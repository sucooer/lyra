<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { usePlayerStore } from '../stores/player'
import { goHome, openAlbum, openArtist, openPlaylist } from '../lib/nav'
import {
  buildAlbumIndex,
  buildArtistIndex,
  normQuery,
  rankItems,
  searchTracks,
  tokensOf,
} from '../lib/search'
import { clearSearchHistory, recentSearches, rememberSearch } from '../lib/search-history'
import TrackRow from './TrackRow.vue'
import PlaylistCard from './PlaylistCard.vue'
import ArtistCard from './ArtistCard.vue'

const player = usePlayerStore()
const query = computed(() => player.searchQuery)
const input = ref<HTMLInputElement | null>(null)

/**
 * 两份曲库索引：只在曲库或元数据变化时重算，跟输入无关。
 * 每敲一个字只做「扫索引 + 打分」，不会重算繁简转换。
 */
const artistIndex = computed(() => buildArtistIndex(player.tracks))
const albumIndex = computed(() => buildAlbumIndex(player.tracks))

const tokens = computed(() => tokensOf(query.value))
const searching = computed(() => tokens.value.length > 0)

const artists = computed(() =>
  rankItems(
    artistIndex.value,
    tokens.value,
    (a) => [normQuery(player.artistLabel(a.key)), a.key],
    (a, b) => b.count - a.count,
  ).slice(0, 12),
)

const albums = computed(() =>
  rankItems(
    albumIndex.value,
    tokens.value,
    (a) => [normQuery(a.name), normQuery(player.artistLabel(a.artist))],
    (a, b) => b.count - a.count,
  ).slice(0, 12),
)

const collections = computed(() =>
  rankItems(player.playlistCards, tokens.value, (c) => [
    normQuery(c.def.title),
    normQuery(c.def.subtitle ?? ''),
  ]).slice(0, 6),
)

const tracks = computed(() => searchTracks(player.tracks, tokens.value))

/** 命中太多就先摆一屏，剩下的按需展开（一次铺 800 行会把滚动条拖垮） */
const TRACK_PAGE = 40
const trackLimit = ref(TRACK_PAGE)
const shownTracks = computed(() => tracks.value.slice(0, trackLimit.value))
watch(tokens, () => (trackLimit.value = TRACK_PAGE))

/** 所有歌曲行共用同一份播放上下文：点哪首都顺着搜索结果往下放 */
const trackIds = computed(() => tracks.value.map((t) => t.id))
const contextLabel = computed(() => `搜索“${query.value.trim()}”`)
const playContext = computed(() => ({ ids: trackIds.value, label: contextLabel.value }))

function playAll() {
  if (trackIds.value.length) player.playCollection(trackIds.value, contextLabel.value)
}

const empty = computed(
  () =>
    searching.value &&
    !artists.value.length &&
    !albums.value.length &&
    !tracks.value.length &&
    !collections.value.length,
)

/** 没输入词时给点能点的东西：曲库里曲目最多的几位歌手 */
const popular = computed(() =>
  [...artistIndex.value].sort((a, b) => b.count - a.count).slice(0, 12),
)

function label(key: string): string {
  return player.artistLabel(key)
}

function clearQuery() {
  player.searchQuery = ''
  input.value?.focus()
}

function onEscape() {
  if (player.searchQuery) clearQuery()
  else goHome()
}

/** 回车收起手机键盘，好让结果整体露出来；顺手把这次搜索记进「最近搜索」 */
function onEnter() {
  rememberSearch(player.searchQuery)
  input.value?.blur()
}

/** 点「最近搜索」里的一条：填回输入框并置顶（重搜一次） */
function rerun(q: string) {
  player.searchQuery = q
  rememberSearch(q)
}

/**
 * 取消 = 结束这次搜索：先把词记进历史（不然「取消了就真丢了」），再清空输入框、
 * 退出搜索页。清空是为了下次进来能直接看到「最近搜索」而不是又回到上次的结果页。
 */
function cancel() {
  rememberSearch(player.searchQuery)
  clearQuery()
  goHome()
}

function focusInput() {
  void nextTick(() => input.value?.focus({ preventScroll: true }))
}

onMounted(() => {
  focusInput()
  // 已经是搜索页时再按 / 或 Ctrl+K：导航层不会动，只需要把焦点还给输入框
  window.addEventListener('lyra:focus-search', focusInput)
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  window.removeEventListener('lyra:focus-search', focusInput)
  window.removeEventListener('keydown', onKey)
})

function onKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if (e.key === '/' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
    e.preventDefault()
    input.value?.focus()
  }
}
</script>

<template>
  <div class="px-4 sm:px-6 lg:px-10 pb-6">
    <!--
      搜索框吸顶：结果很长时改词不用先滚回顶部。
      只写 top-0，不要再加 lg:top-14 —— 宽屏顶栏那 56px 的让位已经由 main 的 lg:pt-14
      提供了，而吸顶基准正是滚动区的内容盒（padding 之内），两个叠加会把输入框
      整整压低 56px（实测 128px vs 72px）。
      负边距 + 同色底：让背景铺满整宽，结果从它底下滚过去而不是露在两侧。
    -->
    <div
      class="sticky top-0 z-20 -mx-4 sm:-mx-6 lg:mx-0 px-4 sm:px-6 lg:px-0 pt-1 lg:pt-4 pb-3 bg-app"
    >
      <!-- 搜索框 + 取消。iOS 上字号必须 ≥16px，否则聚焦时页面会被自动放大 -->
      <div class="flex items-center gap-2 w-full lg:max-w-[640px]">
        <!-- 输入框自己一层 relative：放大镜与清空按钮都按「输入框」定位，
             不能被右侧的取消按钮带着跑 -->
        <div class="relative flex-1 min-w-0">
          <svg
            viewBox="0 0 24 24"
            class="absolute left-3 top-1/2 -translate-y-1/2 w-[18px] h-[18px] fill-current text-fg-subtle pointer-events-none"
          >
            <path
              d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
            />
          </svg>
          <input
            ref="input"
            v-model="player.searchQuery"
            type="text"
            enterkeyhint="search"
            autocomplete="off"
            autocorrect="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="歌手、歌曲或专辑"
            class="w-full h-10 pl-10 pr-10 rounded-xl bg-fill text-[16px] lg:text-[15px] text-fg placeholder:text-fg-subtle outline-none focus:bg-fill-strong transition"
            @keydown.escape="onEscape"
            @keydown.enter="onEnter"
            @blur="rememberSearch(player.searchQuery)"
          />
          <button
            v-if="player.searchQuery"
            class="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center text-fg-subtle hover:text-fg hover:bg-fill-strong transition"
            title="清空"
            @click="clearQuery"
          >
            <svg viewBox="0 0 24 24" class="w-4 h-4 fill-current">
              <path
                d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm3.5 12.1-1.4 1.4L12 13.4l-2.1 2.1-1.4-1.4L10.6 12 8.5 9.9l1.4-1.4L12 10.6l2.1-2.1 1.4 1.4L13.4 12l2.1 2.1z"
              />
            </svg>
          </button>
        </div>

        <button
          data-search-cancel
          class="shrink-0 h-10 px-1 text-[15px] font-medium text-music hover:opacity-70 transition"
          @click="cancel"
        >
          取消
        </button>
      </div>
    </div>

    <!-- ===== 有搜索词：结果 ===== -->
    <template v-if="searching">
      <p v-if="empty" class="mt-6 text-[14px] text-fg-muted">
        没有找到与「{{ player.searchQuery.trim() }}」匹配的内容
      </p>

      <!-- 歌手 -->
      <section v-if="artists.length" class="mt-6">
        <h2 class="text-[22px] font-bold tracking-tight mb-3">歌手</h2>
        <div
          class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-4 gap-y-6"
        >
          <button
            v-for="a in artists"
            :key="a.key"
            class="group hover:opacity-90 transition"
            @click="openArtist(label(a.key))"
          >
            <ArtistCard :cover="a.cover" :label="label(a.key)" :sub="`${a.count} 首`" />
          </button>
        </div>
      </section>

      <!-- 专辑 -->
      <section v-if="albums.length" class="mt-7">
        <h2 class="text-[22px] font-bold tracking-tight mb-3">专辑</h2>
        <div
          class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-x-4 gap-y-6 lg:gap-x-5 lg:gap-y-9"
        >
          <button
            v-for="a in albums"
            :key="a.artist + a.name"
            class="text-left"
            @click="openAlbum(label(a.artist), a.name)"
          >
            <div
              class="w-full aspect-square rounded-xl overflow-hidden bg-fill shadow-sm hover:opacity-90 transition"
            >
              <img v-if="a.cover" :src="a.cover" class="w-full h-full object-cover" loading="lazy" />
              <div v-else class="w-full h-full flex items-center justify-center text-fg-subtle">♪</div>
            </div>
            <div class="mt-[7px]">
              <div class="text-[15px] font-semibold leading-5 truncate">{{ a.name }}</div>
              <div class="text-[14px] leading-5 text-fg-muted truncate">
                {{ label(a.artist) }}
              </div>
            </div>
          </button>
        </div>
      </section>

      <!-- 歌曲 -->
      <section v-if="tracks.length" class="mt-7">
        <div class="flex items-center justify-between gap-3 mb-2">
          <h2 class="text-[22px] font-bold tracking-tight">
            歌曲<span class="ml-2 text-[13px] font-normal text-fg-subtle">{{ tracks.length }} 首</span>
          </h2>
          <button
            class="shrink-0 flex items-center gap-1.5 px-4 h-9 rounded-full bg-solid text-on-solid text-[14px] font-medium hover:opacity-85 transition"
            @click="playAll"
          >
            <svg viewBox="0 0 24 24" class="w-3.5 h-3.5 fill-current">
              <path d="M8 5v14l11-7z" />
            </svg>
            播放
          </button>
        </div>
        <div class="divide-y divide-line border-y border-line">
          <TrackRow v-for="t in shownTracks" :key="t.id" :track="t" :play-context="playContext" />
        </div>
        <button
          v-if="tracks.length > trackLimit"
          class="mt-3 w-full text-[14px] text-music hover:opacity-75 transition"
          @click="trackLimit = tracks.length"
        >
          显示全部 {{ tracks.length }} 首
        </button>
      </section>

      <!-- 歌单 -->
      <section v-if="collections.length" class="mt-7">
        <h2 class="text-[22px] font-bold tracking-tight mb-3">歌单</h2>
        <div
          class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-x-4 gap-y-6 lg:gap-x-5 lg:gap-y-9"
        >
          <button
            v-for="c in collections"
            :key="c.def.id"
            class="text-left"
            @click="openPlaylist(c.def.id)"
          >
            <PlaylistCard :collection="c" />
          </button>
        </div>
      </section>
    </template>

    <!-- ===== 没搜索词：给点可点的入口，不留一整页空白 ===== -->
    <template v-else>
      <!-- 最近搜索：点一条即重搜（并把它提到最前）。做成 chips 而不是列表：
           一条一行的话，10 条就把下面的「热门歌手」挤出屏幕 -->
      <section v-if="recentSearches.length" data-recent-searches class="mt-6">
        <div class="flex items-baseline justify-between mb-3">
          <h2 class="text-[22px] font-bold tracking-tight">最近搜索</h2>
          <button
            data-recent-clear
            class="text-[14px] text-music hover:opacity-70 transition"
            @click="clearSearchHistory"
          >
            清除
          </button>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="q in recentSearches"
            :key="q"
            :data-recent-query="q"
            class="max-w-full h-9 px-3.5 rounded-full bg-fill hover:bg-fill-strong transition text-[14px] text-fg truncate"
            @click="rerun(q)"
          >
            {{ q }}
          </button>
        </div>
      </section>

      <p class="mt-7 text-[14px] text-fg-muted">
        搜索曲库里的歌手、歌曲或专辑。<br />
        支持一次输入多个词（如「周杰伦 稻香」），也支持简体写法搜繁体曲目。
      </p>

      <section v-if="popular.length" class="mt-7">
        <h2 class="text-[22px] font-bold tracking-tight mb-3">热门歌手</h2>
        <div
          class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-4 gap-y-6"
        >
          <button
            v-for="a in popular"
            :key="a.key"
            class="group hover:opacity-90 transition"
            @click="openArtist(label(a.key))"
          >
            <ArtistCard :cover="a.cover" :label="label(a.key)" :sub="`${a.count} 首`" />
          </button>
        </div>
      </section>
    </template>
  </div>
</template>
