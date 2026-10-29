import type { Opening, Plan, Room, WallKind } from '../types.ts'
import type { Cabinet, Decor, FaceRef, Furniture, Panel, Recess } from './types.ts'
import { faceAxis, faceExtent } from './faces.ts'
import { panelGeometry, panelSpan, type PanelGeometry } from './panels.ts'
import { layoutCabinet, type CabinetLayout } from './cabinets.ts'
import { furniturePose } from './furniture.ts'
import { joinedWallFootprint } from '../walls.ts'
import { effectiveWallHeight, pointInPolygon, roomCeiling, roomsBesideWall, wallDir } from '../geometry.ts'
import { levelOf } from '../levels.ts'
const sameFace = (a: FaceRef, b: FaceRef) => a.wall === b.wall && a.side === b.side

export interface ElevationContext {
  face: FaceRef
  ax: ReturnType<typeof faceAxis>
  u: [number, number]
  H: number
  wallKind: WallKind
  thickness: number
  segments: { u: [number, number]; room: Room; ceiling: number }[]
  ends: { side: 'l' | 'r'; kind: WallKind; thickness: number }[]
  openings: { o: Opening; u: [number, number] }[]
  beams: { id: string; kind: 'cross' | 'parallel'; u: [number, number]; bottom: number; name?: string }[]
  removed: { u: number; t: number }[]
  panels: { p: Panel; u0: number; geo: PanelGeometry }[]
  cabinets: { c: Cabinet; u0: number; L: CabinetLayout }[]
  niches: { r: Recess; u: [number, number] }[]
  furniture: { f: Furniture; u: [number, number]; z: [number, number]; held: boolean }[]
}

const ordered = (a: number, b: number): [number, number] => [Math.min(a, b), Math.max(a, b)]

export function elevationContext(plan: Plan, base: Plan, decor: Decor | undefined, face: FaceRef): ElevationContext | null {
  let ax: ReturnType<typeof faceAxis>, ext: [number, number]
  try { ax = faceAxis(plan, face); ext = faceExtent(plan, face) } catch { return null }
  const w = ax.wall, d = wallDir(w)
  const H = effectiveWallHeight(plan, w)
  const u = ordered(ax.toU(ext[0]), ax.toU(ext[1]))
  const toS = (p: [number, number]) => (p[0] - w.a[0]) * d[0] + (p[1] - w.a[1]) * d[1]
  const off = (p: [number, number]) => { const n = ax.normalAt(0); const o = ax.at(0); return (p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1] }

  // 房间分段：房间多边形贴着这面墙面的顶点投到墙上
  const sideRooms = (face.side === 1 ? roomsBesideWall(plan, w.id).positive : roomsBesideWall(plan, w.id).negative)
  const segments = sideRooms.map(r => {
    const ss = r.poly.filter(p => Math.abs(off(p)) < 30).map(toS)
    if (ss.length < 2) return null
    const a = Math.max(ext[0], Math.min(...ss)), b = Math.min(ext[1], Math.max(...ss))
    return b - a > 100 ? { u: ordered(ax.toU(a), ax.toU(b)), room: r, ceiling: roomCeiling(plan, r) } : null
  }).filter(Boolean).sort((a, b) => a!.u[0] - b!.u[0]) as ElevationContext['segments']

  // 两端剖到的墙：墙面线稍微往外一点，落在哪面墙的足迹里
  const ends: ElevationContext['ends'] = []
  for (const [s, side] of [[ext[0] - 30, ax.toU(ext[0]) < ax.toU(ext[1]) ? 'l' : 'r'], [ext[1] + 30, ax.toU(ext[1]) > ax.toU(ext[0]) ? 'r' : 'l']] as const) {
    const p = ax.at(s, 40)
    const hit = plan.walls.find(v => v.id !== w.id && levelOf(plan, v).id === levelOf(plan, w).id && joinedWallFootprint(plan, v).some(rings => pointInPolygon(p, rings[0])))
    if (hit && levelOf(plan, hit).id === levelOf(plan, w).id) ends.push({ side, kind: hit.kind, thickness: hit.thickness })
  }

  const openings = plan.openings.filter(o => o.wall === w.id).map(o => ({ o, u: ordered(ax.toU(o.offset), ax.toU(o.offset + o.width)) }))

  // 梁：垂直于墙的梁 = 剖到的一块；平行的梁（离墙面 800 以内）= 顶上一条虚线带
  const beams: ElevationContext['beams'] = []
  for (const b of plan.beams.filter(b => levelOf(plan, b).id === levelOf(plan, w).id)) {
    const bd: [number, number] = [b.b[0] - b.a[0], b.b[1] - b.a[1]], bl = Math.hypot(...bd)
    const c = Math.abs((bd[0] * d[0] + bd[1] * d[1]) / bl)
    if (c < 0.3) {
      const da = off(b.a), db = off(b.b)
      if (Math.min(Math.abs(da), Math.abs(db)) > w.thickness + 60 && Math.sign(da) === Math.sign(db)) continue
      const t = Math.abs(da - db) < 1e-6 ? 0 : da / (da - db)
      const P: [number, number] = [b.a[0] + bd[0] * t, b.a[1] + bd[1] * t], s = toS(P)
      if (s < ext[0] || s > ext[1]) continue
      beams.push({ id: b.id, kind: 'cross', u: ordered(ax.toU(s - b.width / 2), ax.toU(s + b.width / 2)), bottom: b.bottom, name: b.name })
    } else if (c > 0.95 && Math.abs(off(b.a)) < 800) {
      const s0 = Math.max(ext[0], Math.min(toS(b.a), toS(b.b))), s1 = Math.min(ext[1], Math.max(toS(b.a), toS(b.b)))
      if (s1 > s0) beams.push({ id: b.id, kind: 'parallel', u: ordered(ax.toU(s0), ax.toU(s1)), bottom: b.bottom, name: b.name })
    }
  }

  // 拆掉的墙原位置（地面上两道很淡的竖虚线）
  const ids = new Set(plan.walls.map(x => x.id))
  const removed: ElevationContext['removed'] = []
  for (const v of base.walls) {
    if (ids.has(v.id) || levelOf(base, v).id !== levelOf(plan, w).id) continue
    for (const p of [v.a, v.b]) if (Math.abs(off(p)) < w.thickness / 2 + v.thickness) { const s = toS(p); if (s > ext[0] - 10 && s < ext[1] + 10) removed.push({ u: ax.toU(s), t: v.thickness }) }
  }

  const panels: ElevationContext['panels'] = [], cabinets: ElevationContext['cabinets'] = [], niches: ElevationContext['niches'] = [], furniture: ElevationContext['furniture'] = []
  if (decor) {
    for (const p of decor.panels) {
      try {
        const sp = panelSpan(plan, p)
        if (!sameFace(sp.face, face)) continue
        panels.push({ p, u0: Math.min(ax.toU(sp.s[0]), ax.toU(sp.s[1])), geo: panelGeometry(plan, p) })
      } catch { /* 挂不上 */ }
    }
    for (const c of decor.cabinets) {
      if (!('face' in c.place) || !sameFace(c.place.face, face)) continue
      cabinets.push({ c, u0: Math.min(ax.toU(c.place.s), ax.toU(c.place.s + c.width)), L: layoutCabinet(c) })
    }
    for (const r of decor.recesses) if ('face' in r.host && sameFace(r.host.face, face) && r.rect.s) niches.push({ r, u: ordered(ax.toU(r.rect.s[0]), ax.toU(r.rect.s[1])) })
    for (const f of decor.furniture) {
      if (f.type === 'rug') continue
      const pose = furniturePose({ ...plan, decor }, f)
      if (pose.missing || pose.level !== levelOf(plan, w).id) continue
      const fp = pose.footprint
      const near = Math.min(...fp.map(p => off(p)))
      const onFace = f.against && sameFace(f.against.face, face)
      const held = !!f.in && (cabinets.some(c => f.in === c.c.id || f.in?.startsWith(c.c.id + ':cell:')) || panels.some(p => p.p.id === f.in) || decor.recesses.some(r => r.id === f.in && (('panel' in r.host && panels.some(x => x.p.id === (r.host as { panel: string }).panel)) || ('face' in r.host && sameFace(r.host.face, face)) || ('cabinet' in r.host && cabinets.some(c => c.c.id === (r.host as { cabinet: string }).cabinet)))))
      if (!onFace && !held && !(near > -20 && near < 350)) continue
      const ss = fp.map(toS)
      const a = Math.max(ext[0], Math.min(...ss)), b = Math.min(ext[1], Math.max(...ss))
      if (b - a < 50) continue
      furniture.push({ f, u: ordered(ax.toU(a), ax.toU(b)), z: [pose.z, pose.z + f.height], held })
    }
  }
  return { face, ax, u, H, wallKind: w.kind, thickness: w.thickness, segments, ends, openings, beams, removed, panels, cabinets, niches, furniture }
}
