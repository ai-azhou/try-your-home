import { readFileSync } from 'node:fs'
import clipping from 'polygon-clipping'
import { describe, expect, it } from 'vitest'
import type { Change, Plan, Vec2, Wall } from './types.ts'
import { emptyPlan } from './io.ts'
import { joinedWallFootprint, wallFootprints, wallOutlines } from './walls.ts'
import { pointInPolygon, polygonArea, wallFootprint } from './geometry.ts'
import { buildSolids, unionPolygons } from './solids.ts'
import { planStats } from './summary.ts'
import { applyChanges } from './changes.ts'
import { bakeChange, mirrorPlan, moveJoint, updateBeam, updateWall } from './edit.ts'
import { emptyHistory, recordHistory, stepHistory } from './history.ts'
import { validatePlan } from './validate.ts'

const wall = (id: string, a: Vec2, b: Vec2, thickness = 200): Wall => ({ id, a, b, thickness, kind: 'partition' })
const area = (polys: Vec2[][][]) => polys.reduce((sum, rings) => sum + polygonArea(rings[0]) - rings.slice(1).reduce((n, p) => n + polygonArea(p), 0), 0)
const includes = (polys: Vec2[][][], p: Vec2) => polys.some(rings => pointInPolygon(p, rings[0]) && !rings.slice(1).some(r => pointInPolygon(p, r)))
const rectPlan = () => {
  const p = emptyPlan(), points: Vec2[] = [[0, 0], [4000, 0], [4000, 3000], [0, 3000]]
  p.walls = points.map((a, i) => wall(`w${i}`, a, points[(i + 1) % points.length]))
  p.rooms = [{ id: 'r', name: '房间', poly: [[100, 100], [3900, 100], [3900, 2900], [100, 2900]] }]
  return p
}
const geometry = (p: Plan) => ({ walls: p.walls, openings: p.openings, beams: p.beams, rooms: p.rooms, changes: p.changes })

describe('C2 joined wall footprints', () => {
  it('L 外角补满，过滤仍保留交接上下文，2D 和 3D 共用足迹', () => {
    const p = emptyPlan(); p.walls = [wall('a', [0, 0], [2000, 0]), wall('b', [0, 0], [0, 2000])]
    const outline = wallOutlines(p)
    expect(includes(outline, [-99, -99])).toBe(true)
    expect(area(outline)).toBeCloseTo(800000)
    const filtered = unionPolygons(p.walls.flatMap(w => wallOutlines(p, x => x.id === w.id)))
    expect(area(clipping.xor(outline, filtered) as Vec2[][][])).toBeLessThan(.001)
    expect(area(clipping.xor(outline, unionPolygons(buildSolids(p).flatMap(s => s.polygons))) as Vec2[][][])).toBeLessThan(.001)
  })
  it.each([30, 60, 120, 150])('任意 %s° 交角在偏移线交点斜接，不用直角延长近似', degrees => {
    const p = emptyPlan(), angle = degrees * Math.PI / 180
    p.walls = [wall('a', [0, 0], [3000, 0]), wall('b', [0, 0], [3000 * Math.cos(angle), 3000 * Math.sin(angle)])]
    const tip: Vec2 = [-100 / Math.tan(angle / 2), -100]
    expect(includes(wallOutlines(p), [tip[0] * .999, tip[1] * .999])).toBe(true)
    const baseArea = area(unionPolygons(p.walls.map(w => [wallFootprint(w)])))
    expect(area(wallOutlines(p))).toBeGreaterThan(baseArea)
  })
  it('尖角斜接改 bevel，有界且无 NaN；弧墙端点仍能连接', () => {
    const p = emptyPlan(); p.walls = [wall('a', [0, 0], [3000, 0]), wall('b', [0, 0], [3000, 30])]
    const points = wallOutlines(p).flat(2)
    expect(points.flat().every(Number.isFinite)).toBe(true)
    expect(Math.min(...points.map(v => v[0]))).toBeGreaterThan(-400)
    p.walls[1] = { ...wall('b', [0, 0], [0, 3000]), bulge: 300 }
    expect(wallOutlines(p)).toHaveLength(1)
  })
  it('不同厚度、反向端点、共线和 T 形接缝不延长主墙', () => {
    const p = emptyPlan(); p.walls = [wall('a', [-2000, 0], [0, 0]), wall('b', [0, 0], [2000, 0], 300)]
    expect(wallOutlines(p)).toHaveLength(1)
    expect(area(wallOutlines(p))).toBeCloseTo(1000000)
    p.walls.push(wall('stem', [0, 2000], [0, 0], 120))
    expect(joinedWallFootprint(p, p.walls[0])).toEqual(joinedWallFootprint({ ...p, walls: [p.walls[0]] }, p.walls[0]))
    const t = emptyPlan(); t.walls = [wall('host', [-2000, 0], [2000, 0]), wall('stem', [0, 0], [0, 2000])]
    expect(joinedWallFootprint(t, t.walls[0])).toEqual(joinedWallFootprint({ ...t, walls: [t.walls[0]] }, t.walls[0]))
  })
  it('门窗留空，原始 offset 不移动，端点切片才带斜接', () => {
    const p = rectPlan(); p.openings = [{ id: 'o', wall: 'w0', offset: 500, width: 800, sill: .9, head: 2.2, kind: 'window' }]
    const before = structuredClone(p)
    expect(includes(wallOutlines(p), [800, 0])).toBe(false)
    expect(includes(wallFootprints(p), [800, 0])).toBe(true)
    expect(area(joinedWallFootprint(p, p.walls[0], 500, 1000))).toBeCloseTo(100000)
    buildSolids(p); expect(p).toEqual(before)
  })
})

describe('C2 local solid heights and areas', () => {
  it('无关窗台、洞顶、梁底、矮墙和其他房高不切分一面完整墙', () => {
    const p = emptyPlan(); p.walls = [wall('plain', [0, 0], [5000, 0]), { ...wall('window', [0, 2000], [5000, 2000]), height: 3.5 }, { ...wall('half', [0, 4000], [5000, 4000]), kind: 'half-glass', lowHeight: 1.2 }]
    p.openings = [{ id: 'o', wall: 'window', offset: 1000, width: 1000, sill: .9, head: 2.1, kind: 'window' }]
    p.beams = [{ id: 'b', a: [0, 3000], b: [5000, 3000], width: 200, bottom: 2.5 }]
    const solids = buildSolids(p), plain = solids.filter(s => s.ids.includes('plain'))
    expect(plain).toHaveLength(1); expect(plain[0]).toMatchObject({ z0: 0, z1: 2.8 })
    expect(solids.filter(s => s.ids.includes('window') && !s.ids.includes('o')).every(s => s.z0 === 0 && s.z1 === 3.5)).toBe(true)
  })
  it('不同高度交叉墙和梁体积去重，未相交部分保留整高', () => {
    const p = emptyPlan(); p.walls = [wall('a', [-2000, 0], [2000, 0]), { ...wall('b', [0, -2000], [0, 2000]), height: 3.3 }]
    p.beams = [{ id: 'beam', a: [-1500, -1000], b: [-1500, 1000], width: 200, bottom: 2.5 }]
    const solids = buildSolids(p)
    for (let i = 0; i < solids.length; i++) for (let j = i + 1; j < solids.length; j++) {
      if (Math.min(solids[i].z1, solids[j].z1) > Math.max(solids[i].z0, solids[j].z0)) expect(area(clipping.intersection(solids[i].polygons, solids[j].polygons) as Vec2[][][])).toBeLessThan(.001)
    }
    expect(solids.find(s => s.ids.includes('b') && includes(s.polygons, [0, 1000]))).toMatchObject({ z0: 0, z1: 3.3 })
  })
  it('net/area 计入房间之和，gross 填内孔，wall 去重；未计入房间及只围着它的墙不进含墙面积（C5 #13）', () => {
    const p = rectPlan()
    expect(planStats(p)).toMatchObject({ netArea: 10.6, area: 10.6, grossArea: 13.4, wallArea: 2.8 })
    p.rooms[0].counted = false
    expect(planStats(p)).toMatchObject({ netArea: 0, area: 0, grossArea: 0, wallArea: 2.8, excludedArea: 10.6 })
    p.rooms.push({ id: 'detached', name: '平台', counted: false, poly: [[10000, 0], [11000, 0], [11000, 1000], [10000, 1000]] })
    expect(planStats(p).grossArea).toBe(0)
    p.walls.push({ ...p.walls[0], id: 'duplicate' })
    expect(planStats(p).wallArea).toBe(2.8)
    expect(planStats(emptyPlan())).toMatchObject({ netArea: 0, grossArea: 0, wallArea: 0 })
  })
})

describe('C2 edits and mirrors', () => {
  it('公开样例拖外墙角，房间面积跟随变化，不自交，整组可重放', () => {
    const p = JSON.parse(readFileSync(new URL('../../fixtures/example-v2.json', import.meta.url), 'utf8')) as Plan
    const before = structuredClone(p), changes = moveJoint(p, [7100, 200], [7300, 100])
    expect(changes.some(c => c.type === 'room')).toBe(true)
    expect(new Set(changes.map(c => c.group)).size).toBe(1)
    expect(applyChanges(p, changes).results.some(r => r.needsConfirm)).toBe(true)
    const result = applyChanges(p, changes.map(c => ({ ...c, confirm: { by: 'owner' } })))
    expect(result.results.every(r => r.ok)).toBe(true)
    expect(planStats(result.plan).netArea).not.toBe(planStats(p).netArea)
    expect(validatePlan(result.plan).filter(i => i.code.includes('self'))).toEqual([])
    expect(result.plan.rooms.find(r => r.id === 'r3')!.poly[1]).toEqual([7200, 100])
    expect(p).toEqual(before)
  })
  it('内角对角顶点也在两面墙厚度容差范围，远处顶点不动', () => {
    const p = rectPlan(), changes = moveJoint(p, [0, 0], [-100, -100])
    expect(changes.filter(c => c.type === 'wall')).toHaveLength(2)
    const room = changes.find(c => c.type === 'room')!
    expect(room.data!.poly).toEqual([[0, 0], [3900, 100], [3900, 2900], [100, 2900]])
    expect(moveJoint(p, [500, 500], [600, 600])).toEqual([])
  })
  it('updateBeam 和 updateWall 一样生成可校验、可重放的局部更新', () => {
    const p = emptyPlan(); p.beams = [{ id: 'beam', a: [0, 0], b: [2000, 0], width: 200, bottom: 2.4 }]
    const c = updateBeam('beam', { b: [2500, 0], width: 300, bottom: 2.3 })
    expect(c).toMatchObject({ op: 'update', type: 'beam', target: 'beam', by: 'user', status: 'confirmed' })
    expect(bakeChange(p, c).beams[0]).toMatchObject({ b: [2500, 0], width: 300, bottom: 2.3 })
    expect(() => bakeChange(p, updateBeam('beam', { width: -1 }))).toThrow()
  })
  it.each(['x', 'y'] as const)('%s 镜像与重放交换，涵盖完整 add、局部 update、拆段及扩大外包框', axis => {
    const p = rectPlan()
    const c = (id: string, op: Change['op'], type: Change['type'], data?: Change['data'], target?: string): Change => ({ id, op, type, data, target, by: 'user', status: 'confirmed' })
    p.changes = [
      c('cw', 'add', 'wall', { ...wall('new', [6000, 4000], [9000, 4000]), bulge: 300 }),
      c('uw', 'update', 'wall', { a: [6500, 4200], b: [10000, 4200], bulge: -500 }, 'new'),
      c('cb', 'add', 'beam', { id: 'beam', a: [200, 300], b: [2500, 300], width: 200, bottom: 2.5 }),
      c('ub', 'update', 'beam', { a: [300, 400], b: [2800, 400] }, 'beam'),
      c('cr', 'add', 'room', { id: 'newroom', name: '房', poly: [[6000, 4000], [7000, 4000], [7000, 5000]] }),
      c('ur', 'update', 'room', { poly: [[6000, 4000], [8000, 4000], [8000, 5000]] }, 'newroom'),
      c('co', 'add', 'opening', { id: 'door', wall: 'w0', offset: 1000, width: 800, kind: 'door', sill: 0, head: 2.1, swing: { hinge: 'end', side: 1 } }),
      c('uo', 'update', 'opening', { swing: { hinge: 'start', side: -1 } }, 'door'),
      { ...c('cut', 'remove', 'wall', undefined, 'w1'), range: [500, 1000] },
    ]
    const mirrored = mirrorPlan(p, axis), left = applyChanges(mirrored, mirrored.changes), applied = applyChanges(p, p.changes)
    expect(left.results.every(r => r.ok)).toBe(true); expect(applied.results.every(r => r.ok)).toBe(true)
    const right = mirrorPlan(JSON.parse(JSON.stringify(applied.plan)), axis)
    expect(geometry(left.plan)).toEqual(geometry(right))
    expect(mirrorPlan(JSON.parse(JSON.stringify(mirrored)), axis)).toEqual(p)
  })
  it('默认门开向也镜像、changes-only 方案可镜像；partial swing 不变成 NaN', () => {
    const p = emptyPlan(); p.changes = [{ id: 'a', op: 'add', type: 'wall', data: { ...wall('a', [10, 20], [2010, 20]) }, by: 'user', status: 'confirmed' }]
    expect(mirrorPlan(p, 'x').changes[0].data!.a).toEqual([2010, 20])
    const q = rectPlan(); q.openings = [{ id: 'd', wall: 'w0', offset: 100, width: 800, kind: 'door', sill: 0, head: 2.1 }]
    expect(mirrorPlan(q, 'x').openings[0].swing?.side).toBe(-1)
    expect(mirrorPlan(mirrorPlan(q, 'x'), 'x')).toEqual(q)
    q.changes = [{ id: 'side', op: 'update', type: 'opening', target: 'd', data: { swing: { side: -1 } }, by: 'user', status: 'confirmed' }]
    expect(mirrorPlan(q, 'y').changes[0].data!.swing).toEqual({ side: 1 })
  })
  it('整份方案统一历史：镜像、原始编辑、改造编辑跨模式撤回和重做', () => {
    const p = rectPlan(); p.changes = [updateWall('w0', { thickness: 300 })]
    const m = mirrorPlan(p, 'x'), h1 = recordHistory(emptyHistory(), p)
    const edit = { ...m, changes: [...m.changes, updateWall('w1', { thickness: 150 })] }
    const h2 = recordHistory(h1, m), undoEdit = stepHistory(h2, edit, 'undo')!
    expect(undoEdit.plan).toEqual(m)
    const undoMirror = stepHistory(undoEdit.history, undoEdit.plan, 'undo')!
    expect(undoMirror.plan).toEqual(p)
    const redoMirror = stepHistory(undoMirror.history, undoMirror.plan, 'redo')!
    expect(redoMirror.plan).toEqual(m)
    expect(stepHistory(redoMirror.history, redoMirror.plan, 'redo')!.plan).toEqual(edit)
  })
})
