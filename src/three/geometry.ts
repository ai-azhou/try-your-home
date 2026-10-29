import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Solid, SolidKind } from '../core/solids.ts'
export interface TriangleRange { start: number; count: number; ids: string[] }
export function solidToGeometry(solid: Solid): THREE.BufferGeometry {
  const shapes = solid.polygons.map(poly => {
    const shape = new THREE.Shape(poly[0].map(p => new THREE.Vector2(p[0] / 1000, -p[1] / 1000)))
    shape.holes = poly.slice(1).map(ring => new THREE.Path(ring.map(p => new THREE.Vector2(p[0] / 1000, -p[1] / 1000))))
    return shape
  })
  const g = new THREE.ExtrudeGeometry(shapes, { depth: Math.max(0, solid.z1 - solid.z0), bevelEnabled: false, steps: 1, curveSegments: 1 })
  g.rotateX(-Math.PI / 2); g.translate(0, solid.z0, 0)
  g.clearGroups()
  g.userData = { kind: solid.kind, ids: [...solid.ids], triangleRanges: [{ start: 0, count: (g.index?.count ?? g.getAttribute('position').count) / 3, ids: [...solid.ids] }] satisfies TriangleRange[] }
  return g
}
/** triangleRanges use triangle indices (raycaster faceIndex), not vertex offsets. */
export function mergeByKind(solids: Solid[]): Partial<Record<SolidKind, THREE.BufferGeometry>> {
  const result: Partial<Record<SolidKind, THREE.BufferGeometry>> = {}
  for (const kind of [...new Set(solids.map(s => s.kind))]) {
    const entries = solids.filter(s => s.kind === kind), geometries = entries.map(solidToGeometry), ranges: TriangleRange[] = []
    let start = 0
    geometries.forEach((g, i) => { const count = (g.index?.count ?? g.getAttribute('position').count) / 3; ranges.push({ start, count, ids: [...entries[i].ids] }); start += count })
    const merged = mergeGeometries(geometries, false)
    if (merged) { merged.userData = { kind, triangleRanges: ranges, ids: [...new Set(entries.flatMap(s => s.ids))] }; result[kind] = merged }
    geometries.forEach(g => g.dispose())
  }
  return result
}
