/**
 * Emby 音乐库的接入约定。
 *
 * 这一份同时被两边使用，不能各写一套：
 *   - scripts/gen-emby.mjs —— 生成 public/emby.json 时算出直链与歌单 id
 *   - src/stores/player.ts —— 加载时把这些直链并进曲库、歌单并进歌单列表
 * 两边对「直链 / 歌单 id 长什么样」必须逐字一致，否则 emby.json 里的键就命不中曲目，
 * 表现为列表里一堆「未知曲目」且每首都去联网重解析。
 *
 * 关于直链形态：它并不是音频文件地址，而是本站的取流端点
 * （/api/emby/stream?id=<条目 id>）。这么做有两个原因，见 functions/api/emby/stream.js：
 * 站点是 https 而 Emby 只有 http；且 Emby 取流必须带 api_key，不能交给前端。
 */
import type { CachedMeta } from './metadata'
import type { PlaylistDef } from './playlists'

export const EMBY_STREAM_PATH = '/api/emby/stream'
export const EMBY_COVER_PATH = '/api/emby/cover'
export const EMBY_LYRICS_PATH = '/api/emby/lyrics'

/**
 * Emby 歌单并入本站歌单时统一加这个前缀。
 * 前缀的作用是让两个来源的 id 不可能撞车：手写的 playlists.json 用的是
 * 语义化 id（daily / jpop / all…），不会有人去写 emby-1271。
 */
export const EMBY_PLAYLIST_PREFIX = 'emby-'

/** Emby 歌单条目 id → 本站歌单 id */
export function embyPlaylistId(id: string): string {
  return `${EMBY_PLAYLIST_PREFIX}${id}`
}

export function isEmbyPlaylistId(id: string): boolean {
  return id.startsWith(EMBY_PLAYLIST_PREFIX)
}

/** Emby 歌单的副标题：「Emby 歌单 · 5 首 · 23 分钟」 */
export function embyPlaylistSubtitle(count: number, seconds: number): string {
  return `Emby 歌单 · ${count} 首 · ${Math.max(1, Math.round(seconds / 60))} 分钟`
}

/** 与 meta.json 同形的生成产物，键就是上面那种直链 */
export const EMBY_META_URL = '/emby.json'

/** Emby 条目 → 本站在播放器里使用的直链 */
export function embyStreamUrl(id: string): string {
  return `${EMBY_STREAM_PATH}?id=${encodeURIComponent(id)}`
}

/** 判断某条直链是否走 Emby 取流端点 */
export function isEmbyStreamUrl(url: string): boolean {
  return url.startsWith(`${EMBY_STREAM_PATH}?id=`)
}

/**
 * 专辑封面 → 本站封面代理端点。
 * 封面不再随仓库提交（原来 1400+ 张、一百多 MB 全堆在 git 里），
 * 改成用到时由服务端去 Emby 现取并透传，密钥同样不出服务端。
 * id 用「封面归属条目」——专辑 id（无专辑时退回曲目父目录 id），
 * 与同专辑多首曲目共用同一张封面一致。
 */
export function embyCoverUrl(ownerId: string): string {
  return `${EMBY_COVER_PATH}?id=${encodeURIComponent(ownerId)}`
}

/** 判断某个封面地址是否走本站 Emby 封面代理 */
export function isEmbyCoverUrl(url: string): boolean {
  return url.startsWith(`${EMBY_COVER_PATH}?id=`)
}

/**
 * 曲目歌词 → 本站歌词端点。
 * 歌词也不再随仓库提交（原来一歌一份 json、上万份），
 * 由服务端 Range 拉音频头部解析 SYLT 后按需返回。
 */
export function embyLyricsUrl(id: string): string {
  return `${EMBY_LYRICS_PATH}?id=${encodeURIComponent(id)}`
}

export interface EmbyFile {
  generatedAt?: string
  tracks?: Record<string, CachedMeta>
  /** Emby 音乐库里现成的歌单，条目按它的顺序排（见 orderByUrls） */
  playlists?: unknown
}

/** emby.json 解析结果：曲目与歌单一起给出，两者都是缺失即退化为空 */
export interface EmbyLibrary {
  tracks: Record<string, CachedMeta>
  playlists: PlaylistDef[]
}

/**
 * 解析 emby.json。结构不对时返回空而不是抛错——
 * 这样产物缺失/损坏只会表现为「没有这些曲目与歌单」，页面其余部分照常。
 */
export function parseEmbyFile(raw: unknown): EmbyLibrary {
  const f = raw as EmbyFile | null
  return { tracks: parseTracks(f), playlists: parsePlaylists(f?.playlists) }
}

function parseTracks(f: EmbyFile | null): Record<string, CachedMeta> {
  const t = f?.tracks
  if (!t || typeof t !== 'object' || Array.isArray(t)) return {}
  const out: Record<string, CachedMeta> = {}
  for (const [url, v] of Object.entries(t)) {
    if (!isEmbyStreamUrl(url)) continue
    if (!v || typeof v !== 'object') continue
    if (typeof (v as CachedMeta).title !== 'string') continue
    out[url] = v as CachedMeta
  }
  return out
}

/**
 * 解析 Emby 歌单。逐条校验而不是整体放弃：一个歌单写坏了不该带走其余歌单。
 * 强制是 type: 'playlist'（Emby 歌单不可能是电台），且 id 必须带前缀，
 * 否则宁可不要 —— 万一哪天手写文件里出现裸 id，也不能让它盖掉手写歌单。
 */
function parsePlaylists(raw: unknown): PlaylistDef[] {
  if (!Array.isArray(raw)) return []
  const out: PlaylistDef[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const d = item as Record<string, unknown>
    if (typeof d.id !== 'string' || !isEmbyPlaylistId(d.id)) continue
    if (typeof d.title !== 'string' || !d.title.trim()) continue
    const urls = Array.isArray(d.urls)
      ? [
          ...new Set(
            d.urls.filter((u): u is string => typeof u === 'string' && isEmbyStreamUrl(u)),
          ),
        ]
      : []
    if (urls.length === 0) continue
    out.push({
      id: d.id,
      type: 'playlist',
      title: d.title.trim(),
      subtitle: typeof d.subtitle === 'string' && d.subtitle.trim() ? d.subtitle.trim() : undefined,
      cover: typeof d.cover === 'string' && d.cover.trim() ? d.cover.trim() : undefined,
      urls,
    })
  }
  return out
}
