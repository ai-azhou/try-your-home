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
    if (mode === 'decor' || mode === '装修') expect(text).toContain('不写入 changes。见装修篇')
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
