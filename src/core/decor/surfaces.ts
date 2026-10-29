import { decorItems, decorRoom, itemSpan } from './resolve.ts'
import { panelSpan } from './panels.ts'
import type { Plan, Room, Vec2 } from '../types.ts'
import type { FaceRef, Material, MaterialRole, Surface, SurfaceTarget } from './types.ts'
import { dot, effectiveWallHeight, pointInPolygon, polygonArea, roomCeiling, roomsBesideWall, sub, wallDir, projectToWall } from '../geometry.ts'
import { faceAxis, faceIntervals, faceRun, runS } from './faces.ts'
import { BUILTIN_MATERIALS, STYLE_PRESETS } from './presets.ts'
import { difference, intersection, ordered, overlap, rectPoly } from './math.ts'
import { layoutCabinet } from './cabinets.ts'
import { panelGeometry } from './panels.ts'
export const NEUTRAL_MATERIAL: Material = { id: '__neutral__', name: '白模中性色', category: 'other', color: '#f3f2ef' }
export function styleOf(plan: Plan) { return plan.decor?.presets?.find(p => p.id === plan.decor!.style) ?? STYLE_PRESETS.find(p => p.id === plan.decor?.style) }
export function materialOf(plan: Plan, id?: string): Material { return plan.decor?.materials.find(m => m.id === id) ?? BUILTIN_MATERIALS.find(m => m.id === id) ?? NEUTRAL_MATERIAL }
function roomRole(plan: Plan, room: Room | undefined, kind: 'floor' | 'wall'): MaterialRole {
  const text = room ? `${room.name} ${room.use ?? ''}` : '', rule = styleOf(plan)?.rooms?.find(r => r.match.some(m => text.includes(m)) && r[kind])
  if (rule?.[kind]) return rule[kind]!
  return /卫|厨|阳台/.test(text) ? `${kind}.wet` : `${kind}.main`
}
function sameTarget(a: SurfaceTarget, b: SurfaceTarget) {
  return 'floor' in a && 'floor' in b ? a.floor === b.floor : 'ceiling' in a && 'ceiling' in b ? a.ceiling === b.ceiling : 'face' in a && 'face' in b ? a.face.wall === b.face.wall && a.face.side === b.face.side : false
}
/** A partial overlay may continue onto other records in its connected face run. */
function overlaysOnFace(plan: Plan, face: FaceRef): Surface[] {
  return (plan.decor?.surfaces ?? []).flatMap(surface => {
    const t = surface.target
    if (!('face' in t)) return []
    if (t.face.wall === face.wall && t.face.side === face.side) return [surface]
    if (!t.s) return [] // whole-face means this wall, not an implicit entire run
    try {
      const part = faceRun(plan, t.face).find(p => p.face.wall === face.wall && p.face.side === face.side)
      if (!part) return []
      const s = ordered(...t.s.map(v => part.reversed ? part.s[1] - v : v - part.s[0]) as [number, number])
      return [{ ...surface, target: { ...t, face, s } }]
    } catch { return [] }
  })
}
/** Point-wise finish query; omitted coordinates select only whole-face overrides. Last overlay wins. */
export function resolveFinish(plan: Plan, target: SurfaceTarget, opts: { s?: number; z?: number; room?: Room; material?: string; styleId?: string; keep?: boolean } = {}) {
  if (plan.decor && (opts.styleId !== undefined || opts.keep === false)) plan = { ...plan, decor: { ...plan.decor, style: opts.styleId ?? plan.decor.style, surfaces: opts.keep === false ? [] : plan.decor.surfaces } }
  const override = [...('face' in target ? overlaysOnFace(plan, target.face) : plan.decor?.surfaces ?? [])].reverse().find(s => sameTarget(s.target, target) && (!('face' in s.target) || (!s.target.s || opts.s !== undefined && opts.s >= s.target.s[0] && opts.s <= s.target.s[1]) && (!s.target.z || opts.z !== undefined && opts.z >= s.target.z[0] && opts.z <= s.target.z[1])))
  const room = opts.room ?? ('floor' in target ? plan.rooms.find(r => r.id === target.floor) : 'ceiling' in target ? plan.rooms.find(r => r.id === target.ceiling) : faceRoom(plan, target.face))
  const role: MaterialRole = 'ceiling' in target ? 'ceiling' : 'floor' in target && room?.floorOffset ? 'stone.top' : roomRole(plan, room, 'floor' in target ? 'floor' : 'wall')
  const material = materialOf(plan, override?.material ?? opts.material ?? styleOf(plan)?.roles[role] ?? styleOf(plan)?.roles['floor' in target ? 'floor.main' : 'ceiling' in target ? 'ceiling' : 'wall.main'])
  const styleMaterial = materialOf(plan, styleOf(plan)?.roles[role])
  return { styleMaterial, ...(override ? { surfaceItem: override } : {}), material, materialId: material.id, overridden: !!override, ...(override ? { surface: override.id, by: override.by } : {}), role }
}
export interface ResolvedSurface {
  kind: 'floor' | 'wall' | 'ceiling'; target: SurfaceTarget; material: Material; materialId: string; overridden: boolean; surface?: string; by?: Surface['by']; room?: string
  /** Floors are planar mm/mm; walls are centerline s mm / z m (not u). */
  polygons: Vec2[][][]; area: number
}
const polyArea = (polys: Vec2[][][]) => polys.reduce((sum, rings) => sum + polygonArea(rings[0]) - rings.slice(1).reduce((s, r) => s + polygonArea(r), 0), 0)
export interface FinishPreview { styleId?: string; keep?: boolean }
function previewPlan(plan: Plan, opts: FinishPreview): Plan {
  return plan.decor && (opts.styleId !== undefined || opts.keep === false) ? { ...plan, decor: { ...plan.decor, style: opts.styleId ?? plan.decor.style, surfaces: opts.keep === false ? [] : plan.decor.surfaces } } : plan
}
export function resolveSurfaces(plan: Plan, opts: FinishPreview = {}) {
  plan = previewPlan(plan, opts)
  const floors: ResolvedSurface[] = [], ceilings: ResolvedSurface[] = [], walls: ResolvedSurface[] = []
  for (const room of plan.rooms) for (const kind of ['floor', 'ceiling'] as const) {
    const target: SurfaceTarget = kind === 'floor' ? { floor: room.id } : { ceiling: room.id }, finish = resolveFinish(plan, target, { room })
    ;(kind === 'floor' ? floors : ceilings).push({ kind, target, ...finish, room: room.id, polygons: [[room.poly]], area: polygonArea(room.poly) / 1e6 })
  }
  for (const w of plan.walls) for (const side of [1, -1] as const) {
    const face: FaceRef = { wall: w.id, side }, axis = faceAxis(plan, face), height = w.kind === 'half' ? w.lowHeight ?? 1 : effectiveWallHeight(plan, w), adjacent = roomsBesideWall(plan, w.id)[side === 1 ? 'positive' : 'negative']
    const overrides = overlaysOnFace(plan, face)
    const ss = [0, axis.length, ...overrides.flatMap(s => 'face' in s.target ? s.target.s ?? [] : []), ...adjacent.flatMap(r => r.poly.map(p => w.bulge ? projectToWall(w, p).s : dot(sub(p, w.a), wallDir(w))))].filter(s => s >= 0 && s <= axis.length)
    const zs = [0, height, ...overrides.flatMap(s => 'face' in s.target ? s.target.z ?? [] : [])].filter(z => z >= 0 && z <= height)
    const sx = [...new Set(ss)].sort((a, b) => a - b), zz = [...new Set(zs)].sort((a, b) => a - b)
    const holes = plan.openings.filter(o => o.wall === w.id).map(o => [rectPoly({ u: [o.offset, o.offset + o.width], z: [o.sill, o.head] })])
    const intervals = faceIntervals(plan, face)
    for (let i = 1; i < sx.length; i++) for (let j = 1; j < zz.length; j++) {
      const s: [number, number] = [sx[i - 1], sx[i]], z: [number, number] = [zz[j - 1], zz[j]], mid = (s[0] + s[1]) / 2
      const room = adjacent.find(r => pointInPolygon(axis.at(mid, 1), r.poly)), target: SurfaceTarget = { face, s, z }
      let polygons = intersection([[rectPoly({ u: s, z })]], intervals.map(u => [rectPoly({ u, z: [0, height] })]))
      polygons = difference(polygons, holes)
      if (!polygons.length) continue
      walls.push({ kind: 'wall', target, ...resolveFinish(plan, { face }, { s: mid, z: (z[0] + z[1]) / 2, room }), ...(room ? { room: room.id } : {}), polygons, area: polyArea(polygons) * axis.scale / 1000 })
    }
  }
  return { floors, walls, ceilings, all: [...floors, ...walls, ...ceilings] }
}
export interface MaterialQuantity { material: Material; materialId: string; area: number; floor: number; wall: number; ceiling: number; panel: number; cabinet: number; countertop: number; approximate: true; where: string[]; overridden: boolean; count: number }
/** m²; disjoint overlays and opening unions are counted once. No purchasing/waste allowance. */
export function materialTakeoff(plan: Plan, opts: FinishPreview = {}): MaterialQuantity[] {
  plan = previewPlan(plan, opts)
  const quantities = new Map<string, MaterialQuantity>(), add = (material: Material, kind: 'floor' | 'wall' | 'ceiling' | 'panel' | 'cabinet' | 'countertop', area: number) => {
    const q = quantities.get(material.id) ?? { material, materialId: material.id, area: 0, floor: 0, wall: 0, ceiling: 0, panel: 0, cabinet: 0, countertop: 0, approximate: true, where: [], overridden: false, count: 0 }
    q[kind] += Math.max(0, area); q.area += Math.max(0, area); quantities.set(material.id, q)
  }
  const surfaces = resolveSurfaces(plan).all
  for (const s of surfaces) {
    let polygons = s.polygons
    if ('face' in s.target) {
      const f = s.target.face, axis = faceAxis(plan, f), covers: Vec2[][][] = []
      for (const panel of plan.decor?.panels ?? []) try {
        const g = panelGeometry(plan, panel), member = faceRun(plan, g.span.face).find(p => p.face.wall === f.wall && p.face.side === f.side)
        if (!member) continue
        const pa = faceAxis(plan, g.span.face), u0 = Math.min(...g.span.s.map(pa.toU))
        const through = (plan.decor?.recesses ?? []).filter(r => 'panel' in r.host && r.host.panel === panel.id && r.depth === 'through' && r.rect.u).map(r => [rectPoly({ u: r.rect.u!, z: r.rect.z })]); const covering = difference(g.polygons, through)
        covers.push(...covering.map(rings => rings.map(r => r.map(([u, z]): Vec2 => { const v = pa.toS(u0 + u); return [member.reversed ? member.s[1] - v : v - member.s[0], z] }))))
      } catch { /* Orphans contribute no coverage. */ }
      polygons = difference(polygons, covers)
      for (const recess of [...(plan.decor?.recesses ?? [])].reverse()) if ('face' in recess.host && recess.back && recess.rect.s && typeof recess.depth === 'number' && recess.depth < axis.wall.thickness) {
        try {
          const part = faceRun(plan, recess.host.face).find(p => p.face.wall === f.wall && p.face.side === f.side); if (!part) continue
          const span = ordered(...recess.rect.s.map(v => part.reversed ? part.s[1] - v : v - part.s[0]) as [number, number]), patch = [[rectPoly({ u: span, z: recess.rect.z })]], covered = intersection(polygons, patch)
          add(materialOf(plan, recess.back), 'wall', polyArea(covered) * axis.scale / 1000); polygons = difference(polygons, patch)
        } catch { /* orphan has no measurable back */ }
      }
      add(s.material, s.kind, polyArea(polygons) * axis.scale / 1000)
    } else add(s.material, s.kind, s.area)
  }
  for (const p of plan.decor?.panels ?? []) try { const g = panelGeometry(plan, p); add(materialOf(plan, p.material), 'panel', polyArea(g.visiblePolygons) / 1000); for (const r of plan.decor?.recesses ?? []) if ('panel' in r.host && r.host.panel === p.id && r.depth !== 'through' && r.rect.u) add(materialOf(plan, r.back ?? p.material), 'panel', polyArea(intersection(g.polygons, [[rectPoly({ u: r.rect.u, z: r.rect.z })]])) / 1000) } catch { /* Orphan geometry is reported by validateDecor. */ }
  // Cabinet finishes are projected front area plus horizontal counter area, not a sheet-cutting list.
  for (const cab of plan.decor?.cabinets ?? []) {
    const layout = layoutCabinet(cab); if (layout.issues.length) continue
    const full = [[rectPoly({ u: [0, cab.width], z: cab.z })]], holes = [...layout.cuts, ...(plan.decor?.recesses ?? []).filter(r => 'cabinet' in r.host && r.host.cabinet === cab.id && r.rect.u).map(r => ({ u: r.rect.u!, z: r.rect.z, depth: r.depth }))]
    const through = holes.filter(h => h.depth === 'through').map(h => [rectPoly(h)]), allCuts = holes.map(h => [rectPoly(h)]), fronts: Vec2[][][] = []
    for (const part of layout.parts.filter(p => p.kind === 'front' || p.kind === 'appliance')) {
      const visible = difference([[rectPoly(part)]], allCuts)
      fronts.push(...visible)
      if (part.kind === 'front') add(materialOf(plan, part.material ?? cab.materials.front), 'cabinet', polyArea(visible) / 1000)
    }
    let carcass = difference(difference(full, through), fronts)
    for (const r of [...(plan.decor?.recesses ?? [])].reverse()) if ('cabinet' in r.host && r.host.cabinet === cab.id && r.depth !== 'through' && r.back && r.rect.u) {
      const patch = [[rectPoly({ u: r.rect.u, z: r.rect.z })]], covered = intersection(carcass, patch); add(materialOf(plan, r.back), 'cabinet', polyArea(covered) / 1000); carcass = difference(carcass, patch)
    }
    add(materialOf(plan, cab.materials.carcass), 'cabinet', polyArea(carcass) / 1000)
    for (const top of layout.parts.filter(p => p.kind === 'top')) add(materialOf(plan, top.material), 'countertop', (top.u[1] - top.u[0]) * (top.depth[1] - top.depth[0]) / 1e6)
  }
  for (const q of quantities.values()) {
    const matching = surfaces.filter(s => s.materialId === q.materialId)
    const panels = (plan.decor?.panels ?? []).filter(p => p.material === q.materialId)
    const cabinets = (plan.decor?.cabinets ?? []).filter(c => c.materials.front === q.materialId)
    const roomName = (id?: string) => id ? plan.rooms.find(r => r.id === id)?.name ?? id : undefined
    const location = (item: Parameters<typeof decorRoom>[1], seen = new Set<string>()): string | undefined => {
      if (seen.has(item.id)) return undefined
      seen.add(item.id)
      try { const span = itemSpan(plan, item); if (span) return wallLocation(plan, span.face, decorRoom(plan, item), (span.s[0] + span.s[1]) / 2) } catch { /* orphan */ }
      if ('host' in item && !('face' in item.host) && plan.decor) {
        const id = 'panel' in item.host ? item.host.panel : item.host.cabinet, parent = decorItems(plan.decor).find(i => i.id === id)
        if (parent) return location(parent, seen)
      }
      return roomName(decorRoom(plan, item))
    }
    const faceName = (face: FaceRef, room?: string, s?: number) => wallLocation(plan, face, room, s)
    q.where = [...new Set([
      ...matching.map(s => 'face' in s.target ? faceName(s.target.face, s.room, s.target.s ? (s.target.s[0] + s.target.s[1]) / 2 : undefined) : `${roomName(s.room) ?? s.room ?? '未命名房间'}${s.kind === 'ceiling' ? '顶面' : '地面'}`),
      ...panels.map(p => { try { const sp = panelSpan(plan, p); return `${faceName(sp.face, decorRoom(plan, p), (sp.s[0] + sp.s[1]) / 2)}·${p.name ?? p.id}` } catch { return `${p.id}（宿主缺失）` } }),
      ...(plan.decor?.cabinets ?? []).filter(c => [c.materials.front, c.materials.carcass, ...layoutCabinet(c).parts.map(p => p.material)].includes(q.materialId)).map(c => `${location(c) ?? ('face' in c.place ? faceName(c.place.face, undefined, c.place.s + c.width / 2) : `楼层${c.level ?? 'L1'}`)}·${c.name ?? c.id}`),
      ...(plan.decor?.recesses ?? []).filter(r => r.back === q.materialId).map(r => `${location(r) ?? ('face' in r.host ? faceName(r.host.face) : '宿主' + ('panel' in r.host ? r.host.panel : r.host.cabinet))}·${r.name ?? r.id}`),
    ])]
    q.overridden = matching.some(s => s.overridden) || panels.some(p => p.material !== styleOf(plan)?.roles['wall.accent'])
    q.count = cabinets.length
  }
  return [...quantities.values()].sort((a, b) => a.materialId.localeCompare(b.materialId))
}

/** Longest adjacent room wins for a whole-face query; point queries can pass opts.room. */
export function faceRoom(plan: Plan, face: FaceRef): Room | undefined {
  const w = plan.walls.find(w => w.id === face.wall)
  if (!w) return undefined
  const rooms = roomsBesideWall(plan, w.id)[face.side === 1 ? 'positive' : 'negative'], axis = faceAxis(plan, face)
  const length = (r: Room) => {
    const ss = r.poly.filter(p => Math.abs(dot(sub(p, axis.at(0)), axis.normal)) < 30).map(p => Math.max(0, Math.min(axis.length, dot(sub(p, w.a), wallDir(w)))))
    return ss.length ? Math.max(...ss) - Math.min(...ss) : 0
  }
  return [...rooms].sort((a, b) => length(b) - length(a) || polygonArea(b.poly) - polygonArea(a.poly))[0]
}

/** Direction is from the room toward the wall, rotated by plan.north when present. */
export function wallLocation(plan: Plan, face: FaceRef, room?: string, s?: number): string {
  if (!plan.walls.some(w => w.id === face.wall)) return `${face.wall}（宿主缺失）`
  const axis = faceAxis(plan, face), n = axis.normalAt(s ?? axis.length / 2)
  const angle = ((Math.atan2(-n[0], n[1]) * 180 / Math.PI - (plan.north ?? 0)) % 360 + 360) % 360
  const direction = (plan.north === undefined ? ['上', '右', '下', '左'] : ['北', '东', '南', '西'])[Math.round(angle / 90) % 4]
  const name = room ? plan.rooms.find(r => r.id === room)?.name ?? room : undefined
  return name ? `${name}${direction}墙` : `${axis.wall.name ?? axis.wall.id}（${face.side === 1 ? '正侧' : '反侧'}·${direction}）`
}
