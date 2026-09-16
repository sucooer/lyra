<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePlayerStore } from '../stores/player'

const player = usePlayerStore()

const progress = computed(() =>
  player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0,
)

/** 拖动中的预览比例（null = 未在拖动）；松手才真正 seek，避免流式音频频繁 range 请求 */
const dragRatio = ref<number | null>(null)

function ratioFrom(e: PointerEvent): number {
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
}

function onDragDown(e: PointerEvent) {
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  dragRatio.value = ratioFrom(e)
}
function onDragMove(e: PointerEvent) {
  if (dragRatio.value === null) return
  dragRatio.value = ratioFrom(e)
}
function onDragUp(e: PointerEvent) {
  if (dragRatio.value === null) return
  player.seek(ratioFrom(e) * player.duration)
  dragRatio.value = null
}
function onDragCancel() {
  dragRatio.value = null
}

/** 拖动/点击时用于显示的时间 */
const shownCurrent = computed(() =>
  dragRatio.value !== null ? dragRatio.value * player.duration : player.currentTime,
)

function fmt(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function onSeek(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const r = el.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
  player.seek(ratio * player.duration)
}
</script>

<template>
  <!-- 浮起的圆角胶囊（Apple Music 新版迷你播放条），无歌曲时也保留位置 -->
  <div class="relative z-30 px-2 pt-1 pb-2 sm:px-3 sm:pb-3">
    <div class="relative rounded-2xl border border-line bg-bar backdrop-blur-xl overflow-hidden">
      <!-- ===== 有歌曲：完整控制条 ===== -->
      <template v-if="player.currentTrack">
        <!-- 桌面端：胶囊顶部细进度条（hover 加深） -->
        <div
          class="hidden md:block absolute top-0 left-3 right-3 h-[6px] cursor-pointer group z-10"
          @click="onSeek"
        >
          <div class="h-[3px] mt-[3px] bg-track group-hover:h-[5px] group-hover:mt-[1px] transition-all rounded-full">
            <div class="h-full bg-fg group-hover:bg-music transition-colors rounded-full" :style="{ width: progress + '%' }"></div>
          </div>
        </div>

        <div class="flex items-center gap-2 sm:gap-4 px-3 sm:px-4 h-14 sm:h-16">
          <!-- 封面 + 信息（点击展开全屏；移动端占满剩余宽度） -->
          <button
        class="flex items-center gap-3 min-w-0 flex-1 md:flex-none md:w-64 text-left"
        @click="player.showNowPlaying = true"
      >
        <div class="w-10 h-10 sm:w-11 sm:h-11 rounded-lg overflow-hidden bg-fill shrink-0 shadow-lg">
          <img
            v-if="player.currentTrack.meta?.coverUrl"
            :src="player.currentTrack.meta.coverUrl"
            class="w-full h-full object-cover"
          />
          <div v-else class="w-full h-full flex items-center justify-center text-fg-subtle">♪</div>
        </div>
        <div class="min-w-0">
          <div class="text-sm font-medium truncate">{{ player.displayTitle }}</div>
          <div class="text-xs text-fg-muted truncate">{{ player.displayArtist }}</div>
        </div>
      </button>

      <!-- 控制区：移动端只留 prev/play/next，桌面端全量 -->
      <div class="flex items-center justify-end sm:justify-center gap-3 sm:gap-6 shrink-0">
        <button
          class="hidden sm:flex transition shrink-0"
          :class="player.shuffle ? 'text-music' : 'text-fg-muted hover:text-fg'"
          @click="player.shuffle = !player.shuffle"
          title="随机播放"
        >
          <svg viewBox="0 0 24 24" class="w-4 h-4 fill-current"><path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
        </button>
        <button class="text-fg hover:opacity-70 transition shrink-0" @click="player.prev" title="上一首">
          <svg viewBox="0 0 24 24" class="w-6 h-6 sm:w-6 sm:h-6 fill-current"><path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/></svg>
        </button>
        <button
          class="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-solid text-on-solid flex items-center justify-center hover:scale-105 transition shrink-0"
          @click="player.togglePlay"
        >
          <svg v-if="!player.playing" viewBox="0 0 24 24" class="w-4 h-4 sm:w-5 sm:h-5 fill-current ml-0.5"><path d="M8 5v14l11-7z"/></svg>
          <svg v-else viewBox="0 0 24 24" class="w-4 h-4 sm:w-5 sm:h-5 fill-current"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
        </button>
        <button class="text-fg hover:opacity-70 transition shrink-0" @click="player.next()" title="下一首">
          <svg viewBox="0 0 24 24" class="w-6 h-6 sm:w-6 sm:h-6 fill-current"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/></svg>
        </button>
        <button
          class="hidden sm:flex transition shrink-0"
          :class="player.repeat !== 'off' ? 'text-music' : 'text-fg-muted hover:text-fg'"
          @click="player.cycleRepeat"
          title="循环"
        >
          <svg v-if="player.repeat !== 'one'" viewBox="0 0 24 24" class="w-4 h-4 fill-current"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
          <svg v-else viewBox="0 0 24 24" class="w-4 h-4 fill-current"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/></svg>
        </button>
      </div>

      <!-- 时间 + 音量（仅桌面） -->
      <div class="hidden sm:flex w-52 lg:w-64 items-center justify-end gap-2 lg:gap-3 text-xs text-fg-muted tabular-nums shrink-0">
        <span>{{ fmt(player.currentTime) }}</span>
        <span class="hidden lg:inline">/</span>
        <span class="hidden lg:inline">{{ fmt(player.duration) }}</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="player.volume"
          class="hidden lg:block w-20 accent-music"
          @input="player.setVolume(parseFloat(($event.target as HTMLInputElement).value))"
        />
      </div>
    </div>

    <!-- 移动端：底部常驻进度条（pointer 事件统一处理点击和拖动，松手才 seek） -->
    <div
      class="md:hidden px-3 pt-2 pb-2 touch-none select-none"
      @pointerdown="onDragDown"
      @pointermove="onDragMove"
      @pointerup="onDragUp"
      @pointercancel="onDragCancel"
    >
      <!-- 滑轨行：容器高度 = 滑块高度，滑块完整落在行内不外溢 -->
      <div class="relative h-3.5 flex items-center cursor-pointer">
        <div class="absolute inset-x-0 h-1 bg-track rounded-full">
          <div
            class="absolute left-0 top-0 h-full bg-fg rounded-full"
            :style="{ width: (dragRatio ?? progress) + '%' }"
          >
            <span
              class="absolute -right-1.5 -top-1 w-3 h-3 rounded-full bg-fg shadow transition-transform"
              :class="dragRatio !== null ? 'scale-125' : ''"
            ></span>
          </div>
        </div>
      </div>
      <!-- 时间行：与滑轨间隔 6px，滑块碰不到 -->
      <div class="flex justify-between mt-1.5 text-[10px] text-fg-subtle tabular-nums">
        <span>{{ fmt(shownCurrent) }}</span>
        <span>-{{ fmt(Math.max(0, player.duration - shownCurrent)) }}</span>
      </div>
      </div>
      </template>

      <!-- ===== 无歌曲：Apple Music 式空播放条（封面占位 + 灰掉的控制键） ===== -->
      <div v-else class="flex items-center justify-between pl-3 pr-5 h-14 sm:h-16">
        <div
          class="w-10 h-10 sm:w-11 sm:h-11 rounded-lg bg-fill flex items-center justify-center text-fg-subtle shrink-0"
        >
          <svg viewBox="0 0 24 24" class="w-5 h-5 fill-current">
            <path d="M12 3v11.3A3.7 3.7 0 1 0 14 17.7V7h5V3h-7z" />
          </svg>
        </div>
        <div class="flex items-center gap-6 text-fg-subtle/70" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="w-8 h-8 fill-current">
            <path d="M8 5v14l11-7z" />
          </svg>
          <svg viewBox="0 0 24 24" class="w-8 h-8 fill-current">
            <path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" />
          </svg>
        </div>
      </div>
    </div>
  </div>
</template>