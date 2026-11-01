import { describe, expect, it } from 'vitest'
import type { Plan, Vec2 } from '@/core/types'
import type { Ctx } from './canvas'
import { LABEL_SIZES, assignKeys, fitPlans, layoutRoomLabels, legendEntries } from './room-labels'
import { fitFrame, type Rect, type Xf } from './plan-draw'

function fakeCtx(): Ctx {
  const c = { font: '', fillStyle: '', textAlign: 'left', textBaseline: 'alphabetic', measureText: (s: string) => {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(c.font)?.[1] ?? 12)
    return { width: [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? size : size * 0.55), 0) }
  } }
  return c as unknown as Ctx
}
const ctx = fakeCtx()
const X: Xf = { s: 0.05, ox: 0, oy: 0, P: p => [p[0] * 0.05, p[1] * 0.05] } // 1 m = 50 px
const clip: Rect = { x: -1000, y: -1000, w: 4000, h: 4000 }
const rect = (x: number, y: number, w: number, h: number): Vec2[] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
const plan = (...rooms: { id: string; name: string; poly: Vec2[]; floorOffset?: number }[]) => ({ rooms, walls: [] } as unknown as Plan)
const onlyOne = (name: string, wMm: number, hMm = 3000) => layoutRoomLabels(ctx, plan({ id: 'a', name, poly: rect(0, 0, wMm, hMm) }), X, clip).labels[0]

describe('房间名：先缩字号，放不下才进图例', () => {
  it('放得下：用最大字号', () => {
    expect(onlyOne('客厅', 5000).size).toBe(LABEL_SIZES[0])
  })
  it('略紧：缩一档', () => {
    // 3 个字：12 号宽 36 + 边距 6 = 42 放不下，11 号 33 + 6 = 39 放得下；房间 40 px 宽
    expect(onlyOne('卫生间', 800).size).toBe(11)
  })
  it('再紧：缩到最小一档', () => {
    expect(onlyOne('卫生间', 740).size).toBe(10)
  })
  it('最小字号也放不下：进图例（size 0 = 字母方块）', () => {
    const e = onlyOne('卫生间（两卧之间）', 1500)
    expect(e.size).toBe(0)
    expect(legendEntries({ labels: [e] })[0].name).toBe('卫生间（两卧之间）')
  })
  it('字号永远不小于 10', () => {
    for (const w of [300, 500, 700, 900, 1200, 2000, 4000]) { const e = onlyOne('次卧', w); expect(e.size === 0 || e.size >= 10).toBe(true) }
  })
  it('名字整块在房间里', () => {
    const e = onlyOne('主卧', 2000)
    expect(e.box[0]).toBeGreaterThanOrEqual(0); expect(e.box[2]).toBeLessThanOrEqual(100)
  })
  it('不压序号：挪开，不缩', () => {
    const e = layoutRoomLabels(ctx, plan({ id: 'a', name: '客厅', poly: rect(0, 0, 5000, 3000) }), X, clip, [{ c: [125, 75], r: 15 }]).labels[0]
    expect(e.size).toBe(12)
    const dx = Math.max(e.box[0] - 125, 0, 125 - e.box[2]), dy = Math.max(e.box[1] - 75, 0, 75 - e.box[3])
    expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(15)
  })
  it('高差：放得下一起写；放不下只写名字；进图例时写在图例里', () => {
    const big = layoutRoomLabels(ctx, plan({ id: 'a', name: '飘窗', poly: rect(0, 0, 3000, 2000), floorOffset: 0.45 }), X, clip).labels[0]
    expect(big.showSub).toBe(true)
    const flat = layoutRoomLabels(ctx, plan({ id: 'a', name: '飘窗', poly: rect(0, 0, 3000, 480), floorOffset: 0.45 }), X, clip).labels[0]
    expect(flat.size).toBeGreaterThan(0); expect(flat.showSub).toBe(false)
    const tiny = layoutRoomLabels(ctx, plan({ id: 'a', name: '飘窗台（主卧转角）', poly: rect(0, 0, 1500, 480), floorOffset: 0.45 }), X, clip)
    expect(legendEntries(tiny)[0].name).toBe('飘窗台（主卧转角） +0.45 m')
  })
})

describe('取景框', () => {
  const frame: Rect = { x: 0, y: 0, w: 100, h: 100 }
  it('名字不被取景边切开：挪到框里露出来的那部分', () => {
    const e = layoutRoomLabels(ctx, plan({ id: 'a', name: '客厅', poly: rect(0, 0, 3000, 2000) }), X, frame).labels[0]
    expect(e.size).toBeGreaterThan(0)
    expect(e.box[2]).toBeLessThanOrEqual(100)
  })
  it('框外的房间不标、不进图例', () => {
    expect(layoutRoomLabels(ctx, plan({ id: 'a', name: '客厅', poly: rect(5000, 0, 3000, 2000) }), X, frame).labels).toHaveLength(0)
  })
  it('只露出一小截、又放不下的邻居不标', () => {
    const l = layoutRoomLabels(ctx, plan({ id: 'a', name: '景观阳台（客厅外的那一块）', poly: rect(1900, 0, 8000, 400) }), X, frame)
    expect(legendEntries(l)).toHaveLength(0)
  })
})

describe('图例字母', () => {
  const small = (id: string, name: string, x: number, y: number) => ({ id, name, poly: rect(x, y, 1500, 1500) })
  it('按位置排 A、B，几张图同一间房同一个字母', () => {
    const a = layoutRoomLabels(ctx, plan(small('p', '名字特别长的小房间甲', 2000, 0), small('q', '名字特别长的小房间乙', 0, 3000)), X, clip)
    const b = layoutRoomLabels(ctx, plan(small('q', '名字特别长的小房间乙', 0, 3000)), X, clip)
    assignKeys([a, b])
    expect(a.labels.find(e => e.id === 'p')!.key).toBe('A')
    expect(a.labels.find(e => e.id === 'q')!.key).toBe('B')
    expect(b.labels[0].key).toBe('B')
  })
})

describe('fitPlans', () => {
  const r: Rect = { x: 0, y: 0, w: 400, h: 400 }
  const slot = (p: Plan) => ({ plan: p, area: (strip: number) => ({ ...r, h: r.h - strip }), fit: (rr: Rect) => fitFrame([0, 0, 8000, 8000], rr) })
  it('有图例时给图例留高，图不压图例', () => {
    const p = plan({ id: 'a', name: '客厅', poly: rect(0, 0, 8000, 7000) }, { id: 'b', name: '名字特别特别长的一个储藏间', poly: rect(0, 7000, 1000, 1000) })
    const [f] = fitPlans(ctx, [slot(p)], '图例')
    expect(f.legend.map(e => e.key)).toEqual(['A'])
    expect(f.strip).toBeGreaterThan(0)
    expect(f.r.h).toBe(400 - f.strip)
  })
  it('没有图例时不占地方', () => {
    const [f] = fitPlans(ctx, [slot(plan({ id: 'a', name: '客厅', poly: rect(0, 0, 8000, 8000) }))], '图例')
    expect(f.strip).toBe(0)
    expect(f.r.h).toBe(400)
  })
  it('几张图共用一条图例，同一间房只写一次', () => {
    const p = plan({ id: 'a', name: '客厅', poly: rect(0, 0, 8000, 7000) }, { id: 'b', name: '名字特别特别长的一个储藏间', poly: rect(0, 7000, 1000, 1000) })
    const fs = fitPlans(ctx, [slot(p), slot(p)], '图例', { x: 0, w: 800, bottom: 400 })
    expect(fs[0].strip).toBe(fs[1].strip)
    expect(fs[0].legend[0].key).toBe(fs[1].legend[0].key)
  })
})
