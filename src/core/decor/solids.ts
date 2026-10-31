import { componentOf, componentPrisms, isCustomType } from './components.ts'
import type { Plan, Vec2 } from '../types.ts'
import type { Decor } from './types.ts'
import type { Solid } from '../solids.ts'
import { buildSolids } from '../solids.ts'
import { levelOf, levelsOf } from '../levels.ts'
import { checkEmbed, embedFootprint, embedsOf } from './embed.ts'
import { cabinetTransform, layoutCabinet } from './cabinets.ts'
import { panelGeometry, panelTransform } from './panels.ts'
import { furnitureFootprint, furnitureLevel, furniturePose } from './furniture.ts'
import { difference, overlap, rectPoly } from './math.ts'
import type { ElevationRect, Interval } from './math.ts'
import { faceRun, faceWall } from './faces.ts'
import { decorItems, hostTransform, resolveDecor } from './resolve.ts'
export interface DecorSolid extends Omit<Solid, 'kind'> { kind: `decor-${string}`; material?: string; color?: string; replaces?: Solid['kind']; missing?: boolean }
/** A complete structural scene, with real recesses subtracted; buildSolids stays untouched. */
export function decorWallSolids(plan: Plan, decor: Decor | undefined = plan.decor): Solid[] {
  const base = buildSolids(plan)
  if (!decor) return base
  const source = decorItems(decor), cuts = embedsOf(plan, decor).filter(e => {
    const item = source.find(x => x.id === e.id)!
    return !checkEmbed(plan, decor, item as Parameters<typeof checkEmbed>[2]).some(i => i.level === 'error')
  }).map(e => { const level = levelOf(plan, faceWall(plan, e.face)); return { ...e, wallIds: faceRun(plan, e.face).filter(p => overlap(p.s, e.s)).map(p => p.wall.id), level: level.id, z: [e.z[0] + level.elevation, e.z[1] + level.elevation] as Interval, poly: embedFootprint(plan, e) } })
  return base.flatMap(s => {
    if (!['wall', 'sill', 'lintel'].includes(s.kind)) return [s]
    const active = cuts.filter(c => s.ids.some(id => c.wallIds.includes(id)) && c.level === (s.level ?? levelsOf(plan)[0].id) && overlap(c.z, [s.z0, s.z1]))
    if (!active.length) return [s]
    const zs = [...new Set([s.z0, s.z1, ...active.flatMap(c => c.z.filter(z => z > s.z0 && z < s.z1))])].sort((a, b) => a - b)
    return zs.slice(1).flatMap((z1, i) => { const z0 = zs[i], polygons = difference(s.polygons, active.filter(c => c.z[0] < z1 && c.z[1] > z0).map(c => [c.poly])); return polygons.length ? [{ ...s, z0, z1, polygons }] : [] })
  })
}
interface BoxCut extends ElevationRect { depth: Interval }
/** Extruded elevation rectangles, with arbitrary overlapping blind/through box cuts. */
function cutBox(kind: DecorSolid['kind'], id: string, rect: ElevationRect, depth: Interval, cuts: BoxCut[], at: (u: number, depth: number) => Vec2, level: { id: string; elevation: number }, material?: string): DecorSolid[] {
  const active = cuts.filter(c => overlap(c.z, rect.z) && overlap(c.u, rect.u) && overlap(c.depth, depth)), zs = [...new Set([...rect.z, ...active.flatMap(c => c.z.filter(z => z > rect.z[0] && z < rect.z[1]))])].sort((a, b) => a - b)
  const local = [[rectPoly({ u: rect.u, z: depth })]]
  return zs.slice(1).flatMap((z1, i) => {
    const z0 = zs[i], polygons = difference(local, active.filter(c => c.z[0] < z1 && c.z[1] > z0).map(c => [rectPoly({ u: c.u, z: c.depth })])).map(rings => rings.map(r => r.map(([u, d]) => at(u, d))))
    return polygons.length && z1 > z0 ? [{ kind, ids: [id], polygons, z0: z0 + level.elevation, z1: z1 + level.elevation, level: level.id, ...(material ? { material } : {}) }] : []
  })
}
/** Returns decor entities plus explicitly marked replacement wall entities when niches exist. */
export type DecorSolids = DecorSolid[] & { hideWallIds: string[] }
export function buildDecorSolids(plan: Plan): DecorSolids {
  if (!plan.decor) return Object.assign([], { hideWallIds: [] })
  const resolved = plan.decor.furniture.some(f => f.in) ? resolveDecor(plan) : undefined, d = resolved?.decor ?? plan.decor
  plan = { ...plan, decor: d }
  const missing = new Set((resolved?.placed ?? []).filter(p => p.status === 'missing').map(p => p.id))
  const result: DecorSolid[] = [], structural = decorWallSolids(plan)
  const affected = new Set(embedsOf(plan, d).filter(e => {
    const item = decorItems(d).find(i => i.id === e.id)!
    return !checkEmbed(plan, d, item as Parameters<typeof checkEmbed>[2]).some(i => i.level === 'error')
  }).flatMap(e => faceRun(plan, e.face).filter(p => overlap(p.s, e.s)).map(p => p.wall.id)))
  for (const s of structural) if (s.ids.some(id => affected.has(id)) && ['wall', 'sill', 'lintel', 'glass'].includes(s.kind)) result.push({ ...s, kind: `decor-${s.kind}`, replaces: s.kind })
  for (const cab of d.cabinets.filter(c => !missing.has(c.id))) {
    const layout = layoutCabinet(cab); if (layout.issues.some(i => i.level === 'error')) continue
    try {
      const at = cabinetTransform(plan, cab), level = levelOf(plan, 'face' in cab.place ? faceWall(plan, cab.place.face) : cab)
      const cuts: BoxCut[] = [...layout.cuts, ...d.recesses.filter(r => 'cabinet' in r.host && r.host.cabinet === cab.id && r.rect.u).map(r => ({ u: r.rect.u!, z: r.rect.z, depth: r.depth }))].map(c => ({ u: c.u, z: c.z, depth: [c.depth === 'through' ? 0 : cab.depth - c.depth, cab.depth] }))
      for (const p of layout.parts) result.push(...cutBox(`decor-cabinet-${p.kind}`, cab.id, p, p.depth, p.kind === 'top' ? [] : cuts, at, level, p.material))
    } catch { /* Unsupported / missing host remains an issue, never fallback geometry. */ }
  }
  for (const panel of d.panels.filter(p => !missing.has(p.id))) try {
    const g = panelGeometry(plan, panel), at = panelTransform(plan, panel), level = levelOf(plan, faceWall(plan, g.span.face)), holes = d.recesses.filter(r => 'panel' in r.host && r.host.panel === panel.id && r.rect.u && !checkEmbed(plan, d, r).some(i => i.level === 'error'))
    const cuts: BoxCut[] = holes.map(r => ({ u: r.rect.u!, z: r.rect.z, depth: [r.depth === 'through' ? 0 : g.thickness - r.depth, g.thickness] }))
    const drawPolys = (polys: Vec2[][][], depth: Interval, kind: DecorSolid['kind']) => {
      const zs = [...new Set(polys.flatMap(rings => rings.flatMap(r => r.map(p => p[1]))))].sort((a, b) => a - b)
      for (let i = 1; i < zs.length; i++) {
        const z0 = zs[i - 1], z1 = zs[i], z = (z0 + z1) / 2
        for (const rings of polys) {
          const xs: number[] = []
          for (const ring of rings) ring.forEach((a, j) => { const b = ring[(j + 1) % ring.length]; if ((a[1] <= z && b[1] > z) || (b[1] <= z && a[1] > z)) xs.push(a[0] + (z - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) })
          xs.sort((a, b) => a - b)
          for (let j = 1; j < xs.length; j += 2) result.push(...cutBox(kind, panel.id, { u: [xs[j - 1], xs[j]], z: [z0, z1] }, depth, cuts, at, level, panel.material))
        }
      }
    }
    drawPolys(g.polygons, [0, g.thickness], 'decor-panel')
    if (panel.frame?.style === 'raised') drawPolys(g.frames, [g.thickness, g.thickness + 8], 'decor-panel-frame')
  } catch { /* See validateDecor for explicit host/arc issues. */ }
  for (const f of d.furniture.filter(f => !missing.has(f.id) || d.cache?.[f.id])) {
    const level = furnitureLevel(plan, f), pose = furniturePose(plan, f), def = componentOf(d, f.type)
    const base = { kind: 'decor-furniture' as const, ...(missing.has(f.id) ? { missing: true } : {}), ids: [f.id], level: level.id }
    if (isCustomType(f.type)) {
      if (!def) continue
      const a = pose.rot * Math.PI / 180, co = Math.cos(a), si = Math.sin(a)
      for (const prism of componentPrisms(def)) result.push({ ...base,
        polygons: prism.polygons.map(rings => rings.map(r => r.map(([u, v]): Vec2 => { const x = (u - def.size[0] / 2) * (f.flip ? -1 : 1), y = v - def.size[1] / 2; return [pose.at[0] + x * co - y * si, pose.at[1] + x * si + y * co] }))),
        z0: pose.z + level.elevation + prism.z0 / 1000, z1: pose.z + level.elevation + prism.z1 / 1000,
        ...(prism.color ? { color: prism.color } : {}), ...(prism.material ?? f.materials?.body ? { material: prism.material ?? f.materials?.body } : {}) })
    } else result.push({ ...base, polygons: [[pose.footprint]], z0: pose.z + level.elevation, z1: pose.z + f.height + level.elevation, ...(f.materials?.body ? { material: f.materials.body } : {}) })
  }
  for (const r of d.recesses) if (r.shelves?.length && !checkEmbed(plan, d, r).some(i => i.level === 'error')) try {
    const at = hostTransform(plan, d, r.id), width = r.rect.u ? r.rect.u[1] - r.rect.u[0] : r.rect.s![1] - r.rect.s![0]
    const host = 'panel' in r.host ? d.panels.find(p => p.id === (r.host as { panel: string }).panel) : 'cabinet' in r.host ? d.cabinets.find(c => c.id === (r.host as { cabinet: string }).cabinet) : undefined
    const thickness = host ? 'thickness' in host ? (host.type === 'slats' ? host.slats?.depth ?? host.thickness : host.thickness) : host.depth : 0, dep = r.depth === 'through' ? thickness : r.depth
    const level = levelOf(plan, 'face' in r.host ? faceWall(plan, r.host.face) : host && 'place' in host && 'face' in host.place ? faceWall(plan, host.place.face) : host && 'thickness' in host ? faceWall(plan, panelGeometry(plan, host).span.face) : r)
    if (at) for (const z of r.shelves) result.push(...cutBox('decor-recess-shelf', r.id, { u: [0, width], z: [z - .018, z] }, [thickness - dep, thickness], [], at, level, r.back))
  } catch { /* invalid host */ }
  return Object.assign(result, { hideWallIds: [...new Set(result.filter(s => s.replaces).flatMap(s => s.ids).filter(id => plan.walls.some(w => w.id === id)))] })
}

export interface SectionPolygon { kind: Solid['kind'] | DecorSolid['kind']; ids: string[]; material?: string; polygons: Vec2[][][]; z: number; level?: string; wallKind?: Solid['wallKind'] }
export function sectionAt(solids: readonly (Solid | DecorSolid)[], z: number): SectionPolygon[] {
  return solids.filter(s => s.z0 < z && z < s.z1).map(s => ({ kind: s.kind, ids: [...s.ids], polygons: structuredClone(s.polygons), z, ...(s.level ? { level: s.level } : {}), ...(s.wallKind ? { wallKind: s.wallKind } : {}), ...('material' in s && s.material ? { material: s.material } : {}) }))
}
