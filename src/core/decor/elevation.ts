import { wallSkins, type WallSkinOptions } from './wall-skins.ts'
import { elevationContext } from './elevation-context.ts'
import { furniturePose } from './furniture.ts'
import { styleOf, materialOf } from './surfaces.ts'
import { subtractRects } from './math.ts'
import type { Plan, Vec2 } from '../types.ts'
import type { FaceRef } from './types.ts'
import { add, beamFootprint, dot, effectiveWallHeight, mul, sub, wallDir, wallFootprint, roomsBesideWall, pointInPolygon, roomCeiling } from '../geometry.ts'
import { levelOf } from '../levels.ts'
import { faceAxis, faceExtent, faceRun, runS } from './faces.ts'
import { intersection, ordered, rectPoly } from './math.ts'
import type { ElevationRect } from './math.ts'
import { itemSpan, resolveDecor } from './resolve.ts'
import { panelGeometry } from './panels.ts'
import { layoutCabinet } from './cabinets.ts'
export interface ElevationElement extends ElevationRect { id: string; kind: string; polygons: Vec2[][][]; source?: unknown }
export function elevationOf(plan: Plan, wallId: string, side: 1 | -1, base: Plan = plan, opts: WallSkinOptions = {}) {
  const face: FaceRef = { wall: wallId, side }, axis = faceAxis(plan, face), run = faceRun(plan, face), outline: Vec2[][][] = [], openings: ElevationElement[] = [], beams: ElevationElement[] = [], adjacentWalls: ElevationElement[] = [], items: ElevationElement[] = []
  const floorLines: [Vec2, Vec2][] = [], ceilingLines: [Vec2, Vec2][] = []
  const element = (id: string, kind: string, u: [number, number], z: [number, number], source?: unknown): ElevationElement => ({ id, kind, u, z, polygons: [[rectPoly({ u, z })]], ...(source ? { source } : {}) })
  for (const part of run) {
    const s = faceExtent(plan, part.face), u = ordered(axis.toU(runS(part, s[0])), axis.toU(runS(part, s[1]))), h = part.wall.kind === 'half' ? part.wall.lowHeight ?? 1 : effectiveWallHeight(plan, part.wall)
    outline.push([rectPoly({ u, z: [0, h] })])
    const localAxis = faceAxis(plan, part.face), rooms = roomsBesideWall(plan, part.wall.id)[part.face.side === 1 ? 'positive' : 'negative']
    const cuts = [...new Set([s[0], s[1], ...rooms.flatMap(r => r.poly.map(p => dot(sub(p, part.wall.a), wallDir(part.wall)))).filter(v => v > s[0] && v < s[1])])].sort((a, b) => a - b)
    for (let i = 1; i < cuts.length; i++) {
      const room = rooms.find(r => pointInPolygon(localAxis.at((cuts[i - 1] + cuts[i]) / 2, 1), r.poly)), range = ordered(axis.toU(runS(part, cuts[i - 1])), axis.toU(runS(part, cuts[i]))), floor = room?.floorOffset ?? 0, ceiling = room ? roomCeiling(plan, room) : h
      floorLines.push([[range[0], floor], [range[1], floor]]); ceilingLines.push([[range[0], ceiling], [range[1], ceiling]])
    }
    for (const o of plan.openings.filter(o => o.wall === part.wall.id)) openings.push(element(o.id, o.kind, ordered(axis.toU(runS(part, o.offset)), axis.toU(runS(part, o.offset + o.width))), [o.sill, o.head], o))
  }
  const s0 = run[0].s[0], s1 = run[run.length - 1].s[1], strip = [axis.at(s0, -.01), axis.at(s1, -.01), axis.at(s1, .01), axis.at(s0, .01)]
  const projection = (poly: Vec2[]) => {
    const hit = intersection([[poly]], [[strip]]); if (!hit.length) return undefined
    const us = hit.flatMap(r => r[0].map(p => axis.toU(dot(sub(p, axis.wall.a), wallDir(axis.wall)))))
    return [Math.min(...us), Math.max(...us)] as [number, number]
  }
  for (const b of plan.beams.filter(b => levelOf(plan, b).id === levelOf(plan, axis.wall).id)) { const u = projection(beamFootprint(b)); if (u) beams.push(element(b.id, 'beam', u, [b.bottom, effectiveWallHeight(plan, axis.wall)], b)) }
  for (const w of plan.walls.filter(w => !run.some(p => p.wall.id === w.id) && levelOf(plan, w).id === levelOf(plan, axis.wall).id)) { const u = projection(wallFootprint(w)); if (u) adjacentWalls.push(element(w.id, 'wall-section', u, [0, effectiveWallHeight(plan, w)], w)) }
  const resolution = resolveDecor(plan), placed = resolution.placed.filter(p => p.status !== 'missing'), location = new Map<string, ElevationElement>()
  for (const p of placed) {
    let span; try { span = itemSpan(plan, p.item) } catch { continue }
    if (!span) continue
    const part = run.find(r => r.face.wall === span.face.wall && r.face.side === span.face.side); if (!part) continue
    const u = ordered(axis.toU(runS(part, span.s[0])), axis.toU(runS(part, span.s[1])))
    const e = element(p.id, 'place' in p.item ? 'cabinet' : 'thickness' in p.item ? 'panel' : 'host' in p.item ? 'recess' : 'at' in p.item ? 'furniture' : 'surface', u, span.z, p.item)
    if ('thickness' in p.item) { const g = panelGeometry(plan, p.item); e.polygons = g.visiblePolygons.map(rings => rings.map(r => r.map(([x, z]): Vec2 => [x + u[0], z]))); e.source = { item: p.item, geometry: g } }
    if ('place' in p.item) e.source = { item: p.item, layout: layoutCabinet(p.item) }
    items.push(e); location.set(p.id, e)
  }
  // Holes keep floor-relative z and local horizontal u; resolve hosts before contained furniture.
  for (const r of resolution.decor?.recesses ?? []) if (!('face' in r.host)) {
    const host = location.get('panel' in r.host ? r.host.panel : r.host.cabinet)
    if (host && r.rect.u) { const e = element(r.id, 'recess', [host.u[0] + r.rect.u[0], host.u[0] + r.rect.u[1]], r.rect.z, r); items.push(e); location.set(r.id, e) }
  }
  for (const f of resolution.decor?.furniture ?? []) if (f.in && location.has(f.in)) {
    const us = (resolution.placed.find(p => p.id === f.id)?.footprint ?? []).map(p => axis.toU(dot(sub(p, axis.wall.a), wallDir(axis.wall))))
    if (us.length) items.push(element(f.id, 'furniture', [Math.min(...us), Math.max(...us)], [furniturePose(plan, f).z, furniturePose(plan, f).z + f.height], f))
  }

  const contexts = run.map(part => {
    const context = elevationContext(plan, base, resolution.decor, part.face)!
    const shift = axis.toU(runS(part, faceAxis(plan, part.face).toS(0)))
    const translate = (u: [number, number]): [number, number] => [u[0] + shift, u[1] + shift]
    return {
      ...context, u: translate(context.u),
      segments: context.segments.map(s => ({ ...s, u: translate(s.u) })),
      removed: context.removed.map(r => ({ ...r, u: r.u + shift })),
      beams: context.beams.map(b => ({ ...b, u: translate(b.u) })),
      panels: context.panels.map(p => ({ ...p, u0: p.u0 + shift })),
      cabinets: context.cabinets.map(c => ({ ...c, u0: c.u0 + shift })),
      niches: context.niches.map(n => ({ ...n, u: translate(n.u) })),
      furniture: context.furniture.map(f => ({ ...f, u: translate(f.u) })),
    }
  })
  const unique = <T extends { id: string; u: [number, number] }>(xs: T[]): T[] => {
    const out = new Map<string, T>()
    for (const x of xs) { const prev = out.get(x.id); out.set(x.id, prev ? { ...prev, u: [Math.min(prev.u[0], x.u[0]), Math.max(prev.u[1], x.u[1])] } : x) }
    return [...out.values()]
  }
  const segments = contexts.flatMap(c => c.segments), panels = contexts.flatMap(c => c.panels), cabinets = contexts.flatMap(c => c.cabinets)
  const visible = outline.flat(2).map(p => p[0])
  const range: [number, number] = visible.length ? [Math.min(...visible), Math.max(...visible)] : [0, 0]
  const score = (sg: typeof segments[number]) => [...panels.map(p => [p.u0, p.u0 + p.geo.rect.u[1]]), ...cabinets.map(c => [c.u0, c.u0 + c.c.width])].filter(([a, b]) => a < sg.u[1] && b > sg.u[0]).length
  const focus = segments.length > 1 && range[1] - range[0] > 5000 ? [...segments].sort((a, b) => score(b) - score(a))[0].u : range
  const style = styleOf(plan), skirtHeight = style?.trims?.skirting?.height ?? .08
  const skirtOverrides = panels.filter(p => p.p.type === 'skirting').map(p => ({ p, u: [p.u0, p.u0 + p.geo.rect.u[1]] as [number, number], z: p.geo.rect.z }))
  const skirting = plan.decor ? subtractRects({ u: range, z: [0, skirtHeight] }, [...openings.filter(o => o.z[0] < skirtHeight).map(o => ({ u: o.u, z: [0, skirtHeight] as [number, number] })), ...skirtOverrides]).map(r => ({ ...r, polygons: [[rectPoly(r)]], material: materialOf(plan, style?.roles[style?.trims?.skirting?.role ?? 'skirting']) })) : []
  for (const o of skirtOverrides) skirting.push({ u: o.u, z: o.z, polygons: o.p.geo.visiblePolygons.map(rs => rs.map(r => r.map(([u, z]): Vec2 => [u + o.p.u0, z]))), material: materialOf(plan, o.p.p.material) })
  const contextBeams = unique(contexts.flatMap(c => c.beams)).map(b => ({ ...element(b.id, b.kind, b.u, [b.bottom, effectiveWallHeight(plan, axis.wall)]), ...b }))
  const furniture = unique(contexts.flatMap(c => c.furniture).map(f => ({ ...f, id: f.f.id })))
  for (const f of furniture) if (!items.some(i => i.id === f.f.id)) items.push(element(f.f.id, 'furniture', f.u, f.z, f.f))
  return { ax: axis, H: effectiveWallHeight(plan, axis.wall), wallKind: axis.wall.kind, thickness: axis.wall.thickness, segments, ends: contexts.flatMap(c => c.ends.filter(e => e.side === 'l' ? Math.abs(c.u[0] - range[0]) < 1 : Math.abs(c.u[1] - range[1]) < 1)), removed: contexts.flatMap(c => c.removed), panels, cabinets, niches: contexts.flatMap(c => c.niches), furniture, focus, skirting, face, axis, surfaces: wallSkins(plan, { ...opts, face }), width: range[1] - range[0], u: range, height: Math.max(...run.map(p => effectiveWallHeight(plan, p.wall))), outline, openings, beams: contextBeams, adjacentWalls, floorLines, ceilingLines, items, issues: resolution.issues }
}
