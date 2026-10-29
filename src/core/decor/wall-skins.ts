import earcut from 'earcut'
import type { Plan, Vec2 } from '../types.ts'
import type { FaceRef, Material } from './types.ts'
import { levelOf } from '../levels.ts'
import { polygonArea } from '../geometry.ts'
import { unionPolygons } from '../solids.ts'
import { faceAxis, faceRun, runS } from './faces.ts'
import { resolveSurfaces, type FinishPreview } from './surfaces.ts'
import { checkEmbed, embedsOf } from './embed.ts'
import { decorItems } from './resolve.ts'
import { difference, intersection, rectPoly } from './math.ts'

export interface WallSkin {
  key: string
  /** Canonical anchor; faces lists every contributing wall and its local side. */
  wall: string; side: 1 | -1; face: FaceRef; faces: FaceRef[]; wallIds: string[]; room?: string; level: string
  material: Material; materialId: string; overridden: boolean; surfaceIds: string[]
  /** Unfolded anchor-face u (mm), floor-relative z (m); outer ring then holes. */
  polygons: Vec2[][][]; area: number
  /** Non-indexed triangles, Y-up metres, absolute elevation; normals face out of the wall. */
  positions: number[]; normals: number[]
}
export interface WallSkinOptions extends FinishPreview { face?: FaceRef; level?: string; maxSegment?: number; offset?: number }
/** Continuous material skins, independent of the wall/sill/lintel solid partition. Niches are cut out. */
export function wallSkins(plan: Plan, opts: WallSkinOptions = {}): WallSkin[] {
  const step = opts.maxSegment ?? 150
  if (!(step > 0) || !Number.isFinite(step) || !Number.isFinite(opts.offset ?? 0)) throw new Error('墙面皮分段长度必须是有限正数，偏移必须有限')
  const resolved = resolveSurfaces(plan, opts).walls, seen = new Set<string>(), result: WallSkin[] = []
  const cuts = plan.decor ? embedsOf(plan, plan.decor).filter(e => {
    const item = decorItems(plan.decor!).find(i => i.id === e.id)!
    return !checkEmbed(plan, plan.decor!, item as Parameters<typeof checkEmbed>[2]).some(i => i.level === 'error')
  }) : []
  const seeds = opts.face ? [opts.face] : [...plan.walls].sort((a, b) => a.id.localeCompare(b.id)).flatMap(w => ([1, -1] as const).map(side => ({ wall: w.id, side })))
  for (const face of seeds) {
    if (seen.has(JSON.stringify(face))) continue
    const axis = faceAxis(plan, face), run = faceRun(plan, face), level = levelOf(plan, axis.wall)
    if (opts.level && level.id !== opts.level) continue
    for (const part of run) seen.add(JSON.stringify(part.face))
    const groups = new Map<string, WallSkin>()
    for (const part of run) for (const surface of resolved) {
      if (!('face' in surface.target) || surface.target.face.wall !== part.face.wall || surface.target.face.side !== part.face.side) continue
      let polygons = surface.polygons
      for (const cut of cuts) {
        const member = faceRun(plan, cut.face).find(p => p.face.wall === part.face.wall && p.face.side === part.face.side)
        if (!member) continue
        const ss = cut.s.map(s => member.reversed ? member.s[1] - s : s - member.s[0]).sort((a, b) => a - b)
        polygons = difference(polygons, [[rectPoly({ u: [ss[0], ss[1]], z: cut.z })]])
      }
      if (!polygons.length) continue
      const key = JSON.stringify([face.wall, face.side, surface.room ?? null, surface.materialId])
      let skin = groups.get(key)
      if (!skin) {
        skin = { key, wall: face.wall, side: face.side, face, faces: [], wallIds: [], room: surface.room, level: level.id, material: surface.material, materialId: surface.materialId, overridden: false, surfaceIds: [], polygons: [], area: 0, positions: [], normals: [] }
        groups.set(key, skin)
      }
      if (!skin.wallIds.includes(part.wall.id)) { skin.wallIds.push(part.wall.id); skin.faces.push(part.face) }
      skin.overridden ||= surface.overridden
      if (surface.surface && !skin.surfaceIds.includes(surface.surface)) skin.surfaceIds.push(surface.surface)
      skin.polygons.push(...polygons.map(rs => rs.map(r => r.map(([s, z]): Vec2 => [axis.toU(runS(part, s)), z]))))
    }
    if (!groups.size) continue
    // All materials share the same arc subdivision boundaries, so adjoining patches cannot crack.
    const allU = [...groups.values()].flatMap(g => g.polygons.flat(2).map(p => p[0]))
    const lo = Math.min(...allU), hi = Math.max(...allU)
    const grid = [...new Set([...allU, ...(axis.wall.bulge ? Array.from({ length: Math.ceil((hi - lo) / step) + 1 }, (_, i) => Math.min(hi, lo + i * step)) : [])])].sort((a, b) => a - b)
    for (const skin of groups.values()) {
      skin.polygons = unionPolygons(skin.polygons)
      skin.area = skin.polygons.reduce((sum, rs) => sum + polygonArea(rs[0]) - rs.slice(1).reduce((n, r) => n + polygonArea(r), 0), 0) / 1000
      const zs = skin.polygons.flat(2).map(p => p[1]), z0 = Math.min(...zs), z1 = Math.max(...zs)
      const patches = axis.wall.bulge ? grid.slice(1).flatMap((u, i) => intersection(skin.polygons, [[rectPoly({ u: [grid[i], u], z: [z0, z1] })]])) : skin.polygons
      for (const rings of patches) {
        const points = rings.flat(), holes: number[] = []; let count = rings[0].length
        for (const ring of rings.slice(1)) { holes.push(count); count += ring.length }
        const indices = earcut(points.flat(), holes)
        for (let i = 0; i < indices.length; i += 3) {
          const uv = indices.slice(i, i + 3).map(j => points[j])
          const vertices = uv.map(([u, z]) => { const p = axis.at(axis.toS(u), opts.offset ?? 0); return [p[0] / 1000, level.elevation + z, p[1] / 1000] })
          const a = vertices[1].map((v, j) => v - vertices[0][j]), b = vertices[2].map((v, j) => v - vertices[0][j]), cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
          const n = axis.normalAt(axis.toS(uv.reduce((s, p) => s + p[0], 0) / 3))
          if (cross[0] * n[0] + cross[2] * n[1] < 0) { vertices.reverse(); uv.reverse() }
          skin.positions.push(...vertices.flat())
          for (const [u] of uv) { const normal = axis.normalAt(axis.toS(u)); skin.normals.push(normal[0], 0, normal[1]) }
        }
      }
      result.push(skin)
    }
  }
  return result
}
