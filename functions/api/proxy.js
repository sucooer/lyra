// Cloudflare Pages Function: CORS 代理（用于无 ACAO 头的音乐直链）
// 用法: /api/proxy?url=https://example.com/a.flac
export async function onRequest(context) {
  const { request } = context
  const url = new URL(request.url)
  const target = url.searchParams.get('url')

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type',
    'Access-Control-Expose-Headers':
      'Content-Range, Content-Length, Content-Type, Accept-Ranges',
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (!target || !/^https?:\/\//i.test(target)) {
    return new Response('bad url', { status: 400, headers: corsHeaders })
  }

  // 透传 Range 头，支持分块读取
  const headers = {}
  const range = request.headers.get('range')
  if (range) headers['Range'] = range
  headers['User-Agent'] =
    request.headers.get('user-agent') || 'apple-music-web/1.0'

  const resp = await fetch(target, {
    method: request.method === 'HEAD' ? 'HEAD' : 'GET',
    headers,
    redirect: 'follow',
  })

  const out = new Headers(resp.headers)
  for (const [k, v] of Object.entries(corsHeaders)) out.set(k, v)
  out.delete('content-security-policy')

  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers: out,
  })
}
