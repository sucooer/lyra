/**
 * 歌手 / 专辑资料 + 歌手名的归一化规则（谁和谁是同一个人）。
 *
 * 一半是「补充资料」：来自 public/artists.json，由 scripts/gen-artists.mjs 生成。
 * 内容和 gen-meta / gen-emby 一样是「构建期产物」，运行时不再发任何第三方请求：
 * 歌手简介、Apple Music 的专辑推荐语都是静态文本，抓一次能用很久，
 * 放进构建产物里既省请求也免跨域。
 *
 * 一半是「身份规则」：曲库里的 artist 字段写法很脏 —— 同一个人的名字可能繁简混用
 * （张韶涵 / 張韶涵）、末尾带不带句点（S.E.N.S. / S.E.N.S），还可能把好几位歌手
 * 写在一个字段里（「阿悄, 庄心妍 & 王麟」）。artistKey / splitArtists 就是把这堆写法
 * 收敛成「一个人一个键」的地方：前端分组、artists.json 的键、URL 里的 hash 都走它。
 *
 * 曲库本身（有哪些歌、属于哪个歌手/专辑）不在这里，仍在 emby.json / meta.json，
 * 这里只放「查不到的补充资料」，所以字段缺失是常态，前端必须能容忍空值。
 *
 * 和 emby.ts 一样：这个文件的函数会被 Node 脚本用 loadTs() 直接加载，
 * 所以只能依赖同目录的纯数据模块（t2s.ts），不能出现任何浏览器 API。
 */

import { T2S_FROM, T2S_TO } from './t2s'

export const ARTISTS_URL = '/artists.json'

/** 来自 Apple Music 艺人页「代表专辑」的一张专辑 */
export interface ArtistAlbum {
  /** 专辑名（Apple Music 写法，可能与曲库里的写法不同） */
  name: string
  /** 编辑推荐语，如「没有特异功能拯救世界，唯有追梦的热忱和做自己的真诚。」 */
  note?: string
  /** 专辑封面直链（Apple Music CDN，600px 左右） */
  cover?: string
  /** 发行年份 */
  year?: number
  /** Apple Music 专辑页，用于「在 Apple Music 中查看」 */
  amUrl?: string
}

export interface ArtistInfo {
  /** 归一后的展示名（简体）；artists.json 的键是 artistKey(name) */
  name: string
  /** 简介正文（纯文本，已去掉链接尾巴） */
  bio?: string
  /** 简介来源，用于在界面上标注出处；空 = 没抓到 */
  bioSource?: 'lastfm' | 'wikipedia-zh' | 'wikipedia-en'
  /** 简介出处链接 */
  bioUrl?: string
  /** Apple Music 艺人 id */
  amId?: number
  /** Apple Music 艺人页 */
  amUrl?: string
  /** 该歌手在曲库里的曲目数 */
  trackCount?: number
  /** Apple Music 上的专辑（按艺人页顺序） */
  albums?: ArtistAlbum[]
}

export interface ArtistsFile {
  generatedAt: string
  artists: Record<string, ArtistInfo>
}

/**
 * 名字归一：抹掉大小写、空白与常见标点，用于「写法不同但明显是同一个名字」的宽松比对
 * （专辑名、Apple Music 的写法差异）。不处理繁简 —— 那是 artistKey 的事。
 */
export function normName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    // 连字符/破折号一律抹掉，且必须覆盖 Unicode 那批：曲库里出现过 U+2010（‐，T‐ARA）
    // 与 ASCII（T-ara）两种写法，只认 ASCII 就会把同一个人当成两位歌手 —— 表现是
    // 对不上维基词条、简介永远抓不到。⚠️ 别顺手加 U+30FC（ー，日语长音符），
    // 那是假名的一部分，抹掉会毁掉大量日文名。
    .replace(
      /[·・.,，、\-_\u2010-\u2015\u2212\uFF0D\uFE63/\\()（）[\]【】"'“”‘’!！?？:：]/g,
      '',
    )
}

// ---------- 谁和谁是同一个人 ----------

/** 繁→简映射，模块加载时建一次；表见 t2s.ts（生成文件） */
const T2S = new Map<string, string>()
for (let i = 0; i < T2S_FROM.length; i++) T2S.set(T2S_FROM[i], T2S_TO[i])

/**
 * 繁体转简体。
 * 用 for…of 按码点遍历：表里全是 BMP 单字，代理对（𫝈 这类罕用字）取不到映射就原样留下。
 */
export function simplify(s: string): string {
  let out = ''
  for (const ch of s) out += T2S.get(ch) ?? ch
  return out
}

/**
 * 歌手身份键：**同一个人只有一个键**，也是歌手页 / 专辑页 URL 里用的那个 key。
 * 繁简、大小写、空白、标点（含 S.E.N.S. 末尾的句点）都不影响它。
 *
 * 连标点一起抹掉是因为曲库里同一支乐团有两种写法（S.E.N.S. 126 首 / S.E.N.S 3 首），
 * 不归一就会出现「只有 3 首歌」的第二个歌手页。代价是键不可读（sens），
 * 所以**展示名一律另算（见 stores/player.ts 的 artistLabel），不要把键当名字用**。
 */
export function artistKey(name: string): string {
  return normName(simplify(String(name ?? '')))
}

/** 曲目 artist 字段里拆出来的一位歌手 */
export interface ArtistPart {
  /** 归一后的名字（已转简体），可直接展示；当查找键时仍应走 artistKey */
  name: string
  /** 紧挨在它前面的分隔符原文（首位为空串），界面靠它还原「阿悄 & 徐良」的写法 */
  sep: string
}

/**
 * 联名分隔符。
 * 逗号/顿号/分号/&/+ 一律算分隔（曲库里就有「阿悄, 庄心妍 & 王麟」这种写法）；
 * 斜杠与竖线只在**两侧至少有一侧是空格**时才算 —— 否则会把 AC/DC 这种本来就是
 * 一个整体的名字拆成两半。
 */
const ARTIST_SEP = /[&＆,，;；、+]|\s[/|｜]\s?|[/|｜]\s|\bfeat\b\.?|\bft\b\.?|\bvs\b\.?/gi

/**
 * 分隔符在界面上怎么写。
 * 原文两侧本来就写了空格的（「 & 」「, 」）原样保留；只写了符号的把空格补出来，
 * 否则「阿悄& 徐良」这种会黏在一起。逗号类只在后面补（「A, B」），& / + 两侧都补。
 */
function sepShown(sep: string): string {
  if (!sep || /\s/.test(sep)) return sep
  return /^[,，、;；]$/.test(sep) ? `${sep} ` : ` ${sep} `
}

/**
 * 把一个 artist 字段拆成若干位歌手。
 * 「阿悄, 庄心妍 & 王麟」→ 阿悄 / 庄心妍 / 王麟，分隔符一起带出来给界面还原排版。
 */
export function splitArtists(raw: string): ArtistPart[] {
  const text = String(raw ?? '').trim()
  if (!text) return []

  const out: ArtistPart[] = []
  const seen = new Set<string>()
  // 每次新建正则：带 g 的实例是有状态的（lastIndex），共享会被并发调用打乱
  const re = new RegExp(ARTIST_SEP.source, ARTIST_SEP.flags)
  const push = (name: string) => {
    // 只用键去重：名字重复但写法不同的（「阿悄」与「阿悄 」）不该出现两次
    const key = artistKey(name)
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push({ name, sep: sepShown(sep) })
  }

  let start = 0
  let sep = ''
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const part = text.slice(start, m.index).trim()
    start = re.lastIndex
    const sepText = m[0].replace(/\s+/g, ' ')
    // 分隔符连在一起（「A, & B」）：合并两段，别把分隔符本身弄丢
    if (!part) {
      sep += sepText
      continue
    }
    push(part)
    sep = sepText
  }
  const tail = text.slice(start).trim()
  if (tail) push(tail)
  return out
}

/** artist 字段原文 → 身份键数组的缓存：键就是歌手名，正常只有几十个，但会被反复查 */
const keyCache = new Map<string, string[]>()
/** 上限留足余量，防止运行时解析出来的脏名字把内存堆爆 */
const KEY_CACHE_MAX = 500

/** 曲目的 artist 字段 → 身份键数组（联名拆开、繁简归一、去重） */
export function trackArtistKeys(raw: string): string[] {
  const text = String(raw ?? '')
  const hit = keyCache.get(text)
  if (hit) return hit
  const keys = splitArtists(text).map((p) => artistKey(p.name))
  if (keyCache.size >= KEY_CACHE_MAX) keyCache.clear()
  keyCache.set(text, keys)
  return keys
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

/** 解析 artists.json：结构不对就当空资料，不让单点坏数据把整页搞崩 */
export function parseArtistsFile(raw: unknown): ArtistsFile {
  const out: ArtistsFile = { generatedAt: '', artists: {} }
  if (!raw || typeof raw !== 'object') return out
  const o = raw as Record<string, unknown>
  out.generatedAt = str(o.generatedAt) ?? ''
  const map = o.artists
  if (!map || typeof map !== 'object') return out

  for (const [key, val] of Object.entries(map as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue
    const a = val as Record<string, unknown>
    const info: ArtistInfo = { name: str(a.name) ?? key, albums: [] }
    info.bio = str(a.bio)
    const src = str(a.bioSource)
    if (src === 'lastfm' || src === 'wikipedia-zh' || src === 'wikipedia-en') info.bioSource = src
    info.bioUrl = str(a.bioUrl)
    if (typeof a.amId === 'number' && Number.isFinite(a.amId)) info.amId = a.amId
    info.amUrl = str(a.amUrl)
    if (typeof a.trackCount === 'number') info.trackCount = a.trackCount

    if (Array.isArray(a.albums)) {
      const albums: ArtistAlbum[] = []
      for (const item of a.albums) {
        if (!item || typeof item !== 'object') continue
        const b = item as Record<string, unknown>
        const name = str(b.name)
        if (!name) continue
        const al: ArtistAlbum = { name }
        al.note = str(b.note)
        al.cover = str(b.cover)
        al.amUrl = str(b.amUrl)
        if (typeof b.year === 'number' && Number.isFinite(b.year)) al.year = b.year
        albums.push(al)
      }
      info.albums = albums
    }
    out.artists[key] = info
  }
  return out
}

/**
 * 精确查（先原样，再按身份键比对 —— 归一规则升级后，老产物里可能还留着
 * 「張韶涵」这种异写键，或者浏览器缓存着上一版 artists.json）。
 */
export function findArtist(file: ArtistsFile, name: string): ArtistInfo | undefined {
  if (!name?.trim()) return undefined
  const direct = file.artists[name]
  if (direct) return direct
  const k = artistKey(name)
  if (!k) return undefined
  for (const [key, info] of Object.entries(file.artists)) {
    if (artistKey(key) === k || artistKey(info.name) === k) return info
  }
  return undefined
}

/** 在歌手的 Apple Music 专辑里找同名专辑（曲库与 Apple Music 写法可能不同） */
export function findAlbumNote(
  info: ArtistInfo | undefined,
  album: string,
): ArtistAlbum | undefined {
  if (!info?.albums?.length || !album?.trim()) return undefined
  const k = normName(album)
  return info.albums.find((a) => normName(a.name) === k)
}
