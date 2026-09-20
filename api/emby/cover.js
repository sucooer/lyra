// Vercel Serverless Function: Emby 封面代理（与 functions/api/emby/cover.js 同逻辑）
// 用法: /api/emby/cover?id=<专辑或条目 id>
//
// 两处必须保持一致，改逻辑时一起改，否则两条部署线会漂移。
// 封面不再随仓库提交，由这里去 Emby 现取并透传；密钥只存服务端环境变量。
// 环境变量（Vercel 后台设置）：EMBY_URL、EMBY_API_KEY
const ID_RE = /^[A-Za-z0-9]{1,32}$/
const CACHE = 'public, max-age=86400, stale-while-revalidate=604800'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

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

  const raw = req.query.id
  const id = Array.isArray(raw) ? raw[0] : raw
  if (!id || !ID_RE.test(id)) {
    res.status(400).send('bad id')
    return
  }

  const upstream = `${base}/emby/Items/${id}/Images/Primary?api_key=${encodeURIComponent(key)}`
  let resp
  try {
    resp = await fetch(upstream, {
      method: req.method === 'HEAD' ? 'HEAD' : 'GET',
      redirect: 'follow',
    })
  } catch (e) {
    res.status(502).send(`Emby 取封面失败: ${String(e)}`)
    return
  }

  res.status(resp.status)
  const ct = resp.headers.get('content-type')
  if (ct) res.setHeader('Content-Type', ct)
  res.setHeader('Cache-Control', CACHE)
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
