import { create } from 'zustand'
import { planWriteError } from '@/core/persistence'
import { useMemo } from 'react'
import type { Change, OpeningKind, Plan, Underlay, Vec2 } from '@/core/types'
import { applyChanges } from '@/core/changes'
import { bakeChange } from '@/core/edit'
import type { ImportReport } from '@/core/legacy'
import { dicts, type Lang } from './i18n'
import { computeView, type Mode, type Ref, type View } from './model'

export type { Mode, Ref, View }
export type Tool = 'select' | 'wall' | 'opening' | 'beam' | 'room' | 'underlay' | 'column' | 'shaft' | 'stair' | 'void'
export type Cam = 'iso' | 'top' | 'eye'
export type Panel = null | 'questions' | 'changes' | 'layers' | 'file' | 'report'
export type Style3D = 'struct' | 'clay'

export interface Layers { underlay: boolean; dims: boolean; certainty: boolean; ceilings: boolean; otherLevels: boolean }
export interface Notice { text: string; actions: { label: string; run(): void; primary?: boolean }[] }
/** 二次确认：缺省是受保护墙 / 承重柱（珊瑚卡）；kind 'shaft' = 原始模式删管道井前的轻确认「这是在纠正读图吗？」 */
export interface Confirm { text?: string; kind?: 'protect' | 'shaft'; yes(): void; no(): void }
export type Source = { kind: 'none' | 'local' | 'file' | 'demo' | 'new' | 'served' | 'paste'; file?: string; etag?: string | null }

const MAX_HIST = 100
const BY = '业主'
const today = () => new Date().toISOString().slice(0, 16)

interface State {
  base: Plan | null
  booting: boolean
  mode: Mode
  tool: Tool
  openingKind: OpeningKind
  main: '2d' | '3d'
  sel: Ref[]
  /** 最近一次点选落在平面上的位置（「在此处分段」用） */
  selPoint: Vec2 | null
  hover: Ref | null
  qOpen: string | null
  panel: Panel
  agentOpen: boolean
  agentText: string
  copied: boolean
  cam: Cam
  camNonce: number
  style3d: Style3D
  layers: Layers
  lang: Lang
  fitNonce: number
  dragOver: boolean
  toast: string | null
  notice: Notice | null
  confirm: Confirm | null
  /** 画墙 / 画梁：锚点、光标、这一串的起点（mm） */
  draw: { anchor: Vec2 | null; cursor: Vec2 | null; start: Vec2 | null }
  /** 手动描房间的顶点 */
  roomPoly: Vec2[] | null
  /** 底图两点定比例：已点的点（平面 mm） */
  calib: Vec2[] | null
  sheetTall: boolean
  hist: { original: { past: Plan[]; future: Plan[] }; renovation: { past: Change[][]; future: Change[][] } }
  /** 本地有没导出的改动（服务模式下 Agent 改了文件时据此决定能不能直接载入） */
  dirty: boolean
  loadFailure: string | null
  saveState: 'idle' | 'saved' | 'failed'
  source: Source
  report: ImportReport | null
  /** 底图地址载不出来（相对路径 404 等）时记下这个地址，界面给轻提示 */
  underlayMissing: string | null
  /** 桌面左列：工具栏放不下时画中画往右让开的距离（px，见 ToolRail 的 useLeftColumn） */
  pipShift: number
  /** 桌面左列：矮屏时工具栏去掉文字标签（只留图标 + 悬停提示） */
  railCompact: boolean
  /** 当前楼层（2D 只画这一层、编辑落在这一层）；null = 第一层 */
  level: string | null
  /** 3D 只看当前楼层（默认全部楼层上下叠放） */
  solo3d: boolean
  /** 测距：起点墙 + 终点墙。触屏用检查器里的「测距」按钮进入（to 为空时等用户点第二面墙）；⌥ 悬停测距不进这里 */
  measure: { from: string; to: string | null } | null
  /** 服务模式写回方案文件进行中 */
  saving: boolean
  /** 底图的原文件名（键 main = underlay，其余 = levelUnderlays 的楼层 id）。底图存成 data URL 后文件名就丢了，「复制方案给 Chat」要把 src 换回文件名（T2） */
  underlayNames: Record<string, string>
}

type EditOpts = { key?: string; confirmed?: boolean; select?: Ref | null; silent?: boolean }

interface Actions {
  setMode(m: Mode): void
  setTool(t: Tool): void
  setOpeningKind(k: OpeningKind): void
  select(ref: Ref | null, additive?: boolean, at?: Vec2 | null): void
  setHover(ref: Ref | null): void
  openQuestion(id: string | null): void
  answer(id: string, text: string): void
  setPanel(p: Panel): void
  togglePanel(p: Exclude<Panel, null>): void
  openAgent(open: boolean): void
  setAgentText(s: string): void
  setCopied(b: boolean): void
  setCam(c: Cam): void
  setStyle3d(s: Style3D): void
  toggleLayer(k: keyof Layers): void
  setLang(l: Lang): void
  swapMain(): void
  setMain(m: '2d' | '3d'): void
  fit(): void
  loadPlan(p: Plan | null, source?: Source, report?: ImportReport | null): void
  revertChange(id: string): void
  confirmChange(id: string): void
  setDragOver(b: boolean): void
  showToast(s: string | null): void
  setNotice(n: Notice | null): void
  setConfirm(c: Confirm | null): void
  setDraw(d: Partial<State['draw']>): void
  setRoomPoly(p: Vec2[] | null): void
  setCalib(p: Vec2[] | null): void
  setSheetTall(b: boolean): void
  /** 编辑：原始模式把 Change 烘进 base（纠正读图）；改造模式追加进 changes。受保护墙先弹二次确认 */
  edit(changes: Change[], opts?: EditOpts): boolean
  /** 拖动：开始时记一步历史，过程中反复替换，结束时（改造态受保护墙）再确认 */
  txBegin(): void
  txSet(changes: Change[]): boolean
  txEnd(): void
  undo(): void
  redo(): void
  /** 直接改整份方案（镜像、分段、底图等不走 Change 的操作），记进原始结构的历史 */
  replaceBase(next: Plan, opts?: { history?: boolean; key?: string }): void
  setUnderlay(patch: Partial<Underlay> | null, opts?: { history?: boolean; key?: string }): void
  markSaved(state: State['saveState']): void
  markExported(): void
  setSource(s: Partial<Source>): void
  setLevel(id: string | null): void
  setSolo3d(b: boolean): void
  setMeasure(m: State['measure']): void
}

/** 方案里底图是文件名（不是 data URL）时，记下文件名 */
function underlayNamesOf(p: Plan | null): Record<string, string> {
  const out: Record<string, string> = {}
  const name = (src: string) => src.split(/[?#]/)[0].split(/[\\/]/).pop() || src
  if (p?.underlay?.src && !/^data:/i.test(p.underlay.src)) out.main = name(p.underlay.src)
  for (const [k, u] of Object.entries(p?.levelUnderlays ?? {})) if (u?.src && !/^data:/i.test(u.src)) out[k] = name(u.src)
  return out
}

let toastTimer: ReturnType<typeof setTimeout> | undefined
let lastKey: { key: string; at: number; ids: string[] } | null = null
let tx: { snap: Plan; changed: boolean; needsConfirm: boolean } | null = null

const t = () => dicts[useStore.getState().lang]
/** 装修态里结构只读（一次只改一层，撤销才不乱）：要改墙切回改造 */
const DECOR_RO = '装修里结构只读，按 2 去改造里改'
const structureOf = (p: Plan) => p
const withConfirm = (c: Change): Change => ({ ...c, confirm: c.confirm ?? { by: BY, at: today() } })

/** 在 base 上试改：返回新 base，或错误 / 需要确认 */
function tryApply(base: Plan, mode: Mode, changes: Change[], confirmed: boolean): { next: Plan } | { error: string } | { needsConfirm: true } {
  if (mode === 'original') {
    try {
      let next = base
      // 原始模式是纠正读图，不是改造：不需要二次确认（也不会存下 confirm）
      for (const c of changes) next = bakeChange(next, withConfirm(c))
      return { next }
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  }
  const stamped = changes.map(c => ({ ...c, by: 'user' as const, status: 'confirmed' as const, at: c.at ?? today(), ...(confirmed ? { confirm: { by: BY, at: today() } } : {}) }))
  const all = [...base.changes, ...stamped]
  const { results } = applyChanges(base, all)
  const mine = results.slice(base.changes.length)
  const bad = mine.find(r => !r.ok)
  if (bad?.needsConfirm) return { needsConfirm: true }
  if (bad) return { error: bad.error ?? '改造未执行' }
  return { next: { ...base, changes: all } }
}

function pushOriginal(s: State): State['hist'] {
  return { ...s.hist, original: { past: [...s.hist.original.past, structureOf(s.base!)].slice(-MAX_HIST), future: [] } }
}
function pushRenovation(s: State): State['hist'] {
  return { ...s.hist, renovation: { past: [...s.hist.renovation.past, s.base!.changes].slice(-MAX_HIST), future: [] } }
}
const histFor = (mode: Mode) => mode === 'original' ? 'original' : 'renovation'
const emptyHist = (): State['hist'] => ({ original: { past: [], future: [] }, renovation: { past: [], future: [] } })

export const useStore = create<State & Actions>()((set, get) => ({
  base: null,
  booting: true,
  mode: 'original',
  tool: 'select',
  openingKind: 'window',
  main: '2d',
  sel: [],
  selPoint: null,
  hover: null,
  qOpen: null,
  panel: null,
  agentOpen: false,
  agentText: '',
  copied: false,
  cam: 'iso',
  camNonce: 0,
  style3d: 'struct',
  layers: { underlay: false, dims: true, certainty: false, ceilings: true, otherLevels: true },
  lang: 'zh',
  fitNonce: 0,
  dragOver: false,
  toast: null,
  notice: null,
  confirm: null,
  draw: { anchor: null, cursor: null, start: null },
  roomPoly: null,
  calib: null,
  sheetTall: false,
  hist: emptyHist(),
  dirty: false,
  underlayNames: {},
  loadFailure: null,
  saveState: 'idle',
  source: { kind: 'none' },
  report: null,
  underlayMissing: null,
  pipShift: 0,
  railCompact: false,
  level: null,
  solo3d: false,
  measure: null,
  saving: false,

  setMode: m => set({ mode: m, tool: m === 'compare' || m === 'decor' ? 'select' : get().tool, sel: [], qOpen: null, panel: null, confirm: null, measure: null, draw: { anchor: null, cursor: null, start: null }, roomPoly: null }),
  setTool: tool => {
    if ((get().mode === 'compare' || get().mode === 'decor') && tool !== 'select') { get().showToast(get().mode === 'decor' ? DECOR_RO : t().readOnly); return }
    set({ tool, draw: { anchor: null, cursor: null, start: null }, roomPoly: null, calib: null, hover: null, measure: null })
  },
  setOpeningKind: openingKind => set({ openingKind }),
  select: (ref, additive, at) => set(s => {
    if (!ref) return { sel: [], qOpen: null, selPoint: null, measure: null }
    const has = s.sel.some(r => r.id === ref.id)
    if (additive) return { sel: has ? s.sel.filter(r => r.id !== ref.id) : [...s.sel, ref], qOpen: null }
    return { sel: [ref], qOpen: null, sheetTall: false, selPoint: at ?? null, measure: s.measure && s.measure.from === ref.id ? s.measure : null }
  }),
  setHover: ref => { const h = get().hover; if (h?.id !== ref?.id || h?.type !== ref?.type) set({ hover: ref }) },
  openQuestion: id => set({ qOpen: id, sel: [] }),
  answer: (id, text) => set(s => {
    if (!s.base) return {}
    const base = structuredClone(s.base)
    const q = base.questions.find(q => q.id === id)
    if (q) { q.answer = text; q.answeredBy = BY; q.answeredAt = new Date().toISOString().slice(0, 10) }
    const next = base.questions.find(q => !q.answer)
    return { base, qOpen: next?.id ?? null, dirty: true }
  }),
  setPanel: p => set({ panel: p }),
  togglePanel: p => set(s => ({ panel: s.panel === p ? null : p })),
  openAgent: open => set({ agentOpen: open, copied: false }),
  setAgentText: agentText => set({ agentText }),
  setCopied: copied => set({ copied }),
  setCam: cam => set(s => ({ cam, camNonce: s.camNonce + 1 })),
  setStyle3d: style3d => set({ style3d }),
  toggleLayer: k => {
    const s = get()
    if (k === 'underlay' && s.base?.underlay) { s.setUnderlay({ visible: !s.base.underlay.visible }); set({ layers: { ...s.layers, underlay: !s.base.underlay.visible } }); return }
    set({ layers: { ...s.layers, [k]: !s.layers[k] } })
  },
  setLang: lang => set({ lang }),
  swapMain: () => set(s => ({ main: s.main === '2d' ? '3d' : '2d', tool: 'select', draw: { anchor: null, cursor: null, start: null } })),
  setMain: main => set({ main }),
  fit: () => set(s => ({ fitNonce: s.fitNonce + 1, camNonce: s.camNonce + 1 })),
  loadPlan: (p, source = { kind: p ? 'file' : 'none' }, report = null) => {
    const error = p && planWriteError(p, true)
    if (error) { set({ loadFailure: error, booting: false }); get().showToast(error); return }
    lastKey = null; tx = null
    set(s => ({ loadFailure: null, base: p, booting: false, sel: [], hover: null, qOpen: null, mode: 'original', tool: 'select', measure: null, level: p?.levels?.some(l => l.id === s.level) ? s.level : null, fitNonce: s.fitNonce + 1, camNonce: s.camNonce + 1, dragOver: false, hist: emptyHist(), dirty: false, underlayNames: underlayNamesOf(p), source, report, confirm: null, notice: null, draw: { anchor: null, cursor: null, start: null }, roomPoly: null, calib: null, layers: { ...s.layers, underlay: !!p?.underlay?.visible } }))
  },
  revertChange: id => set(s => {
    if (!s.base) return {}
    const c = s.base.changes.find(c => c.id === id)
    const drop = c?.group ? s.base.changes.filter(x => x.group === c.group).map(x => x.id) : [id]
    return { hist: pushRenovation(s), base: { ...s.base, changes: s.base.changes.filter(c => !drop.includes(c.id)) }, sel: [], dirty: true }
  }),
  confirmChange: id => set(s => s.base ? {
    hist: pushRenovation(s), dirty: true,
    base: { ...s.base, changes: s.base.changes.map(c => c.id === id ? { ...c, status: 'confirmed' as const, confirm: { by: BY, at: new Date().toISOString().slice(0, 10) } } : c) },
  } : {}),
  setDragOver: dragOver => set({ dragOver }),
  showToast: toast => { clearTimeout(toastTimer); set({ toast }); if (toast) toastTimer = setTimeout(() => set({ toast: null }), 2600) },
  setNotice: notice => set({ notice }),
  setConfirm: confirm => set({ confirm }),
  setDraw: d => set(s => ({ draw: { ...s.draw, ...d } })),
  setRoomPoly: roomPoly => set({ roomPoly }),
  setCalib: calib => set({ calib }),
  setSheetTall: sheetTall => set({ sheetTall }),

  edit: (changes, opts = {}) => {
    const s = get()
    if (!s.base || !changes.length) return false
    if (s.mode === 'compare') { s.showToast(t().readOnly); return false }
    if (s.mode === 'decor') { if (!opts.silent) s.showToast(DECOR_RO); return false }
    const now = Date.now()
    const coalesce = !!opts.key && lastKey?.key === opts.key && now - lastKey.at < 1600
    // 连续改同一个属性：原始模式不再记历史；改造模式把数据并进上一条
    if (coalesce && s.mode === 'renovation' && changes.length === 1 && changes[0].op === 'update') {
      const last = s.base.changes[s.base.changes.length - 1]
      if (last && lastKey!.ids.includes(last.id) && last.op === 'update' && last.target === changes[0].target) {
        const merged = { ...last, data: { ...last.data, ...changes[0].data } }
        const r = tryApply({ ...s.base, changes: s.base.changes.slice(0, -1) }, 'renovation', [merged], !!last.confirm)
        if ('next' in r) { set({ base: r.next, dirty: true }); lastKey = { ...lastKey!, at: now }; return true }
        if ('error' in r && !opts.silent) s.showToast(r.error)
        return false
      }
    }
    const r = tryApply(s.base, s.mode, changes, !!opts.confirmed)
    if ('needsConfirm' in r) {
      set({ confirm: { yes: () => { set({ confirm: null }); get().edit(changes, { ...opts, confirmed: true }) }, no: () => set({ confirm: null }) } })
      return false
    }
    if ('error' in r) { if (!opts.silent) s.showToast(r.error); return false }
    const hist = coalesce && s.mode === 'original' ? s.hist : s.mode === 'original' ? pushOriginal(s) : pushRenovation(s)
    lastKey = opts.key ? { key: opts.key, at: now, ids: changes.map(c => c.id) } : null
    set({ base: r.next, hist, dirty: true, ...(opts.select !== undefined ? { sel: opts.select ? [opts.select] : [] } : {}) })
    return true
  },
  txBegin: () => {
    const s = get()
    if (!s.base || s.mode === 'compare' || s.mode === 'decor') return
    tx = { snap: s.base, changed: false, needsConfirm: false }
    lastKey = null
  },
  txSet: changes => {
    const s = get()
    if (!tx || !s.base) return false
    let r = tryApply(tx.snap, s.mode, changes, false)
    let needsConfirm = false
    if ('needsConfirm' in r) { r = tryApply(tx.snap, s.mode, changes, true); needsConfirm = true }
    if (!('next' in r)) return false
    if (!tx.changed) set({ hist: s.mode === 'original' ? pushOriginal({ ...s, base: tx.snap }) : pushRenovation({ ...s, base: tx.snap }) })
    tx.changed = true; tx.needsConfirm = needsConfirm
    set({ base: r.next, dirty: true })
    return true
  },
  txEnd: () => {
    const cur = tx
    tx = null
    if (!cur?.changed || !cur.needsConfirm) return
    const snap = cur.snap
    set({ confirm: { yes: () => set({ confirm: null }), no: () => set(s => ({ confirm: null, base: snap, hist: { ...s.hist, renovation: { past: s.hist.renovation.past.slice(0, -1), future: [] } } })) } })
  },
  undo: () => {
    const s = get()
    if (!s.base) return
    lastKey = null
    const which = histFor(s.mode)
    if (which === 'original') {
      const h = s.hist.original, prev = h.past[h.past.length - 1]
      if (!prev) { s.showToast(t().nothingToUndo); return }
      set({ base: { ...prev, changes: s.base.changes }, hist: { ...s.hist, original: { past: h.past.slice(0, -1), future: [s.base, ...h.future].slice(0, MAX_HIST) } }, dirty: true, sel: [] })
    } else {
      const h = s.hist.renovation, prev = h.past[h.past.length - 1]
      if (!prev) { s.showToast(t().nothingToUndo); return }
      set({ base: { ...s.base, changes: prev }, hist: { ...s.hist, renovation: { past: h.past.slice(0, -1), future: [s.base.changes, ...h.future].slice(0, MAX_HIST) } }, dirty: true, sel: [] })
    }
  },
  redo: () => {
    const s = get()
    if (!s.base) return
    lastKey = null
    if (histFor(s.mode) === 'original') {
      const h = s.hist.original, next = h.future[0]
      if (!next) return
      set({ base: { ...next, changes: s.base.changes }, hist: { ...s.hist, original: { past: [...h.past, s.base].slice(-MAX_HIST), future: h.future.slice(1) } }, dirty: true, sel: [] })
    } else {
      const h = s.hist.renovation, next = h.future[0]
      if (!next) return
      set({ base: { ...s.base, changes: next }, hist: { ...s.hist, renovation: { past: [...h.past, s.base.changes].slice(-MAX_HIST), future: h.future.slice(1) } }, dirty: true, sel: [] })
    }
  },
  replaceBase: (next, opts = {}) => {
    const s = get()
    if (!s.base) { set({ base: next, dirty: true }); return }
    const now = Date.now()
    const coalesce = !!opts.key && lastKey?.key === opts.key && now - lastKey.at < 1600
    lastKey = opts.key ? { key: opts.key, at: now, ids: [] } : null
    set({ base: next, dirty: true, ...(opts.history !== false && !coalesce ? { hist: pushOriginal(s) } : {}) })
  },
  setUnderlay: (patch, opts = { history: false }) => {
    const s = get()
    if (!s.base) return
    if (!patch) { const { underlay: _u, ...rest } = s.base; s.replaceBase(rest as Plan, opts); return }
    if (!s.base.underlay) return
    s.replaceBase({ ...s.base, underlay: { ...s.base.underlay, ...patch } }, opts)
  },
  markSaved: saveState => { if (get().saveState !== saveState) set({ saveState }) },
  markExported: () => set({ dirty: false }),
  setSource: src => set(s => ({ source: { ...s.source, ...src } })),
  setLevel: level => set({ level, sel: [], hover: null, draw: { anchor: null, cursor: null, start: null }, roomPoly: null, measure: null, qOpen: null }),
  setSolo3d: solo3d => set({ solo3d }),
  setMeasure: measure => set({ measure }),
}))

/** 当前模式下画布显示的方案：原始 = base；改造 / 对比 = base 叠 changes 重放后的结果（core applyChanges）。单条缓存，所有组件共用一次重放 */
let viewCache: { base: Plan | null; mode: Mode; view: View | null } = { base: null, mode: 'original', view: null }
function viewOf(base: Plan | null, mode: Mode): View | null {
  if (viewCache.base !== base || viewCache.mode !== mode) viewCache = { base, mode, view: base ? computeView(base, mode) : null }
  return viewCache.view
}
export function useView(): View | null {
  const base = useStore(s => s.base)
  const mode = useStore(s => s.mode)
  return useMemo(() => viewOf(base, mode), [base, mode])
}
/** 非 React 场景（事件处理里）拿当前视图 */
export function getView(): View | null { const { base, mode } = useStore.getState(); return viewOf(base, mode) }

export function useT() {
  const lang = useStore(s => s.lang)
  return dicts[lang]
}
