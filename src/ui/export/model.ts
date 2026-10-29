/**
 * 改造清单导出的数据：core changeFocus → paginate 拆页，每个关注条目（同 group 合一条）配上
 * 「想怎么改」（core describeChange）、业主原话、状态、谁提的、受保护提示。
 * 这里不画任何东西，只决定有哪些页、每页讲哪几条。
 */
import type { Change, Plan, Vec2, Wall, WallKind } from '@/core/types'
import { applyChanges, describeChange, type ChangeResult } from '@/core/changes'
import { changeFocus, paginate, type Focus, type FocusView, type Page } from '@/core/pagination'
import { planBounds, roomsBesideWall } from '@/core/geometry'
import { levelsOf } from '@/core/levels'
import { exportStrings, fill, type ExportStrings } from './strings'
import { buildDecorPart, type DecorPart, type DecorSheet, type DecorSheetKind } from './decor'
import type { Lang } from '../i18n'

/** A4 横版，按 CSS 像素排（1 px = 297/1123 mm），画布按 2 倍像素 */
export const PAGE = { w: 1123, h: 794, scale: 2, margin: 40 } as const
export const MM_PER_PX = 297 / PAGE.w
/** 内容区：页眉下、页脚上 */
export const BODY = { x: PAGE.margin, y: 112, w: PAGE.w - 2 * PAGE.margin, h: 794 - 112 - 66 } as const
/** 细节页：左图右文 */
export const DETAIL = { img: { x: BODY.x, y: BODY.y, w: 716, h: BODY.h }, col: { x: BODY.x + 716 + 24, y: BODY.y, w: BODY.w - 716 - 24, h: BODY.h } } as const
/** 图框里的留白：上方放「改之前 / 改之后」标签 */
export const PANEL_PAD = { x: 14, top: 40, bottom: 14 } as const
/** 序号圆的直径（px）和两两最小间距（纸面 10mm，和 core paginate 默认一致） */
export const BADGE = { d: 24, minGapMm: 10 } as const
export const MIN_GAP_PX = BADGE.minGapMm / MM_PER_PX
export const MAX_ITEMS = 5

export type Layout = 'side' | 'stack'
export type ProtectKind = 'bearing' | 'exterior' | 'column'

export interface ItemLine {
  change: Change
  what: string
  note?: string
  delta: string[]
}
export interface ExportItem {
  number: number
  focus: Focus
  view: FocusView
  lines: ItemLine[]
  /** 总览页的一句话 */
  short: string
  by: 'user' | 'agent' | 'mixed'
  status: 'pending' | 'confirmed'
  protect: ProtectKind[]
  /** 没叠到改造后的图上的原因（要二次确认 / 出错） */
  notApplied?: string
  /** 这条在哪一页细讲（PDF 页码，从 1 起） */
  page: number
}
export type SheetKind = 'cover' | 'overview' | 'original' | 'detail' | DecorSheetKind
export interface Sheet { kind: SheetKind; page?: Page; items?: ExportItem[]; decor?: DecorSheet }
/** decor：包含「装修想法」一节（有装修层时默认开） */
/** structure = 「结构改造」一节（D6 B8：全局导出里和「装修想法」分别勾选；默认开） */
export interface ExportOptions { original: boolean; threeD: boolean; decor?: boolean; structure?: boolean }
export interface ExportDoc {
  base: Plan
  after: Plan
  results: ChangeResult[]
  items: ExportItem[]
  pages: Page[]
  /** 传给 core paginate 的参数（e2e 用它独立复算页数） */
  paginateOpts: Record<string, number>
  sheets: Sheet[]
  layout: Layout
  opts: ExportOptions
  lang: Lang
  t: ExportStrings
  generatedAt: Date
  stats: { bearing: number; exterior: number; column: number; user: number; agent: number; pending: number; confirmed: number }
  /** 装修想法一节（没有装修层或关掉时为 null） */
  decor: DecorPart | null
}

const COLL: Record<string, string> = { wall: 'walls', opening: 'openings', beam: 'beams', room: 'rooms', column: 'columns', shaft: 'shafts', stair: 'stairs', void: 'voids' }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const listOf = (plan: Plan, type: string): any[] => ((plan as unknown as Record<string, unknown[]>)[COLL[type]] ?? []) as any[]
export const findIn = (plan: Plan, type: string, id?: string) => (id ? listOf(plan, type).find(e => e.id === id) : undefined)
export const changeElementId = (c: Change) => c.target ?? (c.data as { id?: string } | undefined)?.id

const KIND_ZH: Record<string, string> = { exterior: '外墙', bearing: '承重墙', partition: '非承重墙', glass: '玻璃隔断', half: '矮墙', 'half-glass': '矮墙 + 玻璃', door: '平开门', sliding: '推拉门', doorway: '门洞', window: '窗', 'floor-window': '落地窗', 'bay-window': '飘窗', 'open-balcony': '未封阳台', rect: '方柱', round: '圆柱', decorative: '装饰柱' }

/** 墙在界面上叫什么：有名字用名字，没有就用两侧房间 */
export function wallName(plan: Plan, w: Wall | undefined): string {
  if (!w) return '墙'
  if (w.name) return w.name
  try {
    const s = roomsBesideWall(plan, w.id), names = [...new Set([...s.positive, ...s.negative].map(r => r.name))]
    if (names.length > 1) return `${names.join('与')}之间的${KIND_ZH[w.kind] ?? '墙'}`
    if (names.length) return `${names[0]}旁的${KIND_ZH[w.kind] ?? '墙'}`
  } catch { /* 楼层视图里找不到也没关系 */ }
  return KIND_ZH[w.kind] ?? '墙'
}

/** core describeChange + 把构件 id 换成墙名（「在 w-d 开…」读起来像代码） */
function describe(base: Plan, state: Plan, c: Change): string {
  let s: string
  try { s = describeChange(base, c) } catch { s = '' }
  if (!s || /目标不存在|未知构件/.test(s)) {
    const verb = { add: '新增', remove: '拆除', update: '修改' }[c.op]
    const el = findIn(state, c.type, changeElementId(c)) ?? c.data
    s = `${verb} ${el?.name ?? KIND_ZH[el?.kind] ?? c.type}`
  }
  if (c.type === 'opening') {
    const host = (c.data as { wall?: string } | undefined)?.wall ?? findIn(state, 'opening', c.target)?.wall
    if (host) s = s.replace(new RegExp(`在 ${host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} 开`), `在${wallName(state, findIn(state, 'wall', host))}开`)
    if (c.op !== 'add') { const o = findIn(state, 'opening', c.target); if (o?.name && !s.includes(o.name)) s += `「${o.name}」` }
  }
  // 「次卧南墙非承重墙（3.3m）」→「次卧南墙（非承重墙，3.3m）」；名字里已经带了类型就不重复
  if (c.type === 'wall') {
    const w = (findIn(state, 'wall', c.target) ?? c.data) as Wall | undefined
    const kn = w && CORE_KIND[w.kind]
    if (w?.name && kn && s.includes(`${w.name}${kn}（`)) s = s.replace(`${w.name}${kn}（`, w.name.endsWith(kn) || w.name.endsWith(kn.slice(-2)) ? `${w.name}（` : `${w.name}（${kn}，`)
  }
  if (c.type === 'room') s = s.replace(/房间$/, '')
  if (c.type === 'beam') s = s.replace(/横梁横梁$/, '横梁')
  return s.replace(/\s+/g, ' ').trim()
}
const CORE_KIND: Record<string, string> = { exterior: '外墙', bearing: '承重墙', partition: '非承重墙', glass: '玻璃隔断', half: '矮墙', 'half-glass': '半墙玻璃' }

const fm = (v: unknown) => typeof v === 'number' ? `${v.toFixed(2)}\u00a0m` : String(v)
const fmm = (v: unknown) => typeof v === 'number' ? `${Math.round(v)}\u00a0mm` : String(v)
/** 修改了哪些字段：「洞顶 2.20 → 2.40 m」 */
function deltas(old: Record<string, unknown> | undefined, c: Change): string[] {
  if (c.op !== 'update' || !c.data) return []
  const out: string[] = []
  const d = c.data
  const pair = (label: string, k: string, f: (v: unknown) => string, dflt?: unknown) => {
    if (!(k in d)) return
    const a = old?.[k] ?? dflt
    out.push(a === undefined ? `${label} ${f(d[k])}` : `${label} ${f(a)}\u00a0→ ${f(d[k])}`)
  }
  pair('类型', 'kind', v => KIND_ZH[String(v)] ?? String(v))
  pair('名称', 'name', v => String(v))
  pair('用途', 'use', v => String(v))
  pair('厚度', 'thickness', fmm)
  pair('宽', 'width', fmm)
  pair('离地', 'sill', fm)
  pair('洞顶', 'head', fm)
  pair('层高', 'ceiling', fm)
  pair('地面高差', 'floorOffset', fm, 0)
  pair('梁底', 'bottom', fm)
  pair('墙高', 'height', fm)
  pair('实体高度', 'lowHeight', fm, 1)
  if ('offset' in d) out.push('沿墙挪了位置')
  if ('a' in d || 'b' in d) out.push('墙的位置或长度变了')
  if ('bulge' in d) out.push(Number(d.bulge) ? '改成弧形' : '改回直墙')
  if ('poly' in d) out.push('房间轮廓变了')
  if ('swing' in d) out.push('换了开门方向')
  if ('panes' in d) out.push('换了分扇')
  return out
}

/** 这条改造碰到的墙在图上标成什么（只陈述图上的标注） */
function protectOf(state: Plan, c: Change): ProtectKind | null {
  let wallKind: WallKind | undefined
  if (c.type === 'wall') wallKind = (findIn(state, 'wall', c.target) as Wall | undefined)?.kind ?? (c.op === 'add' ? undefined : undefined)
  else if (c.type === 'opening') {
    const host = (c.data as { wall?: string } | undefined)?.wall ?? findIn(state, 'opening', c.target)?.wall
    wallKind = (findIn(state, 'wall', host) as Wall | undefined)?.kind
  } else if (c.type === 'column') {
    const col = findIn(state, 'column', c.target) ?? c.data
    if (col?.kind === 'bearing' && c.op !== 'add') return 'column'
  }
  if (c.type === 'wall' && c.op === 'add') return null
  return wallKind === 'bearing' ? 'bearing' : wallKind === 'exterior' ? 'exterior' : null
}

/** 按顺序在私有副本上推进几何（只为取「改之前」的字段值和受保护判断），不做校验 */
function advance(state: Plan, c: Change) {
  const list = listOf(state, c.type)
  if (!(COLL[c.type] in state)) (state as unknown as Record<string, unknown[]>)[COLL[c.type]] = list
  if (c.op === 'add' && c.data) list.push(structuredClone(c.data))
  else if (c.op === 'update') { const i = list.findIndex(e => e.id === c.target); if (i >= 0) list[i] = { ...list[i], ...structuredClone(c.data ?? {}) } }
  else if (c.op === 'remove' && !c.range) { const i = list.findIndex(e => e.id === c.target); if (i >= 0) list.splice(i, 1) }
}

export function chooseLayout(plan: Plan): Layout {
  const bb = planBounds(plan)
  if (!bb) return 'side'
  return (bb[2] - bb[0]) / Math.max(1, bb[3] - bb[1]) > 1.55 ? 'stack' : 'side'
}
/** 细节页平面对比里一张图的可画区域（px） */
export function planImageRect(layout: Layout) {
  const { img } = DETAIL, gap = 16
  const pw = layout === 'side' ? (img.w - gap) / 2 : img.w, ph = layout === 'side' ? img.h : (img.h - gap) / 2
  return { w: pw - 2 * PANEL_PAD.x, h: ph - PANEL_PAD.top - PANEL_PAD.bottom }
}

export function buildDoc(base: Plan, opts: ExportOptions, lang: Lang = 'zh', now = new Date()): ExportDoc {
  const t = exportStrings[lang]
  const changes = base.changes
  const { results } = applyChanges(base, changes)
  // 图上按「我的想法」画：要二次确认的条目也先叠上去（状态和说明里写清楚还没确认），否则改之后的图和改之前一样
  const after = applyChanges(base, changes.map(c => c.confirm ? c : { ...c, confirm: { by: '预览' } })).plan
  const focuses = changeFocus(base, changes)
  const layout = chooseLayout(base)
  const r = planImageRect(layout)
  const paginateOpts = { aspectRatio: r.w / r.h, pageWidthMm: r.w * MM_PER_PX, minNumberSpacing: BADGE.minGapMm, maxItems: MAX_ITEMS, margin: 600 }
  const pages = paginate(focuses, paginateOpts)
  // 每条改造之前的状态（取旧值、判断受保护）
  const before = new Map<string, Plan>()
  const state = structuredClone(base)
  for (const c of changes) { before.set(c.id, structuredClone(state)); advance(state, c) }
  const byId = new Map(changes.map(c => [c.id, c]))
  const numberOf = new Map<string, number>()
  pages.forEach(p => p.items.forEach(i => numberOf.set(i.changeId, i.number)))
  const firstSheet = 2 + (opts.original ? 1 : 0) // 封面、总览、（原始结构）之后
  const pageOf = new Map<string, number>()
  pages.forEach((p, i) => p.items.forEach(it => pageOf.set(it.changeId, firstSheet + i + 1)))
  const items: ExportItem[] = focuses.map((f): ExportItem => {
    const cs = f.changeIds.map(id => byId.get(id)!).filter(Boolean)
    const lines: ItemLine[] = cs.map(c => {
      const st = before.get(c.id) ?? base
      return { change: c, what: describe(base, st, c), note: c.note?.trim() || undefined, delta: deltas(findIn(st, c.type, c.target), c) }
    })
    const protect = [...new Set(cs.map(c => protectOf(before.get(c.id) ?? base, c)).filter(Boolean) as ProtectKind[])]
    const rs = cs.map(c => results.find(x => x.id === c.id)).filter(Boolean) as ChangeResult[]
    const confirm = rs.find(x => x.needsConfirm), bad = rs.find(x => !x.ok && !x.needsConfirm)
    const bys = new Set(cs.map(c => c.by))
    return {
      number: numberOf.get(f.changeId) ?? 0, focus: f, view: f.view, lines,
      short: lines[0]?.note ?? lines[0]?.what ?? '',
      by: bys.size > 1 ? 'mixed' : (cs[0]?.by ?? 'user'),
      status: cs.some(c => c.status === 'pending') ? 'pending' : 'confirmed',
      protect,
      notApplied: confirm ? t.notAppliedConfirm : bad ? fill(t.notApplied, { e: bad.error ?? '' }) : undefined,
      page: pageOf.get(f.changeId) ?? 0,
    }
  }).sort((a, b) => a.number - b.number)
  const itemOf = new Map(items.map(i => [i.focus.changeId, i]))
  // 只导「装修想法」时（structure === false）：结构的总览、原始结构、逐条改造页都不出，装修序号从 1 起
  const withStructure = opts.structure !== false
  const sheets: Sheet[] = [{ kind: 'cover' }, ...(withStructure && changes.length ? [{ kind: 'overview' as const }] : []), ...(withStructure && opts.original ? [{ kind: 'original' as const }] : []),
    ...(withStructure ? pages.map(p => ({ kind: 'detail' as const, page: p, items: p.items.map(i => itemOf.get(i.changeId)!).filter(Boolean) })) : [])]
  // 装修想法：接在结构改造后面，序号全局一套
  let decor: DecorPart | null = null
  if (opts.decor !== false && base.decor) {
    try { decor = buildDecorPart(after, base, withStructure ? Math.max(0, ...items.map(i => i.number)) + 1 : 1, sheets.length + 1) } catch (e) { console.warn('decor export', e); decor = null }
    if (decor) sheets.push(...decor.sheets.map(ds => ({ kind: ds.kind, decor: ds })))
  }
  const stats = {
    bearing: items.filter(i => i.protect.includes('bearing')).length,
    exterior: items.filter(i => i.protect.includes('exterior')).length,
    column: items.filter(i => i.protect.includes('column')).length,
    user: changes.filter(c => c.by === 'user').length,
    agent: changes.filter(c => c.by === 'agent').length,
    pending: changes.filter(c => c.status === 'pending').length,
    confirmed: changes.filter(c => c.status !== 'pending').length,
  }
  return { base, after, results, items, pages, paginateOpts, sheets, layout, opts, lang, t, generatedAt: now, stats, decor }
}

/** 楼层名（多层方案才显示） */
export function levelName(plan: Plan, id: string): string | null {
  const ls = levelsOf(plan)
  if (ls.length < 2) return null
  return ls.find(l => l.id === id)?.name ?? id
}

export const pad2 = (n: number) => String(n).padStart(2, '0')
export const stamp = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
export const ymd = (d: Date) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
export function fileName(doc: ExportDoc): string {
  const title = (doc.base.title || '方案').replace(/\s*·\s*/g, '·').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || '方案'
  return `${title}-${doc.t.fileSuffix}-${ymd(doc.generatedAt)}.pdf`
}
export type { Vec2 }
