<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { usePlayerStore } from '../stores/player'
import LyricsView from './LyricsView.vue'

const player = usePlayerStore()
const showLyrics = ref(false)
const bgColor = ref('rgb(30,30,32)')

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
    // 调暗并保证不太亮
    const dim = 0.55
    bgColor.value = `rgb(${Math.round(r * dim)},${Math.round(g * dim)},${Math.round(b * dim)})`
  } catch {
    bgColor.value = 'rgb(30,30,32)'
  }
}

const cover = computed(() => player.currentTrack?.meta?.coverUrl)
watch(cover, (c) => c && extractColor(c), { immediate: true })

const progress = computed(() =>
  player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0,
)

function fmt(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function onSeek(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  player.seek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * player.duration)
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col overflow-hidden">
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
    <div class="absolute inset-0 bg-black/30"></div>

    <!-- 顶栏：收起 / 标题 / 歌词开关 -->
    <div class="relative z-10 flex items-center justify-between px-5 md:px-8 pt-5">
      <button
        class="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition"
        @click="player.showNowPlaying = false"
        title="收起"
      >
        <svg viewBox="0 0 24 24" class="w-5 h-5 fill-current"><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>
      </button>
      <div class="text-xs uppercase tracking-widest text-white/60">
        {{ showLyrics ? '歌词' : '正在播放' }}
      </div>
      <button
        class="w-9 h-9 rounded-full flex items-center justify-center transition"
        :class="showLyrics ? 'text-red-500' : 'text-white/70 hover:text-white'"
        @click="showLyrics = !showLyrics"
        title="歌词"
      >
        <svg viewBox="0 0 24 24" class="w-6 h-6 fill-current"><path d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"/></svg>
      </button>
    </div>

    <!-- 封面视图 -->
    <div
      v-if="!showLyrics"
      class="relative z-10 flex-1 min-h-0 flex flex-col overflow-y-auto px-6 md:px-14 pb-4"
    >
      <!-- my-auto：内容放得下时垂直居中，放不下时可滚动且不裁顶 -->
      <div class="w-full max-w-md mx-auto my-auto">
        <div
          class="aspect-square w-full max-w-[220px] sm:max-w-[300px] md:max-w-[420px] mx-auto rounded-2xl overflow-hidden shadow-2xl shadow-black/60 transition-transform duration-500"
          :class="player.playing ? 'scale-100' : 'scale-90'"
        >
          <img v-if="cover" :src="cover" class="w-full h-full object-cover" />
          <div v-else class="w-full h-full bg-zinc-800 flex items-center justify-center text-7xl text-white/20">♪</div>
        </div>

        <div class="mt-6 text-center">
          <div class="text-xl md:text-2xl font-bold truncate">{{ player.displayTitle }}</div>
          <div class="text-base md:text-lg text-white/60 truncate mt-0.5">
            {{ player.displayArtist }}
            <template v-if="player.currentTrack?.meta?.album"> — {{ player.currentTrack.meta.album }}</template>
          </div>
        </div>

        <!-- 进度 -->
        <div class="mt-5">
          <div class="h-1.5 bg-white/20 rounded-full cursor-pointer group" @click="onSeek">
            <div class="h-full bg-white rounded-full relative transition-colors group-hover:bg-red-500" :style="{ width: progress + '%' }"></div>
          </div>
          <div class="flex justify-between text-xs text-white/50 tabular-nums mt-1.5">
            <span>{{ fmt(player.currentTime) }}</span>
            <span>-{{ fmt(Math.max(0, player.duration - player.currentTime)) }}</span>
          </div>
        </div>

        <!-- 控制 -->
        <div class="mt-4 flex items-center justify-center gap-8">
          <button class="text-white/70 hover:text-white transition" :class="{ 'text-red-500': player.shuffle }" @click="player.shuffle = !player.shuffle">
            <svg viewBox="0 0 24 24" class="w-5 h-5 fill-current"><path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
          </button>
          <button class="text-white transition hover:opacity-70" @click="player.prev">
            <svg viewBox="0 0 24 24" class="w-9 h-9 fill-current"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
          </button>
          <button class="text-white transition hover:scale-105" @click="player.togglePlay">
            <svg v-if="!player.playing" viewBox="0 0 24 24" class="w-16 h-16 fill-current"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
            <svg v-else viewBox="0 0 24 24" class="w-16 h-16 fill-current"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>
          </button>
          <button class="text-white transition hover:opacity-70" @click="player.next()">
            <svg viewBox="0 0 24 24" class="w-9 h-9 fill-current"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>
          </button>
          <button class="text-white/70 hover:text-white transition" :class="{ 'text-red-500': player.repeat !== 'off' }" @click="player.cycleRepeat">
            <svg v-if="player.repeat !== 'one'" viewBox="0 0 24 24" class="w-5 h-5 fill-current"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
            <svg v-else viewBox="0 0 24 24" class="w-5 h-5 fill-current"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/></svg>
          </button>
        </div>

        <!-- 音量（窄屏隐藏，避免挤压纵向空间） -->
        <div class="hidden sm:flex mt-5 items-center gap-3 justify-center">
          <svg viewBox="0 0 24 24" class="w-4 h-4 fill-white/50"><path d="M3 9v6h4l5 5V4L7 9H3z"/></svg>
          <input
            type="range" min="0" max="1" step="0.01" :value="player.volume"
            class="w-48 accent-white"
            @input="player.setVolume(parseFloat(($event.target as HTMLInputElement).value))"
          />
          <svg viewBox="0 0 24 24" class="w-4 h-4 fill-white/50"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.47 4.47 0 0 0 16.5 12zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
        </div>
      </div>
    </div>

    <!-- 歌词视图（全屏滚动，底部保留进度条） -->
    <div v-else class="relative z-10 flex-1 min-h-0 flex flex-col pb-3">
      <LyricsView class="flex-1 min-h-0" />
      <div class="px-6 md:px-14 pt-3 shrink-0">
        <div class="flex items-center gap-3">
          <span class="text-xs text-white/50 tabular-nums w-10">{{ fmt(player.currentTime) }}</span>
          <div class="flex-1 h-1 bg-white/20 rounded-full cursor-pointer" @click="onSeek">
            <div class="h-full bg-white/80 rounded-full" :style="{ width: progress + '%' }"></div>
          </div>
          <button class="text-white/80 hover:text-white transition shrink-0" @click="player.togglePlay" title="播放/暂停">
            <svg v-if="!player.playing" viewBox="0 0 24 24" class="w-5 h-5 fill-current"><path d="M8 5v14l11-7z"/></svg>
            <svg v-else viewBox="0 0 24 24" class="w-5 h-5 fill-current"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
          </button>
          <span class="text-xs text-white/50 tabular-nums w-10 text-right">{{ fmt(player.duration) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
