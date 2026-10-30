import { useEffect } from 'react'
import { MotionConfig } from 'motion/react'
import { useStore, type Cam, type Mode, type Tool } from './store'
import { TipProvider } from './kit'
import { Stage } from './panels/Stage'
import { TitleBlock, TopBar } from './panels/TopBar'
import { ToolHint, ToolRail } from './panels/ToolRail'
import { FloatingConfirm, NextStep, NoticeBar, RightColumn, Toast, ZoomBar } from './panels/Context'
import { QuestionPopover } from './panels/Questions'
import { AgentSheet } from './panels/AgentSheet'
import { ChatSheet } from './panels/ChatSheet'
import { SimpleBanner } from './panels/SimpleNote'
import { useChat } from './chat'
import { EmptyState } from './panels/EmptyState'
import { useIsMobile } from './layout'
import { findAny } from './model'
import { demoPlan } from './data'
import { serializePlan } from '@/core/io'
import { arcParams, planBounds } from '@/core/geometry'
import { buildSolids } from '@/core/solids'
import { getView } from './store'
import { handleDrop, loadServed, readAutosave, removeRefs, resumeLinked, saveOrExport, startAutosave, startPolling } from './actions'
import { Compass } from './panels/Compass'
import { LevelSwitch } from './panels/Levels'
import { cn } from '@/lib/utils'
import { useUnderlayCheck } from './underlay-check'
import { useDecor } from './decor/dstore'
import { applyStyle, enterDecor, rotateFurniture, showProbe } from './decor/actions'
import { removeItem, getDecorPlan, openElevAt, refreshCache, rehostAfterStructure } from './decor/model'
import { stepFace } from './decor/Chrome'

/**
 * 截图和演示用的 URL 参数（docs/design.md §9）：
 * ?state=empty|wall|opening|room|beam|question|renovation|compare|agent|draw|layers
 * &view=3d &mode=original|renovation|compare &sel=<构件id> &q=<问题id> &cam=iso|top|eye &lang=en &layers=underlay,certainty
 */
// 只读的调试 / e2e 钩子：状态、当前视图、序列化。不改任何东西
if (typeof window !== 'undefined') Object.assign(window, { __fss: { store: useStore, getView, serialize: serializePlan, planBounds, buildSolids, arcParams }, __decorUI: () => useDecor.getState() })

let urlApplied = false
const DEMO_KEYS = ['state', 'data', 'sel', 'mode', 'view', 'q', 'cam', 'tool', 'layers', 'style', 'probe']
/**
 * 启动时载入什么：?plan=<文件>（本地服务模式）> 演示参数（?state= 等，用示例方案）> 上次连接的文件 > 本地自动保存 > 空状态。
 */
function boot() {
  if (urlApplied) return
  urlApplied = true
  const p = new URLSearchParams(location.search)
  const s = useStore.getState()
  if (p.get('lang') === 'en') s.setLang('en')
  const plan = p.get('plan')
  if (plan) {
    // 方案载入（loadPlan 会重置模式 / 视图 / 选中）之后再应用 view、mode、sel 等参数，否则会被冲掉
    void loadServed(plan).then(ok => { if (ok) applyViewParams(p); else useStore.setState({ booting: false }) })
    startPolling(plan)
    return
  }
  if (DEMO_KEYS.some(k => p.has(k))) { applyUrlState(p); return }
  const saved = readAutosave()
  void resumeLinked(saved, () => {
  if (saved) { s.loadPlan(saved.plan, { kind: 'local', file: saved.source?.file }); useStore.setState({ saveState: 'saved', ...(saved.underlayNames && typeof saved.underlayNames === 'object' ? { underlayNames: { ...useStore.getState().underlayNames, ...saved.underlayNames } } : {}) }); return }
  s.loadPlan(null)
  })
}
function applyUrlState(p: URLSearchParams) {
  const s = useStore.getState()
  const st = p.get('state')
  if (st === 'empty') { s.loadPlan(null); return }
  s.loadPlan(structuredClone(demoPlan), { kind: 'demo' })
  const mode = (p.get('mode') as Mode | null) ?? (st === 'renovation' ? 'renovation' : st === 'compare' ? 'compare' : null)
  if (mode === 'decor') enterDecor(); else if (mode) s.setMode(mode)
  const pick = (id: string) => { const b = useStore.getState().base; const r = b && findAny(b, id); if (r) s.select(r) }
  const defaults: Record<string, string> = { wall: 'w-a', opening: 'o-entry', room: 'r-living', beam: 'b-1', agent: 'w-b' }
  if (st && defaults[st]) pick(defaults[st])
  if (p.get('sel')) p.get('sel')!.split(',').forEach((id, i) => { const b = useStore.getState().base; const r = b && findAny(b, id); if (r) s.select(r, i > 0) })
  if (st === 'question' || p.get('q')) { s.setPanel('questions'); s.openQuestion(p.get('q') ?? 'q-beam') }
  if (st === 'agent') { s.setAgentText('这面墙能拆吗？拆了客厅能多大'); s.openAgent(true) }
  if (st === 'layers') s.setPanel('layers')
  if (st === 'draw') { s.setTool('wall'); s.setDraw({ anchor: [1800, 3600], start: [1800, 3600], cursor: [1800, 7200] }) }
  if (p.get('tool')) s.setTool(p.get('tool') as Tool)
  applyLook(p)
  // 白模探针：?probe=p1|p2|p3（装修态、3D、白模，相机对准那一处）
  const pr = p.get('probe') as 'p1' | 'p2' | 'p3' | null
  if (pr && ['p1', 'p2', 'p3'].includes(pr)) { enterDecor(); showProbe(pr) }
}
/** 只改「怎么看」的参数：主画布、相机、显示风格、图层。演示方案和 ?plan= 方案共用 */
function applyLook(p: URLSearchParams) {
  const s = useStore.getState()
  if (p.get('view') === '3d') s.setMain('3d')
  if (p.get('cam')) s.setCam(p.get('cam') as Cam)
  if (p.get('style') === 'clay') s.setStyle3d('clay')
  const on = (p.get('layers') ?? '').split(',').filter(l => l in useStore.getState().layers)
  if (on.length) useStore.setState(st => ({ layers: { ...st.layers, ...Object.fromEntries(on.map(l => [l, true])) } }))
  // 底图的显隐存在方案里（underlay.visible），图层开关只是它的镜像
  const u = useStore.getState().base?.underlay
  if (on.includes('underlay') && u && !u.visible) useStore.setState(st => ({ base: st.base && { ...st.base, underlay: { ...u, visible: true } } })) // 只是看法，不记历史、不算未导出改动
}
/** ?plan= 方案载入后：模式、选中、问题卡、看法（不碰 state= 这类演示专用参数） */
function applyViewParams(p: URLSearchParams) {
  const s = useStore.getState()
  const mode = p.get('mode') as Mode | null
  if (mode === 'original' || mode === 'renovation' || mode === 'compare') s.setMode(mode)
  if (mode === 'decor') enterDecor()
  const b = useStore.getState().base
  if (b && p.get('sel')) p.get('sel')!.split(',').forEach((id, i) => { const r = findAny(getView()?.plan ?? b, id) ?? findAny(b, id); if (r) s.select(r, i > 0) })
  if (b && p.get('q') && b.questions.some(q => q.id === p.get('q'))) { s.setPanel('questions'); s.openQuestion(p.get('q')) }
  applyLook(p)
}

/** 装修态的快捷键：工具（平面 V M F C E；立面 V P N C M）、R 转家具、⌫ 删、[ ] 换墙、Esc 逐级退出 */
function decorKey(e: KeyboardEvent, k: string): boolean {
  const s = useStore.getState(), D = useDecor.getState()
  if (s.agentOpen || s.confirm) return false
  const plan = D.canvas.k === 'plan'
  const tools: Record<string, Parameters<typeof D.setTool>[0]> = plan ? { v: 'select', m: 'material', f: 'furniture', c: 'cabinet' } : { v: 'select', p: 'panel', n: 'cut', c: 'cabinet', m: 'material' }
  if (s.main === '2d' && tools[k]) { D.setTool(tools[k]); return true }
  if (k === 'e' && plan && s.main === '2d') { if (D.sel?.k === 'face') openElevAt(D.sel.face, { s: D.sel.s }); else D.setTool('elevpick'); return true }
  if (k === 'r' && D.sel?.k === 'furniture') { rotateFurniture(D.sel.id); return true }
  // A：交给 Agent，选中的装修构件带 core decorHandoff 的 ref
  if (k === 'a') { e.preventDefault(); D.set({ agentRefs: D.sel && 'id' in D.sel ? [D.sel.id] : [] }); s.openAgent(true); return true }
  if ((k === 'backspace' || k === 'delete') && D.sel && 'id' in D.sel && D.sel.k !== 'cell') { e.preventDefault(); removeItem(D.sel.id); return true }
  if ((k === '[' || k === ']') && D.canvas.k === 'elev') { const dp = getDecorPlan(); const room = D.canvas.room, f = dp && stepFace(dp.plan, D.canvas.face, k === ']' ? 1 : -1, room); if (f) D.openElevation(f, room); return true }
  if (k === 'enter' && D.styleCard && D.preview) { applyStyle(D.preview, D.keepOverrides); return true }
  if (k === 'escape') {
    if (D.throughHint) D.set({ throughHint: null })
    else if (D.probe && s.main === '3d') D.set({ probe: null })
    else if (D.preview) D.set({ preview: null })
    else if (D.tool !== 'select') D.setTool('select')
    else if (D.styleCard && s.base?.decor) D.set({ styleCard: false })
    else if (D.canvas.k === 'cabinet') D.openElevation(D.canvas.face, D.canvas.room)
    else if (D.sel && !(D.canvas.k === 'elev' && D.sel.k === 'face')) D.select(D.canvas.k === 'elev' ? { k: 'face', face: D.canvas.face } : null)
    else if (D.canvas.k === 'elev') D.backToPlan()
    else return false
    return true
  }
  return false
}

/** 装修态：结构变了以后，把挂得上的构件的位置记进 cache（墙被拆以后靠它画「没地方挂」的幽灵） */
function useDecorCache() {
  const mode = useStore(s => s.mode), base = useStore(s => s.base)
  useEffect(() => {
    if (mode !== 'decor' || !base?.decor) return
    const dp = getDecorPlan()
    if (!dp?.decor) return
    const next = refreshCache(dp.plan, dp.decor)
    if (JSON.stringify(next) !== JSON.stringify(dp.decor.cache ?? {})) useStore.setState(st => st.base?.decor ? { base: { ...st.base, decor: { ...st.base.decor, cache: next } } } : {})
  }, [mode, base])
}

/**
 * 结构改动（改造里拆一段墙、改造清单里撤一条）以后，把跟到剩下那段墙上的装修写成新墙 id（core rehostDecor）。
 * 只在「这次只改了结构、装修层没动」时做（撤销 / 重做会把整份方案连装修一起换回去，不再改写）；
 * 不推历史，和那次结构改动算同一步撤销。
 */
if (typeof window !== 'undefined') useStore.subscribe((s, prev) => {
  if (!s.base?.decor || !prev.base || s.base === prev.base) return
  if (s.base.changes === prev.base.changes || !prev.base.decor) return
  // 结构编辑会整份拷贝方案，装修层引用会变；按内容比（cache 除外）：装修层内容也变了 = 撤销 / 重做 / 载入，不改写
  if (s.base.decor !== prev.base.decor && decorKeyOf(s.base.decor) !== decorKeyOf(prev.base.decor)) return
  const next = rehostAfterStructure(prev.base, s.base)
  if (next) useStore.setState(st => st.base ? { base: { ...st.base, decor: next } } : {})
})

/** 对准期间点任一视角 / 复位（camNonce 变了）= 退出对准、切到那个视角（D6） */
if (typeof window !== 'undefined') useStore.subscribe((s, prev) => {
  if (s.camNonce !== prev.camNonce && useDecor.getState().probe) useDecor.getState().set({ probe: null })
})

function decorKeyOf(d: { cache?: unknown } | undefined) { return d ? JSON.stringify({ ...d, cache: undefined }) : '' }

function useShortcuts() {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      // 事件可能派发在 window / document 上（target 不是元素），先判断再 closest
      const el = e.target
      if (el instanceof Element && el.closest('input, textarea, select, [contenteditable]')) return
      const s = useStore.getState()
      if (!s.base || useChat.getState().open) return
      if (e.metaKey || e.ctrlKey) {
        const k = e.key.toLowerCase()
        if (e.key === 'Enter' && !s.agentOpen) { e.preventDefault(); s.openAgent(true) }
        else if (k === 'z' && !e.shiftKey) { e.preventDefault(); s.undo() }
        else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); s.redo() }
        else if (k === 's') { e.preventDefault(); saveOrExport() }
        return
      }
      if (e.altKey) return
      const k = e.key.toLowerCase()
      if (e.repeat && k !== '=' && k !== '-') return
      if (s.mode === 'decor' && decorKey(e, k)) return
      const tools: Record<string, Tool> = { v: 'select', w: 'wall', d: 'opening', b: 'beam', r: 'room', u: 'underlay' }
      if (tools[k] && s.main === '2d') { s.setTool(tools[k]); return }
      const cams: Record<string, Cam> = { '7': 'iso', '8': 'top', '9': 'eye' }
      if (cams[k]) { s.setCam(cams[k]); return }
      if (k === '1') s.setMode('original')
      else if (k === '2') s.setMode('renovation')
      else if (k === '3') s.setMode('compare')
      else if (k === '4') enterDecor()
      else if (k === 'tab') { e.preventDefault(); s.swapMain() }
      else if (k === 'a') { e.preventDefault(); s.openAgent(true) }
      else if (k === 'q') s.togglePanel('questions')
      else if (k === 'f') s.fit()
      else if (k === '=' || k === '+') window.dispatchEvent(new CustomEvent('plan-zoom', { detail: 1.25 }))
      else if (k === '-') window.dispatchEvent(new CustomEvent('plan-zoom', { detail: 0.8 }))
      else if (k === 'escape') {
        if (s.confirm) s.confirm.no()
        else if (s.agentOpen) s.openAgent(false)
        else if (s.measure) s.setMeasure(null)
        else if (s.draw.anchor) s.setDraw({ anchor: null, start: null })
        else if (s.roomPoly) s.setRoomPoly(null)
        else if (s.calib) s.setCalib(null)
        else if (s.tool !== 'select') s.setTool('select')
        else if (s.qOpen) s.openQuestion(null)
        else if (s.sel.length) s.select(null)
        else s.setPanel(null)
      } else if ((k === 'backspace' || k === 'delete') && s.sel.length) {
        e.preventDefault()
        removeRefs(s.sel)
      }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
}

function useDropFiles() {
  useEffect(() => {
    let depth = 0
    const s = () => useStore.getState()
    const enter = (e: DragEvent) => { if (!e.dataTransfer?.types.includes('Files')) return; e.preventDefault(); depth++; s().setDragOver(true) }
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault() }
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) s().setDragOver(false) }
    const drop = async (e: DragEvent) => {
      e.preventDefault(); depth = 0; s().setDragOver(false)
      await handleDrop(e.dataTransfer)
    }
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop)
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop) }
  }, [])
}

export default function App() {
  const base = useStore(s => s.base), mode = useStore(s => s.mode), dragOver = useStore(s => s.dragOver)
  const mobile = useIsMobile()
  const booting = useStore(s => s.booting)
  useEffect(() => { boot() }, [])
  useEffect(() => startAutosave(), [])
  useShortcuts()
  useDecorCache()
  useDropFiles()
  useUnderlayCheck()
  return (
    <MotionConfig reducedMotion="user">
      <TipProvider delayDuration={350}>
        <div className={cn('app-bg fixed inset-0 overflow-hidden', mode === 'decor' ? 'mode-decor' : mode !== 'original' && 'mode-renovation')}>
          {booting ? null : base ? (
            <>
              <Stage />
              {!mobile && <TitleBlock />}
              <ToolRail />
              <ToolHint />
              <RightColumn />
              <NextStep />
              {!mobile && <ZoomBar />}
              <Compass />
              <SimpleBanner />
              {mobile && <div className="pointer-events-none absolute left-[64px] top-[124px] z-30"><LevelSwitch /></div>}
              {!mobile && <QuestionPopover />}
              {dragOver && <div className="pointer-events-none absolute inset-3 z-[70] rounded-[36px] border-2 border-dashed border-mint-400 bg-mint-50/40 backdrop-blur-[2px]" />}
            </>
          ) : <EmptyState />}
          <TopBar />
          <AgentSheet />
          <ChatSheet />
          <FloatingConfirm />
          <NoticeBar />
          <Toast />
        </div>
      </TipProvider>
    </MotionConfig>
  )
}
