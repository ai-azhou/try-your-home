/**
 * 改造清单导出 ·「装修想法」一节（D5 第 18 项）。
 * 口吻：我的装修想法，可行性待专业确认（不出现「给设计师」）；不写品牌、色号；材料面积标「约 · 粗估，只用来对量级」。
 * 页：装修总览 → 每个房间一块（平面局部 + 装修最多那面墙的立面，图上标序号、右栏按序号写）→ 用到的材料 + 家具尺寸 →
 *     需要专业确认（受保护墙上的嵌入、挖洞；页脚写「墙里可能有水电管线…」）。
 * 序号接在结构改造后面，全局一套（功能设计 §6）；取景、视图用 core decorFocus，墙面立面用 core elevationOf（经 decor/elev-model）。
 */
import type { Box, Plan, Vec2, Wall, WallKind } from '@/core/types'
import type { Cabinet, Decor, FaceRef, Panel, Recess } from '@/core/decor/types'
import { decorFocus } from '@/core/decor/resolve'
import { faceAxis, faceExtent, faceRun } from '@/core/decor/faces'
import { joinedWallFootprint } from '@/core/walls'
import { levelOf } from '@/core/levels'
import { cabinetFootprint, layoutCabinet } from '@/core/decor/cabinets'
import { furniturePose, isFlatFurniture } from '@/core/decor/furniture'
import { pendingCount } from '@/core/decor/resolve'
import { embedFootprint, embedsOf } from '@/core/decor/embed'
import { materialOf, materialTakeoff, resolveFinish, faceRoom, styleOf as coreStyleOf } from '@/core/decor/surfaces'
import { labelPoint, planBounds, pointInPolygon } from '@/core/geometry'
import { planTone, elevTone } from '../canvas2d/style'
import { decorIssues, footprintOf, faceLabel, overheadIds, WALL_ZH, type ItemKind } from '../decor/model'
import { panelSpan } from '@/core/decor/panels'
import { elevationModel, type ElevModel } from '../decor/elev-model'
import { furnitureName } from '../decor/furniture'
import { HEAD_RIGHT_Y, K, NUM, T, badge, chip, clampLines, lines, lockIcon, measure, newPage, pageHead, panel, pattern, rrect, text, vdim, wrap, type Ctx, type Tok } from './canvas'
import { boxOf, drawPlan, fitFrame, frameFor, polyPath, type Rect, type Xf } from './plan-draw'
import { layoutBadges, type BadgeIn } from './badges'
import { BADGE, BODY, DETAIL, GUTTER, MIN_GAP_PX, PAGE, PANEL_PAD, span, type ExportDoc } from './model'
import { drawPlanLegends, drawRoomLabels, factsOf, fitPlans, type Circle, type PlanSlot, type SheetFacts } from './room-labels'
import { BAR, GUTTER_L, alertRun, drawCol, flow, type Atom, type FlowCol, type Run } from './textflow'

/* ───────── 数据 ───────── */
export interface DecorExportItem {
  number: number
  id: string
  kind: ItemKind | 'surface'
  room: string
  roomName: string
  anchor: Vec2
  bbox: Box
  face?: FaceRef
  title: string
  lines: string[]
  note?: string
  by: 'user' | 'agent'
  status: 'pending' | 'confirmed'
  /** 受保护墙上的嵌入：只陈述事实 */
  protect?: string
  orphan?: boolean
  page: number
}
export interface DecorRoomBlock { room: string; name: string; lines: string[]; items: DecorExportItem[]; face?: FaceRef }
export type DecorSheetKind = 'decor-overview' | 'decor-room' | 'decor-materials' | 'decor-pro'
export interface DecorSheet { kind: DecorSheetKind; block?: DecorRoomBlock; items?: DecorExportItem[]; part?: [number, number]; col?: FlowCol<DecorExportItem> }
export interface DecorPart { plan: Plan; decor: Decor; style: string; items: DecorExportItem[]; blocks: DecorRoomBlock[]; sheets: DecorSheet[]; pro: DecorExportItem[] }

const FAMILY = { tall: '高柜', base: '地柜', wall: '吊柜' }
const CELL = { door: '单开门', doors: '对开门', drawers: '抽屉', flap: '上翻门', open: '开放格', void: '挖洞', appliance: '家电位' } as const
const APPL: Record<string, string> = { fridge: '冰箱', washer: '洗衣机', dryer: '烘干机', oven: '烤箱', steamer: '蒸箱', dishwasher: '洗碗机', microwave: '微波炉', tv: '电视', other: '家电' }
const PANEL_ZH = { feature: '背景墙板', wainscot: '护墙板', slats: '格栅', skirting: '踢脚线', arch: '拱形门套' }
const mm = (v: number) => Math.round(v).toLocaleString('en-US')
/** 每页右栏最多讲几项（再多就拆页，和结构页的 MAX_ITEMS 同一个意思） */
const PER_PAGE = 5

function cabinetLines(p: Plan, c: Cabinet): string[] {
  const L = layoutCabinet(c), out: string[] = []
  out.push(`${FAMILY[c.family]}：宽 ${mm(c.width)} × 高 ${(c.z[1] - c.z[0]).toFixed(2)} m × 深 ${mm(c.depth)}${c.z[0] > 0.05 ? `，离地 ${c.z[0].toFixed(2)} m` : ''}`)
  const cols = L.columns.map((col, i) => {
    const cells = L.cells.filter(x => x.column === i).map(x => x.type === 'appliance' ? `${APPL[x.cell.appliance?.type ?? 'other']}位` : x.type === 'void' && x.cell.void?.top ? `挖洞（洞里台面 ${x.cell.void.top.z.toFixed(2)} m${x.cell.void.top.overhang ? `，出柜 ${mm(x.cell.void.top.overhang)}` : ''}）` : CELL[x.type])
    return `第 ${i + 1} 列 ${mm(col.width)}：${[...new Set(cells)].join(' / ')}`
  })
  if (cols.length) out.push(`分 ${cols.length} 列（从左到右）：${cols.join('；')}`)
  if (c.cuts?.length) out.push(`跨格挖洞 ${c.cuts.length} 处`)
  out.push(`柜门 ${materialOf(p, c.materials.front).name}${c.materials.carcass !== c.materials.front ? ` · 柜身 ${materialOf(p, c.materials.carcass).name}` : ''}${c.top ? ` · 台面 ${materialOf(p, c.top.material).name}` : ''}`)
  if (c.embed) out.push(`嵌进墙里 ${mm(c.embed)} mm`)
  return out
}
function panelLines(p: Plan, pn: Panel): string[] {
  const out: string[] = []
  let sp = pn.span
  try { sp = panelSpan(p, pn) } catch { /* 拱形门套的门洞不在了 */ }
  const w = sp ? Math.abs(sp.s[1] - sp.s[0]) : 0, h = sp ? sp.z[1] - sp.z[0] : 0
  out.push(`${PANEL_ZH[pn.type]}：宽 ${mm(w)} × 高 ${h.toFixed(2)} m，出墙 ${mm(pn.thickness)} mm（含龙骨）`)
  out.push(`${materialOf(p, pn.material).name}${pn.grooves ? ` · ${pn.grooves.dir === 'v' ? '竖' : '横'}缝，间距 ${mm(pn.grooves.spacing)}` : ''}`)
  return out
}
function recessLines(p: Plan, d: Decor, r: Recess): string[] {
  const w = r.rect.s ? Math.abs(r.rect.s[1] - r.rect.s[0]) : r.rect.u ? Math.abs(r.rect.u[1] - r.rect.u[0]) : 0
  const host = 'panel' in r.host ? d.panels.find(x => x.id === (r.host as { panel: string }).panel) : 'cabinet' in r.host ? d.cabinets.find(x => x.id === (r.host as { cabinet: string }).cabinet) : undefined
  const on = host ? `挖在${host.name ?? ('thickness' in host ? '造型' : '柜子')}上` : '挖在墙上（壁龛）'
  const out = [`${on}：宽 ${mm(w)} × 高 ${(r.rect.z[1] - r.rect.z[0]).toFixed(2)} m，离地 ${r.rect.z[0].toFixed(2)} m，${r.depth === 'through' ? '挖穿' : `挖进 ${mm(r.depth)} mm`}`]
  const inside = d.furniture.filter(f => f.in === r.id)
  if (inside.length) out.push(`里面放：${inside.map(f => furnitureName(d, f)).join('、')}`)
  if (r.back) out.push(`背板 ${materialOf(p, r.back).name}`)
  return out
}

/** 受保护墙上的嵌入：只陈述两件事实（方案里是什么墙 + 把握程度；挖进多深 / 墙厚） */
function protectFact(p: Plan, base: Plan, d: Decor, id: string): string | undefined {
  const iss = decorIssues({ ...p, decor: d }, base).byId.get(id)?.find(i => i.code === 'protected')
  if (!iss) return undefined
  const e = embedsOf({ ...p, decor: d }, d).find(x => x.id === id)
  const w = e ? p.walls.find(x => x.id === e.face.wall) : undefined
  if (!w) return iss.text
  const cert = w.evidence?.certainty ?? 'unknown'
  const head = cert === 'seen' ? `方案里是${WALL_ZH[w.kind]}（读图看到）` : cert === 'inferred' ? `读图推断是${WALL_ZH[w.kind]}，没确认` : `方案里标为${WALL_ZH[w.kind]}（读图把握程度未知）`
  return `${head} · 挖进 ${e && e.depth !== 'through' ? mm(e.depth) : '穿'} · 墙厚 ${mm(w.thickness)}`
}

export function buildDecorPart(after: Plan, base: Plan, startNumber: number, firstPage: number): DecorPart | null {
  const decor = base.decor
  if (!decor) return null
  const plan: Plan = { ...after, decor }
  const style = coreStyleOf(plan)?.name ?? decor.style
  const issues = decorIssues(plan, base)
  const orphan = new Set(issues.orphans.map(i => i.id))
  let focus: ReturnType<typeof decorFocus> = []
  try { focus = decorFocus(plan) } catch { focus = [] }
  const roomAt = (p: Vec2) => plan.rooms.find(r => pointInPolygon(p, r.poly))
  const items: DecorExportItem[] = []
  const add = (id: string, kind: DecorExportItem['kind'], it: { name?: string; note?: string; by: 'user' | 'agent'; status: 'pending' | 'confirmed' }, title: string, lines: string[], at: { anchor: Vec2; bbox: Box; face?: FaceRef }) => {
    // 归到哪间房：先看构件中心落在哪间房里（一面墙跨几间房时也分得对），落不进再按墙面朝向的房间
    const r = roomAt(at.anchor) ?? (at.face ? (() => { try { return faceRoom(plan, at.face!) } catch { return undefined } })() : undefined)
    items.push({ number: 0, id, kind, room: r?.id ?? '', roomName: r?.name ?? '其他', anchor: at.anchor, bbox: at.bbox, face: at.face, title, lines, note: it.note, by: it.by, status: it.status, protect: protectFact(plan, base, decor, id), orphan: orphan.has(id), page: 0 })
  }
  const fOf = (id: string) => focus.find(f => f.id === id)
  const faceOfAt = (f: ReturnType<typeof decorFocus>[number] | undefined, fallback?: FaceRef) => fallback ?? (f?.face ? undefined : undefined)
  for (const c of decor.cabinets) {
    const f = fOf(c.id), box = f?.bbox ?? decor.cache?.[c.id]?.box
    if (!box) continue
    add(c.id, 'cabinet', c, c.name ?? FAMILY[c.family], cabinetLines(plan, c), { anchor: f?.anchor ?? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], bbox: box, face: faceOfAt(f, 'face' in c.place ? c.place.face : undefined) })
  }
  for (const pn of decor.panels) {
    const f = fOf(pn.id), box = f?.bbox ?? decor.cache?.[pn.id]?.box
    if (!box) continue
    add(pn.id, 'panel', pn, pn.name ?? PANEL_ZH[pn.type], panelLines(plan, pn), { anchor: f?.anchor ?? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], bbox: box, face: pn.span?.face })
  }
  for (const r of decor.recesses) {
    const f = fOf(r.id), box = f?.bbox ?? decor.cache?.[r.id]?.box
    if (!box) continue
    const hostFace = 'face' in r.host ? r.host.face : 'panel' in r.host ? decor.panels.find(x => x.id === (r.host as { panel: string }).panel)?.span?.face : undefined
    add(r.id, 'recess', r, r.name ?? (r.kind === 'niche' ? '壁龛' : '挖洞'), recessLines(plan, decor, r), { anchor: f?.anchor ?? [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], bbox: box, face: hostFace })
  }
  // 墙面换材料（整面 / 一段 / 到某个高度）：编号，图上落在那面墙的中点往房间里一点
  for (const s of decor.surfaces) {
    if (!('face' in s.target)) continue
    const face = s.target.face
    try {
      const ax = faceAxis(plan, face), ext = s.target.s ?? faceExtent(plan, face), mid = (ext[0] + ext[1]) / 2
      const a = ax.at(mid, 320), lbl = faceLabel(plan, face)
      const def = resolveFinish(plan, { face }, { keep: false }).material
      const scope = s.target.s ? `一段（${mm(Math.abs(s.target.s[1] - s.target.s[0]))}）` : s.target.z ? `刷到离地 ${s.target.z[1].toFixed(2)} m` : '整面'
      add(s.id, 'surface', { by: s.by, status: s.status }, `${lbl.room}${lbl.dir}墙 · 墙面`, [`${scope}换成 ${materialOf(plan, s.material).name}（风格默认是${def.name}）`], { anchor: a, bbox: [a[0] - 200, a[1] - 200, a[0] + 200, a[1] + 200], face })
    } catch { /* 墙不在了 */ }
  }
  // 房间一块：按房间分组，同一间里按「看这面墙」聚到一起
  const rooms = new Map<string, DecorRoomBlock>()
  const block = (id: string, name: string) => { let b = rooms.get(id); if (!b) { b = { room: id, name, lines: [], items: [] }; rooms.set(id, b) } return b }
  for (const r of plan.rooms) {
    const fin = resolveFinish(plan, { floor: r.id }, { room: r })
    if (fin.overridden) block(r.id, r.name).lines.push(`地面：${fin.material.name}（风格默认是${fin.styleMaterial.name}）`)
  }
  for (const it of items) block(it.room, it.roomName).items.push(it)
  const blocks = [...rooms.values()].filter(b => b.items.length || b.lines.length)
  // 房间顺序：按平面位置（上→下、左→右），读起来和总览图一致
  const center = (b: DecorRoomBlock) => { const r = plan.rooms.find(x => x.id === b.room); return r ? labelPoint(r.poly) : [1e9, 1e9] as Vec2 }
  blocks.sort((a, b) => { const p = center(a), q = center(b); return Math.round(p[1] / 1500) - Math.round(q[1] / 1500) || p[0] - q[0] })
  for (const b of blocks) {
    b.items.sort((x, y) => (x.kind === 'surface' ? 1 : 0) - (y.kind === 'surface' ? 1 : 0) || x.anchor[1] - y.anchor[1] || x.anchor[0] - y.anchor[0])
    // 立面讲哪面墙：这间房里挂东西最多的那面
    const count = new Map<string, number>()
    for (const it of b.items) if (it.face && it.kind !== 'surface' && !it.orphan) { const k = `${it.face.wall}:${it.face.side}`; count.set(k, (count.get(k) ?? 0) + 1) }
    const best = [...count.entries()].sort((x, y) => y[1] - x[1])[0]
    if (best) { const [w, s] = best[0].split(':'); b.face = { wall: w, side: +s as 1 | -1 } }
  }
  // 编号：按页面顺序，接在结构条目后面
  let n = startNumber
  const sheets: DecorSheet[] = [{ kind: 'decor-overview' }]
  for (const b of blocks) {
    const parts = Math.max(1, Math.ceil(b.items.length / PER_PAGE))
    for (let i = 0; i < parts; i++) {
      const its = b.items.slice(i * PER_PAGE, (i + 1) * PER_PAGE)
      sheets.push({ kind: 'decor-room', block: b, items: its, part: [i + 1, parts] })
    }
  }
  for (const b of blocks) for (const it of b.items) it.number = n++
  sheets.push({ kind: 'decor-materials' })
  const pro = items.filter(i => i.protect)
  if (pro.length) sheets.push({ kind: 'decor-pro', items: pro })
  sheets.forEach((s, i) => s.items?.forEach(it => { if (s.kind === 'decor-room') it.page = firstPage + i }))
  return { plan, decor, style, items, blocks, sheets, pro }
}

/* ───────── 画法 ───────── */
const inner = (x: number, y: number, w: number, h: number): Rect => ({ x: x + PANEL_PAD.x, y: y + PANEL_PAD.top, w: w - 2 * PANEL_PAD.x, h: h - PANEL_PAD.top - PANEL_PAD.bottom })
const S = {
  title: '装修想法',
  disclaimer: '我的装修想法，可行性待专业确认',
  pipes: '墙里可能有水电管线，嵌入、挖槽的位置都要现场确认',
  rough: '面积约数 · 粗估，只用来对量级',
  pendingItem: '待确认：Agent 提议，还没算数',
}

/** 平面：地面铺样色（打印更浅一档），装修构件画在结构上面 */
function drawDecorPlan(ctx: Ctx, part: DecorPart, x: Xf, r: Rect, o: { strong?: Set<string> } = {}) {
  const { plan, decor } = part
  const fills = new Map(plan.rooms.map(rm => { try { return [rm.id, planTone(resolveFinish(plan, { floor: rm.id }, { room: rm }).material.color, 0.012)] as const } catch { return [rm.id, K.paper] as const } }))
  drawPlan(ctx, plan, x, r, { tone: 'normal', floorFill: id => fills.get(id) })
  ctx.save(); ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 10); ctx.clip()
  const faint = (id: string) => o.strong && !o.strong.has(id)
  // 墙面换材料：贴着墙面一条色带
  for (const s of decor.surfaces) {
    if (!('face' in s.target)) continue
    try {
      const ax = faceAxis(plan, s.target.face), ext = s.target.s ?? faceExtent(plan, s.target.face)
      const a = x.P(ax.at(ext[0], 40)), b = x.P(ax.at(ext[1], 40))
      ctx.strokeStyle = planTone(materialOf(plan, s.material).color, -0.12); ctx.lineWidth = 3.2; ctx.globalAlpha = faint(s.id) ? 0.45 : 1
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.globalAlpha = 1
    } catch { /* */ }
  }
  // 家具：淡墨轮廓（不编号，进家具尺寸表）
  const overhead = overheadIds(plan, decor)
  for (const f of decor.furniture) {
    if (isFlatFurniture(decor, f) && !overhead.has(f.id)) continue
    try {
      const pose = furniturePose(plan, f)
      ctx.beginPath(); polyPath(ctx, x, pose.footprint)
      // 顶上的东西（吊顶、顶灯）：和界面一样只画虚线，不盖住地面和家具
      if (overhead.has(f.id)) { ctx.setLineDash([5, 4]); ctx.strokeStyle = f.status === 'pending' ? K.lav : K.ink300; ctx.lineWidth = 0.9; ctx.stroke(); ctx.setLineDash([]); continue }
      // 待确认的：淡紫斜纹 + 紫色虚线，和界面同一个说法
      if (f.status === 'pending') { ctx.fillStyle = pattern(ctx, 'lav'); ctx.fill(); ctx.setLineDash([4, 3]); ctx.strokeStyle = K.lav; ctx.lineWidth = 1.1; ctx.stroke(); ctx.setLineDash([]) }
      else { ctx.fillStyle = f.type === 'tv' ? '#3b4048' : K.paper; ctx.fill(); ctx.strokeStyle = K.ink300; ctx.lineWidth = 0.8; ctx.stroke() }
    } catch { /* */ }
  }
  // 造型、柜子、壁龛
  for (const pn of decor.panels) {
    const fp = footprintOf(plan, 'panel', pn); if (!fp) continue
    ctx.globalAlpha = faint(pn.id) ? 0.45 : 1
    ctx.beginPath(); polyPath(ctx, x, fp)
    if (pn.type === 'arch') { ctx.setLineDash([5, 4]); ctx.strokeStyle = K.ink600; ctx.lineWidth = 0.9; ctx.stroke(); ctx.setLineDash([]) } // 门洞上方，不盖住门洞
    else { ctx.fillStyle = planTone(materialOf(plan, pn.material).color, -0.04); ctx.fill(); ctx.strokeStyle = K.ink600; ctx.lineWidth = 0.9; ctx.stroke() }
    if (pn.status === 'pending') pendingMark(ctx, x, fp)
    ctx.globalAlpha = 1
  }
  for (const c of decor.cabinets) {
    if (part.items.find(i => i.id === c.id)?.orphan) continue
    let fp: Vec2[]
    try { fp = cabinetFootprint(plan, c) } catch { continue }
    ctx.globalAlpha = faint(c.id) ? 0.45 : 1
    ctx.beginPath(); polyPath(ctx, x, fp)
    ctx.fillStyle = planTone(materialOf(plan, c.top?.material ?? c.materials.front).color, -0.02); ctx.fill()
    if (c.family === 'wall') ctx.setLineDash([5, 4])
    ctx.strokeStyle = K.ink600; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([])
    if (c.family === 'tall') { const q = fp.map(p => x.P(p)); ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); ctx.lineTo(q[2][0], q[2][1]); ctx.moveTo(q[1][0], q[1][1]); ctx.lineTo(q[3][0], q[3][1]); ctx.strokeStyle = K.ink300; ctx.lineWidth = 0.7; ctx.stroke() }
    if (c.status === 'pending') pendingMark(ctx, x, fp)
    ctx.globalAlpha = 1
  }
  for (const e of embedsOf(plan, decor)) {
    if (!decor.recesses.some(r => r.id === e.id)) continue
    try { ctx.beginPath(); polyPath(ctx, x, embedFootprint(plan, e)); ctx.fillStyle = '#e6e0d4'; ctx.fill(); ctx.setLineDash([3, 2]); ctx.strokeStyle = K.ink600; ctx.lineWidth = 0.9; ctx.stroke(); ctx.setLineDash([]) } catch { /* */ }
  }
  // 没地方挂的：原处虚线框
  for (const it of part.items.filter(i => i.orphan)) {
    const b = it.bbox, A = x.P([b[0], b[1]]), B = x.P([b[2], b[3]])
    ctx.setLineDash([5, 4]); ctx.strokeStyle = '#a08a1c'; ctx.lineWidth = 1.3; ctx.strokeRect(A[0], A[1], B[0] - A[0], B[1] - A[1]); ctx.setLineDash([])
  }
  ctx.restore()
}

function pendingMark(ctx: Ctx, x: Xf, fp: Vec2[]) {
  ctx.beginPath(); polyPath(ctx, x, fp); ctx.fillStyle = pattern(ctx, 'lav'); ctx.globalAlpha = 0.7; ctx.fill(); ctx.globalAlpha = 1
  ctx.setLineDash([4, 3]); ctx.strokeStyle = K.lav; ctx.lineWidth = 1.1; ctx.stroke(); ctx.setLineDash([])
}

/* ───────── 立面取景 ───────── */
/** 一端剖到的墙：u = 它在墙面上占的那一段；kind null = 这里是开敞的房间分界（没有墙），画一道虚线 */
interface ElevCut { kind: WallKind | null; u: [number, number] }
interface ElevView { u: [number, number]; l: ElevCut | null; r: ElevCut | null }

/** 构件在立面上的左右范围（u，mm），取景打分、序号锚点用 */
function spanOf(m: ElevModel, decor: Decor, id: string): [number, number] | null {
  const c = m.cabinets.find(x => x.c.id === id); if (c) return [c.u0, c.u0 + c.c.width]
  const p = m.panels.find(x => x.p.id === id); if (p) return [p.u0 + p.geo.rect.u[0], p.u0 + p.geo.rect.u[1]]
  const n = m.niches.find(x => x.r.id === id); if (n) return n.u
  const h = decor.recesses.find(x => x.id === id && 'panel' in x.host && x.rect.u)
  const hp = h && m.panels.find(x => x.p.id === (h.host as { panel: string }).panel)
  return h && hp ? [hp.u0 + h.rect.u![0], hp.u0 + h.rect.u![1]] : null
}

/**
 * 立面取景，和立面编辑器同一套：这间房在这条墙面链上的那一段 = core elevationOf 的 segments 里这间房的段
 * （相邻的并起来；有几块时取本页构件最多的那块）；这间房不在这面墙上时退回编辑器的默认取景 focus。
 * 两端剖到的墙：到墙链端头用 core ends；中间的房间分界，分界外 30 mm、离墙面 40 mm 落在哪面墙的足迹里（和 core ends 同一个探法），
 * 墙在墙面上占多宽按足迹实际量，取景边对齐到墙的这一面。
 */
function elevView(plan: Plan, decor: Decor, m: ElevModel, roomId: string | undefined, ids: Set<string>): ElevView {
  const segs = roomId ? m.segments.filter(sg => sg.room.id === roomId).sort((a, b) => a.u[0] - b.u[0]) : []
  const groups: [number, number][] = []
  for (const sg of segs) { const g = groups.at(-1); if (g && sg.u[0] - g[1] < 50) g[1] = Math.max(g[1], sg.u[1]); else groups.push([sg.u[0], sg.u[1]]) }
  const spans = [...ids].map(id => spanOf(m, decor, id)).filter(Boolean) as [number, number][]
  const score = (g: [number, number]) => spans.filter(([a, b]) => a < g[1] && b > g[0]).length
  const pick = groups.length ? [...groups].sort((a, b) => score(b) - score(a) || (b[1] - b[0]) - (a[1] - a[0]))[0] : m.focus
  const u: [number, number] = [Math.max(m.u[0], pick[0]), Math.min(m.u[1], pick[1])]
  let run: Set<string>
  try { run = new Set(faceRun(plan, m.face).map(p => p.wall.id)) } catch { run = new Set([m.face.wall]) }
  const lv = levelOf(plan, m.ax.wall).id
  const walls = plan.walls.filter(w => !run.has(w.id) && levelOf(plan, w).id === lv)
  const fps = new Map<string, Vec2[][][]>()
  const inWall = (w: Wall, uu: number) => {
    let f = fps.get(w.id)
    if (!f) { try { f = joinedWallFootprint(plan, w) } catch { f = [] } fps.set(w.id, f) }
    const p = m.ax.at(m.ax.toS(uu), 40)
    return f.some(rings => pointInPolygon(p, rings[0]))
  }
  const cut = (side: 'l' | 'r'): ElevCut | null => {
    const at = side === 'l' ? u[0] : u[1], out = side === 'l' ? -1 : 1
    if (Math.abs(at - (side === 'l' ? m.u[0] : m.u[1])) < 2) {
      const e = m.ends.find(x => x.side === side)
      return e ? { kind: e.kind, u: side === 'l' ? [at - e.thickness, at] : [at, at + e.thickness] } : null
    }
    const probe = at + out * 30, w = walls.find(x => inWall(x, probe))
    if (!w) return { kind: null, u: [at, at] }
    let a = probe, b = probe
    while (a > probe - 600 && inWall(w, a - 5)) a -= 5
    while (b < probe + 600 && inWall(w, b + 5)) b += 5
    return { kind: w.kind, u: [a, b] }
  }
  const l = cut('l'), r = cut('r')
  if (l?.kind) u[0] = Math.max(m.u[0], l.u[1])
  if (r?.kind) u[1] = Math.min(m.u[1], r.u[0])
  return { u, l, r }
}

const CUT_FILL: Record<string, string> = { exterior: K.wallExt, bearing: K.wallBearing, glass: '#c7e6f8', 'half-glass': '#c7e6f8' }

/**
 * 立面（core elevationOf 经 elev-model）：墙面材料、门窗、梁、造型、柜子（门板按裁后的片）、挖洞、洞里的家电。
 * 只画取景段（elevView），两端剖到的墙照常画；整张图在框里等比缩放、居中；高度尺寸在图左侧外面，宽度尺寸在图下面、标取景段的真实宽。
 */
function drawDecorElevation(ctx: Ctx, part: DecorPart, base: Plan, face: FaceRef, r: Rect, roomId: string | undefined, ids: Set<string>): { anchor(id: string): [number, number] | null; label: string; bounds: Rect } | null {
  const { plan, decor } = part
  const m = elevationModel(plan, base, decor, face)
  if (!m) return null
  const v = elevView(plan, decor, m, roomId, ids)
  const [v0, v1] = v.u, H = m.H, SL = 0.1
  if (v1 - v0 < 50) return null
  const e0 = v.l?.u[0] ?? v0, e1 = v.r?.u[1] ?? v1
  // 等比缩放、居中：左边留高度尺寸（右边对称留同样宽），下边留宽度尺寸
  const padX = 80, padT = 6, padB = 40, W = e1 - e0, HZ = (H + 2 * SL) * 1000
  const s = Math.min((r.w - 2 * padX) / W, (r.h - padT - padB) / HZ)
  const left = r.x + (r.w - W * s) / 2, top = r.y + padT + (r.h - padT - padB - HZ * s) / 2
  const X = (u: number) => left + (u - e0) * s, Y = (z: number) => top + (H + SL - z) * 1000 * s
  const rect = (a: number, z0: number, b: number, z1: number) => [X(Math.min(a, b)), Y(Math.max(z0, z1)), Math.abs(b - a) * s, Math.abs(z1 - z0) * 1000 * s] as const
  // 序号锚点：构件露在取景段里的那部分的中间（露出来不到 60 mm 的不标）
  const anchors = new Map<string, [number, number]>()
  const pin = (id: string, a: number, b: number, z: number) => { const p = Math.max(a, v0), q = Math.min(b, v1); if (q - p >= 60) anchors.set(id, [X((p + q) / 2), Y(z)]) }
  const fin = resolveFinish(plan, { face }).material
  // 待确认的：淡紫斜纹 + 紫色虚线，和平面、界面同一个说法
  const elevPending = (a: number, z0: number, b: number, z1: number) => { ctx.save(); ctx.globalAlpha = 0.6; ctx.fillStyle = pattern(ctx, 'lav'); ctx.fillRect(...rect(a, z0, b, z1)); ctx.globalAlpha = 1; ctx.setLineDash([4, 3]); ctx.strokeStyle = K.lav; ctx.lineWidth = 1.1; ctx.strokeRect(...rect(a, z0, b, z1)); ctx.restore() }
  ctx.save(); ctx.beginPath(); ctx.rect(X(v0), Y(H + SL), (v1 - v0) * s, HZ * s); ctx.clip()
  // 墙面
  ctx.fillStyle = elevTone(fin.color, 0.02); ctx.fillRect(...rect(v0, 0, v1, H))
  for (const sf of m.surfaces) {
    if (sf.material.id === fin.id) continue
    ctx.beginPath(); for (const rings of sf.polygons) for (const ring of rings) { ring.forEach(([u, z], i) => i ? ctx.lineTo(X(u), Y(z)) : ctx.moveTo(X(u), Y(z))); ctx.closePath() }
    ctx.fillStyle = elevTone(sf.material.color, 0.02); ctx.fill('evenodd')
  }
  // 梁
  for (const b of m.beams) {
    if (b.kind === 'cross') { ctx.fillStyle = '#c9cdd3'; ctx.fillRect(...rect(b.u[0], b.bottom, b.u[1], H)) }
    else { ctx.setLineDash([5, 4]); ctx.strokeStyle = K.ink400; ctx.lineWidth = 0.9; ctx.strokeRect(...rect(b.u[0], b.bottom, b.u[1], H)); ctx.setLineDash([]) }
  }
  // 门窗
  for (const o of m.openings) { ctx.fillStyle = K.paper; ctx.fillRect(...rect(o.u[0], o.o.sill, o.u[1], o.o.head)); ctx.strokeStyle = K.ink500; ctx.lineWidth = 0.9; ctx.strokeRect(...rect(o.u[0], o.o.sill, o.u[1], o.o.head)) }
  // 壁龛
  for (const n of m.niches) { ctx.fillStyle = elevTone(materialOf(plan, n.r.back ?? fin.id).color, -0.08); ctx.fillRect(...rect(n.u[0], n.r.rect.z[0], n.u[1], n.r.rect.z[1])); ctx.strokeStyle = K.ink600; ctx.lineWidth = 0.8; ctx.strokeRect(...rect(n.u[0], n.r.rect.z[0], n.u[1], n.r.rect.z[1])); pin(n.r.id, n.u[0], n.u[1], (n.r.rect.z[0] + n.r.rect.z[1]) / 2) }
  // 造型
  for (const p of m.panels) {
    ctx.beginPath(); for (const rings of p.geo.visiblePolygons) for (const ring of rings) { ring.forEach(([u, z], i) => i ? ctx.lineTo(X(p.u0 + u), Y(z)) : ctx.moveTo(X(p.u0 + u), Y(z))); ctx.closePath() }
    ctx.fillStyle = elevTone(materialOf(plan, p.p.material).color); ctx.fill('evenodd'); ctx.strokeStyle = K.ink600; ctx.lineWidth = 0.9; ctx.stroke()
    for (const [a, b] of p.geo.grooves) { ctx.beginPath(); ctx.moveTo(X(p.u0 + a[0]), Y(a[1])); ctx.lineTo(X(p.u0 + b[0]), Y(b[1])); ctx.strokeStyle = 'rgba(22,25,30,0.18)'; ctx.lineWidth = 0.6; ctx.stroke() }
    if (p.p.status === 'pending') elevPending(p.u0 + p.geo.rect.u[0], p.geo.rect.z[0], p.u0 + p.geo.rect.u[1], p.geo.rect.z[1])
    pin(p.p.id, p.u0 + p.geo.rect.u[0], p.u0 + p.geo.rect.u[1], p.geo.rect.z[1] - 0.25)
    for (const h of decor.recesses.filter(x => 'panel' in x.host && x.host.panel === p.p.id && x.rect.u)) {
      ctx.fillStyle = elevTone(materialOf(plan, h.back ?? p.p.material).color, -0.1); ctx.fillRect(...rect(p.u0 + h.rect.u![0], h.rect.z[0], p.u0 + h.rect.u![1], h.rect.z[1])); ctx.strokeStyle = K.ink600; ctx.strokeRect(...rect(p.u0 + h.rect.u![0], h.rect.z[0], p.u0 + h.rect.u![1], h.rect.z[1]))
      // 挖洞的序号：洞的右上角（露出来时）
      const hr = p.u0 + h.rect.u![1]
      if (hr > v0 && hr <= v1) anchors.set(h.id, [X(hr), Y(h.rect.z[1])])
    }
  }
  // 柜子：柜身底色 + 门板 / 抽屉面（core 裁过的片）+ 开放格、挖洞深一档
  for (const c of m.cabinets) {
    const L = c.L, pl = c.c.plinth ?? 0
    ctx.fillStyle = elevTone(materialOf(plan, c.c.materials.carcass).color); ctx.fillRect(...rect(c.u0, c.c.z[0] + pl, c.u0 + c.c.width, c.c.z[1]))
    for (const cell of L.cells) if (cell.type === 'open' || cell.type === 'void') { ctx.fillStyle = cell.type === 'void' ? elevTone(fin.color, -0.06) : elevTone(materialOf(plan, c.c.materials.carcass).color, -0.1); ctx.fillRect(...rect(c.u0 + cell.u[0] + 18, cell.z[0] + 0.018, c.u0 + cell.u[1] - 18, cell.z[1] - 0.018)) }
    for (const p of L.parts) {
      if (p.kind === 'front') for (const pc of p.pieces) { ctx.fillStyle = elevTone(materialOf(plan, p.material ?? c.c.materials.front).color); ctx.fillRect(...rect(c.u0 + pc.u[0], pc.z[0], c.u0 + pc.u[1], pc.z[1])); ctx.strokeStyle = 'rgba(22,25,30,0.35)'; ctx.lineWidth = 0.6; ctx.strokeRect(...rect(c.u0 + pc.u[0], pc.z[0], c.u0 + pc.u[1], pc.z[1])) }
      if (p.kind === 'top') { ctx.fillStyle = elevTone(materialOf(plan, p.material).color, -0.05); ctx.fillRect(...rect(c.u0 + p.u[0], p.z[0], c.u0 + p.u[1], p.z[1] + 0.008)) }
      if (p.kind === 'appliance') { ctx.setLineDash([4, 3]); ctx.strokeStyle = K.ink500; ctx.lineWidth = 0.8; ctx.strokeRect(...rect(c.u0 + p.u[0], p.z[0], c.u0 + p.u[1], p.z[1])); ctx.setLineDash([]) }
    }
    ctx.strokeStyle = K.ink600; ctx.lineWidth = 1; ctx.strokeRect(...rect(c.u0, c.c.z[0] + pl, c.u0 + c.c.width, c.c.z[1]))
    if (c.c.status === 'pending') elevPending(c.u0, c.c.z[0], c.u0 + c.c.width, c.c.z[1])
    pin(c.c.id, c.u0, c.u0 + c.c.width, Math.min(c.c.z[1] - 0.25, (c.c.z[0] + c.c.z[1]) / 2 + 0.4))
  }
  // 洞里的家电（电视）
  for (const f of m.furniture) {
    if (isFlatFurniture(decor, f.f)) continue
    if (f.f.status === 'pending') elevPending(f.u[0], f.z[0], f.u[1], f.z[1])
    else if (f.f.type === 'tv' || f.held) { ctx.fillStyle = '#3b4048'; ctx.fillRect(...rect(f.u[0], f.z[0], f.u[1], f.z[1])) }
    else { ctx.setLineDash([4, 3]); ctx.strokeStyle = K.ink300; ctx.lineWidth = 0.8; ctx.strokeRect(...rect(f.u[0], f.z[0], f.u[1], f.z[1])); ctx.setLineDash([]) }
  }
  ctx.restore()
  // 墙面换材料的序号：露出来那部分的左上
  for (const sf of decor.surfaces) {
    if (!('face' in sf.target) || sf.target.face.wall !== face.wall || sf.target.face.side !== face.side) continue
    try {
      const ext = sf.target.s ?? faceExtent(plan, face), a = Math.min(m.ax.toU(ext[0]), m.ax.toU(ext[1])), b = Math.max(m.ax.toU(ext[0]), m.ax.toU(ext[1]))
      const p = Math.max(a, v0), q = Math.min(b, v1)
      if (q - p >= 60) anchors.set(sf.id, [Math.min(X(p) + 26, X((p + q) / 2)), Y(H - 0.3)])
    } catch { /* 墙不在了 */ }
  }
  // 楼板、顶板、两端剖到的墙；开敞的房间分界画一道虚线
  ctx.fillStyle = '#dfe2e6'; ctx.fillRect(...rect(e0, -SL, e1, 0)); ctx.fillRect(...rect(e0, H, e1, H + SL))
  for (const c of [v.l, v.r]) {
    if (!c) continue
    if (c.kind) { ctx.fillStyle = CUT_FILL[c.kind] ?? K.wallPart; ctx.fillRect(...rect(c.u[0], -SL, c.u[1], H + SL)) }
    else { ctx.setLineDash([4, 3]); ctx.strokeStyle = K.ink400; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(c.u[0]), Y(H + SL) - 4); ctx.lineTo(X(c.u[0]), Y(-SL) + 4); ctx.stroke(); ctx.setLineDash([]) }
  }
  // 尺寸：高度在图左侧外面；宽度在图下面，覆盖整段取景、标这段的真实宽
  vdim(ctx, X(e0) - 14, Y(0), Y(H), `${H.toFixed(2)} m`, { side: 'left' })
  const yb = Y(-SL) + 16, xa = X(v0), xb = X(v1)
  ctx.save()
  ctx.strokeStyle = K.ink300; ctx.lineWidth = 0.7
  ctx.beginPath(); ctx.moveTo(xa, Y(-SL) + 3); ctx.lineTo(xa, yb + 5); ctx.moveTo(xb, Y(-SL) + 3); ctx.lineTo(xb, yb + 5); ctx.stroke()
  ctx.strokeStyle = K.ink500; ctx.lineWidth = 0.9
  ctx.beginPath(); ctx.moveTo(xa, yb); ctx.lineTo(xb, yb); ctx.moveTo(xa - 3, yb + 3); ctx.lineTo(xa + 3, yb - 3); ctx.moveTo(xb - 3, yb + 3); ctx.lineTo(xb + 3, yb - 3); ctx.stroke()
  ctx.restore()
  const wl = `${((v1 - v0) / 1000).toFixed(2)} m`, ww = chip(ctx, 0, 0, wl, { size: 10.5, h: 20, dry: true })
  chip(ctx, (xa + xb) / 2 - ww / 2, yb - 10, wl, { fill: K.paper, stroke: K.ink200, color: K.ink700, size: 10.5, h: 20 })
  const lbl = faceLabel(plan, face), partial = v0 > m.u[0] + 10 || v1 < m.u[1] - 10
  const room = roomId ? plan.rooms.find(x => x.id === roomId) : undefined
  return {
    anchor: id => anchors.get(id) ?? null,
    label: `${partial ? `${room?.name ?? lbl.room} · ${lbl.dir}墙（这一段）` : lbl.title} · ${lbl.look}`,
    bounds: { x: X(e0), y: Y(H + SL), w: W * s, h: HZ * s },
  }
}

/** 平面局部的取景：房间（连本页构件）外扩一圈；外圈后半段淡到白，框外留白 */
const RING = 1000, RING_SOLID = 550
function fadeEdges(ctx: Ctx, r: Rect, band: number) {
  const sides: [number, number, number, number, number, number, number, number][] = [
    [r.x, r.y, r.x + band, r.y, r.x, r.y, band, r.h],
    [r.x + r.w, r.y, r.x + r.w - band, r.y, r.x + r.w - band, r.y, band, r.h],
    [r.x, r.y, r.x, r.y + band, r.x, r.y, r.w, band],
    [r.x, r.y + r.h, r.x, r.y + r.h - band, r.x, r.y + r.h - band, r.w, band],
  ]
  for (const [ox, oy, ix, iy, x, y, w, h] of sides) {
    const g = ctx.createLinearGradient(ox, oy, ix, iy)
    g.addColorStop(0, K.paper); g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g; ctx.fillRect(x, y, w, h)
  }
}

function header(ctx: Ctx, doc: ExportDoc, title: string) {
  const mark = (x: number, y: number, sz: number) => {
    rrect(ctx, x, y, sz, sz, 8); ctx.fillStyle = '#efe3d2'; ctx.fill()
    text(ctx, '装', x + sz / 2, y + sz / 2 + 4.7, { size: 13, weight: 600, color: '#6b5338', align: 'center' })
  }
  // 页眉右边：口吻
  const right = { ...T.caption, weight: 600, color: K.ink700 }
  pageHead(ctx, { mark, kicker: `${doc.base.title} · ${doc.t.docName} · ${S.title}`, title, rightW: measure(ctx, S.disclaimer, right) })
  lines(ctx, [S.disclaimer], PAGE.w - PAGE.margin, HEAD_RIGHT_Y - right.lh / 2, right, 'right')
}

/* ───────── 右栏文字：和结构页同一套（textflow） ───────── */
const WARN: Tok = { ...T.caption, weight: 600, color: '#7a6510' }
const PENDING: Tok = { ...T.caption, weight: 700, color: K.lav }
/** 一项拆成块：标题 + 几行事实一块，原话和提示一块 */
function itemAtoms(ctx: Ctx, it: DecorExportItem, tw: number): Atom[] {
  const head: Run[] = [{ kind: 'text', tok: T.title, lines: wrap(ctx, it.title, tw, T.title), gap: 0 }]
  // 待确认：明确写出来，和已确认的分开读
  if (it.status === 'pending') head.push({ kind: 'text', tok: PENDING, lines: wrap(ctx, S.pendingItem, tw, PENDING), gap: 2 })
  it.lines.forEach((ln, i) => head.push({ kind: 'text', tok: T.body, lines: wrap(ctx, ln, tw, T.body), gap: i ? 0 : 4 }))
  const rest: Run[] = []
  if (it.note) rest.push({ kind: 'text', tok: T.body, lines: wrap(ctx, it.note, tw - BAR, T.body), gap: 0, bar: it.by === 'agent' ? K.lav : K.ink300, indent: BAR })
  if (it.orphan) rest.push({ kind: 'text', tok: WARN, lines: wrap(ctx, '墙在改造里拆掉了，这一项现在没地方挂（先留着，画在原来的位置）', tw, WARN), gap: 6 })
  if (it.protect) rest.push(alertRun(ctx, it.protect, tw, 8))
  return rest.length ? [{ runs: head }, { runs: rest }] : [{ runs: head }]
}
const proRect = (): Rect => ({ x: BODY.x + span(7) + GUTTER, y: BODY.y, w: BODY.w - span(7) - GUTTER, h: BODY.h - 48 })
const sheetCol = (ds: DecorSheet): Rect => (ds.kind === 'decor-pro' ? proRect() : DETAIL.col)

/** 量真实文字排右栏；放不下就接下一张同样的页（decor-room、decor-pro），其余页原样 */
export function flowDecorSheet(ctx: Ctx, doc: ExportDoc, ds: DecorSheet): DecorSheet[] {
  if (!ds.items || (ds.kind !== 'decor-room' && ds.kind !== 'decor-pro')) return [ds]
  const r = sheetCol(ds), leadStr = ds.kind === 'decor-pro' ? ['下面这几处在方案里是承重墙或外墙。这里只写事实，能不能做、能挖多深，要专业人员到现场确认。'] : ds.part?.[0] === 1 ? [`风格：${doc.decor?.style}`, ...(ds.block?.lines ?? [])] : []
  const lead: Run[] = leadStr.map(l => ({ kind: 'text', tok: T.strong, lines: wrap(ctx, l, r.w, T.strong), gap: 0 }))
  const cols = flow(ds.items.map(it => ({ item: it, number: it.number, atoms: itemAtoms(ctx, it, r.w - GUTTER_L) })), lead, r.h)
  return cols.map((col, i) => ({ ...ds, col, items: col.blocks.map(b => b.item), part: ds.kind === 'decor-pro' ? (cols.length > 1 ? [i + 1, cols.length] : undefined) : ds.part }))
}
/** 拆页之后，同一间房的几页重新编「第几 / 共几」 */
export function renumberDecorParts(sheets: DecorSheet[]) {
  const by = new Map<DecorRoomBlock, DecorSheet[]>()
  for (const s of sheets) if (s.kind === 'decor-room' && s.block) by.set(s.block, [...(by.get(s.block) ?? []), s])
  for (const list of by.values()) list.forEach((s, i) => { s.part = [i + 1, list.length] })
}
const circles = (ms: { x: number; y: number }[]): Circle[] => ms.map(m => ({ c: [m.x, m.y], r: BADGE.d / 2 + 3 }))
function placeBadges(ctx: Ctx, items: BadgeIn[], bounds: Rect, out: { n: number | string; x: number; y: number }[][]) {
  const lay = layoutBadges(items, bounds, MIN_GAP_PX, BADGE.d / 2)
  for (const p of lay.placed) badge(ctx, p.x, p.y, p.n, { anchor: p.anchor, d: BADGE.d })
  out.push(lay.placed.map(p => ({ n: p.n, x: p.x, y: p.y })))
  return lay
}

export interface DecorRendered { canvas: HTMLCanvasElement; title: string; badges: { n: number | string; x: number; y: number }[][]; regions?: boolean; facts?: SheetFacts }
type Foot = (ctx: Ctx, index: number, extra?: string) => void

export function renderDecorSheet(doc: ExportDoc, part: DecorPart, sheet: DecorSheet, index: number, footer: Foot): DecorRendered {
  if (sheet.kind === 'decor-overview') return overview(doc, part, index, footer)
  if (sheet.kind === 'decor-room') return roomSheet(doc, part, sheet, index, footer)
  if (sheet.kind === 'decor-materials') return materials(doc, part, index, footer)
  return proSheet(doc, part, sheet, index, footer)
}

function overview(doc: ExportDoc, part: DecorPart, index: number, footer: Foot): DecorRendered {
  const { canvas, ctx } = newPage()
  header(ctx, doc, '装修总览')
  const imgW = span(8), badges: DecorRendered['badges'] = []
  const bb = planBounds(part.plan) ?? [0, 0, 1, 1]
  const key = doc.t.roomKey
  const itemMarks = (x: Xf): BadgeIn[] => part.items.map(it => ({ n: it.number, anchor: x.P(it.anchor) as [number, number] }))
  // 序号推不开就只标房间（和结构总览同一个规则）
  const crowded = (x: Xf, r: Rect) => { const l = layoutBadges(itemMarks(x), r, MIN_GAP_PX, BADGE.d / 2); return !l.ok || l.maxShift > 46 }
  const roomMarks = (x: Xf): BadgeIn[] => part.blocks.flatMap(b => {
    const rm = part.plan.rooms.find(q => q.id === b.room); if (!rm) return []
    const p = x.P(labelPoint(rm.poly))
    return [{ n: `${b.items[0]?.number ?? ''}–${b.items.at(-1)?.number ?? ''}`, anchor: [p[0], p[1] - 22] as [number, number] }]
  })
  const r0 = inner(BODY.x, BODY.y, imgW, BODY.h)
  const fitted = fitPlans(ctx, [{
    plan: part.plan, area: strip => ({ ...r0, h: r0.h - strip }), fit: rr => fitFrame(frameFor(bb, rr, 500), rr),
    avoid: (x, rr) => circles(layoutBadges(crowded(x, rr) ? roomMarks(x) : itemMarks(x), rr, MIN_GAP_PX, BADGE.d / 2).placed),
  }], key), f = fitted[0]
  panel(ctx, BODY.x, BODY.y, imgW, BODY.h, `风格 · ${part.style}`, { tone: 'ink', right: '地面铺样色；柜子、造型、墙面换色标序号' })
  drawDecorPlan(ctx, part, f.x, f.r)
  drawRoomLabels(ctx, f.labels, 'normal')
  const regions = crowded(f.x, f.r)
  placeBadges(ctx, regions ? roomMarks(f.x) : itemMarks(f.x), f.r, badges)
  drawPlanLegends(ctx, fitted, key)
  // 右栏：每间房一行。房间多时先把说明压成一行，再不够就只留房间名
  const col = DETAIL.col, free = part.decor.furniture.filter(x => !x.in).length
  const whatOf = (b: DecorRoomBlock) => [...b.lines.map(l => l.replace(/（.*）/, '')), ...b.items.map(i => i.title)].join('、')
  const waiting = pendingCount(part.decor)
  const foot = wrap(ctx, `家具 ${free} 件不编号，尺寸见「用到的材料 · 家具尺寸」页。${waiting ? `其中 ${waiting} 条还没确认：图上淡紫斜纹，右栏写着「待确认」。` : ''}`, col.w, T.caption)
  const room = col.h - 28 - foot.length * T.caption.lh - 12
  const rowsAt = (n: number) => part.blocks.map(b => { const w = n ? clampLines(ctx, whatOf(b), col.w, T.caption, n) : []; return { b, w, h: T.strong.lh + w.length * T.caption.lh + 13 } })
  const rows = [2, 1, 0].map(rowsAt).find(rs => rs.reduce((a, q) => a + q.h, 0) <= room) ?? rowsAt(0)
  let y = lines(ctx, ['按房间'], col.x, col.y, T.h2) + 8
  for (const { b, w, h } of rows) {
    const nums = b.items.length ? (b.items.length > 1 ? `${b.items[0].number}–${b.items.at(-1)!.number}` : `${b.items[0].number}`) : ''
    lines(ctx, [b.name], col.x, y + 6, T.strong)
    lines(ctx, [`${nums}${b.items[0]?.page ? ` · 见第 ${b.items[0].page} 页` : ''}`], col.x + col.w, y + 7.5, T.caption, 'right')
    lines(ctx, w, col.x, y + 6 + T.strong.lh, T.caption)
    y += h
    ctx.fillStyle = K.ink100; ctx.fillRect(col.x, y - 1, col.w, 1)
  }
  lines(ctx, foot, col.x, y + 12, T.caption)
  footer(ctx, index)
  return { canvas, title: '装修总览', badges, regions, facts: factsOf(fitted) }
}

function roomSheet(doc: ExportDoc, part: DecorPart, sheet: DecorSheet, index: number, footer: Foot): DecorRendered {
  const { canvas, ctx } = newPage()
  const b = sheet.block!, items = sheet.items!
  header(ctx, doc, `${b.name}${sheet.part && sheet.part[1] > 1 ? `（${sheet.part[0]} / ${sheet.part[1]}）` : ''}`)
  const { img } = DETAIL, gap = 16, badges: DecorRendered['badges'] = []
  const strong = new Set(items.map(i => i.id))
  const elevItems = b.face ? items.filter(i => i.face && i.face.wall === b.face!.wall && i.face.side === b.face!.side) : []
  const twoViews = !!b.face && elevItems.length > 0
  const planH = twoViews ? Math.round((img.h - gap) * 0.48) : img.h
  // 平面局部：这间房（连本页构件）外扩一圈（RING），外圈后半段淡到白，框里其余留白；名字只写在没淡掉的那部分里
  const room = part.plan.rooms.find(r => r.id === b.room)
  const fb = room ? boxOf([...room.poly, ...items.flatMap(i => [[i.bbox[0], i.bbox[1]], [i.bbox[2], i.bbox[3]]] as Vec2[])]) : boxOf(items.flatMap(i => [[i.bbox[0], i.bbox[1]], [i.bbox[2], i.bbox[3]]] as Vec2[]))
  const win: Box = [fb[0] - RING, fb[1] - RING, fb[2] + RING, fb[3] + RING]
  const winRect = (x: Xf): Rect => { const A = x.P([win[0], win[1]]), B = x.P([win[2], win[3]]); return { x: A[0], y: A[1], w: B[0] - A[0], h: B[1] - A[1] } }
  const solidRect = (x: Xf): Rect => { const w = winRect(x), band = (RING - RING_SOLID) * x.s; return { x: w.x + band, y: w.y + band, w: w.w - 2 * band, h: w.h - 2 * band } }
  const marksOf = (x: Xf): BadgeIn[] => items.map(it => ({ n: it.number, anchor: x.P(it.anchor) as [number, number] }))
  const r0 = inner(img.x, img.y, img.w, planH)
  const slot: PlanSlot = {
    plan: part.plan, area: strip => ({ ...r0, h: r0.h - strip }), fit: rr => fitFrame(win, rr), clip: solidRect,
    avoid: x => circles(layoutBadges(marksOf(x), winRect(x), MIN_GAP_PX, BADGE.d / 2).placed),
  }
  const fitted = fitPlans(ctx, [slot], doc.t.roomKey), f = fitted[0]
  panel(ctx, img.x, img.y, img.w, planH, '平面局部', { tone: 'ink', right: '剖切 1.1 m 往下看' })
  const wr = winRect(f.x)
  drawDecorPlan(ctx, part, f.x, wr, { strong })
  fadeEdges(ctx, wr, (RING - RING_SOLID) * f.x.s)
  drawRoomLabels(ctx, f.labels, 'normal')
  placeBadges(ctx, marksOf(f.x), wr, badges)
  drawPlanLegends(ctx, fitted, doc.t.roomKey)
  // 立面：这间房里挂东西最多的那面墙
  if (twoViews) {
    const ey = img.y + planH + gap, eh = img.h - planH - gap
    panel(ctx, img.x, ey, img.w, eh, '立面', { tone: 'plain' })
    const er = inner(img.x, ey, img.w, eh)
    const e = drawDecorElevation(ctx, part, doc.base, b.face!, er, b.room, strong)
    if (e) {
      lines(ctx, [e.label], img.x + img.w - 16, ey + 13, T.caption, 'right')
      // 本页每一项只要在立面取景段里露出来就标（序号限在图里，不压尺寸）
      const pins = items.map(it => ({ n: it.number, anchor: e.anchor(it.id) })).filter(p => p.anchor) as BadgeIn[]
      placeBadges(ctx, pins, e.bounds, badges)
    }
  }
  const col = DETAIL.col, textBottom = drawCol(ctx, sheet.col!, col.x, col.y, col.w, doc.t.continued)
  footer(ctx, index)
  return { canvas, title: b.name, badges, facts: { ...factsOf(fitted), textBottom, textLimit: col.y + col.h } }
}

function materials(doc: ExportDoc, part: DecorPart, index: number, footer: Foot): DecorRendered {
  const { canvas, ctx } = newPage()
  header(ctx, doc, '用到的材料 · 家具尺寸')
  const leftW = span(7), pad = PANEL_PAD.x
  let q: ReturnType<typeof materialTakeoff> = []
  try { q = materialTakeoff(part.plan).filter(m => m.area > 0.05 || m.count) } catch { q = [] }
  q.sort((a, b) => b.area - a.area)
  panel(ctx, BODY.x, BODY.y, leftW, BODY.h, '材料', { tone: 'ink', right: S.rough })
  const waiting = pendingCount(part.decor)
  const note = wrap(ctx, `${waiting ? `另有 ${waiting} 条待确认未计入。` : ''}面积按各片真实面积扣掉门窗洞、造型遮挡算的，不含损耗；只用来对量级，不是用料或报价。品牌、色号自己记。`, leftW - 2 * pad, T.caption)
  const noteH = note.length * T.caption.lh, listTop = BODY.y + PANEL_PAD.top + 4, listH = BODY.h - PANEL_PAD.top - 4 - noteH - PANEL_PAD.bottom - 12
  // 「用在哪」放得下就写全；地方不够先压成每条一行，再不够只留小色块 + 名字 + 面积，不叠字
  const swatch = 28, tx0 = BODY.x + pad + swatch + 12, whereW = BODY.x + leftW - pad - tx0 - 100
  const rowsAt = (maxLines: number) => q.map(m => { const w = maxLines ? clampLines(ctx, m.where.join('、'), whereW, T.caption, maxLines) : []; return { m, w, h: T.strong.lh + w.length * T.caption.lh + 16 } })
  const rows = [99, 1, 0].map(rowsAt).find(rs => rs.reduce((a, r) => a + r.h, 0) <= listH) ?? rowsAt(0)
  const squeeze = Math.min(1, listH / Math.max(1, rows.reduce((a, r) => a + r.h, 0)))
  let y = listTop
  for (const { m, w, h } of rows) {
    const rowH = h * squeeze, right = BODY.x + leftW - pad, cy = y + (rowH - 1) / 2, sw = Math.min(swatch, rowH - 8)
    rrect(ctx, BODY.x + pad + (swatch - sw) / 2, cy - sw / 2, sw, sw, 8); ctx.fillStyle = m.material.color; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 1; ctx.stroke()
    const amount = m.area > 0.05 ? `约 ${m.area.toFixed(1)} ㎡` : `${m.count} 组柜子`
    const top = cy - (T.strong.lh + w.length * T.caption.lh) / 2
    lines(ctx, [m.material.name], tx0, top, T.strong)
    lines(ctx, w, tx0, top + T.strong.lh, T.caption)
    lines(ctx, [amount], right, cy - T.strong.lh / 2, { ...T.strong, family: NUM }, 'right')
    y += rowH
    ctx.fillStyle = K.ink100; ctx.fillRect(tx0, y - 1, right - tx0, 1)
  }
  lines(ctx, note, BODY.x + pad, BODY.y + BODY.h - PANEL_PAD.bottom - noteH, T.caption)
  // 家具尺寸表：三列，数字右对齐
  const cx = BODY.x + leftW + GUTTER, cw = BODY.w - leftW - GUTTER
  panel(ctx, cx, BODY.y, cw, BODY.h, '家具尺寸', { tone: 'plain' })
  const fs = part.decor.furniture.filter(f => !isFlatFurniture(part.decor, f))
  const c1 = cx + cw - pad, c0 = c1 - 44, rowF = 26, top = BODY.y + PANEL_PAD.top + 4
  const fit = Math.max(1, Math.floor((BODY.h - PANEL_PAD.top - 4 - PANEL_PAD.bottom - 20 - T.caption.lh) / rowF))
  lines(ctx, ['名称'], cx + pad, top, T.caption)
  lines(ctx, ['宽 × 深 mm'], c0, top, T.caption, 'right')
  lines(ctx, ['高 m'], c1, top, T.caption, 'right')
  y = top + 20
  ctx.fillStyle = K.ink200; ctx.fillRect(cx + pad, y - 1, cw - 2 * pad, 1)
  const num: Tok = { ...T.body, weight: 500, family: NUM }
  for (const f of fs.slice(0, fit)) {
    const name = f.status === 'pending' ? `${furnitureName(part.decor, f)} · 待确认` : furnitureName(part.decor, f)
    const size = `${mm(f.size[0])} × ${mm(f.size[1])}`
    lines(ctx, clampLines(ctx, `${name}${f.in ? '（放在洞里）' : ''}`, c0 - measure(ctx, size, num) - 12 - cx - pad, T.body, 1), cx + pad, y + (rowF - T.body.lh) / 2, T.body)
    lines(ctx, [size], c0, y + (rowF - T.body.lh) / 2, num, 'right')
    lines(ctx, [f.height.toFixed(2)], c1, y + (rowF - T.body.lh) / 2, num, 'right')
    y += rowF
    ctx.fillStyle = K.ink100; ctx.fillRect(cx + pad, y - 1, cw - 2 * pad, 1)
  }
  if (fs.length > fit) lines(ctx, [`还有 ${fs.length - fit} 件，见工具里的家具清单`], cx + pad, y + 4, T.caption)
  footer(ctx, index)
  return { canvas, title: '用到的材料', badges: [] }
}

function proSheet(doc: ExportDoc, part: DecorPart, sheet: DecorSheet, index: number, footer: Foot): DecorRendered {
  const { canvas, ctx } = newPage()
  header(ctx, doc, `需要专业确认 · 装修${sheet.part && sheet.part[1] > 1 ? `（${sheet.part[0]} / ${sheet.part[1]}）` : ''}`)
  const items = sheet.items!, badges: DecorRendered['badges'] = []
  const imgW = span(7), ph = BODY.h - 48
  const bb = planBounds(part.plan) ?? [0, 0, 1, 1]
  const marksOf = (x: Xf): BadgeIn[] => items.map(it => ({ n: it.number, anchor: x.P(it.anchor) as [number, number] }))
  const r0 = inner(BODY.x, BODY.y, imgW, ph)
  const fitted = fitPlans(ctx, [{
    plan: part.plan, area: strip => ({ ...r0, h: r0.h - strip }), fit: rr => fitFrame(frameFor(bb, rr, 500), rr),
    avoid: (x, rr) => circles(layoutBadges(marksOf(x), rr, MIN_GAP_PX, BADGE.d / 2).placed),
  }], doc.t.roomKey), f = fitted[0]
  panel(ctx, BODY.x, BODY.y, imgW, ph, '位置', { tone: 'ink', right: '受保护的墙上的嵌入、挖洞' })
  drawDecorPlan(ctx, part, f.x, f.r, { strong: new Set(items.map(i => i.id)) })
  drawRoomLabels(ctx, f.labels, 'normal')
  placeBadges(ctx, marksOf(f.x), f.r, badges)
  drawPlanLegends(ctx, fitted, doc.t.roomKey)
  const col = proRect(), textBottom = drawCol(ctx, sheet.col!, col.x, col.y, col.w, doc.t.continued)
  // 内容区最下面一条：墙里可能有水电管线
  const fy = BODY.y + BODY.h - 32
  rrect(ctx, BODY.x, fy, BODY.w, 32, 8); ctx.fillStyle = K.ink50; ctx.fill(); ctx.strokeStyle = K.ink200; ctx.lineWidth = 1; ctx.stroke()
  lockIcon(ctx, BODY.x + 16, fy + 16, 0.95)
  lines(ctx, [S.pipes], BODY.x + 30, fy + (32 - T.strong.lh) / 2, T.strong)
  footer(ctx, index)
  return { canvas, title: '需要专业确认', badges, facts: { ...factsOf(fitted), textBottom, textLimit: col.y + col.h } }
}

export const DECOR_STRINGS = S
