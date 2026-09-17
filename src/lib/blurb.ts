/**
 * 每日推荐的推荐语。
 *
 * 同一份文案有两条产出路径，共用这里的事实与整理：
 *   1. **模板路** `buildDailyBlurb()` —— 纯函数，从当天曲目的真实元数据里算出来。
 *      站点没有后端，cron 没跑成 / daily.json 过期时前端必须就地现算，所以这条路
 *      必须在任何环境给出同一段话（见 lib/daily.ts 开头）。
 *   2. **模型路** `scripts/lib/blurb-prompt.mjs` + `scripts/lib/ai.mjs` —— 只在 cron 侧
 *      启用（配了密钥才走）。事实清单来自同一个 `blurbFacts()`，产出后同样过 `tidyBlurb()`，
 *      所以两条路写进 daily.json 的形态一致，前端不必区分。
 *
 * 分工：事实归 `blurbFacts()`，措辞各归各的。本模块不认识密钥、网络与浏览器 API，
 * 与 emby.ts / artists.ts 一样会被 Node 脚本用 loadTs() 加载。
 *
 * 模板刻意不写：曲风、情绪、语种（日语除外）、男女声。「深夜抒情」「适合通勤」这类判断
 * 曲库里没有依据（没有 genre 字段），写了就是编 —— 这也是模型路的提示词里反复强调的红线。
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

/** 调用方可以把 app 的展示名规则接进来（见 blurbFacts 的 opts） */
export interface BlurbOptions {
  /**
   * 歌手键 → 展示名。两边都该传 app 自己的规则（store 的 artistLabel /
   * artists.json），这样文案里的名字和歌手页标题是同一个写法。
   * 缺省时退回「当天出现最多的写法」，但仍过一遍简化。
   */
  labelOf?: (key: string) => string | undefined
}

/**
 * 一段文案能用到的全部事实。模板负责挑，模型负责写 —— 两边看到的是同一个数。
 * 没有年份 / 时长这类字段时给 0 或 null，由使用方决定略过。
 */
export interface BlurbFacts {
  /** 有效曲目数（已剔除空项） */
  count: number
  /** 年份：已知年份的最早 / 最晚 / 有几首带年份 */
  yearMin: number
  yearMax: number
  yearKnown: number
  /** 不区分大小写的去重专辑数 */
  albumCount: number
  /** 出现次数最多的专辑（并列时按名字定序，保证任何环境选出的都是同一张） */
  topAlbum: { name: string; n: number } | null
  /** 不同歌手数（按身份键合并，联名每位各计一次） */
  distinctArtists: number
  /** 出现最多的歌手：身份键、展示名、曲目数 */
  topArtistKey: string
  topArtist: string
  topArtistCount: number
  /** 含假名的曲目数 */
  japanese: number
  /** 平均时长（秒），没有时长数据时为 0 */
  avgDuration: number
  /** 平均时长的展示文本，如「4 分 32 秒」。格式化只在这里做一次，模板与提示词共用 */
  avgDurationText: string
  /** 最长的一首（没有时长数据时为 null） */
  longest: { title: string; duration: number; durationText: string } | null
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
 * 中英混排的空白处理（「盘古之白」）。模板与模型两条路的产出都过这一道。
 *
 * 两条方向相反的规则：
 *   · 汉字↔英数**要**有空格：`Bandari一个人` → `Bandari 一个人`、`出现了11次` → `出现了 11 次`。
 *     只认汉字与英数的边界，所以《A》这类括号不会被撑开。
 *   · 汉字↔汉字**不要**有空格：中文正文里没有这种空格，多半是模型写了表情符号、
 *     被 tidyBlurb 摘掉之后留下的（`水汽 🎧 陈奕迅` → `水汽陈奕迅`）。
 *
 * 第二条用的是 `[ \t]+(?=[汉字])` 这种先行断言写法（只匹配空白、不消费下一个字），
 * 否则 `甲 乙 丙` 走一遍全局替换只能修掉第一处 —— 匹配到「甲 乙」后引擎会从「乙」之后继续，
 * 于是「乙 丙」被跳过。
 */
function spacing(s: string): string {
  return s
    .replace(/([\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])/g, '$1')
    .replace(/([\u4e00-\u9fff]) ?([A-Za-z0-9])/g, '$1 $2')
    .replace(/([A-Za-z0-9]) ?([\u4e00-\u9fff])/g, '$1 $2')
}

/** 汉字，用于判断表情符号是不是夹在两句话之间 */
const HAN = /[\u4e00-\u9fff]/

/** 表情符号与装饰符号（箭头、杂项符号、各种 emoji 区段） */
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}]/gu

/** 零宽连接符、变体选择符这类不可见修饰，直接抹掉，它本身不是「表情」 */
const INVISIBLE = /[\u{200B}-\u{200D}\u{FE0E}\u{FE0F}]/gu

/**
 * 文案定稿前的统一整理，模板与模型两条路都过这一道。
 *
 * 模型会带来模板不会有的东西：整段被引号包起来、加粗 / 标题 / 列表符号、换行、
 * 表情符号、中英之间缺空格。都在这里抹平，前端拿到的永远是「一段纯文字」。
 *
 * 顺序有讲究，不能随手调：
 *   · 引号要在空白压平**之后**再剥 —— 模型常把长段落写成多行，而「整段被包住」
 *     这个判断要求首尾引号在同一行。
 *   · 「推荐语：」这种小标题要在剥引号**之后**再摘，因为它可能写在引号外面
 *     （`推荐语 「正文」`）也可能写在里面（`「推荐语：正文」`）。
 */
export function tidyBlurb(raw: string): string {
  let s = String(raw ?? '')
  // ① markdown 痕迹
  s = s
    .replace(/```[a-zA-Z]*/g, '') // 代码围栏
    .replace(/[*_`]/g, '') // 加粗 / 斜体 / 行内代码
  // ② 表情符号：夹在两句之间时当作分隔，补一个逗号 —— 直接删会得到「水汽陈奕迅」这种黏连。
  //    判断时跳过两侧空白：模型写的是「水汽 🎧  陈奕迅」，真正相邻的字是「汽」和「陈」
  s = s.replace(INVISIBLE, '').replace(EMOJI, (m, offset, whole) => {
    const before = whole.slice(0, offset).replace(/[ \t]+$/, '').slice(-1)
    const after = whole.slice(offset + m.length).replace(/^[ \t]+/, '').charAt(0)
    return HAN.test(before) && HAN.test(after) ? '，' : ''
  })
  // ③ 行级痕迹：标题井号、列表符号
  s = s
    .replace(/^[ \t]{0,3}#{1,6}[ \t]*/gm, '')
    .replace(/^[ \t]*[-–—•·][ \t]+/gm, '')
  // ④ 文案是一段，不保留分行。全角标点两侧都不该有空格 —— 表情符号被摘掉后，
  //    它原来占的位置留下一两个空格，压平之后会变成「水汽， 陈奕迅」这种
  s = s
    .replace(/\s+/g, ' ')
    .replace(/[ \t]+(?=[，。！？；：、）》」』…])/g, '')
    .replace(/(?<=[，。！？；：、（《「『…])[ \t]+/g, '')
    .trim()
  // ⑤ 小标题与整段引号会互相嵌套（`推荐语 「正文」` 或 `「推荐语：正文」`），
  //    两件事各做两轮，先后顺序就无关紧要了
  for (let i = 0; i < 2; i++) {
    s = s.replace(/^(?:推荐语|导语|推荐文案|每日推荐|文案)\s*[:：]?\s*/, '')
    // 《》不在此列：那是书名号，属于正文
    s = s.replace(/^[「『“”‘’"']+\s*([\s\S]*?)\s*[」』“”‘’"']+$/u, '$1')
    s = s.trim()
  }
  return spacing(s)
}

/** 秒 → 「4 分 32 秒」/「4 分钟」，与界面上的时长写法保持一致 */
function fmtDur(sec: number): string {
  const s = Math.round(sec)
  const m = Math.floor(s / 60)
  const r = s % 60
  return r ? `${m}分${r}秒` : `${m}分钟`
}

/**
 * 一整条 artist 字段的展示写法：逐字归一成简体，分隔符照旧（「阿悄, 庄心妍 & 王麟」）。
 *
 * 与 store 的 artistText / artistLabel 同一套规则。不要省这一步：曲库里同一位歌手在不同
 * 专辑里可能标成「容祖兒」和「容祖儿」，提示词里若照原样铺出去，模型会在同一段话里
 * 把一个人写成两种字；而界面上曲名 / 专辑名是照原样显示的（只有歌手名归一），
 * 所以这里也只动歌手名，别顺手把标题也改了。
 */
export function artistDisplay(raw: string): string {
  return simplify(String(raw ?? '').trim())
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
 * 把当天这批曲目归纳成一份事实。模板与模型都从这里取材 ——
 * 各算一套的话，两边对「出现最多的歌手是谁」都可能给出不同答案。
 */
export function blurbFacts(tracks: BlurbMeta[], opts?: BlurbOptions): BlurbFacts {
  const list = (tracks ?? []).filter((t) => !!t)
  const count = list.length

  const years = list
    .map((t) => t.year)
    .filter((y): y is number => typeof y === 'number' && y >= 1900 && y <= 2100)

  // 专辑：同名即同一张（大小写不同算一张），展示名取先出现的写法
  const albums = new Map<string, { name: string; n: number }>()
  for (const t of list) {
    const name = (t.album ?? '').trim()
    if (!name) continue
    const hit = albums.get(name.toLowerCase())
    if (hit) hit.n++
    else albums.set(name.toLowerCase(), { name, n: 1 })
  }
  // 出现次数相同时按名字定序，保证任何环境选出的都是同一张
  const topAlbum = [...albums.values()].sort((a, b) => b.n - a.n || (a.name < b.name ? -1 : 1))[0] ?? null

  // 歌手：按身份键合并（繁简 / 异写 / 联名都算同一个人），联名曲每位各计一次
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
  const topArtistKey = ranks[0]?.[0] ?? ''

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

  const durs = list.map((t) => t.duration ?? 0).filter((d) => d > 0)
  const avgDuration = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : 0
  const longestTrack = list.reduce<BlurbMeta | null>(
    (best, t) => ((t.duration ?? 0) > (best?.duration ?? 0) ? t : best),
    null,
  )

  return {
    count,
    yearMin: years.length ? Math.min(...years) : 0,
    yearMax: years.length ? Math.max(...years) : 0,
    yearKnown: years.length,
    albumCount: albums.size,
    topAlbum,
    distinctArtists: artistN.size,
    topArtistKey,
    topArtist: labelOf(topArtistKey),
    topArtistCount: ranks[0]?.[1] ?? 0,
    japanese: list.filter((t) => hasKana(t.title) || hasKana(t.artist)).length,
    avgDuration,
    avgDurationText: avgDuration > 0 ? fmtDur(avgDuration) : '',
    longest: longestTrack?.duration
      ? {
          title: (longestTrack.title ?? '').trim(),
          duration: longestTrack.duration,
          durationText: fmtDur(longestTrack.duration),
        }
      : null,
  }
}

/**
 * 模板路：生成当天的推荐语。数据不足时宁可返回空串（界面就不显示这一块），
 * 也不要用「今天有 30 首歌」这种把副标题又说一遍的废话凑数。
 */
export function buildDailyBlurb(tracks: BlurbMeta[], date: string, opts?: BlurbOptions): string {
  const f = blurbFacts(tracks, opts)
  // 一首歌谈不上「推荐理由」
  if (f.count < 2) return ''

  const seed = daySeed(date)
  const parts: string[] = []

  // ① 开场：年代跨度（有年份的曲目过半才谈年代）或专辑张数。
  //    两者都可用时按种子二选一 —— 否则每天开头都是同一个句式（曲库的年代跨度很稳定）。
  let era = ''
  if (f.yearKnown >= 2 && f.yearKnown / f.count >= 0.5) {
    const span = f.yearMax - f.yearMin
    if (span === 0) {
      era = select([`今天全落在${f.yearMin}年。`, `${f.yearMin}年的一年份，全在这里了。`], seed, 1)
    } else if (span >= 20) {
      era = select(
        [
          `从${f.yearMin}到${f.yearMax}，横跨${span}年。`,
          `${f.yearMin}年的旧藏和${f.yearMax}年的新作混在一起，前后差${span}年。`,
          `${span}年的距离：最早${f.yearMin}，最新${f.yearMax}。`,
        ],
        seed,
        1,
      )
    } else if (span >= 8) {
      era = select(
        [
          `年份从${f.yearMin}铺到${f.yearMax}，跨了${span}年。`,
          `${span}年的跨度，从${f.yearMin}到${f.yearMax}。`,
          `都落在${f.yearMin}到${f.yearMax}之间。`,
        ],
        seed,
        1,
      )
    } else {
      era = select(
        [`都挤在${f.yearMin}–${f.yearMax}这几年里。`, `${f.yearMin}到${f.yearMax}，年份挨得很近。`],
        seed,
        1,
      )
    }
  }
  const byAlbum =
    f.albumCount >= 3
      ? select([`这批歌来自${f.albumCount}张专辑。`, `散在${f.albumCount}张专辑里。`], seed, 5)
      : ''
  if (era && byAlbum) parts.push(seed % 3 === 0 ? byAlbum : era)
  else parts.push(era || byAlbum)

  // ② 歌手阵容
  if (f.distinctArtists === 1 && f.topArtistCount >= 2) {
    parts.push(
      select([`今天从头到尾只有${f.topArtist}的声音。`, `整份推荐都是${f.topArtist}。`], seed, 2),
    )
  } else if (f.topArtistCount >= 3) {
    parts.push(
      select(
        [
          `${f.topArtist}一个人就占了${f.topArtistCount}首。`,
          `${f.topArtist}出现了${f.topArtistCount}次，是今天出场最多的一位。`,
          `${f.topArtistCount}首都是${f.topArtist}的。`,
        ],
        seed,
        2,
      ),
    )
  } else if (f.topArtistCount === 2) {
    parts.push(
      select(
        [`${f.distinctArtists}位歌手，其中一位出现了两次。`, `${f.distinctArtists}位歌手，只有一位重复。`],
        seed,
        2,
      ),
    )
  } else if (f.distinctArtists >= 3) {
    parts.push(
      select(
        [`${f.distinctArtists}位歌手各不相同，没有一个重样。`, `${f.distinctArtists}位歌手轮流上场。`],
        seed,
        2,
      ),
    )
  }

  // ③ 再来一句：候选都够「值得一提」才进池，然后按种子挑一组。
  //    池子为空就只留上面的两句 —— 凑数的第三句不如没有。
  const extras: string[][] = []
  if (f.japanese >= 3) {
    extras.push([`其中${f.japanese}首是日语歌。`, `日语歌占了${f.japanese}首。`])
  }
  if (f.topAlbum && f.topAlbum.n >= 2) {
    // 专辑名太长（曲库里真有「Silence: Music - Harmony - Inspiration (With Sounds
    // From Nature)」这种）时不点名，否则一句话全被名字占掉
    extras.push(
      f.topAlbum.name.length > 18
        ? [`有${f.topAlbum.n}首来自同一张专辑。`, `其中${f.topAlbum.n}首来自同一张专辑。`]
        : [
            `《${f.topAlbum.name}》出现了${f.topAlbum.n}次。`,
            `有${f.topAlbum.n}首来自同一张《${f.topAlbum.name}》。`,
          ],
    )
  }
  if (f.avgDuration > 0 && (f.avgDuration >= 300 || f.avgDuration <= 150)) {
    extras.push([`平均每首${f.avgDurationText}。`])
  }
  if (f.longest && f.longest.duration >= 360 && f.longest.title) {
    extras.push([`最长的一首《${f.longest.title}》有${f.longest.durationText}。`])
  }
  if (extras.length) {
    const gi = (Math.imul(seed + 3, 0x01000193) >>> 0) % extras.length
    parts.push(select(extras[gi], seed, 4))
  }

  return tidyBlurb(parts.join(''))
}
