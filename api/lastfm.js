// Vercel Serverless Function: Last.fm 上报入口（与 functions/api/lastfm.js 同逻辑）
// 用法: POST /api/lastfm  body: { action: 'nowplaying' | 'scrobble', ... }
//
// 签名逻辑共用 functions/_lib/lastfm.js —— 这份只是把 Node 的 (req, res)
// 适配成核心需要的 { env, body }。密钥来自 Vercel 项目的环境变量。
import { runAction } from '../functions/_lib/lastfm.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export default async function handler(req, res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: '只接受 POST' })
    return
  }

  // Vercel 在 content-type 是 JSON 时已经解析过 body；字符串形态也兜一下
  let body = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      body = null
    }
  }
  if (!body || typeof body !== 'object') {
    res.status(400).json({ ok: false, error: '请求体需要是 JSON 对象' })
    return
  }

  const { status, json } = await runAction(process.env, body)
  res.status(status).json(json)
}
