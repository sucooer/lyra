/**
 * 歌单定义：来自 public/playlists.json，用户可直接编辑，无需改代码。
 *
 * 歌单成员用「匹配规则」描述而不是硬编码曲目列表，
 * 这样歌单会跟着 meta.json 里的歌手 / 专辑信息自动更新。
 *
 * 别和 playlist.ts 搞混：那边管的是 playlist.json（曲库源文件），这边管歌单分组。
 */

import { artistKey, trackArtistKeys } from './artists'

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
  /** 精确匹配（忽略大小写与首尾空格）曲目直链；同时决定该歌单的曲目顺序 */
  urls?: string[]
  /** 精确匹配曲名 */
  titles?: string[]
  /** 匹配歌手：按归一后的身份键比，繁简写法与联名都能对上（见 lib/artists.ts） */
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
 * 歌单是否自带成员规则。没写任何规则 = 收录全部曲目，
 * 和「只想改个标题」是两种完全不同的意图，所以合并时要能区分。
 */
export function hasOwnMembership(def: PlaylistDef): boolean {
  return !!(
    def.all ||
    def.urls?.length ||
    def.titles?.length ||
    def.artists?.length ||
    def.albums?.length ||
    def.tags?.length
  )
}

/**
 * 歌单是否收录某曲目：任一规则命中即算收录；未配置任何规则 = 收录全部。
 * tags 和 urls 一样不依赖音频元数据，所以在 meta 判空之前先比。
 */
export function playlistMatches(def: PlaylistDef, t: Matchable): boolean {
  if (def.all) return true
  if (!hasOwnMembership(def)) return true

  const eq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
  if (def.urls?.some((x) => eq(x, t.url))) return true
  if (def.tags?.some((x) => t.tags?.some((y) => eq(x, y)))) return true

  const m = t.meta
  if (!m) return false
  if (def.titles?.some((x) => eq(x, m.title ?? ''))) return true
  // 歌手走身份键：规则里写「花澤香菜」也能命中标成「花泽香菜」的文件，联名歌曲两边都算
  const keys = trackArtistKeys(m.artist ?? '')
  if (def.artists?.some((x) => keys.includes(artistKey(x)))) return true
  if (def.albums?.some((x) => eq(x, m.album ?? ''))) return true
  return false
}

/**
 * 把外部来源（Emby）的歌单合进手工歌单。
 *
 * 手工的一律排在前面，且同 id 时手工的说了算 —— 手写文件是用户的显式意志，
 * 不能被同步产物盖掉（这也正是「给某个 Emby 歌单改标题/换封面」的入口）。
 *
 * 但「说了算」不等于整体接管：手工那条如果没写任何成员规则，成员就沿用外部的，
 * 只覆盖它真正写过的字段。否则为了改个标题也得把十几条直链重抄一遍，
 * 而漏抄一条只表现为「歌单莫名少一首」，基本查不出来。
 * 想完全自己定成员，把 urls（或 artists 等）写上即可，那时就不再继承。
 */
export function mergePlaylists(local: PlaylistDef[], remote: PlaylistDef[]): PlaylistDef[] {
  const byId = new Map(local.map((d) => [d.id, d]))
  const merged = local.map((l) => {
    const r = remote.find((x) => x.id === l.id)
    if (!r || hasOwnMembership(l) || l.type === 'radio') return l
    return { ...r, ...definedOnly(l) }
  })
  return [...merged, ...remote.filter((r) => !byId.has(r.id))]
}

/** 只取有值的字段：正常化后的 def 里可选项是 undefined，展开会把继承来的成员抹掉 */
function definedOnly(def: PlaylistDef): Partial<PlaylistDef> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(def)) if (v !== undefined) out[k] = v
  return out as Partial<PlaylistDef>
}

/**
 * 按 def.urls 里写下的顺序排列（只对显式列了直链的歌单生效）。
 *
 * 把 urls 当「筛选条件」时顺序无所谓，但当「名单」用的时候顺序就是内容的一部分：
 * 每日推荐每天的次序是日期种子打乱出来的，如果这里不认它的顺序，列表会按曲库顺序显示，
 * 那份打乱就白做了（实测就是这个症状：歌单页的曲目顺序和「全部歌曲」一致）。
 */
export function orderByUrls<T extends Matchable>(def: PlaylistDef, tracks: T[]): T[] {
  if (!def.urls?.length) return tracks
  const rank = new Map<string, number>()
  def.urls.forEach((u, i) => {
    const k = u.trim().toLowerCase()
    if (!rank.has(k)) rank.set(k, i)
  })
  const of = (t: T) => rank.get(t.url.trim().toLowerCase()) ?? Number.MAX_SAFE_INTEGER
  // sort 是稳定的：没有排名的曲目不会被重新编组，只是整体排到名单之后
  return [...tracks].sort((a, b) => of(a) - of(b))
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
