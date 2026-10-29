/**
 * D7 · 简版方案（网页 Chat 输出的「只有房间和门」的格式，core simpleToPlan 自动生成墙和门洞）：
 * - SimpleBanner：载入简版后在顶栏下方展开的说明条（柠檬 = 要你注意 / 没把握；红色留给「拆」）。能收起。
 * - SimpleMark：顶栏方案胶囊旁边常驻的「简版」标记，只要 isSimpleDerived(base) 就在（存盘、刷新、自动保存恢复后都在），点它展开 / 收起说明条。
 * 说明条带 data-float：适配（layout.freeRect）会让开它；展开 / 收起时重新适配一次，平面不被压住。
 */
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronUp, PencilRuler, Wand2 } from 'lucide-react'
import { isSimpleDerived } from '@/core/simple'
import { useStore, useT } from '../store'
import { Glass, Pill, Tag, Tip } from '../kit'
import { useIsMobile } from '../layout'
import { cn } from '@/lib/utils'

/** 展开 / 收起说明条：等它进出场后按新的浮卡位置重新适配（画面不被说明条压住，收起后平面放回大的） */
export function setSimpleNoteOpen(open: boolean) {
  const s = useStore.getState()
  s.setSimpleNote(open)
  setTimeout(() => useStore.getState().fit(), open ? 80 : 260)
}

/** 开始加窗：2D、原始结构、门窗工具、类型选「窗」（和左侧工具栏「门窗」→「窗」是同一个入口） */
function startWindow() {
  const s = useStore.getState()
  if (s.mode !== 'original') s.setMode('original')
  if (s.main !== '2d') s.setMain('2d')
  s.setPanel(null)
  s.setOpeningKind('window')
  s.setTool('opening')
  setSimpleNoteOpen(false)
}

export function useIsSimple() {
  return useStore(s => !!s.base && isSimpleDerived(s.base))
}

export function SimpleBanner() {
  const t = useT(), mobile = useIsMobile()
  const simple = useIsSimple(), open = useStore(s => s.simpleNote)
  const mode = useStore(s => s.mode), tool = useStore(s => s.tool), main = useStore(s => s.main), notice = useStore(s => s.notice)
  const [how, setHow] = useState(false)
  useEffect(() => { if (!open) setHow(false) }, [open])
  // 「怎么补窗」展开后说明条变高：等高度动画走完重新适配，平面不被压住
  const toggleHow = () => { setHow(v => !v); setTimeout(() => useStore.getState().fit(), 280) }
  // 画墙 / 门窗等工具激活时顶部是工具提示，装修态有自己的标题和卡片：这两种时候先不出说明条（标记还在）
  const show = simple && open && mode !== 'decor' && !(main === '2d' && tool !== 'select')
  const L = t.simple
  return (
    <AnimatePresence>
      {show && (
        <motion.div key="simple-banner" initial={{ opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.14 } }}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
          className={cn('absolute left-1/2 z-[48] -translate-x-1/2', mobile ? 'w-[calc(100%-24px)]' : 'w-[min(620px,calc(100%-760px))] min-w-[440px]')}
          style={{ top: mobile ? (notice ? 196 : 126) : (notice ? 140 : 88) }}>
          <Glass strong data-float data-testid="simple-banner"
            className={cn('relative overflow-hidden ring-1 ring-inset ring-lemon-300/80', mobile ? 'rounded-[24px] p-3' : 'rounded-[28px] p-4')}>
            {/* 左上一片淡柠檬光：浮在白模上一眼看得到，又不像报错 */}
            <span aria-hidden className="pointer-events-none absolute -left-10 -top-14 size-48 rounded-full bg-lemon-200/55 blur-2xl" />
            {/* 第一行：图标 + 标题（桌面带两枚小标签）+ 右边两个动作；正文在下面（桌面和标题对齐，手机铺满整宽，省高度） */}
            <div className="relative flex items-center gap-3">
              <span className={cn('grid shrink-0 place-items-center rounded-full bg-lemon-200 text-lemon-800 shadow-[inset_0_1px_0_rgb(255_255_255/0.7),0_6px_14px_-8px_rgb(143_154_23/0.6)]', mobile ? 'size-9' : 'size-11')}>
                <Wand2 size={mobile ? 17 : 19} strokeWidth={2.2} />
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className={cn('shrink-0 font-semibold leading-tight tracking-[-0.01em] text-ink-900', mobile ? 'text-[16px]' : 'text-[17px]')}>{L.title}</span>
                {!mobile && <><Tag tone="lemon">{L.tagWalls}</Tag><Tag tone="outline">{L.tagWindows}</Tag></>}
              </div>
              <Pill tone={how ? 'ink' : 'tile'} size="sm" onClick={toggleHow} data-testid="simple-how-window" aria-expanded={how}>{L.howWindow}</Pill>
              <Pill tone="plain" size="sm" onClick={() => setSimpleNoteOpen(false)} data-testid="simple-collapse" className={cn('-mr-1', mobile && 'px-2.5')}>{L.collapse}<ChevronUp size={14} /></Pill>
            </div>
            <div className={cn('relative flex flex-col gap-0.5 text-[12.5px] leading-[1.55] text-ink-600', mobile ? 'mt-2 px-0.5' : 'mt-0.5 pl-14')} data-testid="simple-banner-body">
              <p className="font-semibold text-ink-800">{L.body[0]}</p>
              <p>{L.body[1]}</p>
              <p>{L.body[2]}</p>
            </div>
            <AnimatePresence initial={false}>
              {how && (
                <motion.div key="how" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className={cn('relative overflow-hidden', !mobile && 'pl-14')}>
                  <div className="tile mt-2.5 flex items-center gap-3 rounded-[18px] p-2 pl-3.5" data-testid="simple-how">
                    <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink-700">{mobile ? L.howWindowTouch : L.howWindowText}</p>
                    <Pill tone="ink" size="sm" onClick={startWindow} data-testid="simple-start-window"><PencilRuler size={14} />{L.startWindow}</Pill>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </Glass>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** 顶栏方案胶囊旁边的「简版」标记：一直在；说明条展开时铺柠檬（像按下去的开关），收起时是玻璃底 + 柠檬圆点 */
export function SimpleMark({ compact }: { compact?: boolean }) {
  const t = useT()
  const simple = useIsSimple(), open = useStore(s => s.simpleNote), mode = useStore(s => s.mode)
  if (!simple) return null
  const on = open && mode !== 'decor'
  return (
    <Tip label={t.simple.markTip}>
      <button data-testid="simple-mark" aria-expanded={on} aria-label={t.simple.markTip} onClick={() => setSimpleNoteOpen(!open)}
        className={cn('flex shrink-0 items-center gap-1.5 rounded-full font-semibold transition-[background-color,box-shadow,color] duration-200 active:scale-[0.97]',
          compact ? 'h-[44px] pl-1.5 pr-3 text-[13px]' : 'h-12 pl-2 pr-3.5 text-[13.5px]',
          on ? 'bg-[linear-gradient(180deg,#f5f9c6_0%,#ecf49a_100%)] text-lemon-800 shadow-[inset_0_1px_0_rgb(255_255_255/0.8),0_0_0_1px_rgb(143_154_23/0.22),0_10px_24px_-12px_rgb(143_154_23/0.6)]'
            : 'glass glass-hover text-ink-800')}>
        <span className={cn('grid place-items-center rounded-full', on ? 'bg-white/70 text-lemon-800' : 'bg-lemon-200 text-lemon-800')}>
          <Wand2 size={15} strokeWidth={2.3} />
        </span>
        {t.simple.mark}
      </button>
    </Tip>
  )
}
