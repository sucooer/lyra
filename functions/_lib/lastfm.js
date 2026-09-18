/**
 * Last.fm 上报（scrobble / now playing）的服务端核心 —— CF Pages Function 与
 * Vercel Serverless 共用这一份，避免两套实现漂移。
 *
 * 为什么必须在服务端：
 *   Last.fm 的每次写操作都要用 **API secret** 做 md5 签名（api_sig）。这个站是公开的
 *   （仓库公开、站点公开），secret 一旦进前端就等于交给所有人 —— 任何人都能拿它冒充
 *   这个应用往别人的账号里写收听记录。所以密钥只存服务端环境变量，由这一层注入。
 *   与 functions/api/emby/stream.js 同一个道理。
 *
 * 需要三个环境变量（CF Pages / Vercel / 本地 .env.local 都要有）：
 *   LASTFM_API_KEY       API key（和抓歌手简介用的那个是同一个）
 *   LASTFM_API_SECRET    API secret（只在服务端用；pnpm lastfm:auth 会告诉你去哪拿）
 *   LASTFM_SESSION_KEY   用户授权后的会话密钥（用 scripts/lastfm-auth.mjs 获取一次即可）
 */

/**
 * md5（纯 JS，无平台依赖）。
 *
 * 为什么不直接用 WebCrypto：Cloudflare Workers 的 crypto.subtle 支持 MD5，
 * 但 Node 的 WebCrypto **不支持**（只认 SHA 系），Vercel 上就得再退回 node:crypto。
 * 与其按平台分叉两套签名，不如自带一份 —— 输入只有一小段查询串，性能无关紧要。
 */
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15,
  21, 6, 10, 15, 21, 6, 10, 15, 21,
]
const MD5_K = new Uint32Array(64)
for (let i = 0; i < 64; i++) MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)

/** @param {string} input @returns {string} 32 位小写十六进制 */
export function md5Hex(input) {
  const bytes = new TextEncoder().encode(String(input))
  const len = bytes.length
  // 补 0x80，再补 0 到 (len ≡ 56 mod 64)，最后 8 字节小端位长 —— 至少一个块
  const total = (((len + 8) >> 6) << 6) + 64
  const buf = new Uint8Array(total)
  buf.set(bytes)
  buf[len] = 0x80
  const dv = new DataView(buf.buffer)
  const bitLen = len * 8
  dv.setUint32(total - 8, bitLen >>> 0, true)
  dv.setUint32(total - 4, Math.floor(bitLen / 4294967296), true)

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476
  const M = new Uint32Array(16)
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true)
    let A = a0
    let B = b0
    let C = c0
    let D = d0
    for (let i = 0; i < 64; i++) {
      let F
      let g
      if (i < 16) {
        F = (B & C) | (~B & D)
        g = i
      } else if (i < 32) {
        F = (D & B) | (~D & C)
        g = (5 * i + 1) % 16
      } else if (i < 48) {
        F = B ^ C ^ D
        g = (3 * i + 5) % 16
      } else {
        F = C ^ (B | ~D)
        g = (7 * i) % 16
      }
      F = (F + A + MD5_K[i] + M[g]) >>> 0
      A = D
      D = C
      C = B
      B = (B + (((F << MD5_S[i]) | (F >>> (32 - MD5_S[i]))) >>> 0)) >>> 0
    }
    a0 = (a0 + A) >>> 0
    b0 = (b0 + B) >>> 0
    c0 = (c0 + C) >>> 0
    d0 = (d0 + D) >>> 0
  }
  const out = new Uint8Array(16)
  const odv = new DataView(out.buffer)
  odv.setUint32(0, a0, true)
  odv.setUint32(4, b0, true)
  odv.setUint32(8, c0, true)
  odv.setUint32(12, d0, true)
  return Array.from(out, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Last.fm 签名：把除 format / callback 外的参数按**键名升序**拼成
 * `key1value1key2value2…`，末尾接上 secret，取 md5。
 * 数组参数用 `artist[0]` / `track[0]` 这种键名，照常参与排序。
 */
export function signParams(params, secret) {
  const base = Object.keys(params)
    .filter((k) => k !== 'format' && k !== 'callback')
    .sort()
    .map((k) => k + params[k])
    .join('')
  return md5Hex(base + secret)
}

const ENDPOINT = 'https://ws.audioscrobbler.com/2.0/'

/** 一次真实的写请求（POST 表单 + api_sig）。永不抛错，失败以 {error} 返回 */
export async function callLastfm(env, method, params) {
  const apiKey = String(env?.LASTFM_API_KEY ?? '').trim()
  const secret = String(env?.LASTFM_API_SECRET ?? '').trim()
  const sk = String(env?.LASTFM_SESSION_KEY ?? '').trim()
  if (!apiKey || !secret || !sk) {
    return {
      // ⚠️ 不能用 0 当「未配置」的哨兵：调用方是 `if (r?.error)`，0 判假会被漏判成成功。
      // Last.fm 自己的错误码都是正整数，负数留给本地错误。
      error: -2,
      message:
        'Last.fm 未配置完整：服务端需要 LASTFM_API_KEY / LASTFM_API_SECRET / LASTFM_SESSION_KEY 三个环境变量（session key 用 pnpm lastfm:auth 获取）',
    }
  }

  const all = { ...params, api_key: apiKey, sk, method }
  const body = new URLSearchParams({ ...all, api_sig: signParams(all, secret), format: 'json' })

  try {
    const resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(15000),
    })
    const text = await resp.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      /* 保持 null，下面按文本回 */
    }
    if (!json) return { error: resp.status, message: `上游返回非 JSON（HTTP ${resp.status}）：${text.slice(0, 160)}` }
    return json
  } catch (e) {
    return { error: -1, message: `请求 Last.fm 失败：${String(e?.message ?? e).slice(0, 160)}` }
  }
}

/** 单曲 → Last.fm 参数（scrobble 的数组下标由调用方补） */
function trackParams(t, i) {
  const p = {}
  const suffix = i === null ? '' : `[${i}]`
  p[`artist${suffix}`] = String(t.artist ?? '').slice(0, 400)
  p[`track${suffix}`] = String(t.track ?? '').slice(0, 400)
  if (t.album) p[`album${suffix}`] = String(t.album).slice(0, 400)
  if (t.duration) p[`duration${suffix}`] = String(Math.round(Number(t.duration)))
  if (i !== null) p[`timestamp${suffix}`] = String(Math.round(Number(t.timestamp)))
  return p
}

/** 入参校验：Last.fm 要求 artist/track 非空、timestamp 是过去的秒级时间戳 */
function usable(t) {
  if (!t || typeof t !== 'object') return false
  if (!String(t.artist ?? '').trim() || !String(t.track ?? '').trim()) return false
  const ts = Number(t.timestamp)
  return Number.isFinite(ts) && ts > 0
}

/**
 * 平台无关的动作层：CF 与 Vercel 的入口都只做「读请求 → 调这里 → 写响应」。
 * body: { action: 'nowplaying' | 'scrobble', now?: Track, scrobbles?: Track[] }
 * 返回 { status, json }
 */
export async function runAction(env, body) {
  const action = String(body?.action ?? '')

  if (action === 'nowplaying') {
    const now = body.now ?? {}
    if (!String(now.artist ?? '').trim() || !String(now.track ?? '').trim()) {
      return { status: 400, json: { ok: false, error: 'now 需要 artist 与 track' } }
    }
    const r = await callLastfm(env, 'track.updateNowPlaying', trackParams(now, null))
    const ok = !r?.error
    return { status: ok ? 200 : 502, json: { ok, error: ok ? undefined : (r?.message ?? `Last.fm 错误 ${r?.error}`) } }
  }

  if (action === 'scrobble') {
    const list = Array.isArray(body?.scrobbles) ? body.scrobbles.filter(usable).slice(0, 50) : []
    if (!list.length) return { status: 400, json: { ok: false, error: 'scrobbles 为空或都缺 artist/track/timestamp' } }
    // 多首合并成一次请求（Last.fm 单次上限 50 首），省往返也省配额
    const params = {}
    list.forEach((t, i) => Object.assign(params, trackParams(t, i)))
    const r = await callLastfm(env, 'track.scrobble', params)
    if (r?.error) return { status: 502, json: { ok: false, error: r.message ?? `Last.fm 错误 ${r.error}` } }
    const attr = r?.scrobbles?.['@attr'] ?? {}
    return {
      status: 200,
      json: { ok: true, accepted: Number(attr.accepted ?? list.length), ignored: Number(attr.ignored ?? 0) },
    }
  }

  return { status: 400, json: { ok: false, error: `未知 action：${action || '(空)'}` } }
}
