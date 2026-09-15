<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore } from '../stores/player'

const player = usePlayerStore()

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
  const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  player.seek(ratio * player.duration)
}
</script>

<template>
  <div
    v-if="player.currentTrack"
    class="relative z-30 border-t border-white/10 bg-zinc-950/80 backdrop-blur-xl"
  >
    <!-- 进度条（吸顶细条，Apple Music 风格） -->
    <div
      class="absolute -top-[3px] left-0 right-0 h-[6px] cursor-pointer group"
      @click="onSeek"
    >
      <div class="h-[3px] mt-[3px] bg-white/15 group-hover:h-[5px] group-hover:mt-[1px] transition-all">
        <div class="h-full bg-white/60 group-hover:bg-red-500 transition-colors" :style="{ width: progress + '%' }"></div>
      </div>
    </div>

    <div class="flex items-center gap-4 px-4 h-16">
      <!-- 封面 + 信息（点击展开全屏） -->
      <button
        class="flex items-center gap-3 min-w-0 w-64 text-left"
        @click="player.showNowPlaying = true"
      >
        <div class="w-11 h-11 rounded-lg overflow-hidden bg-zinc-800 shrink-0 shadow-lg">
          <img
            v-if="player.currentTrack.meta?.coverUrl"
            :src="player.currentTrack.meta.coverUrl"
            class="w-full h-full object-cover"
          />
          <div v-else class="w-full h-full flex items-center justify-center text-white/30">♪</div>
        </div>
        <div class="min-w-0">
          <div class="text-sm font-medium truncate">{{ player.displayTitle }}</div>
          <div class="text-xs text-white/50 truncate">{{ player.displayArtist }}</div>
        </div>
      </button>

      <!-- 控制 -->
      <div class="flex-1 flex items-center justify-center gap-6">
        <button
          class="text-white/60 hover:text-white transition"
          :class="{ 'text-red-500': player.shuffle }"
          @click="player.shuffle = !player.shuffle"
          title="随机播放"
        >
          <svg viewBox="0 0 24 24" class="w-4 h-4 fill-current"><path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
        </button>
        <button class="text-white hover:text-white/70 transition" @click="player.prev" title="上一首">
          <svg viewBox="0 0 24 24" class="w-6 h-6 fill-current"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
        </button>
        <button
          class="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition"
          @click="player.togglePlay"
        >
          <svg v-if="!player.playing" viewBox="0 0 24 24" class="w-5 h-5 fill-current ml-0.5"><path d="M8 5v14l11-7z"/></svg>
          <svg v-else viewBox="0 0 24 24" class="w-5 h-5 fill-current"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
        </button>
        <button class="text-white hover:text-white/70 transition" @click="player.next()" title="下一首">
          <svg viewBox="0 0 24 24" class="w-6 h-6 fill-current"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>
        </button>
        <button
          class="text-white/60 hover:text-white transition"
          :class="{ 'text-red-500': player.repeat !== 'off' }"
          @click="player.cycleRepeat"
          title="循环"
        >
          <svg v-if="player.repeat !== 'one'" viewBox="0 0 24 24" class="w-4 h-4 fill-current"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
          <svg v-else viewBox="0 0 24 24" class="w-4 h-4 fill-current"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/></svg>
        </button>
      </div>

      <!-- 时间 + 音量 -->
      <div class="w-64 hidden md:flex items-center justify-end gap-3 text-xs text-white/50 tabular-nums">
        <span>{{ fmt(player.currentTime) }}</span>
        <span>/</span>
        <span>{{ fmt(player.duration) }}</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="player.volume"
          class="w-20 accent-red-500"
          @input="player.setVolume(parseFloat(($event.target as HTMLInputElement).value))"
        />
      </div>
    </div>
  </div>
</template>
