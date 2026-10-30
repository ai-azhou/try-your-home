/**
 * 装修态平面上的浮层：没地方挂的柠檬热点（DOM，和问题针同一个 Hotspot）、拖家具时的净距（测距的洋红胶囊）、
 * 柜子工具沿墙拖出来的预览。
 */
import { Unlink } from 'lucide-react'
import type { Plan, Vec2 } from '@/core/types'
import { faceAxis } from '@/core/decor/faces'
import { Hotspot } from '../kit'
import { C } from '../canvas2d/style'
import { useDecor, type CabFamily } from './dstore'
import type { DecorIssues } from './model'
import type { Clear, Fit } from './plan-ctl'

export function DecorPins({ xf, plan, issues }: { xf: { k: number; x: number; y: number }; plan: Plan; issues: DecorIssues }) {
  const sel = useDecor(s => s.sel)
  const decor = plan.decor
  if (!decor) return null
  const ids = [...new Set(issues.orphans.map(i => i.id))]
  return (
    <>
      {ids.map((id, i) => {
        const c = decor.cache?.[id]
        if (!c) return null
        const x = xf.x + (c.box[0] + c.box[2]) / 2 * xf.k, y = xf.y + (c.box[1] + c.box[3]) / 2 * xf.k
        const on = sel && 'id' in sel && sel.id === id
        const k = decor.cabinets.some(z => z.id === id) ? 'cabinet' : decor.panels.some(z => z.id === id) ? 'panel' : decor.recesses.some(z => z.id === id) ? 'recess' : 'furniture'
        return (
          <div key={id} className="absolute z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: x, top: y, transitionDelay: `${i * 60}ms` }} data-testid={`orphan-pin-${id}`}>
            <Hotspot tone="lemon" pulse={!on} active={!!on} icon={<Unlink size={17} strokeWidth={2.3} />} label="没地方挂了" onClick={() => useDecor.getState().select({ k, id } as never)} />
          </div>
        )
      })}
    </>
  )
}

const DIR_LABEL: Record<Clear['dir'], string> = { l: '', r: '', u: '', d: '' }
/** 拖家具：四个方向到墙面、到别的家具的净距（洋红胶囊），加一句放不放得下（压墙、和家具重叠时占地标珊瑚红） */
export function DragClearance({ cl, fit, k }: { cl: Clear[]; fit?: Fit; k: number }) {
  const px = (v: number) => v / k
  // 结论胶囊挂在外接框右上角外侧：净距胶囊都在四条边中点的射线上，角上是空的
  const corner = fit && [Math.max(...fit.poly.map(q => q[0])), Math.min(...fit.poly.map(q => q[1]))]
  const fw = fit ? px(fit.text.length * 11.5 + 18) : 0
  return (
    <g pointerEvents="none" data-testid="drag-clearance">
      {fit && !fit.ok && <path d={`M${fit.poly.map(q => q.join(' ')).join('L')}Z`} fill="rgb(232 96 79 / 0.16)" stroke={C.coral500} strokeWidth={px(2)} />}
      {cl.map(c => {
        const m: Vec2 = [(c.from[0] + c.to[0]) / 2, (c.from[1] + c.to[1]) / 2]
        const t = `${c.what === 'furniture' ? '' : ''}${c.dist.toLocaleString('en-US')}${DIR_LABEL[c.dir]}`
        const w = px(t.length * 6.8 + 14)
        const horiz = c.dir === 'l' || c.dir === 'r'
        const tick = (p: Vec2) => horiz ? `M${p[0]} ${p[1] - px(5)}V${p[1] + px(5)}` : `M${p[0] - px(5)} ${p[1]}H${p[0] + px(5)}`
        if (c.dist * k < 18) return null
        return (
          <g key={c.dir} data-clear={c.dir} data-dist={c.dist}>
            <path d={`M${c.from[0]} ${c.from[1]}L${c.to[0]} ${c.to[1]}${tick(c.from)}${tick(c.to)}`} stroke={C.magenta500} strokeWidth={px(1.4)} fill="none" />
            <g transform={`translate(${m[0]} ${m[1]})`}>
              <rect x={-w / 2} y={px(-9.5)} width={w} height={px(19)} rx={px(9.5)} fill={C.magenta500} stroke="#fff" strokeWidth={px(1.5)} />
              <text y={px(4)} fontSize={px(11)} fontWeight={700} fill="#fff" textAnchor="middle" className="num">{t}</text>
            </g>
          </g>
        )
      })}
      {fit && corner && (
        <g data-testid="drag-fit" data-fit={fit.ok ? 'ok' : 'blocked'} transform={`translate(${corner[0] + px(6)} ${corner[1] - px(27)})`}>
          <rect width={fw} height={px(21)} rx={px(10.5)} fill={fit.ok ? C.mint500 : C.coral500} stroke="#fff" strokeWidth={px(1.5)} />
          <text x={fw / 2} y={px(14.7)} fontSize={px(11.5)} fontWeight={700} fill="#fff" textAnchor="middle">{fit.text}</text>
        </g>
      )}
    </g>
  )
}

const DEPTH: Record<CabFamily, number> = { tall: 600, base: 600, wall: 350 }
/** 柜子工具：悬停墙面出薄荷预览，沿墙拖出宽度 */
export function CabinetDraft({ plan, spec, k, family }: { plan: Plan; spec: string; k: number; family: CabFamily }) {
  const px = (v: number) => v / k
  const [, wall, side, a, b] = spec.split(':')
  try {
    const ax = faceAxis(plan, { wall, side: +side as 1 | -1 })
    const s0 = Math.min(+a, +b), s1 = Math.max(+a, +b), d = DEPTH[family]
    const p = [ax.at(s0, 0), ax.at(s1, 0), ax.at(s1, d), ax.at(s0, d)]
    const m = ax.at((s0 + s1) / 2, d + px(16))
    const t = `${Math.round(s1 - s0).toLocaleString('en-US')} × ${d}`
    return (
      <g pointerEvents="none">
        <path d={`M${p.map(q => q.join(' ')).join('L')}Z`} fill="rgb(85 211 165 / 0.22)" stroke={C.mint500} strokeWidth={px(1.6)} strokeDasharray={`${px(5)} ${px(3)}`} />
        <g transform={`translate(${m[0]} ${m[1]})`}><rect x={px(-42)} y={px(-10)} width={px(84)} height={px(20)} rx={px(10)} fill={C.ink} /><text y={px(4)} fontSize={px(11)} fontWeight={650} fill="#fff" textAnchor="middle" className="num">{t}</text></g>
      </g>
    )
  } catch { return null }
}
