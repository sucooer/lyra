import { ref } from 'vue'
import { normQuery } from './search'

/**
 * 最近搜索（只记在本机，不上传）。
 *
 * 去重用 `normQuery` —— 和真正的匹配共用同一套归一（繁简、大小写、标点都抹平），
 * 所以「張韶涵」「张韶涵」不会各占一条；点一条历史上的词重搜，效果也与当初那次一致。
 *
 * 模块级 ref：搜索页与以后的其它入口共用同一份，改动即时可见。
 */

const KEY = 'lyra.search.history'
/** 上限：再多也没人往下翻，反而把「热门歌手」挤出屏幕 */
const MAX = 10

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    if (!Array.isArray(arr)) return []
    return arr
      .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      .slice(0, MAX)
  } catch {
    // 隐私模式 / 存储被禁：当作没有历史，不影响搜索本身
    return []
  }
}

function save(list: string[]) {
  recentSearches.value = list
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* 存不下就算了，本会话内仍然可见 */
  }
}

/** 最近的在前 */
export const recentSearches = ref<string[]>(load())

/** 记一条：归一后已存在的先摘掉再插到最前 —— 既不重复，也不会两条并存 */
export function rememberSearch(query: string) {
  const text = String(query ?? '').trim()
  if (!text) return
  const k = normQuery(text)
  const rest = recentSearches.value.filter((x) => normQuery(x) !== k)
  // 已经是最新那条就不写盘，免得每次 blur 都动一次 localStorage
  if (!rest.length && recentSearches.value[0] === text) return
  save([text, ...rest].slice(0, MAX))
}

export function clearSearchHistory() {
  save([])
}
