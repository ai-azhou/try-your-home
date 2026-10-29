/**
 * 网页 Chat 流程（T2）的对话框：粘贴方案 / 复制问题给 Chat / 复制方案给 Chat（复制失败时手动复制）。
 * 外形跟「交给 Agent」一样：桌面居中弹层，手机底部抽屉。Chat 相关和 Agent 一样用淡紫。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, Check, ChevronDown, ClipboardPaste, Copy, FileJson2, MessageSquareText, TriangleAlert, X } from 'lucide-react'
import { useStore, useT } from '../store'
import { Pill, RoundButton } from '../kit'
import { fmt } from '../i18n'
import { useIsMobile } from '../layout'
import { cn } from '@/lib/utils'
import { applyPaste, closeChat, copyIssues, copyPlan, copyShape, copyTruncated, issuesTextNow, openPaste, planTextNow, submitPaste, useChat } from '../chat'
import { issueLines, truncatedChatLead } from '../chat-text'

export function ChatSheet() {
  const open = useChat(s => s.open), view = useChat(s => s.view)
  const mobile = useIsMobile()
  // Esc 关；⌘↵：粘贴页 = 载入，问题页 = 复制
  useEffect(() => {
    if (!open) return
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeChat() }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault(); e.stopImmediatePropagation()
        const v = useChat.getState().view
        if (v === 'paste') submitPaste(); else if (v === 'issues') void copyIssues(); else void copyPlan(true)
      }
    }
    window.addEventListener('keydown', on, true)
    return () => window.removeEventListener('keydown', on, true)
  }, [open])
  return (
    <AnimatePresence>
      {open && (
        <motion.div key="chat" data-testid="chat-sheet" data-view={view} className="fixed inset-0 z-[85] flex items-end justify-center md:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="absolute inset-0 bg-[rgb(28_34_46/0.22)] backdrop-blur-[3px]" onClick={closeChat} />
          <motion.div role="dialog" aria-modal="true"
            initial={mobile ? { y: '100%' } : { opacity: 0, y: 18, scale: 0.97 }} animate={mobile ? { y: 0 } : { opacity: 1, y: 0, scale: 1 }} exit={mobile ? { y: '100%' } : { opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            className={cn('glass-strong scroll-thin relative flex max-h-[92dvh] w-full flex-col gap-4 overflow-y-auto p-5 [&>*]:shrink-0', mobile ? 'rounded-t-[30px] pb-[max(20px,env(safe-area-inset-bottom))]' : 'max-w-[640px] rounded-[32px] p-6')}>
            {mobile && <span className="mx-auto -mt-2 h-1 w-10 rounded-full bg-ink-900/15" />}
            {view === 'paste' ? <PasteView /> : view === 'issues' ? <IssuesView /> : <PlanView />}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** 说明文字里的 ``` 用等宽小块显示（Manrope 里三个反引号几乎看不见） */
const withFence = (s: string) => s.split('```').flatMap((part, i) => i ? [<code key={i} className="mx-0.5 rounded-[5px] bg-ink-900/6 px-1 py-px font-mono text-[11.5px] text-ink-700">```</code>, part] : [part])

function Head({ icon, a, b, sub }: { icon: React.ReactNode; a: string; b: string; sub: string }) {
  return (
    <div className="flex items-start gap-3.5">
      <span className="grid size-12 shrink-0 place-items-center rounded-full bg-lav-200 text-lav-800 shadow-[inset_0_1px_0_rgb(255_255_255/0.6)]">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[22px] font-light leading-tight tracking-[-0.01em] text-ink-700">{a} <b className="font-semibold text-ink-900">{b}</b></div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-500">{withFence(sub)}</p>
      </div>
      <RoundButton size="sm" tone="plain" onClick={closeChat} aria-label="close" data-testid="chat-close"><X size={16} /></RoundButton>
    </div>
  )
}

/** 结果框：柠檬 = 要你动手（截断、错误）；墨 = 二次确认 */
function Callout({ tone = 'lemon', title, sub, children, testId }: { tone?: 'lemon' | 'ink'; title: string; sub?: React.ReactNode; children?: React.ReactNode; testId?: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} data-testid={testId}
      className={cn('rounded-[22px] p-3.5', tone === 'lemon' ? 'bg-lemon-100/90 ring-1 ring-inset ring-lemon-300/70' : 'bg-ink-900 text-white')}>
      <div className="flex items-start gap-2.5">
        <span className={cn('mt-px grid size-7 shrink-0 place-items-center rounded-full', tone === 'lemon' ? 'bg-lemon-300 text-lemon-800' : 'bg-white/14 text-white')}><TriangleAlert size={14} strokeWidth={2.4} /></span>
        <div className="min-w-0 flex-1">
          <div className={cn('text-[14px] font-semibold leading-snug', tone === 'lemon' ? 'text-ink-900' : 'text-white')}>{title}</div>
          {sub && <div className={cn('mt-1 text-[12.5px] leading-relaxed', tone === 'lemon' ? 'text-ink-600' : 'text-white/70')}>{sub}</div>}
        </div>
      </div>
      {children && <div className="mt-3 pl-[38px]">{children}</div>}
    </motion.div>
  )
}

function CopyBtn({ k, label, onClick, tone = 'ink', size = 'md', testId, className }: { k: string; label: string; onClick(): void; tone?: 'ink' | 'tile'; size?: 'sm' | 'md' | 'lg'; testId?: string; className?: string }) {
  const t = useT(), copied = useChat(s => s.copied === k)
  return (
    <Pill tone={copied ? 'mint' : tone} size={size} onClick={onClick} data-testid={testId} data-copied={copied || undefined} className={className}>
      {copied ? <><Check size={15} strokeWidth={2.8} />{t.chat.copied}</> : <><Copy size={15} />{label}</>}
    </Pill>
  )
}

/** 复制失败：文本框里放好全文、全选，用户自己 ⌘C */
function ManualCopy() {
  const t = useT(), manual = useChat(s => s.manual)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { if (manual) setTimeout(() => { ref.current?.focus(); ref.current?.select() }, 60) }, [manual])
  if (!manual) return null
  return (
    <div data-testid="chat-manual">
      <div className="mb-1.5 px-0.5 text-[12px] font-semibold text-lemon-800">{t.chat.manual}</div>
      <textarea ref={ref} readOnly value={manual} rows={8} onFocus={e => e.currentTarget.select()}
        className="scroll-thin tile-sunken block w-full resize-none rounded-[16px] px-3.5 py-3 font-mono text-[11.5px] leading-[1.6] text-ink-800 outline-none ring-2 ring-lemon-300" />
    </div>
  )
}

function PasteView() {
  const t = useT(), lang = useStore(s => s.lang), mobile = useIsMobile()
  const text = useChat(s => s.text), result = useChat(s => s.result), confirm = useChat(s => s.confirmReplace)
  const ta = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { setTimeout(() => ta.current?.focus(), 120) }, [])
  const ex = result?.extracted
  const lines = useMemo(() => result?.fatal && result.parsed ? issueLines(result.parsed.plan, result.parsed.issues, result.raw) : [], [result])
  const errs = lines.filter(l => l.level === 'error')
  const kind = result?.parsed?.issues.some(i => i.code === 'schema' || i.code === 'parse') ? (lang === 'zh' ? '格式' : 'format') : (lang === 'zh' ? '几何' : 'geometry')
  const SHOW = 4
  return (
    <>
      <Head icon={<ClipboardPaste size={21} strokeWidth={2.2} />} a={t.chat.titleA} b={t.chat.titleB} sub={t.chat.hint} />
      <div className="tile rounded-[22px] p-1.5 focus-within:ring-2 focus-within:ring-lav-300">
        <textarea ref={ta} data-testid="chat-paste-input" value={text} rows={9} spellCheck={false} placeholder={mobile ? t.chat.placeholderTouch : t.chat.placeholder}
          onChange={e => useChat.setState({ text: e.target.value, result: null, confirmReplace: false, copied: null, manual: null })}
          // 粘进来就解析：多数人粘完就想看结果，不用再找按钮
          onPaste={() => setTimeout(submitPaste, 0)}
          className="scroll-thin block max-h-[32dvh] w-full resize-none bg-transparent px-3 py-2 font-mono text-[12px] leading-[1.6] text-ink-900 outline-none placeholder:font-sans placeholder:text-[14px] placeholder:text-ink-400" />
        <div className="flex items-center justify-between px-3 pb-1 text-[11px] font-medium text-ink-400">
          <span>{t.chat.local}</span>
          {text && <span className="num">{fmt(t.chat.chars, { n: text.length.toLocaleString() })}</span>}
        </div>
      </div>

      {ex?.kind === 'none' && <Callout testId="chat-none" title={t.chat.none} sub={withFence(t.chat.noneSub)} />}
      {ex?.kind === 'ok' && result?.fatal === 'empty' && <Callout testId="chat-empty" title={t.chat.empty} sub={t.chat.emptySub} />}
      {ex?.kind === 'incomplete' && (
        <Callout testId="chat-incomplete" title={t.chat.incomplete} sub={fmt(t.chat.incompleteSub, { n: ex.at })}>
          <div className="tile-sunken mb-2.5 rounded-[14px] px-3 py-2 text-[12.5px] leading-relaxed text-ink-700" data-testid="chat-incomplete-text">{truncatedChatLead(ex.at)}</div>
          <CopyBtn k="truncated" label={t.chat.copyToChat} size="sm" onClick={() => void copyTruncated(ex.at)} testId="chat-copy-truncated" />
        </Callout>
      )}
      {ex?.kind === 'syntax' && (
        <Callout testId="chat-syntax" title={t.chat.syntax} sub={fmt(t.chat.syntaxSub, { n: ex.at, d: ex.detail })}>
          <Pill tone="ink" size="sm" onClick={() => useChat.setState({ view: 'issues', issuesFrom: 'failed', copied: null })} data-testid="chat-to-issues"><MessageSquareText size={14} />{t.chat.copyIssues}</Pill>
        </Callout>
      )}
      {/* D7：格式根本不对 → 不列字段错误，只列几条短原因，主按钮直接复制简版模板 */}
      {ex?.kind === 'ok' && result?.fatal === 'shape' && result.shape && (
        <Callout testId="chat-shape" title={t.chat.shape} sub={t.chat.shapeSub}>
          {result.shape.length > 0 && (
            <ul className="mb-3 flex flex-col gap-1.5" data-testid="chat-shape-reasons">
              {result.shape.slice(0, 4).map((r, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] leading-snug text-ink-800"><span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-lemon-600" /><span className="min-w-0 break-words">{r}</span></li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <CopyBtn k="shape" label={t.chat.copyShape} size="sm" onClick={() => void copyShape(result.shape!)} testId="chat-copy-shape" />
            <Pill tone="plain" size="sm" onClick={() => useChat.setState({ view: 'issues', issuesFrom: 'failed', copied: null })} data-testid="chat-to-issues">{t.chat.shapePreview}</Pill>
          </div>
        </Callout>
      )}
      {ex?.kind === 'ok' && result?.fatal && result.fatal !== 'empty' && result.fatal !== 'shape' && (
        <Callout testId={result.simple ? 'chat-simple-failed' : 'chat-failed'} title={result.simple ? t.chat.simpleFailed : fmt(t.chat.failed, { kind })} sub={result.simple ? t.chat.simpleFailedSub : t.chat.failedSub}>
          <ol className="mb-3 flex flex-col gap-1.5" data-testid="chat-errors">
            {(errs.length ? errs : lines).slice(0, SHOW).map((l, i) => (
              <li key={i} className="flex gap-2 text-[12.5px] leading-snug text-ink-800"><span className="num mt-px shrink-0 text-[11px] font-bold text-lemon-800">{i + 1}</span><span className="min-w-0 break-words">{l.text}</span></li>
            ))}
            {(errs.length || lines.length) > SHOW && <li className="pl-4 text-[12px] font-medium text-ink-500">{fmt(t.chat.more, { n: (errs.length || lines.length) - SHOW })}</li>}
          </ol>
          <Pill tone="ink" size="sm" onClick={() => useChat.setState({ view: 'issues', issuesFrom: 'failed', copied: null })} data-testid="chat-to-issues"><MessageSquareText size={14} />{t.chat.copyIssues}</Pill>
        </Callout>
      )}
      {confirm && (
        <Callout tone="ink" testId="chat-confirm" title={t.chat.replaceQ} sub={t.chat.replaceSub}>
          <div className="flex gap-2">
            <Pill tone="mint" size="sm" onClick={applyPaste} data-testid="chat-replace">{t.chat.replace}</Pill>
            <Pill tone="plain" size="sm" onClick={() => useChat.setState({ confirmReplace: false })} className="text-white/80 hover:bg-white/10 hover:text-white">{t.chat.cancel}</Pill>
          </div>
        </Callout>
      )}
      <ManualCopy />

      <div className="flex items-center justify-end gap-3">
        {/* 结果框里已经有该点的按钮（复制给 Chat / 替换）时，「载入方案」退成次要，不和它抢 */}
        <Pill tone={result?.fatal || confirm ? 'tile' : 'ink'} size="lg" onClick={submitPaste} disabled={!text.trim() || confirm} data-testid="chat-load" className="min-w-[150px]">
          {t.chat.load}<span className={cn('num rounded-[6px] px-1.5 py-0.5 text-[10.5px] max-md:hidden', result?.fatal || confirm ? 'bg-ink-900/6 text-ink-500' : 'bg-white/14 text-white/70')}>⌘↵</span>
        </Pill>
      </div>
    </>
  )
}

function IssuesView() {
  const t = useT()
  const note = useChat(s => s.note), from = useChat(s => s.issuesFrom), result = useChat(s => s.result), manual = useChat(s => s.manual), copiedIssues = useChat(s => s.copied === 'issues')
  const base = useStore(s => s.base)
  const mobile = useIsMobile()
  const [preview, setPreview] = useState(!mobile)
  const text = useMemo(() => issuesTextNow(), [note, from, result, base])
  // D7：没载入的那段是「格式不对」或「简版有错」：标题、摘要、按钮换成简版的说法
  const shape = from === 'failed' && !!result?.shape, simple = from === 'failed' && !shape && !!result?.simple
  // 摘要：数一下文字里写了什么（和复制出去的一致）
  const nErr = (text.match(/^\d+\. \[错误\]/gm) ?? []).length, nWarn = (text.match(/^\d+\. \[提醒\]/gm) ?? []).length
  const nRooms = (text.split('## 各房间面积')[1]?.split('\n## ')[0].match(/^- /gm) ?? []).length
  const nQ = Number(/还没答的问题卡（(\d+) 个）/.exec(text)?.[1] ?? 0)
  const chip = (label: string, tone: 'lemon' | 'mint' | 'gray') => <span className={cn('num inline-flex h-7 items-center rounded-full px-2.5 text-[12px] font-semibold', tone === 'lemon' ? 'bg-lemon-200 text-lemon-800' : tone === 'mint' ? 'bg-mint-100 text-mint-700' : 'bg-ink-100 text-ink-600')}>{label}</span>
  return (
    <>
      <Head icon={<MessageSquareText size={21} strokeWidth={2.2} />} a={t.chat.issuesA} b={t.chat.issuesB} sub={shape ? t.chat.shapeSub : t.chat.issuesSub} />
      <div className="-mt-1 flex flex-wrap items-center gap-1.5" data-testid="chat-issues-summary">
        <span className="mr-1 text-[12px] font-medium text-ink-500">{shape ? t.chat.fromShape : simple ? t.chat.fromSimple : from === 'failed' ? t.chat.fromFailed : t.chat.fromCurrent}</span>
        {shape ? chip(t.chat.sumShape, 'lemon') : nErr || nWarn ? <>{nErr > 0 && chip(fmt(t.chat.sumErr, { n: nErr }), 'lemon')}{nWarn > 0 && chip(fmt(t.chat.sumWarn, { n: nWarn }), 'gray')}</> : chip(t.chat.sumClean, 'mint')}
        {shape || simple ? chip(t.chat.sumTemplate, 'gray') : chip(fmt(t.chat.sumRooms, { n: nRooms }), 'gray')}
        {nQ > 0 && chip(fmt(t.chat.sumQ, { n: nQ }), 'lemon')}
      </div>
      <label className="block">
        <span className="mb-1.5 flex items-baseline gap-1.5 px-0.5 text-[12px] font-semibold text-ink-600">{t.chat.noteLabel}<span className="font-medium text-ink-400">{t.chat.noteOpt}</span></span>
        <span className="tile block rounded-[20px] p-1.5 focus-within:ring-2 focus-within:ring-lav-300">
          <textarea data-testid="chat-note" value={note} rows={2} placeholder={t.chat.notePh} onChange={e => useChat.setState({ note: e.target.value, copied: null })}
            className="block w-full resize-none bg-transparent px-2.5 py-1.5 text-[14.5px] leading-relaxed text-ink-900 outline-none placeholder:text-ink-400" />
        </span>
      </label>
      {manual ? <ManualCopy /> : (
        <div className="min-h-0">
          <button onClick={() => setPreview(v => !v)} className="mb-2 flex items-center gap-1 px-0.5 text-[12px] font-semibold text-ink-500 hover:text-ink-800">
            {t.chat.preview}<ChevronDown size={14} className={cn('transition', preview && 'rotate-180')} />
          </button>
          {preview && <pre data-testid="chat-issues-preview" className="scroll-thin tile-sunken max-h-[240px] overflow-auto whitespace-pre-wrap break-words rounded-[16px] px-3.5 py-3 font-mono text-[11.5px] leading-[1.65] text-ink-700">{text}</pre>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2.5">
        {from === 'failed' && <button onClick={openPaste} className="flex items-center gap-1 text-[12.5px] font-semibold text-ink-500 hover:text-ink-800"><ArrowLeft size={14} />{t.chat.back}</button>}
        <span className="flex-1" />
        {from === 'current' && base && <CopyBtn k="plan" tone="tile" label={t.chat.copyPlan} onClick={() => void copyPlan(true)} testId="chat-copy-plan" />}
        <CopyBtn k="issues" size="lg" label={shape ? t.chat.copyShape : t.chat.copyIssues} onClick={() => void copyIssues()} testId="chat-copy-issues" className="min-w-[180px]" />
      </div>
      <AnimatePresence>{copiedIssues && <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="-mt-2 text-right text-[12px] font-medium text-mint-700">{t.chat.done}</motion.div>}</AnimatePresence>
    </>
  )
}

/** 复制方案给 Chat：只有复制失败时才会打开这一页（手动复制） */
function PlanView() {
  const t = useT()
  const text = useMemo(() => planTextNow() ?? '', [])
  return (
    <>
      <Head icon={<FileJson2 size={21} strokeWidth={2.2} />} a={t.chat.planA} b={t.chat.planB} sub={t.chat.planSub} />
      <ManualCopy />
      <div className="flex justify-end"><CopyBtn k="plan" size="lg" label={t.chat.copyPlan} onClick={() => void copyPlan(true)} testId="chat-copy-plan" /></div>
      <span hidden data-testid="chat-plan-len">{text.length}</span>
    </>
  )
}
