import { ref } from 'vue'

/** 极简页面级导航：首页 ⇄ 歌单详情（项目不引路由，两个视图来回切足够） */
export const activePlaylistId = ref<string | null>(null)

export function openPlaylist(id: string) {
  activePlaylistId.value = id
}

export function goHome() {
  activePlaylistId.value = null
}
