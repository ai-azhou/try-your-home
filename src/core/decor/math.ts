import clipping from 'polygon-clipping'
import type { Box, Vec2 } from '../types.ts'
export type Interval = [number, number]
/** Elevation rectangle: horizontal mm, vertical m. */
export interface ElevationRect { u: Interval; z: Interval }
export const overlap = (a: Interval, b: Interval, eps = 1e-7) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > eps
export const ordered = (a: number, b: number): Interval => [Math.min(a, b), Math.max(a, b)]
export const rectPoly = (r: ElevationRect): Vec2[] => [[r.u[0], r.z[0]], [r.u[1], r.z[0]], [r.u[1], r.z[1]], [r.u[0], r.z[1]]]
export function bounds(points: readonly (Vec2 | undefined)[]): Box {
  const p = points.filter((x): x is Vec2 => x !== undefined)
  return p.length ? [Math.min(...p.map(x => x[0])), Math.min(...p.map(x => x[1])), Math.max(...p.map(x => x[0])), Math.max(...p.map(x => x[1]))] : [0, 0, 0, 0]
}
export const intersection = (a: Vec2[][][], b: Vec2[][][]): Vec2[][][] => a.length && b.length ? clipping.intersection(a, b) as Vec2[][][] : []
export const difference = (a: Vec2[][][], b: Vec2[][][]): Vec2[][][] => a.length && b.length ? clipping.difference(a, b) as Vec2[][][] : a
/** Split into disjoint rectangles; useful for partial door fronts and box subtraction. */
export function subtractRects(rect: ElevationRect, cuts: ElevationRect[]): ElevationRect[] {
  let pieces = [rect]
  for (const c of cuts) pieces = pieces.flatMap(r => {
    if (!overlap(r.u, c.u) || !overlap(r.z, c.z)) return [r]
    const u = [Math.max(r.u[0], c.u[0]), Math.min(r.u[1], c.u[1])], z = [Math.max(r.z[0], c.z[0]), Math.min(r.z[1], c.z[1])]
    return [{ u: [r.u[0], u[0]], z: r.z }, { u: [u[1], r.u[1]], z: r.z }, { u, z: [r.z[0], z[0]] }, { u, z: [z[1], r.z[1]] }].filter(p => p.u[1] - p.u[0] > 1e-7 && p.z[1] - p.z[0] > 1e-9) as ElevationRect[]
  })
  return pieces
}
