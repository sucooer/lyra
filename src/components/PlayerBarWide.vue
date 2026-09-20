<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { usePlayerStore, type Track } from '../stores/player'
import { openNowPlaying } from '../lib/nav'
import { fmtClock, useScrubber } from '../lib/scrubber'

const player = usePlayerStore()

const { dragging, onDragDown, onDragMove, onDragUp, onDragCancel, shownPercent, shownCurrent, shownRemain } =
  useScrubber(player)

/* ============ 音量：滑轨悬停展开，图标点击静音 ============ */
const lastVolume = ref(1)

function toggleMute() {
  if (player.volume > 0) {
    lastVolume.value = player.volume
    player.setVolume(0)
  } else {
    player.setVolume(lastVolume.value || 1)
  }
}

function volumeRatioFrom(e: PointerEvent): number {
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
}
const volumeDragging = ref(false)
function onVolumeDown(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  volumeDragging.value = true
  player.setVolume(volumeRatioFrom(e))
}
function onVolumeMove(e: PointerEvent) {
  if (volumeDragging.value) player.setVolume(volumeRatioFrom(e))
}
function onVolumeUp(e: PointerEvent) {
  if (!volumeDragging.value) return
  volumeDragging.value = false
  player.setVolume(volumeRatioFrom(e))
}

/* ============ 队列面板：接下来播放 ============ */
const queueOpen = ref(false)

/** 之后播放：先排「接下来播放」插队项，再按当前顺序往后取 */
const upcoming = computed<Track[]>(() => {
  const seen = new Set<string>()
  const out: Track[] = []
  const take = (id: string) => {
    const t = player.tracks.find((x) => x.id === id)
    if (t && !seen.has(t.id) && t.id !== player.currentTrack?.id) {
      seen.add(t.id)
      out.push(t)
    }
  }
  player.upNext.forEach(take)
  const order = player.playOrder
  const start = order.indexOf(player.currentTrack?.id ?? '')
  if (start >= 0) order.slice(start + 1).forEach(take)
  return out.slice(0, 40)
})

const upNextCount = computed(() => player.upNext.length)

function titleOf(t: Track) {
  return t.meta?.title || t.url.split('/').pop()?.replace(/\.[a-z0-9]+$/i, '') || '未知曲目'
}
function artistOf(t: Track) {
  return player.artistText(t.meta?.artist)
}
function playFromQueue(t: Track) {
  player.playId(t.id)
  queueOpen.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') queueOpen.value = false
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <!-- 宽屏胶囊播放条：左（曲目 + 进度）/ 中（控制键）/ 右（队列 + 音量） -->
  <div class="absolute inset-x-0 bottom-0 z-30 hidden lg:block px-6 pb-4">
    <div class="relative mx-auto w-full max-w-[1080px]">
      <!-- 队列面板（贴在胶囊上方，右侧对齐） -->
      <Transition name="queue-panel">
        <div
          v-if="queueOpen"
          class="absolute bottom-[calc(100%+12px)] right-0 w-[380px] rounded-2xl capsule-panel overflow-hidden"
        >
          <div class="flex items-baseline justify-between px-4 pt-3 pb-2">
            <span class="text-[13px] font-semibold">接下来播放</span>
            <span v-if="upNextCount" class="text-[12px] text-fg-muted">{{ upNextCount }} 首插队</span>
          </div>
          <div class="max-h-[320px] overflow-y-auto px-2 pb-2">
            <button
              v-for="t in upcoming"
              :key="t.id"
              class="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-fill transition text-left"
              @click="playFromQueue(t)"
            >
              <div class="w-8 h-8 rounded-[7px] overflow-hidden bg-fill shrink-0">
                <img v-if="t.meta?.coverUrl" :src="t.meta.coverUrl" class="w-full h-full object-cover" />
                <div v-else class="w-full h-full flex items-center justify-center text-fg-subtle text-xs">♪</div>
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-[13px] truncate">{{ titleOf(t) }}</div>
                <div class="text-[12px] text-fg-muted truncate">{{ artistOf(t) }}</div>
              </div>
            </button>
            <div v-if="!upcoming.length" class="px-4 py-8 text-center text-[13px] text-fg-subtle">
              队列是空的
            </div>
          </div>
        </div>
      </Transition>

      <!-- 胶囊本体 -->
      <div
        class="h-[72px] rounded-full capsule-glass grid grid-cols-[1fr_auto_1fr] items-center gap-5 pl-3 pr-5"
      >
        <!-- ============ 左：曲目 + 进度 ============ -->
        <div v-if="player.currentTrack" class="flex items-center gap-3 min-w-0">
          <button
            class="w-12 h-12 rounded-[10px] overflow-hidden bg-fill shrink-0"
            title="打开正在播放"
            @click="openNowPlaying()"
          >
            <img
              v-if="player.currentTrack.meta?.coverUrl"
              :src="player.currentTrack.meta.coverUrl"
              class="w-full h-full object-cover"
            />
            <div v-else class="w-full h-full flex items-center justify-center text-fg-subtle">♪</div>
          </button>

          <div class="min-w-0 flex-1">
            <div class="flex items-baseline gap-1.5 min-w-0">
              <button
                class="text-[13px] font-semibold truncate hover:opacity-70 transition"
                :title="player.displayTitle"
                @click="openNowPlaying()"
              >
                {{ player.displayTitle }}
              </button>
              <span class="text-[12px] text-fg-muted truncate">{{ player.displayArtist }}</span>
            </div>

            <!-- 细滑轨：默认只显示一条线，悬停/拖动才出圆点 -->
            <div class="mt-1 flex items-center gap-2.5">
              <div
                class="group relative h-[14px] flex-1 flex items-center cursor-pointer touch-none select-none"
                @pointerdown="onDragDown"
                @pointermove="onDragMove"
                @pointerup="onDragUp"
                @pointercancel="onDragCancel"
              >
                <div class="absolute inset-x-0 h-[3px] rounded-full bg-track">
                  <div class="relative h-full rounded-full bg-fg" :style="{ width: shownPercent + '%' }">
                    <span
                      class="absolute top-1/2 -right-[5px] -translate-y-1/2 w-[9px] h-[9px] rounded-full bg-fg transition-opacity"
                      :class="dragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
                    ></span>
                  </div>
                </div>
              </div>
              <span class="text-[11px] text-fg-muted tabular-nums shrink-0">
                {{ fmtClock(shownCurrent) }} / {{ fmtClock(player.duration) }}
              </span>
            </div>
          </div>
        </div>
        <!-- 没有曲目时左栏留空，中间控制键位置不变 -->
        <div v-else class="flex items-center gap-3 min-w-0 pl-1">
          <div
            class="w-12 h-12 rounded-[10px] bg-fill flex items-center justify-center text-fg-subtle shrink-0"
          >
            <svg viewBox="0 0 24 24" class="w-5 h-5 fill-current">
              <path d="M12 3v11.3A3.7 3.7 0 1 0 14 17.7V7h5V3h-7z" />
            </svg>
          </div>
          <span class="text-[13px] text-fg-muted">未在播放</span>
        </div>

        <!-- ============ 中：控制键 ============ -->
        <div class="flex items-center gap-6 shrink-0">
          <button
            class="transition"
            :class="player.shuffle ? 'text-music' : 'text-fg-muted hover:text-fg'"
            title="随机播放"
            @click="player.shuffle = !player.shuffle"
          >
            <svg viewBox="0 0 24 24" class="w-[19px] h-[19px] fill-current">
              <path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z" />
            </svg>
          </button>

          <button
            class="text-fg hover:opacity-60 active:opacity-40 transition"
            title="上一首"
            @click="player.prev()"
          >
            <svg viewBox="0 0 24 24" class="w-[22px] h-[22px] fill-current" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round">
              <path d="M18.5 4.5v15L8 12zM6 5h1.5v14H6z" />
            </svg>
          </button>

          <button
            class="text-fg hover:opacity-60 active:opacity-40 transition"
            :title="player.playing ? '暂停' : '播放'"
            @click="player.togglePlay"
          >
            <svg v-if="!player.playing" viewBox="0 0 24 24" class="w-[27px] h-[27px] fill-current" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round">
              <path d="M6.5 4.2v15.6L19.5 12z" />
            </svg>
            <svg v-else viewBox="0 0 24 24" class="w-[27px] h-[27px] fill-current" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round">
              <path d="M6.5 4.2h4v15.6h-4zM13.5 4.2h4v15.6h-4z" />
            </svg>
          </button>

          <button
            class="text-fg hover:opacity-60 active:opacity-40 transition"
            title="下一首"
            @click="player.next()"
          >
            <svg viewBox="0 0 24 24" class="w-[22px] h-[22px] fill-current" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round">
              <path d="M5.5 4.5v15L16 12zM16.5 5H18v14h-1.5z" />
            </svg>
          </button>

          <button
            class="transition"
            :class="player.repeat !== 'off' ? 'text-music' : 'text-fg-muted hover:text-fg'"
            :title="player.repeat === 'one' ? '单曲循环' : player.repeat === 'all' ? '列表循环' : '循环关闭'"
            @click="player.cycleRepeat"
          >
            <svg v-if="player.repeat !== 'one'" viewBox="0 0 24 24" class="w-[19px] h-[19px] fill-current">
              <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z" />
            </svg>
            <svg v-else viewBox="0 0 24 24" class="w-[19px] h-[19px] fill-current">
              <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z" />
            </svg>
          </button>
        </div>

        <!-- ============ 右：队列 + 音量 ============ -->
        <div class="flex items-center justify-end gap-2">
          <button
            class="relative z-10 w-8 h-8 rounded-full flex items-center justify-center transition"
            :class="queueOpen ? 'text-music' : 'text-fg-muted hover:text-fg'"
            title="播放队列"
            @click="queueOpen = !queueOpen"
          >
            <svg viewBox="0 0 24 24" class="w-[19px] h-[19px] fill-current">
              <path d="M4 6h2v2H4zm4 0h12v2H8zM4 11h2v2H4zm4 0h12v2H8zM4 16h2v2H4zm4 0h12v2H8z" />
            </svg>
          </button>

          <!-- 音量：图标点击静音，滑轨悬停/拖动时滑出（绝对定位，不挤动其它元素） -->
          <div class="group relative flex items-center">
            <button
              class="w-8 h-8 rounded-full flex items-center justify-center text-fg-muted hover:text-fg transition"
              :title="player.volume > 0 ? '静音' : '取消静音'"
              @click="toggleMute"
            >
              <svg v-if="player.volume <= 0" viewBox="0 0 24 24" class="w-[19px] h-[19px] fill-current">
                <path d="M3 9v6h4l5 4V5L7 9H3zm16.5 3 2.5-2.5-1.4-1.4-2.5 2.5-2.5-2.5-1.4 1.4L16.7 12l-2.5 2.5 1.4 1.4 2.5-2.5 2.5 2.5 1.4-1.4L19.5 12z" />
              </svg>
              <svg v-else viewBox="0 0 24 24" class="w-[19px] h-[19px] fill-current">
                <path d="M3 9v6h4l5 4V5L7 9H3zm11.5 3a3.5 3.5 0 0 0-2-3.2v6.4a3.5 3.5 0 0 0 2-3.2zm-2-7v2.1c2.3.5 4 2.5 4 4.9s-1.7 4.4-4 4.9V19c3.4-.5 6-3.4 6-7s-2.6-6.5-6-7z" />
              </svg>
            </button>

            <div
              class="absolute right-full top-1/2 -translate-y-1/2 pr-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity"
            >
              <div
                class="w-[84px] h-[14px] flex items-center cursor-pointer touch-none select-none"
                @pointerdown="onVolumeDown"
                @pointermove="onVolumeMove"
                @pointerup="onVolumeUp"
                @pointercancel="onVolumeUp"
              >
                <div class="relative w-full h-[3px] rounded-full bg-track">
                  <div class="h-full rounded-full bg-fg" :style="{ width: player.volume * 100 + '%' }"></div>
                  <span
                    class="absolute top-1/2 -translate-y-1/2 -ml-[5px] w-[9px] h-[9px] rounded-full bg-fg"
                    :style="{ left: player.volume * 100 + '%' }"
                  ></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.queue-panel-enter-active,
.queue-panel-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.queue-panel-enter-from,
.queue-panel-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
