import { computed, ref } from 'vue'

export type ThemeMode = 'auto' | 'light' | 'dark'

const KEY = 'lyra:theme'
const META_COLOR = { light: '#ffffff', dark: '#000000' }

function read(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

const mq =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

/** 系统当前的深浅偏好（仅 auto 模式下决定结果） */
export const systemDark = ref(mq ? mq.matches : true)
export const themeMode = ref<ThemeMode>(read())

/** 实际呈现：auto 时跟随系统 */
export const resolvedDark = computed(() =>
  themeMode.value === 'auto' ? systemDark.value : themeMode.value === 'dark',
)

export const themeLabel = computed(() =>
  themeMode.value === 'auto'
    ? `跟随系统（当前${resolvedDark.value ? '深色' : '浅色'}）`
    : themeMode.value === 'dark'
      ? '深色'
      : '浅色',
)

function sync() {
  const root = document.documentElement
  if (themeMode.value === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', themeMode.value)
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolvedDark.value ? META_COLOR.dark : META_COLOR.light)
}

export function setTheme(m: ThemeMode) {
  themeMode.value = m
  try {
    localStorage.setItem(KEY, m)
  } catch {
    /* 隐私模式下忽略 */
  }
  sync()
}

/**
 * 点击循环：跟随系统 → 与系统相反 → 与系统一致 → 跟随系统
 *
 * 顺序不能写成 auto → light → dark：那样当系统恰好是浅色时，
 * 初始（auto）画面本身就是浅色，第一次点击 auto→light 视觉上毫无变化，
 * 用户会以为"要点两下才生效"。所以第一步先跳到"与系统相反的那一态"，
 * 保证前两次点击都能立刻看到变化。
 */
export function cycleTheme() {
  const opposite = systemDark.value ? 'light' : 'dark'
  const follow = systemDark.value ? 'dark' : 'light'
  const m = themeMode.value
  setTheme(m === 'auto' ? opposite : m === opposite ? follow : 'auto')
}

export function initTheme() {
  mq?.addEventListener('change', (e) => {
    systemDark.value = e.matches
    sync()
  })
  sync()
}
