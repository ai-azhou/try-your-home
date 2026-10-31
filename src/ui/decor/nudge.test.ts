import { expect, it } from 'vitest'
import { decorPlan } from '@/core/decor/fixtures'
import { measureFootprints } from '@/core/measure'
import type { Furniture } from '@/core/decor/types'
import type { Vec2 } from '@/core/types'
import { nudgeFurniture, snapFurniture } from './plan-ctl'

// 墙 w 从 (0,0) 到 (6000,0)，厚 240：一侧墙面 y = 120。沙发深 800、正面朝 +y（rot 0），背面贴墙时中心 y = 520
const sofa = (at: Vec2, extra: Pick<Furniture, 'against'> = {}): Furniture => ({ id: 's', type: 'sofa-3', at, rot: 0, size: [2000, 800], height: .85, by: 'user', status: 'confirmed', ...extra })
const flushY = 520

it('贴着墙的沙发能离开墙 10 mm（不被吸回去），against 随之去掉', () => {
  const p = decorPlan(), f = sofa([3000, flushY], { against: { face: { wall: 'w', side: 1 }, gap: 0 } })
  expect(snapFurniture(p, f, [3000, flushY + 10]).at[1]).toBe(flushY) // 拖动会吸回去
  const n = nudgeFurniture(p, f, [0, 10])
  expect(n.at).toEqual([3000, flushY + 10])
  expect(n.against).toBeUndefined()
})
it('沿墙挪：还贴着，against 留着；走回墙面也记上', () => {
  const p = decorPlan(), f = sofa([3000, flushY])
  expect(nudgeFurniture(p, f, [100, 0])).toEqual({ at: [3100, flushY], against: { face: { wall: 'w', side: 1 }, gap: 0 } })
  expect(nudgeFurniture(p, sofa([3000, flushY + 10]), [0, -10]).against?.face.wall).toBe('w')
})
it('大步跨过墙面时停在墙面上，再按一下才压进墙', () => {
  const p = decorPlan(), near = sofa([3000, flushY + 60])
  const n = nudgeFurniture(p, near, [0, -100])
  expect(n.at[1]).toBeCloseTo(flushY, 6)
  expect(n.against?.face.wall).toBe('w')
  expect(nudgeFurniture(p, sofa(n.at), [0, -100]).at[1]).toBeCloseTo(flushY - 100, 6)
})
it('离墙远的就是平移，10 / 100 mm 都不走样', () => {
  const p = decorPlan(), f = sofa([3000, 2000])
  expect(nudgeFurniture(p, f, [-10, 0])).toEqual({ at: [2990, 2000] })
  expect(nudgeFurniture(p, f, [0, 100])).toEqual({ at: [3000, 2100] })
})

const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
it('⌥ 测距：两块占地的净距，贴着是 0，压住才算相交', () => {
  const a = rect(0, 0, 1000, 1000)
  const m = measureFootprints(a, [rect(1500, 200, 2500, 800)])
  expect(m).toMatchObject({ intersect: false, dx: 500 })
  expect(m.dy).toBeUndefined()
  expect(measureFootprints(a, [rect(1500, 1300, 2500, 2000)])).toMatchObject({ dx: 500, dy: 300 })
  expect(measureFootprints(a, [rect(1000, 0, 2000, 1000)])).toMatchObject({ intersect: false, nearest: 0 })
  expect(measureFootprints(a, [rect(900, 100, 2000, 900)]).intersect).toBe(true)
  // 转过的家具走最近点
  const tilted: Vec2[] = [[2000, 500], [2500, 1000], [2000, 1500], [1500, 1000]]
  expect(measureFootprints(a, [tilted]).nearest).toBeCloseTo(500, 6)
  // 多块（一面墙被洞口分开）取最近的那块
  expect(measureFootprints(a, [rect(5000, 0, 6000, 1000), rect(1200, 0, 1400, 1000)]).dx).toBe(200)
})
