// Cloudflare Pages Function: 开始 Last.fm 授权
// 用法: GET /api/lastfm/auth?origin=https://你的站点
//
// 返回 { ok, authUrl }，前端把浏览器跳过去即可。授权完成后 Last.fm 会把人送回
// /api/lastfm/callback（见同目录 callback.js）。
//
// 这样授权就不用跑终端脚本：只需要在 CF 环境变量里配 key + secret 两个，
// session key 由网页授权拿到、存在浏览器本地 —— 换账号只要在网页上重新授权。
import { authUrl } from '../../_lib/lastfm.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}
const JSON_HEADERS = { ...CORS, 'content-type': 'application/json; charset=utf-8' }

export async function onRequest(context) {
  const { request, env } = context
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const url = new URL(request.url)
  // origin 由前端传（本地 dev 与线上域名不同），缺省用请求自身的来源
  const origin = url.searchParams.get('origin') || url.origin
  const auth = authUrl(env, origin)
  if (!auth) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Last.fm 未配置或 origin 非法：需要在服务端设置 LASTFM_API_KEY（以及 LASTFM_API_SECRET）',
      }),
      { status: 501, headers: JSON_HEADERS },
    )
  }
  return new Response(JSON.stringify({ ok: true, authUrl: auth }), { status: 200, headers: JSON_HEADERS })
}
