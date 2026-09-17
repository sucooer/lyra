<script setup lang="ts">
import { computed, watch } from 'vue'
import { usePlayerStore } from '../stores/player'
import { goHome, openArtist } from '../lib/nav'
import { findAlbumNote } from '../lib/artists'
import { fmtTime } from '../lib/track'
import TrackRow from './TrackRow.vue'

const props = defineProps<{ artist: string; album: string }>()
const player = usePlayerStore()

/**
 * 曲目按轨号排；同一张专辑里有的文件没写轨号时，
 * 让它们跟在有轨号的后面而不是被挤到最前（值 0 会被当成「没写」）。
 */
const tracks = computed(() =>
  player.albumTracks(props.artist, props.album).slice().sort((a, b) => {
    const x = a.meta?.trackNo ?? 0
    const y = b.meta?.trackNo ?? 0
    if (x !== y) return (x || 1e9) - (y || 1e9)
    return (a.meta?.title ?? '').localeCompare(b.meta?.title ?? '', 'zh-Hans-CN')
  }),
)

const note = computed(() => findAlbumNote(player.artistInfo(props.artist), props.album))
const cover = computed(() => player.albumCover(props.artist, props.album))
const year = computed(() => tracks.value.find((t) => t.meta?.year)?.meta?.year ?? note.value?.year)
const ids = computed(() => tracks.value.map((t) => t.id))

/** 进入专辑页即把播放上下文切成这张专辑 */
watch(
  ids,
  (v) => {
    if (v.length) player.setContext(v, props.album)
  },
  { immediate: true },
)

const totalTime = computed(() => tracks.value.reduce((n, t) => n + (t.meta?.duration ?? 0), 0))
function fmtTotal(sec: number): string {
  if (!sec) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? `${h} 小时 ${m} 分钟` : `${m} 分钟`
}

function playAll() {
  if (player.shuffle) player.shuffle = false
  player.playCollection(ids.value, props.album, { shuffle: false })
}
function shuffleAll() {
  player.playCollection(ids.value, props.album, { shuffle: true })
}
</script>

<template>
  <div v-if="tracks.length" class="px-4 sm:px-6 lg:px-10 pb-6">
    <div
      class="flex flex-col items-center text-center pt-1 lg:flex-row lg:items-end lg:text-left lg:gap-7 lg:pt-4"
    >
      <div class="w-40 h-40 sm:w-52 sm:h-52 shrink-0 rounded-2xl overflow-hidden shadow-xl bg-fill">
        <img v-if="cover" :src="cover" class="w-full h-full object-cover" />
        <div v-else class="w-full h-full flex items-center justify-center text-5xl text-fg-subtle">
          ♪
        </div>
      </div>

      <div class="min-w-0">
        <h2 class="mt-4 lg:mt-0 text-2xl sm:text-3xl lg:text-[40px] font-bold tracking-tight">
          {{ album }}
        </h2>
        <!-- 歌手名可点：回到歌手页 -->
        <button
          class="text-[15px] text-music mt-1 hover:opacity-75 transition"
          @click="openArtist(artist)"
        >
          {{ artist }}
        </button>
        <div class="text-[13px] text-fg-subtle mt-0.5">
          {{ tracks.length }} 首<template v-if="year"> · {{ year }}</template>
          <template v-if="totalTime"> · {{ fmtTotal(totalTime) }}</template>
        </div>

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

    <!-- Apple Music 的专辑推荐语，有才显示 -->
    <p v-if="note?.note" class="mt-5 text-[14px] leading-relaxed text-fg-muted">
      {{ note.note }}
      <a
        v-if="note.amUrl"
        :href="note.amUrl"
        target="_blank"
        rel="noopener"
        class="ml-1 text-[13px] text-fg-subtle hover:text-fg transition whitespace-nowrap"
      >
        Apple Music
      </a>
    </p>

    <div class="mt-7 divide-y divide-line border-y border-line">
      <TrackRow
        v-for="t in tracks"
        :key="t.id"
        :track="t"
        :artist-link="false"
        :album-link="false"
      />
    </div>
  </div>

  <div v-else class="px-6 py-16 text-center text-fg-subtle text-sm space-y-4">
    <div>资料库里没有这张专辑</div>
    <button class="text-music text-[15px]" @click="goHome">返回</button>
  </div>
</template>
