/**
 * 生成 public/artists.json：歌手简介 + Apple Music 专辑推荐语。
 *
 * 这是纯「补充资料」，不参与曲库构成 —— 有哪些歌、属于谁仍由 emby.json / meta.json
 * 决定。这里只补两样运行时拿不到的东西：
 *
 *   1. 歌手简介：Last.fm（配了 LASTFM_API_KEY 才用）→ 维基百科中文 → 日文 → 韩文 → 英文。
 *      中文优先（曲库是简体）；日/韩在英文之前 —— 日本/韩国艺人往往只有母语维基有条目，
 *      英文维基要么没有要么词条名是罗马音、正文对不上。正文是日语/韩语就原样留存，
 *      界面照显示（没有合适的机器翻译，宁留原文不硬翻）。
 *      维基先按条目标题精确查，查不到再用全文搜索兜底（舞台名/日文名/带符号的
 *      写法标题对不上，正文搜得到）。
 *      Apple Music 自己的艺人简介已经在 2022 年前后下线了
 *      （music.apple.com/cn/artist/<id>/biography 现在返回「无法找到你所需的页面」，
 *      页面里剩下的 artistBio 只有一个需要鉴权的异步接口，抓不到）。
 *   2. 专辑推荐语：Apple Music 艺人页「代表专辑」区块里每专辑配的一句编辑语，
 *      例如「跨时代 — 没有特异功能拯救世界，唯有追梦的热忱和做自己的真诚。」
 *      艺人页是服务端渲染的（数据在 <script id="serialized-server-data"> 之外，
 *      直接写在 HTML 属性与标签里），所以 Node 这边 fetch 下来正则就能取，
 *      不需要浏览器。
 *
 * 网络全失败也不影响构建：抓不到就沿用已有条目，实在没有就只留曲目聚合信息。
 *
 * 「谁和谁是同一个人」由 src/lib/artists.ts 的 artistKey 决定，这里不自己写一套：
 * 同一人的繁简写法（张韶涵 / 張韶涵）与末尾句点差异（S.E.N.S. / S.E.N.S）合成一条，
 * 联名（「阿悄, 庄心妍 & 王麟」）拆成三位、各人都算上这首联名曲。
 * 产出里的键是 artistKey，name 是该键下出现最多的写法（再统一成简体）。
 *
 * 用法：
 *   pnpm artists             增量生成（30 天内查过且拿到内容的跳过）
 *   pnpm artists --force     全部重抓
 *   pnpm artists --dry       只打印不写文件
 *   pnpm artists --limit 5   只处理前 5 位歌手（试跑）
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadTs } from './load-ts.mjs'

// 只借用「谁和谁是同一个人」的规则与解析辅助，不引 parseArtistsFile：
// 产物要按原始 JSON 读写（它保留 checkedAt / bioVersion），过一遍解析器会把这些丢掉
const { normName, artistKey, splitArtists, simplify } = await loadTs(
  new URL('../src/lib/artists.ts', import.meta.url),
)

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'public', 'artists.json')

/** 查过之后多少天再刷一次 */
const REFRESH_DAYS = 30
/**
 * 简介抓取规则的版本号。改动抓取/清洗逻辑时 +1，存量条目会自动重抓一遍 ——
 * 否则「已经有简介就跳过」的增量判断会让老数据永远停在旧规则上
 * （比如后来才发现中文维基该带 variant=zh-cn，不重抓就一直是那批名字对不上的）。
 */
const BIO_VERSION = 4
/** 单个请求超时：网络不通时别把构建拖死 */
const TIMEOUT = 12000
/** 并发：抓的都是第三方站点，别开太高 */
const JOBS = 2
/**
 * 请求 UA 必须合规：维基媒体基金会的 UA 政策要求「客户端名/版本 (联系方式)」，
 * 缺联系方式、或冒充浏览器（Mozilla/5.0 …）都会被边缘节点直接 403 —— 且是毫秒级返回，
 * 表现成「51 位歌手一秒跑完、全无简介」，很容易误判成网络不通。
 */
const UA = 'lyra-metadata/1.0 (https://github.com/sucooer/lyra)'
/** 同一主机的两次请求至少隔这么久；顺带压一压被第三方风控（406）的概率 */
const MIN_GAP = 250
const lastAt = new Map()
async function throttle(host) {
  const wait = (lastAt.get(host) ?? 0) + MIN_GAP - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastAt.set(host, Date.now())
}

const argv = process.argv.slice(2)
const dry = argv.includes('--dry')
const force = argv.includes('--force')
const limit = Number(argv[argv.indexOf('--limit') + 1]) || 0

/** 真实环境变量优先于 .env.local（CI 里是 secret，本地是文件） */
function loadEnv() {
  const env = { ...process.env }
  const file = path.join(ROOT, '.env.local')
  if (!existsSync(file)) return env
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const i = s.indexOf('=')
    if (i < 0) continue
    const k = s.slice(0, i).trim()
    if (!env[k]) env[k] = s.slice(i + 1).trim()
  }
  return env
}
const env = loadEnv()
const LASTFM_KEY = env.LASTFM_API_KEY || ''

/** 一次超时就说明这台机器到不了该主机，后续直接跳过，省下 50 次干等 */
const hostDown = new Set()

/** 同一台主机只报一次失败原因，避免 51 行刷屏 */
const reported = new Set()
function noteFail(host, msg) {
  if (reported.has(host)) return
  reported.add(host)
  console.log(`  （${host}：${msg}）`)
}

async function get(url, { as = 'text', timeout = TIMEOUT, quiet = false } = {}) {
  let host
  try {
    host = new URL(url).host
  } catch {
    return null
  }
  if (hostDown.has(host)) return null
  await throttle(host)
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(timeout),
      // 维基百科会按 UA 限流，缺 UA 或 UA 不像样的时候直接 403
      headers: { 'user-agent': UA, accept: as === 'json' ? 'application/json' : 'text/html' },
    })
    if (!r.ok) {
      // quiet：404 属于正常结果（该标题在维基上就没有），不必当成故障播报
      if (!quiet) noteFail(host, `HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 80)}`)
      return null
    }
    return as === 'json' ? await r.json() : await r.text()
  } catch (e) {
    // 超时 / 连不上：整台主机拉黑，本机在国内访问维基百科就是这种情况
    const down = e?.name === 'TimeoutError' || e?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT'
    if (down) {
      hostDown.add(host)
      console.log(`  （${host} 连不上，本轮跳过该站点）`)
    }
    return null
  }
}

function stripTags(s) {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

/**
 * 艺人页里各个内容区块的起始位置（<section data-testid="section-container" aria-label="…">）。
 * 区块名不统一：有的艺人是「代表专辑」，有的只有「专辑」，
 * 还有「单曲与 EP」「现场专辑」这类不能当专辑用的，所以要挑一下。
 */
function findSections(html) {
  const marks = []
  for (const m of html.matchAll(
    /data-testid="section-container"[^>]{0,200}?aria-label="([^"]*)"|aria-label="([^"]*)"[^>]{0,200}?data-testid="section-container"/g,
  )) {
    marks.push({ i: m.index, label: m[1] ?? m[2] ?? '' })
  }
  return marks.sort((a, b) => a.i - b.i)
}

function albumSectionScore(label) {
  if (label.includes('代表')) return 3
  if (label === '专辑') return 2
  if (label.includes('专辑') && !label.includes('单曲') && !label.includes('EP')) return 1
  return -1
}

/**
 * 从 Apple Music 艺人页 HTML 里取专辑卡片。
 * 页面是服务端渲染的，专辑名与推荐语分别落在
 * data-testid="product-lockup-title" 与 product-lockup-subtitle 里，
 * 封面在 <source srcset> 中（取最后一个，通常是最大的那张）。
 */
function parseAmAlbums(html) {
  if (!html) return []
  const marks = findSections(html)
  let start = -1
  let end = html.length
  let best = -1
  for (let k = 0; k < marks.length; k++) {
    const s = albumSectionScore(marks[k].label)
    if (s > best) {
      best = s
      start = marks[k].i
      end = marks[k + 1]?.i ?? html.length
    }
  }
  if (best < 0) return []
  const seg = html.slice(start, Math.min(end, start + 200000))
  const out = []
  // 每个专辑卡片以 product-lockup 开头，切块后逐块提取，避免跨块串味
  const blocks = seg.split('data-testid="product-lockup"').slice(1)
  for (const b0 of blocks) {
    const b = b0.slice(0, 8000)
    const t = /<a\b[^>]*data-testid="product-lockup-title"[^>]*>([\s\S]*?)<\/a>/.exec(b)
    if (!t) continue
    const name = stripTags(t[1])
    if (!name) continue
    const href = /href="([^"]+)"/.exec(t[0])?.[1]
    const sub = /data-testid="product-lockup-subtitle"[^>]*>([\s\S]*?)<\/span>/.exec(b)
    // 没有推荐语的专辑，副标题位置会渲染成「2014」「2014年」这类年份，
    // 那不是推荐语，别当成简介存下来
    const rawNote = sub ? stripTags(sub[1]) : ''
    const note = rawNote.length >= 8 && !/^\d{4}\s*年?$/.test(rawNote) ? rawNote : undefined
    const srcset = /srcset="([^"]+)"/.exec(b)?.[1]
    let cover
    if (srcset) {
      const urls = [...srcset.matchAll(/https?:\/\/[^\s,]+/g)].map((m) => m[0])
      if (urls.length) cover = urls[urls.length - 1].replace(/\/\d+x\d+[a-z-]*\.jpg$/, '/600x600bb.jpg')
    }
    out.push({
      name,
      // 推荐语偶尔和专辑名重复（页面把副标题也渲染成名字），此时没意义
      note: note && normName(note) !== normName(name) ? note : undefined,
      cover,
      amUrl: href?.startsWith('http') ? href : undefined,
    })
    if (out.length >= 24) break
  }
  return out
}

/** iTunes 搜索：拿 Apple Music 艺人 id */
async function appleArtistId(name) {
  const j = await get(
    `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=musicArtist&limit=1&country=CN`,
    { as: 'json' },
  )
  const hit = j?.results?.[0]
  if (!hit?.artistId) return null
  return { id: hit.artistId, url: `https://music.apple.com/cn/artist/${hit.artistId}` }
}

/** iTunes lookup：补专辑发行年份与曲目数 */
async function appleAlbums(artistId) {
  const j = await get(
    `https://itunes.apple.com/lookup?id=${artistId}&entity=album&limit=200&country=CN`,
    { as: 'json' },
  )
  const out = new Map()
  for (const r of j?.results ?? []) {
    if (r.wrapperType !== 'collection' || !r.collectionName) continue
    out.set(normName(r.collectionName), {
      year: Number((r.releaseDate || '').slice(0, 4)) || undefined,
      tracks: r.trackCount ?? undefined,
    })
  }
  return out
}

/** Last.fm 简介：summary 是短版且末尾带 Read more 链接，截掉 */
async function lastfmBio(name, lang) {
  if (!LASTFM_KEY) return null
  const j = await get(
    `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(name)}&api_key=${encodeURIComponent(LASTFM_KEY)}&format=json&lang=${lang}`,
    { as: 'json' },
  )
  const bio = j?.artist?.bio?.summary
  if (!bio) return null
  const text = stripTags(bio)
    .replace(/\s*Read more on Last\.fm.*$/i, '')
    .trim()
  if (text.length < 20) return null
  return { bio: text, url: j?.artist?.url }
}

/** 消歧义页不算简介：维基会打 pageprops.disambiguation 标记，正文正则只兜得住英文 */
function isDisambig(p, text) {
  if (p.pageprops?.disambiguation !== undefined) return true
  return /can refer to:|可以指|可能指|消歧義頁|消歧义页|同名人物/.test(text.slice(0, 160))
}

function mkBio(p, text, lang) {
  return { bio: text, url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title)}` }
}

/**
 * 判定「算得上简介」的下限。中文维基有些条目（胡彦斌、周传雄）导言就一两句，
 * 55 字左右但信息准确；定太高会把它们一起丢掉。
 */
const MIN_BIO = 40

/**
 * 从 query.pages 里挑一条能当简介的。
 * generator=search 的结果带 index（相关性排序），精确查询没有，按返回顺序处理。
 * 只有标题能与歌手名对上才算命中 —— 搜索会返回一堆同名或沾边的条目，
 * 不校验就会把「徐良（明朝人物）」的简介安到歌手头上。
 */
function pickBio(j, name, lang) {
  const pages = Object.values(j?.query?.pages ?? {})
  pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
  const want = normName(name)
  let loose = null
  for (const p of pages) {
    if (p.missing !== undefined || !p.extract) continue
    const text = String(p.extract).trim()
    if (text.length < MIN_BIO || isDisambig(p, text)) continue
    const title = normName(p.title)
    if (title === want) {
      // 短名字（如「とた」）标题精确对上了也未必是本人：ko 维基会把「とた」
      // 重定向到「と」这个假名音节页。所以名字 <3 字时再验一道——导言开头得
      // 真的提到这个名字，否则跳过这条候选、继续找，宁可不给简介。
      if (want.length >= 3 || normName(text.slice(0, want.length + 6)).includes(want))
        return mkBio(p, text, lang)
      continue
    }
    // 繁简在 normName 眼里是两个名字（曲库写「胡彦斌」，条目叫「胡彥斌」），
    // 但导言几乎总以本人名字开头，拿它兜一道，免得整个条目被误杀。
    if (normName(text.slice(0, want.length + 4)).includes(want)) return mkBio(p, text, lang)
    // 松匹配只对足够长的名字开放：短名字（如「とた」）会子串撞上单字音节词条
    // （日文维基里「と」= 假名音节），把无关简介安到歌手头上。名字 ≥3 字才允许。
    if (!loose && want.length >= 3 && title.length >= 2 && (title.includes(want) || want.includes(title)))
      loose = mkBio(p, text, lang)
  }
  return loose
}

/**
 * 一次维基查询里各候选被弃用的原因，压成一小段塞进日志。
 * CI 日志是唯一的现场：没有它就只能看到「无简介」，分不清是真没条目、
 * 撞了消歧义页，还是被限流挡了 —— 而这三者的处理方式完全不同。
 */
function whyWiki(j) {
  // API 自己报错时 query 是空的，只看「无返回」会误判成网络问题
  if (j?.error) return `API错误:${j.error.code ?? '?'}`
  const pages = Object.values(j?.query?.pages ?? {})
  if (!pages.length) return '无返回'
  return pages
    .slice(0, 2)
    .map((p) => {
      if (p.missing !== undefined) return `缺:${p.title}`
      if (p.pageprops?.disambiguation !== undefined) return `歧:${p.title}`
      if (!p.extract) return `无摘要:${p.title}`
      // 带上实际长度与开头几个字：分不清「字段为空」和「内容不对」时，只能靠它定位
      const t = String(p.extract).trim()
      return `短${t.length}:${p.title}:${t.slice(0, 16)}`
    })
    .join('/')
}

/**
 * 维基 REST summary 兜底。
 * action API 的 exintro 在部分条目上会给出空/极短的 extract（把候选项列出来，
 * 却一个都够不上简介的下限），REST 端点走另一条渲染路径，且直接给 type 字段 ——
 * disambiguation 一眼可辨，不必靠正文关键词去猜。对繁简重定向也更宽容。
 */
async function restBio(title, lang) {
  const j = await get(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    { as: 'json', quiet: true },
  )
  if (!j || j.type === 'disambiguation' || j.type === 'no-extract') return null
  const text = String(j.extract ?? '').trim()
  if (text.length < MIN_BIO) return null
  return { bio: text, url: j.content_urls?.desktop?.page }
}

/**
 * 维基百科导言。
 * 先按条目标题精确查（redirects=1 既能处理重定向，也能跨繁简，如 Bandari→班得瑞）；
 * 再试 REST summary；最后退回全文搜索 —— 曲库里不少歌手用的是舞台名、日文名或带符号的
 * 写法（「S.E.N.S」「矶村由纪子」「DJ OKAWARI」），标题对不上但正文搜得到。
 */
async function wikiBio(name, lang) {
  const base =
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json` +
    // exlimit=max 不能省：prop=extracts 默认只给 1 个条目生成摘要，
    // 搜索兜底一次返回 5 个候选时，等于只看得到其中一条，命中率忽高忽低。
    '&prop=extracts|pageprops&exintro=1&explaintext=1&exlimit=max&redirects=1&ppprop=disambiguation' +
    // zh 维基加变体转换，让简介正文统一成简体（曲库是简体）。
    // 注意别顺手加 converttitles：它会把请求的标题也做转换，实测会让
    // 「周传雄」这类只有繁体条目的名字整段查不到东西（query 为空）。
    // 标题转不了没关系，条目是否对口改由正文开头判断（见 pickBio）。
    (lang === 'zh' ? '&variant=zh-cn' : '')
  const exact = await get(`${base}&titles=${encodeURIComponent(name)}`, { as: 'json' })
  const hit = pickBio(exact, name, lang)
  if (hit) return hit
  const rest = await restBio(name, lang)
  if (rest) return rest
  const found = await get(`${base}&generator=search&gsrsearch=${encodeURIComponent(name)}&gsrlimit=5`, {
    as: 'json',
  })
  const hit2 = pickBio(found, name, lang)
  return hit2 ?? { diag: `${lang}(${whyWiki(exact)} → ${whyWiki(found)})` }
}

/**
 * 简介长度上限：中文维基的导言动辄几千字（周杰伦那篇近 3000），
 * 51 位全量留存会把 artists.json 撑得很大，页面上也是要折叠起来看的。
 * 按句末截断，不留半句话。
 */
const BIO_MAX = 1200
function clipBio(s) {
  const t = String(s).trim()
  if (t.length <= BIO_MAX) return t
  const head = t.slice(0, BIO_MAX)
  const cut = Math.max(head.lastIndexOf('。'), head.lastIndexOf('\n'), head.lastIndexOf('. '))
  return `${(cut > BIO_MAX * 0.5 ? head.slice(0, cut + 1) : head).trim()}…`
}

async function fetchBio(name) {
  if (NOT_A_PERSON.has(normName(name))) return null
  const diag = []
  let r = null
  if (LASTFM_KEY) {
    r = (await lastfmBio(name, 'zh')) ?? (await lastfmBio(name, 'en'))
    if (r) r = { ...r, source: 'lastfm' }
    else diag.push('lastfm 无')
  }
  for (const lang of ['zh', 'ja', 'ko', 'en']) {
    if (r) break
    const w = await wikiBio(name, lang)
    if (w?.bio) r = { ...w, source: `wikipedia-${lang}` }
    else if (w?.diag) diag.push(w.diag)
  }
  // 没抓到就把原因带回去，日志里能看出是「真没条目」还是「被拦」
  if (!r) return { diag: diag.join(' ') }
  return { ...r, bio: clipBio(r.bio) }
}

/** 并发池 */
async function mapPool(items, size, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        out[idx] = await fn(items[idx], idx)
      }
    }),
  )
  return out
}

// ---------- 1. 汇总曲库里的歌手与专辑 ----------

async function readJson(p, fallback) {
  try {
    return JSON.parse(await readFile(p, 'utf8'))
  } catch {
    return fallback
  }
}

/**
 * 曲库里的「合辑占位名」，不是具体歌手。拿它们去查维基只会撞上无关条目：
 * 「群星」落到同名消歧义页，「Various Artists」被重定向到「Compilation album（合辑）」，
 * 页面上挂着这种"简介"比空着更糟。专辑数据照抓（Apple Music 上 Various Artists
 * 是真实存在的合辑艺人），只是不写简介。
 * 集合里写的是 artistKey（全小写、无标点），比对时也用键。
 */
const NOT_A_PERSON = new Set(['群星', 'variousartists', 'va', '未知艺术家', 'unknownartist'])

/**
 * 曲库里「没写歌手」的占位名：连歌手条目都不必产生
 * （群星 / Various Artists 是有专辑数据的真实条目，所以不在这里）。
 */
const UNKNOWN_ARTIST = new Set(['未知艺术家'].map((n) => artistKey(n)))

/**
 * 汇总曲库里的歌手，一位歌手一条。
 *
 * 键用 artistKey：于是同一人的不同写法会合成一条（张韶涵 72 首 + 張韶涵 37 首 → 一条
 * 109 首；S.E.N.S. 与 S.E.N.S 同理）；「阿悄, 庄心妍 & 王麟」这种联名则拆成三位，
 * 每位都算上这首歌 —— 一个人的歌手页不该漏掉他参与的联名曲。
 *
 * 展示名先 simplify 再计票，取票数最多的那个：于是「容祖兒」261 首与「容祖儿」算作
 * 同一个写法，页面标题不会因为哪个写法恰好更多而在简繁之间来回跳。
 * 注意 splitArtists 帮不上忙 —— 它只在拆联名时保留原文，繁简归一全在 artistKey / simplify。
 */
function collectArtists() {
  const emby = JSON.parse(readFileSync(path.join(ROOT, 'public', 'emby.json'), 'utf8'))
  const meta = JSON.parse(readFileSync(path.join(ROOT, 'public', 'meta.json'), 'utf8'))
  const all = [...Object.values(emby.tracks ?? {}), ...Object.values(meta.tracks ?? {})]

  const map = new Map()
  for (const t of all) {
    for (const part of splitArtists(t.artist || '')) {
      const key = artistKey(part.name)
      if (!key || UNKNOWN_ARTIST.has(key)) continue
      let a = map.get(key)
      if (!a) {
        a = { key, name: simplify(part.name), labels: new Map(), trackCount: 0, albums: new Map() }
        map.set(key, a)
      }
      const label = simplify(part.name)
      a.labels.set(label, (a.labels.get(label) ?? 0) + 1)
      a.trackCount++
      const album = (t.album || '').trim()
      if (!album) continue
      let al = a.albums.get(album)
      if (!al) {
        al = { name: album, trackCount: 0, year: t.year ?? undefined, cover: t.cover ?? undefined }
        a.albums.set(album, al)
      }
      al.trackCount++
      if (!al.year && t.year) al.year = t.year
      if (!al.cover && t.cover) al.cover = t.cover
    }
  }

  for (const a of map.values()) {
    let best = a.name
    let bestN = 0
    for (const [label, n] of a.labels) {
      if (n > bestN) {
        best = label
        bestN = n
      }
    }
    a.name = best
  }
  return { artists: map, total: all.length }
}

// ---------- 2. 主流程 ----------

const { artists: libArtists, total: libTrackCount } = collectArtists()
const prevRaw = await readJson(OUT, null)

/**
 * 上一轮的条目，按**归一键**索引。
 *
 * 三件事都在这里一次做完：
 *   1. 老产物里的键可能还是异写（「容祖兒」「S.E.N.S.」「Various Artists」），
 *      按新键直接查会查不到 → 已经抓到的简介与专辑会被整批重抓；
 *   2. 取的是**原始 JSON** 里那条，而不是 parseArtistsFile 的结果 —— 解析器只认
 *      自己声明的字段，会把 checkedAt / bioVersion 吃掉，于是「查过」变成「没查过」，
 *      整库每轮重抓（实测真的发生过：48 位全部被当成待处理）；
 *   3. 同一人写过好几条时（張韶涵 + 张韶涵）取先出现的，够用。
 */
const prevByKey = new Map()
for (const [oldKey, raw] of Object.entries(prevRaw?.artists ?? {})) {
  const k = artistKey(oldKey) || artistKey(raw?.name ?? '')
  if (k && !prevByKey.has(k)) prevByKey.set(k, raw)
}
const prevOf = (key) => prevByKey.get(key)

const now = Date.now()
/** 上一次查这个歌手是什么时候 */
function ageOf(key) {
  const at = prevOf(key)?.checkedAt
  return at ? (now - Date.parse(at)) / 86400000 : Infinity
}
/** 上一次抓简介用的是哪版规则 */
function bioVerOf(key) {
  return prevOf(key)?.bioVersion ?? 0
}

const target = [...libArtists.values()].filter((a) => {
  const p = prevOf(a.key)
  if (force || !p) return true
  // 简介与专辑分别判断：已经有专辑数据的歌手如果因为「有内容」被整体跳过，
  // 那第一次没抓到简介就永远补不上了（在本地跑的时候必然抓不到维基百科）。
  // bioVersion 对不上说明抓取规则更新过，也要重抓一次。
  return (
    !p.bio || !p.albums?.length || ageOf(a.key) > REFRESH_DAYS || bioVerOf(a.key) !== BIO_VERSION
  )
})
const todo = limit ? target.slice(0, limit) : target

console.log(
  `曲库 ${libTrackCount} 首 / ${libArtists.size} 位歌手（联名曲两边都算）；` +
    `待处理 ${todo.length} 位${todo.length < target.length ? `（--limit ${limit}）` : ''}`,
)
if (!LASTFM_KEY) {
  console.log(
    'LASTFM_API_KEY 未配置：简介改走维基百科。国内网络到不了 wikipedia.org（本机跑必然拿不到），' +
      'CI 上可以；想在本机补简介就配一个 Last.fm key（免费申请）。',
  )
}

const results = await mapPool(todo, JOBS, async (a) => {
  const old = prevOf(a.key)
  // 从旧条目起手：这次不重抓的字段自然沿用旧值
  const info = {
    name: a.name,
    trackCount: a.trackCount,
    albums: old?.albums ?? [],
    bio: old?.bio,
    bioSource: old?.bioSource,
    bioUrl: old?.bioUrl,
    bioVersion: old?.bioVersion,
    amId: old?.amId,
    amUrl: old?.amUrl,
  }
  // 合辑占位名：上一轮可能已经撞到了消歧义页/无关重定向，继承下来的错误简介要主动清掉
  if (NOT_A_PERSON.has(a.key)) {
    info.bio = undefined
    info.bioSource = undefined
    info.bioUrl = undefined
  }
  const wantAlbums = force || !info.albums?.length || ageOf(a.key) > REFRESH_DAYS
  const wantBio = force || !info.bio || bioVerOf(a.key) !== BIO_VERSION

  if (wantAlbums) {
    const am = await appleArtistId(a.name)
    if (am) {
      info.amId = am.id
      info.amUrl = am.url
      const html = await get(am.url, { timeout: 20000 })
      const albums = parseAmAlbums(html)
      if (albums.length) {
        const years = await appleAlbums(am.id)
        info.albums = albums.map((al) => {
          const extra = years.get(normName(al.name))
          return { ...al, year: extra?.year }
        })
      }
    }
  }

  let diag = ''
  if (wantBio) {
    const bio = await fetchBio(a.name)
    if (bio?.bio) {
      info.bio = bio.bio
      info.bioSource = bio.source
      info.bioUrl = bio.url
      // 只有真抓到才记版本号：这一轮失败的话下次还得再试，
      // 否则「规则升级后重抓」的机会一次就被用掉了
      info.bioVersion = BIO_VERSION
    } else {
      diag = bio?.diag ?? ''
    }
  }

  const mark = info.bio ? `简介 ${info.bioSource ?? ''}` : `无简介${diag ? `（${diag}）` : ''}`
  console.log(
    `  ${a.name.padEnd(18)} ${mark.padEnd(18)} 专辑 ${String(info.albums?.length ?? 0).padStart(2)} 张`,
  )
  return [a.key, info]
})

// 合并：一律**按曲库里的歌手逐位重建**，于是产出的键集合与曲库一一对应。
// 直接遍历旧文件的键是不行的：老产物里的异写键（「張韶涵」「郭靜」）会被当成
// 「曲库里没这个人」而在清理时删掉 —— 而它们偏偏是这轮不用重抓（有简介、没过期）的那些，
// 一删就是整条记录消失。改成按新键重建后，老键自然被改写到新键上。
const freshByKey = new Map(results)
const merged = {}
for (const a of libArtists.values()) {
  const fresh = freshByKey.get(a.key)
  // 没查的沿用上一轮（prevOf 会按归一键找回老键下的那条）。
  // 注意用**原始 JSON** 里的那条，而不是 parseArtistsFile 的结果：
  // 解析器只认自己声明的字段，会把 checkedAt / bioVersion 吃掉，
  // 于是「这轮跳过的歌手下轮又被当成没查过」，整库反复重抓。
  const hit = fresh ?? prevOf(a.key)
  if (!hit) continue
  merged[a.key] = { ...hit, name: a.name, trackCount: a.trackCount }
  if (fresh) merged[a.key].checkedAt = new Date().toISOString()
}

const out = { generatedAt: new Date().toISOString(), artists: merged }

if (dry) {
  console.log('\n--dry：不写文件。示例：')
  console.log(JSON.stringify(results.slice(0, 2).map(([, info]) => info), null, 1).slice(0, 1200))
} else {
  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(out))
  const withBio = Object.values(merged).filter((a) => a.bio).length
  const withAlbums = Object.values(merged).filter((a) => a.albums?.length).length
  console.log(
    `\n完成：artists.json 共 ${Object.keys(merged).length} 位歌手（有简介 ${withBio} 位、有专辑推荐语 ${withAlbums} 位）`,
  )
}
