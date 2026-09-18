<script setup lang="ts">
import { ref, watch, computed, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { usePlayerStore } from '../stores/player'
import { findLyricIndex } from '../lib/lrc'

const player = usePlayerStore()
const container = ref<HTMLElement | null>(null)
/** 离屏量尺（见 measureFrames）：不显示，只用来把每行按高亮字号量一遍 */
const probe = ref<HTMLElement | null>(null)
const manualScrolling = ref(false)
let scrollTimer: ReturnType<typeof setTimeout> | null = null

const lyrics = computed(() => player.currentTrack?.lyrics ?? [])
const activeIndex = computed(() => findLyricIndex(lyrics.value, player.currentTime))

/**
 * 跟随锚点：当前行落在歌词区高度的这个比例处（略高于垂直居中）。
 *
 * 首尾留白必须按**容器高度**算，不能写成 py-[40%] 这种百分比 —— CSS 里
 * padding 的百分比恒相对**包含块宽度**解析，宽屏下 40% 宽度 = 400px+，
 * 等于给顶部凭空垫一大块，整段歌词被压到屏幕下半部分。
 *
 * 窄屏（lg 以下）单独取更小的值：手机上歌词区更矮，同一个比例会让当前行显得偏下，
 * 一屏里预读到的下文太少。
 */
const ANCHOR_WIDE = 0.4
const ANCHOR_NARROW = 0.3
const wideMq = window.matchMedia('(min-width: 1024px)')
const anchor = () => (wideMq.matches ? ANCHOR_WIDE : ANCHOR_NARROW)

const padTop = ref(0)
const padBottom = ref(0)
let ro: ResizeObserver | null = null
let settleTimer: ReturnType<typeof setTimeout> | null = null

/**
 * 每行的固定框高（px）。
 *
 * 为什么需要它：放大/缩小是靠改 font-size 实现的，而字号一变**换行点**也变 ——
 * 卡在边界的句子会在 1 行与 2 行之间反复横跳，行高随之从 1 行变成 2 行，
 * 把下面所有行一路推走，看起来就是「字被挤来挤去」。
 * 所以先按**高亮字号**把每行排一遍量出它最多占几行，写死成 min-height：
 * 短句量出来就是 1 行高（不会多占空间），只有会被高亮撑成两行的长句才预留 2 行高。
 * 于是放大缩小只改字形、不改版式，动画自然就顺了。
 */
const frameH = ref<number[]>([])
let measuredW = -1

function measureFrames() {
  const el = container.value
  const p = probe.value
  if (!el || !p) return
  p.innerHTML = ''
  measuredW = el.clientWidth
  const lines = lyrics.value
  if (!lines.length) {
    frameH.value = []
    return
  }
  const cells = lines.map((line) => {
    const d = document.createElement('div')
    d.className = 'lyric-measure'
    d.textContent = line.text || '♪'
    p.appendChild(d)
    return d
  })
  frameH.value = cells.map((d) => Math.ceil(d.getBoundingClientRect().height))
  p.innerHTML = ''
}

function syncSize() {
  const el = container.value
  if (!el) return
  const h = el.clientHeight
  padTop.value = Math.round(h * anchor())
  padBottom.value = Math.max(0, h - padTop.value)
  // 宽度变了换行点就变了，量尺得重量一遍
  if (el.clientWidth !== measuredW) measureFrames()
}

onMounted(() => {
  const el = container.value
  if (!el) return
  // 观察 border-box：padding 变化不会改变它，天然不会自激循环
  ro = new ResizeObserver(syncSize)
  ro.observe(el, { box: 'border-box' })
  wideMq.addEventListener('change', syncSize)
  syncSize()
  measureFrames()
  // 首帧拿到真实高度后再定位一次：下面的 watch 没带 immediate，
  // 直接切进歌词视图时不会自动滚，会从第一行开始显示
  requestAnimationFrame(() => {
    syncSize()
    scrollToLine(activeIndex.value, false)
  })
  // 展开动画（约 300ms）跑完容器高度才定型，补一次定位 ——
  // 否则首屏是拿动画中途的高度算的锚点，位置会偏下
  settleTimer = setTimeout(() => {
    syncSize()
    scrollToLine(activeIndex.value, false)
  }, 380)
})

/** 把某一行滚到锚点所需的 scrollTop */
function targetFor(line: HTMLElement, el: HTMLElement): number {
  return Math.max(0, line.offsetTop - el.clientHeight * anchor() + line.clientHeight / 2)
}

/** 定位到第 idx 行；smooth=false 用于首屏与换歌，直接跳到位不补间 */
function scrollToLine(idx: number, smooth = true) {
  const el = container.value
  if (idx < 0 || !el) return
  const line = el.querySelectorAll<HTMLElement>('.lyric-line')[idx]
  if (!line) return
  const y = targetFor(line, el)
  if (smooth) {
    animateScrollTo(y)
    return
  }
  cancelAnimationFrame(animId)
  el.scrollTop = y
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
  scrollToLine(idx)
})

// 换歌：先按新歌词重算框高（框高变了，行的 offsetTop 才有意义），再直接定位回当前句
watch(lyrics, async () => {
  await nextTick()
  measureFrames()
  const idx = activeIndex.value
  if (idx < 0) {
    if (container.value) container.value.scrollTop = 0
    return
  }
  scrollToLine(idx, false)
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
  scrollToLine(activeIndex.value)
}

function jump(t: number) {
  player.seek(t)
}

onBeforeUnmount(() => {
  cancelAnimationFrame(animId)
  if (settleTimer) clearTimeout(settleTimer)
  wideMq.removeEventListener('change', syncSize)
  ro?.disconnect()
})
</script>

<template>
  <div
    ref="container"
    class="lyrics-scroll relative h-full overflow-y-auto px-6 space-y-2"
    :style="{ paddingTop: padTop + 'px', paddingBottom: padBottom + 'px' }"
    @wheel="onUserScroll"
    @touchmove="onUserScroll"
  >
    <template v-if="lyrics.length">
      <div
        v-for="(line, i) in lyrics"
        :key="i"
        class="lyric-line font-bold cursor-pointer transition-[font-size,color] duration-500 ease-out"
        :class="
          i === activeIndex
            ? 'text-np-fg text-[24px] md:text-[32px]'
            : i < activeIndex
              ? 'text-np-fg/30 text-[20px] md:text-[26px]'
              : 'text-np-fg/35 text-[20px] md:text-[26px] hover:text-np-fg/60'
        "
        :style="frameH[i] ? { minHeight: frameH[i] + 'px' } : undefined"
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

    <!--
      离屏量尺：和真实行同宽（左右各 24px 对齐容器的 px-6）、同字号（下面这行必须与
      上面高亮态的 text-[24px] md:text-[32px] 保持一致），量出每行最多占几行，
      作为该行的固定框高。见 measureFrames 的注释。
    -->
    <div
      ref="probe"
      class="lyric-measure-probe font-bold text-[24px] md:text-[32px]"
      aria-hidden="true"
    ></div>

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
