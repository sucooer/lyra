// Cloudflare Pages Function: Emby 取流代理
// 用法: /api/emby/stream?id=214
//
// 为什么需要这一层（两条都得解决，缺一不可）：
//   1. 站点跑在 https，而 Emby 只开了 http（8920 未开）——
//      浏览器直接去拉 http 媒体会被混合内容策略拦掉，脚本和 fetch 都绕不过。
//   2. Emby 取流必须把 api_key（或 X-Emby-Token）带在请求上。若由前端拼，
//      密钥就会出现在 emby.json / 页面源码里，而它不是只读音乐库的凭证，
//      是这台服务器的完整权限（含其它媒体库与管理接口）。
//      所以密钥只存在服务端环境变量里，由这里注入，前端永远拿不到。
//
// 入参只有 id，且必须匹配条目 id 的形状——不接受任何路径或 URL，
// 免得这个端点长成一个开放代理。
const ID_RE = /^[A-Za-z0-9]{1,32}$/

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Expose-Headers':
    'Content-Range, Content-Length, Content-Type, Accept-Ranges',
}

export async function onRequest(context) {
  const { request, env } = context

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  const base = (env.EMBY_URL || '').trim().replace(/\/+$/, '')
  const key = env.EMBY_API_KEY || ''
  if (!base || !key) {
    // 明确区分「没配」和「取不到」，否则线上只会看到一坨 502 不知道去配环境变量
    return new Response('Emby 未配置：需要在服务端设置 EMBY_URL 与 EMBY_API_KEY', {
      status: 501,
      headers: CORS,
    })
  }

  // EMBY_URL 必须是完整的 http(s)://host[:port]。填错时别让它变成线上一个莫名其妙的
  // 403/502——把当前值原样回显（host:port 不是机密），一眼看出填错在哪。
  // 实测踩过：值指到一个 Cloudflare 代理的 IP 时，上游会回 403 + "error code: 1003"。
  let upstreamOrigin = ''
  try {
    const u = new URL(base)
    if (/^https?:$/.test(u.protocol)) upstreamOrigin = u.origin
  } catch { /* 保持空串 */ }
  if (!upstreamOrigin) {
    return new Response(
      `EMBY_URL 不是合法的 http(s) 地址（当前值：${JSON.stringify(String(env.EMBY_URL || '')).slice(0, 120)}，需要形如 http://host:port）`,
      { status: 500, headers: CORS },
    )
  }

  const id = new URL(request.url).searchParams.get('id') || ''
  if (!ID_RE.test(id)) {
    return new Response('bad id', { status: 400, headers: CORS })
  }

  // 透传 Range：无头与各浏览器的媒体请求几乎都带 Range，服务端要能分块回。
  // 不带也得能工作——上游对这两种形态都会正确应答（实测 200 / 206 均可）。
  const headers = {}
  const range = request.headers.get('range')
  if (range) headers['Range'] = range

  // static=true 是必须的：不加的话 Emby 会走转码管道（实测那个容器里 ffmpeg 起不来，
  // 直接 500）。加了才是原样透传源文件，也正是我们要的——曲库全是 flac，不需要转码。
  const upstream = `${base}/emby/Audio/${id}/stream?static=true&api_key=${encodeURIComponent(key)}`

  let resp
  try {
    resp = await fetch(upstream, {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      redirect: 'follow',
    })
  } catch (e) {
    return new Response(`Emby 取流失败: ${String(e)}`, { status: 502, headers: CORS })
  }

  const out = new Headers(resp.headers)
  for (const [k, v] of Object.entries(CORS)) out.set(k, v)
  out.delete('content-security-policy')
  // 诊断用：非 2xx 时能直接看出上游是谁（不含密钥）
  if (!resp.ok) out.set('x-emby-upstream', upstreamOrigin)

  // Cloudflare 的出站 fetch 不允许以「裸 IP」为目标：请求根本出不了 CF 网络，
  // 会被边缘按 Direct IP Access 拦下，回 403 + 纯文本 "error code: 1003"
  // （实测该 IP 的所有端口都这样，与目标服务无关；域名形态则正常出站）。
  // 撞上时把原因讲清楚，别让线上只剩一个莫名其妙的 403。
  if (resp.status === 403) {
    const text = await resp.text()
    if (text.includes('error code: 1003')) {
      return new Response(
        'EMBY_URL 不能是裸 IP：Cloudflare 不允许出站直连 IP（上游回 error code: 1003）。' +
          '请给服务器解析一个域名（A 记录指向服务器 IP，务必「仅 DNS」/灰云，不要开 Cloudflare 代理），' +
          '然后把 EMBY_URL 改成 http://<该域名>:8096',
        { status: 502, headers: CORS },
      )
    }
    return new Response(text, { status: resp.status, statusText: resp.statusText, headers: out })
  }

  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: out,
  })
}
