/**
 * 房间标签排布（PM 用真实户型实测的两条：最大的客厅名字被问题针盖住；相邻小房间名字互相压字）。
 * 规则：房间名永远不消失——先挪位置，再缩字号 / 换行 / 去掉面积 / 缩写，最后才改成「悬停才显示」。
 * 每个标签必须整块落在自己房间里，不压问题针，不压别的标签。全部按屏幕像素算（除以缩放 k 换回平面 mm）。
 */
import type { Plan, Question, Room, Vec2 } from '@/core/types'
import { labelPoint, pointInPolygon, polygonArea } from '@/core/geometry'

export interface RoomLabelLayout {
  /** 文字块中心（平面 mm） */
  at: Vec2
  lines: string[]
  /** 名称字号（屏幕 px） */
  size: number
  /** 第二行（面积或「+0.45 m」）字号；0 = 不显示 */
  sub: number
  ceil: boolean
  tag: boolean
  /** 放不下：只在悬停 / 选中时以浮签显示 */
  hover?: boolean
}

interface Variant { size: number; sub: number; ceil: boolean; tag: boolean; split: 0 | 1 | 2; abbr?: number }
const VARIANTS: Variant[] = [
  { size: 13.5, sub: 11.5, ceil: true, tag: true, split: 0 },
  { size: 13.5, sub: 11.5, ceil: false, tag: true, split: 0 },
  { size: 12.5, sub: 11, ceil: false, tag: true, split: 2 },
  { size: 12, sub: 10.5, ceil: false, tag: false, split: 0 },
  { size: 12, sub: 0, ceil: false, tag: false, split: 0 },
  { size: 11.5, sub: 10.5, ceil: false, tag: false, split: 2 },
  { size: 11, sub: 0, ceil: false, tag: false, split: 2 },
  { size: 10.5, sub: 0, ceil: false, tag: false, split: 0 },
  { size: 10.5, sub: 0, ceil: false, tag: false, split: 2 },
  { size: 10.5, sub: 0, ceil: false, tag: false, split: 0, abbr: 4 },
  { size: 10, sub: 0, ceil: false, tag: false, split: 0, abbr: 3 },
]
const LINE = 1.22 // 行高 / 字号
const PAD = 3 // 标签离墙内皮、离别的东西至少留的 px
const PIN_R = 24 // 问题针半径 + 留白（px）

let ctx: CanvasRenderingContext2D | null = null
const widthCache = new Map<string, number>()
function textWidth(s: string, size: number, weight: number): number {
  const key = `${weight}|${size}|${s}`
  const hit = widthCache.get(key)
  if (hit !== undefined) return hit
  if (!ctx && typeof document !== 'undefined') ctx = document.createElement('canvas').getContext('2d')
  let w: number
  if (ctx) {
    ctx.font = `${weight} ${size}px ${getComputedStyle(document.body).fontFamily}`
    w = ctx.measureText(s).width
  } else w = [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? size : size * 0.58), 0)
  if (widthCache.size > 4000) widthCache.clear()
  widthCache.set(key, w)
  return w
}

/** 长名字在语义处断成两行：优先在「与 / 和 / 及 / · / 空格」后断，否则对半 */
function splitName(name: string): [string, string] | null {
  const chars = [...name]
  if (chars.length < 4) return null
  const mid = chars.length / 2
  let best = -1, bestD = Infinity
  chars.forEach((c, i) => {
    if (i === 0 || i >= chars.length - 1) return
    const brk = /[与和及·\s\/]/.test(c) ? i + 1 : /[与和及·\s\/]/.test(chars[i - 1]) ? i : -1
    if (brk > 0 && Math.abs(brk - mid) < bestD) { best = brk; bestD = Math.abs(brk - mid) }
  })
  const at = best > 0 && bestD <= chars.length * 0.3 ? best : Math.ceil(mid)
  return [chars.slice(0, at).join('').trim(), chars.slice(at).join('').trim()]
}

/** 问题针的位置：同一处（比如两个都问客厅）的针左右摊开，不叠在一起 */
export function pinPositions(plan: Plan, qs: Question[], k: number): Map<string, Vec2> {
  const out = new Map<string, Vec2>()
  const pts = qs.filter(q => q.bbox).map(q => ({ id: q.id, c: [(q.bbox![0] + q.bbox![2]) / 2, (q.bbox![1] + q.bbox![3]) / 2] as Vec2 }))
  const near = 40 / k, step = 48 / k
  const used = new Set<string>()
  for (const p of pts) {
    if (used.has(p.id)) continue
    const group = pts.filter(o => !used.has(o.id) && Math.hypot(o.c[0] - p.c[0], o.c[1] - p.c[1]) < near)
    group.forEach((o, i) => { used.add(o.id); out.set(o.id, [p.c[0] + (i - (group.length - 1) / 2) * step, p.c[1]]) })
  }
  void plan
  return out
}

export function layoutRoomLabels(plan: Plan, k: number, opts: { pins: Vec2[]; sqm: string; ceilLabel: string; tagged: Set<string>; blocks?: { c: Vec2; r: number }[] }): Map<string, RoomLabelLayout> {
  const out = new Map<string, RoomLabelLayout>()
  const px = (v: number) => v / k
  const placed: [number, number, number, number][] = [] // x0 y0 x1 y1（mm）
  const pinR = px(PIN_R)
  // 先排小房间（能放的地方少），大房间后排、有地方挪
  const rooms = [...plan.rooms].sort((a, b) => polygonArea(a.poly) - polygonArea(b.poly))
  for (const r of rooms) {
    const area = polygonArea(r.poly) / 1e6
    const ceil = r.ceiling !== undefined && Math.abs(r.ceiling - plan.ceiling) > 0.005
    const subText = r.floorOffset ? `+${r.floorOffset.toFixed(2)} m` : `${area.toFixed(1)} ${opts.sqm}`
    const tagged = opts.tagged.has(r.id)
    const cands = candidates(r, k)
    let done: RoomLabelLayout | null = null
    for (const v of VARIANTS) {
      let lines: string[]
      if (v.abbr) { const ch = [...r.name]; if (ch.length <= v.abbr) continue; lines = [ch.slice(0, v.abbr).join('') + '…'] }
      else if (v.split === 2) { const sp = splitName(r.name); if (!sp) continue; lines = sp }
      else lines = [r.name]
      const nameW = Math.max(...lines.map(l => textWidth(l, v.size, 650)))
      const subW = v.sub ? textWidth(subText, v.sub, 550) : 0
      const hasCeil = v.ceil && ceil, hasTag = v.tag && tagged
      const wPx = Math.max(nameW, subW, hasCeil ? 68 : 0, hasTag ? 30 : 0) + 4
      const hPx = lines.length * v.size * LINE + (v.sub ? v.sub * LINE + 2 : 0) + (hasCeil ? 22 : 0) + (hasTag ? 22 : 0)
      const w = px(wPx), h = px(hPx)
      for (const c of cands) {
        const box: [number, number, number, number] = [c[0] - w / 2, c[1] - h / 2, c[0] + w / 2, c[1] + h / 2]
        if (!boxInRoom(box, r.poly, px(PAD))) continue
        if (opts.pins.some(p => circleHitsBox(p, pinR, box))) continue
        if (opts.blocks?.some(b => circleHitsBox(b.c, px(b.r), box))) continue
        if (placed.some(b => b[0] < box[2] + px(PAD) && b[2] > box[0] - px(PAD) && b[1] < box[3] + px(PAD) && b[3] > box[1] - px(PAD))) continue
        placed.push(box)
        done = { at: c, lines, size: v.size, sub: v.sub, ceil: hasCeil, tag: hasTag }
        break
      }
      if (done) break
    }
    out.set(r.id, done ?? { at: labelPoint(r.poly), lines: [r.name], size: 12, sub: 11, ceil: false, tag: false, hover: true })
  }
  return out
}

/** 候选位置：房间的标签点优先，再按离它的距离排房间里的网格点 */
function candidates(r: Room, k: number): Vec2[] {
  const lp = labelPoint(r.poly)
  const xs = r.poly.map(p => p[0]), ys = r.poly.map(p => p[1])
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys)
  const step = Math.max(Math.min(x1 - x0, y1 - y0) / 10, 10 / k)
  const pts: Vec2[] = []
  for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) if (pointInPolygon([x, y], r.poly)) pts.push([x, y])
  pts.sort((a, b) => Math.hypot(a[0] - lp[0], a[1] - lp[1]) - Math.hypot(b[0] - lp[0], b[1] - lp[1]))
  return [lp, ...pts.slice(0, 160)]
}

function boxInRoom(b: [number, number, number, number], poly: Vec2[], m: number): boolean {
  const [x0, y0, x1, y1] = [b[0] - m, b[1] - m, b[2] + m, b[3] + m]
  const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2
  for (const p of [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [xm, y0], [xm, y1], [x0, ym], [x1, ym]] as Vec2[]) if (!pointInPolygon(p, poly)) return false
  // 凹多边形：墙角伸进框里也不行
  return !poly.some(p => p[0] > x0 && p[0] < x1 && p[1] > y0 && p[1] < y1)
}

function circleHitsBox(c: Vec2, r: number, b: [number, number, number, number]) {
  const dx = Math.max(b[0] - c[0], 0, c[0] - b[2]), dy = Math.max(b[1] - c[1], 0, c[1] - b[3])
  return dx * dx + dy * dy < r * r
}
