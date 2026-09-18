<script setup lang="ts">
import { computed, ref } from 'vue'
import { connectLastfm, disconnectLastfm, lastfmUser } from '../lib/scrobble'

/**
 * 顶栏的 Last.fm 连接开关。
 * 未连接 → 点一下跳去 Last.fm 授权（回来后回调会自动写进 localStorage）。
 * 已连接 → 显示账号名，点一下可断开。
 * 出错（比如 CF 环境变量还没配）时把服务端的原话直接显示出来 —— 这类配置问题
 * 提示里写清楚了原因和去哪配，比一个静默失败的图标有用得多。
 */
const busy = ref(false)
const err = ref('')

const connected = computed(() => !!lastfmUser.value)
const title = computed(() =>
  connected.value ? `已连接 Last.fm：${lastfmUser.value}（点击断开）` : '连接 Last.fm（同步听歌记录）',
)

let errTimer: number | undefined
function flash(msg: string) {
  err.value = msg
  window.clearTimeout(errTimer)
  errTimer = window.setTimeout(() => (err.value = ''), 8000)
}

async function onClick() {
  if (busy.value) return
  if (connected.value) {
    if (!window.confirm(`断开 Last.fm（当前账号 ${lastfmUser.value}）？\n断开后不再同步听歌记录。`)) return
    disconnectLastfm()
    return
  }
  busy.value = true
  const r = await connectLastfm()
  busy.value = false
  if (!r.ok) flash(r.error ?? '连接失败')
}
</script>

<template>
  <div class="relative shrink-0">
    <button
      data-lastfm-toggle
      class="w-9 h-9 rounded-full flex items-center justify-center transition"
      :class="connected ? 'text-music hover:bg-fill' : 'text-fg-muted hover:text-fg hover:bg-fill'"
      :title="title"
      :aria-label="title"
      @click="onClick"
    >
      <!-- 上升柱状：听歌记录的意象 -->
      <svg v-if="!busy" viewBox="0 0 24 24" class="w-5 h-5 fill-current">
        <path d="M4 17h3v-4H4v4zm5 0h3V9H9v8zm5 0h3V5h-3v12z" />
        <circle v-if="connected" cx="19.5" cy="6" r="2.5" />
      </svg>
      <svg v-else viewBox="0 0 24 24" class="w-5 h-5 fill-current animate-pulse">
        <path d="M4 17h3v-4H4v4zm5 0h3V9H9v8zm5 0h3V5h-3v12z" />
      </svg>
    </button>

    <!-- 出错时把原因摆出来：这类都是「去哪配什么」的问题，静默失败最难查 -->
    <div
      v-if="err"
      data-lastfm-error
      class="absolute right-0 top-full mt-2 z-40 w-72 rounded-xl bg-app/95 backdrop-blur-2xl border border-line shadow-xl px-3.5 py-3 text-[12px] leading-relaxed text-fg"
    >
      {{ err }}
    </div>
  </div>
</template>
