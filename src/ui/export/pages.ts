/**
 * 每一页的排版：封面、总览、（原始结构）、细节页（平面前后对比 / 墙立面 / 3D 白模 + 剖面）。
 * 每页整页画在一张 A4 横版画布上（2 倍像素），再放进 PDF。中文不用嵌字体。
 * 版式：12 栏栅格（model.ts）、固定字阶（canvas.ts 的 T）、右栏文字流（textflow.ts）、房间名和图例（room-labels.ts）。
 * 每页记下图上序号的位置（页面 px），e2e 用它断言两两间距。
 */
import type { Box, Plan, Vec2, Wall } from '@/core/types'
import { effectiveWallHeight, labelPoint, planBounds, roomCeiling, wallLength, roomsBesideWall, projectToWall, pointInPolygon } from '@/core/geometry'
import { levelsOf, onLevel } from '@/core/levels'
import type { SnapshotRenderer } from '@/three/snapshot'
import { BADGE, BODY, DETAIL, GUTTER, MIN_GAP_PX, PAGE, PANEL_PAD, levelName, span, stamp, wallName, findIn, type ExportDoc, type ExportItem, type Sheet } from './model'
import { HEAD_RIGHT_Y, K, NUM, T, badge, chip, clampLines, lines, lockIcon, measure, newPage, pageHead, panel, para, pattern, rrect, text, wrap, type Ctx, type Tok } from './canvas'
import { boxOf, computeMarks, drawMarks, drawPlan, fitFrame, frameFor, highlightWall, outlinePoly, type Mark, type Rect, type Xf } from './plan-draw'
import { drawBeamElevation, drawRoomSection, drawWallElevation, elevScale, type ElevMark } from './elev-draw'
import { layoutBadges, type BadgeIn } from './badges'
import { fill } from './strings'
import { DECOR_STRINGS, flowDecorSheet, renumberDecorParts, renderDecorSheet } from './decor'
import { drawPlanLegends, drawRoomLabels, factsOf, fitPlans, type Circle, type PlanSlot, type SharedLegend, type SheetFacts } from './room-labels'
import { BAR, GUTTER_L, alertRun, drawCol, flow, type Atom, type Run } from './textflow'

export interface RenderedSheet { canvas: HTMLCanvasElement; kind: Sheet['kind']; title: string; badges: { n: number | string; x: number; y: number }[][]; regions?: boolean; facts?: SheetFacts; part?: [number, number] }
export interface RenderCtx { doc: ExportDoc; snap: SnapshotRenderer | null; restore: Plan | null; marks: Mark[]; total: number }

export function makeRenderCtx(doc: ExportDoc, snap: SnapshotRenderer | null, restore: Plan | null): RenderCtx {
  return { doc, snap, restore, marks: computeMarks(doc.base, doc.base.changes), total: doc.sheets.length }
}

/* ───────── 页眉页脚 ───────── */
function appMark(ctx: Ctx, x: number, y: number, s: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(s / 64, s / 64)
  ctx.translate(32, 29.15)
  ctx.scale(0.91, 0.91)
  ctx.fillStyle = '#d3d7dd'; ctx.fill(new Path2D('M0 0L25.98 15L0 30L-25.98 15Z'))
  ctx.fillStyle = '#b3b8c0'; ctx.fill(new Path2D('M0 0L-25.98 15L-25.98 3L0 -12Z'))
  ctx.fillStyle = '#6c727c'; ctx.fill(new Path2D('M-30.74 12.25L-25.98 15L-25.98 3L-30.74 0.25Z'))
  ctx.fillStyle = '#16191e'; ctx.fill(new Path2D('M0 -17.5L4.76 -14.75L-25.98 3L-30.74 0.25Z'))
  ctx.fillStyle = '#b3b8c0'; ctx.fill(new Path2D('M4.76 -2.75L30.74 12.25L25.98 15L0 0Z'))
  ctx.fillStyle = '#f8c08f'; ctx.fill(new Path2D('M0 -9L25.98 6L25.98 -6L0 -21Z'))
  ctx.fillStyle = '#c96a26'; ctx.fill(new Path2D('M30.74 3.25L25.98 6L25.98 -6L30.74 -8.75Z'))
  ctx.fillStyle = '#e8863f'; ctx.fill(new Path2D('M4.76 -23.75L30.74 -8.75L25.98 -6L0 -21Z'))
  ctx.restore()
}
function header(ctx: Ctx, rc: RenderCtx, title: string, o: { legend?: boolean; proposal?: boolean } = {}) {
  const { doc } = rc
  const items = o.legend ? legendItems(ctx, rc, o.proposal) : []
  pageHead(ctx, { mark: (x, y, s) => appMark(ctx, x, y, s), kicker: `${doc.base.title} · ${doc.t.docName}`, title, rightW: legendWidth(ctx, items) })
  if (items.length) legend(ctx, items, PAGE.w - PAGE.margin, HEAD_RIGHT_Y)
}
function footer(ctx: Ctx, rc: RenderCtx, index: number, note?: string) {
  const { doc } = rc, t = doc.t, y = PAGE.h - 42
  ctx.fillStyle = K.ink100; ctx.fillRect(PAGE.margin, y - 8, PAGE.w - 2 * PAGE.margin, 1)
  const left = note ?? t.coverDisclaimer
  if (left) lines(ctx, [left], PAGE.margin, y, T.micro)
  lines(ctx, [`${fill(t.generated, { t: stamp(doc.generatedAt) })}   ${fill(t.pageOf, { i: index + 1, n: rc.total })}`], PAGE.w - PAGE.margin, y, T.micro, 'right')
}

/* ───────── 图例 ───────── */
type LegendItem = [string, (x: number, y: number) => void]
const LEGEND_FONT: Tok = { ...T.caption, color: K.ink700 }
function legendItems(ctx: Ctx, rc: RenderCtx, withProposal = false): LegendItem[] {
  const t = rc.doc.t
  const items: LegendItem[] = [
    [t.legendRemove, (x, y) => { rrect(ctx, x, y - 6, 26, 12, 3); ctx.fillStyle = pattern(ctx, 'coral'); ctx.fill(); ctx.setLineDash([3.5, 2.2]); ctx.strokeStyle = K.coral; ctx.lineWidth = 1.4; ctx.stroke(); ctx.setLineDash([]) }],
    [t.legendAdd, (x, y) => { rrect(ctx, x, y - 6, 26, 12, 3); ctx.fillStyle = K.cobalt; ctx.fill() }],
    [t.legendModify, (x, y) => { rrect(ctx, x + 1, y - 5, 24, 10, 3); ctx.strokeStyle = K.cobalt; ctx.lineWidth = 2; ctx.stroke() }],
  ]
  if (withProposal) items.push([t.legendBefore, (x, y) => { rrect(ctx, x, y - 6, 26, 12, 3); ctx.fillStyle = '#c1c5cb'; ctx.fill() }])
  return items
}
const legendWidth = (ctx: Ctx, items: LegendItem[]) => items.reduce((a, [label], i) => a + (i ? 16 : 0) + 26 + 6 + measure(ctx, label, LEGEND_FONT), 0)
function legend(ctx: Ctx, items: LegendItem[], xRight: number, y: number) {
  let x = xRight - legendWidth(ctx, items)
  for (const [label, sw] of items) {
    sw(x, y)
    lines(ctx, [label], x + 32, y - LEGEND_FONT.lh / 2, LEGEND_FONT)
    x += 26 + 6 + measure(ctx, label, LEGEND_FONT) + 16
  }
}

/* ───────── 条目文字（右栏） ───────── */
const DELTA: Tok = { size: 11, lh: 16, weight: 500, color: K.cobaltDeep }
const CHIP = { size: 10.5, h: 18, weight: 500 }
function statusChips(it: ExportItem, t: ExportDoc['t'], gap: number): Run {
  const pending = it.status === 'pending'
  const byLabel = it.by === 'agent' ? t.byAgent : it.by === 'mixed' ? `${t.byUser} + ${t.byAgent}` : t.byUser
  return { kind: 'custom', h: CHIP.h, gap, draw(c, x, y) {
    const w = chip(c, x, y, pending ? t.statusPending : t.statusConfirmed, {
      ...CHIP, fill: pending ? K.paper : K.ink50, stroke: pending ? K.ink500 : K.ink200, dashed: pending, color: K.ink800,
      icon: (ix, iy) => {
        c.save(); c.strokeStyle = K.ink800; c.lineWidth = 1.2
        if (pending) { c.beginPath(); c.arc(ix, iy, 3.2, 0, Math.PI * 2); c.stroke() }
        else { c.beginPath(); c.moveTo(ix - 3.2, iy); c.lineTo(ix - 0.8, iy + 2.6); c.lineTo(ix + 3.6, iy - 2.8); c.stroke() }
        c.restore()
      },
    })
    chip(c, x + w + 6, y, byLabel, { ...CHIP, fill: it.by === 'user' ? K.paper : K.lavTint, stroke: it.by === 'user' ? K.ink200 : undefined, color: it.by === 'user' ? K.ink700 : '#4a33b8' })
  } }
}
/** 一条改造拆成几块：每处改动（标题 + 说明 + 变化）一块，状态和提示跟在最后一块后面 */
function itemAtoms(ctx: Ctx, doc: ExportDoc, it: ExportItem, tw: number): Atom[] {
  const t = doc.t
  const atoms: Atom[] = it.lines.map(ln => {
    const runs: Run[] = [{ kind: 'text', tok: T.title, lines: wrap(ctx, ln.what, tw, T.title), gap: 0 }]
    if (ln.note) runs.push({ kind: 'text', tok: T.body, lines: wrap(ctx, ln.note, tw - BAR, T.body), gap: 4, bar: it.by === 'agent' ? K.lav : K.ink300, indent: BAR })
    ln.delta.forEach((d, i) => runs.push({ kind: 'text', tok: DELTA, lines: wrap(ctx, d, tw, DELTA), gap: i ? 0 : 4 }))
    return { runs }
  })
  if (!atoms.length) atoms.push({ runs: [] })
  const last = atoms[atoms.length - 1].runs
  last.push(statusChips(it, t, last.length ? 8 : 0))
  for (const p of it.protect) last.push(alertRun(ctx, p === 'bearing' ? t.protectedBearing : p === 'exterior' ? t.protectedExterior : '这根柱在图上标为承重柱，改动需要专业确认', tw, 8))
  if (it.notApplied) last.push({ kind: 'text', tok: T.caption, lines: wrap(ctx, it.notApplied, tw, T.caption), gap: 6 })
  return atoms
}

const KEY_PLAN_H = 170
/** 这一页右栏的文字区：立面页上面有钥匙图 */
function colRect(sheet: Sheet): Rect {
  const c = DETAIL.col
  return sheet.page?.view === 'elevation' ? { x: c.x, y: c.y + KEY_PLAN_H + 16, w: c.w, h: c.h - KEY_PLAN_H - 16 } : c
}
function drawSheetCol(ctx: Ctx, rc: RenderCtx, sheet: Sheet): Pick<SheetFacts, 'textBottom' | 'textLimit'> {
  const r = colRect(sheet)
  return { textBottom: drawCol(ctx, sheet.col!, r.x, r.y, r.w, rc.doc.t.continued), textLimit: r.y + r.h }
}
const partLabel = (p?: [number, number]) => (p ? `（${p[0]} / ${p[1]}）` : '')

/* ───────── 总览目录（序号 + 一句话 + 在第几页） ───────── */
const LIST_PAD = 6, LIST_HEAD = 28
const listMetaW = (ctx: Ctx, doc: ExportDoc) => measure(ctx, `${doc.t.view.elevation} · ${fill(doc.t.overviewSee, { p: 99 })}`, T.caption)
function listRow(ctx: Ctx, doc: ExportDoc, it: ExportItem, w: number, maxLines: number) {
  const ls = clampLines(ctx, it.short, w - 30 - listMetaW(ctx, doc) - 12 - 14, { ...T.body, weight: 500 }, maxLines)
  return { ls, h: ls.length * T.body.lh + LIST_PAD * 2 + 1 }
}
const listH = (ctx: Ctx, doc: ExportDoc, items: ExportItem[], w: number, maxLines: number) => items.reduce((a, it) => a + listRow(ctx, doc, it, w, maxLines).h, 0)
function drawList(ctx: Ctx, rc: RenderCtx, items: ExportItem[], r: Rect, maxLines: number) {
  const { doc } = rc, t = doc.t
  let y = r.y
  items.forEach((it, i) => {
    const { ls, h } = listRow(ctx, doc, it, r.w, maxLines), top = y + LIST_PAD
    // 列表里的序号用白底墨圈，和图上的墨底序号区分（列表不是图）
    badge(ctx, r.x + 10, top + T.body.lh / 2, it.number, { d: 20, tone: 'white' })
    lines(ctx, ls, r.x + 30, top, { ...T.body, weight: 500, color: K.ink800 })
    const tag = `${t.view[it.view]} · ${fill(t.overviewSee, { p: it.page })}`
    lines(ctx, [tag], r.x + r.w, top + 1.5, T.caption, 'right')
    if (it.protect.length) lockIcon(ctx, r.x + r.w - measure(ctx, tag, T.caption) - 11, top + T.body.lh / 2, 0.8, K.ink600)
    if (i < items.length - 1) { ctx.fillStyle = K.ink100; ctx.fillRect(r.x + 30, y + h - 1, r.w - 30, 1) }
    y += h
  })
}

/**
 * 量真实文字，排好右栏；放不下的接到下一张同样的页（图也再画一遍，只标这一张讲的序号）。
 * 总览目录放不下时先压成每条一行，再不够就接一页纯目录。
 */
export function flowSheets(doc: ExportDoc) {
  const ctx = document.createElement('canvas').getContext('2d')!
  const out: Sheet[] = []
  for (const sheet of doc.sheets) {
    if (sheet.kind === 'detail' && sheet.items) {
      const r = colRect(sheet)
      const cols = flow(sheet.items.map(it => ({ item: it, number: it.number, atoms: itemAtoms(ctx, doc, it, r.w - GUTTER_L) })), [], r.h)
      cols.forEach((col, i) => out.push({ ...sheet, col, items: col.blocks.map(b => b.item), part: cols.length > 1 ? [i + 1, cols.length] : undefined }))
    } else if (sheet.kind === 'overview') {
      const w = DETAIL.col.w, h = DETAIL.col.h - LIST_HEAD
      if (listH(ctx, doc, doc.items, w, 2) <= h) { out.push({ ...sheet, list: doc.items, listLines: 2 }); continue }
      let n = 0, used = 0
      for (const it of doc.items) { used += listRow(ctx, doc, it, w, 1).h; if (used > h) break; n++ }
      out.push({ ...sheet, list: doc.items.slice(0, n), listLines: 1 })
      for (let i = n; i < doc.items.length;) {
        const list: ExportItem[] = []
        for (let c = 0; c < 3 && i < doc.items.length; c++) {
          used = 0
          while (i < doc.items.length && used + listRow(ctx, doc, doc.items[i], w, 2).h <= BODY.h) { used += listRow(ctx, doc, doc.items[i], w, 2).h; list.push(doc.items[i++]) }
        }
        out.push({ kind: 'overview-list', list, listLines: 2 })
      }
    } else if (sheet.decor) out.push(...flowDecorSheet(ctx, doc, sheet.decor).map(d => ({ kind: d.kind, decor: d })))
    else out.push(sheet)
  }
  renumberDecorParts(out.map(s => s.decor).filter(Boolean) as NonNullable<Sheet['decor']>[])
  doc.sheets = out
  // 页码：每条写在它第一次出现的那一页
  const seen = new Set<unknown>()
  out.forEach((s, i) => {
    for (const it of s.items ?? []) if (!seen.has(it)) { seen.add(it); it.page = i + 1 }
    if (s.decor?.kind === 'decor-room') for (const it of s.decor.items ?? []) if (!seen.has(it)) { seen.add(it); it.page = i + 1 }
  })
}

/* ───────── 序号 ───────── */
function placeBadges(ctx: Ctx, items: BadgeIn[], bounds: Rect, out: RenderedSheet['badges']) {
  const lay = layoutBadges(items, bounds, MIN_GAP_PX, BADGE.d / 2)
  for (const p of lay.placed) badge(ctx, p.x, p.y, p.n, { anchor: p.anchor, d: BADGE.d })
  out.push(lay.placed.map(p => ({ n: p.n, x: p.x, y: p.y })))
  return lay
}
const inner = (x: number, y: number, w: number, h: number): Rect => ({ x: x + PANEL_PAD.x, y: y + PANEL_PAD.top, w: w - 2 * PANEL_PAD.x, h: h - PANEL_PAD.top - PANEL_PAD.bottom })

/* ───────── 封面 ───────── */
async function cover(rc: RenderCtx, index: number): Promise<RenderedSheet> {
  const { canvas, ctx } = newPage()
  const { doc } = rc, t = doc.t, s = doc.stats
  const L = PAGE.margin, colW = span(6)
  appMark(ctx, L, 44, 30)
  lines(ctx, [t.docName], L + 42, 49, { ...T.title, color: K.ink700 })
  // 上半：标题（细 + 粗两行，和工具左上角标题同一个做法）→ 大数字 → 统计
  let y: number = BODY.y
  y = lines(ctx, [t.coverKicker], L, y, { ...T.h2, color: K.ink500 }) + 8
  y = lines(ctx, clampLines(ctx, doc.base.title, colW, { size: 40, lh: 48, weight: 300, color: K.ink700 }, 3), L, y, { size: 40, lh: 48, weight: 300, color: K.ink700 })
  y = lines(ctx, [t.docName], L, y, { size: 40, lh: 48, weight: 600, color: K.ink }) + 24
  const n = String(doc.base.changes.length)
  const nw = text(ctx, n, L, y + 46, { size: 58, weight: 600, family: NUM, color: K.ink, letter: -1 })
  lines(ctx, [t.coverUnit], L + nw + 10, y + 26, { ...T.h2, color: K.ink700 })
  y += 64
  y = lines(ctx, [fill(t.coverStatsBy, { u: s.user, a: s.agent }), fill(t.coverStatsStatus, { c: s.confirmed, p: s.pending })], L, y, T.body) + 8
  // 受保护：只陈述条目数
  const pmsg = s.bearing && s.exterior ? fill(t.coverProtected, { n: s.bearing, m: s.exterior }) : s.bearing ? fill(t.coverProtectedBearing, { n: s.bearing }) : s.exterior ? fill(t.coverProtectedExterior, { m: s.exterior }) : t.coverProtectedNone
  lockIcon(ctx, L + 5, y + T.strong.lh / 2, 0.95)
  y = lines(ctx, clampLines(ctx, pmsg, colW - 18, T.strong, 2), L + 18, y, T.strong) + 4
  lines(ctx, [fill(t.coverDate, { d: stamp(doc.generatedAt).slice(0, 10) })], L, y, T.caption)
  // 下半：贴着右边图框的底。说明框在最下面，上面是「怎么看」
  const bottom = BODY.y + BODY.h, dh = 44, dy = bottom - dh
  const how = [t.coverHow1, t.coverHow2, t.coverHow3]
  let hy = dy - 24 - (T.h2.lh + 8 + how.length * T.body.lh)
  hy = lines(ctx, [t.coverHowTo], L, hy, T.h2) + 8
  for (const line of how) {
    ctx.fillStyle = K.ink400; ctx.beginPath(); ctx.arc(L + 3, hy + T.body.lh / 2, 2, 0, Math.PI * 2); ctx.fill()
    hy = lines(ctx, [line], L + 14, hy, T.body)
  }
  rrect(ctx, L, dy, colW, dh, 12); ctx.fillStyle = K.paper; ctx.fill(); ctx.strokeStyle = K.ink; ctx.lineWidth = 1.2; ctx.stroke()
  lines(ctx, clampLines(ctx, t.coverDisclaimer, colW - 32, T.strong, 1), L + 16, dy + (dh - T.strong.lh) / 2, { ...T.strong, color: K.ink })
  // 右边：改造后的整屋
  const px = L + colW + GUTTER, pw = PAGE.w - PAGE.margin - px, py = BODY.y, ph = BODY.h
  panel(ctx, px, py, pw, ph, t.coverAfter, { tone: 'ink' })
  const r = inner(px, py, pw, ph)
  const badges: RenderedSheet['badges'] = []
  let facts: SheetFacts | undefined
  if (doc.opts.threeD && rc.snap) {
    const shot = rc.snap.render(doc.after, { width: r.w, height: r.h, margin: 0.04 }, rc.restore)
    ctx.save(); rrect(ctx, r.x, r.y, r.w, r.h, 10); ctx.clip()
    ctx.drawImage(shot.canvas, r.x, r.y, r.w, r.h)
    ctx.restore()
  } else {
    const bb = planBounds(doc.after) ?? [0, 0, 1, 1]
    const fitted = fitPlans(ctx, [{ plan: doc.after, area: strip => ({ ...r, h: r.h - strip }), fit: rr => fitFrame(frameFor(bb, rr, 500), rr) }], t.roomKey), f = fitted[0]
    drawPlan(ctx, doc.after, f.x, f.r, { tone: 'muted' })
    drawMarks(ctx, f.x, rc.marks, new Set(rc.marks.map(m => m.changeId)), f.r)
    drawRoomLabels(ctx, f.labels, 'muted')
    drawPlanLegends(ctx, fitted, t.roomKey)
    facts = factsOf(fitted)
  }
  footer(ctx, rc, index, '')
  return { canvas, kind: 'cover', title: t.docName, badges, facts }
}

/* ───────── 总览 ───────── */
const circles = (ms: { x: number; y: number }[]): Circle[] => ms.map(m => ({ c: [m.x, m.y], r: BADGE.d / 2 + 3 }))
function overview(rc: RenderCtx, sheet: Sheet, index: number): RenderedSheet {
  const { canvas, ctx } = newPage()
  const { doc } = rc, t = doc.t
  header(ctx, rc, t.overviewTitle, { legend: true, proposal: true })
  const imgW = span(8)
  const area = { x: BODY.x, y: BODY.y, w: imgW, h: BODY.h }
  const used = [...new Set(doc.items.map(i => i.focus.level))]
  const levels = levelsOf(doc.base).filter(l => used.includes(l.id))
  const lv = levels.length ? levels : levelsOf(doc.base).slice(0, 1)
  const badges: RenderedSheet['badges'] = []
  const gap = 16, each = (area.w - gap * (lv.length - 1)) / lv.length, multi = lv.length > 1
  const shared: SharedLegend | undefined = multi ? { x: area.x, w: area.w, bottom: area.y + area.h } : undefined
  const itemsOn = (level: string) => doc.items.filter(it => it.focus.level === level || !multi)
  const itemMarks = (level: string, x: Xf): BadgeIn[] => itemsOn(level).map(it => ({ n: it.number, anchor: roomLift(doc, it, x.P(it.focus.anchor)) }))
  // 只标区域时的虚线框和 P 序号
  const regionsOf = (level: string, x: Xf, r: Rect) => {
    const marks: BadgeIn[] = [], rects: Rect[] = []
    doc.sheets.forEach((sh, si) => {
      if (sh.kind !== 'detail' || !sh.items?.length || sh.page!.level !== level && multi) return
      const its = sh.items
      const b = sh.page!.view === 'plan' ? sh.page!.frame : boxOf(its.flatMap(it => [[it.focus.bbox[0] - 300, it.focus.bbox[1] - 300], [it.focus.bbox[2] + 300, it.focus.bbox[3] + 300]] as Vec2[]))
      const A = x.P([b[0], b[1]]), B = x.P([b[2], b[3]])
      const x0 = Math.max(r.x + 3, A[0]), y0 = Math.max(r.y + 3, A[1]), x1 = Math.min(r.x + r.w - 3, B[0]), y1 = Math.min(r.y + r.h - 3, B[1])
      rects.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
      marks.push({ n: `P${si + 1}`, anchor: labelCenter(its.map(it => x.P(it.focus.anchor))) })
    })
    return { marks, rects }
  }
  // 逐条标序号挤（推不开或推得太远）就改成只标区域
  const crowded = (level: string, x: Xf, r: Rect) => { const l = layoutBadges(itemMarks(level, x), r, MIN_GAP_PX, BADGE.d / 2); return !l.ok || l.maxShift > 46 }
  const slots: PlanSlot[] = lv.map((l, i) => {
    const px = area.x + i * (each + gap), r0 = inner(px, area.y, each, area.h)
    const bb = planBounds(onLevel(doc.base, l.id)) ?? planBounds(doc.base) ?? [0, 0, 1, 1]
    const all = boxOf([[bb[0], bb[1]], [bb[2], bb[3]], ...itemsOn(l.id).filter(it => it.focus.level === l.id).flatMap(it => [[it.focus.bbox[0], it.focus.bbox[1]], [it.focus.bbox[2], it.focus.bbox[3]]] as Vec2[])])
    return {
      plan: multi ? onLevel(doc.base, l.id) : doc.base, area: strip => ({ ...r0, h: r0.h - strip }), fit: rr => fitFrame(frameFor(all, rr, 700), rr),
      avoid: (x, rr) => circles(layoutBadges(crowded(l.id, x, rr) ? regionsOf(l.id, x, rr).marks : itemMarks(l.id, x), rr, MIN_GAP_PX, BADGE.d / 2).placed),
    }
  })
  let fitted = fitPlans(ctx, slots, t.roomKey, shared)
  const anyCrowded = () => fitted.some((f, i) => crowded(lv[i].id, f.x, f.r))
  const regions = anyCrowded()
  if (regions) { slots[0].note = t.overviewRegions; fitted = fitPlans(ctx, slots, t.roomKey, shared) }
  const panelH = area.h - (multi ? fitted[0].strip : 0)
  lv.forEach((l, i) => {
    const f = fitted[i], px = area.x + i * (each + gap)
    panel(ctx, px, area.y, each, panelH, multi ? (levelName(doc.base, l.id) ?? l.name) : undefined, { right: t.overviewSub })
    drawPlan(ctx, doc.base, f.x, f.r, { tone: 'muted', level: multi ? l.id : undefined, dims: true })
    drawMarks(ctx, f.x, rc.marks.filter(m => !m.level || !multi || m.level === l.id), new Set(rc.marks.map(m => m.changeId)), f.r)
    drawRoomLabels(ctx, f.labels, 'muted')
    if (regions) {
      const reg = regionsOf(l.id, f.x, f.r)
      for (const q of reg.rects) { ctx.save(); rrect(ctx, q.x, q.y, q.w, q.h, 10); ctx.setLineDash([5, 4]); ctx.strokeStyle = K.ink600; ctx.lineWidth = 1.2; ctx.stroke(); ctx.restore() }
      placeBadges(ctx, reg.marks, f.r, badges)
    } else placeBadges(ctx, itemMarks(l.id, f.x), f.r, badges)
  })
  drawPlanLegends(ctx, fitted, t.roomKey, shared)
  // 右栏：目录
  const col = DETAIL.col
  lines(ctx, [t.overviewList], col.x, col.y, T.h2)
  drawList(ctx, rc, sheet.list ?? doc.items, { x: col.x, y: col.y + LIST_HEAD, w: col.w, h: col.h - LIST_HEAD }, sheet.listLines ?? 2)
  footer(ctx, rc, index)
  return { canvas, kind: 'overview', title: t.overviewTitle, badges, regions, facts: factsOf(fitted) }
}
/** 目录太长时接的一页：三栏纯目录 */
function overviewListPage(rc: RenderCtx, sheet: Sheet, index: number): RenderedSheet {
  const { canvas, ctx } = newPage()
  const { doc } = rc, t = doc.t
  header(ctx, rc, `${t.overviewTitle}（${t.continued}）`)
  const list = sheet.list ?? [], w = DETAIL.col.w
  let i = 0
  for (let c = 0; c < 3 && i < list.length; c++) {
    const part: ExportItem[] = []
    let used = 0
    while (i < list.length && used + listH(ctx, doc, [list[i]], w, 2) <= BODY.h) { used += listH(ctx, doc, [list[i]], w, 2); part.push(list[i++]) }
    drawList(ctx, rc, part, { x: BODY.x + c * (w + (BODY.w - 3 * w) / 2), y: BODY.y, w, h: BODY.h }, 2)
  }
  footer(ctx, rc, index)
  return { canvas, kind: 'overview-list', title: t.overviewTitle, badges: [] }
}
/** 只改房间的条目：序号放到房间名上方，不盖住名字 */
function roomLift(doc: ExportDoc, it: ExportItem, a: Vec2): [number, number] {
  const onlyRoom = !!it.focus.room && it.focus.changeIds.every(id => doc.base.changes.find(c => c.id === id)?.type === 'room')
  return onlyRoom ? [a[0], a[1] - 30] : [a[0], a[1]]
}
const labelCenter = (pts: Vec2[]): [number, number] => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]

/* ───────── 原始结构 ───────── */
function original(rc: RenderCtx, index: number): RenderedSheet {
  const { canvas, ctx } = newPage()
  const { doc } = rc, t = doc.t
  header(ctx, rc, t.originalTitle)
  const imgW = span(8)
  const lv = levelsOf(doc.base), multi = lv.length > 1
  const gap = 16, each = (imgW - gap * (lv.length - 1)) / lv.length
  const shared: SharedLegend | undefined = multi ? { x: BODY.x, w: imgW, bottom: BODY.y + BODY.h } : undefined
  const fitted = fitPlans(ctx, lv.map((l, i): PlanSlot => {
    const view = multi ? onLevel(doc.base, l.id) : doc.base, bb = planBounds(view) ?? [0, 0, 1, 1], r0 = inner(BODY.x + i * (each + gap), BODY.y, each, BODY.h)
    return { plan: view, area: strip => ({ ...r0, h: r0.h - strip }), fit: rr => fitFrame(frameFor(bb, rr, 700), rr) }
  }), t.roomKey, shared)
  lv.forEach((l, i) => {
    const f = fitted[i]
    panel(ctx, BODY.x + i * (each + gap), BODY.y, each, BODY.h - (multi ? f.strip : 0), multi ? l.name : undefined, { right: t.originalSub })
    drawPlan(ctx, doc.base, f.x, f.r, { tone: 'normal', level: multi ? l.id : undefined, dims: true })
    drawRoomLabels(ctx, f.labels, 'normal')
  })
  drawPlanLegends(ctx, fitted, t.roomKey, shared)
  // 右栏：墙的类型图例（只是图上的标注）
  const cx = DETAIL.col.x, cw = DETAIL.col.w
  let y = lines(ctx, ['墙的类型'], cx, BODY.y, T.h2) + 8
  const kinds: [string, string, (x: number, y: number) => void][] = [
    ['外墙', '石板灰实心', (x, y) => { ctx.fillStyle = K.wallExt; ctx.fillRect(x, y, 36, 12) }],
    ['承重墙', '墨色 + 斜线', (x, y) => { ctx.fillStyle = pattern(ctx, 'bearing'); ctx.fillRect(x, y, 36, 12) }],
    ['非承重墙', '中灰实心', (x, y) => { ctx.fillStyle = K.wallPart; ctx.fillRect(x, y, 36, 12) }],
    ['玻璃隔断', '天青', (x, y) => { ctx.fillStyle = K.skyFill; ctx.fillRect(x, y, 36, 12); ctx.strokeStyle = K.sky; ctx.strokeRect(x, y, 36, 12) }],
    ['矮墙', '点纹，不到顶', (x, y) => { ctx.fillStyle = pattern(ctx, 'half'); ctx.fillRect(x, y, 36, 12) }],
    ['横梁', '虚线，在头顶上方', (x, y) => { ctx.setLineDash([5, 3.5]); ctx.strokeStyle = K.ink500; ctx.strokeRect(x, y, 36, 12); ctx.setLineDash([]) }],
  ]
  const present = new Set(doc.base.walls.map(w => w.kind))
  for (const [name, how, sw] of kinds) {
    const map: Record<string, string> = { 外墙: 'exterior', 承重墙: 'bearing', 非承重墙: 'partition', 玻璃隔断: 'glass', 矮墙: 'half' }
    if (map[name] && !present.has(map[name] as never) && !(name === '矮墙' && present.has('half-glass'))) continue
    if (name === '横梁' && !doc.base.beams.length) continue
    sw(cx, y + 10)
    lines(ctx, [name], cx + 48, y + 6, T.strong)
    lines(ctx, [how], cx + cw, y + 7.5, T.caption, 'right')
    y += 32
    ctx.fillStyle = K.ink100; ctx.fillRect(cx, y - 1, cw, 1)
  }
  lines(ctx, wrap(ctx, '墙的类型是照着原始户型图上的画法认的，只说明图上怎么标，不代表实际结构。', cw, T.caption), cx, y + 12, T.caption)
  footer(ctx, rc, index)
  return { canvas, kind: 'original', title: t.originalTitle, badges: [], facts: factsOf(fitted) }
}

/* ───────── 细节页 ───────── */
function detailPlan(rc: RenderCtx, sheet: Sheet, index: number): RenderedSheet {
  const { canvas, ctx } = newPage()
  const { doc } = rc, t = doc.t, page = sheet.page!, items = sheet.items!
  const lvName = levelName(doc.base, page.level)
  header(ctx, rc, t.detailPlan + (lvName ? ` · ${lvName}` : '') + partLabel(sheet.part), { legend: true })
  const { img } = DETAIL, gap = 16
  const side = doc.layout === 'side'
  const pw = side ? (img.w - gap) / 2 : img.w
  const strong = new Set(items.flatMap(it => it.focus.changeIds))
  const badges: RenderedSheet['badges'] = []
  const level = levelsOf(doc.base).length > 1 ? page.level : undefined
  const sides = ['before', 'after'] as const
  const marksOf = (x: Xf): BadgeIn[] => items.map(it => ({ n: it.number, anchor: roomLift(doc, it, x.P(it.focus.anchor)) }))
  // 图框随共用图例的高度缩：左右排时一起变矮，上下排时各让一半
  const box = (k: number, strip: number) => {
    const ph = side ? img.h - strip : (img.h - strip - gap) / 2
    return { px: img.x + (side ? k * (pw + gap) : 0), py: img.y + (side ? 0 : k * (ph + gap)), ph }
  }
  const shared: SharedLegend = { x: img.x, w: img.w, bottom: img.y + img.h }
  const fitted = fitPlans(ctx, sides.map((which, k): PlanSlot => {
    const plan = which === 'before' ? doc.base : doc.after
    return {
      plan: level ? onLevel(plan, level) : plan, area: strip => { const b = box(k, strip); return inner(b.px, b.py, pw, b.ph) }, fit: rr => fitFrame(contextFrame(doc, page.frame, page.level, rr), rr),
      avoid: (x, rr) => circles(layoutBadges(marksOf(x), rr, MIN_GAP_PX, BADGE.d / 2).placed),
    }
  }), t.roomKey, shared)
  sides.forEach((which, k) => {
    const f = fitted[k], { px, py, ph } = box(k, f.strip), tone = which === 'before' ? 'normal' : 'muted'
    panel(ctx, px, py, pw, ph, which === 'before' ? t.before : t.after, { tone: which === 'after' ? 'ink' : 'plain' })
    drawPlan(ctx, which === 'before' ? doc.base : doc.after, f.x, f.r, { tone, level })
    drawMarks(ctx, f.x, rc.marks.filter(m => !level || !m.level || m.level === page.level), strong, f.r, which)
    drawRoomLabels(ctx, f.labels, tone)
    placeBadges(ctx, marksOf(f.x), f.r, badges)
  })
  drawPlanLegends(ctx, fitted, t.roomKey, shared)
  const text_ = drawSheetCol(ctx, rc, sheet)
  footer(ctx, rc, index)
  return { canvas, kind: 'detail', title: t.detailPlan, badges, facts: { ...factsOf(fitted), ...text_ }, part: sheet.part }
}

/**
 * 只讲一两处的页，paginate 的框很小（构件外扩 0.6m），看不出在屋里哪儿。框至少放到整层的一半大，
 * 序号间距由排布兜底（推开 + 引线），e2e 按最终位置复核。
 */
function contextFrame(doc: ExportDoc, f: Box, level: string, r: Rect): Box {
  const bb = planBounds(levelsOf(doc.base).length > 1 ? onLevel(doc.base, level) : doc.base)
  if (!bb) return f
  const w = Math.max(f[2] - f[0], (bb[2] - bb[0]) * 0.5), h = Math.max(f[3] - f[1], (bb[3] - bb[1]) * 0.5)
  const cx = (f[0] + f[2]) / 2, cy = (f[1] + f[3]) / 2
  return frameFor([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], r)
}

/** 钥匙图：整屋小平面，标出这一页讲的墙 / 房间 */
function keyPlan(ctx: Ctx, rc: RenderCtx, r: Rect, level: string, hi: { wall?: Wall; poly?: Vec2[] }) {
  const { doc } = rc
  panel(ctx, r.x, r.y, r.w, r.h)
  lines(ctx, [doc.t.keyPlan], r.x + 16, r.y + 12, { ...T.caption, weight: 600, color: K.ink600 })
  const ir = { x: r.x + 12, y: r.y + 32, w: r.w - 24, h: r.h - 44 }
  const view = levelsOf(doc.after).length > 1 ? onLevel(doc.after, level) : doc.after
  const bb = planBounds(view) ?? [0, 0, 1, 1]
  const x = fitFrame(frameFor(bb, ir, 300), ir)
  drawPlan(ctx, doc.after, x, ir, { tone: 'muted', level: levelsOf(doc.after).length > 1 ? level : undefined })
  if (hi.wall) highlightWall(ctx, x, hi.wall)
  if (hi.poly) outlinePoly(ctx, x, hi.poly, K.cobalt, 2, [], 'rgba(75,118,242,0.18)')
}

function detailElevation(rc: RenderCtx, sheet: Sheet, index: number): RenderedSheet {
  const { canvas, ctx } = newPage()
  const { doc } = rc, t = doc.t, page = sheet.page!, items = sheet.items!
  const id = page.wall!
  const wallB = findIn(doc.base, 'wall', id) as Wall | undefined, wallA = findIn(doc.after, 'wall', id) as Wall | undefined
  const beamB = findIn(doc.base, 'beam', id), beamA = findIn(doc.after, 'beam', id)
  const isBeam = !wallB && !wallA && (beamB || beamA)
  const host = wallA ?? wallB
  const subject = isBeam ? (beamA?.name ?? beamB?.name ?? '横梁') : wallName(doc.base, host)
  header(ctx, rc, `${isBeam ? t.detailBeam : t.detailElevation} · ${subject}${partLabel(sheet.part)}`, { legend: true })
  const { img } = DETAIL, gap = 16, ph = (img.h - gap) / 2
  const strongIds = new Set(items.flatMap(it => it.focus.changeIds))
  const marks: ElevMark[] = rc.marks.filter(m => strongIds.has(m.changeId)).map(m => {
    const c = doc.base.changes.find(x => x.id === m.changeId)!
    return { id: c.target ?? (c.data as { id?: string })?.id ?? '', op: m.op }
  })
  const badges: RenderedSheet['badges'] = []
  // 两张同一比例
  let L = 1000, H = doc.base.ceiling
  if (isBeam) {
    const b = beamA ?? beamB
    L = Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1])
    const mid: Vec2 = [(b.a[0] + b.b[0]) / 2, (b.a[1] + b.b[1]) / 2]
    const room = doc.after.rooms.find(r => pointInPolygon(mid, r.poly))
    H = Math.max(room ? roomCeiling(doc.after, room) : doc.after.ceiling, doc.base.ceiling)
  } else if (host) {
    L = wallLength(host)
    H = Math.max(...[wallB && effH(doc.base, wallB), wallA && effH(doc.after, wallA)].filter(Boolean) as number[], 1)
  }
  for (const [k, which] of (['before', 'after'] as const).entries()) {
    const py = img.y + k * (ph + gap)
    const sideRoom = host ? roomsBesideWall(which === 'before' ? doc.base : doc.after, host.id).positive[0]?.name : undefined
    panel(ctx, img.x, py, img.w, ph, which === 'before' ? t.before : t.after, { tone: which === 'after' ? 'ink' : 'plain', right: sideRoom ? fill(t.viewFrom, { room: sideRoom }) : undefined })
    const r = { x: img.x + 10, y: py + 30, w: img.w - 20, h: ph - 36 }
    const xf = elevScale(r, L, H + 0.12, 70, 150, 30, 40)
    const plan = which === 'before' ? doc.base : doc.after
    const w = which === 'before' ? wallB : wallA
    if (isBeam) drawBeamElevation(ctx, plan, id, xf, L, marks.find(m => m.id === id) ?? null, which)
    else if (w) drawWallElevation(ctx, r, plan, w, xf, marks, which)
    // 序号：洞口在洞口中间，墙 / 梁在墙中间偏上
    const anchors: BadgeIn[] = items.map(it => {
      const c = doc.base.changes.find(x => x.id === it.focus.changeId)
      const oid = c?.type === 'opening' ? (c.target ?? (c.data as { id?: string })?.id) : undefined
      const o = oid ? plan.openings.find(x => x.id === oid) ?? (c?.op === 'add' ? c.data as never : findIn(doc.base, 'opening', oid)) : undefined
      if (o && host) return { n: it.number, anchor: [xf.X(o.offset + o.width / 2), xf.Y((o.sill + o.head) / 2)] as [number, number], start: [xf.X(o.offset + o.width / 2) - o.width * xf.s / 2 - 22, xf.Y(o.head) - 22] as [number, number] }
      if (host && !isBeam) { const s = projectToWall(host, it.focus.anchor).s; return { n: it.number, anchor: [xf.X(s), xf.Y(H * 0.55)] as [number, number] } }
      return { n: it.number, anchor: [xf.X(L * 0.3), xf.Y(H * 0.92)] as [number, number] }
    })
    placeBadges(ctx, anchors, r, badges)
  }
  // 右栏：钥匙图 + 条目
  const col = DETAIL.col
  keyPlan(ctx, rc, { x: col.x, y: col.y, w: col.w, h: KEY_PLAN_H }, page.level, { wall: isBeam ? undefined : host, poly: isBeam ? beamPoly(beamA ?? beamB) : undefined })
  const text_ = drawSheetCol(ctx, rc, sheet)
  footer(ctx, rc, index)
  return { canvas, kind: 'detail', title: t.detailElevation, badges, facts: { labels: [], legend: [], ...text_ }, part: sheet.part }
}
const effH = (plan: Plan, w: Wall) => { try { return effectiveWallHeight(plan, w) } catch { return plan.ceiling } }
function beamPoly(b: { a: Vec2; b: Vec2; width: number } | undefined): Vec2[] | undefined {
  if (!b) return undefined
  const L = Math.hypot(b.b[0] - b.a[0], b.b[1] - b.a[1]) || 1, n: Vec2 = [-(b.b[1] - b.a[1]) / L * b.width / 2, (b.b[0] - b.a[0]) / L * b.width / 2]
  return [[b.a[0] + n[0], b.a[1] + n[1]], [b.b[0] + n[0], b.b[1] + n[1]], [b.b[0] - n[0], b.b[1] - n[1]], [b.a[0] - n[0], b.a[1] - n[1]]]
}

function detail3d(rc: RenderCtx, sheet: Sheet, index: number): RenderedSheet {
  const { canvas, ctx } = newPage()
  const { doc } = rc, t = doc.t, page = sheet.page!, items = sheet.items!
  const id = page.room!
  const room = findIn(doc.after, 'room', id) ?? findIn(doc.base, 'room', id)
  const stair = !room ? (findIn(doc.after, 'stair', id) ?? findIn(doc.base, 'stair', id)) : undefined
  const poly: Vec2[] = room?.poly ?? stair?.poly ?? []
  const use3d = doc.opts.threeD && !!rc.snap
  const lvName = levelName(doc.base, page.level)
  header(ctx, rc, (use3d ? t.detail3d : t.detail3dSection) + ` · ${room?.name ?? stair?.name ?? '楼梯'}` + (lvName ? ` · ${lvName}` : '') + partLabel(sheet.part), { legend: true })
  const { img } = DETAIL, gap = 16
  const badges: RenderedSheet['badges'] = []
  const topH = use3d ? 392 : 360
  const after = doc.after
  const ceil = room ? roomCeiling(after, room) : after.ceiling
  if (use3d) {
    panel(ctx, img.x, img.y, img.w, topH, t.after + ' · 3D', { tone: 'ink' })
    const r = inner(img.x, img.y, img.w, topH)
    const b = poly.length ? boxOf(poly) : (planBounds(after) ?? [0, 0, 1, 1] as Box)
    const focus: Box = [b[0] - 1900, b[1] - 1900, b[2] + 1900, b[3] + 1900]
    const shot = rc.snap!.render(after, { width: r.w, height: r.h, focus, focusTop: ceil, highlightRooms: room ? [room.id] : [], margin: 0.03 }, rc.restore)
    ctx.save(); rrect(ctx, r.x, r.y, r.w, r.h, 10); ctx.clip()
    ctx.drawImage(shot.canvas, r.x, r.y, r.w, r.h)
    // 框住相关房间：层高处一圈钴蓝线，地面一圈虚线
    const proj = (p: Vec2, z: number) => { const q = shot.project(p, z); return q ? [r.x + q[0], r.y + q[1]] as Vec2 : null }
    const ring = (z: number, dash: number[], w: number) => {
      const pts = poly.map(p => proj(p, z)).filter(Boolean) as Vec2[]
      if (pts.length < 3) return
      ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath()
      ctx.setLineDash(dash); ctx.strokeStyle = K.paper; ctx.lineWidth = w + 3; ctx.stroke(); ctx.strokeStyle = K.cobalt; ctx.lineWidth = w; ctx.stroke(); ctx.setLineDash([])
    }
    ring((room?.floorOffset ?? 0) + 0.01, [5, 4], 1.6)
    ring(ceil, [], 2.2)
    // 层高胶囊
    if (room) {
      const lp = proj(labelPoint(room.poly), ceil)
      const fo = room.floorOffset ?? 0, floorItem = items.some(it => it.lines.some(l => 'floorOffset' in (l.change.data ?? {})))
      const lab = floorItem ? `${room.name} · 地面 ${fo > 0 ? '+' : ''}${fo.toFixed(2)} m` : `${room.name} · 层高 ${ceil.toFixed(2)} m`
      if (lp) chip(ctx, lp[0] + 18, lp[1] - 28, lab, { fill: K.ink, color: K.paper, size: 11, h: 21 })
    }
    ctx.restore()
    placeBadges(ctx, items.map(it => { const q = proj(it.focus.anchor, ceil); return { n: it.number, anchor: q ? [q[0], q[1]] as [number, number] : [r.x + r.w / 2, r.y + r.h / 2] as [number, number] } }), r, badges)
  }
  // 剖面
  const sy = img.y + (use3d ? topH + gap : 0), sh = use3d ? img.h - topH - gap : topH
  panel(ctx, img.x, sy, img.w, sh, use3d ? '剖面' : t.after + ' · 剖面', { tone: use3d ? 'plain' : 'ink' })
  const sr = { x: img.x + 10, y: sy + 34, w: img.w - 20, h: sh - 40 }
  const sec = room ? drawRoomSection(ctx, sr, doc.base, after, room.id) : null
  if (!use3d) {
    const anchor = sec?.anchor ?? [sr.x + sr.w / 2, sr.y + sr.h / 2] as [number, number]
    placeBadges(ctx, items.map(it => ({ n: it.number, anchor })), sr, badges)
    keyPlan(ctx, rc, { x: img.x, y: sy + sh + gap, w: img.w, h: img.h - sh - gap }, page.level, { poly })
  }
  const text_ = drawSheetCol(ctx, rc, sheet)
  footer(ctx, rc, index)
  return { canvas, kind: 'detail', title: t.detail3d, badges, facts: { labels: [], legend: [], ...text_ }, part: sheet.part }
}

export async function renderSheet(rc: RenderCtx, sheet: Sheet, index: number): Promise<RenderedSheet> {
  if (sheet.decor && rc.doc.decor) {
    // 装修页：页脚中间换成装修的口吻；需要专业确认页换成管线那句
    const r = renderDecorSheet(rc.doc, rc.doc.decor, sheet.decor, index, (ctx, i, extra) => footer(ctx, rc, i, extra ?? DECOR_STRINGS.disclaimer))
    return { canvas: r.canvas, kind: sheet.kind, title: r.title, badges: r.badges, regions: r.regions, facts: r.facts, part: sheet.decor.part }
  }
  if (sheet.kind === 'cover') return cover(rc, index)
  if (sheet.kind === 'overview') return overview(rc, sheet, index)
  if (sheet.kind === 'overview-list') return overviewListPage(rc, sheet, index)
  if (sheet.kind === 'original') return original(rc, index)
  const v = sheet.page!.view
  if (v === 'elevation') return detailElevation(rc, sheet, index)
  if (v === '3d') return detail3d(rc, sheet, index)
  return detailPlan(rc, sheet, index)
}
