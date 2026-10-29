import { describe, expect, it } from 'vitest'
import type { Wall } from './types.ts'
import { emptyPlan } from './io.ts'
import { arcParams, bulgeFromAngle, bulgeFromRadius, distance, dot, hitTest, openingFootprint, openingSpan, pointAt, pointInPolygon, polygonArea, projectToWall, snap, wallFootprint, wallLength, wallPath, wallTangent } from './geometry.ts'
import { buildFixtures, buildSolids } from './solids.ts'
import { addOpening, bakeChange, moveOpening, updateWall } from './edit.ts'
import { applyChanges } from './changes.ts'
import { joinedWallFootprint, wallOutlines } from './walls.ts'
import { validatePlan } from './validate.ts'
const wall = (angle = 90): Wall => ({ id: 'w', a: [0, 0], b: [4000, 0], thickness: 120, kind: 'partition', bulge: bulgeFromAngle(4000, angle) })
const area = (polys: number[][][][]) => polys.reduce((sum, rings) => sum + polygonArea(rings[0] as [number, number][]) - rings.slice(1).reduce((a, r) => a + polygonArea(r as [number, number][]), 0), 0)
const covers = (polys: [number, number][][][], p: [number, number]) => polys.some(r => pointInPolygon(p, r[0]) && !r.slice(1).some(h => pointInPolygon(p, h)))
describe('C3 弧墙参数与洞口', () => {
  it.each([90, 180, 270, 340, -90, -180, -270, -340])('%s° 的弧长、参数、足迹和实体一致', angle => {
    const w = wall(angle), p = emptyPlan(); p.walls = [w]
    const params = arcParams(w)!, length = wallLength(w)
    expect(params.angle).toBeCloseTo(angle); expect(params.sagitta).toBe(w.bulge)
    expect(bulgeFromRadius(4000, params.radius, Math.abs(angle) > 180)).toBeCloseTo(Math.abs(w.bulge!), 3)
    expect(length).toBeCloseTo(params.radius * Math.abs(angle) * Math.PI / 180)
    expect(wallPath(w)[0]).toEqual(w.a); expect(wallPath(w).at(-1)).toEqual(w.b)
    for (const t of [.01, .2, .5, .8, .99]) {
      const q = pointAt(w, length * t)
      expect(projectToWall(w, q).s).toBeCloseTo(length * t)
      expect(pointInPolygon(q, wallFootprint(w))).toBe(true)
    }
    expect(area(joinedWallFootprint(p, w)) / (length * w.thickness)).toBeCloseTo(1, 2)
    expect(buildSolids(p).reduce((n, s) => n + area(s.polygons), 0)).toBeCloseTo(area(joinedWallFootprint(p, w)), 2)
    const t = wallTangent(w, length), end: Wall = { id: 'join', a: w.b, b: [w.b[0] - t[1] * 1500, w.b[1] + t[0] * 1500], thickness: 120, kind: 'partition' }
    p.walls.push(end)
    expect(wallOutlines(p).flat(3).every(Number.isFinite)).toBe(true)
    expect(area(joinedWallFootprint(p, w))).toBeGreaterThanOrEqual(area([[wallFootprint(w)]] as number[][][][]) - 1)
  })
  it('参数边界明确拒绝不可能的半径、整圆和非有限输入', () => {
    expect(arcParams({ ...wall(), bulge: 0 })).toBeNull()
    expect(bulgeFromAngle(4000, 0)).toBe(0)
    for (const call of [() => bulgeFromRadius(4000, 100), () => bulgeFromRadius(0, 100), () => bulgeFromAngle(4000, 360), () => bulgeFromAngle(4000, NaN)]) expect(call).toThrow()
  })
  it.each([90, 270, 340, -270])('%s° 洞口保留子弧、精确切向；洞内留空，窗台过梁保留', angle => {
    const p = emptyPlan(); p.walls = [wall(angle)]
    const w = p.walls[0], len = wallLength(w)
    p.openings = [{ id: 'o', wall: 'w', offset: len * .25, width: 1200, kind: 'window', sill: .8, head: 2.3 }]
    const o = p.openings[0], s = openingSpan(p, o), q = s.center
    expect(s.path.length).toBeGreaterThan(2); expect(s.path[0]).toEqual(s.a); expect(s.path.at(-1)).toEqual(s.b)
    expect(dot(s.startTangent, s.startNormal)).toBeCloseTo(0); expect(s.endTangent).toEqual(wallTangent(w, o.offset + o.width))
    expect(pointInPolygon(q, openingFootprint(p, o))).toBe(true)
    const solids = buildSolids(p), at = (z: number) => solids.filter(s => s.z0 < z && s.z1 > z && covers(s.polygons, q))
    expect(at(1.5)).toHaveLength(0); expect(at(.5)[0].kind).toBe('sill'); expect(at(2.5)[0].kind).toBe('lintel')
    expect(covers(wallOutlines(p), q)).toBe(false)
    expect(hitTest(p, q)).toEqual({ type: 'opening', id: 'o' })
    expect(snap(p, s.a, { endpoints: false, walls: false, grid: false }).point).toEqual(s.a)
    expect(validatePlan(p)).toEqual([])
    const panes = buildFixtures(p).filter(f => f.kind === 'pane')
    expect(panes).toHaveLength(1)
    expect(panes[0].width).toBeCloseTo(o.width)
    expect(panes[0].path!.length).toBeGreaterThan(4)
    expect(panes[0].path![0]).toEqual(s.a)
    expect(panes[0].path!.at(-1)).toEqual(s.b)
    expect(dot(panes[0].dir, panes[0].normal)).toBeCloseTo(0)
    p.openings[0].kind = 'door'
    const door = buildFixtures(p, { doorAngle: 0 })[0]
    if (door.kind !== 'door') throw new Error('door')
    expect(door.width).toBeCloseTo(o.width); expect(door.hinge).toEqual(s.a)
    expect(door.path![0]).toEqual(s.a); expect(door.path!.at(-1)).toEqual(s.b)

  })
  it('支持放置、移动和弯曲带洞墙，缩短时夹回并报告，不修改输入', () => {
    let p = emptyPlan(); p.walls = [wall(270)]
    const add = addOpening(p, 'w', 5000, 'window'); if ('error' in add) throw new Error(add.error)
    p = bakeChange(p, add)
    const move = moveOpening(p, p.openings[0].id, 6000); if ('error' in move) throw new Error(move.error)
    p = bakeChange(p, move)
    const saved = structuredClone(p), curved = applyChanges(p, [updateWall('w', { bulge: bulgeFromAngle(4000, 340) })])
    expect(curved.results[0].ok).toBe(true); expect(curved.plan.openings[0].offset).toBe(6000)
    const straight = applyChanges(p, [updateWall('w', { bulge: 0 })])
    expect(straight.results[0]).toMatchObject({ ok: true, affected: ['w', p.openings[0].id] }); expect(straight.results[0].warnings?.[0]).toContain('夹至')
    expect(straight.plan.openings[0].offset).toBe(2500); expect(validatePlan(straight.plan)).toEqual([]); expect(p).toEqual(saved)
  })
  it('多个洞口夹回不重叠，容纳不了则整条更新回滚；单洞宽度可夹到墙长', () => {
    const p = emptyPlan(); p.walls = [wall(270)]; p.openings = [5000, 6500].map((offset, i) => ({ id: `o${i}`, wall: 'w', offset, width: 1000, sill: 0, head: 2, kind: 'doorway' }))
    const result = applyChanges(p, [updateWall('w', { bulge: 0 })]); expect(result.results[0].ok).toBe(true); expect(result.plan.openings.map(o => o.offset)).toEqual([2000, 3000]); expect(validatePlan(result.plan)).toEqual([])
    p.openings.forEach(o => o.width = 2500)
    expect(applyChanges(p, [updateWall('w', { bulge: 0 })]).results[0].ok).toBe(false)
    p.openings = [{ ...p.openings[0], offset: 0, width: 5000 }]
    const single = applyChanges(p, [updateWall('w', { bulge: 0 })]); expect(single.results[0].warnings?.[0]).toContain('宽度'); expect(single.plan.openings[0].width).toBe(4000)
  })
})
