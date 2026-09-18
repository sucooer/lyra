/**
 * 获取 Last.fm 的 session key（只需跑一次）。
 *
 * Last.fm 写操作（scrobble / now playing）需要「用户授权后的会话密钥」，而授权是
 * 一次性的握手：拿 token → 用户在浏览器里点「允许」→ 用 token 换 session key。
 * 这个脚本把三步串起来，最后把要填的三个环境变量打印出来。
 *
 * 用法：
 *   1. 在 https://www.last.fm/api/account/create 建应用（或复用已有的），
 *      拿到 API key 与 **API secret**（同一个页面都给了）
 *   2. 把两者写进 .env.local：
 *        LASTFM_API_KEY=...
 *        LASTFM_API_SECRET=...
 *   3. pnpm lastfm:auth
 *   4. 照着输出把三个变量填到 CF Pages / Vercel 的环境变量里
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { signParams } from '../functions/_lib/lastfm.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const ENDPOINT = 'https://ws.audioscrobbler.com/2.0/'

/** 读 .env.local（不覆盖已存在的真实环境变量） */
function loadEnv() {
  const env = { ...process.env }
  try {
    const text = readFileSync(path.join(ROOT, '.env.local'), 'utf8')
    for (const line of text.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (m && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* 没有就没，下面会报缺哪个 */
  }
  return env
}

const env = loadEnv()
const apiKey = String(env.LASTFM_API_KEY ?? '').trim()
const secret = String(env.LASTFM_API_SECRET ?? '').trim()

if (!apiKey || !secret) {
  console.error(
    '缺少 LASTFM_API_KEY 或 LASTFM_API_SECRET。\n' +
      '到 https://www.last.fm/api/account/create 建应用（或用已有的），把两者写进 .env.local 再跑。\n' +
      '注意 API secret 与 API key 在同一个页面上，两个都要；secret 只放服务端，别提交。',
  )
  process.exit(1)
}

/** 调 auth.* 方法：这两个方法不带 sk，只签 api_key / method / token */
async function call(method, params = {}) {
  const all = { ...params, api_key: apiKey, method }
  const body = new URLSearchParams({ ...all, api_sig: signParams(all, secret), format: 'json' })
  const resp = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  const json = await resp.json().catch(() => null)
  if (!json || json.error) {
    throw new Error(`Last.fm 返回错误 ${json?.error ?? resp.status}：${json?.message ?? '(无说明)'}`)
  }
  return json
}

const ask = (q) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(q, (a) => {
      rl.close()
      resolve(a)
    })
  })

try {
  const { token } = await call('auth.getToken')
  const url = `https://www.last.fm/api/auth/?api_key=${encodeURIComponent(apiKey)}&token=${token}`

  console.log('\n请在浏览器打开下面这个地址，并点「允许」授权：\n')
  console.log(`  ${url}\n`)
  await ask('授权完成后按回车继续…')

  const { session } = await call('auth.getSession', { token })
  const sk = session?.key
  if (!sk) throw new Error('没拿到 session key')

  console.log(`\n授权成功：${session.name}（session key 已获取）\n`)
  console.log('把下面三个变量填进 **CF Pages 与 Vercel 的环境变量**（本地调试用就写 .env.local）：\n')
  console.log(`  LASTFM_API_KEY=${apiKey}`)
  console.log(`  LASTFM_API_SECRET=${secret}`)
  console.log(`  LASTFM_SESSION_KEY=${sk}`)
  console.log(
    '\n提示：CF 改完环境变量要**重新部署**才生效（Pages 的 Functions 只在新构建里读新值）；' +
      'Vercel 同样需要重新部署。session key 不会过期，除非你主动撤销应用授权。\n',
  )
} catch (e) {
  console.error(`\n失败：${e?.message ?? e}`)
  console.error(
    '若是「Unauthorized token（错误码 14）」，说明浏览器里那步没点成功（或点了取消），重跑一次即可。\n',
  )
  process.exit(1)
}
