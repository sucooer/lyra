// Vercel Serverless Function: Emby 取流代理（与 functions/api/emby/stream.js 同逻辑）
// 用法: /api/emby/stream?id=214
//
// 两处必须保持一致，改逻辑时一起改，否则两条部署线会漂移。
// 环境变量（Vercel 后台设置）：EMBY_URL、EMBY_API_KEY
const ID_RE = /^[A-Za-z0-9]{1,32}$/

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type')
  res.setHeader(
    'Access-Control-Expose-Headers',
    'Content-Range, Content-Length, Content-Type, Accept-Ranges',
  )

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  const base = (process.env.EMBY_URL || '').replace(/\/+$/, '')
  const key = process.env.EMBY_API_KEY || ''
  if (!base || !key) {
    res.status(501).send('Emby 未配置：需要在服务端设置 EMBY_URL 与 EMBY_API_KEY')
    return
  }

  const raw = req.query.id
  const id = Array.isArray(raw) ? raw[0] : raw
  if (!id || !ID_RE.test(id)) {
    res.status(400).send('bad id')
    return
  }

  const headers = {}
  if (req.headers.range) headers['Range'] = req.headers.range

  const upstream = `${base}/emby/Audio/${id}/stream?static=true&api_key=${encodeURIComponent(key)}`

  let resp
  try {
    resp = await fetch(upstream, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      redirect: 'follow',
    })
  } catch (e) {
    res.status(502).send(`Emby 取流失败: ${String(e)}`)
    return
  }

  res.status(resp.status)
  for (const [k, v] of resp.headers.entries()) {
    if (!['content-encoding', 'transfer-encoding', 'content-security-policy'].includes(k)) {
      res.setHeader(k, v)
    }
  }
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (!resp.body) {
    res.end()
    return
  }
  const reader = resp.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    res.write(Buffer.from(value))
  }
  res.end()
}
