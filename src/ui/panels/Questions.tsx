/**
 * 问题卡（参考图 1 的摄像头缩略图卡）：底图局部 + 一句问题 + 选项，钉在图上。
 * 列表在右侧卡片；点针或列表项，问题卡在针旁边展开（手机上进底部抽屉）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, Check, ChevronRight, CircleQuestionMark, CornerDownLeft, X } from 'lucide-react'
import type { Box, Plan, Question } from '@/core/types'
import { useStore, useT, useView } from '../store'
import { CertaintyBadge, Pill, RoundButton, Tag } from '../kit'
import { elementLabel, findAny } from '../model'
import { fmt } from '../i18n'
import { polyPath, underlayHref } from '../geom'
import { wallFootprint } from '@/core/geometry'
import { cn } from '@/lib/utils'

function useImageSize(src?: string) {
  const [s, setS] = useState<[number, number] | null>(null)
  useEffect(() => { if (!src) return; const i = new Image(); i.onload = () => setS([i.naturalWidth, i.naturalHeight]); i.src = src }, [src])
  return s
}

/** 底图局部：按问题框外扩取景，柠檬虚线框标出问的位置 */
export function UnderlayCrop({ plan, bbox, className, aspect = 16 / 9 }: { plan: Plan; bbox: Box; className?: string; aspect?: number }) {
  const u = plan.underlay
  const href = underlayHref(u?.src, useStore(s => s.source.kind === 'served'))
  const size = useImageSize(href)
  const cx = (bbox[0] + bbox[2]) / 2, cy = (bbox[1] + bbox[3]) / 2
  let w = Math.max(bbox[2] - bbox[0], 900) * 1.9, h = Math.max(bbox[3] - bbox[1], 900) * 1.9
  if (w / h > aspect) h = w / aspect; else w = h * aspect
  const vb = `${cx - w / 2} ${cy - h / 2} ${w} ${h}`
  return (
    <svg viewBox={vb} preserveAspectRatio="xMidYMid slice" className={cn('block bg-[#fbfaf6]', className)}>
      {u && size ? (
        <image href={href} x={-u.origin[0] * u.mmPerPx} y={-u.origin[1] * (u.mmPerPxY ?? u.mmPerPx)} width={size[0] * u.mmPerPx} height={size[1] * (u.mmPerPxY ?? u.mmPerPx)} preserveAspectRatio="none" />
      ) : (
        plan.walls.map(wl => <path key={wl.id} d={polyPath(wallFootprint(wl))} fill="#2a2e35" />)
      )}
      <rect x={bbox[0]} y={bbox[1]} width={bbox[2] - bbox[0]} height={bbox[3] - bbox[1]} rx={w * 0.012}
        fill="rgb(226 238 110 / 0.22)" stroke="#8f9a17" strokeWidth={w * 0.006} strokeDasharray={`${w * 0.014} ${w * 0.01}`} />
    </svg>
  )
}

/* ───────── 右侧列表 ───────── */
export function QuestionList() {
  const t = useT()
  const view = useView()
  const qOpen = useStore(s => s.qOpen)
  const { openQuestion, setPanel } = useStore.getState()
  if (!view) return null
  const { base } = view
  const pending = base.questions.filter(q => !q.answer), done = base.questions.filter(q => q.answer)
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-full bg-lemon-200 text-ink-900 shadow-[inset_0_1px_0_rgb(255_255_255/0.6)]"><CircleQuestionMark size={20} strokeWidth={2.2} /></span>
        <div className="flex-1">
          <div className="text-[17px] font-semibold tracking-[-0.01em] text-ink-900">{t.q.title} <span className="num font-normal text-ink-400">{pending.length}</span></div>
          <div className="text-[12px] font-medium text-ink-400">{pending.length ? (useStore.getState().lang === 'zh' ? 'Agent 读图时拿不准的地方' : 'Where the agent wasn’t sure') : t.q.allDone}</div>
        </div>
        <RoundButton size="sm" tone="plain" onClick={() => setPanel(null)} aria-label="close"><X size={16} /></RoundButton>
      </div>
      <div className="flex flex-col gap-2">
        {pending.map((q, i) => (
          <motion.button key={q.id} onClick={() => openQuestion(q.id)}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0, transition: { delay: 0.04 * i } }}
            className={cn('tile group flex gap-3 rounded-[20px] p-2 pr-3 text-left transition hover:bg-white', qOpen === q.id && 'bg-white ring-[1.5px] ring-inset ring-ink-900')}>
            {q.bbox && <div className="relative size-[68px] shrink-0 overflow-hidden rounded-[15px] ring-1 ring-ink-900/6"><UnderlayCrop plan={base} bbox={q.bbox} aspect={1} className="size-full" /></div>}
            <div className="min-w-0 flex-1 py-0.5">
              <div className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink-900">{q.text}</div>
              <div className="mt-1.5 flex items-center gap-1.5">
                {q.certainty && <CertaintyBadge c={q.certainty} label={t.certainty[q.certainty]} />}
                {q.targets?.[0] && <span className="min-w-0 truncate text-[11.5px] font-medium text-ink-400">{targetLabel(base, q)}</span>}
              </div>
            </div>
            <ChevronRight size={16} className="mt-1 shrink-0 text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-ink-600" />
          </motion.button>
        ))}
      </div>
      {done.length > 0 && (
        <div>
          <div className="px-1 pb-1.5 text-[12px] font-semibold text-ink-400">{t.q.answered} {done.length}</div>
          {done.map(q => (
            // 问题一行、答复一行，各自截断带省略号：长答复不会顶出卡片（PM 实测：真实方案的答复动辄一整句）
            <button key={q.id} onClick={() => openQuestion(q.id)} title={`${q.text}\n→ ${q.answer}`} className="flex w-full min-w-0 items-start gap-2.5 rounded-[14px] px-2 py-2 text-left transition hover:bg-white/70">
              <span className="mt-px grid size-6 shrink-0 place-items-center rounded-full bg-mint-100 text-mint-700"><Check size={12} strokeWidth={3} /></span>
              <span className="min-w-0 flex-1 overflow-hidden">
                <span className="block truncate text-[12.5px] font-medium leading-[1.45] text-ink-500">{q.text}</span>
                <span className="block truncate text-[12px] font-semibold leading-[1.45] text-ink-800">{q.answer}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function targetLabel(plan: Plan, q: Question) {
  const id = q.targets?.[0]
  const ref = id ? findAny(plan, id) : null
  return ref ? elementLabel(plan, ref) : ''
}

/* ───────── 展开的问题卡 ───────── */
export function QuestionCardBody({ onClose }: { onClose(): void }) {
  const t = useT()
  const view = useView()
  const qOpen = useStore(s => s.qOpen)
  const { answer, openQuestion, select } = useStore.getState()
  const [text, setText] = useState('')
  useEffect(() => setText(''), [qOpen])
  if (!view) return null
  const { base } = view
  const q = base.questions.find(q => q.id === qOpen)
  if (!q) return null
  const list = base.questions.filter(q => !q.answer)
  const idx = list.findIndex(x => x.id === q.id)
  const next = list[(idx + 1) % list.length]
  const target = q.targets?.[0] ? findAny(base, q.targets[0]) : null
  return (
    <div className="flex flex-col gap-3">
      {q.bbox && (
        <div className="relative overflow-hidden rounded-[20px] ring-1 ring-ink-900/6">
          <UnderlayCrop plan={base} bbox={q.bbox} aspect={2} className="h-auto w-full" />
          <span className="absolute left-2.5 top-2.5 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-ink-700 backdrop-blur-md">{t.q.thumbTitle}</span>
          <RoundButton size="sm" tone="glass" onClick={onClose} className="absolute right-2 top-2" aria-label="close"><X size={15} /></RoundButton>
        </div>
      )}
      <div className="flex items-center gap-1.5 px-0.5">
        {q.certainty && <CertaintyBadge c={q.certainty} label={t.certainty[q.certainty]} />}
        <Tag tone="outline">{q.category === 'original' ? t.q.original : t.q.renovation}</Tag>
        {idx >= 0 && <span className="num ml-auto text-[11.5px] font-semibold text-ink-400">{fmt(t.q.of, { i: idx + 1, n: list.length })}</span>}
      </div>
      <div className="px-0.5 text-[15.5px] font-semibold leading-snug tracking-[-0.005em] text-ink-900">{q.text}</div>
      {target && (
        <button onClick={() => select(target)} className="flex items-center gap-1.5 self-start rounded-full px-0.5 text-[12px] font-semibold text-ink-500 transition hover:text-ink-900">
          {t.q.targets}<span className="text-ink-800 underline decoration-ink-300 underline-offset-[3px]">{elementLabel(base, target)}</span><ArrowRight size={12} />
        </button>
      )}
      {q.answer ? (
        <div className="flex items-center gap-2.5 rounded-[16px] bg-mint-50 p-3 ring-1 ring-inset ring-mint-200">
          <span className="grid size-7 place-items-center rounded-full bg-mint-400 text-white"><Check size={14} strokeWidth={3} /></span>
          <div className="min-w-0 flex-1"><div className="text-[13.5px] font-semibold text-ink-900">{q.answer}</div><div className="text-[11.5px] text-ink-500">{q.answeredBy} · {q.answeredAt}</div></div>
        </div>
      ) : (
        <>
          {q.options && (
            <div className="flex flex-wrap gap-1.5">
              {q.options.map(o => (
                <button key={o} onClick={() => answer(q.id, o)} className="tile h-9 rounded-full px-3.5 text-[13px] font-semibold text-ink-800 transition hover:bg-lemon-100 hover:text-lemon-800 active:scale-[0.97]">{o}</button>
              ))}
            </div>
          )}
          <form onSubmit={e => { e.preventDefault(); if (text.trim()) answer(q.id, text.trim()) }} className="tile-sunken flex h-11 items-center rounded-full pl-4 pr-1">
            <input value={text} onChange={e => setText(e.target.value)} placeholder={t.q.placeholder} className="min-w-0 flex-1 bg-transparent text-[13px] text-ink-900 outline-none placeholder:text-ink-400" />
            <button type="submit" disabled={!text.trim()} className="grid size-9 place-items-center rounded-full bg-ink-900 text-white transition disabled:bg-ink-200 disabled:text-ink-400"><CornerDownLeft size={15} /></button>
          </form>
          <div className="flex items-center justify-between px-0.5">
            <button onClick={() => next && next.id !== q.id ? openQuestion(next.id) : onClose()} className="text-[12.5px] font-semibold text-ink-400 transition hover:text-ink-800">{t.act.skip}</button>
            {next && next.id !== q.id && <Pill size="sm" tone="tile" onClick={() => openQuestion(next.id)}>{t.act.next}<ArrowRight size={13} /></Pill>}
          </div>
        </>
      )}
    </div>
  )
}

/** 桌面：钉在针旁边的浮卡 */
export function QuestionPopover() {
  const qOpen = useStore(s => s.qOpen), main = useStore(s => s.main)
  const { openQuestion } = useStore.getState()
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [h, setH] = useState(420)
  useEffect(() => {
    const on = (e: Event) => setAnchor((e as CustomEvent).detail)
    window.addEventListener('q-anchor', on)
    return () => window.removeEventListener('q-anchor', on)
  }, [])
  useLayoutEffect(() => { if (ref.current) setH(ref.current.offsetHeight) })
  if (!qOpen) return null
  const W = 352, vw = window.innerWidth, vh = window.innerHeight
  const a = main === '2d' && anchor ? anchor : { x: vw / 2 - 40, y: vh / 2 }
  const right = a.x + 34 + W < vw - 404
  const left = right ? a.x + 34 : Math.max(112, a.x - 34 - W)
  const top = Math.min(vh - h - 24, Math.max(92, a.y - 70))
  return (
    <motion.div ref={ref} key={qOpen} initial={{ opacity: 0, scale: 0.94, x: right ? -10 : 10 }} animate={{ opacity: 1, scale: 1, x: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className="glass-strong absolute z-50 rounded-[28px] p-3" style={{ left, top, width: W, transformOrigin: right ? 'left top' : 'right top' }}>
      <QuestionCardBody onClose={() => openQuestion(null)} />
    </motion.div>
  )
}
