/**
 * 歌单定义：来自 public/playlists.json，用户可直接编辑，无需改代码。
 *
 * 歌单成员用「匹配规则」描述而不是硬编码曲目列表，
 * 这样歌单会跟着 meta.json 里的歌手 / 专辑信息自动更新。
 *
 * 别和 playlist.ts 搞混：那边管的是 playlist.json（曲库源文件），这边管歌单分组。
 */

export interface PlaylistDef {
  /** 唯一标识，同时用作封面生成的种子 */
  id: string
  /** radio = 电台（封面程序化随机生成，点击即随机无限播放全部歌曲） */
  type?: 'radio' | 'playlist'
  title: string
  subtitle?: string
  /** 显式指定封面（/covers/xxx.jpg 或外链）；缺省时按成员曲目封面拼贴，再退化为程序化生成 */
  cover?: string
  /** true = 包含全部曲目 */
  all?: boolean
  /** 精确匹配（忽略大小写与首尾空格）曲目直链 */
  urls?: string[]
  /** 精确匹配曲名 */
  titles?: string[]
  /** 精确匹配歌手 */
  artists?: string[]
  /** 精确匹配专辑 */
  albums?: string[]
  /** 精确匹配人工标签：来自 playlist.json 对象写法里的 tags，与音频内嵌 tag 无关 */
  tags?: string[]
}

/** 匹配只需要曲目的一小部分字段，结构化解耦避免与 store 循环依赖 */
export interface Matchable {
  url: string
  meta: { title?: string; artist?: string; album?: string } | null
  /** playlist.json 里人工写的标签 */
  tags?: string[]
}

export function isRadio(def: PlaylistDef): boolean {
  return def.type === 'radio'
}

/**
 * 歌单是否收录某曲目：任一规则命中即算收录；未配置任何规则 = 收录全部。
 * tags 和 urls 一样不依赖音频元数据，所以在 meta 判空之前先比。
 */
export function playlistMatches(def: PlaylistDef, t: Matchable): boolean {
  if (def.all) return true
  const hasFilter =
    !!def.urls?.length ||
    !!def.titles?.length ||
    !!def.artists?.length ||
    !!def.albums?.length ||
    !!def.tags?.length
  if (!hasFilter) return true

  const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  if (def.urls?.some((x) => eq(x, t.url))) return true
  if (def.tags?.some((x) => t.tags?.some((y) => eq(x, y)))) return true

  const m = t.meta
  if (!m) return false
  if (def.titles?.some((x) => eq(x, m.title ?? ''))) return true
  if (def.artists?.some((x) => eq(x, m.artist ?? ''))) return true
  if (def.albums?.some((x) => eq(x, m.album ?? ''))) return true
  return false
}

/** 过滤掉结构不合法的条目（playlists.json 手写时容易漏字段） */
export function normalizePlaylists(raw: unknown): PlaylistDef[] {
  if (!Array.isArray(raw)) return []
  const out: PlaylistDef[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const d = item as Record<string, unknown>
    if (typeof d.id !== 'string' || typeof d.title !== 'string') continue
    const strArr = (v: unknown): string[] | undefined =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined
    out.push({
      id: d.id,
      type: d.type === 'radio' ? 'radio' : 'playlist',
      title: d.title,
      subtitle: typeof d.subtitle === 'string' ? d.subtitle : undefined,
      cover: typeof d.cover === 'string' ? d.cover : undefined,
      all: d.all === true,
      urls: strArr(d.urls),
      titles: strArr(d.titles),
      artists: strArr(d.artists),
      albums: strArr(d.albums),
      tags: strArr(d.tags),
    })
  }
  return out
}
