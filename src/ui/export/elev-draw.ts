/**
 * 立面和剖面：讲俯视看不到的高度（门窗离地 / 洞顶、墙是实墙还是玻璃 / 矮墙、梁底、层高、地面高差）。
 * 改之前 / 改之后用同一个比例，高度直接可比。
 */
import type { Opening, Plan, Room, Wall } from '@/core/types'
import { DEFAULTS } from '@/core/types'
import { effectiveWallHeight, pointInPolygon, roomCeiling, wallLength } from '@/core/geometry'
import { K, NUM, pattern, text, vdim, type Ctx } from './canvas'
import type { Rect } from './plan-draw'

export interface ElevMark { id: string; op: 'add' | 'remove' | 'modify' }
export interface ElevXf { X(s: number): number; Y(z: number): number; s: number }

const isWin = (o: Opening) => o.kind === 'window' || o.kind === 'floor-window' || o.kind === 'bay-window'

/** 两张立面共用的比例：长 L(mm)、高 H(m) 放进 r */
export function elevScale(r: Rect, L: number, H: number, padL = 30, padR = 120, padT = 26, padB = 44): ElevXf {
  const s = Math.min((r.w - padL - padR) / L, (r.h - padT - padB) / (H * 1000))
  const x0 = r.x + padL + (r.w - padL - padR - L * s) / 2, fy = r.y + r.h - padB
  return { s, X: mm => x0 + mm * s, Y: m => fy - m * 1000 * s }
}

/** 一面墙的立面。marks：本页讲的洞口 / 墙（op 决定画法）；side 决定「改之前 / 改之后」的标法 */
export function drawWallElevation(ctx: Ctx, r: Rect, plan: Plan, wall: Wall, xf: ElevXf, marks: ElevMark[], side: 'before' | 'after') {
  const L = wallLength(wall), H = effectiveWallHeight(plan, wall)
  const { X, Y, s } = xf
  const low = wall.lowHeight ?? DEFAULTS.lowHeight
  const ops = plan.openings.filter(o => o.wall === wall.id).sort((a, b) => a.offset - b.offset)
  const markOf = (id: string) => marks.find(m => m.id === id)
  const wallMark = markOf(wall.id)
  ctx.save()
  // 地面
  const gx0 = X(0) - 18, gx1 = X(L) + 18, fy = Y(0)
  ctx.fillStyle = pattern(ctx, 'ground'); ctx.fillRect(gx0, fy, gx1 - gx0, 7)
  ctx.strokeStyle = K.ink600; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(gx0, fy); ctx.lineTo(gx1, fy); ctx.stroke()
  // 墙体
  const solidTop = wall.kind === 'half' || wall.kind === 'half-glass' ? low : wall.kind === 'glass' ? 0 : H
  const body: string | CanvasPattern = wall.kind === 'bearing' ? pattern(ctx, 'bearingMuted') : wall.kind === 'exterior' ? '#e1e4e8' : '#eef0f2'
  if (solidTop > 0) { ctx.fillStyle = body; ctx.fillRect(X(0), Y(solidTop), L * s, solidTop * 1000 * s); ctx.strokeStyle = K.ink400; ctx.lineWidth = 1; ctx.strokeRect(X(0), Y(solidTop), L * s, solidTop * 1000 * s) }
  if (wall.kind === 'glass' || wall.kind === 'half-glass') {
    const z0 = wall.kind === 'glass' ? 0 : low
    ctx.fillStyle = K.skyFill; ctx.fillRect(X(0), Y(H), L * s, (H - z0) * 1000 * s)
    ctx.strokeStyle = K.sky; ctx.lineWidth = 1.1; ctx.strokeRect(X(0), Y(H), L * s, (H - z0) * 1000 * s)
    // 玻璃的斜反光
    ctx.save(); ctx.beginPath(); ctx.rect(X(0), Y(H), L * s, (H - z0) * 1000 * s); ctx.clip()
    ctx.strokeStyle = 'rgba(79,163,216,0.45)'; ctx.lineWidth = 0.8
    for (let x = X(0) - 200; x < X(L); x += 46) { ctx.beginPath(); ctx.moveTo(x, Y(z0)); ctx.lineTo(x + 34, Y(H)); ctx.stroke() }
    ctx.restore()
  }
  if (wall.kind === 'half') { ctx.setLineDash([4, 3]); ctx.strokeStyle = K.ink300; ctx.lineWidth = 0.9; ctx.strokeRect(X(0), Y(H), L * s, (H - low) * 1000 * s); ctx.setLineDash([]) }
  // 洞口
  for (const o of ops) {
    const x = X(o.offset), w = o.width * s, y = Y(o.head), h = (o.head - o.sill) * 1000 * s
    const mk = markOf(o.id)
    ctx.fillStyle = isWin(o) ? '#eef7fd' : K.paper
    ctx.fillRect(x, y, w, h)
    ctx.strokeStyle = K.ink600; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h)
    openingGlyph(ctx, o, x, y, w, h)
    if (mk) {
      if (side === 'before') {
        if (mk.op === 'remove') { ctx.fillStyle = pattern(ctx, 'coral'); ctx.fillRect(x, y, w, h); ctx.setLineDash([4, 2.6]); ctx.strokeStyle = K.coral; ctx.lineWidth = 1.8; ctx.strokeRect(x, y, w, h) }
        else { ctx.setLineDash([3.5, 2.5]); ctx.strokeStyle = K.ink; ctx.lineWidth = 1.5; ctx.strokeRect(x - 2, y - 2, w + 4, h + 4) }
        ctx.setLineDash([])
      } else {
        ctx.strokeStyle = K.paper; ctx.lineWidth = 5; ctx.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5)
        ctx.strokeStyle = K.cobalt; ctx.lineWidth = 2.2; ctx.strokeRect(x - 2.5, y - 2.5, w + 5, h + 5)
      }
    }
  }
  if (wallMark) {
    const y = Y(H), h = H * 1000 * s
    if (side === 'before') { ctx.setLineDash([3.5, 2.5]); ctx.strokeStyle = K.ink; ctx.lineWidth = 1.5; ctx.strokeRect(X(0) - 3, y - 3, L * s + 6, h + 6); ctx.setLineDash([]) }
    else { ctx.strokeStyle = K.cobalt; ctx.lineWidth = 2.4; ctx.strokeRect(X(0) - 3, y - 3, L * s + 6, h + 6) }
  }
  // 标注：墙高（右侧），本页洞口的离地 / 洞顶 / 洞宽
  vdim(ctx, X(L) + 22, fy, Y(H), `${H.toFixed(2)} m`, { strong: true })
  if (wall.kind === 'half' || wall.kind === 'half-glass') vdim(ctx, X(L) + 22 + 74, fy, Y(low), `${low.toFixed(2)} m`, { color: side === 'after' && wallMark ? K.cobaltDeep : K.ink600 })
  const tone = side === 'after' ? K.cobaltDeep : K.ink700
  for (const o of ops) {
    if (!markOf(o.id)) continue
    const x = X(o.offset), w = o.width * s
    vdim(ctx, x + w + 9, fy, Y(o.head), `${o.head.toFixed(2)}`, { color: tone })
    if (o.sill > 0.02) vdim(ctx, x - 9, fy, Y(o.sill), `${o.sill.toFixed(2)}`, { color: tone, side: 'left' })
    // 洞宽
    const yy = Y(o.head) - 12
    ctx.strokeStyle = tone; ctx.lineWidth = 0.9
    ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.moveTo(x, yy - 4); ctx.lineTo(x, yy + 4); ctx.moveTo(x + w, yy - 4); ctx.lineTo(x + w, yy + 4); ctx.stroke()
    const lab = `${Math.round(o.width)}`
    ctx.font = `700 10px ${NUM}`
    const tw = ctx.measureText(lab).width + 10
    ctx.fillStyle = K.paper; ctx.fillRect(x + w / 2 - tw / 2, yy - 7, tw, 14)
    text(ctx, lab, x + w / 2, yy + 3.6, { size: 10, weight: 700, family: NUM, align: 'center', color: tone })
  }
  // 长度
  text(ctx, `${(L / 1000).toFixed(2)} m`, X(L / 2), fy + 26, { size: 11, weight: 650, family: NUM, align: 'center', color: K.ink500 })
  ctx.restore()
}

function openingGlyph(ctx: Ctx, o: Opening, x: number, y: number, w: number, h: number) {
  ctx.save()
  ctx.strokeStyle = K.ink500; ctx.lineWidth = 0.8
  if (o.kind === 'door' && o.swing) {
    const hx = o.swing.hinge === 'start' ? x : x + w, fx = o.swing.hinge === 'start' ? x + w : x
    ctx.setLineDash([3, 2.5]); ctx.beginPath(); ctx.moveTo(fx, y + 2); ctx.lineTo(hx, y + h / 2); ctx.lineTo(fx, y + h - 1); ctx.stroke()
  } else if (o.kind === 'sliding') {
    ctx.strokeRect(x + 2, y + 2, w * 0.56 - 2, h - 3); ctx.strokeRect(x + w * 0.44, y + 3.5, w * 0.56 - 2, h - 5)
  } else if (isWin(o)) {
    let acc = 0
    for (const p of (o.panes ?? []).slice(0, -1)) { acc += p.width; ctx.beginPath(); ctx.moveTo(x + w * acc, y); ctx.lineTo(x + w * acc, y + h); ctx.stroke() }
    ctx.strokeStyle = 'rgba(79,163,216,0.7)'; ctx.beginPath(); ctx.moveTo(x + 3, y + h - 3); ctx.lineTo(x + Math.min(w, h) * 0.5, y + h - 3 - Math.min(w, h) * 0.5 + 6); ctx.stroke()
  } else if (o.kind === 'open-balcony') {
    ctx.beginPath(); ctx.moveTo(x, Y1(y, h, 0.6)); ctx.lineTo(x + w, Y1(y, h, 0.6)); ctx.stroke()
  }
  ctx.restore()
}
const Y1 = (y: number, h: number, f: number) => y + h * (1 - f)

/** 横梁的立面（梁没有宿主墙）：沿梁长画梁底到顶面的一条 */
export function drawBeamElevation(ctx: Ctx, plan: Plan, beamId: string, xf: ElevXf, L: number, mark: ElevMark | null, side: 'before' | 'after') {
  const b = plan.beams.find(x => x.id === beamId)
  const mid: [number, number] = b ? [(b.a[0] + b.b[0]) / 2, (b.a[1] + b.b[1]) / 2] : [0, 0]
  const room = plan.rooms.find(r => pointInPolygon(mid, r.poly))
  const H = room ? roomCeiling(plan, room) : plan.ceiling
  const { X, Y } = xf, fy = Y(0)
  ctx.save()
  ctx.fillStyle = pattern(ctx, 'ground'); ctx.fillRect(X(0) - 18, fy, L * xf.s + 36, 7)
  ctx.strokeStyle = K.ink600; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(X(0) - 18, fy); ctx.lineTo(X(L) + 18, fy); ctx.stroke()
  // 顶板
  ctx.fillStyle = pattern(ctx, 'bearingMuted'); ctx.fillRect(X(0) - 18, Y(H) - 9, L * xf.s + 36, 9)
  ctx.strokeStyle = K.ink400; ctx.lineWidth = 1; ctx.strokeRect(X(0) - 18, Y(H) - 9, L * xf.s + 36, 9)
  if (b) {
    const y = Y(H), h = (H - b.bottom) * 1000 * xf.s
    ctx.fillStyle = '#dfe2e6'; ctx.fillRect(X(0), y, L * xf.s, h)
    ctx.strokeStyle = K.ink500; ctx.lineWidth = 1; ctx.strokeRect(X(0), y, L * xf.s, h)
    if (mark) {
      if (side === 'before') { ctx.setLineDash(mark.op === 'remove' ? [4, 2.6] : [3.5, 2.5]); ctx.strokeStyle = mark.op === 'remove' ? K.coral : K.ink; ctx.lineWidth = 1.6; if (mark.op === 'remove') { ctx.fillStyle = pattern(ctx, 'coral'); ctx.fillRect(X(0), y, L * xf.s, h) } ctx.strokeRect(X(0) - 2, y - 2, L * xf.s + 4, h + 4); ctx.setLineDash([]) }
      else { ctx.strokeStyle = K.cobalt; ctx.lineWidth = 2.2; ctx.strokeRect(X(0) - 2, y - 2, L * xf.s + 4, h + 4) }
    }
    vdim(ctx, X(L * 0.5), fy, Y(b.bottom), `${b.bottom.toFixed(2)} m`, { color: side === 'after' && mark ? K.cobaltDeep : K.ink700, prefix: '梁底' })
  } else if (mark && side === 'after') {
    text(ctx, '梁已拆除', X(L / 2), Y(H) + 30, { size: 12, weight: 650, align: 'center', color: K.coralDeep })
  }
  vdim(ctx, X(L) + 22, fy, Y(H), `${H.toFixed(2)} m`, { strong: true })
  text(ctx, `${(L / 1000).toFixed(2)} m`, X(L / 2), fy + 26, { size: 11, weight: 650, family: NUM, align: 'center', color: K.ink500 })
  ctx.restore()
}

/** 房间剖面：改之后实线，改之前不同的地方用墨色虚线叠上，数字写「前 → 后」 */
export function drawRoomSection(ctx: Ctx, r: Rect, before: Plan, after: Plan, roomId: string): { anchor: [number, number] } | null {
  const ra = after.rooms.find(x => x.id === roomId), rb = before.rooms.find(x => x.id === roomId)
  const room: Room | undefined = ra ?? rb
  if (!room) return null
  const xs = room.poly.map(p => p[0]), ys = room.poly.map(p => p[1])
  const wide = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys)
  const span = wide ? Math.max(...xs) - Math.min(...xs) : Math.max(...ys) - Math.min(...ys)
  const Ha = ra ? roomCeiling(after, ra) : 0, Hb = rb ? roomCeiling(before, rb) : 0
  const Fa = ra?.floorOffset ?? 0, Fb = rb?.floorOffset ?? 0
  const Hmax = Math.max(Ha + Math.max(0, Fa) * 0, Hb, 0.5) + 0.25
  const xf = elevScale(r, span, Hmax, 70, 150, 30, 40)
  const { X, Y } = xf, fy = Y(0)
  ctx.save()
  // 楼板和两侧墙
  ctx.fillStyle = pattern(ctx, 'ground'); ctx.fillRect(X(0) - 22, fy, span * xf.s + 44, 8)
  ctx.strokeStyle = K.ink600; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(X(0) - 22, fy); ctx.lineTo(X(span) + 22, fy); ctx.stroke()
  const H = ra ? Ha : Hb
  ctx.fillStyle = '#d5d9de'
  ctx.fillRect(X(0) - 12, Y(H), 12, H * 1000 * xf.s); ctx.fillRect(X(span), Y(H), 12, H * 1000 * xf.s)
  ctx.fillStyle = pattern(ctx, 'bearingMuted'); ctx.fillRect(X(0) - 22, Y(H) - 10, span * xf.s + 44, 10)
  ctx.strokeStyle = K.ink400; ctx.lineWidth = 1; ctx.strokeRect(X(0) - 22, Y(H) - 10, span * xf.s + 44, 10)
  // 地面抬高 / 降板
  if (Fa) {
    ctx.fillStyle = Fa > 0 ? 'rgba(75,118,242,0.16)' : K.paper
    const y0 = Y(Math.max(0, Fa)), h = Math.abs(Fa) * 1000 * xf.s
    ctx.fillRect(X(0), y0, span * xf.s, h); ctx.strokeStyle = K.cobalt; ctx.lineWidth = 2; ctx.strokeRect(X(0), y0, span * xf.s, h)
  }
  // 梁
  for (const b of after.beams) {
    const mid: [number, number] = [(b.a[0] + b.b[0]) / 2, (b.a[1] + b.b[1]) / 2]
    if (!pointInPolygon(mid, room.poly)) continue
    const along = wide ? Math.abs(b.b[0] - b.a[0]) > Math.abs(b.b[1] - b.a[1]) : Math.abs(b.b[1] - b.a[1]) > Math.abs(b.b[0] - b.a[0])
    const o = wide ? Math.min(...xs) : Math.min(...ys)
    const c = (wide ? mid[0] : mid[1]) - o
    const x0 = along ? 0 : c - b.width / 2, x1 = along ? span : c + b.width / 2
    ctx.fillStyle = '#dfe2e6'; ctx.fillRect(X(x0), Y(H), (x1 - x0) * xf.s, (H - b.bottom) * 1000 * xf.s)
    ctx.strokeStyle = K.ink500; ctx.lineWidth = 0.9; ctx.strokeRect(X(x0), Y(H), (x1 - x0) * xf.s, (H - b.bottom) * 1000 * xf.s)
  }
  // 改之前不同的层高：墨色虚线
  if (rb && Math.abs(Hb - Ha) > 0.004) {
    ctx.setLineDash([5, 3.5]); ctx.strokeStyle = K.ink; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(X(0) - 22, Y(Hb)); ctx.lineTo(X(span) + 22, Y(Hb)); ctx.stroke(); ctx.setLineDash([])
    text(ctx, `改之前 ${Hb.toFixed(2)} m`, X(0) - 26, Y(Hb) + 3.6, { size: 10.5, weight: 650, align: 'right', color: K.ink700 })
  }
  if (rb && Math.abs(Fb - Fa) > 0.004 && Fb) {
    ctx.setLineDash([5, 3.5]); ctx.strokeStyle = K.ink; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(X(0), Y(Fb)); ctx.lineTo(X(span), Y(Fb)); ctx.stroke(); ctx.setLineDash([])
    text(ctx, `改之前 ${Fb.toFixed(2)} m`, X(span / 2), Y(Fb) - 6, { size: 10.5, weight: 650, color: K.ink700, align: 'center' })
  }
  // 改之后的顶：钴蓝实线
  if (ra) { ctx.strokeStyle = K.cobalt; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(X(0), Y(Ha)); ctx.lineTo(X(span), Y(Ha)); ctx.stroke() }
  const lab = (a: number, b: number) => Math.abs(a - b) > 0.004 ? `${b.toFixed(2)} → ${a.toFixed(2)} m` : `${a.toFixed(2)} m`
  vdim(ctx, X(span) + 30, fy, Y(Ha), lab(Ha, Hb), { strong: true, prefix: '层高' })
  if (Fa || Fb) vdim(ctx, X(0) - 30, fy, Y(Math.max(Fa, Fb)), lab(Fa, Fb), { color: K.cobaltDeep, prefix: '地面', side: 'left' })
  text(ctx, room.name, X(span / 2), Y(H) + 26, { size: 13, weight: 650, align: 'center', color: K.ink700 })
  text(ctx, `${(span / 1000).toFixed(2)} m`, X(span / 2), fy + 26, { size: 11, weight: 650, family: NUM, align: 'center', color: K.ink500 })
  ctx.restore()
  return { anchor: [X(span / 2), Y(Math.max(Ha, Hb) * 0.62)] }
}
