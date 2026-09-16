import { ref } from 'vue'
import { usePlayerStore } from '../stores/player'

/**
 * 页面级导航：首页 ⇄ 歌单详情 ⇄ 展开播放页。
 *
 * 关键点：每次「进入下一层」都往浏览器历史压一条记录（pushState），
 * 「返回」统一走 history.back()。这样移动端的侧滑返回、浏览器/系统返回键
 * 回到的都是上一层页面，而不会直接把整个站点退掉。
 *
 * 项目不引路由库，层级用 hash 表示（#/playlist/<id>），静态托管刷新也不会 404。
 */

export const activePlaylistId = ref<string | null>(null)

/** 挂在 history.state 上的标记：只有带 lyra 字段的条目才是我们自己压的 */
interface LyraState {
  lyra: true
  /** 层深：0 = 首屏那条记录；>0 说明下面还有一条我们的记录可以退 */
  depth: number
  playlist: string | null
  nowPlaying: boolean
}

function stateOf(): LyraState | null {
  const s = history.state as LyraState | null
  return s && s.lyra === true ? s : null
}

/** 去掉 hash 的当前地址：歌单页用 hash 表示，首页不带 hash */
function baseUrl(): string {
  return location.pathname + location.search
}

function urlFor(playlist: string | null): string {
  return playlist ? `${baseUrl()}#/playlist/${encodeURIComponent(playlist)}` : baseUrl()
}

function playlistFromUrl(): string | null {
  const m = /^#\/playlist\/(.+)$/.exec(location.hash)
  return m ? decodeURIComponent(m[1]) : null
}

/** 正在执行 back()：防止连点两次返回把两层一起退掉，popstate 一到就解锁 */
let goingBack = false

function back() {
  if (goingBack) return
  goingBack = true
  history.back()
  // 兜底：万一 popstate 没来（历史被别的逻辑吃掉），别把返回按钮锁死
  setTimeout(() => (goingBack = false), 600)
}

/** 压入一层 */
function push(playlist: string | null, nowPlaying: boolean) {
  const prev = stateOf()
  const state: LyraState = {
    lyra: true,
    depth: (prev?.depth ?? 0) + 1,
    playlist,
    nowPlaying,
  }
  history.pushState(state, '', urlFor(playlist))
}

/** 就地改写当前记录（首屏、或没有上一层可退时的兜底） */
function replace(playlist: string | null, nowPlaying: boolean) {
  const state: LyraState = { lyra: true, depth: 0, playlist, nowPlaying }
  history.replaceState(state, '', urlFor(playlist))
}

/** 历史状态 → 视图：popstate 与调用方共用这条唯一路径 */
function apply(state: LyraState) {
  activePlaylistId.value = state.playlist
  usePlayerStore().showNowPlaying = state.nowPlaying
}

/** 挂载时调用一次：首屏记录打标记，并接管 popstate（含侧滑返回） */
export function initNav() {
  const id = playlistFromUrl()
  activePlaylistId.value = id
  replace(id, false)
  window.addEventListener('popstate', () => {
    goingBack = false
    const s = stateOf()
    if (s) {
      apply(s)
      return
    }
    // 不是我们压的记录：多半是地址栏里手改 hash 这种「同文档跳转」——
    // 浏览器会新建一条 state 为 null 的记录，此时按 URL 反推视图并就地认领它，
    // 否则会出现「地址栏是歌单、页面还停在首页」的错位。
    const id = playlistFromUrl()
    replace(id, false)
    activePlaylistId.value = id
    usePlayerStore().showNowPlaying = false
  })
}

export function openPlaylist(id: string) {
  if (activePlaylistId.value === id) return
  push(id, usePlayerStore().showNowPlaying)
  activePlaylistId.value = id
}

export function goHome() {
  const s = stateOf()
  if (s && s.depth > 0) {
    // 交给浏览器后退，与系统手势走同一条路径
    back()
    return
  }
  // 深链直接打开的歌单页：没有上一层，就地改写成首页
  replace(null, false)
  activePlaylistId.value = null
}

export function openNowPlaying() {
  const player = usePlayerStore()
  if (player.showNowPlaying) return
  push(activePlaylistId.value, true)
  player.showNowPlaying = true
}

export function closeNowPlaying() {
  const s = stateOf()
  if (s && s.nowPlaying && s.depth > 0) {
    back()
    return
  }
  usePlayerStore().showNowPlaying = false
}
