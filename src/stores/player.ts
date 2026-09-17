import { defineStore } from 'pinia'
import { markRaw, reactive } from 'vue'
import {
  parseTrackMeta,
  fetchSidecarLrc,
  fetchCachedLyrics,
  cachedToMeta,
  type TrackMeta,
  type CachedMeta,
} from '../lib/metadata'
import type { LyricLine } from '../lib/lrc'
import { setupMediaSession, updateMediaSession, updatePositionState } from '../lib/mediaSession'
import { filenameOf, stableId } from '../lib/track'
import {
  normalizePlaylists,
  playlistMatches,
  orderByUrls,
  mergePlaylists,
  isRadio,
  type PlaylistDef,
} from '../lib/playlists'
import {
  parsePlaylist,
  applyOverride,
  type TrackOverride,
  type PlaylistEntry,
} from '../lib/playlist'
import { buildDaily, dateKey, parseDailyFile, DAILY_ID, type DailyPick } from '../lib/daily'
import { parseEmbyFile, EMBY_META_URL } from '../lib/emby'
import {
  ARTISTS_URL,
  parseArtistsFile,
  findArtist,
  findAlbumNote,
  normName,
  artistKey,
  splitArtists,
  simplify,
  trackArtistKeys,
  type ArtistsFile,
  type ArtistInfo,
} from '../lib/artists'

export interface Track {
  /** 由 stableId(url) 得出，跨会话稳定；收藏/历史类功能靠它对齐同一首歌 */
  id: string
  url: string
  meta: TrackMeta | null
  /** playlist.json 里为这首写的人工覆写；每次解析出新元数据后都会重新叠上去 */
  override?: TrackOverride
  /** 覆写里的标签，供歌单规则匹配（单独拎出来，规则层不需要知道 override 结构） */
  tags: string[]
  /** 同步歌词；预生成路径下由 loadLyrics() 在播放到该曲目时按需填充 */
  lyrics: LyricLine[]
  /** 预生成的歌词文件路径（meta.json 的 lyricsUrl）；undefined = 该曲目无歌词 */
  lyricsUrl?: string
  /** 非同步纯文本歌词 */
  plainLyrics?: string
  /** 歌词是否已尝试加载过：区分「还没拉」和「确实没有」 */
  lyricsLoaded: boolean
  loading: boolean
  error?: string
}

/** 曲库按「歌手 + 专辑」聚合出的一张专辑 */
export interface AlbumGroup {
  name: string
  artist: string
  /** 封面：优先曲库内嵌图，没有才用 Apple Music 的 */
  cover?: string
  year?: number
  trackCount: number
  /** Apple Music 的专辑推荐语 */
  note?: string
  /** Apple Music 专辑页 */
  amUrl?: string
}

/** 正在拉取歌词的曲目 id，用于合并并发请求（非响应式数据，不必放进 state） */
const lyricsPending = new Set<string>()

/** 解析后的歌单：定义 + 当前命中的曲目 */
export interface Collection {
  def: PlaylistDef
  tracks: Track[]
  isRadio: boolean
}

export type RepeatMode = 'off' | 'all' | 'one'

const PLAYLIST_URL = '/playlist.json'
const META_URL = '/meta.json'
const LISTS_URL = '/playlists.json'
/** cron（.github/workflows/daily.yml）每天生成的当天推荐 */
const DAILY_URL = '/daily.json'

/** 只回收运行时解析产生的 blob 封面；预生成的封面是普通路径，不能 revoke */
function revokeCover(url?: string) {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
}

export const usePlayerStore = defineStore('player', {
  state: () => ({
    tracks: [] as Track[],
    /** restore() 是否已完成：完成前列表显示加载态，而不是「歌单是空的」 */
    playlistLoaded: false,
    currentIndex: -1,
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    shuffle: false,
    repeat: 'off' as RepeatMode,
    showNowPlaying: false,
    /** 「接下来播放」队列：存 track id，按顺序优先于列表顺序播放 */
    upNext: [] as string[],
    audio: null as HTMLAudioElement | null,

    /** 歌单与电台：手工的来自 public/playlists.json，Emby 的来自 public/emby.json */
    playlists: [] as PlaylistDef[],
    /** 播放上下文：当前歌单/电台的曲目 id 顺序；空数组 = 整个资料库 */
    context: [] as string[],
    /** 上下文名称，用于在界面上说明「正在播放哪个歌单」 */
    contextLabel: '',
    /** 歌手简介 / Apple Music 专辑推荐语等补充资料（public/artists.json） */
    artists: { generatedAt: '', artists: {} } as ArtistsFile,
    /** 电台封面的随机种子：每次点电台都换一张新封面 */
    radioSeed: 20260916,
    /**
     * 搜索框里的词。
     * 放在 store 而不是 SearchView 里：搜索页也是个导航层，点进歌手页再返回时
     * 组件会被卸载重建，词放组件里就丢了（返回后是个空搜索框）。
     */
    searchQuery: '',
  }),

  getters: {
    currentTrack(state): Track | null {
      return state.currentIndex >= 0 ? state.tracks[state.currentIndex] : null
    },
    /** 展示用标题 */
    displayTitle(): string {
      const t = this.currentTrack
      if (!t) return ''
      return t.meta?.title || filenameOf(t.url).replace(/\.[a-z0-9]+$/i, '')
    },
    displayArtist(): string {
      return this.artistText(this.currentTrack?.meta?.artist)
    },

    /**
     * 解析所有歌单：电台收全部曲目，普通歌单按匹配规则筛选，
     * 一首都没命中的歌单直接隐藏（避免出现空卡片）。
     */
    collections(state): Collection[] {
      return state.playlists
        .map((def) => {
          const isR = isRadio(def)
          return {
            def,
            isRadio: isR,
            tracks: isR
              ? state.tracks
              : orderByUrls(def, state.tracks.filter((t) => playlistMatches(def, t))),
          }
        })
        .filter((c) => c.tracks.length > 0)
    },
    radioCollection(): Collection | null {
      return this.collections.find((c) => c.isRadio) ?? null
    },
    /** 首页推荐网格（不含电台，电台单独做成横幅） */
    playlistCards(): Collection[] {
      return this.collections.filter((c) => !c.isRadio)
    },

    /**
     * id → 曲目下标。凡是「按 id 找曲目 / 找位置」的地方都走它：
     * 原先是每处现写 tracks.findIndex / tracks.some，单看是 O(n)，
     * 一旦套进「遍历一份 n 长的 id 列表」，整体就退化成 O(n²) ——
     * 4000 首的曲库上是 1600 万次比较，实测「播放全部」被卡住 6 秒。
     */
    trackIndexById(state): Map<string, number> {
      const m = new Map<string, number>()
      state.tracks.forEach((t, i) => m.set(t.id, i))
      return m
    },
    /** 曲库里现存的 id 集合，供 setContext / playOrder 做存在性判定 */
    trackIdSet(state): Set<string> {
      return new Set(state.tracks.map((t) => t.id))
    },
    /**
     * 「接下来播放」的 id 集合。
     * 列表里每一行都要判断自己有没有排队，写成 upNext.includes(id) 的话
     * 行数 × 队列长度，且队列一变全表重算。
     */
    upNextSet(state): Set<string> {
      return new Set(state.upNext)
    },

    /**
     * 当前播放顺序：有歌单上下文就在歌单内循环，否则是整个资料库。
     * 顺带过滤已被移除的曲目。
     */
    playOrder(state): string[] {
      if (!state.context.length) return state.tracks.map((t) => t.id)
      const have = this.trackIdSet
      return state.context.filter((id) => have.has(id))
    },

    /**
     * 身份键 → 展示名：同一个人的各种写法先统一成简体再多票取一，票数最多的当页面标题。
     * 曲库里「張韶涵」37 首、「张韶涵」72 首，简化后并成 109 票，页面统一显示「张韶涵」；
     * 「容祖兒」261 首同理显示「容祖儿」，不会因为繁体写法恰好更多就把标题写成繁体。
     * 键本身是归一化的产物（比如 S.E.N.S. 的键是 sens），不能当名字用，
     * 所以展示名必须单独算这一层。
     */
    artistNames(state): Record<string, string> {
      const counts = new Map<string, Map<string, number>>()
      for (const t of state.tracks) {
        for (const p of splitArtists(t.meta?.artist ?? '')) {
          const k = artistKey(p.name)
          if (!k) continue
          let m = counts.get(k)
          if (!m) {
            m = new Map<string, number>()
            counts.set(k, m)
          }
          const label = simplify(p.name)
          m.set(label, (m.get(label) ?? 0) + 1)
        }
      }
      const out: Record<string, string> = {}
      for (const [k, m] of counts) {
        let best = ''
        let bestN = -1
        // 票数相同时留下先出现的那个（Map 的遍历顺序就是首次出现的顺序）
        for (const [name, n] of m) {
          if (n > bestN) {
            best = name
            bestN = n
          }
        }
        out[k] = best
      }
      return out
    },
  },

  actions: {
    initAudio() {
      if (this.audio) return
      const a = new Audio()
      a.preload = 'auto'
      a.crossOrigin = 'anonymous'
      a.addEventListener('timeupdate', () => {
        this.currentTime = a.currentTime
        updatePositionState(this)
      })
      a.addEventListener('loadedmetadata', () => {
        this.duration = a.duration
      })
      // 暂停状态下 seek 不会触发 timeupdate，必须监听 seeked 同步界面
      a.addEventListener('seeked', () => {
        this.currentTime = a.currentTime
        updatePositionState(this)
      })
      a.addEventListener('ended', () => this.onEnded())
      a.addEventListener('play', () => {
        this.playing = true
        updateMediaSession(this)
      })
      a.addEventListener('pause', () => {
        this.playing = false
        updateMediaSession(this)
      })
      a.addEventListener('error', () => {
        // 直连音频加载/取数失败时，走代理重载一次，并恢复出错前的播放位置。
        // 不恢复进度的话，seek 触发的网络错误会把歌曲拉回开头（表现为"seek 从头播"）。
        const cur = this.currentTrack
        if (!cur || !a.src || a.src.includes('/api/proxy')) return
        const resumeAt = a.currentTime
        const wasPlaying = this.playing
        a.src = `/api/proxy?url=${encodeURIComponent(cur.url)}`
        a.load()
        const restore = () => {
          a.removeEventListener('loadedmetadata', restore)
          a.currentTime = resumeAt
          if (wasPlaying) a.play().catch(() => {})
        }
        a.addEventListener('loadedmetadata', restore)
      })
      a.volume = this.volume
      // markRaw：audio 不需要响应式包装，避免 Proxy 影响 DOM API 行为
      this.audio = markRaw(a)
      setupMediaSession(this)
    },

    /**
     * 批量添加曲目
     * @param entries 来自 playlist.json，已解析成「直链 + 人工覆写」
     * @param cached  来自 public/meta.json 的预解析结果，命中则直接渲染、不再联网解析
     */
    addUrls(entries: PlaylistEntry[], cached: Record<string, CachedMeta> = {}) {
      const added: Track[] = []
      // 用 Set 记住已经有的直链：原先每加一首都 some() 扫一遍曲库，
      // 几千首的库整体入库就退化成 O(n²)（每次刷新都要跑一遍）
      const seen = new Set(this.tracks.map((t) => t.url))
      for (const entry of entries) {
        const { url } = entry
        if (seen.has(url)) continue
        seen.add(url)
        const hit = cached[url]
        // 必须用 reactive() 包一层：否则后续 loadMeta 拿到的是 raw 引用，
        // 对它的赋值不会触发界面更新（表现为永远"解析中…"）
        added.push(
          reactive({
            id: stableId(url),
            url,
            override: entry.override ?? undefined,
            tags: entry.override?.tags ?? [],
            // 覆写先叠一次：即使 meta.json 没缓存、网络还没回，
            // 人工写死的标题/歌手/封面也能立刻显示出来
            meta: applyOverride(hit ? cachedToMeta(hit) : null, entry.override),
            lyrics: [] as LyricLine[],
            lyricsUrl: hit?.lyricsUrl ?? undefined,
            lyricsLoaded: false,
            // 有覆写不代表元数据齐全（时长、码率还得联网拿），只看缓存有没有命中
            loading: !hit,
          }),
        )
      }
      this.tracks.push(...added)
      // 这里刻意不为每条曲目探测歌词：预生成路径下歌词是独立文件，
      // 等真正播放到该曲目时由 loadLyrics() 拉取。否则歌单有多少首，
      // 首屏就有多少个并发请求（100 首 = 100 个）。
      for (const t of added) {
        if (t.loading) this.loadMeta(t)
      }
    },

    async loadMeta(track: Track) {
      track.loading = true
      track.error = undefined
      try {
        const parsed = await parseTrackMeta(track.url, filenameOf(track.url))
        const { lyrics, plainLyrics, ...meta } = parsed
        // 落地前回收可能存在的旧 blob 封面（覆写用的是静态路径，不受影响）
        revokeCover(track.meta?.coverUrl)
        // 刚解析出来的是音频里的原始 tag，人工覆写要再叠一次才算最终值
        track.meta = applyOverride(meta, track.override)
        track.lyrics = lyrics
        track.plainLyrics = plainLyrics
        if (lyrics.length === 0 && !plainLyrics) {
          track.lyrics = await fetchSidecarLrc(track.url)
        }
      } catch (e) {
        track.error = String(e)
        track.meta = applyOverride(
          {
            title: filenameOf(track.url).replace(/\.[a-z0-9]+$/i, ''),
            artist: '',
            album: '',
          },
          track.override,
        )
      } finally {
        track.lyricsLoaded = true
        track.loading = false
      }
    },

    /**
     * 按需加载歌词：优先读预生成好的歌词文件，没有则退回同路径外挂 .lrc。
     * 切到某首曲目时才调用；同一曲目只尝试一次，并发调用自动合并。
     */
    async loadLyrics(track: Track) {
      if (track.lyricsLoaded || lyricsPending.has(track.id)) return
      lyricsPending.add(track.id)
      try {
        if (track.lyricsUrl) {
          const { synced, plain } = await fetchCachedLyrics(track.lyricsUrl)
          track.lyrics = synced
          track.plainLyrics = plain
        }
        if (track.lyrics.length === 0 && !track.plainLyrics) {
          track.lyrics = await fetchSidecarLrc(track.url)
        }
      } finally {
        lyricsPending.delete(track.id)
        track.lyricsLoaded = true
      }
    },

    play(index: number) {
      if (index < 0 || index >= this.tracks.length) return
      this.initAudio()
      this.currentIndex = index
      const t = this.tracks[index]
      const a = this.audio!
      a.src = t.url
      a.currentTime = 0
      this.currentTime = 0
      this.duration = t.meta?.duration ?? 0
      updateMediaSession(this)
      a.play().catch(() => {})
      // 歌词按需拉取：不阻塞播放，也不影响首屏
      void this.loadLyrics(t)
    },

    /** 按 track id 播放（歌单详情页用，不改变播放上下文） */
    playId(id: string) {
      const i = this.trackIndexById.get(id)
      if (i !== undefined) this.play(i)
    },

    /** 从「资料库」列表点播：退出歌单上下文，回到整个资料库顺序 */
    playFromLibrary(id: string) {
      this.context = []
      this.contextLabel = ''
      this.playId(id)
    },

    /**
     * 按一份临时列表（搜索结果这种）播放其中某一首：
     * 点哪首就从哪首开始，往后顺着这份列表走，而不是回到整个资料库。
     */
    playInContext(id: string, ids: string[], label: string) {
      this.setContext(ids, label)
      // 上一份上下文的待播队列不能带过来，否则「接下来播放」会串味
      this.upNext = []
      this.playId(id)
    },

    /** 歌手的补充资料（简介 / Apple Music 链接）；曲库里没有该歌手时为 undefined */
    artistInfo(name: string): ArtistInfo | undefined {
      return findArtist(this.artists, name)
    },

    /**
     * 一整条 artist 字段的展示文本（播放条、待播队列、右键菜单这类只有一个字符串位置的地方用）。
     * 只逐字归一成简体、分隔符照旧，联名仍显示成「阿悄, 庄心妍 & 王麟」；
     * 要「每位各自可点」的那种渲染在 TrackRow 里，走 splitArtists + artistLabel。
     */
    artistText(raw: string | null | undefined): string {
      return simplify(String(raw ?? '').trim()) || '未知艺术家'
    },

    /**
     * 歌手的展示名 —— 一律是简体。入参是身份键（URL 里那个），必要时也能喂原始写法。
     * 退路依次是：曲库里票数最多的写法 → artists.json 里的名字 → 键本身（实在没有就显示键）；
     * 后两条也过一遍 simplify，免得产物还没重跑时繁体名从退路漏出来。
     */
    artistLabel(name: string): string {
      const k = artistKey(name)
      const fromLibrary = this.artistNames[k]
      if (fromLibrary) return fromLibrary
      const stored = this.artists.artists[k]?.name
      if (stored) return simplify(stored)
      return simplify(name)
    },

    /** 某位歌手在曲库里的全部曲目（联名的歌曲也算他的：阿悄 & 徐良 两边都能查到） */
    artistTracks(name: string): Track[] {
      const k = artistKey(name)
      if (!k) return []
      return this.tracks.filter((t) => trackArtistKeys(t.meta?.artist ?? '').includes(k))
    },

    /**
     * 某位歌手在曲库里的专辑。
     * 封面与年份优先用曲库自己的（内嵌图与 tag 更贴近实际文件），
     * 缺了才退回 artists.json 里 Apple Music 那份。
     */
    artistAlbums(name: string): AlbumGroup[] {
      const k = artistKey(name)
      const info = this.artistInfo(name)
      const artist = this.artistLabel(name)
      const groups = new Map<string, AlbumGroup>()

      for (const t of this.tracks) {
        if (!trackArtistKeys(t.meta?.artist ?? '').includes(k)) continue
        const album = (t.meta?.album ?? '').trim()
        if (!album) continue
        let g = groups.get(album)
        if (!g) {
          const am = findAlbumNote(info, album)
          g = {
            name: album,
            artist,
            cover: t.meta?.coverUrl ?? am?.cover,
            year: t.meta?.year ?? am?.year,
            trackCount: 0,
            note: am?.note,
            amUrl: am?.amUrl,
          }
          groups.set(album, g)
        }
        g.trackCount++
        if (!g.cover && t.meta?.coverUrl) g.cover = t.meta.coverUrl
        if (!g.year && t.meta?.year) g.year = t.meta.year
      }

      // 新专辑在前；都没年份的按名字排，保证顺序稳定
      return [...groups.values()].sort((a, b) => {
        if (a.year && b.year && a.year !== b.year) return b.year - a.year
        if (a.year && !b.year) return -1
        if (!a.year && b.year) return 1
        return a.name.localeCompare(b.name, 'zh-Hans-CN')
      })
    },

    /** 某张专辑的曲目：歌手按身份键比（繁简/联名都能对上），专辑名按归一化比 */
    albumTracks(artist: string, album: string): Track[] {
      const ka = artistKey(artist)
      const kl = normName(album)
      return this.tracks.filter(
        (t) =>
          trackArtistKeys(t.meta?.artist ?? '').includes(ka) &&
          normName(t.meta?.album ?? '') === kl,
      )
    },

    /** 一张专辑的封面：取该专辑第一首有封面的曲目，退回 Apple Music 的 */
    albumCover(artist: string, album: string): string | undefined {
      const tracks = this.albumTracks(artist, album)
      const hit = tracks.find((t) => t.meta?.coverUrl)
      if (hit?.meta?.coverUrl) return hit.meta.coverUrl
      return findAlbumNote(this.artistInfo(artist), album)?.cover
    },

    /**
     * 设定播放上下文（歌单/电台），顺带清掉「接下来播放」残留队列，
     * 否则上一张歌单排队的曲目会串到新歌单里。
     */
    setContext(ids: string[], label: string) {
      const have = this.trackIdSet
      this.context = ids.filter((id) => have.has(id))
      this.contextLabel = label
    },

    /** 顺序播放整个歌单 */
    playCollection(ids: string[], label: string, opts: { shuffle?: boolean } = {}) {
      this.setContext(ids, label)
      this.upNext = []
      if (opts.shuffle !== undefined) this.shuffle = opts.shuffle
      const order = this.playOrder
      if (!order.length) return
      this.playId(this.shuffle ? order[Math.floor(Math.random() * order.length)] : order[0])
    },

    /** 电台：全部歌曲随机播放 + 循环（永不停止），并换一张新封面 */
    playRadio() {
      this.radioSeed = (Math.random() * 0xffffffff) >>> 0
      const ids = this.tracks.map((t) => t.id)
      this.setContext(ids, '无限电台')
      this.upNext = []
      this.shuffle = true
      // repeat = 'all'：随机取曲也不会撞到「放完就停」的分支，实现无限播放
      this.repeat = 'all'
      const order = this.playOrder
      if (!order.length) return
      this.playId(order[Math.floor(Math.random() * order.length)])
    },

    togglePlay() {
      if (!this.audio) {
        if (this.tracks.length > 0) this.play(0)
        return
      }
      if (this.playing) this.audio.pause()
      else this.audio.play().catch(() => {})
    },

    next(auto = false) {
      if (this.tracks.length === 0) return
      if (auto && this.repeat === 'one') {
        this.audio!.currentTime = 0
        this.audio!.play().catch(() => {})
        return
      }
      // 「接下来播放」队列优先于列表顺序（也优先于随机）
      if (this.upNext.length > 0) {
        const id = this.upNext[0]
        this.upNext = this.upNext.slice(1)
        const queued = this.trackIndexById.get(id)
        if (queued !== undefined) {
          this.play(queued)
          return
        }
        // 目标已被删除则继续往下走
      }

      const order = this.playOrder
      if (order.length === 0) return
      const cur = order.indexOf(this.currentTrack?.id ?? '')
      let idx: number
      if (this.shuffle && order.length > 1) {
        do {
          idx = Math.floor(Math.random() * order.length)
        } while (idx === cur)
      } else {
        idx = cur + 1
        if (idx >= order.length) {
          if (this.repeat === 'off' && auto) {
            this.playing = false
            return
          }
          idx = 0
        }
      }
      this.playId(order[idx])
    },

    prev() {
      if (!this.audio) return
      if (this.currentTime > 3) {
        this.audio.currentTime = 0
        return
      }
      const order = this.playOrder
      if (order.length === 0) return
      const cur = order.indexOf(this.currentTrack?.id ?? '')
      const idx = (cur <= 0 ? order.length : cur) - 1
      this.playId(order[idx])
    },

    seek(sec: number) {
      if (!this.audio) return
      // 钳制到有效区间，防止负值或超出时长导致浏览器行为异常
      const d = this.duration
      const t = d > 0 ? Math.min(Math.max(0, sec), d - 0.25) : Math.max(0, sec)
      this.audio.currentTime = t
      // 乐观更新：暂停态下远程流不会预取目标位置，`seeked` 可能几十秒都不来（实测 25s
      // 仍未触发），界面就停在旧进度 —— 表现为「暂停时拖了没反应」。先按目标值更新，
      // `seeked` 到了再用音频的真实值覆盖（播放态下两者一致，不会有跳动）。
      this.currentTime = t
      updatePositionState(this)
    },

    setVolume(v: number) {
      this.volume = v
      if (this.audio) this.audio.volume = v
    },

    cycleRepeat() {
      const modes: RepeatMode[] = ['off', 'all', 'one']
      this.repeat = modes[(modes.indexOf(this.repeat) + 1) % modes.length]
    },

    /** 「接下来播放」：插到队首，多次操作后点的那首排在最前（与 Apple Music 一致） */
    playNext(id: string) {
      if (!this.trackIndexById.has(id)) return
      if (this.currentTrack?.id === id) return
      this.upNext = [id, ...this.upNext.filter((x) => x !== id)]
    },

    /** 「最后播放」：追加到队尾 */
    playLast(id: string) {
      if (!this.trackIndexById.has(id)) return
      if (this.currentTrack?.id === id) return
      this.upNext = [...this.upNext.filter((x) => x !== id), id]
    },

    remove(id: string) {
      const at = this.trackIndexById.get(id)
      if (at === undefined) return
      const i = at
      this.upNext = this.upNext.filter((x) => x !== id)
      this.context = this.context.filter((x) => x !== id)
      const t = this.tracks[i]
      revokeCover(t.meta?.coverUrl)
      this.tracks.splice(i, 1)
      if (i === this.currentIndex) {
        this.audio?.pause()
        this.currentIndex = -1
        this.playing = false
      } else if (i < this.currentIndex) {
        this.currentIndex--
      }
    },

    clear() {
      for (const t of this.tracks) {
        revokeCover(t.meta?.coverUrl)
      }
      this.tracks = []
      this.upNext = []
      this.context = []
      this.contextLabel = ''
      this.audio?.pause()
      this.currentIndex = -1
      this.playing = false
    },

    onEnded() {
      this.next(true)
    },

    /**
     * 载入歌单：优先用 public/meta.json 的预解析结果（首屏即完整渲染，零等待），
     * 未命中的条目才在后台联网解析。
     * 改动 playlist.json 后，跑一次 `pnpm meta` 再刷新即可。
     */
    async restore() {
      try {
        const [plResp, metaResp, listsResp, embyResp, artistsResp] = await Promise.all([
          fetch(PLAYLIST_URL, { cache: 'no-store' }),
          fetch(META_URL, { cache: 'no-store' }).catch(() => null),
          fetch(LISTS_URL, { cache: 'no-store' }).catch(() => null),
          fetch(EMBY_META_URL, { cache: 'no-store' }).catch(() => null),
          fetch(ARTISTS_URL, { cache: 'no-store' }).catch(() => null),
        ])
        if (!plResp.ok) return

        // 歌手简介这类补充资料：缺失只是页面少一块简介，不影响播放
        if (artistsResp?.ok) {
          try {
            this.artists = parseArtistsFile(await artistsResp.json())
          } catch {
            /* 忽略 */
          }
        }

        let cached: Record<string, CachedMeta> = {}
        if (metaResp?.ok) {
          try {
            cached = (await metaResp.json())?.tracks ?? {}
          } catch {
            /* meta.json 损坏则全部走运行时解析 */
          }
        }

        /**
         * Emby 音乐库（public/emby.json，由 `pnpm emby` 生成）。
         * 与 meta.json 的不同在于它一份文件同时充当「曲目清单」和「元数据」：
         * 每条都自带完整信息，所以键既是播放直链也是曲目来源。
         * 产物缺失或损坏时整个跳过——页面退化成只有手写曲库，不会报错。
         */
        let embyUrls: string[] = []
        let embyLists: PlaylistDef[] = []
        if (embyResp?.ok) {
          try {
            const emby = parseEmbyFile(await embyResp.json())
            embyUrls = Object.keys(emby.tracks)
            embyLists = emby.playlists
            cached = { ...cached, ...emby.tracks }
          } catch {
            /* 忽略 */
          }
        }

        // playlist.json 支持纯字符串与对象（带人工覆写字段）混排，统一在 parsePlaylist 里消化
        this.addUrls(parsePlaylist(await plResp.json()), cached)
        // Emby 曲库排在人工曲库之后：playlist.json 是手工挑选的主曲库，顺序上保持在前
        this.addUrls(
          embyUrls.map((url) => ({ url, override: null })),
          cached,
        )

        this.radioSeed = (Math.random() * 0xffffffff) >>> 0
        if (listsResp?.ok) {
          try {
            this.playlists = normalizePlaylists(await listsResp.json())
          } catch {
            /* playlists.json 损坏则只显示资料库列表 */
          }
        }
        /**
         * Emby 里现成的歌单接在手工歌单之后（合并规则见 lib/playlists.ts 的 mergePlaylists）：
         * 手工的在前、同 id 时手工的胜出，且没写成员规则的手工条目会继承 Emby 的曲目名单。
         */
        this.playlists = mergePlaylists(this.playlists, embyLists)
        // 放在歌单之后：它会把自己插到列表最前面
        await this.loadDaily()
      } catch {
        /* ignore */
      } finally {
        // 无论成败都要置位：失败时也该显示「空歌单」而不是永远转圈
        this.playlistLoaded = true
      }
    },

    /**
     * 每日推荐：优先读 cron 预生成的 public/daily.json，缺失或不是今天的
     * （cron 没跑成、或本地开发没跑过 `pnpm daily`）就按同一套规则就地现算。
     * 选歌规则在 lib/daily.ts 里由前端与脚本共用，所以两条路结果一致，
     * 页面永远有当天的一份，不会因为部署没跟上就空着。
     */
    async loadDaily() {
      if (this.tracks.length === 0) return
      const today = dateKey()
      let pick: DailyPick | null = null
      try {
        const resp = await fetch(DAILY_URL, { cache: 'no-store' })
        if (resp.ok) {
          const file = parseDailyFile(await resp.json())
          // 只认当天那份：留着昨天的清单比现算还糟，等于推荐不更新
          if (file && file.date === today) pick = file
        }
      } catch {
        /* 拿不到文件就现算 */
      }
      pick ??= buildDaily(
        this.tracks.map((t) => t.url),
        today,
      )
      if (pick.urls.length === 0) return

      const def: PlaylistDef = {
        id: DAILY_ID,
        type: 'playlist',
        title: pick.title,
        subtitle: pick.subtitle,
        // urls 是精确匹配：名单外的一律不收，改歌手名也不会让推荐跑偏
        urls: pick.urls,
      }
      // 固定排在最前；playlists.json 里若手写了同 id 的定义，以每天生成的这份为准
      this.playlists = [def, ...this.playlists.filter((p) => p.id !== DAILY_ID)]
    },
  },
})
