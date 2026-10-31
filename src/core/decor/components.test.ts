import { describe, it, expect } from 'vitest'
import { parsePath, flattenPath, pathRegion, pathBounds } from './svg-path.ts'
import { componentPrisms, componentPlanPaths, componentFrontPaths, validateComponent } from './components.ts'
import { componentExamples } from './component-fixtures.ts'
import { decorPlan, authored, cabinet, panel, niche } from './fixtures.ts'
import { buildDecorSolids } from './solids.ts'
import { validatePlan } from '../validate.ts'
import { furnitureCollisions } from './furniture.ts'
import { mirrorPlan } from '../edit.ts'
import { parsePlanText, serializePlan, METRE_PATHS } from '../io.ts'
import { confirmedDecor, restoreDecorItem } from './resolve.ts'
import type { CustomComponent, Furniture } from './types.ts'
import { decorHandoff } from './integration.ts'
import { renderKit } from '../raster.ts'
import { materialTakeoff } from './surfaces.ts'

const rectangle: CustomComponent = { id: 'box-def', name: '盒', category: 'other', label: '测试盒', size: [100, 100], height: 100, parts: [{ outline: 'M0 0H100V100H0Z', z: [10, 80] }] }
describe('SVG paths', () => {
  it('supports every absolute and relative command, repetition, reflected controls and arc flags', () => {
    for (const d of ['M0 0L10 0H20V30C20 40 30 40 40 30S60 20 70 30Q80 40 90 30T100 30A20 10 30 0 1 120 40Z', 'm1 2 10 0l0 10h10v10c0 5 5 5 10 0s10 -5 10 0q5 5 10 0t10 0a10 10 0 0110 10z']) {
      expect(parsePath(d).error).toBeUndefined(); const paths = flattenPath(d); expect(paths).toHaveLength(1); expect(paths[0].closed).toBe(true); expect(paths[0].points.length).toBeGreaterThan(10); expect(paths[0].points.length).toBeLessThanOrEqual(256)
    }
    expect(flattenPath('M0 0h10v20h-10z')[0].points).toEqual([[0, 0], [10, 0], [10, 20], [0, 20]])
    const arc = pathBounds('M0 50A50 50 0 1 1 100 50A50 50 0 1 1 0 50Z'); arc.forEach((v, i) => expect(v).toBeCloseTo([0, 0, 100, 100][i], 0))
  })
  it('rejects invalid characters, malformed syntax, flags and overlong input with command numbers', () => {
    for (const d of ['', 'L0 0', 'M0', 'M0 0 R2 3', '<svg/>', 'MNaN 0', 'M0 0A1 1 0 2 0 2 2', 'M0 0,', 'M0 0,,2 2', 'M ,0 0', 'M0 0Z2 3', 'M0 0' + ' '.repeat(8192)]) expect(parsePath(d).error).toMatch(/第 \d+ 个命令/)
  })
  it('evenodd makes holes and overlapping subpaths xor; open paths can form filled regions', () => {
    const region = pathRegion('M0 0H100V100H0Z M20 20H80V80H20Z'); expect(region).toHaveLength(1); expect(region[0]).toHaveLength(2)
    expect(pathRegion('M0 0L100 0L100 100')).toHaveLength(1)
  })
})
describe('component geometry and validation', () => {
  it('extrudes holes at exact z; side slices slope and preserves evenodd intervals', () => {
    const p = componentPrisms(rectangle); expect(p[0]).toMatchObject({ z0: 10, z1: 80, part: 0 })
    const hole = componentPrisms({ ...rectangle, parts: [{ outline: 'M0 0H100V100H0Z M20 20H80V80H20Z', z: [0, 100] }] }); expect(hole[0].polygons[0]).toHaveLength(2)
    for (const along of ['width', 'depth'] as const) { const p = componentPrisms({ ...rectangle, parts: [{ kind: 'side', along, profile: 'M0 0L100 100H0Z', span: [0, 100] }] }); expect(p).toHaveLength(24); expect(Math.min(...p.map(v => v.z0))).toBe(0); expect(Math.max(...p.map(v => v.z1))).toBe(100) }
  })
  it('revolves solid and hollow rings with 32 sides', () => {
    for (const radius of [0, 20]) { const p = componentPrisms({ ...rectangle, parts: [{ kind: 'revolve', profile: `M${radius} 0H50V100H${radius}Z` }] }); expect(p).toHaveLength(1); expect(p[0].polygons[0]).toHaveLength(radius ? 2 : 1); expect(p[0].polygons[0][0]).toHaveLength(33) }
  })
  it('validates all five fictional components, projects views, places z above level and preserves part metadata', () => {
    const plan = decorPlan(); plan.levels = [{ id: 'upstairs', name: '二层', elevation: 3, ceiling: 2.8 }]; plan.walls[0].level = 'upstairs'
    plan.decor!.components = structuredClone(componentExamples)
    plan.decor!.furniture = componentExamples.map((def, i) => ({ id: `custom-${i}`, ...authored, type: `custom:${def.id}`, size: def.size, height: def.height / 1000, at: [i * 3000, 3000], rot: 30, z: .9, level: 'upstairs' }))
    expect(validatePlan(plan).filter(i => i.level === 'error')).toEqual([])
    const solids = buildDecorSolids(plan)
    for (const [i, def] of componentExamples.entries()) {
      expect(validateComponent(def, new Set())).toEqual([]); expect(componentPlanPaths(def).length).toBeGreaterThan(0); expect(componentFrontPaths(def).length).toBeGreaterThan(0)
      const s = solids.filter(s => s.ids[0] === `custom-${i}`); expect(Math.min(...s.map(v => v.z0))).toBeCloseTo(3.9); expect(Math.max(...s.map(v => v.z1))).toBeCloseTo(3.9 + def.height / 1000)
    }
    expect(solids.find(s => s.ids[0] === 'custom-0')?.color).toBe('#222222')
    expect(decorHandoff(plan, { type: 'furniture', id: 'custom-0' })).toContain('65 寸电视示例（家电）')
  })
  it('reports invalid paths, bounds, empty geometry, z, label, color, material and complexity', () => {
    const invalid = [ { ...rectangle, label: '' }, { ...rectangle, parts: [] }, { ...rectangle, parts: [{ outline: 'M0 0H102V100H0Z', z: [0, 100] }] }, { ...rectangle, parts: [{ outline: 'bad', z: [0, 100] }] }, { ...rectangle, parts: [{ ...rectangle.parts[0], z: [0, 101] }] }, { ...rectangle, parts: [{ ...rectangle.parts[0], color: 'red', material: 'missing' }] }, { ...rectangle, parts: Array(401).fill(rectangle.parts[0]) } ]
    for (const def of invalid) expect(validateComponent(def as CustomComponent, new Set()).some(i => i.code === 'component-invalid')).toBe(true)
  })
  it('mirrors asymmetric parts and pending snapshots, with exact two-mirror restoration', () => {
    const p = decorPlan(); p.decor!.components = [componentExamples[2]]; p.decor!.furniture = [{ id: 'sofa', ...authored, type: 'custom:l-sofa', size: [2400, 1600], height: .85, at: [2200, 1500], rot: 23 }]
    for (const flip of [undefined, false, true]) for (const axis of ['x', 'y'] as const) { const q = structuredClone(p); if (flip !== undefined) q.decor!.furniture[0].flip = flip; q.decor!.furniture[0].prev = { ...q.decor!.furniture[0], at: [1500, 1800] }; q.decor!.furniture[0].status = 'pending'; const m = mirrorPlan(q, axis); expect(m.decor!.furniture[0].flip).toBe(!flip); expect(mirrorPlan(m, axis)).toEqual(q) }
  })
  it('flat custom components and rugs do not collide; unknown definitions have no fallback solids', () => {
    const p = decorPlan(); p.decor!.components = [componentExamples[1]]; const f: Furniture = { id: 'chair', ...authored, type: 'chair', size: [500, 500], height: .85, at: [3000, 2000], rot: 0 }; p.decor!.furniture = [f, { ...f, id: 'rug', type: 'custom:round-rug', size: [1600, 1600], height: .01 }]
    expect(furnitureCollisions(p, f)).toEqual([]); expect(furnitureCollisions(p, p.decor!.furniture[1])).toEqual([])
    p.decor!.furniture[1].type = 'custom:missing'; expect(buildDecorSolids(p).filter(s => s.ids.includes('rug'))).toEqual([])
  })
  it('roundtrips prev units; confirmed view restores old items and filters dependent chains', () => {
    const p = decorPlan(); const f: Furniture = { id: 'f', ...authored, type: 'chair', size: [500, 500], height: .85, at: [1000, 2000], rot: 0, z: .9 }
    p.decor!.furniture = [{ ...f, height: 1.2, status: 'pending', prev: { ...f } }, { ...f, id: 'new', status: 'pending' }, { ...f, id: 'child', at: undefined, in: 'new' }]
    const text = serializePlan(p); expect(JSON.parse(text).decor.furniture[0].prev.height).toBe(850); const round = parsePlanText(text).plan; expect(round.decor!.furniture[0].prev!.z).toBe(.9)
    expect(restoreDecorItem(p.decor!.furniture[0])).toEqual(f); expect(confirmedDecor(p.decor)!.furniture).toEqual([f]); expect(p.decor!.furniture).toHaveLength(3)
    expect(METRE_PATHS.some(p => p.includes('components'))).toBe(false)
  })
})

it('all prev length paths use the same units and old materials remain in takeoff', () => {
  const p = decorPlan(), c = cabinet(), pa = panel(), r = niche()
  c.cuts = [{ u: [100, 200], z: [.4, .6], depth: 'through' }]
  c.columns[0].cells[0].appliance = { type: 'tv', size: [400, 100, .3] }
  r.shelves = [1.1]
  p.decor!.cabinets = [c]; p.decor!.panels = [pa]; p.decor!.recesses = [r]
  p.decor!.surfaces = [{ id: 'surface', ...authored, material: 'oak', target: { face: { wall: 'w', side: 1 }, z: [.4, 1.4] } }]
  const old = materialTakeoff(p)
  for (const k of ['cabinets', 'panels', 'recesses', 'surfaces'] as const) for (const item of p.decor![k]) { item.prev = structuredClone(item) as unknown as Record<string, unknown>; item.status = 'pending' }
  p.decor!.panels[0].material = 'white'
  const file = JSON.parse(serializePlan(p)); expect(file.decor.cabinets[0].prev.columns[0].cells[0].appliance.size).toEqual([400, 100, 300]); expect(file.decor.recesses[0].prev.shelves).toEqual([1100]); expect(file.decor.surfaces[0].prev.target.z).toEqual([400, 1400])
  expect(parsePlanText(JSON.stringify(file)).plan.decor).toEqual(p.decor)
  expect(materialTakeoff(p)).toEqual(old)
})
it('custom multipart segmentation shares one instance id and the definition name; explicit seg overrides category', () => {
  const p = decorPlan(); p.decor!.components = [{ ...componentExamples[3], seg: 'chair' }]
  p.decor!.furniture = [{ id: 'table', ...authored, type: 'custom:four-leg-table', size: [1600, 800], height: .75, at: [3000, 2000], rot: 0 }]
  const k = renderKit(p, { camera: { projection: 'orthographic', pos: [3000, 5000, 2000], target: [3000, 0, 2000], up: [0, 0, -1], span: 4000 }, width: 96, height: 96, passes: ['clay', 'seg'] })
  expect(k.camera.decor!.visible).toHaveLength(1); expect(k.camera.decor!.visible[0]).toMatchObject({ id: 'table', name: '四腿餐桌', seg: 'chair' })
})
it('world transforms use centered canvas, flip, rotation and exact prism height', () => {
  const p = decorPlan(); p.decor!.components = [rectangle]; p.decor!.furniture = [{ id: 'box', ...authored, type: 'custom:box-def', size: [100, 100], height: .1, at: [1000, 2000], rot: 90, flip: true, z: .2 }]
  const s = buildDecorSolids(p)[0]
  expect(s.z0).toBeCloseTo(.21); expect(s.z1).toBeCloseTo(.28)
  // Local (0,0) -> centered (-50,-50) -> flip (50,-50) -> rotate (50,50).
  expect(s.polygons[0][0].some(([x, y]) => Math.abs(x - 1050) < 1e-7 && Math.abs(y - 2050) < 1e-7)).toBe(true)
})
