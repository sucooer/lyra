/**
 * 生成 public/artists.json：歌手简介 + Apple Music 专辑推荐语。
 *
 * 这是纯「补充资料」，不参与曲库构成 —— 有哪些歌、属于谁仍由 emby.json / meta.json
 * 决定。这里只补两样运行时拿不到的东西：
 *
 *   1. 歌手简介：Last.fm（配了 LASTFM_API_KEY 才用）→ 维基百科中文 → 英文。
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

const { parseArtistsFile, normName } = await loadTs(new URL('../src/lib/artists.ts', import.meta.url))

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'public', 'artists.json')

/** 查过之后多少天再刷一次 */
const REFRESH_DAYS = 30
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

async function get(url, { as = 'text', timeout = TIMEOUT } = {}) {
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
      noteFail(host, `HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 80)}`)
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

/** 维基百科导言：redirects=1 能把「Bandari」带到「班得瑞」 */
async function wikiBio(name, lang) {
  const j = await get(
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=1&explaintext=1&redirects=1&titles=${encodeURIComponent(name)}`,
    { as: 'json' },
  )
  const pages = j?.query?.pages ?? {}
  for (const p of Object.values(pages)) {
    if (p.missing !== undefined || !p.extract) continue
    const text = String(p.extract).trim()
    // 消歧义页（「Bandari can refer to:」）不算简介
    if (text.length < 60 || /can refer to:/i.test(text)) continue
    return {
      bio: text,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
    }
  }
  return null
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
  let r = null
  if (LASTFM_KEY) {
    r = (await lastfmBio(name, 'zh')) ?? (await lastfmBio(name, 'en'))
    if (r) r = { ...r, source: 'lastfm' }
  }
  if (!r) {
    const w = await wikiBio(name, 'zh')
    if (w) r = { ...w, source: 'wikipedia-zh' }
  }
  if (!r) {
    const e = await wikiBio(name, 'en')
    if (e) r = { ...e, source: 'wikipedia-en' }
  }
  return r ? { ...r, bio: clipBio(r.bio) } : null
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

function collectArtists() {
  const emby = JSON.parse(readFileSync(path.join(ROOT, 'public', 'emby.json'), 'utf8'))
  const meta = JSON.parse(readFileSync(path.join(ROOT, 'public', 'meta.json'), 'utf8'))
  const all = [...Object.values(emby.tracks ?? {}), ...Object.values(meta.tracks ?? {})]

  const map = new Map()
  for (const t of all) {
    const artist = (t.artist || '').trim()
    if (!artist || artist === '未知艺术家') continue
    let a = map.get(artist)
    if (!a) {
      a = { name: artist, trackCount: 0, albums: new Map() }
      map.set(artist, a)
    }
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
  return map
}

// ---------- 2. 主流程 ----------

const libArtists = collectArtists()
const prevRaw = await readJson(OUT, null)
const prev = parseArtistsFile(prevRaw)
/** 上一次查这个歌手是什么时候（parseArtistsFile 不保留 checkedAt，从原始 JSON 取） */
function ageOf(name) {
  const at = prevRaw?.artists?.[name]?.checkedAt
  return at ? (now - Date.parse(at)) / 86400000 : Infinity
}

const now = Date.now()
const target = [...libArtists.values()].filter((a) => {
  const p = prev.artists[a.name]
  if (force || !p) return true
  // 简介与专辑分别判断：已经有专辑数据的歌手如果因为「有内容」被整体跳过，
  // 那第一次没抓到简介就永远补不上了（在本地跑的时候必然抓不到维基百科）
  return !p.bio || !p.albums?.length || ageOf(a.name) > REFRESH_DAYS
})
const todo = limit ? target.slice(0, limit) : target

console.log(
  `曲库 ${[...libArtists.values()].reduce((n, a) => n + a.trackCount, 0)} 首 / ${libArtists.size} 位歌手；` +
    `待处理 ${todo.length} 位${todo.length < target.length ? `（--limit ${limit}）` : ''}`,
)
if (!LASTFM_KEY) {
  console.log(
    'LASTFM_API_KEY 未配置：简介改走维基百科。国内网络到不了 wikipedia.org（本机跑必然拿不到），' +
      'CI 上可以；想在本机补简介就配一个 Last.fm key（免费申请）。',
  )
}

const results = await mapPool(todo, JOBS, async (a) => {
  const old = prev.artists[a.name]
  // 从旧条目起手：这次不重抓的字段自然沿用旧值
  const info = {
    name: a.name,
    trackCount: a.trackCount,
    albums: old?.albums ?? [],
    bio: old?.bio,
    bioSource: old?.bioSource,
    bioUrl: old?.bioUrl,
    amId: old?.amId,
    amUrl: old?.amUrl,
  }
  const wantAlbums = force || !info.albums?.length || ageOf(a.name) > REFRESH_DAYS
  const wantBio = force || !info.bio

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

  if (wantBio) {
    const bio = await fetchBio(a.name)
    if (bio) {
      info.bio = bio.bio
      info.bioSource = bio.source
      info.bioUrl = bio.url
    }
  }

  const mark = info.bio ? `简介 ${info.bioSource ?? ''}` : '无简介'
  console.log(
    `  ${a.name.padEnd(18)} ${mark.padEnd(18)} 专辑 ${String(info.albums?.length ?? 0).padStart(2)} 张`,
  )
  return info
})

// 合并：新结果 + 旧条目里这次没动的
const merged = {}
for (const [name, info] of Object.entries(prev.artists)) merged[name] = { ...info }
for (const info of results) {
  merged[info.name] = { ...info, checkedAt: new Date().toISOString() }
}
// 曲库里已不存在的歌手不再保留
for (const name of Object.keys(merged)) {
  if (!libArtists.has(name)) delete merged[name]
}

const out = { generatedAt: new Date().toISOString(), artists: merged }

if (dry) {
  console.log('\n--dry：不写文件。示例：')
  console.log(JSON.stringify(results.slice(0, 2), null, 1).slice(0, 1200))
} else {
  await mkdir(path.dirname(OUT), { recursive: true })
  await writeFile(OUT, JSON.stringify(out))
  const withBio = Object.values(merged).filter((a) => a.bio).length
  const withAlbums = Object.values(merged).filter((a) => a.albums?.length).length
  console.log(
    `\n完成：artists.json 共 ${Object.keys(merged).length} 位歌手（有简介 ${withBio} 位、有专辑推荐语 ${withAlbums} 位）`,
  )
}
