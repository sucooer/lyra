// Vercel Serverless Function: CORS 代理（与 functions/api/proxy.js 同逻辑）
// 用法: /api/proxy?url=https://example.com/a.flac
export default async function handler(req, res) {
  const target = req.query.url
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
  if (!target || !/^https?:\/\//i.test(target)) {
    res.status(400).send('bad url')
    return
  }

  const headers = {}
  if (req.headers.range) headers['Range'] = req.headers.range
  headers['User-Agent'] = req.headers['user-agent'] || 'apple-music-web/1.0'

  const resp = await fetch(target, {
    method: req.method === 'HEAD' ? 'HEAD' : 'GET',
    headers,
    redirect: 'follow',
  })

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
