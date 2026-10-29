/**
 * 检查器里的小立面 / 小剖面：把俯视看不到的高度（窗台、洞顶、过梁、梁底、层高、飘窗台）画成正视图。
 * 单位：图上 1 单位 = 1 px（viewBox 宽 320）。
 */
import { useId } from 'react'
import type { Opening, Plan, Room, Wall } from '@/core/types'
import { DEFAULTS } from '@/core/types'
import { effectiveWallHeight, pointInPolygon } from '@/core/geometry'
import { openingsOn } from '../geom'
import { wallLength } from '@/core/geometry'
import { C } from '../canvas2d/style'

const VW = 320, VH = 136

export function WallElevation({ plan, wall, highlight, proposals = [] }: { plan: Plan; wall: Wall; highlight?: string; proposals?: Opening[] }) {
  const pid = 'e' + useId().replace(/[:«»]/g, '')
  const L = wallLength(wall), H = effectiveWallHeight(plan, wall) * 1000
  const padL = 10, padR = 46, padT = 12, padB = 24
  const s = Math.min((VW - padL - padR) / L, (VH - padT - padB) / H)
  const x0 = padL + (VW - padL - padR - L * s) / 2, fy = VH - padB
  const X = (mm: number) => x0 + mm * s, Y = (m: number) => fy - m * 1000 * s
  const low = (wall.lowHeight ?? DEFAULTS.lowHeight)
  const ops = openingsOn(plan, wall.id)
  const body = { exterior: '#dde0e5', bearing: `url(#${pid}-h)`, partition: '#eceef1', glass: '#e1f1fb', half: '#e4e6ea', 'half-glass': '#e4e6ea' }[wall.kind]
  const solidTop = wall.kind === 'half' || wall.kind === 'half-glass' ? low : H / 1000
  const hl = ops.find(o => o.id === highlight)
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="block h-auto w-full">
      <defs>
        <pattern id={`${pid}-h`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="#e3e6ea" /><rect width="2" height="7" fill="#c3c8cf" />
        </pattern>
        <clipPath id={`${pid}-c`}><rect x={X(0)} y={Y(H / 1000)} width={L * s} height={H * s} /></clipPath>
      </defs>
      {/* 墙体 */}
      <rect x={X(0)} y={Y(solidTop)} width={L * s} height={solidTop * 1000 * s} fill={body} stroke={C.ink300} strokeWidth={1} rx={1.5} />
      {(wall.kind === 'half-glass' || wall.kind === 'glass') && (
        <rect x={X(0)} y={Y(H / 1000)} width={L * s} height={(H / 1000 - (wall.kind === 'glass' ? 0 : low)) * 1000 * s} fill="#e1f1fb" stroke={C.skyLine} strokeWidth={1} rx={1.5} />
      )}
      {wall.kind === 'half' && <rect x={X(0)} y={Y(H / 1000)} width={L * s} height={(H / 1000 - low) * 1000 * s} fill="none" stroke={C.ink200} strokeDasharray="3 3" />}
      {/* 洞口 */}
      <g clipPath={`url(#${pid}-c)`}>
        {ops.map(o => <OpeningElev key={o.id} o={o} X={X} Y={Y} s={s} on={o.id === highlight} />)}
        {proposals.map(o => (
          <rect key={o.id} x={X(o.offset)} y={Y(o.head)} width={o.width * s} height={(o.head - o.sill) * 1000 * s} fill="rgb(220 212 253 / 0.75)" stroke={C.lav500} strokeWidth={1.3} strokeDasharray="4 3" />
        ))}
      </g>
      {/* 地面 */}
      <line x1={4} x2={VW - 4} y1={fy + 0.5} y2={fy + 0.5} stroke={C.ink400} strokeWidth={1.2} />
      <rect x={4} y={fy + 1} width={VW - 8} height={5} fill={`url(#${pid}-h)`} opacity={0.7} />
      {/* 右侧高度标尺 */}
      <VDim x={X(L) + 14} y0={fy} y1={Y(H / 1000)} label={(H / 1000).toFixed(2)} strong />
      {hl && hl.sill > 0.02 && <VDim x={X(hl.offset + hl.width) + 9} y0={fy} y1={Y(hl.sill)} label={hl.sill.toFixed(2)} mint />}
      {hl && <VDim x={X(L) + 34} y0={fy} y1={Y(hl.head)} label={hl.head.toFixed(2)} mint />}
      {/* 底部长度 */}
      <text x={X(L / 2)} y={VH - 6} textAnchor="middle" fontSize={10.5} fontWeight={650} fill={C.ink500} className="num">{(L / 1000).toFixed(2)} m</text>
      {/* 不在洞口上的低窗台注记 */}
      {!hl && ops.filter(o => o.sill > 0.02).map(o => (
        <text key={o.id} x={X(o.offset + o.width / 2)} y={Y(o.sill) + 11} textAnchor="middle" fontSize={9} fontWeight={700} fill={C.ink400} className="num">{o.sill.toFixed(2)}</text>
      ))}
    </svg>
  )
}

function OpeningElev({ o, X, Y, s, on }: { o: Opening; X(mm: number): number; Y(m: number): number; s: number; on: boolean }) {
  const x = X(o.offset), w = o.width * s, y = Y(o.head), h = (o.head - o.sill) * 1000 * s
  const isWin = o.kind === 'window' || o.kind === 'floor-window' || o.kind === 'bay-window'
  const stroke = on ? C.mint700 : C.ink400
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={on ? C.mint100 : isWin ? '#e9f5fc' : '#ffffff'} stroke={stroke} strokeWidth={on ? 1.6 : 1} />
      {o.kind === 'door' && o.swing && (() => {
        // 立面门：两条虚线指向铰链一侧
        const hx = o.swing.hinge === 'start' ? x : x + w, fx = o.swing.hinge === 'start' ? x + w : x
        return <path d={`M${fx} ${y + 2}L${hx} ${y + h / 2}L${fx} ${y + h - 1}`} fill="none" stroke={stroke} strokeWidth={0.9} strokeDasharray="3 2.5" />
      })()}
      {o.kind === 'sliding' && <><rect x={x + 2} y={y + 2} width={w * 0.56 - 2} height={h - 3} fill="none" stroke={stroke} strokeWidth={0.8} /><rect x={x + w * 0.44} y={y + 3.5} width={w * 0.56 - 2} height={h - 5} fill="none" stroke={stroke} strokeWidth={0.8} /></>}
      {isWin && (() => {
        let acc = 0
        const ms = (o.panes ?? []).slice(0, -1).map(p => { acc += p.width; return x + w * acc })
        return <>{ms.map((mx, i) => <line key={i} x1={mx} x2={mx} y1={y} y2={y + h} stroke={stroke} strokeWidth={0.9} />)}<line x1={x + 2} x2={x + w - 2} y1={y + h - 2} y2={y + 2} stroke={C.skyLine} strokeWidth={0.6} opacity={0.6} /></>
      })()}
    </g>
  )
}

function VDim({ x, y0, y1, label, strong, mint }: { x: number; y0: number; y1: number; label: string; strong?: boolean; mint?: boolean }) {
  const col = mint ? C.mint700 : strong ? C.ink700 : C.ink400
  return (
    <g>
      <line x1={x} x2={x} y1={y0} y2={y1} stroke={col} strokeWidth={1} />
      <line x1={x - 3} x2={x + 3} y1={y1} y2={y1} stroke={col} strokeWidth={1.2} />
      <line x1={x - 3} x2={x + 3} y1={y0} y2={y0} stroke={col} strokeWidth={1.2} />
      <g transform={`translate(${x} ${y1 - 7})`}>
        <rect x={-15} y={-7} width={30} height={14} rx={7} fill={mint ? C.ink : '#fff'} stroke={mint ? 'none' : 'rgb(22 27 36 / 0.08)'} />
        <text y={3.4} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={mint ? '#fff' : col} className="num">{label}</text>
      </g>
    </g>
  )
}

/** 房间小剖面：层高、梁、飘窗台。按房间 x 向展开，梁按其中点落在房间里的画。 */
export function RoomSection({ plan, room, highlight }: { plan: Plan; room: Room; highlight?: string }) {
  const pid = 's' + useId().replace(/[:«»]/g, '')
  const xs = room.poly.map(p => p[0]), ys = room.poly.map(p => p[1])
  const rx0 = Math.min(...xs), rx1 = Math.max(...xs), ry0 = Math.min(...ys), ry1 = Math.max(...ys)
  const Wm = rx1 - rx0, H = room.ceiling ?? plan.ceiling, F = room.floorOffset ?? 0
  const padL = 12, padR = 50, padT = 16, padB = 22
  const s = Math.min((VW - padL - padR - 20) / Wm, (VH - padT - padB - 10) / (H * 1000 + 200))
  const x0 = padL + 10 + (VW - padL - padR - 20 - Wm * s) / 2, fy = VH - padB
  const X = (mm: number) => x0 + (mm - rx0) * s, Y = (m: number) => fy - m * 1000 * s
  const beams = plan.beams.filter(b => pointInPolygon([(b.a[0] + b.b[0]) / 2, (b.a[1] + b.b[1]) / 2], room.poly) || b.id === highlight)
  const slab = 9
  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} className="block h-auto w-full">
      <defs>
        <pattern id={`${pid}-h`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#e3e6ea" /><rect width="2" height="7" fill="#c3c8cf" /></pattern>
      </defs>
      {/* 楼板 + 两侧墙 */}
      <rect x={X(rx0) - 10} y={Y(H) - slab} width={Wm * s + 20} height={slab} fill={`url(#${pid}-h)`} stroke={C.ink300} strokeWidth={0.8} />
      <rect x={X(rx0) - 10} y={fy} width={Wm * s + 20} height={6} fill={`url(#${pid}-h)`} />
      <rect x={X(rx0) - 10} y={Y(H)} width={10} height={H * 1000 * s} fill="#dde0e5" stroke={C.ink300} strokeWidth={0.8} />
      <rect x={X(rx1)} y={Y(H)} width={10} height={H * 1000 * s} fill="#dde0e5" stroke={C.ink300} strokeWidth={0.8} />
      <rect x={X(rx0)} y={Y(H)} width={Wm * s} height={H * 1000 * s} fill="#ffffff" />
      {F > 0 && <rect x={X(rx0)} y={Y(F)} width={Wm * s} height={F * 1000 * s} fill={C.mint100} stroke={C.mint500} strokeWidth={1} />}
      {beams.map(b => {
        const along = Math.abs(b.b[0] - b.a[0]) > Math.abs(b.b[1] - b.a[1])
        const on = b.id === highlight
        const bx0 = along ? Math.max(rx0, Math.min(b.a[0], b.b[0])) : b.a[0] - b.width / 2
        const bx1 = along ? Math.min(rx1, Math.max(b.a[0], b.b[0])) : b.a[0] + b.width / 2
        return (
          <g key={b.id}>
            <rect x={X(bx0)} y={Y(H)} width={Math.max(4, (bx1 - bx0) * s)} height={(H - b.bottom) * 1000 * s} fill={on ? C.mint300 : '#d6d9de'} stroke={on ? C.mint700 : C.ink400} strokeWidth={1} strokeDasharray={along ? '4 2' : undefined} />
            <text x={X((bx0 + bx1) / 2)} y={Y(b.bottom) + 11} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={on ? C.mint700 : C.ink500} className="num">{b.bottom.toFixed(2)}</text>
          </g>
        )
      })}
      <line x1={X(rx0)} x2={X(rx1)} y1={fy + 0.5} y2={fy + 0.5} stroke={C.ink400} strokeWidth={1.2} />
      <VDim x={X(rx1) + 26} y0={fy} y1={Y(H)} label={H.toFixed(2)} strong />
      {F > 0 && <VDim x={X(rx0) + 20} y0={fy} y1={Y(F)} label={F.toFixed(2)} mint />}
      <text x={X((rx0 + rx1) / 2)} y={VH - 6} textAnchor="middle" fontSize={10.5} fontWeight={650} fill={C.ink500} className="num">{(Wm / 1000).toFixed(2)} m · {((ry1 - ry0) / 1000).toFixed(2)} m</text>
    </svg>
  )
}
