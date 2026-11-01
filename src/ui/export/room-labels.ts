/**
 * PDF 平面图上的房间名（工具界面的排法见 canvas2d/labels.ts；纸上不能悬停，所以最后一档换成图例）。
 * 规则：名字整块落在自己房间里、落在图框里，不压序号、不压别的名字。放不下时依次：
 *   挪位置 → 字号 12 → 11 → 10（略微缩小）→ 图上只留字母方块，名字进图框底部的图例。
 * 大半在取景框外、又放不下的邻居房间不标，不进图例（它不是这张图讲的东西）。
 * 同一页几张图共用一条图例、一套字母。全部按页面 px 算。
 */
import type { Plan, Vec2 } from '@/core/types'
import { labelPoint, pointInPolygon, polygonArea } from '@/core/geometry'
import { boxInRoom, circleHitsBox } from '../canvas2d/labels'
import { K, NUM, SANS, T, lines, measure, rrect, text, wrap, type Ctx } from './canvas'
import type { Rect, Tone, Xf } from './plan-draw'

export const LABEL_SIZES = [12, 11, 10] as const
const LINE = 1.25, SUB = 10, SUB_H = 13, PAD = 3
const KEY = 15, KEY_GAP = 5, ROW = 20, ENTRY_GAP = 14, STRIP_TOP = 9, STRIP_GAP = 8
const SHARED_PAD_X = 16, SHARED_PAD_Y = 10, SHARED_GAP = 16
/** 放不下时，房间在图框里露出来不到这个比例就不标 */
const MIN_VISIBLE = 0.5

export interface Circle { c: Vec2; r: number }
type Box4 = [number, number, number, number]
export interface RoomLabel {
  id: string
  name: string
  sub?: string
  /** 名字（或字母方块）的中心 */
  at: Vec2
  /** 字号；0 = 图例字母方块 */
  size: number
  showSub: boolean
  box: Box4
  /** 图例字母（assignKeys 之后才有） */
  key?: string
  /** 字母方块放到了房间外面：画一根引线回到房间 */
  leader?: Vec2
  poly: Vec2[]
}
export interface LabelLayout { labels: RoomLabel[] }

const fontOf = (size: number) => ({ size, weight: 600, family: SANS })
const overlapRatio = (b: Box4, r: Rect) => {
  const w = Math.min(b[2], r.x + r.w) - Math.max(b[0], r.x), h = Math.min(b[3], r.y + r.h) - Math.max(b[1], r.y)
  const area = (b[2] - b[0]) * (b[3] - b[1])
  return w > 0 && h > 0 && area > 0 ? (w * h) / area : 0
}
const boxOfPts = (pts: Vec2[]): Box4 => [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))]
const hits = (a: Box4, b: Box4, m: number) => a[0] < b[2] + m && a[2] > b[0] - m && a[1] < b[3] + m && a[3] > b[1] - m
const inside = (b: Box4, r: Rect) => b[0] >= r.x && b[2] <= r.x + r.w && b[1] >= r.y && b[3] <= r.y + r.h

/** 候选位置：标签点优先，再按离它的距离排「房间 ∩ 图框」里的网格点 */
function candidates(poly: Vec2[], lp: Vec2, clip: Rect): Vec2[] {
  const b = boxOfPts(poly)
  const x0 = Math.max(b[0], clip.x), x1 = Math.min(b[2], clip.x + clip.w), y0 = Math.max(b[1], clip.y), y1 = Math.min(b[3], clip.y + clip.h)
  const step = Math.max(Math.min(x1 - x0, y1 - y0) / 12, 5)
  const pts: Vec2[] = []
  for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) if (pointInPolygon([x, y], poly)) pts.push([x, y])
  pts.sort((p, q) => Math.hypot(p[0] - lp[0], p[1] - lp[1]) - Math.hypot(q[0] - lp[0], q[1] - lp[1]))
  return [lp, ...pts.slice(0, 240)]
}

export function layoutRoomLabels(ctx: Ctx, plan: Plan, x: Xf, clip: Rect, avoid: Circle[] = []): LabelLayout {
  const rooms = plan.rooms.filter(r => r.poly.length >= 3).sort((a, b) => polygonArea(a.poly) - polygonArea(b.poly))
  const placed: Box4[] = [], smaller: Vec2[][] = [], labels: RoomLabel[] = []
  const free = (box: Box4, inRoom: Vec2[] | null, pad = PAD) => {
    if (!inside(box, clip)) return false
    if (inRoom && !boxInRoom(box, inRoom, pad)) return false
    if (placed.some(b => hits(b, box, PAD))) return false
    if (avoid.some(a => circleHitsBox(a.c, a.r, box))) return false
    // 房间里还套着小房间（飘窗台、干区）时，名字不落到小房间上
    const corners: Vec2[] = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]], [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]]
    return !(inRoom && smaller.some(s => corners.some(c => pointInPolygon(c, s))))
  }
  for (const r of rooms) {
    const poly = r.poly.map(p => x.P(p)) as Vec2[]
    const visible = overlapRatio(boxOfPts(poly), clip)
    if (visible <= 0) continue
    const lp = x.P(labelPoint(r.poly)) as Vec2, cands = candidates(poly, lp, clip)
    const fo = r.floorOffset ?? 0, sub = fo ? `${fo > 0 ? '+' : ''}${fo.toFixed(2)} m` : undefined
    const base = { id: r.id, name: r.name, sub, poly }
    let done: RoomLabel | null = null
    // 先带着高差一起放；放不下再只放名字（高差进不了图时写进图例）
    const tries = [...(sub ? LABEL_SIZES.map(size => ({ size, showSub: true })) : []), ...LABEL_SIZES.map(size => ({ size, showSub: false }))]
    for (const t of tries) {
      const nameW = measure(ctx, r.name, fontOf(t.size)), subW = t.showSub ? measure(ctx, sub!, { size: SUB, weight: 600, family: NUM }) : 0
      const w = Math.max(nameW, subW), h = t.size * LINE + (t.showSub ? SUB_H : 0)
      for (const c of cands) {
        const box: Box4 = [c[0] - w / 2, c[1] - h / 2, c[0] + w / 2, c[1] + h / 2]
        if (free(box, poly)) { done = { ...base, at: c, size: t.size, showSub: t.showSub, box }; break }
      }
      if (done) break
    }
    if (!done) {
      if (visible < MIN_VISIBLE) continue
      const k = KEY / 2, boxAt = (c: Vec2): Box4 => [c[0] - k, c[1] - k, c[0] + k, c[1] + k]
      const hit = cands.find(c => free(boxAt(c), poly, 0.5))
      if (hit) done = { ...base, at: hit, size: 0, showSub: false, box: boxAt(hit) }
      else {
        // 房间比方块还小：方块放到最近的空地，引线回到房间
        const ring: Vec2[] = []
        for (let d = KEY; d <= 70; d += 5) for (let a = 0; a < 16; a++) ring.push([lp[0] + d * Math.cos(a * Math.PI / 8), lp[1] + d * Math.sin(a * Math.PI / 8)])
        const out = ring.find(c => free(boxAt(c), null))
        const at = out ?? lp
        done = { ...base, at, size: 0, showSub: false, box: boxAt(at), leader: out ? lp : undefined }
      }
    }
    placed.push(done.box)
    smaller.push(poly)
    labels.push(done)
  }
  return { labels }
}

/** 字母：同一页几张图共用一套，按第一次出现的位置（上 → 下、左 → 右）排 */
export function assignKeys(layouts: LabelLayout[]) {
  const first = new Map<string, Vec2>()
  for (const l of layouts) for (const e of l.labels) if (!e.size && !first.has(e.id)) first.set(e.id, e.at)
  const order = [...first.entries()].sort((a, b) => Math.round(a[1][1] / 24) - Math.round(b[1][1] / 24) || a[1][0] - b[1][0]).map(e => e[0])
  const letter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : letter(Math.floor(i / 26) - 1) + String.fromCharCode(65 + i % 26))
  for (const l of layouts) for (const e of l.labels) if (!e.size) e.key = letter(order.indexOf(e.id))
}

export function drawRoomLabels(ctx: Ctx, layout: LabelLayout, tone: Tone) {
  const color = tone === 'normal' ? K.ink700 : K.ink600
  ctx.save()
  ctx.lineJoin = 'round'
  for (const e of layout.labels) {
    if (!e.size) { keyMark(ctx, e.at, e.key ?? '', e.leader); continue }
    const h = e.size * LINE + (e.showSub ? SUB_H : 0), top = e.at[1] - h / 2, base = top + e.size * LINE / 2 + e.size * 0.36
    ctx.font = `600 ${e.size}px ${SANS}`
    ctx.textAlign = 'center'
    ctx.lineWidth = 3; ctx.strokeStyle = K.paper
    ctx.strokeText(e.name, e.at[0], base)
    ctx.fillStyle = color
    ctx.fillText(e.name, e.at[0], base)
    if (e.showSub) text(ctx, e.sub!, e.at[0], top + e.size * LINE + SUB_H - 3, { size: SUB, weight: 600, family: NUM, align: 'center', color: K.ink500 })
  }
  ctx.restore()
}

/** 字母方块：方的，和圆形的改造序号一眼分开 */
function keyMark(ctx: Ctx, at: Vec2, key: string, leader?: Vec2) {
  const k = KEY / 2
  if (leader) {
    ctx.save(); ctx.strokeStyle = K.ink500; ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(at[0], at[1]); ctx.lineTo(leader[0], leader[1]); ctx.stroke()
    ctx.fillStyle = K.ink500; ctx.beginPath(); ctx.arc(leader[0], leader[1], 1.6, 0, Math.PI * 2); ctx.fill(); ctx.restore()
  }
  rrect(ctx, at[0] - k, at[1] - k, KEY, KEY, 4); ctx.fillStyle = K.paper; ctx.fill(); ctx.strokeStyle = K.ink500; ctx.lineWidth = 1; ctx.stroke()
  text(ctx, key, at[0], at[1] + 3.7, { size: 10, weight: 700, family: NUM, align: 'center', color: K.ink800 })
}

/* ───────── 图例条 ───────── */
export interface LegendEntry { id: string; key: string; name: string }
const byKey = (a: LegendEntry, b: LegendEntry) => a.key.length - b.key.length || a.key.localeCompare(b.key)
export const legendEntries = (l: LabelLayout): LegendEntry[] => l.labels.filter(e => !e.size).map(e => ({ id: e.id, key: e.key ?? 'A', name: e.sub ? `${e.name} ${e.sub}` : e.name })).sort(byKey)
const unionEntries = (fs: LabelLayout[]) => { const m = new Map<string, LegendEntry>(); for (const l of fs) for (const e of legendEntries(l)) if (!m.has(e.id)) m.set(e.id, e); return [...m.values()].sort(byKey) }

interface Placed { entry: LegendEntry; x: number; row: number; lines: string[] }
function flowEntries(ctx: Ctx, entries: LegendEntry[], w: number, label: string) {
  const start = measure(ctx, label, T.caption) + 10, room = w - start, textW = room - KEY - KEY_GAP
  const out: Placed[] = []
  let row = 0, x = 0
  for (const entry of entries) {
    const ls = wrap(ctx, entry.name, textW, T.caption)
    const ew = KEY + KEY_GAP + Math.max(...ls.map(l => measure(ctx, l, T.caption)))
    if (x && x + ew > room) { row++; x = 0 }
    out.push({ entry, x: start + x, row, lines: ls })
    if (ls.length > 1) { row += ls.length; x = 0 } else x += ew + ENTRY_GAP
  }
  return { out, rows: entries.length ? row + (x ? 1 : 0) : 0 }
}
const legendRows = (ctx: Ctx, entries: LegendEntry[], w: number, label: string, note?: string) => flowEntries(ctx, entries, w, label).rows + (note ? wrap(ctx, note, w, T.caption).length : 0)
function drawLegendBody(ctx: Ctx, x: number, top: number, w: number, entries: LegendEntry[], label: string, note?: string) {
  let yy = top
  if (note) for (const l of wrap(ctx, note, w, T.caption)) { lines(ctx, [l], x, yy + 2, T.caption); yy += ROW }
  if (!entries.length) return
  const { out } = flowEntries(ctx, entries, w, label)
  lines(ctx, [label], x, yy + 2, { ...T.caption, weight: 600, color: K.ink600 })
  for (const p of out) {
    const ry = yy + p.row * ROW
    keyMark(ctx, [x + p.x + KEY / 2, ry + 10], p.entry.key)
    p.lines.forEach((l, i) => lines(ctx, [l], x + p.x + KEY + KEY_GAP, ry + i * ROW + 2, { ...T.caption, color: K.ink700 }))
  }
}

/* ───────── 一页里的几张平面：同比例、图例留够高 ───────── */
export interface PlanSlot {
  /** 这张图要标名字的方案（多层时已按楼层筛好） */
  plan: Plan
  /** 图例占掉 strip 高之后，图框里还能画的区域 */
  area(strip: number): Rect
  /** 给定可画区域，算平面到页面的变换 */
  fit(r: Rect): Xf
  /** 名字可以落在哪个框里（缺省 = 可画区域） */
  clip?(x: Xf, r: Rect): Rect
  /** 要躲开的序号 */
  avoid?(x: Xf, r: Rect): Circle[]
  /** 图例里的一行说明 */
  note?: string
}
export interface FittedPlan { x: Xf; r: Rect; labels: LabelLayout; legend: LegendEntry[]; strip: number; slot: PlanSlot }
/** 共用图例条：一页几张图时，几张图下面只放一条，横跨整个图区 */
export interface SharedLegend { x: number; w: number; bottom: number }

/**
 * 图例占掉的高度会让图变小、图变小又可能多出放不下的名字，所以来回算到稳定。
 * 一张图：图例放在图框底部。几张图：共用一条，放在所有图框下面（名字不重复写两遍，比例也一致，前后能对照）。
 */
export function fitPlans(ctx: Ctx, slots: PlanSlot[], label: string, shared?: SharedLegend): FittedPlan[] {
  const need = (fs: FittedPlan[]) => {
    const note = fs.find(f => f.slot.note)?.slot.note
    if (shared) { const rows = legendRows(ctx, unionEntries(fs.map(f => f.labels)), shared.w - 2 * SHARED_PAD_X, label, note); return rows ? rows * ROW + 2 * SHARED_PAD_Y + SHARED_GAP : 0 }
    return Math.max(...fs.map(f => { const rows = legendRows(ctx, legendEntries(f.labels), f.slot.area(0).w, label, f.slot.note); return rows ? STRIP_GAP + STRIP_TOP + rows * ROW : 0 }))
  }
  let strip = 0
  let res: FittedPlan[] = []
  for (let i = 0; i < 4; i++) {
    res = slots.map(slot => {
      const r = slot.area(strip), x = slot.fit(r)
      return { x, r, labels: layoutRoomLabels(ctx, slot.plan, x, slot.clip?.(x, r) ?? r, slot.avoid?.(x, r)), legend: [], strip, slot }
    })
    const n = need(res)
    if (n <= strip) break
    strip = n
  }
  assignKeys(res.map(f => f.labels))
  for (const f of res) { f.strip = strip; f.legend = legendEntries(f.labels) }
  return res
}
/** 给 e2e 核对的版面事实：房间名落在哪、图例里有谁、右栏写到哪 */
export interface SheetFacts { labels: { name: string; key?: string; size: number; box: number[]; poly: Vec2[]; leader: boolean }[]; legend: string[]; textBottom?: number; textLimit?: number }
export const factsOf = (fitted: FittedPlan[]): Pick<SheetFacts, 'labels' | 'legend'> => ({
  labels: fitted.flatMap(f => f.labels.labels.map(e => ({ name: e.name, key: e.key, size: e.size, box: e.box, poly: e.poly, leader: !!e.leader }))),
  legend: fitted.flatMap(f => f.legend.map(e => `${e.key} ${e.name}`)),
})

/** 画图例：一张图贴着图框底部；共用时在所有图框下面单独一块 */
export function drawPlanLegends(ctx: Ctx, fitted: FittedPlan[], label: string, shared?: SharedLegend) {
  if (shared) {
    const entries = unionEntries(fitted.map(f => f.labels)), note = fitted.find(f => f.slot.note)?.slot.note
    const h = fitted[0].strip - SHARED_GAP
    if (h <= 0) return
    rrect(ctx, shared.x, shared.bottom - h, shared.w, h, 16); ctx.fillStyle = K.paper; ctx.fill(); ctx.strokeStyle = K.hair; ctx.lineWidth = 1; ctx.stroke()
    drawLegendBody(ctx, shared.x + SHARED_PAD_X, shared.bottom - h + SHARED_PAD_Y, shared.w - 2 * SHARED_PAD_X, entries, label, note)
    return
  }
  for (const f of fitted) {
    if (!f.legend.length && !f.slot.note) continue
    const top = f.r.y + f.r.h + STRIP_GAP
    ctx.fillStyle = K.ink100; ctx.fillRect(f.r.x, top, f.r.w, 1)
    drawLegendBody(ctx, f.r.x, top + STRIP_TOP, f.r.w, f.legend, label, f.slot.note)
  }
}
