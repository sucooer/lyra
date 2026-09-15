<script setup lang="ts">
import { onMounted } from 'vue'
import { usePlayerStore } from './stores/player'
import { setupShortcuts } from './lib/shortcuts'
import PlayerBar from './components/PlayerBar.vue'
import NowPlaying from './components/NowPlaying.vue'
import TrackList from './components/TrackList.vue'

const player = usePlayerStore()

onMounted(() => {
  player.initAudio()
  player.restore()
  setupShortcuts(player)
})
</script>

<template>
  <!-- 100dvh：移动端浏览器工具栏不占可视高度，底部播放栏不会被裁 -->
  <div class="h-[100dvh] flex flex-col bg-black text-white overflow-hidden">
    <main class="flex-1 min-h-0 overflow-y-auto pb-4 pt-6">
      <TrackList />
    </main>
    <PlayerBar />
    <Transition name="now-playing">
      <NowPlaying v-if="player.showNowPlaying" />
    </Transition>
  </div>
</template>

<style scoped>
.now-playing-enter-active,
.now-playing-leave-active {
  transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.3s;
}
.now-playing-enter-from,
.now-playing-leave-to {
  transform: translateY(100%);
  opacity: 0.5;
}
</style>
