<script setup lang="ts">
import { ref, watch, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { usePlayerStore } from '../stores/player'
import { findLyricIndex } from '../lib/lrc'

const player = usePlayerStore()
const container = ref<HTMLElement | null>(null)
const manualScrolling = ref(false)
let scrollTimer: ReturnType<typeof setTimeout> | null = null

const lyrics = computed(() => player.currentTrack?.lyrics ?? [])
const activeIndex = computed(() => findLyricIndex(lyrics.value, player.currentTime))

/**
 * 跟随锚点：当前行落在歌词区高度的 40% 处（略高于垂直居中）。
 *
 * 首尾留白必须按**容器高度**算，不能写成 py-[40%] 这种百分比 —— CSS 里
 * padding 的百分比恒相对**包含块宽度**解析，宽屏下 40% 宽度 = 400px+，
 * 等于给顶部凭空垫一大块，整段歌词被压到屏幕下半部分。
 */
const ANCHOR = 0.4
const padTop = ref(0)
const padBottom = ref(0)
let ro: ResizeObserver | null = null

onMounted(() => {
  const el = container.value
  if (!el) return
  const sync = () => {
    const h = el.clientHeight
    padTop.value = Math.round(h * ANCHOR)
    padBottom.value = Math.max(0, h - padTop.value)
  }
  // 观察 border-box：padding 变化不会改变它，天然不会自激循环
  ro = new ResizeObserver(sync)
  ro.observe(el, { box: 'border-box' })
  sync()
  // 首帧拿到真实高度后再定位一次：下面的 watch 没带 immediate，
  // 直接切进歌词视图时不会自动滚，会从第一行开始显示
  requestAnimationFrame(() => {
    sync()
    const idx = activeIndex.value
    const line = idx >= 0 ? el.querySelectorAll<HTMLElement>('.lyric-line')[idx] : null
    if (line) el.scrollTop = Math.max(0, targetFor(line, el))
  })
})

/** 把某一行滚到锚点所需的 scrollTop */
function targetFor(line: HTMLElement, el: HTMLElement): number {
  return line.offsetTop - el.clientHeight * ANCHOR + line.clientHeight / 2
}

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
  animateScrollTo(targetFor(line, el))
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
  if (line) animateScrollTo(targetFor(line, el))
}

function jump(t: number) {
  player.seek(t)
}

onBeforeUnmount(() => {
  cancelAnimationFrame(animId)
  ro?.disconnect()
})
</script>

<template>
  <div
    ref="container"
    class="lyrics-scroll relative h-full overflow-y-auto px-6 space-y-5"
    :style="{ paddingTop: padTop + 'px', paddingBottom: padBottom + 'px' }"
    @wheel="onUserScroll"
    @touchmove="onUserScroll"
  >
    <template v-if="lyrics.length">
      <div
        v-for="(line, i) in lyrics"
        :key="i"
        class="lyric-line font-bold leading-snug cursor-pointer transition-all duration-500 ease-out"
        :class="
          i === activeIndex
            ? 'text-np-fg text-[24px] md:text-[32px]'
            : i < activeIndex
              ? 'text-np-fg/30 text-[20px] md:text-[26px]'
              : 'text-np-fg/35 text-[20px] md:text-[26px] hover:text-np-fg/60'
        "
        @click="jump(line.time)"
      >
        {{ line.text || '♪' }}
      </div>
    </template>
    <div v-else class="text-np-muted text-base pt-20 text-center select-none">
      <template v-if="player.currentTrack?.plainLyrics">
        <pre class="whitespace-pre-wrap text-left text-base leading-relaxed font-sans">{{ player.currentTrack.plainLyrics }}</pre>
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
