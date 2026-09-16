/**
 * Emby 音乐库的接入约定。
 *
 * 这一份同时被两边使用，不能各写一套：
 *   - scripts/gen-emby.mjs —— 生成 public/emby.json 时算出直链
 *   - src/stores/player.ts —— 加载时把这些直链并进曲库
 * 两边对「直链长什么样」必须逐字一致，否则 emby.json 里的键就命不中曲目，
 * 表现为列表里一堆「未知曲目」且每首都去联网重解析。
 *
 * 关于直链形态：它并不是音频文件地址，而是本站的取流端点
 * （/api/emby/stream?id=<条目 id>）。这么做有两个原因，见 functions/api/emby/stream.js：
 * 站点是 https 而 Emby 只有 http；且 Emby 取流必须带 api_key，不能交给前端。
 */
import type { CachedMeta } from './metadata'

export const EMBY_STREAM_PATH = '/api/emby/stream'

/** 与 meta.json 同形的生成产物，键就是上面那种直链 */
export const EMBY_META_URL = '/emby.json'

/**
 * 封面单独放一个目录。
 * 不能塞进 public/covers/ —— gen-meta 会清理该目录里「未被 meta.json 引用」的文件，
 * 而 Emby 的封面只被 emby.json 引用，跑一次 pnpm meta 就会被全部删掉。
 */
export const EMBY_COVER_DIR = '/emby-covers'

/** Emby 条目 → 本站在播放器里使用的直链 */
export function embyStreamUrl(id: string): string {
  return `${EMBY_STREAM_PATH}?id=${encodeURIComponent(id)}`
}

/** 判断某条直链是否走 Emby 取流端点 */
export function isEmbyStreamUrl(url: string): boolean {
  return url.startsWith(`${EMBY_STREAM_PATH}?id=`)
}

export interface EmbyFile {
  generatedAt?: string
  tracks?: Record<string, CachedMeta>
}

/**
 * 解析 emby.json。结构不对时返回空表而不是抛错——
 * 这样产物缺失/损坏只会表现为「没有这些曲目」，页面其余部分照常。
 */
export function parseEmbyFile(raw: unknown): Record<string, CachedMeta> {
  const t = (raw as EmbyFile | null)?.tracks
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
