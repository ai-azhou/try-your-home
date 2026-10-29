import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { emptyPlan, parsePlanText } from './io.ts'
import { applyChanges } from './changes.ts'
import { polygonArea, pointInPolygon } from './geometry.ts'
import { renderKit, resolveCamera } from './raster.ts'

const fixture = () => parsePlanText(readFileSync(new URL('./fixtures/o8-newuser.json', import.meta.url), 'utf8')).plan
it.each(['original', 'renovated'] as const)('试用户型 %s 默认客厅能看见门窗，站在室内且不误报房间窄', state => {
  const p = fixture(), camera = resolveCamera(p, { camera: 'room:r-living', state })
  expect(camera.description).toContain('画面里有')
  expect(camera.description).not.toContain('房间窄')
  const view = state === 'original' ? p : applyChanges(p, p.changes).plan
  expect(pointInPolygon([camera.pos[0], camera.pos[2]], view.rooms.find(r => r.id === 'r-living')!.poly)).toBe(true)
  const k = renderKit(p, { camera, state, width: 240, height: 160, passes: ['openings'] })
  expect(k.camera.openings.some(o => o.visible_px >= 240 * 160 * .01 && o.bbox_xyxy[2] - o.bbox_xyxy[0] > 240 * .05)).toBe(true)
  expect(camera).toEqual(resolveCamera(p, { camera: 'room:r-living', state }))
})
it('合并后的客厅面积确实增大；没有洞口时仍能给出默认机位', () => {
  const p = fixture(), after = applyChanges(p, p.changes).plan
  expect(polygonArea(after.rooms.find(r => r.id === 'r-living')!.poly)).toBeGreaterThan(polygonArea(p.rooms.find(r => r.id === 'r-living')!.poly))
  p.openings = []
  expect(resolveCamera(p, { camera: 'room:r-living' }).projection).toBe('perspective')
})

it('真正狭窄的房间仍提示房间窄', () => {
  const p = emptyPlan()
  p.rooms = [{ id: 'narrow', name: '窄间', poly: [[0, 0], [1100, 0], [1100, 3000], [0, 3000]] }]
  expect(resolveCamera(p, { camera: 'room:narrow' }).description).toContain('房间窄')
})
