/**
 * 音频元数据解析
 * - 优先 HTTP Range 分块拉取（只下载头部，40MB FLAC 只需 ~1MB）
 * - CORS 失败自动回落到 /api/proxy 中转
 * - 解析内嵌封面 / 歌词 / 标题 / 歌手 / 专辑等
 */
import { parseBlob, type IAudioMetadata } from 'music-metadata'
import { looksLikeLrc, parseLrc, type LyricLine } from './lrc'

export interface TrackMeta {
  title: string
  artist: string
  album: string
  albumArtist?: string
  year?: number
  trackNo?: number
  duration?: number
  codec?: string
  bitrate?: number
  sampleRate?: number
  /** 封面 ObjectURL（由调用方负责 revoke）或站点内静态路径 */
  coverUrl?: string
}

/**
 * 运行时解析（直链现解）的结果：元数据 + 内嵌歌词。
 * 歌词不挂在 TrackMeta 上——预生成路径下它是单独按需拉取的，两条路径在这里统一。
 */
export interface ParsedTrack extends TrackMeta {
  /** 同步歌词 */
  lyrics: LyricLine[]
  /** 非同步纯文本歌词（内嵌但非 LRC 格式时） */
  plainLyrics?: string
}

const RANGE_HEAD_SIZE = 1024 * 1024 * 2 // 先拉头部 2MB
const RANGE_MAX_SIZE = 1024 * 1024 * 12 // 封面较大时最多拉 12MB

function proxied(url: string): string {
  return `/api/proxy?url=${encodeURIComponent(url)}`
}

async function fetchRange(
  url: string,
  start: number,
  end: number,
  useProxy: boolean,
): Promise<{ blob: Blob; total: number }> {
  const target = useProxy ? proxied(url) : url
  const resp = await fetch(target, {
    headers: { Range: `bytes=${start}-${end}` },
  })
  if (!resp.ok && resp.status !== 206) {
    throw new Error(`fetch failed: ${resp.status}`)
  }
  const total = parseTotal(resp)
  return { blob: await resp.blob(), total }
}

function parseTotal(resp: Response): number {
  const cr = resp.headers.get('content-range')
  if (cr) {
    const m = cr.match(/\/(\d+)\s*$/)
    if (m) return parseInt(m[1], 10)
  }
  const len = resp.headers.get('content-length')
  return len ? parseInt(len, 10) : 0
}

function mimeFromUrl(url: string): string | undefined {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    flac: 'audio/flac',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    opus: 'audio/ogg',
    wav: 'audio/wav',
  }
  return ext ? map[ext] : undefined
}

function toMeta(ia: IAudioMetadata, coverUrl?: string): ParsedTrack {
  const c = ia.common
  let lyrics: LyricLine[] = []
  let plainLyrics: string | undefined

  const lyricTexts: string[] = []
  if (c.lyrics) {
    for (const l of c.lyrics) {
      if (typeof l === 'string') lyricTexts.push(l)
      else if (Array.isArray(l.syncText) && l.syncText.length) {
        // 内嵌同步歌词（SYLT）
        lyrics = l.syncText
          .filter((s) => s.timestamp !== undefined)
          .map((s) => ({ time: (s.timestamp as number) / 1000, text: s.text }))
          .sort((a, b) => a.time - b.time)
      } else if (l.text) lyricTexts.push(l.text)
    }
  }
  if (lyrics.length === 0) {
    for (const t of lyricTexts) {
      if (looksLikeLrc(t)) {
        lyrics = parseLrc(t)
        break
      }
    }
    if (lyrics.length === 0 && lyricTexts.length > 0) {
      plainLyrics = lyricTexts[0]
    }
  }

  return {
    title: c.title ?? '',
    artist: c.artist ?? c.artists?.[0] ?? '',
    album: c.album ?? '',
    albumArtist: c.albumartist,
    year: c.year,
    trackNo: c.track.no ?? undefined,
    duration: ia.format.duration,
    codec: ia.format.codec,
    bitrate: ia.format.bitrate ? Math.round(ia.format.bitrate / 1000) : undefined,
    sampleRate: ia.format.sampleRate,
    coverUrl,
    lyrics,
    plainLyrics,
  }
}

/**
 * public/meta.json 中单条记录的结构（由 scripts/gen-meta.mjs 预生成）。
 * 与 TrackMeta 的区别：封面是站点内的静态路径而非 blob URL。
 */
export interface CachedMeta {
  title: string
  artist: string
  album: string
  albumArtist?: string | null
  year?: number | null
  trackNo?: number | null
  duration?: number | null
  codec?: string | null
  bitrate?: number | null
  sampleRate?: number | null
  /** 相对站点根的封面路径，如 /covers/xxxx.jpg */
  cover?: string | null
  /** 相对站点根的歌词文件路径，如 /lyrics/xxxx.json；null = 该曲目没有内嵌歌词 */
  lyricsUrl?: string | null
}

export function cachedToMeta(c: CachedMeta): TrackMeta {
  return {
    title: c.title,
    artist: c.artist,
    album: c.album,
    albumArtist: c.albumArtist ?? undefined,
    year: c.year ?? undefined,
    trackNo: c.trackNo ?? undefined,
    duration: c.duration ?? undefined,
    codec: c.codec ?? undefined,
    bitrate: c.bitrate ?? undefined,
    sampleRate: c.sampleRate ?? undefined,
    coverUrl: c.cover ?? undefined,
  }
}

export interface CachedLyrics {
  synced: LyricLine[]
  plain?: string
}

/**
 * 按需拉取预生成的歌词文件。
 * 只在播放到该曲目时才调用，列表页完全不碰——这正是 meta.json 能瘦掉九成的原因。
 */
export async function fetchCachedLyrics(url: string): Promise<CachedLyrics> {
  try {
    const resp = await fetch(url)
    if (!resp.ok) return { synced: [] }
    const data: unknown = await resp.json()
    const d = data as { synced?: unknown; plain?: unknown } | null

    const synced: LyricLine[] = Array.isArray(d?.synced)
      ? d.synced.flatMap((l) => {
          const line = l as Partial<LyricLine>
          return typeof line.text === 'string' &&
            typeof line.time === 'number' &&
            Number.isFinite(line.time)
            ? [{ time: line.time, text: line.text }]
            : []
        })
      : []
    const plain = typeof d?.plain === 'string' && d.plain.length > 0 ? d.plain : undefined
    return { synced, plain }
  } catch {
    return { synced: [] }
  }
}

function extractCover(ia: IAudioMetadata): string | undefined {
  const pic = ia.common.picture?.[0]
  if (!pic) return undefined
  const blob = new Blob([pic.data], { type: pic.format || 'image/jpeg' })
  return URL.createObjectURL(blob)
}

/**
 * 解析直链音频的元数据
 * @param url 音频直链
 * @param filename 无元数据时回退显示的文件名
 */
export async function parseTrackMeta(url: string, filename = ''): Promise<ParsedTrack> {
  let useProxy = false

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // 第一段：头部 2MB
      let { blob, total } = await fetchRange(url, 0, RANGE_HEAD_SIZE - 1, useProxy)
      const mime = mimeFromUrl(url)
      try {
        const ia = await parseBlob(blob, {
          mimeType: mime,
          duration: true,
          skipCovers: false,
        })
        return toMeta(ia, extractCover(ia))
      } catch (e) {
        // 头部不够（封面太大或元数据靠后），扩大到 12MB 再试一次
        if (total > RANGE_HEAD_SIZE && blob.size < total) {
          blob = (await fetchRange(url, 0, Math.min(total - 1, RANGE_MAX_SIZE - 1), useProxy)).blob
          const ia = await parseBlob(blob, {
            mimeType: mime,
            duration: true,
            skipCovers: false,
          })
          return toMeta(ia, extractCover(ia))
        }
        throw e
      }
    } catch (e) {
      // 直连失败（多半 CORS），切代理重试一次
      if (!useProxy) {
        useProxy = true
        continue
      }
      throw e
    }
  }
  throw new Error('unreachable')
}

/** 尝试拉取同路径 .lrc 外部歌词 */
export async function fetchSidecarLrc(audioUrl: string): Promise<LyricLine[]> {
  const lrcUrl = audioUrl.replace(/\.[a-z0-9]+(\?.*)?$/i, '.lrc$1')
  try {
    let resp = await fetch(lrcUrl)
    if (!resp.ok) {
      resp = await fetch(proxied(lrcUrl))
    }
    if (!resp.ok) return []
    const text = await resp.text()
    return looksLikeLrc(text) ? parseLrc(text) : []
  } catch {
    return []
  }
}
