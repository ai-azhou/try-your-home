/**
 * 指北针（S2a）：2D 角落一枚二级玻璃圆钮，指针指向方案的北（plan.north：0 = 图上方，顺时针为正）。
 * 按住拖动旋转改北向（吸附到 45° 的整数倍附近，按住 ⇧ 每 15° 一档），双击回正。
 * 桌面在缩放条左边，手机在左上角（顶栏下面）。
 */
import { useRef, useState } from 'react'
import { useStore, useT } from '../store'
import { useIsMobile } from '../layout'
import { Tip } from '../kit'
import { cn } from '@/lib/utils'

export function Compass() {
  const t = useT()
  const north = useStore(s => s.base?.north ?? 0), has = useStore(s => s.base?.north !== undefined)
  const main = useStore(s => s.main), mode = useStore(s => s.mode)
  const mobile = useIsMobile()
  const el = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState(false)
  if (main !== '2d') return null
  const ro = mode === 'compare'
  const angleAt = (e: React.PointerEvent, shift: boolean) => {
    const r = el.current!.getBoundingClientRect()
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2)
    if (Math.hypot(dx, dy) < 4) return null
    let a = Math.atan2(dx, -dy) * 180 / Math.PI
    if (shift) a = Math.round(a / 15) * 15
    else { a = Math.round(a); const near = Math.round(a / 45) * 45; if (Math.abs(a - near) <= 3) a = near }
    if (a <= -180) a += 360
    if (a > 180) a -= 360
    return a
  }
  const set = (a: number) => {
    const s = useStore.getState()
    if (!s.base || a === (s.base.north ?? 0) && s.base.north !== undefined) return
    s.replaceBase({ ...s.base, north: a }, { key: 'north' })
  }
  return (
    <div data-float className={cn('absolute z-30', mobile ? 'left-3 top-[124px]' : 'bottom-5 right-[284px]')}>
      <Tip label={<span>{t.s2a.north.title} <span className="num">{Math.round(north)}°</span> · {t.s2a.north.hint}</span>} side="top">
        <div ref={el} role="slider" aria-label={t.s2a.north.title} aria-valuemin={-180} aria-valuemax={180} aria-valuenow={Math.round(north)} data-testid="compass" data-north={north}
          onPointerDown={e => { if (ro) return; e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag(true) }}
          onPointerMove={e => { if (!drag) return; const a = angleAt(e, e.shiftKey); if (a !== null) set(a) }}
          onPointerUp={e => { setDrag(false); (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId) }}
          onPointerCancel={() => setDrag(false)}
          onDoubleClick={() => !ro && set(0)}
          className={cn('glass-chip relative grid select-none place-items-center rounded-full transition-transform duration-150', mobile ? 'size-11' : 'size-[52px]', ro ? 'cursor-default' : drag ? 'cursor-grabbing scale-105' : 'cursor-grab hover:scale-105')}>
          {/* 刻度圈 */}
          <svg viewBox="0 0 52 52" className="absolute inset-0 size-full">
            {Array.from({ length: 12 }, (_, i) => {
              const a = i * 30 * Math.PI / 180, r0 = i % 3 ? 22 : 20.5
              return <line key={i} x1={26 + Math.sin(a) * r0} y1={26 - Math.cos(a) * r0} x2={26 + Math.sin(a) * 23.5} y2={26 - Math.cos(a) * 23.5} stroke="#16191e" strokeOpacity={i % 3 ? 0.14 : 0.28} strokeWidth={1.2} strokeLinecap="round" />
            })}
            <g transform={`rotate(${north} 26 26)`} style={{ transition: drag ? 'none' : 'transform 220ms var(--ease-out)' }}>
              <path d="M26 8.5 30.4 26 26 23.6 21.6 26Z" fill="#16191e" opacity={has ? 1 : 0.45} />
              <path d="M26 43.5 30.4 26 26 28.4 21.6 26Z" fill="#b3b8c0" opacity={has ? 1 : 0.45} />
              <circle cx="26" cy="26" r="2.2" fill="#fff" stroke="#16191e" strokeWidth="1.2" />
              <text x="26" y="6.2" textAnchor="middle" fontSize="7.5" fontWeight="800" fill="#16191e" opacity={has ? 1 : 0.5} transform={`rotate(${-north} 26 4)`} style={{ fontFamily: 'var(--font-sans)' }}>{t.s2a.north.title === '指北针' ? '北' : 'N'}</text>
            </g>
          </svg>
        </div>
      </Tip>
    </div>
  )
}
