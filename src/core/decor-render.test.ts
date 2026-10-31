import { expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { emptyPlan } from './io.ts'
import { createDecor } from './decor/presets.ts'
import { pointInPolygon } from './geometry.ts'
import { renderKit, resolveCamera, SEG_CLASSES, type CameraSpec } from './raster.ts'
import type { Furniture } from './decor/types.ts'
import type { Plan, Vec2 } from './types.ts'

// B1 (线上bug-1030): render draws the decor layer, so tool-placed furniture reaches the generation kit.
const rect = [[100,100],[3900,100],[3900,3900],[100,3900]] as Vec2[]
const sofa: Furniture = { id: 'sofa', type: 'sofa-3', at: [2000, 3200], rot: 0, size: [2000, 800], height: .85, by: 'user', status: 'confirmed' }
function furnished(): Plan {
  const p: Plan = { ...emptyPlan(), walls: [{ id: 'n', a: [0, 0], b: [4000, 0], kind: 'partition', thickness: 200 }, { id: 'e', a: [4000, 0], b: [4000, 4000], kind: 'partition', thickness: 200 }, { id: 's', a: [4000, 4000], b: [0, 4000], kind: 'partition', thickness: 200 }, { id: 'w', a: [0, 4000], b: [0, 0], kind: 'partition', thickness: 200 }], rooms: [{ id: 'r', name: '试验房间', poly: rect }] }
  p.decor = createDecor(); p.decor.furniture = [structuredClone(sofa)]
  return p
}
const cam: CameraSpec = { projection: 'perspective', pos: [2000, 1450, 1000], target: [2000, 1000, 4000], fov: 75 }
const size = { width: 96, height: 64 }
function pixels(png: Uint8Array) {
  const b = Buffer.from(png), chunks: Buffer[] = []
  for (let i = 8; i < b.length;) { const n = b.readUInt32BE(i); if (b.toString('ascii', i + 4, i + 8) === 'IDAT') chunks.push(b.subarray(i + 8, i + 8 + n)); i += n + 12 }
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20), data = inflateSync(Buffer.concat(chunks)), out: number[][] = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.push([...data.subarray(y * (w * 4 + 1) + 1 + x * 4, y * (w * 4 + 1) + 1 + x * 4 + 3)])
  return out
}
const has = (png: Uint8Array, rgb: readonly number[]) => pixels(png).some(p => p.every((v, i) => v === rgb[i]))

it('draws furniture into clay and seg, and lists what is visible in the camera record', () => {
  const k = renderKit(furnished(), { ...size, camera: cam, passes: ['clay', 'depth', 'lines', 'seg'] })
  expect(k.camera.decor).toMatchObject({ drawn: true, visible: [{ id: 'sofa', kind: 'furniture', type: 'sofa-3', name: '三人沙发', seg: 'sofa' }] })
  expect(k.camera.decor!.visible[0].visible_px).toBeGreaterThan(0)
  expect(has(k.files['seg-ade20k.png'], SEG_CLASSES.sofa)).toBe(true)
  expect(k.camera.segDecorClasses).toContain('sofa')
  const bare = renderKit(furnished(), { ...size, camera: cam, passes: ['clay', 'seg'], decor: false })
  expect(bare.camera.decor).toEqual({ drawn: false, skipped: 'disabled', visible: [], pendingHidden: 0, overheadHidden: 0, includePending: false })
  expect(has(bare.files['seg-ade20k.png'], SEG_CLASSES.sofa)).toBe(false)
  expect(Buffer.from(bare.files['clay.png']).equals(Buffer.from(k.files['clay.png']))).toBe(false)
})
it('decor sits on the renovated plan: an original render skips it once changes are confirmed', () => {
  const p = furnished()
  p.changes = [{ id: 'c1', op: 'update', type: 'room', target: 'r', data: { name: '客厅' }, by: 'user', status: 'confirmed' }]
  expect(renderKit(p, { ...size, camera: cam, passes: ['seg'] }).camera.decor).toMatchObject({ drawn: false, skipped: 'original-state' })
  expect(renderKit(p, { ...size, camera: cam, passes: ['seg'], state: 'renovated' }).camera.decor!.drawn).toBe(true)
  p.changes[0].status = 'pending'
  expect(renderKit(p, { ...size, camera: cam, passes: ['seg'] }).camera.decor!.drawn).toBe(true)
  delete p.decor
  expect(renderKit(p, { ...size, camera: cam, passes: ['seg'] }).camera.decor).toMatchObject({ drawn: false, skipped: 'none' })
})
it('room cameras stand clear of furniture footprints', () => {
  const p = furnished()
  p.decor!.furniture = [{ ...sofa, id: 'block', type: 'bed-1800', at: [2000, 2000], size: [2400, 2400], height: .5 }]
  const c = resolveCamera(p, { camera: 'room:r' }), at: Vec2 = [c.pos[0], c.pos[2]]
  const box: Vec2[] = [[800, 800], [3200, 800], [3200, 3200], [800, 3200]]
  expect(pointInPolygon(at, box)).toBe(false)
  expect(Math.hypot(Math.max(800 - at[0], 0, at[0] - 3200), Math.max(800 - at[1], 0, at[1] - 3200))).toBeGreaterThanOrEqual(200)
})
