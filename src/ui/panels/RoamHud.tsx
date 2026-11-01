/**
 * 漫游的设置卡：视角宽度、平视高度、怎么走、退出。桌面放右下（左下是画中画平面），手机铺底部、默认收起，不挡画面。
 */
import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Footprints, MoveHorizontal, MoveVertical, X } from 'lucide-react'
import { ROAM, hFovOf, vFovFor } from '@/three/roam'
import { useT } from '../store'
import { Glass, Pill, Segmented, Slider, Tip } from '../kit'
import { useIsMobile } from '../layout'
import { exitRoam, useRoam } from '../roam'
import { LevelSwitch } from './Levels'
import { fmt } from '../i18n'
import { cn } from '@/lib/utils'

/** 鼠标拖完滑块：把焦点还给页面，WASD 和方向键才能接着走（键盘调滑块的人焦点留着，能连续按） */
const release = () => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() }

function useAspect() {
  const [a, setA] = useState(() => window.innerWidth / Math.max(1, window.innerHeight))
  useEffect(() => { const on = () => setA(window.innerWidth / Math.max(1, window.innerHeight)); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on) }, [])
  return a
}

export function RoamHud() {
  const t = useT().roam
  const mobile = useIsMobile()
  const fov = useRoam(s => s.fov), eye = useRoam(s => s.eye), set = useRoam(s => s.set)
  const [open, setOpen] = useState(!mobile)
  const aspect = useAspect()
  // 竖屏封顶后实际有多宽（照实说，不让人以为选了 120° 就是 120°）
  const actual = Math.round(hFovOf(vFovFor(fov, aspect), aspect))
  const capped = actual < fov - 1
  const fovNote = capped ? fmt(t.fovCapped, { n: actual }) : fov < 75 ? t.fovFocus : fov <= 105 ? t.fovNatural : t.fovWide
  const fovNames = [t.fovFocusName, t.fovNaturalName, t.fovWideName], eyeNames = [t.eyeSit, t.eyeStand, t.eyeTall]
  const cm = Math.round(eye * 100)
  return (
    <div data-float data-testid="roam-hud" className={cn('absolute z-40', mobile ? 'inset-x-3 bottom-[max(12px,env(safe-area-inset-bottom))]' : 'bottom-5 right-5 w-[348px]')}>
      {/* 漫游的背景不可控（深色家具、黑电视）：用不透明度高的玻璃，字才一直看得清 */}
      <Glass strong className="rounded-[26px] p-3">
        <div className="flex items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink-900 text-white"><Footprints size={15} strokeWidth={2.2} /></span>
          <button onClick={() => setOpen(!open)} data-testid="roam-collapse" aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none">
            <span className="shrink-0 text-[14px] font-semibold text-ink-900">{t.title}</span>
            {!open && <span className="num truncate text-[12px] font-medium text-ink-500" data-testid="roam-summary">{actual}° · {eye.toFixed(2)} m</span>}
            {open ? <ChevronDown size={15} className="shrink-0 text-ink-400" /> : <ChevronUp size={15} className="shrink-0 text-ink-400" />}
          </button>
          <LevelSwitch />
          <Tip label={t.exit} kbd="Esc" side="top"><Pill tone="glass" size="sm" onClick={exitRoam} data-testid="roam-exit"><X size={14} />{t.exit}</Pill></Tip>
        </div>
        {open && <>
          <div className="mt-3 flex items-baseline justify-between px-1">
            <span className="text-[12px] font-semibold text-ink-500">{t.fov}</span>
          </div>
          <div className="tile-sunken mt-1.5 rounded-full p-0.5">
            <Segmented size="sm" value={String(fov)} onChange={v => set({ fov: +v })} options={ROAM.fov.presets.map((n, i) => ({ value: String(n), label: <><span>{fovNames[i]}</span><span className="num opacity-70">{n}°</span></>, testId: `roam-fov-${n}` }))} />
          </div>
          <div className="mt-1.5" data-testid="roam-fov" onPointerUp={release}><Slider value={fov} min={ROAM.fov.min} max={ROAM.fov.max} suffix="°" label={t.fov} icon={<MoveHorizontal size={15} />} onChange={v => set({ fov: v })} /></div>
          <p className="mt-1.5 px-1 text-[11.5px] leading-snug text-ink-500" data-testid="roam-fov-note">{fovNote}</p>

          <div className="mt-3 flex items-baseline justify-between px-1">
            <span className="text-[12px] font-semibold text-ink-500">{t.eye}</span>
          </div>
          <div className="tile-sunken mt-1.5 rounded-full p-0.5">
            <Segmented size="sm" value={eye.toFixed(2)} onChange={v => set({ eye: +v })} options={ROAM.eye.presets.map((n, i) => ({ value: n.toFixed(2), label: <><span>{eyeNames[i]}</span><span className="num opacity-70">{n.toFixed(2)}</span></>, testId: `roam-eye-${Math.round(n * 100)}` }))} />
          </div>
          <div className="mt-1.5" data-testid="roam-eye" onPointerUp={release}><Slider value={cm} min={ROAM.eye.min * 100} max={ROAM.eye.max * 100} suffix=" cm" label={t.eye} icon={<MoveVertical size={15} />} onChange={v => set({ eye: v / 100 })} /></div>
          <p className="mt-1.5 px-1 text-[11.5px] leading-snug text-ink-500">{t.eyeNote}</p>

          <div className="mt-3 border-t border-ink-900/6 px-1 pt-2 text-[11.5px] leading-snug text-ink-500">{mobile ? t.helpTouch : t.help}</div>
        </>}
      </Glass>
    </div>
  )
}
