import { hostTransform } from './resolve.ts'
import { faceAxis } from './faces.ts'
import { panelSpan } from './panels.ts'
import { layoutCabinet, cabinetTransform } from './cabinets.ts'
import type { Plan, Vec2 } from '../types.ts'
import type { Furniture } from './types.ts'
import { add, clamp, distance, dot, mul, polygonArea, sub, wallLength } from '../geometry.ts'
import { joinedWallFootprint } from '../walls.ts'
import { levelOf } from '../levels.ts'
import { bounds, intersection, overlap } from './math.ts'

export interface FurnitureEntry { type: string; name: string; category: string; size: [number, number]; height: number; symbol: string }
export const FURNITURE_LIBRARY: FurnitureEntry[] = [
  ['sofa-3', '三人沙发', '客厅', 2400, 900, .85], ['sofa-2', '双人沙发', '客厅', 1800, 900, .85], ['armchair', '单椅', '客厅', 800, 800, .85], ['coffee-table', '茶几', '客厅', 1200, 600, .4],
  ['bed-1800', '双人床', '卧室', 1800, 2000, .5], ['bed-1500', '双人床', '卧室', 1500, 2000, .5], ['bed-1200', '单人床', '卧室', 1200, 2000, .5], ['nightstand', '床头柜', '卧室', 500, 400, .5],
  ['dining-table', '餐桌', '餐厨', 1600, 800, .75], ['chair', '餐椅', '餐厨', 450, 500, .85], ['desk', '书桌', '书房', 1200, 600, .75], ['bookshelf', '书架', '书房', 800, 300, 2],
  ['fridge', '冰箱', '家电', 900, 700, 1.9], ['washer', '洗衣机', '家电', 600, 650, .85], ['dryer', '烘干机', '家电', 600, 650, .85], ['oven', '烤箱', '家电', 600, 550, .6], ['steamer', '蒸箱', '家电', 600, 550, .45], ['dishwasher', '洗碗机', '家电', 600, 600, .8], ['microwave', '微波炉', '家电', 500, 400, .3], ['tv', '电视', '家电', 1450, 80, .83],
  ['rug', '地毯', '软装', 2400, 1600, .01], ['toilet', '坐便器', '卫浴', 400, 700, .75], ['basin', '洗手台', '卫浴', 800, 500, .85], ['bathtub', '浴缸', '卫浴', 1700, 750, .6], ['wardrobe', '衣柜', '收纳', 1800, 600, 2.4],
].map(([type, name, category, w, d, height]) => ({ type: String(type), name: String(name), category: String(category), size: [Number(w), Number(d)], height: Number(height), symbol: String(type) }))
export function furnitureFootprint(f: Furniture, plan?: Plan): Vec2[] {
  if (plan) return furniturePose(plan, f).footprint
  if (!f.at) throw new Error('宿主家具占地需要传入 plan')
  return footprint(f.at, f.rot ?? 0, f.size)
}
function footprint(at: Vec2, rot: number, size: [number, number]): Vec2[] {
  const a = rot * Math.PI / 180, co = Math.cos(a), si = Math.sin(a), [w, d] = size
  return ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as Vec2[]).map(([x, y]) => add(at, [x * co - y * si, x * si + y * co]))
}
export function furnitureLevel(plan: Plan, f: Furniture) { return levelOf(plan, { level: f.in ? furniturePose(plan, f).level : plan.walls.find(w => w.id === f.against?.face.wall)?.level ?? f.level }) }
function obstacles(plan: Plan, f: Furniture) {
  const level = furnitureLevel(plan, f).id
  return [
    ...plan.walls.filter(w => levelOf(plan, w).id === level).map(w => {
      const holes = plan.openings.filter(o => o.wall === w.id && o.sill <= furniturePose(plan, f).z && o.head >= furniturePose(plan, f).z + f.height)
      const spans: [number, number][] = [], end = wallLength(w); let start = 0
      for (const o of holes.sort((a, b) => a.offset - b.offset)) { if (o.offset > start) spans.push([start, o.offset]); start = Math.max(start, o.offset + o.width) }
      if (start < end) spans.push([start, end])
      return { id: w.id, type: 'wall' as const, polygons: holes.length ? spans.flatMap(([a, b]) => joinedWallFootprint(plan, w, a, b)) : joinedWallFootprint(plan, w) }
    }).filter(o => o.polygons.length),
    ...(plan.decor?.furniture ?? []).filter(v => v.id !== f.id && furnitureLevel(plan, v).id === level && overlap([furniturePose(plan, v).z, (furniturePose(plan, v).z) + v.height], [furniturePose(plan, f).z, furniturePose(plan, f).z + f.height])).map(v => ({ id: v.id, type: 'furniture' as const, polygons: [[furnitureFootprint(v, plan)]] })),
  ]
}
export function furnitureCollisions(plan: Plan, f: Furniture) {
  const p = furnitureFootprint(f, plan)
  return obstacles(plan, f).filter(o => intersection([[p]], o.polygons).some(r => polygonArea(r[0]) > 1e-6)).map(({ id, type }) => ({ id, type }))
}
function nearest(a: Vec2[], b: Vec2[]): [Vec2, Vec2] {
  const pairs: [Vec2, Vec2][] = []
  const project = (p: Vec2, x: Vec2, y: Vec2) => { const d = sub(y, x); return add(x, mul(d, clamp(dot(sub(p, x), d) / (dot(d, d) || 1), 0, 1))) }
  a.forEach(p => b.forEach((q, i) => pairs.push([p, project(p, q, b[(i + 1) % b.length])]))); b.forEach(p => a.forEach((q, i) => pairs.push([project(p, q, a[(i + 1) % a.length]), p])))
  return pairs.sort((x, y) => distance(...x) - distance(...y))[0]
}
export interface FurnitureClearance { id: string; type: 'wall' | 'furniture'; intersect: boolean; dx?: number; dy?: number; nearest?: number; a?: Vec2; b?: Vec2 }
/** Same finite-footprint convention as measureWalls; no passability judgement. */
export function furnitureClearances(plan: Plan, f: Furniture) {
  const p = furnitureFootprint(f, plan), A = bounds(p), collisions = new Set(furnitureCollisions(plan, f).map(c => c.id))
  const distances: FurnitureClearance[] = obstacles(plan, f).map(o => {
    if (collisions.has(o.id)) return { id: o.id, type: o.type, intersect: true }
    const pairs = o.polygons.map(r => nearest(p, r[0])), pair = pairs.sort((a, b) => distance(...a) - distance(...b))[0], B = bounds(o.polygons.flatMap(r => r[0]))
    const axisAligned = (poly: Vec2[]) => poly.every((v, i) => { const next = poly[(i + 1) % poly.length]; return Math.abs(v[0] - next[0]) < 1e-7 || Math.abs(v[1] - next[1]) < 1e-7 })
    const aligned = axisAligned(p) && o.polygons.every(r => axisAligned(r[0]))
    const dx = aligned ? Math.max(0, B[0] - A[2], A[0] - B[2]) : Math.abs(pair[1][0] - pair[0][0]), dy = aligned ? Math.max(0, B[1] - A[3], A[1] - B[3]) : Math.abs(pair[1][1] - pair[0][1])
    return { id: o.id, type: o.type, intersect: distance(...pair) < 1e-7, ...(dx ? { dx } : {}), ...(dy ? { dy } : {}), nearest: distance(...pair), a: pair[0], b: pair[1] }
  })
  const closest = (type: FurnitureClearance['type']) => distances.filter(d => d.type === type).sort((a, b) => (a.nearest ?? 0) - (b.nearest ?? 0))[0]
  const min = (values: number[]) => values.length ? Math.min(...values) : undefined
  const directions: Partial<Record<'left' | 'right' | 'up' | 'down', { distance: number; id: string; type: 'wall' | 'furniture' }>> = {}
  for (const o of obstacles(plan, f)) for (const polygon of o.polygons) for (const [name, axis, sign] of [['left', 0, -1], ['right', 0, 1], ['up', 1, -1], ['down', 1, 1]] as const) {
    const gap = directionalGap(p, polygon[0], axis, sign)
    if (gap !== undefined && (directions[name] === undefined || gap < directions[name]!.distance)) directions[name] = { distance: gap, id: o.id, type: o.type }
  }
  return { distances, directions, wall: closest('wall'), furniture: closest('furniture'), dx: min(distances.flatMap(d => d.dx === undefined ? [] : [d.dx])), dy: min(distances.flatMap(d => d.dy === undefined ? [] : [d.dy])) }
}
export const measureFurniture = furnitureClearances

/** First directional separation using intersecting scan lines, rather than diagonal bounding-box gaps. */
function directionalGap(a: Vec2[], b: Vec2[], axis: 0 | 1, sign: 1 | -1): number | undefined {
  const other = 1 - axis, low = Math.max(...[a, b].map(p => Math.min(...p.map(v => v[other])))), high = Math.min(...[a, b].map(p => Math.max(...p.map(v => v[other]))))
  if (high <= low) return undefined
  const levels = [...new Set([low, high, ...a.map(v => v[other]), ...b.map(v => v[other])].filter(v => v >= low && v <= high))].sort((a, b) => a - b), samples = [...levels, ...levels.slice(1).map((v, i) => (v + levels[i]) / 2)]
  const xs = (poly: Vec2[], y: number) => poly.flatMap((p, i) => { const q = poly[(i + 1) % poly.length]; if (p[other] === q[other]) return Math.abs(y - p[other]) < 1e-7 ? [p[axis], q[axis]] : []; if (y < Math.min(p[other], q[other]) || y > Math.max(p[other], q[other])) return []; return [p[axis] + (y - p[other]) * (q[axis] - p[axis]) / (q[other] - p[other])] })
  const gaps = samples.flatMap(y => { const A = xs(a, y), B = xs(b, y); if (!A.length || !B.length) return []; const gap = sign === 1 ? Math.min(...B) - Math.max(...A) : Math.min(...A) - Math.max(...B); return gap >= -1e-7 ? [Math.max(0, gap)] : [] })
  return gaps.length ? Math.min(...gaps) : undefined
}

export interface FurniturePose { at: Vec2; center: Vec2; rot: number; z: number; footprint: Vec2[]; level: string; missing: boolean }
/** World XY in mm; z floor-relative metres; hosted rot is a local offset. */
export function furniturePose(plan: Plan, f: Furniture): FurniturePose {
  let center: Vec2 = f.at ?? [0, 0], rotation = f.rot ?? 0, height = f.z ?? 0, level = levelOf(plan, plan.walls.find(w => w.id === f.against?.face.wall) ?? f).id, missing = false
  if (f.in) try {
    const decor = plan.decor
    if (!decor) throw new Error('missing decor')
    const cellRef = /^(.*):cell:(\d+):(\d+)$/.exec(f.in)
    if (cellRef) {
      const cab = decor.cabinets.find(c => c.id === cellRef[1])
      if (!cab) throw new Error('missing cabinet')
      const cell = layoutCabinet(cab).cells.find(c => c.column === +cellRef[2] && c.row === +cellRef[3])
      if (!cell) throw new Error('missing cell')
      const at = cabinetTransform(plan, cab), n = sub(at(0, 1), at(0, 0))
      center = at((cell.u[0] + cell.u[1]) / 2, cab.depth - f.size[1] / 2)
      rotation = Math.atan2(n[1], n[0]) * 180 / Math.PI - 90 + (f.rot ?? 0)
      height = f.z ?? cell.z[0]
      level = levelOf(plan, 'face' in cab.place ? faceAxis(plan, cab.place.face).wall : cab).id
    } else {
      const at = hostTransform(plan, decor, f.in)
      if (!at) throw new Error('missing host')
      const host = [...decor.recesses, ...decor.panels, ...decor.cabinets].find(h => h.id === f.in)!
      let width: number, front: number, z: [number, number], hostLevel: string | undefined
      if ('host' in host) {
        width = host.rect.u ? host.rect.u[1] - host.rect.u[0] : host.rect.s![1] - host.rect.s![0]; z = host.rect.z
        const parent = 'panel' in host.host ? decor.panels.find(p => p.id === (host.host as { panel: string }).panel) : 'cabinet' in host.host ? decor.cabinets.find(c => c.id === (host.host as { cabinet: string }).cabinet) : undefined
        front = parent ? 'thickness' in parent ? (parent.type === 'slats' ? parent.slats?.depth ?? parent.thickness : parent.thickness) : parent.depth : 0
        hostLevel = 'face' in host.host ? faceAxis(plan, host.host.face).wall.level : parent && 'thickness' in parent ? faceAxis(plan, panelSpan(plan, parent).face).wall.level : parent && 'place' in parent && 'face' in parent.place ? faceAxis(plan, parent.place.face).wall.level : parent?.level
      } else if ('thickness' in host) { const span = panelSpan(plan, host); width = span.s[1] - span.s[0]; front = host.type === 'slats' ? host.slats?.depth ?? host.thickness : host.thickness; z = span.z; hostLevel = faceAxis(plan, span.face).wall.level }
      else { width = host.width; front = host.depth; z = host.z; hostLevel = 'face' in host.place ? faceAxis(plan, host.place.face).wall.level : host.level }
      // `in` has no stored local offset in v0: center horizontally, front flush with the host.
      // Storage has no at; last valid world pose belongs to decor.cache.
      center = at(width / 2, front - f.size[1] / 2)
      const normal = sub(at(0, 1), at(0, 0)); rotation = Math.atan2(normal[1], normal[0]) * 180 / Math.PI - 90 + (f.rot ?? 0)
      height = f.z ?? z[0]
      level = levelOf(plan, { level: hostLevel }).id

    }
  } catch {
    missing = true
    const cache = plan.decor?.cache?.[f.id]
    if (cache) {
      center = cache.pose?.at ?? [(cache.box[0] + cache.box[2]) / 2, (cache.box[1] + cache.box[3]) / 2]
      rotation = cache.pose?.rot ?? rotation; height = cache.pose?.z ?? height; level = cache.level ?? level
    }
  }
  return { at: center, center, rot: rotation, z: height, level, missing, footprint: footprint(center, rotation, f.size) }
}
