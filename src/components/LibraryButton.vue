<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { activeView, openAlbums, openArtists } from '../lib/nav'

/**
 * 顶栏的「资料库」入口：点开是一个面板，里面只放**没有别的入口**的两个维度
 * （全部歌手 / 全部专辑），点进去是索引页。
 *
 * 刻意**不在这里写数量、也不写说明文字**：数量（几百上千）对「去哪」这个决定毫无帮助，
 * 每多一个数字/注释就多一份要跟着曲库变的负担；说明文字更是没人读。行里只留
 * 「图标 + 名字」——一眼扫到、点进去再说。
 *
 * 也刻意**不在这里列歌单**：那是「抄一份清单」的思路，歌单一多就必然崩（放不下、也没法维护
 * 顺序）。面板只放「结构性的入口」，清单类的东西一律各自有页面 —— 歌单在首页就够了；
 * 哪天真多到首页摆不下，就再加一个 `#/playlists` 索引页，那时这里加**一行**入口即可，
 * 而不是往面板里塞列表。
 *
 * 为什么做弹层而不是常驻侧边栏：侧边栏要重排整个外壳（悬浮顶栏、视口居中的播放胶囊、
 * 各视图的 lg 内边距都得跟着重算，1024px 档网格还会掉一列），而真正缺的是
 * 「歌手 / 专辑没有列表入口」这件事 —— 先用最轻的入口把它补上，确认自己真的会顺着逛，
 * 再决定要不要把它挪进常驻侧栏。
 */
const open = ref(false)
/** 面板锚在这个按钮上：窄屏下 header 是普通流（没有定位上下文），不能拿 header 当锚点 */
const anchor = ref<HTMLElement | null>(null)

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
      title="资料库（歌手 / 专辑）"
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
        class="absolute right-0 top-full mt-2 z-50 w-[176px] rounded-2xl capsule-panel p-1.5 text-left"
      >
        <button
          data-library-artists
          class="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-fill transition text-left"
          @click="choose(openArtists)"
        >
          <!-- 人像：歌手 -->
          <svg
            viewBox="0 0 24 24"
            class="w-[17px] h-[17px] shrink-0 text-music"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5.2 19.6c0-3.1 3-5.2 6.8-5.2s6.8 2.1 6.8 5.2" />
          </svg>
          <span class="text-[14px] font-medium truncate">歌手</span>
        </button>

        <button
          data-library-albums
          class="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-fill transition text-left"
          @click="choose(openAlbums)"
        >
          <!-- 唱片：专辑 -->
          <svg
            viewBox="0 0 24 24"
            class="w-[17px] h-[17px] shrink-0 text-music"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="8.2" />
            <circle cx="12" cy="12" r="2.6" />
          </svg>
          <span class="text-[14px] font-medium truncate">专辑</span>
        </button>
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
