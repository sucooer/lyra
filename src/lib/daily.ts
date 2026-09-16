/**
 * 每日推荐：按日期从曲库里轮换出当天的歌单。
 *
 * 这个模块刻意写成「纯函数 + 零 import」，因为浏览器和 Node 两边共用：
 *   1. 浏览器 stores/player.ts —— 打开页面时取当天推荐；daily.json 缺失或过期时就地现算
 *   2. Node scripts/gen-daily.mjs —— cron 每天预生成 public/daily.json
 * Node 直接跑 .ts 只做类型擦除、不做路径补全，所以这里不能出现无后缀的 import，
 * 也不能用 enum / namespace 这类擦不掉的语法。两边输入相同时结果必须逐字一致。
 *
 * 轮换规则：把曲库按直链哈希排成一个固定顺序，第 n 天取从 (n × 每天首数) 开始的连续一段。
 * 不用「随机抽」是因为随机会隔三差五撞上前几天抽过的，而首尾相接的轮换能让相邻两天
 * 基本不重样（曲库 16 首、每天 12 首时，第二天只有 8 首与前一天重合）。
 */

/** 歌单 id：会出现在地址栏 #/playlist/daily，改动等于换歌单身份 */
export const DAILY_ID = 'daily'
export const DAILY_TITLE = '每日推荐'
/** 每天的首数上限 */
export const DAILY_MAX = 12

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

/** FNV-1a 32 位：只用来给曲库定序，不参与身份识别（那是 track.ts 的 stableId） */
function fnv1a(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * 曲库的固定顺序：与 playlist.json 里的书写顺序无关，
 * 加歌只会把新歌插到它该在的位置，已有曲目的相对顺序不变。
 */
function fixedOrder(urls: string[]): string[] {
  return [...urls].sort((a, b) => fnv1a(a) - fnv1a(b) || (a < b ? -1 : a > b ? 1 : 0))
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
 * 当天的首数：默认 12 首，但不超过曲库的一半。
 * 「每日推荐」的意义在于每天有新鲜感，如果一次推掉大半个曲库（16 首推 12 首），
 * 第二天只能换出 4 首新的；按一半取，轮换段刚好首尾相接，天天都是全新的一半。
 */
export function dailySize(total: number, max: number = DAILY_MAX): number {
  if (total <= 0) return 0
  return Math.min(max, Math.max(1, Math.ceil(total / 2)))
}

/**
 * 选出某一天的曲目直链。
 * @param urls 曲库全部直链（顺序无所谓，内部会定序）
 * @param date 日期键，缺省今天
 * @param size 首数，缺省按曲库总量自适应（见 dailySize）
 */
export function pickDaily(urls: string[], date: string = dateKey(), size?: number): string[] {
  const all = fixedOrder(urls)
  const n = all.length
  if (n === 0) return []
  const count = Math.min(size && size > 0 ? Math.floor(size) : dailySize(n), n)
  const day = dayIndex(date)
  const start = (((day * count) % n) + n) % n
  const picked: string[] = []
  for (let i = 0; i < count; i++) picked.push(all[(start + i) % n])
  // 当天的播放顺序也随日期变：否则每天都从轮换段的同一位置听起，"推荐"感会打折
  return shuffle(picked, day)
}

/** 卡片副标题：9月17日 · 12 首 · 每天更新 */
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
  urls: string[]
}

/** 按同一套文案组装一份每日推荐；服务端写文件、浏览器现算都走这里 */
export function buildDaily(urls: string[], date: string = dateKey(), size?: number): DailyPick {
  const picked = pickDaily(urls, date, size)
  return {
    date,
    title: DAILY_TITLE,
    subtitle: dailySubtitle(date, picked.length),
    urls: picked,
  }
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
    ? o.urls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//i.test(u))
    : []
  if (urls.length === 0) return null
  const title = typeof o.title === 'string' && o.title.trim() ? o.title.trim() : DAILY_TITLE
  const subtitle =
    typeof o.subtitle === 'string' && o.subtitle.trim()
      ? o.subtitle.trim()
      : dailySubtitle(date, urls.length)
  return { date, title, subtitle, urls }
}
