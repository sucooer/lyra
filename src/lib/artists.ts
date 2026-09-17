/**
 * 歌手 / 专辑资料：来自 public/artists.json，由 scripts/gen-artists.mjs 生成。
 *
 * 内容和 gen-meta / gen-emby 一样是「构建期产物」，运行时不再发任何第三方请求：
 * 歌手简介、Apple Music 的专辑推荐语都是静态文本，抓一次能用很久，
 * 放进构建产物里既省请求也免跨域。
 *
 * 曲库本身（有哪些歌、属于哪个歌手/专辑）不在这里，仍在 emby.json / meta.json，
 * 这里只放「查不到的补充资料」，所以字段缺失是常态，前端必须能容忍空值。
 *
 * 和 emby.ts 一样：这个文件的函数会被 Node 脚本用 loadTs() 直接加载，
 * 不能出现 import（类型除外）与任何浏览器 API。
 */

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
  /** 与曲库里的 artist 字段完全一致，作为查找键 */
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
 * 名字归一：只用于「曲库写法」与「Apple Music 写法」之间的宽松比对。
 * 不处理繁简（周杰伦 / 周杰倫 在两处写法不同，硬转需要映射表，
 * 代价大于收益），只抹掉大小写、空白和常见分隔符。
 */
export function normName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[·・.,，、\-_/\\()（）[\]【】"'“”‘’!！?？:：]/g, '')
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

/** 精确查（先原样，再按归一化比对一次） */
export function findArtist(file: ArtistsFile, name: string): ArtistInfo | undefined {
  if (!name?.trim()) return undefined
  const direct = file.artists[name]
  if (direct) return direct
  const k = normName(name)
  for (const info of Object.values(file.artists)) {
    if (normName(info.name) === k) return info
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
