// Cloudflare Pages Function: Emby 歌词端点
// 用法: /api/emby/lyrics?id=<条目 id>  →  { synced: [{time, text}], plain?: string }
//
// 为什么歌词要走代理而不是随仓库提交：
//   之前 gen-emby 会把每首曲目的内嵌歌词解析成一份 json 提交进 public/emby-lyrics/，
//   曲库一大就是上万份文件（本项目实测 11256 份 / 26MB）堆在 git 里。
//   歌词本来就只在「播放到该曲目」时才需要，改成由这里按需现取：
//   Range 拉音频头部，解析出歌词后返回与原来预生成文件同形的 JSON。
//   密钥只在服务端，与 stream/cover 同思路。
//
// 解析逻辑在 functions/_lib/audio-lyrics.js（与 Vercel 那份 api/emby/lyrics.js 共用），
// 支持 FLAC / MP3(ID3v2) / M4A(MP4)。不引 music-metadata：
// CF Function 跑在 V8 isolates，加载不动它。
import {
  extractLyrics,
  extractMp4Lyrics,
  detectContainer,
  id3TotalSize,
  findMp4Moov,
} from '../../_lib/audio-lyrics.js'

const ID_RE = /^[A-Za-z0-9]{1,32}$/

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
}

// 歌词不常变：缓存一天，换歌词靠重新部署或 id 变化。
const CACHE = 'public, max-age=86400, stale-while-revalidate=604800'

// 首次只拉头部这么些字节：FLAC 的 Vorbis Comment、MP3 的 ID3 通常都在这一段里。
// 取 128KB 是给「内嵌封面挡在歌词前面」留余量；不够再按下述规则补拉。
const HEAD = 128 * 1024
// MP4 的 moov 可能在文件尾（非 faststart）：头部找不到时补拉尾部这么些字节再试。
const MP4_TAIL = 512 * 1024
// moov 也可能从头部开始但被 HEAD 截断（ilst 里的大封面把 ©lyr 挤到后面）：
// 此时按 moov 的声明范围补拉整段，封顶 8MB（封面动辄几 MB）。
const MP4_MOOV_MAX = 8 * 1024 * 1024
// MP3 的 ID3 标签若比 HEAD 大（内嵌封面把歌词挤到后面），按声明的标签大小补拉，封顶 2MB。
const MP3_TAG_MAX = 2 * 1024 * 1024

export async function onRequest(context) {
  const { request, env } = context

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  const base = (env.EMBY_URL || '').trim().replace(/\/+$/, '')
  const key = env.EMBY_API_KEY || ''
  if (!base || !key) {
    return jsonErr('Emby 未配置：需要在服务端设置 EMBY_URL 与 EMBY_API_KEY', 501)
  }

  const id = new URL(request.url).searchParams.get('id') || ''
  if (!ID_RE.test(id)) return jsonErr('bad id', 400)

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
      // ID3 标签比头部大：补拉到声明的标签大小
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
    return jsonErr(`Emby 取流失败: ${String(e)}`, 502)
  }

  const { synced, plain } = out
  return new Response(JSON.stringify({ synced, ...(plain ? { plain } : {}) }), {
    status: 200,
    headers: { ...CORS, 'Cache-Control': CACHE },
  })
}

/** 从 Content-Range（bytes a-b/total）里取文件总长；取不到返回 0 */
function totalOf(resp) {
  const cr = resp.headers.get('content-range') || ''
  const m = /\/(\d+)\s*$/.exec(cr)
  return m ? Number(m[1]) : 0
}

function jsonErr(msg, status) {
  return new Response(JSON.stringify({ synced: [], error: msg }), { status, headers: CORS })
}
