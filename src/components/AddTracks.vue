<script setup lang="ts">
import { ref } from 'vue'
import { usePlayerStore } from '../stores/player'

const player = usePlayerStore()
const open = ref(false)
const input = ref('')
const importJson = ref('')

function add() {
  const urls = input.value
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (urls.length) {
    player.addUrls(urls)
    input.value = ''
    open.value = false
  }
}

function doImport() {
  try {
    const arr = JSON.parse(importJson.value)
    if (Array.isArray(arr)) {
      player.addUrls(arr.filter((u) => typeof u === 'string'))
      importJson.value = ''
      open.value = false
    }
  } catch {
    alert('JSON 格式错误')
  }
}

function doExport() {
  const blob = new Blob([player.exportJson()], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'playlist.json'
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>

<template>
  <div class="flex items-center gap-2">
    <button
      class="px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-sm font-medium transition"
      @click="open = !open"
    >
      ＋ 添加
    </button>
    <button
      class="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm transition"
      @click="doExport"
      title="导出歌单 JSON"
    >
      导出
    </button>
  </div>

  <div
    v-if="open"
    class="absolute right-6 top-16 z-40 w-[26rem] max-w-[90vw] rounded-2xl bg-zinc-900 border border-white/10 shadow-2xl p-4 space-y-3"
  >
    <div class="text-sm font-semibold text-white/80">粘贴音乐直链（每行一个）</div>
    <textarea
      v-model="input"
      rows="5"
      class="w-full rounded-lg bg-black/50 border border-white/10 p-3 text-xs font-mono focus:outline-none focus:border-red-500/60 resize-none"
      placeholder="https://img.520717.xyz/file/QaYpn7s6.flac"
    ></textarea>
    <div class="flex justify-end gap-2">
      <button
        class="px-3 py-1.5 rounded-lg bg-white/10 text-sm hover:bg-white/20"
        @click="open = false"
      >
        取消
      </button>
      <button
        class="px-3 py-1.5 rounded-lg bg-red-500 text-sm font-medium hover:bg-red-600"
        @click="add"
      >
        添加到资料库
      </button>
    </div>
    <details class="text-xs text-white/50">
      <summary class="cursor-pointer hover:text-white/80">从 JSON 导入</summary>
      <textarea
        v-model="importJson"
        rows="3"
        class="mt-2 w-full rounded-lg bg-black/50 border border-white/10 p-2 font-mono text-xs resize-none"
        placeholder='["https://...","https://..."]'
      ></textarea>
      <button
        class="mt-2 px-3 py-1 rounded-lg bg-white/10 hover:bg-white/20"
        @click="doImport"
      >
        导入
      </button>
    </details>
  </div>
</template>
