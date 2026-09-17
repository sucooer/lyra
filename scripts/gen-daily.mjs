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
 * 输出里只有直链和日期，不放歌名：歌名是 meta.json / emby.json（生成物）的职责，
 * 这个文件只负责「今天是哪几首」。想确认是哪几首看下面的运行日志。
 *
 * 用法：
 *   pnpm daily                     生成今天的
 *   pnpm daily --date 2026-09-18   指定日期（补生成 / 调试）
 *   pnpm daily --size 8            改当天首数
 *   pnpm daily --dry               只打印，不写文件
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
// Node ≥22.18 能直接加载 .ts（只擦类型、不校验），所以这里可以复用前端那份规则
import { buildDaily, dailySubtitle, dateKey } from '../src/lib/daily.ts'
import { isEmbyStreamUrl } from '../src/lib/emby.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLAYLIST_PATH = resolve(ROOT, 'public/playlist.json')
const EMBY_PATH = resolve(ROOT, 'public/emby.json')
const DAILY_PATH = resolve(ROOT, 'public/daily.json')

/** 支持 --date 2026-09-18 与 --date=2026-09-18 两种写法 */
const argv = process.argv.slice(2)
const argVal = (name) => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return undefined
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : argv[argv.indexOf(hit) + 1]
}
const dry = argv.includes('--dry')
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
  info.set(url, { title: typeof src.title === 'string' ? src.title : '', artist: typeof src.artist === 'string' ? src.artist : '' })
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
      info.set(url, { title: meta?.title ?? '', artist: meta?.artist ?? '' })
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

const pick = buildDaily(urls, wantDate, size)

const prevText = existsSync(DAILY_PATH) ? readFileSync(DAILY_PATH, 'utf8') : ''
let prev = null
try {
  prev = JSON.parse(prevText)
} catch {
  /* 旧文件坏了就当作没有 */
}
const sameAsPrev =
  prev?.date === pick.date && JSON.stringify(prev?.urls ?? []) === JSON.stringify(pick.urls)

const out = {
  date: pick.date,
  generatedAt: new Date().toISOString(),
  count: pick.urls.length,
  title: pick.title,
  subtitle: pick.subtitle,
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

if (dry) {
  console.log(`\n--dry：以上是待写入内容，没有改动 ${DAILY_PATH}`)
} else if (sameAsPrev) {
  console.log(`\npublic/daily.json 已经就是这个日期与曲目（保留原 generatedAt），无需改动`)
} else {
  writeFileSync(DAILY_PATH, nextText)
  console.log(`\n已写入 public/daily.json（副标题：${dailySubtitle(pick.date, pick.urls.length)}）`)
}
