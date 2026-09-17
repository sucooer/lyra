/**
 * 每日推荐的推荐语：从当天这批曲目的真实元数据里提炼出两三句话。
 *
 * 为什么是「算出来」而不是写死或调模型：
 *   1. 这个站点没有后端，daily.json 缺失或过期时前端必须就地现算，并且要和 cron
 *      预生成的那份**逐字一致**（见 lib/daily.ts 开头）—— 文案因此必须是纯函数。
 *   2. 曲库四千首、每天换一批，人工写不过来；调模型要密钥、要配额，而且两次调用
 *      不会给出同一段话，前端现算那条路就复现不了。
 *
 * 所以每句话都由真实统计驱动，措辞从几套模板里按**日期种子**挑：每天不一样，
 * 但同一天在任何环境都是同一段。加一句新话时，也请只写能从元数据里核实的东西。
 *
 * 刻意不写：曲风、情绪、语种（日语除外）、男女声。「深夜抒情」「适合通勤」这类判断
 * 曲库里没有依据（没有 genre 字段），写了就是编。
 *
 * 与 emby.ts / artists.ts 一样会被 Node 脚本用 loadTs() 加载，不能出现浏览器 API。
 */
import { artistKey, simplify, splitArtists } from './artists'

/** 文案取材需要的字段。store 的 Track.meta 与脚本侧的元数据视图都满足这个形状 */
export interface BlurbMeta {
  title?: string
  artist?: string
  album?: string
  year?: number
  /** 秒 */
  duration?: number
}

/** 调用方可以把 app 的展示名规则接进来（见 buildDailyBlurb 的 opts） */
export interface BlurbOptions {
  /**
   * 歌手键 → 展示名。两边都该传 app 自己的规则（store 的 artistLabel /
   * artists.json），这样文案里的名字和歌手页标题是同一个写法。
   * 缺省时退回「当天出现最多的写法」，但仍过一遍简化。
   */
  labelOf?: (key: string) => string | undefined
}

/**
 * 日期 → 稳定的 32 位种子。
 *
 * 这里自带一份而不 import lib/daily.ts 的 dayIndex：daily.ts 要 import 本模块
 * （文案是 DailyPick 的一部分），反过来再 import 就成环了。
 */
function daySeed(date: string): number {
  const [y, m, d] = String(date ?? '').split('-').map(Number)
  if (!y || !m || !d) return 0x5f3a1c
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000) >>> 0
}

/** 从措辞池里按 (种子, 盐) 稳定地取一句；不同盐之间互不相关，各句不会总是一起变 */
function select(pool: string[], seed: number, salt: number): string {
  const h = Math.imul(seed + salt * 7919, 0x01000193) >>> 0
  return pool[h % pool.length]
}

/**
 * 中英混排补空格（「盘古之白」）。
 *
 * 模板里一律不手写空格，最后统一过这一道：`Bandari一个人` → `Bandari 一个人`、
 * `容祖儿一个人` 不动、`出现了11次` → `出现了 11 次`。
 * 只认汉字与英数之间的边界，所以《A》这类括号不会被撑开。
 */
function spacing(s: string): string {
  return s
    .replace(/([\u4e00-\u9fff]) ?([A-Za-z0-9])/g, '$1 $2')
    .replace(/([A-Za-z0-9]) ?([\u4e00-\u9fff])/g, '$1 $2')
}

/** 秒 → 「4 分 32 秒」/「4 分钟」，与界面上的时长写法保持一致 */
function fmtDur(sec: number): string {
  const s = Math.round(sec)
  const m = Math.floor(s / 60)
  const r = s % 60
  return r ? `${m}分${r}秒` : `${m}分钟`
}

/**
 * 日文假名。只认字母部分，刻意排除 ・(U+30FB) 与 ー(U+30FC) —— 它们也在片假名区段里，
 * 但中文标题里同样会出现（「GARNET CROW・謎」这种），拿它们判语种会误伤。
 */
const KANA = /[\u3041-\u3096\u30a1-\u30fa]/

function hasKana(s: string | undefined): boolean {
  return !!s && KANA.test(s)
}

/**
 * 生成当天的推荐语。数据不足时宁可返回空串（界面就不显示这一块），
 * 也不要用「今天有 30 首歌」这种把副标题又说一遍的废话凑数。
 */
export function buildDailyBlurb(tracks: BlurbMeta[], date: string, opts?: BlurbOptions): string {
  const list = (tracks ?? []).filter((t) => !!t)
  const count = list.length
  // 一首歌谈不上「推荐理由」
  if (count < 2) return ''

  const seed = daySeed(date)

  // —— 年份 ——
  const years = list
    .map((t) => t.year)
    .filter((y): y is number => typeof y === 'number' && y >= 1900 && y <= 2100)
  const minYear = years.length ? Math.min(...years) : 0
  const maxYear = years.length ? Math.max(...years) : 0

  // —— 专辑：同名即同一张（大小写不同算一张），展示名取先出现的写法 ——
  const albums = new Map<string, { name: string; n: number }>()
  for (const t of list) {
    const name = (t.album ?? '').trim()
    if (!name) continue
    const hit = albums.get(name.toLowerCase())
    if (hit) hit.n++
    else albums.set(name.toLowerCase(), { name, n: 1 })
  }
  // 出现次数相同时按名字定序，保证任何环境选出的都是同一张
  const topAlbum = [...albums.values()].sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : 1))[0]

  // —— 歌手：按身份键合并（繁简 / 异写 / 联名都算同一个人），联名曲每位各计一次 ——
  const artistN = new Map<string, number>()
  const writings = new Map<string, Map<string, number>>()
  for (const t of list) {
    for (const p of splitArtists(t.artist ?? '')) {
      const k = artistKey(p.name)
      if (!k) continue
      artistN.set(k, (artistN.get(k) ?? 0) + 1)
      const w = writings.get(k) ?? new Map<string, number>()
      w.set(p.name, (w.get(p.name) ?? 0) + 1)
      writings.set(k, w)
    }
  }
  const ranks = [...artistN.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  const topKey = ranks[0]?.[0] ?? ''
  const topN = ranks[0]?.[1] ?? 0
  const distinct = artistN.size

  /** 展示名：优先用调用方的规则（与 app 其它地方一致），否则当天出现最多的写法 */
  const labelOf = (key: string): string => {
    if (!key) return ''
    const fromHook = opts?.labelOf?.(key)
    // 钩子把键本身当名字吐回来（没这条资料时 artistLabel 的兜底）说明查不到，退回本地
    if (fromHook && simplify(fromHook) !== key) return simplify(fromHook)
    const best = [...(writings.get(key) ?? new Map<string, number>())].sort(
      (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
    )[0]?.[0]
    return simplify(best ?? key)
  }
  const topLabel = labelOf(topKey)

  // —— 日语曲目 ——
  const jp = list.filter((t) => hasKana(t.title) || hasKana(t.artist)).length

  // —— 时长 ——
  const durs = list.map((t) => t.duration ?? 0).filter((d) => d > 0)
  const avg = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0
  const longest = list.reduce<BlurbMeta | null>(
    (best, t) => ((t.duration ?? 0) > (best?.duration ?? 0) ? t : best),
    null,
  )

  const parts: string[] = []

  // ① 开场：年代跨度（有年份的曲目过半才谈年代）或专辑张数。
  //    两者都可用时按种子二选一 —— 否则每天开头都是同一个句式（曲库的年代跨度很稳定）。
  let era = ''
  if (years.length >= 2 && years.length / count >= 0.5) {
    const span = maxYear - minYear
    if (span === 0) {
      era = select([`今天全落在${minYear}年。`, `${minYear}年的一年份，全在这里了。`], seed, 1)
    } else if (span >= 20) {
      era = select(
        [
          `从${minYear}到${maxYear}，横跨${span}年。`,
          `${minYear}年的旧藏和${maxYear}年的新作混在一起，前后差${span}年。`,
          `${span}年的距离：最早${minYear}，最新${maxYear}。`,
        ],
        seed,
        1,
      )
    } else if (span >= 8) {
      era = select(
        [
          `年份从${minYear}铺到${maxYear}，跨了${span}年。`,
          `${span}年的跨度，从${minYear}到${maxYear}。`,
          `都落在${minYear}到${maxYear}之间。`,
        ],
        seed,
        1,
      )
    } else {
      era = select([`都挤在${minYear}–${maxYear}这几年里。`, `${minYear}到${maxYear}，年份挨得很近。`], seed, 1)
    }
  }
  const byAlbum =
    albums.size >= 3
      ? select([`这批歌来自${albums.size}张专辑。`, `散在${albums.size}张专辑里。`], seed, 5)
      : ''
  if (era && byAlbum) parts.push(seed % 3 === 0 ? byAlbum : era)
  else parts.push(era || byAlbum)

  // ② 歌手阵容
  if (distinct === 1 && topN >= 2) {
    parts.push(select([`今天从头到尾只有${topLabel}的声音。`, `整份推荐都是${topLabel}。`], seed, 2))
  } else if (topN >= 3) {
    parts.push(
      select(
        [
          `${topLabel}一个人就占了${topN}首。`,
          `${topLabel}出现了${topN}次，是今天出场最多的一位。`,
          `${topN}首都是${topLabel}的。`,
        ],
        seed,
        2,
      ),
    )
  } else if (topN === 2) {
    parts.push(
      select([`${distinct}位歌手，其中一位出现了两次。`, `${distinct}位歌手，只有一位重复。`], seed, 2),
    )
  } else if (distinct >= 3) {
    parts.push(select([`${distinct}位歌手各不相同，没有一个重样。`, `${distinct}位歌手轮流上场。`], seed, 2))
  }

  // ③ 再来一句：候选都够「值得一提」才进池，然后按种子挑一组。
  //    池子为空就只留上面的两句 —— 凑数的第三句不如没有。
  const extras: string[][] = []
  if (jp >= 3) {
    extras.push([`其中${jp}首是日语歌。`, `日语歌占了${jp}首。`])
  }
  if (topAlbum && topAlbum.n >= 2) {
    // 专辑名太长（曲库里真有「Silence: Music - Harmony - Inspiration (With Sounds
    // From Nature)」这种）时不点名，否则一句话全被名字占掉
    extras.push(
      topAlbum.name.length > 18
        ? [`有${topAlbum.n}首来自同一张专辑。`, `其中${topAlbum.n}首来自同一张专辑。`]
        : [
            `《${topAlbum.name}》出现了${topAlbum.n}次。`,
            `有${topAlbum.n}首来自同一张《${topAlbum.name}》。`,
          ],
    )
  }
  if (avg > 0 && (avg >= 300 || avg <= 150)) {
    extras.push([`平均每首${fmtDur(avg)}。`])
  }
  const longestTitle = (longest?.title ?? '').trim()
  if (longest?.duration && longest.duration >= 360 && longestTitle) {
    extras.push([`最长的一首《${longestTitle}》有${fmtDur(longest.duration)}。`])
  }
  if (extras.length) {
    const gi = (Math.imul(seed + 3, 0x01000193) >>> 0) % extras.length
    parts.push(select(extras[gi], seed, 4))
  }

  return spacing(parts.join(''))
}
