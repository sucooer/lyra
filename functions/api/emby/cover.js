// Cloudflare Pages Function: Emby 封面代理
// 用法: /api/emby/cover?id=<专辑或条目 id>
//
// 为什么封面要走代理而不是随仓库提交：
//   之前 gen-emby 会把每张专辑封面下载进 public/emby-covers/ 一并提交，
//   曲库一大就是上千张图、一百多 MB 堆在 git 里（clone/CI checkout/部署全变慢）。
//   封面在 Emby 上本来就有现成接口（Items/{id}/Images/Primary），
//   与取流同理：密钥不能给前端，所以由这里在服务端注入并透传，
//   浏览器/边缘用 Cache-Control 缓存，实际回源次数很少。
//
// 入参只有 id，且必须是条目 id 形状——与 stream.js 同一个收窄口径，
// 免得这个端点长成开放代理。
const ID_RE = /^[A-Za-z0-9]{1,32}$/

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// 封面不常变：浏览器与边缘都缓存一天，重新部署/换封面靠 id 变化自然失效。
const CACHE = 'public, max-age=86400, stale-while-revalidate=604800'

export async function onRequest(context) {
  const { request, env } = context

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS })
  }

  const base = (env.EMBY_URL || '').trim().replace(/\/+$/, '')
  const key = env.EMBY_API_KEY || ''
  if (!base || !key) {
    return new Response('Emby 未配置：需要在服务端设置 EMBY_URL 与 EMBY_API_KEY', {
      status: 501,
      headers: CORS,
    })
  }

  const id = new URL(request.url).searchParams.get('id') || ''
  if (!ID_RE.test(id)) {
    return new Response('bad id', { status: 400, headers: CORS })
  }

  const upstream = `${base}/emby/Items/${id}/Images/Primary?api_key=${encodeURIComponent(key)}`

  let resp
  try {
    resp = await fetch(upstream, {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      redirect: 'follow',
    })
  } catch (e) {
    return new Response(`Emby 取封面失败: ${String(e)}`, { status: 502, headers: CORS })
  }

  const out = new Headers()
  const ct = resp.headers.get('content-type')
  if (ct) out.set('Content-Type', ct)
  out.set('Cache-Control', CACHE)
  for (const [k, v] of Object.entries(CORS)) out.set(k, v)

  if (!resp.ok) {
    // 没封面（404）也回透传状态码，前端按「无封面」走占位符，不当错误
    return new Response(resp.body, { status: resp.status, headers: out })
  }

  return new Response(resp.body, { status: 200, headers: out })
}
