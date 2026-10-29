/**
 * 立面画法（docs/decor/设计规范.md §5.2）：像一张放在台面上的图纸。屏幕坐标里画（X(u)、Y(z)），线宽字号按像素。
 * 凸出来的（造型板、柜子）右边一道软影 + 左上 1px 白高光；凹进去的（壁龛、挖洞、开放格）上沿、左沿内影——
 * 凹凸用同一束左上来的光解释，不靠图例。剖到的两端墙用平面里学会的墙色。
 */
import type { ReactNode } from 'react'
import type { Cabinet, Decor } from '@/core/decor/types'
import type { CabinetLayout } from '@/core/decor/cabinets'
import { C, elevTone, shade } from '../canvas2d/style'
import { faceFinish, matOf, roleMat, styleOf, type DecorIssues } from './model'
import type { ElevModel } from './elev-model'
import type { DSel } from './dstore'
import type { Plan } from '@/core/types'

export interface Frame { k: number; tx: number; ty: number }
export const X = (F: Frame, u: number) => F.tx + u * F.k
export const Y = (F: Frame, z: number) => F.ty - z * 1000 * F.k
const R = (F: Frame, u0: number, z0: number, u1: number, z1: number) => ({ x: X(F, Math.min(u0, u1)), y: Y(F, Math.max(z0, z1)), w: Math.abs(u1 - u0) * F.k, h: Math.abs(z1 - z0) * 1000 * F.k })
/** 中文按一个字号、数字 0.62 个字号算宽（r2 按字符数算，中文胶囊被裁掉） */
export const textW = (s: string, fs = 11) => [...s].reduce((a, c) => a + (/[一-鿿（）「」·]/.test(c) ? fs : fs * 0.62), 0)

export function ElevDefs({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={`${id}-slab`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#e6e8ec" /><rect width="1.6" height="7" fill="#c7cbd2" /></pattern>
      <pattern id={`${id}-beam`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#cfd3d9" /><rect width="1.4" height="6" fill="#aeb3bb" /></pattern>
      <pattern id={`${id}-bearing`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#1f232a" /><rect width="1.2" height="5" fill="#4a515c" /></pattern>
      <pattern id={`${id}-lemon`} width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="9" fill="rgb(226 238 110 / 0.16)" /><rect width="2.6" height="9" fill="rgb(212 227 72 / 0.5)" /></pattern>
      <linearGradient id={`${id}-shR`} x1="0" x2="1"><stop offset="0" stopColor="#1c2434" stopOpacity=".20" /><stop offset="1" stopColor="#1c2434" stopOpacity="0" /></linearGradient>
      <linearGradient id={`${id}-shB`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#1c2434" stopOpacity=".22" /><stop offset="1" stopColor="#1c2434" stopOpacity="0" /></linearGradient>
      <linearGradient id={`${id}-inT`} x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#1c2434" stopOpacity=".30" /><stop offset="1" stopColor="#1c2434" stopOpacity="0" /></linearGradient>
      <linearGradient id={`${id}-inL`} x1="0" x2="1"><stop offset="0" stopColor="#1c2434" stopOpacity=".22" /><stop offset="1" stopColor="#1c2434" stopOpacity="0" /></linearGradient>
      <linearGradient id={`${id}-tv`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#2b2f36" /><stop offset=".55" stopColor="#15181c" /><stop offset="1" stopColor="#1d2026" /></linearGradient>
      <pattern id={`${id}-speck`} width="46" height="46" patternUnits="userSpaceOnUse"><circle cx="7" cy="9" r=".7" fill="#000" fillOpacity=".10" /><circle cx="30" cy="20" r=".6" fill="#000" fillOpacity=".08" /><circle cx="18" cy="38" r=".7" fill="#000" fillOpacity=".09" /><circle cx="40" cy="41" r=".5" fill="#000" fillOpacity=".07" /></pattern>
      <filter id={`${id}-sheet`} x="-10%" y="-20%" width="120%" height="140%" colorInterpolationFilters="sRGB"><feDropShadow dx="0" dy="18" stdDeviation="22" floodColor="#1c2434" floodOpacity=".14" /><feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#1c2434" floodOpacity=".08" /></filter>
    </defs>
  )
}

function Raised({ id, r, fill, shadow = 7, bottom = 0, stroke = '#8e949d', sw = 0.9, children }: { id: string; r: ReturnType<typeof R>; fill: string; shadow?: number; bottom?: number; stroke?: string; sw?: number; children?: ReactNode }) {
  return (
    <g>
      {shadow > 0 && <rect x={r.x + r.w} y={r.y + 3} width={shadow} height={Math.max(0, r.h - 3)} fill={`url(#${id}-shR)`} />}
      {bottom > 0 && <rect x={r.x + 4} y={r.y + r.h} width={Math.max(0, r.w - 2)} height={bottom} fill={`url(#${id}-shB)`} />}
      <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={fill} stroke={stroke} strokeWidth={sw} />
      {children}
      <path d={`M${r.x + 0.8} ${r.y + r.h - 1}V${r.y + 0.8}H${r.x + r.w - 1}`} stroke="#fff" strokeOpacity={0.7} strokeWidth={1} fill="none" />
    </g>
  )
}
function Sunk({ id, r, back, inset = 11, stroke = '#6c727c' }: { id: string; r: ReturnType<typeof R>; back: string; inset?: number; stroke?: string }) {
  return (
    <g>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={back} />
      <rect x={r.x} y={r.y} width={r.w} height={Math.min(inset, r.h)} fill={`url(#${id}-inT)`} />
      <rect x={r.x} y={r.y} width={Math.min(inset * 0.8, r.w)} height={r.h} fill={`url(#${id}-inL)`} />
      <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke={stroke} strokeWidth={0.9} />
    </g>
  )
}
export function Pill({ x, y, text, tone = 'white', rot = 0, anchor = 'middle' }: { x: number; y: number; text: string; tone?: 'white' | 'ink' | 'gray'; rot?: number; anchor?: 'middle' | 'start' }) {
  const w = Math.max(30, textW(text) + 16), f = { white: ['#fff', '#3b4048', 'rgb(22 27 36 / .08)'], ink: ['#16191e', '#fff', 'none'], gray: ['rgb(255 255 255 / .86)', '#6c727c', 'rgb(22 27 36 / .06)'] }[tone]
  const bx = anchor === 'middle' ? -w / 2 : 0
  return <g transform={`translate(${x} ${y}) rotate(${rot})`} pointerEvents="none"><rect x={bx} y={-9.5} width={w} height={19} rx={9.5} fill={f[0]} stroke={f[2]} /><text x={bx + w / 2} y={3.9} fontSize={11} fontWeight={650} textAnchor="middle" fill={f[1]} className="num">{text}</text></g>
}
export function HDim({ x0, x1, y, text, tone = 'white', tick = true }: { x0: number; x1: number; y: number; text: string; tone?: 'white' | 'ink'; tick?: boolean }) {
  const col = tone === 'ink' ? '#16191e' : '#8e949d'
  return <g pointerEvents="none"><path d={`M${x0} ${y}H${x1}`} stroke={col} strokeWidth={1} />{tick && <path d={`M${x0} ${y - 4}V${y + 4}M${x1} ${y - 4}V${y + 4}`} stroke={col} strokeWidth={1.2} />}<Pill x={(x0 + x1) / 2} y={y} text={text} tone={tone} /></g>
}
export function VDim({ y0, y1, x, text, tone = 'white' }: { y0: number; y1: number; x: number; text: string; tone?: 'white' | 'ink' }) {
  const col = tone === 'ink' ? '#16191e' : '#8e949d'
  return <g pointerEvents="none"><path d={`M${x} ${y0}V${y1}M${x - 4} ${y0}H${x + 4}M${x - 4} ${y1}H${x + 4}`} stroke={col} strokeWidth={1.1} /><Pill x={x} y={(y0 + y1) / 2} text={text} tone={tone} rot={-90} /></g>
}
export function SelBox({ r, handles = true, bottom = true }: { r: ReturnType<typeof R>; handles?: boolean; bottom?: boolean }) {
  const hs: [number, number][] = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w / 2, r.y], [r.x + r.w, r.y + r.h / 2], [r.x, r.y + r.h / 2], ...(bottom ? [[r.x, r.y + r.h], [r.x + r.w, r.y + r.h]] as [number, number][] : [[r.x, r.y + r.h], [r.x + r.w, r.y + r.h]] as [number, number][])]
  return (
    <g pointerEvents="none" data-testid="elev-sel">
      <rect x={r.x - 1} y={r.y - 1} width={r.w + 2} height={r.h + 2} fill="rgb(85 211 165 / .06)" stroke={C.mint500} strokeWidth={2} />
      {handles && hs.map(([x, y], i) => <rect key={i} x={x - 4.5} y={y - 4.5} width={9} height={9} rx={2.5} fill="#fff" stroke={C.mint500} strokeWidth={1.6} />)}
    </g>
  )
}

/* ───────── 柜子的立面：按格画（门、抽屉、开放格、挖洞、家电位），3mm 缝画成发丝线 ───────── */
function CabinetElev({ id, F, c, L, u0, decor, styleId, faceColor, cellSel }: { id: string; F: Frame; c: Cabinet; L: CabinetLayout; u0: number; decor: Decor; styleId: string; faceColor: string; cellSel?: { col: number; row: number } | null }) {
  const st = styleOf(styleId, decor)
  const front = elevTone(matOf(decor, c.materials.front || st.roles['cabinet.front']).color)
  const carcass = elevTone(matOf(decor, c.materials.carcass || st.roles['cabinet.carcass']).color)
  const pl = c.plinth ?? 0
  const body = R(F, u0, c.z[0] + pl, u0 + c.width, c.z[1])
  const floating = c.z[0] > 0.05
  const g = 1.2, handle = '#8f8676'
  const out: ReactNode[] = []
  if (pl > 0) out.push(<rect key="pl" {...rectProps(R(F, u0 + 15, c.z[0], u0 + c.width - 15, c.z[0] + pl))} fill={shade(carcass, -0.09)} />)
  for (const cell of L.cells) {
    const r0 = R(F, u0 + cell.u[0], cell.z[0], u0 + cell.u[1], cell.z[1])
    const key = `${cell.column}-${cell.row}`
    const fr = cell.cell.material ? elevTone(matOf(decor, cell.cell.material).color) : front
    if (cell.type === 'door' || cell.type === 'doors' || cell.type === 'flap' || cell.type === 'drawers') {
      // 门板、抽屉面用 core layoutCabinet 的 front 部件：pieces 已经按跨格的洞（cuts）裁过，和 3D 一致；
      // 被洞压到的门缝、拉手跟着断开（拉手点落在裁掉的地方就不画）
      const fronts = L.parts.filter(p => p.kind === 'front' && p.column === cell.column && p.row === cell.row)
      fronts.forEach((part, i) => {
        const pf = part.material && part.material !== c.materials.front ? elevTone(matOf(decor, part.material).color) : fr
        for (const [j, pc] of part.pieces.entries()) {
          const r = R(F, u0 + pc.u[0], pc.z[0], u0 + pc.u[1], pc.z[1])
          out.push(<rect key={`${key}f${i}-${j}`} x={r.x + g / 2} y={r.y + g / 2} width={Math.max(0, r.w - g)} height={Math.max(0, r.h - g)} rx={1.2} fill={pf} stroke={shade(pf, -0.11)} strokeWidth={1} data-front={`${cell.column}-${cell.row}-${i}`} />)
        }
        if (c.handle === 'none') return
        const nr = R(F, u0 + part.u[0], part.z[0], u0 + part.u[1], part.z[1])
        const inside = (x: number, y: number) => part.pieces.some(pc => { const r = R(F, u0 + pc.u[0], pc.z[0], u0 + pc.u[1], pc.z[1]); return x >= r.x + 2 && x <= r.x + r.w - 2 && y >= r.y + 2 && y <= r.y + r.h - 2 })
        if (cell.type === 'flap' || cell.type === 'drawers') {
          const cx = nr.x + nr.w / 2, hy = nr.y + (cell.type === 'flap' ? 8 : 7), hw = Math.min(cell.type === 'flap' ? 22 : 18, nr.w * (cell.type === 'flap' ? 0.2 : 0.18))
          if (inside(cx - hw, hy) && inside(cx + hw, hy)) out.push(<path key={`${key}h${i}`} d={`M${cx - hw} ${hy}H${cx + hw}`} stroke={handle} strokeWidth={2} strokeLinecap="round" />)
          return
        }
        const hingeLeft = cell.type === 'doors' ? i === 0 : (cell.cell.hinge ?? 'left') === 'left'
        const hx = hingeLeft ? nr.x + nr.w - 7 : nr.x + 7
        const hz = Math.min(Math.max(Y(F, 1.05), nr.y + 14), nr.y + nr.h - 30), hl = Math.min(26, nr.h * 0.25)
        if (inside(hx, hz) && inside(hx, hz + hl)) out.push(<path key={`${key}h${i}`} d={`M${hx} ${hz}V${hz + hl}`} stroke={handle} strokeWidth={2} strokeLinecap="round" />)
      })
    } else if (cell.type === 'open' || cell.type === 'void') {
      // 开放格：四周露出 18mm 柜体板，格子里是更深的背板 + 上沿、左沿内影 + 层板亮边；挖穿的洞里露出墙面
      const gg = 2.2, r = { x: r0.x + gg, y: r0.y + gg, w: r0.w - 2 * gg, h: r0.h - 2 * gg }
      const through = cell.type === 'void' && (cell.cell.void?.depth ?? 'through') === 'through'
      const deep = through ? shade(faceColor, -0.025) : shade(carcass, -0.075)
      out.push(<g key={key}>
        <rect x={r0.x} y={r0.y} width={r0.w} height={r0.h} fill={carcass} />
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={deep} />
        <rect x={r.x} y={r.y} width={r.w} height={Math.min(20, r.h * 0.45)} fill={`url(#${id}-inT)`} />
        <rect x={r.x} y={r.y} width={Math.min(11, r.w)} height={r.h} fill={`url(#${id}-inL)`} />
        <rect x={r.x} y={r.y + r.h - 2} width={r.w} height={2} fill="#fff" fillOpacity={0.45} />
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke="#1c2434" strokeOpacity={0.18} strokeWidth={0.8} />
      </g>)
      if (cell.type === 'open') for (let j = 1; j <= (cell.cell.count ?? 0); j++) { const yy = r0.y + r0.h * j / ((cell.cell.count ?? 0) + 1); out.push(<g key={`${key}s${j}`}><rect x={r.x} y={yy - 1.2} width={r.w} height={2.4} fill={carcass} /><rect x={r.x} y={yy - 1.2} width={r.w} height={1} fill="#fff" fillOpacity={0.5} /></g>) }
      const top = cell.cell.void?.top
      if (top) { const tr = R(F, u0 + cell.u[0], top.z - 0.025, u0 + cell.u[1], top.z); out.push(<g key={`${key}t`}><rect {...rectProps(tr)} fill={elevTone(matOf(decor, top.material ?? c.materials.carcass).color)} stroke="#8e949d" strokeWidth={0.8} /><rect x={tr.x} y={tr.y + tr.h} width={tr.w} height={8} fill={`url(#${id}-shB)`} /></g>) }
    } else if (cell.type === 'appliance') {
      out.push(<rect key={key} {...rectProps(r0)} fill={shade(carcass, -0.03)} />)
      const part = L.parts.find(p => p.kind === 'appliance' && p.column === cell.column && p.row === cell.row)
      if (part) out.push(<rect key={`${key}a`} {...rectProps(R(F, u0 + part.u[0], part.z[0], u0 + part.u[1], part.z[1]))} rx={3} fill="#fff" fillOpacity={0.5} stroke="#6c727c" strokeWidth={1} strokeDasharray="4 3" />)
      const label = ({ fridge: '冰箱', washer: '洗衣机', dryer: '烘干机', oven: '烤箱', steamer: '蒸箱', dishwasher: '洗碗机', microwave: '微波炉', tv: '电视', other: '家电' } as Record<string, string>)[cell.cell.appliance?.type ?? 'other']
      if (r0.w > 40 && r0.h > 30) out.push(<text key={`${key}l`} x={r0.x + r0.w / 2} y={r0.y + r0.h / 2 + 4} fontSize={11} fontWeight={600} fill="#6c727c" textAnchor="middle" pointerEvents="none">{label}</text>)
    }
    if (cellSel && cellSel.col === cell.column && cellSel.row === cell.row) out.push(<SelBox key={`${key}sel`} r={r0} />)
  }
  for (const cut of c.cuts ?? []) out.push(<Sunk key={`cut${cut.u[0]}`} id={id} r={R(F, u0 + cut.u[0], cut.z[0], u0 + cut.u[1], cut.z[1])} back={cut.depth === 'through' ? shade(faceColor, -0.025) : shade(carcass, -0.08)} />)
  return (
    <g data-elev="cabinet" data-id={c.id}>
      <Raised id={id} r={body} fill={carcass} shadow={8} bottom={floating ? 12 : 0}>{out}</Raised>
    </g>
  )
}
const rectProps = (r: ReturnType<typeof R>) => ({ x: r.x, y: r.y, width: Math.max(0, r.w), height: Math.max(0, r.h) })

export interface ElevDrawProps {
  id: string
  F: Frame
  m: ElevModel
  plan: Plan
  decor: Decor | undefined
  styleId: string
  sel: DSel | null
  hover?: DSel | null
  issues?: DecorIssues | null
  dims?: boolean
  /** 柜体编辑：只给这个柜子出分列抓手和尺寸链 */
  cabEdit?: string | null
  /** 取景范围（u）：之外的墙用蒙版淡出 */
  fade?: [number, number] | null
  mini?: boolean
}

export function ElevDrawing(P: ElevDrawProps) {
  const { id, F, decor, styleId, sel } = P
  // 柜体编辑：立面放大到这个柜子，别的构件不画（其他东西不动，只是不抢眼）
  const m: ElevModel = P.cabEdit ? { ...P.m, panels: [], niches: [], furniture: [], cabinets: P.m.cabinets.filter(c => c.c.id === P.cabEdit) } : P.m
  const H = m.H
  const st = styleOf(styleId, decor)
  const finish = decor ? faceFinish(P.plan, decor, m.face, styleId) : null
  const faceColor = elevTone(finish?.material.color ?? '#f3f2ef')
  const endW = (side: 'l' | 'r') => m.ends.find(e => e.side === side)?.thickness ?? 0
  const slab = 0.12
  const board = R(F, m.u[0] - endW('l') - 60, -slab - 0.05, m.u[1] + endW('r') + 60, H + slab + 0.05)
  const isSel = (k: string, idd: string) => !!sel && 'id' in sel && sel.k === k && sel.id === idd
  const endFill = (k: string) => k === 'bearing' ? `url(#${id}-bearing)` : k === 'exterior' ? '#3c424b' : k === 'glass' ? '#c7e6f8' : '#adb3bc'
  const skirt = decor ? elevTone(roleMat(st, 'skirting', decor).color) : null
  const out: ReactNode[] = []
  // 墙面：整面材料 + 一段 / 到某个高度的覆盖
  out.push(<rect key="face" {...rectProps(R(F, m.u[0], 0, m.u[1], H))} fill={faceColor} data-elev="face" />)
  if (finish?.material.texture?.kind === 'speckle') out.push(<rect key="facesp" {...rectProps(R(F, m.u[0], 0, m.u[1], H))} fill={`url(#${id}-speck)`} pointerEvents="none" />)
  // core resolveSurfaces 按片给的墙面材料（一段、到某个高度的覆盖；洞口已扣）。和整面同色的片不重画
  for (const s of m.surfaces) {
    if (s.material.id === finish?.material.id) continue
    const d = s.polygons.map(rings => rings.map(r => 'M' + r.map(([u, z]) => `${F.tx + u * F.k} ${F.ty - z * 1000 * F.k}`).join('L') + 'Z').join('')).join('')
    out.push(<path key={`sf${s.key}`} d={d} fill={elevTone(s.material.color)} fillRule="evenodd" pointerEvents="none" />)
  }
  // 踢脚线（跟风格）：洞口处断开
  // core elevationOf 的踢脚线（风格默认段，门洞处断开；显式踢脚造型另外画在造型里）
  if (skirt && !P.mini) for (const sk of m.skirting) {
    if (sk.u[1] - sk.u[0] < 10 || m.panels.some(p => p.p.type === 'skirting' && Math.abs(p.u0 - sk.u[0]) < 1)) continue
    out.push(<rect key={`sk${sk.u[0]}`} {...rectProps(R(F, sk.u[0], sk.z[0], sk.u[1], sk.z[1]))} fill={skirt} stroke={shade(skirt, -0.08)} strokeWidth={0.6} pointerEvents="none" />)
  }
  // 拆掉的墙原位置
  for (const r of m.removed) out.push(<path key={`rm${r.u}`} d={`M${X(F, r.u - r.t / 2)} ${Y(F, 0)}V${Y(F, H)}M${X(F, r.u + r.t / 2)} ${Y(F, 0)}V${Y(F, H)}`} stroke="#8e949d" strokeOpacity={0.35} strokeWidth={1} strokeDasharray="3 4" pointerEvents="none" />)
  // 门窗：白洞口、门扇虚线、窗分扇
  for (const { o, u } of m.openings) {
    const r = R(F, u[0], o.sill, u[1], Math.min(o.head, H))
    const win = o.kind.includes('window') || o.kind === 'open-balcony'
    out.push(<g key={o.id} pointerEvents="none">
      <rect {...rectProps(r)} fill={win ? '#eaf4fb' : '#ffffff'} stroke="#8e949d" strokeWidth={0.9} />
      {o.kind === 'door' && <path d={`M${r.x} ${r.y + r.h}L${r.x + r.w} ${r.y + r.h / 2}L${r.x} ${r.y}`} stroke="#b3b8c0" strokeWidth={0.9} strokeDasharray="4 3" fill="none" />}
      {win && (o.panes?.length ? o.panes.slice(0, -1).reduce<number[]>((acc, p) => [...acc, (acc.at(-1) ?? 0) + p.width], []).map((t, i) => <path key={i} d={`M${r.x + r.w * t} ${r.y}V${r.y + r.h}`} stroke="#4fa3d8" strokeWidth={0.9} />) : <path d={`M${r.x + r.w / 2} ${r.y}V${r.y + r.h}`} stroke="#4fa3d8" strokeWidth={0.9} />)}
    </g>)
  }
  // 壁龛（挖在墙上，不挖透）
  for (const { r, u } of m.niches) {
    const back = elevTone(matOf(decor, r.back ?? finish?.material.id).color, -0.06)
    const rr = R(F, u[0], r.rect.z[0], u[1], r.rect.z[1])
    out.push(<g key={r.id} data-elev="recess" data-id={r.id}><Sunk id={id} r={rr} back={back} />
      {(r.shelves ?? []).map(z => <rect key={z} x={rr.x} y={Y(F, z) - 1.2} width={rr.w} height={2.4} fill="#fff" fillOpacity={0.6} />)}
    </g>)
  }
  // 造型：凸出来，右边软影；分缝；上面挖的洞是凹进去的
  for (const { p, u0, geo } of m.panels) {
    if (p.type === 'skirting') continue
    const col = elevTone(matOf(decor, p.material).color)
    const d = geo.polygons.map(rings => rings.map(rg => 'M' + rg.map(([uu, z]) => `${X(F, u0 + uu).toFixed(1)} ${Y(F, z).toFixed(1)}`).join('L') + 'Z').join('')).join('')
    const bb = R(F, u0 + geo.rect.u[0], geo.rect.z[0], u0 + geo.rect.u[1], geo.rect.z[1])
    const holes = (decor?.recesses ?? []).filter(r => 'panel' in r.host && r.host.panel === p.id && r.rect.u)
    out.push(<g key={p.id} data-elev="panel" data-id={p.id}>
      <rect x={bb.x + bb.w} y={bb.y + 3} width={9} height={Math.max(0, bb.h - 3)} fill={`url(#${id}-shR)`} />
      <path d={d} fill={col} stroke="#8e949d" strokeWidth={0.9} fillRule="evenodd" />
      {matOf(decor, p.material).texture?.kind === 'speckle' && <path d={d} fill={`url(#${id}-speck)`} fillRule="evenodd" pointerEvents="none" />}
      {geo.grooves.map(([a, b], i) => <path key={i} d={`M${X(F, u0 + a[0])} ${Y(F, a[1])}L${X(F, u0 + b[0])} ${Y(F, b[1])}`} stroke={shade(col, -0.1)} strokeWidth={0.8} pointerEvents="none" />)}
      {geo.frames.map((rings, i) => <path key={`f${i}`} d={rings.map(rg => 'M' + rg.map(([uu, z]) => `${X(F, u0 + uu)} ${Y(F, z)}`).join('L') + 'Z').join('')} fill={shade(col, -0.05)} fillRule="evenodd" pointerEvents="none" />)}
      <path d={`M${bb.x + 0.8} ${bb.y + bb.h - 1}V${bb.y + 0.8}H${bb.x + bb.w - 1}`} stroke="#fff" strokeOpacity={0.7} strokeWidth={1} fill="none" pointerEvents="none" />
      {holes.map(h => {
        const rr = R(F, u0 + h.rect.u![0], h.rect.z[0], u0 + h.rect.u![1], h.rect.z[1])
        return <g key={h.id} data-elev="recess" data-id={h.id}><Sunk id={id} r={rr} back={h.depth === 'through' ? faceColor : shade(col, -0.07)} inset={20} /></g>
      })}
    </g>)
  }
  // 柜子
  if (decor) for (const { c, u0, L } of m.cabinets) {
    const cs = P.cabEdit === c.id && sel?.k === 'cell' ? { col: sel.col, row: sel.row } : null
    out.push(<CabinetElev key={c.id} id={id} F={F} c={c} L={L} u0={u0} decor={decor} styleId={styleId} faceColor={faceColor} cellSel={cs} />)
  }
  // 家电放进洞里 / 壁挂电视：深色圆角板 + 很淡的屏幕反光；靠墙的家具：淡墨虚线轮廓，不填色
  for (const { f, u, z, held } of m.furniture) {
    const r = R(F, u[0], z[0], u[1], z[1])
    if (f.type === 'tv' || held) out.push(<g key={f.id} data-elev="furniture" data-id={f.id}><rect {...rectProps(r)} rx={4} fill={`url(#${id}-tv)`} /><path d={`M${r.x + r.w * 0.08} ${r.y + r.h * 0.9}L${r.x + r.w * 0.42} ${r.y + r.h * 0.08}`} stroke="#fff" strokeOpacity={0.05} strokeWidth={r.w * 0.12} /></g>)
    else out.push(<g key={f.id} pointerEvents="none"><rect {...rectProps(r)} rx={3} fill="none" stroke="#545a63" strokeOpacity={0.38} strokeWidth={1} strokeDasharray="4 3" />{r.w > (P.mini ? 24 : 40) && <text x={r.x + r.w / 2} y={r.y + r.h / 2 + (P.mini ? 3 : 4)} fontSize={P.mini ? 8.5 : 10.5} fontWeight={600} fill="#8e949d" textAnchor="middle">{P.mini ? (f.name ?? '').replace(/双人|三人|单人/, '').slice(0, 2) : f.name ?? ''}</text>}</g>)
  }
  // 梁：垂直的 = 剖到的一块；平行的 = 顶上一条虚线带
  for (const b of m.beams) {
    const r = R(F, b.u[0], b.bottom, b.u[1], H)
    out.push(b.kind === 'cross' ? <rect key={b.id} {...rectProps(r)} fill={`url(#${id}-beam)`} stroke="#9aa0a9" strokeWidth={0.8} pointerEvents="none" /> : <rect key={b.id} {...rectProps(r)} fill="rgb(22 25 30 / 0.04)" stroke="#8e949d" strokeWidth={0.9} strokeDasharray="5 4" pointerEvents="none" />)
  }
  // 没地方挂、超出墙面：柠檬虚线框 + 斜纹（立面里只有「超出墙面 / 压到洞口」会出现）
  const bad = new Set((P.issues?.all ?? []).filter(i => ['out-of-face', 'over-opening'].includes(i.code)).map(i => i.id))
  for (const { c, u0 } of m.cabinets) if (bad.has(c.id)) out.push(<rect key={`bad${c.id}`} {...rectProps(R(F, u0, c.z[0], u0 + c.width, c.z[1]))} fill={`url(#${id}-lemon)`} stroke={C.lemon600} strokeWidth={1.5} strokeDasharray="6 4" pointerEvents="none" />)

  // 选中
  const selNodes: ReactNode[] = []
  if (sel && 'id' in sel && sel.k !== 'cell') {
    const r = rectOfSel(m, decor, sel.k, sel.id)
    if (r) {
      const rr = R(F, r.u[0], r.z[0], r.u[1], r.z[1])
      selNodes.push(<SelBox key="sel" r={rr} bottom={r.z[0] > 0.01} />)
      if (sel.k === 'cabinet') { const c = decor?.cabinets.find(x => x.id === sel.id); if (c?.embed) selNodes.push(<Pill key="emb" x={rr.x + rr.w / 2} y={rr.y + 34} text={`嵌进墙 ${c.embed}`} tone="ink" />) }
      if (sel.k === 'recess') { const rc = decor?.recesses.find(x => x.id === sel.id); if (rc && typeof rc.depth === 'number') selNodes.push(<Pill key="emb" x={rr.x + rr.w / 2} y={rr.y + 22} text={`${'face' in rc.host ? '挖进墙' : '挖进'} ${rc.depth}`} tone="ink" />) }
    }
  }

  // 尺寸（默认只画：总高、房间分段、选中构件的宽和高；挖洞的关键尺寸）
  const dimNodes: ReactNode[] = [], segDims: ReactNode[] = []
  if (P.dims) {
    const left = X(F, m.u[0] - endW('l')) - 64
    dimNodes.push(<VDim key="H" y0={Y(F, 0)} y1={Y(F, H)} x={left} text={H.toFixed(2)} />)
    const yb = Y(F, 0) + Math.max(22, slab * 1000 * F.k + 14)
    if (!P.cabEdit) m.segments.forEach((sg, i) => segDims.push(<HDim key={`sg${i}`} x0={X(F, sg.u[0])} x1={X(F, sg.u[1])} y={yb + 42} text={`${sg.room.name} ${((sg.u[1] - sg.u[0]) / 1000).toFixed(2)} m`} />))
    for (const { p, u0, geo } of m.panels) {
      if (p.type === 'skirting') continue
      dimNodes.push(<HDim key={`pw${p.id}`} x0={X(F, u0 + geo.rect.u[0])} x1={X(F, u0 + geo.rect.u[1])} y={yb} text={Math.round(geo.rect.u[1] - geo.rect.u[0]).toLocaleString('en-US')} tone={isSel('panel', p.id) ? 'ink' : 'white'} />)
      // 吸附提示：造型顶对齐梁底
      const beam = m.beams.find(b => Math.abs(b.bottom - geo.rect.z[1]) < 0.005 && b.u[1] > u0 && b.u[0] < u0 + geo.rect.u[1])
      if (beam) dimNodes.push(<Pill key={`snap${p.id}`} x={X(F, u0 + (geo.rect.u[0] + geo.rect.u[1]) / 2)} y={Y(F, geo.rect.z[1]) + 20} text={`梁底 ${beam.bottom.toFixed(2)} · 造型顶对齐`} tone="gray" />)
      for (const h of (decor?.recesses ?? []).filter(r => 'panel' in r.host && r.host.panel === p.id && r.rect.u)) {
        const x0 = X(F, u0 + h.rect.u![0]), x1 = X(F, u0 + h.rect.u![1])
        dimNodes.push(<HDim key={`hw${h.id}`} x0={x0} x1={x1} y={Y(F, h.rect.z[0]) + 26} text={Math.round(h.rect.u![1] - h.rect.u![0]).toLocaleString('en-US')} tone={isSel('recess', h.id) ? 'ink' : 'white'} />)
        dimNodes.push(<VDim key={`hh${h.id}`} y0={Y(F, h.rect.z[0])} y1={Y(F, h.rect.z[1])} x={x1 + 22} text={(h.rect.z[1] - h.rect.z[0]).toFixed(2)} tone={isSel('recess', h.id) ? 'ink' : 'white'} />)
      }
    }
    if (sel && 'id' in sel && sel.k !== 'cell' && !(sel.k === 'panel') && !P.cabEdit) {
      const r = rectOfSel(m, decor, sel.k, sel.id)
      if (r) {
        dimNodes.push(<HDim key="sw" x0={X(F, r.u[0])} x1={X(F, r.u[1])} y={yb} text={Math.round(r.u[1] - r.u[0]).toLocaleString('en-US')} tone="ink" />)
        dimNodes.push(<VDim key="sh" y0={Y(F, r.z[0])} y1={Y(F, r.z[1])} x={left + 38} text={(r.z[1] - r.z[0]).toFixed(2)} tone="ink" />)
      }
    }
    if (P.cabEdit) {
      const cm = m.cabinets.find(x => x.c.id === P.cabEdit)
      if (cm) {
        const yc = Y(F, cm.c.z[0]) + 22
        cm.L.columns.forEach((col, i) => dimNodes.push(<HDim key={`cw${i}`} x0={X(F, cm.u0 + col.u[0])} x1={X(F, cm.u0 + col.u[1])} y={yc} text={Math.round(col.width).toLocaleString('en-US')} tone={sel?.k === 'cell' && sel.col === i ? 'ink' : 'white'} />))
        dimNodes.push(<HDim key="cwt" x0={X(F, cm.u0)} x1={X(F, cm.u0 + cm.c.width)} y={yc + 40} text={Math.round(cm.c.width).toLocaleString('en-US')} />)
        const colSel = sel?.k === 'cell' ? sel.col : 1
        cm.L.cells.filter(c => c.column === Math.min(colSel, cm.L.columns.length - 1)).forEach(c => dimNodes.push(<VDim key={`ch${c.row}`} y0={Y(F, c.z[0])} y1={Y(F, c.z[1])} x={X(F, cm.u0) - 36} text={(c.z[1] - c.z[0]).toFixed(2)} tone={sel?.k === 'cell' && sel.row === c.row ? 'ink' : 'white'} />))
        // 分列抓手：薄荷虚线 + 顶上薄荷小药丸
        cm.L.columns.slice(1).forEach((col, i) => {
          const x = X(F, cm.u0 + col.u[0])
          dimNodes.push(<g key={`grip${i}`} data-elev="divider" data-col={i + 1}><path d={`M${x} ${Y(F, cm.c.z[1])}V${Y(F, cm.c.z[0] + (cm.c.plinth ?? 0))}`} stroke={C.mint500} strokeWidth={1.6} strokeDasharray="5 4" pointerEvents="none" /><rect x={x - 6} y={Y(F, cm.c.z[1]) - 22} width={12} height={20} rx={6} fill="#fff" stroke={C.mint500} strokeWidth={1.8} /><rect x={x - 10} y={Y(F, cm.c.z[1]) - 24} width={20} height={Y(F, cm.c.z[0]) - Y(F, cm.c.z[1]) + 24} fill="transparent" style={{ cursor: 'ew-resize' }} /></g>)
        })
      }
    }
  }
  const fadeMask = P.fade ? (() => {
    const x0 = board.x, x1 = board.x + board.w, a = X(F, P.fade![0]), b = X(F, P.fade![1])
    const t0 = Math.max(0, (a - 80 - x0) / (x1 - x0)), t1 = Math.min(1, (b + 80 - x0) / (x1 - x0))
    return (
      <mask id={`${id}-fade`} maskUnits="userSpaceOnUse" x={x0} y={board.y - 200} width={x1 - x0} height={board.h + 400}>
        <linearGradient id={`${id}-fg`} x1={x0} x2={x1} gradientUnits="userSpaceOnUse">
          <stop offset={0} stopColor="#000" /><stop offset={Math.max(0, t0 - 0.0001)} stopColor="#000" stopOpacity={a <= x0 + 81 ? 0 : 1} /><stop offset={Math.max(0, (a - x0) / (x1 - x0))} stopColor="#fff" />
          <stop offset={Math.min(1, (b - x0) / (x1 - x0))} stopColor="#fff" /><stop offset={t1} stopColor="#000" /><stop offset={1} stopColor="#000" />
        </linearGradient>
        <rect x={x0 - 10} y={board.y - 200} width={x1 - x0 + 20} height={board.h + 400} fill={`url(#${id}-fg)`} />
      </mask>
    )
  })() : null
  return (
    <g>
      {fadeMask && <defs>{fadeMask}</defs>}
      <g mask={fadeMask ? `url(#${id}-fade)` : undefined}>
        <rect {...rectProps(board)} fill="#ffffff" filter={P.mini ? undefined : `url(#${id}-sheet)`} pointerEvents="none" />
        <rect {...rectProps(R(F, m.u[0] - endW('l'), -slab, m.u[1] + endW('r'), 0))} fill={`url(#${id}-slab)`} pointerEvents="none" />
        <rect {...rectProps(R(F, m.u[0] - endW('l'), H, m.u[1] + endW('r'), H + slab))} fill={`url(#${id}-slab)`} pointerEvents="none" />
        {m.ends.map(e => <rect key={e.side} {...rectProps(e.side === 'l' ? R(F, m.u[0] - e.thickness, -slab, m.u[0], H + slab) : R(F, m.u[1], -slab, m.u[1] + e.thickness, H + slab))} fill={endFill(e.kind)} pointerEvents="none" />)}
        {out}
        {segDims}
      </g>
      {selNodes}
      {dimNodes}
    </g>
  )
}

/** 选中构件在立面上的矩形（u mm、z m） */
export function rectOfSel(m: ElevModel, decor: Decor | undefined, k: string, id: string): { u: [number, number]; z: [number, number] } | null {
  if (k === 'cabinet') { const c = m.cabinets.find(x => x.c.id === id); return c ? { u: [c.u0, c.u0 + c.c.width], z: [c.c.z[0], c.c.z[1]] } : null }
  if (k === 'panel') { const p = m.panels.find(x => x.p.id === id); return p ? { u: [p.u0 + p.geo.rect.u[0], p.u0 + p.geo.rect.u[1]], z: p.geo.rect.z } : null }
  if (k === 'recess') {
    const n = m.niches.find(x => x.r.id === id)
    if (n) return { u: n.u, z: n.r.rect.z }
    const r = decor?.recesses.find(x => x.id === id)
    if (r && 'panel' in r.host && r.rect.u) { const p = m.panels.find(x => x.p.id === (r.host as { panel: string }).panel); if (p) return { u: [p.u0 + r.rect.u[0], p.u0 + r.rect.u[1]], z: r.rect.z } }
    return null
  }
  if (k === 'furniture') { const f = m.furniture.find(x => x.f.id === id); return f ? { u: f.u, z: f.z } : null }
  return null
}
