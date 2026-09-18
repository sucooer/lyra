/**
 * Last.fm 服务端核心的自测：`pnpm lastfm:selftest`
 *
 * 为什么要留着它：签名用的 md5 是**手写实现**（CF Workers 与 Node 的 WebCrypto 对 MD5
 * 支持不一致，按平台分叉更容易出错），而签名错了的表现是 Last.fm 静默拒绝 —— 光看
 * 「没记录」根本查不出原因。这里用官方测试向量 + 与 node:crypto 大量对照把它钉死。
 * 不发任何真实请求，纯本地。
 */
import { createHash } from 'node:crypto'
import { md5Hex, signParams, runAction, authUrl } from '../functions/_lib/lastfm.js'

const ref = (s) => createHash('md5').update(s, 'utf8').digest('hex')

// ① 官方测试向量
const vectors = [
  ['', 'd41d8cd98f00b204e9800998ecf8427e'],
  ['abc', '900150983cd24fb0d6963f7d28e17f72'],
  ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
  ['The quick brown fox jumps over the lazy dog', '9e107d9d372bb6826bd81d3542a419d6'],
]
let ok = true
for (const [input, want] of vectors) {
  const got = md5Hex(input)
  const pass = got === want
  ok = ok && pass
  console.log(`  向量 ${JSON.stringify(input).slice(0, 30)} → ${got} ${pass ? '✓' : '✗ 期望 ' + want}`)
}

// ② 与 node:crypto 大规模对照（含多块 / 边界长度 / UTF-8 中文 emoji）
const cases = []
for (const n of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000]) cases.push('a'.repeat(n))
cases.push('中文测试', '🎵 日本語と中文 mixed', 'artist=磯村由紀子&track=風の住む街', 'x'.repeat(64) + '中')
let mismatch = 0
for (const c of cases) if (md5Hex(c) !== ref(c)) { mismatch++; console.log('  ✗ 不一致:', JSON.stringify(c).slice(0, 40)) }
console.log(`  与 node:crypto 对照 ${cases.length} 例 → ${mismatch === 0 ? '全部一致 ✓' : mismatch + ' 例不一致 ✗'}`)
ok = ok && mismatch === 0

// ③ 签名：按 Last.fm 规则手算一遍对照
const secret = 's3cr3t'
const params = { artist: '磯村由紀子', track: '風の住む街', timestamp: '1700000000', api_key: 'k', sk: 's', method: 'track.scrobble' }
const manual = ref(
  Object.keys(params).sort().map((k) => k + params[k]).join('') + secret,
)
const got = signParams(params, secret)
console.log(`  签名 手算=${manual} 实现=${got} ${manual === got ? '✓' : '✗'}`)
ok = ok && manual === got

// ④ 未授权时的行为：请求里没带 sk → 401（提示去网页上连接）
const r = await runAction({}, { action: 'scrobble', scrobbles: [{ artist: 'a', track: 't', timestamp: 1 }] })
console.log(`  未授权（没带 sk）→ HTTP ${r.status} / ${String(r.json.error).slice(0, 30)} ${r.status === 401 ? '✓' : '✗'}`)
ok = ok && r.status === 401

// ⑤ 带了 sk 但服务端没配 key/secret → 502 且说明缺什么
const r5 = await runAction({}, { action: 'scrobble', sk: 'x', scrobbles: [{ artist: 'a', track: 't', timestamp: 1 }] })
console.log(`  未配置 key/secret → HTTP ${r5.status} / ${String(r5.json.error).slice(0, 30)} ${r5.status === 502 && /未配置/.test(r5.json.error) ? '✓' : '✗'}`)
ok = ok && r5.status === 502 && /未配置/.test(r5.json.error)

// ⑥ service 端兜底：环境变量里有 LASTFM_SESSION_KEY 时，请求不带 sk 也能走
const r6 = await runAction({ LASTFM_API_KEY: 'k', LASTFM_API_SECRET: 's', LASTFM_SESSION_KEY: 'sk-from-env' }, { action: 'xx' })
console.log(`  环境变量兜底 sk → 走到 action 校验（400）而非 401 ${r6.status === 400 ? '✓' : '✗'}`)
ok = ok && r6.status === 400

// ⑦ 授权地址：必须带 api_key 与回到本站的 cb
const u1 = authUrl({ LASTFM_API_KEY: 'KEY123' }, 'https://lyra.example.com')
const u2 = authUrl({}, 'https://lyra.example.com')
const u3 = authUrl({ LASTFM_API_KEY: 'KEY123' }, 'not-a-url')
const uOk =
  !!u1 &&
  u1.includes('api_key=KEY123') &&
  u1.includes(encodeURIComponent('https://lyra.example.com/api/lastfm/callback')) &&
  u2 === null &&
  u3 === null
console.log(`  授权地址拼装（含 cb、缺 key/非法 origin 时返回 null）→ ${uOk ? '✓' : '✗'} ${u1}`)
ok = ok && uOk

// ⑧ 入参校验
const r2 = await runAction({}, { action: 'scrobble', sk: 'x', scrobbles: [{ artist: '', track: '' }] })
console.log(`  非法入参 → HTTP ${r2.status} ${r2.status === 400 ? '✓' : '✗'}`)
const r3 = await runAction({}, { action: '???', sk: 'x' })
console.log(`  未知 action → HTTP ${r3.status} ${r3.status === 400 ? '✓' : '✗'}`)
ok = ok && r2.status === 400 && r3.status === 400

console.log(ok ? '\n✅ 服务端核心全部通过' : '\n❌ 有失败项')
process.exit(ok ? 0 : 1)
