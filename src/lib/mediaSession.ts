/**
 * Media Session API：系统级媒体控制（锁屏/通知栏/蓝牙耳机按键）
 * 显示封面、标题、歌手，响应系统播放控制
 */
import type { usePlayerStore } from '../stores/player'

type Store = ReturnType<typeof usePlayerStore>

export function setupMediaSession(player: Store) {
  if (!('mediaSession' in navigator)) return

  navigator.mediaSession.setActionHandler('play', () => player.togglePlay())
  navigator.mediaSession.setActionHandler('pause', () => player.togglePlay())
  navigator.mediaSession.setActionHandler('previoustrack', () => player.prev())
  navigator.mediaSession.setActionHandler('nexttrack', () => player.next())
  navigator.mediaSession.setActionHandler('seekto', (d) => {
    if (d.seekTime !== undefined) player.seek(d.seekTime)
  })
}

export function updateMediaSession(player: Store) {
  if (!('mediaSession' in navigator)) return
  const t = player.currentTrack
  if (!t) return

  const cover = t.meta?.coverUrl
  navigator.mediaSession.metadata = new MediaMetadata({
    title: player.displayTitle,
    artist: player.displayArtist,
    album: t.meta?.album ?? '',
    artwork: cover
      ? [
          { src: cover, sizes: '512x512', type: 'image/jpeg' },
          { src: cover, sizes: '256x256', type: 'image/jpeg' },
        ]
      : [],
  })
  navigator.mediaSession.playbackState = player.playing ? 'playing' : 'paused'
}

export function updatePositionState(player: Store) {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return
  if (!player.duration || !isFinite(player.duration)) return
  try {
    navigator.mediaSession.setPositionState({
      duration: player.duration,
      playbackRate: 1,
      position: Math.min(player.currentTime, player.duration),
    })
  } catch {
    /* ignore */
  }
}
