/**
 * public/playlist.json（曲库源文件）的结构与解析。
 *
 * 和 playlists.ts 的分工，别搞混：
 *   - playlist.json  = 曲库本身，逐首列出音频直链，是「有哪些歌」的唯一真相源
 *   - playlists.json = 歌单分组规则，从曲库里按歌手 / 专辑 / 标签挑歌
 *
 * 每条支持两种写法，可以混排：
 *   "https://.../a.flac"
 *   { "url": "https://.../b.flac",
 *     "title": "粉雪", "artist": "レミオロメン", "album": "...",
 *     "cover": "/covers/xxxx.jpg", "tags": ["日系", "冬季"] }
 *
 * 对象形式是为「人工覆写」准备的：音频内嵌 tag 写错、缺失或封面不对时，
 * 在这里盖一层即可，改完刷新页面就生效，不需要重跑 gen-meta。
 * 没写的字段继续沿用音频里解析出来的值。
 */
import type { TrackMeta } from './metadata'

export interface TrackOverride {
  title?: string
  artist?: string
  album?: string
  /** 自定义封面：站点内路径（/covers/xxx.jpg）或外链 */
  cover?: string
  /** 自由标签，供 playlists.json 的 tags 规则匹配 */
  tags?: string[]
}

export interface PlaylistEntry {
  url: string
  /** null = 这一条没做任何覆写 */
  override: TrackOverride | null
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/** 解析 playlist.json：纯字符串与对象混排都接受；非法条目和重复直链直接丢弃 */
export function parsePlaylist(raw: unknown): PlaylistEntry[] {
  if (!Array.isArray(raw)) return []
  const out: PlaylistEntry[] = []
  const seen = new Set<string>()

  for (const item of raw) {
    let url: string | undefined
    let override: TrackOverride | null = null

    if (typeof item === 'string') {
      url = str(item)
    } else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      url = str(o.url)
      const ov: TrackOverride = {
        title: str(o.title),
        artist: str(o.artist),
        album: str(o.album),
        cover: str(o.cover),
        tags: Array.isArray(o.tags) ? o.tags.map(str).filter((x): x is string => !!x) : undefined,
      }
      if (ov.title || ov.artist || ov.album || ov.cover || ov.tags?.length) override = ov
    }

    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    out.push({ url, override })
  }
  return out
}

/** 覆写里是否带了能直接显示出来的字段 */
function hasDisplayFields(ov: TrackOverride): boolean {
  return !!(ov.title || ov.artist || ov.album || ov.cover)
}

/**
 * 把人工覆写叠到解析结果上，返回新对象（不改原 meta）。
 * meta 为 null（还没联网解析）时，只要覆写带了展示字段就合成一个兜底 meta，
 * 让列表先有标题可显示；只写了 tags 的话返回 null，不凭空造 meta。
 */
export function applyOverride(meta: TrackMeta | null, ov?: TrackOverride | null): TrackMeta | null {
  if (!ov) return meta
  if (!meta && !hasDisplayFields(ov)) return null
  const base: TrackMeta = meta ?? { title: '', artist: '', album: '' }
  return {
    ...base,
    title: ov.title ?? base.title,
    artist: ov.artist ?? base.artist,
    album: ov.album ?? base.album,
    coverUrl: ov.cover ?? base.coverUrl,
  }
}
