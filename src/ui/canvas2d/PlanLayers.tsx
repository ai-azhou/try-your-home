/**
 * 平面图的 SVG 内容（平面坐标 mm）。线宽、字号按屏幕像素写，除以缩放 k。
 * 画法规格见 docs/design.md §5。
 */
import { memo, useMemo, type ReactNode } from 'react'
import type { Column, Opening, Plan, Room, Shaft, Stair, Vec2, Void, Wall, WallKind } from '@/core/types'
import { PROTECTED_KINDS } from '@/core/types'
import { beamFootprint, columnFootprint, labelPoint, planBounds, polygonArea, wallFootprint, wallLength, wallNormal, wallTangent, pointAt } from '@/core/geometry'
import { fmtLen, isArc, len2, mid, polyPath, segmentRect, spanOf } from '../geom'
import { openingPath, openingSymbol } from '@/core/opening-symbol'
import type { Diff, Ref } from '../model'
import type { Layers, Mode } from '../store'
import { multiPolyPath, wallGroups, wallSolidPolys, withJoinedCorners } from '../render-plan'
import { C } from './style'
import type { RoomLabelLayout } from './labels'

export interface LayerProps {
  plan: Plan
  base: Plan
  diff: Diff | null
  mode: Mode
  k: number
  pid: string
  sel: Ref[]
  hover: Ref | null
  layers: Layers
  mini?: boolean
  certainty: boolean
  lang: 'zh' | 'en'
  labels: { sqm: string; ceiling: string; entry: string; platform: string }
  /** 房间标签排布（canvas2d/labels：避让问题针、互不压字、放不下改悬停显示） */
  roomLabels?: Map<string, RoomLabelLayout> | null
  /** 问题针位置（平面 mm）：入户标签要让开 */
  pins?: Vec2[]
  /** 测距时不画选中构件的尺寸胶囊（免得和测距胶囊叠在一起） */
  hideSelDims?: boolean
  /** 装修态（decor/PlanDecor）：地面材料、柜子、造型画在墙下；家具、嵌入缺口、色带、选中画在门窗上 */
  decorUnder?: ReactNode
  decorOver?: ReactNode
}

const has = (list: Ref[], id: string) => list.some(r => r.id === id)

function fillFor(kind: WallKind, muted: boolean, pid: string) {
  if (kind === 'bearing') return `url(#${pid}-bearing${muted ? '-m' : ''})`
  if (kind === 'half' || kind === 'half-glass') return `url(#${pid}-half${muted ? '-m' : ''})`
  const solid: Record<string, [string, string]> = { exterior: ['#3c424b', '#b9bec6'], partition: ['#adb3bc', '#d6d9de'], glass: ['#c7e6f8', '#e4eef4'] }
  return solid[kind][muted ? 1 : 0]
}

export function Defs({ pid }: { pid: string }) {
  return (
    <defs>
      <pattern id={`${pid}-bearing`} width="70" height="70" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="70" height="70" fill="#1f232a" /><rect width="16" height="70" fill="#4a515c" />
      </pattern>
      <pattern id={`${pid}-bearing-m`} width="70" height="70" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="70" height="70" fill="#a9aeb6" /><rect width="16" height="70" fill="#c3c7cd" />
      </pattern>
      <pattern id={`${pid}-half`} width="48" height="48" patternUnits="userSpaceOnUse">
        <rect width="48" height="48" fill="#dfe2e7" /><circle cx="24" cy="24" r="9" fill="#959ba4" />
      </pattern>
      <pattern id={`${pid}-half-m`} width="48" height="48" patternUnits="userSpaceOnUse">
        <rect width="48" height="48" fill="#eaecef" /><circle cx="24" cy="24" r="8" fill="#c6cad0" />
      </pattern>
      <pattern id={`${pid}-platform`} width="120" height="120" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="120" height="120" fill="#f6f7f9" /><rect width="10" height="120" fill="#e3e6ea" />
      </pattern>
      <pattern id={`${pid}-coral`} width="90" height="90" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
        <rect width="90" height="90" fill="#fff4f2" /><rect width="26" height="90" fill="#fbcfc8" />
      </pattern>
      <pattern id={`${pid}-lemon`} width="90" height="90" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="90" height="90" fill="rgb(226 238 110 / 0.18)" /><rect width="28" height="90" fill="rgb(212 227 72 / 0.55)" />
      </pattern>
      <pattern id={`${pid}-lav`} width="90" height="90" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
        <rect width="90" height="90" fill="rgb(235 231 254 / 0.9)" /><rect width="26" height="90" fill="rgb(195 182 251 / 0.9)" />
      </pattern>
      <pattern id={`${pid}-shaft`} width="80" height="80" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="80" height="80" fill="#ffffff" /><rect width="14" height="80" fill="#3c424b" />
      </pattern>
      <pattern id={`${pid}-shaft-m`} width="80" height="80" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="80" height="80" fill="#ffffff" /><rect width="12" height="80" fill="#c3c7cd" />
      </pattern>
      {/* 平面像一块白模放在灰台面上：两层投影 */}
      <filter id={`${pid}-slab`} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
        <feDropShadow dx="0" dy="60" stdDeviation="160" floodColor="#1c2434" floodOpacity="0.16" />
        <feDropShadow dx="0" dy="10" stdDeviation="22" floodColor="#1c2434" floodOpacity="0.10" />
      </filter>
    </defs>
  )
}

/* ───────── 门窗符号 ───────── */
function arcSweep(c: Vec2, from: Vec2, to: Vec2) {
  const ax = from[0] - c[0], ay = from[1] - c[1], bx = to[0] - c[0], by = to[1] - c[1]
  return ax * by - ay * bx > 0 ? 1 : 0
}
const shift = (poly: Vec2[], n: Vec2, d: number): Vec2[] => poly.map(p => [p[0] + n[0] * d, p[1] + n[1] * d])
/** 沿墙 [s0, s1] 偏离中心线 d 的一条线：直墙两点，弧墙按弧长细分（窗的墙面线、玻璃中线都沿弧画） */
function along(w: Wall, s0: number, s1: number, d: number): string {
  const n = isArc(w) ? Math.max(2, Math.ceil(Math.abs(s1 - s0) / 60)) : 1
  let out = ''
  for (let i = 0; i <= n; i++) {
    const s = s0 + (s1 - s0) * i / n, p = pointAt(w, s), tg = wallTangent(w, s)
    out += `${i ? 'L' : 'M'}${(p[0] - tg[1] * d).toFixed(1)} ${(p[1] + tg[0] * d).toFixed(1)}`
  }
  return out
}

function OpeningSymbol({ plan, o, k, tone = 'ink', label, hideTag, pins }: { plan: Plan; o: Opening; k: number; tone?: 'ink' | 'muted' | 'cobalt' | 'coral' | 'lav'; label?: string; hideTag?: boolean; pins?: Vec2[] }) {
  const s = spanOf(plan, o)
  if (!s) return null
  const w = s.wall, t = w.thickness, n = s.normal
  const ink = { ink: C.ink, muted: C.ink300, cobalt: C.cobalt500, coral: C.coral500, lav: C.lav500 }[tone]
  const thin = { ink: C.ink400, muted: C.ink200, cobalt: C.cobalt400, coral: C.coral300, lav: C.lav300 }[tone]
  const glassLine = tone === 'ink' ? C.skyLine : ink
  const px = (v: number) => v / k
  const gap = segmentRect(w, o.offset, o.offset + o.width)
  const parts: ReactNode[] = []
  const threshold = tone === 'coral' ? 'none' : C.paper
  parts.push(<path key="gap" d={polyPath(gap)} fill={threshold} />)

  if (isArc(w) && o.kind !== 'doorway' && o.kind !== 'open-balcony') {
    // 弧墙上的门窗（D6 B9）：core openingSymbol 给沿弧的 path / edges / 扇间 divisions / leaves；只在扇和扇交界画分隔，细分点不是框
    let sym: ReturnType<typeof openingSymbol> | null = null
    try { sym = openingSymbol(plan, o.id, { doorAngle: 90 }) } catch { /* 墙不在了 */ }
    if (sym) {
      const pl = (pts: Vec2[]) => pts.map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('')
      if (o.kind === 'door') {
        sym.leaves.forEach((lf, i) => {
          const h = lf.hinge ?? lf.path[0], tip = len2(lf.path[0], h) > len2(lf.path.at(-1)!, h) ? lf.path[0] : lf.path.at(-1)!
          const closedS = Math.abs(len2(pointAt(w, lf.s[0]), h)) < 1 ? lf.s[1] : lf.s[0], closed = pointAt(w, closedS), r = len2(tip, h)
          parts.push(<path key={`as${i}`} d={`M${h[0]} ${h[1]}L${tip[0]} ${tip[1]}A${r} ${r} 0 0 ${arcSweep(h, tip, closed)} ${closed[0]} ${closed[1]}Z`} fill={tone === 'ink' ? 'rgb(22 25 30 / 0.035)' : 'none'} stroke="none" />)
          parts.push(<path key={`aa${i}`} d={`M${tip[0]} ${tip[1]}A${r} ${r} 0 0 ${arcSweep(h, tip, closed)} ${closed[0]} ${closed[1]}`} fill="none" stroke={thin} strokeWidth={px(1)} />)
          parts.push(<path key={`al${i}`} d={pl(lf.path)} fill="none" stroke={ink} strokeWidth={px(2.4)} strokeLinecap="round" strokeLinejoin="round" />)
          parts.push(<circle key={`ah${i}`} cx={h[0]} cy={h[1]} r={px(2.2)} fill={ink} />)
        })
      } else {
        parts.push(<path key="g" d={polyPath(gap)} fill={tone === 'ink' ? C.skyFill : 'none'} />)
        for (const [i, e] of sym.edges.entries()) parts.push(<path key={`ae${i}`} d={pl(e)} fill="none" stroke={thin} strokeWidth={px(1)} />)
        if (o.kind === 'sliding') {
          // 推拉：每扇一条沿弧的窄条，前后错开（和直墙同一个画法）
          const th = Math.max(t * 0.24, 22)
          sym.leaves.forEach((lf, i) => {
            const d = (i % 2 ? -1 : 1) * t * 0.17, ov = (lf.s[1] - lf.s[0]) * 0.06
            const a0 = Math.max(o.offset, lf.s[0] - ov), a1 = Math.min(o.offset + o.width, lf.s[1] + ov)
            parts.push(<path key={`ap${i}`} d={polyPath([...openingPath(w, a0, a1, d + th / 2), ...openingPath(w, a0, a1, d - th / 2).reverse()])} fill={C.paper} stroke={ink} strokeWidth={px(1.2)} />)
          })
        } else {
          const centers = o.kind === 'floor-window' ? [-t * 0.12, t * 0.12] : [0]
          for (const d of centers) parts.push(<path key={`ac${d}`} d={pl(openingPath(w, o.offset, o.offset + o.width, d))} fill="none" stroke={glassLine} strokeWidth={px(1.6)} />)
          if (o.kind === 'bay-window') parts.push(<path key="bay" d={pl(openingPath(w, o.offset, o.offset + o.width, t / 2 + 40))} fill="none" stroke={thin} strokeWidth={px(1)} strokeDasharray={`${px(3)} ${px(2)}`} />)
        }
        sym.divisions.forEach(([a, b], i) => parts.push(<path key={`ad${i}`} data-division={o.id} d={`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`} stroke={thin} strokeWidth={px(1)} />))
      }
      return <g data-curved-opening={o.id} data-leaves={sym.leaves.length}>{parts}</g>
    }
  }
  if (o.kind === 'door' && o.swing) {
    const side = o.swing.side
    const hinge = o.swing.hinge === 'start' ? s.a : s.b, other = o.swing.hinge === 'start' ? s.b : s.a
    const hf: Vec2 = [hinge[0] + n[0] * side * t / 2, hinge[1] + n[1] * side * t / 2]
    const of: Vec2 = [other[0] + n[0] * side * t / 2, other[1] + n[1] * side * t / 2]
    const leaf: Vec2 = [hf[0] + n[0] * side * o.width, hf[1] + n[1] * side * o.width]
    const sw = arcSweep(hf, leaf, of)
    parts.push(<path key="sector" d={`M${hf[0]} ${hf[1]}L${leaf[0]} ${leaf[1]}A${o.width} ${o.width} 0 0 ${sw} ${of[0]} ${of[1]}Z`}
      fill={tone === 'ink' ? 'rgb(22 25 30 / 0.035)' : 'none'} stroke="none" />)
    parts.push(<path key="arc" d={`M${leaf[0]} ${leaf[1]}A${o.width} ${o.width} 0 0 ${sw} ${of[0]} ${of[1]}`} fill="none" stroke={thin} strokeWidth={px(1)} />)
    parts.push(<path key="leaf" d={`M${hf[0]} ${hf[1]}L${leaf[0]} ${leaf[1]}`} stroke={ink} strokeWidth={px(2.4)} strokeLinecap="round" />)
    parts.push(<circle key="h" cx={hf[0]} cy={hf[1]} r={px(2.2)} fill={ink} />)
  } else if (o.kind === 'sliding') {
    const th = Math.max(t * 0.24, 22)
    const r1 = shift(segmentRect(w, o.offset, o.offset + o.width * 0.56, th), n, t * 0.17)
    const r2 = shift(segmentRect(w, o.offset + o.width * 0.44, o.offset + o.width, th), n, -t * 0.17)
    parts.push(<path key="p1" d={polyPath(r1)} fill={C.paper} stroke={ink} strokeWidth={px(1.2)} />)
    parts.push(<path key="p2" d={polyPath(r2)} fill={C.paper} stroke={ink} strokeWidth={px(1.2)} />)
  } else if (o.kind === 'doorway') {
    for (const d of [-t / 2, t / 2]) parts.push(<path key={`l${d}`} d={along(w, o.offset, o.offset + o.width, d)} fill="none" stroke={thin} strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} />)
  } else if (o.kind === 'open-balcony') {
    parts.push(<path key="rail" d={along(w, o.offset, o.offset + o.width, 0)} fill="none" stroke={ink} strokeWidth={px(1.4)} strokeDasharray={`${px(1)} ${px(5)}`} strokeLinecap="round" />)
  } else {
    // 窗：两条墙面线 + 玻璃中线；落地窗中线加粗为双线；飘窗多一道外线
    parts.push(<path key="g" d={polyPath(gap)} fill={tone === 'ink' ? C.skyFill : 'none'} />)
    const s0 = o.offset, s1 = o.offset + o.width
    for (const d of [-t / 2, t / 2]) parts.push(<path key={`f${d}`} d={along(w, s0, s1, d)} fill="none" stroke={thin} strokeWidth={px(1)} />)
    const centers = o.kind === 'floor-window' ? [-t * 0.12, t * 0.12] : [0]
    for (const d of centers) parts.push(<path key={`c${d}`} d={along(w, s0, s1, d)} fill="none" stroke={glassLine} strokeWidth={px(1.6)} />)
    if (o.panes && o.panes.length > 1) {
      const total = o.panes.reduce((a, p) => a + p.width, 0) || 1
      let acc = 0
      for (let i = 0; i < o.panes.length - 1; i++) {
        acc += o.panes[i].width / total
        const sm = o.offset + o.width * acc, p = pointAt(w, sm), tg = wallTangent(w, sm), nn: Vec2 = [-tg[1], tg[0]]
        const a = shift([p], nn, -t / 2)[0], b = shift([p], nn, t / 2)[0]
        parts.push(<path key={`m${i}`} d={`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`} stroke={thin} strokeWidth={px(1)} />)
      }
    }
    if (o.kind === 'bay-window') parts.push(<path key="bay" d={along(w, s0, s1, t / 2 + 40)} fill="none" stroke={thin} strokeWidth={px(1)} strokeDasharray={`${px(3)} ${px(2)}`} />)
  }
  if (o.entry && label && tone !== 'muted' && !hideTag) {
    const c = s.center, base: Vec2 = [c[0] - n[0] * (o.swing?.side ?? 1) * (t / 2 + px(16)), c[1] - n[1] * (o.swing?.side ?? 1) * (t / 2 + px(16))]
    // 问题针常钉在入户门上：标签沿墙方向挪开，不被针盖住
    const d: Vec2 = [-n[1], n[0]], clear = (p: Vec2) => !(pins ?? []).some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < px(44))
    const out = [0, 1, -1, 2, -2, 3, -3].map(i => [base[0] + d[0] * px(30) * i, base[1] + d[1] * px(30) * i] as Vec2).find(clear) ?? base
    parts.push(
      <g key="entry" transform={`translate(${out[0]} ${out[1]})`}>
        <rect x={px(-17)} y={px(-9)} width={px(34)} height={px(18)} rx={px(9)} fill={C.ink} />
        <text x={0} y={px(3.6)} fontSize={px(10)} fontWeight={600} fill="#fff" textAnchor="middle">{label}</text>
      </g>,
    )
  }
  return <g>{parts}</g>
}

/* ───────── 尺寸线 ───────── */
function Dim({ a, b, off, k, text, tone = 'ink' }: { a: Vec2; b: Vec2; off: Vec2; k: number; text: string; tone?: 'ink' | 'mint' }) {
  const px = (v: number) => v / k
  const A: Vec2 = [a[0] + off[0], a[1] + off[1]], B: Vec2 = [b[0] + off[0], b[1] + off[1]]
  const L = len2(A, B), ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L
  const ang = Math.atan2(uy, ux) * 180 / Math.PI, up = ang > 90 || ang < -90 ? ang + 180 : ang
  const m = mid(A, B), col = tone === 'mint' ? C.mint700 : C.ink400
  const tw = px(text.length * 6.6 + 12)
  const tick = (p: Vec2) => <path d={`M${p[0] - uy * px(5)} ${p[1] + ux * px(5)}L${p[0] + uy * px(5)} ${p[1] - ux * px(5)}`} stroke={col} strokeWidth={px(1.2)} />
  return (
    <g pointerEvents="none">
      <path d={`M${A[0]} ${A[1]}L${B[0]} ${B[1]}`} stroke={col} strokeWidth={px(1)} />
      {tick(A)}{tick(B)}
      <g transform={`translate(${m[0]} ${m[1]}) rotate(${up})`}>
        <rect x={-tw / 2} y={px(-9)} width={tw} height={px(18)} rx={px(9)} fill={tone === 'mint' ? C.ink : '#ffffff'} stroke={tone === 'mint' ? 'none' : 'rgb(22 27 36 / 0.08)'} strokeWidth={px(1)} />
        <text y={px(3.8)} fontSize={px(11)} fontWeight={650} textAnchor="middle" fill={tone === 'mint' ? '#fff' : C.ink700} className="num">{text}</text>
      </g>
    </g>
  )
}

/* ───────── 房间标签 ───────── */
/** 按排布结果画：标签块（「改」标 / 名称一到两行 / 面积 / 层高胶囊）以 lay.at 为中心；放不下的只在悬停 / 选中时画成墨色浮签 */
function RoomLabel({ r, plan, k, selected, hovered, tone, labels, tag, lay }: { r: Room; plan: Plan; k: number; selected: boolean; hovered: boolean; tone: 'ink' | 'muted' | 'cobalt'; labels: LayerProps['labels']; tag?: string; lay?: RoomLabelLayout }) {
  if (!lay) return null
  const px = (v: number) => v / k
  const area = polygonArea(r.poly) / 1e6
  const sub = r.floorOffset ? `+${r.floorOffset.toFixed(2)} m` : `${area.toFixed(1)} ${labels.sqm}`
  if (lay.hover) {
    if (!hovered && !selected) return null
    const text = `${r.name}  ${sub}`, w = px(text.length * 7.4 + 22)
    return (
      <g data-room-label={r.id} data-hover-label transform={`translate(${lay.at[0]} ${lay.at[1]})`} pointerEvents="none">
        <rect x={-w / 2} y={px(-12)} width={w} height={px(24)} rx={px(12)} fill={C.ink} />
        <text y={px(4.2)} fontSize={px(11.5)} fontWeight={650} textAnchor="middle" fill="#fff">{r.name}<tspan dx={px(6)} fill={C.mint300} className="num">{sub}</tspan></text>
      </g>
    )
  }
  const nameCol = selected ? C.mint700 : tone === 'muted' ? C.ink400 : tone === 'cobalt' ? C.cobalt500 : C.ink
  const ceil = r.ceiling !== undefined && Math.abs(r.ceiling - plan.ceiling) > 0.005 ? r.ceiling : null
  const halo = { stroke: selected ? C.mint100 : tone === 'cobalt' ? C.cobalt50 : r.floorOffset ? '#f6f7f9' : '#ffffff', strokeWidth: px(4.5), strokeLinejoin: 'round' as const, paintOrder: 'stroke' as const }
  const H = (lay.tag && tag ? 22 : 0) + lay.lines.length * lay.size * 1.22 + (lay.sub ? lay.sub * 1.22 + 2 : 0) + (lay.ceil && ceil !== null ? 22 : 0)
  let y = -H / 2
  const parts: ReactNode[] = []
  if (lay.tag && tag) {
    parts.push(
      <g key="tag" transform={`translate(0 ${px(y + 10)})`}>
        <rect x={px(-15)} y={px(-8.5)} width={px(30)} height={px(17)} rx={px(8.5)} fill={C.cobalt500} />
        <text y={px(3.6)} fontSize={px(10)} fontWeight={700} textAnchor="middle" fill="#fff">{tag}</text>
      </g>)
    y += 22
  }
  lay.lines.forEach((line, i) => {
    parts.push(<text key={'n' + i} {...halo} y={px(y + lay.size * 0.96)} fontSize={px(lay.size)} fontWeight={650} textAnchor="middle" fill={nameCol} letterSpacing={px(0.2)}>{line}</text>)
    y += lay.size * 1.22
  })
  if (lay.sub) {
    parts.push(<text key="sub" {...halo} y={px(y + 2 + lay.sub * 0.92)} fontSize={px(lay.sub)} fontWeight={550} textAnchor="middle" fill={selected ? C.mint700 : C.ink400} className="num">{sub}</text>)
    y += lay.sub * 1.22 + 2
  }
  if (lay.ceil && ceil !== null) {
    parts.push(
      <g key="ceil" transform={`translate(0 ${px(y + 4 + 9)})`}>
        <rect x={px(-34)} y={px(-9)} width={px(68)} height={px(18)} rx={px(9)} fill={selected ? '#fff' : '#f1f3f6'} />
        <text y={px(3.6)} fontSize={px(10.5)} fontWeight={600} textAnchor="middle" fill={C.ink500} className="num">{labels.ceiling} {ceil.toFixed(2)}</text>
      </g>)
  }
  return <g data-room-label={r.id} transform={`translate(${lay.at[0]} ${lay.at[1]})`} pointerEvents="none">{parts}</g>
}

/* ───────── 主体 ───────── */
export const PlanLayers = memo(function PlanLayers(p: LayerProps) {
  const { plan, base, diff, mode, k, pid, sel, hover, layers, mini, certainty, labels } = p
  const px = (v: number) => v / k
  const compare = mode === 'compare' && diff
  const muted = (id: string) => !!compare && !diff!.added.has(id) && !diff!.modified.has(id)
  const walls = plan.walls
  const bounds = planBounds(plan)
  const wallPaint = useMemo(() => ({
    groups: wallGroups(plan, w => `${w.kind}|${compare ? (diff!.added.has(w.id) ? 'added' : diff!.modified.has(w.id) ? 'normal' : 'muted') : 'normal'}`),
    joined: withJoinedCorners(plan),
  }), [plan, compare, diff])
  const isSel = (id: string) => has(sel, id)
  const isHover = (id: string) => hover?.id === id && !isSel(id)
  const certOf = (e: { evidence?: { certainty: string } }) => e.evidence?.certainty

  // 被拆掉的（对比态从 base 取）
  const removedWalls = compare ? diff!.removed.filter(r => r.type === 'wall').map(r => base.walls.find(w => w.id === r.id)!).filter(Boolean) : []
  const removedOpenings = compare ? diff!.removed.filter(r => r.type === 'opening').map(r => base.openings.find(o => o.id === r.id)!).filter(o => o && !removedWalls.some(w => w.id === o.wall)) : []
  const removedIds = new Set(compare ? diff!.removed.map(r => r.id) : [])
  const removedExtras = {
    columns: (base.columns ?? []).filter(c => removedIds.has(c.id)), shafts: (base.shafts ?? []).filter(c => removedIds.has(c.id)),
    stairs: (base.stairs ?? []).filter(c => removedIds.has(c.id)), voids: (base.voids ?? []).filter(c => removedIds.has(c.id)),
  }
  // 待确认的提议（受保护墙上开洞 / 拆受保护墙）：画成淡紫虚线
  const pendingAdds = mode !== 'original' && diff ? diff.pending.filter(c => c.op === 'add' && c.type === 'opening').map(c => c.data as unknown as Opening) : []

  return (
    <g>
      {/* 白模台面 + 投影 */}
      <g filter={mini ? undefined : `url(#${pid}-slab)`} pointerEvents="none">
        {plan.rooms.map(r => <path key={r.id} d={polyPath(r.poly)} fill={C.paper} />)}
        {wallPaint.joined.walls.map(w => <path key={w.id} d={polyPath(wallFootprint(w))} fill={C.paper} />)}
      </g>

      {/* 房间 */}
      {plan.rooms.map(r => {
        const s = isSel(r.id), h = isHover(r.id), mod = compare && diff!.modified.has(r.id)
        const fill = s ? C.mint100 : h ? C.mint50 : r.floorOffset ? `url(#${pid}-platform)` : mod ? C.cobalt50 : C.paper
        return <path key={r.id} data-type="room" data-id={r.id} d={polyPath(r.poly)} fill={fill}
          stroke={s ? C.mint400 : mod ? C.cobalt400 : 'none'} strokeWidth={px(s ? 2 : 1.4)} strokeDasharray={mod && !s ? `${px(5)} ${px(4)}` : undefined}
          style={{ transition: 'fill 160ms' }} />
      })}

      {/* 挑空（打叉）、楼梯（踏步线 +「上」箭头）、管道井（斜线）：画在房间上、墙下 */}
      {(plan.voids ?? []).map(v => <VoidShape key={v.id} v={v} k={k} tone={compare && diff!.added.has(v.id) ? 'cobalt' : muted(v.id) ? 'muted' : 'ink'} label={p.lang === 'zh' ? '挑空' : 'VOID'} />)}
      {(plan.stairs ?? []).map(st => <StairShape key={st.id} st={st} plan={plan} k={k} tone={compare && diff!.added.has(st.id) ? 'cobalt' : muted(st.id) ? 'muted' : 'ink'} up={p.lang === 'zh' ? '上' : 'UP'} />)}
      {(plan.shafts ?? []).map(sh => <ShaftShape key={sh.id} sh={sh} k={k} pid={pid} tone={compare && diff!.added.has(sh.id) ? 'cobalt' : muted(sh.id) ? 'muted' : 'ink'} label={p.lang === 'zh' ? { flue: '烟道', pipe: '管井', vent: '风道', other: '井' }[sh.kind] : { flue: 'FLUE', pipe: 'RISER', vent: 'VENT', other: 'SHAFT' }[sh.kind]} />)}
      {compare && [...removedExtras.stairs, ...removedExtras.voids, ...removedExtras.shafts].map(e => <path key={`rmx-${e.id}`} d={polyPath(e.poly)} fill={`url(#${pid}-coral)`} stroke={C.coral500} strokeWidth={px(1.6)} strokeDasharray={`${px(6)} ${px(4)}`} />)}
      {p.decorUnder}

      {/* 梁：在顶上，画成虚线（建筑制图里看不见的上方构件用虚线） */}
      {plan.beams.map(b => {
        const fp = beamFootprint(b), s = isSel(b.id), h = isHover(b.id)
        const col = s ? C.mint500 : h ? C.mint400 : muted(b.id) ? C.ink300 : C.ink500
        return (
          <g key={b.id}>
            <path data-type="beam" data-id={b.id} d={polyPath(fp)} fill={s ? 'rgb(85 211 165 / 0.28)' : h ? 'rgb(85 211 165 / 0.14)' : 'rgb(22 25 30 / 0.035)'}
              stroke={col} strokeWidth={px(s ? 1.8 : 1.2)} strokeDasharray={`${px(7)} ${px(5)}`} />
          </g>
        )
      })}

      {/* 被拆的墙：珊瑚斜纹 + 虚线框 */}
      {removedWalls.map(w => (
        <path key={`rm-${w.id}`} d={polyPath(wallFootprint(w))}
          fill={`url(#${pid}-coral)`} stroke={C.coral500} strokeWidth={px(isSel(w.id) ? 2.2 : 1.6)} strokeDasharray={`${px(6)} ${px(4)}`} />
      ))}

      {/* 墙：按类型 + 状态并成多边形（core 墙足迹 + L 角补齐），T 形、L 形交接没有缝 */}
      {wallPaint.groups.map(g => {
        const [kind, state] = g.key.split('|') as [WallKind, string]
        const fill = state === 'added' ? C.cobalt400 : fillFor(kind, state === 'muted', pid)
        return (
          <g key={g.key} pointerEvents="none">
            {state === 'added' && <path d={multiPolyPath(g.polys)} fill="rgb(75 118 242 / 0.16)" stroke={C.cobalt500} strokeWidth={px(6)} strokeLinejoin="round" strokeOpacity={0.35} />}
            <path d={multiPolyPath(g.polys)} fill={fill} fillRule="evenodd"
              stroke={kind === 'glass' && state !== 'added' ? (state === 'muted' ? '#b9d3e3' : C.skyLine) : 'none'} strokeWidth={px(1)} />
          </g>
        )
      })}
      {walls.filter(w => (w.kind === 'glass' || w.kind === 'half-glass') && !(compare && diff!.added.has(w.id))).map(w => (
        <path key={`gl-${w.id}`} d={along(w, 0, wallLength(w), 0)} fill="none" stroke={muted(w.id) ? '#b9d3e3' : C.skyLine} strokeWidth={px(w.kind === 'half-glass' ? 1.8 : 1.2)} pointerEvents="none" />
      ))}
      {/* 柱：实心（承重墨色、装饰中灰），画在墙上面——墙垛贴着墙也看得出来 */}
      {(plan.columns ?? []).map(c => <ColumnShape key={c.id} c={c} k={k} tone={compare && diff!.added.has(c.id) ? 'cobalt' : muted(c.id) ? 'muted' : 'ink'} />)}
      {compare && removedExtras.columns.map(c => <path key={`rmc-${c.id}`} d={polyPath(columnFootprint(c))} fill={`url(#${pid}-coral)`} stroke={C.coral500} strokeWidth={px(1.6)} strokeDasharray={`${px(5)} ${px(3)}`} />)}
      {compare && walls.filter(w => diff!.modified.has(w.id)).map(w => (
        <path key={`mod-${w.id}`} d={polyPath(wallFootprint(w))} fill="none" stroke={C.cobalt500} strokeWidth={px(1.4)} strokeDasharray={`${px(5)} ${px(3)}`} pointerEvents="none" />
      ))}

      {/* 门窗 */}
      {plan.openings.map(o => {
        const m = muted(o.id), added = compare && diff!.added.has(o.id)
        return (
          <g key={o.id} data-type="opening" data-id={o.id}>
            <OpeningSymbol plan={plan} o={o} k={k} tone={added ? 'cobalt' : m ? 'muted' : 'ink'} label={labels.entry} hideTag={isSel(o.id)} pins={p.pins} />
          </g>
        )
      })}
      {removedOpenings.map(o => (
        <g key={`rmo-${o.id}`}>
          <OpeningSymbol plan={base} o={o} k={k} tone="coral" />
          <OpeningHit plan={base} o={o} stroke={C.coral500} k={k} dashed />
        </g>
      ))}
      {pendingAdds.map(o => (
        <g key={`pd-${o.id}`} pointerEvents="none">
          {(() => { const s = spanOf(plan, o); if (!s) return null; const r = segmentRect(s.wall, o.offset, o.offset + o.width, s.wall.thickness + 40); // 装修态（D6 B5）：只画一圈细虚线，不铺淡紫斜纹——装修按现在的结构算，提议只是提醒「这里还有一条没确认」
            return mode === 'decor'
              ? <path data-proposal={o.id} d={polyPath(r)} fill="none" stroke={C.lav500} strokeOpacity={0.8} strokeWidth={px(1)} strokeDasharray={`${px(3)} ${px(3)}`} />
              : <path d={polyPath(r)} fill={`url(#${pid}-lav)`} stroke={C.lav500} strokeWidth={px(1.6)} strokeDasharray={`${px(5)} ${px(4)}`} /> })()}
        </g>
      ))}

      {p.decorOver}
      {/* 把握程度：推断 = 柠檬虚线框，不知道 = 柠檬斜纹 */}
      {certainty && !mini && (
        <g pointerEvents="none">
          {plan.walls.filter(w => certOf(w) && certOf(w) !== 'seen').map(w => (
            <path key={`c-${w.id}`} d={polyPath(wallFootprint(w))} fill={certOf(w) === 'unknown' ? `url(#${pid}-lemon)` : 'none'} stroke={C.lemon600} strokeWidth={px(1.4)} strokeDasharray={`${px(3)} ${px(3)}`} />
          ))}
          {plan.openings.filter(o => certOf(o) && certOf(o) !== 'seen').map(o => { const s = spanOf(plan, o); if (!s) return null; const r = segmentRect(s.wall, o.offset, o.offset + o.width, s.wall.thickness + 80); return <path key={`c-${o.id}`} d={polyPath(r)} fill={certOf(o) === 'unknown' ? `url(#${pid}-lemon)` : 'none'} stroke={C.lemon600} strokeWidth={px(1.4)} strokeDasharray={`${px(3)} ${px(3)}`} /> })}
          {plan.beams.filter(b => certOf(b) && certOf(b) !== 'seen').map(b => (
            <path key={`c-${b.id}`} d={polyPath(beamFootprint(b))} fill={certOf(b) === 'unknown' ? `url(#${pid}-lemon)` : 'none'} stroke={C.lemon600} strokeWidth={px(1.4)} strokeDasharray={`${px(3)} ${px(3)}`} />
          ))}
        </g>
      )}

      {/* 悬停 / 选中：墙和洞口叠一层薄荷 */}
      {[...plan.walls, ...base.walls.filter(w => removedWalls.includes(w))].filter(w => isSel(w.id) || isHover(w.id)).map(w => {
        const s = isSel(w.id), ghost = removedWalls.includes(w)
        const jw = wallPaint.joined.walls.find(x => x.id === w.id)
        const d = ghost || !jw ? polyPath(wallFootprint(w)) : wallSolidPolys(wallPaint.joined, jw).map(p => polyPath(p)).join('')
        return (
          <g key={`hl-${w.id}`} pointerEvents="none">
            {!isArc(w) && !ghost && <path d={polyPath(wallFootprint(w))} fill="none" stroke={s ? C.mint500 : C.mint400} strokeWidth={px(1.2)} strokeDasharray={`${px(3)} ${px(3)}`} />}
            <path d={d} fill={s ? C.mint400 : 'rgb(85 211 165 / 0.45)'} stroke={s ? C.mint700 : C.mint500} strokeWidth={px(s ? 1.6 : 1.2)} />
          </g>
        )
      })}
      {/* 新构件的悬停 / 选中 */}
      {[...(plan.columns ?? []).map(c => ({ id: c.id, poly: columnFootprint(c) })), ...[...(plan.shafts ?? []), ...(plan.stairs ?? []), ...(plan.voids ?? [])].map(e => ({ id: e.id, poly: e.poly })),
        ...(compare ? [...removedExtras.columns.map(c => ({ id: c.id, poly: columnFootprint(c) })), ...[...removedExtras.stairs, ...removedExtras.voids, ...removedExtras.shafts].map(e => ({ id: e.id, poly: e.poly }))] : [])]
        .filter(e => isSel(e.id) || isHover(e.id)).map(e => (
        <path key={`hlx-${e.id}`} d={polyPath(e.poly)} fill={isSel(e.id) ? 'rgb(85 211 165 / 0.42)' : 'rgb(85 211 165 / 0.22)'} stroke={isSel(e.id) ? C.mint700 : C.mint500} strokeWidth={px(isSel(e.id) ? 1.8 : 1.2)} pointerEvents="none" />
      ))}
      {plan.openings.filter(o => isSel(o.id) || isHover(o.id)).map(o => (
        <OpeningHit key={`hl-${o.id}`} plan={plan} o={o} k={k} stroke={isSel(o.id) ? C.mint700 : C.mint500} fill={isSel(o.id) ? 'rgb(85 211 165 / 0.55)' : 'rgb(85 211 165 / 0.3)'} grow={60} />
      ))}


      {/* 总尺寸 */}
      {!mini && layers.dims && bounds && (
        <>
          <Dim a={[bounds[0], bounds[1]]} b={[bounds[2], bounds[1]]} off={[0, -px(30)]} k={k} text={`${fmtLen(bounds[2] - bounds[0])} m`} />
          <Dim a={[bounds[0], bounds[3]]} b={[bounds[0], bounds[1]]} off={[-px(30), 0]} k={k} text={`${fmtLen(bounds[3] - bounds[1])} m`} />
        </>
      )}

      {/* 选中构件的尺寸和端点 */}
      {!mini && sel.length === 1 && !p.hideSelDims && <SelectionDims plan={sel[0].type === 'wall' && removedWalls.some(w => w.id === sel[0].id) ? base : plan} sel={sel[0]} k={k} />}

      {/* 房间名最后画（带同色光晕，压过尺寸线和选中线）：排布见 canvas2d/labels；放不下的悬停浮签再后，压在最上面 */}
      {!mini && [false, true].map(top => plan.rooms.filter(r => !!p.roomLabels?.get(r.id)?.hover === top).map(r => (
        <RoomLabel key={`lb-${r.id}`} r={r} plan={plan} k={k} selected={isSel(r.id)} hovered={hover?.id === r.id} tone={compare ? (diff!.modified.has(r.id) ? 'cobalt' : 'muted') : 'ink'}
          labels={labels} tag={compare && diff!.modified.has(r.id) ? (p.lang === 'zh' ? '改' : 'Δ') : undefined} lay={p.roomLabels?.get(r.id)} />
      )))}

    </g>
  )
})

function OpeningHit({ plan, o, k, hit, stroke, fill, dashed, grow = 0 }: { plan: Plan; o: Opening; k: number; hit?: boolean; stroke?: string; fill?: string; dashed?: boolean; grow?: number }) {
  const s = spanOf(plan, o)
  if (!s) return null
  const r = segmentRect(s.wall, o.offset, o.offset + o.width, s.wall.thickness + (hit ? Math.max(160, 14 / k) : grow))
  if (hit) return <path data-type="opening" data-id={o.id} d={polyPath(r)} fill="transparent" />
  return <path d={polyPath(r)} fill={fill ?? 'none'} stroke={stroke} strokeWidth={1.6 / k} strokeDasharray={dashed ? `${6 / k} ${4 / k}` : undefined} pointerEvents="none" />
}

function SelectionDims({ plan, sel, k }: { plan: Plan; sel: Ref; k: number }) {
  const px = (v: number) => v / k
  if (sel.type === 'wall') {
    const w = plan.walls.find(w => w.id === sel.id) as Wall | undefined
    if (!w) return null
    const n = wallNormal(w), off = w.thickness / 2 + px(22)
    return (
      <g pointerEvents="none">
        {!isArc(w) && <Dim a={w.a} b={w.b} off={[-n[0] * off, -n[1] * off]} k={k} text={`${fmtLen(wallLength(w))} m`} tone="mint" />}
        {[w.a, w.b].map((q, i) => <circle key={i} data-handle={i ? 'b' : 'a'} cx={q[0]} cy={q[1]} r={px(5.5)} fill="#fff" stroke={C.mint500} strokeWidth={px(2.2)} />)}
        {(() => { const m = pointAt(w, wallLength(w) / 2), r = px(5); return <rect data-handle="mid" x={m[0] - r} y={m[1] - r} width={2 * r} height={2 * r} rx={px(1.5)} transform={`rotate(45 ${m[0]} ${m[1]})`} fill="#fff" stroke={C.mint700} strokeWidth={px(1.8)} /> })()}
      </g>
    )
  }
  if (sel.type === 'opening') {
    const o = plan.openings.find(o => o.id === sel.id)
    const s = o && spanOf(plan, o)
    if (!o || !s) return null
    const n = s.normal, off = s.wall.thickness / 2 + px(22)
    return (
      <g pointerEvents="none">
        <Dim a={s.a} b={s.b} off={[-n[0] * off, -n[1] * off]} k={k} text={`${o.width}`} tone="mint" />
        {[s.a, s.b].map((q, i) => <rect key={i} x={q[0] - px(4.5)} y={q[1] - px(4.5)} width={px(9)} height={px(9)} rx={px(2.5)} fill="#fff" stroke={C.mint500} strokeWidth={px(2)} />)}
      </g>
    )
  }
  if (sel.type === 'beam') {
    const b = plan.beams.find(b => b.id === sel.id)
    if (!b) return null
    const n = wallNormal({ a: b.a, b: b.b } as Wall), off = b.width / 2 + px(22)
    return <Dim a={b.a} b={b.b} off={[-n[0] * off, -n[1] * off]} k={k} text={`${fmtLen(len2(b.a, b.b))} m`} tone="mint" />
  }
  return null
}

/* ───────── 新构件的画法（S2a，design.md §5.6） ───────── */
type XTone = 'ink' | 'muted' | 'cobalt'
const xcol = (tone: XTone) => ({ ink: C.ink, muted: C.ink300, cobalt: C.cobalt500 }[tone])

function ColumnShape({ c, k, tone }: { c: Column; k: number; tone: XTone }) {
  const fill = tone === 'cobalt' ? C.cobalt400 : tone === 'muted' ? (c.kind === 'bearing' ? '#b9bec6' : '#d6d9de') : c.kind === 'bearing' ? '#1f232a' : '#8e949d'
  return <path data-type="column" data-id={c.id} d={polyPath(columnFootprint(c))} fill={fill} stroke={tone === 'cobalt' ? C.cobalt500 : 'none'} strokeWidth={1.2 / k} pointerEvents="none" />
}

function ShaftShape({ sh, k, pid, tone, label }: { sh: Shaft; k: number; pid: string; tone: XTone; label: string }) {
  const px = (v: number) => v / k
  const b = bbox(sh.poly), c = labelPoint(sh.poly)
  const big = Math.min(b[2] - b[0], b[3] - b[1]) * k > 30
  return (
    <g data-type="shaft" data-id={sh.id} pointerEvents="none">
      <path d={polyPath(sh.poly)} fill={tone === 'cobalt' ? 'rgb(75 118 242 / 0.18)' : `url(#${pid}-shaft${tone === 'muted' ? '-m' : ''})`} stroke={tone === 'cobalt' ? C.cobalt500 : tone === 'muted' ? C.ink300 : C.ink} strokeWidth={px(1.4)} />
      {big && <g transform={`translate(${c[0]} ${c[1]})`}><rect x={px(-15)} y={px(-8)} width={px(30)} height={px(16)} rx={px(8)} fill="#fff" /><text y={px(3.4)} fontSize={px(9.5)} fontWeight={700} textAnchor="middle" fill={tone === 'muted' ? C.ink400 : C.ink700}>{label}</text></g>}
    </g>
  )
}

function VoidShape({ v, k, tone, label }: { v: Void; k: number; tone: XTone; label: string }) {
  const px = (n: number) => n / k
  const b = bbox(v.poly), col = tone === 'ink' ? C.ink500 : xcol(tone), c = labelPoint(v.poly)
  return (
    <g data-type="void" data-id={v.id} pointerEvents="none">
      <path d={polyPath(v.poly)} fill="rgb(22 25 30 / 0.025)" stroke={col} strokeWidth={px(1.3)} strokeDasharray={`${px(6)} ${px(4)}`} />
      <path d={`M${b[0]} ${b[1]}L${b[2]} ${b[3]}M${b[2]} ${b[1]}L${b[0]} ${b[3]}`} stroke={col} strokeWidth={px(1)} />
      {Math.min(b[2] - b[0], b[3] - b[1]) * k > 40 && <g transform={`translate(${c[0]} ${c[1]})`}><rect x={px(-17)} y={px(-8.5)} width={px(34)} height={px(17)} rx={px(8.5)} fill="#fff" stroke="rgb(22 27 36 / 0.1)" strokeWidth={px(1)} /><text y={px(3.6)} fontSize={px(10)} fontWeight={700} textAnchor="middle" fill={col}>{label}</text></g>}
    </g>
  )
}

/** 楼梯：占地轮廓 + 沿 path 的踏步线 + 从起点（低处）往上的箭头，起点旁一个「上」 */
function StairShape({ st, plan, k, tone, up }: { st: Stair; plan: Plan; k: number; tone: XTone; up: string }) {
  const px = (v: number) => v / k
  const col = tone === 'ink' ? C.ink : xcol(tone), thin = tone === 'ink' ? C.ink400 : xcol(tone)
  const lens = st.path.slice(1).map((p, i) => len2(st.path[i], p)), total = lens.reduce((a, b) => a + b, 0)
  const levels = plan.levels ?? [], from = levels.find(l => l.id === st.level), to = levels.find(l => l.id === st.to)
  const count = st.steps ?? Math.max(1, Math.ceil(((to?.elevation ?? 3) - (from?.elevation ?? 0)) / 0.17))
  const at = (s: number): { p: Vec2; d: Vec2 } => {
    let acc = 0
    for (let i = 0; i < lens.length; i++) {
      if (s <= acc + lens[i] || i === lens.length - 1) {
        const a = st.path[i], b = st.path[i + 1], f = lens[i] ? (s - acc) / lens[i] : 0, d: Vec2 = [(b[0] - a[0]) / (lens[i] || 1), (b[1] - a[1]) / (lens[i] || 1)]
        return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], d }
      }
      acc += lens[i]
    }
    return { p: st.path[0], d: [1, 0] }
  }
  const treads: string[] = []
  for (let i = 1; i < count; i++) {
    const { p, d } = at(total * i / count), n: Vec2 = [-d[1], d[0]], h = st.width / 2
    treads.push(`M${(p[0] + n[0] * h).toFixed(1)} ${(p[1] + n[1] * h).toFixed(1)}L${(p[0] - n[0] * h).toFixed(1)} ${(p[1] - n[1] * h).toFixed(1)}`)
  }
  const end = at(total * 0.92), head = end.p, hd = end.d, hn: Vec2 = [-hd[1], hd[0]], ah = px(9)
  const arrowLine = 'M' + [st.path[0], ...st.path.slice(1, -1), head].map(q => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('L')
  const tip = `M${(head[0] - hd[0] * ah + hn[0] * ah * 0.6).toFixed(1)} ${(head[1] - hd[1] * ah + hn[1] * ah * 0.6).toFixed(1)}L${head[0].toFixed(1)} ${head[1].toFixed(1)}L${(head[0] - hd[0] * ah - hn[0] * ah * 0.6).toFixed(1)} ${(head[1] - hd[1] * ah - hn[1] * ah * 0.6).toFixed(1)}`
  const s0 = at(Math.min(total * 0.12, px(26))).p
  return (
    <g data-type="stair" data-id={st.id} pointerEvents="none">
      <path d={polyPath(st.poly)} fill={tone === 'cobalt' ? 'rgb(75 118 242 / 0.12)' : '#ffffff'} stroke={col} strokeWidth={px(1.3)} />
      <path d={treads.join('')} stroke={thin} strokeWidth={px(1)} />
      <path d={arrowLine} fill="none" stroke={col} strokeWidth={px(1.6)} strokeLinecap="round" />
      <path d={tip} fill="none" stroke={col} strokeWidth={px(1.8)} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={st.path[0][0]} cy={st.path[0][1]} r={px(3)} fill={col} />
      <g transform={`translate(${s0[0]} ${s0[1]})`}><rect x={px(-11)} y={px(-9)} width={px(22)} height={px(18)} rx={px(9)} fill={col} /><text y={px(3.8)} fontSize={px(10.5)} fontWeight={700} textAnchor="middle" fill="#fff">{up}</text></g>
    </g>
  )
}
const bbox = (poly: Vec2[]): [number, number, number, number] => [Math.min(...poly.map(p => p[0])), Math.min(...poly.map(p => p[1])), Math.max(...poly.map(p => p[0])), Math.max(...poly.map(p => p[1]))]

export const isProtectedWall = (w?: Wall) => !!w && PROTECTED_KINDS.includes(w.kind)
