/**
 * 界面动作：把用户操作翻成 core 的 Change / 函数调用，再交给 store.edit。
 * 文件（打开 / 导出 / 底图）、本地自动保存、本地服务模式的轮询也在这里。
 */
import type { Change, Level, Opening, Plan, Room, Underlay, Wall } from '@/core/types'
import { DEFAULTS, PROTECTED_KINDS } from '@/core/types'
import { projectToWall, planBounds, polygonArea } from '@/core/geometry'
import { mirrorPlan, removeElement, splitWall, updateBeam, updateElement, updateOpening, updateRoom, updateWall } from '@/core/edit'
import { levelsOf } from '@/core/levels'
import { emptyPlan, newId, parsePlanText, serializePlan } from '@/core/io'
import { getView, useStore, type Ref, type Source } from './store'
import { dicts } from './i18n'
import { mockPlan } from './mock'
import { loadError, planWriteError } from '@/core/persistence'
import { findEl } from './model'
import { openChatIssuesFor } from './chat'
import { diagnoseShape, isNotPlan, isSimplePlan } from '@/core/simple'
import { canLink, forgetHandle, recallHandle, rememberHandle, stampOf, type PlanFileHandle } from './file-link'
import { mergeAcrossWall, wallFootprintSides, type FootprintSide } from '@/core/merge-rooms'

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
  // 改造态拆墙：问墙占地怎么算。受保护的墙先过二次确认，确认拆了再问
  const walls = list.filter(r => r.type === 'wall').map(r => r.id)
  if (s.mode === 'renovation' && walls.length) afterWallRemoved(ok, v.plan, walls)
  return ok
}
function afterWallRemoved(ok: boolean, before: Plan, walls: string[], range?: [number, number]) {
  const pending = st().confirm
  if (ok) offerFootprint(before, walls, range)
  else if (pending) useStore.setState({ confirm: { ...pending, yes: () => { pending.yes(); if (!st().confirm) offerFootprint(before, walls, range) } } })
}
/** 改造态只拆墙的一段：core 的 remove wall 带 range。范围里的门窗会一起拆掉，界面先问清楚 */
export function removeWallRange(id: string, from: number, to: number) {
  const v = getView()
  if (!v || st().mode !== 'renovation') return false
  const ok = st().edit([{ ...removeElement(v.plan, { type: 'wall', id }), range: [from, to] }], { select: null })
  afterWallRemoved(ok, v.plan, [id], [from, to])
  return ok
}
/** 拆墙后墙占的地方怎么算：两边合成一间，或者两间都留着、算给其中一侧；不选就留一道缝（线上 bug B4，设计见 docs/design.md 7.2） */
function offerFootprint(before: Plan, wallIds: string[], range?: [number, number]) {
  const found = wallIds.map(id => ({ id, merge: mergeAcrossWall(before, id, range), ...wallFootprintSides(before, id, range) })).find(x => x.merge || x.positive || x.negative)
  if (!found) return
  const zh = st().lang === 'zh', t0 = t().footprint, { merge: m } = found
  const sides = [found.positive, found.negative].filter((x): x is FootprintSide => !!x)
  const gain = sides.length ? (Math.max(...sides.map(x => x.gained)) / 1e6).toFixed(1) : ''
  const close = () => useStore.setState({ confirm: null })
  const toSide = (side: FootprintSide) => {
    close()
    if (side.rooms.every(r => findEl(getView()?.plan ?? before, { type: 'room', id: r.room.id }))) st().edit(side.rooms.map(r => updateRoom(r.room.id, { poly: r.poly })), { select: { type: 'room', id: side.rooms[0].room.id } })
  }
  const choices = sides.map((side, i) => ({ label: fmt(t0.toSide, { names: side.rooms.map(r => r.room.name).join(zh ? '、' : ', ') }), testId: `footprint-${i}`, run: () => toSide(side) }))
  const text = m ? fmt(t0.mergeText, { a: m.keep.name, b: m.drop.name, area: (polygonArea(m.poly) / 1e6).toFixed(1) }) : fmt(t0.sideText, { gain })
  useStore.setState({ confirm: { kind: 'merge', text, canMerge: !!m, choices, no: close, yes: () => {
    close()
    const v = getView()
    if (!m || !v || !findEl(v.plan, { type: 'room', id: m.keep.id }) || !findEl(v.plan, { type: 'room', id: m.drop.id })) return
    st().edit([updateRoom(m.keep.id, { poly: m.poly }), removeElement(v.plan, { type: 'room', id: m.drop.id })], { select: { type: 'room', id: m.keep.id } })
  } } })
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
      // 底图的不透明度、显隐不算编辑：撤销别的改动时留在现在的值
      useStore.setState({ base: carryUnderlayView(result.plan, s.base), hist: indicators(), dirty: true, sel: [] })
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
/** 根本不是方案的 JSON（B8）：是选错了文件，不是谁写错了格式。说清楚该选哪个，主按钮直接重新选，不给「复制问题给 Chat」 */
function rejectNotPlan(file?: string) {
  const message = fmt(t().notPlan, { name: file?.split('/').pop() || 'JSON' })
  useStore.setState({ loadFailure: message, booting: false })
  st().setNotice({ text: message, actions: [
    { label: t().pickPlan, primary: true, run: () => { st().setNotice(null); void pickPlanFile() } },
    { label: t().act.dismiss, run: () => st().setNotice(null) },
  ] })
}
/** 是一个 JSON、但根本不是方案；写法有错的交给 parsePlanText 报 */
function notPlanText(text: string): boolean {
  try { return isNotPlan(JSON.parse(text.replace(/^﻿/, ''))) } catch { return false }
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
  const s = st(), error = s.loadFailure ? '上次载入失败，不能保存或导出。请修复文件后重新载入；原文件保持不变。' : s.unconfirmed ? t().confirmFirst : planWriteError(s.base)
  if (error) { s.showToast(error); return true }
  return false
}
export function openPlanText(text: string, source: Source, opts: { keepView?: boolean } = {}): boolean {
  const r = parsePlanText(text)
  // 根本不是方案（相机参数、统计这类 JSON，B8）：放在最前面，不当成 Chat 写错格式
  if (notPlanText(text)) { rejectNotPlan(source.file); return false }
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
export type Autosave = { plan: Plan; source?: Source; underlayNames?: Record<string, string>; dirty?: boolean }
export function readAutosave(): Autosave | null {
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
  const write = () => {
    timer = undefined
    const cur = st()
    try {
      // A failed load or blank/invalid document must never replace the last recovery copy.
      // 受保护改动还没答「我确认」：只是预览，刷新后不能算数
      if (!cur.base || cur.loadFailure || cur.unconfirmed || planWriteError(cur.base)) return
      localStorage.setItem(KEY, JSON.stringify({ plan: JSON.parse(serializePlan(cur.base)), source: { kind: cur.source.kind, file: cur.source.file, etag: cur.source.etag }, dirty: cur.dirty, underlayNames: cur.underlayNames, savedAt: new Date().toISOString() }))
      cur.markSaved('saved')
    } catch { cur.markSaved('failed') }
  }
  // 还没写下去就关页面或刷新：先写，不丢这几百毫秒里的改动
  const flush = () => { if (timer !== undefined) { clearTimeout(timer); write() } }
  globalThis.addEventListener?.('pagehide', flush)
  const off = useStore.subscribe((s, prev) => {
    // dirty、source 也要跟上：连接文件时，刷新后靠它们判断本地有没有没写回的改动
    if (s.base === prev.base && s.dirty === prev.dirty && s.source === prev.source && s.unconfirmed === prev.unconfirmed) return
    clearTimeout(timer)
    // 刚写回文件：本地副本立刻跟上。不然这时刷新，会把写回之前的内容当成没保存的改动恢复出来
    if (prev.dirty && !s.dirty) { write(); return }
    timer = setTimeout(write, 400)
  })
  return () => { off(); globalThis.removeEventListener?.('pagehide', flush); clearTimeout(timer) }
}

/* ───────── 外部版本（服务模式、连接文件共用）：坏的不载入；没有未保存改动直接载入，有就先问 ───────── */
type Watch = { skipped: string | null; rejected: string | null; offered: string | null }
const newWatch = (): Watch => ({ skipped: null, rejected: null, offered: null })
function takeRevision(w: Watch, text: string, revision: string, file: string, s: ReturnType<typeof st>, reload: () => void) {
  if (notPlanText(text)) { w.rejected = revision; rejectNotPlan(file); return }
  const error = loadError(parsePlanText(text).issues)
  // Validate even while local edits are dirty; a bad external revision blocks writeback.
  if (error) { w.rejected = revision; rejectLoad(error, text); return }
  if (st().base !== s.base || st().source !== s.source) return
  if (!st().dirty) reload()
  else if (st().base === viewOnlyBase) {
    // 本地只改了底图显示（还没写回或者刚被冲突拦下）：载入新版本，把这个值带过去再写回，Agent 写的内容一点不丢
    const keep = st().base!
    reload()
    const now = st().base
    if (now && now !== keep) {
      const merged = carryUnderlayView(now, keep)
      if (merged !== now) { useStore.setState({ base: merged, dirty: true }); viewOnlyBase = merged; commitUnderlayView() }
    }
  } else if (revision !== w.offered && (!st().notice || st().loadFailure)) {
    w.offered = revision
    st().setNotice({ text: t().agentUpdated, actions: [{ label: t().act.load, primary: true, run: reload }, { label: t().act.later, run: () => { w.skipped = revision; st().setNotice(null) } }] })
  }
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
export async function saveServed(opts: { quiet?: boolean } = {}): Promise<boolean> {
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
    useStore.setState(x => ({ source: { ...x.source, etag: etag ?? x.source.etag }, dirty: changedSince ? x.dirty : false, cleanBase: base }))
    if (!opts.quiet) st().showToast(fmt(t().s2a.save.saved, { file }))
    return true
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // 底图显示的静默写回撞上别人刚写的（409）：不吓人，轮询会载入新版本再带上这个值
    if (!opts.quiet || !message.startsWith('409')) st().showToast(fmt(t().s2a.save.failed, { e: message }))
    return false
  } finally { saveInFlight = false; useStore.setState({ saving: false }); afterSave() }
}
/** ⌘S：服务模式写回方案文件，否则导出 JSON */
export function saveOrExport() {
  if (isConnected(st().source)) void saveToFile()
  else exportPlan()
}
/** 服务模式、连接文件：改动能直接写回方案文件 */
export const isConnected = (source: Source) => source.kind === 'served' || source.kind === 'linked'
export const saveToFile = (opts?: { quiet?: boolean }) => st().source.kind === 'linked' ? saveLinked(opts) : saveServed(opts)

/* ───────── 底图的不透明度、显隐：不进撤销历史；连着文件时松手就写回，下次打开还是这个值 ───────── */
/** 上一次「只改了底图显示」之后的方案：base 还是它，就说明除了底图显示没有别的未保存改动 */
let viewOnlyBase: Plan | null = null
let flushAfterSave = false
export function setUnderlayView(patch: { opacity?: number; visible?: boolean }) {
  const s = st(), clean = !s.dirty || s.base === viewOnlyBase
  s.setUnderlay(patch, { history: false })
  viewOnlyBase = clean ? st().base : null
}
export function toggleUnderlayView() {
  const s = st(), clean = !s.dirty || s.base === viewOnlyBase
  s.toggleLayer('underlay')
  viewOnlyBase = clean ? st().base : null
  commitUnderlayView()
}
/** 松手：没有别的未保存改动就写回（走保存本来的冲突检测）；有的话留给下一次保存，这个值跟着一起写 */
export function commitUnderlayView() {
  const s = st()
  if (!isConnected(s.source) || !s.dirty || s.base !== viewOnlyBase) return
  if (saveInFlight) { flushAfterSave = true; return }
  void saveToFile({ quiet: true })
}
function afterSave() { if (flushAfterSave) { flushAfterSave = false; commitUnderlayView() } }
const sameView = (a: Underlay | undefined, b: Underlay | undefined) => !a || !b || a.opacity === b.opacity && a.visible === b.visible
/** 把 from 的底图显示设置抄到 to 上（同一张底图、同一层），没差别就返回 to 本身 */
function carryUnderlayView(to: Plan, from: Plan): Plan {
  const pick = (a: Underlay | undefined, b: Underlay | undefined) => a && b ? { ...a, opacity: b.opacity, visible: b.visible } : a
  const keys = Object.keys(to.levelUnderlays ?? {})
  if (sameView(to.underlay, from.underlay) && keys.every(k => sameView(to.levelUnderlays![k], from.levelUnderlays?.[k]))) return to
  return { ...to, ...(to.underlay ? { underlay: pick(to.underlay, from.underlay) } : {}), ...(to.levelUnderlays ? { levelUnderlays: Object.fromEntries(keys.map(k => [k, pick(to.levelUnderlays![k], from.levelUnderlays?.[k])!])) } : {}) }
}

export function startPolling(file: string) {
  const w = newWatch()
  let busy = false
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
      if (etag && (etag === st().source.etag || etag === w.skipped || ownEtags.has(etag))) { if (etag && ownEtags.has(etag) && etag !== st().source.etag) st().setSource({ etag }); return }
      const text = await res.text()
      const revision = etag ?? text
      if (revision === w.rejected || retryFailedLoad && revision === failedServedRevision) return
      takeRevision(w, text, revision, file, s, () => {
        if (openPlanText(text, servedSource(file, res), { keepView: true })) { failedServedFile = null; st().showToast(t().agentReloaded) }
      })
    } catch { /* 服务停了：下次再试 */ } finally { busy = false }
  }
  const id = setInterval(tick, 2000)
  return () => clearInterval(id)
}

/* ───────── 连接方案文件（Chrome / Edge，见 file-link.ts）：2 秒比一次修改时间和大小 ───────── */
let linkedHandle: PlanFileHandle | null = null
let pendingHandle: PlanFileHandle | null = null
/** 连接着、但最后读到的版本是坏的：记下它，文件再变才重试 */
let failedLinkStamp: string | null = null
const linkedSource = (f: File): Source => ({ kind: 'linked', file: f.name, etag: stampOf(f) })
function dropLink() {
  linkedHandle = null; pendingHandle = null; failedLinkStamp = null
  void forgetHandle()
}
async function openHandle(h: PlanFileHandle) {
  const f = await h.getFile()
  if (!/\.json$/i.test(f.name)) { await handleFiles([f]); return }
  if (!openPlanText(await f.text(), linkedSource(f))) return
  linkedHandle = h; pendingHandle = null; failedLinkStamp = null
  void rememberHandle(h)
  if (st().report?.source !== 'simple') st().showToast(fmt(t().linked, { name: f.name }))
}
/** 打开方案文件：能连接就连接，不能就走一次性读取 */
export async function pickPlanFile() {
  if (!canLink()) { pickFile('.json,application/json'); return }
  try {
    const [h] = await window.showOpenFilePicker!({ types: [{ description: t().empty.plan, accept: { 'application/json': ['.json'] } }] })
    await openHandle(h)
  } catch (e) {
    if ((e as Error).name !== 'AbortError') pickFile('.json,application/json')
  }
}
/** 拖进窗口：句柄和文件列表都要在 drop 事件里同步取，事件结束就没了 */
export async function handleDrop(data: DataTransfer | null | undefined) {
  if (!data) return
  const files = [...data.files], item = [...data.items].find(i => i.kind === 'file')
  const pending = item?.getAsFileSystemHandle?.()
  const h = await pending?.catch(() => null)
  if (h?.kind === 'file' && /\.json$/i.test(h.name)) await openHandle(h).catch(() => handleFiles(files))
  else await handleFiles(files)
}
/** 写回连接的文件。Agent 刚改过就不写，免得盖掉；写回要的权限比读高，第一次会问 */
export async function saveLinked(opts: { quiet?: boolean } = {}): Promise<boolean> {
  const s = st(), h = linkedHandle
  if (s.source.kind !== 'linked' || !h || saveInFlight || writeBlocked() || !s.base) return false
  saveInFlight = true
  useStore.setState({ saving: true })
  const base = s.base
  try {
    if (await h.queryPermission({ mode: 'readwrite' }) !== 'granted' && await h.requestPermission({ mode: 'readwrite' }) !== 'granted') { s.showToast(t().linkNoWrite); return false }
    if (stampOf(await h.getFile()) !== s.source.etag) {
      // 底图显示的静默写回：不弹冲突条，下一次比对会载入新版本再带上这个值
      if (opts.quiet) return false
      s.setNotice({ text: t().linkConflict, actions: [{ label: t().act.load, primary: true, run: () => { st().setNotice(null); void openHandle(h) } }, { label: t().act.dismiss, run: () => st().setNotice(null) }] })
      return false
    }
    const w = await h.createWritable()
    await w.write(serializePlan({ ...base, meta: { ...base.meta, updatedAt: new Date().toISOString().slice(0, 10) } }))
    await w.close()
    const etag = stampOf(await h.getFile()), changedSince = st().base !== base
    useStore.setState(x => ({ source: { ...x.source, etag }, dirty: changedSince ? x.dirty : false, cleanBase: base }))
    if (!opts.quiet) st().showToast(fmt(t().s2a.save.saved, { file: h.name }))
    return true
  } catch (e) {
    // 静默写回且不是用户手势里（要不到写权限）：不打扰，等下一次保存
    if (!opts.quiet || (e as Error).name !== 'SecurityError') st().showToast(fmt(t().s2a.save.failed, { e: e instanceof Error ? e.message : String(e) }))
    return false
  } finally { saveInFlight = false; useStore.setState({ saving: false }); afterSave() }
}
/** 本地有没写回的改动：恢复它们，文件的新版本交给轮询来问，不直接盖掉 */
function restoreUnsaved(h: PlanFileHandle, saved: Autosave) {
  st().loadPlan(saved.plan, { kind: 'linked', file: h.name, etag: saved.source?.etag })
  useStore.setState({ dirty: true, saveState: 'saved', ...(saved.underlayNames ? { underlayNames: saved.underlayNames } : {}) })
  linkedHandle = h; pendingHandle = null
}
/** 启动时：上次连着文件就接着读文件，没有就走 local（本地自动保存或空状态） */
export async function resumeLinked(saved: Autosave | null, local: () => void) {
  useStore.subscribe((s, prev) => { if (s.source !== prev.source && s.source.kind !== 'linked' && (linkedHandle || pendingHandle)) dropLink() })
  const tick = linkTicker()
  setInterval(tick, 2000)
  window.addEventListener('focus', () => void tick())
  const h = await recallHandle()
  if (!h) { local(); return }
  const unsaved = !!saved?.dirty && saved.source?.kind === 'linked' && saved.source.file === h.name
  const permission = await h.queryPermission({ mode: 'read' }).catch(() => 'prompt' as const)
  if (permission !== 'granted') {
    // 关过浏览器以后权限要重新确认，而确认必须由用户点一下触发
    local()
    pendingHandle = h
    st().setNotice({ text: fmt(t().linkAsk, { name: h.name }), actions: [
      { label: t().linkResume, primary: true, run: () => { st().setNotice(null); void h.requestPermission({ mode: 'read' }).then(p => { if (p !== 'granted') return; return unsaved ? restoreUnsaved(h, saved!) : openHandle(h) }) } },
      { label: t().linkDrop, run: () => { st().setNotice(null); dropLink() } },
    ] })
    return
  }
  try {
    if (unsaved) { restoreUnsaved(h, saved!); return }
    const f = await h.getFile(), text = await f.text()
    if (notPlanText(text) || loadError(parsePlanText(text).issues)) { local(); linkedHandle = h; failedLinkStamp = stampOf(f); openPlanText(text, linkedSource(f)); return }
    openPlanText(text, linkedSource(f))
    linkedHandle = h
  } catch {
    // 文件被移走或删掉：显示最后的副本，说清楚
    local()
    st().setNotice({ text: fmt(t().linkGone, { name: h.name }), actions: [{ label: t().pickPlan, primary: true, run: () => { st().setNotice(null); void pickPlanFile() } }, { label: t().act.dismiss, run: () => st().setNotice(null) }] })
    void forgetHandle()
  }
}
function linkTicker() {
  const w = newWatch()
  let busy = false, warned = false
  return async () => {
    const s = st(), h = linkedHandle
    if (!h || busy || saveInFlight || s.source.kind !== 'linked' && !s.loadFailure) return
    busy = true
    try {
      const f = await h.getFile(), stamp = stampOf(f)
      warned = false
      if (saveInFlight || st().base !== s.base || st().source !== s.source) return
      if (s.source.kind === 'linked' && stamp === s.source.etag || [w.skipped, w.rejected, failedLinkStamp].includes(stamp)) return
      const text = await f.text()
      takeRevision(w, text, stamp, f.name, s, () => {
        if (openPlanText(text, linkedSource(f), { keepView: true })) { failedLinkStamp = null; st().showToast(t().agentReloaded) }
      })
    } catch (e) {
      // 正在写的文件读不出来，下次再试；只有真的不见了才提示，而且只提示一次
      const name = (e as Error).name
      if ((name === 'NotFoundError' || name === 'NotAllowedError') && !warned && !st().notice) {
        warned = true
        st().setNotice({ text: fmt(t().linkGone, { name: h.name }), actions: [{ label: t().act.dismiss, run: () => st().setNotice(null) }] })
      }
    } finally { busy = false }
  }
}

/** 新建构件默认值（检查器的「类型」切换用） */
export const openingDefaults = (k: Opening['kind']) => DEFAULTS.opening[k]
export { newId }
