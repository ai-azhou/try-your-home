import type { WallKind } from '@/core/types'

/** 2D 墙的画法：深 = 受保护（承重带斜线、外墙实心石板灰），浅 = 可动（隔墙中灰、矮墙点纹、玻璃天青）。 */
export const wallFill: Record<WallKind, string> = {
  exterior: '#3c424b',
  bearing: 'url(#p-bearing)',
  partition: '#adb3bc',
  glass: '#c7e6f8',
  half: 'url(#p-half)',
  'half-glass': 'url(#p-half)',
}
/** 对比态里未改动的构件退到背景 */
export const wallFillMuted: Record<WallKind, string> = {
  exterior: '#b9bec6',
  bearing: 'url(#p-bearing-muted)',
  partition: '#d6d9de',
  glass: '#e2edf4',
  half: 'url(#p-half-muted)',
  'half-glass': 'url(#p-half-muted)',
}
/** 画的先后：浅的先画，外墙最后（墙角归外墙） */
export const wallOrder: Record<WallKind, number> = { half: 0, 'half-glass': 1, glass: 2, partition: 3, bearing: 4, exterior: 5 }

export const C = {
  paper: '#ffffff',
  ink: '#16191e',
  ink700: '#3b4048',
  ink500: '#6c727c',
  ink400: '#8e949d',
  ink300: '#b3b8c0',
  ink200: '#d3d7dd',
  mint200: '#b4eed6',
  mint300: '#86e3bf',
  mint400: '#55d3a5',
  mint500: '#2dbf8c',
  mint700: '#12825e',
  mint100: '#d4f6e7',
  mint50: '#ecfbf4',
  lemon300: '#e2ee6e',
  lemon600: '#8f9a17',
  coral500: '#e8604f',
  coral300: '#f59d93',
  cobalt500: '#4b76f2',
  cobalt400: '#6d93fb',
  cobalt100: '#dfe8ff',
  cobalt50: '#eef3ff',
  lav500: '#8a72ef',
  lav300: '#c3b6fb',
  skyLine: '#4fa3d8',
  /** 测量（S2a）：洋红，和选中的薄荷、拆除的珊瑚都分得开 */
  magenta500: '#d633a0',
  magenta700: '#9e1f74',
  magenta100: '#fbe1f1',
  skyFill: '#e1f1fb',
}

/* ───────── 装修：材料色在平面 / 立面里怎么压（docs/decor/设计规范.md §2.1–2.2） ─────────
 * 语义粉彩（薄荷、柠檬、淡紫、珊瑚）的 OKLCH 彩度都在 0.12 以上；材料在平面里压到 ≤ 0.033、明度拉到 0.895–0.975，
 * 差 3 倍多：哪怕选了薄荷绿乳胶漆，平面上也只是一层淡绿，选中的薄荷、拆除的珊瑚照样跳出来。
 */
const hex2rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const gam = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
export function oklch(hex: string) {
  const [r, g, b] = hex2rgb(hex.length === 4 ? '#' + [...hex.slice(1)].map(c => c + c).join('') : hex).map(lin)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return { L, C: Math.hypot(A, B), h: Math.atan2(B, A) }
}
export function fromOklch({ L, C, h }: { L: number; C: number; h: number }) {
  const A = C * Math.cos(h), B = C * Math.sin(h)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
  return '#' + rgb.map(c => Math.round(Math.min(1, Math.max(0, gam(Math.max(0, c)))) * 255).toString(16).padStart(2, '0')).join('')
}
const toneCache = new Map<string, string>()
/** 平面样色：明度往纸白拉 50%，夹在 0.895–0.975；彩度 ×0.6 且不超过 0.033 */
export const PLAN_CHROMA_MAX = 0.033
export function planTone(hex: string, dL = 0) {
  const key = `p${hex}${dL}`
  let v = toneCache.get(key)
  if (!v) { const c = oklch(hex); v = fromOklch({ L: Math.min(0.975, Math.max(0.895, c.L + (1 - c.L) * 0.5)) + dL, C: Math.min(c.C * 0.6, PLAN_CHROMA_MAX), h: c.h }); toneCache.set(key, v) }
  return v
}
/** 平面线色（Agent 画的构件定义里的 stroke）：只压彩度，明度不拉——线要看得见 */
export function planLine(hex: string) {
  const key = `l${hex}`
  let v = toneCache.get(key)
  if (!v) { const c = oklch(hex); v = fromOklch({ L: c.L, C: Math.min(c.C * 0.6, PLAN_CHROMA_MAX), h: c.h }); toneCache.set(key, v) }
  return v
}
/** 立面样色：只往纸白拉 8%，彩度上限 0.10——立面离「真实」近一档 */
export function elevTone(hex: string, dL = 0) {
  const key = `e${hex}${dL}`
  let v = toneCache.get(key)
  if (!v) { const c = oklch(hex); v = fromOklch({ L: Math.min(0.97, c.L + (1 - c.L) * 0.08) + dL, C: Math.min(c.C, 0.10), h: c.h }); toneCache.set(key, v) }
  return v
}
export const shade = (hex: string, dL: number) => { const c = oklch(hex); return fromOklch({ ...c, L: c.L + dL }) }
/** 装修平面画法常量（§4.3–4.5） */
export const D = {
  outline: '#545a63', detail: '#b3b8c0', clay: '#fbfaf8', upper: '#8e949d', embedLine: '#3b4048',
  sand100: '#efe3d2', sand50: '#f3eadc', sand700: '#6b5338',
}
