<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePlayerStore, type Track } from '../stores/player'

const player = usePlayerStore()

function title(t: Track): string {
  if (t.meta?.title) return t.meta.title
  try {
    return decodeURIComponent(new URL(t.url).pathname.split('/').pop() ?? t.url).replace(
      /\.[a-z0-9]+$/i,
      '',
    )
  } catch {
    return t.url
  }
}

function fmt(sec?: number): string {
  if (!sec || !isFinite(sec)) return '--:--'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function click(t: Track, i: number) {
  if (player.currentIndex === i) player.togglePlay()
  else player.play(i)
}

/* ---------- 每行右侧「•••」菜单 ---------- */
const menuId = ref<string | null>(null)
const menuPos = ref({ x: 0, y: 0 })
const MENU_W = 208
const MENU_H = 214

const menuTrack = computed(() => player.tracks.find((t) => t.id === menuId.value) ?? null)

function openMenu(e: MouseEvent, t: Track) {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  menuPos.value = {
    x: Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8)),
    y: Math.max(8, Math.min(r.bottom + 6, window.innerHeight - MENU_H - 8)),
  }
  menuId.value = t.id
}
function closeMenu() {
  menuId.value = null
}
/** 先取出 id 再关菜单：关菜单会让 menuTrack 变 null，回调里就不能再引用它了 */
function run(action: (id: string) => void) {
  const id = menuId.value
  if (!id) return
  closeMenu()
  action(id)
}

/** 已在「接下来播放」队列里的行显示一个小标记 */
function queued(id: string): boolean {
  return player.upNext.includes(id)
}
</script>

<template>
  <div class="px-4 sm:px-6">
    <!-- 歌单还在加载：显示加载态，避免刷新瞬间闪现「歌单是空的」 -->
    <div v-if="!player.playlistLoaded" class="mt-20 text-center text-fg-subtle text-sm space-y-3">
      <div class="text-5xl animate-pulse">🎵</div>
      <div>正在加载歌单…</div>
    </div>

    <div
      v-else-if="player.tracks.length === 0"
      class="mt-20 text-center text-fg-subtle text-sm space-y-2"
    >
      <div class="text-5xl">🎵</div>
      <div>歌单是空的，编辑 public/playlist.json 添加歌曲直链后刷新</div>
    </div>

    <!-- Apple Music 风格：行与行之间用细分隔线，不做卡片高亮 -->
    <div v-else class="divide-y divide-line border-y border-line">
      <div
        v-for="(t, i) in player.tracks"
        :key="t.id"
        class="group flex items-center gap-3 py-2.5 cursor-pointer active:bg-fill transition-colors"
        @dblclick="player.play(i)"
        @click="click(t, i)"
      >
        <div class="w-12 h-12 rounded-md overflow-hidden bg-fill shrink-0 relative">
          <img
            v-if="t.meta?.coverUrl"
            :src="t.meta.coverUrl"
            class="w-full h-full object-cover"
            loading="lazy"
          />
          <div v-else class="w-full h-full flex items-center justify-center text-fg-subtle">
            <span v-if="t.loading" class="animate-pulse text-xs">…</span>
            <span v-else>♪</span>
          </div>
          <div
            v-if="player.currentIndex === i && player.playing"
            class="absolute inset-0 bg-scrim flex items-end justify-center gap-[2px] pb-1.5"
          >
            <span class="w-[3px] bg-music rounded animate-bounce h-3" style="animation-delay: 0s"></span>
            <span class="w-[3px] bg-music rounded animate-bounce h-4" style="animation-delay: .15s"></span>
            <span class="w-[3px] bg-music rounded animate-bounce h-2" style="animation-delay: .3s"></span>
          </div>
        </div>

        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5">
            <span
              class="text-[15px] leading-snug truncate"
              :class="player.currentIndex === i ? 'text-music font-medium' : 'font-normal'"
            >
              {{ title(t) }}
            </span>
            <!-- 已加入「接下来播放」 -->
            <svg
              v-if="queued(t.id)"
              viewBox="0 0 24 24"
              class="w-3.5 h-3.5 fill-current text-music shrink-0"
            >
              <title>接下来播放</title>
              <path d="M3 6h13v2H3V6zm0 5h13v2H3v-2zm0 5h9v2H3v-2zm15-9v8.2a2.8 2.8 0 1 1-2-2.7V4h4v2h-2z" />
            </svg>
          </div>
          <div class="text-[13px] leading-snug text-fg-muted truncate mt-0.5">
            {{ t.meta?.artist || (t.loading ? '解析中…' : '未知艺术家') }}
          </div>
        </div>

        <button
          class="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-fg-muted hover:text-fg hover:bg-fill transition"
          title="更多"
          @click.stop="openMenu($event, t)"
        >
          <svg viewBox="0 0 24 24" class="w-5 h-5 fill-current">
            <circle cx="5" cy="12" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="19" cy="12" r="1.7" />
          </svg>
        </button>
      </div>
    </div>
  </div>

  <!-- 「•••」弹出菜单 -->
  <Teleport to="body">
    <div
      v-if="menuId"
      class="fixed inset-0 z-40"
      @click="closeMenu"
      @contextmenu.prevent="closeMenu"
    ></div>
    <div
      v-if="menuId && menuTrack"
      class="fixed z-50 rounded-2xl overflow-hidden border border-line bg-app/95 backdrop-blur-2xl shadow-2xl shadow-black/40"
      :style="{ left: menuPos.x + 'px', top: menuPos.y + 'px', width: MENU_W + 'px' }"
    >
      <!-- 头部：曲目信息（含时长/编码，之前列表右侧展示的信息移到这里） -->
      <div class="px-4 pt-3 pb-2.5 border-b border-line">
        <div class="text-[15px] font-medium truncate">{{ title(menuTrack) }}</div>
        <div class="text-[12px] text-fg-muted truncate mt-0.5">
          {{ menuTrack.meta?.artist || '未知艺术家' }}
          <template v-if="menuTrack.meta?.duration"> · {{ fmt(menuTrack.meta.duration) }}</template>
          <template v-if="menuTrack.meta?.codec"> · {{ menuTrack.meta.codec }}</template>
          <template v-if="menuTrack.meta?.bitrate"> {{ menuTrack.meta.bitrate }}kbps</template>
        </div>
      </div>

      <div class="py-1">
        <button
          class="w-full flex items-center gap-3 px-4 py-2.5 text-[15px] hover:bg-fill transition text-left"
          @click="run((id) => player.playNext(id))"
        >
          <svg viewBox="0 0 24 24" class="w-[18px] h-[18px] fill-current text-fg-muted shrink-0">
            <path d="M3 6h13v2H3V6zm0 5h13v2H3v-2zm0 5h9v2H3v-2zm15-9v8.2a2.8 2.8 0 1 1-2-2.7V4h4v2h-2z" />
          </svg>
          接下来播放
        </button>
        <button
          class="w-full flex items-center gap-3 px-4 py-2.5 text-[15px] hover:bg-fill transition text-left"
          @click="run((id) => player.playLast(id))"
        >
          <svg viewBox="0 0 24 24" class="w-[18px] h-[18px] fill-current text-fg-muted shrink-0">
            <path d="M3 6h13v2H3V6zm0 5h13v2H3v-2zm0 5h13v2H3v-2zm17-9v8.2a2.8 2.8 0 1 1-2-2.7V4h4v2h-2z" />
          </svg>
          最后播放
        </button>
        <div class="my-1 border-t border-line"></div>
        <button
          class="w-full flex items-center gap-3 px-4 py-2.5 text-[15px] hover:bg-fill transition text-left text-music"
          @click="run((id) => player.remove(id))"
        >
          <svg viewBox="0 0 24 24" class="w-[18px] h-[18px] fill-current shrink-0">
            <path d="M7 4h10v2h3v2H4V6h3V4zm-1 6h12l-1 11H7L6 10zm4 2v7h1v-7h-1zm4 0v7h1v-7h-1z" />
          </svg>
          从歌单移除
        </button>
      </div>
    </div>
  </Teleport>
</template>
