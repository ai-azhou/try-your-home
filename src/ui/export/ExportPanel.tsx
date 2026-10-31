/**
 * 导出面板：预览页数和每页缩略图，两个开关（原始结构页 / 3D 页），确认后生成并下载 PDF。
 * 自己挂一个 React 根（不改 App.tsx）；状态在这个模块自己的 zustand 里。
 */
import { useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { create } from 'zustand'
import { Dialog } from 'radix-ui'
import { Check, FileDown, LoaderCircle, Lock, X } from 'lucide-react'
import { useStore, getView } from '../store'
import { cn } from '@/lib/utils'
import { exportStrings, fill } from './strings'
import { download, fileName, renderAll, toPdf, type Rendered } from './pdf'
import { MIN_GAP_PX, type ExportOptions } from './model'

type Phase = 'idle' | 'rendering' | 'ready' | 'packing' | 'done' | 'error'
interface UI {
  open: boolean
  opts: ExportOptions
  phase: Phase
  progress: { i: number; n: number }
  thumbs: { src: string; title: string; kind: string }[]
  rendered: Rendered | null
  error: string | null
  run: number
}
export const useExportUI = create<UI>(() => ({ open: false, opts: { original: false, threeD: true, decor: true }, phase: 'idle', progress: { i: 0, n: 0 }, thumbs: [], rendered: null, error: null, run: 0 }))

let root: Root | null = null
/** 打开导出面板（文件菜单、改造清单里的按钮共用） */
export function openExport(preset?: Partial<ExportOptions>) {
  if (!root) {
    const el = document.createElement('div')
    el.setAttribute('data-export-root', '')
    document.body.appendChild(el)
    root = createRoot(el)
    root.render(<ExportPanel />)
  }
  useExportUI.setState(s => ({ open: true, phase: 'idle', error: null, run: s.run + 1, opts: preset ? { ...s.opts, ...preset } : s.opts }))
}

function thumb(c: HTMLCanvasElement): string {
  const w = 300, h = Math.round(w * c.height / c.width)
  const t = document.createElement('canvas'); t.width = w * 2; t.height = h * 2
  const g = t.getContext('2d')!
  g.imageSmoothingQuality = 'high'
  g.drawImage(c, 0, 0, t.width, t.height)
  return t.toDataURL('image/png')
}

/** e2e / 排查用的只读钩子：最近一次排出的页面（类型、标题、序号位置）和整页 PNG */
function expose(r: Rendered | null) {
  ;(window as unknown as Record<string, unknown>).__fssExport = {
    open: openExport,
    minGapPx: MIN_GAP_PX,
    pages: r ? r.sheets.map(s => ({ kind: s.kind, title: s.title, badges: s.badges, regions: !!s.regions })) : [],
    paginate: r ? r.doc.pages.length : 0,
    paginateOpts: r ? r.doc.paginateOpts : null,
    opts: r ? r.doc.opts : null,
    items: r ? r.doc.items.map(i => ({ n: i.number, view: i.view, page: i.page, changeIds: i.focus.changeIds })) : [],
    decor: r?.doc.decor ? { style: r.doc.decor.style, items: r.doc.decor.items.map(i => ({ n: i.number, id: i.id, kind: i.kind, room: i.roomName, page: i.page, protect: i.protect ?? null, orphan: !!i.orphan, status: i.status, title: i.title, lines: i.lines })), pro: r.doc.decor.pro.map(i => i.id) } : null,
    png: (i: number) => r?.sheets[i]?.canvas.toDataURL('image/png') ?? null,
    file: r ? fileName(r.doc) : null,
  }
}

function ExportPanel() {
  const ui = useExportUI()
  const lang = useStore(s => s.lang)
  const t = exportStrings[lang]
  const signal = useRef<{ cancelled: boolean } | null>(null)
  const set = useExportUI.setState

  // 打开或改开关时重新排版
  useEffect(() => {
    if (!ui.open) return
    const base = useStore.getState().base
    if (!base || (!base.changes.length && !base.decor)) { set({ phase: 'error', error: t.entryEmpty }); return }
    if (ui.opts.structure === false && ui.opts.decor === false) { set({ phase: 'error', error: lang === 'zh' ? '「结构改造」「装修想法」至少勾一节' : 'Pick at least one section' }); return }
    if (signal.current) signal.current.cancelled = true
    const sig = { cancelled: false }
    signal.current = sig
    set({ phase: 'rendering', progress: { i: 0, n: 0 }, thumbs: [], rendered: null, error: null })
    renderAll(base, ui.opts, lang, getView()?.plan ?? null, (i, n) => { if (!sig.cancelled) set({ progress: { i, n } }) }, sig)
      .then(r => {
        if (sig.cancelled) return
        expose(r)
        set({ rendered: r, thumbs: r.sheets.map(s => ({ src: thumb(s.canvas), title: s.title, kind: s.kind })), phase: 'ready' })
      })
      .catch(e => { if (!sig.cancelled) { console.error(e); set({ phase: 'error', error: fill(t.failed, { e: e instanceof Error ? e.message : String(e) }) }) } })
    return () => { sig.cancelled = true }
  }, [ui.open, ui.run, ui.opts.original, ui.opts.threeD, ui.opts.decor, ui.opts.structure, lang])

  const go = async () => {
    const r = useExportUI.getState().rendered
    if (!r) return
    set({ phase: 'packing', progress: { i: 0, n: r.sheets.length } })
    try {
      const blob = await toPdf(r, (i, n) => set({ progress: { i, n } }))
      download(blob, fileName(r.doc))
      set({ phase: 'done' })
    } catch (e) {
      set({ phase: 'error', error: fill(t.failed, { e: e instanceof Error ? e.message : String(e) }) })
    }
  }
  const busy = ui.phase === 'rendering' || ui.phase === 'packing'
  const r = ui.rendered
  const nItems = useStore(s => s.base?.changes.length ?? 0), hasDecor = useStore(s => !!s.base?.decor)
  const toggle = (k: keyof ExportOptions) => set(s => ({ opts: { ...s.opts, [k]: !s.opts[k] } }))

  return (
    <Dialog.Root open={ui.open} onOpenChange={o => { if (!o) { if (signal.current) signal.current.cancelled = true; set({ open: false }) } }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-ink-950/20 backdrop-blur-[2px] data-[state=open]:animate-[shimmer-in_160ms_var(--ease-out)]" />
        <Dialog.Content data-testid="export-panel" aria-describedby={undefined}
          className="glass-strong fixed left-1/2 top-1/2 z-[91] flex max-h-[min(860px,calc(100dvh-32px))] w-[min(760px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[30px] p-5 outline-none data-[state=open]:animate-[shimmer-in_200ms_var(--ease-out)]">
          <div className="flex items-start gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-ink-900 text-white"><FileDown size={18} strokeWidth={2.3} /></span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[17px] font-semibold tracking-[-0.01em] text-ink-900">{t.panelTitle}</Dialog.Title>
              <div className="text-[12.5px] font-medium text-ink-500">{t.panelSub}</div>
            </div>
            <Dialog.Close asChild>
              <button aria-label={t.close} className="grid size-9 shrink-0 place-items-center rounded-full text-ink-500 transition hover:bg-white/80 hover:text-ink-900"><X size={17} /></button>
            </Dialog.Close>
          </div>

          <div className="tile flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[18px] px-4 py-3">
            <Stat n={nItems} label={fill(t.items, { n: '' }).trim()} />
            {r?.doc.decor && <Stat n={r.doc.decor.items.length} label={lang === 'zh' ? '项装修' : 'decor items'} testId="export-decor-count" />}
            <Stat n={r ? r.sheets.length : ui.progress.n || '–'} label={fill(t.pages, { n: '' }).trim()} testId="export-page-count" />
            {r && (r.doc.stats.bearing + r.doc.stats.exterior) > 0 && (
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink-600"><Lock size={12} strokeWidth={2.6} />
                {r.doc.stats.bearing && r.doc.stats.exterior ? fill(t.coverProtected, { n: r.doc.stats.bearing, m: r.doc.stats.exterior }) : r.doc.stats.bearing ? fill(t.coverProtectedBearing, { n: r.doc.stats.bearing }) : fill(t.coverProtectedExterior, { m: r.doc.stats.exterior })}
              </span>
            )}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {hasDecor && nItems > 0 && <Toggle on={ui.opts.structure !== false} onChange={() => set(s => ({ opts: { ...s.opts, structure: s.opts.structure === false } }))} label={lang === 'zh' ? '包含结构改造' : 'Include structural changes'} hint={lang === 'zh' ? `${nItems} 条，逐条标在图上` : `${nItems} items, marked on the plan`} testId="export-opt-structure" disabled={ui.phase === 'packing'} />}
            <Toggle on={ui.opts.original} onChange={() => toggle('original')} label={t.optOriginal} hint={t.optOriginalHint} testId="export-opt-original" disabled={ui.phase === 'packing'} />
            <Toggle on={ui.opts.threeD} onChange={() => toggle('threeD')} label={t.opt3d} hint={t.opt3dHint} testId="export-opt-3d" disabled={ui.phase === 'packing'} />
            {hasDecor && <Toggle on={ui.opts.decor !== false} onChange={() => set(s => ({ opts: { ...s.opts, decor: s.opts.decor === false } }))} label={lang === 'zh' ? '包含装修想法' : 'Include decor ideas'} hint={lang === 'zh' ? '每个房间一块，材料表、需要专业确认的嵌入' : 'Per room, materials, items to verify'} testId="export-opt-decor" disabled={ui.phase === 'packing'} />}
          </div>

          <div className="scroll-thin -mx-1 min-h-[180px] flex-1 overflow-y-auto px-1">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4" data-testid="export-thumbs">
              {(ui.thumbs.length ? ui.thumbs : Array.from({ length: Math.max(3, ui.progress.n) }, () => null)).map((th, i) => (
                <figure key={i} className="flex flex-col gap-1.5">
                  <div className={cn('aspect-[297/210] overflow-hidden rounded-[12px] bg-white ring-1 ring-ink-900/8 shadow-[0_6px_16px_-12px_rgb(30_34_60/0.5)]', !th && 'animate-pulse bg-white/60')}>
                    {th && <img src={th.src} alt={th.title} className="block size-full object-cover" />}
                  </div>
                  <figcaption className="flex items-center gap-1.5 px-0.5 text-[11.5px] font-medium text-ink-500">
                    <span className="num font-semibold text-ink-800">{i + 1}</span>
                    <span className="truncate">{th?.title ?? ''}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <div className="min-w-0 flex-1 text-[12.5px] font-medium text-ink-500" data-testid="export-status">
              {ui.phase === 'rendering' && <span className="flex items-center gap-2"><LoaderCircle size={14} className="animate-spin" />{ui.progress.n ? fill(t.rendering, { i: ui.progress.i, n: ui.progress.n }) : t.preparing}</span>}
              {ui.phase === 'packing' && <span className="flex items-center gap-2"><LoaderCircle size={14} className="animate-spin" />{t.packing} <span className="num">{ui.progress.i} / {ui.progress.n}</span></span>}
              {ui.phase === 'ready' && r && <span className="truncate">{fileName(r.doc)}</span>}
              {ui.phase === 'done' && <span className="flex items-center gap-2 text-mint-700"><Check size={15} strokeWidth={2.6} />{t.done} · <span className="text-ink-500">{t.doneHint}</span></span>}
              {ui.phase === 'error' && <span className="text-coral-700">{ui.error}</span>}
            </div>
            {busy && <div className="h-1.5 w-28 overflow-hidden rounded-full bg-ink-900/8"><div className="h-full rounded-full bg-ink-900 transition-[width] duration-200" style={{ width: `${ui.progress.n ? (ui.progress.i / ui.progress.n) * 100 : 6}%` }} /></div>}
            <button data-testid="export-download" disabled={!r || busy} onClick={go}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-ink-900 pl-2 pr-5 text-[14px] font-semibold text-white shadow-[0_8px_18px_-8px_rgb(15_17_21/0.55),inset_0_1px_0_rgb(255_255_255/0.12)] transition active:scale-[0.97] disabled:opacity-40">
              <span className="grid size-7 place-items-center rounded-full bg-white/14"><FileDown size={15} strokeWidth={2.4} /></span>{t.download}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function Stat({ n, label, testId }: { n: number | string; label: string; testId?: string }) {
  return <span className="flex items-baseline gap-1.5"><span data-testid={testId} className="num text-[20px] font-semibold leading-none text-ink-900">{n}</span><span className="text-[12px] font-semibold text-ink-500">{label}</span></span>
}

function Toggle({ on, onChange, label, hint, testId, disabled }: { on: boolean; onChange(): void; label: string; hint: string; testId?: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} data-testid={testId} disabled={disabled} onClick={onChange}
      className="tile flex items-center gap-3 rounded-[18px] px-3.5 py-2.5 text-left transition hover:bg-white disabled:opacity-50">
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold text-ink-900">{label}</span>
        <span className="block text-[11.5px] font-medium leading-snug text-ink-500">{hint}</span>
      </span>
      <span className={cn('relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors', on ? 'bg-mint-400' : 'bg-ink-900/12')}>
        <span className={cn('absolute top-[3px] size-5 rounded-full bg-white shadow-[0_2px_6px_-1px_rgb(0_0_0/0.3)] transition-[left]', on ? 'left-[21px]' : 'left-[3px]')} />
      </span>
    </button>
  )
}
