<script setup lang="ts">
import { usePlayerStore, type Track } from '../stores/player'

const player = usePlayerStore()

function fmt(sec?: number): string {
  if (!sec || !isFinite(sec)) return '--:--'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function title(t: Track): string {
  if (t.meta?.title) return t.meta.title
  try {
    return decodeURIComponent(new URL(t.url).pathname.split('/').pop() ?? t.url).replace(
      /\.[a-z0-9]+$/i,
      '',
    )
  } catch {
    return t.url
  }
}

function click(t: Track, i: number) {
  if (player.currentIndex === i) player.togglePlay()
  else player.play(i)
}
</script>

<template>
  <div class="px-6">
    <div
      v-if="player.tracks.length === 0"
      class="mt-20 text-center text-white/30 text-sm space-y-2"
    >
      <div class="text-5xl">🎵</div>
      <div>资料库是空的，点右上角「添加」粘贴音乐直链</div>
    </div>

    <div
      v-for="(t, i) in player.tracks"
      :key="t.id"
      class="group flex items-center gap-4 px-3 py-2 rounded-xl cursor-pointer transition"
      :class="player.currentIndex === i ? 'bg-white/10' : 'hover:bg-white/5'"
      @dblclick="player.play(i)"
      @click="click(t, i)"
    >
      <div class="w-10 h-10 rounded-md overflow-hidden bg-zinc-800 shrink-0 relative">
        <img
          v-if="t.meta?.coverUrl"
          :src="t.meta.coverUrl"
          class="w-full h-full object-cover"
          loading="lazy"
        />
        <div v-else class="w-full h-full flex items-center justify-center text-white/30">
          <span v-if="t.loading" class="animate-pulse text-xs">…</span>
          <span v-else>♪</span>
        </div>
        <div
          v-if="player.currentIndex === i && player.playing"
          class="absolute inset-0 bg-black/50 flex items-end justify-center gap-[2px] pb-1.5"
        >
          <span class="w-[3px] bg-red-500 rounded animate-bounce h-3" style="animation-delay: 0s"></span>
          <span class="w-[3px] bg-red-500 rounded animate-bounce h-4" style="animation-delay: .15s"></span>
          <span class="w-[3px] bg-red-500 rounded animate-bounce h-2" style="animation-delay: .3s"></span>
        </div>
      </div>

      <div class="flex-1 min-w-0">
        <div
          class="text-sm font-medium truncate"
          :class="player.currentIndex === i ? 'text-red-400' : ''"
        >
          {{ title(t) }}
        </div>
        <div class="text-xs text-white/40 truncate">
          {{ t.meta?.artist || (t.loading ? '解析中…' : '未知艺术家') }}
          <template v-if="t.meta?.album"> — {{ t.meta.album }}</template>
        </div>
      </div>

      <div class="text-xs text-white/30 tabular-nums hidden sm:block">
        {{ t.meta?.codec ?? '' }}{{ t.meta?.bitrate ? ` · ${t.meta.bitrate}kbps` : '' }}
      </div>
      <div class="text-xs text-white/40 tabular-nums w-12 text-right">
        {{ fmt(t.meta?.duration) }}
      </div>
      <button
        class="opacity-0 group-hover:opacity-100 text-white/40 hover:text-red-400 transition px-1"
        title="移除"
        @click.stop="player.remove(t.id)"
      >
        ✕
      </button>
    </div>
  </div>
</template>
