<script setup lang="ts">
import { computed } from 'vue'
import { usePlayerStore, type Collection } from '../stores/player'
import { genCoverSvg, hashStr } from '../lib/coverArt'

// 注意：Boolean 类型 prop 未传入时 Vue 会强制转为 false，
// 所以要让「默认显示角标」必须显式给默认值，不能用 undefined 判断
const props = withDefaults(
  defineProps<{
    collection: Collection
    /** 是否显示右上角 Apple Music 角标 */
    badge?: boolean
  }>(),
  { badge: true },
)

const player = usePlayerStore()

/** 成员曲目封面：按专辑去重（同专辑共用一张图，否则拼贴会出现 4 张一样的） */
const memberCovers = computed(() => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of props.collection.tracks) {
    const c = t.meta?.coverUrl
    if (!c) continue
    const key = (t.meta?.album || c).trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
    if (out.length === 4) break
  }
  return out
})

/**
 * 封面取用顺序：
 * 1. playlists.json 里显式指定的 cover
 * 2. 电台 → 程序化随机生成（种子每次点播都换）
 * 3. 只有 1 张专辑封面 → 直接铺满
 * 4. 2 张 → 左右对半；3 张 → 左大右二；4 张及以上 → 2×2 拼贴
 * 5. 一张都没有 → 按歌单 id 程序化生成（同名永远同一张）
 */
const mode = computed<'image' | 'halves' | 'triptych' | 'collage' | 'generated'>(() => {
  if (props.collection.def.cover) return 'image'
  if (props.collection.isRadio) return 'generated'
  const n = memberCovers.value.length
  if (n === 0) return 'generated'
  if (n === 1) return 'image'
  if (n === 2) return 'halves'
  if (n === 3) return 'triptych'
  return 'collage'
})

const singleSrc = computed(() =>
  mode.value === 'image' ? (props.collection.def.cover ?? memberCovers.value[0]) : undefined,
)

const tiles = computed(() => (mode.value === 'collage' ? memberCovers.value.slice(0, 4) : []))

const generatedSvg = computed(() =>
  mode.value === 'generated'
    ? genCoverSvg(props.collection.isRadio ? player.radioSeed : hashStr(props.collection.def.id))
    : '',
)
</script>

<template>
  <div class="relative w-full h-full rounded-xl overflow-hidden bg-fill">
    <!-- 单张封面 -->
    <img v-if="mode === 'image'" :src="singleSrc" class="w-full h-full object-cover" loading="lazy" />

    <!-- 两张封面：左右对半 -->
    <div v-else-if="mode === 'halves'" class="w-full h-full grid grid-cols-2">
      <img
        v-for="(src, i) in memberCovers"
        :key="i"
        :src="src"
        class="w-full h-full object-cover"
        loading="lazy"
      />
    </div>

    <!-- 三张封面：左边大图 + 右侧上下两张 -->
    <div v-else-if="mode === 'triptych'" class="w-full h-full flex">
      <img :src="memberCovers[0]" class="w-1/2 h-full object-cover" loading="lazy" />
      <div class="w-1/2 h-full flex flex-col">
        <img :src="memberCovers[1]" class="w-full h-1/2 object-cover" loading="lazy" />
        <img :src="memberCovers[2]" class="w-full h-1/2 object-cover" loading="lazy" />
      </div>
    </div>

    <!-- 四张封面：2×2 拼贴 -->
    <div v-else-if="mode === 'collage'" class="w-full h-full grid grid-cols-2 grid-rows-2">
      <img
        v-for="(src, i) in tiles"
        :key="i"
        :src="src"
        class="w-full h-full object-cover"
        loading="lazy"
      />
    </div>

    <!-- 程序化生成 -->
    <div v-else class="w-full h-full [&>svg]:w-full [&>svg]:h-full" v-html="generatedSvg"></div>

    <!-- 右上角 Apple Music 角标（对齐官方卡片） -->
    <div
      v-if="badge"
      class="absolute top-2 right-2.5 flex items-center gap-1 text-white/95"
      style="text-shadow: 0 1px 3px rgba(0, 0, 0, 0.35)"
    >
      <svg viewBox="0 0 24 24" class="w-[13px] h-[13px] fill-current">
        <path
          d="M17.05 12.04c-.03-2.4 1.96-3.55 2.05-3.61-1.12-1.63-2.86-1.86-3.48-1.88-1.48-.15-2.89.87-3.64.87-.75 0-1.91-.85-3.14-.83-1.61.02-3.1.94-3.93 2.38-1.68 2.91-.43 7.22 1.2 9.58.8 1.16 1.75 2.46 3 2.41 1.2-.05 1.66-.78 3.11-.78 1.45 0 1.86.78 3.13.75 1.29-.02 2.11-1.18 2.9-2.34.91-1.34 1.29-2.64 1.31-2.71-.03-.01-2.51-.96-2.54-3.84zM14.7 5.1c.66-.8 1.11-1.91.99-3.02-.95.04-2.11.64-2.79 1.43-.61.71-1.15 1.84-1.01 2.93 1.06.08 2.15-.54 2.81-1.34z"
        />
      </svg>
      <span class="text-[13px] font-medium leading-none">Music</span>
    </div>
  </div>
</template>
