import { describe, expect, it } from 'vitest'
import type { Change, Plan, Vec2 } from './types.ts'
import { emptyPlan } from './io.ts'
import { applyChanges, describeChange, diffPlans, elements } from './changes.ts'
import { addElement, removeElement, updateElement } from './edit.ts'
import { validatePlan } from './validate.ts'

const rect = (x = 0, y = 0, w = 1000, h = 1000): Vec2[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
const plan = (): Plan => ({
  ...emptyPlan(),
  levels: [{ id: 'L1', name: '1F', elevation: 0 }, { id: 'L2', name: '2F', elevation: 3 }],
  columns: [{ id: 'col-b', center: [500, 500], shape: 'rect', size: [400, 400], kind: 'bearing' }, { id: 'col-d', center: [2500, 500], shape: 'round', size: [300, 300], kind: 'decorative' }],
  shafts: [{ id: 'sh', poly: rect(3000, 0, 500, 500), kind: 'flue' }],
})
const confirmed = (c: Change): Change => ({ ...c, confirm: { by: '业主' } })

describe('S2a ElementType 并入柱 / 管道井 / 楼梯 / 挑空', () => {
  it('elements 对缺省的可选集合返回空数组，不改方案', () => {
    const p = emptyPlan()
    expect(elements(p, 'column')).toEqual([])
    expect(elements(p, 'stair')).toEqual([])
    expect(p.columns).toBeUndefined()
  })
  it('新增柱、楼梯、挑空、管道井：缺省集合自动建立，id 不撞号，结果仍能通过校验', () => {
    const p = emptyPlan()
    p.levels = [{ id: 'L1', name: '1F', elevation: 0 }, { id: 'L2', name: '2F', elevation: 3 }]
    const col = addElement(p, 'column', { center: [0, 0], shape: 'rect', size: [400, 400], kind: 'bearing' })
    const stair = addElement(p, 'stair', { level: 'L1', to: 'L2', poly: rect(0, 0, 1000, 3000), path: [[500, 3000], [500, 0]], width: 1000, kind: 'straight' })
    const vd = addElement(p, 'void', { level: 'L2', poly: rect(0, 0, 1000, 3000) })
    const sh = addElement(p, 'shaft', { poly: rect(2000, 0, 400, 400), kind: 'pipe' })
    const { plan: next, results } = applyChanges(p, [col, stair, vd, sh])
    expect(results.every(r => r.ok)).toBe(true)
    expect(next.columns?.map(c => c.id)).toEqual(['column1'])
    expect(next.stairs?.[0]).toMatchObject({ id: 'stair1', level: 'L1', to: 'L2' })
    expect(next.voids?.[0].id).toBe('void1')
    expect(next.shafts?.[0].kind).toBe('pipe')
    expect(validatePlan(next)).toEqual([])
    expect(p.columns).toBeUndefined() // 原方案不动
  })
  it('新增时检查形状：楼梯必须往上走、圆柱尺寸相等、挑空要楼层', () => {
    const p = plan()
    const bad = [
      addElement(p, 'stair', { level: 'L2', to: 'L1', poly: rect(), path: [[0, 0], [0, 1000]], width: 900, kind: 'straight' }),
      addElement(p, 'column', { center: [0, 0], shape: 'round', size: [300, 400], kind: 'decorative' }),
      addElement(p, 'void', { level: 'nope', poly: rect() }),
      addElement(p, 'shaft', { poly: [[0, 0], [1, 1]], kind: 'flue' }),
    ]
    const { results } = applyChanges(p, bad)
    expect(results.map(r => r.ok)).toEqual([false, false, false, false])
    expect(results[0].error).toContain('更高')
  })
  it('修改柱：尺寸、旋转、类型；update 不能改 id', () => {
    const p = plan()
    const { plan: next, results } = applyChanges(p, [updateElement('column', 'col-d', { size: [500, 500], rotation: 15 })])
    expect(results[0].ok).toBe(true)
    expect(next.columns?.find(c => c.id === 'col-d')).toMatchObject({ size: [500, 500], rotation: 15 })
    expect(applyChanges(p, [updateElement('column', 'col-d', { id: 'x' })]).results[0].ok).toBe(false)
  })
  it('拆承重柱先要二次确认，确认后执行；装饰柱直接拆；先改成装饰柱再拆仍要确认', () => {
    const p = plan()
    const r1 = applyChanges(p, [removeElement(p, { type: 'column', id: 'col-b' })]).results[0]
    expect(r1).toMatchObject({ ok: false, needsConfirm: true })
    expect(r1.error).toContain('承重柱')
    const r2 = applyChanges(p, [confirmed(removeElement(p, { type: 'column', id: 'col-b' }))])
    expect(r2.results[0].ok).toBe(true)
    expect(r2.plan.columns?.map(c => c.id)).toEqual(['col-d'])
    expect(applyChanges(p, [removeElement(p, { type: 'column', id: 'col-d' })]).results[0].ok).toBe(true)
    const sneaky = applyChanges(p, [updateElement('column', 'col-b', { kind: 'decorative' }), removeElement(p, { type: 'column', id: 'col-b' })]).results
    expect(sneaky[1].needsConfirm).toBe(true)
  })
  it('管道井拆不了：带 confirm 也报错，原因写明', () => {
    const p = plan()
    for (const c of [removeElement(p, { type: 'shaft', id: 'sh' }), confirmed(removeElement(p, { type: 'shaft', id: 'sh' }))]) {
      const r = applyChanges(p, [c]).results[0]
      expect(r.ok).toBe(false)
      expect(r.needsConfirm).toBeFalsy()
      expect(r.error).toBe('管道井 / 烟道不能拆')
    }
    // 修改管道井（纠正读图的尺寸 / 类型）是允许的
    expect(applyChanges(p, [updateElement('shaft', 'sh', { kind: 'vent' })]).results[0].ok).toBe(true)
  })
  it('diffPlans 和 describeChange 认识新构件', () => {
    const p = plan()
    const add = addElement(p, 'column', { center: [5000, 0], shape: 'rect', size: [300, 300], kind: 'decorative', name: '新柱' })
    const { plan: next } = applyChanges(p, [add, updateElement('shaft', 'sh', { kind: 'vent' }), removeElement(p, { type: 'column', id: 'col-d' })])
    const d = diffPlans(p, next)
    expect(d.added.column).toEqual(['column1'])
    expect(d.removed.column).toEqual(['col-d'])
    expect(d.modified.shaft).toEqual(['sh'])
    expect(d.added.wall).toEqual([])
    expect(describeChange(p, add)).toBe('新增柱「新柱」（300×300mm）')
    expect(describeChange(p, removeElement(p, { type: 'shaft', id: 'sh' }))).toBe('拆除管道井')
    const stair = addElement(p, 'stair', { level: 'L1', to: 'L2', poly: rect(0, 0, 1000, 3000), path: [[500, 3000], [500, 0]], width: 1000, kind: 'straight' })
    expect(describeChange(p, stair)).toBe('新增楼梯（1F → 2F）')
    expect(describeChange(p, updateElement('column', 'col-d', { rotation: 5 }))).toBe('修改柱（直径 300mm）')
  })
  it('校验接受指向新构件的改造记录', () => {
    const p = plan()
    p.changes = [{ ...updateElement('column', 'col-d', { rotation: 10 }), id: 'c1' }]
    expect(validatePlan(p)).toEqual([])
  })
})
