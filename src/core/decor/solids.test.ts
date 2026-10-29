import { describe, expect, it } from 'vitest'
import { solidToGeometry } from '../../three/geometry.ts'
import type { Solid } from '../solids.ts'
import { buildDecorSolids } from './solids.ts'
import { probeP1, probeP2, probeP3 } from './fixtures.ts'
import { materialTakeoff } from './surfaces.ts'
describe('P1–P3 白模可进入现有三角化器', () => {
  it.each([probeP1, probeP2, probeP3])('%s 输出有限且非退化的 Three 几何', make => {
    const solids = buildDecorSolids(make()); expect(solids.length).toBeGreaterThan(0)
    for (const s of solids) {
      // The converter reads only geometric fields; its old kind union is intentionally unchanged.
      const geometry = solidToGeometry(s as unknown as Solid), positions = geometry.getAttribute('position')
      expect(positions.count).toBeGreaterThan(0); expect(Array.from(positions.array).every(Number.isFinite)).toBe(true); expect(geometry.userData.kind).toMatch(/^decor-/)
      geometry.dispose()
    }
  })
  it('柜体面材与台面加入粗估表，非板材展开采购清单', () => { const p = probeP3(), q = materialTakeoff(p); expect(q.some(m => m.materialId === 'creamDoor' && m.cabinet > 0)).toBe(true); expect(q.some(m => m.materialId === 'oakVeneer' && m.countertop > 0)).toBe(true) })
})
