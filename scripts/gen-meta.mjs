/**
 * 预生成歌单元数据：public/playlist.json -> public/meta.json + public/covers/* + public/lyrics/*
 *
 * 目的：音源线路慢（实测 2MB 头部要几分钟），运行时解析会导致首页长时间「解析中…」。
 * 改成开发/部署前跑一次本脚本，把标题/歌手/专辑/封面/歌词全部落盘，页面首屏直接渲染。
 *
 * 歌词单独存放（public/lyrics/<hash>.json），meta.json 里只留 lyricsUrl 指针：
 * 歌词体积占了元数据的绝大部分，而列表页并不需要它，拆开后首屏只为列表字段买单，
 * 歌词在播放到该曲目时才按需拉取。
 *
 * 封面按图片内容哈希命名（public/covers/<内容sha1>.jpg），不按曲目直链：
 * 同专辑多首曲子内嵌同一张封面时只落一个文件，且换歌单/换直链不会重存。
 * 每次运行结束会清掉 covers/ 与 lyrics/ 里不再被 meta.json 引用的文件。
 *
 * 用法：
 *   node scripts/gen-meta.mjs            # 只解析 meta.json 里缺失的条目
 *   node scripts/gen-meta.mjs --force    # 全部重新解析
 *   node scripts/gen-meta.mjs --only 2   # 只解析第 3 条（下标从 0 开始）
 *
 * 增量下载：按 256KB 递增分块请求（不重复下载），一旦标题和封面都拿到就停。
 * 升级自旧版本（歌词内嵌）时，首次运行会自动把已有歌词迁出，无需重新下载音频。
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { parseBlob } from 'music-metadata'

const ROOT = path.resolve(import.meta.dirname, '..')
const PLAYLIST = path.join(ROOT, 'public', 'playlist.json')
const META_OUT = path.join(ROOT, 'public', 'meta.json')
const COVER_DIR = path.join(ROOT, 'public', 'covers')
const LYRICS_DIR = path.join(ROOT, 'public', 'lyrics')

const CHUNK = 256 * 1024
const MAX_BYTES = 8 * 1024 * 1024

const args = process.argv.slice(2)
const force = args.includes('--force')
const onlyIdx = args.includes('--only') ? Number(args[args.indexOf('--only') + 1]) : null

const MIME = {
  flac: 'audio/flac',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
}

function mimeOf(url) {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase()
  return ext ? MIME[ext] : undefined
}

function coverExt(format) {
  return (format || 'image/jpeg').split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
}

function shortHash(input) {
  return createHash('sha1').update(input).digest('hex').slice(0, 12)
}

/**
 * 封面按「图片内容」命名，不按曲目直链。
 * 同一张专辑的每首曲子都内嵌同一张封面，按直链命名会各存一份完全相同的文件
 * （实测 9 首里就有 3 对重复）；按内容命名后相同的图天然合并成一个文件。
 */
function coverName(data, format) {
  return `${shortHash(data)}.${coverExt(format)}`
}

/** 递增分块下载，边下边试解析，拿到所需内容即停 */
async function fetchAndParse(url) {
  const mime = mimeOf(url)
  let buf = Buffer.alloc(0)
  let total = Infinity

  while (buf.length < MAX_BYTES && buf.length < total) {
    const start = buf.length
    const end = start + CHUNK - 1
    const resp = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } })
    if (!resp.ok && resp.status !== 206) {
      throw new Error(`HTTP ${resp.status}`)
    }
    const cr = resp.headers.get('content-range')
    if (cr) {
      const m = cr.match(/\/(\d+)\s*$/)
      if (m) total = Number(m[1])
    } else if (resp.status === 200) {
      total = buf.length + Number(resp.headers.get('content-length') || 0)
    }
    const chunk = Buffer.from(await resp.arrayBuffer())
    if (chunk.length === 0) break
    buf = Buffer.concat([buf, chunk])

    let meta
    try {
      meta = await parseBlob(new Blob([buf], { type: mime }), {
        mimeType: mime,
        duration: true,
        skipCovers: false,
      })
    } catch {
      // 截断的文件解析会抛错，继续下载更大的块
      if (buf.length >= total) throw new Error('解析失败（已下载完整文件）')
      continue
    }

    const hasTitle = Boolean(meta.common.title || meta.common.artist)
    const hasCover = Boolean(meta.common.picture?.[0])
    if ((hasTitle && hasCover) || buf.length >= total) {
      process.stdout.write(`  · 下载 ${(buf.length / 1024).toFixed(0)}KB / ${(total / 1024 / 1024).toFixed(1)}MB\n`)
      return meta
    }
  }

  // 循环结束还没 return：用最后一块硬解一次
  return await parseBlob(new Blob([buf], { type: mime }), {
    mimeType: mime,
    duration: true,
    skipCovers: false,
  })
}

/** 提取内嵌歌词（同步优先，退回纯文本） */
function extractLyrics(meta) {
  const c = meta.common
  let synced = []
  const texts = []

  for (const l of c.lyrics ?? []) {
    if (typeof l === 'string') texts.push(l)
    else if (Array.isArray(l.syncText) && l.syncText.length) {
      synced = l.syncText
        .filter((s) => s.timestamp !== undefined)
        .map((s) => ({ time: s.timestamp / 1000, text: s.text }))
        .sort((a, b) => a.time - b.time)
    } else if (l.text) texts.push(l.text)
  }

  const plain = synced.length === 0 && texts.length > 0 ? texts[0] : null
  return { synced, plain }
}

/**
 * 歌词单独落盘：只有真的有歌词时才写文件。
 * 拆出去是因为歌词占了 meta.json 的绝大部分体积，而列表页一个字都用不到，
 * 没必要让首屏为一个 36KB 的文件买单。
 */
async function writeLyrics(url, synced, plain) {
  const lines = Array.isArray(synced) ? synced : []
  const text = typeof plain === 'string' && plain.length > 0 ? plain : null
  if (lines.length === 0 && !text) return null
  const name = `${shortHash(url)}.json`
  await writeFile(path.join(LYRICS_DIR, name), JSON.stringify({ synced: lines, plain: text }))
  return `/lyrics/${name}`
}

/** 把旧版 meta.json 里内嵌的歌词搬到独立文件（无需重新下载音频） */
async function migrateLegacyLyrics(cache) {
  let moved = 0
  for (const [url, entry] of Object.entries(cache.tracks)) {
    if (!('lyrics' in entry) && !('plainLyrics' in entry)) continue
    entry.lyricsUrl = await writeLyrics(url, entry.lyrics, entry.plainLyrics)
    delete entry.lyrics
    delete entry.plainLyrics
    moved++
  }
  return moved
}

/**
 * 旧版封面文件名是 sha1(曲目直链)，迁到「内容哈希」命名。
 * 直接读本地已落盘的图片重新命名，不需要重新下载音频；内容相同的会指向同一个文件。
 */
async function migrateCoverNames(cache) {
  let migrated = 0
  for (const entry of Object.values(cache.tracks)) {
    if (!entry.cover) continue
    const oldName = path.basename(entry.cover)
    const oldPath = path.join(COVER_DIR, oldName)
    if (!existsSync(oldPath)) continue
    const data = await readFile(oldPath)
    const newName = `${shortHash(data)}.${oldName.split('.').pop()}`
    if (newName === oldName) continue
    await writeIfChanged(path.join(COVER_DIR, newName), data)
    entry.cover = `/covers/${newName}`
    migrated++
  }
  return migrated
}

/** 只在内容不同时才写盘，避免同一张封面被重复覆盖 */
async function writeIfChanged(file, data) {
  if (existsSync(file)) {
    const old = await readFile(file)
    if (old.length === data.length && old.equals(data)) return
  }
  await writeFile(file, data)
}

/**
 * 清理 covers/ 与 lyrics/ 里不再被 meta.json 引用的文件
 * （改名后的旧文件、换封面/换歌词后的残留）。
 * 判断依据是当前 meta.json，所以处理到一半中断也不会误删还在用的资源。
 */
async function sweepOrphans(cache) {
  const entries = Object.values(cache.tracks)
  const targets = [
    [COVER_DIR, new Set(entries.map((e) => e.cover && path.basename(e.cover)).filter(Boolean))],
    [LYRICS_DIR, new Set(entries.map((e) => e.lyricsUrl && path.basename(e.lyricsUrl)).filter(Boolean))],
  ]
  let removed = 0
  for (const [dir, keep] of targets) {
    for (const name of await readdir(dir)) {
      if (keep.has(name)) continue
      await unlink(path.join(dir, name))
      removed++
    }
  }
  return removed
}

function toCached(meta, coverRelPath, lyricsUrl) {
  const c = meta.common

  return {
    title: c.title ?? '',
    artist: c.artist ?? c.artists?.[0] ?? '',
    album: c.album ?? '',
    albumArtist: c.albumartist,
    year: c.year,
    trackNo: c.track.no ?? null,
    duration: meta.format.duration ?? null,
    codec: meta.format.codec,
    bitrate: meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : null,
    sampleRate: meta.format.sampleRate ?? null,
    cover: coverRelPath ?? null,
    lyricsUrl: lyricsUrl ?? null,
  }
}

/**
 * playlist.json 支持纯字符串与对象混排：
 *   "https://.../a.flac"
 *   { "url": "https://.../b.flac", "title": "...", "tags": [...] }
 * 对象形式里的覆写字段由前端在显示时合并，这里只负责取出直链去解析。
 */
function toUrls(raw) {
  if (!Array.isArray(raw)) return []
  const out = []
  const seen = new Set()
  for (const item of raw) {
    let url = ''
    if (typeof item === 'string') url = item.trim()
    else if (item && typeof item === 'object' && typeof item.url === 'string') url = item.url.trim()
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

async function main() {
  let urls
  try {
    urls = toUrls(JSON.parse(await readFile(PLAYLIST, 'utf8')))
  } catch (e) {
    // 读不了歌单不能挡构建（部署平台跑 build 时尤其如此），警告后跳过
    console.warn('[gen-meta] 读取 playlist.json 失败，跳过预生成：', e?.message ?? e)
    return
  }
  if (urls.length === 0) {
    console.log('playlist.json 里没有有效直链')
    return
  }

  let cache = { generatedAt: null, tracks: {} }
  if (existsSync(META_OUT) && !force) {
    try {
      cache = JSON.parse(await readFile(META_OUT, 'utf8'))
      cache.tracks ??= {}
    } catch {
      /* 缓存损坏则重建 */
    }
  }

  await mkdir(COVER_DIR, { recursive: true })
  await mkdir(LYRICS_DIR, { recursive: true })

  // 旧版 meta.json 把歌词内嵌在条目里，先搬到独立文件（不需要重新下载音频）
  const movedLyrics = await migrateLegacyLyrics(cache)
  if (movedLyrics > 0) console.log(`已把 ${movedLyrics} 条歌词迁出 meta.json → public/lyrics/`)

  // 封面从「按直链命名」迁到「按内容命名」，顺便合并重复的那些
  const movedCovers = await migrateCoverNames(cache)
  if (movedCovers > 0) console.log(`已把 ${movedCovers} 张封面转为按内容命名 → public/covers/`)

  if (movedLyrics > 0 || movedCovers > 0) {
    cache.generatedAt = new Date().toISOString()
    await writeFile(META_OUT, JSON.stringify(cache, null, 2))
  }

  let done = 0
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i].trim()
    if (onlyIdx !== null && i !== onlyIdx) continue
    if (!force && cache.tracks[url]?.title) {
      console.log(`[${i + 1}/${urls.length}] 已缓存，跳过：${cache.tracks[url].title}`)
      continue
    }
    console.log(`[${i + 1}/${urls.length}] 解析 ${url}`)
    try {
      const meta = await fetchAndParse(url)
      let coverRelPath = null
      const pic = meta.common.picture?.[0]
      if (pic) {
        const name = coverName(url, pic.format)
        await writeFile(path.join(COVER_DIR, name), pic.data)
        coverRelPath = `/covers/${name}`
      }
      const { synced, plain } = extractLyrics(meta)
      const lyricsUrl = await writeLyrics(url, synced, plain)
      const entry = toCached(meta, coverRelPath, lyricsUrl)
      cache.tracks[url] = entry
      done++
      const lyricInfo = !lyricsUrl ? '无' : synced.length ? `${synced.length} 行` : '纯文本'
      console.log(
        `  ✓ ${entry.title || '(无标题)'} — ${entry.artist || '?'} | 歌词 ${lyricInfo} | 封面 ${coverRelPath ? '有' : '无'}`,
      )
      // 每成功一条就落盘，长任务中断不丢进度
      cache.generatedAt = new Date().toISOString()
      await writeFile(META_OUT, JSON.stringify(cache, null, 2))
    } catch (e) {
      console.log(`  ✗ 失败：${e?.message ?? e}`)
    }
  }

  cache.generatedAt = new Date().toISOString()
  await writeFile(META_OUT, JSON.stringify(cache, null, 2))

  // 缓存非空才清理，避免 meta.json 损坏/被清空时把整个 covers 目录误删
  if (Object.keys(cache.tracks).length > 0) {
    const orphans = await sweepOrphans(cache)
    if (orphans > 0) console.log(`已清理 ${orphans} 个不再被引用的封面/歌词文件`)
    const covers = (await readdir(COVER_DIR)).length
    console.log(`封面：${covers} 个文件（按内容去重后）`)
  }

  const sizeKB = (await readFile(META_OUT)).length / 1024
  console.log(
    `\n完成：新增/更新 ${done} 条，meta.json 共 ${Object.keys(cache.tracks).length} 条（${sizeKB.toFixed(1)}KB，歌词另存 public/lyrics/）`,
  )
  const missing = urls.filter((u) => !cache.tracks[u.trim()]?.title)
  if (missing.length) console.log(`未成功 ${missing.length} 条，重跑本脚本会重试`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
