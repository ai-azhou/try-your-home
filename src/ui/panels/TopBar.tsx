import tryMark from '../../assets/try-mark.svg?raw'
import { DropdownMenu, Popover } from 'radix-ui'
import { motion } from 'motion/react'
import { ArrowLeftRight, ArrowUpDown, Box, ChevronDown, CircleQuestionMark, ClipboardPaste, Download, FileBraces, FileJson2, FilePlus2, ImageUp, Languages, Layers, ListChecks, MessageSquareText, Save, Sofa, Sparkles, Upload } from 'lucide-react'
import { useStore, useT, useView, type Layers as L } from '../store'
import { useDecor } from '../decor/dstore'
import { Glass, Pill, RoundButton, Segmented, Switch, Slider, Tip } from '../kit'
import { fmt } from '../i18n'
import { commitUnderlayView, exportPlan, isConnected, mirror, newPlan, openDemo, pickFile, pickPlanFile, saveToFile, setUnderlayView, toggleUnderlayView } from '../actions'
import { underlayOf } from '../levels-ui'
import { copyPlan, openChatIssues, openPaste } from '../chat'
import { LevelSwitch } from './Levels'
import { useIsMobile } from '../layout'
import { cn } from '@/lib/utils'
import { questionStatus } from '@/core/questions'
import { ExportMenuItem } from '../export/entry'
import { GlobalExport } from '../export/GlobalExport'
import { planStats } from '@/core/summary'
import { enterDecor } from '../decor/actions'
import { DecorTitle } from '../decor/Chrome'
import { SimpleMark } from './SimpleNote'

export function AppMark({ size = 30 }: { size?: number }) {
  return <span aria-hidden="true" className="app-mark shrink-0" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: tryMark }} />
}

function FileMenu({ compact }: { compact?: boolean }) {
  const t = useT()
  const base = useStore(s => s.base), lang = useStore(s => s.lang), saveState = useStore(s => s.saveState), dirty = useStore(s => s.dirty), source = useStore(s => s.source), report = useStore(s => s.report)
  const { setLang, setPanel } = useStore.getState()
  const item = 'flex h-10 cursor-pointer select-none items-center gap-3 rounded-[12px] px-3 text-[13.5px] font-medium text-ink-800 outline-none data-[highlighted]:bg-ink-100'
  const status = !base ? t.app.tagline
    : saveState === 'failed' ? t.saveFailed
    : isConnected(source) ? (dirty ? t.unexported : t.served)
    : t.savedLocal
  const dot = saveState === 'failed' ? 'bg-coral-500' : isConnected(source) && dirty ? 'bg-lemon-600' : 'bg-mint-500'
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button data-testid="file-menu" data-float className={cn('glass glass-hover flex h-12 min-w-0 items-center gap-2.5 rounded-full pl-2 pr-3.5 text-left transition', compact && 'h-11 flex-1')}>
          <AppMark />
          <span className="min-w-0 leading-tight">
            <span className="block truncate text-[13.5px] font-semibold text-ink-900">{t.app.name}</span>
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-ink-400">
              {base ? <><span className={cn('size-1.5 rounded-full', dot)} /><span className="truncate" title={base.title}>{base.meta?.planFile?.split('/').pop() ?? base.title}</span><span aria-hidden="true">·</span><span data-testid="save-status" className="shrink-0">{status}</span></> : status}
            </span>
          </span>
          <ChevronDown size={15} className="ml-0.5 shrink-0 text-ink-400" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={10} className="glass-strong z-[70] w-64 rounded-[20px] p-1.5 data-[state=open]:animate-[shimmer-in_180ms_var(--ease-out)]">
          <DropdownMenu.Item className={item} data-testid="menu-open" onSelect={() => void pickPlanFile()}><Upload size={16} className="text-ink-500" />{t.act.open}</DropdownMenu.Item>
          <DropdownMenu.Item className={item} data-testid="menu-paste" onSelect={openPaste}><ClipboardPaste size={16} className="text-lav-600" />{t.chat.paste}</DropdownMenu.Item>
          <DropdownMenu.Item className={item} onSelect={() => pickFile('image/*')}><ImageUp size={16} className="text-ink-500" />{t.act.importImage}</DropdownMenu.Item>
          <DropdownMenu.Item className={item} data-testid="menu-export" disabled={!base} onSelect={exportPlan}><Download size={16} className="text-ink-500" />{t.act.export}{!isConnected(source) && <span className="kbd ml-auto">⌘S</span>}</DropdownMenu.Item>
          <ExportMenuItem className={item} />
          {report && <DropdownMenu.Item className={item} onSelect={() => setPanel('report')}><ListChecks size={16} className="text-ink-500" />{t.act.report}<span className="num ml-auto text-[11.5px] text-ink-400">{report.approximations.length}</span></DropdownMenu.Item>}
          <DropdownMenu.Separator className="mx-2 my-1 h-px bg-ink-900/6" />
          {/* 网页 Chat 来回改：问题和方案都复制成能直接贴回 Chat 的文字（T2） */}
          <DropdownMenu.Item className={item} data-testid="menu-chat-issues" disabled={!base} onSelect={openChatIssues}><MessageSquareText size={16} className="text-lav-600" />{t.chat.copyIssues}</DropdownMenu.Item>
          <DropdownMenu.Item className={item} data-testid="menu-chat-plan" disabled={!base} onSelect={() => void copyPlan()}><FileJson2 size={16} className="text-lav-600" />{t.chat.copyPlan}</DropdownMenu.Item>
          <DropdownMenu.Separator className="mx-2 my-1 h-px bg-ink-900/6" />
          <DropdownMenu.Item className={item} data-testid="menu-mirror" disabled={!base} onSelect={() => mirror('x')}><ArrowLeftRight size={16} className="text-ink-500" />{t.act.mirror}</DropdownMenu.Item>
          <DropdownMenu.Item className={item} disabled={!base} onSelect={() => mirror('y')}><ArrowUpDown size={16} className="text-ink-500" />{t.act.mirrorY}</DropdownMenu.Item>
          <DropdownMenu.Separator className="mx-2 my-1 h-px bg-ink-900/6" />
          <DropdownMenu.Item className={item} onSelect={newPlan}><FilePlus2 size={16} className="text-ink-500" />{t.act.newPlan}</DropdownMenu.Item>
          <DropdownMenu.Item className={item} onSelect={openDemo}><FileBraces size={16} className="text-ink-500" />{t.act.loadDemo}</DropdownMenu.Item>
          <DropdownMenu.Separator className="mx-2 my-1 h-px bg-ink-900/6" />
          <DropdownMenu.Item className={item} onSelect={() => setLang(lang === 'zh' ? 'en' : 'zh')}><Languages size={16} className="text-ink-500" />{t.act.lang}</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function LayersPopover({ children }: { children: React.ReactNode }) {
  const t = useT()
  const layers = useStore(s => s.layers), panel = useStore(s => s.panel)
  const underlay = useStore(s => underlayOf(s.base, s.level))
  const { toggleLayer, setPanel } = useStore.getState()
  // 装修态的「3D 顶面和梁」管的是吊顶和顶灯：单独记、默认关（见 dstore overhead3d）
  const decorMode = useStore(s => s.mode === 'decor'), overhead3d = useDecor(s => s.overhead3d)
  const row = (k: keyof L, label: string, swatch: React.ReactNode) => (
    <div className="flex h-11 items-center gap-3 rounded-[14px] px-2.5">
      <span className="grid size-7 place-items-center rounded-full bg-ink-100 text-ink-600">{swatch}</span>
      <span className="flex-1 text-[13.5px] font-medium text-ink-800">{label}</span>
      <Switch on={k === 'underlay' ? !!underlay?.visible : k === 'ceilings' && decorMode ? overhead3d : layers[k]} onChange={() => { if (k === 'underlay') toggleUnderlayView(); else if (k === 'ceilings' && decorMode) useDecor.getState().set({ overhead3d: !overhead3d }); else toggleLayer(k) }} label={label} />
    </div>
  )
  return (
    <Popover.Root open={panel === 'layers'} onOpenChange={o => setPanel(o ? 'layers' : null)}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={10} className="glass-strong z-[70] w-72 rounded-[22px] p-2 data-[state=open]:animate-[shimmer-in_180ms_var(--ease-out)]">
          <div className="px-2.5 pb-1 pt-1.5 text-[12px] font-semibold text-ink-500">{t.layers.title}</div>
          {row('underlay', t.layers.underlay, <ImageUp size={14} />)}
          {underlay?.visible && (
            <div className="px-2.5 pb-2" data-testid="underlay-opacity"><Slider value={underlay.opacity} onChange={v => setUnderlayView({ opacity: v })} onCommit={commitUnderlayView} icon={<ImageUp size={15} />} /></div>
          )}
          {row('dims', t.layers.dims, <span className="num text-[10px] font-bold">1.2</span>)}
          {row('certainty', t.layers.certainty, <span className="size-2.5 rounded-full border-[1.5px] border-dashed border-lemon-600" />)}
          {row('ceilings', t.layers.ceilings, <Box size={14} />)}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * 「装修」入口（D6 B4）：和结构三段分开的一颗玻璃胶囊，杏色（和装修态左下角的杏色柔光同一个颜色），带图标。
 * 没进装修：玻璃底 + 杏色小圆盘图标；进了装修：整颗铺杏色、字变深棕（选中态），和结构那组的薄荷滑块一样「这一段亮着」。
 */
function DecorPill({ on, compact }: { on: boolean; compact?: boolean }) {
  return (
    <Tip label={on ? '正在装修' : '进装修：选风格、铺材料、摆家具'} kbd="4">
      <button role="tab" aria-selected={on} data-testid="mode-decor" onClick={() => { if (!on) enterDecor() }}
        className={cn('relative flex shrink-0 items-center gap-2 rounded-full font-semibold transition-[background-color,box-shadow,color] duration-200 active:scale-[0.97]',
          compact ? 'h-[44px] pl-1.5 pr-3.5 text-[13px]' : 'h-[46px] pl-1.5 pr-4 text-[13.5px]',
          on ? 'bg-[linear-gradient(180deg,#f8e7d3_0%,#f1d9bd_100%)] text-sand-700 shadow-[inset_0_1px_0_rgb(255_255_255/0.75),0_0_0_1px_rgb(176_132_86/0.22),0_10px_24px_-12px_rgb(150_100_50/0.55)]'
            : 'glass glass-hover text-ink-600 hover:text-ink-900')}>
        <span className={cn('grid size-[34px] place-items-center rounded-full transition-colors', on ? 'bg-white/70 text-sand-700' : 'bg-[rgb(246_222_196/0.85)] text-sand-700')}>
          <Sofa size={16} strokeWidth={2.3} />
        </span>
        装修
      </button>
    </Tip>
  )
}

export function TopBar() {
  const t = useT()
  const mobile = useIsMobile()
  const base = useStore(s => s.base), mode = useStore(s => s.mode), panel = useStore(s => s.panel)
  const { setMode, openAgent, togglePanel, setPanel } = useStore.getState()
  // 角标：还有没答的（柠檬）；都答了但还没交给 Agent 处理的（淡紫）
  const openQ = base?.questions.filter(q => questionStatus(q) === 'open').length ?? 0, waitingQ = base?.questions.filter(q => questionStatus(q) === 'answered').length ?? 0
  const pendingQ = openQ || waitingQ, qTone = openQ ? 'lemon' as const : 'lav' as const
  const nChanges = base?.changes.length ?? 0
  // 结构的三段（原始 / 改造 / 对比）一个分段控件；「装修」是下一章，单独一颗杏色胶囊（D6 B4）
  const modes = (['original', 'renovation', 'compare'] as const).map(v => ({
    value: v, testId: `mode-${v}`,
    label: <>{t.mode[v]}{v === 'renovation' && nChanges > 0 && <span className={cn('num grid h-[17px] min-w-[17px] place-items-center rounded-full px-1 text-[10px] font-bold', mode === v ? 'bg-white/80 text-mint-900' : 'bg-ink-900/8 text-ink-600')}>{nChanges}</span>}</>,
  }))

  if (mobile) {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex flex-col gap-2 px-3 pt-3">
        <div className="pointer-events-auto flex items-center gap-2">
          <FileMenu compact />
          {base && <SaveButton compact />}
          {base && <GlobalExport compact />}
          {base && <RoundButton size="lg" tone={panel === 'questions' ? 'ink' : 'glass'} badge={pendingQ || undefined} badgeTone={qTone} onClick={() => togglePanel('questions')} aria-label={t.q.title}><CircleQuestionMark size={19} /></RoundButton>}
          {base && <LayersPopover><RoundButton size="lg" aria-label={t.act.layers}><Layers size={18} /></RoundButton></LayersPopover>}
        </div>
        {base && (
          <div className="pointer-events-auto flex items-center gap-2">
            {/* 简版标记放第二行：第一行方案胶囊已经很挤，放那里会把方案名挤没（D7） */}
            <SimpleMark compact />
            <Glass className="min-w-0 flex-1 rounded-full">
              <Segmented value={mode} onChange={m => setMode(m)} options={modes} />
            </Glass>
            <DecorPill on={mode === 'decor'} compact />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex h-[80px] items-center gap-3 px-5">
      <div className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2.5"><FileMenu />{base && <SimpleMark />}</div>
      {base && (
        <motion.div initial={{ y: -12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 30, delay: 0.05 }}>
          <div className="pointer-events-auto flex items-center gap-3">
            <Glass className="rounded-full">
              <Segmented value={mode} onChange={m => setMode(m)} options={modes} className="w-[330px]" />
            </Glass>
            <DecorPill on={mode === 'decor'} />
          </div>
        </motion.div>
      )}
      <div className="pointer-events-auto flex flex-1 items-center justify-end gap-2.5">
        {base && <GlobalExport />}
        {base && <SaveButton />}
        {base && (
          <>
            <LayersPopover>
              <span><Tip label={t.act.layers}><RoundButton size="lg" tone={panel === 'layers' ? 'ink' : 'glass'} aria-label={t.act.layers}><Layers size={18} /></RoundButton></Tip></span>
            </LayersPopover>
            <Tip label={t.q.title} kbd="Q">
              <RoundButton size="lg" tone={panel === 'questions' ? 'ink' : 'glass'} badge={pendingQ || undefined} badgeTone={qTone} onClick={() => { togglePanel('questions') }} aria-label={t.q.title}>
                <CircleQuestionMark size={19} />
              </RoundButton>
            </Tip>
            <Tip label={t.act.agent} kbd="A">
              {/* 次要入口：主入口在检查器（有选中时）或底部「下一步」条，这里只是常驻的退路，不抢眼 */}
              <RoundButton size="lg" tone="glass" onClick={() => { setPanel(null); openAgent(true) }} aria-label={t.act.agent} data-testid="topbar-agent">
                <Sparkles size={18} className="text-lav-600" />
              </RoundButton>
            </Tip>
          </>
        )}
        {!base && <RoundButton size="lg" onClick={() => useStore.getState().setLang(useStore.getState().lang === 'zh' ? 'en' : 'zh')} aria-label="language"><Languages size={18} /></RoundButton>}
      </div>
    </div>
  )
}

export function TitleBlock() {
  const t = useT()
  const view = useView(), mode = useStore(s => s.mode), main = useStore(s => s.main), lang = useStore(s => s.lang)
  if (!view) return null
  if (mode === 'decor') return <DecorTitle />
  // 英文词长，显示字降一档，别压到画布的总尺寸线
  const disp = lang === 'zh' ? 'text-[30px]' : 'text-[24px]'
  const { plan, base } = view
  const counted = plan.rooms.filter(r => r.counted !== false)
  // 面积口径（core planStats）：使用面积 netArea（不含墙）+ 含墙面积 grossArea（上限估算）。core 还没给 netArea 时退回 area
  const stats = planStats(plan) as ReturnType<typeof planStats> & { netArea?: number; grossArea?: number; excludedRooms?: { id: string; name: string; area: number }[]; excludedArea?: number }
  // 露台、空调平台这类不计入的房间（core excludedRooms）：使用面积、含墙面积都不含它们，单列一行（backlog #13）
  const excl = stats.excludedRooms ?? []
  const net = stats.netArea ?? stats.area, gross = stats.grossArea
  const pending = base.questions.filter(q => questionStatus(q) === 'open').length
  const diff = view.diff
  return (
    <motion.div key={mode} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
      data-float data-title-block className="pointer-events-none absolute left-7 top-[96px] z-20 select-none">
      <div className={cn(disp, 'font-light leading-[1.12] tracking-[-0.01em] text-ink-700')}>{plan.title}</div>
      <div className={cn(disp, 'font-semibold leading-[1.12] tracking-[-0.015em] text-ink-900')}>{t.modeTitle[mode]}{main === '3d' && <span className="ml-2 text-ink-300">3D</span>}</div>
      <div className="mt-2.5 flex items-center gap-2 text-[12.5px] font-medium text-ink-500">
        <Tip label={<span className="block max-w-[260px] leading-relaxed">{gross !== undefined ? t.area.tip : t.area.tipNetOnly}</span>} side="bottom">
          <span data-testid="area-stats" className="pointer-events-auto flex cursor-help items-center gap-2 decoration-ink-300 decoration-dotted underline-offset-[5px] hover:underline">
            <span>{t.area.net} <span className="num text-ink-800">{net.toFixed(1)} {t.sqm}</span></span>
            {gross !== undefined && <><Dot /><span>{t.area.gross} <span className="num text-ink-800">{gross.toFixed(1)} {t.sqm}</span></span></>}
          </span>
        </Tip>
        <Dot /><span>{fmt(t.stats.rooms, { n: counted.length })}</span>
        {mode === 'original' && <><Dot />{pending ? <span className="text-lemon-800">{fmt(t.stats.pending, { n: pending })}</span> : <span className="text-mint-700">{t.stats.none}</span>}</>}
        {mode !== 'original' && diff && <><Dot /><span className="text-coral-700">−{diff.removed.length}</span><span className="text-cobalt-700">+{diff.added.size}</span><span className="text-ink-500">~{diff.modified.size}</span></>}
      </div>
      {excl.length > 0 && (
        <div data-testid="area-excluded" className="mt-1 text-[12px] font-medium text-ink-400">
          {lang === 'zh' ? '另有 ' : 'Plus '}{excl.map((r, i) => <span key={r.id}>{i ? (lang === 'zh' ? '、' : ', ') : ''}{r.name} <span className="num">{r.area.toFixed(1)}</span></span>)} {t.sqm}{lang === 'zh' ? '（不计入）' : ' (not counted)'}
        </div>
      )}
      <LevelSwitch className="mt-3 w-fit" />
    </motion.div>
  )
}
/** 服务模式、连接文件才有：写回方案文件（⌘S）。有未保存改动时是墨底主按钮，存完退成玻璃 */
function SaveButton({ compact }: { compact?: boolean }) {
  const t = useT()
  const connected = useStore(s => isConnected(s.source)), dirty = useStore(s => s.dirty), saving = useStore(s => s.saving)
  if (!connected) return null
  const label = saving ? t.s2a.save.saving : t.s2a.save.btn
  if (compact) return <RoundButton size="lg" tone={dirty ? 'ink' : 'glass'} onClick={() => void saveToFile()} disabled={saving} aria-label={label} data-testid="save"><Save size={18} /></RoundButton>
  return (
    <Tip label={t.s2a.save.tip} kbd="⌘S">
      <Pill tone={dirty ? 'ink' : 'glass'} size="lg" onClick={() => void saveToFile()} disabled={saving} data-testid="save" data-dirty={dirty || undefined} className="px-4">
        <Save size={16} strokeWidth={2.3} />{label}
      </Pill>
    </Tip>
  )
}
const Dot = () => <span className="size-[3px] shrink-0 rounded-full bg-ink-300" />
