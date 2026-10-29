import { describe, expect, it } from 'vitest'
import type { Plan, Vec2, Wall } from './types.ts'
import { emptyPlan } from './io.ts'
import { effectiveWallHeight, hitTest, jointsAt, labelPoint, openingSpan, planBounds, pointAt, pointInPolygon, polygonArea, projectToWall, roomsBesideWall, sliceWall, snap, wallFootprint, wallLength, wallNormal, wallPath } from './geometry.ts'
const wall = (extra: Partial<Wall> = {}): Wall => ({ id: 'w', a: [0, 0], b: [1000, 0], thickness: 100, kind: 'partition', ...extra })
describe('几何', () => {
  it('法向、矢高、弧长和投影使用同一约定', () => {
    const w = wall({ bulge: 200 }), length = wallLength(w), path = wallPath(w)
    expect(wallNormal(w)).toEqual([-0, 1]); expect(length).toBeGreaterThan(1000)
    expect(length / (path.length - 1)).toBeLessThanOrEqual(150)
    expect(pointAt(w, length / 2)[0]).toBeCloseTo(500); expect(pointAt(w, length / 2)[1]).toBeCloseTo(200)
    const p = pointAt(w, length * .37), projection = projectToWall(w, p)
    expect(projection.s).toBeCloseTo(length * .37); expect(projection.dist).toBeLessThan(1e-7)
    expect(wallLength(sliceWall(w, length * .2, length * .8))).toBeCloseTo(length * .6)
    expect(wallFootprint(w).flat().every(Number.isFinite)).toBe(true)
  })
  it('负矢高和大于半圆的弧保持端点和投影', () => {
    for (const bulge of [-200, 900, -900]) { const w = wall({ bulge }); expect(pointAt(w, 0)).toEqual(w.a); expect(pointAt(w, wallLength(w))).toEqual(w.b); expect(pointAt(w, wallLength(w) / 2)[1]).toBeCloseTo(bulge); expect(projectToWall(w, pointAt(w, wallLength(w) * .8)).s).toBeCloseTo(wallLength(w) * .8) }
  })
  it('直墙矩形面积、端点夹取、零长墙无 NaN', () => {
    expect(polygonArea(wallFootprint(wall()))).toBe(100000)
    expect(projectToWall(wall(), [-30, 40])).toEqual({ s: 0, point: [0, 0], dist: 50 })
    expect(wallPath(wall({ b: [0, 0] })).flat().every(Number.isFinite)).toBe(true)
  })
  it('凹多边形标签严格位于内部', () => {
    const poly: Vec2[] = [[0, 0], [10, 0], [10, 2], [2, 2], [2, 10], [0, 10]], label = labelPoint(poly)
    expect(pointInPolygon(label, poly)).toBe(true); expect(pointInPolygon([5, 5], poly)).toBe(false)
    expect(polygonArea(poly)).toBe(36)
  })
  it('包围盒含墙厚、梁、房间，空方案为 null', () => {
    const p = emptyPlan(); expect(planBounds(p)).toBeNull(); p.walls = [wall()]
    expect(planBounds(p)).toEqual([0, -50, 1000, 50])
    p.beams = [{ id: 'b', a: [1200, 0], b: [1600, 0], width: 200, bottom: 2 }]
    expect(planBounds(p)).toEqual([0, -100, 1600, 100])
  })
  it('命中按洞口、墙、梁、房间优先；洞口端点准确', () => {
    const p = emptyPlan(); p.walls = [wall()]; p.openings = [{ id: 'o', wall: 'w', offset: 300, width: 400, sill: 0, head: 2, kind: 'door' }]
    p.rooms = [{ id: 'r', name: '房', poly: [[-10, -100], [1100, -100], [1100, 100], [-10, 100]] }]
    expect(hitTest(p, [500, 0])).toEqual({ type: 'opening', id: 'o' }); expect(hitTest(p, [100, 0])?.type).toBe('wall'); expect(hitTest(p, [500, 90])?.type).toBe('room')
    expect(openingSpan(p, p.openings[0]).a).toEqual([300, 0])
  })
  it('吸附每类可关闭、独立容差和方向锚点', () => {
    const p = emptyPlan(); p.walls = [wall()]
    expect(snap(p, [20, 10]).kind).toBe('endpoint')
    expect(snap(p, [500, 30], { endpoints: false, walls: { tolerance: 40 }, grid: false }).point).toEqual([500, 0])
    expect(snap(p, [500, 30], { endpoints: false, walls: { tolerance: 10 }, grid: false }).kind).toBe('none')
    const opts = { endpoints: false, walls: false, grid: false, openings: false, anchor: [0, 0] as Vec2 }
    expect(snap(p, [1000, 990], opts).point[0]).toBeCloseTo(995)
    expect(snap(p, [98, 202], { endpoints: false, walls: false, angles: false, gridSize: 100 }).point).toEqual([100, 200])
  })
  it('共享端点和两侧多个房间决定默认墙高', () => {
    const p: Plan = emptyPlan(); p.walls = [wall(), wall({ id: 'w2', a: [1000, 0], b: [1000, 1000] })]
    p.rooms = [{ id: 'r1', name: '南', ceiling: 3.2, poly: [[0, 50], [1000, 50], [1000, 1000], [0, 1000]] }, { id: 'r2', name: '北', ceiling: 2.5, poly: [[0, -1000], [1000, -1000], [1000, -50], [0, -50]] }]
    expect(jointsAt(p, [1000, 0])).toHaveLength(2); expect(roomsBesideWall(p, 'w').positive[0].id).toBe('r1'); expect(effectiveWallHeight(p, p.walls[0])).toBe(3.2)
  })
})
