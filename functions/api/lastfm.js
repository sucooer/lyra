// Cloudflare Pages Function: Last.fm 上报入口
// 用法: POST /api/lastfm  body: { action: 'nowplaying' | 'scrobble', ... }
//
// 这里只做「读请求 → 交给共用核心 → 写响应」；签名与密钥都在
// functions/_lib/lastfm.js 里，和 Vercel 那份共用同一份实现。
import { runAction } from '../_lib/lastfm.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}
const JSON_HEADERS = { ...CORS, 'content-type': 'application/json; charset=utf-8' }

const reply = (status, json) => new Response(JSON.stringify(json), { status, headers: JSON_HEADERS })

export async function onRequest(context) {
  const { request, env } = context
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (request.method !== 'POST') return reply(405, { ok: false, error: '只接受 POST' })

  let body = null
  try {
    body = await request.json()
  } catch {
    /* 下面按空 body 处理 */
  }
  if (!body || typeof body !== 'object') return reply(400, { ok: false, error: '请求体需要是 JSON 对象' })

  const { status, json } = await runAction(env, body)
  return reply(status, json)
}
