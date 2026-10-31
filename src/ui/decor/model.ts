/**
 * 装修层的界面包装：读写 base.decor、材料 / 风格查找、每块面最后是什么材料、问题（没地方挂、受保护墙）。
 * 几何和校验都用 core（src/core/decor/*）；core 还没给的放在 ./temp，到了就换掉。
 */
import { useMemo } from 'react'
import type { Opening, Plan, Room, Vec2, Wall } from '@/core/types'
import type { Cabinet, Decor, DecorIssue, DoorFinish, FaceRef, Furniture, Material, MaterialRole, Panel, Recess, StylePreset, Surface, SurfaceTarget } from '@/core/decor/types'
import { BUILTIN_MATERIALS, STYLE_PRESETS, createDecor } from '@/core/decor/presets'
import { faceRoom as coreFaceRoom, materialTakeoff, resolveFinish } from '@/core/decor/surfaces'
import { validateDecor } from '@/core/decor/validate'
import { confirmDecorItems, decorStatus, rehostDecor, rejectDecorItems } from '@/core/decor/resolve'
import { componentOf, isCustomType } from '@/core/decor/components'
import { applyChanges } from '@/core/changes'
import { faceAxis, faceExtent } from '@/core/decor/faces'
import { cabinetFootprint } from '@/core/decor/cabinets'
import { FURNITURE_LIBRARY, furnitureFootprint, furniturePose, isOverhead } from '@/core/decor/furniture'
import { panelSpan, panelTransform } from '@/core/decor/panels'
import { embedFootprint, embedsOf, wallEmbed } from '@/core/decor/embed'
import { pointAt, pointInPolygon, polygonArea, wallDir, wallLength, wallNormal } from '@/core/geometry'
import { useStore, useView, getView } from '../store'
import { useDecor, type DSel } from './dstore'

export type DecorItem = Furniture | Cabinet | Panel | Recess
export type ItemKind = 'furniture' | 'cabinet' | 'panel' | 'recess'
const LIST: Record<ItemKind, 'furniture' | 'cabinets' | 'panels' | 'recesses'> = { furniture: 'furniture', cabinet: 'cabinets', panel: 'panels', recess: 'recesses' }
export const listOf = (d: Decor, k: ItemKind) => d[LIST[k]] as DecorItem[]

/* ───────── 材料、风格 ───────── */
const BUILTIN = new Map(BUILTIN_MATERIALS.map(m => [m.id, m]))
const NEUTRAL: Material = { id: '_clay', name: '白模', category: 'other', color: '#f3f2ef' }
export function matOf(decor: Decor | undefined, id: string | undefined): Material {
  if (!id) return NEUTRAL
  return decor?.materials.find(m => m.id === id) ?? BUILTIN.get(id) ?? NEUTRAL
}
export const allStyles = (decor?: Decor): StylePreset[] => [...STYLE_PRESETS, ...(decor?.presets ?? [])]
export function styleOf(id: string | undefined, decor?: Decor): StylePreset {
  return allStyles(decor).find(s => s.id === id) ?? STYLE_PRESETS[0]
}
export function roleMat(style: StylePreset, role: MaterialRole, decor?: Decor): Material {
  return matOf(decor, style.roles[role] ?? style.roles['wall.main'])
}
/** 内置材料都复制进方案（自包含，换台机器打开不丢）：和 core createDecor 一致 */
export function newDecor(style: string): Decor {
  return { version: 1, style, materials: structuredClone(BUILTIN_MATERIALS), surfaces: [], furniture: [], cabinets: [], panels: [], recesses: [] }
}

/**
 * 没有装修层时（载入只做过结构的方案）用来画和点选的临时一份：core createDecor，不写进数据。
 * 悬停风格预览就画这一份；按「应用」或第一次真正编辑时才由 commitDecor 创建装修层（D6 A1）。
 * 按风格缓存，同一个风格每次拿到的是同一个对象（下游 useMemo 不会每帧重算）。
 */
const TEMP = new Map<string, Decor>()
export function tempDecor(style = 'cream'): Decor {
  let d = TEMP.get(style)
  if (!d) { d = createDecor(style); TEMP.set(style, d) }
  return d
}
/** 画面上用哪份装修层：有就用方案里的；没有、正在预览某个风格时用临时那份；都没有就不画（白模） */
export function shownDecor(decor: Decor | undefined, preview: string | null | undefined): Decor | undefined {
  return decor ?? (preview ? tempDecor(preview) : undefined)
}
export function useShownDecor(): Decor | undefined {
  const decor = useStore(s => s.base?.decor), preview = useDecor(s => s.preview)
  return shownDecor(decor, preview)
}

/* ───────── 每块面最后是什么材料：core resolveFinish（数据格式草案 §8 的顺序；覆盖「后写优先」） ───────── */
export interface Finish { material: Material; overridden: boolean; surface?: Surface; role?: MaterialRole; styleMaterial: Material }
function finishOf(plan: Plan, decor: Decor, target: SurfaceTarget, styleId: string, keep: boolean, room?: Room): Finish {
  const r = resolveFinish({ ...plan, decor }, target, { styleId, keep, ...(room ? { room } : {}) })
  return { material: r.material, overridden: r.overridden, surface: r.surfaceItem, role: r.role, styleMaterial: r.styleMaterial }
}
export function floorFinish(plan: Plan, decor: Decor, r: Room, styleId = decor.style, keep = true): Finish {
  return finishOf(plan, decor, { floor: r.id }, styleId, keep, r)
}
/** 墙面朝着的房间：一面墙面跨几间房时（拆墙后连成一片），取贴着墙面最长的那间（core） */
export function faceRoom(plan: Plan, face: FaceRef): Room | undefined { return coreFaceRoom(plan, face) }
/**
 * 立面从哪间房看（D6 A3：立面按房间分段）。双击处的点落在哪间房就是哪间；给了沿墙的 s 就从墙面那一点往房间里探 200 mm；
 * 都没有（或探不到房间）用 core faceRoom（贴着墙面最长的那间）。
 */
export function elevRoomAt(plan: Plan, face: FaceRef, at: { p?: Vec2; s?: number } = {}): string | undefined {
  const inRoom = (q: Vec2) => plan.rooms.find(r => pointInPolygon(q, r.poly))
  if (at.p) { const r = inRoom(at.p); if (r) return r.id }
  if (at.s != null) {
    try { const r = inRoom(faceAxis(plan, face).at(at.s, 200)); if (r) return r.id } catch { /* 弧墙等 */ }
  }
  return coreFaceRoom(plan, face)?.id
}
/**
 * 墙面这一侧朝着哪里（D6 B6：「客厅一侧 / 室外一侧」）。给了 s 就看墙面那一点往外 200 mm 落在哪间房；
 * 没给 s 用 core faceRoom；都没有房间 = 室外。
 */
export function faceSideName(plan: Plan, face: FaceRef, s?: number): string {
  if (s != null) {
    try { const q = faceAxis(plan, face).at(s, 200), r = plan.rooms.find(x => pointInPolygon(q, x.poly)); if (r) return r.name } catch { /* */ }
    return s != null && !coreFaceRoom(plan, face) ? '室外' : coreFaceRoom(plan, face)?.name ?? '室外'
  }
  return coreFaceRoom(plan, face)?.name ?? '室外'
}
/** 墙两侧哪一侧是室内（只有一侧贴着房间时）；两侧都是房间 / 都不是返回 null */
export function indoorSide(plan: Plan, wallId: string): 1 | -1 | null {
  const a = !!coreFaceRoom(plan, { wall: wallId, side: 1 }), b = !!coreFaceRoom(plan, { wall: wallId, side: -1 })
  return a && !b ? 1 : b && !a ? -1 : null
}
/** 构件在哪间房（取平面足迹的中心；柜子、造型挂在墙面上，按足迹中心落在哪间） */
export function itemRoom(plan: Plan, decor: Decor | undefined, id: string): string | undefined {
  const hit = findItem(decor, id)
  if (!hit) return undefined
  try {
    const fp = footprintOf(plan, hit.k, hit.it)
    if (!fp?.length) return undefined
    const c: Vec2 = [fp.reduce((a, q) => a + q[0], 0) / fp.length, fp.reduce((a, q) => a + q[1], 0) / fp.length]
    return plan.rooms.find(r => pointInPolygon(c, r.poly))?.id
  } catch { return undefined }
}
/** 进立面：算好从哪间房看（双击点 / 沿墙 s / 构件所在房间），再切主画布 */
export function openElevAt(face: FaceRef, at: { p?: Vec2; s?: number; item?: string } = {}) {
  const dp = getDecorPlan()
  const room = dp ? (at.item ? itemRoom(dp.plan, dp.decor, at.item) : undefined) ?? elevRoomAt(dp.plan, face, at) : undefined
  if (useStore.getState().main === '3d') useStore.getState().setMain('2d') // 立面是 2D 画布：3D 里点「进立面」也直接过去（D6 B6）
  useDecor.getState().openElevation(face, room)
}
export function openCabinetAt(id: string, face: FaceRef) {
  const dp = getDecorPlan()
  if (useStore.getState().main === '3d') useStore.getState().setMain('2d')
  useDecor.getState().openCabinet(id, face, dp ? itemRoom(dp.plan, dp.decor, id) ?? elevRoomAt(dp.plan, face) : undefined)
}
export const isWholeFace = (s: Surface) => 'face' in s.target && !s.target.s && !s.target.z
export function faceSurfaces(decor: Decor, face: FaceRef) {
  return decor.surfaces.filter(s => 'face' in s.target && s.target.face.wall === face.wall && s.target.face.side === face.side)
}
/** 整面墙面的材料（只认整面覆盖；一段、到某个高度的覆盖在立面里按片画） */
export function faceFinish(plan: Plan, decor: Decor, face: FaceRef, styleId = decor.style, keep = true): Finish {
  return finishOf(plan, decor, { face }, styleId, keep)
}

/* ───────── 墙面的白话名字：「主卧 · 南墙」「面朝南看」 ───────── */
const DIRS = ['东', '南', '西', '北']
/** 平面方向 → 方位字（plan.north：北在屏幕上偏转的角度，0 = 上） */
export function dirWord(plan: Plan, v: Vec2) {
  const north = ((plan.north ?? 0) * Math.PI) / 180
  // 屏幕坐标 y 向下：把向量转到「北在上」的坐标系里
  const x = v[0] * Math.cos(-north) - v[1] * Math.sin(-north), y = v[0] * Math.sin(-north) + v[1] * Math.cos(-north)
  const a = Math.atan2(y, x) // 0 = 东，π/2 = 南（y 向下）
  return DIRS[((Math.round(a / (Math.PI / 2)) % 4) + 4) % 4]
}
export function faceLabel(plan: Plan, face: FaceRef) {
  const w = plan.walls.find(x => x.id === face.wall)
  if (!w) return { room: '', dir: '', title: face.wall, look: '' }
  const n = wallNormal(w), into: Vec2 = [n[0] * face.side, n[1] * face.side]
  const look = dirWord(plan, [-into[0], -into[1]])
  const room = faceRoom(plan, face)?.name ?? ''
  return { room, dir: look, title: room ? `${room} · ${look}墙` : `${w.name ?? w.id}`, look: `面朝${look}看` }
}
export const WALL_ZH: Record<string, string> = { exterior: '外墙', bearing: '承重墙', partition: '隔墙', glass: '玻璃隔断', half: '矮墙', 'half-glass': '矮墙' }

/* ───────── 读写 ───────── */
/** 装修态画的是改造后的结构，装修层取 base.decor；core 的函数从 plan.decor 读，所以拼一份 */
export function decorPlanOf(viewPlan: Plan, decor: Decor | undefined): Plan {
  return decor ? { ...viewPlan, decor } : viewPlan
}
export function useDecorPlan(): { plan: Plan; decor: Decor | undefined; base: Plan } | null {
  const view = useView()
  const decor = useStore(s => s.base?.decor)
  return useMemo(() => view ? { plan: decorPlanOf(view.plan, decor), decor, base: view.base } : null, [view, decor])
}
export function getDecorPlan() {
  const v = getView(), d = useStore.getState().base?.decor
  return v ? { plan: decorPlanOf(v.plan, d), decor: d, base: v.base } : null
}

let lastKey: { key: string; at: number } | null = null
/**
 * 改装修层：fn 在一份拷贝上改（或返回新的一份）。和结构编辑共用全局撤销（actions.ts 的整份方案历史）：
 * 往 hist.renovation 推一步就会让它记下改之前的整份方案。key 相同、1.6 秒内连续改（拖动、连点）只记一步。
 */
export function commitDecor(fn: (d: Decor) => Decor | void, opts: { key?: string; history?: boolean } = {}): boolean {
  const s = useStore.getState()
  if (!s.base) return false
  const cur = s.base.decor ?? newDecor('cream')
  const draft = structuredClone(cur)
  const next = fn(draft) ?? draft
  const v = getView()
  if (v) next.cache = refreshCache(decorPlanOf(v.plan, next), next)
  const now = Date.now()
  const coalesce = !!opts.key && lastKey?.key === opts.key && now - lastKey.at < 1600
  lastKey = opts.key ? { key: opts.key, at: now } : null
  const base = { ...s.base, decor: next }
  if (opts.history === false || coalesce) useStore.setState({ base, dirty: true })
  else useStore.setState({ base, dirty: true, hist: { ...s.hist, renovation: { past: [...s.hist.renovation.past, s.base.changes].slice(-100), future: [] } } })
  return true
}

/** 每个挂在墙上的构件最后一次挂得上时的平面外接框 + 墙面线段：墙被拆以后靠它画「没地方挂」的幽灵 */
export function refreshCache(plan: Plan, decor: Decor): Decor['cache'] {
  const cache = { ...(decor.cache ?? {}) }
  for (const k of ['cabinet', 'panel', 'recess', 'furniture'] as ItemKind[]) for (const it of listOf(decor, k)) {
    const fp = footprintOf(plan, k, it)
    const face = faceOfItem(it)
    if (!fp || !face) continue
    try {
      const ax = faceAxis(plan, face)
      const ext = faceExtent(plan, face)
      const box: [number, number, number, number] = [Math.min(...fp.map(p => p[0])), Math.min(...fp.map(p => p[1])), Math.max(...fp.map(p => p[0])), Math.max(...fp.map(p => p[1]))]
      cache[it.id] = { ...cache[it.id], box, face: [ax.at(ext[0]), ax.at(ext[1])] }
    } catch { /* 挂不上：保留上一次的 */ }
  }
  // 放在宿主里的家电：记下最后一次挂得上时的位置（宿主没了以后 core 按它画在原处）
  for (const f of decor.furniture) {
    if (!f.in) continue
    try {
      const pose = furniturePose(plan, f)
      if (pose.missing) continue
      const fp = pose.footprint
      cache[f.id] = { ...cache[f.id], box: [Math.min(...fp.map(p => p[0])), Math.min(...fp.map(p => p[1])), Math.max(...fp.map(p => p[0])), Math.max(...fp.map(p => p[1]))], pose: { at: pose.at, rot: pose.rot, z: pose.z } }
    } catch { /* 宿主不在了 */ }
  }
  return cache
}

/* ───────── 构件几何（平面） ───────── */
export function faceOfItem(it: DecorItem): FaceRef | null {
  if ('place' in it) return 'face' in it.place ? it.place.face : null
  if ('span' in it && it.span) return it.span.face
  if ('host' in it) return 'face' in it.host ? it.host.face : null
  if ('against' in it && it.against) return it.against.face
  return null
}
export function footprintOf(plan: Plan, k: ItemKind, it: DecorItem): Vec2[] | null {
  try {
    if (k === 'furniture') return furnitureFootprint(it as Furniture, plan)
    if (k === 'cabinet') return cabinetFootprint(plan, it as Cabinet)
    if (k === 'panel') {
      const p = it as Panel, sp = panelSpan(plan, p), at = panelTransform(plan, p), w = Math.abs(sp.s[1] - sp.s[0])
      return [at(0, 0), at(w, 0), at(w, p.thickness), at(0, p.thickness)]
    }
    const r = it as Recess
    if (!('face' in r.host)) return null
    const e = wallEmbed(plan, r)
    return e ? embedFootprint(plan, e) : null
  } catch { return null }
}
export function hostWall(plan: Plan, it: DecorItem): Wall | undefined {
  const f = faceOfItem(it)
  return f ? plan.walls.find(w => w.id === f.wall) : undefined
}
export { embedsOf, embedFootprint }

/* ───────── 问题：没地方挂、受保护墙、几何上的硬约束 ───────── */
export interface DecorIssues { all: DecorIssue[]; orphans: DecorIssue[]; protected: DecorIssue[]; byId: Map<string, DecorIssue[]> }
let issueCache: { plan: Plan | null; base: Plan | null; out: DecorIssues } = { plan: null, base: null, out: { all: [], orphans: [], protected: [], byId: new Map() } }
export function decorIssues(plan: Plan, base: Plan): DecorIssues {
  if (issueCache.plan === plan && issueCache.base === base) return issueCache.out
  let all: DecorIssue[] = []
  try { all = validateDecor(plan, plan.decor, base) } catch (e) { all = [{ id: 'decor', code: 'invalid', level: 'error', text: e instanceof Error ? e.message : String(e) }] }
  // 「没地方挂了」只用 core decorStatus 判断（base + 已确认改造 → placed / moved / missing）。
  // 挂在墙上的（柜子、造型、壁龛 / 挖洞）和放在宿主里的家电才算；靠墙的自由家具墙没了原地不动、面的覆盖退回风格默认
  const missing: DecorIssue[] = []
  try {
    const st = decorStatus({ ...base, decor: plan.decor })
    for (const p of st.placed) {
      if (p.status !== 'missing') continue
      const it = p.item
      // 门的外观没有挂墙的位置可挪：洞口拆了在门的卡片上说，不进「没地方挂了」
      if ('target' in it || ('size' in it && !it.in) || plan.decor?.doors?.some(d => d.id === p.id)) continue
      const iss = st.issues.find(i => i.id === p.id && (i.code === 'host-missing' || i.code === 'host-cut'))
      missing.push(iss ?? { id: p.id, code: 'host-missing', level: 'warn', text: p.reasons.join('；') || p.text })
    }
  } catch { /* 解析失败按 validateDecor 的 invalid 报 */ }
  const orphanIds = new Set(missing.map(i => i.id))
  all = [...all.filter(i => !((i.code === 'host-missing' || i.code === 'host-cut') && !orphanIds.has(i.id))), ...missing.filter(m => !all.some(i => i.id === m.id && i.code === m.code))]
  const byId = new Map<string, DecorIssue[]>()
  for (const i of all) byId.set(i.id, [...(byId.get(i.id) ?? []), i])
  const out = { all, byId, orphans: missing, protected: all.filter(i => i.code === 'protected') }
  issueCache = { plan, base, out }
  return out
}
export function useDecorIssues(): DecorIssues | null {
  const dp = useDecorPlan()
  return useMemo(() => dp?.decor ? decorIssues(dp.plan, dp.base) : null, [dp])
}

/**
 * 结构改了以后（拆一段墙、撤销改造）：用 core rehostDecor 把挪到剩下那段墙上的装修改写成新墙 id（墙id~改造id），可直接存。
 * 和那次结构改动算同一步撤销：调用方不推历史（历史记的是改动之前的整份方案）。没有变化时返回 null。
 */
export function rehostAfterStructure(prevBase: Plan, nextBase: Plan): Decor | null {
  const decor = nextBase.decor
  if (!decor) return null
  try {
    const confirmed = (p: Plan) => applyChanges(p, p.changes.filter(c => c.status === 'confirmed')).plan
    const next = rehostDecor(confirmed(prevBase), confirmed(nextBase), decor)
    const strip = (d: Decor) => JSON.stringify({ ...d, cache: undefined })
    return strip(next) === strip(decor) ? null : next
  } catch { return null }
}

/* ───────── Agent 提议（待确认项） ───────── */
export type AnyItem = DecorItem | Surface | DoorFinish
export type AnyKind = ItemKind | 'surface' | 'door'
const allItems = (d: Decor): { k: AnyKind; it: AnyItem }[] => [...(['furniture', 'cabinet', 'panel', 'recess'] as ItemKind[]).flatMap(k => listOf(d, k).map(it => ({ k, it }))), ...d.surfaces.map(it => ({ k: 'surface' as const, it })), ...(d.doors ?? []).map(it => ({ k: 'door' as const, it }))]
/** 待你看的那几条，按画面上的类别排 */
export const pendingItems = (d: Decor | undefined) => d ? allItems(d).filter(x => x.it.status === 'pending') : []
/** 这条选中时该出哪张卡：面覆盖选那面墙 / 那块地，其余选它自己 */
export function selOfItem(x: { k: AnyKind; it: AnyItem }): DSel {
  if (x.k !== 'surface') return { k: x.k, id: x.it.id } as DSel
  const t = (x.it as Surface).target
  return 'face' in t ? { k: 'face', face: t.face } : 'floor' in t ? { k: 'floor', id: t.floor } : { k: 'floor', id: t.ceiling }
}
/** 一条的白话名字 */
export function itemTitle(plan: Plan, decor: Decor, x: { k: AnyKind; it: AnyItem }): string {
  if (x.k === 'surface') {
    const t = (x.it as Surface).target, m = matOf(decor, (x.it as Surface).material).name
    if ('face' in t) { const l = faceLabel(plan, t.face); return `${l.room}${l.dir}墙换成${m}` }
    const r = plan.rooms.find(q => q.id === ('floor' in t ? t.floor : t.ceiling))
    return `${r?.name ?? ''}${'floor' in t ? '地面' : '顶面'}换成${m}`
  }
  if (x.k === 'door') return doorTitle(plan, x.it as DoorFinish)
  const it = x.it as DecorItem
  if (it.name) return it.name
  if (x.k === 'furniture') return componentOf(decor, (it as Furniture).type)?.name ?? FURNITURE_LIBRARY.find(e => e.type === (it as Furniture).type)?.name ?? '家具'
  return ({ cabinet: '柜子', panel: '造型', recess: '壁龛' } as Record<string, string>)[x.k]
}
/* ───────── 门的外观 ───────── */
export const doorFinishOf = (decor: Decor | undefined, id: string) => decor?.doors?.find(d => d.id === id)
export const doorOfOpening = (decor: Decor | undefined, opening: string) => decor?.doors?.find(d => d.opening === opening)
/** 这扇门叫什么：结构里写了名字用名字；没写就按它通向的房间（面积小的那间，「主卧门」），入户门、推拉门照实说 */
export function openingName(plan: Plan, o: Opening): string {
  if (o.name) return o.name
  if (o.entry) return '入户门'
  const w = plan.walls.find(x => x.id === o.wall), tail = o.kind === 'sliding' ? '推拉门' : '门'
  if (!w) return tail
  const c = pointAt(w, o.offset + o.width / 2), n = wallNormal(w), off = w.thickness / 2 + 200
  const rooms = ([1, -1] as const).map(k => plan.rooms.find(r => pointInPolygon([c[0] + n[0] * off * k, c[1] + n[1] * off * k], r.poly))).filter((r): r is Room => !!r)
  const room = rooms.sort((a, b) => polygonArea(a.poly) - polygonArea(b.poly))[0]
  return room ? room.name + tail : tail
}
/** 卡片上的名字：外观自己写了名字用它，否则用门的名字 */
export function doorName(plan: Plan, d: DoorFinish): string {
  if (d.name) return d.name
  const o = plan.openings.find(x => x.id === d.opening)
  return o ? openingName(plan, o) : '门'
}
/** 提议列表里的名字：「主卧门的外观」 */
export function doorTitle(plan: Plan, d: DoorFinish): string {
  const n = doorName(plan, d)
  return /外观$/.test(n) ? n : `${n}的外观`
}
/** color / material 都可能是材料 id 或 #RRGGBB：取真实颜色；都没写、材料查不到时没有颜色 */
export function finishColor(decor: Decor | undefined, f: { color?: string; material?: string } | undefined): string | undefined {
  const v = f?.color ?? f?.material
  if (!v) return undefined
  if (v.startsWith('#')) return v
  const m = matOf(decor, v)
  return m.id === NEUTRAL.id ? undefined : m.color
}
/** 色块上的名字：写了材料说材料，只有颜色值说「自定义颜色」 */
export function finishMaterialName(decor: Decor | undefined, f: { color?: string; material?: string } | undefined): string {
  for (const v of [f?.material, f?.color]) if (v && !v.startsWith('#')) { const m = matOf(decor, v); if (m.id !== NEUTRAL.id) return m.name }
  return '自定义颜色'
}

/* ───────── 顶上的东西（吊顶、吸顶灯、吊灯） ───────── */
/** core isOverhead 的安全包装：宿主不在了算不上顶上的东西 */
export function overheadOf(plan: Plan, f: Furniture): boolean {
  try { return isOverhead(plan, f) } catch { return false }
}
export function overheadIds(plan: Plan, decor: Decor | undefined): Set<string> {
  if (!decor) return new Set()
  const p = plan.decor === decor ? plan : { ...plan, decor }
  return new Set(decor.furniture.filter(f => overheadOf(p, f)).map(f => f.id))
}

/** 下一条待确认（看完一条接着看下一条） */
export function nextPending(decor: Decor | undefined, after: string | undefined) {
  const list = pendingItems(decor), i = list.findIndex(x => x.it.id === after)
  return list.length ? list[(i + 1) % list.length] : null
}
/** 这条改了哪些字段（有 prev 时，给卡片说清楚改了什么） */
export function changedFields(it: AnyItem): string[] {
  const prev = it.prev as Record<string, unknown> | undefined
  if (!prev) return []
  const cur = it as unknown as Record<string, unknown>
  return [...new Set([...Object.keys(prev), ...Object.keys(cur)])].filter(k => !['prev', 'status', 'by', 'ack', 'id'].includes(k) && JSON.stringify(cur[k]) !== JSON.stringify(prev[k]))
}
export function confirmPending(ids: string[]): string[] {
  let done: string[] = []
  commitDecor(d => { done = confirmDecorItems(d, ids) })
  return done
}
export function rejectPending(ids: string[]) {
  const dp = getDecorPlan()
  let out = { removed: [] as string[], restored: [] as string[] }
  commitDecor(d => { out = rejectDecorItems(d, ids, f => dp ? unhostFurniture(dp.plan, f) : f) })
  return out
}
/**
 * 选中、取景、悬停、交接引用指向的东西不在了（Agent 改了文件、撤销、改造里拆了墙）就清掉，不留着报错：
 * 柜体编辑退回那面墙的立面，墙也没了退回平面；选中的格子没了退回选柜子。
 */
export function pruneDecorUI() {
  const s = useStore.getState(), D = useDecor.getState(), decor = s.base?.decor
  const inDecor = s.mode === 'decor', plan = inDecor ? getView()?.plan : undefined
  const hasItem = (id: string) => !!findItem(decor, id)
  const hasWall = (id: string) => !plan || plan.walls.some(w => w.id === id)
  const hasRoom = (id: string) => !plan || plan.rooms.some(r => r.id === id)
  const fix = (x: DSel | null): DSel | null => {
    if (!x) return x
    if (x.k === 'floor') return hasRoom(x.id) ? x : null
    if (x.k === 'face') return hasWall(x.face.wall) ? x : null
    if (x.k === 'door') return doorFinishOf(decor, x.id) ? x : null
    if (!hasItem(x.id)) return null
    if (x.k === 'cell') { const c = decor?.cabinets.find(q => q.id === x.id); return c?.columns[x.col]?.cells[x.row] ? x : { k: 'cabinet', id: x.id } }
    return x
  }
  const patch: Partial<ReturnType<typeof useDecor.getState>> = {}
  const sel = fix(D.sel), hover = fix(D.hover)
  if (sel !== D.sel) patch.sel = sel
  if (hover !== D.hover) patch.hover = hover
  if (D.canvas.k === 'cabinet' && !hasItem(D.canvas.id)) patch.canvas = hasWall(D.canvas.face.wall) ? { k: 'elev', face: D.canvas.face, ...(D.canvas.room ? { room: D.canvas.room } : {}) } : { k: 'plan' }
  else if (D.canvas.k !== 'plan' && !hasWall(D.canvas.face.wall)) patch.canvas = { k: 'plan' }
  if (D.probe && !hasItem(D.probe.item) && decor) patch.probe = null
  const hasRef = (id: string) => hasItem(id) || decor?.surfaces.some(x => x.id === id) || !!doorFinishOf(decor, id)
  if (D.agentRefs.some(id => !hasRef(id))) patch.agentRefs = D.agentRefs.filter(hasRef)
  if (D.placing && isCustomType(D.placing) && !componentOf(decor, D.placing)) { patch.placing = null; if (D.tool === 'furniture') patch.tool = 'select' }
  if (D.throughHint && !hasItem(D.throughHint.id)) patch.throughHint = null
  if (D.preview && decor && !allStyles(decor).some(x => x.id === D.preview)) patch.preview = null
  if (Object.keys(patch).length) D.set(patch)
}

/** 找一个构件（四类里） */
export function findItem(decor: Decor | undefined, id: string): { k: ItemKind; it: DecorItem } | null {
  if (!decor) return null
  for (const k of ['furniture', 'cabinet', 'panel', 'recess'] as ItemKind[]) { const it = listOf(decor, k).find(x => x.id === id); if (it) return { k, it } }
  return null
}
export function newDecorId(decor: Decor, plan: Plan, prefix: string) {
  const ids = new Set<string>([...plan.walls, ...plan.openings, ...plan.rooms, ...plan.beams].map(x => x.id))
  for (const k of ['furniture', 'cabinet', 'panel', 'recess'] as ItemKind[]) for (const x of listOf(decor, k)) ids.add(x.id)
  for (const s of decor.surfaces) ids.add(s.id)
  for (const d of decor.doors ?? []) ids.add(d.id)
  let i = 1; while (ids.has(`${prefix}${i}`)) i++
  return `${prefix}${i}`
}
/** 放在宿主里的家电拿出来：先取它现在的世界位置，再去掉 in、写回 at / rot / z（core 规定 at 和 in 二选一） */
export function unhostFurniture(plan: Plan, f: Furniture): Furniture {
  if (!f.in) return f
  const pose = furniturePose(plan, f)
  const { in: _in, at: _at, rot: _rot, ...rest } = f
  void _in; void _at; void _rot
  return { ...rest, at: [Math.round(pose.at[0]), Math.round(pose.at[1])], rot: Math.round(pose.rot * 100) / 100, z: pose.z }
}
export function removeItem(id: string) {
  const s = useStore.getState(), d = s.base?.decor, f = findItem(d, id)
  if (doorFinishOf(d, id)) {
    commitDecor(dd => { dd.doors = (dd.doors ?? []).filter(x => x.id !== id) })
    useDecor.getState().select(null)
    return true
  }
  if (!f) return false
  const dp = getDecorPlan()
  commitDecor(dd => {
    const L = LIST[f.k]
    ;(dd as unknown as Record<string, DecorItem[]>)[L] = listOf(dd, f.k).filter(x => x.id !== id)
    // 挂在它上面的洞、放在洞里的家电一起去掉
    dd.recesses = dd.recesses.filter(r => !(('panel' in r.host && r.host.panel === id) || ('cabinet' in r.host && r.host.cabinet === id)))
    dd.furniture = dd.furniture.map(x => x.in === id || x.in?.startsWith(id + ':cell:') ? (dp ? unhostFurniture(dp.plan, x) : x) : x)
  })
  useDecor.getState().select(null)
  return true
}

/** 用到的材料：色块 + 名字 + 用在哪 + 面积粗估（core materialTakeoff：按各片真实面积扣洞口、扣造型遮挡，m²） */
export interface MaterialUse { m: Material; where: string[]; area: number; overridden: boolean; count?: number }
export function materialUses(plan: Plan, decor: Decor, styleId = decor.style, keep = true): MaterialUse[] {
  // 顺序和 D4 一样读：地面 → 墙面 → 造型 → 柜子，同类按面积从大到小
  const rank = (q: ReturnType<typeof materialTakeoff>[number]) => q.floor > 0.05 ? 0 : q.wall > 0.05 ? 1 : q.panel > 0.05 ? 2 : 3
  return materialTakeoff({ ...plan, decor }, { styleId, keep }).sort((a, b) => rank(a) - rank(b) || b.area - a.area).map(q => ({ m: q.material, where: q.where, area: q.area, overridden: q.overridden, ...(q.count ? { count: q.count } : {}) }))
}

/** 平面上某处最近的墙面（点墙边 300mm 以内 = 选那一侧） */
export function faceNear(plan: Plan, p: Vec2, reach = 300): { face: FaceRef; s: number; d: number } | null {
  let best: { face: FaceRef; s: number; d: number } | null = null
  for (const w of plan.walls) {
    if (w.bulge) continue
    const L = wallLength(w), u = wallDir(w), n = wallNormal(w)
    const q: Vec2 = [p[0] - w.a[0], p[1] - w.a[1]]
    const s = q[0] * u[0] + q[1] * u[1], off = q[0] * n[0] + q[1] * n[1]
    if (s < -w.thickness / 2 || s > L + w.thickness / 2) continue
    const d = Math.abs(off) - w.thickness / 2 // 离墙面多远（<0 在墙里）
    // 点在墙体里面时：只有一侧是房间的墙（外墙）默认选室内那一侧；明确点在墙外才选室外一侧（D6 B6）
    const inner = d < 0 ? indoorSide(plan, w.id) : null
    const side: 1 | -1 = inner ?? (off >= 0 ? 1 : -1)
    if (d > reach) continue
    if (!best || d < best.d) best = { face: { wall: w.id, side }, s, d }
  }
  return best
}
export const selKey = (s: DSel | null) => !s ? '' : s.k === 'face' ? `face:${s.face.wall}:${s.face.side}` : s.k === 'cell' ? `cell:${s.id}:${s.col}:${s.row}` : `${s.k}:${s.id}`
