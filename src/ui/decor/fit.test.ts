import { expect, it } from 'vitest'
import { decorPlan } from '@/core/decor/fixtures'
import type { Furniture } from '@/core/decor/types'
import { fitCheck } from './plan-ctl'

// B5 (线上bug-1030): dragging furniture says whether it fits, not only the distances.
const sofa: Furniture = { id: 'sofa', type: 'sofa-3', at: [3000, 1500], rot: 0, size: [2000, 800], height: .85, by: 'user', status: 'confirmed' }
function plan(...more: Furniture[]) { const p = decorPlan(); p.decor!.furniture = [sofa, ...more].map(f => structuredClone(f)); return p }

it('clear floor fits; touching the wall or another sofa does not', () => {
  const p = plan()
  expect(fitCheck(p, p.decor!, p.decor!.furniture[0])).toMatchObject({ ok: true, text: '放得下' })
  const wall = plan(), f: Furniture = { ...sofa, at: [3000, 300] }
  wall.decor!.furniture = [f]
  expect(fitCheck(wall, wall.decor!, f)).toMatchObject({ ok: false, text: '放不下 · 压到墙' })
  const two = plan({ ...sofa, id: 'other', at: [3500, 1600] })
  expect(fitCheck(two, two.decor!, two.decor!.furniture[0])).toMatchObject({ ok: false, text: '放不下 · 和三人沙发重叠' })
})
it('a rug under the sofa is not an overlap', () => {
  const p = plan({ id: 'rug', type: 'rug', at: [3000, 1600], rot: 0, size: [2400, 1600], height: .01, by: 'user', status: 'confirmed' })
  expect(fitCheck(p, p.decor!, p.decor!.furniture[0]).ok).toBe(true)
  expect(fitCheck(p, p.decor!, p.decor!.furniture[1]).ok).toBe(true)
})
