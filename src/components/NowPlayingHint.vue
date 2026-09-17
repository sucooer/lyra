<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore } from '../stores/player'
import { fmtTime } from '../lib/track'
import { openNowPlaying } from '../lib/nav'

/**
 * 歌单页底部的「正在播放…」提示条。
 *
 * 单独拆成一个组件是为了隔离 `player.currentTime` 这个高频依赖：
 * 它每秒更新数次，如果这段文字写在歌单页模板里，整张曲目表（几千行）
 * 会跟着 currentTime 一起重渲染。放进这里，重渲染范围就只剩这一行字。
 */
const player = usePlayerStore()

const title = computed(() => {
  const t = player.currentTrack
  if (!t) return ''
  return t.meta?.title || t.url.split('/').pop()?.replace(/\.[a-z0-9]+$/i, '') || ''
})
</script>

<template>
  <button
    v-if="player.currentTrack"
    class="w-full text-[13px] text-music hover:opacity-75 transition"
    @click="openNowPlaying"
  >
    正在播放「{{ title }}」· {{ fmtTime(player.currentTime) }} / {{ fmtTime(player.duration) }}
  </button>
</template>
