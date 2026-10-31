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
import { K, NUM, badge, chip, lockIcon, newPage, panel, para, pattern, rrect, text, vdim, type Ctx } from './canvas'
import { boxOf, drawPlan, fitFrame, frameFor, polyPath, type Rect, type Xf } from './plan-draw'
import { layoutBadges, type BadgeIn } from './badges'
import { BADGE, BODY, DETAIL, MIN_GAP_PX, PAGE, PANEL_PAD, type ExportDoc } from './model'

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
export interface DecorSheet { kind: DecorSheetKind; block?: DecorRoomBlock; items?: DecorExportItem[]; part?: [number, number] }
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
function drawDecorPlan(ctx: Ctx, part: DecorPart, x: Xf, r: Rect, o: { strong?: Set<string>; labels?: boolean; labelWithin?: Rect } = {}) {
  const { plan, decor } = part
  const fills = new Map(plan.rooms.map(rm => { try { return [rm.id, planTone(resolveFinish(plan, { floor: rm.id }, { room: rm }).material.color, 0.012)] as const } catch { return [rm.id, K.paper] as const } }))
  drawPlan(ctx, plan, x, r, { tone: 'normal', labels: o.labels !== false, floorFill: id => fills.get(id), labelWithin: o.labelWithin })
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
  text(ctx, `${doc.base.title} · ${doc.t.docName} · ${S.title}`, PAGE.margin + 36, 52, { size: 11.5, weight: 600, color: K.ink500 })
  rrect(ctx, PAGE.margin, 40, 26, 26, 8); ctx.fillStyle = '#efe3d2'; ctx.fill()
  text(ctx, '装', PAGE.margin + 13, 58, { size: 13, weight: 700, color: '#6b5338', align: 'center' })
  text(ctx, title, PAGE.margin + 36, 80, { size: 22, weight: 650, color: K.ink, letter: -0.2 })
  ctx.fillStyle = K.ink100; ctx.fillRect(PAGE.margin, 98, PAGE.w - 2 * PAGE.margin, 1)
  // 页眉右边：口吻
  text(ctx, S.disclaimer, PAGE.w - PAGE.margin, 80, { size: 11.5, weight: 650, color: K.ink700, align: 'right' })
}

/** 右栏一项：序号 + 标题 + 几行事实 + 原话 + 受保护事实 */
function itemBlock(ctx: Ctx, it: DecorExportItem, x: number, y: number, w: number, size: number, dry: boolean): number {
  const tx = x + 34, tw = w - 34
  if (!dry) badge(ctx, x + 12, y + 10, it.number, { d: 24 })
  let yy = y + 4 + size * 0.95
  yy = para(ctx, it.title, tx, yy, tw, size * 1.4, { size: size + 0.5, weight: 650, color: K.ink }, 2, dry).y
  // 待确认：明确写出来，和已确认的分开读
  if (it.status === 'pending') yy = para(ctx, S.pendingItem, tx, yy, tw, size * 1.4, { size: size - 1, weight: 700, color: K.lav }, 2, dry).y
  for (const ln of it.lines) yy = para(ctx, ln, tx, yy, tw, size * 1.4, { size: size - 1, weight: 500, color: K.ink700 }, 3, dry).y
  if (it.note) {
    const top = yy - size + 2
    const r = para(ctx, `「${it.note}」`, tx + 10, yy + 2, tw - 10, size * 1.45, { size: size - 1, weight: 450, color: K.ink700 }, 3, dry)
    if (!dry) { ctx.fillStyle = it.by === 'agent' ? K.lav : K.ink300; ctx.fillRect(tx, top, 2.5, r.y - top - size * 0.5) }
    yy = r.y + 2
  }
  if (it.orphan) yy = para(ctx, '墙在改造里拆掉了，这一项现在没地方挂（先留着，画在原来的位置）', tx, yy, tw, size * 1.4, { size: size - 1.5, weight: 600, color: '#7a6510' }, 2, dry).y
  if (it.protect) {
    const h = para(ctx, it.protect, tx + 24, 0, tw - 32, size * 1.4, { size: size - 1.5, weight: 600 }, 3, true).lines * size * 1.4 + 12
    if (!dry) {
      rrect(ctx, tx, yy - 4, tw, h, 9); ctx.fillStyle = K.ink50; ctx.fill(); ctx.strokeStyle = K.ink300; ctx.lineWidth = 1; ctx.stroke()
      lockIcon(ctx, tx + 12, yy + 2 + size * 0.6, 0.9)
      para(ctx, it.protect, tx + 24, yy + 2 + size * 0.95, tw - 32, size * 1.4, { size: size - 1.5, weight: 600, color: K.ink800 }, 3)
    }
    yy += h + 2
  }
  return yy - y
}
function column(ctx: Ctx, items: DecorExportItem[], r: Rect, lead: string[] = []) {
  let size = 13
  const height = (sz: number) => lead.length * sz * 1.5 + (lead.length ? 10 : 0) + items.reduce((a, it) => a + itemBlock(ctx, it, r.x, 0, r.w, sz, true) + 12, 0)
  while (size > 10 && height(size) > r.h) size -= 0.5
  let y = r.y
  for (const ln of lead) { y = para(ctx, ln, r.x, y + size, r.w, size * 1.45, { size: size - 0.5, weight: 600, color: K.ink800 }, 2).y - size * 0.6 }
  if (lead.length) { y += 6; ctx.fillStyle = K.ink100; ctx.fillRect(r.x, y, r.w, 1); y += 8 }
  for (const [i, it] of items.entries()) {
    const h = itemBlock(ctx, it, r.x, y, r.w, size, true)
    if (y + h > r.y + r.h + 6) { text(ctx, '……', r.x + 34, y + 12, { size: 12, color: K.ink500 }); break }
    itemBlock(ctx, it, r.x, y, r.w, size, false)
    y += h + 12
    if (i < items.length - 1) { ctx.fillStyle = K.ink100; ctx.fillRect(r.x + 34, y - 7, r.w - 34, 1) }
  }
}
function placeBadges(ctx: Ctx, items: BadgeIn[], bounds: Rect, out: { n: number | string; x: number; y: number }[][]) {
  const lay = layoutBadges(items, bounds, MIN_GAP_PX, BADGE.d / 2)
  for (const p of lay.placed) badge(ctx, p.x, p.y, p.n, { anchor: p.anchor, d: BADGE.d })
  out.push(lay.placed.map(p => ({ n: p.n, x: p.x, y: p.y })))
  return lay
}

export interface DecorRendered { canvas: HTMLCanvasElement; title: string; badges: { n: number | string; x: number; y: number }[][]; regions?: boolean }
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
  const imgW = 690, badges: DecorRendered['badges'] = []
  panel(ctx, BODY.x, BODY.y, imgW, BODY.h, `风格 · ${part.style}`, { tone: 'ink', right: '地面铺样色；柜子、造型、墙面换色标序号' })
  const r = inner(BODY.x, BODY.y, imgW, BODY.h)
  const bb = planBounds(part.plan) ?? [0, 0, 1, 1]
  const x = fitFrame(frameFor(bb, r, 500), r)
  drawDecorPlan(ctx, part, x, r)
  // 序号推不开就只标房间（和结构总览同一个规则）
  const trial = layoutBadges(part.items.map(it => ({ n: it.number, anchor: x.P(it.anchor) })), r, MIN_GAP_PX, BADGE.d / 2)
  const regions = !trial.ok || trial.maxShift > 46
  if (!regions) placeBadges(ctx, part.items.map(it => ({ n: it.number, anchor: x.P(it.anchor) as [number, number] })), r, badges)
  else {
    const marks: BadgeIn[] = []
    for (const b of part.blocks) {
      const rm = part.plan.rooms.find(q => q.id === b.room); if (!rm) continue
      const p = x.P(labelPoint(rm.poly))
      marks.push({ n: `${b.items[0]?.number ?? ''}–${b.items.at(-1)?.number ?? ''}`, anchor: [p[0], p[1] - 22] })
    }
    placeBadges(ctx, marks, r, badges)
  }
  // 右栏：每间房一行
  const cx = BODY.x + imgW + 22, cw = BODY.w - imgW - 22
  let y = BODY.y + 18
  text(ctx, '按房间', cx, y, { size: 13, weight: 650, color: K.ink }); y += 10
  for (const b of part.blocks) {
    y += 14
    text(ctx, b.name, cx, y + 4, { size: 12.5, weight: 650, color: K.ink800 })
    const nums = b.items.length ? (b.items.length > 1 ? `${b.items[0].number}–${b.items.at(-1)!.number}` : `${b.items[0].number}`) : ''
    text(ctx, `${nums}${b.items[0]?.page ? ` · 见第 ${b.items[0].page} 页` : ''}`, cx + cw, y + 4, { size: 10.5, weight: 600, color: K.ink500, align: 'right' })
    const what = [...b.lines.map(l => l.replace(/（.*）/, '')), ...b.items.map(i => i.title)].join('、')
    y = para(ctx, what, cx, y + 22, cw, 16, { size: 11, weight: 500, color: K.ink600 }, 2).y - 6
    ctx.fillStyle = K.ink100; ctx.fillRect(cx, y + 4, cw, 1)
  }
  y += 22
  const free = part.decor.furniture.filter(f => !f.in).length
  y = para(ctx, `家具 ${free} 件不编号，尺寸见「用到的材料 · 家具尺寸」页。`, cx, y, cw, 16, { size: 11, weight: 500, color: K.ink500 }, 2).y
  const waiting = pendingCount(part.decor)
  if (waiting) para(ctx, `其中 ${waiting} 条是 Agent 提议，还没确认：图上淡紫斜纹，右栏写着「待确认」。`, cx, y + 4, cw, 16, { size: 11, weight: 700, color: K.lav }, 3)
  footer(ctx, index)
  return { canvas, title: '装修总览', badges, regions }
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
  // 平面局部：这间房（连本页构件）外扩一圈（RING），外圈后半段淡到白，框里其余留白；取景边上的半截房间名不写
  panel(ctx, img.x, img.y, img.w, planH, '平面局部', { tone: 'ink', right: '剖切 1.1 m 往下看' })
  const pr = inner(img.x, img.y, img.w, planH)
  const room = part.plan.rooms.find(r => r.id === b.room)
  const fb = room ? boxOf([...room.poly, ...items.flatMap(i => [[i.bbox[0], i.bbox[1]], [i.bbox[2], i.bbox[3]]] as Vec2[])]) : boxOf(items.flatMap(i => [[i.bbox[0], i.bbox[1]], [i.bbox[2], i.bbox[3]]] as Vec2[]))
  const win: Box = [fb[0] - RING, fb[1] - RING, fb[2] + RING, fb[3] + RING]
  const x = fitFrame(win, pr)
  const A = x.P([win[0], win[1]]), B = x.P([win[2], win[3]]), wr: Rect = { x: A[0], y: A[1], w: B[0] - A[0], h: B[1] - A[1] }
  const band = (RING - RING_SOLID) * x.s, solid: Rect = { x: wr.x + band, y: wr.y + band, w: wr.w - 2 * band, h: wr.h - 2 * band }
  drawDecorPlan(ctx, part, x, wr, { strong, labelWithin: solid })
  fadeEdges(ctx, wr, band)
  placeBadges(ctx, items.map(it => ({ n: it.number, anchor: x.P(it.anchor) as [number, number] })), wr, badges)
  // 立面：这间房里挂东西最多的那面墙
  if (twoViews) {
    const ey = img.y + planH + gap, eh = img.h - planH - gap
    panel(ctx, img.x, ey, img.w, eh, '立面', { tone: 'plain' })
    const er = inner(img.x, ey, img.w, eh)
    const e = drawDecorElevation(ctx, part, doc.base, b.face!, er, b.room, strong)
    if (e) {
      text(ctx, e.label, img.x + img.w - 14, ey + 26, { size: 10.5, weight: 600, color: K.ink500, align: 'right' })
      // 本页每一项只要在立面取景段里露出来就标（序号限在图里，不压尺寸）
      const pins = items.map(it => ({ n: it.number, anchor: e.anchor(it.id) })).filter(p => p.anchor) as BadgeIn[]
      placeBadges(ctx, pins, e.bounds, badges)
    }
  }
  column(ctx, items, DETAIL.col, sheet.part?.[0] === 1 ? [`风格：${part.style}`, ...b.lines] : [])
  footer(ctx, index)
  return { canvas, title: b.name, badges }
}

function materials(doc: ExportDoc, part: DecorPart, index: number, footer: Foot): DecorRendered {
  const { canvas, ctx } = newPage()
  header(ctx, doc, '用到的材料 · 家具尺寸')
  const leftW = 620
  let q: ReturnType<typeof materialTakeoff> = []
  try { q = materialTakeoff(part.plan).filter(m => m.area > 0.05 || m.count) } catch { q = [] }
  q.sort((a, b) => b.area - a.area)
  panel(ctx, BODY.x, BODY.y, leftW, BODY.h, '材料', { tone: 'ink', right: S.rough })
  const rowH = Math.min(48, (BODY.h - 60) / Math.max(1, q.length))
  let y = BODY.y + 50
  for (const m of q) {
    rrect(ctx, BODY.x + 16, y, 30, 30, 9); ctx.fillStyle = m.material.color; ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 1; ctx.stroke()
    text(ctx, m.material.name, BODY.x + 58, y + 13, { size: 12.5, weight: 650, color: K.ink800 })
    para(ctx, m.where.join('、'), BODY.x + 58, y + 29, leftW - 58 - 130, 14, { size: 10.5, weight: 500, color: K.ink500 }, 1)
    const right = m.area > 0.05 ? `约 ${m.area.toFixed(1)} ㎡` : `${m.count} 组柜子`
    text(ctx, right, BODY.x + leftW - 16, y + 20, { size: 12.5, weight: 650, family: NUM, color: K.ink800, align: 'right' })
    y += rowH
    ctx.fillStyle = K.ink100; ctx.fillRect(BODY.x + 58, y - 8, leftW - 74, 1)
  }
  // 粗估只算已确认的（core materialTakeoff 走 confirmedDecor，和 Agent 那边的 decor 命令一致）
  const waiting = pendingCount(part.decor)
  if (waiting) text(ctx, `另有 ${waiting} 条待确认未计入`, BODY.x + 16, BODY.y + BODY.h - 34, { size: 11, weight: 700, color: K.lav })
  para(ctx, '面积按各片真实面积扣掉门窗洞、造型遮挡算的，不含损耗；只用来对量级，不是用料或报价。品牌、色号自己记。', BODY.x + 16, BODY.y + BODY.h - 26, leftW - 32, 15, { size: 10.5, weight: 500, color: K.ink500 }, 2)
  // 家具尺寸表
  const cx = BODY.x + leftW + 18, cw = BODY.w - leftW - 18
  panel(ctx, cx, BODY.y, cw, BODY.h, '家具尺寸', { tone: 'plain', right: '宽 × 深 mm · 高 m' })
  const fs = part.decor.furniture.filter(f => !isFlatFurniture(part.decor, f))
  const fh = Math.min(30, (BODY.h - 60) / Math.max(1, fs.length))
  y = BODY.y + 52
  for (const f of fs) {
    const name = furnitureName(part.decor, f)
    text(ctx, f.status === 'pending' ? `${name} · 待确认` : name, cx + 16, y, { size: Math.min(12, fh * 0.48), weight: 600, color: f.status === 'pending' ? K.lav : K.ink800 })
    text(ctx, `${mm(f.size[0])} × ${mm(f.size[1])} · ${f.height.toFixed(2)}${f.in ? ' · 放在洞里' : ''}`, cx + cw - 16, y, { size: Math.min(11.5, fh * 0.46), weight: 600, family: NUM, color: K.ink600, align: 'right' })
    y += fh
  }
  footer(ctx, index)
  return { canvas, title: '用到的材料', badges: [] }
}

function proSheet(doc: ExportDoc, part: DecorPart, sheet: DecorSheet, index: number, footer: Foot): DecorRendered {
  const { canvas, ctx } = newPage()
  header(ctx, doc, '需要专业确认 · 装修')
  const items = sheet.items!, badges: DecorRendered['badges'] = []
  const imgW = 600
  panel(ctx, BODY.x, BODY.y, imgW, BODY.h - 40, '位置', { tone: 'ink', right: '受保护的墙上的嵌入、挖洞' })
  const r = inner(BODY.x, BODY.y, imgW, BODY.h - 40)
  const bb = planBounds(part.plan) ?? [0, 0, 1, 1]
  const x = fitFrame(frameFor(bb, r, 500), r)
  drawDecorPlan(ctx, part, x, r, { strong: new Set(items.map(i => i.id)) })
  placeBadges(ctx, items.map(it => ({ n: it.number, anchor: x.P(it.anchor) as [number, number] })), r, badges)
  column(ctx, items, { x: BODY.x + imgW + 24, y: BODY.y, w: BODY.w - imgW - 24, h: BODY.h - 40 }, ['下面这几处在方案里是承重墙或外墙。这里只写事实，能不能做、能挖多深，要专业人员到现场确认。'])
  // 页脚上方一行：墙里可能有水电管线
  const fy = BODY.y + BODY.h - 26
  rrect(ctx, BODY.x, fy - 14, BODY.w, 32, 10); ctx.fillStyle = K.ink50; ctx.fill(); ctx.strokeStyle = K.ink300; ctx.lineWidth = 1; ctx.stroke()
  lockIcon(ctx, BODY.x + 18, fy + 2, 0.95)
  text(ctx, S.pipes, BODY.x + 32, fy + 6, { size: 12.5, weight: 650, color: K.ink800 })
  footer(ctx, index, S.pipes)
  return { canvas, title: '需要专业确认', badges }
}

export const DECOR_STRINGS = S
