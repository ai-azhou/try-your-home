/**
 * PDF 里的 2D 平面：在页面画布上按 frame（平面 mm）画进一个矩形。
 * 画法沿用工具（design.md §5）：深 = 受保护（承重墨色斜线、外墙石板灰），浅 = 可动；门窗符号同一套。
 * 改造标记（打印友好，不只靠颜色）：拆 = 珊瑚虚线 + 斜纹；加 = 钴蓝实心；改 = 钴蓝实线框。
 */
import clipping from 'polygon-clipping'
import type { Box, Change, Opening, Plan, Vec2, Wall, WallKind } from '@/core/types'
import { beamFootprint, columnFootprint, labelPoint, openingSpan, pointAt, polygonArea, sliceWall, wallFootprint } from '@/core/geometry'
import { wallOutlines } from '@/core/walls'
import { openingPath, openingSymbol } from '@/core/opening-symbol'
import { onLevel } from '@/core/levels'
import { K, NUM, pattern, text, type Ctx } from './canvas'
import { findIn, listOf } from './model'

export interface Rect { x: number; y: number; w: number; h: number }
export interface Xf { s: number; ox: number; oy: number; P(p: Vec2): Vec2 }
/** frame（平面 mm）→ 矩形（页面 px），等比、居中 */
export function fitFrame(frame: Box, r: Rect): Xf {
  const fw = Math.max(1, frame[2] - frame[0]), fh = Math.max(1, frame[3] - frame[1])
  const s = Math.min(r.w / fw, r.h / fh)
  const ox = r.x + (r.w - fw * s) / 2 - frame[0] * s, oy = r.y + (r.h - fh * s) / 2 - frame[1] * s
  return { s, ox, oy, P: p => [ox + p[0] * s, oy + p[1] * s] }
}
/** 把框按矩形比例补齐，四周留 pad（mm） */
export function frameFor(b: Box, r: Rect, pad = 0): Box {
  const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, A = r.w / r.h
  let w = b[2] - b[0] + 2 * pad, h = b[3] - b[1] + 2 * pad
  if (w / h < A) w = h * A; else h = w / A
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]
}

export function polyPath(ctx: Ctx, x: Xf, poly: Vec2[]) {
  poly.forEach((p, i) => { const q = x.P(p); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]) })
  ctx.closePath()
}
export function multiPath(ctx: Ctx, x: Xf, polys: Vec2[][][]) {
  ctx.beginPath()
  for (const rings of polys) for (const r of rings) polyPath(ctx, x, r)
}
const line = (ctx: Ctx, x: Xf, a: Vec2, b: Vec2) => { const p = x.P(a), q = x.P(b); ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]) }
const shift = (p: Vec2, n: Vec2, d: number): Vec2 => [p[0] + n[0] * d, p[1] + n[1] * d]

const HARD: Record<WallKind, number> = { exterior: 0, bearing: 1, partition: 2, glass: 3, 'half-glass': 4, half: 5 }
/** 按墙类型并成多边形，硬的先占（墙角归更硬的那面），和工具同一个做法 */
function wallGroups(plan: Plan): { kind: WallKind; polys: Vec2[][][] }[] {
  const kinds = [...new Set(plan.walls.map(w => w.kind))].sort((a, b) => HARD[a] - HARD[b])
  const out: { kind: WallKind; polys: Vec2[][][] }[] = []
  let occupied: Vec2[][][] = []
  for (const kind of kinds) {
    let merged: Vec2[][][]
    try { merged = wallOutlines(plan, w => w.kind === kind) } catch { merged = plan.walls.filter(w => w.kind === kind).map(w => [wallFootprint(w)]) }
    if (!merged.length) continue
    let polys = merged
    try { if (occupied.length) polys = clipping.difference(merged as never, occupied as never) as Vec2[][][] } catch { /* 并集失败就叠着画 */ }
    if (polys.length) out.push({ kind, polys })
    try { occupied = occupied.length ? clipping.union(occupied as never, merged as never) as Vec2[][][] : merged } catch { occupied = [...occupied, ...merged] }
  }
  return out
}

export type Tone = 'normal' | 'muted' | 'faint'
function wallFill(ctx: Ctx, kind: WallKind, tone: Tone): string | CanvasPattern {
  const m = tone !== 'normal'
  if (kind === 'bearing') return pattern(ctx, m ? 'bearingMuted' : 'bearing')
  if (kind === 'half' || kind === 'half-glass') return pattern(ctx, m ? 'halfMuted' : 'half')
  const solid: Record<string, [string, string]> = { exterior: [K.wallExt, '#c1c5cb'], partition: [K.wallPart, '#dcdfe3'], glass: [K.skyFill, '#edf4f8'] }
  return solid[kind][m ? 1 : 0]
}

/* ───────── 门窗符号 ───────── */
export function drawOpening(ctx: Ctx, x: Xf, plan: Plan, o: Opening, color: string, thin: string, glass: string, fillGap = true) {
  let s
  try { s = openingSpan(plan, o) } catch { return }
  const w = s.wall, t = w.thickness, n = s.normal
  const gap = wallFootprint(sliceWall(w, o.offset, o.offset + o.width))
  if (fillGap) { ctx.beginPath(); polyPath(ctx, x, gap); ctx.fillStyle = K.paper; ctx.fill() }
  ctx.save()
  ctx.lineCap = 'round'
  if (w.bulge && o.kind !== 'doorway' && o.kind !== 'open-balcony') {
    // 弧墙上的门窗（D6 B9）：core openingSymbol 沿弧、按扇分隔，和界面平面同一套
    let sym: ReturnType<typeof openingSymbol> | null = null
    try { sym = openingSymbol(plan, o.id, { doorAngle: 90 }) } catch { /* */ }
    if (sym) {
      const pl = (pts: Vec2[]) => { ctx.beginPath(); pts.forEach((q, i) => { const P = x.P(q); if (i) ctx.lineTo(P[0], P[1]); else ctx.moveTo(P[0], P[1]) }) }
      if (o.kind === 'door') {
        for (const lf of sym.leaves) { pl(lf.path); ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.stroke(); if (lf.hinge) { const H = x.P(lf.hinge); ctx.beginPath(); ctx.arc(H[0], H[1], 1.6, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill() } }
      } else {
        if (fillGap) { ctx.beginPath(); polyPath(ctx, x, gap); ctx.fillStyle = K.skyFill; ctx.fill() }
        for (const e of sym.edges) { pl(e); ctx.strokeStyle = thin; ctx.lineWidth = 0.8; ctx.stroke() }
        for (const d of o.kind === 'floor-window' ? [-t * 0.12, t * 0.12] : [0]) { pl(openingPath(w, o.offset, o.offset + o.width, d)); ctx.strokeStyle = glass; ctx.lineWidth = 1.3; ctx.stroke() }
        for (const [a, b] of sym.divisions) { line(ctx, x, a, b); ctx.strokeStyle = thin; ctx.lineWidth = 0.8; ctx.stroke() }
      }
      ctx.restore()
      return
    }
  }
  if (o.kind === 'door' && o.swing) {
    const side = o.swing.side
    const hinge = o.swing.hinge === 'start' ? s.a : s.b, other = o.swing.hinge === 'start' ? s.b : s.a
    const hf = shift(hinge, n, side * t / 2), of = shift(other, n, side * t / 2), leaf = shift(hf, n, side * o.width)
    const H = x.P(hf), L = x.P(leaf), O = x.P(of), r = o.width * x.s
    const a0 = Math.atan2(L[1] - H[1], L[0] - H[0]), a1 = Math.atan2(O[1] - H[1], O[0] - H[0])
    let d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI
    ctx.beginPath(); ctx.moveTo(H[0], H[1]); ctx.arc(H[0], H[1], r, a0, a1, d < 0); ctx.closePath()
    ctx.fillStyle = 'rgba(22,25,30,0.035)'; ctx.fill()
    ctx.beginPath(); ctx.arc(H[0], H[1], r, a0, a1, d < 0); ctx.strokeStyle = thin; ctx.lineWidth = 0.8; ctx.stroke()
    ctx.beginPath(); ctx.moveTo(H[0], H[1]); ctx.lineTo(L[0], L[1]); ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.stroke()
    ctx.beginPath(); ctx.arc(H[0], H[1], 1.6, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill()
  } else if (o.kind === 'sliding') {
    const th = Math.max(t * 0.24, 22)
    const r1 = wallFootprint(sliceWall({ ...w, thickness: th }, o.offset, o.offset + o.width * 0.56)).map(p => shift(p, n, t * 0.17))
    const r2 = wallFootprint(sliceWall({ ...w, thickness: th }, o.offset + o.width * 0.44, o.offset + o.width)).map(p => shift(p, n, -t * 0.17))
    for (const r of [r1, r2]) { ctx.beginPath(); polyPath(ctx, x, r); ctx.fillStyle = K.paper; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke() }
  } else if (o.kind === 'doorway') {
    ctx.setLineDash([3, 2.4])
    for (const d of [-t / 2, t / 2]) { line(ctx, x, shift(s.a, n, d), shift(s.b, n, d)); ctx.strokeStyle = thin; ctx.lineWidth = 0.9; ctx.stroke() }
  } else if (o.kind === 'open-balcony') {
    ctx.setLineDash([0.8, 4]); line(ctx, x, s.a, s.b); ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.stroke()
  } else {
    if (fillGap) { ctx.beginPath(); polyPath(ctx, x, gap); ctx.fillStyle = K.skyFill; ctx.fill() }
    for (const d of [-t / 2, t / 2]) { line(ctx, x, shift(s.a, n, d), shift(s.b, n, d)); ctx.strokeStyle = thin; ctx.lineWidth = 0.8; ctx.stroke() }
    for (const d of o.kind === 'floor-window' ? [-t * 0.12, t * 0.12] : [0]) { line(ctx, x, shift(s.a, n, d), shift(s.b, n, d)); ctx.strokeStyle = glass; ctx.lineWidth = 1.3; ctx.stroke() }
    if (o.panes && o.panes.length > 1) {
      let acc = 0
      for (let i = 0; i < o.panes.length - 1; i++) { acc += o.panes[i].width; const p = pointAt(w, o.offset + o.width * acc); line(ctx, x, shift(p, n, -t / 2), shift(p, n, t / 2)); ctx.strokeStyle = thin; ctx.lineWidth = 0.8; ctx.stroke() }
    }
    if (o.kind === 'bay-window') { ctx.setLineDash([3, 2]); line(ctx, x, shift(s.a, n, t / 2 + 40), shift(s.b, n, t / 2 + 40)); ctx.strokeStyle = thin; ctx.lineWidth = 0.8; ctx.stroke() }
  }
  ctx.restore()
}

export interface DrawPlanOpts {
  tone?: Tone
  /** 房间名 */
  labels?: boolean
  /** 总宽总深 */
  dims?: boolean
  level?: string
  /** 装修页：每间房的地面填色（缺省白底） */
  floorFill?: (roomId: string) => string | undefined
  /** 装修房间页的平面局部：房间名整个落在这个框里才写（取景边上的半截字不写）；缺省全写 */
  labelWithin?: Rect
}

/** 画一张平面（不含改造标记） */
export function drawPlan(ctx: Ctx, plan: Plan, x: Xf, clip: Rect | null, o: DrawPlanOpts = {}) {
  const tone = o.tone ?? 'normal'
  const p = o.level ? onLevel(plan, o.level) : plan
  ctx.save()
  if (clip) { ctx.beginPath(); ctx.roundRect(clip.x, clip.y, clip.w, clip.h, 10); ctx.clip() }
  // 房间：白底；飘窗台这类抬高的地面画斜纹
  for (const r of p.rooms) {
    if (r.poly.length < 3) continue
    ctx.beginPath(); polyPath(ctx, x, r.poly)
    ctx.fillStyle = o.floorFill?.(r.id) ?? ((r.floorOffset ?? 0) > 0 ? pattern(ctx, 'platform') : K.paper)
    ctx.fill()
  }
  // 房间外轮廓一圈极淡的线，白底上读得出「这是一块平面」
  try {
    const rp = p.rooms.filter(r => r.poly.length >= 3).map(r => [r.poly]) as never[]
    const u = rp.length ? clipping.union(rp[0], ...rp.slice(1)) as Vec2[][][] : []
    multiPath(ctx, x, u); ctx.strokeStyle = tone === 'normal' ? K.ink200 : K.ink100; ctx.lineWidth = 0.8; ctx.stroke()
  } catch { /* 房间并集失败就不画轮廓 */ }
  // 楼梯、挑空、管道井、柱
  for (const v of listOf(p, 'void')) { if (v.poly?.length >= 3) { ctx.beginPath(); polyPath(ctx, x, v.poly); ctx.setLineDash([4, 3]); ctx.strokeStyle = K.ink400; ctx.lineWidth = 0.9; ctx.stroke(); ctx.setLineDash([]) } }
  for (const st of listOf(p, 'stair')) drawStair(ctx, x, st, tone)
  for (const sh of listOf(p, 'shaft')) {
    if (!(sh.poly?.length >= 3)) continue
    ctx.beginPath(); polyPath(ctx, x, sh.poly); ctx.fillStyle = tone === 'normal' ? K.ink100 : K.ink50; ctx.fill(); ctx.strokeStyle = tone === 'normal' ? K.ink500 : K.ink300; ctx.lineWidth = 1; ctx.stroke()
    const b = sh.poly as Vec2[]; if (b.length >= 4) { line(ctx, x, b[0], b[2]); ctx.stroke(); line(ctx, x, b[1], b[3]); ctx.stroke() }
  }
  // 墙
  for (const g of wallGroups(p)) {
    multiPath(ctx, x, g.polys)
    ctx.fillStyle = wallFill(ctx, g.kind, tone); ctx.fill('evenodd')
    if (g.kind === 'glass' || g.kind === 'half-glass') { ctx.strokeStyle = tone === 'normal' ? K.sky : '#b7d6ea'; ctx.lineWidth = 0.9; ctx.stroke() }
    else if (g.kind === 'half') { ctx.strokeStyle = tone === 'normal' ? K.ink400 : K.ink200; ctx.lineWidth = 0.7; ctx.stroke() }
  }
  for (const c of listOf(p, 'column')) {
    try { ctx.beginPath(); polyPath(ctx, x, columnFootprint(c)); ctx.fillStyle = c.kind === 'bearing' ? (tone === 'normal' ? K.wallBearing : '#b4b9c0') : (tone === 'normal' ? K.wallPart : '#dcdfe3'); ctx.fill() } catch { /* 坏数据跳过 */ }
  }
  // 门窗
  const col = tone === 'normal' ? K.ink : K.ink300, thin = tone === 'normal' ? K.ink400 : K.ink200, glass = tone === 'normal' ? K.sky : '#b7d6ea'
  for (const op of p.openings) drawOpening(ctx, x, p, op, col, thin, glass)
  // 梁：在剖切面以上，虚线轮廓
  for (const b of p.beams) {
    ctx.beginPath(); polyPath(ctx, x, beamFootprint(b))
    ctx.fillStyle = 'rgba(22,25,30,0.03)'; ctx.fill()
    ctx.setLineDash([5, 3.5]); ctx.strokeStyle = tone === 'normal' ? K.ink500 : K.ink300; ctx.lineWidth = 0.9; ctx.stroke(); ctx.setLineDash([])
  }
  if (o.labels !== false) roomLabels(ctx, p, x, tone, o.labelWithin)
  ctx.restore()
  if (o.dims) totalDims(ctx, p, x)
}

function drawStair(ctx: Ctx, x: Xf, st: { poly?: Vec2[]; path?: Vec2[]; width?: number; steps?: number }, tone: Tone) {
  if (!st.poly || st.poly.length < 3) return
  ctx.beginPath(); polyPath(ctx, x, st.poly); ctx.fillStyle = K.paper; ctx.fill(); ctx.strokeStyle = tone === 'normal' ? K.ink600 : K.ink300; ctx.lineWidth = 1; ctx.stroke()
  const path = st.path ?? []
  if (path.length >= 2) {
    ctx.beginPath(); path.forEach((p, i) => { const q = x.P(p); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]) })
    ctx.strokeStyle = tone === 'normal' ? K.ink : K.ink300; ctx.lineWidth = 1; ctx.stroke()
    const end = x.P(path[path.length - 1]), prev = x.P(path[path.length - 2]), a = Math.atan2(end[1] - prev[1], end[0] - prev[0])
    ctx.beginPath(); ctx.moveTo(end[0], end[1]); ctx.lineTo(end[0] - 7 * Math.cos(a - 0.45), end[1] - 7 * Math.sin(a - 0.45)); ctx.moveTo(end[0], end[1]); ctx.lineTo(end[0] - 7 * Math.cos(a + 0.45), end[1] - 7 * Math.sin(a + 0.45)); ctx.stroke()
  }
}

function roomLabels(ctx: Ctx, p: Plan, x: Xf, tone: Tone, within?: Rect) {
  for (const r of p.rooms) {
    if (r.poly.length < 3) continue
    const areaPx = polygonArea(r.poly) * x.s * x.s
    if (areaPx < 900) continue
    const at = x.P(labelPoint(r.poly))
    const size = Math.max(9, Math.min(12.5, Math.sqrt(areaPx) / 7))
    ctx.save()
    ctx.font = `600 ${size}px ${'"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'}`
    if (within) {
      const hw = ctx.measureText(r.name).width / 2 + 2, below = (r.floorOffset ?? 0) !== 0 && areaPx > 1600 ? 16 : 3
      if (at[0] - hw < within.x || at[0] + hw > within.x + within.w || at[1] - size * 0.75 < within.y || at[1] + size * 0.35 + below > within.y + within.h) { ctx.restore(); continue }
    }
    ctx.textAlign = 'center'
    ctx.lineWidth = 3.5; ctx.strokeStyle = (r.floorOffset ?? 0) > 0 ? '#f7f8f9' : K.paper; ctx.lineJoin = 'round'
    ctx.strokeText(r.name, at[0], at[1] + size * 0.35)
    ctx.fillStyle = tone === 'normal' ? K.ink700 : K.ink400
    ctx.fillText(r.name, at[0], at[1] + size * 0.35)
    if ((r.floorOffset ?? 0) !== 0 && areaPx > 1600) text(ctx, `${(r.floorOffset ?? 0) > 0 ? '+' : ''}${(r.floorOffset ?? 0).toFixed(2)} m`, at[0], at[1] + size * 0.35 + 12, { size: 9, weight: 650, family: NUM, align: 'center', color: K.ink500 })
    ctx.restore()
  }
}

function totalDims(ctx: Ctx, p: Plan, x: Xf) {
  const xs = p.walls.flatMap(w => wallFootprint(w).map(q => q[0])), ys = p.walls.flatMap(w => wallFootprint(w).map(q => q[1]))
  if (!xs.length) return
  const b: Box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  const A = x.P([b[0], b[1]]), B = x.P([b[2], b[3]])
  ctx.save()
  ctx.strokeStyle = K.ink400; ctx.lineWidth = 0.9
  const y = A[1] - 16, xx = A[0] - 16
  ctx.beginPath(); ctx.moveTo(A[0], y); ctx.lineTo(B[0], y); ctx.moveTo(A[0], y - 4); ctx.lineTo(A[0], y + 4); ctx.moveTo(B[0], y - 4); ctx.lineTo(B[0], y + 4)
  ctx.moveTo(xx, A[1]); ctx.lineTo(xx, B[1]); ctx.moveTo(xx - 4, A[1]); ctx.lineTo(xx + 4, A[1]); ctx.moveTo(xx - 4, B[1]); ctx.lineTo(xx + 4, B[1]); ctx.stroke()
  const lab = (s: string, cx: number, cy: number, rot = 0) => {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(rot)
    ctx.font = `700 10px ${NUM}`; const w = ctx.measureText(s).width + 12
    ctx.beginPath(); ctx.roundRect(-w / 2, -8, w, 16, 8); ctx.fillStyle = K.paper; ctx.fill(); ctx.strokeStyle = K.ink200; ctx.stroke()
    text(ctx, s, 0, 3.6, { size: 10, weight: 700, family: NUM, align: 'center', color: K.ink700 }); ctx.restore()
  }
  lab(`${((b[2] - b[0]) / 1000).toFixed(2)} m`, (A[0] + B[0]) / 2, y)
  lab(`${((b[3] - b[1]) / 1000).toFixed(2)} m`, xx, (A[1] + B[1]) / 2, -Math.PI / 2)
  ctx.restore()
}

/* ───────── 改造标记 ───────── */
export type MarkOp = 'add' | 'remove' | 'modify'
export interface Mark {
  changeId: string
  op: MarkOp
  type: string
  /** 平面足迹 */
  polys: Vec2[][]
  /** 洞口：画符号用（宿主墙取自 host） */
  opening?: Opening
  host?: Plan
  /** 「改之前」那张图上的足迹（修改 / 拆除） */
  beforePolys?: Vec2[][]
  level?: string
}

function footprintOf(state: Plan, type: string, el: Record<string, unknown> | undefined, range?: [number, number]): Vec2[][] {
  if (!el) return []
  try {
    if (type === 'wall') { const w = el as unknown as Wall; return [wallFootprint(range ? sliceWall(w, range[0], range[1]) : w)] }
    if (type === 'opening') { const o = el as unknown as Opening; const s = openingSpan(state, o); return [wallFootprint(sliceWall({ ...s.wall, thickness: s.wall.thickness + 40 }, o.offset, o.offset + o.width))] }
    if (type === 'beam') return [beamFootprint(el as never)]
    if (type === 'column') return [columnFootprint(el as never)]
    const poly = (el as { poly?: Vec2[] }).poly
    return poly && poly.length >= 3 ? [poly] : []
  } catch { return [] }
}

/** 按顺序推进一份私有几何，算出每条改造的标记（不管它有没有被重放执行——待确认的提议也画出来） */
export function computeMarks(base: Plan, changes: Change[]): Mark[] {
  const state = structuredClone(base) as Plan
  const out: Mark[] = []
  for (const c of changes) {
    const list = listOf(state, c.type)
    if (!list.length && !(c.type in { wall: 1, opening: 1, beam: 1, room: 1 })) (state as unknown as Record<string, unknown[]>)[({ column: 'columns', shaft: 'shafts', stair: 'stairs', void: 'voids' } as Record<string, string>)[c.type]] = list
    const old = findIn(state, c.type, c.target)
    const levelOfEl = (el: { level?: string; wall?: string } | undefined) => el?.wall ? (findIn(state, 'wall', el.wall) as Wall | undefined)?.level : el?.level
    if (c.op === 'add' && c.data) {
      const el = structuredClone(c.data) as Record<string, unknown>
      out.push({ changeId: c.id, op: 'add', type: c.type, polys: footprintOf(state, c.type, el), opening: c.type === 'opening' ? el as unknown as Opening : undefined, host: c.type === 'opening' ? structuredClone(state) : undefined, level: levelOfEl(el as never) })
      list.push(el)
    } else if (c.op === 'remove' && old) {
      const polys = footprintOf(state, c.type, old, c.range)
      out.push({ changeId: c.id, op: 'remove', type: c.type, polys, beforePolys: polys, opening: c.type === 'opening' ? old : undefined, host: c.type === 'opening' ? structuredClone(state) : undefined, level: levelOfEl(old) })
      if (!c.range) {
        list.splice(list.indexOf(old), 1)
        if (c.type === 'wall') state.openings = state.openings.filter(o => o.wall !== old.id)
      }
    } else if (c.op === 'update' && old) {
      const next = { ...old, ...structuredClone(c.data ?? {}) }
      const beforePolys = footprintOf(state, c.type, old)
      list[list.indexOf(old)] = next
      out.push({ changeId: c.id, op: 'modify', type: c.type, polys: footprintOf(state, c.type, next), beforePolys, opening: c.type === 'opening' ? next : undefined, host: c.type === 'opening' ? structuredClone(state) : undefined, level: levelOfEl(next) })
    }
  }
  return out
}

/** 改之后的图上画标记；strong = 本页讲的条目，其余淡显 */
export function drawMarks(ctx: Ctx, x: Xf, marks: Mark[], strong: Set<string>, clip: Rect | null, side: 'after' | 'before' = 'after') {
  ctx.save()
  if (clip) { ctx.beginPath(); ctx.roundRect(clip.x, clip.y, clip.w, clip.h, 10); ctx.clip() }
  // 先画淡的，再画本页的
  const ordered = [...marks].sort((a, b) => Number(strong.has(a.changeId)) - Number(strong.has(b.changeId)))
  for (const m of ordered) {
    const on = strong.has(m.changeId)
    ctx.globalAlpha = on ? 1 : 0.32
    const polys = side === 'before' ? (m.beforePolys ?? []) : m.polys
    if (!polys.length) continue
    const path = () => { ctx.beginPath(); for (const p of polys) polyPath(ctx, x, p) }
    if (side === 'before') {
      // 改之前：要拆的 = 珊瑚虚线 + 斜纹；要改的 = 墨色虚线框（「这里会变」）
      if (m.op === 'remove') { path(); ctx.fillStyle = pattern(ctx, 'coral'); ctx.fill(); ctx.setLineDash([4, 2.6]); ctx.strokeStyle = K.coral; ctx.lineWidth = 1.6; ctx.stroke() }
      else if (m.op === 'modify') { path(); ctx.setLineDash([3.5, 2.5]); ctx.strokeStyle = K.ink; ctx.lineWidth = 1.3; ctx.stroke() }
      ctx.setLineDash([])
      continue
    }
    if (m.op === 'remove') {
      path(); ctx.fillStyle = pattern(ctx, 'coral'); ctx.fill()
      ctx.setLineDash([4, 2.6]); ctx.strokeStyle = K.coral; ctx.lineWidth = 1.6; ctx.stroke(); ctx.setLineDash([])
    } else if (m.op === 'add') {
      if (m.type === 'opening' && m.opening && m.host) {
        path(); ctx.fillStyle = K.paper; ctx.fill()
        drawOpening(ctx, x, m.host, m.opening, K.cobaltDeep, K.cobalt, K.cobalt, false)
        path(); ctx.strokeStyle = K.cobalt; ctx.lineWidth = 2.2; ctx.stroke()
      } else if (m.type === 'room' || m.type === 'void' || m.type === 'stair' || m.type === 'shaft') {
        path(); ctx.fillStyle = 'rgba(75,118,242,0.16)'; ctx.fill(); ctx.strokeStyle = K.cobalt; ctx.lineWidth = 2.2; ctx.stroke()
      } else if (m.type === 'beam') {
        path(); ctx.fillStyle = 'rgba(75,118,242,0.35)'; ctx.fill(); ctx.strokeStyle = K.cobaltDeep; ctx.lineWidth = 1.4; ctx.stroke()
      } else {
        path(); ctx.fillStyle = K.cobalt; ctx.fill(); ctx.strokeStyle = K.cobaltDeep; ctx.lineWidth = 0.8; ctx.stroke()
      }
    } else {
      // 修改：钴蓝实线框（白边隔开底下的墙）
      path(); ctx.strokeStyle = K.paper; ctx.lineWidth = 5; ctx.stroke()
      if (m.type === 'room') { ctx.fillStyle = 'rgba(75,118,242,0.10)'; ctx.fill() }
      ctx.strokeStyle = K.cobalt; ctx.lineWidth = 2.2; ctx.stroke()
    }
  }
  ctx.restore()
}

/** 只画墙本身（钥匙图、立面旁的小平面） */
export function highlightWall(ctx: Ctx, x: Xf, w: Wall, color: string = K.cobalt) {
  ctx.save()
  ctx.beginPath(); polyPath(ctx, x, wallFootprint({ ...w, thickness: Math.max(w.thickness, 160) }))
  ctx.strokeStyle = K.paper; ctx.lineWidth = 6; ctx.stroke()
  ctx.fillStyle = color; ctx.fill()
  ctx.restore()
}
export function outlinePoly(ctx: Ctx, x: Xf, poly: Vec2[], color: string, width = 2, dash: number[] = [], fillStyle?: string) {
  ctx.save(); ctx.beginPath(); polyPath(ctx, x, poly)
  if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill() }
  ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); ctx.restore()
}
/** 一组 mm 点的外接框 */
export function boxOf(points: Vec2[]): Box {
  return [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))]
}
