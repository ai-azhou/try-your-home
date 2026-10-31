/**
 * 家具平面块：白模摆件——白填充 + 细墨线 + 一层软影，细节线每件不超过 4 根（设计规范 §4.5）。
 * 家具库卡片里用的是同一个符号（不是图标），拖进来以后长得一样。
 * 局部坐标：宽沿 x、深沿 y，背面在 −y，正面朝 +y（数据格式 §7：rot 0 = 正面朝屏幕下方）。
 */
import type { ReactNode } from 'react'
import type { ComponentPath, CustomComponent, Decor, Furniture, MaterialRole } from '@/core/decor/types'
import { FURNITURE_LIBRARY, furniturePose, isFlatFurniture, type FurnitureEntry } from '@/core/decor/furniture'
import { componentOf, componentPlanPaths } from '@/core/decor/components'
import type { Plan, Vec2 } from '@/core/types'
import { planLine, planTone, D, C } from '../canvas2d/style'
import { roleMat, styleOf } from './model'
import { isBigOverhead, overheadLabelAt, overheadLabelW } from './plan-ctl'

export const FURN_LIB: FurnitureEntry[] = FURNITURE_LIBRARY
export const FURN_CATS = ['客厅', '卧室', '餐厨', '书房', '卫浴', '家电', '收纳', '软装']
export const furnEntry = (type: string) => FURN_LIB.find(f => f.type === type)

export function furnTones(decor: Decor | undefined, styleId?: string) {
  const st = styleOf(styleId ?? decor?.style, decor)
  const t = (r: MaterialRole) => planTone(roleMat(st, r, decor).color)
  return { fabric: t('fabric.main'), wood: t('wood.main'), rug: t('rug'), stone: t('stone.top') }
}
type Tones = ReturnType<typeof furnTones>

/** 家具的名字：实例没写就用构件定义、家具库的 */
export function furnitureName(decor: Decor | undefined, f: Furniture): string {
  return f.name ?? componentOf(decor, f.type)?.name ?? furnEntry(f.type)?.name ?? '家具'
}

/**
 * Agent 画的构件（路径来自方案文件，只当 <path d> 属性用，不拼 HTML）：
 * 路径坐标是 size 画布、(0,0) 在左上，平移到以中心为原点的局部坐标；线宽按屏幕 px 换算，填色走 planTone。
 */
function pathAttrs(p: ComponentPath, px: (v: number) => number) {
  const style = p.style ?? 'outline'
  const fill = p.fill === 'none' ? 'none' : p.fill ? planTone(p.fill) : style === 'outline' ? D.clay : 'none'
  const stroke = p.stroke === 'none' ? 'none' : p.stroke ? planLine(p.stroke) : style === 'outline' ? D.outline : style === 'detail' ? D.detail : D.upper
  return { fill, stroke, strokeWidth: px(style === 'outline' ? 1.05 : style === 'detail' ? 0.7 : 0.9), fillRule: 'evenodd' as const, ...(style === 'dashed' ? { strokeDasharray: `${px(4)} ${px(3)}` } : {}) }
}
/** size 画布 → 家具局部坐标（实例尺寸和定义一致时比例就是 1；校验会提示不一致） */
const canvasToLocal = (def: CustomComponent, w: number, d: number) => `translate(${-w / 2} ${-d / 2}) scale(${w / def.size[0]} ${d / def.size[1]})`
function componentPaths(def: CustomComponent): ComponentPath[] {
  try { return componentPlanPaths(def) } catch { return [{ d: `M0 0H${def.size[0]}V${def.size[1]}H0Z`, style: 'outline' }] }
}
export function componentBody(def: CustomComponent, w: number, d: number, px: (v: number) => number): ReactNode {
  return <g transform={canvasToLocal(def, w, d)}>{componentPaths(def).map((p, i) => <path key={i} d={p.d} {...pathAttrs(p, px)} />)}</g>
}

/** 符号本体（局部坐标，mm）。px = 屏幕像素 → mm */
export function symbolBody(type: string, w: number, d: number, px: (v: number) => number, T: Tones, def?: CustomComponent): ReactNode {
  if (def) return componentBody(def, w, d, px)
  const hw = w / 2, hd = d / 2
  const OL = { stroke: D.outline, strokeWidth: px(1.05) }
  const DL = { stroke: D.detail, strokeWidth: px(0.7), fill: 'none' }
  const rr = (x: number, y: number, ww: number, hh: number, r: number, fill: string, extra: object = OL) => <rect x={x} y={y} width={Math.max(0, ww)} height={Math.max(0, hh)} rx={Math.min(r, ww / 2, hh / 2)} fill={fill} {...extra} />
  const box = (fill: string) => rr(-hw, -hd, w, d, 30, fill)
  switch (type) {
    case 'sofa-3': case 'sofa-2': {
      const arm = Math.min(170, w * 0.1), back = Math.min(200, d * 0.24), n = type === 'sofa-3' ? 3 : 2
      const seams = Array.from({ length: n - 1 }, (_, i) => -hw + arm + (w - 2 * arm) * (i + 1) / n)
      return <>{rr(-hw, -hd, w, d, 70, T.fabric)}<path d={`M${-hw + arm} ${-hd + back}H${hw - arm}M${-hw + arm} ${-hd + back}V${hd - 40}M${hw - arm} ${-hd + back}V${hd - 40}${seams.map(x => `M${x} ${-hd + back}V${hd - 70}`).join('')}`} {...DL} /></>
    }
    case 'armchair': return <>{rr(-hw, -hd, w, d, 90, T.fabric)}<path d={`M${-hw + 150} ${-hd + 190}H${hw - 150}M${-hw + 150} ${-hd + 190}V${hd - 50}M${hw - 150} ${-hd + 190}V${hd - 50}`} {...DL} /></>
    case 'coffee-table': return <>{rr(-hw, -hd, w, d, 60, T.wood)}{rr(-hw + 70, -hd + 70, w - 140, d - 140, 30, 'none', DL)}</>
    case 'rug': return <>{rr(-hw, -hd, w, d, 30, T.rug, { stroke: '#c6cbd2', strokeWidth: px(0.7) })}{rr(-hw + 90, -hd + 90, w - 180, d - 180, 10, 'none', { stroke: '#c6cbd2', strokeWidth: px(0.6), fill: 'none', strokeDasharray: `${px(2)} ${px(2.4)}` })}</>
    case 'dining-table': case 'desk': return <>{rr(-hw, -hd, w, d, 40, T.wood)}{type === 'desk' && <path d={`M${-hw + 60} ${-hd + 90}H${hw - 60}`} {...DL} />}</>
    case 'tv-stand': return <>{rr(-hw, -hd, w, d, 30, T.wood)}<path d={`M${-hw / 3} ${-hd}V${hd}M${hw / 3} ${-hd}V${hd}`} {...DL} /></>
    case 'chair': return <>{rr(-hw, -hd + 60, w, d - 60, 70, D.clay)}<path d={`M${-hw + 40} ${-hd + 30}Q0 ${-hd - 30} ${hw - 40} ${-hd + 30}`} stroke={D.outline} strokeWidth={px(1.6)} fill="none" strokeLinecap="round" /></>
    case 'desk-chair': return <><circle r={Math.min(hw, hd) - 20} fill={D.clay} {...OL} /><path d={`M${-hw + 30} ${-hd + 70}Q0 ${-hd - 20} ${hw - 30} ${-hd + 70}`} stroke={D.outline} strokeWidth={px(1.6)} fill="none" strokeLinecap="round" /></>
    case 'bed-1800': case 'bed-1500': case 'bed-1200': {
      const two = w >= 1400, pw = two ? (w - 300) / 2 : w - 200
      return <>{rr(-hw, -hd, w, d, 50, D.clay)}
        {rr(-hw + 100, -hd + 110, pw, 330, 70, '#ffffff', { stroke: D.detail, strokeWidth: px(0.8) })}
        {two && rr(100, -hd + 110, pw, 330, 70, '#ffffff', { stroke: D.detail, strokeWidth: px(0.8) })}
        {rr(-hw + 10, -hd + 560, w - 20, d - 570, 40, T.fabric, { stroke: D.detail, strokeWidth: px(0.7) })}
        <path d={`M${-hw + 10} ${hd - 560}H${hw - 10}`} {...DL} /></>
    }
    case 'nightstand': return <>{rr(-hw, -hd, w, d, 40, T.wood)}<circle r={Math.min(hw, hd) * 0.48} fill="#fff" stroke={D.detail} strokeWidth={px(0.7)} /></>
    case 'bookshelf': return <>{box(T.wood)}{[1, 2, 3].map(i => <path key={i} d={`M${-hw + w * i / 4} ${-hd}V${hd}`} {...DL} />)}</>
    case 'wardrobe': return <>{box(D.clay)}<path d={`M${-hw} ${-hd}L${hw} ${hd}M${hw} ${-hd}L${-hw} ${hd}`} {...DL} /></>
    case 'fridge': return <>{rr(-hw, -hd, w, d, 40, '#ffffff')}<path d={`M${-hw + 40} ${hd - 80}H${hw - 40}`} {...DL} /></>
    case 'washer': case 'dryer': return <>{rr(-hw, -hd, w, d, 40, '#ffffff')}<circle r={Math.min(hw, hd) * 0.62} fill="none" stroke={D.upper} strokeWidth={px(0.8)} /><circle r={Math.min(hw, hd) * 0.36} fill="none" stroke={D.detail} strokeWidth={px(0.7)} /></>
    case 'oven': case 'steamer': case 'dishwasher': case 'microwave': return <>{rr(-hw, -hd, w, d, 30, '#ffffff')}<path d={`M${-hw + 50} ${hd - 70}H${hw - 50}`} {...DL} /></>
    case 'tv': return <rect x={-hw} y={-hd} width={w} height={d} rx={Math.min(20, d / 2)} fill="#3b4048" />
    case 'toilet': return <>{rr(-hw, -hd, w, Math.min(200, d * 0.3), 40, D.clay)}<ellipse cx={0} cy={-hd + Math.min(200, d * 0.3) + (d - Math.min(220, d * 0.32)) / 2} rx={hw - 10} ry={(d - Math.min(220, d * 0.32)) / 2} fill={D.clay} {...OL} /></>
    case 'basin': return <>{rr(-hw, -hd, w, d, 40, T.stone)}<ellipse cx={0} cy={hd * 0.1} rx={hw * 0.55} ry={hd * 0.6} fill="#fff" stroke={D.upper} strokeWidth={px(0.8)} /></>
    case 'bathtub': return <>{rr(-hw, -hd, w, d, 60, D.clay)}{rr(-hw + 80, -hd + 80, w - 160, d - 160, 160, '#ffffff', { stroke: D.detail, strokeWidth: px(0.8) })}</>
    case 'shower': return <><path d={`M${-hw} ${-hd}V${hd}H${hw}`} stroke="#4fa3d8" strokeWidth={px(1.6)} fill="none" /><rect x={-60} y={-60} width={120} height={120} rx={20} fill="none" stroke={D.detail} strokeWidth={px(0.8)} /><path d="M-40 0H40M0 -40V40" {...DL} /></>
    case 'cushion': return <>{rr(-hw, -hd, w, d, 90, T.fabric, { stroke: D.upper, strokeWidth: px(0.8) })}{rr(-hw + 120, -hd + 70, Math.min(420, w / 3), d - 140, 90, '#ffffff', { stroke: D.detail, strokeWidth: px(0.7) })}{rr(hw - 120 - Math.min(420, w / 3), -hd + 70, Math.min(420, w / 3), d - 140, 90, '#ffffff', { stroke: D.detail, strokeWidth: px(0.7) })}</>
    default: return box(D.clay)
  }
}
const FLAT = new Set(['rug', 'shower', 'tv'])

/** 位置一律取 core furniturePose：放在宿主里的家电（电视在电视位里）跟着宿主走，自己不存 at */
export function FurnitureSymbol({ f, plan, k, tones, filter, dim }: { f: Furniture; plan: Plan; k: number; tones: Tones; filter?: string; dim?: boolean }) {
  const px = (v: number) => v / k
  const def = componentOf(plan.decor, f.type)
  let at = f.at ?? [0, 0], rot = f.rot ?? 0
  try { const pose = furniturePose(plan, f); at = pose.at; rot = pose.rot } catch { /* 宿主不在了：core 已按 cache 给位置 */ }
  return (
    <g transform={`translate(${at[0]} ${at[1]}) rotate(${rot})${def && f.flip ? ' scale(-1 1)' : ''}`} filter={FLAT.has(f.type) || isFlatFurniture(plan.decor, f) || !filter ? undefined : filter} opacity={dim ? 0.45 : 1} data-decor="furniture" data-id={f.id} data-custom={def ? def.id : undefined}>
      {symbolBody(f.type, f.size[0], f.size[1], px, tones, def)}
    </g>
  )
}

/** 这件的外轮廓路径（画布坐标）；定义没给轮廓就用尺寸框 */
const outlinePaths = (def: CustomComponent) => { const o = componentPaths(def).filter(p => (p.style ?? 'outline') === 'outline'); return o.length ? o : [{ d: `M0 0H${def.size[0]}V${def.size[1]}H0Z` }] }

/**
 * 顶上的东西（吊顶、吸顶灯、吊灯）：只画虚线轮廓，不填色、不投影，地面和家具从下面透出来。
 * 大块吊顶中间不接点选（留给地面和家具），靠轮廓线和这个名字选中，所以把名字标出来。
 */
export function OverheadSymbol({ f, plan, k, mini, pending }: { f: Furniture; plan: Plan; k: number; mini?: boolean; pending?: boolean }) {
  const px = (v: number) => v / k
  const def = componentOf(plan.decor, f.type)
  let at = f.at ?? [0, 0], rot = f.rot ?? 0, fp: Vec2[] = []
  try { const pose = furniturePose(plan, f); at = pose.at; rot = pose.rot; fp = pose.footprint } catch { /* */ }
  if (!def) return null
  const [w, d] = f.size, name = f.name ?? def.name
  const stroke = pending ? C.lav500 : D.upper
  const label = !mini && isBigOverhead(f) && fp.length ? overheadLabelAt(fp, k) : null, lw = overheadLabelW(name)
  return (
    <g data-decor="furniture" data-id={f.id} data-custom={def.id} data-overhead="1" data-pending={pending ? f.id : undefined}>
      <g transform={`translate(${at[0]} ${at[1]}) rotate(${rot})${f.flip ? ' scale(-1 1)' : ''}`}>
        <g transform={canvasToLocal(def, w, d)}>{outlinePaths(def).map((p, i) => <path key={i} d={p.d} fill="none" stroke={stroke} strokeWidth={px(pending ? 1.4 : 1.1)} strokeDasharray={`${px(6)} ${px(4)}`} fillRule="evenodd" />)}</g>
      </g>
      {label && (
        <g transform={`translate(${label[0]} ${label[1]})`} data-overhead-label={f.id}>
          <rect x={px(-lw / 2)} y={px(-9)} width={px(lw)} height={px(18)} rx={px(9)} fill="rgb(255 255 255 / 0.86)" stroke={pending ? C.lav500 : 'rgb(22 27 36 / 0.1)'} strokeWidth={px(1)} />
          <text y={px(3.8)} fontSize={px(11)} fontWeight={650} fill={pending ? C.lav500 : '#6c727c'} textAnchor="middle">{name}</text>
        </g>
      )}
    </g>
  )
}

/** 待确认：淡紫斜纹 + 紫色虚线。构件沿自己的外形，其余沿外接框；和结构提议同一套画法（pid-lav） */
export function PendingFurnitureMark({ f, plan, k, pid }: { f: Furniture; plan: Plan; k: number; pid: string }) {
  const px = (v: number) => v / k
  const def = componentOf(plan.decor, f.type)
  let at = f.at ?? [0, 0], rot = f.rot ?? 0
  try { const pose = furniturePose(plan, f); at = pose.at; rot = pose.rot } catch { /* */ }
  const mark = { fill: `url(#${pid}-lav)`, fillOpacity: 0.72, stroke: C.lav500, strokeWidth: px(1.4), strokeDasharray: `${px(5)} ${px(4)}`, fillRule: 'evenodd' as const }
  const [w, d] = f.size
  const outlines = def ? componentPaths(def).filter(p => (p.style ?? 'outline') === 'outline') : []
  return (
    <g transform={`translate(${at[0]} ${at[1]}) rotate(${rot})${def && f.flip ? ' scale(-1 1)' : ''}`} data-pending={f.id}>
      {def && outlines.length
        ? <g transform={canvasToLocal(def, w, d)}>{outlines.map((p, i) => <path key={i} d={p.d} {...mark} />)}</g>
        : <rect x={-w / 2} y={-d / 2} width={w} height={d} {...mark} />}
    </g>
  )
}

/** 家具库里方案自带的构件：同一套画法，按格子大小缩放 */
export function ComponentPreview({ def, size = 64 }: { def: CustomComponent; size?: number }) {
  const [w, d] = def.size, pad = 0.14, s = Math.max(w, d / 0.72) * (1 + pad * 2)
  const k = size / s
  return (
    <svg width={size} height={size * 0.72} viewBox={`${-s / 2} ${-s * 0.36} ${s} ${s * 0.72}`} className="block" data-preview={def.id}>
      {componentBody(def, w, d, v => v / k)}
    </svg>
  )
}

/** 家具库卡片里的符号：同一套画法，按格子大小缩放 */
export function SymbolPreview({ e, tones, size = 64 }: { e: FurnitureEntry; tones: Tones; size?: number }) {
  const [w, d] = e.size, pad = 0.14, s = Math.max(w, d) * (1 + pad * 2)
  const k = size / s
  return (
    <svg width={size} height={size * 0.72} viewBox={`${-s / 2} ${-s * 0.36} ${s} ${s * 0.72}`} className="block">
      <g transform={w < d && w / d < 0.6 ? 'rotate(90)' : undefined}>{symbolBody(e.type, w, d, v => v / k, tones)}</g>
    </svg>
  )
}

export function FurnShadowDef({ id, k }: { id: string; k: number }) {
  const px = (v: number) => v / k
  return (
    <filter id={id} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
      <feDropShadow dx="0" dy={px(2.2)} stdDeviation={px(2.6)} floodColor="#1c2434" floodOpacity="0.13" />
      <feDropShadow dx="0" dy={px(0.6)} stdDeviation={px(0.5)} floodColor="#1c2434" floodOpacity="0.12" />
    </filter>
  )
}
