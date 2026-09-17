/**
 * 从 Emby 音乐库生成 public/emby.json（与 meta.json 同形：{ generatedAt, tracks }）。
 *
 * 为什么不走 gen-meta 那套「下载音频分块解析」：
 * Emby 已经把整个库索引好了，一次 Items 查询就能拿到标题 / 艺术家 / 专辑 / 年份 /
 * 轨号 / 时长 / 码率 / 采样率，封面也有现成接口。实测 907 首一分钟内出结果，
 * 而下载解析要跑约半小时、并且要经 Emby 再拉 1.8GB 流量。
 *
 * 代价是拿不到歌词：实测库里所有曲目内嵌歌词都是 0 条，Emby 也没有歌词接口
 * （/Audio/{id}/Lyrics 会掉进转码管道并 500）。这个库整体是纯音乐，影响不大。
 *
 * 密钥只从环境变量读（本地放 .env.local，CI 放仓库 secret）。没配就跳过并保留
 * 已有产物 —— 这样没配密钥的构建环境（如 Cloudflare Pages）也能正常出站，
 * 直接用仓库里那份快照。
 *
 * 用法：
 *   pnpm emby              全量生成
 *   pnpm emby --dry        只打印，不写文件
 *   pnpm emby --limit 30   只处理前 30 首（试跑用，覆盖写会警告）
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { embyPlaylistId, embyPlaylistSubtitle, embyStreamUrl, EMBY_COVER_DIR } from '../src/lib/emby.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'public', 'emby.json')
const COVER_DIR = path.join(ROOT, 'public', 'emby-covers')

/** 一次问 500 条，够大又不会让单次响应过肥 */
const PAGE = 500
/** 封面下载并发 */
const COVER_JOBS = 4

const FIELDS = [
  'Path',
  'ParentId',
  'AlbumId',
  'Album',
  'Name',
  'AlbumArtist',
  'ArtistItems',
  'ProductionYear',
  'IndexNumber',
  'RunTimeTicks',
  'Container',
  'MediaSources',
  'ImageTags',
].join(',')

const argv = process.argv.slice(2)
const argVal = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const dry = argv.includes('--dry')
const limit = Number(argVal('limit')) || 0

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
const BASE = (env.EMBY_URL || '').replace(/\/+$/, '')
const KEY = env.EMBY_API_KEY || ''

function shortHash(input) {
  return createHash('sha1').update(input).digest('hex').slice(0, 12)
}

/** 从字节里认图，不信任响应头（Emby 有时候给 application/octet-stream） */
function imageExt(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg'
  if (buf.length > 8 && buf.toString('latin1', 0, 8) === '\x89PNG\r\n\x1a\n') return 'png'
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP')
    return 'webp'
  return null
}

const api = async (p, extra = '') => {
  const r = await fetch(`${BASE}/emby${p}?api_key=${encodeURIComponent(KEY)}${extra}`)
  if (!r.ok) throw new Error(`Emby ${p} → HTTP ${r.status}`)
  return r.json()
}

/** 分页取全量。TotalRecordCount 不可信时靠「某页返回空」收尾 */
async function fetchAll(uid, parentId, types, fields) {
  const out = []
  for (let start = 0; ; start += PAGE) {
    const j = await api(
      `/Users/${uid}/Items`,
      `&ParentId=${parentId}&Recursive=true&IncludeItemTypes=${types}` +
        `&Limit=${PAGE}&StartIndex=${start}&Fields=${fields}`,
    )
    const items = j.Items ?? []
    out.push(...items)
    const total = j.TotalRecordCount ?? 0
    if (items.length === 0 || (total > 0 && out.length >= total)) break
  }
  return out
}

/**
 * 去掉文件名开头的轨号前缀（「02. やさしさの選択」→「やさしさの選択」）。
 * 只在「前缀里的数字 == 标签里的轨号」时动手，避免把「2001 太空漫游」这类
 * 真的以数字开头的标题砍掉；没有轨号时按目录约定放宽为纯数字前缀。
 */
function stripTrackPrefix(name, trackNo) {
  const m = name.match(/^0*(\d{1,3})\s*[.\-、_]\s*(.+)$/)
  if (!m) return name
  const n = Number(m[1])
  if (trackNo != null && n !== trackNo) return name
  return m[2].trim() || name
}

/**
 * Emby 对「没有该字段」和「该字段是空数组/空串」两种写法都会出现，
 * 所以不能用 ??（空串不是 nullish，会把后面的兜底挡住，表现为艺术家一片空白）。
 */
const pick = (...vals) => vals.find((v) => typeof v === 'string' && v.trim()) ?? ''

/** 从 Path 里回推艺术家/专辑，给「父目录没被识别成专辑」的少数曲目兜底 */
function fromPath(p) {
  const parts = String(p || '').split('/').filter(Boolean)
  const album = parts.length >= 2 ? parts[parts.length - 2] : ''
  const artist = parts.length >= 3 ? parts[parts.length - 3] : ''
  const year = Number((album.match(/\((\d{4})\)\s*$/) || [])[1]) || null
  return { album, artist, year, cleanAlbum: album.replace(/\s*\(\d{4}\)\s*$/, '').trim() }
}

async function fetchCover(ownerId) {
  const r = await fetch(`${BASE}/emby/Items/${ownerId}/Images/Primary?api_key=${encodeURIComponent(KEY)}`)
  if (!r.ok) return null
  const buf = Buffer.from(await r.arrayBuffer())
  const ext = imageExt(buf)
  if (!ext) return null
  const name = `${shortHash(buf)}.${ext}`
  const file = path.join(COVER_DIR, name)
  if (!dry && !existsSync(file)) await writeFile(file, buf)
  return `${EMBY_COVER_DIR}/${name}`
}

/** 并发池：封面几十张，串行会明显拖慢，全并发又容易把服务器压出 5xx */
async function mapPool(items, size, fn) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      for (;;) {
        const i = next++
        if (i >= items.length) return
        out[i] = await fn(items[i], i)
      }
    }),
  )
  return out
}

/**
 * 取 Emby 里现成的歌单。
 *
 * 只收「条目 id 都在本次曲库里」的歌单条目：Emby 歌单里可能躺着已被删掉或已被移出
 * 音乐库的条目，那种 url 在本站曲库里没有对应曲目，留着只会让歌单显示得比实际短。
 * 这类条目按缺失计数并打出来，而不是静默丢弃。
 *
 * 封面不生成：Emby 给歌单的缩略图本身就是「成员专辑封面的 2×2 拼贴」，
 * 而前端 PlaylistCover 对没有 cover 的歌单做的正是同一件事（还能按专辑去重），
 * 存下来等于多一份重复图片。真想要自定义封面时，在 playlists.json 里手写同 id
 * 的条目即可覆盖（见 store 里的合并规则）。
 */
async function fetchPlaylists(uid, trackUrls) {
  const list = await api(`/Users/${uid}/Items`, '&Recursive=true&IncludeItemTypes=Playlist')
  const out = []
  for (const pl of list.Items ?? []) {
    const items = await api(`/Playlists/${pl.Id}/Items`, '&Limit=2000')
    const urls = []
    let seconds = 0
    let missing = 0
    for (const it of items.Items ?? []) {
      const u = embyStreamUrl(String(it.Id))
      if (!trackUrls.has(u)) {
        missing++
        continue
      }
      if (urls.includes(u)) continue
      urls.push(u)
      seconds += (it.RunTimeTicks ?? 0) / 1e7
    }
    if (urls.length === 0) {
      console.log(`  ! 歌单「${pl.Name}」没有可用条目，跳过`)
      continue
    }
    console.log(
      `  歌单「${pl.Name}」：${urls.length} 首${missing ? `（另有 ${missing} 首不在曲库里，已略过）` : ''}`,
    )
    out.push({
      id: embyPlaylistId(String(pl.Id)),
      title: pl.Name,
      subtitle: embyPlaylistSubtitle(urls.length, seconds),
      urls,
    })
  }
  return out
}

async function main() {
  if (!BASE || !KEY) {
    console.log('未配置 EMBY_URL / EMBY_API_KEY，跳过 Emby 同步（沿用仓库里已有的 emby.json）')
    return
  }

  const info = await api('/System/Info')
  console.log(`Emby ${info.Version} @ ${BASE}`)

  const users = await api('/Users')
  const uid = (users.find((u) => u.Policy?.IsAdministrator) ?? users[0])?.Id
  if (!uid) throw new Error('取不到任何 Emby 用户')

  const views = (await api(`/Users/${uid}/Views`)).Items ?? []
  const musicViews = views.filter((v) => v.CollectionType === 'music')
  if (musicViews.length === 0) throw new Error('这台 Emby 上没有音乐库')
  console.log(`音乐库：${musicViews.map((v) => v.Name).join('、')}`)

  let audio = []
  let albums = []
  for (const v of musicViews) {
    audio.push(...(await fetchAll(uid, v.Id, 'Audio', FIELDS)))
    albums.push(...(await fetchAll(uid, v.Id, 'MusicAlbum', 'ImageTags,ProductionYear,AlbumArtist,ArtistItems,Path')))
  }
  console.log(`音频 ${audio.length} 首，专辑条目 ${albums.length} 张`)

  const albumById = new Map(albums.map((a) => [String(a.Id), a]))

  const picked = limit > 0 ? audio.slice(0, limit) : audio
  if (limit > 0) console.log(`--limit ${limit}：只处理前 ${picked.length} 首（产物将不完整）`)

  // 封面按「归属条目」去重：专辑封面一张就够，同专辑所有曲目共用
  await mkdir(COVER_DIR, { recursive: true })
  const owners = [...new Set(picked.map((it) => String(it.AlbumId || it.ParentId)).filter(Boolean))]
  console.log(`需要取封面 ${owners.length} 张…`)
  const coverByOwner = new Map()
  await mapPool(owners, COVER_JOBS, async (owner) => {
    try {
      coverByOwner.set(owner, await fetchCover(owner))
    } catch (e) {
      coverByOwner.set(owner, null)
      console.log(`  ! 封面 ${owner} 失败：${e.message}`)
    }
  })

  const tracks = {}
  let noAlbum = 0
  let noCover = 0
  for (const it of picked) {
    const id = String(it.Id)
    const albumItem = it.AlbumId ? albumById.get(String(it.AlbumId)) : null
    const fb = albumItem ? null : fromPath(it.Path)
    if (!albumItem) noAlbum++

    const stream = (it.MediaSources ?? [])[0]?.MediaStreams?.find((s) => s.Type === 'Audio')
    const size = (it.MediaSources ?? [])[0]?.Size
    const seconds = it.RunTimeTicks ? it.RunTimeTicks / 1e7 : null
    const owner = String(it.AlbumId || it.ParentId || '')
    const cover = coverByOwner.get(owner) ?? null
    if (!cover) noCover++

    tracks[embyStreamUrl(id)] = {
      title: stripTrackPrefix(it.Name ?? '', it.IndexNumber),
      artist: pick(it.AlbumArtist, (it.ArtistItems ?? []).map((a) => a.Name).join(' / '), fb?.artist),
      album: pick(it.Album, fb?.cleanAlbum),
      albumArtist: pick(it.AlbumArtist, fb?.artist) || null,
      year: it.ProductionYear ?? fb?.year ?? null,
      trackNo: it.IndexNumber ?? null,
      duration: seconds ? Number(seconds.toFixed(3)) : null,
      codec: (it.Container || '').toUpperCase() || null,
      // 码率沿用 gen-meta 的口径：文件总长 ÷ 时长，无损曲目这样最准
      bitrate: size && seconds ? Math.round((size * 8) / seconds / 1000) : (stream?.BitRate ? Math.round(stream.BitRate / 1000) : null),
      sampleRate: stream?.SampleRate ?? null,
      cover,
      // Emby 这一侧没有歌词，明确写 null：前端就不会去试探外挂 .lrc
      lyricsUrl: null,
    }
  }

  console.log('Emby 歌单：')
  const playlists = await fetchPlaylists(uid, new Set(Object.keys(tracks)))
  if (playlists.length === 0) console.log('  （这台 Emby 上没有可用歌单）')

  const fresh = { generatedAt: new Date().toISOString(), tracks, playlists }
  const body = JSON.stringify(fresh, null, 0) + '\n'

  // 内容没变就不重写：generatedAt 每次都不同，不能拿整个文件比对
  let same = false
  if (existsSync(OUT)) {
    try {
      const old = JSON.parse(await readFile(OUT, 'utf8'))
      same =
        JSON.stringify(old.tracks) === JSON.stringify(tracks) &&
        JSON.stringify(old.playlists ?? []) === JSON.stringify(playlists)
    } catch {
      /* 旧文件坏了，直接覆盖 */
    }
  }

  console.log('')
  console.log(`曲目 ${Object.keys(tracks).length} 首 | 缺专辑信息 ${noAlbum} 首（已按目录名兜底）| 缺封面 ${noCover} 首 | 歌单 ${playlists.length} 个`)
  const samples = picked.slice(0, 3)
  for (const it of samples) {
    const t = tracks[embyStreamUrl(String(it.Id))]
    console.log(`  · ${t.artist} — ${t.title}｜${t.album}｜${t.year ?? '—'}｜${t.duration ? Math.round(t.duration) + 's' : '—'}｜${t.bitrate ?? '—'}kbps｜${t.cover ? '有封面' : '无封面'}`)
  }

  if (dry) {
    console.log('\n--dry：未写文件')
    return
  }
  if (same && !limit) {
    console.log('\n内容与现有 emby.json 一致，跳过写入（保留原 generatedAt）')
    return
  }

  await mkdir(COVER_DIR, { recursive: true })
  await writeFile(OUT, body)
  console.log(`\n已写入 public/emby.json（${(body.length / 1024).toFixed(0)}KB）`)

  // 清掉不再被引用的封面，避免改了归属后残留
  const keep = new Set(Object.values(tracks).map((t) => t.cover && path.basename(t.cover)).filter(Boolean))
  let removed = 0
  for (const name of await readdir(COVER_DIR)) {
    if (keep.has(name)) continue
    await unlink(path.join(COVER_DIR, name))
    removed++
  }
  if (removed) console.log(`清理了 ${removed} 张不再引用的封面`)
}

try {
  await main()
} catch (e) {
  // 同步失败不能把已有产物搞坏：仓库里那份快照还能用，只是不再新鲜
  const hasSnapshot = existsSync(OUT)
  console.error(`\nEmby 同步失败：${e.message}`)
  if (hasSnapshot) console.error('保留仓库中已有的 emby.json（内容仍是上一次同步的结果）')
  else process.exitCode = 1
}
