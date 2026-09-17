/**
 * 每日推荐：按日期从曲库里轮换出当天的歌单。
 *
 * 这个模块是「纯函数 + 不碰浏览器 API」，因为浏览器和 Node 两边共用：
 *   1. 浏览器 stores/player.ts —— 打开页面时取当天推荐；daily.json 缺失或过期时就地现算
 *   2. Node scripts/gen-daily.mjs —— cron 每天预生成 public/daily.json
 * 两边输入相同时结果必须逐字一致（含推荐语，见 lib/blurb.ts）。
 * 依赖只能是同样纯的同目录模块（blurb → artists → t2s）：脚本侧走 scripts/load-ts.mjs
 * 用 esbuild 打包，浏览器侧走 Vite，无后缀 import 两边都能解析；
 * 但不能用 enum / namespace 这类擦不掉的语法。
 *
 * ⚠️ 选歌**需要每位曲目的歌手**（见 lib/artists.ts 的 trackArtistKeys）。调用方必须通过
 * DailyContext.metaOf 把它喂进来：脚本读 meta.json + emby.json，浏览器读 store 里那份合并结果。
 * 两边装出来的曲库集合与歌手字段必须一致 —— 集合差一首，周期长度与相位就全错位。
 * 拿不到歌手时的降级路径见 buildCycle 末尾（退化成「按直链哈希定序 + 连续窗口轮换」）。
 *
 * ── 轮换规则 ────────────────────────────────────────────────
 * 把整个曲库排成一个长度恰好等于曲库曲目数的「周期序列」，第 n 天取其中等分的一段：
 *
 *   L（周期天数）= ceil(曲库 ÷ 每天首数)        4013 首 / 30 首 → 134 天
 *   第 d 天 = seq[round(d·n/L) … round((d+1)·n/L)]   每天 29~30 首，不重不漏、首尾相接
 *
 * 于是：一个周期里每首歌恰好出现一次（同曲最短间隔 = 整个周期，4013 首时是 134 天），
 * 相邻两天的曲目零重合，逛完整个曲库正好走完一个周期。
 *
 * 周期的**内部构造**才是关键：按歌手分层，每位歌手按自己在曲库里的占比匀速被取走
 * （最大亏欠优先，即 Bresenham 式的比例轮换），一次取走一小批（见 ARTIST_BATCH）。
 * 因为速率与占比成正比，所有歌手会在周期末尾**同时耗尽**，不会出现「尾巴上只剩两位大歌手」。
 *
 * 为什么不是「把曲库按哈希排序、取连续一段」（2026-09-17 之前的做法）：
 * 那样等价于随机抽样，而随机抽样的聚集程度远超直觉 —— 实测相邻两首同歌手 33%（随机应 6%）、
 * 一天里同一位歌手最多 11 首、相邻两天的歌手重合 75%。根因是排序用的 FNV-1a 对末位字符
 * 几乎不雪崩，而 Emby 直链是 /api/emby/stream?id=214 这种连号，于是「排序」实际等于
 * 按库内顺序排（同专辑同歌手本来就挨着）。改用雪崩良好的哈希只能把重合从 75% 降到 42%，
 * 真正解决要靠分层：现在每天约 10 位歌手、单日同歌手最多 7 首、相邻两天歌手重合 23%。
 */
import { trackArtistKeys } from './artists'
import { buildDailyBlurb, type BlurbMeta } from './blurb'

/** 歌单 id：会出现在地址栏 #/playlist/daily，改动等于换歌单身份 */
export const DAILY_ID = 'daily'
export const DAILY_TITLE = '每日推荐'
/** 每天的首数上限；曲库不够时按一半取（见 dailySize） */
export const DAILY_MAX = 30

/**
 * 同一位歌手「轮到」时最少带几首 —— 这是整套规则唯一的调性旋钮。
 *
 * 调大：每天出现的歌手更少、歌手的轮换更明显，代价是同一位会在一天里占掉更多位置。
 * 调小：每天出现的歌手更多、听感更接近随机抽样，代价是热门歌手几乎天天露面。
 *
 * 实测（4013 首 / 47 位歌手 / 每天 30 首 / 相邻两天的歌手重合）：
 *   1 → 每天 19 位歌手、重合 35%（约等于按比例抽样，热门歌手天天出现）
 *   2 → 每天 13 位、重合 27%
 *   3 → 每天 10 位、重合 23%   ← 当前
 *   4 → 每天  8 位、重合 22%（但单日同歌手会到 8 首）
 */
const ARTIST_BATCH = 3

/** 日期键：本地时区的 YYYY-MM-DD。用本地而不是 UTC，否则东八区早上 8 点前会算成昨天 */
export function dateKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 日期键 → 天数序号（1970-01-01 起）。按 UTC 解析，避免解析处再叠加一次时区偏移 */
export function dayIndex(key: string): number {
  const [y, m, d] = key.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000)
}

/**
 * 曲目定序用的哈希（cyrb53 一族，与 track.ts 的 stableId 同源）。
 *
 * 关键是**雪崩**：改动末位必须影响高位。旧规则用的 FNV-1a 不满足这一点 ——
 * 它每轮 `h ^= c; h *= prime`，最后一位只参与一次乘法，于是
 * `…?id=728` 与 `…?id=729` 的哈希差恰好是常数 0x01000193（实测），
 * 排序结果等同于按库内顺序排。这里在最后做了两次乘加混合（h ^ h>>>16）。
 */
function hash(s: string): number {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  // 只取 h2 的低 21 位：21 + 32 = 53 位，正好是双精度能精确表示的整数范围，
  // 再宽就会落到 2 的幂次网格上（同一批哈希被抹成同一个数），排序也就不再随机。
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/** mulberry32：小而确定的伪随机，同一种子在任何环境给出同一串数 */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 原地 Fisher–Yates，洗牌序列由种子决定 */
function shuffle<T>(arr: T[], seed: number): T[] {
  const rand = rng(seed)
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
  return arr
}

/**
 * 当天的首数：默认 30 首，但不超过曲库的一半。
 *
 * 上限是给「小曲库」留的：曲库只有 16 首时一次推 16 首，第二天还是这 16 首，
 * 「每日」就没意义了。取一半能让轮换段首尾相接，天天都是全新的一半。
 * 曲库超过 60 首后这个限制就够不着了，固定按 DAILY_MAX 取。
 */
export function dailySize(total: number, max: number = DAILY_MAX): number {
  if (total <= 0) return 0
  return Math.min(max, Math.max(1, Math.ceil(total / 2)))
}

/** 周期长度（天）：一个周期恰好把曲库放一遍 */
export function cycleDays(total: number, count: number): number {
  if (total <= 0 || count <= 0) return 1
  return Math.max(1, Math.ceil(total / count))
}

/** 排一个周期所需的中间状态：一位歌手（或「没有歌手信息」的那一队） */
interface ArtistGroup {
  songs: string[]
  /** 曲目占比，也就是每次轮到时应该被取走的速率 */
  rate: number
  /** 一次轮到带几首 */
  size: number
  done: number
  acc: number
}

/**
 * 把曲库排成周期序列：每位歌手按占比匀速被取走，一次取走一小批。
 *
 * 算法是「最大亏欠优先」：每次所有人按自己的速率累加一分亏欠，谁欠得最多谁先被取走，
 * 取走后按实际取走的首数销账。等价于 Bresenham 比例轮换，所以
 *   - 速率与曲目占比成正比 → 一个周期里所有歌手同时耗尽，尾巴上不会剩下大歌手
 *   - 序列长度恰好等于曲库曲目数 → 按天等分后每天的首数精确（不需要任何配平）
 *
 * size 取 max(batch, ceil(c/L))：后一项保证大歌手一天最多轮一批，
 * 否则 526 首的歌手会在一天里出现两批（8 首），又回到「一天被一两位占掉大半」。
 */
function buildCycle(
  urls: string[],
  ctx: DailyContext,
  count: number,
): { seq: string[]; keyOf: (url: string) => string } {
  const total = urls.length
  const L = cycleDays(total, count)
  const batch = Math.max(1, Math.min(ARTIST_BATCH, Math.floor(count / 3)))

  // 按歌手分组。联名曲记在第一位歌手名下（选歌只需要「别让一个人占太多」，
  // 不像歌手页那样要求联名在双方都算数）。没有歌手信息的曲目合成一队：
  // 若整库都没有（meta.json 丢了），这一队就是全部曲目，退化成按哈希定序。
  const cache = new Map<string, string>()
  const keyOf = (url: string): string => {
    const hit = cache.get(url)
    if (hit !== undefined) return hit
    const key = trackArtistKeys(ctx.metaOf?.(url)?.artist ?? '')[0] ?? ''
    cache.set(url, key)
    return key
  }

  const byKey = new Map<string, string[]>()
  for (const url of urls) {
    const key = keyOf(url)
    const list = byKey.get(key)
    if (list) list.push(url)
    else byKey.set(key, [url])
  }

  const groups: ArtistGroup[] = []
  for (const songs of byKey.values()) {
    // 组内顺序按哈希排：与曲库书写顺序无关，加歌也不会打乱已有曲目的相对顺序
    songs.sort((a, b) => hash(a) - hash(b) || (a < b ? -1 : a > b ? 1 : 0))
    groups.push({
      songs,
      rate: songs.length / total,
      size: Math.max(batch, Math.ceil(songs.length / L)),
      done: 0,
      acc: songs.length / total,
    })
  }
  // 队列顺序必须确定：Map 的插入顺序取决于曲库书写顺序，这里按组大小与首曲哈希固定下来
  groups.sort(
    (a, b) =>
      b.songs.length - a.songs.length ||
      hash(a.songs[0]) - hash(b.songs[0]) ||
      (a.songs[0] < b.songs[0] ? -1 : 1),
  )

  const seq: string[] = []
  let last = 0
  while (seq.length < total) {
    let best: ArtistGroup | null = null
    for (const g of groups) {
      if (g.done >= g.songs.length) continue
      g.acc += g.rate * last
      if (!best || g.acc > best.acc) best = g
    }
    if (!best) break
    const take = Math.min(best.size, best.songs.length - best.done)
    for (let i = 0; i < take; i++) seq.push(best.songs[best.done + i])
    best.done += take
    best.acc -= take
    last = take
  }
  return { seq, keyOf }
}

/**
 * 播放顺序：先把当天这批洗一遍（不然每天都从同一位置听起），
 * 再把同一位歌手的曲目岔开。
 *
 * 分层之后一天的清单里本来就会有某位歌手的 3~4 首，随机洗牌有大约一半的概率
 * 把它们排成相邻的，连着放同一张专辑的歌听感很差。这一步只挪位置，
 * 不改变当天是哪几首 —— 所以浏览器与脚本算出来仍是同一批歌。
 */
function spreadApart(urls: string[], keyOf: (url: string) => string): string[] {
  for (let i = 1; i < urls.length; i++) {
    if (keyOf(urls[i]) !== keyOf(urls[i - 1])) continue
    const j = urls.findIndex((_, k) => k > i && keyOf(urls[k]) !== keyOf(urls[i - 1]))
    if (j < 0) break
    const tmp = urls[i]
    urls[i] = urls[j]
    urls[j] = tmp
  }
  return urls
}

/**
 * 选出某一天的曲目直链。
 * @param urls 曲库全部直链（顺序无所谓，内部会按歌手分层重排）
 * @param date 日期键，缺省今天
 * @param size 首数，缺省按曲库总量自适应（见 dailySize）
 * @param ctx 曲目元数据视图；**必须提供 metaOf**，否则拿不到歌手、选歌退化成按哈希定序
 */
export function pickDaily(
  urls: string[],
  date: string = dateKey(),
  size?: number,
  ctx: DailyContext = {},
): string[] {
  const total = urls.length
  if (total === 0) return []
  const count = Math.min(size && size > 0 ? Math.floor(size) : dailySize(total), total)
  const { seq, keyOf } = buildCycle(urls, ctx, count)
  const L = cycleDays(total, count)
  const day = dayIndex(date)
  const d = ((day % L) + L) % L
  // 等分到天：round 边界保证不重不漏，且首尾相接（最后一天接回第一天）
  const start = Math.round((d * total) / L)
  const end = Math.round(((d + 1) * total) / L)
  return spreadApart(shuffle(seq.slice(start, end), day), keyOf)
}

/** 卡片副标题：9月17日 · 30 首 · 每天更新 */
export function dailySubtitle(date: string, count: number): string {
  const [, m, d] = date.split('-').map(Number)
  return `${m}月${d}日 · ${count} 首 · 每天更新`
}

/** 一份每日推荐（对象形式便于直接写进 daily.json） */
export interface DailyPick {
  /** 生效日期 YYYY-MM-DD */
  date: string
  title: string
  subtitle: string
  /** 推荐语：由当天曲目的真实元数据算出（见 lib/blurb.ts），数据不足时是空串 */
  blurb: string
  urls: string[]
}

/**
 * 生成推荐语所需的外部信息。两边各自把自己手上的那份视图喂进来：
 * 脚本读 meta.json + emby.json + artists.json，浏览器读 store 里已合并好的
 * track.meta 与 artistLabel。
 *
 * metaOf 不只给推荐语用 —— **选歌也靠它拿歌手**（见本文件开头）。所以两边必须
 * 装出同一份曲库与同一套歌手字段，否则同一天的清单会不一样。
 * labelOf 只影响文案措辞，缺了不影响选歌。
 */
export interface DailyContext {
  /** 直链 → 元数据（歌手 / 年份 / 专辑 / 时长） */
  metaOf?: (url: string) => BlurbMeta | undefined
  /** 歌手键 → 展示名，走 app 的统一规则，免得文案里的名字和歌手页标题对不上 */
  labelOf?: (key: string) => string | undefined
}

/**
 * 按同一套规则组装一份每日推荐；服务端写文件、浏览器现算都走这里。
 */
export function buildDaily(
  urls: string[],
  date: string = dateKey(),
  size?: number,
  ctx: DailyContext = {},
): DailyPick {
  const picked = pickDaily(urls, date, size, ctx)
  return {
    date,
    title: DAILY_TITLE,
    subtitle: dailySubtitle(date, picked.length),
    blurb: buildDailyBlurb(
      picked.map((u) => ctx.metaOf?.(u) ?? {}),
      date,
      ctx,
    ),
    urls: picked,
  }
}

/**
 * daily.json 里的直链得能直接喂给 <audio>。
 *
 * 早先曲库只有图床的绝对地址，所以这里只认 http(s)；Emby 曲目用的是站内相对路径
 * （/api/emby/stream?id=…），只认绝对地址会把它们整批滤掉 —— 实测过：923 首的曲库
 * 取 30 首，读文件只剩 1 首（那条手工曲目），而现算路径是对的，两边就不一致了。
 *
 * 相对路径必须是「单个前导斜杠」：//evil.com 是协议相对地址，会被解析成外域，不能放行。
 */
function isPlayableUrl(u: string): boolean {
  return /^https?:\/\//i.test(u) || /^\/(?!\/)/.test(u)
}

/**
 * 校验并归一化 public/daily.json 的内容。
 * 手写或脚本生成的都从这里过一遍；结构不对（缺 urls、日期不是 YYYY-MM-DD）返回 null，
 * 由调用方决定退回现算，而不是把半个对象塞进界面。
 */
export function parseDailyFile(raw: unknown): DailyPick | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const date = typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : null
  if (!date) return null
  const urls = Array.isArray(o.urls)
    ? o.urls.filter((u): u is string => typeof u === 'string' && isPlayableUrl(u))
    : []
  if (urls.length === 0) return null
  const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : DAILY_TITLE
  const subtitle =
    typeof o.subtitle === 'string' && o.subtitle.trim()
      ? o.subtitle.trim()
      : dailySubtitle(date, urls.length)
  // 推荐语可以缺（旧产物、或手写的 daily.json）：前端会拿自己的元数据补算一份
  const blurb = typeof o.blurb === 'string' ? o.blurb.trim() : ''
  return { date, title, subtitle, blurb, urls }
}
