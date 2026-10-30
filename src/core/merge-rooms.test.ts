import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { emptyPlan, parsePlanText } from './io.ts'
import { applyChanges } from './changes.ts'
import { polygonArea } from './geometry.ts'
import { mergeAcrossWall, roomSpanOnWall, roomsOverlapping, wallFootprintSides } from './merge-rooms.ts'
import { levelOf } from './levels.ts'
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

// 实测反馈：一侧房间比墙长时不弹合并；墙占地要能算给一侧；只拆一段
function longRoom(): Plan {
  return { ...emptyPlan(), walls: [{ id: 'w', a: [7000, 0], b: [13300, 0], kind: 'partition', thickness: 200 }], rooms: [
    { id: 'hall', name: '厅', poly: [[7000, -4000], [13300, -4000], [13300, -100], [7000, -100]] },
    { id: 'long', name: '阳台', poly: [[3900, 100], [13200, 100], [13200, 2000], [3900, 2000]] },
  ] }
}
function twoOnOneSide(): Plan {
  return { ...emptyPlan(), walls: [{ id: 'w', a: [0, 0], b: [6000, 0], kind: 'partition', thickness: 200 }], rooms: [
    { id: 'top', name: '过道', poly: [[0, -2000], [6000, -2000], [6000, -100], [0, -100]] },
    { id: 'l', name: '卧室', poly: [[0, 100], [3000, 100], [3000, 3000], [0, 3000]] },
    { id: 'r', name: '卫生间', poly: [[3000, 100], [6000, 100], [6000, 3000], [3000, 3000]] },
  ] }
}
it('一侧房间比墙长：贴墙范围按墙带求交，合并照常', () => {
  const p = longRoom(), w = p.walls[0]
  expect(roomSpanOnWall(w, p.rooms[1].poly)).toEqual([0, 6200])
  const m = mergeAcrossWall(p, 'w')!
  expect(m.keep.id).toBe('hall')
  expect(m.drop.id).toBe('long')
  expect(polygonArea(m.poly)).toBeGreaterThan(polygonArea(p.rooms[0].poly) + polygonArea(p.rooms[1].poly))
})
it('墙占地算给一侧：两间都留着，增加的正好是墙占地，不压另一侧', () => {
  const p = longRoom(), { positive, negative } = wallFootprintSides(p, 'w')
  for (const side of [positive!, negative!]) {
    expect(side.rooms).toHaveLength(1)
    const other = p.rooms.find(r => r.id !== side.rooms[0].room.id)!
    expect(roomsOverlapping({ ...p, rooms: [other] }, side.rooms[0].poly, levelOf(p, other).id)).toEqual([])
  }
  expect(Math.round(positive!.gained / 1e6 * 10) / 10).toBeCloseTo(Math.round(negative!.gained / 1e6 * 10) / 10, 0)
})
it('一侧有多间：不能合成一间，但算给那一侧时每间各收自己那段，不留缝', () => {
  const p = twoOnOneSide()
  expect(mergeAcrossWall(p, 'w')).toBeNull()
  const sides = wallFootprintSides(p, 'w'), many = [sides.positive!, sides.negative!].find(s => s.rooms.length === 2)!, one = [sides.positive!, sides.negative!].find(s => s.rooms.length === 1)!
  expect(many.rooms.map(r => r.room.id).sort()).toEqual(['l', 'r'])
  expect(many.gained).toBeCloseTo(6000 * 200 , -4)
  expect(one.rooms[0].room.id).toBe('top')
})
it('只拆一段：只看这一段贴着的房间，所以一侧多间的墙也能合并', () => {
  const p = twoOnOneSide()
  const m = mergeAcrossWall(p, 'w', [500, 2500])!
  expect([m.keep.id, m.drop.id].sort()).toEqual(['l', 'top'])
  const sides = wallFootprintSides(p, 'w', [500, 2500])
  const near = [sides.positive!, sides.negative!].find(s => s.rooms[0].room.id === 'l')!
  expect(near.rooms).toHaveLength(1)
  expect(near.gained).toBeCloseTo(2000 * 200, -4)
  expect(mergeAcrossWall(p, 'w', [0, 200])).toBeNull()
})
it('房间工具围出的一大片压住别的房间：能查出来；贴边不算', () => {
  const p = twoOnOneSide(), id = levelsOfId(p)
  expect(roomsOverlapping(p, [[-100, -2100], [6100, -2100], [6100, 3100], [-100, 3100]], id).map(r => r.id).sort()).toEqual(['l', 'r', 'top'])
  expect(roomsOverlapping(p, [[0, 3000], [3000, 3000], [3000, 5000], [0, 5000]], id)).toEqual([])
})
function levelsOfId(p: Plan) { return levelOf(p, p.rooms[0]).id }
