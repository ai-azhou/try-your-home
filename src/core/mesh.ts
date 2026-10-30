import earcut from 'earcut'
import { openingSymbol, openingStrip } from './opening-symbol.ts'
import { applyChanges, validateReplay } from './changes.ts'
import { buildSolids, buildFixtures, type Solid, type SolidKind } from './solids.ts'
import { assertLevel, levelOf, onLevel, levelsOf } from './levels.ts'
import { openingFootprint } from './geometry.ts'
import type { Plan, Vec2 } from './types.ts'

export type ModelState = 'original' | 'renovated'
/** furniture / cabinet: decor-layer boxes, drawn only by the raster renderer (buildMesh and GLB export stay structural). */
export type MeshKind = SolidKind | 'leaf' | 'pane' | 'rail' | 'plinth' | 'ceiling' | 'furniture' | 'cabinet'
export type V3 = [number, number, number]
export interface MeshPart { kind: MeshKind; ids: string[]; level?: string; positions: number[]; normals: number[] }
export interface MeshGroup { kind: MeshKind; parts: MeshPart[] }
export interface MeshOptions { state?: ModelState; cutHeight?: number; level?: string }
/** White-model palette = the tool's clay3 set in three/materials.ts (sRGB). Glass is a pale cool white, drawn see-through.
 * Decor follows the tool's decor-mode clay look: furniture in the platform tone, cabinets and panels in the wall tone. */
export const CLAY_COLORS: Record<MeshKind, string> = {
  wall: '#f4f4f3', sill: '#f4f4f3', lintel: '#f4f4f3', glass: '#eef3f7', beam: '#f1f1f0',
  floor: '#e8e8e6', platform: '#f0f0ee', slab: '#f4f4f3', stair: '#f0f0ee',
  column: '#f4f4f3', shaft: '#f4f4f3', leaf: '#f6f6f5', pane: '#eef3f7', rail: '#ececea', plinth: '#f2f2f1', ceiling: '#f4f4f3',
  furniture: '#f0f0ee', cabinet: '#f4f4f3',
}
/** Kinds drawn as light see-through glass (GLB alpha blend, raster one-layer see-through). */
export const GLASS_KINDS: ReadonlySet<MeshKind> = new Set(['glass', 'pane'])
export const GLASS_OPACITY = .3
export function modelPlan(plan: Plan, state: ModelState = 'original'): Plan {
  if (state !== 'original' && state !== 'renovated') throw new Error('state 必须为 original 或 renovated')
  if (state === 'original') return plan
  // Match the tool: pending proposals are not silently treated as approved work.
  const changes = plan.changes.filter(c => c.status === 'confirmed')
  const replay: ReturnType<typeof applyChanges> = plan.legacy?.__structureReplayFrame ? { plan, results: changes.map(c => ({ id: c.id, ok: true, affected: [c.target ?? String(c.data?.id ?? '')], removed: [] })) } : applyChanges(plan, changes)
  const failed = replay.results.filter(r => !r.ok)
  if (failed.length) throw new Error(`改造重放失败：${failed.map(r => `${r.id}: ${r.error}`).join('; ')}`)
  const errors = validateReplay(replay, changes, plan.legacy?.__structureReplayFrame ? undefined : plan).filter(i => i.level === 'error')
  if (errors.length) throw new Error(`改造最终校验失败：${errors.map(i => `${i.code}: ${i.message}`).join('; ')}`)
  return replay.plan
}
const ringArea = (r: Vec2[]) => r.reduce((s, a, i) => { const b = r[(i + 1) % r.length]; return s + a[0] * b[1] - b[0] * a[1] }, 0)
/** Extrude rings with earcut caps and explicit hole-facing side walls. Heights already use metres. */
export function solidMesh(solid: Omit<Solid, 'kind'> & { kind: MeshKind }): MeshPart {
  const positions: number[] = [], normals: number[] = []
  const triangle = (a: V3, b: V3, c: V3) => {
    const u = b.map((x, i) => x - a[i]), v = c.map((x, i) => x - a[i])
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n)
    if (l < 1e-12) return
    positions.push(...a, ...b, ...c)
    for (let i = 0; i < 3; i++) normals.push(...n.map(x => x / l))
  }
  if (solid.z1 <= solid.z0) return { ...solid, positions, normals }
  for (const poly of solid.polygons) {
    const rings = poly.map((ring, i) => {
      let r = ring.filter((p, j) => j === 0 || p[0] !== ring[j - 1][0] || p[1] !== ring[j - 1][1])
      if (r.length > 1 && r[0][0] === r.at(-1)![0] && r[0][1] === r.at(-1)![1]) r = r.slice(0, -1)
      return (ringArea(r) > 0) === (i === 0) ? r : [...r].reverse()
    }).filter(r => r.length >= 3)
    if (!rings.length) continue
    const points = rings.flat(), holes: number[] = []; let offset = rings[0].length
    for (const r of rings.slice(1)) { holes.push(offset); offset += r.length }
    const indices = earcut(points.flat(), holes, 2)
    const p = (v: Vec2, h: number): V3 => [v[0] / 1000, h, v[1] / 1000]
    for (let i = 0; i < indices.length; i += 3) {
      const a = points[indices[i]], b = points[indices[i + 1]], c = points[indices[i + 2]]
      const ccw = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0
      const B = ccw ? c : b, C = ccw ? b : c
      triangle(p(a, solid.z1), p(B, solid.z1), p(C, solid.z1))
      triangle(p(a, solid.z0), p(C, solid.z0), p(B, solid.z0))
    }
    for (const ring of rings) ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length]
      triangle(p(a, solid.z0), p(a, solid.z1), p(b, solid.z1))
      triangle(p(a, solid.z0), p(b, solid.z1), p(b, solid.z0))
    })
  }
  return { kind: solid.kind, ids: [...solid.ids], level: solid.level, positions, normals }
}
export function buildMesh(plan: Plan, options: MeshOptions = {}): MeshGroup[] {
  const full = modelPlan(plan, options.state)
  assertLevel(full, options.level)
  const selected = options.level ? onLevel(full, options.level) : full, parts: MeshPart[] = []
  const add = (s: Omit<Solid, 'kind'> & { kind: MeshKind }) => {
    if (options.cutHeight !== undefined) {
      const elevation = levelOf(selected, { level: s.level }).elevation
      s = { ...s, z1: Math.min(s.z1, elevation + options.cutHeight) }
    }
    const mesh = solidMesh(s); if (mesh.positions.length) parts.push(mesh)
  }
  buildSolids(selected).forEach(add)
  // Floor-level openings get a threshold inside the wall thickness; otherwise every doorway shows a slot to the outside.
  for (const o of selected.openings) {
    const wall = selected.walls.find(w => w.id === o.wall)
    if (!wall || o.sill > .001) continue
    const el = levelOf(selected, wall).elevation
    add({ kind: 'floor', ids: [o.id], level: levelOf(selected, wall).id, polygons: [[openingFootprint(selected, o)]], z0: el - .08, z1: el })
  }
  const box = (kind: MeshKind, id: string, level: string | undefined, center: Vec2, dir: Vec2, width: number, depth: number, z0: number, z1: number) => {
    const poly: Vec2[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => [center[0] + dir[0] * x * width / 2 - dir[1] * y * depth / 2, center[1] + dir[1] * x * width / 2 + dir[0] * y * depth / 2])
    add({ kind, ids: [id], level, polygons: [[poly]], z0, z1 })
  }
  for (const f of buildFixtures(selected, { doorAngle: 68 })) {
    if (f.footprint && f.kind !== 'railing') add({ kind: f.kind === 'door' ? 'leaf' : 'pane', ids: [f.id], level: f.level, polygons: [[f.footprint]], z0: f.z0, z1: f.kind === 'door' ? f.z0 + f.height : f.z1 })
    else if (f.kind === 'door') box('leaf', f.id, f.level, f.position, f.dir, Math.max(1, f.width - 20), f.thickness, f.z0 + .01, f.z0 + f.height - .01)
    else if (f.kind === 'pane') box('pane', f.id, f.level, f.center, f.dir, Math.max(10, f.width - 30), f.thickness, f.z0, f.z1)
    else {
      const length = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1]), d: Vec2 = [(f.b[0] - f.a[0]) / (length || 1), (f.b[1] - f.a[1]) / (length || 1)], c: Vec2 = [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2]
      box('rail', f.id, f.level, c, d, length, 50, f.z1 - .05, f.z1)
      box('pane', f.id, f.level, c, d, Math.max(1, length - 40), 16, f.z0 + .05, f.z1 - .05)
    }
  }
  // Curved frames follow the opening, with verticals only at jambs and authored leaf boundaries.
  for (const o of selected.openings) {
    const w = selected.walls.find(w => w.id === o.wall)
    if (!w?.bulge || o.kind === 'doorway' || o.kind === 'open-balcony') continue
    const symbol = openingSymbol(selected, o.id), level = levelOf(selected, w), z0 = level.elevation + o.sill, z1 = level.elevation + o.head
    for (const [a, b] of [...symbol.jambs, ...symbol.divisions]) {
      const center: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], n = Math.hypot(b[0] - a[0], b[1] - a[1])
      box('leaf', o.id, level.id, center, [-(b[1] - a[1]) / n, (b[0] - a[0]) / n], 30, 40, z0, z1)
    }
    const polygons = [[openingStrip(w, o.offset, o.offset + o.width, 40)]]
    add({ kind: 'leaf', ids: [o.id], level: level.id, polygons, z0: z1 - .03, z1 })
    if (o.kind !== 'door') add({ kind: 'leaf', ids: [o.id], level: level.id, polygons, z0, z1: z0 + .03 })
  }
  const groups = new Map<MeshKind, MeshPart[]>()
  for (const p of parts) { if (!groups.has(p.kind)) groups.set(p.kind, []); groups.get(p.kind)!.push(p) }
  return [...groups].map(([kind, parts]) => ({ kind, parts }))
}
