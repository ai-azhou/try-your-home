/**
 * 房间多边形只到墙面：门洞的墙厚范围、两间房之间没墙的缝、拆墙留下的占地，都不属于任何房间。
 * 这里算出这些补丁各归哪间房（2D、3D 共用），只管显示：材料粗估照旧按房间面积，门槛不算进去。
 * 一律不抛错：算不出来的那一块不铺，界面照常。
 */
import clipping from 'polygon-clipping'
import type { Plan, Room, Vec2, Wall } from '../types.ts'
import { add, columnFootprint, dot, mul, pointInPolygon, polygonArea, projectToWall, sub, wallLength } from '../geometry.ts'
import { openingPath, openingStrip } from '../opening-symbol.ts'
import { joinedWallFootprint } from '../walls.ts'

type Multi = Vec2[][][]
/** 洞底贴地：比这高就是窗（下面有窗台墙），不铺 */
const FLOOR_SILL = 0.01
/** 两间房相对的边离这么近、中间又没有墙，才算一条缝（比最厚的墙略大） */
const MAX_SEAM = 400
/** 看房间边外侧是什么时，往外探这么远（比缝隙容差大，比半个墙厚小） */
const PROBE = 20
/** 面积小于它的碎片不要（mm²） */
const SLIVER = 200

export interface FloorThreshold {
  opening: string
  /** 整条洞口：先按第一段的地面铺满，接缝处不透出下面的墙色 */
  whole: Vec2[]
  /** 一段 = 同一间房；两边地面不同时从墙中线分开 */
  parts: { room: string; polygon: Vec2[] }[]
}
export interface FloorSeam { room: string; polygons: Multi }
export interface FloorEdge { path: Vec2[]; closed: boolean }
export interface FloorFills {
  thresholds: FloorThreshold[]
  seams: FloorSeam[]
  /** 房间的纸白内沿只沿墙走：通向门洞、缝、相邻同高房间的那几段不画 */
  edges: Record<string, FloorEdge[]>
}
const EMPTY: FloorFills = { thresholds: [], seams: [], edges: {} }

const raised = (r: Room) => (r.floorOffset ?? 0) > 0
/** 抬高的台面（飘窗台）只和一样高的连 */
const sameHeight = (a: Room, b: Room) => (!raised(a) && !raised(b)) || (a.floorOffset ?? 0) === (b.floorOffset ?? 0)
const signedArea = (poly: Vec2[]) => poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p[0] * q[1] - q[0] * p[1] }, 0) / 2
const outward = (poly: Vec2[], a: Vec2, b: Vec2): Vec2 => {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, s = signedArea(poly) > 0 ? 1 : -1
  return [s * (b[1] - a[1]) / L, -s * (b[0] - a[0]) / L]
}
type Box = [number, number, number, number]
const boxOf = (pts: Vec2[]): Box => [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))]
const hit = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
const inMulti = (p: Vec2, m: Multi) => m.some(rings => pointInPolygon(p, rings[0]) && !rings.slice(1).some(h => pointInPolygon(p, h)))
const multiArea = (m: Multi) => m.reduce((sum, rings) => sum + polygonArea(rings[0]) - rings.slice(1).reduce((s, r) => s + polygonArea(r), 0), 0)

/** 只和碰得到的障碍求差：polygon-clipping 按参与的边数算，复杂户型才快 */
function subtract(poly: Multi, blockers: { box: Box; m: Multi }[]): Multi {
  const box = boxOf(poly.flatMap(r => r[0]))
  const near = blockers.filter(b => hit(box, b.box)).map(b => b.m)
  return near.length ? clipping.difference(poly, ...near) as Multi : poly
}
const blocker = (m: Multi) => ({ box: boxOf(m.flatMap(r => r.flatMap(x => x))), m })

function roomBeside(rooms: Room[], w: Wall, s: number, side: 1 | -1): Room | undefined {
  for (const off of [30, 120]) {
    const q = openingPath(w, s, s, side * (w.thickness / 2 + off))[0]
    const r = rooms.find(x => pointInPolygon(q, x.poly))
    if (r) return r
  }
  return undefined
}

function thresholdOf(rooms: Room[], w: Wall, id: string, from: number, to: number): FloorThreshold | null {
  const t = w.thickness, mid = (from + to) / 2
  const samples = [mid, (from + mid) / 2, (mid + to) / 2]
  const pick = (side: 1 | -1) => { for (const s of samples) { const r = roomBeside(rooms, w, s, side); if (r) return r } return undefined }
  let pos = pick(1), neg = pick(-1)
  // 门开在台面旁边：门槛归地面那边，台面不跟着连出来
  if (pos && neg && !sameHeight(pos, neg)) { if (raised(pos)) pos = undefined; else neg = undefined }
  if (!pos && !neg) return null
  const whole = openingStrip(w, from, to, t)
  // 只有一边是房间（入户门、外门）：整条归室内，门槛不留白，也不超出墙外皮
  if (!pos || !neg || pos.id === neg.id) return { opening: id, whole, parts: [{ room: (pos ?? neg)!.id, polygon: whole }] }
  return { opening: id, whole, parts: [
    { room: pos.id, polygon: [...openingPath(w, from, to, t / 2), ...openingPath(w, from, to, 0).reverse()] },
    { room: neg.id, polygon: [...openingPath(w, from, to, 0), ...openingPath(w, from, to, -t / 2).reverse()] },
  ] }
}

/** 相对的两条房间边之间那条带子，从中线分给两边 */
function facingStrips(a: Room, b: Room): { room: Room; quad: Vec2[] }[] {
  const out: { room: Room; quad: Vec2[] }[] = []
  a.poly.forEach((p0, i) => {
    const p1 = a.poly[(i + 1) % a.poly.length], L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1])
    if (L < 1) return
    const u: Vec2 = [(p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L], n = outward(a.poly, p0, p1)
    b.poly.forEach((q0, j) => {
      const q1 = b.poly[(j + 1) % b.poly.length], M = Math.hypot(q1[0] - q0[0], q1[1] - q0[1])
      if (M < 1 || dot(outward(b.poly, q0, q1), n) > -0.999) return
      const d0 = dot(sub(q0, p0), n), d1 = dot(sub(q1, p0), n)
      if (Math.min(d0, d1) < 0.5 || Math.max(d0, d1) > MAX_SEAM) return
      const t0 = dot(sub(q0, p0), u), t1 = dot(sub(q1, p0), u), lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(L, Math.max(t0, t1))
      if (hi - lo < 30) return
      const on = (t: number): Vec2 => add(p0, mul(u, t)), far = (t: number): Vec2 => add(q0, mul(sub(q1, q0), (t - t0) / (t1 - t0)))
      const half = (t: number): Vec2 => { const x = on(t), y = far(t); return [(x[0] + y[0]) / 2, (x[1] + y[1]) / 2] }
      out.push({ room: a, quad: [on(lo), on(hi), half(hi), half(lo)] }, { room: b, quad: [half(lo), half(hi), far(hi), far(lo)] })
    })
  })
  return out
}

/** 房间每条边往外探：外侧是同高的房间、或归同高房间的补丁，这段就是开敞的，不画纸白线 */
function roomEdges(room: Room, others: { room: Room; m: Multi; box: Box }[]): FloorEdge[] {
  const poly = room.poly, runs: Vec2[][] = []
  const near = others.filter(o => sameHeight(o.room, room))
  let openAny = false
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length], n = outward(poly, a, b), off = mul(n, PROBE)
    const A = add(a, off), B = add(b, off), d = sub(B, A), box = boxOf([A, B])
    const hits = near.filter(o => hit(box, o.box))
    const ts = [0, 1]
    for (const o of hits) for (const rings of o.m) for (const ring of rings) ring.forEach((p, k) => {
      const q = ring[(k + 1) % ring.length], e = sub(q, p), det = d[0] * e[1] - d[1] * e[0]
      if (Math.abs(det) < 1e-9) return
      const v = sub(p, A), t = (v[0] * e[1] - v[1] * e[0]) / det, s = (v[0] * d[1] - v[1] * d[0]) / det
      if (t > 0 && t < 1 && s >= 0 && s <= 1) ts.push(t)
    })
    ts.sort((x, y) => x - y)
    for (let k = 1; k < ts.length; k++) {
      const t0 = ts[k - 1], t1 = ts[k]
      if (t1 - t0 < 1e-6) continue
      const m = add(A, mul(d, (t0 + t1) / 2))
      if (hits.some(o => inMulti(m, o.m))) { openAny = true; continue }
      const from = add(a, mul(sub(b, a), t0)), to = add(a, mul(sub(b, a), t1)), last = runs[runs.length - 1]
      if (last && Math.hypot(last[last.length - 1][0] - from[0], last[last.length - 1][1] - from[1]) < 1e-6) last.push(to)
      else runs.push([from, to])
    }
  })
  if (!openAny) return [{ path: poly, closed: true }]
  // 首尾相接的两段并成一段，转角才是连着的
  if (runs.length > 1) {
    const first = runs[0], last = runs[runs.length - 1], e = last[last.length - 1]
    if (Math.hypot(e[0] - first[0][0], e[1] - first[0][1]) < 1e-6) { runs[0] = [...last, ...first.slice(1)]; runs.pop() }
  }
  return runs.map(path => ({ path, closed: false }))
}

function compute(plan: Plan, base?: Plan): FloorFills {
  const rooms = plan.rooms.filter(r => r.poly.length >= 3)
  if (!rooms.length) return EMPTY
  const thresholds: FloorThreshold[] = []
  const isFloorOpening = (o: Plan['openings'][number]) => o.sill <= FLOOR_SILL
  // 实体：墙减去贴地洞口（窗洞还算墙，下面有窗台）+ 柱、管井；楼板开的洞也不铺
  const solids: { box: Box; m: Multi }[] = []
  for (const w of plan.walls) {
    const L = wallLength(w), cuts = plan.openings.filter(o => o.wall === w.id && isFloorOpening(o)).sort((a, b) => a.offset - b.offset)
    let start = 0
    for (const o of cuts) {
      const from = Math.max(0, Math.min(L, o.offset)), to = Math.max(0, Math.min(L, o.offset + o.width))
      if (from > start) { const m = joinedWallFootprint(plan, w, start, from); if (m.length) solids.push(blocker(m)) }
      start = Math.max(start, to)
      if (to - from < 1) continue
      try { const th = thresholdOf(rooms, w, o.id, from, to); if (th) thresholds.push(th) } catch { /* 这一处不铺 */ }
    }
    if (start < L) { const m = joinedWallFootprint(plan, w, start, L); if (m.length) solids.push(blocker(m)) }
  }
  for (const c of plan.columns ?? []) solids.push(blocker([[columnFootprint(c)]]))
  for (const s of plan.shafts ?? []) if (s.poly.length >= 3) solids.push(blocker([[s.poly]]))
  for (const v of plan.voids ?? []) if (v.poly.length >= 3) solids.push(blocker([[v.poly]]))
  const taken = [...rooms.map(r => blocker([[r.poly]])), ...thresholds.map(t => blocker([[t.whole]]))]
  const seams: FloorSeam[] = []
  const put = (room: Room, poly: Multi) => {
    try {
      const rest = subtract(subtract(poly, solids), taken).filter(rings => polygonArea(rings[0]) >= SLIVER)
      if (!rest.length || multiArea(rest) < SLIVER) return
      seams.push({ room: room.id, polygons: rest }); taken.push(blocker(rest))
    } catch { /* 这一块不铺 */ }
  }
  // 拆掉的墙（含拆一段）：占地还给两边的房间
  for (const w of base?.walls ?? []) {
    const cur = plan.walls.find(x => x.id === w.id)
    if (cur && cur.thickness === w.thickness && cur.bulge === w.bulge && cur.a[0] === w.a[0] && cur.a[1] === w.a[1] && cur.b[0] === w.b[0] && cur.b[1] === w.b[1]) continue
    try {
      const left = subtract(subtract(joinedWallFootprint(base!, w), solids), taken)
      for (const rings of left) {
        if (polygonArea(rings[0]) < SLIVER) continue
        const c = rings[0].reduce<Vec2>((a, p) => [a[0] + p[0] / rings[0].length, a[1] + p[1] / rings[0].length], [0, 0]), s = projectToWall(w, c).s
        let pos = roomBeside(rooms, w, s, 1), neg = roomBeside(rooms, w, s, -1)
        if (pos && neg && !sameHeight(pos, neg)) { if (raised(pos)) pos = undefined; else neg = undefined }
        if (!pos && !neg) continue
        if (!pos || !neg || pos.id === neg.id) { put((pos ?? neg)!, [rings]); continue }
        const L = wallLength(w), half = (d: number): Multi => [[[...openingPath(w, -w.thickness, L + w.thickness, 0), ...openingPath(w, -w.thickness, L + w.thickness, d).reverse()]]]
        put(pos, clipping.intersection([rings], half(w.thickness)) as Multi)
        put(neg, clipping.intersection([rings], half(-w.thickness)) as Multi)
      }
    } catch { /* 这面墙不补 */ }
  }
  // 两间房之间的缝：相对的两条边，中间没被墙占的部分
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    if (!sameHeight(rooms[i], rooms[j])) continue
    for (const { room, quad } of facingStrips(rooms[i], rooms[j])) put(room, [[quad]])
  }
  // 纸白内沿：看每间房的边外侧是不是同高的房间或它的补丁
  const byId = new Map(rooms.map(r => [r.id, r]))
  const others = (self: Room) => [
    ...rooms.filter(r => r.id !== self.id).map(r => ({ room: r, m: [[r.poly]] as Multi, box: boxOf(r.poly) })),
    ...thresholds.flatMap(t => t.parts.map(p => ({ room: byId.get(p.room)!, m: [[p.polygon]] as Multi, box: boxOf(p.polygon) }))),
    ...seams.map(s => ({ room: byId.get(s.room)!, m: s.polygons, box: boxOf(s.polygons.flatMap(r => r[0])) })),
  ]
  const edges: FloorFills['edges'] = {}
  for (const r of rooms) { try { edges[r.id] = roomEdges(r, others(r)) } catch { edges[r.id] = [{ path: r.poly, closed: true }] } }
  return { thresholds, seams, edges }
}

/** 按几何内容缓存：拖家具时方案对象每帧都换新，但墙、门、房间没动，不用重算 */
const cache: { key: string; value: FloorFills }[] = []
export function floorFills(plan: Plan, base?: Plan): FloorFills {
  let key: string
  try { key = JSON.stringify([plan.walls, plan.openings, plan.rooms, plan.columns, plan.shafts, plan.voids, base?.walls]) } catch { return EMPTY }
  const found = cache.find(c => c.key === key)
  if (found) return found.value
  let value = EMPTY
  try { value = compute(plan, base) } catch { /* 几何坏了：只是不铺补丁 */ }
  cache.unshift({ key, value })
  cache.length = Math.min(cache.length, 6)
  return value
}

/** 3D 用：一块块地面，z 由调用方按房间定 */
export function floorFillPieces(f: FloorFills): { room: string; polygons: Multi }[] {
  return [...f.thresholds.flatMap(t => t.parts.map(p => ({ room: p.room, polygons: [[p.polygon]] as Multi }))), ...f.seams]
}
