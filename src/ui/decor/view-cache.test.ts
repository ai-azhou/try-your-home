import { describe, expect, it, vi } from 'vitest'
import type { Plan } from '@/core/types'
import { applyChanges } from '@/core/changes'
import { wallSkins } from '@/core/decor/wall-skins'
import { resolveSurfaces } from '@/core/decor/surfaces'
import { createDecor } from '@/core/decor/presets'
import { demoPlan } from '../data'
import { getView, useStore } from '../store'
import { sameStructure } from '../model'
import { useDecor } from './dstore'
import { decorIssues, decorPlanOf, shownIssues } from './model'

const plan = () => structuredClone(demoPlan) as Plan
const decorA = () => createDecor('cream')

describe('decorPlanOf：同样的输入拿到同一个对象（下游缓存按身份比）', () => {
  it('同一份结构 + 同一份装修 → 同一个对象；装修变了 → 新对象，内容也对', () => {
    const p = plan(), a = decorA(), b = decorA()
    expect(decorPlanOf(p, a)).toBe(decorPlanOf(p, a))
    expect(decorPlanOf(p, b)).not.toBe(decorPlanOf(p, a))
    expect(decorPlanOf(p, b).decor).toBe(b)
    expect(decorPlanOf(p, undefined)).toBe(p)
  })
  it('方案本来就带这份装修：原样返回', () => {
    const a = decorA(), p = { ...plan(), decor: a }
    expect(decorPlanOf(p, a)).toBe(p)
  })
})

describe('decorIssues 缓存', () => {
  it('缩放、平移反复取：只算一次，结果是同一份', () => {
    const p = plan(), d = decorA()
    const first = decorIssues(decorPlanOf(p, d), p)
    const spy = vi.spyOn(Array.prototype, 'filter') // 命中缓存时函数体不执行
    const again = decorIssues(decorPlanOf(p, d), p)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
    expect(again).toBe(first)
  })
  it('两份视图轮流取互不挤掉（多层方案主画布和卡片各看一份）', () => {
    const p = plan(), q = plan(), d = decorA()
    const a = decorIssues(decorPlanOf(p, d), p), b = decorIssues(decorPlanOf(q, d), q)
    expect(decorIssues(decorPlanOf(p, d), p)).toBe(a)
    expect(decorIssues(decorPlanOf(q, d), q)).toBe(b)
  })
  it('装修变了要重算', () => {
    const p = plan(), d = decorA()
    expect(decorIssues(decorPlanOf(p, decorA()), p)).not.toBe(decorIssues(decorPlanOf(p, d), p))
  })
})

describe('连续挪动时沿用校验结果，松手重算', () => {
  it('拖动、方向键挪：不算新的；停下：拿到最新的', () => {
    const p = plan(), a = decorPlanOf(p, decorA()), b = decorPlanOf(p, decorA())
    const before = shownIssues(a, p)
    for (const moving of [{ dragging: 'x', nudging: null }, { dragging: null, nudging: 'x' }]) {
      useDecor.setState(moving)
      expect(shownIssues(b, p)).toBe(before)
    }
    useDecor.setState({ dragging: null, nudging: null })
    expect(shownIssues(b, p)).toBe(decorIssues(b, p))
    expect(shownIssues(b, p)).not.toBe(before)
  })
})

describe('视图：只改装修不重放结构', () => {
  const load = (mode: 'renovation' | 'decor') => {
    const base = plan()
    useStore.setState({ base, mode })
    return base
  }
  it('结构引用不变，装修和 base 是新的', () => {
    const base = load('decor'), v0 = getView()!, d = decorA()
    useStore.setState({ base: { ...base, decor: d } })
    const v1 = getView()!
    expect(v1.plan.walls).toBe(v0.plan.walls)
    expect(v1.plan.rooms).toBe(v0.plan.rooms)
    expect(v1.results).toBe(v0.results)
    expect(v1.plan.decor).toBe(d)
    expect(v1.base.decor).toBe(d)
  })
  it('结构真的变了（多一条改造）要重放，结果跟着变', () => {
    const base = load('renovation'), v0 = getView()!
    useStore.setState({ base: { ...base, changes: base.changes.slice(0, -1) } })
    const v1 = getView()!
    expect(v1.plan.walls).not.toBe(v0.plan.walls)
    expect(v1.results.length).toBe(v0.results.length - 1)
  })
  it('换模式要重算', () => {
    const base = load('decor'), v0 = getView()!
    useStore.setState({ mode: 'original', base })
    expect(getView()).not.toBe(v0)
    expect(getView()!.plan).toBe(base)
  })
  it('sameStructure：只认 decor 可以不同，多一个字段也算变了', () => {
    const p = plan()
    expect(sameStructure(p, { ...p, decor: decorA() })).toBe(true)
    expect(sameStructure(p, { ...p, walls: [...p.walls] })).toBe(false)
    expect(sameStructure(p, { ...p, title: 'x' })).toBe(false)
  })
})

describe('applyChanges：不拷底图和装修层', () => {
  const withUnderlay = () => {
    const p = plan()
    return { ...p, underlay: { src: 'data:image/png;base64,AAAA', visible: true, opacity: 50, mmPerPx: 10, origin: [0, 0] }, decor: decorA() } as unknown as Plan
  }
  it('底图、装修层共用同一份；结构是独立的拷贝，改结果不影响原方案', () => {
    const p = withUnderlay(), { plan: out } = applyChanges(p, p.changes)
    expect(out.underlay).toBe(p.underlay)
    expect(out.decor).toBe(p.decor)
    expect(out.walls).not.toBe(p.walls)
    const before = JSON.stringify(p.walls)
    out.walls[0].thickness = 1
    expect(JSON.stringify(p.walls)).toBe(before)
  })
  it('键的顺序不变（写回文件不产生无关差异）', () => {
    const p = withUnderlay()
    expect(Object.keys(applyChanges(p, []).plan)).toEqual(Object.keys(p))
    expect(applyChanges(p, p.changes).plan.title).toBe(p.title)
  })
  it('重放结果和整份深拷的写法一致', () => {
    const p = withUnderlay(), { plan: out, results } = applyChanges(p, p.changes)
    expect(JSON.parse(JSON.stringify({ ...out, underlay: 0, decor: 0 }))).toEqual(JSON.parse(JSON.stringify({ ...structuredClone(applyChanges({ ...p, underlay: undefined, decor: undefined }, p.changes).plan), underlay: 0, decor: 0 })))
    expect(results.length).toBe(p.changes.length)
  })
})

describe('wallSkins 的 resolved 参数', () => {
  it('传入算好的结果，输出和自己算一样', () => {
    const p = { ...plan(), decor: decorA() } as Plan
    const face = { wall: p.walls[0].id, side: 1 as const }
    const a = wallSkins(p, { face, offset: 4 }), b = wallSkins(p, { face, offset: 4, resolved: resolveSurfaces(p).walls })
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })
})
