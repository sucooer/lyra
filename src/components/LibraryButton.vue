<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { usePlayerStore } from '../stores/player'
import { activeView, openAlbums, openArtists, openPlaylist } from '../lib/nav'
import { buildAlbumIndex, buildArtistIndex } from '../lib/search'

/**
 * 顶栏的「资料库」入口：点开是一个面板，里面是歌手 / 专辑两个索引页 + 歌单快捷跳转。
 *
 * 为什么做在顶栏弹层而不是常驻侧边栏：侧边栏要重排整个外壳（悬浮顶栏、视口居中的
 * 播放胶囊、各视图的 lg 内边距都得跟着重算，1024px 档网格还会掉一列），而真正缺的是
 * 「歌手 / 专辑没有列表入口」这件事 —— 先用最轻的入口把它补上，确认自己真的会顺着逛，
 * 再决定要不要把它挪进常驻侧栏。
 */
const player = usePlayerStore()

const open = ref(false)
/** 面板锚在这个按钮上：窄屏下 header 是普通流（没有定位上下文），不能拿 header 当锚点 */
const anchor = ref<HTMLElement | null>(null)

/**
 * 面板上那两个数字必须和索引页里看到的一致 —— 所以直接调索引页用的同一个聚合函数，
 * 而不是另写一套统计（差一位数就会让人怀疑页面坏了）。曲库是异步装的，tracks 为空时
 * 先显示占位，等它到齐再算。
 */
const indexes = computed(() =>
  player.tracks.length
    ? { artists: buildArtistIndex(player.tracks), albums: buildAlbumIndex(player.tracks) }
    : null,
)
const playlistCount = computed(() => player.playlistCards.length)
const libraryCount = computed(() => player.collections.length)
const collections = computed(() => player.collections)

function toggle() {
  open.value = !open.value
}

function choose(fn: () => void) {
  open.value = false
  fn()
}

/** 点外部 / Esc 关闭。面板不是模态，不需要锁滚动 */
function onDocPointer(e: PointerEvent) {
  if (!open.value) return
  const el = anchor.value
  if (el && e.target instanceof Node && el.contains(e.target)) return
  open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointer, true)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointer, true)
  window.removeEventListener('keydown', onKey)
})

// 路由一变就收起：否则点进索引页后面板还挂在顶栏上
watch(activeView, () => (open.value = false))
</script>

<template>
  <div ref="anchor" class="relative shrink-0">
    <button
      data-library-toggle
      class="w-9 h-9 rounded-full flex items-center justify-center transition"
      :class="open ? 'text-fg bg-fill' : 'text-fg-muted hover:text-fg hover:bg-fill'"
      title="资料库（歌手 / 专辑 / 歌单）"
      aria-label="资料库"
      :aria-expanded="open"
      @click="toggle"
    >
      <!-- 四宫格：资料库的通用意象 -->
      <svg viewBox="0 0 24 24" class="w-[18px] h-[18px] fill-current">
        <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h3A1.5 1.5 0 0 1 10 5.5v3A1.5 1.5 0 0 1 8.5 10h-3A1.5 1.5 0 0 1 4 8.5v-3zM14 5.5A1.5 1.5 0 0 1 15.5 4h3A1.5 1.5 0 0 1 20 5.5v3A1.5 1.5 0 0 1 18.5 10h-3A1.5 1.5 0 0 1 14 8.5v-3zM4 15.5A1.5 1.5 0 0 1 5.5 14h3A1.5 1.5 0 0 1 10 15.5v3A1.5 1.5 0 0 1 8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3zM14 15.5A1.5 1.5 0 0 1 15.5 14h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3a1.5 1.5 0 0 1-1.5-1.5v-3z" />
      </svg>
    </button>

    <Transition name="library-panel">
      <div
        v-if="open"
        data-library-panel
        class="absolute right-0 top-full mt-2 z-50 w-[248px] max-h-[70vh] overflow-y-auto rounded-2xl capsule-panel p-2 text-left"
      >
        <button
          data-library-artists
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-fill transition text-left"
          @click="choose(openArtists)"
        >
          <span class="w-7 h-7 shrink-0 rounded-full bg-fill-strong flex items-center justify-center text-[11px] font-semibold tabular-nums">
            {{ indexes ? indexes.artists.length : '–' }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-[14px] font-medium truncate">全部歌手</span>
            <span class="block text-[12px] text-fg-muted truncate">按曲目数排，联名两边都算</span>
          </span>
        </button>

        <button
          data-library-albums
          class="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-fill transition text-left"
          @click="choose(openAlbums)"
        >
          <span class="w-7 h-7 shrink-0 rounded-full bg-fill-strong flex items-center justify-center text-[11px] font-semibold tabular-nums">
            {{ indexes ? indexes.albums.length : '–' }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-[14px] font-medium truncate">全部专辑</span>
            <span class="block text-[12px] text-fg-muted truncate">年份新的在前</span>
          </span>
        </button>

        <div v-if="playlistCount" class="mt-1 pt-2 border-t border-line">
          <div class="px-3 pb-1 text-[12px] font-medium text-fg-subtle">
            歌单<template v-if="libraryCount > playlistCount"> · 含全部歌曲</template>
          </div>
          <button
            v-for="c in collections"
            :key="c.def.id"
            :data-library-playlist="c.def.id"
            class="w-full px-3 py-2 rounded-xl hover:bg-fill transition text-left"
            @click="choose(() => openPlaylist(c.def.id))"
          >
            <span class="block text-[14px] truncate">{{ c.def.title }}</span>
            <span v-if="c.def.subtitle" class="block text-[12px] text-fg-muted truncate">
              {{ c.def.subtitle }}
            </span>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.library-panel-enter-active,
.library-panel-leave-active {
  transition:
    opacity 0.16s ease-out,
    transform 0.16s ease-out;
}
.library-panel-enter-from,
.library-panel-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
