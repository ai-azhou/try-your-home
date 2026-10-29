/**
 * 界面动作：把用户操作翻成 core 的 Change / 函数调用，再交给 store.edit。
 * 文件（打开 / 导出 / 底图）、本地自动保存、本地服务模式的轮询也在这里。
 */
import type { Change, Level, Opening, Plan, Room, Wall } from '@/core/types'
import { DEFAULTS, PROTECTED_KINDS } from '@/core/types'
import { projectToWall, planBounds } from '@/core/geometry'
import { mirrorPlan, removeElement, splitWall, updateBeam, updateElement, updateOpening, updateRoom, updateWall } from '@/core/edit'
import { levelsOf } from '@/core/levels'
import { emptyPlan, newId, parsePlanText, serializePlan } from '@/core/io'
import { getView, useStore, type Ref, type Source } from './store'
import { dicts } from './i18n'
import { mockPlan } from './mock'
import { loadError, planWriteError } from '@/core/persistence'
import { findEl } from './model'
import { openChatIssuesFor } from './chat'
import { diagnoseShape, isSimplePlan } from '@/core/simple'

const st = () => useStore.getState()
const t = () => dicts[st().lang]
const fmt = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''))

/* ───────── 编辑 ───────── */
export function updateChange(ref: Ref, patch: Record<string, unknown>): Change {
  if (ref.type === 'wall') return updateWall(ref.id, patch as Partial<Wall>)
  if (ref.type === 'opening') return updateOpening(ref.id, patch as Partial<Opening>)
  if (ref.type === 'room') return updateRoom(ref.id, patch as Partial<Room>)
  if (ref.type === 'beam') return updateBeam(ref.id, patch as Partial<Omit<import('@/core/types').Beam, 'id'>>)
  return updateElement(ref.type, ref.id, patch)
}
/** 检查器改属性：同一构件同一字段连续改合并成一条 */
export function patchEl(ref: Ref, patch: Record<string, unknown>) {
  return st().edit([updateChange(ref, patch)], { key: `upd:${ref.id}:${Object.keys(patch).sort().join(',')}` })
}
export function removeRefs(refs: Ref[], confirmedShaft = false) {
  const v = getView()
  if (!v || !refs.length) return false
  // 洞口随墙一起没了，就别再单独删（否则后一条会报「目标不存在」）
  const wallIds = new Set(refs.filter(r => r.type === 'wall').map(r => r.id))
  const list = refs.filter(r => !(r.type === 'opening' && wallIds.has((findEl(v.plan, r) as Opening | undefined)?.wall ?? '')))
    .filter(r => findEl(v.plan, r))
  if (!list.length) return false
  // 原始模式里删管道井 = 纠正读图（读错了 / 画错了），不是拆；core 的「不能拆」只拦改造记录。
  // 管道井本身拆不了，删之前先轻确认一句「这是在纠正读图吗？」（本人 10-29 定）；改造态照旧由 core 拦下
  const s = st()
  if (s.mode === 'original' && list.some(r => r.type === 'shaft') && s.base && !confirmedShaft) {
    useStore.setState({ confirm: { kind: 'shaft', yes: () => { useStore.setState({ confirm: null }); removeRefs(refs, true) }, no: () => useStore.setState({ confirm: null }) } })
    return false
  }
  if (s.mode === 'original' && list.some(r => r.type === 'shaft') && s.base) {
    const shafts = new Set(list.filter(r => r.type === 'shaft').map(r => r.id)), rest = list.filter(r => r.type !== 'shaft')
    if (rest.length && !s.edit(rest.map(r => removeElement(v.plan, r)), { select: null })) return false
    const b = st().base!
    s.replaceBase({ ...b, shafts: (b.shafts ?? []).filter(x => !shafts.has(x.id)) })
    useStore.setState({ sel: [] })
    return true
  }
  const ok = st().edit(list.map(r => removeElement(v.plan, r)), { select: null })
  return ok
}
export const isProtectedRef = (plan: Plan, r: Ref) => r.type === 'wall' && PROTECTED_KINDS.includes((findEl(plan, r) as Wall | undefined)?.kind ?? 'partition')

/** 原始模式「在此处分段」：用最近一次点选的位置，没有就取中点 */
export function splitSelectedWall(id: string) {
  const s = st(), base = s.base
  if (!base || s.mode !== 'original') return
  const w = base.walls.find(w => w.id === id)
  if (!w) return
  const at = s.selPoint ? projectToWall(w, s.selPoint).s : undefined
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
  const sAt = at !== undefined && at > 50 && at < len - 50 ? at : len / 2
  try {
    const next = splitWall(base, id, Math.round(sAt))
    s.replaceBase(next)
    s.select({ type: 'wall', id }, false, null)
    s.showToast(fmt(t().splitDone, { m: (sAt / 1000).toFixed(2) }))
  } catch (e) { s.showToast(e instanceof Error ? e.message : String(e)) }
}

// Mirror integration stays here because this task does not own store.ts or TopBar.tsx.
import { emptyHistory, recordHistory, stepHistory } from '@/core/history'

/** One full-plan timeline, exposed through both existing history indicators. */
function installMirrorHistory() {
  let history = emptyHistory(), syncing = false
  const nativeUndo = st().undo, nativeRedo = st().redo
  const indicators = () => ({
    original: { past: history.past, future: history.future },
    renovation: { past: history.past.map(p => p.changes), future: history.future.map(p => p.changes) },
  })
  const step = (direction: 'undo' | 'redo') => {
    const s = st()
    if (!s.base) return
    const result = stepHistory(history, s.base, direction)
    if (!result) { if (direction === 'undo') s.showToast(t().nothingToUndo); return }
    syncing = true
    try {
      // Clear the store's edit-coalescing key using its existing action, then restore the full snapshot.
      if (direction === 'undo') nativeUndo(); else nativeRedo()
      history = result.history
      useStore.setState({ base: result.plan, hist: indicators(), dirty: true, sel: [] })
    } finally { syncing = false }
  }
  useStore.setState({ undo: () => step('undo'), redo: () => step('redo') })
  useStore.subscribe((s, before) => {
    if (syncing || s.hist === before.hist) return
    const reset = !s.hist.original.past.length && !s.hist.original.future.length && !s.hist.renovation.past.length && !s.hist.renovation.future.length
    if (reset) history = emptyHistory() // loadPlan / new file
    else if (before.base) {
      const cancelled = s.hist.renovation.past.length < before.hist.renovation.past.length
      history = cancelled ? { past: history.past.slice(0, -1), future: [] } : recordHistory(history, before.base)
    }
    syncing = true
    try { useStore.setState({ hist: indicators() }) } finally { syncing = false }
  })
}
installMirrorHistory()

const MIRROR_ORIGINAL_ONLY = '镜像请在原始模式做'
export function mirror(axis: 'x' | 'y') {
  const s = st()
  if (!s.base) return
  if (s.mode !== 'original') { s.showToast(MIRROR_ORIGINAL_ONLY); return }
  s.replaceBase(mirrorPlan(s.base, axis))
  s.fit()
}

/**
 * The menu is portalled and owned by the concurrent UI task. Adapt its existing two entries
 * here, without rewriting that component. Remove this bridge when its disabled/title props
 * can be wired directly to mode. The action guard above remains authoritative.
 */
function installMirrorMenuGuard() {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
  const entries = (): HTMLElement[] => {
    const x = document.querySelector<HTMLElement>('[data-testid="menu-mirror"]')
    const y = x?.nextElementSibling
    return x ? [x, ...(y instanceof HTMLElement && y.getAttribute('role') === 'menuitem' ? [y] : [])] : []
  }
  const refresh = () => {
    const blocked = st().mode !== 'original' || !st().base
    for (const entry of entries()) {
      entry.setAttribute('aria-disabled', String(blocked))
      entry.toggleAttribute('data-disabled', blocked)
      entry.title = st().mode !== 'original' ? MIRROR_ORIGINAL_ONLY : ''
      entry.style.opacity = blocked ? '0.4' : ''
    }
  }
  const prevent = (event: Event) => {
    if (st().mode === 'original' || !(event.target instanceof Node)) return
    if (!entries().some(entry => entry.contains(event.target as Node))) return
    if (event instanceof KeyboardEvent && !['Enter', ' '].includes(event.key)) return
    event.preventDefault(); event.stopImmediatePropagation()
    st().showToast(MIRROR_ORIGINAL_ONLY)
  }
  const observer = new MutationObserver(refresh)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  document.addEventListener('click', prevent, true)
  document.addEventListener('keydown', prevent, true)
  useStore.subscribe((s, prev) => { if (s.mode !== prev.mode || s.base !== prev.base) refresh() })
}
installMirrorMenuGuard()

/* ───────── 楼层（S2a）：新建、改标高 / 层高 / 名称、删空楼层。只在原始模式（楼层是原始结构） ───────── */
const round2 = (v: number) => Math.round(v * 100) / 100
export function addLevel() {
  const s = st(), b = s.base
  if (!b) return
  if (s.mode !== 'original') { s.showToast(t().s2a.level.onlyOriginal); return }
  const levels: Level[] = b.levels?.length ? b.levels.map(l => ({ ...l })) : [{ id: levelsOf(b)[0].id, name: '1F', elevation: 0 }]
  const top = levels[levels.length - 1]
  // 上一层楼面 = 下一层楼面 + 层高 + 楼板（120mm，和 core 上层楼板厚度一致）
  const elevation = round2(top.elevation + (top.ceiling ?? b.ceiling) + 0.12)
  const tmp = { ...b, levels }
  const id = newId(tmp, 'L')
  const name = `${levels.length + 1}F`
  s.replaceBase({ ...b, levels: [...levels, { id, name, elevation }] })
  s.setLevel(id)
  s.fit()
  s.showToast(fmt(t().s2a.level.added, { name, e: elevation.toFixed(2) }))
}
/** 改楼层：标高必须在上下两层之间（core 校验要求严格递增），第一层固定 0 */
export function updateLevel(id: string, patch: Partial<Omit<Level, 'id'>>) {
  const s = st(), b = s.base
  if (!b?.levels) return false
  if (s.mode !== 'original') { s.showToast(t().s2a.level.onlyOriginal); return false }
  const i = b.levels.findIndex(l => l.id === id)
  if (i < 0) return false
  if (patch.elevation !== undefined) {
    if (i === 0 && patch.elevation !== 0) { s.showToast(t().s2a.level.firstFixed); return false }
    const lo = b.levels[i - 1]?.elevation ?? -Infinity, hi = b.levels[i + 1]?.elevation ?? Infinity
    if (!(patch.elevation > lo && patch.elevation < hi)) { s.showToast(t().s2a.level.orderErr); return false }
  }
  const levels = b.levels.map(l => l.id === id ? { ...l, ...patch } : l)
  s.replaceBase({ ...b, levels }, { key: `level:${id}:${Object.keys(patch).join(',')}` })
  return true
}
/** 只删空楼层（还有构件就提示先删构件）；删到只剩一层时去掉 levels，回到单层方案 */
export function removeLevel(id: string) {
  const s = st(), b = s.base
  if (!b?.levels || b.levels.length < 2) return
  if (s.mode !== 'original') { s.showToast(t().s2a.level.onlyOriginal); return }
  const first = b.levels[0].id
  const on = (e: { level?: string }) => (e.level ?? first) === id
  const used = [...b.walls, ...b.beams, ...b.rooms, ...(b.columns ?? []), ...(b.shafts ?? []), ...(b.voids ?? [])].some(on) || (b.stairs ?? []).some(x => x.level === id || x.to === id)
  if (used || id === first) { s.showToast(t().s2a.level.removeBlocked); return }
  const levels = b.levels.filter(l => l.id !== id)
  const { levels: _l, ...rest } = b
  s.replaceBase(levels.length > 1 ? { ...b, levels } : rest as Plan)
  s.setLevel(null)
}

/* ───────── 文件 ───────── */
export function newPlan() {
  const p = emptyPlan()
  p.title = st().lang === 'zh' ? '新方案' : 'New plan'
  p.meta = { createdAt: new Date().toISOString().slice(0, 10) }
  st().loadPlan(p, { kind: 'new' })
  st().setTool('wall')
}
export function openDemo() {
  const p = structuredClone(mockPlan)
  st().loadPlan(p, { kind: 'demo' })
}

/** 打开方案文字（v2 或旧格式，core parsePlanText 自动转换） */
/** 载入失败：不替换当前方案，顶部提示；知道原文时多给一个「复制问题给 Chat」（T2：网页 Chat 流程） */
function rejectLoad(message: string, text?: string) {
  useStore.setState({ loadFailure: message, booting: false })
  st().setNotice({ text: message, actions: [
    ...(text !== undefined ? [{ label: t().chat.copyIssues, primary: true, run: () => { st().setNotice(null); openChatIssuesFor(text) } }] : []),
    { label: t().act.dismiss, run: () => st().setNotice(null) },
  ] })
}
function shapeProblem(text: string): string[] | null {
  let raw: unknown
  try { raw = JSON.parse(text.replace(/^\uFEFF/, '')) } catch { return null }
  if (isSimplePlan(raw)) return null
  const d = diagnoseShape(raw)
  return d.wrong ? d.reasons : null
}
function simpleLoadError(issues: { level: string; message: string }[]): string {
  const errors = issues.filter(i => i.level === 'error')
  return `${t().chat.simpleFailed}：\n${errors.slice(0, 3).map(i => i.message).join('\n')}${errors.length > 3 ? `\n${fmt(t().chat.more, { n: errors.length - 3 })}` : ''}`
}
function writeBlocked(): boolean {
  const s = st(), error = s.loadFailure ? '上次载入失败，不能保存或导出。请修复文件后重新载入；原文件保持不变。' : planWriteError(s.base)
  if (error) { s.showToast(error); return true }
  return false
}
export function openPlanText(text: string, source: Source, opts: { keepView?: boolean } = {}): boolean {
  const r = parsePlanText(text)
  // 格式根本不对（D7，和粘贴同一条判断，放在格式 / 几何错误之前）：不载入；提示条「复制问题给 Chat」给的是简版模板
  const shape = shapeProblem(text)
  if (shape) { rejectLoad(`${t().chat.shape}：${shape.slice(0, 2).join('；')}`, text); return false }
  const fatal = loadError(r.issues)
  // 简版有阻断错误：core 的 message 已经是简版路径，提示里别写成「方案文件有几何错误」（D7）
  if (fatal) { rejectLoad(r.report.source === 'simple' ? simpleLoadError(r.issues) : fatal, text); return false }
  const plan = r.plan
  // 本地服务模式知道真实路径；浏览器里打开的文件只知道文件名，方案里已有路径就不覆盖
  if (source.file && (source.kind === 'served' || !plan.meta?.planFile)) plan.meta = { ...plan.meta, planFile: source.file }
  const prev = st()
  const keep = opts.keepView ? { mode: prev.mode, main: prev.main, sel: prev.sel } : null
  prev.loadPlan(plan, source, r.report)
  if (keep) useStore.setState({ mode: keep.mode, main: keep.main, sel: keep.sel.filter(ref => findEl(plan, ref)), fitNonce: prev.fitNonce, camNonce: prev.camNonce })
  const n = r.report.approximations.length
  // 简版（D7）：不弹「已转换旧格式」，改展开「简版方案」说明条 + 提示数量
  if (r.report.source === 'simple') {
    st().setSimpleNote(opts.keepView ? prev.simpleNote : true)
    if (!opts.keepView) st().showToast(fmt(t().chat.loadedSimple, { w: plan.walls.length, o: plan.openings.length, r: plan.rooms.length }))
    return true
  }
  if (r.report.source !== 'v2' && !opts.keepView) {
    st().setNotice(n
      ? { text: fmt(t().importApprox, { n }), actions: [{ label: t().act.details, primary: true, run: () => { st().setNotice(null); st().setPanel('report') } }, { label: t().act.dismiss, run: () => st().setNotice(null) }] }
      : { text: t().importLegacyOk, actions: [{ label: t().act.dismiss, run: () => st().setNotice(null) }] })
  }
  return true
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
export const safeName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'plan'

export function exportPlan() {
  const s = st()
  if (writeBlocked() || !s.base) return
  const plan = { ...s.base, meta: { ...s.base.meta, updatedAt: new Date().toISOString().slice(0, 10) } }
  downloadBlob(new Blob([serializePlan(plan)], { type: 'application/json' }), `${safeName(plan.title)}.json`)
  s.markExported()
  s.showToast(t().exported)
}

function readAsDataURL(f: File) {
  return new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f) })
}
function imageSize(src: string) {
  return new Promise<[number, number]>((res, rej) => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = rej; i.src = src })
}

/** 户型图 → 底图（data URL，只存在本地）。没有方案时新建一个空方案带上它 */
export async function importImage(f: File) {
  let src: string, size: [number, number]
  try { src = await readAsDataURL(f); size = await imageSize(src) } catch { st().showToast(t().badImage); return }
  const s = st()
  if (!s.base) { newPlan(); useStore.setState({ tool: 'underlay' }) }
  const base = st().base!
  const b = planBounds(base)
  // 有结构时让底图宽度先对上平面宽度；空方案按 10mm/px（1000px ≈ 10m）
  const mmPerPx = b ? Math.max(1, (b[2] - b[0]) / size[0]) : 10
  const origin: [number, number] = b ? [-b[0] / mmPerPx, -b[1] / mmPerPx] : [0, 0]
  st().replaceBase({ ...base, underlay: { src, mmPerPx, origin, opacity: 60, visible: true } })
  useStore.setState(x => ({ layers: { ...x.layers, underlay: true }, tool: 'underlay', underlayNames: { ...x.underlayNames, main: f.name } }))
  st().fit()
  st().showToast(t().imageImported)
}

export async function handleFiles(files: FileList | File[] | null | undefined) {
  const f = files?.[0]
  if (!f) return
  if (/\.json$/i.test(f.name) || f.type === 'application/json') {
    const ok = openPlanText(await f.text(), { kind: 'file', file: f.name })
    // 简版文件（D7）：openPlanText 已经给了「已载入简版方案：…」，不拿「已打开」盖掉
    if (ok && st().report?.source !== 'simple') st().showToast(fmt(t().opened, { name: f.name }))
  } else if (/^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(f.name)) await importImage(f)
  else st().showToast(t().badFile)
}

/** 打开系统文件选择（隐藏 input） */
export function pickFile(accept: string) {
  const input = document.createElement('input')
  input.type = 'file'; input.accept = accept; input.style.display = 'none'
  input.onchange = () => { void handleFiles(input.files); input.remove() }
  document.body.appendChild(input)
  input.click()
}

/* ───────── 底图：两点定比例 ───────── */
/** 平面点 → 原图像素（和 core mirrorPlan 用同一个映射：P = (px − origin) · s，s 带翻转符号） */
export function planToPixel(u: NonNullable<Plan['underlay']>, p: [number, number]): [number, number] {
  const sx = (u.flipX ? -1 : 1) * u.mmPerPx, sy = (u.flipY ? -1 : 1) * (u.mmPerPxY ?? u.mmPerPx)
  return [u.origin[0] + p[0] / sx, u.origin[1] + p[1] / sy]
}
export function applyCalibration(p1: [number, number], p2: [number, number], length: number) {
  const s = st(), u = s.base?.underlay
  if (!u || !(length > 0)) return
  const a = planToPixel(u, p1), b = planToPixel(u, p2), px = Math.hypot(b[0] - a[0], b[1] - a[1])
  if (px < 2) { s.showToast(t().calibTooClose); return }
  const mmPerPx = length / px
  // 保持第一个点在平面上的位置不动：新 origin 让 a 仍映射到 p1
  const sx = (u.flipX ? -1 : 1) * mmPerPx, sy = (u.flipY ? -1 : 1) * mmPerPx
  const origin: [number, number] = [a[0] - p1[0] / sx, a[1] - p1[1] / sy]
  const { mmPerPxY: _y, ...rest } = u
  s.replaceBase({ ...s.base!, underlay: { ...rest, mmPerPx, origin, calibrations: [...(u.calibrations ?? []), { p1: a, p2: b, length, note: s.lang === 'zh' ? '界面两点定比例' : 'two-point scale' }] } })
  s.setCalib(null)
  s.showToast(fmt(t().calibDone, { v: mmPerPx.toFixed(2) }))
}

/* ───────── 本地自动保存 ───────── */
const KEY = 'floorplan-structure:autosave:v2'
export function readAutosave(): { plan: Plan; source?: Source; underlayNames?: Record<string, string> } | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    if (v?.plan?.format !== 'floorplan-structure') return null
    const parsed = parsePlanText(JSON.stringify(v.plan))
    return loadError(parsed.issues) ? null : { ...v, plan: parsed.plan }
  } catch { return null }
}
export function startAutosave() {
  let timer: ReturnType<typeof setTimeout> | undefined
  return useStore.subscribe((s, prev) => {
    if (s.base === prev.base) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      const cur = st()
      try {
        // A failed load or blank/invalid document must never replace the last recovery copy.
        if (!cur.base || cur.loadFailure || planWriteError(cur.base)) return
        localStorage.setItem(KEY, JSON.stringify({ plan: JSON.parse(serializePlan(cur.base)), source: { kind: cur.source.kind, file: cur.source.file }, underlayNames: cur.underlayNames, savedAt: new Date().toISOString() }))
        cur.markSaved('saved')
      } catch { cur.markSaved('failed') }
    }, 400)
  })
}

/* ───────── 本地服务模式：?plan=<文件>，2 秒用 ETag 查一次 ───────── */
let failedServedFile: string | null = null
let failedServedRevision: string | null = null
function servedSource(file: string, res: Response): Source {
  const root = res.headers.get('x-plan-root')
  return { kind: 'served', file: root ? `${decodeURIComponent(root).replace(/\/$/, '')}/${file.replace(/^\.?\//, '')}` : file, etag: res.headers.get('etag') }
}
export async function loadServed(file: string): Promise<boolean> {
  try {
    const res = await fetch(file, { cache: 'no-store' })
    if (!res.ok) throw new Error(String(res.status))
    const text = await res.text()
    const ok = openPlanText(text, servedSource(file, res))
    failedServedFile = ok ? null : file
    failedServedRevision = ok ? null : res.headers.get('etag') ?? text
    return ok
  } catch {
    failedServedFile = file
    failedServedRevision = null
    rejectLoad(fmt(t().serveFail, { file }))
    return false
  }
}
/**
 * 服务模式「保存」（⌘S）：POST /save?plan=<文件> 写回方案文件（serve.mjs 原子写入，只限服务目录里已存在的 .json）。
 * 写完记下服务端返回的新 ETag，轮询据此认出「这是我自己刚存的」，不当成 Agent 更新。
 */
const ownEtags = new Set<string>()
let saveInFlight = false
export async function saveServed(): Promise<boolean> {
  const s = st()
  if (s.source.kind !== 'served' || saveInFlight || writeBlocked() || !s.base) return false
  const file = new URLSearchParams(location.search).get('plan')
  if (!file) return false
  saveInFlight = true
  useStore.setState({ saving: true })
  const base = s.base
  // 方案里存相对路径（载入时为了交接文字换成了绝对路径，写回时换回来，不把本机目录写进文件）
  const plan: Plan = { ...base, meta: { ...base.meta, planFile: file, updatedAt: new Date().toISOString().slice(0, 10) } }
  const text = serializePlan(plan)
  try {
    const res = await fetch(`/save?plan=${encodeURIComponent(file)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(s.source.etag ? { 'If-Match': s.source.etag } : {}) }, body: text })
    if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')}`.trim())
    const etag = res.headers.get('etag')
    if (etag) ownEtags.add(etag)
    // 保存期间用户又改了：仍算有未保存改动
    const changedSince = st().base !== base
    useStore.setState(x => ({ source: { ...x.source, etag: etag ?? x.source.etag }, dirty: changedSince ? x.dirty : false }))
    st().showToast(fmt(t().s2a.save.saved, { file }))
    return true
  } catch (e) {
    st().showToast(fmt(t().s2a.save.failed, { e: e instanceof Error ? e.message : String(e) }))
    return false
  } finally { saveInFlight = false; useStore.setState({ saving: false }) }
}
/** ⌘S：服务模式写回方案文件，否则导出 JSON */
export function saveOrExport() {
  if (st().source.kind === 'served') void saveServed()
  else exportPlan()
}

export function startPolling(file: string) {
  let skipped: string | null = null, rejected: string | null = null, offered: string | null = null, busy = false
  const tick = async () => {
    const s = st()
    const retryFailedLoad = !!s.loadFailure && failedServedFile === file
    if (busy || saveInFlight || s.source.kind !== 'served' && !retryFailedLoad) return
    busy = true
    try {
      const res = await fetch(file, { cache: 'no-store', headers: s.source.etag ? { 'If-None-Match': s.source.etag } : {} })
      if (res.status === 304 || !res.ok) return
      const etag = res.headers.get('etag')
      if (saveInFlight || st().base !== s.base || st().source !== s.source) return
      if (etag && (etag === st().source.etag || etag === skipped || ownEtags.has(etag))) { if (etag && ownEtags.has(etag) && etag !== st().source.etag) st().setSource({ etag }); return }
      const text = await res.text()
      // Validate even while local edits are dirty; a bad external revision blocks writeback.
      const revision = etag ?? text
      if (revision === rejected || retryFailedLoad && revision === failedServedRevision) return
      const error = loadError(parsePlanText(text).issues)
      if (error) { rejected = revision; rejectLoad(error, text); return }
      if (st().base !== s.base || st().source !== s.source) return
      const reload = () => {
        if (openPlanText(text, servedSource(file, res), { keepView: true })) { failedServedFile = null; st().showToast(t().agentReloaded) }
      }
      if (!st().dirty) reload()
      else if (revision !== offered && (!st().notice || st().loadFailure)) {
        offered = revision
        st().setNotice({ text: t().agentUpdated, actions: [{ label: t().act.load, primary: true, run: reload }, { label: t().act.later, run: () => { skipped = etag; st().setNotice(null) } }] })
      }
    } catch { /* 服务停了：下次再试 */ } finally { busy = false }
  }
  const id = setInterval(tick, 2000)
  return () => clearInterval(id)
}

/** 新建构件默认值（检查器的「类型」切换用） */
export const openingDefaults = (k: Opening['kind']) => DEFAULTS.opening[k]
export { newId }
