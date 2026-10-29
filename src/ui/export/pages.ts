/**
 * 每一页的排版：封面、总览、（原始结构）、细节页（平面前后对比 / 墙立面 / 3D 白模 + 剖面）。
 * 每页整页画在一张 A4 横版画布上（2 倍像素），再放进 PDF。中文不用嵌字体。
 * 每页记下图上序号的位置（页面 px），e2e 用它断言两两间距。
 */
import type { Box, Plan, Vec2, Wall } from '@/core/types'
import { effectiveWallHeight, labelPoint, planBounds, roomCeiling, wallLength, roomsBesideWall, projectToWall, pointInPolygon } from '@/core/geometry'
import { levelsOf, onLevel } from '@/core/levels'
import type { SnapshotRenderer } from '@/three/snapshot'
import { BADGE, BODY, DETAIL, MIN_GAP_PX, PAGE, PANEL_PAD, levelName, stamp, wallName, findIn, type ExportDoc, type ExportItem, type Sheet } from './model'
import { K, NUM, SANS, badge, chip, lockIcon, measure, newPage, panel, para, pattern, rrect, text, type Ctx } from './canvas'
import { boxOf, computeMarks, drawMarks, drawPlan, fitFrame, frameFor, highlightWall, outlinePoly, type Mark, type Rect } from './plan-draw'
import { drawBeamElevation, drawRoomSection, drawWallElevation, elevScale, type ElevMark } from './elev-draw'
import { layoutBadges, type BadgeIn } from './badges'
import { fill } from './strings'
import { DECOR_STRINGS, renderDecorSheet } from './decor'

export interface RenderedSheet { canvas: HTMLCanvasElement; kind: Sheet['kind']; title: string; badges: { n: number | string; x: number; y: number }[][]; regions?: boolean }
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
function header(ctx: Ctx, rc: RenderCtx, title: string) {
  const { doc } = rc
  appMark(ctx, PAGE.margin, 40, 26)
  text(ctx, `${doc.base.title} · ${doc.t.docName}`, PAGE.margin + 36, 52, { size: 11.5, weight: 600, color: K.ink500 })
  text(ctx, title, PAGE.margin + 36, 80, { size: 22, weight: 650, color: K.ink, letter: -0.2 })
  ctx.fillStyle = K.ink100; ctx.fillRect(PAGE.margin, 98, PAGE.w - 2 * PAGE.margin, 1)
}
function footer(ctx: Ctx, rc: RenderCtx, index: number, center?: string) {
  const { doc } = rc, t = doc.t, y = PAGE.h - 30
  ctx.fillStyle = K.ink100; ctx.fillRect(PAGE.margin, y - 20, PAGE.w - 2 * PAGE.margin, 1)
  text(ctx, fill(t.footer, { title: doc.base.title }), PAGE.margin, y, { size: 10.5, weight: 600, color: K.ink600 })
  text(ctx, center ?? t.coverDisclaimer, PAGE.w / 2, y, { size: 10.5, weight: 500, color: K.ink500, align: 'center' })
  const right = `${fill(t.generated, { t: stamp(doc.generatedAt) })}   ${fill(t.pageOf, { i: index + 1, n: rc.total })}`
  text(ctx, right, PAGE.w - PAGE.margin, y, { size: 10.5, weight: 600, color: K.ink600, align: 'right', family: SANS })
}

/* ───────── 图例 ───────── */
function legend(ctx: Ctx, rc: RenderCtx, xRight: number, y: number, withProposal = false) {
  const t = rc.doc.t
  const items: [string, (x: number, y: number) => void][] = [
    [t.legendRemove, (x, y) => { rrect(ctx, x, y - 6, 26, 12, 3); ctx.fillStyle = pattern(ctx, 'coral'); ctx.fill(); ctx.setLineDash([3.5, 2.2]); ctx.strokeStyle = K.coral; ctx.lineWidth = 1.4; ctx.stroke(); ctx.setLineDash([]) }],
    [t.legendAdd, (x, y) => { rrect(ctx, x, y - 6, 26, 12, 3); ctx.fillStyle = K.cobalt; ctx.fill() }],
    [t.legendModify, (x, y) => { rrect(ctx, x + 1, y - 5, 24, 10, 3); ctx.strokeStyle = K.cobalt; ctx.lineWidth = 2; ctx.stroke() }],
  ]
  if (withProposal) items.push([t.legendBefore, (x, y) => { rrect(ctx, x, y - 6, 26, 12, 3); ctx.fillStyle = '#c1c5cb'; ctx.fill() }])
  let x = xRight
  for (const [label] of [...items].reverse()) x -= measure(ctx, label, { size: 11.5, weight: 600 }) + 26 + 8 + 18
  for (const [label, sw] of items) {
    sw(x, y)
    const w = text(ctx, label, x + 32, y + 4, { size: 11.5, weight: 600, color: K.ink700 })
    x += 32 + w + 18
  }
}

/* ───────── 条目文字（右栏） ───────── */
interface ColStyle { what: number; note: number; small: number; gap: number; noteLines: number; deltas: boolean }
const COL_STYLES: ColStyle[] = [
  { what: 13.5, note: 12.5, small: 11, gap: 18, noteLines: 4, deltas: true },
  { what: 12.5, note: 11.5, small: 10.5, gap: 13, noteLines: 3, deltas: true },
  { what: 12, note: 11, small: 10, gap: 10, noteLines: 2, deltas: false },
  { what: 11.5, note: 10.5, small: 9.5, gap: 8, noteLines: 1, deltas: false },
]
function itemBlock(ctx: Ctx, rc: RenderCtx, it: ExportItem, x: number, y: number, w: number, st: ColStyle, dry: boolean): number {
  const t = rc.doc.t
  const tx = x + 34, tw = w - 34
  if (!dry) badge(ctx, x + 12, y + 10, it.number, { d: 24 })
  let yy = y + 4 + st.what * 0.9
  for (const [i, ln] of it.lines.entries()) {
    if (i) yy += 6
    const r = para(ctx, ln.what, tx, yy, tw, st.what * 1.38, { size: st.what, weight: 650, color: K.ink }, 3, dry)
    yy = r.y - st.what * 1.38 + st.what * 1.38
    if (ln.note) {
      const q = `「${ln.note}」`
      const top = yy - st.note * 0.9 + 2
      const r2 = para(ctx, q, tx + 10, yy + 2, tw - 10, st.note * 1.5, { size: st.note, weight: 450, color: K.ink700 }, st.noteLines, dry)
      if (!dry) { ctx.fillStyle = it.by === 'agent' ? K.lav : K.ink300; ctx.fillRect(tx, top, 2.5, r2.y - top - st.note * 0.5) }
      yy = r2.y + 2
    }
    if (st.deltas && ln.delta.length) {
      const r3 = para(ctx, `${t.change}：${ln.delta.join('；')}`, tx, yy + 1, tw, st.small * 1.45, { size: st.small, weight: 600, color: K.cobaltDeep }, 2, dry)
      yy = r3.y + 1
    }
  }
  // 状态、谁提的
  let cx = tx
  const cy = yy - 6
  const pending = it.status === 'pending'
  cx += chip(ctx, cx, cy, pending ? t.statusPending : t.statusConfirmed, {
    fill: pending ? K.paper : K.ink50, stroke: pending ? K.ink500 : K.ink200, dashed: pending, color: K.ink800, size: st.small, h: 19, dry,
    icon: dry ? undefined : (ix, iy) => {
      ctx.save(); ctx.strokeStyle = K.ink800; ctx.lineWidth = 1.3
      if (pending) { ctx.beginPath(); ctx.arc(ix, iy, 3.4, 0, Math.PI * 2); ctx.stroke() }
      else { ctx.beginPath(); ctx.moveTo(ix - 3.2, iy); ctx.lineTo(ix - 0.8, iy + 2.6); ctx.lineTo(ix + 3.6, iy - 2.8); ctx.stroke() }
      ctx.restore()
    },
  }) + 6
  const byLabel = it.by === 'agent' ? t.byAgent : it.by === 'mixed' ? `${t.byUser} + ${t.byAgent}` : t.byUser
  chip(ctx, cx, cy, byLabel, { fill: it.by === 'user' ? K.paper : K.lavTint, stroke: it.by === 'user' ? K.ink200 : undefined, color: it.by === 'user' ? K.ink700 : '#4a33b8', size: st.small, h: 19, dry })
  yy = cy + 19 + 8
  // 受保护：只陈述图上的标注
  for (const p of it.protect) {
    const msg = p === 'bearing' ? t.protectedBearing : p === 'exterior' ? t.protectedExterior : '这根柱在图上标为承重柱，改动需要专业确认'
    const lines = para(ctx, msg, tx + 24, 0, tw - 32, st.small * 1.45, { size: st.small, weight: 600 }, 3, true).lines
    const h = lines * st.small * 1.45 + 12
    if (!dry) {
      rrect(ctx, tx, yy, tw, h, 9); ctx.fillStyle = K.ink50; ctx.fill(); ctx.strokeStyle = K.ink300; ctx.lineWidth = 1; ctx.stroke()
      lockIcon(ctx, tx + 12, yy + 6 + st.small * 0.75, 0.95)
      para(ctx, msg, tx + 24, yy + 6 + st.small * 1.05, tw - 32, st.small * 1.45, { size: st.small, weight: 600, color: K.ink800 }, 3)
    }
    yy += h + 6
  }
  if (it.notApplied) {
    const r = para(ctx, it.notApplied, tx, yy + st.small, tw, st.small * 1.4, { size: st.small, weight: 500, color: K.ink500 }, 2, dry)
    yy = r.y
  }
  return yy - y
}
/** 右栏：自动选一档字号，放得下为止 */
function itemColumn(ctx: Ctx, rc: RenderCtx, items: ExportItem[], r: Rect) {
  let st = COL_STYLES[COL_STYLES.length - 1]
  for (const s of COL_STYLES) {
    const h = items.reduce((a, it) => a + itemBlock(ctx, rc, it, r.x, 0, r.w, s, true) + s.gap, -s.gap)
    if (h <= r.h) { st = s; break }
  }
  let y = r.y
  for (const [i, it] of items.entries()) {
    const h = itemBlock(ctx, rc, it, r.x, y, r.w, st, true)
    if (y + h > r.y + r.h + 4) { text(ctx, `……`, r.x + 34, y + 12, { size: 12, color: K.ink500 }); break }
    itemBlock(ctx, rc, it, r.x, y, r.w, st, false)
    y += h + st.gap
    if (i < items.length - 1) { ctx.fillStyle = K.ink100; ctx.fillRect(r.x + 34, y - st.gap / 2, r.w - 34, 1) }
  }
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
  const L = PAGE.margin
  appMark(ctx, L, 44, 30)
  text(ctx, t.docName, L + 42, 64, { size: 13, weight: 650, color: K.ink700 })
  // 标题：细 + 粗两行（和工具左上角标题同一个做法）
  text(ctx, t.coverKicker, L, 168, { size: 15, weight: 600, color: K.ink500 })
  const titleLines = para(ctx, doc.base.title, L, 220, 470, 50, { size: 42, weight: 300, color: K.ink700, letter: -0.4 }, 2, true).lines
  para(ctx, doc.base.title, L, 220, 470, 50, { size: 42, weight: 300, color: K.ink700, letter: -0.4 }, 2)
  let y = 220 + titleLines * 50
  text(ctx, t.docName, L, y, { size: 42, weight: 650, color: K.ink, letter: -0.6 })
  y += 56
  // 大数字
  const n = String(doc.base.changes.length)
  const nw = text(ctx, n, L, y + 46, { size: 58, weight: 600, family: NUM, color: K.ink, letter: -1 })
  text(ctx, t.coverUnit, L + nw + 10, y + 44, { size: 16, weight: 600, color: K.ink700 })
  text(ctx, fill(t.coverStatsBy, { u: s.user, a: s.agent }), L, y + 78, { size: 12.5, weight: 500, color: K.ink600 })
  text(ctx, fill(t.coverStatsStatus, { c: s.confirmed, p: s.pending }), L, y + 98, { size: 12.5, weight: 500, color: K.ink600 })
  y += 128
  // 受保护：只陈述条目数
  const pmsg = s.bearing && s.exterior ? fill(t.coverProtected, { n: s.bearing, m: s.exterior }) : s.bearing ? fill(t.coverProtectedBearing, { n: s.bearing }) : s.exterior ? fill(t.coverProtectedExterior, { m: s.exterior }) : t.coverProtectedNone
  lockIcon(ctx, L + 6, y - 4, 1.05)
  para(ctx, pmsg, L + 20, y, 440, 19, { size: 12.5, weight: 600, color: K.ink800 }, 2)
  text(ctx, fill(t.coverDate, { d: stamp(doc.generatedAt).slice(0, 10) }), L, y + 30, { size: 12, weight: 500, color: K.ink500 })
  // 怎么看
  let hy = 560
  text(ctx, t.coverHowTo, L, hy, { size: 12, weight: 650, color: K.ink700 })
  hy += 22
  for (const line of [t.coverHow1, t.coverHow2, t.coverHow3]) {
    ctx.fillStyle = K.ink400; ctx.beginPath(); ctx.arc(L + 3, hy - 4, 2, 0, Math.PI * 2); ctx.fill()
    text(ctx, line, L + 14, hy, { size: 11.5, weight: 500, color: K.ink600 })
    hy += 19
  }
  // 说明：放在一块墨色描边的框里
  const dy = 668, dw = 470
  rrect(ctx, L, dy, dw, 44, 14); ctx.fillStyle = K.paper; ctx.fill(); ctx.strokeStyle = K.ink; ctx.lineWidth = 1.4; ctx.stroke()
  text(ctx, t.coverDisclaimer, L + 18, dy + 27, { size: 13, weight: 650, color: K.ink })
  // 右边：改造后的整屋
  const px = 560, pw = PAGE.w - PAGE.margin - px, py = 92, ph = 640
  panel(ctx, px, py, pw, ph, t.coverAfter, { tone: 'ink' })
  const r = inner(px, py, pw, ph)
  const badges: RenderedSheet['badges'] = []
  if (doc.opts.threeD && rc.snap) {
    const shot = rc.snap.render(doc.after, { width: r.w, height: r.h, margin: 0.04 }, rc.restore)
    ctx.save(); rrect(ctx, r.x, r.y, r.w, r.h, 10); ctx.clip()
    ctx.drawImage(shot.canvas, r.x, r.y, r.w, r.h)
    ctx.restore()
  } else {
    const bb = planBounds(doc.after) ?? [0, 0, 1, 1]
    const x = fitFrame(frameFor(bb, r, 500), r)
    drawPlan(ctx, doc.after, x, r, { tone: 'muted' })
    drawMarks(ctx, x, rc.marks, new Set(rc.marks.map(m => m.changeId)), r)
  }
  footer(ctx, rc, index)
  return { canvas, kind: 'cover', title: t.docName, badges }
}

/* ───────── 总览 ───────── */
function overview(rc: RenderCtx, index: number): RenderedSheet {
  const { canvas, ctx } = newPage()
  const { doc } = rc, t = doc.t
  header(ctx, rc, t.overviewTitle)
  legend(ctx, rc, PAGE.w - PAGE.margin, 76, true)
  const imgW = 690
  const area = { x: BODY.x, y: BODY.y, w: imgW, h: BODY.h }
  const used = [...new Set(doc.items.map(i => i.focus.level))]
  const levels = levelsOf(doc.base).filter(l => used.includes(l.id))
  const lv = levels.length ? levels : levelsOf(doc.base).slice(0, 1)
  const badges: RenderedSheet['badges'] = []
  const gap = 14, each = (area.w - gap * (lv.length - 1)) / lv.length
  let regions = false
  const plans: { level: string; r: Rect; x: ReturnType<typeof fitFrame> }[] = []
  lv.forEach((l, i) => {
    const px = area.x + i * (each + gap)
    panel(ctx, px, area.y, each, area.h, lv.length > 1 ? (levelName(doc.base, l.id) ?? l.name) : undefined, { right: t.overviewSub })
    const r = inner(px, area.y, each, area.h)
    const view = onLevel(doc.base, l.id)
    const bb = planBounds(view) ?? planBounds(doc.base) ?? [0, 0, 1, 1]
    const items = doc.items.filter(it => it.focus.level === l.id)
    const all = boxOf([[bb[0], bb[1]], [bb[2], bb[3]], ...items.flatMap(it => [[it.focus.bbox[0], it.focus.bbox[1]], [it.focus.bbox[2], it.focus.bbox[3]]] as Vec2[])])
    const x = fitFrame(frameFor(all, r, 700), r)
    drawPlan(ctx, doc.base, x, r, { tone: 'muted', level: lv.length > 1 ? l.id : undefined, dims: true })
    drawMarks(ctx, x, rc.marks.filter(m => !m.level || lv.length < 2 || m.level === l.id), new Set(rc.marks.map(m => m.changeId)), r)
    plans.push({ level: l.id, r, x })
  })
  // 先试逐条标序号；挤（推不开或推得太远）就改成只标区域
  const trial = plans.map(p => layoutBadges(doc.items.filter(it => it.focus.level === p.level || plans.length < 2).map(it => ({ n: it.number, anchor: roomLift(doc, it, p.x.P(it.focus.anchor)) })), p.r, MIN_GAP_PX, BADGE.d / 2))
  regions = trial.some(l => !l.ok || l.maxShift > 46)
  if (!regions) {
    plans.forEach(p => placeBadges(ctx, doc.items.filter(it => it.focus.level === p.level || plans.length < 2).map(it => ({ n: it.number, anchor: roomLift(doc, it, p.x.P(it.focus.anchor)) })), p.r, badges))
  } else {
    for (const p of plans) {
      const marks: BadgeIn[] = []
      doc.sheets.forEach((sh, si) => {
        if (sh.kind !== 'detail' || !sh.items?.length || sh.page!.level !== p.level && plans.length > 1) return
        const its = sh.items
        const b = sh.page!.view === 'plan' ? sh.page!.frame : boxOf(its.flatMap(it => [[it.focus.bbox[0] - 300, it.focus.bbox[1] - 300], [it.focus.bbox[2] + 300, it.focus.bbox[3] + 300]] as Vec2[]))
        const A = p.x.P([b[0], b[1]]), B = p.x.P([b[2], b[3]])
        const x0 = Math.max(p.r.x + 3, A[0]), y0 = Math.max(p.r.y + 3, A[1]), x1 = Math.min(p.r.x + p.r.w - 3, B[0]), y1 = Math.min(p.r.y + p.r.h - 3, B[1])
        ctx.save(); rrect(ctx, x0, y0, x1 - x0, y1 - y0, 10); ctx.setLineDash([5, 4]); ctx.strokeStyle = K.ink600; ctx.lineWidth = 1.2; ctx.stroke(); ctx.restore()
        const c = labelCenter(its.map(it => p.x.P(it.focus.anchor)))
        marks.push({ n: `P${si + 1}`, anchor: c })
      })
      placeBadges(ctx, marks, p.r, badges)
    }
    text(ctx, t.overviewRegions, area.x + 16, area.y + area.h - 16, { size: 11, weight: 600, color: K.ink600 })
  }
  // 右栏：序号 + 一句话 + 在第几页
  const col = { x: BODY.x + imgW + 22, y: BODY.y + 4, w: BODY.w - imgW - 22, h: BODY.h - 4 }
  overviewList(ctx, rc, col, regions)
  footer(ctx, rc, index)
  return { canvas, kind: 'overview', title: t.overviewTitle, badges, regions }
}
/** 只改房间的条目：序号放到房间名上方，不盖住名字 */
function roomLift(doc: ExportDoc, it: ExportItem, a: Vec2): [number, number] {
  const onlyRoom = !!it.focus.room && it.focus.changeIds.every(id => doc.base.changes.find(c => c.id === id)?.type === 'room')
  return onlyRoom ? [a[0], a[1] - 30] : [a[0], a[1]]
}
const labelCenter = (pts: Vec2[]): [number, number] => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]

function overviewList(ctx: Ctx, rc: RenderCtx, r: Rect, regions: boolean) {
  const { doc } = rc, t = doc.t
  const n = doc.items.length
  // 行高按条数自适应；太多就分两列
  const twoCol = n > 16
  const cols = twoCol ? 2 : 1, perCol = Math.ceil(n / cols), cw = (r.w - (cols - 1) * 14) / cols
  const rowH = Math.min(46, Math.max(30, r.h / perCol))
  const size = rowH >= 40 ? 12.5 : rowH >= 34 ? 11.5 : 10.5
  doc.items.forEach((it, i) => {
    const c = Math.floor(i / perCol), row = i % perCol
    const x = r.x + c * (cw + 14), y = r.y + row * rowH
    // 列表里的序号用白底墨圈，和图上的墨底序号区分（列表不是图）
    badge(ctx, x + 10, y + 11, it.number, { d: 20, tone: 'white' })
    const tag = `${t.view[it.view]} · ${fill(t.overviewSee, { p: it.page })}`
    const tw = measure(ctx, tag, { size: 10, weight: 600 })
    text(ctx, tag, x + cw, y + 15, { size: 10, weight: 600, color: K.ink500, align: 'right' })
    const lockW = it.protect.length ? 16 : 0
    para(ctx, it.short, x + 28, y + 15, cw - 28 - tw - 12 - lockW, size * 1.35, { size, weight: 600, color: K.ink800 }, rowH >= 40 ? 2 : 1)
    if (it.protect.length) lockIcon(ctx, x + cw - tw - 12, y + 11, 0.8, K.ink600)
    if (row < perCol - 1 && i < n - 1) { ctx.fillStyle = K.ink100; ctx.fillRect(x + 28, y + rowH - 6, cw - 28, 1) }
  })
  if (regions) void 0
}

/* ───────── 原始结构 ───────── */
function original(rc: RenderCtx, index: number): RenderedSheet {
  const { canvas, ctx } = newPage()
  const { doc } = rc, t = doc.t
  header(ctx, rc, t.originalTitle)
  const imgW = 760
  const lv = levelsOf(doc.base)
  const gap = 14, each = (imgW - gap * (lv.length - 1)) / lv.length
  lv.forEach((l, i) => {
    const px = BODY.x + i * (each + gap)
    panel(ctx, px, BODY.y, each, BODY.h, lv.length > 1 ? l.name : undefined, { right: t.originalSub })
    const r = inner(px, BODY.y, each, BODY.h)
    const view = lv.length > 1 ? onLevel(doc.base, l.id) : doc.base
    const bb = planBounds(view) ?? [0, 0, 1, 1]
    const x = fitFrame(frameFor(bb, r, 700), r)
    drawPlan(ctx, doc.base, x, r, { tone: 'normal', level: lv.length > 1 ? l.id : undefined, dims: true })
  })
  // 右栏：墙的类型图例（只是图上的标注）
  const cx = BODY.x + imgW + 26, cw = BODY.w - imgW - 26
  let y = BODY.y + 18
  text(ctx, '墙的类型', cx, y, { size: 13, weight: 650, color: K.ink })
  y += 14
  const kinds: [string, string, (x: number, y: number) => void][] = [
    ['外墙', '石板灰实心', (x, y) => { ctx.fillStyle = K.wallExt; ctx.fillRect(x, y, 40, 14) }],
    ['承重墙', '墨色 + 斜线', (x, y) => { ctx.fillStyle = pattern(ctx, 'bearing'); ctx.fillRect(x, y, 40, 14) }],
    ['非承重墙', '中灰实心', (x, y) => { ctx.fillStyle = K.wallPart; ctx.fillRect(x, y, 40, 14) }],
    ['玻璃隔断', '天青', (x, y) => { ctx.fillStyle = K.skyFill; ctx.fillRect(x, y, 40, 14); ctx.strokeStyle = K.sky; ctx.strokeRect(x, y, 40, 14) }],
    ['矮墙', '点纹，不到顶', (x, y) => { ctx.fillStyle = pattern(ctx, 'half'); ctx.fillRect(x, y, 40, 14) }],
    ['横梁', '虚线，在头顶上方', (x, y) => { ctx.setLineDash([5, 3.5]); ctx.strokeStyle = K.ink500; ctx.strokeRect(x, y, 40, 14); ctx.setLineDash([]) }],
  ]
  const present = new Set(doc.base.walls.map(w => w.kind))
  for (const [name, how, sw] of kinds) {
    const map: Record<string, string> = { 外墙: 'exterior', 承重墙: 'bearing', 非承重墙: 'partition', 玻璃隔断: 'glass', 矮墙: 'half' }
    if (map[name] && !present.has(map[name] as never) && !(name === '矮墙' && present.has('half-glass'))) continue
    if (name === '横梁' && !doc.base.beams.length) continue
    y += 14
    sw(cx, y)
    text(ctx, name, cx + 52, y + 11, { size: 12.5, weight: 650, color: K.ink800 })
    text(ctx, how, cx + cw, y + 11, { size: 11, weight: 500, color: K.ink500, align: 'right' })
    y += 18
  }
  y += 22
  para(ctx, '墙的类型是照着原始户型图上的画法认的，只说明图上怎么标，不代表实际结构。', cx, y, cw, 18, { size: 11.5, weight: 500, color: K.ink600 }, 4)
  footer(ctx, rc, index)
  return { canvas, kind: 'original', title: t.originalTitle, badges: [] }
}

/* ───────── 细节页 ───────── */
function detailPlan(rc: RenderCtx, sheet: Sheet, index: number): RenderedSheet {
  const { canvas, ctx } = newPage()
  const { doc } = rc, t = doc.t, page = sheet.page!, items = sheet.items!
  const lvName = levelName(doc.base, page.level)
  header(ctx, rc, t.detailPlan + (lvName ? ` · ${lvName}` : ''))
  legend(ctx, rc, PAGE.w - PAGE.margin, 76)
  const { img } = DETAIL, gap = 16
  const side = doc.layout === 'side'
  const pw = side ? (img.w - gap) / 2 : img.w, ph = side ? img.h : (img.h - gap) / 2
  const strong = new Set(items.flatMap(it => it.focus.changeIds))
  const badges: RenderedSheet['badges'] = []
  const level = levelsOf(doc.base).length > 1 ? page.level : undefined
  for (const [k, which] of (['before', 'after'] as const).entries()) {
    const px = img.x + (side ? k * (pw + gap) : 0), py = img.y + (side ? 0 : k * (ph + gap))
    panel(ctx, px, py, pw, ph, which === 'before' ? t.before : t.after, { tone: which === 'after' ? 'ink' : 'plain' })
    const r = inner(px, py, pw, ph)
    const x = fitFrame(contextFrame(doc, page.frame, page.level, r), r)
    drawPlan(ctx, which === 'before' ? doc.base : doc.after, x, r, { tone: which === 'before' ? 'normal' : 'muted', level })
    drawMarks(ctx, x, rc.marks.filter(m => !level || !m.level || m.level === page.level), strong, r, which)
    placeBadges(ctx, items.map(it => ({ n: it.number, anchor: roomLift(doc, it, x.P(it.focus.anchor)) })), r, badges)
  }
  itemColumn(ctx, rc, items, DETAIL.col)
  footer(ctx, rc, index)
  return { canvas, kind: 'detail', title: t.detailPlan, badges }
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
  text(ctx, doc.t.keyPlan, r.x + 14, r.y + 22, { size: 11, weight: 650, color: K.ink600 })
  const ir = { x: r.x + 10, y: r.y + 30, w: r.w - 20, h: r.h - 40 }
  const view = levelsOf(doc.after).length > 1 ? onLevel(doc.after, level) : doc.after
  const bb = planBounds(view) ?? [0, 0, 1, 1]
  const x = fitFrame(frameFor(bb, ir, 300), ir)
  drawPlan(ctx, doc.after, x, ir, { tone: 'muted', labels: false, level: levelsOf(doc.after).length > 1 ? level : undefined })
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
  header(ctx, rc, `${isBeam ? t.detailBeam : t.detailElevation} · ${subject}`)
  legend(ctx, rc, PAGE.w - PAGE.margin, 76)
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
  const col = DETAIL.col, kh = 170
  keyPlan(ctx, rc, { x: col.x, y: col.y, w: col.w, h: kh }, page.level, { wall: isBeam ? undefined : host, poly: isBeam ? beamPoly(beamA ?? beamB) : undefined })
  itemColumn(ctx, rc, items, { x: col.x, y: col.y + kh + 18, w: col.w, h: col.h - kh - 18 })
  footer(ctx, rc, index)
  return { canvas, kind: 'detail', title: t.detailElevation, badges }
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
  header(ctx, rc, (use3d ? t.detail3d : t.detail3dSection) + ` · ${room?.name ?? stair?.name ?? '楼梯'}` + (lvName ? ` · ${lvName}` : ''))
  legend(ctx, rc, PAGE.w - PAGE.margin, 76)
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
  itemColumn(ctx, rc, items, DETAIL.col)
  footer(ctx, rc, index)
  return { canvas, kind: 'detail', title: t.detail3d, badges }
}

export async function renderSheet(rc: RenderCtx, sheet: Sheet, index: number): Promise<RenderedSheet> {
  if (sheet.decor && rc.doc.decor) {
    // 装修页：页脚中间换成装修的口吻；需要专业确认页换成管线那句
    const r = renderDecorSheet(rc.doc, rc.doc.decor, sheet.decor, index, (ctx, i, extra) => footer(ctx, rc, i, extra ?? DECOR_STRINGS.disclaimer))
    return { canvas: r.canvas, kind: sheet.kind, title: r.title, badges: r.badges, regions: r.regions }
  }
  if (sheet.kind === 'cover') return cover(rc, index)
  if (sheet.kind === 'overview') return overview(rc, index)
  if (sheet.kind === 'original') return original(rc, index)
  const v = sheet.page!.view
  if (v === 'elevation') return detailElevation(rc, sheet, index)
  if (v === '3d') return detail3d(rc, sheet, index)
  return detailPlan(rc, sheet, index)
}
