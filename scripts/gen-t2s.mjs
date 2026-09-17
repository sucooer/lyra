/**
 * 生成 src/lib/t2s.ts（繁体 → 简体 单字表）。
 *
 * 为什么需要它：曲库里的歌手名写法不统一（同一批歌里既有「张韶涵」也有「張韶涵」，
 * 既有「容祖兒」也有排成简体的），分类到歌手页时得把它们认成同一个人。
 * 运行时（浏览器）也要算这个归一结果，所以表必须能进前端包 —— 公开的表里
 * OpenCC 的 TSCharacters.txt 是单字级、体积最小、许可也最宽松的那个。
 *
 * 用法：
 *   pnpm t2s            重新拉取上游并覆盖 src/lib/t2s.ts
 *
 * 依赖本机的 gh CLI（已登录即可，不用 token）：上游在 GitHub 上，
 * 直连 raw.githubusercontent.com 在本机不通，而 api.github.com 是通的。
 */
import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

const UPSTREAM = 'BYVoid/OpenCC'
const FILE = 'data/dictionary/TSCharacters.txt'
const OUT = path.resolve(import.meta.dirname, '..', 'src', 'lib', 't2s.ts')
/** 每行放多少个字，纯为可读性；改它不影响结果 */
const WRAP = 100

function fetchUpstream() {
  let raw
  try {
    raw = execFileSync(
      'gh',
      // 不传 --jq：Windows 上 shell 会把 `{sha, content}` 拆成两个参数
      ['api', `repos/${UPSTREAM}/contents/${FILE}`],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, shell: process.platform === 'win32' },
    )
  } catch (e) {
    throw new Error(`拉取上游失败（需要本机 gh CLI 可用）：${e.message}`)
  }
  const j = JSON.parse(raw)
  return { sha: j.sha, text: Buffer.from(j.content, 'base64').toString('utf8') }
}

const { sha, text } = fetchUpstream()

const from = []
const to = []
let total = 0
for (const line of text.split('\n')) {
  const s = line.trim()
  if (!s || s.startsWith('#')) continue
  total++
  const [trad, ...cands] = s.split(/\s+/)
  // 只收单 UTF-16 单元的字：表是「两张等长字符串按位对应」，代理对（𫝈 这类）会串位
  if (trad.length !== 1) continue
  const simp = cands[0]
  // 恒等映射占掉近两成体积，查表时落空也一样是原字，直接不要
  if (!simp || simp === trad || simp.length !== 1) continue
  from.push(trad)
  to.push(simp)
}

const wrap = (s) =>
  s
    .match(new RegExp(`.{1,${WRAP}}`, 'g'))
    .map((seg) => `  '${seg.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`)
    .join(' +\n')

const out = `/**
 * 繁体 → 简体 单字对照表。**生成文件，勿手改** —— 改表请改 scripts/gen-t2s.mjs 后重跑。
 *
 * 来源：OpenCC（Apache-2.0）的 ${FILE}
 * 上游版本：${sha}
 * 原始条目 ${total} 条，这里保留 ${from.length} 条（去掉非单字、恒等映射与代理对）。
 *
 * 为什么用两张字符串而不是对象字面量：体积就是一切。
 * 写成 \`{ 張: '张', … }\` 约 90KB，两张等长字符串只要 ${(Buffer.byteLength(from.join('')) + Buffer.byteLength(to.join(''))) / 1024 | 0}KB（gzip 后约 7KB），
 * 代价只是模块加载时建一次 Map（见 lib/artists.ts 的 simplify）。
 *
 * 注意是「单字」表，没有词语级规则：人名基本不会踩到一简对多繁的语境歧义
 * （表里 \`著\` 这类两体同形的字本来也不在其中）。
 */

/** 繁 → 简：T2S_FROM[i] 对应 T2S_TO[i]，两张表等长 */
export const T2S_FROM =
${wrap(from.join(''))}

export const T2S_TO =
${wrap(to.join(''))}
`

await writeFile(OUT, out, 'utf8')
console.log(`已写入 ${path.relative(process.cwd(), OUT)}：${from.length} 条映射，上游 ${sha.slice(0, 8)}`)
