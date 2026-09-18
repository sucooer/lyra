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
      :class="[
        connected ? 'text-fg hover:bg-fill' : 'text-fg-muted hover:text-fg hover:bg-fill',
        busy ? 'animate-pulse' : '',
      ]"
      :title="title"
      :aria-label="title"
      @click="onClick"
    >
      <!--
        Last.fm 官方标志。构成照着他们自己的 favicon：**红底圆角方 + 白色 "as" 连字**
        （"la|st" 里 a 与 s 的那个连笔 —— 它才是 logo 的识别点，整串 wordmark 在 36px
        的按钮里根本认不出来）。字形路径取自 Simple Icons 收录的官方 logo
        （来源 Wikimedia 的 Lastfm_logo.svg），品牌红 #D51007。
        未连接时画成描边+次要前景色（「有个 Last.fm，但没连」），连接后点亮成官方配色。
      -->
      <svg viewBox="0 0 24 24" class="w-6 h-6" aria-hidden="true">
        <rect
          x="0.75"
          y="0.75"
          width="22.5"
          height="22.5"
          rx="5.5"
          :fill="connected ? '#D51007' : 'none'"
          :stroke="connected ? 'none' : 'currentColor'"
          stroke-width="1.5"
        />
        <path
          transform="translate(4,3.2) scale(0.72)"
          :fill="connected ? '#fff' : 'currentColor'"
          d="M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.382 1.704-4.591 3.381-4.591 2.42 0 3.189 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.63-3.931l-1.758-.385c-1.21-.275-1.567-.77-1.567-1.595 0-.934.742-1.484 1.952-1.484 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.601l1.87.44c1.402.33 1.869.907 1.869 1.704 0 1.017-.99 1.43-2.86 1.43-2.776 0-3.93-1.457-4.59-3.464l-.907-2.75c-1.155-3.573-2.997-4.893-6.653-4.893C2.144 5.333 0 7.89 0 12.233c0 4.18 2.144 6.434 5.993 6.434 3.106 0 4.591-1.457 4.591-1.457z"
        />
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
