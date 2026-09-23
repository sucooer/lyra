/**
 * 从 Emby 音乐库生成 public/emby.json（与 meta.json 同形：{ generatedAt, tracks }）。
 *
 * 为什么不走 gen-meta 那套「下载音频分块解析」：
 * Emby 已经把整个库索引好了，一次 Items 查询就能拿到标题 / 艺术家 / 专辑 / 年份 /
 * 轨号 / 时长 / 码率 / 采样率。实测 900 首一分钟内出结果，
 * 而下载解析要跑约半小时、并且要经 Emby 再拉 1.8GB 流量。
 *
 * 封面与歌词都不落盘、不进 git：
 *   早先版本会把封面下载进 public/emby-covers/、歌词解析成 public/emby-lyrics/ 一起提交，
 *   曲库一大就是上千张图 + 上万份歌词 json（一百多 MB）堆在仓库里，clone/CI/部署全变慢。
 *   现在 emby.json 里只写「代理端点地址」（/api/emby/cover?id=…、/api/emby/lyrics?id=…），
 *   前端用到时由服务端去 Emby 现取并透传，密钥不出服务端。
 *   代价是 Emby 不在线时封面/歌词不可用（元数据仍可用，因为 emby.json 本身随仓库提交）。
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
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadTs } from './load-ts.mjs'

// 与前端共用同一份约定。这里不能直接 `import '../src/lib/emby.ts'`：
// Node 的类型擦除要 >= 22.18 才默认开启，而 Cloudflare Pages 的构建镜像是 22.16，
// 直接 import 会让整条构建挂掉（ERR_UNKNOWN_FILE_EXTENSION）。详见 load-ts.mjs。
const {
  embyPlaylistId,
  embyPlaylistSubtitle,
  embyStreamUrl,
  embyCoverUrl,
  embyLyricsUrl,
} = await loadTs(new URL('../src/lib/emby.ts', import.meta.url))

const ROOT = path.resolve(import.meta.dirname, '..')
const OUT = path.join(ROOT, 'public', 'emby.json')

/** 一次问 500 条，够大又不会让单次响应过肥 */
const PAGE = 500

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

/**
 * 服务器前面挂着按 UA / 频率的防护（实测 curl / Emby 这类 UA 会拿到 SPA 的
 * HTML 回退页，Mozilla 或无 UA 放行；拦截还有随机性，偶发直接断连）。
 * CI 上一天一次基本不会触发，本地手动高频跑就容易被盯上。
 * 对策：带常规浏览器 UA；拿到 HTML（<!DOCTYPE 开头）或连接失败时小退避重试。
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms))

async function api(p, extra = '') {
  for (let attempt = 1; ; attempt++) {
    let r
    try {
      r = await fetch(`${BASE}/emby${p}?api_key=${encodeURIComponent(KEY)}${extra}`, {
        headers: { 'User-Agent': UA },
      })
    } catch (e) {
      if (attempt >= 3) throw new Error(`Emby ${p} → 连接失败（${e.cause?.code ?? e.message}）`)
      await sleep(800 * attempt)
      continue
    }
    if (!r.ok) throw new Error(`Emby ${p} → HTTP ${r.status}`)
    const text = await r.text()
    if (text.startsWith('<')) {
      if (attempt >= 3) throw new Error(`Emby ${p} → 返回 HTML（被服务器防护拦截，已重试 3 次）`)
      await sleep(800 * attempt)
      continue
    }
    try {
      return JSON.parse(text)
    } catch {
      if (attempt >= 3) throw new Error(`Emby ${p} → 响应不是 JSON`)
      await sleep(800 * attempt)
    }
  }
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

/**
 * Emby 的「收藏歌曲」→ 一条固定 id 的虚拟歌单。
 *
 * 收藏不是 Playlist 条目，而是条目上的 UserData 标记（截图里 Emby 首页的
 * 「收藏歌曲」就是 Filters=IsFavorite 查询），所以单独查一次。
 * 不限 ParentId、全库查一遍也没关系：trackUrls 只含音乐库内的曲目，
 * 不在曲库里的收藏在这里被天然滤掉 —— 与 fetchPlaylists 的 missing 口径一致。
 * 最新收藏排前面（SortBy=DateCreated），收藏了几首就显示几首。
 */
async function fetchFavorites(uid, trackUrls) {
  const j = await api(
    `/Users/${uid}/Items`,
    '&Recursive=true&IncludeItemTypes=Audio&Filters=IsFavorite' +
      '&SortBy=DateCreated&SortOrder=Descending&Limit=2000',
  )
  const urls = []
  let seconds = 0
  for (const it of j.Items ?? []) {
    const u = embyStreamUrl(String(it.Id))
    if (!trackUrls.has(u)) continue
    urls.push(u)
    seconds += (it.RunTimeTicks ?? 0) / 1e7
  }
  console.log(`  收藏歌曲：${urls.length} 首`)
  if (urls.length === 0) return null
  return {
    id: 'emby-fav',
    title: 'Emby 收藏',
    subtitle: `Emby 收藏 · ${urls.length} 首 · ${Math.max(1, Math.round(seconds / 60))} 分钟`,
    urls,
  }
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
    // 封面归属条目：专辑 id（无专辑时退回曲目父目录 id）。不下载文件，
    // 只写代理端点地址，前端用到时由服务端去 Emby 现取（没有封面时代理回 404，走占位）。
    const owner = String(it.AlbumId || it.ParentId || '')
    const cover = owner ? embyCoverUrl(owner) : null
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
      // 歌词同样不落盘：写成歌词端点地址，前端播放到该曲目时才去取。
      lyricsUrl: embyLyricsUrl(id),
    }
  }

  const trackUrls = new Set(Object.keys(tracks))

  console.log('Emby 收藏：')
  const fav = await fetchFavorites(uid, trackUrls)

  console.log('Emby 歌单：')
  const playlists = await fetchPlaylists(uid, trackUrls)
  if (playlists.length === 0) console.log('  （这台 Emby 上没有可用歌单）')

  // 收藏排在最前：它比手动建的歌单更高频被听
  const allPlaylists = [...(fav ? [fav] : []), ...playlists]

  const fresh = { generatedAt: new Date().toISOString(), tracks, playlists: allPlaylists }
  const body = JSON.stringify(fresh, null, 0) + '\n'

  // 内容没变就不重写：generatedAt 每次都不同，不能拿整个文件比对
  let same = false
  if (existsSync(OUT)) {
    try {
      const old = JSON.parse(await readFile(OUT, 'utf8'))
      same =
        JSON.stringify(old.tracks) === JSON.stringify(tracks) &&
        JSON.stringify(old.playlists ?? []) === JSON.stringify(allPlaylists)
    } catch {
      /* 旧文件坏了，直接覆盖 */
    }
  }

  console.log('')
  console.log(`曲目 ${Object.keys(tracks).length} 首 | 缺专辑信息 ${noAlbum} 首（已按目录名兜底）| 缺封面 ${noCover} 首 | 歌单 ${allPlaylists.length} 个${fav ? '（含收藏）' : ''}`)
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

  await writeFile(OUT, body)
  console.log(`\n已写入 public/emby.json（${(body.length / 1024).toFixed(0)}KB）`)
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
