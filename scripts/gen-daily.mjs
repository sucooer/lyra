#!/usr/bin/env node
/**
 * 生成 public/daily.json —— 当天的「每日推荐」曲目清单。
 *
 * 由 .github/workflows/daily.yml 每天 0 点（北京时间）跑一次并提交，
 * 部署平台收到这个提交会重新构建，于是首页的「每日推荐」每天自动换一批歌。
 *
 * 选歌规则不在这里，而在 src/lib/daily.ts：那份代码同时被前端引用，
 * 两边用同一套规则，所以即使这个脚本没跑成（cron 挂了、或本地没跑过），
 * 页面打开时也会就地算出完全一样的一份，不会出现「今天没有推荐」。
 *
 * 输出里只有日期、直链与一段推荐语，不放整份曲目清单：歌名是 meta.json / emby.json
 * （生成物）的职责，这个文件只负责「今天是哪几首、为什么是这几首」。想确认是哪几首看
 * 下面的运行日志。
 *
 * 推荐语有两条路，写进 daily.json 的字段都是 blurb：
 *   1. **模板**（src/lib/blurb.ts 的 buildDailyBlurb）—— 从当天曲目的元数据算出来，纯函数，
 *      前端在产物缺失或过期时也现算同一份，所以这条路永远可用、永远一致。
 *   2. **模型**（配了 AI_API_KEY 才走）—— 事实清单由同一个 blurbFacts() 给出，只是措辞交给
 *      模型写成文艺随笔。调用失败、返回空、长度离谱时一律退回模板，不会让当天的产物开天窗。
 *   产物里另记一个 blurbFrom: 'ai' | 'template'，方便回头查某天的文案是谁写的。
 *
 * 用法：
 *   pnpm daily                     生成今天的
 *   pnpm daily --date 2026-09-18   指定日期（补生成 / 调试）
 *   pnpm daily --size 8            改当天首数
 *   pnpm daily --no-ai             强制用模板文案（不调模型、不花额度）
 *   pnpm daily --dry               只打印，不写文件
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTs } from './load-ts.mjs'
import { loadEnv } from './lib/env.mjs'
import { aiConfig, chat } from './lib/ai.mjs'
import { BLURB_SYSTEM, buildBlurbUser } from './lib/blurb-prompt.mjs'

// 复用前端那份规则（buildDaily / isEmbyStreamUrl 都是浏览器与脚本共用的纯函数）。
// 不能直接 `import '../src/lib/*.ts'`：Node 的类型擦除要 >= 22.18 才默认开启，
// Cloudflare Pages 的构建镜像是 22.16，直接 import 会让构建挂掉。详见 load-ts.mjs。
const { buildDaily, dailySubtitle, dateKey } = await loadTs(
  new URL('../src/lib/daily.ts', import.meta.url),
)
const { isEmbyStreamUrl } = await loadTs(new URL('../src/lib/emby.ts', import.meta.url))
// 事实与文本整理：与模板路同一个 blurbFacts()，两边才不会对「谁是出场最多的歌手」各说各话
const { blurbFacts, tidyBlurb, artistDisplay } = await loadTs(
  new URL('../src/lib/blurb.ts', import.meta.url),
)

/**
 * 模型文案的长度闸门。提示词里要求 60~120 字；这里放宽到区间外一截再拒，
 * 宁可退回模板，也不把一篇长文塞进歌单标题下面（那段位置最多容三行）。
 */
const BLURB_MIN = 30
const BLURB_MAX = 220

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLAYLIST_PATH = resolve(ROOT, 'public/playlist.json')
const META_PATH = resolve(ROOT, 'public/meta.json')
const EMBY_PATH = resolve(ROOT, 'public/emby.json')
const ARTISTS_PATH = resolve(ROOT, 'public/artists.json')
const DAILY_PATH = resolve(ROOT, 'public/daily.json')

// 模型配置：密钥只从环境变量 / .env.local 读（CI 是仓库 secret），没配就等于没启用。
// 与 EMBY_* / LASTFM_* 同一套规矩 —— 缺了不是错误，只是退回模板文案。
const env = loadEnv(ROOT)
const ai = aiConfig(env)

/** 支持 --date 2026-09-18 与 --date=2026-09-18 两种写法 */
const argv = process.argv.slice(2)
const argVal = (name) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return undefined
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : argv[argv.indexOf(hit) + 1]
}
const dry = argv.includes('--dry')
/** 强制走模板：想让某天就用模板文案，或者不想再花额度时用 */
const noAi = argv.includes('--no-ai')
const wantDate = argVal('date') ?? dateKey()
// 不给 --size 就走 lib/daily.ts 的自适应默认（上限 30 首、且不超过曲库一半）
const sizeArg = argVal('size')
const size = sizeArg ? Math.max(1, Math.floor(Number(sizeArg)) || 1) : undefined

if (!/^\d{4}-\d{2}-\d{2}$/.test(wantDate)) {
  console.error(`日期格式应为 YYYY-MM-DD，收到：${wantDate}`)
  process.exit(1)
}
if (!existsSync(PLAYLIST_PATH)) {
  console.error(`找不到 ${PLAYLIST_PATH}`)
  process.exit(1)
}

/**
 * 与前端 store 一致的元数据视图：先 meta.json，再让 emby.json 覆盖（同名直链以 Emby 为准），
 * 最后叠 playlist.json 的人工覆写。推荐语只从这里取材 —— 前端走的是 store 里同一份合并结果。
 */
let cachedMeta = {}
if (existsSync(META_PATH)) {
  try {
    cachedMeta = JSON.parse(readFileSync(META_PATH, 'utf8'))?.tracks ?? {}
  } catch {
    console.error('public/meta.json 解析失败，本次的推荐语会缺年份/专辑等字段')
  }
}

/** 与前端 lib/playlist.ts 的 parsePlaylist 保持同一套取舍：字符串或对象写法、只认 http(s)、按首次出现去重 */
const raw = JSON.parse(readFileSync(PLAYLIST_PATH, 'utf8'))
if (!Array.isArray(raw)) {
  console.error('playlist.json 顶层必须是数组')
  process.exit(1)
}
const urls = []
const info = new Map()
for (const item of raw) {
  const src = typeof item === 'string' ? { url: item } : item
  const url = typeof src?.url === 'string' ? src.url.trim() : ''
  if (!url || !/^https?:\/\//i.test(url) || info.has(url)) continue
  const c = cachedMeta[url] ?? {}
  info.set(url, {
    // 人工覆写优先（前端 applyOverride 也是这个次序）
    title: typeof src.title === 'string' && src.title ? src.title : (c.title ?? ''),
    artist: typeof src.artist === 'string' && src.artist ? src.artist : (c.artist ?? ''),
    album: typeof src.album === 'string' && src.album ? src.album : c.album,
    year: c.year,
    duration: c.duration,
  })
  urls.push(url)
}
const manualCount = urls.length

/**
 * 把 Emby 曲库（public/emby.json，由 `pnpm emby` 生成）也并进来。
 *
 * 顺序必须与前端 store 装载时一致：手工曲库在前、Emby 在后、按直链去重取先出现的。
 * 否则这里预生成的清单会和前端现算的那份不是同一批歌 —— 而两者本该逐字一致
 * （见 lib/daily.ts 开头）。emby.json 不存在时只是没有这部分，不算错误。
 */
let embyCount = 0
if (existsSync(EMBY_PATH)) {
  try {
    const emby = JSON.parse(readFileSync(EMBY_PATH, 'utf8'))
    for (const [url, meta] of Object.entries(emby?.tracks ?? {})) {
      if (!isEmbyStreamUrl(url) || info.has(url)) continue
      info.set(url, {
        title: meta?.title ?? '',
        artist: meta?.artist ?? '',
        album: meta?.album,
        year: meta?.year,
        duration: meta?.duration,
      })
      urls.push(url)
      embyCount++
    }
  } catch {
    console.error('public/emby.json 解析失败，本次只用手工曲库')
  }
}

if (urls.length === 0) {
  console.error('曲库是空的，先去 public/playlist.json 里加歌')
  process.exit(1)
}

// 歌手展示名：与前端 store 的 artistLabel 同一个来源（artists.json 的 name 字段，已是简体）
let artistNames = {}
if (existsSync(ARTISTS_PATH)) {
  try {
    artistNames = JSON.parse(readFileSync(ARTISTS_PATH, 'utf8'))?.artists ?? {}
  } catch {
    /* 产物缺失时退回到「当天出现最多的写法」，不影响选歌 */
  }
}

const labelOf = (k) => artistNames[k]?.name

const pick = buildDaily(urls, wantDate, size, {
  metaOf: (u) => info.get(u),
  labelOf,
})

// —— 可选的一步：让模型把模板文案重写成文艺随笔 ——
// 只在配了密钥且没加 --no-ai 时走。任何失败都只是「少了一次改写」，不影响当天产物。
let blurb = pick.blurb
let blurbFrom = 'template'
if (!ai.enabled) {
  console.log(`推荐语用模板生成（未启用模型：${ai.reason}）`)
} else if (noAi) {
  console.log('推荐语用模板生成（--no-ai）')
} else {
  const items = pick.urls.map((u) => {
    const m = info.get(u) ?? {}
    // 歌手名过一遍归一（曲库里繁简混写），曲名与专辑名照原样 —— 与界面显示一致
    return { title: m.title, artist: artistDisplay(m.artist), album: m.album, year: m.year }
  })
  // 事实清单与模板路同源，模型的「出场最多的歌手」不会和模板数出两个答案
  const facts = blurbFacts(items, { labelOf })
  console.log(`\n调用模型 ${ai.model}（${ai.baseUrl}）生成推荐语…`)
  const r = await chat(ai, {
    system: BLURB_SYSTEM,
    user: buildBlurbUser({ date: pick.date, items, facts }),
  })
  const text = tidyBlurb(r.text)
  if (!r.text) {
    console.log(`模型调用失败：${r.error} → 退回模板文案`)
  } else if (text.length < BLURB_MIN || text.length > BLURB_MAX) {
    console.log(
      `模型返回 ${text.length} 字，超出 ${BLURB_MIN}~${BLURB_MAX} 字的范围 → 退回模板文案`,
    )
  } else {
    blurb = text
    blurbFrom = 'ai'
    console.log(`模型返回 ${text.length} 字，用时 ${(r.ms / 1000).toFixed(1)}s`)
  }
}

const prevText = existsSync(DAILY_PATH) ? readFileSync(DAILY_PATH, 'utf8') : ''
let prev = null
try {
  prev = JSON.parse(prevText)
} catch {
  /* 旧文件坏了就当作没有 */
}
// 文案也要比：曲目没变但文案生成规则改了时，同样需要落盘。
// 模型文案每天都不同，所以开了模型之后这里基本天天为假 —— 那正是想要的效果。
const sameAsPrev =
  prev?.date === pick.date &&
  JSON.stringify(prev?.urls ?? []) === JSON.stringify(pick.urls) &&
  (prev?.blurb ?? '') === blurb

const out = {
  date: pick.date,
  generatedAt: new Date().toISOString(),
  count: pick.urls.length,
  title: pick.title,
  subtitle: pick.subtitle,
  blurb,
  /** 这段文案是模型写的还是模板算的，回头排查「某天文案怎么这么平」时用 */
  blurbFrom,
  urls: pick.urls,
}
const nextText = JSON.stringify(out, null, 2) + '\n'

console.log(`每日推荐 · ${pick.date}${pick.date === dateKey() ? '' : '（指定的日期，不是今天）'}`)
console.log(
  `曲库 ${urls.length} 首（手工 ${manualCount}${embyCount ? ` + Emby ${embyCount}` : ''}），` +
    `取 ${pick.urls.length} 首${size ? '' : '（默认上限 30 首、不超过曲库一半）'}：`,
)
for (const [i, u] of pick.urls.entries()) {
  const m = info.get(u) ?? {}
  const bits = [m.artist].filter(Boolean).join(' · ')
  console.log(`  ${String(i + 1).padStart(3)}. ${m.title || '（未知 · 还没跑过 pnpm label）'}${bits ? `  —  ${bits}` : ''}`)
}

console.log(`\n推荐语（${blurbFrom === 'ai' ? '模型' : '模板'}）：${blurb || '（数据不足，这次没有文案）'}`)

if (dry) {
  console.log(`\n--dry：以上是待写入内容，没有改动 ${DAILY_PATH}`)
} else if (sameAsPrev) {
  console.log(`\npublic/daily.json 已经就是这个日期、曲目与文案（保留原 generatedAt），无需改动`)
} else {
  writeFileSync(DAILY_PATH, nextText)
  console.log(`\n已写入 public/daily.json（副标题：${dailySubtitle(pick.date, pick.urls.length)}）`)
}
