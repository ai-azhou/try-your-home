/**
 * 问题卡（参考图 1 的摄像头缩略图卡）：底图局部 + 一句问题 + 选项，钉在图上。
 * 列表在右侧卡片；点针或列表项，问题卡在针旁边展开（手机上进底部抽屉）。
 * 每张卡有状态（core questionStatus）：待回答 → 已答等 Agent 处理 → 已处理（Agent 的回复和改到的构件）。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, Check, ChevronRight, CircleQuestionMark, CornerDownLeft, History, Hourglass, Minus, Sparkles, X } from 'lucide-react'
import type { Box, Plan, Question, QuestionOutcome, QuestionStatus } from '@/core/types'
import { questionStatus } from '@/core/questions'
import { markSeen, unseenReplies, useReplies } from '../replies'
import { useStore, useT, useView } from '../store'
import { CertaintyBadge, Pill, RoundButton, Tag } from '../kit'
import { elementLabel, findAny } from '../model'
import { fmt } from '../i18n'
import { polyPath, underlayHref } from '../geom'
import { wallFootprint } from '@/core/geometry'
import { cn } from '@/lib/utils'
import { isSimpleDerived } from '@/core/simple'

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

/* ───────── 右侧列表：待回答 / 等 Agent 处理 / 已处理 ───────── */
export function QuestionList() {
  const t = useT()
  const view = useView()
  const qOpen = useStore(s => s.qOpen), lang = useStore(s => s.lang), demo = useStore(s => s.source.kind === 'demo')
  const seen = useReplies(s => s.seen)
  const { openQuestion, setPanel, openAgent } = useStore.getState()
  // 面板收起时，这次看到的 Agent 回复都算看过（打开单张卡时也算，见 QuestionCardBody）
  const last = useRef<Plan | null>(null)
  useEffect(() => () => { if (last.current) markSeen(last.current) }, [])
  if (!view) return null
  const { base } = view
  last.current = base
  const of = (st: QuestionStatus) => base.questions.filter(q => questionStatus(q) === st)
  const pending = of('open'), waiting = of('answered'), resolved = of('resolved')
  const fresh = new Set(demo ? [] : unseenReplies(base, seen).map(q => q.id))
  const sub = pending.length ? (isSimpleDerived(base) ? t.simple.qSub : lang === 'zh' ? 'Agent 读图时拿不准的地方' : 'Where the agent wasn’t sure')
    : waiting.length ? t.q.waitingSub : resolved.length ? t.q.allResolved : t.q.allDone
  return (
    <>
      <div className="flex items-center gap-3">
        <span className="grid size-11 place-items-center rounded-full bg-lemon-200 text-ink-900 shadow-[inset_0_1px_0_rgb(255_255_255/0.6)]"><CircleQuestionMark size={20} strokeWidth={2.2} /></span>
        <div className="flex-1">
          <div className="text-[17px] font-semibold tracking-[-0.01em] text-ink-900">{t.q.title} <span className="num font-normal text-ink-400">{pending.length}</span></div>
          <div className="text-[12px] font-medium text-ink-400">{sub}</div>
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
              {q.reply?.outcome === 'ask' && <div className="mt-1 line-clamp-2 text-[11.5px] font-semibold leading-snug text-lav-600">{t.q.agentAsks}：{q.reply.text}</div>}
              <div className="mt-1.5 flex items-center gap-1.5">
                {q.certainty && <CertaintyBadge c={q.certainty} label={t.certainty[q.certainty]} />}
                {q.targets?.[0] && <span className="min-w-0 truncate text-[11.5px] font-medium text-ink-400">{targetLabel(base, q)}</span>}
              </div>
            </div>
            <ChevronRight size={16} className="mt-1 shrink-0 text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-ink-600" />
          </motion.button>
        ))}
      </div>
      {waiting.length > 0 && (
        <div data-testid="q-waiting">
          <div className="flex items-center gap-2 px-1 pb-1.5">
            <span className="text-[12px] font-semibold text-lav-600">{t.q.waiting} {waiting.length}</span>
            <Pill tone="lav" size="sm" onClick={() => openAgent(true, true)} className="ml-auto h-7 gap-1.5 px-2.5 text-[12px]" data-testid="q-handoff"><Sparkles size={13} strokeWidth={2.3} />{fmt(t.q.handoffN, { n: waiting.length })}</Pill>
          </div>
          {waiting.map(q => <Row key={q.id} q={q} disc="bg-lav-100 text-lav-600" icon={<Hourglass size={12} strokeWidth={2.6} />} line={q.answer ?? ''} />)}
        </div>
      )}
      {resolved.length > 0 && (
        <div data-testid="q-resolved">
          <div className="px-1 pb-1.5 text-[12px] font-semibold text-ink-400">{t.q.resolved} {resolved.length}</div>
          {resolved.map(q => (
            <Row key={q.id} q={q} disc={q.reply?.outcome === 'withdrawn' ? 'bg-ink-100 text-ink-500' : 'bg-mint-100 text-mint-700'}
              icon={q.reply?.outcome === 'withdrawn' ? <Minus size={12} strokeWidth={3} /> : <Check size={12} strokeWidth={3} />}
              line={q.reply?.text ?? q.answer ?? ''} tag={q.reply && <OutcomeTag o={q.reply.outcome} />} dot={fresh.has(q.id)} />
          ))}
        </div>
      )}
    </>
  )
}

/** 列表里的一行：问题一行、答复或回复一行，各自截断（PM 实测：真实方案的答复动辄一整句） */
function Row({ q, disc, icon, line, tag, dot }: { q: Question; disc: string; icon: React.ReactNode; line: string; tag?: React.ReactNode; dot?: boolean }) {
  const t = useT()
  return (
    <button onClick={() => useStore.getState().openQuestion(q.id)} title={`${q.text}\n→ ${line}`} data-testid={`q-row-${q.id}`}
      className="flex w-full min-w-0 items-start gap-2.5 rounded-[14px] px-2 py-2 text-left transition hover:bg-white/70">
      <span className={cn('mt-px grid size-6 shrink-0 place-items-center rounded-full', disc)}>{icon}</span>
      <span className="min-w-0 flex-1 overflow-hidden">
        <span className="block truncate text-[12.5px] font-medium leading-[1.45] text-ink-500">{q.text}</span>
        <span className="flex min-w-0 items-center gap-1.5"><span className="min-w-0 truncate text-[12px] font-semibold leading-[1.45] text-ink-800">{line}</span>{tag}</span>
      </span>
      {dot && <span className="mt-2 size-2 shrink-0 rounded-full bg-lav-500" aria-label={t.q.newReply} title={t.q.newReply} data-testid="q-new-reply" />}
    </button>
  )
}

const OUTCOME_TONE: Record<QuestionOutcome, 'mint' | 'lemon' | 'gray' | 'lav'> = { changed: 'mint', confirmed: 'mint', inferred: 'lemon', noted: 'gray', ask: 'lav', withdrawn: 'gray' }
function OutcomeTag({ o }: { o: QuestionOutcome }) {
  return <Tag tone={OUTCOME_TONE[o]} className="h-[20px] px-1.5 text-[10.5px]">{useT().q.outcome[o]}</Tag>
}

function targetLabel(plan: Plan, q: Question) {
  const id = q.targets?.[0]
  const ref = id ? findAny(plan, id) : null
  return ref ? elementLabel(plan, ref) : ''
}

/** 时间线里的一句：你的答复（薄荷）/ Agent 的回复（淡紫，Agent 在工具里一律是淡紫） */
function Said({ agent, who, at, tag, children }: { agent?: boolean; who: string; at?: string; tag?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={cn('flex items-start gap-2.5 rounded-[16px] p-3 ring-1 ring-inset', agent ? 'bg-lav-50 ring-lav-200' : 'bg-mint-50 ring-mint-200')} data-testid={agent ? 'q-said-agent' : 'q-said-user'}>
      <span className={cn('grid size-7 shrink-0 place-items-center rounded-full text-white', agent ? 'bg-lav-400' : 'bg-mint-400')}>{agent ? <Sparkles size={14} strokeWidth={2.4} /> : <Check size={14} strokeWidth={3} />}</span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-500"><span className="font-semibold text-ink-700">{who}</span>{at && <span className="num">· {at}</span>}{tag && <span className="ml-auto">{tag}</span>}</div>
        <div className="mt-0.5 break-words text-[13.5px] font-semibold leading-snug text-ink-900">{children}</div>
      </div>
    </div>
  )
}

/* ───────── 展开的问题卡：问 → 你的答复 → Agent 的回复，按状态给操作 ───────── */
export function QuestionCardBody({ onClose }: { onClose(): void }) {
  const t = useT()
  const view = useView()
  const qOpen = useStore(s => s.qOpen)
  const { answer, openQuestion, select, openAgent, resolveSelf } = useStore.getState()
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(false)
  const [history, setHistory] = useState(false)
  useEffect(() => { setText(''); setEditing(false); setHistory(false) }, [qOpen])
  const q = view?.base.questions.find(q => q.id === qOpen)
  // 打开带 Agent 回复的卡就算看过
  useEffect(() => { if (view && q?.reply) markSeen(view.base, [q]) }, [view?.base, q])
  if (!view || !q) return null
  const { base } = view
  const status = questionStatus(q)
  const list = base.questions.filter(x => questionStatus(x) === 'open')
  const idx = list.findIndex(x => x.id === q.id)
  const next = list[(idx + 1) % list.length]
  const target = q.targets?.[0] ? findAny(base, q.targets[0]) : null
  const submit = () => { if (text.trim()) { answer(q.id, text.trim()); setEditing(false); setText('') } }
  const who = (by?: string) => !by || by === '业主' ? t.q.you : by === 'Agent' ? t.q.agent : by
  const field = (
    <form onSubmit={e => { e.preventDefault(); submit() }} className="tile-sunken flex h-11 items-center rounded-full pl-4 pr-1">
      <input value={text} onChange={e => setText(e.target.value)} autoFocus={editing} placeholder={t.q.placeholder} data-testid="q-input" className="min-w-0 flex-1 bg-transparent text-[13px] text-ink-900 outline-none placeholder:text-ink-400" />
      <button type="submit" disabled={!text.trim()} className="grid size-9 place-items-center rounded-full bg-ink-900 text-white transition disabled:bg-ink-200 disabled:text-ink-400"><CornerDownLeft size={15} /></button>
    </form>
  )
  return (
    <div className="flex flex-col gap-3" data-testid="q-card" data-status={status}>
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
        {status === 'answered' && <Tag tone="lav" icon={<Hourglass size={11} strokeWidth={2.6} />}>{t.q.waiting}</Tag>}
        {status === 'resolved' && q.reply && <OutcomeTag o={q.reply.outcome} />}
        {status === 'open' && idx >= 0 && <span className="num ml-auto text-[11.5px] font-semibold text-ink-400">{fmt(t.q.of, { i: idx + 1, n: list.length })}</span>}
      </div>
      <div className="px-0.5 text-[15.5px] font-semibold leading-snug tracking-[-0.005em] text-ink-900">{q.text}</div>
      {target && (
        <button onClick={() => select(target)} className="flex items-center gap-1.5 self-start rounded-full px-0.5 text-[12px] font-semibold text-ink-500 transition hover:text-ink-900">
          {t.q.targets}<span className="text-ink-800 underline decoration-ink-300 underline-offset-[3px]">{elementLabel(base, target)}</span><ArrowRight size={12} />
        </button>
      )}
      {!!q.log?.length && (
        <div className="px-0.5">
          <button onClick={() => setHistory(v => !v)} className="flex items-center gap-1 text-[12px] font-semibold text-ink-400 transition hover:text-ink-800" data-testid="q-history">
            <History size={13} />{fmt(t.q.prevRounds, { n: q.log.filter(e => e.role === 'user').length || 1 })}<ChevronRight size={13} className={cn('transition', history && 'rotate-90')} />
          </button>
          {history && (
            <div className="mt-1.5 flex flex-col gap-1 border-l-2 border-ink-900/8 pl-2.5">
              {q.log.map((e, i) => (
                <div key={i} className="text-[12px] leading-snug text-ink-500">
                  <span className="font-semibold text-ink-700">{e.role === 'agent' ? t.q.agent : who(e.by)}</span>{e.at && <span className="num"> · {e.at}</span>}{e.outcome && <span> · {t.q.outcome[e.outcome]}</span>}：{e.text}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {q.answer?.trim() && !(editing && status === 'answered') && <Said who={who(q.answeredBy)} at={q.answeredAt}>{q.answer}</Said>}
      {q.reply && (
        <Said agent who={who(q.reply.by)} at={q.reply.at} tag={<OutcomeTag o={q.reply.outcome} />}>
          {q.reply.text}
          {!!q.reply.changed?.length && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-semibold text-ink-400">{t.q.changed}</span>
              {q.reply.changed.map(id => {
                const ref = findAny(base, id)
                return <button key={id} disabled={!ref} onClick={() => ref && select(ref)} data-testid="q-changed"
                  className="tile h-7 rounded-full px-2.5 text-[12px] font-semibold text-ink-700 transition hover:bg-white disabled:opacity-50">{ref ? elementLabel(base, ref) : id}</button>
              })}
            </div>
          )}
        </Said>
      )}
      {status === 'open' && (
        <>
          {q.options && (
            <div className="flex flex-wrap gap-1.5">
              {q.options.map(o => (
                <button key={o} onClick={() => answer(q.id, o)} className="tile h-9 rounded-full px-3.5 text-[13px] font-semibold text-ink-800 transition hover:bg-lemon-100 hover:text-lemon-800 active:scale-[0.97]">{o}</button>
              ))}
            </div>
          )}
          {field}
          <div className="flex items-center justify-between px-0.5">
            <button onClick={() => next && next.id !== q.id ? openQuestion(next.id) : onClose()} className="text-[12.5px] font-semibold text-ink-400 transition hover:text-ink-800">{t.act.skip}</button>
            {next && next.id !== q.id && <Pill size="sm" tone="tile" onClick={() => openQuestion(next.id)}>{t.act.next}<ArrowRight size={13} /></Pill>}
          </div>
        </>
      )}
      {status !== 'open' && editing && (
        <>
          {field}
          <button onClick={() => { setEditing(false); setText('') }} className="self-start px-0.5 text-[12.5px] font-semibold text-ink-400 transition hover:text-ink-800">{t.q.cancel}</button>
        </>
      )}
      {status === 'answered' && !editing && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone="ink" size="sm" onClick={() => openAgent(true, true)} className="gap-1.5" data-testid="q-card-handoff"><Sparkles size={13} strokeWidth={2.3} />{t.q.handoffOne}</Pill>
          <Pill tone="tile" size="sm" onClick={() => { setText(q.answer ?? ''); setEditing(true) }} data-testid="q-edit">{t.q.editAnswer}</Pill>
          <button onClick={() => resolveSelf(q.id)} className="ml-auto px-1 text-[12px] font-semibold text-ink-400 transition hover:text-ink-800" data-testid="q-self-done">{t.q.selfDone}</button>
        </div>
      )}
      {status === 'resolved' && !editing && (
        <Pill tone="tile" size="sm" onClick={() => setEditing(true)} className="self-start" data-testid="q-disagree">{t.q.disagree}</Pill>
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
