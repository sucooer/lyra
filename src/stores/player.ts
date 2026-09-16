import { defineStore } from 'pinia'
import { reactive } from 'vue'
import {
  parseTrackMeta,
  fetchSidecarLrc,
  cachedToMeta,
  type TrackMeta,
  type CachedMeta,
} from '../lib/metadata'
import type { LyricLine } from '../lib/lrc'
import { setupMediaSession, updateMediaSession, updatePositionState } from '../lib/mediaSession'

export interface Track {
  id: string
  url: string
  meta: TrackMeta | null
  lyrics: LyricLine[]
  loading: boolean
  error?: string
}

export type RepeatMode = 'off' | 'all' | 'one'

const PLAYLIST_URL = '/playlist.json'
const META_URL = '/meta.json'

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

/** 只回收运行时解析产生的 blob 封面；预生成的封面是普通路径，不能 revoke */
function revokeCover(url?: string) {
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
}

function filenameOf(url: string): string {
  try {
    const p = decodeURIComponent(new URL(url).pathname)
    return p.split('/').pop() ?? url
  } catch {
    return url.split('/').pop() ?? url
  }
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
    audio: null as HTMLAudioElement | null,
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
        // 直连音频加载失败时，走代理重载一次
        const cur = this.currentTrack
        if (cur && a.src && !a.src.includes('/api/proxy')) {
          a.src = `/api/proxy?url=${encodeURIComponent(cur.url)}`
          a.load()
          if (this.playing) a.play().catch(() => {})
        }
      })
      a.volume = this.volume
      this.audio = a
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
            lyrics: hit?.lyrics ?? [],
            loading: !hit,
          }),
        )
      }
      this.tracks.push(...added)
      for (const t of added) {
        if (t.meta) {
          // 预生成结果里没有歌词时，后台再试一次外挂 .lrc（不阻塞渲染）
          if (t.lyrics.length === 0) {
            fetchSidecarLrc(t.url).then((l) => {
              if (l.length) t.lyrics = l
            })
          }
        } else {
          this.loadMeta(t)
        }
      }
    },

    async loadMeta(track: Track) {
      track.loading = true
      track.error = undefined
      try {
        track.meta = await parseTrackMeta(track.url, filenameOf(track.url))
        track.lyrics = track.meta.lyrics
        if (track.lyrics.length === 0) {
          track.lyrics = await fetchSidecarLrc(track.url)
        }
      } catch (e) {
        track.error = String(e)
        track.meta = {
          title: filenameOf(track.url).replace(/\.[a-z0-9]+$/i, ''),
          artist: '',
          album: '',
          lyrics: [],
        }
      } finally {
        track.loading = false
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
      let idx: number
      if (this.shuffle && this.tracks.length > 1) {
        do {
          idx = Math.floor(Math.random() * this.tracks.length)
        } while (idx === this.currentIndex)
      } else {
        idx = this.currentIndex + 1
        if (idx >= this.tracks.length) {
          if (this.repeat === 'off' && auto) {
            this.playing = false
            return
          }
          idx = 0
        }
      }
      this.play(idx)
    },

    prev() {
      if (!this.audio) return
      if (this.currentTime > 3) {
        this.audio.currentTime = 0
        return
      }
      const idx = this.currentIndex - 1
      this.play(idx < 0 ? this.tracks.length - 1 : idx)
    },

    seek(sec: number) {
      if (this.audio) this.audio.currentTime = sec
    },

    setVolume(v: number) {
      this.volume = v
      if (this.audio) this.audio.volume = v
    },

    cycleRepeat() {
      const modes: RepeatMode[] = ['off', 'all', 'one']
      this.repeat = modes[(modes.indexOf(this.repeat) + 1) % modes.length]
    },

    remove(id: string) {
      const i = this.tracks.findIndex((t) => t.id === id)
      if (i < 0) return
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
        const [plResp, metaResp] = await Promise.all([
          fetch(PLAYLIST_URL, { cache: 'no-store' }),
          fetch(META_URL, { cache: 'no-store' }).catch(() => null),
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
      } catch {
        /* ignore */
      } finally {
        // 无论成败都要置位：失败时也该显示「空歌单」而不是永远转圈
        this.playlistLoaded = true
      }
    },
  },
})
