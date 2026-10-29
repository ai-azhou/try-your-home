/**
 * 家具平面块：白模摆件——白填充 + 细墨线 + 一层软影，细节线每件不超过 4 根（设计规范 §4.5）。
 * 家具库卡片里用的是同一个符号（不是图标），拖进来以后长得一样。
 * 局部坐标：宽沿 x、深沿 y，背面在 −y，正面朝 +y（数据格式 §7：rot 0 = 正面朝屏幕下方）。
 */
import type { ReactNode } from 'react'
import type { Decor, Furniture, MaterialRole } from '@/core/decor/types'
import { FURNITURE_LIBRARY, furniturePose, type FurnitureEntry } from '@/core/decor/furniture'
import type { Plan } from '@/core/types'
import { planTone, D } from '../canvas2d/style'
import { roleMat, styleOf } from './model'

/** core 的常用家具 + 界面补的几件（不认识的 type 在 core 里画成通用盒子，不报错） */
const EXTRA: FurnitureEntry[] = [
  { type: 'tv-stand', name: '电视柜', category: '客厅', size: [1800, 400], height: 0.45, symbol: 'tv-stand' },
  { type: 'desk-chair', name: '书桌椅', category: '书房', size: [520, 520], height: 0.9, symbol: 'desk-chair' },
  { type: 'shower', name: '淋浴区', category: '卫浴', size: [900, 900], height: 2.0, symbol: 'shower' },
  { type: 'cushion', name: '飘窗垫', category: '软装', size: [2000, 520], height: 0.12, symbol: 'cushion' },
]
export const FURN_LIB: FurnitureEntry[] = [...FURNITURE_LIBRARY, ...EXTRA.filter(e => !FURNITURE_LIBRARY.some(f => f.type === e.type))]
export const FURN_CATS = ['客厅', '卧室', '餐厨', '书房', '卫浴', '家电', '收纳', '软装']
export const furnEntry = (type: string) => FURN_LIB.find(f => f.type === type)

export function furnTones(decor: Decor | undefined, styleId?: string) {
  const st = styleOf(styleId ?? decor?.style, decor)
  const t = (r: MaterialRole) => planTone(roleMat(st, r, decor).color)
  return { fabric: t('fabric.main'), wood: t('wood.main'), rug: t('rug'), stone: t('stone.top') }
}
type Tones = ReturnType<typeof furnTones>

/** 符号本体（局部坐标，mm）。px = 屏幕像素 → mm */
export function symbolBody(type: string, w: number, d: number, px: (v: number) => number, T: Tones): ReactNode {
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
  let at = f.at ?? [0, 0], rot = f.rot ?? 0
  try { const pose = furniturePose(plan, f); at = pose.at; rot = pose.rot } catch { /* 宿主不在了：core 已按 cache 给位置 */ }
  return (
    <g transform={`translate(${at[0]} ${at[1]}) rotate(${rot})`} filter={FLAT.has(f.type) || !filter ? undefined : filter} opacity={dim ? 0.45 : 1} data-decor="furniture" data-id={f.id}>
      {symbolBody(f.type, f.size[0], f.size[1], px, tones)}
    </g>
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
