import type { Track } from '../stores/player'

/**
 * 曲目的稳定身份：同一个直链在任何会话、任何设备上都得到同一个值。
 *
 * 之前用的是随机串，每次刷新都变，凡是需要跨会话引用一首歌的功能
 * （收藏、最近播放、播放次数、自定义排序）都存不下来——存了下次也对不上。
 *
 * 用 cyrb53（非加密哈希，53 位有效）。曲库上万首时碰撞概率约 5e-7，
 * 而且只拿它当身份标识，不参与任何鉴权判断。
 */
export function stableId(url: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < url.length; i++) {
    const ch = url.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** 从直链里取出文件名（解码后的） */
export function filenameOf(url: string): string {
  try {
    const p = decodeURIComponent(new URL(url).pathname)
    return p.split('/').pop() ?? url
  } catch {
    return url.split('/').pop() ?? url
  }
}

/** 展示用标题：优先元数据标题，退回文件名去扩展名 */
export function trackTitle(t: Track): string {
  if (t.meta?.title) return t.meta.title
  return filenameOf(t.url).replace(/\.[a-z0-9]+$/i, '')
}

export function fmtTime(sec?: number): string {
  if (!sec || !isFinite(sec)) return '--:--'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
