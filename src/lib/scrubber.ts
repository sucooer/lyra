import { computed, ref } from 'vue'
import { usePlayerStore } from '../stores/player'

type Player = ReturnType<typeof usePlayerStore>

/**
 * 进度滑轨的拖拽逻辑，迷你播放条与宽屏胶囊条共用。
 *
 * 关键点：拖动过程中只更新「预览比例」，松手才真正 seek。
 * 流式音频每动一下就打一次 range 请求，跟手 seek 会卡成幻灯片。
 */
export function useScrubber(player: Player = usePlayerStore()) {
  const dragRatio = ref<number | null>(null)
  const dragging = computed(() => dragRatio.value !== null)

  function ratioFrom(e: PointerEvent): number {
    const el = e.currentTarget as HTMLElement
    const r = el.getBoundingClientRect()
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  }

  function onDragDown(e: PointerEvent) {
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragRatio.value = ratioFrom(e)
  }
  function onDragMove(e: PointerEvent) {
    if (dragRatio.value === null) return
    dragRatio.value = ratioFrom(e)
  }
  function onDragUp(e: PointerEvent) {
    if (dragRatio.value === null) return
    const r = ratioFrom(e)
    dragRatio.value = null // 先清拖动态再 seek，否则进度条会闪回旧位置
    player.seek(r * player.duration)
  }
  function onDragCancel() {
    dragRatio.value = null
  }

  /** 滑轨显示比例（0-100）：拖动时跟手，否则跟播放进度 */
  const shownPercent = computed(() =>
    dragRatio.value !== null
      ? dragRatio.value * 100
      : player.duration > 0
        ? (player.currentTime / player.duration) * 100
        : 0,
  )

  /** 拖动/点击时用于显示的时间 */
  const shownCurrent = computed(() =>
    dragRatio.value !== null ? dragRatio.value * player.duration : player.currentTime,
  )
  const shownRemain = computed(() => Math.max(0, player.duration - shownCurrent.value))

  return {
    dragging,
    onDragDown,
    onDragMove,
    onDragUp,
    onDragCancel,
    shownPercent,
    shownCurrent,
    shownRemain,
  }
}

/** 播放条里的时间戳：未知时长显示 0:00 而不是「--:--」，条上位置更稳定 */
export function fmtClock(sec: number): string {
  if (!sec || !isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
