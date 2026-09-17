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

  const base = (process.env.EMBY_URL || '').trim().replace(/\/+$/, '')
  const key = process.env.EMBY_API_KEY || ''
  if (!base || !key) {
    res.status(501).send('Emby 未配置：需要在服务端设置 EMBY_URL 与 EMBY_API_KEY')
    return
  }

  // EMBY_URL 必须是完整的 http(s)://host[:port]，填错时回显当前值（host:port 不是机密）。
  // 与 functions/api/emby/stream.js 保持一致（那边有详细注释）。
  let upstreamOrigin = ''
  try {
    const u = new URL(base)
    if (/^https?:$/.test(u.protocol)) upstreamOrigin = u.origin
  } catch { /* 保持空串 */ }
  if (!upstreamOrigin) {
    res.status(500).send(
      `EMBY_URL 不是合法的 http(s) 地址（当前值：${JSON.stringify(String(process.env.EMBY_URL || '')).slice(0, 120)}，需要形如 http://host:port）`,
    )
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
  // 诊断用：非 2xx 时能直接看出上游是谁（不含密钥）
  if (!resp.ok) res.setHeader('x-emby-upstream', upstreamOrigin)

  // 与 functions/api/emby/stream.js 保持一致：Vercel 出站没有这个限制，
  // 但同一份错误文案在两条线上都能出现，保持行为对齐。
  if (resp.status === 403) {
    const text = await resp.text()
    if (text.includes('error code: 1003')) {
      res.status(502).send(
        'EMBY_URL 不能是裸 IP：Cloudflare 不允许出站直连 IP（上游回 error code: 1003）。' +
          '请给服务器解析一个域名（A 记录指向服务器 IP，务必「仅 DNS」/灰云，不要开 Cloudflare 代理），' +
          '然后把 EMBY_URL 改成 http://<该域名>:8096',
      )
      return
    }
    res.send(text)
    return
  }

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
