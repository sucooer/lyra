<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore, type Track } from '../stores/player'
import { useTrackMenu } from '../lib/trackMenu'
import { trackTitle } from '../lib/track'

const props = defineProps<{
  track: Track
  /** library = 资料库列表（点播会退出歌单上下文）；playlist = 歌单内（在歌单顺序里播） */
  source?: 'library' | 'playlist'
}>()

const player = usePlayerStore()
const menu = useTrackMenu()

const active = computed(() => player.currentTrack?.id === props.track.id)
const queued = computed(() => player.upNext.includes(props.track.id))

function onRow() {
  if (active.value) player.togglePlay()
  else if (props.source === 'library') player.playFromLibrary(props.track.id)
  else player.playId(props.track.id)
}
</script>

<template>
  <div
    class="group flex items-center gap-3 py-2.5 cursor-pointer active:bg-fill transition-colors"
    @dblclick="onRow"
    @click="onRow"
  >
    <div class="w-12 h-12 rounded-md overflow-hidden bg-fill shrink-0 relative">
      <img
        v-if="track.meta?.coverUrl"
        :src="track.meta.coverUrl"
        class="w-full h-full object-cover"
        loading="lazy"
      />
      <div v-else class="w-full h-full flex items-center justify-center text-fg-subtle">
        <span v-if="track.loading" class="animate-pulse text-xs">…</span>
        <span v-else>♪</span>
      </div>
      <div
        v-if="active && player.playing"
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
          :class="active ? 'text-music font-medium' : 'font-normal'"
        >
          {{ trackTitle(track) }}
        </span>
        <!-- 已加入「接下来播放」 -->
        <svg
          v-if="queued"
          viewBox="0 0 24 24"
          class="w-3.5 h-3.5 fill-current text-music shrink-0"
        >
          <title>接下来播放</title>
          <path d="M3 6h13v2H3V6zm0 5h13v2H3v-2zm0 5h9v2H3v-2zm15-9v8.2a2.8 2.8 0 1 1-2-2.7V4h4v2h-2z" />
        </svg>
      </div>
      <div class="text-[13px] leading-snug text-fg-muted truncate mt-0.5">
        {{ track.meta?.artist || (track.loading ? '解析中…' : '未知艺术家') }}
      </div>
    </div>

    <button
      class="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-fg-muted hover:text-fg hover:bg-fill transition"
      title="更多"
      @click.stop="menu.open($event, track)"
    >
      <svg viewBox="0 0 24 24" class="w-5 h-5 fill-current">
        <circle cx="5" cy="12" r="1.7" />
        <circle cx="12" cy="12" r="1.7" />
        <circle cx="19" cy="12" r="1.7" />
      </svg>
    </button>
  </div>
</template>
