<script setup lang="ts">
import type { Collection } from '../stores/player'
import PlaylistCover from './PlaylistCover.vue'

defineProps<{ collection: Collection }>()
</script>

<template>
  <div class="w-full">
    <!-- 官方推荐卡：封面直角很小、无投影，文字块总共 47px（标题行 20 + 副标题行 20 + 间隔） -->
    <div class="aspect-square rounded-xl overflow-hidden">
      <PlaylistCover :collection="collection" />
    </div>

    <div class="mt-[7px] text-[15px] leading-5 font-semibold truncate">
      {{ collection.def.title }}
    </div>
    <div class="text-[14px] leading-5 text-fg-muted truncate">
      {{ collection.def.subtitle || `${collection.tracks.length} 首` }}
    </div>
  </div>
</template>
