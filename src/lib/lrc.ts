/**
 * LRC 歌词解析
 * 支持标准 [mm:ss.xx] / [mm:ss.xxx] 时间戳、多时间戳同行、元信息标签
 */

export interface LyricLine {
  time: number // 秒
  text: string
}

const TIME_TAG = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g
const META_TAG = /^\[(ti|ar|al|by|offset|re|ve):/i

export function parseLrc(raw: string, offsetMs = 0): LyricLine[] {
  const lines: LyricLine[] = []
  let globalOffset = offsetMs

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue

    // offset 元信息标签
    const offsetMatch = line.match(/^\[offset:\s*([+-]?\d+)\s*\]/i)
    if (offsetMatch) {
      globalOffset = offsetMs + parseInt(offsetMatch[1], 10)
      continue
    }
    if (META_TAG.test(line)) continue

    TIME_TAG.lastIndex = 0
    const times: number[] = []
    let m: RegExpExecArray | null
    while ((m = TIME_TAG.exec(line)) !== null) {
      const min = parseInt(m[1], 10)
      const sec = parseInt(m[2], 10)
      let frac = m[3] ?? '0'
      // [mm:ss.xx] 两位=厘秒, 三位=毫秒
      const fracMs = frac.length === 3 ? parseInt(frac, 10) : parseInt(frac.padEnd(3, '0'), 10)
      times.push(min * 60 + sec + fracMs / 1000)
    }
    if (times.length === 0) continue

    const text = line.replace(TIME_TAG, '').trim()
    for (const t of times) {
      lines.push({ time: t + globalOffset / 1000, text })
    }
  }

  lines.sort((a, b) => a.time - b.time)
  return lines
}

/** 判断一段文本是否像 LRC 同步歌词 */
export function looksLikeLrc(text: string): boolean {
  return /\[\d{1,2}:\d{2}[.:]\d{1,3}\]/.test(text)
}

/** 二分查找当前时间对应的歌词行索引 */
export function findLyricIndex(lines: LyricLine[], time: number): number {
  if (lines.length === 0) return -1
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= time) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}
