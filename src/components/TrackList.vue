<script setup lang="ts">
import { usePlayerStore } from '../stores/player'
import TrackRow from './TrackRow.vue'

const player = usePlayerStore()
</script>

<template>
  <!-- 歌单还在加载：显示加载态，避免刷新瞬间闪现「歌单是空的」 -->
  <div v-if="!player.playlistLoaded" class="py-12 text-center text-fg-subtle text-sm space-y-3">
    <div class="text-5xl animate-pulse">🎵</div>
    <div>正在加载歌单…</div>
  </div>

  <div v-else-if="player.tracks.length === 0" class="py-12 text-center text-fg-subtle text-sm space-y-2">
    <div class="text-5xl">🎵</div>
    <div>歌单是空的，编辑 public/playlist.json 添加歌曲直链后刷新</div>
  </div>

  <!-- Apple Music 风格：行与行之间用细分隔线，不做卡片高亮 -->
  <div v-else class="divide-y divide-line border-y border-line">
    <TrackRow v-for="t in player.tracks" :key="t.id" :track="t" source="library" />
  </div>
</template>
