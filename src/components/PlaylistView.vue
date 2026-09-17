<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { usePlayerStore } from '../stores/player'
import { goHome } from '../lib/nav'
import PlaylistCover from './PlaylistCover.vue'
import TrackRow from './TrackRow.vue'
import NowPlayingHint from './NowPlayingHint.vue'

const props = defineProps<{ id: string }>()
const player = usePlayerStore()

const collection = computed(
  () => player.collections.find((c) => c.def.id === props.id) ?? null,
)

const totalTime = computed(() => {
  const s = collection.value?.tracks.reduce((n, t) => n + (t.meta?.duration ?? 0), 0) ?? 0
  return s
})

function fmtTotal(sec: number): string {
  if (!sec) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? `${h} 小时 ${m} 分钟` : `${m} 分钟`
}

const ids = computed(() => collection.value?.tracks.map((t) => t.id) ?? [])
const label = computed(() => collection.value?.def.title ?? '')

/** 进入歌单即把播放上下文切成该歌单：之后点任意一首都在歌单内顺序播 */
watch(
  ids,
  (v) => {
    if (v.length) player.setContext(v, label.value)
  },
  { immediate: true },
)

function playAll() {
  if (player.shuffle) player.shuffle = false
  player.playCollection(ids.value, label.value, { shuffle: false })
}

function shuffleAll() {
  player.playCollection(ids.value, label.value, { shuffle: true })
}

/**
 * 分批渲染：一次只建 CHUNK 行，滚到列表末尾附近再补一批。
 *
 * 曲库级歌单有 4000 首，一次性渲染实测要 4.4 秒、6.4 万个 DOM 节点，
 * 点进去就是明显卡死；分批后首帧只有几十行，剩下的按需出现。
 */
const CHUNK = 60
const shown = ref(CHUNK)
const visibleTracks = computed(() => {
  const all = collection.value?.tracks ?? []
  // 小歌单直接全给：多渲染那点行数无关痛痒，也免得出现「60 / 62 首」这种别扭的提示
  const n = all.length <= CHUNK * 2 ? all.length : Math.min(all.length, shown.value)
  return all.slice(0, n)
})

/** 换歌单时回到第一批 */
watch(
  () => props.id,
  () => (shown.value = CHUNK),
)

const sentinel = ref<HTMLElement | null>(null)
let io: IntersectionObserver | null = null

onMounted(() => {
  io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        shown.value = Math.min(ids.value.length, shown.value + CHUNK)
      }
    },
    // 提前 800px 就开始补，正常滚动不会看到「白条」
    { rootMargin: '800px' },
  )
  if (sentinel.value) io.observe(sentinel.value)
})
// 歌单内容是 v-if="collection" 渲染的，挂载时哨兵可能还不存在，等它出现再观察
watch(sentinel, (el) => {
  if (io && el) io.observe(el)
})
onBeforeUnmount(() => io?.disconnect())

/** 本歌单是否有正在播放的曲目（走 Set，避免每次重渲染都扫一遍 ids） */
const playingHere = computed(() => {
  const cur = player.currentTrack
  return !!cur && new Set(ids.value).has(cur.id)
})
</script>

<template>
  <div v-if="collection" class="px-4 sm:px-6 lg:px-10 pb-6">
    <!-- 头部：手机上竖排居中，宽屏改成官方的「左封面 + 右信息」 -->
    <div
      class="flex flex-col items-center text-center pt-1 lg:flex-row lg:items-end lg:text-left lg:gap-7 lg:pt-4"
    >
      <div class="w-40 h-40 sm:w-52 sm:h-52 shrink-0 rounded-2xl overflow-hidden shadow-xl">
        <PlaylistCover :collection="collection" />
      </div>

      <div class="min-w-0">
        <h2 class="mt-4 lg:mt-0 text-2xl sm:text-3xl lg:text-[40px] font-bold tracking-tight truncate">
          {{ collection.def.title }}
        </h2>
        <div v-if="collection.def.subtitle" class="text-[15px] text-fg-muted mt-1">
          {{ collection.def.subtitle }}
        </div>
        <div class="text-[13px] text-fg-subtle mt-0.5">
          {{ collection.tracks.length }} 首
          <template v-if="totalTime"> · {{ fmtTotal(totalTime) }}</template>
        </div>

        <!-- 推荐语 / 导语（每日推荐由脚本生成，见 lib/blurb.ts）。限宽是为了别拉成一整行长文 -->
        <p
          v-if="collection.def.blurb"
          data-playlist-blurb
          class="mt-2.5 max-w-[46ch] mx-auto lg:mx-0 text-[14px] lg:text-[15px] leading-relaxed text-fg-muted"
        >
          {{ collection.def.blurb }}
        </p>

        <div class="mt-5 flex items-center gap-3 justify-center lg:justify-start">
          <button
            class="flex items-center gap-2 px-5 h-10 rounded-full bg-solid text-on-solid text-[15px] font-medium hover:opacity-85 transition"
            @click="playAll"
          >
            <svg viewBox="0 0 24 24" class="w-4 h-4 fill-current"><path d="M8 5v14l11-7z" /></svg>
            播放
          </button>
          <button
            class="flex items-center gap-2 px-5 h-10 rounded-full bg-fill text-fg text-[15px] font-medium hover:bg-fill-strong transition"
            @click="shuffleAll"
          >
            <svg viewBox="0 0 24 24" class="w-4 h-4 fill-current">
              <path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
            </svg>
            随机播放
          </button>
        </div>
      </div>
    </div>

    <!-- 曲目列表（分批渲染，见 visibleTracks） -->
    <div class="mt-7 divide-y divide-line border-y border-line">
      <TrackRow v-for="t in visibleTracks" :key="t.id" :track="t" source="playlist" />
    </div>
    <!-- 哨兵：放在带边框的列表容器之外，免得 divide-y 给它多画一条线 -->
    <div ref="sentinel"></div>

    <!-- 播放中时给一个回到播放器的入口（单独组件：它每秒都在动，别拖累上面的列表） -->
    <NowPlayingHint v-if="playingHere" class="mt-4" />

    <div
      v-if="visibleTracks.length < collection.tracks.length"
      class="mt-3 text-center text-[12px] text-fg-subtle"
    >
      已显示 {{ visibleTracks.length }} / {{ collection.tracks.length }} 首 · 继续下滑加载
    </div>
  </div>

  <div v-else class="px-6 py-16 text-center text-fg-subtle text-sm space-y-4">
    <div>这个歌单不存在或暂时没有歌曲</div>
    <button class="text-music text-[15px]" @click="goHome">返回</button>
  </div>
</template>
