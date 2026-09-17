<script setup lang="ts">
defineProps<{
  /** 头像：取该歌手任一曲目的封面；没有就显示占位音符 */
  cover?: string
  /** 展示名（已归一为简体） */
  label: string
  /** 次要行：曲目数这类 */
  sub?: string
}>()
</script>

<template>
  <div class="w-full text-center">
    <div class="w-full aspect-square rounded-full overflow-hidden bg-fill shadow-sm">
      <img v-if="cover" :src="cover" class="w-full h-full object-cover" loading="lazy" />
      <div v-else class="w-full h-full flex items-center justify-center text-3xl text-fg-subtle">
        ♪
      </div>
    </div>
    <div class="mt-2 text-[14px] leading-5 font-medium truncate">{{ label }}</div>
    <div v-if="sub" class="text-[13px] leading-4 text-fg-muted truncate">{{ sub }}</div>
  </div>
</template>
