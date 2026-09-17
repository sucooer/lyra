/**
 * 全局键盘快捷键
 * 空格: 播放/暂停  ←/→: 快退/快进5s  ↑/↓: 音量  n/p: 下一首/上一首  f: 全屏播放页
 * / 或 ⌘K: 打开搜索（已经在搜索页时由 SearchView 自己把焦点还给输入框）
 */
import type { usePlayerStore } from '../stores/player'
import { openNowPlaying, closeNowPlaying, openSearch } from './nav'

type Store = ReturnType<typeof usePlayerStore>

export function setupShortcuts(player: Store) {
  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return

    if (e.code === 'Slash' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      openSearch()
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
      e.preventDefault()
      openSearch()
      return
    }

    switch (e.code) {
      case 'Space':
        e.preventDefault()
        player.togglePlay()
        break
      case 'ArrowLeft':
        e.preventDefault()
        player.seek(Math.max(0, player.currentTime - 5))
        break
      case 'ArrowRight':
        e.preventDefault()
        player.seek(Math.min(player.duration || 0, player.currentTime + 5))
        break
      case 'ArrowUp':
        e.preventDefault()
        player.setVolume(Math.min(1, player.volume + 0.05))
        break
      case 'ArrowDown':
        e.preventDefault()
        player.setVolume(Math.max(0, player.volume - 0.05))
        break
      case 'KeyN':
        player.next()
        break
      case 'KeyP':
        player.prev()
        break
      case 'KeyF':
        if (!player.currentTrack) break
        // 走导航层而不是直接赋值：展开页也要在浏览器历史里留一层，侧滑返回才能收起它
        if (player.showNowPlaying) closeNowPlaying()
        else openNowPlaying()
        break
    }
  })
}
