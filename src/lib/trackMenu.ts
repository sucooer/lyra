import { computed, ref } from 'vue'
import type { Track } from '../stores/player'

const MENU_W = 208
const MENU_H = 214

/* 模块级单例状态：整个应用同时只会打开一个「•••」菜单，
   所以不需要每行各养一份弹层（9 行就是 9 个 Teleport）。 */
const openId = ref<string | null>(null)
const target = ref<Track | null>(null)
const pos = ref({ x: 0, y: 0 })

export function useTrackMenu() {
  const isOpen = computed(() => openId.value !== null && target.value !== null)

  /** 在触发按钮下方展开；超出视口时向内收 */
  function open(e: MouseEvent, t: Track) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    pos.value = {
      x: Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8)),
      y: Math.max(8, Math.min(r.bottom + 6, window.innerHeight - MENU_H - 8)),
    }
    target.value = t
    openId.value = t.id
  }

  function close() {
    openId.value = null
    target.value = null
  }

  /** 先取出 id 再关菜单：关菜单会让 target 变 null，回调里就不能再引用它了 */
  function run(action: (id: string) => void) {
    const id = openId.value
    if (!id) return
    close()
    action(id)
  }

  return { open, close, run, isOpen, target, pos, MENU_W, MENU_H }
}
