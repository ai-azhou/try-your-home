import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { agentHandoff } from './handoff.ts'
import { applyChanges } from './changes.ts'
import { emptyPlan, parsePlanText, serializePlan } from './io.ts'

it('handoff distinguishes all modes, teaches the manual first, and requests an unknown/full file location', () => {
  const p = emptyPlan()
  for (const mode of ['original', '原始', 'renovation', '改造', 'compare', '对比', 'decor', '装修'] as const) {
    const text = agentHandoff(p, [], '保留用户原话', { mode })
    expect(text.split('\n')[0]).toContain('先读 Agent 手册「格式」')
    expect(text).toContain('「改造」3.2–3.6')
    expect(text).toContain('先问用户方案文件在哪')
    expect(text).toContain('保留用户原话')
    if (mode === 'original' || mode === '原始') {
      expect(text).toContain('读图纠错直接改原始结构')
      expect(text).not.toContain('以下为重放全部')
      expect(text).not.toContain('追加 changes')
    } else expect(text).toContain('含待确认')
    if (mode === 'compare' || mode === '对比') expect(text).toContain('对比视图只读')
    if (mode === 'decor' || mode === '装修') expect(text).toContain('不写 changes')
  }
  expect(agentHandoff(p, [], '', { mode: 'original', planFile: 'plan.json' })).toContain('不是完整路径')
  expect(agentHandoff(p, [], '', { mode: 'original', planFile: '/old/plan.json' })).toContain('非服务模式请先向用户确认文件位置')
})
it('actual UI replay handoff includes evidence and pending opening on a selected bearing wall', () => {
  const p = parsePlanText(readFileSync('fixtures/skill-two-bed/plan.json', 'utf8')).plan
  const view = applyChanges(p, p.changes).plan
  const text = agentHandoff(view, [{ type: 'wall', id: 'w-a' }, { type: 'wall', id: 'w-d' }, { type: 'room', id: 'r-bed2' }], '开门', { mode: 'renovation' })
  for (const expected of ['书房', 'certainty：seen', 'basis：', '改动需要二次确认', 'c5', '尚未确认']) {
    expect(text).toContain(expected)
  }
  expect(text).toContain('勿把这些值抄回原始数组')
})
it('generated split/add elements and historically protected types are identified without persisting provenance', () => {
  const p = emptyPlan()
  p.walls = [{ id: 'w', a: [0, 0], b: [3000, 0], thickness: 240, kind: 'bearing', evidence: { certainty: 'inferred', basis: '待核' } }]
  p.columns = [{ id: 'col', center: [4000, 0], size: [300, 300], shape: 'rect', kind: 'bearing' }]
  p.shafts = [{ id: 'sh', poly: [[0, 500], [200, 500], [200, 700]], kind: 'pipe' }]
  p.changes = [
    { id: 'split', op: 'remove', type: 'wall', target: 'w', range: [1000, 2000], by: 'user', status: 'confirmed', confirm: { by: '业主' } },
    { id: 'type', op: 'update', type: 'wall', target: 'w~split', data: { kind: 'partition' }, by: 'user', status: 'confirmed', confirm: { by: '业主' } },
    { id: 'coltype', op: 'update', type: 'column', target: 'col', data: { kind: 'decorative' }, by: 'user', status: 'confirmed', confirm: { by: '业主' } },
    { id: 'add', op: 'add', type: 'wall', data: { id: 'new', a: [0, 1000], b: [3000, 1000], thickness: 120, kind: 'partition' }, by: 'agent', status: 'pending', note: '加隔墙' },
  ]
  const view = applyChanges(p, p.changes).plan
  const text = agentHandoff(view, [{ type: 'wall', id: 'w~split' }, { type: 'wall', id: 'new' }, { type: 'column', id: 'col' }, { type: 'shaft', id: 'sh' }], '', { mode: 'compare' })
  expect(text.match(/改造产生，只能用 changes 修改/g)).toHaveLength(2)
  expect(text.match(/改动需要二次确认/g)).toHaveLength(2)
  expect(text).toContain('不可拆'); expect(text).toContain('certainty：inferred；basis：待核')
  expect(text).toContain('add：加隔墙')
  expect(serializePlan(view)).not.toContain('protectedWalls')
})

it.each(['saved', 'unsaved'] as const)('handoff %s 答复段逐字输出，排在选中构件前', answers => {
  const p = emptyPlan()
  p.questions = [
    { id: 'q-kitchen', category: 'original', text: '厨房有门吗？', targets: ['w-kit-e', 'w-kit-s', 'o-kit-slide'], answer: '开放式，没有门', answeredBy: '业主', answeredAt: '2026-10-30' },
    { id: 'q-next', category: 'renovation', text: '门高 2.1 m？', options: ['2.1 m', '2 m'], status: 'answered', answer: '2.1 m', answeredBy: '家人', answeredAt: '2026-10-30' },
    { id: 'q-open', category: 'original', text: '未答' },
    { id: 'q-ask', category: 'original', text: '追问', answer: '不确定', reply: { outcome: 'ask', text: '请量一下', by: 'Agent', at: '2026-10-30' } },
    { id: 'q-done', category: 'original', text: '已处理', status: 'resolved', answer: '对', reply: { outcome: 'confirmed', text: '已确认', by: 'Agent', at: '2026-10-30' } },
  ]
  const text = agentHandoff(p, [], '', { mode: 'original', answers })
  const intro = answers === 'saved' ? '这些答复已经存进方案文件（status 是 answered）。处理方法见读图 2.8「答复之后」、工具连接 4.6。' : '方案文件里还没有这些答复：先按下面原文写进对应问题卡的 answer、answeredBy、answeredAt，status 写 answered，再处理。处理方法见读图 2.8「答复之后」、工具连接 4.6。'
  expect(text).toContain(`## 待核对答复（2 条，等你处理）\n${intro}\n- q-kitchen（原始信息）\n  问：厨房有门吗？\n  问的是：w-kit-e、w-kit-s、o-kit-slide\n  答：开放式，没有门（业主 · 2026-10-30）\n- q-next（改造）\n  问：门高 2100 mm？（选项：2100 mm / 2000 mm）\n  答：2.1 m（家人 · 2026-10-30）\n\n## 选中构件\n（没选构件）`)
  for (const id of ['q-open', 'q-ask', 'q-done']) expect(text).not.toContain(id)
  expect(text).not.toContain('答复以外的改动')
})
it('handoff 提醒其他未导出改动；问题原文截断到 80 字，答复保留全文', () => {
  const p = emptyPlan(), answer = '答复'.repeat(80)
  p.questions = [{ id: 'q', category: 'original', text: '问'.repeat(81), answer }]
  const text = agentHandoff(p, [], '', { mode: 'original', answers: 'unsaved', otherUnsaved: true })
  expect(text).toContain('工具连接 4.6。\n工具里还有答复以外的改动没导出，这段文字里没有；要一起处理，请用户先导出方案文件。\n- q（原始信息）')
  expect(text).toContain(`  问：${'问'.repeat(80)}……\n`)
  expect(text).toContain(`  答：${answer}`)
  expect(text).not.toContain('问的是：')
})
it.each([
  [[{ role: 'user', text: '旧答' }, { role: 'agent', text: '旧回复' }, { role: 'user', text: '上轮答' }, { role: 'agent', text: '上轮回复' }], '答「上轮答」，你回复「上轮回复」'],
  [[{ role: 'user', text: '上轮答' }], '答「上轮答」'],
  [[{ role: 'agent', text: '上轮回复' }], '你回复「上轮回复」'],
] as const)('handoff 取最后一轮，缺半句就省略', (log, expected) => {
  const p = emptyPlan()
  p.questions = [{ id: 'q', category: 'original', text: '问题', answer: '这次答复', answeredBy: '业主', answeredAt: '2026-10-30', log: [...log] }]
  expect(agentHandoff(p, [], '', { mode: 'original', answers: 'saved' })).toContain(`  答：这次答复（业主 · 2026-10-30）\n  上一轮：${expected}。这次是用户有异议。`)
})
it('handoff 缺省不出答复节；没有 answered 时也不出', () => {
  const p = emptyPlan()
  p.questions = [{ id: 'q', category: 'original', text: '问题', answer: '答复' }]
  const plain = agentHandoff(p, [], '', { mode: 'original' })
  expect(plain).not.toContain('待核对答复'); expect(plain).toContain('## 选中构件\n（没选构件）')
  expect(agentHandoff(p, [], '', { mode: 'original', otherUnsaved: true })).toBe(plain)
  p.questions[0].status = 'open'
  expect(agentHandoff(p, [], '', { mode: 'original', answers: 'saved', otherUnsaved: true })).not.toContain('待核对答复')
})
