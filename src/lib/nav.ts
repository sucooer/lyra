import { computed, ref } from 'vue'
import { usePlayerStore } from '../stores/player'
import { artistKey } from './artists'

/**
 * 页面级导航：首页 ⇄ 歌单详情 / 歌手页 / 专辑页 ⇄ 展开播放页。
 *
 * 关键点：每次「进入下一层」都往浏览器历史压一条记录（pushState），
 * 「返回」统一走 history.back()。这样移动端的侧滑返回、浏览器/系统返回键
 * 回到的都是上一层页面，而不会直接把整个站点退掉。
 *
 * 项目不引路由库，层级用 hash 表示（#/playlist/<id>、#/artist/<歌手>、
 * #/album/<歌手>/<专辑>），静态托管刷新也不会 404。
 */

export type ViewKind = 'home' | 'playlist' | 'artist' | 'album' | 'search'

/** 复合 key 的分隔符：专辑的归属歌手与专辑名可能都含斜杠，用不可见字符分隔最稳 */
const SEP = '\u001f'

export interface ViewRef {
  kind: ViewKind
  /** playlist = 歌单 id；artist = 歌手名；album = `歌手 + SEP + 专辑名` */
  key: string
}

const HOME: ViewRef = { kind: 'home', key: '' }

export const activeView = ref<ViewRef>({ ...HOME })

/** 兼容旧写法：当前在歌单页时的歌单 id，其它页面为 null */
export const activePlaylistId = computed(() =>
  activeView.value.kind === 'playlist' ? activeView.value.key : null,
)
/** 当前歌手页的歌手名 */
export const activeArtist = computed(() =>
  activeView.value.kind === 'artist' ? activeView.value.key : null,
)
/** 当前专辑页的「歌手 + 专辑名」 */
export const activeAlbum = computed(() => {
  if (activeView.value.kind !== 'album') return null
  const [artist, album] = activeView.value.key.split(SEP)
  return { artist, album }
})

/**
 * 专辑 key 里的歌手部分也换成身份键：歌手名经过繁简归一，
 * 老链接（#/artist/張韶涵）与新链接指向的是同一层，不会各开一页。
 */
export function albumKey(artist: string, album: string): string {
  return `${artistKey(artist)}${SEP}${album}`
}

/** 挂在 history.state 上的标记：只有带 lyra 字段的条目才是我们自己压的 */
interface LyraState {
  lyra: true
  /** 层深：0 = 首屏那条记录；>0 说明下面还有一条我们的记录可以退 */
  depth: number
  view: ViewRef
  nowPlaying: boolean
}

function stateOf(): LyraState | null {
  const s = history.state as LyraState | null
  return s && s.lyra === true ? s : null
}

/** 去掉 hash 的当前地址：子页面用 hash 表示，首页不带 hash */
function baseUrl(): string {
  return location.pathname + location.search
}

function urlFor(v: ViewRef): string {
  const base = baseUrl()
  if (v.kind === 'playlist') return `${base}#/playlist/${encodeURIComponent(v.key)}`
  if (v.kind === 'artist') return `${base}#/artist/${encodeURIComponent(v.key)}`
  if (v.kind === 'album') {
    const [artist, album] = v.key.split(SEP)
    return `${base}#/album/${encodeURIComponent(artist)}/${encodeURIComponent(album)}`
  }
  // 搜索词刻意不进 URL：每敲一个字就写一次历史会把返回键淹掉。
  // 词存在 store 里（player.searchQuery），进歌手页再返回时还在。
  if (v.kind === 'search') return `${base}#/search`
  return base
}

function viewFromUrl(): ViewRef {
  const h = location.hash
  let m = /^#\/playlist\/(.+)$/.exec(h)
  if (m) return { kind: 'playlist', key: decodeURIComponent(m[1]) }
  m = /^#\/artist\/(.+)$/.exec(h)
  // 地址栏里手写的老写法（張韶涵）也归一到合并后的键，否则会打开一个空页
  if (m) return { kind: 'artist', key: artistKey(decodeURIComponent(m[1])) }
  m = /^#\/album\/([^/]+)\/(.+)$/.exec(h)
  if (m) return { kind: 'album', key: albumKey(decodeURIComponent(m[1]), decodeURIComponent(m[2])) }
  if (/^#\/search\/?$/.test(h)) return { kind: 'search', key: '' }
  return { ...HOME }
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

/**
 * 入 history 前必须拆成普通对象。
 *
 * activeView 是 ref，读出来的 .value 是 Vue 的响应式 Proxy；而 pushState /
 * replaceState 的状态要走结构化克隆，规范对 Proxy 直接抛 DataCloneError，
 * 于是「点播放条展开」这类调用会静默失败（showNowPlaying 那行根本执行不到）。
 * ViewRef 就两个字符串字段，拷一份最省事。
 */
function plain(v: ViewRef): ViewRef {
  return { kind: v.kind, key: v.key }
}

/** 压入一层 */
function push(view: ViewRef, nowPlaying: boolean) {
  const prev = stateOf()
  const depth = (prev?.depth ?? 0) + 1
  const state: LyraState = { lyra: true, depth, view: plain(view), nowPlaying }
  try {
    history.pushState(state, '', urlFor(view))
  } catch (e) {
    // 历史记录写不进去时别让整个交互哑掉（异常会打断事件处理函数，
    // 后面的 store 赋值就再也执行不到）。退化成改写当前记录，
    // depth 保持原值，这样返回键仍旧退回上一层而不是一路退站。
    console.warn('[nav] pushState 失败，退化为就地改写', e)
    replaceWith({ ...state, depth: prev?.depth ?? 0 })
  }
}

/** 就地改写当前记录（首屏、或没有上一层可退时的兜底） */
function replace(view: ViewRef, nowPlaying: boolean) {
  replaceWith({ lyra: true, depth: 0, view: plain(view), nowPlaying })
}

function replaceWith(state: LyraState) {
  try {
    history.replaceState(state, '', urlFor(state.view))
  } catch (e) {
    console.warn('[nav] replaceState 失败，本次导航不写历史', e)
  }
}

/** 历史状态 → 视图：popstate 与调用方共用这条唯一路径 */
function apply(state: LyraState) {
  activeView.value = state.view
  usePlayerStore().showNowPlaying = state.nowPlaying
}

/** 挂载时调用一次：首屏记录打标记，并接管 popstate（含侧滑返回） */
export function initNav() {
  const v = viewFromUrl()
  activeView.value = v
  replace(v, false)
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
    const v = viewFromUrl()
    replace(v, false)
    activeView.value = v
    usePlayerStore().showNowPlaying = false
  })
}

/** 进入某一层；已在该层则什么都不做 */
function open(view: ViewRef) {
  if (activeView.value.kind === view.kind && activeView.value.key === view.key) return
  push(view, usePlayerStore().showNowPlaying)
  activeView.value = view
}

export function openPlaylist(id: string) {
  open({ kind: 'playlist', key: id })
}

export function openArtist(name: string) {
  open({ kind: 'artist', key: artistKey(name) })
}

export function openAlbum(artist: string, album: string) {
  open({ kind: 'album', key: albumKey(artist, album) })
}

/**
 * 进入搜索页。
 * 已在搜索页时把焦点还给输入框 —— 快捷键（/ 或 Ctrl+K）在页内按也要有反应，
 * 而「已在该层就什么都不做」的 open() 是给不出这个反馈的。
 */
export function openSearch() {
  const player = usePlayerStore()
  const search: ViewRef = { kind: 'search', key: '' }

  if (player.showNowPlaying) {
    /*
     * 全屏播放页是盖住整个界面的模态层（顶栏也被它压住），此时只有快捷键够得着搜索。
     * 若照常 push 一层，搜索页会被压在模态层底下，看起来就是「按了没反应」。
     * 所以这里把它收掉，并且用 replace 把「正在播放」那条记录就地改写成搜索页：
     * 不能用 closeNowPlaying() + open()——back() 是异步的，紧接着的 pushState
     * 会被随后的 popstate 用旧 state 覆盖，两层状态就错位了。
     */
    replace(search, false)
    activeView.value = { ...search }
    player.showNowPlaying = false
  } else if (activeView.value.kind !== 'search') {
    open(search)
  }

  window.dispatchEvent(new CustomEvent('lyra:focus-search'))
}

export function goHome() {
  const s = stateOf()
  if (s && s.depth > 0) {
    // 交给浏览器后退，与系统手势走同一条路径
    back()
    return
  }
  // 深链直接打开的子页面：没有上一层，就地改写成首页
  replace(HOME, false)
  activeView.value = { ...HOME }
}

export function openNowPlaying() {
  const player = usePlayerStore()
  if (player.showNowPlaying) return
  push(activeView.value, true)
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
