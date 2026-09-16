<script setup lang="ts">
import { usePlayerStore } from '../stores/player'
import { useTrackMenu } from '../lib/trackMenu'
import { trackTitle, fmtTime } from '../lib/track'

const player = usePlayerStore()
const menu = useTrackMenu()

const queueIcon = 'M3 6h13v2H3V6zm0 5h13v2H3v-2zm0 5h9v2H3v-2zm15-9v8.2a2.8 2.8 0 1 1-2-2.7V4h4v2h-2z'
const lastIcon = 'M3 6h13v2H3V6zm0 5h13v2H3v-2zm0 5h13v2H3v-2zm17-9v8.2a2.8 2.8 0 1 1-2-2.7V4h4v2h-2z'
</script>

<template>
  <Teleport to="body">
    <div
      v-if="menu.isOpen.value"
      class="fixed inset-0 z-40"
      @click="menu.close"
      @contextmenu.prevent="menu.close"
    ></div>
    <div
      v-if="menu.isOpen.value && menu.target.value"
      class="fixed z-50 rounded-2xl overflow-hidden border border-line bg-app/95 backdrop-blur-2xl shadow-2xl shadow-black/40"
      :style="{ left: menu.pos.value.x + 'px', top: menu.pos.value.y + 'px', width: menu.MENU_W + 'px' }"
    >
      <div class="px-4 pt-3 pb-2.5 border-b border-line">
        <div class="text-[15px] font-medium truncate">{{ trackTitle(menu.target.value) }}</div>
        <div class="text-[12px] text-fg-muted truncate mt-0.5">
          {{ menu.target.value.meta?.artist || '未知艺术家' }}
          <template v-if="menu.target.value.meta?.duration">
            · {{ fmtTime(menu.target.value.meta.duration) }}
          </template>
          <template v-if="menu.target.value.meta?.codec">
            · {{ menu.target.value.meta.codec }}
          </template>
          <template v-if="menu.target.value.meta?.bitrate">
            {{ menu.target.value.meta.bitrate }}kbps
          </template>
        </div>
      </div>

      <div class="py-1">
        <button
          class="w-full flex items-center gap-3 px-4 py-2.5 text-[15px] hover:bg-fill transition text-left"
          @click="menu.run((id) => player.playNext(id))"
        >
          <svg viewBox="0 0 24 24" class="w-[18px] h-[18px] fill-current text-fg-muted shrink-0">
            <path :d="queueIcon" />
          </svg>
          接下来播放
        </button>
        <button
          class="w-full flex items-center gap-3 px-4 py-2.5 text-[15px] hover:bg-fill transition text-left"
          @click="menu.run((id) => player.playLast(id))"
        >
          <svg viewBox="0 0 24 24" class="w-[18px] h-[18px] fill-current text-fg-muted shrink-0">
            <path :d="lastIcon" />
          </svg>
          最后播放
        </button>
        <div class="my-1 border-t border-line"></div>
        <button
          class="w-full flex items-center gap-3 px-4 py-2.5 text-[15px] hover:bg-fill transition text-left text-music"
          @click="menu.run((id) => player.remove(id))"
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
