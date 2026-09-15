import { defineStore } from 'pinia'
import { reactive } from 'vue'
import { parseTrackMeta, fetchSidecarLrc, type TrackMeta } from '../lib/metadata'
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

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
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

    /** 批量添加直链 */
    addUrls(urls: string[]) {
      const added: Track[] = []
      for (const raw of urls) {
        const url = raw.trim()
        if (!/^https?:\/\//i.test(url)) continue
        if (this.tracks.some((t) => t.url === url)) continue
        // 必须用 reactive() 包一层：否则后续 loadMeta 拿到的是 raw 引用，
        // 对它的赋值不会触发界面更新（表现为永远"解析中…"）
        added.push(reactive({ id: uid(), url, meta: null, lyrics: [], loading: true }))
      }
      this.tracks.push(...added)
      for (const t of added) this.loadMeta(t)
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
      if (t.meta?.coverUrl) URL.revokeObjectURL(t.meta.coverUrl)
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
        if (t.meta?.coverUrl) URL.revokeObjectURL(t.meta.coverUrl)
      }
      this.tracks = []
      this.audio?.pause()
      this.currentIndex = -1
      this.playing = false
    },

    onEnded() {
      this.next(true)
    },

    /** 从 public/playlist.json 读取歌单（歌单即文件，改动后刷新页面生效） */
    async restore() {
      try {
        const resp = await fetch(PLAYLIST_URL, { cache: 'no-store' })
        if (!resp.ok) return
        const data = await resp.json()
        if (Array.isArray(data)) {
          this.addUrls(data.filter((u: unknown) => typeof u === 'string'))
        }
      } catch {
        /* ignore */
      }
    },
  },
})
