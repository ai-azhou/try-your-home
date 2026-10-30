import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { isNotPlan, SIMPLE_TEMPLATE } from './simple.ts'
import { emptyPlan } from './io.ts'

// B8 (线上bug-1030): opening a JSON that is not a plan at all says so, instead of asking Chat for the simple format.
const json = (file: string) => JSON.parse(readFileSync(file, 'utf8'))

it('see-your-home side files and other JSON are not plans', () => {
  // 相机文件带 openings 数组（画面里的门窗）和自己的 format
  const camera = { projection: 'orthographic', id: 'top', pos: [0, 30000, 6000], target: [0, 0, 6000], format: 'floorplan-camera', version: 1, unit: 'mm', width: 2400, height: 1600, openings: [{ id: 'o-1', box: [10, 10, 40, 80] }], decor: { drawn: [], skipped: [], visible: [] } }
  const stats = { netArea: 80.2, grossArea: 92.1, walls: 14, doors: 6, windows: 6, openings: 12, rooms: 7, roomAreas: {} }
  const validate = { valid: true, issues: [] }
  const apply = { results: [{ id: 'c1', ok: true }], issues: [] }
  const rect = { corners: [[12, 30], [980, 28], [985, 700], [10, 705]], width: 1000, height: 720 }
  for (const v of [camera, stats, validate, apply, rect, { name: 'x', version: '1.0.0', dependencies: {} }, {}, [camera], [], null, 'json', 42]) expect(isNotPlan(v)).toBe(true)
})

it('anything that tries to be a plan still goes through the plan checks', () => {
  const plan = json('fixtures/skill-two-bed/plan.json')
  const weak = { 'floorplan-structure': 'version 3', layout: { rooms: [{ name: '客厅', poly: [[0, 0], [5000, 0], [5000, 4000], [0, 4000]] }], walls: [], doors: [{ from: '客厅', to: '卧室' }] } }
  for (const v of [plan, { plan }, { ...plan, walls: [], openings: [] }, (({ format, version, ...rest }) => rest)(plan), emptyPlan(), JSON.parse(SIMPLE_TEMPLATE), { ...JSON.parse(SIMPLE_TEMPLATE), rooms: 'x' }, json('fixtures/legacy-example.json'), weak, { myHome: { rooms: [] } }, { doors: [] }, { ...plan, format: 'floorplan-structure-v3' }])
    expect(isNotPlan(v)).toBe(false)
})
