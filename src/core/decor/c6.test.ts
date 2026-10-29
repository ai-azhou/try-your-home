import { describe, expect, it } from 'vitest'
import type { Plan, Vec2 } from '../types.ts'
import { wallSkins } from './wall-skins.ts'
import { elevationOf } from './elevation.ts'
import { faceAxis } from './faces.ts'
import { resolveSurfaces, materialTakeoff, wallLocation } from './surfaces.ts'
import { decorFocus } from './resolve.ts'
import { decorHandoff } from './integration.ts'
import { buildDecorSolids, decorWallSolids } from './solids.ts'
import { authored, cabinet, decorPlan, niche, panel } from './fixtures.ts'
import { intersection, rectPoly } from './math.ts'
import { polygonArea, pointInPolygon } from '../geometry.ts'
const area = (p: Vec2[][][]) => p.reduce((s, rs) => s + polygonArea(rs[0]) - rs.slice(1).reduce((n, r) => n + polygonArea(r), 0), 0) / 1000
const patch = (u: [number, number], z: [number, number]) => [[rectPoly({ u, z })]]
function rooms(p: Plan) {
  p.rooms = [{ id: 'a', name: '主卧', poly: [[0, 120], [3000, 120], [3000, 3000], [0, 3000]] }, { id: 'b', name: '客餐厅', poly: [[3000, 120], [6000, 120], [6000, 3000], [3000, 3000]] }]
  return p
}
const face = { wall: 'w', side: 1 as const }
describe('C6 continuous skins', () => {
  it('one face stays connected above a door; an interior window is a polygon hole', () => {
    const p = decorPlan(); p.openings = [{ id: 'd', wall: 'w', offset: 500, width: 900, kind: 'door', sill: 0, head: 2.1 }, { id: 'win', wall: 'w', offset: 3000, width: 1200, kind: 'window', sill: 1, head: 2 }]
    const skins = wallSkins(p, { face }); expect(skins).toHaveLength(1)
    expect(skins[0].polygons).toHaveLength(1); expect(skins[0].polygons[0]).toHaveLength(2)
    expect(skins[0].area).toBeCloseTo(6 * 2.8 - .9 * 2.1 - 1.2)
    expect(area(intersection(skins[0].polygons, patch([500, 1400], [0, 2.1])))).toBe(0)
    let triangles = 0
    const ps = skins[0].positions
    for (let i = 0; i < ps.length; i += 9) triangles += Math.abs((ps[i + 3] - ps[i]) * (ps[i + 7] - ps[i + 1]) - (ps[i + 6] - ps[i]) * (ps[i + 4] - ps[i + 1])) / 2
    expect(triangles).toBeCloseTo(skins[0].area)
  })
  it('joins reversed collinear records, preserving local sides and all IDs', () => {
    const p = decorPlan(); p.walls[0].b = [3000, 0]; p.walls.push({ ...p.walls[0], id: 'w2', a: [6000, 0], b: [3000, 0] })
    const all = wallSkins(p); expect(all).toHaveLength(2)
    const skin = wallSkins(p, { face })[0]
    expect(skin.faces).toEqual([face, { wall: 'w2', side: -1 }]); expect(skin.polygons).toHaveLength(1); expect(skin.area).toBeCloseTo(16.8)
  })
  it('height and horizontal overlays partition without gaps or overlaps, last wins', () => {
    const p = decorPlan(); p.decor!.surfaces = [{ id: 's1', ...authored, target: { face, s: [500, 3500], z: [0, 1] }, material: 'micro' }, { id: 's2', ...authored, target: { face, s: [2500, 4500], z: [.5, 2] }, material: 'oakVeneer' }]
    const skins = wallSkins(p, { face }); expect(skins).toHaveLength(3)
    expect(skins.reduce((s, p) => s + p.area, 0)).toBeCloseTo(16.8)
    for (let i = 0; i < skins.length; i++) for (const other of skins.slice(i + 1)) expect(area(intersection(skins[i].polygons, other.polygons))).toBe(0)
    expect(skins.find(s => s.materialId === 'micro')!.area).toBeCloseTo(2.5)
    expect(skins.find(s => s.materialId === 'oakVeneer')!.area).toBeCloseTo(3)
  })
  it('same-material overlays union into one face; preview does not mutate plan', () => {
    const p = decorPlan(), material = resolveSurfaces(p).walls[0].materialId
    p.decor!.surfaces = [{ id: 's', ...authored, target: { face, s: [500, 1500] }, material }]
    const before = structuredClone(p)
    expect(wallSkins(p, { face })).toHaveLength(1)
    expect(wallSkins(p, { face, keep: false, styleId: 'minimal' })[0].overridden).toBe(false)
    expect(p).toEqual(before)
  })
  it('two rooms remain separately identified on one wall', () => {
    const skins = wallSkins(rooms(decorPlan()), { face })
    expect(skins.map(s => s.room).sort()).toEqual(['a', 'b'])
    expect(skins.map(s => s.area)).toEqual([8.4, 8.4])
  })
  it('blind niche cuts only its own face; invalid through cuts do not hide a skin', () => {
    const p = decorPlan(); p.decor!.recesses = [niche()]
    expect(wallSkins(p, { face })[0].area).toBeCloseTo(16.8 - .4 * .6)
    expect(wallSkins(p, { face: { ...face, side: -1 } })[0].area).toBeCloseTo(16.8)
    const cut = p.decor!.recesses[0]; cut.depth = 240
    expect(wallSkins(p, { face })[0].area).toBeCloseTo(16.8)
    expect(buildDecorSolids(p).hideWallIds).toEqual([])
  })
  it('cross-record niche and replacement solids use the same cut on both segments', () => {
    const p = decorPlan(); p.walls[0].b = [3000, 0]; p.walls.push({ ...p.walls[0], id: 'w2', a: [3000, 0], b: [6000, 0] }); p.decor!.recesses = [niche('cross', [2800, 3200])]
    expect(wallSkins(p, { face })[0].area).toBeCloseTo(16.56)
    expect(buildDecorSolids(p).hideWallIds.sort()).toEqual(['w', 'w2'])
    for (const x of [2900, 3100]) expect(decorWallSolids(p).filter(s => s.z0 < 1 && s.z1 > 1).some(s => s.polygons.some(rs => pointInPolygon([x, 100], rs[0]) && !rs.slice(1).some(r => pointInPolygon([x, 100], r))))).toBe(false)
  })
  it.each([1, -1] as const)('side %s supplies correct winding, world elevation and u reversal', side => {
    const p = decorPlan(); p.levels = [{ id: 'up', name: '二层', elevation: 3 }]
    const skin = wallSkins(p, { face: { ...face, side }, offset: 2 })[0], ps = skin.positions
    expect(Math.min(...ps.filter((_, i) => i % 3 === 1))).toBe(3)
    expect(ps.filter((_, i) => i % 3 === 2).every(y => Math.abs(y - side * .122) < 1e-9)).toBe(true)
    for (let i = 0; i < ps.length; i += 9) {
      const crossZ = (ps[i + 3] - ps[i]) * (ps[i + 7] - ps[i + 1]) - (ps[i + 4] - ps[i + 1]) * (ps[i + 6] - ps[i])
      expect(crossZ * side).toBeGreaterThan(0)
    }
  })
  it.each([900, -900])('arc %s has one curved mesh per material and a hole, with real face-length area', bulge => {
    const p = decorPlan(); p.walls[0].bulge = bulge; p.openings = [{ id: 'o', wall: 'w', offset: 1000, width: 1800, kind: 'window', sill: .8, head: 2 }]
    const skin = wallSkins(p, { face })[0], ax = faceAxis(p, face)
    expect(wallSkins(p, { face })).toHaveLength(1); expect(skin.polygons[0]).toHaveLength(2)
    expect(skin.positions.length).toBeGreaterThan(100)
    expect(skin.area).toBeCloseTo((ax.length * 2.8 - 1800 * 1.2) * ax.scale / 1000)
    expect(new Set(skin.normals.filter((_, i) => i % 3 === 0).map(x => x.toFixed(3))).size).toBeGreaterThan(10)
  })
  it('empty/hidden faces, filters and invalid sampling do not produce invalid meshes', () => {
    const p = decorPlan(); expect(wallSkins(p, { level: 'absent' })).toEqual([])
    expect(() => wallSkins(p, { maxSegment: 0 })).toThrow()
    p.openings = [{ id: 'o', wall: 'w', offset: 0, width: 6000, kind: 'doorway', sill: 0, head: 2.8 }]
    expect(wallSkins(p)).toEqual([])
  })
})
describe('C6 elevations, locations and handoff', () => {
  it.each([1, -1] as const)('visible range and end sections on side %s survive a reversed chain and other floors', side => {
    const p = decorPlan(); p.walls[0].b = [3000, 0]; p.walls.push({ ...p.walls[0], id: 'w2', a: [6000, 0], b: [3000, 0] })
    p.levels = [{ id: 'L1', name: '一层', elevation: 0 }, { id: 'L2', name: '二层', elevation: 3 }]
    p.walls.push({ id: 'wrong', a: [0, -1000], b: [0, 1000], thickness: 500, kind: 'partition', level: 'L2' }, { id: 'left', a: [0, -1000], b: [0, 1000], thickness: 240, kind: 'exterior' }, { id: 'right', a: [6000, -1000], b: [6000, 1000], thickness: 300, kind: 'bearing' })
    const e = elevationOf(p, 'w', side)
    expect(e.u).toEqual(side === 1 ? [120, 5850] : [-2850, 2880]); expect(e.width).toBe(5730)
    expect(e.ends).toHaveLength(2); expect(e.ends.map(x => x.kind).sort()).toEqual(['bearing', 'exterior'])
    expect(e.surfaces).toEqual(wallSkins(p, { face: { wall: 'w', side } }))
    const us = e.surfaces.flatMap(s => s.polygons.flat(2).map(p => p[0])); expect(Math.min(...us)).toBe(e.u[0]); expect(Math.max(...us)).toBe(e.u[1])
  })
  it('material locations include room and north-adjusted direction, floors and orphan wall identity', () => {
    const p = rooms(decorPlan()); p.north = 0
    expect(materialTakeoff(p).flatMap(q => q.where)).toContain('主卧北墙')
    expect(materialTakeoff(p).flatMap(q => q.where)).toContain('客餐厅地面')
    expect(wallLocation(p, face, 'a')).toBe('主卧北墙'); p.north = 90
    expect(wallLocation(p, face, 'a')).toBe('主卧西墙'); delete p.north
    expect(wallLocation(p, face, 'a')).toBe('主卧上墙')
    expect(materialTakeoff(p).flatMap(q => q.where).some(w => ['墙面', '地面', '顶面', '柜门', '柜身', '台面'].includes(w))).toBe(false)
    expect(materialTakeoff(decorPlan()).flatMap(q => q.where).every(w => w.includes('w'))).toBe(true)
  })
  it('focus uses actual span in second room and follows panel holes and held furniture', () => {
    const p = rooms(decorPlan()); p.decor!.panels = [{ ...panel(), span: { face, s: [3500, 5000], z: [0, 2.5] } }]
    p.decor!.recesses = [{ id: 'hole', ...authored, kind: 'hole', host: { panel: 'panel' }, rect: { u: [100, 500], z: [1, 2] }, depth: 50 }]
    p.decor!.furniture = [{ id: 'tv', ...authored, type: 'tv', in: 'hole', size: [300, 30], height: .5 }]
    const focus = decorFocus(p)
    for (const id of ['panel', 'hole', 'tv']) expect(focus.find(f => f.id === id)?.room).toBe('b')
  })
  it('array handoff labels each actual type and retains missing IDs', () => {
    const p = decorPlan(); p.decor!.cabinets = [cabinet()]; p.decor!.panels = [panel()]; p.decor!.recesses = [niche()]
    p.decor!.furniture = [{ id: 'chair', ...authored, type: 'chair', at: [1000, 2000], rot: 0, size: [500, 500], height: 1 }]
    const text = decorHandoff(p, ['cab', 'panel', 'n', 'chair', 'missing'])
    for (const name of ['柜体 cab', '造型 panel', '壁龛 / 挖洞 n', '家具 chair', '装修 missing：不存在']) expect(text).toContain(name)
  })
})
