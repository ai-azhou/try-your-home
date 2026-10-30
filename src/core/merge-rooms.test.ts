import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { emptyPlan, parsePlanText } from './io.ts'
import { applyChanges } from './changes.ts'
import { polygonArea } from './geometry.ts'
import { mergeAcrossWall } from './merge-rooms.ts'
import type { Plan } from './types.ts'

// B4 (线上bug-1030): after knocking down a partition by hand, the two rooms can become one.
function twoRooms(): Plan {
  return { ...emptyPlan(), walls: [
    { id: 'n', a: [0, 0], b: [7000, 0], kind: 'exterior', thickness: 200 }, { id: 'e', a: [7000, 0], b: [7000, 4000], kind: 'exterior', thickness: 200 },
    { id: 's', a: [7000, 4000], b: [0, 4000], kind: 'exterior', thickness: 200 }, { id: 'w', a: [0, 4000], b: [0, 0], kind: 'exterior', thickness: 200 },
    { id: 'mid', a: [4000, 0], b: [4000, 4000], kind: 'partition', thickness: 100 },
  ], rooms: [
    { id: 'living', name: '客厅', poly: [[100, 100], [3950, 100], [3950, 3900], [100, 3900]] },
    { id: 'study', name: '书房', poly: [[4050, 100], [6900, 100], [6900, 3900], [4050, 3900]] },
  ] }
}

it('two rooms across a partition merge into one outline that includes the wall strip', () => {
  const p = twoRooms(), m = mergeAcrossWall(p, 'mid')!
  expect(m.keep.id).toBe('living'); expect(m.drop.id).toBe('study')
  expect(m.poly).toHaveLength(4)
  expect(polygonArea(m.poly)).toBeCloseTo(6800 * 3800, -3)
  const after = applyChanges(p, [
    { id: 'c1', op: 'remove', type: 'wall', target: 'mid', by: 'user', status: 'confirmed' },
    { id: 'c2', op: 'update', type: 'room', target: 'living', data: { poly: m.poly }, by: 'user', status: 'confirmed' },
    { id: 'c3', op: 'remove', type: 'room', target: 'study', by: 'user', status: 'confirmed' },
  ])
  expect(after.results.every(r => r.ok)).toBe(true)
  expect(after.plan.rooms.map(r => r.id)).toEqual(['living'])
})
it('no offer when the wall does not separate exactly two comparable rooms', () => {
  expect(mergeAcrossWall(twoRooms(), 'n')).toBeNull()
  const step = twoRooms(); step.rooms[1].floorOffset = .15
  expect(mergeAcrossWall(step, 'mid')).toBeNull()
  expect(mergeAcrossWall(twoRooms(), 'missing')).toBeNull()
})
it('works on the published two-bed sample (bedroom 2 and living room across w-b)', () => {
  const p = parsePlanText(readFileSync('fixtures/skill-two-bed/plan.json', 'utf8')).plan, m = mergeAcrossWall(p, 'w-b')
  expect(m && [m.keep.id, m.drop.id].sort()).toEqual(['r-bed2', 'r-living'])
  expect(polygonArea(m!.poly)).toBeGreaterThan(polygonArea(m!.keep.poly) + polygonArea(m!.drop.poly))
})
