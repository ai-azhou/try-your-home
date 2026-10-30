/**
 * 交给 Agent：选中构件 + 一句话 → 复制。路径要顺：打开即聚焦输入框，⌘↵ 复制，复制后告诉用户下一步。
 * 有已答、等处理的问题卡时可以附上「待核对答复」：服务模式、连接文件先存回方案文件，否则答复原文写在交接文字里（工具连接 4.6）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown, Copy, FileBraces, Hourglass, Sparkles, X } from 'lucide-react'
import { useStore, useT, useView } from '../store'
import { Pill, RoundButton, Switch, WallSwatch } from '../kit'
import { elementLabel, findEl } from '../model'
import { agentHandoff } from '@/core/handoff'
import { decorHandoff } from '@/core/decor/integration'
import { useDecor } from '../decor/dstore'
import { findItem } from '../decor/model'
import { useIsMobile } from '../layout'
import { openingIcon } from './Inspector'
import type { Opening, Plan, Wall } from '@/core/types'
import { questionStatus } from '@/core/questions'
import { isConnected, saveToFile } from '../actions'
import { fmt } from '../i18n'
import { cn } from '@/lib/utils'

export function AgentSheet() {
  const t = useT()
  const open = useStore(s => s.agentOpen), sel = useStore(s => s.sel), text = useStore(s => s.agentText), copied = useStore(s => s.copied), mode = useStore(s => s.mode)
  const answersOn = useStore(s => s.agentAnswers), connected = useStore(s => isConnected(s.source)), dirty = useStore(s => s.dirty), cleanBase = useStore(s => s.cleanBase)
  const { openAgent, setAgentText, setCopied, select } = useStore.getState()
  const view = useView()
  const mobile = useIsMobile()
  const [showPreview, setShowPreview] = useState(!mobile)
  const ta = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (open) setTimeout(() => ta.current?.focus(), 120) }, [open])
  const lang = useStore(s => s.lang)
  const pre = useRef<HTMLPreElement>(null)
  // 装修态：选中的装修构件用 core decorHandoff 展开（白话位置、FaceRef、数据、受保护墙的事实），接在结构交接文字后面
  const decor = useStore(s => s.base?.decor), decorRefs = useDecor(s => s.agentRefs)
  const dRefs = mode === 'decor' && decor ? decorRefs.filter(id => findItem(decor, id) || decor.surfaces.some(x => x.id === id)) : []
  const waiting = view ? view.base.questions.filter(q => questionStatus(q) === 'answered').length : 0
  // 服务模式、连接文件复制前会先存回文件，所以按「已存进文件」写；其余模式答复原文在交接文字里
  const answers = answersOn && waiting ? (connected ? 'saved' as const : 'unsaved' as const) : undefined
  const otherUnsaved = !!answers && !connected && dirty && !!view && otherEdits(view.base, cleanBase)
  const build = (a: typeof answers) => {
    if (!view) return ''
    const base = agentHandoff(view.plan, sel.filter(r => findEl(view.plan, r)), text.trim() || (lang === 'zh' ? '（没写）' : '(none)'), { mode, planFile: view.base.meta?.planFile, answers: a, otherUnsaved })
    if (!dRefs.length || !decor) return base
    const dp = { ...view.plan, decor }
    const refs = dRefs.map(id => { const it = findItem(decor, id); return decorHandoff(dp, { type: it ? it.k : 'surface', id }) })
    return `${base}\n\n## 装修构件（ref）\n${refs.join('\n')}`
  }
  const md = useMemo(() => build(answers), [view, sel, text, mode, lang, decor, dRefs.join(','), answers, otherUnsaved])

  const copy = async () => {
    let out = md
    // 服务模式：答复要先进方案文件，Agent 才读得到；存不进去就改成把原文写在文字里
    if (answers === 'saved' && useStore.getState().dirty && !(await saveToFile())) out = build('unsaved')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard')
      await navigator.clipboard.writeText(out)
      setCopied(true)
    } catch {
      // 浏览器不让写剪贴板（file:// 或没权限）：展开预览、选中全文，让用户手动复制
      setShowPreview(true)
      setTimeout(() => {
        const el = pre.current
        if (!el) return
        const r = document.createRange(); r.selectNodeContents(el)
        const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r)
      }, 80)
      useStore.getState().showToast(t.copyFailed)
    }
  }
  useEffect(() => {
    if (!open) return
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); copy() } }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  })

  if (!view) return null
  const { plan } = view
  return (
    <AnimatePresence>
      {open && (
        <motion.div key="agent" className="fixed inset-0 z-[60] flex items-end justify-center md:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-[rgb(28_34_46/0.22)] backdrop-blur-[3px]" onClick={() => openAgent(false)} />
          <motion.div
            initial={mobile ? { y: '100%' } : { opacity: 0, y: 18, scale: 0.97 }} animate={mobile ? { y: 0 } : { opacity: 1, y: 0, scale: 1 }} exit={mobile ? { y: '100%' } : { opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className={cn('glass-strong scroll-thin relative flex max-h-[92dvh] w-full flex-col gap-4 overflow-y-auto p-5 [&>*]:shrink-0', mobile ? 'rounded-t-[30px] pb-[max(20px,env(safe-area-inset-bottom))]' : 'max-w-[600px] rounded-[32px] p-6')}>
            {mobile && <span className="mx-auto -mt-2 h-1 w-10 rounded-full bg-ink-900/15" />}
            <div className="flex items-start gap-3.5">
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-lav-200 text-lav-800 shadow-[inset_0_1px_0_rgb(255_255_255/0.6)]"><Sparkles size={21} strokeWidth={2.2} /></span>
              <div className="flex-1">
                <div className="text-[22px] font-light leading-tight tracking-[-0.01em] text-ink-700">{useStore.getState().lang === 'zh' ? <>交给 <b className="font-semibold text-ink-900">Agent</b></> : <>Hand to <b className="font-semibold text-ink-900">agent</b></>}</div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">{t.agent.sub}</p>
              </div>
              <RoundButton size="sm" tone="plain" onClick={() => openAgent(false)} aria-label="close"><X size={16} /></RoundButton>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between px-0.5">
                <span className="text-[12px] font-semibold text-ink-500">{t.agent.selected}</span>
                {!mobile && <span className="text-[11.5px] text-ink-400">{t.agent.addMore}</span>}
              </div>
              {dRefs.length > 0 && decor && (
                <div className="mb-1.5 flex flex-wrap gap-1.5" data-testid="agent-decor-refs">
                  {dRefs.map(id => { const it = findItem(decor, id); return (
                    <span key={id} className="tile flex h-9 items-center gap-2 rounded-full pl-2 pr-1 text-[13px] font-semibold text-ink-800">
                      <span className="grid size-6 place-items-center rounded-full bg-sand-100 text-sand-700"><span className="size-2 rounded-sm bg-sand-700" /></span>
                      {it?.it.name ?? (it ? ({ furniture: '家具', cabinet: '柜子', panel: '造型', recess: '挖洞' } as const)[it.k] : '墙面材料')}
                      <span className="num text-[11px] font-medium text-ink-400">{id}</span>
                      <button onClick={() => useDecor.getState().set({ agentRefs: decorRefs.filter(x => x !== id) })} className="grid size-6 place-items-center rounded-full text-ink-400 hover:bg-ink-100 hover:text-ink-800"><X size={12} /></button>
                    </span>) })}
                </div>
              )}
              {sel.length || dRefs.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {sel.map(r => {
                    const el = findEl(plan, r) ?? findEl(view.base, r)
                    return (
                      <span key={r.id} className="tile flex h-9 items-center gap-2 rounded-full pl-2 pr-1 text-[13px] font-semibold text-ink-800">
                        <span className="grid size-6 place-items-center rounded-full bg-mint-100 text-mint-800">
                          {r.type === 'wall' && el ? <WallSwatch kind={(el as Wall).kind} size={14} /> : r.type === 'opening' && el ? openingIcon((el as Opening).kind, 12) : <span className="size-2 rounded-sm bg-mint-500" />}
                        </span>
                        {elementLabel(plan, r, lang)}
                        <span className="num text-[11px] font-medium text-ink-400">{r.id}</span>
                        <button onClick={() => select(r, true)} className="grid size-6 place-items-center rounded-full text-ink-400 hover:bg-ink-100 hover:text-ink-800"><X size={12} /></button>
                      </span>
                    )
                  })}
                </div>
              ) : <div className="tile-sunken rounded-[16px] px-3.5 py-3 text-[12.5px] text-ink-500">{t.agent.none}</div>}
            </div>

            {waiting > 0 && (
              <div className="tile flex items-center gap-3 rounded-[18px] px-3 py-2.5" data-testid="agent-answers">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-lav-100 text-lav-600"><Hourglass size={15} strokeWidth={2.4} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-semibold text-ink-900">{fmt(t.agent.withAnswers, { n: waiting })}</span>
                  {answersOn && <span className="block text-[11.5px] leading-snug text-ink-500">{connected ? t.agent.answersSaved : t.agent.answersInText}</span>}
                </span>
                <Switch on={answersOn} onChange={v => useStore.setState({ agentAnswers: v })} label={fmt(t.agent.withAnswers, { n: waiting })} />
              </div>
            )}

            <div>
              <div className="tile rounded-[22px] p-1.5 focus-within:ring-2 focus-within:ring-lav-300">
                <textarea ref={ta} value={text} onChange={e => setAgentText(e.target.value)} rows={3} placeholder={t.agent.placeholder}
                  className="block w-full resize-none bg-transparent px-3 pt-2 text-[15px] leading-relaxed text-ink-900 outline-none placeholder:text-ink-400" />
                <div className="flex flex-wrap gap-1.5 px-1.5 pb-1">
                  {t.agent.examples.map(x => (
                    <button key={x} onClick={() => setAgentText(x)} className="h-7 rounded-full bg-lav-50 px-2.5 text-[12px] font-medium text-lav-600 transition hover:bg-lav-100">{x}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="min-h-0">
              <button onClick={() => setShowPreview(v => !v)} className="mb-2 flex items-center gap-1 px-0.5 text-[12px] font-semibold text-ink-500 hover:text-ink-800">
                {t.agent.preview}<ChevronDown size={14} className={cn('transition', showPreview && 'rotate-180')} />
              </button>
              <AnimatePresence initial={false}>
                {showPreview && (
                  <motion.pre ref={pre} data-testid="agent-preview" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    className="scroll-thin tile-sunken max-h-[180px] overflow-auto whitespace-pre-wrap rounded-[16px] px-3.5 py-3 font-mono text-[11.5px] leading-[1.65] text-ink-700">{md}</motion.pre>
                )}
              </AnimatePresence>
            </div>

            <div className="flex items-center gap-3">
              <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-ink-500">
                <FileBraces size={14} className="shrink-0 text-ink-400" /><span className="shrink-0">{t.agent.file}</span>
                <span className="num truncate font-semibold text-ink-700">{view.base.meta?.planFile ?? (lang === 'zh' ? '未指定（导出后告诉 Agent 路径）' : 'not set')}</span>
              </span>
              <Pill tone={copied ? 'mint' : 'ink'} size="lg" onClick={copy} className="min-w-[168px]" data-testid="agent-copy">
                <AnimatePresence mode="wait" initial={false}>
                  {copied
                    ? <motion.span key="c" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex items-center gap-2"><Check size={17} strokeWidth={2.8} />{t.act.copied}</motion.span>
                    : <motion.span key="n" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2"><Copy size={16} />{t.act.copy}{!mobile && <span className="num rounded-[6px] bg-white/14 px-1.5 py-0.5 text-[10.5px] text-white/70">⌘↵</span>}</motion.span>}
                </AnimatePresence>
              </Pill>
            </div>
            <AnimatePresence>{copied && <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="-mt-2 text-right text-[12px] font-medium text-mint-700">{t.agent.done}</motion.div>}</AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** 答复以外有没有没导出的改动：和上次载入 / 存回 / 导出时比，问题卡和 meta 不算 */
function otherEdits(base: Plan, clean: Plan | null): boolean {
  if (!clean) return false
  const a = base as unknown as Record<string, unknown>, b = clean as unknown as Record<string, unknown>
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].some(k => k !== 'questions' && k !== 'meta' && a[k] !== b[k] && JSON.stringify(a[k]) !== JSON.stringify(b[k]))
}
