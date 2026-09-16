<script setup lang="ts">
import { ref, watch, computed, nextTick, onBeforeUnmount } from 'vue'
import { usePlayerStore } from '../stores/player'
import { findLyricIndex } from '../lib/lrc'

const player = usePlayerStore()
const container = ref<HTMLElement | null>(null)
const manualScrolling = ref(false)
let scrollTimer: ReturnType<typeof setTimeout> | null = null

const lyrics = computed(() => player.currentTrack?.lyrics ?? [])
const activeIndex = computed(() => findLyricIndex(lyrics.value, player.currentTime))

/** rAF 缓动滚动（easeOutQuint），复刻 Apple Music 的柔和跟随动画 */
let animId = 0
function animateScrollTo(targetY: number) {
  const el = container.value
  if (!el) return
  cancelAnimationFrame(animId)
  const startY = el.scrollTop
  const delta = targetY - startY
  if (Math.abs(delta) < 1) return
  const duration = 700
  const t0 = performance.now()
  const ease = (x: number) => 1 - Math.pow(1 - x, 5)
  const step = (now: number) => {
    const p = Math.min(1, (now - t0) / duration)
    el.scrollTop = startY + delta * ease(p)
    if (p < 1) animId = requestAnimationFrame(step)
  }
  animId = requestAnimationFrame(step)
}

watch(activeIndex, async (idx) => {
  if (idx < 0 || manualScrolling.value) return
  await nextTick()
  const el = container.value
  if (!el) return
  const line = el.querySelectorAll<HTMLElement>('.lyric-line')[idx]
  if (!line) return
  // 目标：当前行垂直居中
  const target = line.offsetTop - el.clientHeight / 2 + line.clientHeight / 2
  animateScrollTo(target)
})

function onUserScroll() {
  manualScrolling.value = true
  cancelAnimationFrame(animId)
  if (scrollTimer) clearTimeout(scrollTimer)
  scrollTimer = setTimeout(() => (manualScrolling.value = false), 2500)
}

/** 手动滚走后点这里恢复跟随 */
function resumeFollow() {
  manualScrolling.value = false
  const idx = activeIndex.value
  const el = container.value
  if (idx < 0 || !el) return
  const line = el.querySelectorAll<HTMLElement>('.lyric-line')[idx]
  if (line) animateScrollTo(line.offsetTop - el.clientHeight / 2 + line.clientHeight / 2)
}

function jump(t: number) {
  player.seek(t)
}

onBeforeUnmount(() => cancelAnimationFrame(animId))
</script>

<template>
  <div
    ref="container"
    class="lyrics-scroll relative h-full overflow-y-auto px-6 py-[25%] md:py-[40%] space-y-5"
    @wheel="onUserScroll"
    @touchmove="onUserScroll"
  >
    <template v-if="lyrics.length">
      <div
        v-for="(line, i) in lyrics"
        :key="i"
        class="lyric-line font-bold leading-snug cursor-pointer origin-left transition-all duration-500 ease-out will-change-transform"
        :class="
          i === activeIndex
            ? 'text-np-fg scale-110 md:scale-125'
            : i < activeIndex
              ? 'text-np-fg/30 scale-100'
              : 'text-np-fg/35 scale-100 hover:text-np-fg/60'
        "
        @click="jump(line.time)"
      >
        {{ line.text || '♪' }}
      </div>
    </template>
    <div v-else class="text-np-muted text-base pt-20 text-center select-none">
      <template v-if="player.currentTrack?.plainLyrics">
        <pre class="whitespace-pre-wrap text-left text-sm leading-relaxed font-sans">{{ player.currentTrack.plainLyrics }}</pre>
      </template>
      <template v-else>暂无歌词</template>
    </div>

    <!-- 手动滚离当前行后出现，点击回到当前行 -->
    <button
      v-if="manualScrolling && lyrics.length"
      class="fixed bottom-24 right-5 z-10 w-9 h-9 rounded-full bg-np-btn backdrop-blur flex items-center justify-center text-np-fg shadow-lg transition hover:bg-np-fill"
      title="回到当前行"
      @click="resumeFollow"
    >
      <svg viewBox="0 0 24 24" class="w-4.5 h-4.5 fill-current"><path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/></svg>
    </button>
  </div>
</template>
