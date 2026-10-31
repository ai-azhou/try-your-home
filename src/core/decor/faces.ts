import type { Plan, Vec2, Wall } from '../types.ts'
import type { DecorIssue, FaceRef, FaceSpan } from './types.ts'
import { add, arcParams, dot, effectiveWallHeight, mul, pointAt, pointInPolygon, sub, wallDir, wallLength, wallNormal, wallTangent } from '../geometry.ts'
import { joinedWallFootprint } from '../walls.ts'
import { levelOf } from '../levels.ts'
import { ordered } from './math.ts'

export class DecorGeometryError extends Error {
  code: DecorIssue['code']
  constructor(code: DecorIssue['code'], message: string) { super(message); this.code = code; this.name = 'DecorGeometryError' }
}
export function faceWall(plan: Plan, face: FaceRef): Wall {
  const wall = plan.walls.find(w => w.id === face.wall)
  if (!wall) throw new DecorGeometryError('host-missing', `墙 ${face.wall} 不存在，没地方挂了`)
  if (face.side !== 1 && face.side !== -1) throw new DecorGeometryError('invalid', '墙面 side 必须为 1 或 -1')
  return wall
}
/** s is always from a; u always runs left to right as viewed from the room. */
export function faceAxis(plan: Plan, face: FaceRef) {
  const wall = faceWall(plan, face), length = wallLength(wall), arc = arcParams(wall)
  const scale = arc ? (arc.radius + Math.sign(wall.bulge!) * face.side * wall.thickness / 2) / arc.radius : 1
  const normalAt = (s: number): Vec2 => { const d = wallTangent(wall, s); return mul([-d[1], d[0]], face.side) }
  const at = (s: number, depth = 0): Vec2 => add(arc ? pointAt(wall, s) : add(wall.a, mul(wallDir(wall), s)), mul(normalAt(s), wall.thickness / 2 + depth))
  const toU = (s: number) => (face.side === 1 ? s : length - s) * scale
  const toS = (u: number) => face.side === 1 ? u / scale : length - u / scale
  return { wall, face, length, faceLength: length * scale, scale, origin: at(face.side === 1 ? 0 : length), dir: mul(wallDir(wall), face.side), normal: normalAt(length / 2), at, normalAt, toU, toS }
}
export interface FaceRunPart { face: FaceRef; wall: Wall; s: [number, number]; reversed: boolean }
/** Connected coplanar chain, expressed in the anchor wall's unbounded s coordinates. */
export function faceRun(plan: Plan, face: FaceRef): FaceRunPart[] {
  const axis = faceAxis(plan, face), w = axis.wall, d = wallDir(w), n = wallNormal(w)
  if (w.bulge) return [{ face, wall: w, s: [0, axis.length], reversed: false }]
  const candidates = plan.walls.filter(v => !v.bulge && levelOf(plan, v).id === levelOf(plan, w).id && Math.abs(dot(wallDir(v), n)) < 1e-7 && Math.abs(dot(sub(v.a, w.a), n)) < 1e-5)
    .map(v => {
      const reversed = dot(wallDir(v), d) < 0, side = (reversed ? -face.side : face.side) as 1 | -1
      return { face: { wall: v.id, side }, wall: v, s: ordered(dot(sub(v.a, w.a), d), dot(sub(v.b, w.a), d)), reversed }
    }).filter(v => Math.abs(dot(sub(faceAxis(plan, v.face).at(0), axis.at(0)), n)) < 1e-5)
  const chain = candidates.filter(v => v.wall.id === w.id)
  let changed = true
  while (changed) {
    changed = false
    for (const v of candidates) if (!chain.includes(v) && chain.some(c => Math.abs(c.s[1] - v.s[0]) <= 1 || Math.abs(v.s[1] - c.s[0]) <= 1)) { chain.push(v); changed = true }
  }
  return chain.sort((a, b) => a.s[0] - b.s[0] || a.wall.id.localeCompare(b.wall.id))
}
/** Visible intervals: intersect a ray just outside the wall face with joined neighboring wall footprints. */
export function faceIntervals(plan: Plan, face: FaceRef): [number, number][] {
  const axis = faceAxis(plan, face), w = axis.wall
  if (w.bulge) return [[0, axis.length]]
  const d = wallDir(w), origin = axis.at(0, .001), cuts: [number, number][] = []
  const neighbors = plan.walls.filter(v => v.id !== w.id && levelOf(plan, v).id === levelOf(plan, w).id)
  for (const v of neighbors) for (const rings of joinedWallFootprint(plan, v)) {
    const ts = [0, axis.length]
    for (const ring of rings) ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length], e = sub(b, a), det = d[0] * e[1] - d[1] * e[0]
      if (Math.abs(det) < 1e-9) return
      const q = sub(a, origin), t = (q[0] * e[1] - q[1] * e[0]) / det, u = (q[0] * d[1] - q[1] * d[0]) / det
      if (u >= 0 && u <= 1 && t > 0 && t < axis.length) ts.push(t)
    })
    ts.sort((a, b) => a - b)
    for (let i = 1; i < ts.length; i++) {
      const p = add(origin, mul(d, (ts[i - 1] + ts[i]) / 2))
      if (pointInPolygon(p, rings[0]) && !rings.slice(1).some(r => pointInPolygon(p, r))) cuts.push([ts[i - 1], ts[i]])
    }
  }
  let result: [number, number][] = [[0, axis.length]]
  for (const [a, b] of cuts) result = result.flatMap(([s, e]) => b <= s || a >= e ? [[s, e]] : [[s, Math.max(s, a)], [Math.min(e, b), e]].filter(([x, y]) => y - x > 1e-6) as [number, number][])
  return result
}
export function faceExtent(plan: Plan, face: FaceRef): [number, number] {
  const spans = faceIntervals(plan, face)
  return spans.length ? [spans[0][0], spans[spans.length - 1][1]] : [0, 0]
}
export function faceFrame(plan: Plan, ref: FaceRef | FaceSpan) {
  const face = 'face' in ref ? ref.face : ref, axis = faceAxis(plan, face)
  if (axis.wall.bulge && 'face' in ref) throw new DecorGeometryError('arc-unsupported', '弧墙暂只支持整面材质，造型和嵌入暂不支持')
  const s = 's' in ref ? ref.s : faceExtent(plan, face), z: [number, number] = 'z' in ref ? ref.z : [0, effectiveWallHeight(plan, axis.wall)]
  const run = faceRun(plan, face)
  if (s[0] < run[0].s[0] - 1e-5 || s[1] > run[run.length - 1].s[1] + 1e-5) throw new DecorGeometryError('host-cut', `超出连续墙面：写的是 ${Math.round(s[0])}–${Math.round(s[1])} mm，这面墙连续的范围是 ${Math.round(run[0].s[0])}–${Math.round(run[run.length - 1].s[1])} mm`)
  return { ...axis, s, z, u: ordered(axis.toU(s[0]), axis.toU(s[1])), a: axis.at(s[0]), b: axis.at(s[1]), segment: [axis.at(s[0]), axis.at(s[1])] as [Vec2, Vec2], run }
}
/** Convert a member wall's s coordinate to the anchor wall's s coordinate. */
export function runS(part: FaceRunPart, s: number) { return part.reversed ? part.s[1] - s : part.s[0] + s }
