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
 * 封面长边压到 MAX_COVER_EDGE 以内（原图动辄 2048px / 800KB，界面里最多显示到约 300px）。
 * 这一步用 ffmpeg，**属可选优化**：找不到就按原图落盘，其余流程不受影响。
 * 查找顺序：环境变量 FFMPEG_PATH → 系统 PATH 上的 ffmpeg → `import('ffmpeg-static')`
 * （包已经不在依赖里了，装了才走得到这一条；失败也只是警告）。
 * 别为了「让构建机能压封面」再把 ffmpeg-static 加回依赖：它 5.x 的 postinstall 要下载
 * 约 79MB 二进制，部署时一旦卡住是几分钟无日志的静默挂起（2026-09-17 CF Pages 那次）。
 * 需要压封面就装系统 ffmpeg 并设 FFMPEG_PATH。
 *
 * 用法：
 *   node scripts/gen-meta.mjs            # 只解析 meta.json 里缺失的条目
 *   node scripts/gen-meta.mjs --force    # 全部重新解析
 *   node scripts/gen-meta.mjs --only 2   # 只解析第 3 条（下标从 0 开始）
 *
 * 下载策略：按 256KB 分块，一批并发取多块（不重复下载）。
 * 这么做的原因是「每请求固定开销」远大于带宽：实测单次 256KB 请求要 5.1s，
 * 其中约 2.8s 是建连/回源首字节，串行递增会把这笔开销叠加 N 次
 * （串行 4×256KB = 14.2s，并发 4×256KB = 5.6s）。块内并发 + 曲目间并发
 * （JOBS）把两份开销都重叠掉，实测整库全量解析由数分钟降到约 1 分钟。
 * 停止条件：拿到标题+封面，或读完了 FLAC 标签区（flacMetadataEnd），或触到上限。
 * 中途还会按曲目并发（--jobs N，默认 JOBS），meta.json 落盘串行化避免写坏。
 * 升级自旧版本（歌词内嵌）时，首次运行会自动把已有歌词迁出，无需重新下载音频。
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseBlob } from 'music-metadata'

const ROOT = path.resolve(import.meta.dirname, '..')
const PLAYLIST = path.join(ROOT, 'public', 'playlist.json')
const META_OUT = path.join(ROOT, 'public', 'meta.json')
const COVER_DIR = path.join(ROOT, 'public', 'covers')
const LYRICS_DIR = path.join(ROOT, 'public', 'lyrics')

const CHUNK = 256 * 1024
const MAX_BYTES = 8 * 1024 * 1024

/**
 * 一批并发取几块。每请求的固定开销（建连 + 回源首字节，实测约 2.8s）
 * 远大于传输本身，并发能把它重叠掉：串行 4×256KB 要 14.2s，并发只要 5.6s。
 * 取 4 块 = 1MB，实测已能覆盖绝大多数曲目的标签区（含封面），一批即完成。
 */
const BLOCKS_PER_BATCH = 4

/** 封面长边上限：界面里最大只显示到约 300px，2 倍屏 600px 足够；原图动辄 2048px / 800KB */
const MAX_COVER_EDGE = 800
/** JPEG 质量（ffmpeg -q:v，2 最好 / 31 最差；4 视觉上与原图无差） */
const COVER_QUALITY = '4'

const args = process.argv.slice(2)
const force = args.includes('--force')
const onlyIdx = args.includes('--only') ? Number(args[args.indexOf('--only') + 1]) : null
/**
 * 同时解析几首（--jobs N，默认 3）。曲目并发 × BLOCKS_PER_BATCH 即并发连接数，
 * 控制在 8~12 之间：实测吞吐在 8 个连接后趋于饱和（串行 72KB/s → 并发 204KB/s），
 * 再高只是互相抢带宽。
 */
const jobs = args.includes('--jobs') ? Math.max(1, Number(args[args.indexOf('--jobs') + 1]) || 1) : 3

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

/**
 * ffmpeg 只用来压封面，属可选优化：找不到就按原图落盘，构建照常。
 * 「能不能跑起来」才算数 —— 文件存在不代表可用，所以一律 spawn 一次 -version 探活。
 */
function ffmpegWorks(bin) {
  if (typeof bin !== 'string' || bin.length === 0) return false
  const r = spawnSync(bin, ['-version'], { stdio: 'ignore' })
  return !r.error && r.status === 0
}

/**
 * 按 环境变量 → 系统安装 → 依赖自带 的顺序找一个能用的 ffmpeg：
 *   1. FFMPEG_PATH：本机装在奇怪位置时手动指定
 *   2. 系统 PATH 上的 ffmpeg：开发机通常走这条
 *   3. ffmpeg-static：部署平台（Cloudflare Pages 构建镜像不含 ffmpeg）的兜底，
 *      二进制由该包的 postinstall 下载 —— pnpm 10 默认拦截依赖脚本，
 *      需在 pnpm-workspace.yaml 的 onlyBuiltDependencies 里放行，否则装了也是空壳。
 * 都没有就返回 null，调用方按原图落盘。
 */
async function resolveFfmpeg() {
  for (const bin of [process.env.FFMPEG_PATH, 'ffmpeg']) {
    if (bin && ffmpegWorks(bin)) return bin
  }
  try {
    const mod = await import('ffmpeg-static')
    const bin = mod.default ?? mod
    if (ffmpegWorks(bin)) {
      // 明确报出来源：本地有系统 ffmpeg 时不会走到这里，构建日志里能一眼看出兜底有没有生效
      console.log('ffmpeg：系统里没有，改用依赖自带的 ffmpeg-static')
      return bin
    }
    console.warn('  ! ffmpeg-static 装上了但二进制不可用（构建脚本可能被包管理器拦截），封面按原图落盘')
  } catch {
    // 没装这个包属正常情况，本地有系统 ffmpeg 就够
  }
  return null
}

const ffmpegBin = await resolveFfmpeg()

/**
 * 只从文件头读图片尺寸（封面基本只有 JPEG / PNG 两种）。
 * 自己解析是为了判断「到底要不要压」——否则只能无脑重编码，
 * 把本来就很小的图也再走一遍有损转换。
 */
function imageSize(buf, ext) {
  if (ext === 'png') {
    // \x89PNG\r\n\x1a\n | 长度(4) | 'IHDR' | 宽(4) | 高(4)
    if (buf.length > 24 && buf.toString('latin1', 12, 16) === 'IHDR') {
      return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
    }
    return null
  }
  if (ext === 'jpg' || ext === 'jpeg') {
    // 逐个跳过段头，直到 SOFn：段内是 精度(1) 高(2) 宽(2)
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++
        continue
      }
      const marker = buf[i + 1]
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
        i += 2
        continue
      }
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) }
      i += 2 + buf.readUInt16BE(i + 2)
    }
  }
  return null
}

/**
 * 长边超过 MAX_COVER_EDGE 就等比压到上限以内，返回编码后的字节。
 * 认不出尺寸、本来就不大、没装 ffmpeg 或压完反而更大 —— 一律原样返回。
 */
async function shrinkCover(data, ext) {
  if (!ffmpegBin) return data
  const size = imageSize(data, ext)
  if (!size || Math.max(size.w, size.h) <= MAX_COVER_EDGE) return data

  const dir = await mkdtemp(path.join(os.tmpdir(), 'lyra-cover-'))
  const src = path.join(dir, `in.${ext}`)
  const dst = path.join(dir, `out.${ext}`)
  try {
    await writeFile(src, data)
    const quality = ext === 'jpg' || ext === 'jpeg' ? ['-q:v', COVER_QUALITY] : []
    const r = spawnSync(
      ffmpegBin,
      [
        '-v', 'error', '-y', '-i', src,
        '-vf', `scale=min(${MAX_COVER_EDGE}\\,iw):min(${MAX_COVER_EDGE}\\,ih):force_original_aspect_ratio=decrease`,
        ...quality, '-frames:v', '1', dst,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
    if (r.status !== 0) {
      const why = r.stderr?.toString().trim().split('\n').pop() || r.error?.message || `exit ${r.status}`
      console.warn(`  ! 封面压缩失败，改用原图（${why}）`)
      return data
    }
    const out = await readFile(dst)
    return out.length < data.length ? out : data
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/**
 * 取一个字节区间（带重试）。
 * 关键防御：服务器偶发忽略 Range，直接返回 200 + 整个文件 —— 实测一次要下 37MB。
 * 所以一旦发现响应没有 content-range，立刻掐断连接、一个字都不读，换连接重试；
 * 连续失败才报错，交给下次重跑。
 */
async function fetchRange(url, start, length, tries = 3) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    const ac = new AbortController()
    const resp = await fetch(url, {
      headers: { Range: `bytes=${start}-${start + length - 1}` },
      signal: ac.signal,
    })
    if (resp.status === 416) {
      ac.abort()
      return { data: Buffer.alloc(0), total: null } // 已越过文件末尾
    }
    if (!resp.ok && resp.status !== 206) {
      ac.abort()
      throw new Error(`HTTP ${resp.status}`)
    }

    const cr = resp.headers.get('content-range')
    if (!cr) {
      ac.abort() // 忽略 Range：body 是整个文件，绝不能读
      if (attempt === tries) throw new Error('服务器忽略了 Range 且重试无效，稍后重跑本条')
      process.stdout.write(`  ! 偏移 ${start} 的 Range 被忽略（返回整文件），换连接重试\n`)
      continue
    }

    const body = Buffer.from(await resp.arrayBuffer())
    const m = cr.match(/bytes (\d+)-(\d+)\/(\d+|\*)/)
    const total = m && m[3] !== '*' ? Number(m[3]) : null
    const skip = m ? Math.max(0, start - Number(m[1])) : 0 // 起点比请求的更靠前就裁掉多出来的头部
    return { data: Buffer.from(body.subarray(skip, skip + length)), total }
  }
  throw new Error('取数失败')
}

/**
 * FLAC 的标签区（STREAMINFO / VORBIS_COMMENT / PICTURE…）全部位于音频帧之前，
 * 每个块头 4 字节：最高位标记「是否最后一块」，低 7 位是类型，后 3 字节是块长度。
 * 顺着块链走一遍就能算出标签区的确切结束位置，拿到它便能立刻停止下载，
 * 音频帧一个字节都不用下。
 *
 * 这条对**没有内嵌封面**的曲目尤其关键：只靠「拿到封面才停」的话，这类曲子会
 * 一路下到 MAX_BYTES 上限才放弃（32 轮请求，实测白等近两分钟）。
 *
 * 返回标签区结束偏移；数据不足以走完块链（或不是 FLAC）时返回 null，退回上限策略。
 */
function flacMetadataEnd(buf) {
  if (buf.length < 8 || buf.toString('latin1', 0, 4) !== 'fLaC') return null
  let pos = 4
  while (pos + 4 <= buf.length) {
    const header = buf[pos]
    const isLast = (header & 0x80) !== 0
    const length = (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3]
    pos += 4 + length
    if (isLast) return pos <= MAX_BYTES ? pos : null
  }
  return null
}

/**
 * 分块下载 + 解析：一批并发取多块（块内并发），边下边试解析，拿到所需内容即停。
 * 停止条件三个，任一满足即返回：
 *   1. 标题与封面都拿到了（正常曲目）
 *   2. FLAC 标签区已读完（无封面的曲目，避免白下到 8MB 上限）
 *   3. 已读到文件末尾
 * 返回 { meta, total }：total 是文件总长，落库时用来算码率（见 toCached）。
 */
async function fetchAndParse(url) {
  const mime = mimeOf(url)
  let buf = Buffer.alloc(0)
  let total = Infinity

  while (buf.length < MAX_BYTES && buf.length < total) {
    // 一批并发取 BLOCKS_PER_BATCH 块：串行时每次请求的固定开销（实测约 2.8s）完全叠加，
    // 并发把这部分重叠掉。首轮不知道文件总长，靠 content-range 里的越界返回兜底。
    const starts = []
    for (let i = 0; i < BLOCKS_PER_BATCH; i++) {
      const start = buf.length + i * CHUNK
      if (start < total && start < MAX_BYTES) starts.push(start)
    }
    if (starts.length === 0) break

    const got = await Promise.all(starts.map((start) => fetchRange(url, start, CHUNK)))
    for (const g of got) {
      if (g.total) total = g.total
      if (g.data.length === 0) break // 越过末尾，后面的块一并作废
      buf = Buffer.concat([buf, g.data])
      if (g.data.length < CHUNK) break // 已到文件末尾
    }

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
    const metaEnd = flacMetadataEnd(buf)
    const tagsDone = metaEnd !== null && buf.length >= metaEnd
    if ((hasTitle && hasCover) || tagsDone || buf.length >= total) {
      const why = tagsDone && !hasCover ? '，无内嵌封面，标签区已读完' : ''
      process.stdout.write(
        `  · 下载 ${(buf.length / 1024).toFixed(0)}KB / ${(total / 1024 / 1024).toFixed(1)}MB${why}\n`,
      )
      return { meta, total }
    }
  }

  // 循环结束还没 return：用最后一块硬解一次
  const meta = await parseBlob(new Blob([buf], { type: mime }), {
    mimeType: mime,
    duration: true,
    skipCovers: false,
  })
  return { meta, total }
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
 * 把已有的封面迁到「内容哈希」命名，超出长边上限的就地压小。
 * 读本地已落盘的图片重编码，不需要重新下载音频；内容相同的会收敛到同一个文件。
 */
async function migrateCovers(cache) {
  let renamed = 0
  let shrunk = 0
  for (const entry of Object.values(cache.tracks)) {
    if (!entry.cover) continue
    const oldName = path.basename(entry.cover)
    const data = await readFile(path.join(COVER_DIR, oldName)).catch(() => null)
    if (!data) continue
    const ext = oldName.split('.').pop()
    const out = await shrinkCover(data, ext)
    if (out !== data) shrunk++
    const newName = `${shortHash(out)}.${ext}`
    if (newName === oldName) continue
    await writeIfChanged(path.join(COVER_DIR, newName), out)
    entry.cover = `/covers/${newName}`
    renamed++
  }
  return { renamed, shrunk }
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

function toCached(meta, coverRelPath, lyricsUrl, fileSize) {
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
    // 码率自己按「文件总长 ÷ 时长」算：FLAC 无损，整个文件都是音频数据，这样最准。
    // 不能直接用 music-metadata 的 format.bitrate —— 它是按「传进去的那段字节数」推算的，
    // 而我们只取标签区（约 1MB / 30MB），会把它算小几十倍（实测 1054kbps 变成 10kbps）。
    bitrate:
      Number.isFinite(fileSize) && fileSize > 0 && meta.format.duration
        ? Math.round((fileSize * 8) / meta.format.duration / 1000)
        : null,
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
  let rawList = []
  try {
    rawList = JSON.parse(await readFile(PLAYLIST, 'utf8'))
    urls = toUrls(rawList)
  } catch (e) {
    // 读不了歌单不能挡构建（部署平台跑 build 时尤其如此），警告后跳过
    console.warn('[gen-meta] 读取 playlist.json 失败，跳过预生成：', e?.message ?? e)
    return
  }
  if (urls.length === 0) {
    console.log('playlist.json 里没有有效直链')
    return
  }

  // 旧缓存一律先读进来，--force 只决定「是否跳过已缓存条目」，不清空它。
  // 否则 --force 期间中途失败、或与 --only 组合时，残缺缓存会被当成真相写盘，
  // 紧接着的孤儿清理就会把还在用的封面/歌词删掉（实测踩过：一次删掉 25 个文件）。
  let cache = { generatedAt: null, tracks: {} }
  // 记住读进来的原文：结尾要拿它比对，内容没变就不写盘。
  // 为什么重要：现在这一步由 GitHub Actions 每天跑，而 generatedAt 每次都是新值 ——
  // 无条件写的话，就算一首新歌都没有，也会每天产生一个只有时间戳变化的提交，
  // 顺带触发一次毫无必要的重新构建与部署。
  let metaTextBefore = null
  if (existsSync(META_OUT)) {
    try {
      // 归一成 LF 再比对：Windows 上 core.autocrlf 会让工作区变成 CRLF，
      // 不归一的话「原文」与生成结果永远差一个 \r，等于这条保护失效。
      metaTextBefore = (await readFile(META_OUT, 'utf8')).replace(/\r\n/g, '\n')
      const prev = JSON.parse(metaTextBefore)
      if (prev && typeof prev.tracks === 'object' && prev.tracks) cache = prev
    } catch {
      /* 缓存损坏则重建 */
    }
    cache.tracks ??= {}
  }

  await mkdir(COVER_DIR, { recursive: true })
  await mkdir(LYRICS_DIR, { recursive: true })

  // 旧版 meta.json 把歌词内嵌在条目里，先搬到独立文件（不需要重新下载音频）
  const movedLyrics = await migrateLegacyLyrics(cache)
  if (movedLyrics > 0) console.log(`已把 ${movedLyrics} 条歌词迁出 meta.json → public/lyrics/`)

  // 封面统一成「按内容哈希命名」，超出长边上限的顺带压小
  const coverMoves = await migrateCovers(cache)
  if (coverMoves.renamed > 0) {
    const how = coverMoves.shrunk > 0 ? `按内容命名 + 压到 ${MAX_COVER_EDGE}px 内` : '按内容命名'
    console.log(`已重整 ${coverMoves.renamed} 张封面（${how}） → public/covers/`)
  }

  if (movedLyrics > 0 || coverMoves.renamed > 0) {
    cache.generatedAt = new Date().toISOString()
    await writeFile(META_OUT, JSON.stringify(cache, null, 2))
  }

  let done = 0
  const queue = []
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i].trim()
    if (onlyIdx !== null && i !== onlyIdx) continue
    if (!force && cache.tracks[url]?.title) {
      console.log(`[${i + 1}/${urls.length}] 已缓存，跳过：${cache.tracks[url].title}`)
      continue
    }
    queue.push({ i, url })
  }
  if (queue.length > 1) {
    console.log(`待解析 ${queue.length} 条，曲目并发 ${jobs}（同时 ${jobs * BLOCKS_PER_BATCH} 个连接）`)
  }

  // 并发跑时 meta.json 必须串行落盘：两处 writeFile 撞在一起会写出半截文件
  let saving = Promise.resolve()
  const saveMeta = () => {
    cache.generatedAt = new Date().toISOString()
    saving = saving.then(() => writeFile(META_OUT, JSON.stringify(cache, null, 2))).catch(() => {})
    return saving
  }

  let cursor = 0
  async function parseWorker() {
    while (cursor < queue.length) {
      const { i, url } = queue[cursor++]
      console.log(`[${i + 1}/${urls.length}] 解析 ${url}`)
      try {
        const { meta, total } = await fetchAndParse(url)
        let coverRelPath = null
        const pic = meta.common.picture?.[0]
        if (pic) {
          const data = await shrinkCover(Buffer.from(pic.data), coverExt(pic.format))
          const name = coverName(data, pic.format)
          await writeIfChanged(path.join(COVER_DIR, name), data)
          coverRelPath = `/covers/${name}`
        }
        const { synced, plain } = extractLyrics(meta)
        const lyricsUrl = await writeLyrics(url, synced, plain)
        const entry = toCached(meta, coverRelPath, lyricsUrl, total)
        cache.tracks[url] = entry
        done++
        const lyricInfo = !lyricsUrl ? '无' : synced.length ? `${synced.length} 行` : '纯文本'
        console.log(
          `[${i + 1}] ✓ ${entry.title || '(无标题)'} — ${entry.artist || '?'} | 歌词 ${lyricInfo} | 封面 ${coverRelPath ? '有' : '无'}`,
        )
        await saveMeta() // 每成功一条就落盘，长任务中断不丢进度
      } catch (e) {
        console.log(`[${i + 1}] ✗ 失败：${e?.message ?? e}`)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, parseWorker))

  // 内容没变就不写盘：generatedAt 每次都是新值，无条件写（或先更新时间戳再比对）会让
  // Actions 每天产生一个只有时间戳变化的提交，并触发一次毫无必要的重新构建与部署。
  // 所以先按「旧的时间戳」序列化来比，只有真有内容变化时才刷新时间戳并落盘。
  if (JSON.stringify(cache, null, 2) === metaTextBefore) {
    console.log('\n没有新内容（全部命中缓存），meta.json 不动')
  } else {
    cache.generatedAt = new Date().toISOString()
    await writeFile(META_OUT, JSON.stringify(cache, null, 2))
  }

  // 清理的第二道保险：只有「当前所有直链都已解析出条目」时才动手。
  // --only 只解析一条、或部分条目解析失败时，缓存只是真实曲库的一个子集，
  // 此时按它清理会把其余曲目的封面/歌词当作孤儿删掉。
  const resolved = urls.filter((u) => cache.tracks[u.trim()]).length
  if (resolved === urls.length && Object.keys(cache.tracks).length > 0) {
    const orphans = await sweepOrphans(cache)
    if (orphans > 0) console.log(`已清理 ${orphans} 个不再被引用的封面/歌词文件`)
    const files = await readdir(COVER_DIR)
    const bytes = (await Promise.all(files.map(async (f) => (await readFile(path.join(COVER_DIR, f))).length)))
      .reduce((a, b) => a + b, 0)
    console.log(`封面：${files.length} 个文件，共 ${(bytes / 1024).toFixed(0)}KB（按内容去重${ffmpegBin ? ` + 压到 ${MAX_COVER_EDGE}px 内` : '，未压缩：没找到 ffmpeg'}）`)
  } else if (resolved < urls.length) {
    console.log(`曲库 ${urls.length} 条中还有 ${urls.length - resolved} 条没有元数据，本次跳过孤儿清理（避免误删仍在用的封面/歌词）`)
  }

  const sizeKB = (await readFile(META_OUT)).length / 1024
  console.log(
    `\n完成：新增/更新 ${done} 条，meta.json 共 ${Object.keys(cache.tracks).length} 条（${sizeKB.toFixed(1)}KB，歌词另存 public/lyrics/）`,
  )
  const missing = urls.filter((u) => !cache.tracks[u.trim()]?.title)
  if (missing.length) console.log(`未成功 ${missing.length} 条，重跑本脚本会重试`)

  // 源文件里还写着裸链接的话，元数据已经解析好了，提醒一句就能顺手回填
  const bare = Array.isArray(rawList) ? rawList.filter((x) => typeof x === 'string').length : 0
  if (bare > 0) {
    console.log(`playlist.json 里还有 ${bare} 条裸链接：跑 pnpm label 把歌名写回去，源文件就能自己认出歌了`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
