import clipping from 'polygon-clipping'
import type { Plan, Vec2, Wall } from './types.ts'
import { add, distance, mul, sliceWall, sub, wallFootprint, wallLength, wallTangent } from './geometry.ts'

import { levelOf, onLevel } from './levels.ts'

export const MITER_LIMIT = 4
const JOIN_TOLERANCE = 1
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0]
// Quantize only derived polygon coordinates: exact arc tangents can otherwise leave
// coincident endpoints a few floating-point ulps apart in polygon-clipping.
const union = (polys: Vec2[][][]): Vec2[][][] => {
  const rounded = polys.map(rings => rings.map(ring => ring.map(([x, y]): Vec2 => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6])))
  return rounded.length ? clipping.union(rounded[0], ...rounded.slice(1)) as Vec2[][][] : []
}
type End = 'a' | 'b'
type Ray = { wall: Wall; end: End; dir: Vec2; angle: number }

/** Outgoing tangent, including circular walls. */
function ray(wall: Wall, end: End): Ray {
  const dir = mul(wallTangent(wall, end === 'a' ? 0 : wallLength(wall)), end === 'a' ? 1 : -1)
  return { wall, end, dir, angle: Math.atan2(dir[1], dir[0]) }
}

/** Each exterior join is split along its bisector so filtering keeps each wall's own part. */
function endPatches(plan: Plan, w: Wall, end: End): Vec2[][] {
  const p = w[end]
  const rays = plan.walls.filter(o => levelOf(plan, o).id === levelOf(plan, w).id && wallLength(o) > 1e-7 && o.thickness > 0).flatMap(o =>
    (['a', 'b'] as const).filter(e => distance(o[e], p) <= JOIN_TOLERANCE).map(e => ray(o, e)))
    .sort((a, b) => a.angle - b.angle)
  if (rays.length < 2) return []
  const patches: Vec2[][] = []
  for (let i = 0; i < rays.length; i++) {
    const a = rays[i], b = rays[(i + 1) % rays.length]
    if (a.wall.id !== w.id && b.wall.id !== w.id) continue
    const gap = (b.angle - a.angle + Math.PI * 2) % (Math.PI * 2)
    // Interior sectors are already covered by the strips. Straight and T joins need no extension.
    if (gap <= Math.PI + 1e-7) continue
    const na: Vec2 = [-a.dir[1], a.dir[0]], nb: Vec2 = [-b.dir[1], b.dir[0]]
    const ca = add(p, mul(na, a.wall.thickness / 2)), cb = add(p, mul(nb, -b.wall.thickness / 2))
    const det = cross(a.dir, b.dir)
    let tip = mul(add(ca, cb), .5) // bevel fallback for a very sharp angle
    if (Math.abs(det) > 1e-8) {
      const intersection = add(ca, mul(a.dir, cross(sub(cb, ca), b.dir) / det))
      if (distance(p, intersection) <= MITER_LIMIT * Math.max(a.wall.thickness, b.wall.thickness) / 2) tip = intersection
    }
    if (a.wall.id === w.id && a.end === end) patches.push([p, ca, tip])
    if (b.wall.id === w.id && b.end === end) patches.push([p, tip, cb])
  }
  return patches
}

/** Full-width footprint for a wall interval. Only real endpoints receive joined corners. */
export function joinedWallFootprint(plan: Plan, w: Wall, from = 0, to = wallLength(w)): Vec2[][][] {
  if (to - from < 1e-7 || w.thickness <= 0) return []
  const polygons: Vec2[][][] = [[wallFootprint(sliceWall(w, from, to))]]
  if (from <= 1e-7) polygons.push(...endPatches(plan, w, 'a').map(p => [p]))
  if (to >= wallLength(w) - 1e-7) polygons.push(...endPatches(plan, w, 'b').map(p => [p]))
  return union(polygons)
}

/** Plan-view intervals omit all door/window spans, independent of sill and head height. */
export function solidIntervals(plan: Plan, w: Wall): [number, number][] {
  const len = wallLength(w)
  const out: [number, number][] = []
  let start = 0
  for (const o of plan.openings.filter(o => o.wall === w.id).sort((a, b) => a.offset - b.offset)) {
    const a = Math.max(0, Math.min(len, o.offset)), b = Math.max(0, Math.min(len, o.offset + o.width))
    if (a > start) out.push([start, a])
    start = Math.max(start, b)
  }
  if (start < len) out.push([start, len])
  return out
}

/** Joined, unioned plan-view outlines with opening spans removed; filter keeps full join context. */
export function wallOutlines(plan: Plan, filter: ((wall: Wall) => boolean) | string = () => true, levelId?: string): Vec2[][][] {
  if (typeof filter === 'string') { levelId = filter; filter = () => true }
  if (levelId) plan = onLevel(plan, levelId)
  return union(plan.walls.filter(filter).flatMap(w => solidIntervals(plan, w).flatMap(([a, b]) => joinedWallFootprint(plan, w, a, b))))
}

/** Full structural footprints (including opening spans), for area and enclosure calculations. */
export function wallFootprints(plan: Plan, filter: (wall: Wall) => boolean = () => true): Vec2[][][] {
  return union(plan.walls.filter(filter).flatMap(w => joinedWallFootprint(plan, w)))
}
