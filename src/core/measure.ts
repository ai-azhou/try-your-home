import type { Plan, Vec2, Wall } from './types.ts'
import clipping from 'polygon-clipping'
import { add, clamp, distance, dot, mul, pointInPolygon, polygonArea, sub, wallDir, wallFootprint, wallPath } from './geometry.ts'

export interface MeasureSegment {
  kind: 'dx' | 'dy' | 'normal' | 'nearest'
  a: Vec2
  b: Vec2
  /** Dashed extension lines; a is on the measured face, b is on the dimension line. */
  extensions: { a: Vec2; b: Vec2 }[]
}
export interface WallMeasurement {
  dx?: number
  dy?: number
  normal?: number
  nearest?: number
  intersect: boolean
  centerline?: { dx?: number; dy?: number; normal?: number; nearest?: number }
  segments: MeasureSegment[]
}
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0]
const project = (p: Vec2, a: Vec2, b: Vec2) => {
  const d = sub(b, a)
  return add(a, mul(d, clamp(dot(sub(p, a), d) / (dot(d, d) || 1), 0, 1)))
}
function closestSegments(a: Vec2, b: Vec2, c: Vec2, d: Vec2): [Vec2, Vec2] {
  const u = sub(b, a), v = sub(d, c), det = cross(u, v)
  if (Math.abs(det) > 1e-10) {
    const t = cross(sub(c, a), v) / det, s = cross(sub(c, a), u) / det
    if (t >= 0 && t <= 1 && s >= 0 && s <= 1) { const p = add(a, mul(u, t)); return [p, p] }
  }
  return ([[a, project(a, c, d)], [b, project(b, c, d)], [project(c, a, b), c], [project(d, a, b), d]] as [Vec2, Vec2][])
    .sort((x, y) => distance(...x) - distance(...y))[0]
}
function closestPaths(a: Vec2[], b: Vec2[], closed: boolean): [Vec2, Vec2] {
  let best: [Vec2, Vec2] = [a[0], b[0]], bestDistance = Infinity
  for (let i = 0; i < a.length - (closed ? 0 : 1); i++) for (let j = 0; j < b.length - (closed ? 0 : 1); j++) {
    const pair = closestSegments(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]), d = distance(...pair)
    if (d < bestDistance) { best = pair; bestDistance = d }
  }
  return best
}
const bounds = (poly: Vec2[]) => [Math.min(...poly.map(p => p[0])), Math.min(...poly.map(p => p[1])), Math.max(...poly.map(p => p[0])), Math.max(...poly.map(p => p[1]))]
const axisAligned = (w: Wall) => !w.bulge && (Math.abs(w.a[0] - w.b[0]) < 1e-7 || Math.abs(w.a[1] - w.b[1]) < 1e-7)
/** Axis-separated dimension lines between two bounding boxes (same drawing as wall-to-wall). */
function axisSegments(A: number[], B: number[], result: WallMeasurement) {
  for (const axis of [0, 1] as const) {
    const other = 1 - axis, kind = axis === 0 ? 'dx' : 'dy'
    if (A[axis + 2] >= B[axis] && B[axis + 2] >= A[axis]) continue
    const forward = A[axis + 2] < B[axis], x = forward ? A[axis + 2] : A[axis], y = forward ? B[axis] : B[axis + 2]
    const low = Math.max(A[other], B[other]), high = Math.min(A[other + 2], B[other + 2]), line = (low + high) / 2
    const start: Vec2 = [0, 0], end: Vec2 = [0, 0]
    start[axis] = x; end[axis] = y; start[other] = end[other] = line
    const faceA: Vec2 = [...start], faceB: Vec2 = [...end]
    faceA[other] = clamp(line, A[other], A[other + 2]); faceB[other] = clamp(line, B[other], B[other + 2])
    result[kind] = Math.abs(y - x)
    result.segments.push({ kind, a: start, b: end, extensions: [{ a: faceA, b: start }, { a: faceB, b: end }].filter(e => distance(e.a, e.b) > 1e-7) })
  }
}
const isAxisRect = (poly: Vec2[]) => poly.every((v, i) => { const n = poly[(i + 1) % poly.length]; return Math.abs(v[0] - n[0]) < 1e-7 || Math.abs(v[1] - n[1]) < 1e-7 })
/**
 * Clearance between two plan footprints (furniture, cabinets, wall outlines), for ⌥ hover measuring.
 * Touching is a real 0, only overlapping counts as intersecting; heights are ignored because this is a plan-view distance.
 */
export function measureFootprints(a: Vec2[], others: Vec2[][]): WallMeasurement {
  const ranked = others.filter(p => p.length >= 3).map(b => ({ b, pair: closestPaths(a, b, true) })).sort((x, y) => distance(...x.pair) - distance(...y.pair))
  if (!ranked.length) return { intersect: false, segments: [] }
  const { b, pair } = ranked[0], gap = distance(...pair)
  if (others.some(q => q.length >= 3 && (clipping.intersection([[a]], [[q]]) as Vec2[][][]).some(r => polygonArea(r[0]) > 1))) return { intersect: true, segments: [] }
  if (gap < 1e-6) return { intersect: false, nearest: 0, segments: [{ kind: 'nearest', a: pair[0], b: pair[1], extensions: [] }] }
  const result: WallMeasurement = { intersect: false, segments: [] }
  if (isAxisRect(a) && isAxisRect(b)) { axisSegments(bounds(a), bounds(b), result); if (result.segments.length) return result }
  result.nearest = gap; result.dx = Math.abs(pair[1][0] - pair[0][0]); result.dy = Math.abs(pair[1][1] - pair[0][1])
  result.segments.push({ kind: 'nearest', a: pair[0], b: pair[1], extensions: [] })
  return result
}
/** Finite footprint clearances in mm. Throws for an unknown id; never invents a zero distance. */
export function measureWalls(plan: Plan, idA: string, idB: string): WallMeasurement {
  const a = plan.walls.find(w => w.id === idA), b = plan.walls.find(w => w.id === idB)
  if (!a || !b) throw new Error('测距墙不存在')
  const pa = wallFootprint(a), pb = wallFootprint(b), pair = closestPaths(pa, pb, true)
  const intersect = distance(...pair) < 1e-6 || pointInPolygon(pa[0], pb) || pointInPolygon(pb[0], pa)
  if (intersect) return { intersect: true, segments: [] }
  const result: WallMeasurement = { intersect: false, segments: [], centerline: {} }
  if (axisAligned(a) && axisAligned(b)) {
    const A = bounds(pa), B = bounds(pb), CA = bounds([a.a, a.b]), CB = bounds([b.a, b.b])
    for (const axis of [0, 1] as const) {
      const other = 1 - axis, kind = axis === 0 ? 'dx' : 'dy'
      if (A[axis + 2] >= B[axis] && B[axis + 2] >= A[axis]) continue
      const forward = A[axis + 2] < B[axis], x = forward ? A[axis + 2] : A[axis], y = forward ? B[axis] : B[axis + 2]
      const low = Math.max(A[other], B[other]), high = Math.min(A[other + 2], B[other + 2]), line = (low + high) / 2
      const start: Vec2 = [0, 0], end: Vec2 = [0, 0]
      start[axis] = x; end[axis] = y; start[other] = end[other] = line
      const faceA: Vec2 = [...start], faceB: Vec2 = [...end]
      faceA[other] = clamp(line, A[other], A[other + 2]); faceB[other] = clamp(line, B[other], B[other + 2])
      result[kind] = Math.abs(y - x)
      result.centerline![kind] = Math.max(0, forward ? CB[axis] - CA[axis + 2] : CA[axis] - CB[axis + 2])
      result.segments.push({ kind, a: start, b: end, extensions: [{ a: faceA, b: start }, { a: faceB, b: end }].filter(e => distance(e.a, e.b) > 1e-7) })
    }
    return result
  }
  const d = wallDir(a), e = wallDir(b)
  if (!a.bulge && !b.bulge && Math.abs(cross(d, e)) < 1e-7) {
    const aRange = [dot(a.a, d), dot(a.b, d)].sort((a, b) => a - b), bRange = [dot(b.a, d), dot(b.b, d)].sort((a, b) => a - b)
    const low = Math.max(aRange[0], bRange[0]), high = Math.min(aRange[1], bRange[1])
    if (high >= low) {
      const t = (low + high) / 2, n: Vec2 = [-d[1], d[0]], signed = dot(sub(b.a, a.a), n), side = Math.sign(signed)
      const start = add(add(a.a, mul(d, t - dot(a.a, d))), mul(n, side * a.thickness / 2))
      const end = add(add(b.a, mul(d, t - dot(b.a, d))), mul(n, -side * b.thickness / 2))
      result.normal = distance(start, end); result.centerline!.normal = Math.abs(signed)
      result.segments.push({ kind: 'normal', a: start, b: end, extensions: [] })
      return result
    }
  }
  result.nearest = distance(...pair); result.dx = Math.abs(pair[1][0] - pair[0][0]); result.dy = Math.abs(pair[1][1] - pair[0][1])
  result.centerline!.nearest = distance(...closestPaths(wallPath(a), wallPath(b), false))
  result.segments.push({ kind: 'nearest', a: pair[0], b: pair[1], extensions: [] })
  return result
}
