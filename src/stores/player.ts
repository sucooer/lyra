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
import { filenameOf } from '../lib/track'
import {
  normalizePlaylists,
  playlistMatches,
  isRadio,
  type PlaylistDef,
} from '../lib/playlists'

export interface Track {
  id: string
  url: string
  meta: TrackMeta | null
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

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

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

    /** public/playlists.json 里定义的歌单与电台 */
    playlists: [] as PlaylistDef[],
    /** 播放上下文：当前歌单/电台的曲目 id 顺序；空数组 = 整个资料库 */
    context: [] as string[],
    /** 上下文名称，用于在界面上说明「正在播放哪个歌单」 */
    contextLabel: '',
    /** 电台封面的随机种子：每次点电台都换一张新封面 */
    radioSeed: 20260916,
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
      return this.currentTrack?.meta?.artist || '未知艺术家'
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
            tracks: isR ? state.tracks : state.tracks.filter((t) => playlistMatches(def, t)),
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
     * 当前播放顺序：有歌单上下文就在歌单内循环，否则是整个资料库。
     * 顺带过滤已被移除的曲目。
     */
    playOrder(state): string[] {
      const ids = state.context.length ? state.context : state.tracks.map((t) => t.id)
      if (!state.context.length) return ids
      return ids.filter((id) => state.tracks.some((t) => t.id === id))
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
     * 批量添加直链
     * @param cached 来自 public/meta.json 的预解析结果，命中则直接渲染、不再联网解析
     */
    addUrls(urls: string[], cached: Record<string, CachedMeta> = {}) {
      const added: Track[] = []
      for (const raw of urls) {
        const url = raw.trim()
        if (!/^https?:\/\//i.test(url)) continue
        if (this.tracks.some((t) => t.url === url)) continue
        // 必须用 reactive() 包一层：否则后续 loadMeta 拿到的是 raw 引用，
        // 对它的赋值不会触发界面更新（表现为永远"解析中…"）
        const hit = cached[url]
        added.push(
          reactive({
            id: uid(),
            url,
            meta: hit ? cachedToMeta(hit) : null,
            lyrics: [] as LyricLine[],
            lyricsUrl: hit?.lyricsUrl ?? undefined,
            lyricsLoaded: false,
            loading: !hit,
          }),
        )
      }
      this.tracks.push(...added)
      // 这里刻意不为每条曲目探测歌词：预生成路径下歌词是独立文件，
      // 等真正播放到该曲目时由 loadLyrics() 拉取。否则歌单有多少首，
      // 首屏就有多少个并发请求（100 首 = 100 个）。
      for (const t of added) {
        if (!t.meta) this.loadMeta(t)
      }
    },

    async loadMeta(track: Track) {
      track.loading = true
      track.error = undefined
      try {
        const parsed = await parseTrackMeta(track.url, filenameOf(track.url))
        const { lyrics, plainLyrics, ...meta } = parsed
        track.meta = meta
        track.lyrics = lyrics
        track.plainLyrics = plainLyrics
        if (lyrics.length === 0 && !plainLyrics) {
          track.lyrics = await fetchSidecarLrc(track.url)
        }
      } catch (e) {
        track.error = String(e)
        track.meta = {
          title: filenameOf(track.url).replace(/\.[a-z0-9]+$/i, ''),
          artist: '',
          album: '',
        }
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
      const i = this.tracks.findIndex((t) => t.id === id)
      if (i >= 0) this.play(i)
    },

    /** 从「资料库」列表点播：退出歌单上下文，回到整个资料库顺序 */
    playFromLibrary(id: string) {
      this.context = []
      this.contextLabel = ''
      this.playId(id)
    },

    /**
     * 设定播放上下文（歌单/电台），顺带清掉「接下来播放」残留队列，
     * 否则上一张歌单排队的曲目会串到新歌单里。
     */
    setContext(ids: string[], label: string) {
      this.context = ids.filter((id) => this.tracks.some((t) => t.id === id))
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
        const queued = this.tracks.findIndex((t) => t.id === id)
        if (queued >= 0) {
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
      this.audio.currentTime = d > 0 ? Math.min(Math.max(0, sec), d - 0.25) : Math.max(0, sec)
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
      if (!this.tracks.some((t) => t.id === id)) return
      if (this.currentTrack?.id === id) return
      this.upNext = [id, ...this.upNext.filter((x) => x !== id)]
    },

    /** 「最后播放」：追加到队尾 */
    playLast(id: string) {
      if (!this.tracks.some((t) => t.id === id)) return
      if (this.currentTrack?.id === id) return
      this.upNext = [...this.upNext.filter((x) => x !== id), id]
    },

    remove(id: string) {
      const i = this.tracks.findIndex((t) => t.id === id)
      if (i < 0) return
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
        const [plResp, metaResp, listsResp] = await Promise.all([
          fetch(PLAYLIST_URL, { cache: 'no-store' }),
          fetch(META_URL, { cache: 'no-store' }).catch(() => null),
          fetch(LISTS_URL, { cache: 'no-store' }).catch(() => null),
        ])
        if (!plResp.ok) return
        const data = await plResp.json()
        if (!Array.isArray(data)) return

        let cached: Record<string, CachedMeta> = {}
        if (metaResp?.ok) {
          try {
            cached = (await metaResp.json())?.tracks ?? {}
          } catch {
            /* meta.json 损坏则全部走运行时解析 */
          }
        }
        this.addUrls(data.filter((u: unknown) => typeof u === 'string'), cached)

        this.radioSeed = (Math.random() * 0xffffffff) >>> 0
        if (listsResp?.ok) {
          try {
            this.playlists = normalizePlaylists(await listsResp.json())
          } catch {
            /* playlists.json 损坏则只显示资料库列表 */
          }
        }
      } catch {
        /* ignore */
      } finally {
        // 无论成败都要置位：失败时也该显示「空歌单」而不是永远转圈
        this.playlistLoaded = true
      }
    },
  },
})
