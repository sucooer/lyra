// Cloudflare Pages Function: Last.fm 授权的回调
// 用法: GET /api/lastfm/callback?token=xxxx（由 Last.fm 在用户点「允许」后跳转过来）
//
// 拿 token 换 session key，然后**直接写进本站的 localStorage 并跳回首页**。
//
// 为什么用这种方式交接：回调本身就落在本站同源下，所以它能直接写 localStorage ——
// 比 postMessage / 把 sk 塞进 URL 都干净（sk 不进地址栏、不进历史、不进日志）。
// token 是一次性的（且换完即失效），出现在 URL 里没有风险。
import { exchangeToken } from '../../_lib/lastfm.js'

const page = (body) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Last.fm</title><style>
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
       font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
       background:#fafafa;color:#111}
  @media (prefers-color-scheme:dark){body{background:#0b0b0c;color:#f5f5f7}}
  .box{max-width:26rem;padding:0 1.5rem;text-align:center}
  a{color:#fa233b}
</style></head><body><div class="box">${body}</div></body></html>`

export async function onRequest(context) {
  const { request, env } = context
  const url = new URL(request.url)
  const token = url.searchParams.get('token') || ''
  const denied = url.searchParams.get('denied') // 用户点了「拒绝」时 Last.fm 会带这个

  if (!token) {
    return new Response(
      page(
        `<h3>没有拿到授权 token</h3><p>${
          denied ? '你刚才在那个页面点了「拒绝」。' : '回调里没有 token。'
        }</p><p><a href="/">回到播放器</a>，右上角再点一次「连接 Last.fm」重试。</p>`,
      ),
      { status: 400, headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
  }

  const r = await exchangeToken(env, token)
  if (r.error) {
    return new Response(
      page(
        `<h3>授权失败</h3><p>${String(r.message ?? '').replace(/[<>]/g, '')}</p>` +
          `<p>token 只能用一次、有效期 60 分钟；重新点一次「连接 Last.fm」即可。</p><p><a href="/">回到播放器</a></p>`,
      ),
      { status: 502, headers: { 'content-type': 'text/html; charset=utf-8' } },
    )
  }

  // 写入 localStorage 后跳回首页。JSON.stringify 保证引号安全。
  const sk = JSON.stringify(r.sessionKey)
  const who = JSON.stringify(r.user)
  return new Response(
    page(
      `<h3>已连接 Last.fm</h3><p>账号：<b>${String(r.user).replace(/[<>]/g, '') || '(未知)'}</b></p>` +
        `<p>正在返回播放器…现在起听歌就会计入你的收听记录。</p><p><a href="/">没自动跳转？点这里</a></p>` +
        `<script>
           try {
             localStorage.setItem('lyra.lastfm', JSON.stringify({ sk: ${sk}, user: ${who} }))
             localStorage.setItem('lyra.scrobble', 'on')
           } catch (e) {}
           location.replace('/')
         </script>`,
    ),
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}
