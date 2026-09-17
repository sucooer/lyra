<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { usePlayerStore } from './stores/player'
import { setupShortcuts } from './lib/shortcuts'
import { initTheme, cycleTheme, themeMode, resolvedDark, themeLabel } from './lib/theme'
import { activePlaylistId, activeAlbum, activeView, goHome, initNav, openSearch } from './lib/nav'
import PlayerBar from './components/PlayerBar.vue'
import PlayerBarWide from './components/PlayerBarWide.vue'
import NowPlaying from './components/NowPlaying.vue'
import Home from './components/Home.vue'
import PlaylistView from './components/PlaylistView.vue'
import ArtistView from './components/ArtistView.vue'
import AlbumView from './components/AlbumView.vue'
import SearchView from './components/SearchView.vue'
import TrackMenu from './components/TrackMenu.vue'

const player = usePlayerStore()

/** 子页面 = 歌单 / 歌手 / 专辑；首页不带 hash */
const inSubPage = computed(() => activeView.value.kind !== 'home')

const current = computed(() =>
  activePlaylistId.value
    ? (player.collections.find((c) => c.def.id === activePlaylistId.value) ?? null)
    : null,
)

/** 顶栏标题：歌单用歌单名，歌手页用歌手名，专辑页用专辑名（歌手在页面里单独一行） */
const headerTitle = computed(() => {
  switch (activeView.value.kind) {
    case 'playlist':
      return current.value?.def.title ?? '歌单'
    case 'artist':
      // 键是归一化产物（S.E.N.S. → sens），标题要用展示名
      return player.artistLabel(activeView.value.key)
    case 'album':
      return activeAlbum.value?.album ?? '专辑'
    case 'search':
      return '搜索'
    default:
      return '音乐'
  }
})

onMounted(() => {
  initNav()
  initTheme()
  player.initAudio()
  player.restore()
  setupShortcuts(player)
})
</script>

<template>
  <!-- 100dvh：移动端浏览器工具栏不占可视高度，底部播放栏不会被裁 -->
  <div class="relative h-[100dvh] flex flex-col bg-app text-fg overflow-hidden">
    <!-- 宽屏把顶栏做成悬浮工具栏：内容从它底下滚过，玻璃才糊得到东西 -->
    <header
      class="shrink-0 flex items-center gap-2 px-4 sm:px-6 pt-5 pb-2 lg:absolute lg:inset-x-0 lg:top-0 lg:z-40 lg:h-14 lg:py-0 lg:px-10 topbar-glass"
    >
      <button
        v-if="inSubPage"
        class="w-9 h-9 -ml-1 rounded-full flex items-center justify-center text-fg-muted hover:text-fg hover:bg-fill transition"
        title="返回"
        @click="goHome"
      >
        <svg viewBox="0 0 24 24" class="w-5 h-5">
          <path
            d="M15 5 8 12l7 7"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      <h1 class="flex-1 min-w-0 truncate text-xl lg:text-[17px] font-semibold tracking-tight">
        {{ headerTitle }}
      </h1>

      <!-- 搜索入口：已经在搜索页就不重复显示（那一页的输入框就在下面） -->
      <button
        v-if="activeView.kind !== 'search'"
        class="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-fg-muted hover:text-fg hover:bg-fill transition"
        title="搜索（/ 或 ⌘K）"
        @click="openSearch"
      >
        <svg viewBox="0 0 24 24" class="w-5 h-5 fill-current">
          <path
            d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"
          />
        </svg>
      </button>

      <button
        class="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-fg-muted hover:text-fg hover:bg-fill transition"
        :title="themeLabel"
        @click="cycleTheme"
      >
        <!-- 跟随系统：半阴半晴 -->
        <svg v-if="themeMode === 'auto'" viewBox="0 0 24 24" class="w-5 h-5 fill-current">
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 1.8V20.2A8.2 8.2 0 0 1 12 3.8z" />
        </svg>
        <!-- 浅色：太阳 -->
        <svg v-else-if="!resolvedDark" viewBox="0 0 24 24" class="w-5 h-5 fill-current">
          <path
            d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0-5 1.6 3.2h-3.2L12 2zm0 21 1.6-3.2h-3.2L12 23zM2 12l3.2-1.6v3.2L2 12zm20 0-3.2 1.6v-3.2L22 12zM4.2 4.2l3.3 1.1-1.1 3.3-2.2-4.4zm15.6 15.6-3.3-1.1 1.1-3.3 2.2 4.4zM19.8 4.2l-2.2 4.4-1.1-3.3 3.3-1.1zM4.2 19.8l2.2-4.4 1.1 3.3-3.3 1.1z"
          />
        </svg>
        <!-- 深色：月亮 -->
        <svg v-else viewBox="0 0 24 24" class="w-5 h-5 fill-current">
          <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
        </svg>
      </button>
    </header>

    <!-- 滚动区与播放条同层：内容从半透明播放条底下穿过去，玻璃才模糊得到东西 -->
    <div class="relative flex-1 min-h-0">
      <main class="absolute inset-0 overflow-y-auto pb-[150px] lg:pt-14 lg:pb-[112px]">
        <PlaylistView v-if="activePlaylistId" :id="activePlaylistId" />
        <ArtistView v-else-if="activeView.kind === 'artist'" :name="activeView.key" />
        <AlbumView
          v-else-if="activeAlbum"
          :artist="activeAlbum.artist"
          :album="activeAlbum.album"
        />
        <SearchView v-else-if="activeView.kind === 'search'" />
        <Home v-else />
      </main>
      <PlayerBar />
      <PlayerBarWide />
    </div>

    <TrackMenu />

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
