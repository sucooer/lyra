#!/usr/bin/env node
/**
 * 把音频里解析出来的歌名回填进 public/playlist.json，让源文件自己可读。
 *
 * 为什么需要它：
 *   playlist.json 是「曲库里有哪些歌」的唯一真相源，但远程直链多半是随机 token
 *   （Pks0olqo.flac），光看链接认不出是哪首歌；而能认出歌的 meta.json 是生成物、
 *   不入库。结果就是往源文件里加歌只能靠记忆，写错了也看不出来。
 *
 * 这个脚本拿 gen-meta 的产物 meta.json，把歌名补进 playlist.json 的对象写法：
 *   改前  "https://.../Pks0olqo.flac"
 *   改后  { "url": "https://.../Pks0olqo.flac", "title": "知足", "artist": "五月天" }
 *
 * 三条原则：
 *   1. 只补不改 —— 文件里已有的人工值一律保留，不会被音频 tag 覆盖。
 *      音频 tag 后来被修正的情况用 --force 显式刷新。
 *   2. 保持顺序 —— 条目顺序就是播放顺序，绝不重排。
 *   3. 无需改动就不碰文件 —— 否则每跑一次都多出一堆无意义的 diff。
 *
 * 用法：
 *   pnpm label            补 title + artist（最常用的两个）
 *   pnpm label --album    连 album 也写进去
 *   pnpm label --force    用音频里的值刷新已有字段
 *   pnpm label --dry      只打印结果，不写文件
 *
 * 跑 gen-meta 解析不到的新链接会保持原样，末尾会列出来提醒。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLAYLIST_PATH = resolve(ROOT, 'public/playlist.json')
const META_PATH = resolve(ROOT, 'public/meta.json')

const args = new Set(process.argv.slice(2))
const withAlbum = args.has('--album')
const force = args.has('--force')
const dry = args.has('--dry')

/** 会从 meta.json 里补的字段；cover / tags 是纯人工字段，永不自动写 */
const FILLABLE = withAlbum ? ['title', 'artist', 'album'] : ['title', 'artist']
/** 输出时的字段顺序，url 永远在最前（它是真相源） */
const KEY_ORDER = ['title', 'artist', 'album', 'cover', 'tags']

if (!existsSync(PLAYLIST_PATH)) {
  console.error(`找不到 ${PLAYLIST_PATH}`)
  process.exit(1)
}

const originalText = readFileSync(PLAYLIST_PATH, 'utf8')
const raw = JSON.parse(originalText)
if (!Array.isArray(raw)) {
  console.error('playlist.json 顶层必须是数组')
  process.exit(1)
}

/** meta.json 可能还没生成（刚 clone、或刚清过构建产物） */
let parsed = {}
if (existsSync(META_PATH)) {
  try {
    parsed = JSON.parse(readFileSync(META_PATH, 'utf8')).tracks ?? {}
  } catch {
    console.error('meta.json 解析失败，先跑一次 pnpm meta')
    process.exit(1)
  }
} else {
  console.error('还没有 public/meta.json，先跑一次 pnpm meta 再来回填')
  process.exit(1)
}

const isFilled = (v) => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.trim() !== '')

let upgraded = 0
let filled = 0
let unresolved = 0
const unresolvedUrls = []

const out = raw.map((item) => {
  const isObj = !!item && typeof item === 'object' && !Array.isArray(item)
  const src = isObj ? item : { url: typeof item === 'string' ? item.trim() : '' }
  const url = typeof src.url === 'string' ? src.url.trim() : ''
  const hit = url ? parsed[url] : null

  // 认不出来的（新加的链接还没跑 gen-meta）原样留着，纯字符串写法比空对象清爽
  if (!hit) {
    if (url) {
      unresolved++
      unresolvedUrls.push(url)
    }
    return item
  }

  const next = { url }
  let added = 0
  for (const k of KEY_ORDER) {
    const cur = src[k]
    const curOk = isFilled(cur)
    // 已有值默认不动；--force 只对可补字段生效，不会去动 cover / tags
    const canFill = FILLABLE.includes(k) && !(curOk && !force)
    const val = canFill ? hit[k] : undefined
    if (typeof val === 'string' && val.trim() !== '') {
      next[k] = val.trim()
      if (!curOk) added++
    } else if (curOk) {
      next[k] = cur
    }
  }

  if (!isObj) upgraded++
  else if (added > 0) filled++
  return next
})

const toLine = (e) =>
  '  ' + (typeof e === 'string' ? JSON.stringify(e) : `{ ${Object.entries(e).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`)

const nextText = out.length ? `[\n${out.map(toLine).join(',\n')}\n]\n` : '[]\n'
const changed = nextText !== originalText

console.log(`曲库共 ${out.length} 首：`)
for (const [i, e] of out.entries()) {
  const url = typeof e === 'string' ? e : e.url
  const hit = parsed[url] ?? {}
  const title = (typeof e === 'object' ? e.title : undefined) ?? hit.title ?? '（未知 · 还没解析）'
  const artist = (typeof e === 'object' ? e.artist : undefined) ?? hit.artist ?? ''
  const album = (typeof e === 'object' ? e.album : undefined) ?? hit.album ?? ''
  const bits = [artist && `${artist}`, album && `${album}`].filter(Boolean).join(' · ')
  console.log(`  ${String(i + 1).padStart(3)}. ${title}${bits ? `  —  ${bits}` : ''}`)
}

if (unresolved > 0) {
  console.log(`\n${unresolved} 首还没有元数据（先跑 pnpm meta）：`)
  for (const u of unresolvedUrls) console.log(`  ${u}`)
}

console.log('')
if (dry) {
  console.log(changed ? '用法：以上是待写入的内容（--dry 没有改动文件）' : 'playlist.json 已经是最新的，无需改动')
} else if (!changed) {
  console.log('playlist.json 已经是最新的，无需改动')
} else {
  writeFileSync(PLAYLIST_PATH, nextText)
  const bits = [`升级 ${upgraded} 条裸链接`, filled > 0 ? `补全 ${filled} 条已有条目` : ''].filter(Boolean)
  console.log(`已回填：${bits.join('，')} → public/playlist.json`)
  console.log('上面清单里的歌手 / 专辑就是写 playlists.json 规则时要用的原字符串，可照抄。')
}
