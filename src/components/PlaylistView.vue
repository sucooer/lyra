<script setup lang="ts">
import { computed, watch } from 'vue'
import { usePlayerStore } from '../stores/player'
import { goHome } from '../lib/nav'
import { fmtTime } from '../lib/track'
import PlaylistCover from './PlaylistCover.vue'
import TrackRow from './TrackRow.vue'

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

function openInPlayer() {
  if (player.currentTrack && ids.value.includes(player.currentTrack.id)) {
    player.showNowPlaying = true
  }
}
</script>

<template>
  <div v-if="collection" class="px-4 sm:px-6 pb-6">
    <!-- 头部：大封面 + 标题 -->
    <div class="flex flex-col items-center text-center pt-1">
      <div class="w-40 h-40 sm:w-52 sm:h-52 rounded-2xl overflow-hidden shadow-xl">
        <PlaylistCover :collection="collection" />
      </div>
      <h2 class="mt-4 text-2xl sm:text-3xl font-bold tracking-tight">
        {{ collection.def.title }}
      </h2>
      <div v-if="collection.def.subtitle" class="text-[15px] text-fg-muted mt-1">
        {{ collection.def.subtitle }}
      </div>
      <div class="text-[13px] text-fg-subtle mt-0.5">
        {{ collection.tracks.length }} 首
        <template v-if="totalTime"> · {{ fmtTotal(totalTime) }}</template>
      </div>

      <div class="mt-5 flex items-center gap-3">
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

    <!-- 曲目列表 -->
    <div class="mt-7 divide-y divide-line border-y border-line">
      <TrackRow v-for="t in collection.tracks" :key="t.id" :track="t" source="playlist" />
    </div>

    <!-- 播放中时给一个回到播放器的入口 -->
    <button
      v-if="player.currentTrack && ids.includes(player.currentTrack.id)"
      class="mt-4 w-full text-[13px] text-music hover:opacity-75 transition"
      @click="openInPlayer"
    >
      正在播放「{{
        player.currentTrack.meta?.title ||
        player.currentTrack.url.split('/').pop()?.replace(/\.[a-z0-9]+$/i, '')
      }}」· {{ fmtTime(player.currentTime) }} / {{ fmtTime(player.duration) }}
    </button>
  </div>

  <div v-else class="px-6 py-16 text-center text-fg-subtle text-sm space-y-4">
    <div>这个歌单不存在或暂时没有歌曲</div>
    <button class="text-music text-[15px]" @click="goHome">返回</button>
  </div>
</template>
