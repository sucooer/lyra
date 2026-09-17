<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { usePlayerStore } from '../stores/player'
import { goHome, openAlbum } from '../lib/nav'
import { fmtTime } from '../lib/track'
import TrackRow from './TrackRow.vue'

const props = defineProps<{ name: string }>()
const player = usePlayerStore()

const info = computed(() => player.artistInfo(props.name))
const tracks = computed(() => player.artistTracks(props.name))
const albums = computed(() => player.artistAlbums(props.name))
/** 头像：优先用曲库里的封面，没有再退 Apple Music 的专辑图 */
const portrait = computed(
  () => albums.value.find((a) => a.cover)?.cover ?? info.value?.albums?.[0]?.cover,
)

const ids = computed(() => tracks.value.map((t) => t.id))

/** 进入歌手页即把播放上下文切成这位歌手：之后点任意一首都在他/她的歌里顺序播 */
watch(
  ids,
  (v) => {
    if (v.length) player.setContext(v, props.name)
  },
  { immediate: true },
)

function playAll() {
  if (player.shuffle) player.shuffle = false
  player.playCollection(ids.value, props.name, { shuffle: false })
}
function shuffleAll() {
  player.playCollection(ids.value, props.name, { shuffle: true })
}

const totalTime = computed(() => tracks.value.reduce((n, t) => n + (t.meta?.duration ?? 0), 0))
function fmtTotal(sec: number): string {
  if (!sec) return ''
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? `${h} 小时 ${m} 分钟` : `${m} 分钟`
}

/** 简介默认收起到 3 行，避免长条目把专辑挤到屏幕外 */
const bioOpen = ref(false)
const bioSourceLabel = computed(() => {
  switch (info.value?.bioSource) {
    case 'lastfm':
      return 'Last.fm'
    case 'wikipedia-zh':
      return '维基百科'
    case 'wikipedia-en':
      return 'Wikipedia'
    default:
      return ''
  }
})
</script>

<template>
  <div v-if="tracks.length" class="px-4 sm:px-6 lg:px-10 pb-6">
    <!-- 头部：手机上竖排居中，宽屏改成官方的「左头像 + 右信息」 -->
    <div
      class="flex flex-col items-center text-center pt-1 lg:flex-row lg:items-end lg:text-left lg:gap-7 lg:pt-4"
    >
      <div
        class="w-40 h-40 sm:w-52 sm:h-52 shrink-0 rounded-full overflow-hidden shadow-xl bg-fill"
      >
        <img v-if="portrait" :src="portrait" class="w-full h-full object-cover" />
        <div v-else class="w-full h-full flex items-center justify-center text-5xl text-fg-subtle">
          ♪
        </div>
      </div>

      <div class="min-w-0">
        <h2 class="mt-4 lg:mt-0 text-2xl sm:text-3xl lg:text-[40px] font-bold tracking-tight truncate">
          {{ name }}
        </h2>
        <div class="text-[13px] text-fg-subtle mt-0.5">
          {{ tracks.length }} 首<template v-if="albums.length"> · {{ albums.length }} 张专辑</template>
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

    <!-- 简介：抓不到就整块不显示，不留空标题 -->
    <section v-if="info?.bio" class="mt-7">
      <h3 class="text-[13px] font-semibold text-fg-muted mb-1.5">歌手简介</h3>
      <p
        class="text-[14px] leading-relaxed text-fg-muted whitespace-pre-line"
        :class="bioOpen ? '' : 'line-clamp-3'"
      >
        {{ info.bio }}
      </p>
      <div class="mt-1.5 flex items-center gap-3 text-[13px]">
        <button class="text-music hover:opacity-75 transition" @click="bioOpen = !bioOpen">
          {{ bioOpen ? '收起' : '展开' }}
        </button>
        <a
          v-if="info.bioUrl"
          :href="info.bioUrl"
          target="_blank"
          rel="noopener"
          class="text-fg-subtle hover:text-fg transition"
        >
          来源：{{ bioSourceLabel }}
        </a>
      </div>
    </section>

    <!-- 专辑 -->
    <section v-if="albums.length" class="mt-7">
      <h3 class="text-[22px] font-bold tracking-tight mb-3">专辑</h3>
      <div
        class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-x-4 gap-y-6 lg:gap-x-5 lg:gap-y-9"
      >
        <button
          v-for="a in albums"
          :key="a.name"
          class="text-left"
          @click="openAlbum(a.artist, a.name)"
        >
          <div
            class="w-full aspect-square rounded-xl overflow-hidden bg-fill shadow-sm hover:opacity-90 transition"
          >
            <img v-if="a.cover" :src="a.cover" class="w-full h-full object-cover" loading="lazy" />
            <div v-else class="w-full h-full flex items-center justify-center text-fg-subtle">♪</div>
          </div>
          <!-- 封面下文字块：与首页卡片一致的 15px/14px 两行 -->
          <div class="mt-[7px]">
            <div class="text-[15px] font-semibold leading-5 truncate">{{ a.name }}</div>
            <div class="text-[14px] leading-5 text-fg-muted truncate">
              {{ a.year ? a.year + ' · ' : '' }}{{ a.trackCount }} 首
            </div>
          </div>
        </button>
      </div>
    </section>

    <!-- 曲目 -->
    <section class="mt-8">
      <h3 class="text-[22px] font-bold tracking-tight mb-2">歌曲</h3>
      <div class="divide-y divide-line border-y border-line">
        <TrackRow v-for="t in tracks" :key="t.id" :track="t" :artist-link="false" />
      </div>
    </section>
  </div>

  <div v-else class="px-6 py-16 text-center text-fg-subtle text-sm space-y-4">
    <div>资料库里没有这位歌手的歌曲</div>
    <button class="text-music text-[15px]" @click="goHome">返回</button>
  </div>
</template>
