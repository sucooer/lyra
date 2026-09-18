import type { Track } from '../stores/player'
import { splitArtists } from './artists'

/**
 * 曲目排序：歌单页 / 歌手页共用的纯函数 + localStorage 持久化。
 *
 * 排序不修改原数组、也不重排 store 里的顺序 —— 只在展示层给一份新数组，
 * 这样「默认顺序」随时能一键回到歌单/歌手的原始排列（含 playlists.json 里显式
 * 声明的 urls 顺序、Emby 曲库的原始序）。
 */

export type SortKey = 'default' | 'title' | 'artist' | 'album' | 'year' | 'duration'
export type SortDir = 'asc' | 'desc'
export interface SortState {
  key: SortKey
  dir: SortDir
}

export interface SortFieldDef {
  key: SortKey
  label: string
}

/** 全部可排字段；各页面按需取子集（歌手页不排「歌手」，专辑页不排「专辑」） */
export const SORT_FIELDS: SortFieldDef[] = [
  { key: 'default', label: '默认顺序' },
  { key: 'title', label: '歌名' },
  { key: 'artist', label: '歌手' },
  { key: 'album', label: '专辑' },
  { key: 'year', label: '年份' },
  { key: 'duration', label: '时长' },
]

export function labelOfField(key: SortKey): string {
  return SORT_FIELDS.find((f) => f.key === key)?.label ?? '默认顺序'
}

function storageKey(namespace: string): string {
  return `lyra.sort.${namespace}`
}

/** 读回某个歌单/歌手记下的排序；没记过或字段已不在可选集合里就回默认 */
export function loadSort(namespace: string, fields: SortKey[]): SortState {
  try {
    const raw = localStorage.getItem(storageKey(namespace))
    if (raw) {
      const p = JSON.parse(raw) as SortState
      if (p && (p.key === 'default' || fields.includes(p.key))) {
        return { key: p.key, dir: p.dir === 'desc' ? 'desc' : 'asc' }
      }
    }
  } catch {
    /* 存坏了就当没存过 */
  }
  return { key: 'default', dir: 'asc' }
}

export function saveSort(namespace: string, s: SortState): void {
  try {
    localStorage.setItem(storageKey(namespace), JSON.stringify(s))
  } catch {
    /* 隐私模式 / 配额满，忽略 */
  }
}

/** 取某字段的排序键；拿不到（空字符串 / 缺年份时长）返回 null，统一沉底 */
function sortValue(t: Track, key: SortKey, artistLabel: (n: string) => string): string | number | null {
  const m = t.meta
  switch (key) {
    case 'title':
      return m?.title?.trim() || null
    case 'artist': {
      const first = splitArtists(m?.artist ?? '')[0]?.name
      return first ? artistLabel(first) : null
    }
    case 'album':
      return m?.album?.trim() || null
    case 'year':
      return m?.year ?? null
    case 'duration':
      return m?.duration ?? null
    default:
      return null
  }
}

/**
 * 返回一份排好序的新数组。默认顺序原样返回（引用不换，避免无谓重渲染）。
 * 缺字段的条目（空标题、没写年份/时长）永远沉底，升序降序都一样，
 * 免得「升序时缺时长的排到最前」这种反直觉结果。
 */
export function sortTracks(
  tracks: Track[],
  s: SortState,
  opts: { artistLabel?: (n: string) => string } = {},
): Track[] {
  if (s.key === 'default') return tracks
  const artistLabel = opts.artistLabel ?? ((n: string) => n)
  const dir = s.dir === 'desc' ? -1 : 1
  return tracks.slice().sort((a, b) => {
    const va = sortValue(a, s.key, artistLabel)
    const vb = sortValue(b, s.key, artistLabel)
    const na = va === null || va === ''
    const nb = vb === null || vb === ''
    if (na && nb) return 0
    if (na) return 1
    if (nb) return -1
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
    return String(va).localeCompare(String(vb), 'zh-Hans-CN') * dir
  })
}
