<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore } from '../stores/player'
import { openPlaylist } from '../lib/nav'
import PlaylistCard from './PlaylistCard.vue'
import PlaylistCover from './PlaylistCover.vue'
import TrackList from './TrackList.vue'

const player = usePlayerStore()

const radio = computed(() => player.radioCollection)

function playRadio() {
  player.playRadio()
}
</script>

<template>
  <div class="px-4 sm:px-6 pb-6 space-y-8">
    <!-- ===== 电台：整块可点，一键随机无限播放全部歌曲 ===== -->
    <section v-if="radio">
      <h2 class="text-[22px] font-bold tracking-tight mb-3">电台</h2>
      <button
        class="group w-full flex items-center gap-4 p-3 rounded-2xl bg-fill hover:bg-fill-strong active:scale-[0.99] transition text-left"
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
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-6">
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

    <!-- ===== 资料库歌曲 ===== -->
    <section>
      <h2 class="text-[22px] font-bold tracking-tight mb-3">歌曲</h2>
      <TrackList />
    </section>
  </div>
</template>
