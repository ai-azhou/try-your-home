import { describe, expect, it } from 'vitest'
import { emptyPlan, parsePlanText, planFileValue, serializePlan } from './io.ts'
import { applyChanges, validateReplay } from './changes.ts'
import { modelPlan } from './mesh.ts'
import { exportGlb } from './glb.ts'
import { createRenderSession, listCameras, renderKit } from './raster.ts'
import type { Change, Plan } from './types.ts'
const base = (): Plan => ({ ...emptyPlan(), walls: [{ id: 'w', a: [0, 0], b: [4000, 0], kind: 'bearing', thickness: 240 }], columns: [{ id: 'c', center: [2000, 1000], shape: 'rect', size: [400, 400], kind: 'bearing' }] })
const update = (type: Change['type'], target: string, data: Change['data']): Change => ({ id: 'change-' + target, op: 'update', type, target, data, by: 'agent', status: 'confirmed' })
describe('O5 protected structure', () => {
  it.each(['bearing', 'exterior'] as const)('%s wall needs explicit confirmation for loss or relocation', kind => {
    const p = base(); p.walls[0].kind = kind
    for (const data of [{ a: [10, 0] }, { b: [1, 0] }, { thickness: .001 }, { height: .001 }, { kind: 'partition' }, { bulge: 100 }]) {
      const c = update('wall', 'w', data)
      expect(applyChanges(p, [c]).results[0]).toMatchObject({ ok: false, needsConfirm: true })
      expect(applyChanges(p, [{ ...c, confirm: { by: 'owner' } }]).results[0].ok).toBe(true)
    }
    expect(applyChanges(p, [update('wall', 'w', { thickness: 300, name: 'renamed' })]).results[0].ok).toBe(true)
  })
  it('bearing columns retain original protection after confirmed category changes', () => {
    const p = base()
    for (const data of [{ center: [2100, 1000] }, { size: [200, 400] }, { kind: 'decorative' }, { shape: 'round' }, { rotation: 45 }]) {
      expect(applyChanges(p, [update('column', 'c', data)]).results[0]).toMatchObject({ ok: false, needsConfirm: true })
    }
    for (const [type, target, data] of [['wall', 'w', { kind: 'partition' }], ['column', 'c', { kind: 'decorative' }]] as const) {
      const first = { ...update(type, target, data), confirm: { by: 'owner' } }
      const move = update(type, target, type === 'wall' ? { b: [3000, 0] } : { center: [2500, 1000] })
      expect(applyChanges(p, [first, move]).results.map(r => r.ok)).toEqual([true, false])
    }
  })
})
describe('O5 file boundaries and final geometry', () => {
  it.each([
    (v: any) => { v.walls[0].heigth = 1000 },
    (v: any) => { v.questions = [{ id: 'q', category: 'original' }] },
    (v: any) => { v.walls[0].evidence = { certainty: 'seen', pixelBox: [1, 2] } },
    (v: any) => { v.ceiling = '2800' },
    (v: any) => { v.changes = [update('wall', 'w', { heigth: 1000 })] },
  ])('rejects invalid schemas before geometry', mutate => {
    const v = planFileValue(base()); mutate(v)
    expect(parsePlanText(JSON.stringify(v)).issues.some(i => i.code === 'schema')).toBe(true)
  })
  it('keeps v2 conversion and strips untrusted replay state', () => {
    const p = base(); p.changes = [{ ...update('wall', 'w', { thickness: 300 }) }]
    p.legacy = { __structureReplayFrame: { x0: 0, x1: 4000, y0: 0, y1: 1000 }, preserved: 'snapshot' }
    const parsed = parsePlanText(JSON.stringify(p))
    expect(parsed.issues).toEqual([])
    expect(parsed.plan.legacy).toEqual({ preserved: 'snapshot' })
    expect(modelPlan(parsed.plan, 'renovated').walls[0].thickness).toBe(300)
    expect(serializePlan(p)).not.toContain('__structureReplayFrame')
  })
  it('blocks invalid final geometry in every delivery entry point and identifies its change', () => {
    const p = base(); p.rooms = [{ id: 'r', name: 'Room', poly: [[0, 0], [4000, 0], [4000, 4000], [0, 4000]] }]
    p.changes = [update('room', 'r', { poly: [[0, 0], [4000, 4000], [0, 4000], [4000, 0]] })]
    const replay = applyChanges(p, p.changes)
    expect(validateReplay(replay, p.changes).find(i => i.code === 'room-self-intersection')?.changeIds).toEqual(['change-r'])
    for (const action of [() => modelPlan(p, 'renovated'), () => exportGlb(p, { state: 'renovated' }), () => listCameras(p, 'renovated'), () => renderKit(p, { state: 'renovated', width: 40, height: 30 })]) expect(action).toThrow('change-r')
  })
  it('rejects missing camera floors just as render does', () => {
    expect(() => listCameras(base(), 'original', { level: 'missing' })).toThrow('未知楼层')
    expect(() => renderKit(base(), { level: 'missing', width: 40, height: 30 })).toThrow('未知楼层')
  })
})

it('batch snapshots reuse geometry without leaking state, sections or later live edits', () => {
  const p = base(); p.changes = [update('wall', 'w', { thickness: 480 })]
  const session = createRenderSession(p)
  for (const state of ['original', 'renovated'] as const) for (const camera of ['iso-sw', 'top']) {
    const options = { state, camera, width: 40, height: 30 }
    expect(session.renderKit(options).files).toEqual(renderKit(p, options).files)
  }
  const before = session.renderKit({ width: 40, height: 30 }).files
  p.walls[0].thickness = 600
  expect(session.renderKit({ width: 40, height: 30 }).files).toEqual(before)
})
