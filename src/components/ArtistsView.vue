<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore } from '../stores/player'
import { openArtist } from '../lib/nav'
import { buildArtistIndex } from '../lib/search'
import ArtistCard from './ArtistCard.vue'

/**
 * 「全部歌手」索引页。
 *
 * 在这之前歌手只有两个入口：搜索、或从某首曲目的行里点进去 —— 想「顺着逛」是做不到的。
 *
 * 曲库聚合直接用 `lib/search.ts` 的 `buildArtistIndex`（搜索页的热门歌手用的是同一个函数）：
 * 好处是口径天然一致 —— 联名曲两边都算，所以这里的「N 首」与歌手页里的曲目数对得上。
 */
const player = usePlayerStore()

/** 曲目数降序（常听的排前面）；同数按身份键排一下，保证顺序稳定不抖 */
const artists = computed(() =>
  buildArtistIndex(player.tracks).sort(
    (a, b) => b.count - a.count || a.key.localeCompare(b.key),
  ),
)

const total = computed(() => artists.value.reduce((n, a) => n + a.count, 0))

function label(key: string): string {
  return player.artistLabel(key)
}
</script>

<template>
  <div class="px-4 sm:px-6 lg:px-10 pt-0 lg:pt-5 pb-6">
    <p class="text-[13px] text-fg-subtle mb-4">
      {{ artists.length }} 位歌手<template v-if="total"> · 共 {{ total }} 首</template>
    </p>

    <div
      v-if="artists.length"
      class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-4 gap-y-6"
    >
      <button
        v-for="a in artists"
        :key="a.key"
        data-artist-card
        class="group hover:opacity-90 transition text-left"
        @click="openArtist(label(a.key))"
      >
        <ArtistCard :cover="a.cover" :label="label(a.key)" :sub="`${a.count} 首`" />
      </button>
    </div>

    <p v-else class="text-[14px] text-fg-muted mt-2">曲库还没加载完，或库里没有任何歌手。</p>
  </div>
</template>
