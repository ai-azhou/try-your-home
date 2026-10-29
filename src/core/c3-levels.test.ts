import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Plan, Vec2 } from './types.ts'
import { emptyPlan, newId, parsePlanText, serializePlan } from './io.ts'
import { levelCeiling, levelOf, levelsOf, onLevel } from './levels.ts'
import { buildFixtures, buildSolids } from './solids.ts'
import { columnFootprint, effectiveWallHeight, hitTest, hitTestExtra, planBounds, pointInPolygon, polygonArea } from './geometry.ts'
import { detectRoom, mirrorPlan, shaftRemovalError, updateRoom } from './edit.ts'
import { applyChanges } from './changes.ts'
import { wallOutlines } from './walls.ts'
import { validatePlan } from './validate.ts'
import { planStats } from './summary.ts'
import { agentHandoff } from './handoff.ts'
import { mergeByKind, solidToGeometry } from '../three/geometry.ts'
const rect = (x = 0, y = 0, w = 4000, h = 4000): Vec2[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
const duplex = (): Plan => ({ ...emptyPlan(), levels: [{ id: 'ground', name: '1F', elevation: 0, ceiling: 2.9 }, { id: 'upper', name: '2F', elevation: 3.2, ceiling: 2.6 }],
  walls: [{ id: 'w1', a: [0, 0], b: [4000, 0], thickness: 200, kind: 'partition' }, { id: 'w2', level: 'upper', a: [0, 0], b: [4000, 0], thickness: 200, kind: 'partition' }],
  rooms: [{ id: 'r1', name: '下', poly: rect(), floorOffset: -.05 }, { id: 'r2', level: 'upper', name: '上', poly: rect() }],
  openings: [{ id: 'o', wall: 'w2', offset: 1000, width: 1000, kind: 'window', sill: .8, head: 2.2 }],
  columns: [{ id: 'col', level: 'upper', center: [3000, 3000], shape: 'rect', size: [300, 500], rotation: 30, kind: 'bearing' }],
  shafts: [{ id: 'shaft', poly: rect(3000, 2000, 400, 400), kind: 'flue' }],
  stairs: [{ id: 'stairs', level: 'ground', to: 'upper', poly: rect(0, 1000, 3000, 1000), path: [[0, 1500], [3000, 1500]], width: 1000, kind: 'straight', steps: 16 }],
  voids: [{ id: 'void', level: 'upper', poly: rect(0, 1000, 3000, 1000) }],
})
const covers = (s: ReturnType<typeof buildSolids>[number], p: Vec2) => s.polygons.some(poly => pointInPolygon(p, poly[0]) && !poly.slice(1).some(h => pointInPolygon(p, h)))
describe('C3 楼层与结构构件', () => {
  it('默认楼层、洞口跟宿主、层高和只读按层视图', () => {
    expect(levelsOf(emptyPlan())).toEqual([{ id: 'L1', name: '1F', elevation: 0 }])
    const p = duplex(), saved = structuredClone(p)
    expect(levelOf(p, p.walls[0]).id).toBe('ground'); expect(levelOf(p, p.openings[0]).name).toBe('2F')
    expect(levelCeiling(p, 'upper')).toBe(2.6)
    const upper = onLevel(p, 'upper'); expect(upper.walls.map(w => w.id)).toEqual(['w2']); expect(upper.openings.map(o => o.id)).toEqual(['o']); expect(upper.shafts).toEqual([])
    expect(onLevel(p, 'missing').walls).toEqual([]); expect(p).toEqual(saved)
    expect(validatePlan(p)).toEqual([])
  })
  it('各层实体、门窗绝对标高正确；降板、上层 120mm 楼板和挑空', () => {
    const p = duplex(), s = buildSolids(p)
    expect(s.every(s => s.level)).toBe(true)
    expect(s.find(s => s.ids[0] === 'w1')).toMatchObject({ z0: 0, z1: 2.9, level: 'ground' })
    expect(s.find(s => s.ids[0] === 'w2' && s.kind === 'wall')).toMatchObject({ z0: 3.2, level: 'upper' })
    expect(s.find(s => s.ids[0] === 'w2' && s.kind === 'wall')?.z1).toBeCloseTo(5.8)
    expect(s.find(s => s.kind === 'floor')).toMatchObject({ z0: -.13, z1: -.05 })
    const slabs = s.filter(s => s.kind === 'slab'); expect(slabs.length).toBeGreaterThan(0)
    slabs.forEach(s => { expect(s.z1 - s.z0).toBeCloseTo(.12); expect(covers(s, [1500, 1500])).toBe(false) })
    expect(slabs.some(s => covers(s, [3500, 3500]))).toBe(true)
    expect(buildFixtures(p)[0]).toMatchObject({ level: 'upper', z0: 4, z1: 5.4 })
    expect(applyChanges(p, [updateRoom('r1', { floorOffset: -.12 })]).results[0].ok).toBe(true)
    p.rooms[1].floorOffset = -.1
    expect(buildSolids(p).find(s => s.kind === 'slab' && s.ids[0] === 'r2')?.z1).toBeCloseTo(3.1)
  })
  it('楼梯按路径给踏步，目标高度、柱和管井整高，几何可三角化', () => {
    const p = duplex(), solids = buildSolids(p), stairs = solids.filter(s => s.kind === 'stair')
    expect(stairs).toHaveLength(16); expect(stairs[0].z1).toBeCloseTo(.2); expect(stairs.at(-1)?.z1).toBe(3.2)
    expect(stairs[0].polygons[0][0].every(p => p[0] <= 187.5 + 1e-6)).toBe(true)
    expect(solids.find(s => s.kind === 'column')).toMatchObject({ level: 'upper', z0: 3.2 })
    expect(solids.find(s => s.kind === 'column')?.z1).toBeCloseTo(5.8)
    expect(solids.find(s => s.kind === 'shaft')).toMatchObject({ level: 'ground', z0: 0, z1: 2.9 })
    for (const s of solids.filter(s => ['stair', 'column', 'shaft', 'slab'].includes(s.kind))) { const g = solidToGeometry(s); expect([...g.getAttribute('position').array].every(Number.isFinite)).toBe(true); g.dispose() }
    const merged = mergeByKind(solids); expect(Object.keys(merged)).toEqual(expect.arrayContaining(['slab', 'stair', 'column', 'shaft'])); Object.values(merged).forEach(g => g.dispose())
    delete p.stairs![0].steps; expect(buildSolids(p).filter(s => s.kind === 'stair')).toHaveLength(19)
  })
  it('折线楼梯在转角按路径分段，踏步限制在占地内', () => {
    const p = duplex(), stair = p.stairs![0]; stair.kind = 'L'; stair.poly = rect(0, 0, 4000, 4000); stair.path = [[0, 500], [2000, 500], [2000, 3500]]; stair.steps = 7
    const s = buildSolids(p).filter(s => s.kind === 'stair'); expect(s).toHaveLength(7); expect(s.at(-1)?.z1).toBe(3.2)
    expect(s.every(s => s.polygons.flat(2).every(v => pointInPolygon(v, stair.poly)))).toBe(true)
  })
  it('上下层房间不混用层高，墙角斜接和封闭识别按层隔离', () => {
    const p = duplex(); p.rooms[1].ceiling = 8
    expect(effectiveWallHeight(p, p.walls[0])).toBe(2.9); expect(effectiveWallHeight(p, p.walls[1])).toBe(8)
    const outline = rect()
    p.walls = outline.map((a, i) => ({ id: `box${i}`, a, b: outline[(i + 1) % 4], kind: 'partition', thickness: 100 }))
    p.walls.push({ id: 'cross', level: 'upper', a: [0, 0], b: [4000, 4000], kind: 'partition', thickness: 400 })
    expect(wallOutlines(p, 'ground')).toEqual(wallOutlines(onLevel(p, 'ground')))
    expect(wallOutlines(p, () => true, 'upper')).toEqual(wallOutlines(onLevel(p, 'upper')))
    expect(detectRoom(p, [1000, 2000], 'ground')).not.toBeNull(); expect(detectRoom(p, [1000, 2000], 'upper')).toBeNull()
  })
  it('新构件点选独立于旧 hitTest，支持旋转柱、圆柱、容差及楼层', () => {
    const p = duplex()
    expect(hitTestExtra(p, [3000, 3000], 0, 'upper')).toEqual({ type: 'column', id: 'col' })
    expect(hitTestExtra(p, [3200, 2200], 0, 'ground')).toEqual({ type: 'shaft', id: 'shaft' })
    expect(hitTestExtra(p, [1500, 1500], 0, 'ground')).toEqual({ type: 'stair', id: 'stairs' })
    expect(hitTestExtra(p, [1500, 1500], 0, 'upper')).toEqual({ type: 'void', id: 'void' })
    expect(hitTest(p, [3000, 3000])?.type).toBe('room')
    p.columns = [{ id: 'round', center: [6000, 6000], size: [400, 400], shape: 'round', kind: 'decorative' }]
    expect(polygonArea(columnFootprint(p.columns[0]))).toBeCloseTo(Math.PI * 200 ** 2, -3)
    expect(hitTestExtra(p, [6210, 6000], 11)?.id).toBe('round'); expect(hitTestExtra(p, [6210, 6000], 0)).toBeNull()
  })
  it.each(['x', 'y'] as const)('%s 镜像覆盖中心、角度、poly/path、分层底图，往返可恢复', axis => {
    const p = duplex(); p.levelUnderlays = { upper: { src: './upper.png', origin: [10, 20], mmPerPx: 2, rotation: 25, opacity: 50, visible: true } }
    const m = mirrorPlan(p, axis), index = axis === 'x' ? 0 : 1, bounds = planBounds(p)!, sum = bounds[index] + bounds[index + 2]
    expect(m.columns![0].center[index]).toBeCloseTo(sum - p.columns![0].center[index]); expect(m.columns![0].rotation).toBe(-30)
    expect(m.stairs![0].path[0][index]).toBeCloseTo(sum - p.stairs![0].path[0][index])
    expect(m.voids![0].poly[0][index]).toBeCloseTo(sum - p.voids![0].poly[0][index])
    expect(mirrorPlan(m, axis)).toEqual(p)
  })
  it('统计按层累加而非将上下层投影并集；原有计数字段含义不变', () => {
    const p = duplex(), s = planStats(p)
    expect(s).toMatchObject({ netArea: 32, area: 32, walls: 2, openings: 1, rooms: 2, columns: 1, shafts: 1, stairs: 1, voids: 1 })
    expect(s.byLevel?.map(l => [l.id, l.netArea, l.grossArea])).toEqual([['ground', 16, 16.4], ['upper', 16, 16.4]])
    expect(s.grossArea).toBe(32.8)
    const text = agentHandoff(p, [{ type: 'opening', id: 'o' }, { type: 'shaft', id: 'shaft' }], '核对', { mode: 'original' })
    expect(text).toContain('2F（upper）'); expect(text).toContain('1F（ground）'); expect(text).toContain('管道井 / 烟道')
  })
  it('管井拆除 guard 与运行时重放一律拒绝，不能靠确认绕过', () => {
    const p = duplex(), original = structuredClone(p)
    expect(shaftRemovalError(p, 'shaft')).toBe('管道井 / 烟道不能拆'); expect(shaftRemovalError(p, 'w1')).toBeUndefined()
    for (const type of ['shaft', 'wall']) {
      const r = applyChanges(p, [{ id: 'remove', type, op: 'remove', target: 'shaft', by: 'user', status: 'confirmed', confirm: { by: '本人' } } as any])
      expect(r.results[0]).toMatchObject({ ok: false, error: '管道井 / 烟道不能拆' }); expect(r.plan).toEqual(original)
    }
  })
  it('新增格式的校验、id 与 schema 覆盖，序列化无损', () => {
    const p = duplex(); p.columns![0].id = 'column1'; expect(newId(p, 'column')).toBe('column2')
    expect(parsePlanText(serializePlan(p)).plan).toEqual(p)
    const schema = JSON.parse(readFileSync('schema/plan.schema.json', 'utf8'))
    for (const name of ['Level', 'Column', 'Shaft', 'Stair', 'Void']) expect(schema.$defs[name]).toBeDefined()
    expect(schema.$defs.Room.properties.floorOffset).toEqual({ type: 'number', description: '长度单位 mm' })
    expect(schema.$defs.Opening.properties.level).toBeUndefined(); expect(schema.$defs.Wall.properties.level).toBeDefined()
  })
  it('无新构件的旧方案保留统计/实体/点选的字段形状和示例面积', () => {
    const p = parsePlanText(readFileSync('fixtures/example-v2.json', 'utf8')).plan, stats = planStats(p)
    expect(stats).toMatchObject({ area: 31, netArea: 31, grossArea: 37.4, wallArea: 6.4 })
    expect(Object.keys(stats).sort()).toEqual(['netArea', 'grossArea', 'wallArea', 'walls', 'doors', 'windows', 'openings', 'beams', 'rooms', 'area', 'roomAreas', 'unansweredQuestions', 'pendingChanges'].sort())
    expect(buildSolids(p).every(s => !('level' in s) && !['slab', 'stair', 'column', 'shaft'].includes(s.kind))).toBe(true)
    expect(hitTest(p, p.walls[0].a)).toEqual(expect.objectContaining({ type: expect.any(String), id: expect.any(String) }))
  })
  it.each([
    ['level-reference', (p: Plan) => { p.columns![0].level = 'missing' }],
    ['level-order', (p: Plan) => { p.levels![1].elevation = 0 }],
    ['stair-level', (p: Plan) => { p.stairs![0].to = 'ground' }],
    ['stair-path', (p: Plan) => { p.stairs![0].path = [[0, 0]] }],
    ['extra-points', (p: Plan) => { p.voids![0].poly = [[0, 0], [1, 0]] }],
    ['extra-polygon', (p: Plan) => { p.shafts![0].poly = [[0, 0], [100, 100], [100, 0], [0, 100]] }],
    ['column', (p: Plan) => { p.columns![0].size[0] = -1 }],
    ['stair-size', (p: Plan) => { p.stairs![0].steps = 1.5 }],
    ['level-reference', (p: Plan) => { p.questions = [{ id: 'q', level: 'missing', category: 'original', text: '?' }] }],
  ] as const)('校验 %s', (code, mutate) => { const p = duplex(); mutate(p); expect(validatePlan(p).map(i => i.code)).toContain(code) })
})
