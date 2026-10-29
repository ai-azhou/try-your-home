import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fromLegacy } from './legacy.ts'
import { emptyPlan, newId, parsePlanText, serializePlan } from './io.ts'
import { validatePlan } from './validate.ts'
import { buildSolids } from './solids.ts'
import { mirrorPlan, detectRoom } from './edit.ts'
import { labelPoint, pointInPolygon } from './geometry.ts'
import { applyChanges } from './changes.ts'
const files = ['fixtures/legacy-example.json']
for (const file of files) describe('公开旧样例', () => {
  const run = existsSync(file) ? it : it.skip
  run('转换、校验解释、实体覆盖所有墙且无 NaN', () => {
    const source = JSON.parse(readFileSync(file, 'utf8')), { plan, report } = fromLegacy(source)
    for (const issue of validatePlan(plan).filter(i => i.level === 'error')) expect(report.warnings.join('\n')).toContain(issue.message)
    expect(plan.legacy).toEqual(source)
    const solids = buildSolids(plan), ids = new Set(solids.flatMap(s => s.ids))
    for (const w of plan.walls) expect(ids.has(w.id)).toBe(true)
    for (const s of solids) { expect(s.polygons.flat(3).every(Number.isFinite)).toBe(true); expect(s.z1).toBeGreaterThan(s.z0) }
  })
  run('两轴镜像两次精确复原，包括导出再读入', () => {
    const plan = fromLegacy(JSON.parse(readFileSync(file, 'utf8'))).plan
    for (const axis of ['x', 'y'] as const) expect(mirrorPlan(parsePlanText(serializePlan(mirrorPlan(plan, axis))).plan, axis)).toEqual(plan)
  })
})
describe('旧格式细节', () => {
  it('公开样例里识别客厅区域，不把房间边界当输入', () => {
    const plan = fromLegacy(JSON.parse(readFileSync(files[0], 'utf8'))).plan, p = labelPoint(plan.rooms[2].poly)
    plan.rooms = []
    const poly = detectRoom(plan, p); expect(poly).not.toBeNull(); expect(pointInPolygon(p, poly!)).toBe(true); expect(poly).toHaveLength(4)
    expect(detectRoom(plan, [-500, -500])).toBeNull()
  })
  it('同类墙跨门窗合并，布尔第六位不当 id；不同类型建立独立宿主', () => {
    const input = { layout: { walls: [[0, 0, 1000, 100, 'n', true], [1900, 0, 3000, 100, 'n', 'right']], doors: [{ rect: [1000, 0, 1900, 100], h: [1900, 0], o: [0, -1] }] } }
    const { plan, report } = fromLegacy(input)
    expect(plan.walls).toHaveLength(1); expect(report.idMap.right).toEqual({ wall: 'w0', offset: 1900 }); expect(plan.openings[0].offset).toBe(1000); expect(plan.openings[0].swing).toEqual({ hinge: 'end', side: -1 })
    input.layout.walls[1][4] = 'b'; const other = fromLegacy(input); expect(other.plan.walls).toHaveLength(3); expect(other.report.approximations.length).toBeGreaterThan(0)
  })
  it('lintel 与同矩形 opening 只生成一个洞口，问题和底图转换', () => {
    const { plan, report } = fromLegacy({ layout: { walls: [], openings: [{ rect: [0, 0, 900, 100], height: 2 }], lintels: [[[0, 0, 900, 100], 2.2]], questions: [{ id: 'q', text: '配色', category: '风格', kind: '推断' }], underlay: { src: 'local.png', mmPerPx: 10, calibrations: [{ points: [[0, 0], [100, 0]], length: 1000 }] } } })
    expect(plan.openings).toHaveLength(1); expect(plan.openings[0].head).toBe(2.2); expect(plan.questions[0]).toMatchObject({ category: 'renovation', certainty: 'inferred' }); expect(report.approximations.join('')).toContain('风格'); expect(plan.underlay?.calibrations?.[0].p2).toEqual([100, 0])
  })
  it('合并后的多次拆墙按当前保留段更新旧 id 和 offset', () => {
    const { plan } = fromLegacy({ layout: { walls: [[0, 0, 1000, 100, 'n'], [1000, 0, 2000, 100, 'n'], [2000, 0, 3000, 100, 'n']] }, mods: [{ id: 'm1', op: 'demolish', target: 'w1' }, { id: 'm2', op: 'open', target: 'w2', params: { from: 100, width: 700, height: 2 } }] })
    const replay = applyChanges(plan, plan.changes)
    expect(replay.results.every(r => r.ok)).toBe(true); expect(replay.plan.openings[0]).toMatchObject({ wall: 'w0~m1', offset: 100 })
    expect(replay.plan.walls).toHaveLength(2)
  })
  it('无法转换的 mods 明示 unsupported', () => { const { report, plan } = fromLegacy({ layout: { walls: [] }, mods: [{ id: 'm', op: 'layout-patch', params: { unknown: true } }] }); expect(report.unsupported).toHaveLength(1); expect(plan.changes).toHaveLength(0); expect(plan.legacy?.mods).toBeDefined() })

})
describe('IO', () => {
  it('稳定键序、v2 自动识别和非法文本错误', () => {
    const p = emptyPlan(), parsed = parsePlanText(serializePlan(p)); expect(parsed.plan).toEqual(p); expect(parsed.report.source).toBe('v2'); expect(parsed.issues).toEqual([])
    expect(serializePlan({ ...p, title: '测试' })).toBe(serializePlan(Object.fromEntries(Object.entries({ ...p, title: '测试' }).reverse()) as unknown as typeof p))
    expect(parsePlanText('{').issues[0].code).toBe('parse'); expect(parsePlanText('{}').issues[0].level).toBe('error')
    p.walls = [{ id: 'w1', a: [0, 0], b: [1, 0], thickness: 1, kind: 'partition' }]; expect(newId(p, 'w')).toBe('w2')
  })
})
