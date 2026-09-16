<script setup lang="ts">
import { usePlayerStore } from '../stores/player'
import { openNowPlaying } from '../lib/nav'
import { fmtClock, useScrubber } from '../lib/scrubber'

const player = usePlayerStore()

// 拖拽逻辑与宽屏胶囊条共用（见 lib/scrubber.ts）
const { dragging, onDragDown, onDragMove, onDragUp, onDragCancel, shownPercent, shownCurrent, shownRemain } =
  useScrubber(player)
</script>

<template>
  <!-- 浮起的圆角玻璃条（对齐 Apple Music 迷你播放条），无歌曲时也保留位置。
       宽屏另有单行胶囊版本（PlayerBarWide），这里从 lg 起让位 -->
  <div class="absolute inset-x-0 bottom-0 z-30 lg:hidden px-2 pb-2 sm:px-3 sm:pb-3">
    <div class="relative rounded-[32px] bar-glass overflow-hidden">
      <!-- ===================== 有歌曲 ===================== -->
      <template v-if="player.currentTrack">
        <!-- 第一行：封面 / 曲目信息 / 官方双键控制 -->
        <div class="flex items-center gap-3 pl-3 pr-4 sm:pl-4 sm:pr-6 pt-3 sm:pt-3.5">
          <button
            class="flex items-center gap-3.5 min-w-0 flex-1 text-left"
            @click="openNowPlaying()"
          >
            <div
              class="w-13 h-13 sm:w-14 sm:h-14 rounded-[16px] overflow-hidden bg-fill shrink-0"
            >
              <img
                v-if="player.currentTrack.meta?.coverUrl"
                :src="player.currentTrack.meta.coverUrl"
                class="w-full h-full object-cover"
              />
              <div v-else class="w-full h-full flex items-center justify-center text-fg-subtle">♪</div>
            </div>
            <div class="min-w-0">
              <div class="text-[17px] font-semibold truncate leading-tight">
                {{ player.displayTitle }}
              </div>
              <div class="text-[15px] text-fg-muted truncate mt-0.5">
                {{ player.displayArtist }}
              </div>
            </div>
          </button>

          <!-- 控制键：官方迷你播放条只有 ▶ / ⏸ 与 ▶▶ 两个纯色按钮 -->
          <div class="flex items-center gap-7 sm:gap-8 shrink-0">
            <!-- 随机 / 循环：官方桌面端播放条才有的附加键，窄屏隐藏保持官方迷你条外观 -->
            <button
              class="hidden xl:flex transition"
              :class="player.shuffle ? 'text-music' : 'text-fg-muted hover:text-fg'"
              @click="player.shuffle = !player.shuffle"
              title="随机播放"
            >
              <svg viewBox="0 0 24 24" class="w-[18px] h-[18px] fill-current"><path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>
            </button>

            <!-- ▶ / ⏸ 播放暂停：纯色三角，无圆形底 -->
            <button
              class="text-fg hover:opacity-60 active:opacity-40 transition"
              @click="player.togglePlay"
              :title="player.playing ? '暂停' : '播放'"
            >
              <svg v-if="!player.playing" viewBox="0 0 24 24" class="w-7 h-7 sm:w-8 sm:h-8 fill-current" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">
                <path d="M6 4.5v15L19 12z" />
              </svg>
              <svg v-else viewBox="0 0 24 24" class="w-7 h-7 sm:w-8 sm:h-8 fill-current" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">
                <path d="M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z" />
              </svg>
            </button>

            <!-- ▶▶ 下一首：双三角 -->
            <button
              class="text-fg hover:opacity-60 active:opacity-40 transition"
              @click="player.next()"
              title="下一首"
            >
              <svg viewBox="0 0 24 24" class="w-8 h-8 sm:w-9 sm:h-9 fill-current" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">
                <path d="M2.5 5v14L12 12zM11 5v14l9.5-7z" />
              </svg>
            </button>

            <button
              class="hidden xl:flex transition"
              :class="player.repeat !== 'off' ? 'text-music' : 'text-fg-muted hover:text-fg'"
              @click="player.cycleRepeat"
              :title="player.repeat === 'one' ? '单曲循环' : player.repeat === 'all' ? '列表循环' : '循环关闭'"
            >
              <svg v-if="player.repeat !== 'one'" viewBox="0 0 24 24" class="w-[18px] h-[18px] fill-current"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/></svg>
              <svg v-else viewBox="0 0 24 24" class="w-[18px] h-[18px] fill-current"><path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4zm-4-2V9h-1l-2 1v1h1.5v4H13z"/></svg>
            </button>
          </div>
        </div>

        <!-- 第二行：进度滑轨（粗轨道 + 大圆点滑块） -->
        <div class="px-3 sm:px-4 pt-2.5 sm:pt-3 pb-2.5 sm:pb-3">
          <div
            class="relative h-4 flex items-center cursor-pointer touch-none select-none"
            @pointerdown="onDragDown"
            @pointermove="onDragMove"
            @pointerup="onDragUp"
            @pointercancel="onDragCancel"
          >
            <!-- 轨道 -->
            <div class="absolute inset-x-0 h-[5px] rounded-full bg-track">
              <!-- 已播放部分 -->
              <div
                class="relative h-full rounded-full bg-fg"
                :style="{ width: shownPercent + '%' }"
              >
                <!-- 大号圆形滑块：中心落在播放进度上，可拖拽 -->
                <span
                  class="absolute top-1/2 -right-2 -translate-y-1/2 w-4 h-4 rounded-full bg-fg shadow-[0_1px_4px_rgba(0,0,0,0.35)] transition-transform"
                  :class="dragging ? 'scale-125' : ''"
                ></span>
              </div>
            </div>
          </div>

          <!-- 第三行：已播放时间 / 剩余时间 -->
          <div class="flex justify-between mt-1.5 text-[11px] text-fg-subtle tabular-nums">
            <span>{{ fmtClock(shownCurrent) }}</span>
            <span>-{{ fmtClock(shownRemain) }}</span>
          </div>
        </div>
      </template>

      <!-- ===================== 无歌曲：官方空播放条 ===================== -->
      <div v-else class="flex items-center gap-3 pl-3 pr-4 sm:pl-4 sm:pr-6 py-3 sm:py-3.5">
        <div
          class="w-13 h-13 sm:w-14 sm:h-14 rounded-[16px] bg-fill flex items-center justify-center text-fg-subtle shrink-0"
        >
          <svg viewBox="0 0 24 24" class="w-6 h-6 fill-current">
            <path d="M12 3v11.3A3.7 3.7 0 1 0 14 17.7V7h5V3h-7z" />
          </svg>
        </div>
        <!-- 官方空态同为 ▶ 与 ▶▶ 两个纯色双键 -->
        <div class="flex items-center gap-7 sm:gap-8 text-fg ml-auto" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="w-7 h-7 sm:w-8 sm:h-8 fill-current" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">
            <path d="M6 4.5v15L19 12z" />
          </svg>
          <svg viewBox="0 0 24 24" class="w-8 h-8 sm:w-9 sm:h-9 fill-current" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round">
            <path d="M2.5 5v14L12 12zM11 5v14l9.5-7z" />
          </svg>
        </div>
      </div>
    </div>
  </div>
</template>
