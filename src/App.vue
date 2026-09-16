<script setup lang="ts">
import { onMounted } from 'vue'
import { usePlayerStore } from './stores/player'
import { setupShortcuts } from './lib/shortcuts'
import { initTheme, cycleTheme, themeMode, resolvedDark, themeLabel } from './lib/theme'
import PlayerBar from './components/PlayerBar.vue'
import NowPlaying from './components/NowPlaying.vue'
import TrackList from './components/TrackList.vue'

const player = usePlayerStore()

onMounted(() => {
  initTheme()
  player.initAudio()
  player.restore()
  setupShortcuts(player)
})
</script>

<template>
  <!-- 100dvh：移动端浏览器工具栏不占可视高度，底部播放栏不会被裁 -->
  <div class="h-[100dvh] flex flex-col bg-app text-fg overflow-hidden">
    <header class="shrink-0 flex items-center justify-between px-6 pt-5 pb-2">
      <h1 class="text-xl font-semibold tracking-tight">歌曲</h1>
      <button
        class="w-9 h-9 rounded-full flex items-center justify-center text-fg-muted hover:text-fg hover:bg-fill transition"
        :title="themeLabel"
        @click="cycleTheme"
      >
        <!-- 跟随系统：半阴半晴 -->
        <svg
          v-if="themeMode === 'auto'"
          viewBox="0 0 24 24"
          class="w-5 h-5 fill-current"
        >
          <path
            d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 1.8V20.2A8.2 8.2 0 0 1 12 3.8z"
          />
        </svg>
        <!-- 浅色：太阳 -->
        <svg v-else-if="!resolvedDark" viewBox="0 0 24 24" class="w-5 h-5 fill-current">
          <path
            d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-5 1.6 3.2h-3.2L12 2zm0 21 1.6-3.2h-3.2L12 23zM2 12l3.2-1.6v3.2L2 12zm20 0-3.2 1.6v-3.2L22 12zM4.2 4.2l3.3 1.1-1.1 3.3-2.2-4.4zm15.6 15.6-3.3-1.1 1.1-3.3 2.2 4.4zM19.8 4.2l-2.2 4.4-1.1-3.3 3.3-1.1zM4.2 19.8l2.2-4.4 1.1 3.3-3.3 1.1z"
          />
        </svg>
        <!-- 深色：月亮 -->
        <svg v-else viewBox="0 0 24 24" class="w-5 h-5 fill-current">
          <path
            d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z"
          />
        </svg>
      </button>
    </header>

    <main class="flex-1 min-h-0 overflow-y-auto pb-4">
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
