/**
 * 装修态的平面画法（docs/decor/设计规范.md §4）。插在 PlanLayers 的两个位置：
 * - DecorUnder：房间之后、梁和墙之前（地面材料、纸白内沿、拆墙墙位、地毯、柜子、造型）；
 * - DecorOver：门窗之后、尺寸和房间名之前（嵌入缺口、家具、墙面色带、没地方挂的幽灵、选中）。
 * 结构的颜色继续只说「要你注意」；材料一律走 planTone 压低彩度，不描粗边、不发光。
 */
import { memo, useMemo, type ReactNode } from 'react'
import clipping from 'polygon-clipping'
import type { Plan, Room, Vec2 } from '@/core/types'
import type { Cabinet, Decor, FaceRef, Material, Panel } from '@/core/decor/types'
import { layoutCabinet, cabinetTransform } from '@/core/decor/cabinets'
import { panelSpan, panelTransform } from '@/core/decor/panels'
import { faceAxis, faceExtent } from '@/core/decor/faces'
import { pointInPolygon, wallFootprint, wallLength } from '@/core/geometry'
import { polyPath } from '../geom'
import { C, D, planTone } from '../canvas2d/style'
import { embedFootprint, embedsOf, faceFinish, faceSideName, floorFinish, footprintOf, matOf, roleMat, styleOf, isWholeFace, findItem, type DecorIssues } from './model'
import { FurnitureSymbol, FurnShadowDef, furnTones } from './furniture'
import type { DSel } from './dstore'

export interface DecorLayerProps {
  plan: Plan
  base: Plan
  decor: Decor
  k: number
  pid: string
  styleId: string
  keep: boolean
  sel: DSel | null
  hover: DSel | null
  issues: DecorIssues | null
  mini?: boolean
  /** 立面画中画里：标出看的是哪面墙 */
  focusFace?: FaceRef | null
  drag?: ReactNode
}

/* ───────── 纹理：真实尺寸的轻量图案（mm，跟着平面缩放）；太密时只剩平涂 ───────── */
function texPattern(id: string, m: Material, k: number, tone = planTone): ReactNode {
  const base = tone(m.color), line = tone(m.color, -0.032), px = (v: number) => v / k
  const t = m.texture
  if (!t) return null
  if (t.kind === 'planks') {
    const [L, H] = t.size ?? [1200, 190]
    if (H * k < 4) return null
    return <pattern key={id} id={id} width={L} height={H * 2} patternUnits="userSpaceOnUse"><rect width={L} height={H * 2} fill={base} /><path d={`M0 ${H}H${L}M0 ${H * 2}H${L}M${L * 0.001} 0V${H}M${L * 0.5} ${H}V${H * 2}`} stroke={line} strokeWidth={px(0.6)} fill="none" /></pattern>
  }
  if (t.kind === 'tiles') {
    const [W, H] = t.size ?? [600, 600]
    if (Math.min(W, H) * k < 4) return null
    return <pattern key={id} id={id} width={W} height={H} patternUnits="userSpaceOnUse"><rect width={W} height={H} fill={base} /><path d={`M0 0H${W}M0 0V${H}`} stroke={line} strokeWidth={px(0.55)} fill="none" /></pattern>
  }
  if (t.kind === 'herringbone') {
    const s = 140, L = 560
    if (s * k < 4) return null
    return <pattern key={id} id={id} width={s * 2} height={L} patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width={s * 2} height={L} fill={base} /><path d={`M0 0V${L}M${s} 0V${L}M0 0L${s} ${s}M${s} ${s * 2}L0 ${s * 3}M${s} ${s}L${s * 2} 0M${s * 2} ${s * 3}L${s} ${s * 2}`} stroke={line} strokeWidth={px(0.6)} fill="none" /></pattern>
  }
  if (t.kind === 'speckle') {
    const d = tone(m.color, -0.022), l2 = tone(m.color, 0.012)
    return <pattern key={id} id={id} width={900} height={900} patternUnits="userSpaceOnUse"><rect width={900} height={900} fill={base} />
      {[[140, 210, 1.1], [520, 90, 0.9], [760, 420, 1.2], [330, 640, 1], [640, 780, 0.9], [80, 820, 0.8]].map(([x, y, r]) => <circle key={`${x}`} cx={x} cy={y} r={px(r)} fill={d} />)}
      <ellipse cx={420} cy={380} rx={260} ry={150} fill={l2} opacity={0.55} /></pattern>
  }
  return null
}
export const texId = (pid: string, m: Material) => `${pid}-m-${m.id}`
const fillOfMat = (pid: string, m: Material, textured: Set<string>) => textured.has(m.id) ? `url(#${texId(pid, m)})` : planTone(m.color)

export function DecorDefs({ pid, k, mats }: { pid: string; k: number; mats: Material[] }) {
  const kk = Math.round(k * 2000) / 2000 // 缩放变一点点不重建图案
  return useMemo(() => (
    <defs>
      {mats.map(m => texPattern(texId(pid, m), m, kk))}
      <FurnShadowDef id={`${pid}-fsh`} k={kk} />
    </defs>
  ), [pid, kk, mats])
}

/* ───────── 柜子：剖切 1.1 m 的平面惯例（§4.3） ───────── */
const CUT = 1.1
function CabinetPlan({ plan, cab, decor, k, styleId, onlyEmbed }: { plan: Plan; cab: Cabinet; decor: Decor; k: number; styleId: string; onlyEmbed?: boolean }) {
  const px = (v: number) => v / k
  let T: (u: number, d: number) => Vec2
  try { T = cabinetTransform(plan, cab) } catch { return null }
  const L = layoutCabinet(cab)
  const style = styleOf(styleId, decor)
  const front = planTone(matOf(decor, cab.materials.front || style.roles['cabinet.front']).color)
  const top = planTone(matOf(decor, cab.top?.material ?? style.roles['stone.top']).color)
  const wood = planTone(roleMat(style, 'wood.main', decor).color)
  const OL = { stroke: D.outline, strokeWidth: px(1.05) }
  const XL = { stroke: D.detail, strokeWidth: px(0.7), fill: 'none' }
  const poly = (u0: number, u1: number, d0: number, d1: number) => [T(u0, d0), T(u1, d0), T(u1, d1), T(u0, d1)]
  const D0 = 0, D1 = cab.depth
  const out: ReactNode[] = []
  const cutsAt = cab.z[0] < CUT && cab.z[1] > CUT
  if (cab.family === 'wall') {
    out.push(<path key="w" d={polyPath(poly(0, cab.width, D0, D1))} fill="rgb(22 25 30 / 0.03)" stroke={D.upper} strokeWidth={px(1)} strokeDasharray={`${px(5)} ${px(4)}`} />)
    return <g data-decor="cabinet" data-id={cab.id}>{out}</g>
  }
  if (!cutsAt) {
    // 剖切面以下（地柜、悬空柜、电视柜）：看得到、没剖到。地柜俯视看到的是台面
    const floating = cab.z[0] > 0.05
    const fill = cab.top ? top : front
    out.push(<path key="b" d={polyPath(poly(0, cab.width, D0, D1 + (cab.top?.overhang ?? 0)))} fill={fill} stroke={floating ? D.upper : D.outline} strokeWidth={px(floating ? 0.85 : 1.05)} />)
    for (const c of L.cells) {
      if (c.type !== 'appliance') continue
      const t = c.cell.appliance?.type
      const cx = (c.u[0] + c.u[1]) / 2, P = T(cx, D1 * 0.5), r = Math.min(c.u[1] - c.u[0], D1) * 0.36
      if (t === 'washer' || t === 'dryer') out.push(<g key={`a${c.column}`}><circle cx={P[0]} cy={P[1]} r={r} fill="#fff" stroke={D.upper} strokeWidth={px(0.8)} /><circle cx={P[0]} cy={P[1]} r={r * 0.6} fill="none" stroke={D.detail} strokeWidth={px(0.7)} /></g>)
    }
    return <g data-decor="cabinet" data-id={cab.id}>{out}</g>
  }
  // 剖到的高柜：按列画。剖切处是柜体 = 交叉线；是挖洞 = 虚线（上面还有柜子）+ 细实线台面；是家电 = 家电外形
  L.columns.forEach((col, ci) => {
    const cell = L.cells.find(c => c.column === ci && c.z[0] <= CUT && c.z[1] > CUT)
    const [u0, u1] = col.u
    const p = poly(u0, u1, D0, D1)
    if (cell?.type === 'void' || cell?.type === 'open') {
      const top = cell.cell.void?.top
      out.push(<path key={`v${ci}`} d={polyPath(p)} fill="rgb(22 25 30 / 0.03)" stroke={D.upper} strokeWidth={px(1)} strokeDasharray={`${px(5)} ${px(4)}`} />)
      if (top) out.push(<path key={`t${ci}`} d={polyPath(poly(u0, u1, D0, D1 + (top.overhang ?? 0)))} fill={wood} fillOpacity={0.55} stroke={D.upper} strokeWidth={px(0.85)} />)
    } else if (cell?.type === 'appliance') {
      out.push(<path key={`c${ci}`} d={polyPath(p)} fill={front} {...OL} />)
      const q = poly(u0 + 50, u1 - 50, D0 + 40, D1 - 40)
      out.push(<path key={`a${ci}`} d={polyPath(q)} fill="#fff" stroke={D.detail} strokeWidth={px(0.8)} />)
      const a = T(u0 + 50, D1 - 120), b = T(u1 - 50, D1 - 120)
      out.push(<path key={`al${ci}`} d={`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`} {...XL} />)
    } else {
      out.push(<path key={`c${ci}`} d={polyPath(p)} fill={front} {...OL} />)
      out.push(<path key={`x${ci}`} d={`M${p[0][0]} ${p[0][1]}L${p[2][0]} ${p[2][1]}M${p[1][0]} ${p[1][1]}L${p[3][0]} ${p[3][1]}`} {...XL} />)
    }
  })
  if (onlyEmbed) return <g>{out}</g>
  return <g data-decor="cabinet" data-id={cab.id}>{out}</g>
}

/* ───────── 造型：墙面前一条实际厚度的色条；挖洞处变薄 ───────── */
function PanelPlan({ plan, p, decor, k, styleId, keep }: { plan: Plan; p: Panel; decor: Decor; k: number; styleId: string; keep: boolean }) {
  const px = (v: number) => v / k
  let T: (u: number, d: number) => Vec2, W = 0
  try { const sp = panelSpan(plan, p); T = panelTransform(plan, p); W = Math.abs(sp.s[1] - sp.s[0]) } catch { return null }
  if (p.type === 'skirting') return null
  const th = p.type === 'slats' ? p.slats?.depth ?? p.thickness : p.thickness
  let local: [number, number][][][] = [[[[0, 0], [W, 0], [W, th], [0, th]]]]
  const holes = decor.recesses.filter(r => 'panel' in r.host && r.host.panel === p.id && r.rect.u && r.rect.z[0] < CUT + 0.9)
  for (const h of holes) {
    const dep = h.depth === 'through' ? th : Math.min(th, h.depth)
    local = clipping.difference(local, [[[h.rect.u![0], th - dep], [h.rect.u![1], th - dep], [h.rect.u![1], th + 1], [h.rect.u![0], th + 1]]]) as [number, number][][][]
  }
  const d = local.map(rings => rings.map(r => polyPath(r.map(([u, dd]) => T(u, dd)))).join('')).join('')
  // 风格预览且「不保留单独改过的」：造型按新风格的点缀墙材料画（和应用后的结果一致）
  const mat = keep ? p.material : styleOf(styleId, decor).roles['wall.accent'] ?? p.material
  return <path d={d} fill={planTone(matOf(decor, mat).color)} stroke={D.outline} strokeWidth={px(0.9)} fillRule="evenodd" data-decor="panel" data-id={p.id} />
}

/* ───────── 墙面色带：只画和风格默认不同的面（例外才画）；离墙面 1px 纸白缝 + 3px ───────── */
function faceLine(plan: Plan, face: FaceRef, off: number, s?: [number, number]): string | null {
  try {
    const ax = faceAxis(plan, face), ext = s ?? faceExtent(plan, face)
    const a = ax.at(ext[0], off), b = ax.at(ext[1], off)
    return `M${a[0]} ${a[1]}L${b[0]} ${b[1]}`
  } catch { return null }
}

export const DecorUnder = memo(function DecorUnder(p: DecorLayerProps) {
  const { plan, base, decor, k, pid, styleId, keep } = p
  const px = (v: number) => v / k
  const floors = useMemo(() => plan.rooms.map(r => ({ r, f: floorFinish(plan, decor, r, styleId, keep) })), [plan, decor, styleId, keep])
  const textured = useMemo(() => new Set(floors.map(x => x.f.material).filter(m => m.texture && texPattern('x', m, k)).map(m => m.id)), [floors, k])
  const mats = useMemo(() => [...new Map(floors.map(x => [x.f.material.id, x.f.material])).values()], [floors])
  const fillOf = (r: Room) => { const f = floors.find(x => x.r.id === r.id)!.f; return fillOfMat(pid, f.material, textured) }
  // 拆掉的墙位：地面按两侧接上（压在纸白线上面，开敞处不出现「门槛」）
  const gaps = useMemo(() => {
    const ids = new Set(plan.walls.map(w => w.id))
    return base.walls.filter(w => !ids.has(w.id) && !plan.walls.some(x => x.id.startsWith(w.id + '~'))).map(w => {
      const fp = wallFootprint(w), L = wallLength(w), n: Vec2 = [-(w.b[1] - w.a[1]) / L, (w.b[0] - w.a[0]) / L]
      const m: Vec2 = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2]
      const r = [1, -1].map(sd => plan.rooms.find(rr => pointInPolygon([m[0] + n[0] * sd * (w.thickness / 2 + 30), m[1] + n[1] * sd * (w.thickness / 2 + 30)], rr.poly))).find(Boolean)
      return r ? { id: w.id, fp, r } : null
    }).filter(Boolean) as { id: string; fp: Vec2[]; r: Room }[]
  }, [plan, base])
  const tones = furnTones(decor, styleId)
  return (
    <g pointerEvents="none" data-layer="decor-under">
      <DecorDefs pid={pid} k={k} mats={mats} />
      {floors.map(({ r }) => <path key={r.id} d={polyPath(r.poly)} fill={fillOf(r)} data-floor={r.id} />)}
      {!p.mini && floors.map(({ r }) => <path key={`e${r.id}`} d={polyPath(r.poly)} fill="none" stroke="rgb(255 255 255 / .9)" strokeWidth={px(2)} />)}
      {gaps.map(g => <path key={`g${g.id}`} d={polyPath(g.fp)} fill={fillOf(g.r)} />)}
      {decor.furniture.filter(f => f.type === 'rug').map(f => <FurnitureSymbol key={f.id} f={f} plan={plan} k={k} tones={tones} />)}
      {decor.cabinets.map(c => <CabinetPlan key={c.id} plan={plan} cab={c} decor={decor} k={k} styleId={styleId} />)}
      {decor.panels.map(pn => <PanelPlan key={pn.id} plan={plan} p={pn} decor={decor} k={k} styleId={styleId} keep={keep} />)}
    </g>
  )
})

export const DecorOver = memo(function DecorOver(p: DecorLayerProps) {
  const { plan, decor, k, pid, styleId, keep, sel, hover, issues } = p
  const px = (v: number) => v / k
  const tones = furnTones(decor, styleId)
  const embeds = useMemo(() => embedsOf(plan, decor), [plan, decor])
  const orphanIds = new Set(issues?.orphans.map(i => i.id) ?? [])
  const bands = keep ? decor.surfaces.filter(s => 'face' in s.target && isWholeFace(s)).map(s => {
    const face = (s.target as { face: FaceRef }).face
    const def = faceFinish(plan, decor, face, styleId, false)
    if (def.material.id === s.material) return null
    const d = faceLine(plan, face, px(2.5))
    return d ? <path key={s.id} d={d} stroke={planTone(matOf(decor, s.material).color, -0.06)} strokeWidth={px(3)} strokeLinecap="round" fill="none" /> : null
  }) : []
  return (
    <g data-layer="decor-over">
      <g pointerEvents="none">
        {/* 嵌入：墙体里扣出一块（填柜子 / 龛内的样色），原墙面画墨色虚线；高柜的交叉线连到墙里 */}
        {embeds.map(e => {
          const it = findItem(decor, e.id)
          if (!it || orphanIds.has(e.id)) return null
          let fp: Vec2[]
          try { fp = embedFootprint(plan, e) } catch { return null }
          const cutHere = e.z[0] < CUT && e.z[1] > CUT
          const orig = faceLine(plan, e.face, 0, e.s)
          if (it.k === 'cabinet') return (
            <g key={e.id}>
              <CabinetPlan plan={plan} cab={it.it as Cabinet} decor={decor} k={k} styleId={styleId} onlyEmbed />
              {orig && <path d={orig} stroke={D.embedLine} strokeWidth={px(0.9)} strokeDasharray={`${px(3)} ${px(2.2)}`} fill="none" />}
            </g>
          )
          const back = planTone(matOf(decor, ('back' in it.it && it.it.back) || faceFinish(plan, decor, e.face, styleId, keep).material.id).color, -0.03)
          return (
            <g key={e.id} data-decor="recess" data-id={e.id}>
              {cutHere ? <path d={polyPath(fp)} fill={back} stroke={D.outline} strokeWidth={px(0.8)} /> : <path d={polyPath(fp)} fill="none" stroke={D.outline} strokeWidth={px(0.9)} strokeDasharray={`${px(3)} ${px(2.2)}`} />}
              {orig && cutHere && <path d={orig} stroke={D.embedLine} strokeWidth={px(0.9)} strokeDasharray={`${px(3)} ${px(2.2)}`} fill="none" />}
            </g>
          )
        })}
        {decor.furniture.filter(f => f.type !== 'rug').map(f => <FurnitureSymbol key={f.id} f={f} plan={plan} k={k} tones={tones} filter={p.mini ? undefined : `url(#${pid}-fsh)`} dim={p.drag !== undefined && sel?.k === 'furniture' && sel.id === f.id ? false : undefined} />)}
        {/* 墙面色带画在家具上面：它说的是墙面，靠墙的床、柜子不能把它盖掉 */}
        {bands}
        {/* 没地方挂了：画在原处，柠檬斜纹 + 柠檬虚线 */}
        {[...orphanIds].map(id => {
          const c = decor.cache?.[id]
          if (!c) return null
          const [x0, y0, x1, y1] = c.box
          return <path key={`o${id}`} data-orphan={id} d={`M${x0} ${y0}H${x1}V${y1}H${x0}Z`} fill={`url(#${pid}-lemon)`} stroke={C.lemon600} strokeWidth={px(1.5)} strokeDasharray={`${px(6)} ${px(4)}`} />
        })}
        {p.focusFace && <FocusFace plan={plan} face={p.focusFace} k={k} />}
      </g>
      {!p.mini && hover && <Highlight plan={plan} decor={decor} s={hover} k={k} hover />}
      {!p.mini && sel && <Highlight plan={plan} decor={decor} s={sel} k={k} />}
      {p.drag}
    </g>
  )
})

/** 胶囊里文字的宽（px）：中文按一个字号，数字、字母、空格按 0.6 个字号（设计规范 §5.3） */
const textW = (t: string, fs: number) => [...t].reduce((a, ch) => a + (/[\u2E80-\uFFFF]/.test(ch) ? fs : fs * 0.6), 0)

/** 立面画中画：薄荷色带标出看的是哪面墙 + 一个视锥（人站在房间里朝墙看） */
function FocusFace({ plan, face, k }: { plan: Plan; face: FaceRef; k: number }) {
  const px = (v: number) => v / k
  try {
    const ax = faceAxis(plan, face), ext = faceExtent(plan, face)
    const a = ax.at(ext[0], px(2)), b = ax.at(ext[1], px(2))
    const mid = ax.at((ext[0] + ext[1]) / 2, Math.min(2600, (ext[1] - ext[0]) * 0.55))
    return (
      <g>
        <path d={`M${a[0]} ${a[1]}L${b[0]} ${b[1]}L${mid[0]} ${mid[1]}Z`} fill="rgb(85 211 165 / 0.16)" />
        <path d={`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`} stroke={C.mint400} strokeWidth={px(3.4)} strokeLinecap="round" />
        <circle cx={mid[0]} cy={mid[1]} r={px(6)} fill="#fff" stroke={C.mint700} strokeWidth={px(2.2)} />
        <circle cx={mid[0]} cy={mid[1]} r={px(2.4)} fill={C.mint700} />
      </g>
    )
  } catch { return null }
}

/** 选中 / 悬停：装修态只描边 + 角柄，不再整块铺薄荷（会把材料盖掉）；墙面 = 贴着墙面一条薄荷色带 + 两端白圆柄 */
function Highlight({ plan, decor, s, k, hover }: { plan: Plan; decor: Decor; s: DSel; k: number; hover?: boolean }) {
  const px = (v: number) => v / k
  const col = hover ? C.mint400 : C.mint500
  if (s.k === 'floor') {
    const r = plan.rooms.find(x => x.id === s.id)
    if (!r) return null
    return <path d={polyPath(r.poly)} fill={hover ? 'rgb(85 211 165 / 0.06)' : 'none'} stroke={col} strokeWidth={px(hover ? 1.4 : 2.2)} pointerEvents="none" />
  }
  if (s.k === 'face') {
    try {
      const ax = faceAxis(plan, s.face), ext = faceExtent(plan, s.face)
      const a = ax.at(ext[0], px(2.5)), b = ax.at(ext[1], px(2.5))
      // 墙有两侧：色带旁的小标签写清是哪一侧（D6 B6）。标签放在这一侧的房间里，离墙 18px；悬停淡一档、选中墨底
      const L = ext[1] - ext[0], mid = s.s != null && s.s > ext[0] && s.s < ext[1] ? s.s : (ext[0] + ext[1]) / 2
      const m = ax.at((ext[0] + ext[1]) / 2, px(2.5) + px(20))
      const side = `${faceSideName(plan, s.face, mid)}一侧`
      const text = hover ? side : `${side} · ${(L / 1000).toFixed(2)} m`
      const tw = textW(text, 11) + 22
      return (
        <g pointerEvents="none" data-face-label={side}>
          <path d={`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`} stroke={hover ? 'rgb(85 211 165 / 0.55)' : C.mint400} strokeWidth={px(3.2)} strokeLinecap="round" />
          {!hover && [a, b].map((q, i) => <circle key={i} cx={q[0]} cy={q[1]} r={px(5.5)} fill="#fff" stroke={C.mint700} strokeWidth={px(1.8)} />)}
          <g transform={`translate(${m[0]} ${m[1]})`}>
            <rect x={px(-tw / 2)} y={px(-10)} width={px(tw)} height={px(20)} rx={px(10)} fill={hover ? 'rgb(255 255 255 / 0.94)' : C.ink} stroke={hover ? C.mint400 : 'none'} strokeWidth={px(1)} />
            <text y={px(4)} fontSize={px(11)} fontWeight={650} fill={hover ? C.mint700 : '#fff'} textAnchor="middle" className="num">{text}</text>
          </g>
        </g>
      )
    } catch { return null }
  }
  if (s.k === 'cell') return null
  const it = findItem(decor, s.id)
  if (!it) return null
  const fp = footprintOf(plan, it.k, it.it) ?? (decor.cache?.[s.id] ? (() => { const [x0, y0, x1, y1] = decor.cache![s.id].box; return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as Vec2[] })() : null)
  if (!fp) return null
  return (
    <g pointerEvents="none">
      <path d={polyPath(fp)} fill={hover ? 'rgb(85 211 165 / 0.08)' : 'rgb(85 211 165 / 0.06)'} stroke={col} strokeWidth={px(hover ? 1.4 : 2)} />
      {!hover && fp.map((q, i) => <rect key={i} x={q[0] - px(4)} y={q[1] - px(4)} width={px(8)} height={px(8)} rx={px(1.5)} fill="#fff" stroke={C.mint700} strokeWidth={px(1.5)} />)}
    </g>
  )
}
