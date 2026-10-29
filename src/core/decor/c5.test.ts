import { describe, expect, it } from 'vitest'
import { authored, cabinet, decorPlan, niche, probeP1, probeP2 } from './fixtures.ts'
import { buildDecorSolids, decorWallSolids, sectionAt } from './solids.ts'
import { buildSolids } from '../solids.ts'
import { furniturePose, furnitureFootprint, furnitureCollisions, furnitureClearances } from './furniture.ts'
import { rehostDecor, decorStatus } from './resolve.ts'
import { validateDecor } from './validate.ts'
import { applyChanges } from '../changes.ts'
import { mirrorPlan } from '../edit.ts'
import { parsePlanText, serializePlan } from '../io.ts'
import { polygonArea, pointInPolygon } from '../geometry.ts'
import { elevationOf } from './elevation.ts'
import { layoutCabinet } from './cabinets.ts'
import { decorHandoff } from './integration.ts'
import { planStats } from '../summary.ts'
import { resolveFinish, materialTakeoff, resolveSurfaces } from './surfaces.ts'
import type { Furniture } from './types.ts'
import type { Plan, Vec2 } from '../types.ts'
const tv = (host = 'tv-hole'): Furniture => ({ id: 'tv', ...authored, type: 'tv', in: host, size: [800, 40], height: .5 })
const area = (polys: Vec2[][][]) => polys.reduce((s, r) => s + polygonArea(r[0]) - r.slice(1).reduce((s, p) => s + polygonArea(p), 0), 0)
function split() {
  const p = decorPlan(); p.decor!.recesses = [niche('n', [4000, 4400])]
  p.changes = [{ id: 'cut', ...authored, op: 'remove', type: 'wall', target: 'w', range: [1500, 3000] }]
  return { p, after: applyChanges(p, p.changes).plan }
}
describe('C5 仅替换受影响墙与切面', () => {
  it('保留结构分组并只报告有凹槽墙，玻璃/窗台/过梁也按墙分组', () => {
    const p = probeP1(); p.walls.push({ ...p.walls[0], id: 'other', a: [0, 2000], b: [6000, 2000] })
    p.openings.push({ id: 'o', wall: 'w', offset: 2000, width: 1000, sill: .9, head: 2, kind: 'window' })
    const out = buildDecorSolids(p), replacements = out.filter(s => s.replaces)
    expect(out.hideWallIds).toEqual(['w'])
    expect(replacements.every(s => s.ids.includes('w') && !s.ids.includes('other') && s.wallKind === 'exterior')).toBe(true)
    expect(replacements.some(s => s.replaces === 'sill')).toBe(true)
    expect(replacements.some(s => s.replaces === 'lintel')).toBe(true)
  })
  it('无效凹槽不替换，未装修返回空隐藏清单', () => {
    const p = probeP1(); p.decor!.recesses[0].depth = 240
    expect(buildDecorSolids(p).hideWallIds).toEqual([])
    expect(buildDecorSolids({ ...p, decor: undefined }).hideWallIds).toEqual([])
  })
  it('1.1m 缺口与 embed 占地一致，严格排除上下端面', () => {
    const p = probeP1(), caps = sectionAt(decorWallSolids(p), 1.1)
    expect(caps.some(s => s.polygons.some(r => pointInPolygon([700, 100], r[0]) && !r.slice(1).some(h => pointInPolygon([700, 100], h))))).toBe(false)
    expect(area(sectionAt(buildSolids(p), 1.1).flatMap(s => s.polygons)) - area(caps.flatMap(s => s.polygons))).toBeCloseTo(400 * 80)
    const s = buildDecorSolids(probeP2()).find(s => s.material)!
    expect(sectionAt([s], s.z0)).toEqual([]); expect(sectionAt([s], s.z1)).toEqual([])
    expect(sectionAt([s], (s.z0 + s.z1) / 2)[0]).toMatchObject({ material: s.material, ids: s.ids, kind: s.kind })
  })
  it('楼层标高和邻墙完全不受嵌入影响', () => {
    const p = probeP1(); p.levels = [{ id: 'up', name: '上层', elevation: 3 }]
    const solids = buildDecorSolids(p)
    expect(solids.filter(s => s.replaces).every(s => s.level === 'up')).toBe(true)
    expect(sectionAt(solids, 1.1)).toEqual([]); expect(sectionAt(solids, 4.1).length).toBeGreaterThan(0)
  })
})
describe('C5 家具仅随宿主和迁移', () => {
  it.each(['tv-hole', 'n', 'cab:cell:0:0'])('%s 宿主移动、平面与3D一致且不补写 at', host => {
    const p = probeP2(); p.decor!.recesses.push(niche()); const c = cabinet(); c.columns = [{ cells: [{ type: 'appliance' }] }]; p.decor!.cabinets = [c]; p.decor!.furniture = [tv(host)]
    const before = furniturePose(p, p.decor!.furniture[0])
    p.walls.forEach(w => { w.a[1] += 100; w.b[1] += 100 })
    const pose = furniturePose(p, p.decor!.furniture[0])
    expect(pose.at[1] - before.at[1]).toBeCloseTo(100)
    expect(furnitureFootprint(p.decor!.furniture[0], p)).toEqual(pose.footprint)
    const solid = buildDecorSolids(p).find(s => s.ids.includes('tv'))!
    expect(solid.polygons).toEqual([[pose.footprint]])
    expect(solid.z0).toBe(pose.z); expect(p.decor!.furniture[0]).not.toHaveProperty('at')
  })
  it('宿主消失后使用缓存的中心/角度/高度并报 missing', () => {
    const p = probeP2(); p.decor!.furniture = [tv()]
    p.decor = rehostDecor(p, p, p.decor!)
    const before = furniturePose(p, p.decor.furniture[0]); p.decor.panels = []
    const after = furniturePose(p, p.decor.furniture[0])
    expect(after).toMatchObject({ at: before.at, rot: before.rot, z: before.z, footprint: before.footprint, missing: true })
    expect(decorStatus(p).items.find(x => x.id === 'tv')?.status).toBe('missing')
  })
  it('in 与 at 同时写入 invalid；读取迁移只去掉 at', () => {
    const p = probeP2(); p.decor!.furniture = [{ ...tv(), at: [1, 2], rot: 0 } as unknown as Furniture]
    expect(validateDecor(p).some(i => i.id === 'tv' && i.code === 'invalid')).toBe(true)
    const parsed = parsePlanText(serializePlan(p))
    expect(parsed.plan.decor!.furniture[0]).not.toHaveProperty('at')
    expect(parsed.report.approximations.join()).toContain('移除旧 at')
    expect(parsePlanText(serializePlan(parsed.plan)).plan).toEqual(parsed.plan)
  })
  it('宿主旋转偏移、楼层、高度碰撞与净距使用统一 pose', () => {
    const p = probeP2(); p.levels = [{ id: 'low', name: '下', elevation: 0 }, { id: 'high', name: '上', elevation: 3 }]; p.walls.forEach(w => w.level = 'high')
    p.decor!.furniture = [tv()]; const f = p.decor!.furniture[0], pose = furniturePose(p, f)
    expect(pose).toMatchObject({ level: 'high', z: .9 })
    p.decor!.furniture.push({ id: 'block', ...authored, type: 'box', at: pose.at, rot: pose.rot, size: [800, 40], height: .5, z: .9, level: 'high' })
    expect(furnitureCollisions(p, f)).toContainEqual({ id: 'block', type: 'furniture' })
    expect(furnitureClearances(p, f).furniture?.intersect).toBe(true)
    p.decor!.furniture[1].z = 2
    expect(furnitureCollisions(p, f).some(x => x.id === 'block')).toBe(false)
    f.rot = 90; expect(furniturePose(p, f).rot - pose.rot).toBe(90)
  })
})
describe('C5 重挂写回、撤销、状态', () => {
  it('派生 id 写回；相同前后再次调用与已写回视图幂等；撤销回原墙', () => {
    const { p, after } = split(), d = rehostDecor(p, after, p.decor!)
    expect(d.recesses[0].host).toEqual({ face: { wall: 'w~cut', side: 1 } })
    expect(d.recesses[0].rect.s).toEqual([1000, 1400])
    expect(rehostDecor(p, after, d)).toEqual(d)
    expect(rehostDecor(after, after, d)).toEqual(d)
    const back = rehostDecor({ ...after, decor: d }, { ...p, changes: [] }, d)
    expect(back.recesses[0].host).toEqual({ face: { wall: 'w', side: 1 } })
    expect(back.recesses[0].rect.s).toEqual([4000, 4400])
  })
  it('原始 base 加已写回装修可计算状态，也可撤销，无重复诊断', () => {
    const { p, after } = split(); p.decor = rehostDecor(p, after, p.decor!)
    expect(decorStatus(p).items[0].status).toBe('placed')
    expect(validateDecor(p).filter(i => i.level === 'error')).toEqual([])
    p.changes = []
    expect(decorStatus(p).items[0].status).toBe('moved')
    p.walls = []
    const state = decorStatus(p)
    expect(state.items[0].status).toBe('missing')
    expect(validateDecor(p)).toEqual(state.issues)
    expect(state.issues.filter(i => i.id === 'n' && i.code === 'host-missing')).toHaveLength(1)
  })
  it('跨断口与超范围保留数据；pending 改造不影响宿主', () => {
    const { p } = split(); p.decor!.recesses[0].rect.s = [1000, 2000]
    expect(decorStatus(p).items[0].status).toBe('missing')
    expect(decorStatus(p).issues.some(i => i.code === 'host-cut')).toBe(true)
    p.changes[0].status = 'pending'
    expect(decorStatus(p).items[0].status).toBe('placed')
  })
  it.each(['x', 'y'] as const)('%s 双镜像含宿主家具、cache、派生 id，JSON 中途往返精确', axis => {
    const { p, after } = split(); p.decor!.furniture = [tv('n')]; p.decor = rehostDecor(p, after, p.decor!)
    const once = mirrorPlan(p, axis), restored = mirrorPlan(parsePlanText(serializePlan(once)).plan, axis)
    expect(restored).toEqual(p)
  })
})
describe('C5 立面、材料、裁切和交接', () => {
  it('跨房间取景、平行梁、已拆墙、靠墙自由家具和踢脚线', () => {
    const p = decorPlan(); p.rooms = [
      { id: 'r1', name: '客厅', poly: [[0, 120], [3000, 120], [3000, 3000], [0, 3000]] },
      { id: 'r2', name: '书房', poly: [[3000, 120], [6000, 120], [6000, 3000], [3000, 3000]] },
    ]
    const c = cabinet(); c.width = 1000; c.place = { face: { wall: 'w', side: 1 }, s: 4000 }; c.columns = [{ cells: [{ type: 'door' }] }]; p.decor!.cabinets = [c]
    p.decor!.furniture = [{ id: 'chair', ...authored, type: 'chair', at: [1000, 500], rot: 0, size: [400, 400], height: .8 }]
    p.beams = [{ id: 'parallel', a: [0, 500], b: [6000, 500], width: 200, bottom: 2.5 }]
    p.openings = [{ id: 'door', wall: 'w', offset: 1000, width: 800, sill: 0, head: 2, kind: 'doorway' }]
    const base = structuredClone(p); base.walls.push({ id: 'gone', a: [3000, 0], b: [3000, 2000], thickness: 120, kind: 'partition' })
    const e = elevationOf(p, 'w', 1, base)
    expect(e.segments).toHaveLength(2); expect(e.focus).toEqual([3000, 6000])
    expect(e.beams.find(b => b.id === 'parallel')?.kind).toBe('parallel')
    expect(e.removed).toContainEqual({ u: 3000, t: 120 })
    expect(e.furniture.find(f => f.f.id === 'chair')?.held).toBe(false)
    expect(e.skirting.every(s => s.u[1] <= 1000 || s.u[0] >= 1800)).toBe(true)
  })
  it('跨墙链反侧取景及局部洞家具都在同一 u 坐标系', () => {
    const p = probeP2(); p.decor!.furniture = [tv()]
    const e = elevationOf(p, 'w', 1), pose = furniturePose(p, p.decor!.furniture[0])
    expect(e.items.find(i => i.id === 'tv')?.u).toEqual([pose.at[0] - 400, pose.at[0] + 400])
    expect(elevationOf(p, 'w', -1).u).toEqual([-3000, 3000])
  })
  it('平台材料、默认材料、预览风格、覆盖身份和精确面积均可替代 UI', () => {
    const p = decorPlan(); p.rooms = [{ id: 'r', name: '窗台', floorOffset: .3, counted: false, poly: [[0, 120], [1000, 120], [1000, 1120], [0, 1120]] }]
    const before = resolveFinish(p, { floor: 'r' })
    expect(before.role).toBe('stone.top')
    p.decor!.surfaces.push({ id: 's', ...authored, target: { floor: 'r' }, material: 'forest' })
    expect(resolveFinish(p, { floor: 'r' })).toMatchObject({ materialId: 'forest', surfaceItem: { id: 's' }, styleMaterial: before.material })
    expect(resolveFinish(p, { floor: 'r' }, { keep: false }).material).toEqual(before.material)
    expect(resolveSurfaces(p).floors[0].area).toBe(1)
    expect(materialTakeoff(p).find(m => m.materialId === 'forest')?.floor).toBe(1)
  })
  it.each([[[800, 1200], [.4, 1.2]], [[200, 700], [.7, 1.3]]] as const)('跨格洞 %j 门板/抽屉正面输出裁后多边形', (u, z) => {
    const c = cabinet(); c.width = 2000; c.z = [0, 2]; c.plinth = 0
    c.columns = [{ width: 1000, cells: [{ h: 1, type: 'drawers', count: 2 }, { type: 'door' }] }, { cells: [{ type: 'door' }] }]
    c.cuts = [{ u: [...u], z: [...z], depth: 50 }]
    const l = layoutCabinet(c), fronts = l.parts.filter(p => p.kind === 'front')
    expect(fronts.length).toBe(4)
    for (const part of fronts) {
      expect(part.polygons).toHaveLength(part.pieces.length)
      for (const piece of part.pieces) expect(Math.min(piece.u[1], u[1]) <= Math.max(piece.u[0], u[0]) || Math.min(piece.z[1], z[1]) <= Math.max(piece.z[0], z[0])).toBe(true)
    }
    expect(fronts.reduce((s, p) => s + area(p.polygons), 0)).toBeLessThan(fronts.reduce((s, p) => s + (p.u[1] - p.u[0]) * (p.z[1] - p.z[0]), 0))
  })
  it('交接接受 id 列表并保留缺失引用', () => {
    const p = probeP2(), text = decorHandoff(p, ['panel', 'tv-hole', 'absent'])
    expect(text).toContain('panel'); expect(text).toContain('tv-hole'); expect(text).toContain('absent：不存在')
  })
})
function terrace(levels = 1): Plan {
  const p = decorPlan(); p.decor = undefined; p.walls = []; p.rooms = []
  if (levels > 1) p.levels = Array.from({ length: levels }, (_, i) => ({ id: 'L' + i, name: String(i), elevation: i * 3 }))
  for (let i = 0; i < levels; i++) {
    const level = levels > 1 ? 'L' + i : undefined
    p.rooms.push({ id: 'inside' + i, name: '房间', level, poly: [[0, 0], [2000, 0], [2000, 2000], [0, 2000]] })
    p.rooms.push({ id: 'terrace' + i, name: '露台', level, counted: false, poly: [[2000, 0], [4000, 0], [4000, 2000], [2000, 2000]] })
    p.walls.push({ id: 'rail' + i, level, a: [4100, 0], b: [4100, 2000], thickness: 200, kind: 'half' })
  }
  return p
}
describe('C5 面积排除', () => {
  it.each([1, 2])('%i 层露台及只围露台的栏板不计 gross，excluded 单列', levels => {
    const p = terrace(levels), s = planStats(p)
    expect(s.netArea).toBe(4 * levels); expect(s.grossArea).toBe(4 * levels); expect(s.excludedArea).toBe(4 * levels)
    expect(s.excludedRooms).toHaveLength(levels)
    s.byLevel?.forEach(l => expect(l).toMatchObject({ netArea: 4, grossArea: 4, excludedArea: 4 }))
  })
  it('只有中间层露台不误扣上下层同投影房间，共用墙仍计入', () => {
    const p = terrace(3); p.rooms = p.rooms.filter(r => r.id === 'terrace1' || r.id !== 'inside1' && !r.id.startsWith('terrace'))
    p.walls = p.walls.filter(w => w.id === 'rail1')
    const s = planStats(p); expect(s.netArea).toBe(8); expect(s.grossArea).toBe(8); expect(s.excludedArea).toBe(4)
    expect(s.byLevel?.map(l => l.grossArea)).toEqual([4, 0, 4])
    const shared = terrace(); shared.rooms[0].poly[1][0] = 1900; shared.rooms[0].poly[2][0] = 1900
    shared.rooms[1].poly[0][0] = 2100; shared.rooms[1].poly[3][0] = 2100
    shared.walls.push({ id: 'shared', a: [2000, 0], b: [2000, 2000], thickness: 200, kind: 'partition' })
    expect(planStats(shared).grossArea).toBe(4.2)
  })
})

describe('C5 写回边界与镜像几何', () => {
  it('拆头保留原 id 也能撤销还原 s，连续调用不重复偏移', () => {
    const { p } = split(); p.changes[0] = { ...p.changes[0], range: [0, 3000] } as typeof p.changes[number]
    const after = applyChanges(p, p.changes).plan, d = rehostDecor(p, after, p.decor!)
    expect(d.recesses[0].rect.s).toEqual([1000, 1400])
    expect(rehostDecor(p, after, d)).toEqual(d)
    const restored = rehostDecor(after, { ...p, changes: [] }, d)
    expect(restored.recesses[0].rect.s).toEqual([4000, 4400])
  })
  it('第一次拆除即缓存家具最后姿态，3D 提供 missing 幽灵', () => {
    const p = probeP2(); p.decor!.furniture = [tv()]
    const before = furniturePose(p, p.decor!.furniture[0])
    const after = { ...p, walls: [] }; after.decor = rehostDecor(p, after, p.decor!)
    expect(furniturePose(after, after.decor.furniture[0])).toMatchObject({ at: before.at, z: before.z, missing: true })
    expect(buildDecorSolids(after).find(s => s.ids.includes('tv'))).toMatchObject({ missing: true, polygons: [[before.footprint]] })
  })
  it('写回后的单次镜像保持挂接位置与几何镜像一致', () => {
    const { p, after } = split(); p.decor!.furniture = [tv('n')]; p.decor = rehostDecor(p, after, p.decor!)
    const mirrored = mirrorPlan(p, 'x'), status = decorStatus(mirrored), source = decorStatus(p)
    const original = source.items.find(i => i.id === 'tv')!.footprint, fp = status.items.find(i => i.id === 'tv')!.footprint
    expect(status.items.every(i => i.status !== 'missing')).toBe(true)
    expect(Math.min(...fp.map(p => p[0]))).toBeCloseTo(6000 - Math.max(...original.map(p => p[0])))
  })
})

describe('C5 最终适配回归', () => {
  it('柜格镜像同步列引用，一次镜像保持世界几何，双镜像精确恢复', () => {
    const p = decorPlan(), c = cabinet(); c.columns = [{ width: 900, cells: [{ type: 'appliance' }] }, { cells: [{ type: 'door' }] }]; p.decor!.cabinets = [c]; p.decor!.furniture = [tv('cab:cell:0:0')]
    const pose = furniturePose(p, p.decor!.furniture[0]), once = mirrorPlan(p, 'x')
    expect(once.decor!.furniture[0].in).toBe('cab:cell:1:0')
    const other = furniturePose(once, once.decor!.furniture[0])
    expect(other.at[0]).toBeCloseTo(6000 - pose.at[0]); expect(other.at[1]).toBeCloseTo(pose.at[1])
    expect(mirrorPlan(parsePlanText(serializePlan(once)).plan, 'x')).toEqual(p)
  })
  it('显式踢脚线覆盖保留材质，默认色与原界面一致；材料表附用途和数量', () => {
    const p = probeP2(); p.decor!.panels[0].type = 'skirting'; p.decor!.panels[0].span!.s = [500, 1500]; p.decor!.panels[0].span!.z = [0, .1]
    const e = elevationOf(p, 'w', 1)
    expect(e.skirting.some(s => s.material.id === 'micro' && s.u[0] === 500 && s.u[1] === 1500)).toBe(true)
    expect(resolveFinish({ ...p, decor: undefined }, { face: { wall: 'w', side: 1 } }).material.color).toBe('#f3f2ef')
    p.decor!.cabinets = [cabinet()]
    const q = materialTakeoff(p).find(x => x.materialId === 'creamDoor')!
    expect(q.count).toBe(1); expect(q.where).toContain('w（正侧·上）·cab')
    expect(materialTakeoff(p, { keep: false, styleId: 'minimal' }).length).toBeGreaterThan(0)
  })
  it('跨共线墙的家具淡显及平行梁合并完整投影', () => {
    const p = probeP2(); p.decor!.panels = []; p.decor!.recesses = []
    p.beams = [{ id: 'parallel', a: [0, 500], b: [6000, 500], width: 200, bottom: 2.5 }]
    p.decor!.furniture = [{ id: 'desk', ...authored, type: 'desk', at: [3000, 400], rot: 0, size: [1000, 300], height: .8 }]
    const e = elevationOf(p, 'w', 1)
    expect(e.beams[0].u).toEqual([0, 6000])
    expect(e.furniture[0].u).toEqual([2500, 3500])
  })
})
