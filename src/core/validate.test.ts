import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { emptyPlan, newId, parsePlanText } from './io.ts'
import { validatePlan } from './validate.ts'
import { agentHandoff } from './handoff.ts'
import { planStats } from './summary.ts'
import type { Plan } from './types.ts'
function invalid(): Plan {
  return { ...emptyPlan(), walls: [{ id: 'w', a: [0, 0], b: [1000, 0], thickness: 100, kind: 'partition', bulge: 10 }], openings: [{ id: 'a', wall: 'w', offset: 500, width: 900, sill: 3, head: 2.9, kind: 'window' }, { id: 'b', wall: 'w', offset: 700, width: 200, sill: 0, head: 2, kind: 'door' }, { id: 'b', wall: 'missing', offset: 0, width: 200, sill: 0, head: 2, kind: 'door' }], rooms: [{ id: 'r', name: '自交', poly: [[0, 0], [1000, 1000], [0, 1000], [1000, 0]] }, { id: 'r2', name: '不足', poly: [[0, 0], [1, 0]] }], underlay: { src: 'https://example.test/private.png', mmPerPx: 10, origin: [0, 0], opacity: 50, visible: true } }
}
describe('校验与交接', () => {
  it('全部要求的几何错误都有中文 Issue', () => {
    const codes = validatePlan(invalid()).map(i => i.code)
    for (const code of ['duplicate-id', 'opening-host', 'opening-range', 'opening-overlap', 'opening-height', 'opening-head', 'room-points', 'room-self-intersection', 'underlay-remote']) expect(codes).toContain(code)
  })
  it('不认识的枚举、非数值几何和畸形 JSON 不崩溃', () => {
    const p = invalid(); p.walls[0].kind = 'unknown' as any; p.walls[0].bulge = NaN
    expect(validatePlan(p).map(i => i.code)).toContain('enum'); expect(validatePlan(p).map(i => i.code)).toContain('wall-geometry')
    const v = JSON.stringify({ ...emptyPlan(), walls: [null, { id: 'x', a: 'bad' }], openings: [null], rooms: [null] })
    expect(() => parsePlanText(v)).not.toThrow(); expect(parsePlanText(v).issues.length).toBeGreaterThan(0)
  })
  it('本地底图可用，远程、协议相对及主动内容拒绝', () => {
    const p = emptyPlan(); p.underlay = { src: './local.png', origin: [0, 0], mmPerPx: 1, opacity: 100, visible: true }
    for (const src of ['./local.png', 'data:image/png;base64,YQ==']) { p.underlay.src = src; expect(validatePlan(p)).toEqual([]) }
    for (const src of ['//example.test/a.png', 'http://example.test/a', 'javascript:alert(1)', 'data:text/html,a']) { p.underlay.src = src; expect(validatePlan(p).some(i => i.code === 'underlay-remote')).toBe(true) }
  })
  it('交接带路径、模式、构件、尺寸、房间、洞口和用户原话', () => {
    const p = parsePlanText(readFileSync('fixtures/example-v2.json', 'utf8')).plan
    const text = agentHandoff(p, [{ type: 'wall', id: 'w6' }, { type: 'opening', id: 'slides:0' }, { type: 'room', id: 'r3' }], '这里打通试试', { planFile: 'plans/home.json', mode: 'renovation' })
    for (const value of ['plans/home.json', '当前模式：改造', 'w6', 'slides:0', '端点', '法向侧房间', '区域3', '这里打通试试']) expect(text).toContain(value)
    expect(text.split('\n').at(-1)).toContain('改完 validate、apply、export --state renovated 并重出图')
  })
  it('面积按未四舍五入的原面积汇总，忽略 counted=false', () => {
    const p = emptyPlan(); p.rooms = [{ id: 'a', name: 'a', poly: [[0, 0], [1000, 0], [1000, 1040], [0, 1040]] }, { id: 'b', name: 'b', poly: [[0, 0], [1000, 0], [1000, 1040], [0, 1040]] }, { id: 'c', name: '不计', counted: false, poly: [[0, 0], [1000, 0], [1000, 1000], [0, 1000]] }]; p.questions = [{ id: 'q', text: '?', category: 'original', answer: ' ' }]
    expect(planStats(p)).toMatchObject({ area: 2.1, rooms: 3, unansweredQuestions: 1 }); expect(planStats(p).roomAreas.map(r => r.area)).toEqual([1, 1, 1])
  })
  it('newId 避开改造里待新增的构件和 group', () => {
    const p = emptyPlan(); p.changes = [{ id: 'c1', op: 'add', type: 'wall', data: { id: 'w1' }, by: 'agent', status: 'pending', group: 'joint1' }]
    expect(newId(p, 'w')).toBe('w2'); expect(newId(p, 'joint')).toBe('joint2')
  })
})
describe('Node 24 命令行', () => {
  it('convert /dev/stdout 是有效 JSON，report 独立打印', () => {
    const result = spawnSync(process.execPath, ['scripts/plan.ts', 'convert', 'fixtures/legacy-example.json', '/dev/stdout'], { encoding: 'utf8' })
    expect(result.status).toBe(0); expect(JSON.parse(result.stdout).version).toBe(3); expect(JSON.parse(result.stderr).source).toBe('legacy')
  })
  it('validate、apply、stats 成功执行；缺参数返回非零', () => {
    for (const command of ['validate', 'apply', 'stats']) { const result = spawnSync(process.execPath, ['scripts/plan.ts', command, 'fixtures/example-v2.json'], { encoding: 'utf8' }); expect(result.status).toBe(0); expect(() => JSON.parse(result.stdout)).not.toThrow() }
    expect(spawnSync(process.execPath, ['scripts/plan.ts', 'convert'], { encoding: 'utf8' }).status).toBe(1)
  })
})
