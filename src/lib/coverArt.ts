/**
 * 程序化封面生成。
 *
 * 适用于没有实体封面的「歌单 / 电台」：不依赖任何图片素材，
 * 由一个数字种子确定性地画出一张方形渐变封面（种子相同 → 图相同，
 * 换种子就是一张新图），所以歌单封面可以随内容自动生成、永不失联。
 */

/** FNV-1a：字符串 → 稳定 32 位无符号哈希（同名歌单永远拿到同一套配色） */
export function hashStr(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32：可复现的伪随机数发生器 */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 参考 Apple Music 电台封面的一组配色：基底色 / 点缀色 A / 点缀色 B（HSL 色相） */
const PALETTES: Array<[number, number, number]> = [
  [271, 330, 205], // 紫 · 品红 · 蓝
  [8, 42, 322], // 红 · 橙 · 玫红
  [205, 262, 168], // 蓝 · 紫 · 青
  [152, 192, 96], // 青绿 · 蓝 · 黄绿
  [318, 265, 18], // 玫红 · 紫 · 橙
  [34, 356, 278], // 金 · 红 · 紫
  [231, 300, 190], // 靛 · 紫红 · 水绿
  [186, 222, 288], // 青 · 蓝 · 紫
]

/**
 * 生成一张方形封面的 SVG 字符串。
 * @param seed 任意整数，同一个 seed 永远得到同一张图
 * @param size 画布边长（内部坐标，实际显示尺寸交给外层 CSS）
 */
export function genCoverSvg(seed: number, size = 300): string {
  const r = rng(seed)
  const p = PALETTES[Math.floor(r() * PALETTES.length) % PALETTES.length]
  const uid = `g${(seed >>> 0).toString(36)}`
  const h = (v: number, off = 0) => (((v + off) % 360) + 360) % 360
  const h1 = h(p[0], (r() - 0.5) * 26)
  const h2 = h(p[1], (r() - 0.5) * 26)

  const defs = `
    <linearGradient id="${uid}bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${h1.toFixed(0)} 60% 24%)"/>
      <stop offset="1" stop-color="hsl(${h2.toFixed(0)} 66% 11%)"/>
    </linearGradient>
    <radialGradient id="${uid}vig">
      <stop offset="52%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.42"/>
    </radialGradient>
    <filter id="${uid}soft" x="-45%" y="-45%" width="190%" height="190%">
      <feGaussianBlur stdDeviation="${(size * 0.115).toFixed(1)}"/>
    </filter>
    <filter id="${uid}grain">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
    </filter>
  `

  let blobs = ''
  const n = 4 + Math.floor(r() * 3)
  for (let i = 0; i < n; i++) {
    const hh = h(p[i % 3], (r() - 0.5) * 44)
    const cx = r() * size
    const cy = r() * size
    const rx = size * (0.2 + r() * 0.36)
    const ry = rx * (0.68 + r() * 0.62)
    const rot = (r() * 180).toFixed(0)
    const light = (36 + r() * 28).toFixed(0)
    const op = (0.48 + r() * 0.42).toFixed(2)
    blobs += `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${rx.toFixed(1)}" ry="${ry.toFixed(1)}" fill="hsl(${hh.toFixed(0)} 76% ${light}%)" opacity="${op}" transform="rotate(${rot} ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true">
  <defs>${defs}</defs>
  <rect width="${size}" height="${size}" fill="url(#${uid}bg)"/>
  <g filter="url(#${uid}soft)">${blobs}</g>
  <rect width="${size}" height="${size}" fill="url(#${uid}vig)"/>
  <rect width="${size}" height="${size}" filter="url(#${uid}grain)" opacity="0.15" style="mix-blend-mode:overlay"/>
</svg>`
}
