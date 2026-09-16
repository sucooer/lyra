<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore } from '../stores/player'
import { openPlaylist } from '../lib/nav'
import PlaylistCard from './PlaylistCard.vue'
import PlaylistCover from './PlaylistCover.vue'

const player = usePlayerStore()

const radio = computed(() => player.radioCollection)

/** 加载中 / 无内容时的兜底：首页只剩电台与歌单两节，都没有就会整页空白 */
const loading = computed(() => !player.playlistLoaded)
const nothing = computed(
  () => player.playlistLoaded && !radio.value && player.playlistCards.length === 0,
)

function playRadio() {
  player.playRadio()
}
</script>

<template>
  <div class="px-4 sm:px-6 lg:px-10 pt-0 lg:pt-5 pb-6 space-y-8 lg:space-y-12">
    <!-- ===== 电台：整块可点，一键随机无限播放全部歌曲 ===== -->
    <section v-if="radio">
      <h2 class="text-[22px] font-bold tracking-tight mb-3">电台</h2>
      <button
        class="group w-full lg:max-w-[420px] flex items-center gap-4 p-3 rounded-2xl bg-fill hover:bg-fill-strong active:scale-[0.99] transition text-left"
        @click="playRadio"
      >
        <div class="w-20 h-20 sm:w-[92px] sm:h-[92px] shrink-0">
          <PlaylistCover :collection="radio" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-[17px] font-semibold truncate">{{ radio.def.title }}</div>
          <div class="text-[14px] text-fg-muted truncate mt-0.5">{{ radio.def.subtitle }}</div>
          <div class="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-music">
            <svg viewBox="0 0 24 24" class="w-[15px] h-[15px] fill-current">
              <path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
            </svg>
            随机播放全部 {{ radio.tracks.length }} 首
          </div>
        </div>
        <svg viewBox="0 0 24 24" class="w-6 h-6 fill-current text-fg-subtle shrink-0 mr-1">
          <path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none" />
        </svg>
      </button>
    </section>

    <!-- ===== 歌单：卡片网格（对齐 Apple Music 推荐区） ===== -->
    <section v-if="player.playlistCards.length">
      <h2 class="text-[22px] font-bold tracking-tight mb-3">为你推荐</h2>
      <div
        class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(196px,1fr))] gap-x-4 gap-y-6 lg:gap-x-5 lg:gap-y-9"
      >
        <button
          v-for="c in player.playlistCards"
          :key="c.def.id"
          class="text-left"
          @click="openPlaylist(c.def.id)"
        >
          <PlaylistCard :collection="c" />
        </button>
      </div>
    </section>

    <!-- 加载中 / 歌单为空：原来是底部歌曲小节承担的，去掉小节后在这里兜底 -->
    <div v-if="loading" class="py-16 text-center text-fg-subtle text-sm space-y-3">
      <div class="text-5xl animate-pulse">🎵</div>
      <div>正在加载歌单…</div>
    </div>
    <div v-else-if="nothing" class="py-16 text-center text-fg-subtle text-sm space-y-2">
      <div class="text-5xl">🎵</div>
      <div>还没有可播放的内容，编辑 public/playlist.json 添加歌曲直链后刷新</div>
    </div>
  </div>
</template>
