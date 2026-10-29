/**
 * 左侧竖排圆形工具（参考图 3）：图标 + 下方文字，选中黑底。
 * 主画布是 3D 时同一位置换成视角工具：2D 改结构、3D 看结果，工具跟着主画布走。
 * 手机上变成底部工具坞。
 */
import { useLayoutEffect, useState, type ReactNode } from 'react'
import { Popover } from 'radix-ui'
import type { OpeningKind } from '@/core/types'
import { motion } from 'motion/react'
import { Columns3, Inbox, PaintRoller, ScanEye, Sofa, Wallpaper } from 'lucide-react'
import { useDecor, type DTool } from '../decor/dstore'
import { DecorToolHint } from '../decor/Chrome'
import { openElevAt } from '../decor/model'
import { BrickWall, Box, DoorOpen, Eye, Focus, ImageDown, ImageUp, Layers2, MousePointer2, Palette, Rows2, Scan, Scissors, Shapes, SquareDashedMousePointer } from 'lucide-react'
import { useStore, useT, type Cam, type Tool } from '../store'
import { Glass, Pill, Segmented, Tip } from '../kit'
import { addLevel } from '../actions'
import { shoot3d } from '../export/GlobalExport'
import { ExtraIcon } from '../kit/extra-icons'
import { PIP, useIsMobile } from '../layout'
import { cn } from '@/lib/utils'

const TOOLS: { id: Exclude<Tool, 'column' | 'shaft' | 'stair' | 'void'>; icon: ReactNode; key: string }[] = [
  { id: 'select', icon: <MousePointer2 size={19} strokeWidth={2.1} />, key: 'V' },
  { id: 'wall', icon: <BrickWall size={19} strokeWidth={2.1} />, key: 'W' },
  { id: 'opening', icon: <DoorOpen size={19} strokeWidth={2.1} />, key: 'D' },
  { id: 'beam', icon: <Rows2 size={19} strokeWidth={2.1} />, key: 'B' },
  { id: 'room', icon: <SquareDashedMousePointer size={19} strokeWidth={2.1} />, key: 'R' },
  { id: 'underlay', icon: <ImageUp size={19} strokeWidth={2.1} />, key: 'U' },
]
const CAMS: { id: Cam; icon: ReactNode; key: string }[] = [
  { id: 'iso', icon: <Box size={19} strokeWidth={2.1} />, key: '7' },
  { id: 'top', icon: <Scan size={19} strokeWidth={2.1} />, key: '8' },
  { id: 'eye', icon: <Eye size={19} strokeWidth={2.1} />, key: '9' },
]

function Item({ on, icon, label, kbd, onClick, compact, mobile, testId, tip }: { on: boolean; icon: ReactNode; label: string; kbd?: string; onClick?(): void; compact?: boolean; mobile?: boolean; testId?: string; tip?: ReactNode }) {
  const railCompact = useStore(s => s.railCompact)
  compact = compact || (!mobile && railCompact)
  const btn = (
    <button onClick={onClick} aria-pressed={on} data-testid={testId} data-rail-item
      className={cn('group flex flex-col items-center gap-1 rounded-[18px] outline-none', mobile ? 'w-[52px] py-0.5' : 'w-[60px] py-0.5')}>
      <span className={cn('relative grid place-items-center rounded-full transition-[background-color,color,box-shadow,transform] duration-200 ease-[var(--ease-out)] group-active:scale-90',
        mobile ? 'size-10' : 'size-11',
        on ? 'bg-ink-900 text-white shadow-[0_8px_18px_-8px_rgb(15_17_21/0.6),inset_0_1px_0_rgb(255_255_255/0.12)]' : 'bg-white/78 text-ink-700 shadow-[inset_0_1px_0_rgb(255_255_255/0.95),0_1px_2px_rgb(40_38_80/0.08),0_0_0_0.5px_rgb(40_38_80/0.06)] group-hover:bg-white group-hover:text-ink-900')}>
        {icon}
      </span>
      {!compact && <span className={cn('text-[11px] font-semibold leading-none transition-colors', on ? 'text-ink-900' : 'text-ink-500')}>{label}</span>}
    </button>
  )
  if (mobile) return btn
  return <Tip label={tip ?? label} kbd={kbd} side="right">{btn}</Tip>
}

export function ToolRail() {
  const t = useT()
  const mobile = useIsMobile()
  const tool = useStore(s => s.tool), main = useStore(s => s.main), cam = useStore(s => s.cam), layers = useStore(s => s.layers)
  const style3d = useStore(s => s.style3d)
  const { setTool, setCam, toggleLayer, fit, setStyle3d } = useStore.getState()
  const is3d = main === '3d'

  const mode = useStore(s => s.mode)
  const dTool = useDecor(s => s.tool), dCanvas = useDecor(s => s.canvas), dSel = useDecor(s => s.sel), probe = useDecor(s => s.probe?.id), look3d = useDecor(s => s.look3d), section3d = useDecor(s => s.section3d)
  const decorItems = () => {
    const D = useDecor.getState()
    const it = (id: DTool, icon: ReactNode, label: string, key: string, onClick?: () => void) =>
      <Item key={id} testId={`dtool-${id}`} on={dTool === id} icon={icon} label={label} kbd={key} onClick={onClick ?? (() => D.setTool(id))} mobile={mobile} />
    if (dCanvas.k === 'plan') return [
      it('select', <MousePointer2 size={19} strokeWidth={2.1} />, '选择', 'V'),
      it('material', <PaintRoller size={19} strokeWidth={2.1} />, '材质', 'M'),
      it('furniture', <Sofa size={19} strokeWidth={2.1} />, '家具', 'F'),
      it('cabinet', <Columns3 size={19} strokeWidth={2.1} />, '柜子', 'C'),
      <Sep key="s" mobile={mobile} />,
      // 立面：选中了墙面直接进；没选中就等你点一面墙
      it('elevpick', <ScanEye size={19} strokeWidth={2.1} />, '立面', 'E', () => { if (dSel?.k === 'face') openElevAt(dSel.face, { s: dSel.s }); else D.setTool('elevpick') }),
    ]
    return [
      it('select', <MousePointer2 size={19} strokeWidth={2.1} />, '选择', 'V'),
      it('panel', <Wallpaper size={19} strokeWidth={2.1} />, '造型', 'P'),
      it('cut', <Inbox size={19} strokeWidth={2.1} />, '挖', 'N'),
      it('cabinet', <Columns3 size={19} strokeWidth={2.1} />, '柜子', 'C'),
      it('material', <PaintRoller size={19} strokeWidth={2.1} />, '材质', 'M'),
    ]
  }
  const items = mode === 'decor' && !is3d ? decorItems() : is3d
    ? [
        // 对准期间视角按钮都不亮（相机不在任何一个预设视角上）；点一个 = 退出对准、切到那个视角
        ...CAMS.map(c => <Item key={c.id} testId={`cam-${c.id}`} on={!(mode === 'decor' && probe) && cam === c.id} icon={c.icon} label={t.tool[c.id]} kbd={c.key} onClick={() => setCam(c.id)} mobile={mobile} />),
        <Sep key="s" mobile={mobile} />,
        ...(mode === 'decor'
          // 装修态：「白模」关着 = 平涂（默认，墙地按材料铺平涂色），开着 = 纯白模；两种都能导出 PNG。旁边一格 1.1 m 水平剖切
          ? [<Item key="clay" testId="look-clay" on={look3d === 'clay'} icon={<Palette size={19} strokeWidth={2.1} />} label={look3d === 'clay' ? '白模' : '平涂'} onClick={() => useDecor.getState().set({ look3d: look3d === 'clay' ? 'flat' : 'clay' })} mobile={mobile} />,
            <Item key="sect" testId="section-3d" on={section3d} icon={<Scissors size={19} strokeWidth={2.1} />} label="剖开看"
              // 带字 + 一句白话（D6 B7：本人是装修小白，只有图标时找了半天、也不知道有什么用）
              tip={<span className="block max-w-[240px] whitespace-normal leading-snug"><b className="font-semibold">剖开看</b><br />像在腰的高度把房子横着切开往下看：柜子嵌进墙里多少、哪里挖了洞，从外面看不到，切开就能看到</span>} onClick={() => useDecor.getState().set({ section3d: !section3d })} mobile={mobile} />]
          : [<Item key="clay" testId="style-clay" on={style3d === 'clay'} icon={<Palette size={19} strokeWidth={2.1} />} label={t.style3d.clay} onClick={() => setStyle3d(style3d === 'clay' ? 'struct' : 'clay')} mobile={mobile} />,
            ...(mobile ? [] : [<Item key="ceil" on={layers.ceilings && style3d !== 'clay'} icon={<Layers2 size={19} strokeWidth={2.1} />} label={t.tool.ceilings} onClick={() => toggleLayer('ceilings')} mobile={mobile} />])]),
        <Item key="reset" on={false} icon={<Focus size={19} strokeWidth={2.1} />} label={t.tool.reset} kbd="F" onClick={fit} mobile={mobile} />,
        <ExportShot key="shot" mobile={mobile} />,
        // P1–P3 探针从工具栏收掉（D6）：只留网址参数 ?probe=p1|p2|p3 给 e2e 和开发；用户用 3D 里选中构件旁边的「对准」
      ]
    : TOOLS.map((x, i) => [
        i === TOOLS.length - 1 ? <MoreStructure key="more" mobile={mobile} /> : null,
        i === TOOLS.length - 1 ? <Sep key="s" mobile={mobile} /> : null,
        <Item key={x.id} on={tool === x.id} icon={x.icon} label={t.tool[x.id]} kbd={x.key} onClick={() => setTool(x.id)} mobile={mobile} />,
      ])

  const top = useLeftColumn(mobile, is3d, `${mode}:${dCanvas.k}`)

  if (mobile) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center px-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <Glass data-float className="pointer-events-auto flex w-full max-w-[420px] items-center justify-between rounded-[26px] px-1.5 py-1.5">{items}</Glass>
      </div>
    )
  }
  return (
    <motion.div initial={{ x: -16, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 30, delay: 0.08 }}
      className="absolute left-5 z-30" style={{ top }}>
      <Glass data-float data-rail className="flex flex-col items-center gap-0.5 rounded-[30px] px-1 py-2">{items}</Glass>
    </motion.div>
  )
}

const LABEL = 15 // 每个工具按钮下面文字标签占的高度（gap 4 + 字 11）
/**
 * 桌面左列按实际高度排：标题块下面 16px 放工具栏；放不下就先去掉文字标签；
 * 工具栏底部会碰到左下画中画时，画中画往右让到工具栏旁边（pipShift，适配和 3D 取景都会跟着让）。
 */
function useLeftColumn(mobile: boolean, is3d: boolean, extra = '') {
  const [top, setTop] = useState(200)
  const mode = useStore(s => s.mode), lang = useStore(s => s.lang)
  useLayoutEffect(() => {
    if (mobile) { useStore.setState({ pipShift: 0, railCompact: false }); return }
    const rail = () => document.querySelector<HTMLElement>('[data-rail]')
    const measure = () => {
      const el = rail()
      if (!el) return
      const H = window.innerHeight
      const title = document.querySelector('[data-title-block]')?.getBoundingClientRect()
      const t = Math.round(Math.max(110, (title && title.height ? title.bottom : 180) + 16))
      const st = useStore.getState()
      const n = el.querySelectorAll('[data-rail-item]').length
      const fullH = st.railCompact ? el.offsetHeight + n * LABEL : el.offsetHeight
      const compact = t + fullH > H - 20
      const railH = compact ? fullH - n * LABEL : fullH
      const shift = t + railH + 12 > H - 20 - PIP.h ? 20 + el.offsetWidth + 12 - 20 : 0
      setTop(t)
      if (compact !== st.railCompact || shift !== st.pipShift) useStore.setState({ railCompact: compact, pipShift: shift })
    }
    measure()
    const raf = requestAnimationFrame(measure) // 标题块是动画进场的，下一帧再量一次
    const ro = new ResizeObserver(measure)
    const el = rail(), tb = document.querySelector('[data-title-block]')
    if (el) ro.observe(el)
    if (tb) ro.observe(tb)
    window.addEventListener('resize', measure)
    return () => { cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [mobile, is3d, mode, lang, extra])
  return top
}

function Sep({ mobile }: { mobile?: boolean }) {
  return mobile ? <span className="mx-0.5 h-7 w-px bg-ink-900/8" /> : <span className="my-0.5 h-px w-8 bg-ink-900/8" />
}

/** 导出图片：当前视角、2 倍像素、不带界面；背景纯白 / 透明 */
function ExportShot({ mobile }: { mobile?: boolean }) {
  const t = useT()
  const [bg, setBg] = useState<'white' | 'transparent'>('white')
  const [aspect, setAspect] = useState<'view' | '16:9'>('view')
  const [open, setOpen] = useState(false)
  const glass = useDecor(s => s.exportGlass)
  const go = () => {
    shoot3d(bg, aspect)
    setOpen(false)
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <span><Item on={open} testId="shot-open" icon={<ImageDown size={19} strokeWidth={2.1} />} label={mobile ? t.shot.go.replace(' PNG', '') : t.shot.title} mobile={mobile} /></span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side={mobile ? 'top' : 'right'} align="end" sideOffset={12} className="glass-strong z-[70] w-64 rounded-[22px] p-3 data-[state=open]:animate-[shimmer-in_180ms_var(--ease-out)]">
          <div className="px-1 text-[14px] font-semibold text-ink-900">{t.shot.title}</div>
          <div className="mt-0.5 px-1 text-[11.5px] text-ink-500">{t.shot.sub}</div>
          <div className="mt-3 px-1 text-[11.5px] font-semibold text-ink-500">{t.shot.bg}</div>
          <div className="tile-sunken mt-1.5 rounded-full p-0.5">
            <Segmented size="sm" value={bg} onChange={v => setBg(v as 'white' | 'transparent')} options={[{ value: 'white' as const, label: t.shot.white, testId: 'shot-bg-white' }, { value: 'transparent' as const, label: t.shot.transparent, testId: 'shot-bg-transparent' }]} />
          </div>
          <div className="mt-3 px-1 text-[11.5px] font-semibold text-ink-500">{t.shot.aspect}</div>
          <div className="tile-sunken mt-1.5 rounded-full p-0.5">
            <Segmented size="sm" value={aspect} onChange={v => setAspect(v as 'view' | '16:9')} options={[{ value: 'view' as const, label: t.shot.aspView, testId: 'shot-aspect-view' }, { value: '16:9' as const, label: t.shot.asp169, testId: 'shot-aspect-169' }]} />
          </div>
          {aspect === '16:9' && <div className="mt-1.5 px-1 text-[11px] leading-snug text-ink-400">{t.shot.aspNote}</div>}
          {/* 透明背景时窗户默认实心浅灰：半透明玻璃会透出合成底色，给生图模型的轮廓不干净（D3 拍板第 3 条的倾向） */}
          {bg === 'transparent' && <>
            <div className="mt-3 px-1 text-[11.5px] font-semibold text-ink-500">{useStore.getState().lang === 'zh' ? '窗户' : 'Windows'}</div>
            <div className="tile-sunken mt-1.5 rounded-full p-0.5" data-testid="shot-glass">
              <Segmented size="sm" value={glass} onChange={v => useDecor.getState().set({ exportGlass: v as 'solid' | 'clear' })} options={[{ value: 'solid' as const, label: useStore.getState().lang === 'zh' ? '实心浅灰' : 'Solid grey', testId: 'shot-glass-solid' }, { value: 'clear' as const, label: useStore.getState().lang === 'zh' ? '半透明' : 'See-through', testId: 'shot-glass-clear' }]} />
            </div>
          </>}
          <Pill tone="ink" size="md" onClick={go} className="mt-3 w-full" data-testid="shot-go"><ImageDown size={15} />{t.shot.go}</Pill>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * 「更多结构」二级菜单：柱、管道井、楼梯、挑空、新建楼层。低频构件不占工具栏，一个入口收起来；
 * 选中其中一个工具时，这个入口本身变墨底并换成那个构件的图标，看得出「现在在画什么」。
 */
const EXTRA_TOOLS = ['column', 'shaft', 'stair', 'void'] as const
function MoreStructure({ mobile }: { mobile?: boolean }) {
  const t = useT()
  const tool = useStore(s => s.tool)
  const [open, setOpen] = useState(false)
  const active = (EXTRA_TOOLS as readonly string[]).includes(tool) ? tool as typeof EXTRA_TOOLS[number] : null
  const row = 'flex w-full items-center gap-3 rounded-[14px] px-2.5 py-2 text-left transition hover:bg-white/80 focus-visible:bg-white/80 outline-none'
  const pickTool = (k: typeof EXTRA_TOOLS[number]) => { setOpen(false); useStore.getState().setTool(k) }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <span><Item on={open || !!active} testId="tool-more" icon={active ? <ExtraIcon type={active} size={19} /> : <Shapes size={19} strokeWidth={2.1} />} label={active ? t.s2a.tool[active] : mobile ? t.act.more : t.s2a.tool.more} mobile={mobile} /></span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content side={mobile ? 'top' : 'right'} align={mobile ? 'center' : 'start'} sideOffset={12} style={mobile ? { background: 'rgb(252 252 254 / 0.98)' } : undefined} className="glass-strong z-[70] w-[272px] rounded-[22px] p-1.5 data-[state=open]:animate-[shimmer-in_180ms_var(--ease-out)]">
          <div className="px-2.5 pb-1 pt-1.5 text-[12px] font-semibold text-ink-500">{t.s2a.tool.more}</div>
          {EXTRA_TOOLS.map(k => (
            <button key={k} data-testid={`more-${k}`} onClick={() => pickTool(k)} className={row}>
              <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', tool === k ? 'bg-ink-900 text-white' : 'tile text-ink-700')}><ExtraIcon type={k} size={17} /></span>
              <span className="min-w-0"><span className="block text-[13.5px] font-semibold text-ink-900">{t.s2a.tool[k]}</span><span className="block truncate text-[11.5px] text-ink-500">{t.s2a.moreSub[k]}</span></span>
            </button>
          ))}
          <div className="mx-2 my-1 h-px bg-ink-900/6" />
          <button data-testid="more-level" onClick={() => { setOpen(false); addLevel() }} className={row}>
            <span className="grid size-9 shrink-0 place-items-center rounded-full tile text-ink-700"><ExtraIcon type="level" size={17} /></span>
            <span className="min-w-0"><span className="block text-[13.5px] font-semibold text-ink-900">{t.s2a.tool.newLevel}</span><span className="block truncate text-[11.5px] text-ink-500">{t.s2a.moreSub.newLevel}</span></span>
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

const KINDS: OpeningKind[] = ['door', 'sliding', 'doorway', 'window', 'floor-window', 'bay-window', 'open-balcony']

export function ToolHint() {
  const t = useT()
  const tool = useStore(s => s.tool), main = useStore(s => s.main), kind = useStore(s => s.openingKind)
  const mobile = useIsMobile()
  const mode = useStore(s => s.mode)
  if (mode === 'decor') return main === '3d' ? null : <DecorToolHint />
  if (tool === 'select' || main === '3d') return null
  return (
    <motion.div key={tool} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
      className={cn('pointer-events-none absolute left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2', mobile ? 'top-[232px] w-[calc(100%-24px)]' : 'top-[86px]')}>
      <div className="flex max-w-full items-center gap-2 whitespace-nowrap rounded-full bg-ink-900/90 py-1.5 pl-3 pr-1.5 text-[12px] font-medium text-white shadow-lg backdrop-blur-md">
        <span className="truncate">{tool in t.toolHint ? t.toolHint[tool as keyof typeof t.toolHint] : t.s2a.toolHint[tool as keyof typeof t.s2a.toolHint]}</span>
        <span className="num rounded-full bg-white/14 px-2 py-0.5 text-[10.5px] text-white/80">Esc</span>
      </div>
      {tool === 'opening' && (
        <div className="glass pointer-events-auto flex max-w-full gap-1 overflow-x-auto rounded-full p-1">
          {KINDS.map(k => (
            <button key={k} data-testid={`okind-${k}`} onClick={() => useStore.getState().setOpeningKind(k)}
              className={cn('h-7 shrink-0 rounded-full px-2.5 text-[12px] font-semibold transition', kind === k ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-white')}>{t.opening[k]}</button>
          ))}
        </div>
      )}
    </motion.div>
  )
}
