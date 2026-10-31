/**
 * 装修态平面的点选和拖动：点哪选哪（家具 → 柜子 → 造型 → 嵌入 → 没地方挂的幽灵 → 墙边 300mm 内的墙面 → 地面）。
 * 拖家具：离墙面 150mm 以内背面自动贴墙（记 against），拖的时候算四个方向的净距（测距的洋红胶囊）。
 * 方向键挪家具：贴墙的记法和拖动一样，但不吸附（吸回去的话 10 mm 就挪不动了）。
 */
import type { Plan, Vec2 } from '@/core/types'
import type { Decor, DoorFinish, FaceRef, Furniture } from '@/core/decor/types'
import { furnitureCollisions, furnitureFootprint, isFlatFurniture } from '@/core/decor/furniture'
import { componentOf } from '@/core/decor/components'
import { furnitureName } from './furniture'
import { faceAxis, faceExtent } from '@/core/decor/faces'
import { joinedWallFootprint } from '@/core/walls'
import { pointInPolygon, polygonArea, sliceWall, wallDir, wallFootprint, wallNormal } from '@/core/geometry'
import { openingSymbol } from '@/core/opening-symbol'
import { embedFootprint, embedsOf, faceNear, footprintOf, overheadIds, overheadOf, type DecorIssues, listOf, type ItemKind } from './model'
import type { DSel } from './dstore'

/** 顶上的东西大到这个面积（mm²）就只认轮廓线和名字：中间要留给地面和家具 */
const OVERHEAD_BIG = 1.5e6
const distToSeg = (p: Vec2, a: Vec2, b: Vec2) => {
  const d: Vec2 = [b[0] - a[0], b[1] - a[1]], l = d[0] * d[0] + d[1] * d[1], t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l)) : 0
  return Math.hypot(p[0] - a[0] - d[0] * t, p[1] - a[1] - d[1] * t)
}
export const isBigOverhead = (f: Furniture) => f.size[0] * f.size[1] >= OVERHEAD_BIG
/** 大块吊顶的名字标在哪（屏幕 px 的小标签，平面坐标的中心）：第一条边的中点往里 18 px，避开房间中间的房间名 */
export function overheadLabelAt(fp: Vec2[], k: number): Vec2 {
  const c: Vec2 = [fp.reduce((a, q) => a + q[0], 0) / fp.length, fp.reduce((a, q) => a + q[1], 0) / fp.length]
  const m: Vec2 = [(fp[0][0] + fp[1][0]) / 2, (fp[0][1] + fp[1][1]) / 2], d = Math.hypot(c[0] - m[0], c[1] - m[1]) || 1
  return [m[0] + (c[0] - m[0]) / d * 18 / k, m[1] + (c[1] - m[1]) / d * 18 / k]
}
export const overheadLabelW = (name: string) => [...name].reduce((a, ch) => a + (/[\u2E80-\uFFFF]/.test(ch) ? 11 : 6.6), 0) + 18
/** 门洞那一块（墙厚范围）和平面上画出来的门扇；有外观的门才认，没外观的门点了还是那面墙 */
function doorAt(plan: Plan, decor: Decor, p: Vec2, tol: number): DoorFinish | null {
  for (const d of decor.doors ?? []) {
    const o = plan.openings.find(x => x.id === d.opening), w = o && plan.walls.find(x => x.id === o.wall)
    if (!o || !w) continue
    try {
      if (pointInPolygon(p, wallFootprint(sliceWall({ ...w, thickness: w.thickness + tol * 2 }, o.offset, o.offset + o.width)))) return d
      if (openingSymbol(plan, o.id, { doorAngle: 90 }).leaves.some(l => l.path.some((a, i) => i > 0 && distToSeg(p, l.path[i - 1], a) <= tol))) return d
    } catch { /* 墙不在了 */ }
  }
  return null
}

/**
 * 点到了什么。k = 平面当前缩放（px/mm），用来换算线的点选宽度；
 * structure：只认墙面、地面和普通构件（刷材质、双击进立面时用，门和顶上的东西不挡路）。
 */
export function decorHit(plan: Plan, decor: Decor, p: Vec2, issues: DecorIssues | null, opts: { k?: number; structure?: boolean } = {}): DSel | null {
  const inside = (poly: Vec2[] | null) => !!poly && pointInPolygon(p, poly)
  const furn = [...decor.furniture].reverse()
  const k = opts.k ?? 0.1, tol = 7 / k
  const over = opts.structure ? new Set<string>() : overheadIds(plan, decor), all = opts.structure ? overheadIds(plan, decor) : over
  // 灯这种小件和家具重叠时，面积小的那件优先：吊灯在餐桌上方，点灯选灯，点桌子其余地方选桌子
  let small: { id: string; area: number } | null = null
  for (const f of furn) if (over.has(f.id) && !isBigOverhead(f)) { const fp = furnitureFootprint(f, plan); if (inside(fp) && (!small || polygonArea(fp) < small.area)) small = { id: f.id, area: polygonArea(fp) } }
  for (const f of furn) if (!all.has(f.id) && !isFlatFurniture(decor, f)) {
    const fp = furnitureFootprint(f, plan)
    if (inside(fp)) return { k: 'furniture', id: small && small.area < polygonArea(fp) ? small.id : f.id }
  }
  if (small) return { k: 'furniture', id: small.id }
  const orphan = new Set(issues?.orphans.map(i => i.id) ?? [])
  for (const k of ['cabinet', 'panel'] as ItemKind[]) for (const it of [...listOf(decor, k)].reverse()) {
    if (orphan.has(it.id)) continue
    if (inside(footprintOf(plan, k, it))) return { k: k as 'cabinet' | 'panel', id: it.id }
  }
  for (const e of embedsOf(plan, decor)) {
    if (!decor.recesses.some(r => r.id === e.id)) continue
    try { if (inside(embedFootprint(plan, e))) return { k: 'recess', id: e.id } } catch { /* 挂不上 */ }
  }
  for (const id of orphan) {
    const c = decor.cache?.[id]
    if (c && p[0] >= c.box[0] && p[0] <= c.box[2] && p[1] >= c.box[1] && p[1] <= c.box[3]) {
      const k = decor.cabinets.some(x => x.id === id) ? 'cabinet' : decor.panels.some(x => x.id === id) ? 'panel' : decor.recesses.some(x => x.id === id) ? 'recess' : 'furniture'
      return { k, id }
    }
  }
  if (!opts.structure) {
    const door = doorAt(plan, decor, p, tol)
    if (door) return { k: 'door', id: door.id }
    for (const f of furn) if (over.has(f.id) && isBigOverhead(f)) {
      const fp = furnitureFootprint(f, plan)
      if (fp.some((a, i) => distToSeg(p, a, fp[(i + 1) % fp.length]) <= tol)) return { k: 'furniture', id: f.id }
      const name = f.name ?? componentOf(decor, f.type)?.name ?? '', at = overheadLabelAt(fp, k)
      if (Math.abs(p[0] - at[0]) <= overheadLabelW(name) / 2 / k && Math.abs(p[1] - at[1]) <= 11 / k) return { k: 'furniture', id: f.id }
    }
  }
  for (const f of furn) if (!all.has(f.id) && isFlatFurniture(decor, f) && inside(furnitureFootprint(f, plan))) {
    // 地毯中间是选地毯；靠墙那一圈仍然让给墙面
    const fn = faceNear(plan, p, 300)
    if (!fn || fn.d > 300) return { k: 'furniture', id: f.id }
  }
  const fn = faceNear(plan, p, 300)
  const room = plan.rooms.find(r => pointInPolygon(p, r.poly))
  if (fn && (fn.d < 0 || !room || fn.d <= 300)) {
    try {
      const ext = faceExtent(plan, fn.face)
      if (fn.s >= ext[0] - 1 && fn.s <= ext[1] + 1 && ext[1] - ext[0] > 1) return { k: 'face', face: fn.face, s: fn.s }
    } catch { /* 弧墙等 */ }
  }
  if (room) return { k: 'floor', id: room.id }
  return null
}

const front = (rot: number): Vec2 => { const a = rot * Math.PI / 180; return [-Math.sin(a), Math.cos(a)] }

/** 背面最近的那面墙（正面朝着离开墙的方向）；dist = 背面到墙面的距离，压进墙里是负数 */
function backFace(plan: Plan, f: Furniture, at: Vec2): { face: FaceRef; dist: number; n: Vec2 } | null {
  const fr = front(f.rot ?? 0), d = f.size[1]
  const back: Vec2 = [at[0] - fr[0] * d / 2, at[1] - fr[1] * d / 2]
  let best: { face: FaceRef; dist: number; s: number } | null = null
  for (const w of plan.walls) {
    if (w.bulge) continue
    const n = wallNormal(w), u = wallDir(w)
    for (const side of [1, -1] as const) {
      const nn: Vec2 = [n[0] * side, n[1] * side]
      if (nn[0] * fr[0] + nn[1] * fr[1] < 0.96) continue // 正面要朝着离开墙的方向
      let ax
      try { ax = faceAxis(plan, { wall: w.id, side }) } catch { continue }
      const o = ax.at(0)
      const q: Vec2 = [back[0] - o[0], back[1] - o[1]]
      const dist = q[0] * nn[0] + q[1] * nn[1], s = q[0] * u[0] + q[1] * u[1]
      if (dist < -40 || dist > 150) continue
      let ext: [number, number]
      try { ext = faceExtent(plan, { wall: w.id, side }) } catch { continue }
      if (s < ext[0] - f.size[0] / 2 || s > ext[1] + f.size[0] / 2) continue
      if (!best || Math.abs(dist) < Math.abs(best.dist)) best = { face: { wall: w.id, side }, dist, s }
    }
  }
  if (!best) return null
  const n = wallNormal(plan.walls.find(x => x.id === best!.face.wall)!)
  return { face: best.face, dist: best.dist, n: [n[0] * best.face.side, n[1] * best.face.side] }
}

/** 拖家具：背面离墙面 150mm 以内就贴上去（正面朝房间），返回新的中心点和 against */
export function snapFurniture(plan: Plan, f: Furniture, at: Vec2): { at: Vec2; against?: Furniture['against'] } {
  if (overheadOf(plan, f)) return { at } // 顶上的东西不贴墙：只挪平面位置，离地高度不动
  const b = backFace(plan, f, at)
  if (!b) return { at }
  return { at: [at[0] - b.n[0] * b.dist, at[1] - b.n[1] * b.dist], against: { face: b.face, gap: 0 } }
}

/**
 * 方向键挪家具：按屏幕方向走 d（mm）。背面正好贴着墙面才记 against（和拖动的结果一致），离开了就不记；
 * 不往回吸，所以 10 mm 总能走出去。一步跨过墙面时停在墙面上（贴墙），再按一下才压进墙里，由「放不下」提示。
 */
export function nudgeFurniture(plan: Plan, f: Furniture, d: Vec2): { at: Vec2; against?: Furniture['against'] } {
  const from = f.at ?? [0, 0], at: Vec2 = [Math.round((from[0] + d[0]) * 100) / 100, Math.round((from[1] + d[1]) * 100) / 100]
  if (overheadOf(plan, f)) return { at }
  const after = backFace(plan, f, at)
  if (!after) return { at }
  if (Math.abs(after.dist) < 0.5) return { at, against: { face: after.face, gap: 0 } }
  const before = backFace(plan, f, from)
  if (after.dist < 0 && before && before.dist > 0.5 && before.face.wall === after.face.wall && before.face.side === after.face.side) return { at: [at[0] - after.n[0] * after.dist, at[1] - after.n[1] * after.dist], against: { face: after.face, gap: 0 } }
  return { at }
}

/** 四个方向的净距：从家具外接框四条边的中点往外打射线，碰到的第一面墙或另一件家具。只给数，不判断够不够 */
export interface Clear { dir: 'l' | 'r' | 'u' | 'd'; from: Vec2; to: Vec2; dist: number; what: 'wall' | 'furniture' }
function raySeg(o: Vec2, d: Vec2, a: Vec2, b: Vec2): number | null {
  const e: Vec2 = [b[0] - a[0], b[1] - a[1]], det = d[0] * e[1] - d[1] * e[0]
  if (Math.abs(det) < 1e-9) return null
  const q: Vec2 = [a[0] - o[0], a[1] - o[1]]
  const t = (q[0] * e[1] - q[1] * e[0]) / det, u = (q[0] * d[1] - q[1] * d[0]) / det
  return t > 0.5 && u >= 0 && u <= 1 ? t : null
}
export function clearances(plan: Plan, decor: Decor, f: Furniture): Clear[] { return clearancesOf(plan, decor, furnitureFootprint(f, plan), f.id) }
export function clearancesOf(plan: Plan, decor: Decor, fp: Vec2[], selfId: string): Clear[] {
  const x0 = Math.min(...fp.map(p => p[0])), x1 = Math.max(...fp.map(p => p[0])), y0 = Math.min(...fp.map(p => p[1])), y1 = Math.max(...fp.map(p => p[1]))
  const segs: { a: Vec2; b: Vec2; what: Clear['what'] }[] = []
  for (const w of plan.walls) for (const rings of joinedWallFootprint(plan, w)) for (const r of rings) r.forEach((a, i) => segs.push({ a, b: r[(i + 1) % r.length], what: 'wall' }))
  for (const g of decor.furniture) {
    if (g.id === selfId || isFlatFurniture(decor, g) || g.in || overheadOf(plan, g)) continue
    const q = furnitureFootprint(g, plan)
    q.forEach((a, i) => segs.push({ a, b: q[(i + 1) % q.length], what: 'furniture' }))
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  const rays: [Clear['dir'], Vec2, Vec2][] = [['l', [x0, cy], [-1, 0]], ['r', [x1, cy], [1, 0]], ['u', [cx, y0], [0, -1]], ['d', [cx, y1], [0, 1]]]
  const out: Clear[] = []
  for (const [dir, o, d] of rays) {
    let best: { t: number; what: Clear['what'] } | null = null
    for (const s of segs) { const t = raySeg(o, d, s.a, s.b); if (t !== null && t < 6000 && (!best || t < best.t)) best = { t, what: s.what } }
    if (best && best.t > 1) out.push({ dir, from: o, to: [o[0] + d[0] * best.t, o[1] + d[1] * best.t], dist: Math.round(best.t), what: best.what })
  }
  return out
}

/** 拖家具：放不放得下（core furnitureCollisions：压到墙、和同高度的家具重叠）。地毯本来就垫在家具下面，不算重叠 */
export interface Fit { poly: Vec2[]; ok: boolean; text: string }
export function fitCheck(plan: Plan, decor: Decor, f: Furniture): Fit {
  const rug = (id: string) => { const g = decor.furniture.find(x => x.id === id); return !!g && isFlatFurniture(decor, g) }
  const hits = furnitureCollisions(plan, f).filter(h => h.type === 'wall' || (!isFlatFurniture(decor, f) && !rug(h.id)))
  const name = (id: string) => { const g = decor.furniture.find(x => x.id === id); return g ? furnitureName(decor, g) : '家具' }
  const furn = [...new Set(hits.filter(h => h.type === 'furniture').map(h => name(h.id)))]
  const text = !hits.length ? '放得下' : `放不下 · ${[hits.some(h => h.type === 'wall') ? '压到墙' : '', furn.length ? `和${furn.slice(0, 2).join('、')}${furn.length > 2 ? '等' : ''}重叠` : ''].filter(Boolean).join('，')}`
  return { poly: furnitureFootprint(f, plan), ok: !hits.length, text }
}
