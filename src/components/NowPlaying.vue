<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { usePlayerStore } from '../stores/player'
import LyricsView from './LyricsView.vue'
import { resolvedDark } from '../lib/theme'
import { closeNowPlaying } from '../lib/nav'

const player = usePlayerStore()
const showLyrics = ref(false)
const bgColor = ref('rgb(30,30,32)')

/** 拖动中的预览比例（null = 未在拖动）；松手才真正 seek */
const dragRatio = ref<number | null>(null)

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
  if (dragRatio.value !== null) dragRatio.value = ratioFrom(e)
}
function onDragUp(e: PointerEvent) {
  if (dragRatio.value === null) return
  player.seek(ratioFrom(e) * player.duration)
  dragRatio.value = null
}
function onDragCancel() {
  dragRatio.value = null
}

/** 音量滑条：官方同样是一条粗圆角实心条，没有原生 range 的外观 */
const volumeDrag = ref<number | null>(null)
const shownVolume = computed(() => (volumeDrag.value !== null ? volumeDrag.value : player.volume))

function volFrom(e: PointerEvent): number {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
}
function onVolDown(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  volumeDrag.value = volFrom(e)
  player.setVolume(volumeDrag.value)
}
function onVolMove(e: PointerEvent) {
  if (volumeDrag.value === null) return
  volumeDrag.value = volFrom(e)
  player.setVolume(volumeDrag.value)
}
function onVolUp() {
  volumeDrag.value = null
}

const shownProgress = computed(() =>
  dragRatio.value !== null ? dragRatio.value * 100 : progress.value,
)
const shownCurrent = computed(() =>
  dragRatio.value !== null ? dragRatio.value * player.duration : player.currentTime,
)

/** 从封面提取主色调（canvas 平均色，Apple Music 风格背景） */
async function extractColor(src: string) {
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = src
    await img.decode()
    const canvas = document.createElement('canvas')
    const size = 32
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, size, size)
    const { data } = ctx.getImageData(0, 0, size, size)
    let r = 0, g = 0, b = 0
    const n = data.length / 4
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]; g += data[i + 1]; b += data[i + 2]
    }
    r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n)
    // 调暗并保证不太亮；浅色模式下只压一档，得到 Apple Music 那种淡色底
    const dim = resolvedDark.value ? 0.55 : 0.9
    bgColor.value = `rgb(${Math.round(r * dim)},${Math.round(g * dim)},${Math.round(b * dim)})`
  } catch {
    bgColor.value = 'rgb(30,30,32)'
  }
}

const cover = computed(() => player.currentTrack?.meta?.coverUrl)
watch(cover, (c) => c && extractColor(c), { immediate: true })
// 主题切换后重取主色调，浅色/深色的压暗档位不同
watch(resolvedDark, () => cover.value && extractColor(cover.value))

const progress = computed(() =>
  player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0,
)

function fmt(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
</script>

<template>
  <!-- h-[100dvh] 而非 inset-0：移动端浏览器底部工具栏会盖住 100vh 的最后一截，
       dvh 跟随可视视口，进度条时间不再被裁 -->
  <div class="fixed inset-x-0 top-0 z-50 flex h-[100dvh] flex-col overflow-hidden">
    <!-- 背景：封面主色调 + 模糊层 -->
    <div
      class="absolute inset-0 transition-colors duration-1000"
      :style="{ backgroundColor: bgColor }"
    ></div>
    <img
      v-if="cover"
      :src="cover"
      class="absolute inset-0 w-full h-full object-cover blur-3xl opacity-40 scale-125 transition-opacity duration-700"
    />
    <div class="absolute inset-0 bg-np-scrim"></div>

    <!-- 顶栏：收起 / 标题 / 歌词开关 -->
    <div class="relative z-10 flex items-center justify-between px-5 md:px-8 pt-5">
      <button
        class="w-9 h-9 rounded-full bg-np-btn hover:bg-np-fill flex items-center justify-center transition"
        @click="closeNowPlaying()"
        title="收起"
      >
        <svg viewBox="0 0 24 24" class="w-5 h-5 fill-current"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
      </button>
      <div class="text-xs uppercase tracking-widest text-np-muted">
        {{ showLyrics ? '歌词' : '正在播放' }}
      </div>
      <button
        class="w-9 h-9 rounded-full flex items-center justify-center transition"
        :class="showLyrics ? 'text-music' : 'text-np-muted hover:text-np-fg'"
        @click="showLyrics = !showLyrics"
        title="歌词"
      >
        <svg viewBox="0 0 24 24" class="w-6 h-6 fill-current"><path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/></svg>
      </button>
    </div>

    <!-- 封面视图 -->
    <div
      v-if="!showLyrics"
      class="relative z-10 flex-1 min-h-0 flex flex-col overflow-y-auto px-6 md:px-14 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
    >
      <!-- my-auto：内容放得下时垂直居中，放不下时可滚动且不裁顶 -->
      <div class="w-full max-w-md mx-auto my-auto">
        <div
          class="aspect-square w-full max-w-[220px] sm:max-w-[300px] md:max-w-[420px] mx-auto rounded-2xl overflow-hidden shadow-2xl shadow-black/60 transition-transform duration-500"
          :class="player.playing ? 'scale-100' : 'scale-90'"
        >
          <img v-if="cover" :src="cover" class="w-full h-full object-cover" />
          <div v-else class="w-full h-full bg-np-btn flex items-center justify-center text-7xl text-np-fill">♪</div>
        </div>

        <div class="mt-6 text-center">
          <div class="text-xl md:text-2xl font-bold truncate">{{ player.displayTitle }}</div>
          <div class="text-base md:text-lg text-np-muted truncate mt-0.5">
            {{ player.displayArtist }}
            <template v-if="player.currentTrack?.meta?.album"> — {{ player.currentTrack.meta.album }}</template>
          </div>
        </div>

        <!-- 进度（官方：粗圆角实心条，无圆点；支持点击与拖动，松手生效） -->
        <div class="mt-6 touch-none select-none" @pointerdown="onDragDown" @pointermove="onDragMove" @pointerup="onDragUp" @pointercancel="onDragCancel">
          <div class="relative h-4 flex items-center cursor-pointer">
            <div class="absolute inset-x-0 h-2 rounded-full bg-np-fill">
              <div class="h-full rounded-full bg-np-fg" :style="{ width: shownProgress + '%' }"></div>
            </div>
          </div>
          <div class="flex justify-between mt-1.5 text-[17px] font-medium text-np-fg/70 tabular-nums">
            <span>{{ fmt(shownCurrent) }}</span>
            <span>-{{ fmt(Math.max(0, player.duration - shownCurrent)) }}</span>
          </div>
        </div>

        <!-- 控制：官方为 ◀◀ / ▶(⏸) / ▶▶ 三个纯色大按钮，无圆底、无竖条 -->
        <div class="mt-5 flex items-center justify-center gap-5 sm:gap-9">
          <button
            class="transition shrink-0"
            :class="player.shuffle ? 'text-music' : 'text-np-muted hover:text-np-fg'"
            @click="player.shuffle = !player.shuffle"
            title="随机播放"
          >
            <svg viewBox="0 0 24 24" class="w-5 h-5 fill-current"><path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
          </button>

          <!-- ◀◀ 上一首：双三角 -->
          <button class="text-np-fg transition hover:opacity-70 active:opacity-50" @click="player.prev" title="上一首">
            <svg viewBox="0 0 24 24" class="w-10 h-10 fill-current" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
              <path d="M21.5 5v14L12 12zM13 5v14l-9.5-7z" />
            </svg>
          </button>

          <!-- ▶ / ⏸ 播放暂停：单个大三角，无圆形底 -->
          <button
            class="text-np-fg transition hover:opacity-80 active:scale-95 shrink-0"
            @click="player.togglePlay"
            :title="player.playing ? '暂停' : '播放'"
          >
            <svg
              v-if="!player.playing"
              viewBox="0 0 24 24"
              class="w-16 h-16 fill-current"
              stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"
            >
              <path d="M6 4.5v15L19 12z" />
            </svg>
            <svg
              v-else
              viewBox="0 0 24 24"
              class="w-16 h-16 fill-current"
              stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"
            >
              <path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" />
            </svg>
          </button>

          <!-- ▶▶ 下一首：双三角 -->
          <button class="text-np-fg transition hover:opacity-70 active:opacity-50" @click="player.next()" title="下一首">
            <svg viewBox="0 0 24 24" class="w-10 h-10 fill-current" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
              <path d="M2.5 5v14L12 12zM11 5v14l9.5-7z" />
            </svg>
          </button>

          <button
            class="transition shrink-0"
            :class="player.repeat !== 'off' ? 'text-music' : 'text-np-muted hover:text-np-fg'"
            @click="player.cycleRepeat"
            title="循环模式"
          >
            <svg v-if="player.repeat !== 'one'" viewBox="0 0 24 24" class="w-5 h-5 fill-current"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
            <svg v-else viewBox="0 0 24 24" class="w-5 h-5 fill-current"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/></svg>
          </button>
        </div>

        <!-- 音量（窄屏隐藏，避免挤压纵向空间）：左右喇叭图标 + 同款粗圆角条 -->
        <div class="hidden sm:flex mt-6 items-center gap-3">
          <svg viewBox="0 0 24 24" class="w-5 h-5 fill-np-fg shrink-0"><path d="M3 9v6h4l5 5V4L7 9H3z"/></svg>
          <div
            class="flex-1 h-4 flex items-center touch-none select-none cursor-pointer"
            @pointerdown="onVolDown"
            @pointermove="onVolMove"
            @pointerup="onVolUp"
            @pointercancel="onVolUp"
          >
            <div class="relative w-full h-2 rounded-full bg-np-fill">
              <div class="h-full rounded-full bg-np-fg" :style="{ width: shownVolume * 100 + '%' }"></div>
            </div>
          </div>
          <svg viewBox="0 0 24 24" class="w-6 h-6 fill-np-fg shrink-0"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.47 4.47 0 0 0 16.5 12zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
        </div>
      </div>
    </div>

    <!-- 歌词视图（全屏滚动，底部保留进度条） -->
    <div v-else class="relative z-10 flex-1 min-h-0 flex flex-col pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <LyricsView class="flex-1 min-h-0" />
      <div class="px-6 md:px-14 pt-3 shrink-0 touch-none select-none" @pointerdown="onDragDown" @pointermove="onDragMove" @pointerup="onDragUp" @pointercancel="onDragCancel">
        <div class="flex items-center gap-3">
          <span class="text-xs text-np-muted tabular-nums w-10">{{ fmt(shownCurrent) }}</span>
          <div class="flex-1 h-1 bg-np-fill rounded-full cursor-pointer">
            <div class="h-full bg-np-fg rounded-full" :style="{ width: shownProgress + '%' }"></div>
          </div>
          <button class="text-np-fg hover:opacity-70 transition shrink-0" @click="player.togglePlay" title="播放/暂停">
            <svg v-if="!player.playing" viewBox="0 0 24 24" class="w-6 h-6 fill-current" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M6 4.5v15L19 12z"/></svg>
            <svg v-else viewBox="0 0 24 24" class="w-6 h-6 fill-current" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z"/></svg>
          </button>
          <span class="text-xs text-np-muted tabular-nums w-10 text-right">{{ fmt(player.duration) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
