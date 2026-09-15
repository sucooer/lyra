<script setup lang="ts">
import { onMounted } from 'vue'
import { usePlayerStore } from './stores/player'
import Sidebar from './components/Sidebar.vue'
import PlayerBar from './components/PlayerBar.vue'
import NowPlaying from './components/NowPlaying.vue'
import TrackList from './components/TrackList.vue'
import AddTracks from './components/AddTracks.vue'

const player = usePlayerStore()

onMounted(() => {
  player.initAudio()
  player.restore()
})
</script>

<template>
  <div class="h-full flex flex-col bg-black text-white overflow-hidden">
    <div class="flex-1 flex min-h-0">
      <Sidebar />
      <main class="flex-1 min-w-0 flex flex-col overflow-y-auto pb-4">
        <div class="px-6 pt-6 pb-4 flex items-center justify-between">
          <h1 class="text-2xl font-bold tracking-tight">资料库</h1>
          <AddTracks />
        </div>
        <TrackList />
      </main>
    </div>
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
