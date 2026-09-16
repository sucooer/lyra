import type { Track } from '../stores/player'

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
