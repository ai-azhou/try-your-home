/**
 * 一面墙面的立面数据（站在房间里面对墙：u 从左到右 mm，z 离地 m）。
 * D5 起全部来自 core `elevationOf`（共线墙链、取景段、两端剖到的墙、梁、拆掉的墙原位、靠墙家具、踢脚线；C6 起含按片墙面材料），
 * 这里只把它包成画法要的形状；界面不再自己算立面。
 */
import type { Opening, Plan, Room, WallKind } from '@/core/types'
import type { Cabinet, Decor, FaceRef, Furniture, Panel, Recess } from '@/core/decor/types'
import { elevationOf } from '@/core/decor/elevation'
import type { Material } from '@/core/decor/types'
import type { faceAxis } from '@/core/decor/faces'
import type { PanelGeometry } from '@/core/decor/panels'
import type { CabinetLayout } from '@/core/decor/cabinets'

export interface ElevModel {
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
  /** 默认取景段：墙面跨几间房且很长时，取装修最多的那一段（core） */
  focus: [number, number]
  /** 踢脚线（风格默认 + 显式踢脚造型；门洞处断开），u 立面坐标 */
  skirting: { u: [number, number]; z: [number, number]; polygons: [number, number][][][]; material: { color: string } }[]
  /** 墙面材料按片（core elevationOf.surfaces = wallSkins，立面 u / z；含一段 / 到某个高度的覆盖、洞口已扣） */
  surfaces: { key: string; material: Material; overridden: boolean; polygons: [number, number][][][] }[]
}

const cache = new WeakMap<Plan, Map<string, ElevModel | null>>()
export function elevationModel(plan: Plan, base: Plan, decor: Decor | undefined, face: FaceRef, styleId?: string, keep = true): ElevModel | null {
  const p = decor ? { ...plan, decor } : plan
  const key = `${face.wall}:${face.side}:${styleId}:${keep}`
  const byPlan = cache.get(plan) ?? new Map<string, ElevModel | null>()
  if (byPlan.has(key) && decor === plan.decor) return byPlan.get(key)!
  let out: ElevModel | null = null
  try {
    // C6 起 core 的 u / ends 已按墙面实际露出的范围算（faceExtent 的并），surfaces 直接是立面 u / z 的按片材料（wallSkins）
    const e = elevationOf(p, face.wall, face.side, base, { styleId, keep })
    out = {
      face, ax: e.ax, u: e.u as [number, number], H: e.H, wallKind: e.wallKind, thickness: e.thickness,
      segments: e.segments, ends: e.ends as ElevModel['ends'], removed: e.removed,
      openings: e.openings.map(o => ({ o: o.source as Opening, u: o.u })),
      beams: e.beams.map(b => ({ id: b.id, kind: b.kind as 'cross' | 'parallel', u: b.u, bottom: b.bottom, name: b.name })),
      panels: e.panels, cabinets: e.cabinets, niches: e.niches, furniture: e.furniture,
      focus: e.focus as [number, number],
      skirting: e.skirting as ElevModel['skirting'],
      surfaces: decor ? e.surfaces.map(k => ({ key: k.key, material: k.material, overridden: k.overridden, polygons: k.polygons as [number, number][][][] })) : [],
    }
  } catch { out = null }
  if (decor === plan.decor) { byPlan.set(key, out); cache.set(plan, byPlan) }
  return out
}

/** 这面墙面（含共线连着的几段）贴着哪几间房，按立面从左到右（D6 A3：标题旁「这面墙还连着 书房 ›」） */
export function elevSegmentRooms(plan: Plan, base: Plan, decor: Decor | undefined, face: FaceRef): Room[] {
  const m = elevationModel(plan, base, decor, face)
  if (!m) return []
  const seen = new Set<string>(), out: Room[] = []
  for (const sg of [...m.segments].sort((a, b) => a.u[0] - b.u[0])) if (!seen.has(sg.room.id) && sg.u[1] - sg.u[0] > 300) { seen.add(sg.room.id); out.push(sg.room) }
  return out
}
