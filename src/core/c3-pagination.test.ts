import { describe, expect, it } from 'vitest'
import type { Change, Vec2 } from './types.ts'
import { emptyPlan } from './io.ts'
import { changeFocus, paginate } from './pagination.ts'
import type { Focus } from './pagination.ts'
const change = (id: string, extra: Partial<Change> = {}): Change => ({ id, op: 'update', type: 'wall', target: 'w', data: { thickness: 150 }, by: 'agent', status: 'pending', ...extra })
const base = () => ({ ...emptyPlan(), walls: [{ id: 'w', a: [0, 0] as Vec2, b: [6000, 0] as Vec2, kind: 'partition' as const, thickness: 200 }], rooms: [{ id: 'r', name: '房', poly: [[0, 0], [6000, 0], [6000, 4000], [0, 4000]] as Vec2[] }], openings: [{ id: 'o', wall: 'w', offset: 1000, width: 1000, kind: 'window' as const, sill: .9, head: 2.3 }] })
const focus = (id: string, anchor: Vec2, extra: Partial<Focus> = {}): Focus => ({ changeId: id, changeIds: [id], anchor, bbox: [anchor[0] - 100, anchor[1] - 100, anchor[0] + 100, anchor[1] + 100], overview: [-1000, -1000, 15000, 15000], view: 'plan', level: 'L1', reason: '平面', ...extra })
describe('C3 改造清单取景与分页', () => {
  it('拆墙按局部区间锚定；开洞封洞、房间边界为平面', () => {
    const p = base(), copy = structuredClone(p)
    const focuses = changeFocus(p, [change('open', { op: 'remove', type: 'opening', target: 'o', data: undefined }), change('cut', { op: 'remove', range: [3000, 4000], data: undefined }), change('room', { type: 'room', target: 'r', data: { poly: p.rooms[0].poly } })])
    expect(focuses.map(f => f.view)).toEqual(['plan', 'plan', 'plan']); expect(focuses[1].anchor).toEqual([3500, 0]); expect(focuses[1].bbox).toEqual([3000, -100, 4000, 100]); expect(p).toEqual(copy)
  })
  it('洞底/洞顶/类型、玻璃/矮墙和梁用立面；房间高差层高、楼梯用 3D', () => {
    const p = base()
    for (const data of [{ sill: .5 }, { head: 2.2 }, { kind: 'floor-window' }]) expect(changeFocus(p, [change('c', { type: 'opening', target: 'o', data })])[0]).toMatchObject({ view: 'elevation', wall: 'w', level: 'L1' })
    for (const kind of ['glass', 'half', 'half-glass']) expect(changeFocus(p, [change('c', { data: { kind } })])[0].view).toBe('elevation')
    expect(changeFocus(p, [change('beam', { op: 'add', type: 'beam', data: { id: 'b', a: [0, 500], b: [3000, 500], width: 200, bottom: 2.4 } })])[0]).toMatchObject({ view: 'elevation', wall: 'b' })
    for (const data of [{ floorOffset: -.05 }, { ceiling: 3 }]) expect(changeFocus(p, [change('c', { type: 'room', target: 'r', data })])[0]).toMatchObject({ view: '3d', room: 'r' })
    expect(changeFocus(p, [{ ...change('stairs'), type: 'stair', op: 'add', data: { id: 's', level: 'L1', to: 'L2', poly: p.rooms[0].poly, path: [[0, 0], [2000, 0]], width: 900, kind: 'straight' } }])[0].view).toBe('3d')
  })
  it('同 group 合并一条，选择能表达高度的视图，保留前后 bbox 和全部 changeId', () => {
    const p = base(), f = changeFocus(p, [change('z', { group: 'g', data: { a: [-2000, 0] } }), change('a', { group: 'g', type: 'opening', target: 'o', data: { sill: 1 } })])
    expect(f).toHaveLength(1); expect(f[0]).toMatchObject({ changeId: 'a', changeIds: ['a', 'z'], group: 'g', view: 'elevation' }); expect(f[0].bbox[0]).toBe(-2000); expect(f[0].reason).toContain('洞底')
  })
  it('新增构件后修改可以连续定位；受保护的待确认拆除仍可预览而不执行', () => {
    const p = base(); p.walls[0].kind = 'bearing' as any
    const f = changeFocus(p, [change('add', { op: 'add', data: { id: 'new', a: [0, 5000], b: [1000, 5000], thickness: 120, kind: 'partition' } }), change('update', { target: 'new', data: { b: [2000, 5000] } }), change('remove', { op: 'remove', data: undefined })])
    expect(f).toHaveLength(3); expect(f[1].anchor).toEqual([1000, 5000]); expect(p.walls).toHaveLength(1)
    expect(() => changeFocus(p, [change('bad', { target: 'absent' })])).toThrow('不存在')
  })
  it('空间足够时用一页整屋总览，页框匹配目标比例', () => {
    const f = [focus('a', [0, 0]), focus('b', [12000, 0]), focus('c', [0, 12000])], pages = paginate(f, { aspectRatio: 2, pageWidthMm: 200 })
    expect(pages).toHaveLength(1); expect(pages[0].items).toHaveLength(3)
    const b = pages[0].frame; expect((b[2] - b[0]) / (b[3] - b[1])).toBeCloseTo(2); expect(b[0]).toBeLessThanOrEqual(-1000)
  })
  it('密集与同点序号拆页后无重叠，每组恰好出现一次，缩放和页面上限均满足', () => {
    const f = Array.from({ length: 15 }, (_, i) => focus(`c${i}`, [Math.floor(i / 3) * 6000 + i % 3 * 30, i % 3 * 20]))
    f.push(focus('coincident', f[0].anchor))
    const pages = paginate(f, { minNumberSpacing: 12, pageWidthMm: 200, maxItems: 4, aspectRatio: 1.5 })
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.flatMap(p => p.items.map(i => i.changeId)).sort()).toEqual(f.map(f => f.changeId).sort())
    for (const p of pages) {
      expect(p.items.length).toBeLessThanOrEqual(4)
      for (let i = 0; i < p.items.length; i++) for (let j = i + 1; j < p.items.length; j++) {
        const a = p.items[i].anchor, b = p.items[j].anchor
        expect(Math.hypot(a[0] - b[0], a[1] - b[1]) * 200 / (p.frame[2] - p.frame[0])).toBeGreaterThanOrEqual(12 - 1e-8)
      }
    }
  })
  it('编号按上到下左到右全局稳定，不受输入排列与分页选项影响', () => {
    const f = [focus('b', [5000, 1000]), focus('c', [0, 3000]), focus('a', [1000, 1000])]
    const mapping = (pages: ReturnType<typeof paginate>) => Object.fromEntries(pages.flatMap(p => p.items).map(i => [i.changeId, i.number]))
    expect(mapping(paginate(f))).toEqual({ a: 1, b: 2, c: 3 }); expect(mapping(paginate([...f].reverse(), { maxItems: 1 }))).toEqual({ a: 1, b: 2, c: 3 })
  })
  it('楼层、墙立面、房间 3D 分页互不混用，空列表返回空页', () => {
    const f = [focus('a', [0, 0], { view: 'elevation', wall: 'w' }), focus('b', [1000, 0], { view: 'elevation', wall: 'w2' }), focus('c', [0, 1000], { view: '3d', room: 'r' }), focus('d', [1000, 1000], { level: 'L2' })]
    expect(paginate(f)).toHaveLength(4); expect(paginate([])).toEqual([])
    expect(() => paginate(f, { maxItems: 0 })).toThrow('参数'); expect(() => paginate([f[0], f[0]])).toThrow('唯一')
  })
})
