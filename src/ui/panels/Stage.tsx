/**
 * 主画布 + 画中画。2D 和 3D 各占一个层，谁是主画布谁铺满，另一个缩进画中画小窗。
 * 两个层都常驻（WebGL 上下文不重建），切换时只动位置和尺寸，两边选中天然联动。
 */
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowLeftRight, Box, Map as MapIcon } from 'lucide-react'
import { PlanCanvas } from '../canvas2d/PlanCanvas'
import { Scene3D } from '@/three/Scene3D'
import { useStore, useT } from '../store'
import { PIP, useIsMobile } from '../layout'
import { Tip } from '../kit'
import { cn } from '@/lib/utils'
import { useDecor } from '../decor/dstore'
import { ElevationCanvas } from '../decor/ElevationCanvas'

function useViewport() {
  const [s, setS] = useState({ w: window.innerWidth, h: window.innerHeight })
  useEffect(() => { const on = () => setS({ w: window.innerWidth, h: window.innerHeight }); window.addEventListener('resize', on); return () => window.removeEventListener('resize', on) }, [])
  return s
}

export function Stage() {
  const main = useStore(s => s.main), swap = useStore(s => s.swapMain), shift = useStore(s => s.pipShift)
  const t = useT()
  const mobile = useIsMobile()
  const vp = useViewport()
  const pip = mobile
    ? { left: vp.w - 12 - PIP.mw, top: 118, width: PIP.mw, height: PIP.mh, borderRadius: 22 }
    : { left: 20 + shift, top: vp.h - 20 - PIP.h, width: PIP.w, height: PIP.h, borderRadius: 26 }
  const full = { left: 0, top: 0, width: vp.w, height: vp.h, borderRadius: 0 }
  const spring = { type: 'spring' as const, stiffness: 260, damping: 32, mass: 0.9 }
  // 装修态的立面 / 柜体编辑：主画布是立面，画中画永远是平面（标出看的是哪面墙）；3D 层留着不重建，只是藏起来
  const mode = useStore(s => s.mode), dCanvas = useDecor(s => s.canvas)
  const elev = mode === 'decor' && dCanvas.k !== 'plan' && main === '2d'

  const layer = (which: '2d' | '3d') => {
    const isMain = !elev && main === which
    if (elev && which === '3d') return <div key="3d" className="pointer-events-none absolute opacity-0" style={pip}><Scene3D mini /></div>
    return (
      <motion.div key={which} initial={false} animate={isMain ? full : pip} transition={spring}
        data-pip={isMain ? undefined : which} className={cn('absolute overflow-hidden', isMain ? 'z-0' : 'z-30')}
        style={isMain ? undefined : { boxShadow: 'var(--glass-edge), var(--glass-ring), var(--shadow-lift)' }}>
        {/* 画中画本身是一块玻璃：底下的画布和柔光透过来，里面的平面 / 3D 照常画 */}
        {!isMain && <div className="glass absolute inset-0" />}
        {which === '2d' ? <PlanCanvas mini={!isMain} /> : <Scene3D mini={!isMain} />}
        {!isMain && (
          <>
            <div className="pointer-events-none absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/80" />
            <div className="pointer-events-none absolute left-2.5 top-2.5 flex items-center gap-1.5 glass-chip rounded-full py-1 pl-1.5 pr-2.5 text-[11px] font-semibold text-ink-700 max-md:hidden">
              <span className="grid size-[18px] place-items-center rounded-full bg-mint-200 text-mint-900">{which === '3d' ? <Box size={11} strokeWidth={2.6} /> : <MapIcon size={11} strokeWidth={2.6} />}</span>
              {which === '3d' ? t.view.live : t.view.planMini}
              {which === '3d' && <span className="relative ml-0.5 size-1.5 rounded-full bg-mint-500"><span className="pulse-ring absolute inset-0 rounded-full bg-mint-400" /></span>}
            </div>
            <Tip label={elev ? '回平面' : t.view.swap} kbd={elev ? 'Esc' : 'Tab'} side="top">
              <button onClick={elev ? () => useDecor.getState().backToPlan() : swap} data-testid="pip-swap" onPointerDown={e => e.stopPropagation()}
                className="glass-chip glass-hover absolute right-2 top-2 grid size-8 place-items-center rounded-full text-ink-700 transition hover:text-ink-900 active:scale-90 max-md:right-1.5 max-md:top-1.5 max-md:size-7">
                <ArrowLeftRight size={14} strokeWidth={2.4} />
              </button>
            </Tip>
          </>
        )}
      </motion.div>
    )
  }
  return <>{elev && <motion.div key="elev" initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.22 }} className="absolute inset-0 z-0"><ElevationCanvas /></motion.div>}{layer('2d')}{layer('3d')}</>
}
