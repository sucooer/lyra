/**
 * 曲库搜索：在歌手 / 专辑 / 歌曲 / 歌单里找词。
 *
 * 匹配前一律先归一化（normQuery）：繁简统一成简体，再抹掉大小写、空白与标点。
 * 于是「張韶涵」搜得到「张韶涵」、「sens」搜得到 S.E.N.S.，「稻香」搜得到《稻香》。
 *
 * 多词按 AND 处理（每个词都得命中），单个词可以落在标题 / 歌手 / 专辑任意一个字段上，
 * 所以「周杰伦 稻香」能精确收窄到那一首。
 *
 * 排序只看「命中在哪个字段、字段里的第几个字」：标题开头最前，然后标题中段、
 * 歌手、专辑，多词的总分相加。权重是常量，同一份曲库下结果稳定可复现。
 *
 * 刻意不做拼音：拼音表要几百 KB，而这个曲库本身以中文为主，收益不抵体积。
 * 真要加，只需在 normQuery 的产物上再挂一份拼音串，匹配与排序逻辑一行都不用动。
 *
 * 这个文件不碰 Vue 与 store（只 type-only 引 Track），Node 脚本也能直接跑。
 */

import { normName, simplify, trackArtistKeys } from './artists'
import { trackTitle } from './track'
import type { Track } from '../stores/player'

/** 归一化时要抹掉的标点：全角半角都算，连字符与斜杠一起处理 */
const STRIP = /[\s\u3000·・.,，、\-_/\\()（）[\]【】"'“”‘’!！?？:：&＋+｜|]/g

/**
 * 查询串 / 待匹配文本的归一化。
 * 大小写、空白、标点全部不影响结果，所以「s.e.n.s」「S.E.N.S」「sens」是同一个查询。
 */
export function normQuery(s: string): string {
  return simplify(String(s ?? ''))
    .toLowerCase()
    .replace(STRIP, '')
}

/** 查询串 → 词元数组（已归一化、去重）。空白是唯一的分词依据，中文不再切分 */
export function tokensOf(raw: string): string[] {
  const out: string[] = []
  for (const part of String(raw ?? '').split(/[\s\u3000]+/)) {
    const t = normQuery(part)
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/**
 * 一组候选字段里的最佳命中：越靠前越优，字段越靠后越次（每个字段递加 200）。
 * 任一词元在所有字段里都找不到就是 Infinity —— 多词 AND 靠这个返回值筛。
 */
export function textScore(fields: string[], tokens: string[]): number {
  let total = 0
  for (const tok of tokens) {
    let best = Infinity
    for (let i = 0; i < fields.length; i++) {
      const pos = fields[i].indexOf(tok)
      if (pos < 0) continue
      const v = pos + i * 200
      if (v < best) best = v
    }
    if (best === Infinity) return Infinity
    total += best
  }
  return total
}

/**
 * 通用排序：按 textScore 升序，同分交给 tiebreak（不传就保持原顺序，sort 是稳定的）。
 * 歌手 / 专辑 / 歌单这类数量不多，逐次现算归一化文本就够；曲库那 4000 首走 searchTracks。
 */
export function rankItems<T>(
  items: T[],
  tokens: string[],
  fieldsOf: (x: T) => string[],
  tiebreak?: (a: T, b: T) => number,
): T[] {
  if (!tokens.length) return []
  const scored: { x: T; s: number }[] = []
  for (const x of items) {
    const s = textScore(fieldsOf(x), tokens)
    if (s < Infinity) scored.push({ x, s })
  }
  scored.sort((a, b) => a.s - b.s || (tiebreak ? tiebreak(a.x, b.x) : 0))
  return scored.map((o) => o.x)
}

// ---------- 曲库索引 ----------

interface TrackEntry {
  /** 归一化当初所依据的元数据对象：换过对象就说明字段可能变了 */
  meta: unknown
  title: string
  artist: string
  album: string
}

/**
 * 逐曲目的归一化文本缓存。
 * 每敲一个字都要扫全库，逐次现算 4000 首的繁简转换与正则太浪费；
 * 元数据是「解析出来就整体换对象」，比引用即可判断要不要重算。
 */
const entryCache = new Map<string, TrackEntry>()
/** 上限留足余量（曲库 4000 首）；超了直接清空重来，不做 LRU */
const ENTRY_CACHE_MAX = 12000

function entryOf(t: Track): TrackEntry {
  const hit = entryCache.get(t.id)
  if (hit && hit.meta === t.meta) return hit
  const e: TrackEntry = {
    meta: t.meta,
    title: normQuery(trackTitle(t)),
    artist: normQuery(t.meta?.artist ?? ''),
    album: normQuery(t.meta?.album ?? ''),
  }
  if (entryCache.size >= ENTRY_CACHE_MAX) entryCache.clear()
  entryCache.set(t.id, e)
  return e
}

/** 歌曲搜索：返回全部命中的曲目，按相关度排好序（调用方自己截断） */
export function searchTracks(tracks: Track[], tokens: string[]): Track[] {
  if (!tokens.length) return []
  const out: { t: Track; s: number }[] = []
  for (const t of tracks) {
    const e = entryOf(t)
    let total = 0
    let ok = true
    for (const tok of tokens) {
      // 字段权重：标题 0 / 歌手 200 / 专辑 400，与 textScore 的字段顺序一致
      const p = e.title.indexOf(tok)
      const a = e.artist.indexOf(tok)
      const b = e.album.indexOf(tok)
      let best = Infinity
      if (p >= 0) best = p
      if (a >= 0 && a + 200 < best) best = a + 200
      if (b >= 0 && b + 400 < best) best = b + 400
      if (best === Infinity) {
        ok = false
        break
      }
      total += best
    }
    if (ok) out.push({ t, s: total })
  }
  out.sort((x, y) => x.s - y.s)
  return out.map((x) => x.t)
}

/** 一位歌手在曲库里的汇总，用于搜索结果里的头像卡 */
export interface ArtistEntry {
  /** 身份键（URL 里那个）；展示名要走 player.artistLabel(key) */
  key: string
  count: number
  /** 任一曲目的封面，当头像用 */
  cover?: string
}

/** 从曲库聚合出歌手列表：联名曲两边都算，与歌手页的口径一致 */
export function buildArtistIndex(tracks: Track[]): ArtistEntry[] {
  const map = new Map<string, ArtistEntry>()
  for (const t of tracks) {
    for (const k of trackArtistKeys(t.meta?.artist ?? '')) {
      let e = map.get(k)
      if (!e) {
        e = { key: k, count: 0 }
        map.set(k, e)
      }
      e.count++
      if (!e.cover && t.meta?.coverUrl) e.cover = t.meta.coverUrl
    }
  }
  return [...map.values()]
}

/** 一张专辑在曲库里的汇总 */
export interface AlbumEntry {
  /** 归属歌手的身份键：联名专辑算首位歌手名下（与列表里点专辑名的行为一致） */
  artist: string
  name: string
  cover?: string
  year?: number
  count: number
}

/** 专辑 identity 用不可见字符拼（专辑名与歌手名都可能含斜杠） */
const FSEP = '\u001f'

/**
 * 从曲库聚合出专辑列表：同名不同歌手的各算一张。
 *
 * 专辑身份刻意用 normName 而不是 normQuery —— 必须与 store 的 albumTracks 口径一致，
 * 否则卡片上的「N 首」会跟点进去看到的对不上（normQuery 会多做一次繁简归一，
 * 把缩写不同的两张专辑并成一张，而专辑页仍按原文匹配）。
 * 搜索匹配另走 normQuery，所以写法有差异也照样搜得到。
 */
export function buildAlbumIndex(tracks: Track[]): AlbumEntry[] {
  const map = new Map<string, AlbumEntry>()
  for (const t of tracks) {
    const name = (t.meta?.album ?? '').trim()
    if (!name) continue
    const owner = trackArtistKeys(t.meta?.artist ?? '')[0]
    if (!owner) continue
    const id = `${owner}${FSEP}${normName(name)}`
    let e = map.get(id)
    if (!e) {
      e = { artist: owner, name, count: 0 }
      map.set(id, e)
    }
    e.count++
    if (!e.cover && t.meta?.coverUrl) e.cover = t.meta.coverUrl
    if (!e.year && t.meta?.year) e.year = t.meta.year
  }
  return [...map.values()]
}
