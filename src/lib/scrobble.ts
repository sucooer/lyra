import { ref } from 'vue'
import { splitArtists } from './artists'
import { trackTitle } from './track'
import { usePlayerStore, type Track } from '../stores/player'

/**
 * 把本机的播放同步到 Last.fm（now playing + scrobble 收听记录）。
 *
 * 为什么走自己的 /api/lastfm 而不是直接打 Last.fm：
 *   scrobble 的 api_sig 必须用 API secret 签名，而本站是公开的 —— secret 一旦进前端
 *   就等于公开（任何人都能冒充本站往别人的账号写记录）。所以签名只在服务端做，
 *   见 functions/_lib/lastfm.js。
 *
 * 授权（只需一次，在站点上点按钮完成）：
 *   点「连接 Last.fm」→ /api/lastfm/auth 给出授权地址 → 用户在 Last.fm 点「允许」
 *   → 回到 /api/lastfm/callback → 服务端把 token 换成 session key 写进本站 localStorage。
 *   所以环境变量只需要 key + secret 两个，session key 由浏览器自己持有并随请求带上。
 *
 * Last.fm 的计入规则（不满足就不会出现在收听记录里，所以本地先判一道）：
 *   实听 ≥ 30 秒，且（实听 ≥ 曲目时长的 50% 或 实听 ≥ 4 分钟）。
 * 上报时机：条件满足的那一刻就报，不等播完 —— 中途关掉页面也不丢。
 * 时间戳取「开始播放」的时刻（Last.fm 要求是过去的秒级时间戳）。
 *
 * 离线：上报失败就进 localStorage 队列，下次启动 / 网络恢复时补发。
 */

const QUEUE_KEY = 'lyra.scrobble.queue'
/** 授权结果：{ sk, user }。sk 只在本浏览器里，不发往别处（请求时带给自己的端点） */
const SESSION_KEY = 'lyra.lastfm'
/** 想临时关掉：localStorage.setItem('lyra.scrobble', 'off') */
const OFF_KEY = 'lyra.scrobble'
const MIN_SECONDS = 30
const MAX_SECONDS = 240
const MAX_QUEUE = 500

/** 已连接的 Last.fm 用户名；空串 = 未连接（给界面用） */
export const lastfmUser = ref('')

/** 一首待上报的曲目（字段都是 Last.fm 要的形状） */
interface Scrobble {
  artist: string
  track: string
  album?: string
  duration?: number
  timestamp: number
}

interface Session {
  sk: string
  user: string
}

export function readSession(): Session | null {
  try {
    const p = JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') as Session | null
    return p && typeof p.sk === 'string' && p.sk ? { sk: p.sk, user: String(p.user ?? '') } : null
  } catch {
    return null
  }
}

export function disconnectLastfm(): void {
  try {
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(QUEUE_KEY)
  } catch {
    /* ignore */
  }
  lastfmUser.value = ''
}

/** 拉取授权地址并跳过去；失败时把原因交给调用方显示 */
export async function connectLastfm(): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`/api/lastfm/auth?origin=${encodeURIComponent(location.origin)}`)
    const j = (await r.json().catch(() => null)) as { ok?: boolean; authUrl?: string; error?: string } | null
    if (!r.ok || !j?.authUrl) return { ok: false, error: j?.error ?? `服务端返回 HTTP ${r.status}` }
    location.href = j.authUrl
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e) }
  }
}

function killed(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) === 'off'
  } catch {
    return false
  }
}

/** 能干活的前提：已授权 + 没被手动关掉 */
function ready(): Session | null {
  if (killed()) return null
  return readSession()
}

function readQueue(): Scrobble[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x) => x && x.artist && x.track && x.timestamp) : []
  } catch {
    return []
  }
}

function writeQueue(q: Scrobble[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-MAX_QUEUE)))
  } catch {
    /* 隐私模式 / 配额满：这一条就丢了，不值得让播放出问题 */
  }
}

async function post(body: Record<string, unknown>): Promise<{ ok?: boolean; error?: string }> {
  const s = readSession()
  if (!s) throw new Error('未连接 Last.fm')
  const r = await fetch('/api/lastfm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, sk: s.sk }),
  })
  const json = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null
  if (!r.ok) throw new Error(json?.error ?? `HTTP ${r.status}`)
  return json ?? {}
}

let flushing = false

/** 把队列里的记录发出去（每批最多 50 首，Last.fm 的单次上限） */
export async function flushQueue(): Promise<void> {
  if (flushing || !ready()) return
  flushing = true
  try {
    for (;;) {
      const q = readQueue()
      if (!q.length) break
      const batch = q.slice(0, 50)
      const r = await post({ action: 'scrobble', scrobbles: batch })
      if (!r.ok) break
      // 只去掉刚发出去的那批：发送期间可能有新记录入队
      writeQueue(readQueue().slice(batch.length))
    }
  } catch {
    /* 网络不通就留着，下次再试 */
  } finally {
    flushing = false
  }
}

function enqueue(s: Scrobble): void {
  if (!ready()) return
  const q = readQueue()
  q.push(s)
  writeQueue(q)
  void flushQueue()
}

/** now playing 只在「此刻」有意义，失败不重试（重试就过时了） */
async function sendNowPlaying(s: Scrobble): Promise<void> {
  if (!ready()) return
  try {
    await post({ action: 'nowplaying', now: { ...s, timestamp: undefined } })
  } catch {
    /* 静默：now playing 丢一两条无所谓 */
  }
}

/** 够不够计一次收听 */
function meets(listened: number, duration?: number): boolean {
  if (listened < MIN_SECONDS) return false
  if (duration && duration > 0) return listened >= duration * 0.5 || listened >= MAX_SECONDS
  // 没有时长信息时只能按「听满 4 分钟」这条判
  return listened >= MAX_SECONDS
}

/** 曲目 → 上报用的字段。歌手取第一位并走展示名（与界面显示一致，也避开繁简差异） */
function toScrobble(t: Track, player: ReturnType<typeof usePlayerStore>, timestamp: number): Scrobble | null {
  const raw = t.meta?.artist ?? ''
  const first = splitArtists(raw)[0]?.name
  const artist = first ? player.artistLabel(first) : ''
  const track = trackTitle(t)
  if (!artist || !track) return null
  const s: Scrobble = { artist, track, timestamp: Math.round(timestamp) }
  const album = t.meta?.album
  if (album) s.album = album
  const duration = t.meta?.duration
  if (duration && duration > 0) s.duration = Math.round(duration)
  return s
}

/**
 * 挂到播放器上。App 挂载时调一次即可。
 * audio 元素由 store 的 initAudio() 创建，这里拿不到就重试几拍（调用顺序不该成为暗坑）。
 */
export function initScrobble(): void {
  const player = usePlayerStore()
  lastfmUser.value = readSession()?.user ?? ''

  let cur: Scrobble | null = null
  let curId = ''
  let listened = 0
  let startedAt = 0
  let reported = false
  let npSent = false
  let lastPos = 0

  /** 结束当前曲目的统计：够条件且还没报过就入队 */
  function finalize(): void {
    if (cur && !reported && meets(listened, cur.duration)) {
      enqueue(cur)
      reported = true
    }
    cur = null
    curId = ''
    listened = 0
    npSent = false
    reported = false
  }

  function startTrack(t: Track, pos: number): void {
    finalize()
    const s = toScrobble(t, player, Date.now() / 1000)
    cur = s
    curId = t.id
    startedAt = Date.now() / 1000
    listened = 0
    reported = false
    lastPos = pos
    if (s) {
      npSent = true
      void sendNowPlaying(s)
    }
  }

  function maybeScrobble(): void {
    if (!cur || reported) return
    if (!meets(listened, cur.duration)) return
    enqueue({ ...cur, timestamp: Math.round(startedAt) })
    reported = true
  }

  function onPlay(): void {
    const a = player.audio
    const t = player.currentTrack
    if (!a || !t) return
    if (t.id !== curId) startTrack(t, a.currentTime)
  }

  function onTime(): void {
    const a = player.audio
    if (!a) return
    const t = player.currentTrack
    // 换曲但没触发 play（切歌后暂停着）也要把上一首结算掉
    if (t && t.id !== curId) {
      startTrack(t, a.currentTime)
      return
    }
    if (a.paused) {
      lastPos = a.currentTime
      return
    }
    const delta = a.currentTime - lastPos
    lastPos = a.currentTime
    // 超过 5 秒的跳变当作拖动进度，不计入实听
    if (delta > 0 && delta < 5) listened += delta
    maybeScrobble()
  }

  function attach(): boolean {
    const a = player.audio as HTMLAudioElement | undefined
    if (!a) return false
    a.addEventListener('play', onPlay)
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('ended', finalize)
    return true
  }

  if (!attach()) {
    let tries = 0
    const timer = setInterval(() => {
      if (attach() || ++tries > 20) clearInterval(timer)
    }, 250)
  }

  // 上次没发出去的记录，启动时就补
  void flushQueue()
  window.addEventListener('online', () => void flushQueue())
}
