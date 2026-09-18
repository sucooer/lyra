<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore } from '../stores/player'
import { openAlbum } from '../lib/nav'
import { buildAlbumIndex } from '../lib/search'

/**
 * 「全部专辑」索引页。
 *
 * 与 ArtistsView 同源：聚合走 `lib/search.ts` 的 `buildAlbumIndex`，与实际进专辑页后的
 * 曲目列表是同一套口径（专辑身份用 normName，同名不同歌手各算一张）。
 */
const player = usePlayerStore()

/** 年份新的在前（当「最近添加」用）；没年份的按 0 处理，自然沉到最后 */
const albums = computed(() =>
  buildAlbumIndex(player.tracks).sort(
    (a, b) => (b.year ?? 0) - (a.year ?? 0) || a.name.localeCompare(b.name),
  ),
)

/** 卡片只放「歌手 · 年份」两行；有年份的专辑数单列一行给个概览 */
const years = computed(() => albums.value.filter((a) => a.year).length)

function label(key: string): string {
  return player.artistLabel(key)
}
</script>

<template>
  <div class="px-4 sm:px-6 lg:px-10 pt-0 lg:pt-5 pb-6">
    <p class="text-[13px] text-fg-subtle mb-4">
      {{ albums.length }} 张专辑<template v-if="years && years < albums.length">
        · {{ years }} 张有年份</template
      >
    </p>

    <div
      v-if="albums.length"
      class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-x-4 gap-y-6 lg:gap-x-5 lg:gap-y-9"
    >
      <button
        v-for="a in albums"
        :key="a.artist + a.name"
        data-album-card
        class="text-left"
        @click="openAlbum(label(a.artist), a.name)"
      >
        <div class="w-full aspect-square rounded-xl overflow-hidden bg-fill shadow-sm hover:opacity-90 transition">
          <img v-if="a.cover" :src="a.cover" class="w-full h-full object-cover" loading="lazy" />
          <div v-else class="w-full h-full flex items-center justify-center text-fg-subtle">♪</div>
        </div>
        <div class="mt-[7px]">
          <div class="text-[15px] font-semibold leading-5 truncate">{{ a.name }}</div>
          <div class="text-[14px] leading-5 text-fg-muted truncate">
            {{ label(a.artist) }}<template v-if="a.year"> · {{ a.year }}</template>
          </div>
        </div>
      </button>
    </div>

    <p v-else class="text-[14px] text-fg-muted mt-2">曲库还没加载完，或库里没有任何专辑。</p>
  </div>
</template>
