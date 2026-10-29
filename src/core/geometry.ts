import { DEFAULTS } from './types.ts'
import type { Beam, Box, Column, ElementType, ExtraElementType, Opening, Plan, Room, Vec2, Wall } from './types.ts'

import { levelCeiling, levelOf, levelsOf } from './levels.ts'

export const EPS = 1e-7
export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]]
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
export const mul = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s]
export const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]
export const distance = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])
export const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x))
export function wallDir(w: Pick<Wall, 'a' | 'b'>): Vec2 { const d = sub(w.b, w.a); return mul(d, 1 / (Math.hypot(...d) || 1)) }
export function wallNormal(w: Pick<Wall, 'a' | 'b'>): Vec2 { const d = wallDir(w); return [-d[1], d[0]] }
function arc(w: Wall) {
  const chord = distance(w.a, w.b), sag = w.bulge || 0
  if (chord < EPS || Math.abs(sag) < EPS) return null
  const c = sag / 2 - chord * chord / (8 * sag)
  const center = add(mul(add(w.a, w.b), .5), mul(wallNormal(w), c))
  const radius = distance(center, w.a), start = Math.atan2(w.a[1] - center[1], w.a[0] - center[0])
  const sweep = -4 * Math.atan(2 * sag / chord)
  return { center, radius, start, sweep }
}
/** Signed angle follows bulge (positive toward n), rather than mathematical sweep. */
export function arcParams(w: Wall): { radius: number; angle: number; sagitta: number; center: Vec2 } | null {
  const a = arc(w)
  return a ? { radius: a.radius, angle: -a.sweep * 180 / Math.PI, sagitta: w.bulge!, center: a.center } : null
}
export function bulgeFromRadius(chord: number, radius: number, major = false): number {
  if (!Number.isFinite(chord) || chord <= 0 || !Number.isFinite(radius) || radius < chord / 2) throw new Error('弦长必须为正，半径不能小于半弦长')
  const h = Math.sqrt(Math.max(0, radius * radius - chord * chord / 4))
  return major ? radius + h : chord * chord / (4 * (radius + h))
}
export function bulgeFromAngle(chord: number, angle: number): number {
  if (!Number.isFinite(chord) || chord <= 0 || !Number.isFinite(angle) || Math.abs(angle) >= 360) throw new Error('弦长必须为正，圆心角须在 −360° 与 360° 之间')
  return chord / 2 * Math.tan(angle * Math.PI / 720)
}
export function wallLength(w: Wall): number { const a = arc(w); return a ? a.radius * Math.abs(a.sweep) : distance(w.a, w.b) }
export function pointAt(w: Wall, s: number): Vec2 {
  const len = wallLength(w), t = len > EPS ? clamp(s / len, 0, 1) : 0
  if (t === 0) return [...w.a]; if (t === 1) return [...w.b]
  const a = arc(w)
  return a ? add(a.center, mul([Math.cos(a.start + a.sweep * t), Math.sin(a.start + a.sweep * t)], a.radius)) : add(w.a, mul(sub(w.b, w.a), t))
}
/** Exact unit tangent along the centerline, also at circular wall endpoints. */
export function wallTangent(w: Wall, s: number): Vec2 {
  const a = arc(w)
  if (!a) return wallDir(w)
  const angle = a.start + a.sweep * clamp(s / wallLength(w), 0, 1)
  return mul([-Math.sin(angle), Math.cos(angle)], Math.sign(a.sweep))
}
export function wallPath(w: Wall): Vec2[] {
  if (!arc(w)) return [[...w.a], [...w.b]]
  const len = wallLength(w), n = Math.max(2, Math.ceil(len / 150))
  return Array.from({ length: n + 1 }, (_, i) => pointAt(w, len * i / n))
}
export function projectToWall(w: Wall, p: Vec2): { s: number; dist: number; point: Vec2 } {
  const a = arc(w), len = wallLength(w)
  let s = clamp(dot(sub(p, w.a), wallDir(w)), 0, len)
  if (a) {
    const angle = Math.atan2(p[1] - a.center[1], p[0] - a.center[0])
    const candidates = [0, len]
    for (let k = -2; k <= 2; k++) { const t = (angle - a.start + k * Math.PI * 2) / a.sweep; if (t >= 0 && t <= 1) candidates.push(t * len) }
    s = candidates.reduce((best, cur) => distance(pointAt(w, cur), p) < distance(pointAt(w, best), p) ? cur : best)
  }
  const point = pointAt(w, s); return { s, dist: distance(point, p), point }
}
/** Slice preserves the exact circular arc, including its signed sagitta. */
export function sliceWall(w: Wall, from: number, to: number): Wall {
  const a = arc(w), len = wallLength(w), result = { ...w, a: pointAt(w, from), b: pointAt(w, to) }
  if (a) result.bulge = Math.sign(w.bulge!) * a.radius * (1 - Math.cos(Math.abs(a.sweep) * (to - from) / len / 2))
  return result
}
export function wallFootprint(w: Wall): Vec2[] {
  const path = wallPath(w), a = arc(w), half = w.thickness / 2
  const normals = path.map(p => a ? mul(sub(p, a.center), -Math.sign(a.sweep) / a.radius) : wallNormal(w))
  return [...path.map((p, i) => add(p, mul(normals[i], half))), ...path.map((p, i) => add(p, mul(normals[i], -half))).reverse()]
}
export function beamFootprint(b: Beam): Vec2[] { return wallFootprint({ ...b, thickness: b.width, kind: 'partition' }) }
export function openingSpan(plan: Plan, o: Opening) {
  const wall = plan.walls.find(w => w.id === o.wall)
  if (!wall) throw new Error(`洞口 ${o.id} 的宿主墙 ${o.wall} 不存在`)
  const startTangent = wallTangent(wall, o.offset), endTangent = wallTangent(wall, o.offset + o.width)
  const dir = wallTangent(wall, o.offset + o.width / 2), normal: Vec2 = [-dir[1], dir[0]]
  return { a: pointAt(wall, o.offset), b: pointAt(wall, o.offset + o.width), center: pointAt(wall, o.offset + o.width / 2), dir, normal, wall,
    path: wallPath(sliceWall(wall, o.offset, o.offset + o.width)), startTangent, endTangent,
    startNormal: [-startTangent[1], startTangent[0]] as Vec2, endNormal: [-endTangent[1], endTangent[0]] as Vec2 }

}
export function openingFootprint(plan: Plan, o: Opening): Vec2[] { const { wall } = openingSpan(plan, o); return wallFootprint(sliceWall(wall, o.offset, o.offset + o.width)) }
export function polygonArea(poly: Vec2[]): number { return Math.abs(poly.reduce((a, p, i) => { const q = poly[(i + 1) % poly.length]; return a + p[0] * q[1] - q[0] * p[1] }, 0)) / 2 }
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i], d = sub(b, a), t = clamp(dot(sub(p, a), d) / (dot(d, d) || 1), 0, 1)
    if (distance(p, add(a, mul(d, t))) < EPS) return true
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}
export function labelPoint(poly: Vec2[]): Vec2 {
  if (!poly.length) return [0, 0]
  const ys = [...new Set(poly.map(p => p[1]))].sort((a, b) => a - b)
  let best: Vec2 = [...poly[0]], width = -1
  for (let k = 1; k < ys.length; k++) {
    const y = (ys[k - 1] + ys[k]) / 2, xs: number[] = []
    poly.forEach((a, i) => { const b = poly[(i + 1) % poly.length]; if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) })
    xs.sort((a, b) => a - b)
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > width) { width = xs[i + 1] - xs[i]; best = [(xs[i] + xs[i + 1]) / 2, y] }
  }
  return best
}
export function planBounds(plan: Plan): Box | null {
  const pts = [...plan.walls.flatMap(wallFootprint), ...plan.rooms.flatMap(r => r.poly), ...plan.beams.flatMap(beamFootprint), ...(plan.columns ?? []).flatMap(columnFootprint), ...[...(plan.shafts ?? []), ...(plan.stairs ?? []), ...(plan.voids ?? [])].flatMap(e => e.poly)]
  if (!pts.length) return null
  return [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))]
}
export interface ElementRef { type: ElementType; id: string }
export function hitTest(plan: Plan, p: Vec2, tol = 0): ElementRef | null {
  for (const o of [...plan.openings].reverse()) { const w = plan.walls.find(w => w.id === o.wall); if (w) { const proj = projectToWall(w, p); if (proj.dist <= w.thickness / 2 + tol && proj.s >= o.offset - tol && proj.s <= o.offset + o.width + tol) return { type: 'opening', id: o.id } } }
  for (const w of [...plan.walls].reverse()) if (projectToWall(w, p).dist <= w.thickness / 2 + tol) return { type: 'wall', id: w.id }
  for (const b of [...plan.beams].reverse()) if (pointInPolygon(p, beamFootprint(b))) return { type: 'beam', id: b.id }
  for (const r of [...plan.rooms].reverse()) if (pointInPolygon(p, r.poly)) return { type: 'room', id: r.id }
  return null
}
type SnapToggle = boolean | { tolerance?: number }
export interface SnapOptions { tolerance?: number; endpoints?: SnapToggle; walls?: SnapToggle; openings?: SnapToggle; grid?: SnapToggle; gridSize?: number; angles?: SnapToggle; anchor?: Vec2 }
export interface SnapResult { point: Vec2; kind: 'endpoint' | 'wall' | 'opening' | 'grid' | 'angle' | 'none'; ref?: string }
export function snap(plan: Plan, p: Vec2, opts: SnapOptions = {}): SnapResult {
  const candidates: (SnapResult & { d: number; rank: number })[] = []
  const offer = (point: Vec2, kind: SnapResult['kind'], setting: SnapToggle | undefined, rank: number, ref?: string) => { const d = distance(point, p); if (setting !== false && d <= (typeof setting === 'object' ? setting.tolerance ?? opts.tolerance ?? 100 : opts.tolerance ?? 100)) candidates.push({ point, kind, ref, d, rank }) }
  for (const w of plan.walls) { offer(w.a, 'endpoint', opts.endpoints, 0, w.id); offer(w.b, 'endpoint', opts.endpoints, 0, w.id); offer(projectToWall(w, p).point, 'wall', opts.walls, 2, w.id) }
  for (const o of plan.openings) if (plan.walls.some(w => w.id === o.wall)) { const s = openingSpan(plan, o); offer(s.a, 'opening', opts.openings, 1, o.id); offer(s.b, 'opening', opts.openings, 1, o.id) }
  if (opts.anchor && opts.angles !== false) { const d = sub(p, opts.anchor), ang = Math.round(Math.atan2(d[1], d[0]) / (Math.PI / 4)) * Math.PI / 4, v: Vec2 = [Math.cos(ang), Math.sin(ang)]; offer(add(opts.anchor, mul(v, dot(d, v))), 'angle', opts.angles, 3) }
  const g = opts.gridSize ?? 100
  if (g > 0) offer([Math.round(p[0] / g) * g, Math.round(p[1] / g) * g], 'grid', opts.grid, 4)
  candidates.sort((a, b) => a.rank - b.rank || a.d - b.d)
  const best = candidates[0]; return best ? { point: [...best.point], kind: best.kind, ...(best.ref ? { ref: best.ref } : {}) } : { point: [...p], kind: 'none' }
}
export function jointsAt(plan: Plan, p: Vec2, tol = 1): { wall: Wall; end: 'a' | 'b' }[] { return plan.walls.flatMap(wall => (['a', 'b'] as const).filter(end => distance(wall[end], p) <= tol).map(end => ({ wall, end }))) }
/** positive = n side, negative = -n side. Multiple rooms can adjoin one merged wall. */
export function roomsBesideWall(plan: Plan, wallId: string): { positive: Room[]; negative: Room[] } {
  const wall = plan.walls.find(w => w.id === wallId), result: { positive: Room[]; negative: Room[] } = { positive: [], negative: [] }
  if (!wall) return result
  const path = wallPath(wall)
  for (const room of plan.rooms.filter(r => levelOf(plan, r).id === levelOf(plan, wall).id)) for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], n = wallNormal({ a, b }), d = sub(b, a)
    // Include projected room edge midpoints: short rooms need not contain the wall midpoint.
    const ts = [.1, .5, .9, ...room.poly.map(p => clamp(dot(sub(p, a), d) / (dot(d, d) || 1), .001, .999))]
    for (const side of ['positive', 'negative'] as const) if (!result[side].includes(room) && ts.some(t => pointInPolygon(add(add(a, mul(d, t)), mul(n, (wall.thickness / 2 + 1) * (side === 'positive' ? 1 : -1))), room.poly))) result[side].push(room)
  }
  return result
}
export function roomCeiling(plan: Plan, room: Room): number { return room.ceiling ?? levelCeiling(plan, levelOf(plan, room).id) ?? DEFAULTS.ceiling }
export function effectiveWallHeight(plan: Plan, w: Wall): number { if (w.height !== undefined) return w.height; const sides = roomsBesideWall(plan, w.id), rooms = [...sides.positive, ...sides.negative]; return rooms.length ? Math.max(...rooms.map(r => roomCeiling(plan, r))) : levelCeiling(plan, levelOf(plan, w).id) }
export function ceilingAt(plan: Plan, p: Vec2, levelId = levelsOf(plan)[0].id): number { const rooms = plan.rooms.filter(r => levelOf(plan, r).id === levelId && pointInPolygon(p, r.poly)); return rooms.length ? Math.max(...rooms.map(r => roomCeiling(plan, r))) : levelCeiling(plan, levelId) }

export function columnFootprint(c: Column): Vec2[] {
  const theta = (c.rotation ?? 0) * Math.PI / 180, co = Math.cos(theta), si = Math.sin(theta)
  const local: Vec2[] = c.shape === 'round'
    ? Array.from({ length: 64 }, (_, i) => [Math.cos(i * Math.PI / 32) * c.size[0] / 2, Math.sin(i * Math.PI / 32) * c.size[0] / 2])
    : [[-c.size[0] / 2, -c.size[1] / 2], [c.size[0] / 2, -c.size[1] / 2], [c.size[0] / 2, c.size[1] / 2], [-c.size[0] / 2, c.size[1] / 2]]
  return local.map(([x, y]) => add(c.center, [x * co - y * si, x * si + y * co]))
}
export interface ExtraElementRef { type: ExtraElementType; id: string }
export function hitTestExtra(plan: Plan, p: Vec2, tol = 0, levelId?: string): ExtraElementRef | null {
  for (const type of ['column', 'shaft', 'stair', 'void'] as const) {
    const items = type === 'column' ? plan.columns : type === 'shaft' ? plan.shafts : type === 'stair' ? plan.stairs : plan.voids
    for (const e of [...(items ?? [])].reverse()) {
      if (levelId && levelOf(plan, e).id !== levelId) continue
      const poly = 'center' in e ? columnFootprint(e) : e.poly
      if (pointInPolygon(p, poly) || poly.some((a, i) => {
        const d = sub(poly[(i + 1) % poly.length], a), t = clamp(dot(sub(p, a), d) / (dot(d, d) || 1), 0, 1)
        return distance(p, add(a, mul(d, t))) <= tol
      })) return { type, id: e.id }
    }
  }
  return null
}
