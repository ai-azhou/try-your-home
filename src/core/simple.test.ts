import { existsSync, readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'
import simpleSchema from '../../schema/simple.schema.json' with { type: 'json' }
import { SIMPLE_FORMAT, SIMPLE_BASIS, SIMPLE_SNAP, SIMPLE_TEMPLATE, SIMPLE_RULES, isSimplePlan, simpleToPlan, diagnoseShape, simpleFormatChatText, isSimpleDerived } from './simple.ts'
import { parsePlanText, serializePlan, emptyPlan } from './io.ts'
import { polygonArea, wallLength, openingSpan } from './geometry.ts'
import { validatePlan } from './validate.ts'
import { validatePlanFile } from './schema.ts'
import type { Plan, Vec2 } from './types.ts'

const rect = (name: string, x = 0, y = 0, w = 3000, h = 3000) => ({ name, rect: [x, y, w, h] })
const simple = (rooms: unknown[], doors: unknown[] = []) => ({ format: SIMPLE_FORMAT, version: 1, rooms, doors })
function convert(input: unknown) {
  const result = simpleToPlan(input)
  expect(result.issues.filter(i => i.level === 'error')).toEqual([])
  expect(result.plan).not.toBeNull()
  const plan = result.plan!
  expect(validatePlan(plan).filter(i => i.level === 'error')).toEqual([])
  expect(validatePlanFile(JSON.parse(serializePlan(plan)))).toEqual([])
  return { ...result, plan }
}
const template = () => convert(JSON.parse(SIMPLE_TEMPLATE)).plan
const questions = (p: Plan, prefix: string) => p.questions.filter(q => q.id.startsWith(prefix))
const center = (p: Plan, index = 0) => openingSpan(p, p.openings[index]).center

// All geometry below is synthetic. No private fixtures are read.
describe('规范文本与模板转换', () => {
  it('模板、规则不带末尾换行；开发仓库里逐字对应任务书', () => {
    expect(SIMPLE_TEMPLATE.endsWith('\n')).toBe(false)
    expect(SIMPLE_RULES).toHaveLength(6)
    expect(SIMPLE_SNAP).toBe(150)
    const briefPath = 'docs/tasks/C7-简版格式-core-任务书.md'
    if (!existsSync(briefPath)) return // 发布仓库不带任务书
    const brief = readFileSync(briefPath, 'utf8')
    expect(SIMPLE_TEMPLATE).toBe(brief.split('```json\n')[1].split('\n```')[0])
    const ruleSection = brief.split('### 1.2')[1].split('### 1.3')[0]
    expect(SIMPLE_RULES).toEqual([...ruleSection.matchAll(/^\d\. (.*)$/gm)].map(m => m[1]))
  })
  it('模板生成 8 墙、4 门、5 房、2 问题，证据和净面正确', () => {
    const p = template()
    expect(p.walls).toHaveLength(8); expect(p.openings).toHaveLength(4); expect(p.rooms).toHaveLength(5); expect(p.questions).toHaveLength(2)
    expect(p.version).toBe(2); expect(p.ceiling).toBe(2.8); expect(p.title).toBe('我家')
    expect(p.openings[0]).toMatchObject({ entry: true, width: 1000, sill: 0, head: 2.1 })
    const entryWall = p.walls.find(w => w.id === p.openings[0].wall)!
    expect(entryWall.a[1]).toBe(0); expect(entryWall.b[1]).toBe(0)
    expect(center(p)).toEqual([6600, 0])
    expect(p.walls.filter(w => w.kind === 'exterior')).toHaveLength(4)
    expect(p.walls.filter(w => w.kind === 'exterior').every(w => w.thickness === 240)).toBe(true)
    expect(p.walls.find(w => w.a[0] === 3600 && w.b[0] === 3600)).toMatchObject({ kind: 'partition', thickness: 120 })
    expect(p.walls.some(w => w.a[1] === 5400 && w.b[1] === 5400 && Math.max(w.a[0], w.b[0]) > 6000)).toBe(false)
    expect(p.openings.some(o => o.name?.includes('厨房'))).toBe(false)
    for (const e of [...p.walls, ...p.openings, ...p.rooms]) expect(e.evidence).toEqual({ certainty: 'inferred', basis: SIMPLE_BASIS })
    expect(p.questions.map(q => q.id)).toEqual(['simple-windows', 'simple-entry'])
    expect(p.questions[0].certainty).toBe('unknown'); expect(p.questions[1].targets).toEqual([p.openings[0].id])
    expect(p.meta?.source).toBe(SIMPLE_FORMAT); expect(isSimpleDerived(p)).toBe(true)
    expect(polygonArea(p.rooms[0].poly)).toBeCloseTo((3600 - 120 - 60) * (4000 - 120 - 60), 3)
    // The open kitchen edge reaches y=5400; it receives no 60 mm inset.
    expect(p.rooms.find(r => r.name === '厨房')!.poly.some(p => p[1] === 5400)).toBe(true)
    expect(center(p, 2)).toEqual([3600, 4700])
  })
  it('v3 往返保留来源、问题和证据，全部高度正确换算', () => {
    const p = template(), text = serializePlan(p), wire = JSON.parse(text), reread = parsePlanText(text)
    expect(wire.version).toBe(3); expect(wire.openings[0].head).toBe(2100)
    expect(reread.issues).toEqual([]); expect(reread.plan).toEqual(p); expect(reread.report.source).toBe('v2')
    expect(isSimpleDerived(reread.plan)).toBe(true); expect(isSimpleDerived(emptyPlan())).toBe(false)
  })
  it('parsePlanText 优先识别简版并填转换报告；阻断时返回 emptyPlan', () => {
    const parsed = parsePlanText(SIMPLE_TEMPLATE)
    expect(parsed.report.source).toBe('simple')
    expect(parsed.report.counts).toEqual({ walls: 8, openings: 4, beams: 0, rooms: 5, questions: 2, changes: 0 })
    const tolerant = parsePlanText(JSON.stringify({ box: { ...simple([rect('A')]), version: '1' } }))
    expect(tolerant.report.approximations.join('')).toContain('box')
    const failed = parsePlanText(JSON.stringify(simple([])))
    expect(failed.report.source).toBe('simple'); expect(failed.plan).toEqual(emptyPlan()); expect(failed.issues[0].level).toBe('error')
  })
})

describe('几何：吸附、共用边和净面', () => {
  it('一字三间合并外圈为 4 面墙，保留 2 面隔墙，门在各自共用段中间', () => {
    const { plan } = convert(simple([rect('A'), rect('B', 3000), rect('C', 6000)], [{ between: ['A', 'B'] }, { between: ['B', 'C'] }]))
    expect(plan.walls).toHaveLength(6); expect(plan.walls.filter(w => w.kind === 'partition')).toHaveLength(2)
    expect(center(plan)).toEqual([3000, 1500]); expect(center(plan, 1)).toEqual([6000, 1500])
    expect(plan.openings.every(o => o.offset === 1050)).toBe(true)
  })
  it.each([100, 120, 150])('%i mm 缝吸附平均为隔墙，无缝隙卡', gap => {
    const { plan, notes } = convert(simple([rect('A'), rect('B', 3000 + gap)], [{ between: ['A', 'B'] }]))
    const wall = plan.walls.find(w => w.kind === 'partition')!
    expect(wall.a[0]).toBe(3000 + gap / 2); expect(wall.b[0]).toBe(3000 + gap / 2)
    expect(plan.openings).toHaveLength(1); expect(questions(plan, 'simple-gap')).toHaveLength(0)
    expect(notes.join('')).toContain('吸附')
  })
  it('单个顶点偏 120 mm，邻边保持共用且房间不自交', () => {
    const { plan } = convert(simple([rect('A'), { name: 'B', poly: [[3120, 0], [6000, 0], [6000, 3000], [3000, 3000]] }], [{ between: ['A', 'B'] }]))
    const wall = plan.walls.find(w => w.kind === 'partition')!
    expect(wall.a).toEqual([3000, 3000]); expect(wall.b).toEqual([3060, 0]); expect(plan.openings).toHaveLength(1)
  })
  it('T 接头附近顶点投影到长边，按共用范围而非整墙居中', () => {
    const { plan } = convert(simple([rect('长房', 0, 0, 3000, 6000), rect('短房', 3100, 1000, 3000, 3000)], [{ between: ['长房', '短房'] }]))
    const partition = plan.walls.find(w => w.kind === 'partition')!
    expect(partition.a).toEqual([3000, 1000]); expect(partition.b).toEqual([3000, 4000])
    expect(center(plan)).toEqual([3000, 2500]); expect(questions(plan, 'simple-gap')).toHaveLength(0)
  })
  it('L 形与矩形的 T 接头，只有真正共用部分生成隔墙', () => {
    const l = { name: 'L', poly: [[0, 0], [6000, 0], [6000, 2000], [3000, 2000], [3000, 6000], [0, 6000]] }
    const { plan } = convert(simple([l, rect('B', 3000, 3000, 3000, 3000)], [{ between: ['L', 'B'] }]))
    const partition = plan.walls.find(w => w.kind === 'partition')!
    expect(partition.a).toEqual([3000, 3000]); expect(partition.b).toEqual([3000, 6000]); expect(center(plan)).toEqual([3000, 4500])
    expect(plan.walls.some(w => w.kind === 'exterior' && w.a[0] === 3000 && w.b[0] === 3000 && wallLength(w) === 1000)).toBe(true)
  })
  it('open 去掉完整共用边，逆序顶点也能匹配', () => {
    const { plan } = convert(simple([rect('A'), { name: 'B', poly: [[3000, 0], [3000, 3000], [6000, 3000], [6000, 0]] }], [{ between: ['A', 'B'], open: true }]))
    expect(plan.walls).toHaveLength(4); expect(plan.openings).toHaveLength(0)
    expect(plan.rooms.map(r => polygonArea(r.poly))).toEqual([2880 * 2760, 2880 * 2760])
  })
  it('共线顶点不会造成重墙或改变净面积', () => {
    const { plan } = convert(simple([{ name: 'A', poly: [[0, 0], [1000, 0], [3000, 0], [3000, 3000], [0, 3000]] }]))
    expect(plan.walls).toHaveLength(4); expect(plan.rooms[0].poly).toHaveLength(4)
    expect(polygonArea(plan.rooms[0].poly)).toBe(2760 ** 2)
  })
})

describe('几何问题卡', () => {
  it('300 mm 缝保留两道外墙和带 bbox 的问题卡', () => {
    const { plan } = convert(simple([rect('A'), rect('B', 3300)]))
    expect(plan.walls).toHaveLength(8); expect(plan.walls.every(w => w.kind === 'exterior')).toBe(true)
    expect(questions(plan, 'simple-gap')).toHaveLength(1)
    expect(questions(plan, 'simple-gap')[0]).toMatchObject({ bbox: [3000, 0, 3300, 3000], targets: ['r1', 'r2'] })
    expect(questions(plan, 'simple-gap')[0].text).toContain('300 mm')
  })
  it.each([601, 1000])('%i mm 间距不报窄缝', gap => {
    expect(questions(convert(simple([rect('A'), rect('B', 3000 + gap)])).plan, 'simple-gap')).toHaveLength(0)
  })
  it('投影不足 300 mm 的平行边不报缝隙', () => {
    expect(questions(convert(simple([rect('A'), rect('B', 3300, 2800)])).plan, 'simple-gap')).toHaveLength(0)
  })
  it('四房围合的内部空洞单独报告 bbox', () => {
    const { plan } = convert(simple([rect('上', 0, 0, 6000, 2000), rect('左', 0, 2000, 2000, 2000), rect('右', 4000, 2000, 2000, 2000), rect('下', 0, 4000, 6000, 2000)]))
    expect(questions(plan, 'simple-hole')).toHaveLength(1)
    expect(questions(plan, 'simple-hole')[0].bbox).toEqual([2000, 2000, 4000, 4000])
  })
  it('500 mm 重叠不阻断，问题卡含两房 id 和交集 bbox', () => {
    const { plan } = convert(simple([rect('A'), rect('B', 2500)]))
    expect(plan.rooms).toHaveLength(2)
    expect(questions(plan, 'simple-overlap')).toHaveLength(1)
    expect(questions(plan, 'simple-overlap')[0]).toMatchObject({ bbox: [2500, 0, 3000, 3000], targets: ['r1', 'r2'] })
    expect(questions(plan, 'simple-gap')).toHaveLength(0)
  })
  it('斜向平行外墙也能识别缝隙', () => {
    const transform = (x: number, y: number): Vec2 => [(x - y) * Math.SQRT1_2, (x + y) * Math.SQRT1_2]
    const rooms = [0, 3300].map((x, i) => ({ name: `R${i}`, poly: [[x, 0], [x + 3000, 0], [x + 3000, 3000], [x, 3000]].map(([x, y]) => transform(x, y)) }))
    const { plan } = convert(simple(rooms))
    expect(questions(plan, 'simple-gap')).toHaveLength(1); expect(questions(plan, 'simple-gap')[0].text).toContain('300 mm')
  })
  it('旋转户型的相接、吸附、缝隙和重叠：120 个确定性角度案例均可保存', () => {
    // Regression for boolean-operation slivers at oblique wall junctions.
    for (let i = 0; i < 120; i++) {
      const angle = i * .137, c = Math.cos(angle), s = Math.sin(angle), gap = [0, 100, 300, -500][i % 4]
      const rooms = [0, 3000 + gap].map((x, j) => ({ name: `R${j}`, poly: [[x, 0], [x + 3000, 0], [x + 3000, 4000], [x, 4000]].map(([x, y]) => [x * c - y * s, x * s + y * c]) }))
      const { plan } = convert(simple(rooms, gap >= 0 && gap <= 100 ? [{ between: ['R0', 'R1'] }] : []))
      expect(plan.rooms).toHaveLength(2)
      expect(plan.openings).toHaveLength(gap >= 0 && gap <= 100 ? 1 : 0)
      if (gap === 300) expect(questions(plan, 'simple-gap')).toHaveLength(1)
      if (gap === -500) expect(questions(plan, 'simple-overlap')).toHaveLength(1)
    }
  })
})

describe('门的定位和失败提示', () => {
  it('单房入户门放在最长外墙中点', () => {
    const { plan } = convert(simple([rect('家', 0, 0, 3000, 5000)], [{ between: ['家', '外面'] }]))
    expect(center(plan)).toEqual([3000, 2500]); expect(plan.openings[0].width).toBe(1000)
    expect(questions(plan, 'simple-entry')[0].targets).toEqual([plan.openings[0].id])
  })
  it.each(['外面', '室外', '户外', 'outside'])('户外同义词 %s 与反向引用', outside => {
    const { plan } = convert(simple([rect('家')], [{ between: [outside, '家'] }]))
    expect(plan.openings[0].entry).toBe(true)
  })
  it('完全被围的中间房没有外墙，不生成入户门', () => {
    const { plan, issues } = convert(simple([rect('中', 2000, 2000, 2000, 2000), rect('上', 0, 0, 6000, 2000), rect('下', 0, 4000, 6000, 2000), rect('左', 0, 2000, 2000, 2000), rect('右', 4000, 2000, 2000, 2000)], [{ between: ['中', '外面'] }]))
    expect(plan.openings).toHaveLength(0); expect(issues[0].level).toBe('warn'); expect(issues[0].message).toContain('没有外墙')
    expect(questions(plan, 'simple-door')).toHaveLength(1)
  })
  it.each([
    [['A', '不存在'], '不存在'], [['A', 'A'], '同一间'], [['A', '远房'], '没有共用边'],
  ])('无效关系 %j 不生成门并报告 doors 路径', (between, text) => {
    const { plan, issues } = convert(simple([rect('A'), rect('远房', 7000)], [{ between }]))
    expect(plan.openings).toHaveLength(0); expect(issues[0]).toMatchObject({ level: 'warn' }); expect(issues[0].message).toContain(text)
    expect(questions(plan, 'simple-door')[0].text).toContain('doors[0]')
  })
  it.each([[650, 0, 0], [900, 1, 700], [1100, 1, 900]])('共用段 %i mm 的门宽规则', (h, count, width) => {
    const { plan, issues } = convert(simple([rect('A', 0, 0, 3000, h), rect('B', 3000, 0, 3000, h)], [{ between: ['A', 'B'] }]))
    expect(plan.openings).toHaveLength(count)
    if (count) { expect(plan.openings[0].width).toBe(width); expect(center(plan)).toEqual([3000, h / 2]) }
    else { expect(issues[0].level).toBe('warn'); expect(questions(plan, 'simple-door')[0].text).toContain('不足 600') }
  })
  it('重复关系不产生重叠洞口或校验 error', () => {
    const { plan, issues } = convert(simple([rect('A'), rect('B', 3000)], [{ between: ['A', 'B'] }, { between: ['B', 'A'] }]))
    expect(plan.openings).toHaveLength(1); expect(issues[0].message).toContain('重叠')
  })
  it('同一关系同时 open 和普通门时，敞开优先并提示', () => {
    const { plan, issues } = convert(simple([rect('A'), rect('B', 3000)], [{ between: ['A', 'B'] }, { between: ['B', 'A'], open: true }]))
    expect(plan.openings).toHaveLength(0); expect(plan.walls).toHaveLength(4); expect(issues[0].message).toContain('敞开')
  })
})

describe('宽容导入', () => {
  it.each([
    ['外层', { layout: simple([rect('A')]) }, '拆掉'],
    ['数字键标记', { 'floorplan-simple': 1, rooms: [rect('A')] }, '标记写成了键'],
    ['字符串键标记', { 'floorplan-simple': 'version 1', rooms: [rect('A')] }, '标记写成了键'],
    ['字符串 version', { ...simple([rect('A')]), version: '1' }, '按 1'],
    ['缺 version', { format: SIMPLE_FORMAT, rooms: [rect('A')] }, '按 1'],
  ])('%s 可识别并记 note', (_, input, text) => {
    expect(isSimplePlan(input)).toBe(true); expect(convert(input).notes.join('')).toContain(text)
    expect(diagnoseShape(input)).toEqual({ wrong: false, reasons: [] })
  })
  it('多余字段只汇总一次；对象点/矩形、id 和 from/to 能使用', () => {
    const input = { ...simple([
      { id: 'bed', name: '卧室', poly: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 3000 }, { x: 0, y: 3000 }], area: 9, type: 'bedroom' },
      { name: '客厅', rect: { x: 3000, y: 0, width: 3000, height: 3000 }, area: 9 },
      { name: '厨房', rect: { x: 6000, y: 0, w: 3000, h: 3000 } },
    ], [{ from: 'bed', to: '客厅', comment: '门' }]), comment: '示例' }
    const { plan, notes } = convert(input)
    expect(plan.rooms[0].id).toBe('bed'); expect(plan.openings).toHaveLength(1)
    const ignored = notes.filter(n => n.includes('多余字段'))
    expect(ignored).toEqual(['已忽略多余字段：area、comment、type'])
    expect(notes.join('')).toContain('{x, y}'); expect(notes.join('')).toContain('from/to'); expect(notes.join('')).toContain('rect 的对象')
  })
  it('重名自动编号，原名引用第一间，也可以引用新名字', () => {
    const { plan, notes } = convert(simple([rect('卧室'), rect('卧室', 3000), rect('卧室', 6000)], [{ between: ['卧室', '卧室 2'] }]))
    expect(plan.rooms.map(r => r.name)).toEqual(['卧室', '卧室 2', '卧室 3'])
    expect(center(plan)).toEqual([3000, 1500]); expect(notes.join('')).toContain('按第一间')
  })
  it('米制坐标换算，附 note 和问题卡', () => {
    const { plan, notes } = convert(simple([rect('A', 0, 0, 3, 4)]))
    expect(plan.walls[0].b).toEqual([3000, 0]); expect(plan.walls[1].b).toEqual([3000, 4000])
    expect(notes.join('')).toContain('×1000'); expect(questions(plan, 'simple-units')[0].text).toBe('坐标像是米，已按毫米 ×1000 换算，请核对尺寸')
  })
  it('转换纯函数、重复结果稳定，不改传入对象', () => {
    const input = { wrapper: { ...simple([rect('卧室', 0, 0, 3, 4), rect('卧室', 3, 0, 3, 4)]), version: '1' } }, before = structuredClone(input)
    expect(simpleToPlan(input)).toEqual(simpleToPlan(input)); expect(input).toEqual(before)
  })
  it('用户 id 与生成 id、问题卡前缀冲突时仍然全局唯一', () => {
    const { plan } = convert(simple([
      { ...rect('A'), id: 'w1' }, { ...rect('B', 3000), id: 'o1' }, { ...rect('C', 6000), id: 'simple-windows' },
      { ...rect('D', 9000), id: 'w1' },
    ], [{ between: ['w1', 'o1'] }]))
    expect(plan.rooms[0].id).toBe('w1'); expect(plan.rooms[1].id).toBe('o1')
    expect(plan.questions[0].id).toBe('simple-windows'); expect(plan.openings).toHaveLength(1)
  })
  it('极窄净面消失时给 warn，不输出退化房间', () => {
    const { plan, issues } = convert(simple([rect('窄条', 0, 0, 200, 3000)]))
    expect(plan.rooms).toHaveLength(0); expect(issues[0].message).toContain('没有有效净面')
  })
  it('重叠导致净面有孔时保留扣除面积且 v3 可保存', () => {
    const { plan, notes } = convert(simple([rect('大房', 0, 0, 6000, 6000), rect('内房', 2000, 2000, 2000, 2000)]))
    expect(plan.rooms).toHaveLength(2); expect(notes.join('')).toContain('内孔')
    expect(polygonArea(plan.rooms[0].poly)).toBeLessThan(5760 ** 2 - 2200 ** 2)
  })
})

describe('阻断错误保留简版路径', () => {
  it.each([
    ['缺 rooms', { format: SIMPLE_FORMAT, version: 1 }, 'rooms'],
    ['空 rooms', simple([]), 'rooms'],
    ['缺 name', simple([{ rect: [0, 0, 3000, 3000] }]), 'rooms[0].name'],
    ['两个点', simple([{ name: '厨房', poly: [[0, 0], [3000, 0]] }]), 'rooms[0]（厨房）.poly'],
    ['字符串坐标', simple([{ name: '厨房', poly: [[0, 0], ['3000', 0], [0, 3000]] }]), 'rooms[0]（厨房）.poly[1]'],
    ['NaN', simple([{ name: '厨房', poly: [[0, 0], [NaN, 0], [0, 3000]] }]), 'rooms[0]（厨房）.poly[1]'],
    ['Infinity', simple([{ name: '厨房', rect: [0, 0, Infinity, 3000] }]), 'rooms[0]（厨房）.rect'],
    ['零宽', simple([rect('厨房', 0, 0, 0, 3000)]), 'rooms[0]（厨房）.rect'],
    ['负深', simple([rect('厨房', 0, 0, 3000, -1)]), 'rooms[0]（厨房）.rect'],
    ['rect 三数', simple([{ name: '厨房', rect: [0, 0, 3000] }]), 'rooms[0]（厨房）.rect'],
    ['自交', simple([{ name: '厨房', poly: [[0, 0], [3000, 3000], [0, 3000], [3000, 0]] }]), 'rooms[0]（厨房）.poly'],
    ['非零面积自交', simple([{ name: '厨房', poly: [[0, 0], [4000, 3000], [0, 3000], [3000, 0]] }]), 'rooms[0]（厨房）.poly'],
    ['退化', simple([{ name: '厨房', poly: [[0, 0], [1000, 0], [3000, 0]] }]), 'rooms[0]（厨房）.poly'],
    ['两种形状', simple([{ ...rect('厨房'), poly: [[0, 0], [3000, 0], [0, 3000]] }]), 'rooms[0]（厨房）'],
    ['不支持版本', { ...simple([rect('厨房')]), version: 2 }, 'version'],
  ])('%s 返回 null 和可交给 Chat 的路径', (_, value, path) => {
    const result = simpleToPlan(value)
    expect(result.plan).toBeNull(); expect(result.issues.some(i => i.level === 'error' && i.message.includes(path))).toBe(true)
  })
  it('多间房错误使用原数组下标和房名', () => {
    const result = simpleToPlan(simple([rect('A'), rect('B'), { name: '厨房', poly: [[0, 0], [1000, 0]] }]))
    expect(result.issues[0].message).toBe('rooms[2]（厨房）.poly：至少要 3 个点')
  })
})

describe('diagnoseShape 与 Chat 提示词', () => {
  it('弱模型失败样本给出四类具体原因', () => {
    const input = { 'floorplan-structure': 'version 3', layout: { rooms: [{ name: '客厅', poly: [[0, 0], [5000, 0], [5000, 4000], [0, 4000]], area: 20, type: 'living' }], walls: [], doors: [{ from: '客厅', to: '卧室' }] } }
    const { wrong, reasons } = diagnoseShape(input)
    expect(wrong).toBe(true)
    expect(reasons).toContain('格式标记写成了 "floorplan-structure": "version 3"，应该是 format、version 两个字段')
    expect(reasons).toContain('外面多套了一层 layout'); expect(reasons).toContain('walls 是空的，只有房间')
    expect(reasons).toContain('门写成了房间之间的关系，没有位置和宽度')
  })
  it('文档两室示例和 v2 六个数组齐全不误判', () => {
    const doc = readFileSync('docs/format.md', 'utf8').split('## 两室示例')[1].split('```json\n')[1].split('\n```')[0]
    const input = JSON.parse(doc)
    expect(diagnoseShape(input)).toEqual({ wrong: false, reasons: [] })
    expect(diagnoseShape({ ...input, version: 2 })).toEqual({ wrong: false, reasons: [] })
    expect(diagnoseShape(emptyPlan()).wrong).toBe(false)
  })
  it('完整标记但仅有 rooms，仍然 wrong', () => {
    const result = diagnoseShape({ ...emptyPlan(), rooms: [rect('A')] })
    expect(result.wrong).toBe(true); expect(result.reasons).toContain('walls 是空的，只有房间')
  })
  it.each([null, [], 'json', 42])('非对象 %j 诊断', input => {
    expect(diagnoseShape(input)).toEqual({ wrong: true, reasons: ['最外层不是一个 JSON 对象'] })
  })
  it('缺标记、外层实际名称、关系 openings 均有中文原因', () => {
    expect(diagnoseShape({}).reasons).toContain('没有 format 和 version 两个字段')
    const result = diagnoseShape({ myHome: { rooms: [rect('A')], openings: [{ from: 'A', to: 'B' }] } })
    expect(result.reasons).toContain('外面多套了一层 myHome')
    expect(result.reasons).toContain('门写成了房间之间的关系，没有位置和宽度')
  })
  it('简版自己的错误不归为格式根本不对', () => {
    expect(diagnoseShape(simple([]))).toEqual({ wrong: false, reasons: [] })
    expect(diagnoseShape(JSON.parse(SIMPLE_TEMPLATE))).toEqual({ wrong: false, reasons: [] })
  })
  it('公开 legacy 样例以及现有可生成墙的 legacy 测试形状均不误判', () => {
    const old = JSON.parse(readFileSync('fixtures/legacy-example.json', 'utf8'))
    const inputs = [old,
      { layout: { walls: [[0, 0, 1000, 100, 'n', true], [1900, 0, 3000, 100, 'n', 'right']], doors: [{ rect: [1000, 0, 1900, 100], h: [1900, 0], o: [0, -1] }] } },
      { layout: { walls: [[0, 0, 1000, 100, 'n', true], [1900, 0, 3000, 100, 'b', 'right']], doors: [{ rect: [1000, 0, 1900, 100] }] } },
      { layout: { walls: [], openings: [{ rect: [0, 0, 900, 100], height: 2 }], lintels: [[[0, 0, 900, 100], 2.2]], questions: [{ id: 'q', text: '配色', category: '风格', kind: '推断' }], underlay: { src: 'local.png', mmPerPx: 10, calibrations: [{ points: [[0, 0], [100, 0]], length: 1000 }] } } },
      { layout: { walls: [[0, 0, 1000, 100, 'n'], [1000, 0, 2000, 100, 'n'], [2000, 0, 3000, 100, 'n']] }, mods: [{ id: 'm1', op: 'demolish', target: 'w1' }, { id: 'm2', op: 'open', target: 'w2', params: { from: 100, width: 700, height: 2 } }] },
      { layout: { walls: [], freeWalls: [{ a: [0, 0], b: [3000, 0] }] } },
    ]
    for (const input of inputs) expect(diagnoseShape(input)).toEqual({ wrong: false, reasons: [] })
  })
  it('有原因的提示词包含逐条原因、六条规则和模板原文', () => {
    const reasons = ['walls 是空的，只有房间', '外面多套了一层 layout'], text = simpleFormatChatText(reasons)
    for (const reason of reasons) expect(text).toContain(`- ${reason}\n`)
    SIMPLE_RULES.forEach((r, i) => expect(text).toContain(`${i + 1}. ${r}`))
    expect(text).toContain(SIMPLE_TEMPLATE); expect(text).toContain('只输出一个 ```json 代码块。')
    expect(text.startsWith('你上次输出的方案 JSON 格式不对')).toBe(true)
  })
  it('无原因的提示词用指定开头，不附错误段落', () => {
    const text = simpleFormatChatText([])
    expect(text.startsWith('请改用下面的简版格式重新输出方案：只写房间和门，墙和门洞由工具自动生成。')).toBe(true)
    expect(text).not.toContain('工具读不了'); expect(text).toContain(SIMPLE_TEMPLATE)
  })
})

describe('简版 schema', () => {
  const check = new Ajv2020({ strict: false }).compile(simpleSchema)
  it('标准模板、额外字段和可选 id 合法', () => {
    expect(check(JSON.parse(SIMPLE_TEMPLATE))).toBe(true)
    expect(check({ ...simple([{ ...rect('A'), id: 'a', area: 9 }]), comment: 'ignored' })).toBe(true)
  })
  it.each([
    simple([]), simple([{ name: 'A' }]), simple([{ ...rect('A'), poly: [[0, 0], [3000, 0], [0, 3000]] }]),
    simple([rect('A', 0, 0, 0, 3000)]), simple([{ name: 'A', poly: [[0, 0], [3000, 0]] }]),
    simple([rect('A')], [{ between: ['A'] }]), simple([rect('A')], [{ between: ['A', '外面'], open: false }]),
  ])('拒绝不符合规范的形状 %#', input => { expect(check(input)).toBe(false) })
})
