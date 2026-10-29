import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { openingSymbol } from './opening-symbol.ts'
import { buildFixtures } from './solids.ts'
import { buildMesh } from './mesh.ts'
import { emptyPlan, parsePlanText } from './io.ts'
import { arcParams, bulgeFromAngle, distance, pointAt } from './geometry.ts'
import { cameraRoomEligible, listCameras, resolveCamera } from './raster.ts'
import type { Plan, Opening } from './types.ts'
function arc(kind: Opening['kind'] = 'window', angle = 90): Plan {
  const p = emptyPlan(); p.walls = [{ id: 'w', a: [0, 0], b: [4000, 0], thickness: 200, kind: 'partition', bulge: bulgeFromAngle(4000, angle) }]
  p.openings = [{ id: 'o', wall: 'w', offset: 200, width: 2400, sill: kind === 'window' ? .8 : 0, head: 2.4, kind }]
  return p
}
function room(): Plan {
  const p = emptyPlan()
  p.walls = [{ id: 'n', a: [0, 0], b: [4000, 0], thickness: 200, kind: 'partition' }, { id: 'e', a: [4000, 0], b: [4000, 4000], thickness: 200, kind: 'partition' }, { id: 's', a: [4000, 4000], b: [0, 4000], thickness: 200, kind: 'partition' }, { id: 'w', a: [0, 4000], b: [0, 0], thickness: 200, kind: 'partition' }]
  p.rooms = [{ id: 'r', name: '房间', poly: [[100, 100], [3900, 100], [3900, 3900], [100, 3900]] }]
  return p
}
it.each([90, 270, -270, 340])('arc %s: one pane, many tessellation vertices, only two jambs and two curved rails', angle => {
  const p = arc('window', angle), f = buildFixtures(p), symbol = openingSymbol(p, 'o')
  expect(f).toHaveLength(1); expect(f[0].path!.length).toBeGreaterThan(10); expect(symbol.divisions).toEqual([])
  expect(symbol.jambs).toHaveLength(2); expect(symbol.leaves).toHaveLength(1)
  const { radius, center } = arcParams(p.walls[0])!
  for (const v of f[0].path!) expect(distance(v, center)).toBeCloseTo(radius)
  expect(buildMesh(p).find(g => g.kind === 'pane')!.parts).toHaveLength(1)
  expect(buildMesh(p).find(g => g.kind === 'leaf')!.parts).toHaveLength(4)
})
it('proportional arc panes create only authored boundaries and preserve kinds', () => {
  const p = arc(); p.openings[0].panes = [{ width: 1, kind: 'fixed' }, { width: 2, kind: 'casement' }, { width: 1, kind: 'sliding' }]
  const f = buildFixtures(p), symbol = openingSymbol(p, 'o')
  expect(f.map(f => 'paneKind' in f && f.paneKind)).toEqual(['fixed', 'casement', 'sliding']); expect(f.map(f => 'width' in f && f.width)).toEqual([600, 1200, 600])
  expect(symbol.divisions).toHaveLength(2); expect(f[0].path!.at(-1)).toEqual(f[1].path![0]); expect(f[1].path!.at(-1)).toEqual(f[2].path![0])
  expect(buildMesh(p).find(g => g.kind === 'leaf')!.parts).toHaveLength(6)
})
it.each(['door', 'sliding'] as const)('%s uses curved leaves, no chord slabs; explicit pane counts are respected', kind => {
  const p = arc(kind); p.openings[0].panes = [{ width: 1, kind: 'sliding' }, { width: 1, kind: 'sliding' }]
  const fs = buildFixtures(p, { doorAngle: 0 }); expect(fs).toHaveLength(2)
  for (const f of fs) { expect(f.path!.length).toBeGreaterThan(2); expect(f.footprint!.length).toBeGreaterThan(4) }
  expect(fs[0].path!.at(-1)).toEqual(fs[1].path![0])
})
it.each(['start', 'end'] as const)('curved hinged leaf rotates around %s hinge without changing its shape', hinge => {
  const p = arc('door'); p.openings[0].swing = { hinge, side: -1 }
  const closed = buildFixtures(p, { doorAngle: 0 })[0], opened = buildFixtures(p, { doorAngle: 60 })[0]
  if (closed.kind !== 'door' || opened.kind !== 'door') throw Error('door')
  expect(opened.hinge).toEqual(closed.hinge)
  for (let i = 0; i < closed.path!.length; i++) expect(distance(opened.path![i], opened.hinge)).toBeCloseTo(distance(closed.path![i], closed.hinge))
  expect(opened.path).not.toEqual(closed.path)
})
it('straight fixture geometry retains old field shape and numeric results', () => {
  const p = arc(); delete p.walls[0].bulge
  p.openings[0].panes = [{ width: 1, kind: 'fixed' }, { width: 2, kind: 'casement' }]
  expect(buildFixtures(p)).toEqual([
    { kind: 'pane', id: 'o', wall: 'w', openingKind: 'window', paneKind: 'fixed', a: [200, 0], b: [1000, 0], center: [600, 0], dir: [1, 0], normal: [-0, 1], width: 800, thickness: 30, z0: .8, z1: 2.4 },
    { kind: 'pane', id: 'o', wall: 'w', openingKind: 'window', paneKind: 'casement', a: [1000, 0], b: [2600, 0], center: [1800, 0], dir: [1, 0], normal: [-0, 1], width: 1600, thickness: 30, z0: .8, z1: 2.4 },
  ])
  const symbol = openingSymbol(p, 'o'); expect(symbol.path).toEqual([[200, 0], [2600, 0]]); expect(symbol.divisions).toEqual([[[1000, 100], [1000, -100]]])
})
it('arc fixture metadata keeps local paths in mm and absolute vertical levels in m', () => {
  const p = arc(); p.levels = [{ id: 'up', name: '二层', elevation: 3 }]
  expect(buildFixtures(p)[0]).toMatchObject({ level: 'up', z0: 3.8, z1: 5.4 })
  expect(buildFixtures(p)[0].path![0]).toEqual(pointAt(p.walls[0], 200))
  expect(() => openingSymbol(p, 'missing')).toThrow()
})
it('camera eligibility excludes uncounted, tiny and raised platforms and keeps threshold boundaries', () => {
  const r = room().rooms[0]
  expect(cameraRoomEligible({ ...r, counted: false })).toBe(false)
  expect(cameraRoomEligible({ ...r, floorOffset: .301 })).toBe(false)
  expect(cameraRoomEligible({ ...r, floorOffset: .3 })).toBe(true)
  expect(cameraRoomEligible({ ...r, poly: [[0, 0], [1000, 0], [1000, 1499], [0, 1499]] })).toBe(false)
  expect(cameraRoomEligible({ ...r, poly: [[0, 0], [1000, 0], [1000, 1500], [0, 1500]] })).toBe(true)
  const p = room(); p.rooms[0].counted = false
  expect(listCameras(p).some(c => c.id.startsWith('room:'))).toBe(false)
  expect(() => resolveCamera(p, { camera: 'room:r' })).toThrow('不适合站人')
})
it('camera defaults omit wall variants; --all API includes them and preserves the same default view', () => {
  const p = room(), defaults = listCameras(p), all = listCameras(p, 'original', { all: true })
  expect(defaults.map(c => c.id)).toEqual(['iso-sw', 'iso-ne', 'iso-se', 'iso-nw', 'top', 'room:r'])
  expect(all.filter(c => c.id.startsWith('room:r:'))).toHaveLength(4)
  expect(all.find(c => c.id === 'room:r')).toEqual(defaults.at(-1))
})
it('open balconies keep a standing camera with the requested explanation', () => {
  const p = room(); p.rooms[0].name = '阳台'; p.openings = [{ id: 'open', wall: 's', offset: 100, width: 3800, sill: 0, head: 2.8, kind: 'open-balcony' }]
  expect(listCameras(p).find(c => c.id === 'room:r')?.description).toContain('开敞阳台，平视多半是天空')
})
it('CLI cameras accepts --all, defaults to room views only, and filters levels before computing', () => {
  const file = 'fixtures/example-v2.json'
  const invoke = (...args: string[]) => {
    const result = spawnSync(process.execPath, ['scripts/plan.ts', 'cameras', file, '--json', ...args], { encoding: 'utf8' }); expect(result.status, result.stderr).toBe(0); return JSON.parse(result.stdout) as { id: string }[]
  }
  const defaults = invoke(), all = invoke('--all')
  expect(defaults.filter(c => c.id.startsWith('room:')).every(c => c.id.split(':').length === 2)).toBe(true)
  expect(all.length).toBeGreaterThan(defaults.length)
  const p = parsePlanText(readFileSync(file, 'utf8')).plan
  expect(defaults.map(c => c.id)).toEqual(listCameras(p).map(c => c.id))
  const missing = spawnSync(process.execPath, ['scripts/plan.ts', 'cameras', file, '--level', 'absent'], { encoding: 'utf8' })
  expect(missing.status).toBe(1); expect(missing.stderr).toContain('未知楼层')
  const brief = spawnSync(process.execPath, ['scripts/plan.ts', 'cameras', file], { encoding: 'utf8' })
  expect(brief.status).toBe(0); expect(brief.stdout).toContain('iso-sw [L1]'); expect(brief.stdout).not.toContain('projection')
}, 15000)
