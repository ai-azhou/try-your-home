import { describe, expect, it } from 'vitest'
import type { Opening, Plan, Room, Vec2, Wall } from '../types.ts'
import { pointInPolygon, polygonArea, wallFootprint } from '../geometry.ts'
import { floorFillPieces, floorFills } from './floor-fill.ts'
import { resolveSurfaces } from './surfaces.ts'
import { createDecor } from './presets.ts'

const wall = (id: string, a: Vec2, b: Vec2, extra: Partial<Wall> = {}): Wall => ({ id, a, b, thickness: 200, kind: 'partition', ...extra })
const room = (id: string, x0: number, y0: number, x1: number, y1: number, extra: Partial<Room> = {}): Room => ({ id, name: id, poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], ...extra } as Room)
const door = (id: string, w: string, offset = 1000, width = 900, extra: Partial<Opening> = {}): Opening => ({ id, wall: w, offset, width, kind: 'door', sill: 0, head: 2.1, ...extra })
const planOf = (p: Partial<Plan>): Plan => ({ format: 'floorplan-structure', version: 2, title: 't', ceiling: 2.8, walls: [], rooms: [], beams: [], openings: [], changes: [], questions: [], decor: createDecor(), ...p } as Plan)
// 两间房，中间一道墙（x = 3000，墙面 2900 / 3100）
const two = (more: Partial<Plan> = {}) => planOf({ walls: [wall('mid', [3000, 0], [3000, 3000])], rooms: [room('A', 0, 0, 2900, 3000), room('B', 3100, 0, 6000, 3000)], ...more })

describe('门洞的地面', () => {
  it('两边都是房间：从墙中线分开，各归一边，正好是墙厚 × 门宽', () => {
    const f = floorFills(two({ openings: [door('d', 'mid')] }))
    expect(f.thresholds).toHaveLength(1)
    const t = f.thresholds[0]
    expect(polygonArea(t.whole)).toBeCloseTo(200 * 900, 3)
    expect(t.parts.map(p => p.room).sort()).toEqual(['A', 'B'])
    for (const p of t.parts) {
      expect(polygonArea(p.polygon)).toBeCloseTo(100 * 900, 3)
      const xs = p.polygon.map(q => q[0])
      expect(p.room === 'A' ? Math.max(...xs) : Math.min(...xs)).toBeCloseTo(3000, 6)
      expect(p.room === 'A' ? Math.min(...xs) : Math.max(...xs)).toBeCloseTo(p.room === 'A' ? 2900 : 3100, 6)
    }
  })
  it('入户门只有一边是房间：整条归室内，不超出墙外皮', () => {
    const p = planOf({ walls: [wall('ext', [3000, 0], [3000, 3000], { kind: 'exterior' })], rooms: [room('A', 0, 0, 2900, 3000)], openings: [door('in', 'ext', 1000, 900, { entry: true })] })
    const t = floorFills(p).thresholds[0]
    expect(t.parts).toHaveLength(1)
    expect(t.parts[0].room).toBe('A')
    expect(Math.max(...t.parts[0].polygon.map(q => q[0]))).toBeCloseTo(3100, 6)
  })
  it('推拉门、门洞都铺；窗不铺（下面有窗台墙）；两边都没房间也不铺', () => {
    const f = floorFills(two({ openings: [door('s', 'mid', 200, 800, { kind: 'sliding' }), door('g', 'mid', 1100, 800, { kind: 'doorway' }), door('win', 'mid', 2100, 600, { kind: 'window', sill: .9 })] }))
    expect(f.thresholds.map(t => t.opening).sort()).toEqual(['g', 's'])
    const out = planOf({ walls: [wall('w', [0, 0], [3000, 0])], openings: [door('d', 'w')], rooms: [room('far', 0, 5000, 3000, 7000)] })
    expect(floorFills(out).thresholds).toEqual([])
  })
  it('弧墙洞口贴着弧走，内外两半都在墙厚范围里', () => {
    const w = wall('arc', [0, 0], [4000, 0], { bulge: 800 })
    // 弧顶在 y = 800（朝墙的法向 +y 鼓）：洞口在弧顶附近，两间房分放在弧的内外两侧
    const p = planOf({ walls: [w], rooms: [room('side1', 1000, -500, 3000, 690), room('side2', 1000, 905, 3000, 2500)], openings: [door('d', 'arc', 1500, 900)] })
    const t = floorFills(p).thresholds[0]
    expect(t).toBeTruthy()
    expect(polygonArea(t.whole)).toBeGreaterThan(200 * 900 * .9)
    expect(polygonArea(t.whole)).toBeLessThan(200 * 900 * 1.1)
    expect(t.whole.length).toBeGreaterThan(4)
    expect(t.parts.map(q => q.room).sort()).toEqual(['side1', 'side2'])
    // 弧外侧那半略大，两半加起来正好是整条
    expect(polygonArea(t.parts[0].polygon) + polygonArea(t.parts[1].polygon)).toBeCloseTo(polygonArea(t.whole), 0)
    const fp = wallFootprint(w)
    const c = t.whole.reduce<Vec2>((a, q) => [a[0] + q[0] / t.whole.length, a[1] + q[1] / t.whole.length], [0, 0])
    expect(pointInPolygon(c, fp)).toBe(true)
  })
  it('门开在飘窗台旁边：门槛归地面那边，台面不连出来', () => {
    const t = floorFills(two({ rooms: [room('A', 0, 0, 2900, 3000), room('bay', 3100, 0, 6000, 3000, { floorOffset: .45 })], openings: [door('d', 'mid')] })).thresholds[0]
    expect(t.parts.map(p => p.room)).toEqual(['A'])
  })
})

describe('房间之间的缝', () => {
  it('没墙的细缝铺满，从中线分给两边', () => {
    const f = floorFills(planOf({ rooms: [room('A', 0, 0, 3000, 3000), room('B', 3020, 0, 6000, 3000)] }))
    expect(f.seams.map(s => s.room).sort()).toEqual(['A', 'B'])
    const area = f.seams.reduce((n, s) => n + s.polygons.reduce((m, r) => m + polygonArea(r[0]), 0), 0)
    expect(area).toBeCloseTo(20 * 3000, 3)
  })
  it('中间有墙就不铺，不盖到墙上', () => {
    expect(floorFills(two()).seams).toEqual([])
    const part = floorFills(planOf({ walls: [wall('half', [3000, 0], [3000, 1500])], rooms: [room('A', 0, 0, 2900, 3000), room('B', 3100, 0, 6000, 3000)] }))
    const area = part.seams.reduce((n, s) => n + s.polygons.reduce((m, r) => m + polygonArea(r[0]), 0), 0)
    expect(area).toBeCloseTo(200 * 1500, 3) // 没墙的那一半
    for (const s of part.seams) for (const r of s.polygons) expect(Math.min(...r[0].map(q => q[1]))).toBeGreaterThanOrEqual(1500 - 1e-6)
  })
  it('拆掉的墙：占地还给两边；拆一段只补拆掉的那段', () => {
    const base = two()
    const gone = floorFills({ ...base, walls: [] }, base)
    expect(gone.seams.map(s => s.room).sort()).toEqual(['A', 'B'])
    const area = (x: typeof gone) => x.seams.reduce((n, s) => n + s.polygons.reduce((m, r) => m + polygonArea(r[0]), 0), 0)
    expect(area(gone)).toBeCloseTo(200 * 3000, 0)
    const cut = floorFills({ ...base, walls: [wall('mid~1', [3000, 0], [3000, 1000])] }, base)
    expect(area(cut)).toBeCloseTo(200 * 2000, 0)
  })
  it('抬高的台面和相邻地面不连成一片：不补缝，纸白线留着', () => {
    const f = floorFills(planOf({ rooms: [room('A', 0, 0, 3000, 3000), room('bay', 3000, 0, 4000, 3000, { floorOffset: .45 })] }))
    expect(f.seams).toEqual([])
    expect(f.edges.A[0].closed).toBe(true)
    expect(f.edges.bay[0].closed).toBe(true)
  })
  it('不铺到建筑外面：只有一间房时什么都不补', () => {
    const f = floorFills(planOf({ walls: [wall('w', [0, -100], [3000, -100])], rooms: [room('A', 0, 0, 3000, 3000)] }))
    expect(f.seams).toEqual([])
    expect(f.thresholds).toEqual([])
  })
})

describe('纸白内沿', () => {
  const length = (e: { path: Vec2[] }[]) => e.reduce((n, x) => n + x.path.slice(1).reduce((m, p, i) => m + Math.hypot(p[0] - x.path[i][0], p[1] - x.path[i][1]), 0), 0)
  it('四周都是墙时是一整圈', () => {
    const f = floorFills(two())
    expect(f.edges.A).toEqual([{ path: f.edges.A[0].path, closed: true }])
  })
  it('门口那一段不画，其余照画', () => {
    const f = floorFills(two({ openings: [door('d', 'mid')] }))
    expect(f.edges.A.every(e => !e.closed)).toBe(true)
    expect(length(f.edges.A)).toBeCloseTo(2 * (2900 + 3000) - 900, 3)
  })
  it('两间房边贴边、中间没墙：共用的那条边不画', () => {
    const f = floorFills(planOf({ rooms: [room('A', 0, 0, 3000, 3000), room('B', 3000, 0, 6000, 3000)] }))
    expect(length(f.edges.A)).toBeCloseTo(2 * 6000 - 3000, 3)
  })
})

describe('稳妥', () => {
  it('坏几何不抛错', () => {
    const bad = planOf({ walls: [wall('w', [NaN, 0], [100, 0])], rooms: [room('A', 0, 0, 10, 10), { id: 'x', name: 'x', poly: [[0, 0]] } as Room], openings: [door('d', 'w'), door('ghost', 'nope')] })
    expect(() => floorFills(bad)).not.toThrow()
  })
  it('墙、门、房间没变就用缓存（拖家具时不重算）', () => {
    const p = two({ openings: [door('d', 'mid')] })
    expect(floorFills({ ...p, decor: createDecor() })).toBe(floorFills({ ...p, title: '别的' }))
  })
  it('材料粗估的地面面积只按房间算，门槛不算进去', () => {
    const p = two({ openings: [door('d', 'mid')] })
    expect(floorFillPieces(floorFills(p)).length).toBe(2)
    const floors = resolveSurfaces(p).floors
    expect(floors.reduce((n, s) => n + s.area, 0)).toBeCloseTo((2900 * 3000 * 2) / 1e6, 6)
  })
})
