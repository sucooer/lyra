// 从音频文件里提取内嵌歌词为 { synced, plain }。
//
// 这是 functions/api/emby/lyrics.js（CF）与 api/emby/lyrics.js（Vercel）共用的实现，
// 放在 _lib 里让两处 import 同一份，避免两条部署线漂移。
// 也能在 Node 里直接 import 做单测（开发期验证用）。
//
// 支持三种容器（按魔数识别）：
//   - FLAC（'fLaC'）：Vorbis Comment 的 LYRICS / UNSYNCEDLYRICS 字段（LRC 文本）
//   - MP3（'ID3'）：ID3v2 的 SYLT（逐行时间戳）/ USLT / TXXX:LYRICS 帧
//   - M4A（'ftyp'）：moov.udta.meta.ilst 里的 ©lyr（UTF-8 文本，常含 LRC 时间戳）
//
// 不引 music-metadata：CF Pages Function 跑在 V8 isolates（非 Node），加载不动那个包，
// 这三种解析用下面的轻量实现足够。
//
// 输出与前端 fetchCachedLyrics、以及 meta.json 里预生成歌词文件的口径一致：
//   synced: [{ time: 秒, text }]（按时间排序）；plain: 非同步纯文本（没有同步歌词时）。

/** [mm:ss.xx] / [mm:ss] → 秒；一行可能有多个时间戳，逐个展开 */
const LRC_TS = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g

export function parseLrc(text) {
  const lines = []
  for (const raw of String(text).split(/\r?\n/)) {
    const stamps = [...raw.matchAll(LRC_TS)]
    if (!stamps.length) continue
    const lyric = raw.replace(LRC_TS, '').trim()
    for (const m of stamps) {
      const t =
        Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3].padEnd(3, '0')) / 1000 : 0)
      lines.push({ time: t, text: lyric })
    }
  }
  lines.sort((a, b) => a.time - b.time)
  return lines
}

/**
 * 按魔数识别容器并提取歌词。
 * @param {Buffer|Uint8Array} buf 音频头部
 * @returns {{ container: 'flac'|'mp3'|'mp4'|null, synced: {time:number,text:string}[], plain: string|null }}
 */
export function extractLyrics(buf) {
  const container = detectContainer(buf)
  let out = { synced: [], plain: null }
  if (container === 'flac') out = extractFlacLyrics(buf)
  else if (container === 'mp3') out = extractId3Lyrics(buf)
  else if (container === 'mp4') out = extractMp4Lyrics(buf)
  return { container, ...out }
}

export function detectContainer(buf) {
  if (buf.length >= 4 && str(buf, 0, 4) === 'fLaC') return 'flac'
  if (buf.length >= 3 && str(buf, 0, 3) === 'ID3') return 'mp3'
  // 无 ID3 头的 MP3（少见）也按 mp3 处理：0xFFEx 帧同步
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3'
  if (buf.length >= 8 && str(buf, 4, 8) === 'ftyp') return 'mp4'
  return null
}

/** MP3：ID3v2 头声明的标签总大小（含 10 字节头）；不是 MP3 返回 0。供端点决定补拉多少。 */
export function id3TotalSize(buf) {
  if (buf.length < 10 || str(buf, 0, 3) !== 'ID3') return 0
  return 10 + syncsafe(buf, 6)
}

/**
 * MP4：找 moov box，返回 { off, size }；找不到返回 null。
 * 两种情况端点都需要据此补拉：moov 在文件尾（非 faststart，头部里没有），
 * 或 moov 从头部开始但被 HEAD 截断（ilst 里的封面把 ©lyr 挤到后面，实测遇到过）。
 */
export function findMp4Moov(buf) {
  let off = 0
  let guard = 0
  while (off + 8 <= buf.length && guard++ < 64) {
    const size = readUIntBE(buf, off, 4)
    const type = str(buf, off + 4, off + 8)
    if (type === 'moov') return size >= 8 ? { off, size } : null
    if (size < 8) break
    off += size
  }
  return null
}


// —— FLAC ————————————————————————————————————————————————————————————

/**
 * 从 FLAC 头部字节里提取 Vorbis Comment 的歌词字段。
 * 结构：'fLaC' + 若干 metadata block（1 字节类型+是否最后一块、3 字节大端长度），
 * Vorbis Comment（type 4）里是一串 little-endian 长度前缀的 'KEY=value'。
 */
export function extractFlacLyrics(buf) {
  if (buf.length < 8 || str(buf, 0, 4) !== 'fLaC') return { synced: [], plain: null }
  let off = 4
  let comment = null
  let guard = 0
  while (off + 4 <= buf.length && guard++ < 64) {
    const type = buf[off] & 0x7f
    const last = (buf[off] & 0x80) !== 0
    const len = readUIntBE(buf, off + 1, 3)
    const bodyStart = off + 4
    if (type === 4) {
      // Vorbis Comment block 可能超出 buf（被截断），取可用部分
      comment = buf.subarray(bodyStart, Math.min(bodyStart + len, buf.length))
      break
    }
    off = bodyStart + len
    if (last) break
  }
  if (!comment || comment.length < 8) return { synced: [], plain: null }

  // 逐字段读 'KEY=value'；读不动（截断/损坏）就按已读到的继续
  const fields = []
  let p = 0
  const u32 = () => {
    const v = readUInt32LE(comment, p)
    p += 4
    return v
  }
  try {
    const vendorLen = u32()
    p += vendorLen
    const count = u32()
    for (let i = 0; i < count && p + 4 <= comment.length; i++) {
      const n = u32()
      if (p + n > comment.length) break
      fields.push(toStr(comment, p, p + n))
      p += n
    }
  } catch {
    /* 截断/损坏就按已读到的字段继续 */
  }

  const texts = fields.flatMap((f) => {
    const eq = f.indexOf('=')
    if (eq < 0) return []
    const key = f.slice(0, eq).trim().toUpperCase()
    const val = f.slice(eq + 1)
    return key === 'LYRICS' || key === 'UNSYNCEDLYRICS' || key === 'SYNCEDLYRICS' ? [val] : []
  })
  return pickLyrics(texts, [])
}

// —— MP3 / ID3v2 ——————————————————————————————————————————————————————

/**
 * 解析 ID3v2 头 + 帧，取 SYLT / USLT / TXXX:LYRICS。
 * 结构：'ID3' + 版本(2) + flags(1) + syncsafe 标签大小(4)，随后是一串帧：
 * 每帧 10 字节头（4 字节 ID + 4 字节大小 + 2 字节 flags），v2.4 的帧大小是 syncsafe。
 */
export function extractId3Lyrics(buf) {
  if (buf.length < 10 || str(buf, 0, 3) !== 'ID3') return { synced: [], plain: null }
  const major = buf[3]
  const flags = buf[5]
  const tagSize = syncsafe(buf, 6)
  let off = 10
  if (flags & 0x40) {
    // Extended header：v2.3 大小不含自身 4 字节，v2.4 含
    const ext = major === 4 ? syncsafe(buf, off) : readUIntBE(buf, off, 4)
    off += major === 4 ? ext : ext + 4
  }
  const end = Math.min(10 + tagSize, buf.length)

  const texts = []
  const sylts = []
  let guard = 0
  while (off + 10 <= end && guard++ < 512) {
    const id = str(buf, off, off + 4)
    // 帧 ID 是 4 位大写字母数字；读到 padding（全 0）就结束
    if (!/^[A-Z0-9]{4}$/.test(id)) break
    const size = major === 4 ? syncsafe(buf, off + 4) : readUIntBE(buf, off + 4, 4)
    const bodyStart = off + 10
    if (size <= 0 || bodyStart + size > end) break
    const body = buf.subarray(bodyStart, bodyStart + size)

    if (id === 'SYLT') {
      const lines = parseSylt(body)
      if (lines.length) sylts.push(...lines)
    } else if (id === 'USLT') {
      const t = parseUslt(body)
      if (t) texts.push(t)
    } else if (id === 'TXXX') {
      const t = parseTxxxLyrics(body)
      if (t) texts.push(t)
    }
    off = bodyStart + size
  }
  return pickLyrics(texts, sylts)
}

/** SYLT 帧：编码(1) 语言(3) 时间格式(1) 内容类型(1)，随后是若干「文本(以编码的 NUL 结尾) + 大端毫秒(4)」 */
function parseSylt(b) {
  if (b.length < 6) return []
  const enc = b[0]
  let p = 6
  const lines = []
  let guard = 0
  while (p < b.length && guard++ < 20000) {
    const { text, next } = readTerminated(b, p, enc)
    if (next + 4 > b.length) break
    const ms = readUIntBE(b, next, 4)
    p = next + 4
    const t = text.trim()
    if (t) lines.push({ time: ms / 1000, text: t })
  }
  lines.sort((a, z) => a.time - z.time)
  return lines
}

/** USLT 帧：编码(1) 语言(3)，描述串（编码 NUL 结尾），随后是正文 */
function parseUslt(b) {
  if (b.length < 4) return null
  const enc = b[0]
  const { next } = readTerminated(b, 4, enc)
  const text = decodeText(b.subarray(next), enc).trim()
  return text || null
}

/** TXXX 帧：编码(1)，描述串，正文。描述是 LYRICS 类才取 */
function parseTxxxLyrics(b) {
  if (b.length < 1) return null
  const enc = b[0]
  const { text: desc, next } = readTerminated(b, 1, enc)
  const d = desc.trim().toUpperCase()
  if (d !== 'LYRICS' && d !== 'UNSYNCEDLYRICS' && d !== 'SYNCEDLYRICS') return null
  const text = decodeText(b.subarray(next), enc).trim()
  return text || null
}


// —— M4A / MP4 ————————————————————————————————————————————————————————

/**
 * 在 MP4 box 树里找 moov.udta.meta.ilst 下的 ©lyr（或 ---- 自定义）文本。
 * meta 的 box 头前还有 4 字节 version/flags，需要跳过。
 */
export function extractMp4Lyrics(buf) {
  const texts = []
  walkMp4(buf, 0, buf.length, [], (bodyStart, bodyEnd) => {
    // 逐个读 ilst 条目
    let off = bodyStart
    let guard = 0
    while (off + 8 <= bodyEnd && guard++ < 256) {
      const size = readUIntBE(buf, off, 4)
      const type = str(buf, off + 4, off + 8)
      if (!(size >= 8) || off + size > bodyEnd) break
      if (type === '©lyr') {
        const t = parseIlstItem(buf, off + 8, off + size)
        if (t) texts.push(t)
      } else if (type === '----') {
        // 自由项：只有键名（name box）指明是 LYRICS 类才取，否则可能是任何 ID/备注
        const t = parseFreeformItem(buf, off + 8, off + size)
        if (t) texts.push(t)
      }
      off += size
    }
  })
  return pickLyrics(texts, [])
}

/** 递归遍历 box；命中 moov.udta.meta.ilst 时回调其内容区间（不再往子树走） */
function walkMp4(buf, start, end, path, hit) {
  // moov 的声明大小可能超出 buf（头部被截断），end 收敛到实际可用长度
  end = Math.min(end, buf.length)
  let off = start
  let guard = 0
  while (off + 8 <= end && guard++ < 512) {
    const size = readUIntBE(buf, off, 4)
    const type = str(buf, off + 4, off + 8)
    // 用 !(size>=8) 而非 size<8：截断处读出的 NaN 与任何数比较都是 false，会漏 break
    if (!(size >= 8) || off + size > end) break
    const childKey = [...path, type].join('.')
    const bodyStart = off + 8 + (type === 'meta' ? 4 : 0)
    if (childKey === 'moov.udta.meta.ilst') {
      hit(bodyStart, Math.min(off + size, end))
    } else if (type === 'moov' || type === 'udta' || type === 'meta') {
      walkMp4(buf, bodyStart, off + size, [...path, type], hit)
    }
    off += size
  }
}

/** ilst 条目里再套一层 'data' box：data 头是 4 字节类型 + 4 字节 locale，随后才是文本 */
function parseIlstItem(buf, start, end) {
  let off = start
  let guard = 0
  while (off + 8 <= end && guard++ < 32) {
    const size = readUIntBE(buf, off, 4)
    const type = str(buf, off + 4, off + 8)
    if (!(size >= 8) || off + size > end) break
    if (type === 'data') {
      const text = toStr(buf, off + 16, off + size).trim()
      return text || null
    }
    off += size
  }
  return null
}

/**
 * '----' 自由项：mean(命名空间) / name(键名) / data(值) 三个子 box。
 * 只有键名指明是歌词（如 com.apple.iTunes 下的 LYRICS）才取，其余是各种 ID/备注，不能当歌词。
 * name/data box 的正文都从 box 头 + 4 字节 version/flags 之后开始（data 另有 4 字节 locale）。
 */
function parseFreeformItem(buf, start, end) {
  let name = null
  let data = null
  let off = start
  let guard = 0
  while (off + 8 <= end && guard++ < 16) {
    const size = readUIntBE(buf, off, 4)
    const type = str(buf, off + 4, off + 8)
    if (!(size >= 8) || off + size > end) break
    if (type === 'name') name = toStr(buf, off + 12, off + size).trim().toUpperCase()
    else if (type === 'data') data = toStr(buf, off + 16, off + size).trim()
    off += size
  }
  if (!name || !data) return null
  return name.includes('LYRIC') ? data : null
}

// —— 汇总：同步优先，退回纯文本；文本里若带 LRC 时间戳则解析成 synced ——————————

function pickLyrics(texts, syltLines) {
  // 先汇总所有文本里的 LRC（SYLT 优先），只要有同步行就不设 plain ——
  // 排在前面的字段可能是任何杂项文本（ID、备注），不能因为「先出现」就占了 plain
  const synced = syltLines.slice()
  const plainTexts = []
  for (const t of texts) {
    const lines = parseLrc(t)
    if (lines.length) synced.push(...lines)
    else if (t.trim()) plainTexts.push(t)
  }
  if (synced.length) synced.sort((a, b) => a.time - b.time)
  const plain = synced.length ? null : (plainTexts.find((t) => t.trim()) ?? null)
  return { synced, plain }
}

// —— 字节小工具（CF 运行时没有 Buffer 全局，统一走 TextDecoder）———————————

function str(buf, s, e) {
  return new TextDecoder('latin1').decode(buf.subarray(s, e))
}
function toStr(buf, s, e) {
  return new TextDecoder('utf-8').decode(buf.subarray(s, e))
}
function readUIntBE(buf, off, len) {
  let v = 0
  for (let i = 0; i < len; i++) v = v * 256 + buf[off + i]
  return v
}
function readUInt32LE(buf, off) {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0
}
/** syncsafe：每字节只用低 7 位（ID3 防帧同步撞车） */
function syncsafe(buf, off) {
  return (
    ((buf[off] & 0x7f) << 21) |
    ((buf[off + 1] & 0x7f) << 14) |
    ((buf[off + 2] & 0x7f) << 7) |
    (buf[off + 3] & 0x7f)
  ) >>> 0
}

/** ID3 文本编码：0=ISO-8859-1，1=UTF-16(BOM)，2=UTF-16BE，3=UTF-8 */
function decodeText(buf, enc) {
  if (enc === 3) return new TextDecoder('utf-8').decode(buf)
  if (enc === 2) return new TextDecoder('utf-16be').decode(buf)
  if (enc === 1) {
    // 按 BOM 选 LE/BE；没有 BOM 按规范默认 LE
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe)
      return new TextDecoder('utf-16le').decode(buf.subarray(2))
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff)
      return new TextDecoder('utf-16be').decode(buf.subarray(2))
    return new TextDecoder('utf-16le').decode(buf)
  }
  return new TextDecoder('latin1').decode(buf)
}

/** 读一个以编码对应的 NUL 结尾的字符串，返回 { text, next }（next 越过终止符） */
function readTerminated(buf, from, enc) {
  const unit = enc === 1 || enc === 2 ? 2 : 1
  let i = from
  if (unit === 1) {
    while (i < buf.length && buf[i] !== 0) i++
    return { text: decodeText(buf.subarray(from, i), enc), next: i + 1 }
  }
  while (i + 1 < buf.length && !(buf[i] === 0 && buf[i + 1] === 0)) i += 2
  return { text: decodeText(buf.subarray(from, i), enc), next: i + 2 }
}
