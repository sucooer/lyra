// Vercel Serverless Function: Emby 歌词端点（与 functions/api/emby/lyrics.js 同逻辑）
// 用法: /api/emby/lyrics?id=<条目 id>  →  { synced: [{time, text}], plain?: string }
//
// 两处必须保持一致，改逻辑时一起改，否则两条部署线会漂移。
// 歌词不再随仓库提交，由这里 Range 拉音频解析内嵌歌词。
// 解析逻辑与 CF 那份共用 functions/_lib/audio-lyrics.js（FLAC / MP3 / M4A），
// 不引 music-metadata。
// 环境变量（Vercel 后台设置）：EMBY_URL、EMBY_API_KEY
import {
  extractLyrics,
  extractMp4Lyrics,
  detectContainer,
  id3TotalSize,
  findMp4Moov,
} from '../../functions/_lib/audio-lyrics.js'

const ID_RE = /^[A-Za-z0-9]{1,32}$/
const CACHE = 'public, max-age=86400, stale-while-revalidate=604800'
const HEAD = 128 * 1024
const MP4_TAIL = 512 * 1024
const MP4_MOOV_MAX = 8 * 1024 * 1024
const MP3_TAG_MAX = 2 * 1024 * 1024

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  const base = (process.env.EMBY_URL || '').trim().replace(/\/+$/, '')
  const key = process.env.EMBY_API_KEY || ''
  if (!base || !key) {
    res.status(501).json({ synced: [], error: 'Emby 未配置：需要 EMBY_URL 与 EMBY_API_KEY' })
    return
  }

  const raw = req.query.id
  const id = Array.isArray(raw) ? raw[0] : raw
  if (!id || !ID_RE.test(id)) {
    res.status(400).json({ synced: [], error: 'bad id' })
    return
  }

  const url = `${base}/emby/Audio/${id}/stream?static=true&api_key=${encodeURIComponent(key)}`
  const get = async (range) => {
    const headers = range ? { Range: range } : {}
    const r = await fetch(url, { headers, redirect: 'follow' })
    if (!r.ok && r.status !== 206) throw new Error(`upstream HTTP ${r.status}`)
    return { buf: new Uint8Array(await r.arrayBuffer()), total: totalOf(r) }
  }

  let out
  try {
    let { buf, total } = await get(`bytes=0-${HEAD - 1}`)
    const container = detectContainer(buf)

    if (container === 'mp3') {
      const tagTotal = id3TotalSize(buf)
      if (tagTotal > buf.length && tagTotal <= MP3_TAG_MAX) {
        ;({ buf, total } = await get(`bytes=0-${tagTotal - 1}`))
      }
      out = extractLyrics(buf)
    } else if (container === 'mp4') {
      out = extractLyrics(buf)
      if (out.synced.length === 0 && !out.plain && total > 0) {
        const moov = findMp4Moov(buf)
        if (moov && moov.off + moov.size > buf.length && moov.size <= MP4_MOOV_MAX) {
          // moov 从头部开始但被截断：按声明范围把整段 moov 拉下来再解析。
          // 注意用 extractMp4Lyrics：这段缓冲开头是 moov 而非 ftyp，走不了容器识别。
          const end = Math.min(moov.off + moov.size, total)
          const full = await get(`bytes=${moov.off}-${end - 1}`)
          out = extractMp4Lyrics(full.buf)
        } else if (!moov) {
          // moov 在文件尾（非 faststart）：补拉尾部再解析（同样没有 ftyp 头）
          const start = Math.max(0, total - MP4_TAIL)
          const tail = await get(`bytes=${start}-${total - 1}`)
          out = extractMp4Lyrics(tail.buf)
        }
      }
    } else {
      out = extractLyrics(buf)
    }
  } catch (e) {
    res.status(502).json({ synced: [], error: `Emby 取流失败: ${String(e)}` })
    return
  }

  const { synced, plain } = out
  res.setHeader('Cache-Control', CACHE)
  res.status(200).json({ synced, ...(plain ? { plain } : {}) })
}

function totalOf(resp) {
  const cr = resp.headers.get('content-range') || ''
  const m = /\/(\d+)\s*$/.exec(cr)
  return m ? Number(m[1]) : 0
}
