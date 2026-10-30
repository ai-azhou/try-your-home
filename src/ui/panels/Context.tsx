/**
 * 右侧上下文卡（桌面）/ 底部抽屉（手机）、改造清单、下一步条、缩放条、提示条。
 * 右侧只放一张卡：选中 → 检查器；原始模式没选中 → 待核对；改造 / 对比没选中 → 改造清单。
 */
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Check, CircleQuestionMark, FlipHorizontal2, FlipVertical2, ImageUp, ListChecks, Lock, Maximize, Minus, MousePointerClick, Pencil, Plus, Redo2, Ruler, Sparkles, Trash, Undo2, X } from 'lucide-react'
import type { Change } from '@/core/types'
import { useStore, useT, useView } from '../store'
import { findEl } from '../model'
import { Glass, Pill, RoundButton, Slider, Switch, Tag, Tip } from '../kit'
import { ConfirmCard, InspectorBody } from './Inspector'
import { QuestionCardBody, QuestionList } from './Questions'
import { describeChange } from '@/core/changes'
import { applyCalibration, pickFile } from '../actions'
import { relinkUnderlay } from '../underlay-check'
import { fmt } from '../i18n'
import { bottomSlot, useIsMobile, useIsNarrow } from '../layout'
import { cn } from '@/lib/utils'
import { ExportButton } from '../export/entry'
import { DecorCard, decorCardKey } from '../decor/Cards'
import { DecorNext } from '../decor/Chrome'
import { useDecor } from '../decor/dstore'

type Card = 'inspector' | 'questions' | 'changes' | 'question' | 'underlay' | 'report' | 'decor' | null

export function useCard(): Card {
  const sel = useStore(s => s.sel), mode = useStore(s => s.mode), panel = useStore(s => s.panel), base = useStore(s => s.base), qOpen = useStore(s => s.qOpen)
  const mobile = useIsMobile()
  const tool = useStore(s => s.tool), main = useStore(s => s.main)
  if (!base) return null
  if (panel === 'report') return 'report'
  if (mode === 'decor') return 'decor'
  if (tool === 'underlay' && main === '2d') return 'underlay'
  if (sel.length) return 'inspector'
  if (mobile && qOpen) return 'question'
  if (panel === 'questions') return 'questions'
  if (mobile) return panel === 'changes' ? 'changes' : null
  if (mode === 'original') return base.questions.some(q => !q.answer) ? 'questions' : null
  return 'changes'
}

export function RightColumn() {
  const card = useCard()
  const mobile = useIsMobile()
  const sel = useStore(s => s.sel)
  // 所有 hook 都在提前 return 之前（D6：手机 ↔ 桌面来回拉宽时 hook 数量变了，React #300）
  const dkey = useDecor(s => decorCardKey(s))
  if (mobile) return <MobileSheet card={card} />
  const key = card === 'inspector' ? 'i-' + sel.map(s => s.id).join(',') : card === 'decor' ? 'd-' + dkey : card
  return (
    <div className="pointer-events-none absolute bottom-[88px] right-5 top-[88px] z-30 flex w-[372px] flex-col">
      <AnimatePresence mode="popLayout" initial={false}>
        {card && card !== 'question' && (
          <motion.div key={key ?? 'x'} layout="position"
            initial={{ opacity: 0, x: 28, scale: 0.98 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 18, scale: 0.98, transition: { duration: 0.16 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            className="pointer-events-auto max-h-full">
            <Glass className="scroll-thin flex max-h-full flex-col gap-4 overflow-y-auto rounded-[30px] p-4 pb-5 [&>*]:shrink-0">
              {card === 'inspector' && <InspectorBody />}
              {card === 'questions' && <QuestionList />}
              {card === 'changes' && <ChangesBody />}
              {card === 'underlay' && <UnderlayBody />}
              {card === 'report' && <ReportBody />}
              {card === 'decor' && <DecorCard />}
            </Glass>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ───────── 手机底部抽屉 ───────── */
function MobileSheet({ card }: { card: Card }) {
  const tall = useStore(s => s.sheetTall)
  const { setSheetTall, select, setPanel, openQuestion } = useStore.getState()
  const close = () => { select(null); setPanel(null); openQuestion(null) }
  return (
    <AnimatePresence>
      {card && (
        <motion.div key="sheet" className="absolute inset-x-0 bottom-0 z-50"
          initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={0.18}
          onDragEnd={(_, i) => { if (i.offset.y > 80) { if (tall) setSheetTall(false); else close() } else if (i.offset.y < -60) setSheetTall(true) }}>
          <div className={cn('glass-strong scroll-thin flex flex-col gap-4 overflow-y-auto rounded-t-[30px] [&>*]:shrink-0 px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-2.5 transition-[max-height] duration-300', tall ? 'max-h-[86dvh]' : 'max-h-[50dvh]')}>
            <button onClick={() => setSheetTall(!tall)} className="mx-auto h-1.5 w-10 shrink-0 rounded-full bg-ink-900/15" aria-label="resize" />
            {card === 'inspector' && <InspectorBody />}
            {card === 'questions' && <QuestionList />}
            {card === 'changes' && <ChangesBody />}
            {card === 'question' && <QuestionCardBody onClose={() => openQuestion(null)} />}
            {card === 'underlay' && <UnderlayBody />}
            {card === 'report' && <ReportBody />}
            {card === 'decor' && <DecorCard />}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ───────── 改造清单 ───────── */
function ChangesBody() {
  const t = useT()
  const view = useView()
  const mode = useStore(s => s.mode), lang = useStore(s => s.lang)
  const mobile = useIsMobile()
  const { revertChange, select, openAgent, setMode, setPanel } = useStore.getState()
  if (!view) return null
  const { base, results, diff } = view
  const status = (c: Change) => results.find(r => r.id === c.id)
  const icon = (c: Change) => {
    if (c.by === 'agent') return <span className="grid size-8 place-items-center rounded-full bg-lav-200 text-lav-800"><Sparkles size={14} strokeWidth={2.4} /></span>
    if (c.op === 'remove') return <span className="grid size-8 place-items-center rounded-full bg-coral-100 text-coral-700"><Minus size={15} strokeWidth={2.6} /></span>
    if (c.op === 'add') return <span className="grid size-8 place-items-center rounded-full bg-cobalt-100 text-cobalt-700"><Plus size={15} strokeWidth={2.6} /></span>
    return <span className="grid size-8 place-items-center rounded-full bg-ink-100 text-ink-600"><Pencil size={13} strokeWidth={2.4} /></span>
  }
  const targetRef = (c: Change) => {
    if (c.target) return { type: c.type, id: c.target }
    const d = c.data as { id?: string; wall?: string } | undefined
    if (c.type === 'opening' && d?.wall && status(c)?.needsConfirm) return { type: 'wall' as const, id: d.wall }
    return d?.id ? { type: c.type, id: d.id } : null
  }
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-full bg-ink-900 text-white"><Pencil size={17} strokeWidth={2.3} /></span>
        <div className="flex-1">
          <div className="text-[17px] font-semibold tracking-[-0.01em] text-ink-900">{t.changes.title} <span className="num font-normal text-ink-400">{base.changes.length}</span></div>
          <div className="text-[12px] font-medium text-ink-400">{lang === 'zh' ? '原始结构不动，改动按顺序叠上去' : 'Original stays intact; changes stack on top'}</div>
        </div>
        {mobile && <RoundButton size="sm" tone="plain" onClick={() => setPanel(null)} aria-label="close"><X size={16} /></RoundButton>}
      </div>
      {mode === 'compare' && diff && (
        <div className="tile grid grid-cols-4 gap-1 rounded-[18px] p-2">
          <Legend swatch={<span className="hatch-coral block h-2.5 w-6 rounded-[3px] bg-coral-50 ring-[1.5px] ring-dashed ring-coral-500" />} n={diff.removed.length} label={t.changes.removed} />
          <Legend swatch={<span className="block h-2.5 w-6 rounded-[3px] bg-cobalt-400" />} n={diff.added.size} label={t.changes.added} />
          <Legend swatch={<span className="block h-2.5 w-6 rounded-[3px] border-[1.5px] border-dashed border-cobalt-500 bg-cobalt-50" />} n={diff.modified.size} label={t.changes.modified} />
          <Legend swatch={<span className="hatch-lav block h-2.5 w-6 rounded-[3px] bg-lav-50 ring-[1.5px] ring-lav-500" />} n={diff.pending.length} label={t.changes.pending} />
        </div>
      )}
      {base.changes.length === 0 && <div className="tile-sunken rounded-[16px] p-4 text-[13px] text-ink-500">{t.changes.empty}</div>}
      <div className="flex flex-col gap-1.5">
        {base.changes.map((c, i) => {
          const r = status(c), ref = targetRef(c)
          return (
            <motion.div key={c.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.035 } }}
              className={cn('group tile flex items-start gap-3 rounded-[18px] p-2.5 pr-2', r?.needsConfirm && 'bg-lav-50/80 ring-1 ring-inset ring-lav-200')}>
              {icon(c)}
              {/* 外层不用 <button>：里面还有「我确认」按钮，button 不能套 button */}
              <div role="button" tabIndex={0} onClick={() => ref && select(ref)} onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && ref) { e.preventDefault(); select(ref) } }} className="min-w-0 flex-1 cursor-pointer pt-0.5 text-left outline-none">
                <div className="text-[13px] font-semibold leading-snug text-ink-900">{c.note ?? describeChange(base, c)}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11.5px] font-medium text-ink-400">{c.by === 'agent' ? t.changes.byAgent : t.changes.byUser}</span>
                  {r?.needsConfirm && <Tag tone="ink" icon={<Lock size={10} strokeWidth={3} />}>{t.changes.needsConfirm}</Tag>}
                  {c.status === 'pending' && !r?.needsConfirm && <Tag tone="lav">{t.changes.pending}</Tag>}
                  {r && !r.ok && !r.needsConfirm && <Tag tone="coral">{r.error}</Tag>}
                  {c.status === 'pending' && <button onClick={e => { e.stopPropagation(); useStore.getState().confirmChange(c.id) }} className="h-6 rounded-full bg-ink-900 px-2.5 text-[11px] font-semibold text-white">{t.act.confirm}</button>}
                </div>
              </div>
              <Tip label={t.act.revert} side="left">
                <button data-testid={`revert-${c.id}`} onClick={() => revertChange(c.id)} className="grid size-8 shrink-0 place-items-center rounded-full text-ink-300 opacity-0 transition hover:bg-white hover:text-ink-800 group-hover:opacity-100 max-md:opacity-100"><Undo2 size={15} /></button>
              </Tip>
            </motion.div>
          )
        })}
      </div>
      {/* S2b：改造清单导出（多页 PDF） */}
      <ExportButton />
      {mobile && <div className="flex gap-2 pt-1">
        {mode !== 'compare' && <Pill tone="tile" onClick={() => setMode('compare')} className="flex-1">{lang === 'zh' ? '看对比' : 'Compare'}<ArrowRight size={14} /></Pill>}
        <Pill tone="ink" onClick={() => openAgent(true)} className="flex-1 pl-1.5">
          <span className="grid size-7 place-items-center rounded-full bg-lav-300 text-lav-800"><Sparkles size={14} strokeWidth={2.4} /></span>{t.act.agent}
        </Pill>
      </div>}
    </>
  )
}

function Legend({ swatch, n, label }: { swatch: React.ReactNode; n: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 py-1">
      {swatch}
      <span className="num text-[15px] font-semibold leading-none text-ink-900">{n}</span>
      <span className="text-[10.5px] font-semibold text-ink-500">{label}</span>
    </div>
  )
}

/* ───────── 下一步 ───────── */
export function NextStep() {
  const t = useT()
  const view = useView()
  const mode = useStore(s => s.mode), sel = useStore(s => s.sel), qOpen = useStore(s => s.qOpen), agentOpen = useStore(s => s.agentOpen), panel = useStore(s => s.panel)
  const measuring = useStore(s => !!s.measure)
  const { openQuestion, setMode, openAgent, setPanel } = useStore.getState()
  const mobile = useIsMobile(), narrow = useIsNarrow() && !mobile, shift = useStore(s => s.pipShift)
  if (mode === 'decor') return useStore.getState().main === '2d' ? <DecorNext /> : null
  if (!view || agentOpen) return null
  if (mobile && !measuring && (sel.length || qOpen || panel === 'questions' || panel === 'changes')) return null
  const { base, diff } = view
  const pending = base.questions.filter(q => !q.answer)
  let tone: 'lemon' | 'mint' | 'lav' | 'ink' = 'mint', icon = <Check size={15} strokeWidth={2.6} />, lead = '', cta = '', act = () => {}
  if (sel.length) {
    // 有选中时「交给 Agent」在检查器里，这里只说怎么改，不再放第二个按钮（design.md §8）
    tone = 'ink'; icon = <MousePointerClick size={15} strokeWidth={2.4} />
    const ghost = !findEl(view.plan, sel[0])
    lead = measuring ? t.s2a.measure.active : sel.length > 1 ? fmt(t.selHint.multi, { n: sel.length }) : ghost ? t.selHint.ghost : mode === 'compare' ? fmt(t.next.handoffSel.lead, { name: labelOf(view, sel[0]) }) : t.selHint[sel[0].type]
    if (measuring) { tone = 'ink'; icon = <Ruler size={15} strokeWidth={2.4} /> }
  } else if (mode === 'original' && pending.length) {
    tone = 'lemon'; icon = <CircleQuestionMark size={16} strokeWidth={2.3} />
    lead = fmt(t.next.check.lead, { n: pending.length }); cta = t.next.check.cta; act = () => { setPanel('questions'); openQuestion(pending[0].id) }
  } else if (mode === 'original') {
    lead = t.next.renovate.lead; cta = t.next.renovate.cta; act = () => setMode('renovation')
  } else if (mode === 'renovation') {
    tone = 'ink'; icon = <Pencil size={14} strokeWidth={2.4} />
    if (base.changes.length) { lead = fmt(t.next.seeCompare.lead, { n: base.changes.length }); cta = t.next.seeCompare.cta; act = () => setMode('compare') }
    else lead = t.next.pickToEdit.lead
  } else if (diff) {
    tone = 'lav'; icon = <Sparkles size={15} strokeWidth={2.4} />
    lead = fmt(t.next.handoffAll.lead, { r: diff.removed.length, a: diff.added.size, m: diff.modified.size }); cta = t.next.handoffAll.cta; act = () => openAgent(true)
  }
  if (qOpen && !mobile) return null
  if (useStore.getState().tool !== 'select' && !sel.length) return null
  const disc = { lemon: 'bg-lemon-200 text-ink-900', mint: 'bg-mint-200 text-mint-900', lav: 'bg-lav-200 text-lav-800', ink: 'bg-ink-900 text-white' }[tone]
  return (
    <motion.div key={lead} initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className={cn('absolute z-30', narrow ? 'bottom-5 flex justify-center' : 'left-1/2 -translate-x-1/2', mobile ? 'bottom-[92px]' : 'bottom-5')} style={narrow ? bottomSlot(shift) : undefined}>
      <Glass data-testid="next-step" className="flex h-[52px] min-w-0 max-w-full items-center gap-3 rounded-full pl-1.5 pr-1.5">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-full shadow-[inset_0_1px_0_rgb(255_255_255/0.6)]', disc)}>{icon}</span>
        <span className={cn('min-w-0 truncate whitespace-nowrap text-[13.5px] font-semibold text-ink-800', !cta && 'pr-4')}>{lead}</span>
        {cta && (
          <Pill tone="ink" size="md" onClick={act} className="h-10 shrink-0 gap-1.5 pl-4 pr-3.5" data-testid="next-cta">{cta}<ArrowRight size={15} strokeWidth={2.4} /></Pill>
        )}
      </Glass>
    </motion.div>
  )
}
function labelOf(view: NonNullable<ReturnType<typeof useView>>, r: { type: string; id: string }) {
  const all = [...view.plan.walls, ...view.plan.openings, ...view.plan.beams, ...view.plan.rooms, ...view.base.walls, ...view.base.openings] as { id: string; name?: string }[]
  return all.find(e => e.id === r.id)?.name ?? r.id
}

/* ───────── 缩放 ───────── */
export function ZoomBar() {
  const t = useT()
  const main = useStore(s => s.main), mode = useStore(s => s.mode), hist = useStore(s => s.hist)
  const { fit, undo, redo } = useStore.getState()
  const h = mode === 'original' ? hist.original : hist.renovation
  const z = (f: number) => window.dispatchEvent(new CustomEvent('plan-zoom', { detail: f }))
  return (
    <div className="absolute bottom-5 right-5 z-30" data-float>
      <Glass className="flex h-[52px] items-center gap-0.5 rounded-full px-1.5">
        <Tip label={t.act.undo} kbd="⌘Z" side="top"><RoundButton tone="plain" size="md" onClick={undo} disabled={!h.past.length} aria-label={t.act.undo} className="disabled:opacity-35" data-testid="undo"><Undo2 size={16} /></RoundButton></Tip>
        <Tip label={t.act.redo} kbd="⇧⌘Z" side="top"><RoundButton tone="plain" size="md" onClick={redo} disabled={!h.future.length} aria-label={t.act.redo} className="disabled:opacity-35"><Redo2 size={16} /></RoundButton></Tip>
        <span className="mx-1 h-6 w-px bg-ink-900/8" />
        {main === '2d' && <Tip label={t.act.zoomOut} kbd="−" side="top"><RoundButton tone="plain" size="md" onClick={() => z(1 / 1.25)} aria-label={t.act.zoomOut}><Minus size={17} /></RoundButton></Tip>}
        <Tip label={t.act.fit} kbd="F" side="top"><RoundButton tone="plain" size="md" onClick={fit} aria-label={t.act.fit}><Maximize size={16} /></RoundButton></Tip>
        {main === '2d' && <Tip label={t.act.zoomIn} kbd="+" side="top"><RoundButton tone="plain" size="md" onClick={() => z(1.25)} aria-label={t.act.zoomIn}><Plus size={17} /></RoundButton></Tip>}
      </Glass>
    </div>
  )
}

export function Toast() {
  const toast = useStore(s => s.toast)
  const mobile = useIsMobile()
  return (
    <AnimatePresence>
      {toast && (
        <motion.div key={toast} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
          // 手机上长提示（比如「已载入简版方案：…」）换行，不出屏
          className={cn('pointer-events-none absolute left-1/2 z-[90] -translate-x-1/2 bg-ink-900/92 px-4 py-2.5 text-[13px] font-medium text-white shadow-xl backdrop-blur-md', mobile ? 'bottom-[156px] w-max max-w-[calc(100vw-24px)] rounded-[20px] text-center leading-snug' : 'bottom-[88px] whitespace-nowrap rounded-full')}>
          {toast}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/* ───────── 轻提示（带按钮）：旧格式近似、Agent 更新了方案 ───────── */
export function NoticeBar() {
  const notice = useStore(s => s.notice)
  const mobile = useIsMobile()
  return (
    <AnimatePresence>
      {notice && (
        <motion.div key={notice.text} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
          className={cn('absolute left-1/2 z-[80] -translate-x-1/2', mobile ? 'top-[124px] w-[calc(100%-24px)]' : 'top-[88px]')}>
          <Glass strong data-testid="notice" className={cn('flex items-center gap-3 py-1.5 pl-2 pr-1.5', mobile ? 'rounded-[24px]' : 'rounded-full')}>
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-lav-200 text-lav-800"><Sparkles size={14} strokeWidth={2.4} /></span>
            {/* 手机上两行：一行装不下时文件名（「方案里引用了底图 xxx.png」）会被截掉 */}
            <span title={notice.text} className={cn('min-w-0 flex-1 text-[13px] font-semibold text-ink-800', mobile ? 'line-clamp-2 leading-snug' : 'truncate')}>{notice.text}</span>
            {notice.actions.map(a => <Pill key={a.label} size="sm" tone={a.primary ? 'ink' : 'plain'} onClick={a.run} data-testid={`notice-${a.primary ? 'primary' : 'secondary'}`}>{a.label}</Pill>)}
          </Glass>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** 没有检查器可挂时（门窗工具在受保护墙上开洞等），二次确认浮在底部 */
export function FloatingConfirm() {
  const confirm = useStore(s => s.confirm), card = useCard()
  const mobile = useIsMobile()
  if (!confirm || card === 'inspector') return null
  return (
    <div className={cn('absolute left-1/2 z-[75] w-[380px] max-w-[calc(100%-24px)] -translate-x-1/2', mobile ? 'bottom-[160px]' : 'bottom-24')}>
      <Glass strong className="rounded-[24px] p-2"><AnimatePresence><ConfirmCard confirm={confirm} /></AnimatePresence></Glass>
    </div>
  )
}

/* ───────── 底图卡（底图工具）：导入、显隐、透明度、镜像、两点定比例、拖动对齐 ───────── */
function UnderlayBody() {
  const t = useT()
  const base = useStore(s => s.base), calib = useStore(s => s.calib), missing = useStore(s => s.underlayMissing)
  const { setUnderlay, setCalib, setTool } = useStore.getState()
  const u = base?.underlay
  const L = t.underlayCard
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-full bg-mint-200 text-mint-900"><ImageUp size={18} strokeWidth={2.2} /></span>
        <div className="flex-1">
          <div className="text-[17px] font-semibold tracking-[-0.01em] text-ink-900">{t.underlay.title}</div>
          <div className="text-[12px] font-medium text-ink-400">{u ? fmt(t.underlay.scale, { v: u.mmPerPx.toFixed(2) }) : L.none}</div>
        </div>
        <RoundButton size="sm" tone="plain" onClick={() => setTool('select')} aria-label="close"><X size={16} /></RoundButton>
      </div>
      {!u && <Pill tone="ink" onClick={() => pickFile('image/*')}><ImageUp size={15} />{L.import}</Pill>}
      {u && missing && (
        <div className="flex items-center gap-3 rounded-[18px] bg-lemon-50 p-3 ring-1 ring-inset ring-lemon-200">
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-lemon-800" title={u.src}>{fmt(t.underlayMissingCard, { src: u.src.split('/').pop() ?? u.src })}</span>
          <Pill tone="ink" size="sm" onClick={relinkUnderlay} data-testid="underlay-relink">{t.reimport}</Pill>
        </div>
      )}
      {u && (
        <>
          <div className="tile flex flex-col gap-1 rounded-[18px] p-2">
            <label className="flex h-10 items-center justify-between px-2 text-[13px] font-medium text-ink-800">{t.underlay.visible}<Switch on={u.visible} onChange={v => setUnderlay({ visible: v })} /></label>
            <div className="px-1 pb-1"><Slider value={u.opacity} onChange={v => setUnderlay({ opacity: v })} icon={<ImageUp size={15} />} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Pill tone="tile" size="md" onClick={() => setUnderlay({ flipX: !u.flipX }, { history: true })} className={cn(u.flipX && 'ring-2 ring-mint-400')}><FlipHorizontal2 size={15} />{t.underlay.flipX}</Pill>
            <Pill tone="tile" size="md" onClick={() => setUnderlay({ flipY: !u.flipY }, { history: true })} className={cn(u.flipY && 'ring-2 ring-mint-400')}><FlipVertical2 size={15} />{L.flipY}</Pill>
          </div>
          {!calib && <Pill tone="ink" size="md" onClick={() => { if (!u.visible) setUnderlay({ visible: true }); setCalib([]) }} data-testid="calib-start"><Ruler size={15} />{t.underlay.calibrate}</Pill>}
          {calib && calib.length < 2 && <div className="tile-sunken rounded-[16px] px-3.5 py-3 text-[13px] font-semibold text-lav-600">{fmt(L.calibPick, { i: calib.length + 1 })}<button onClick={() => setCalib(null)} className="ml-2 text-ink-400 underline">{L.cancel}</button></div>}
          {calib && calib.length === 2 && <CalibInput />}
          {(u.calibrations?.length ?? 0) > 0 && <div className="px-1 text-[11.5px] text-ink-400">{t.underlay.calibrated} · {u.calibrations!.length}</div>}
          <p className="px-1 text-[12px] leading-relaxed text-ink-500">{L.drag}</p>
          <div className="flex gap-2">
            <Pill tone="tile" size="sm" onClick={() => pickFile('image/*')}>{L.replace}</Pill>
            <Pill tone="plain" size="sm" onClick={() => setUnderlay(null, { history: true })}><Trash size={13} />{L.remove}</Pill>
          </div>
        </>
      )}
    </>
  )
}
function CalibInput() {
  const t = useT(), calib = useStore(s => s.calib)!
  const d = Math.round(Math.hypot(calib[1][0] - calib[0][0], calib[1][1] - calib[0][1]))
  const go = (e: React.FormEvent) => { e.preventDefault(); const v = +(new FormData(e.target as HTMLFormElement).get('len') ?? 0); applyCalibration(calib[0], calib[1], v) }
  return (
    <form onSubmit={go} className="tile flex flex-col gap-2 rounded-[18px] p-3">
      <span className="text-[12px] font-semibold text-ink-500">{t.underlayCard.calibLen}</span>
      <div className="flex items-center gap-2">
        <input name="len" type="number" min={1} defaultValue={d} autoFocus data-testid="calib-len" className="tile-sunken h-9 min-w-0 flex-1 rounded-full px-3.5 text-[14px] font-semibold text-ink-900 outline-none focus:ring-2 focus:ring-lav-300" />
        <span className="text-[12px] text-ink-400">mm</span>
        <Pill tone="ink" size="sm" type="submit">{t.underlayCard.apply}</Pill>
      </div>
    </form>
  )
}

/* ───────── 旧格式转换报告 ───────── */
function ReportBody() {
  const t = useT(), report = useStore(s => s.report)
  const { setPanel } = useStore.getState()
  const sec = (title: string, list: string[]) => list.length > 0 && (
    <div>
      <div className="mb-1.5 px-1 text-[11.5px] font-semibold text-ink-500">{title} <span className="num text-ink-400">{list.length}</span></div>
      <ul className="tile flex flex-col gap-1 rounded-[16px] p-3 text-[12.5px] leading-relaxed text-ink-700">{list.map((x, i) => <li key={i}>· {x}</li>)}</ul>
    </div>
  )
  const str = (x: unknown) => typeof x === 'string' ? x : JSON.stringify(x)
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-full bg-lav-200 text-lav-800"><ListChecks size={18} /></span>
        <div className="flex-1 text-[17px] font-semibold text-ink-900">{t.reportTitle}</div>
        <RoundButton size="sm" tone="plain" onClick={() => setPanel(null)} aria-label="close"><X size={16} /></RoundButton>
      </div>
      {report && sec(t.reportApprox, report.approximations.map(str))}
      {report && sec(t.reportUnsupported, report.unsupported.map(str))}
      {report && sec(t.reportWarnings, report.warnings.map(str))}
      {(!report || !report.approximations.length) && <div className="tile-sunken rounded-[16px] p-4 text-[13px] text-ink-500">{t.reportNone}</div>}
    </>
  )
}
