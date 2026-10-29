import clipping from 'polygon-clipping'
import { openingSymbol } from './opening-symbol.ts'
export { openingSymbol } from './opening-symbol.ts'
import { DEFAULTS } from './types.ts'
import type { OpeningKind, PaneKind, Plan, Vec2, Wall, WallKind } from './types.ts'
import { add, beamFootprint, ceilingAt, columnFootprint, distance, effectiveWallHeight, mul, openingSpan, pointAt, sub, wallDir, wallLength } from './geometry.ts'
import { hasLevelData, levelCeiling, levelOf, levelsOf, onLevel } from './levels.ts'
import { joinedWallFootprint, wallFootprints } from './walls.ts'
export { wallOutlines } from './walls.ts'
export type SolidKind = 'wall' | 'glass' | 'lintel' | 'sill' | 'beam' | 'floor' | 'platform' | 'slab' | 'stair' | 'column' | 'shaft'
export interface Solid { kind: SolidKind; polygons: Vec2[][][]; z0: number; z1: number; ids: string[]; wallKind?: WallKind; level?: string }
export function unionPolygons(polys: Vec2[][][]): Vec2[][][] { return polys.length ? clipping.union(polys[0], ...polys.slice(1)) as Vec2[][][] : [] }
function buildLevelSolids(plan: Plan, filter: (wall: Wall) => boolean = () => true): Solid[] {
  const pieces: Solid[] = [], result: Solid[] = []
  const push = (kind: SolidKind, poly: Vec2[], z0: number, z1: number, ids: string[], wallKind?: WallKind) => { if (z1 - z0 > 1e-8 && poly.length >= 3) pieces.push({ kind, polygons: [[poly]], z0, z1, ids, ...(wallKind ? { wallKind } : {}) }) }
  for (const w of plan.walls.filter(filter)) {
    const len = wallLength(w), height = effectiveWallHeight(plan, w), low = Math.min(w.lowHeight ?? DEFAULTS.lowHeight, height)
    if (len <= 1e-7 || w.thickness <= 0 || height <= 0) continue
    const openings = plan.openings.filter(o => o.wall === w.id), cuts = [...new Set([0, len, ...openings.flatMap(o => [Math.max(0, Math.min(len, o.offset)), Math.max(0, Math.min(len, o.offset + o.width))])])].sort((a, b) => a - b)
    for (let i = 1; i < cuts.length; i++) {
      const a = cuts[i - 1], b = cuts[i], middle = (a + b) / 2, holes = openings.filter(o => o.offset < middle && o.offset + o.width > middle), polygons = joinedWallFootprint(plan, w, a, b)
      const zs = [...new Set([0, height, ...(w.kind === 'half' || w.kind === 'half-glass' ? [low] : []), ...holes.flatMap(o => [Math.max(0, Math.min(height, o.sill)), Math.max(0, Math.min(height, o.head))])])].sort((a, b) => a - b)
      for (let j = 1; j < zs.length; j++) {
        const z0 = zs[j - 1], z1 = zs[j], z = (z0 + z1) / 2
        if (holes.some(o => z > o.sill && z < o.head) || w.kind === 'half' && z > low) continue
        const kind: SolidKind = w.kind === 'glass' || w.kind === 'half-glass' && z >= low ? 'glass' : holes.length ? holes.every(o => z >= o.head) ? 'lintel' : 'sill' : 'wall'
        if (z1 - z0 > 1e-8 && polygons.length) pieces.push({ kind, polygons, z0, z1, ids: [w.id, ...holes.map(o => o.id)], wallKind: w.kind })
      }
    }
  }
  for (const b of plan.beams) {
    // A beam can cross rooms of different heights; subdivide at room boundary intersections.
    const d: Vec2 = [b.b[0] - b.a[0], b.b[1] - b.a[1]], ts = [0, 1]
    const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0]
    for (const r of plan.rooms.filter(r => levelOf(plan, r).id === levelOf(plan, b).id)) r.poly.forEach((a, i) => { const q = r.poly[(i + 1) % r.poly.length], e: Vec2 = [q[0] - a[0], q[1] - a[1]], v: Vec2 = [a[0] - b.a[0], a[1] - b.a[1]], det = cross(d, e); if (Math.abs(det) > 1e-8) { const t = cross(v, e) / det, u = cross(v, d) / det; if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t) } })
    const cuts = [...new Set(ts)].sort((a, b) => a - b)
    for (let i = 1; i < cuts.length; i++) push('beam', beamFootprint({ ...b, a: add(b.a, mul(d, cuts[i - 1])), b: add(b.a, mul(d, cuts[i])) }), b.bottom, ceilingAt(plan, add(b.a, mul(d, (cuts[i - 1] + cuts[i]) / 2)), levelOf(plan, b).id), [b.id])
  }
  // Subtract actual intersecting volumes only. A remote opening/beam never cuts this wall.
  const priority: Record<SolidKind, number> = { wall: 0, sill: 1, lintel: 2, beam: 3, glass: 4, floor: 5, platform: 6, slab: 7, stair: 8, column: 9, shaft: 10 }
  pieces.sort((a, b) => priority[a.kind] - priority[b.kind] || (a.wallKind ?? '').localeCompare(b.wallKind ?? ''))
  const occupied: Solid[] = []
  for (const piece of pieces) {
    let cells: Solid[] = [piece]
    for (const blocker of occupied) {
      cells = cells.flatMap(cell => {
        const z0 = Math.max(cell.z0, blocker.z0), z1 = Math.min(cell.z1, blocker.z1)
        if (z1 - z0 <= 1e-8) return [cell]
        const inside = clipping.intersection(cell.polygons, blocker.polygons) as Vec2[][][]
        if (!inside.length) return [cell]
        const outside = clipping.difference(cell.polygons, blocker.polygons) as Vec2[][][]
        const rest: Solid[] = []
        if (outside.length) rest.push({ ...cell, polygons: outside })
        if (z0 > cell.z0 + 1e-8) rest.push({ ...cell, polygons: inside, z1: z0 })
        if (z1 < cell.z1 - 1e-8) rest.push({ ...cell, polygons: inside, z0: z1 })
        return rest
      })
      if (!cells.length) break
    }
    // Combine lateral fragments sharing this piece's own height interval.
    const bands = new Map<string, Solid>()
    for (const cell of cells) {
      const key = `${cell.z0}:${cell.z1}`, prev = bands.get(key)
      bands.set(key, prev ? { ...prev, polygons: unionPolygons([...prev.polygons, ...cell.polygons]) } : cell)
    }
    result.push(...bands.values())
    occupied.push(piece)
  }
  // Negative offsets lower the entire floor; positive offsets add a platform above zero.
  for (const r of plan.rooms) if (r.poly.length >= 3) {
    result.push({ kind: 'floor', polygons: [[r.poly]], z0: Math.min(0, r.floorOffset ?? 0) - .08, z1: Math.min(0, r.floorOffset ?? 0), ids: [r.id] })
    if ((r.floorOffset ?? 0) > 0) result.push({ kind: 'platform', polygons: [[r.poly]], z0: 0, z1: r.floorOffset!, ids: [r.id] })
  }
  return result
}
/** Generate each level independently, then translate local heights to absolute elevations. */
export function buildSolids(plan: Plan, filter: (wall: Wall) => boolean = () => true): Solid[] {
  if (!hasLevelData(plan)) return buildLevelSolids(plan, filter)
  return levelsOf(plan).flatMap((level, index) => {
    const view = onLevel(plan, level.id), holes = (view.voids ?? []).map(v => [v.poly])
    const cut = (polys: Vec2[][][]): Vec2[][][] => holes.length && polys.length ? clipping.difference(polys, ...holes) as Vec2[][][] : polys
    const solids = buildLevelSolids(view, filter).map(s => {
      if (s.kind === 'floor' || s.kind === 'platform') s = { ...s, polygons: cut(s.polygons) }
      if (index > 0 && s.kind === 'floor') s = { ...s, kind: 'slab', z0: s.z1 - .12 }
      return { ...s, level: level.id, z0: s.z0 + level.elevation, z1: s.z1 + level.elevation }
    }).filter(s => s.polygons.length)
    // Fill the footprint beneath walls too, without duplicating the room slabs.
    if (index > 0) {
      let polys = wallFootprints(view)
      const rooms = view.rooms.filter(r => r.poly.length >= 3).map(r => [r.poly])
      if (polys.length && rooms.length) polys = clipping.difference(polys, ...rooms) as Vec2[][][]
      polys = cut(polys)
      if (polys.length) solids.push({ kind: 'slab', polygons: polys, z0: level.elevation - .12, z1: level.elevation, ids: view.walls.map(w => w.id), level: level.id })
    }
    for (const c of view.columns ?? []) solids.push({ kind: 'column', polygons: [[columnFootprint(c)]], z0: level.elevation, z1: level.elevation + levelCeiling(plan, level.id), ids: [c.id], level: level.id })
    for (const shaft of view.shafts ?? []) if (shaft.poly.length >= 3) solids.push({ kind: 'shaft', polygons: [[shaft.poly]], z0: level.elevation, z1: level.elevation + levelCeiling(plan, level.id), ids: [shaft.id], level: level.id })
    for (const stair of view.stairs ?? []) {
      const target = levelsOf(plan).find(l => l.id === stair.to)
      if (!target || target.elevation <= level.elevation || stair.path.length < 2) continue
      const lengths = stair.path.slice(1).map((p, i) => distance(stair.path[i], p)), total = lengths.reduce((a, b) => a + b, 0)
      const count = stair.steps ?? Math.max(1, Math.ceil((target.elevation - level.elevation) / .17))
      if (!total || !Number.isInteger(count) || count < 1) continue
      for (let step = 0; step < count; step++) {
        const from = total * step / count, to = total * (step + 1) / count
        let offset = 0
        const strips: Vec2[][][] = []
        lengths.forEach((length, i) => {
          const a = Math.max(from, offset), b = Math.min(to, offset + length)
          if (b > a && length > 0) {
            const origin = stair.path[i], d = mul(sub(stair.path[i + 1], origin), 1 / length)
            strips.push([beamFootprint({ id: stair.id, a: add(origin, mul(d, a - offset)), b: add(origin, mul(d, b - offset)), width: stair.width, bottom: 0 })])
          }
          offset += length
        })
        const polys = unionPolygons(strips)
        const polygons = polys.length ? clipping.intersection(polys, [stair.poly]) as Vec2[][][] : []
        if (polygons.length) solids.push({ kind: 'stair', polygons, z0: level.elevation, z1: level.elevation + (target.elevation - level.elevation) * (step + 1) / count, ids: [stair.id], level: level.id })
      }
    }
    return solids
  })
}
export type Fixture = (
  | { kind: 'door'; id: string; wall: string; hinge: Vec2; position: Vec2; dir: Vec2; normal: Vec2; width: number; thickness: number; height: number; z0: number; angle: number; side: 1 | -1 }
  | { kind: 'pane'; id: string; wall: string; openingKind: OpeningKind; paneKind: PaneKind; a: Vec2; b: Vec2; center: Vec2; dir: Vec2; normal: Vec2; width: number; thickness: number; z0: number; z1: number }
  | { kind: 'railing'; id: string; wall: string; a: Vec2; b: Vec2; z0: number; z1: number; height: number }
) & { path?: Vec2[]; footprint?: Vec2[]; paneIndex?: number }
/** Plan dimensions remain mm; vertical dimensions are m; opening angle is degrees. */
function buildLocalFixtures(plan: Plan, opts: { doorAngle?: number } = {}): Fixture[] {
  const result: Fixture[] = []
  for (const o of plan.openings) {
    if (!plan.walls.some(w => w.id === o.wall) || o.head <= o.sill) continue
    const s = openingSpan(plan, o)
    if (s.wall.bulge && o.kind !== 'open-balcony' && o.kind !== 'doorway') {
      const symbol = openingSymbol(plan, o.id, opts)
      for (const leaf of symbol.leaves) {
        const a = leaf.path[0], b = leaf.path.at(-1)!, dir = wallDir({ a, b }), normal: Vec2 = [-dir[1], dir[0]], width = leaf.s[1] - leaf.s[0]
        const common = { id: o.id, wall: o.wall, path: leaf.path, footprint: leaf.footprint, paneIndex: leaf.index, dir, normal, width, z0: o.sill }
        if (leaf.kind === 'door') result.push({ ...common, kind: 'door', hinge: leaf.hinge!, position: leaf.path[Math.floor(leaf.path.length / 2)], thickness: 40, height: o.head - o.sill, angle: Math.max(0, Math.min(90, opts.doorAngle ?? 60)), side: o.swing?.side ?? 1 })
        else result.push({ ...common, kind: 'pane', openingKind: o.kind, paneKind: leaf.kind, a, b, center: leaf.path[Math.floor(leaf.path.length / 2)], thickness: 30, z1: o.head })
      }
      continue
    }
    if (o.kind === 'door') {
      const chordDir = wallDir({ a: s.a, b: s.b }), chordNormal: Vec2 = [-chordDir[1], chordDir[0]], width = s.wall.bulge ? distance(s.a, s.b) : o.width
      const swing = o.swing ?? { hinge: 'start', side: 1 as const }, hinge = swing.hinge === 'start' ? s.a : s.b, closed = mul(chordDir, swing.hinge === 'start' ? 1 : -1), angle = Math.max(0, Math.min(90, opts.doorAngle ?? 60)), rad = angle * Math.PI / 180
      const dir = add(mul(closed, Math.cos(rad)), mul(chordNormal, swing.side * Math.sin(rad)))
      result.push({ kind: 'door', id: o.id, wall: o.wall, hinge, position: add(hinge, mul(dir, width / 2)), dir, normal: [-dir[1], dir[0]], width, thickness: 40, height: o.head - o.sill, z0: o.sill, angle, side: swing.side })
    } else if (o.kind === 'open-balcony') result.push({ kind: 'railing', id: o.id, wall: o.wall, a: s.a, b: s.b, z0: o.sill, z1: o.sill + 1.1, height: 1.1 })
    else if (o.kind !== 'doorway') {
      const panes = o.panes?.length ? o.panes : o.kind === 'sliding' ? [{ width: 1, kind: 'sliding' as const }, { width: 1, kind: 'sliding' as const }] : [{ width: 1, kind: 'fixed' as const }], total = panes.reduce((sum, p) => sum + Math.max(0, p.width), 0)
      if (!total) continue
      let offset = o.offset
      for (const pane of panes) {
        const width = Math.max(0, pane.width) / total * o.width, count = s.wall.bulge ? Math.max(1, Math.ceil(width / 300)) : 1
        for (let i = 0; i < count; i++) {
          const a = pointAt(s.wall, offset + width * i / count), b = pointAt(s.wall, offset + width * (i + 1) / count), dir = wallDir({ a, b })
          result.push({ kind: 'pane', id: o.id, wall: o.wall, openingKind: o.kind, paneKind: pane.kind, a, b, center: s.wall.bulge ? mul(add(a, b), .5) : pointAt(s.wall, offset + width / 2), dir: s.wall.bulge ? dir : s.dir, normal: s.wall.bulge ? [-dir[1], dir[0]] : s.normal, width: s.wall.bulge ? distance(a, b) : width, thickness: 30, z0: o.sill, z1: o.head })
        }
        offset += width
      }
    }
  }
  return result
}

export function buildFixtures(plan: Plan, opts: { doorAngle?: number } = {}): (Fixture & { level?: string })[] {
  return buildLocalFixtures(plan, opts).map(f => {
    const wall = plan.walls.find(w => w.id === f.wall)!, level = levelOf(plan, wall)
    return { ...f, z0: f.z0 + level.elevation, ...('z1' in f ? { z1: f.z1 + level.elevation } : {}), ...(hasLevelData(plan) ? { level: level.id } : {}) }
  })
}
