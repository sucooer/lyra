<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { labelOfField, type SortDir, type SortKey, type SortState } from '../lib/sort'

const props = defineProps<{ modelValue: SortState; fields: SortKey[] }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: SortState): void }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)

function pick(key: SortKey) {
  if (key === 'default') {
    emit('update:modelValue', { key: 'default', dir: 'asc' })
  } else if (props.modelValue.key === key) {
    const dir: SortDir = props.modelValue.dir === 'asc' ? 'desc' : 'asc'
    emit('update:modelValue', { key, dir })
  } else {
    emit('update:modelValue', { key, dir: 'asc' })
  }
  open.value = false
}

const currentLabel = computed(() => {
  const l = labelOfField(props.modelValue.key)
  if (props.modelValue.key === 'default') return l
  return `${l} ${props.modelValue.dir === 'asc' ? '↑' : '↓'}`
})

// 「默认顺序」单独放最上，其它按传入的 fields 顺序排
const options = computed(() => props.fields.filter((k) => k !== 'default'))

function onDocClick(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div ref="root" class="relative">
    <button
      data-sort-toggle
      class="flex items-center gap-1 h-8 px-3 rounded-full text-[13px] transition"
      :class="modelValue.key !== 'default' ? 'text-music font-medium bg-fill' : 'text-fg-muted hover:text-fg hover:bg-fill'"
      @click="open = !open"
    >
      <svg viewBox="0 0 24 24" class="w-3.5 h-3.5 fill-current">
        <path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z" />
      </svg>
      {{ currentLabel }}
      <svg viewBox="0 0 24 24" class="w-3 h-3 fill-current" :class="open ? 'rotate-180' : ''">
        <path d="M7 10l5 5 5-5z" />
      </svg>
    </button>

    <transition name="sort">
      <div
        v-if="open"
        class="absolute right-0 top-full mt-2 z-30 min-w-[176px] rounded-xl bg-solid shadow-xl border border-line py-1.5"
      >
        <button
          data-sort-option="default"
          class="w-full flex items-center justify-between px-4 h-9 text-[13px] hover:bg-fill-strong transition"
          :class="modelValue.key === 'default' ? 'text-music font-medium' : 'text-fg'"
          @click="pick('default')"
        >
          默认顺序
          <svg v-if="modelValue.key === 'default'" viewBox="0 0 24 24" class="w-3.5 h-3.5 fill-current">
            <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
          </svg>
        </button>
        <button
          v-for="k in options"
          :key="k"
          :data-sort-option="k"
          class="w-full flex items-center justify-between px-4 h-9 text-[13px] hover:bg-fill-strong transition"
          :class="modelValue.key === k ? 'text-music font-medium' : 'text-fg'"
          @click="pick(k)"
        >
          {{ labelOfField(k) }}
          <span v-if="modelValue.key === k" class="text-music">{{ modelValue.dir === 'asc' ? '↑' : '↓' }}</span>
        </button>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.sort-enter-active,
.sort-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}
.sort-enter-from,
.sort-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
