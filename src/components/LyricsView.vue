<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import { usePlayerStore } from '../stores/player'
import { findLyricIndex } from '../lib/lrc'

const player = usePlayerStore()
const container = ref<HTMLElement | null>(null)
const manualScrolling = ref(false)
let scrollTimer: ReturnType<typeof setTimeout> | null = null

const lyrics = computed(() => player.currentTrack?.lyrics ?? [])
const activeIndex = computed(() => findLyricIndex(lyrics.value, player.currentTime))

watch(activeIndex, async (idx) => {
  if (idx < 0 || manualScrolling.value) return
  await nextTick()
  const el = container.value?.querySelectorAll<HTMLElement>('.lyric-line')[idx]
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
})

function onUserScroll() {
  manualScrolling.value = true
  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => (manualScrolling.value = false), 2500)
}

function jump(t: number) {
  player.seek(t)
}
</script>

<template>
  <div
    ref="container"
    class="lyrics-scroll h-full overflow-y-auto px-6 py-[40%] space-y-5"
    @wheel="onUserScroll"
    @touchmove="onUserScroll"
  >
    <template v-if="lyrics.length">
      <div
        v-for="(line, i) in lyrics"
        :key="i"
        class="lyric-line text-xl md:text-2xl font-bold leading-snug cursor-pointer transition-all duration-300 origin-left"
        :class="
          i === activeIndex
            ? 'text-white scale-100'
            : i < activeIndex
              ? 'text-white/35'
              : 'text-white/35 hover:text-white/60'
        "
        @click="jump(line.time)"
      >
        {{ line.text || '♪' }}
      </div>
    </template>
    <div v-else class="text-white/40 text-base pt-20 text-center select-none">
      <template v-if="player.currentTrack?.meta?.plainLyrics">
        <pre class="whitespace-pre-wrap text-left text-sm leading-relaxed font-sans">{{ player.currentTrack.meta.plainLyrics }}</pre>
      </template>
      <template v-else>暂无歌词</template>
    </div>
  </div>
</template>
