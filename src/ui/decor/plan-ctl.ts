/**
 * 装修态平面的点选和拖动：点哪选哪（家具 → 柜子 → 造型 → 嵌入 → 没地方挂的幽灵 → 墙边 300mm 内的墙面 → 地面）。
 * 拖家具：离墙面 150mm 以内背面自动贴墙（记 against），拖的时候算四个方向的净距（测距的洋红胶囊）。
 */
import type { Plan, Vec2 } from '@/core/types'
import type { Decor, FaceRef, Furniture } from '@/core/decor/types'
import { furnitureFootprint } from '@/core/decor/furniture'
import { faceAxis, faceExtent } from '@/core/decor/faces'
import { joinedWallFootprint } from '@/core/walls'
import { pointInPolygon, wallDir, wallNormal } from '@/core/geometry'
import { embedFootprint, embedsOf, faceNear, footprintOf, type DecorIssues, listOf, type ItemKind } from './model'
import type { DSel } from './dstore'

export function decorHit(plan: Plan, decor: Decor, p: Vec2, issues: DecorIssues | null): DSel | null {
  const inside = (poly: Vec2[] | null) => !!poly && pointInPolygon(p, poly)
  const furn = [...decor.furniture].reverse()
  for (const f of furn) if (f.type !== 'rug' && inside(furnitureFootprint(f, plan))) return { k: 'furniture', id: f.id }
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
  for (const f of furn) if (f.type === 'rug' && inside(furnitureFootprint(f, plan))) {
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

/** 拖家具：背面离墙面 150mm 以内就贴上去（正面朝房间），返回新的中心点和 against */
export function snapFurniture(plan: Plan, f: Furniture, at: Vec2): { at: Vec2; against?: Furniture['against'] } {
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
  if (!best) return { at }
  const nn = (() => { const w = plan.walls.find(x => x.id === best!.face.wall)!, n = wallNormal(w); return [n[0] * best!.face.side, n[1] * best!.face.side] as Vec2 })()
  return { at: [at[0] - nn[0] * best.dist, at[1] - nn[1] * best.dist], against: { face: best.face, gap: 0 } }
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
export function clearances(plan: Plan, decor: Decor, f: Furniture): Clear[] {
  const fp = furnitureFootprint(f, plan)
  const x0 = Math.min(...fp.map(p => p[0])), x1 = Math.max(...fp.map(p => p[0])), y0 = Math.min(...fp.map(p => p[1])), y1 = Math.max(...fp.map(p => p[1]))
  const segs: { a: Vec2; b: Vec2; what: Clear['what'] }[] = []
  for (const w of plan.walls) for (const rings of joinedWallFootprint(plan, w)) for (const r of rings) r.forEach((a, i) => segs.push({ a, b: r[(i + 1) % r.length], what: 'wall' }))
  for (const g of decor.furniture) {
    if (g.id === f.id || g.type === 'rug' || g.in) continue
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
