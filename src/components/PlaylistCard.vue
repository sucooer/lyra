<script setup lang="ts">
import type { Collection } from '../stores/player'
import PlaylistCover from './PlaylistCover.vue'

defineProps<{ collection: Collection }>()
</script>

<template>
  <div class="w-full">
    <div class="aspect-square rounded-xl overflow-hidden shadow-sm">
      <PlaylistCover :collection="collection" />
    </div>

    <div class="mt-2 text-[15px] font-semibold truncate">{{ collection.def.title }}</div>
    <div class="text-[13px] text-fg-muted truncate leading-snug mt-0.5">
      {{ collection.def.subtitle || `${collection.tracks.length} 首` }}
    </div>
  </div>
</template>
