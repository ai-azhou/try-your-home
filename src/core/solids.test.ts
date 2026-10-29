import clipping from 'polygon-clipping'
import { describe, expect, it } from 'vitest'
import { emptyPlan } from './io.ts'
import { buildFixtures, buildSolids } from './solids.ts'
import { pointInPolygon, polygonArea } from './geometry.ts'
import { mergeByKind, solidToGeometry } from '../three/geometry.ts'
const plan = () => { const p = emptyPlan(); p.walls = [{ id: 'w', a: [0, 0], b: [5000, 0], thickness: 200, kind: 'partition' }]; return p }
const covered = (solids: ReturnType<typeof buildSolids>, x: number, y: number, z: number) => solids.filter(s => z > s.z0 && z < s.z1 && s.polygons.some(poly => pointInPolygon([x, y], poly[0]) && !poly.slice(1).some(h => pointInPolygon([x, y], h))))
describe('实体与 3D 几何', () => {
  it('门窗真正挖空，窗台、过梁保留', () => {
    const p = plan(); p.openings = [{ id: 'win', wall: 'w', offset: 1000, width: 1500, kind: 'window', sill: .9, head: 2.4 }]
    const solids = buildSolids(p)
    expect(covered(solids, 1500, 0, 1.5)).toHaveLength(0); expect(covered(solids, 1500, 0, .5)[0].kind).toBe('sill'); expect(covered(solids, 1500, 0, 2.6)[0].kind).toBe('lintel'); expect(covered(solids, 500, 0, 1.5)[0].kind).toBe('wall')
  })
  it('矮墙、半墙玻璃和通高玻璃高度区间', () => {
    const p = plan(); p.walls[0].kind = 'half'; expect(covered(buildSolids(p), 500, 0, 1.5)).toHaveLength(0)
    p.walls[0].kind = 'half-glass'; const s = buildSolids(p); expect(covered(s, 500, 0, .5)[0].kind).toBe('wall'); expect(covered(s, 500, 0, 1.5)[0].kind).toBe('glass')
    p.walls[0].kind = 'glass'; expect(buildSolids(p).every(s => s.kind === 'glass')).toBe(true)
  })
  it('交叉墙按高度做并集，不同类型同一高度也不重叠', () => {
    const p = plan(); p.walls.push({ id: 'cross', a: [2500, -1500], b: [2500, 1500], thickness: 200, kind: 'bearing', height: 3.2 })
    const solids = buildSolids(p)
    for (let i = 0; i < solids.length; i++) for (let j = i + 1; j < solids.length; j++) if (Math.min(solids[i].z1, solids[j].z1) > Math.max(solids[i].z0, solids[j].z0)) expect(clipping.intersection(solids[i].polygons, solids[j].polygons).reduce((a, poly) => a + polygonArea(poly[0]), 0)).toBeLessThan(.001)
    expect(covered(solids, 2500, 0, 1)).toHaveLength(1)
    const area = solids.filter(s => s.z0 === 0).flatMap(s => s.polygons).reduce((a, poly) => a + polygonArea(poly[0]), 0); expect(area).toBe(5000 * 200 + 3000 * 200 - 200 * 200)
  })
  it('梁随房间层高，地面和抬台区间', () => {
    const p = emptyPlan(); p.rooms = [{ id: 'r', name: '房', poly: [[0, 0], [3000, 0], [3000, 3000], [0, 3000]], ceiling: 3.3, floorOffset: .45 }]; p.beams = [{ id: 'b', a: [100, 500], b: [2900, 500], width: 200, bottom: 2.5 }]
    const solids = buildSolids(p); expect(solids.find(s => s.kind === 'beam')).toMatchObject({ z0: 2.5, z1: 3.3 }); expect(solids.find(s => s.kind === 'platform')).toMatchObject({ z0: 0, z1: .45 }); expect(solids.find(s => s.kind === 'floor')?.z1).toBe(0)
  })
  it('门扇角度、窗分格和栏杆数据', () => {
    const p = plan(); p.openings = [{ id: 'd', wall: 'w', offset: 0, width: 900, sill: 0, head: 2.1, kind: 'door', swing: { hinge: 'end', side: -1 } }, { id: 'win', wall: 'w', offset: 1000, width: 1800, sill: .9, head: 2.4, kind: 'window', panes: [{ width: 1, kind: 'casement' }, { width: 2, kind: 'fixed' }] }, { id: 'rail', wall: 'w', offset: 3000, width: 1500, sill: 0, head: 2.5, kind: 'open-balcony' }]
    const f = buildFixtures(p, { doorAngle: 90 }), door = f[0]; if (door.kind !== 'door') throw Error('door'); expect(door.dir[1]).toBeCloseTo(-1); expect(door.hinge).toEqual([900, 0]); expect(f.filter(p => p.kind === 'pane').map(p => p.width)).toEqual([600, 1200]); expect(f.at(-1)).toMatchObject({ height: 1.1, z1: 1.1 })
  })
  it('米制坐标、内孔三角化与点选范围', () => {
    const solids = buildSolids(plan()), g = solidToGeometry(solids[0]); g.computeBoundingBox(); expect(g.boundingBox?.max.x).toBe(5); expect(g.boundingBox?.max.y).toBeCloseTo(2.8); expect(g.boundingBox?.min.z).toBeCloseTo(-.1)
    const ring = solidToGeometry({ kind: 'wall', z0: 0, z1: 1, ids: ['ring'], polygons: [[[[0, 0], [3000, 0], [3000, 3000], [0, 3000]], [[1000, 1000], [1000, 2000], [2000, 2000], [2000, 1000]]]] })
    expect([...ring.getAttribute('position').array].every(Number.isFinite)).toBe(true)
    const merged = mergeByKind([...solids, { ...solids[0], kind: 'beam' }]); expect(Object.keys(merged)).toEqual(['wall', 'beam']); expect(merged.wall?.userData.triangleRanges[0]).toMatchObject({ start: 0, ids: ['w'] }); expect(merged.wall?.userData.triangleRanges[0].count).toBe(merged.wall!.getAttribute('position').count / 3)
    g.dispose(); ring.dispose(); Object.values(merged).forEach(g => g.dispose())
  })
})
