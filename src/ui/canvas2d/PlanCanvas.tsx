/**
 * 2D 平面画布：SVG + 自写平移缩放。点选 / 悬停 / 编辑一律用平面坐标调 core（hitTest、snap、edit.*）。
 * mini = 画中画小窗：不平移缩放、不画标签，始终适配，只能点选。
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CircleQuestionMark, Check, Lock, Sparkles } from 'lucide-react'
import type { Change, ElementType, Opening, OpeningKind, Plan, Room, Beam, Vec2, Wall } from '@/core/types'
import { DEFAULTS } from '@/core/types'
import { distance, effectiveWallHeight, jointsAt, labelPoint, planBounds, pointAt, pointInPolygon, projectToWall, snap, wallLength, wallNormal, type SnapResult } from '@/core/geometry'
import { addBeam, addElement, addOpening, addRoom, addWall, detectRoom, moveJoint, moveOpening, updateWall } from '@/core/edit'
import { applyChanges } from '@/core/changes'
import { levelsOf } from '@/core/levels'
import { measureWalls, type WallMeasurement } from '@/core/measure'
import { wallOutlines } from '@/core/walls'
import { curLevelId, isMultiLevel, levelField, levelView, pickAll } from '../levels-ui'
import { multiPolyPath } from '../render-plan'
import { polygonArea } from '@/core/geometry'
import { newId } from '@/core/io'
import { getView, useStore, useT, useView, type Ref } from '../store'
import { Defs, PlanLayers, isProtectedWall } from './PlanLayers'
import { Hotspot } from '../kit'
import { fmtLen, len2, mid, polyPath, segmentRect, spanOf, underlayHref } from '../geom'
import { wallFootprint } from '@/core/geometry'
import { C } from './style'
import { cn } from '@/lib/utils'
import { freeRect, useIsMobile } from '../layout'
import { findEl } from '../model'
import { fmt } from '../i18n'
import { layoutRoomLabels, pinPositions, type RoomLabelLayout } from './labels'
import type { FaceRef } from '@/core/decor/types'
import { useDecor } from '../decor/dstore'
import { DecorOver, DecorUnder } from '../decor/PlanDecor'
import { decorIssues, decorPlanOf, faceNear, getDecorPlan, openCabinetAt, openElevAt, shownDecor, tempDecor } from '../decor/model'
import { clearances, decorHit, snapFurniture } from '../decor/plan-ctl'
import { addCabinet, addFurniture, paintFace, paintFloor, patchFurniture } from '../decor/actions'
import { DecorPins, DragClearance, CabinetDraft } from '../decor/PlanOverlays'

function refCenter(plan: Plan, base: Plan, r: Ref): Vec2 | null {
  const el = findEl(plan, r) ?? findEl(base, r)
  if (!el) return null
  if (r.type === 'wall') { const w = el as Wall; return pointAt(w, wallLength(w) / 2) }
  if (r.type === 'opening') { const s = spanOf(findEl(plan, r) ? plan : base, el as Opening); return s ? s.center : null }
  if (r.type === 'room') return labelPoint((el as Room).poly)
  const b = el as Beam
  return mid(b.a, b.b)
}

interface Xf { k: number; x: number; y: number }
const NO_SEL: Ref[] = []

function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [s, setS] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setS({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return s
}

export function useImageSize(src?: string) {
  const [s, setS] = useState<[number, number] | null>(null)
  useEffect(() => {
    if (!src) { setS(null); return }
    const img = new Image()
    img.onload = () => setS([img.naturalWidth, img.naturalHeight])
    img.src = src
  }, [src])
  return s
}

/** 当前状态：完整方案（编辑落在这上面）+ 当前楼层的只读视图（画、点选、吸附用） */
function cur() {
  const v = getView()
  if (!v) return null
  const lvId = curLevelId(v.plan, useStore.getState().level)
  return { v, full: v.plan, plan: levelView(v.plan, lvId), base: levelView(v.base, lvId), lvId }
}

/** 点选：柱 / 洞口 / 墙 / 管道井 / 梁 / 楼梯 / 挑空 / 房间（core hitTest + hitTestExtra，当前层）；对比态再试一次已拆掉的构件 */
function pick(p: Vec2, tol: number): Ref | null {
  const c = cur()
  if (!c) return null
  const r = pickAll(c.plan, p, tol)
  if (r) return r
  if (c.v.diff && useStore.getState().mode === 'compare') {
    const removed = new Set(c.v.diff.removed.map(x => x.id))
    const keep = <T extends { id: string }>(xs?: T[]) => (xs ?? []).filter(x => removed.has(x.id))
    const ghost = { ...c.base, walls: keep(c.base.walls), openings: keep(c.base.openings), beams: [], rooms: [], columns: keep(c.base.columns), shafts: keep(c.base.shafts), stairs: keep(c.base.stairs), voids: keep(c.base.voids) }
    return pickAll(ghost, p, tol)
  }
  return null
}

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; x: number; y: number; moved: boolean }
  | { kind: 'pinch'; d: number; k: number; cx: number; cy: number; x: number; y: number; moved: true }
  | { kind: 'joint'; sx: number; sy: number; from: Vec2; moved: boolean; snapPlan: Plan; start: Plan }
  | { kind: 'bulge'; sx: number; sy: number; wall: string; moved: boolean }
  | { kind: 'opening'; sx: number; sy: number; id: string; grab: number; moved: boolean }
  | { kind: 'underlay'; sx: number; sy: number; origin: Vec2; start: Vec2; moved: boolean }
  | { kind: 'compass'; sx: number; sy: number; moved: boolean }
  | { kind: 'dfurn'; sx: number; sy: number; id: string; grab: Vec2; moved: boolean }
  | { kind: 'dcab'; sx: number; sy: number; face: FaceRef; s0: number; s1: number; moved: boolean }

export function PlanCanvas({ mini }: { mini?: boolean }) {
  const pid = 'p' + useId().replace(/[:«»]/g, '')
  const view = useView()
  const t = useT()
  const mode = useStore(s => s.mode), sel = useStore(s => s.sel), hover = useStore(s => s.hover), layers = useStore(s => s.layers)
  const tool = useStore(s => s.tool), lang = useStore(s => s.lang), qOpen = useStore(s => s.qOpen), fitNonce = useStore(s => s.fitNonce)
  const draw = useStore(s => s.draw), panel = useStore(s => s.panel), roomPoly = useStore(s => s.roomPoly), calib = useStore(s => s.calib), openingKind = useStore(s => s.openingKind)
  const S = useStore.getState
  const box = useRef<HTMLDivElement>(null)
  const size = useSize(box)
  const [xf, setXf] = useState<Xf>({ k: 0.06, x: 0, y: 0 })
  const [preview, setPreview] = useState<{ opening?: Opening; error?: string; at?: Vec2 } | null>(null)
  const [snapKind, setSnapKind] = useState<SnapResult['kind']>('none')
  const served = useStore(s => s.source.kind === 'served')
  const href = underlayHref(view?.plan.underlay?.src, served)
  const imgSize = useImageSize(href)
  const mobile = useIsMobile()
  const pipShift = useStore(s => s.pipShift)
  const level = useStore(s => s.level), measure = useStore(s => s.measure)
  const fullPlan = view?.plan
  const lvId = fullPlan ? curLevelId(fullPlan, level) : ''
  const plan = fullPlan ? levelView(fullPlan, lvId) : undefined
  const basePlan = view ? levelView(view.base, lvId) : undefined
  const multi = isMultiLevel(fullPlan)
  const baseDecor = useStore(s => s.base?.decor)
  const dSel = useDecor(s => s.sel), dHover = useDecor(s => s.hover), dPreview = useDecor(s => s.preview), dKeep = useDecor(s => s.keepOverrides)
  const dCanvas = useDecor(s => s.canvas), dDragging = useDecor(s => s.dragging), dFamily = useDecor(s => s.cabFamily), dTool = useDecor(s => s.tool)
  const editable = !mini && mode !== 'compare'
  // ⌥ / Alt 悬停测距（Figma 式）：按住时记下悬停到的另一面墙；松开就消失
  const [alt, setAlt] = useState(false)
  const [altTarget, setAltTarget] = useState<string | null>(null)
  useEffect(() => {
    if (mini) return
    const down = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return
      // Windows 上单按 Alt 再松开会把焦点切到浏览器菜单：拦掉默认行为
      e.preventDefault()
      setAlt(true)
    }
    const up = (e: KeyboardEvent) => { if (e.key === 'Alt') { e.preventDefault(); setAlt(false); setAltTarget(null) } }
    const blur = () => { setAlt(false); setAltTarget(null) }
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [mini])

  const boundsRef = useRef<ReturnType<typeof planBounds>>(null)
  // 适配按全部楼层的外包框：切层、在空楼层上画第一面墙时画面不跳，上下层对得上
  boundsRef.current = fullPlan ? planBounds(fullPlan) : null
  const hasBounds = !!boundsRef.current

  // 适配：在没被任何浮卡压住的区域里放到最大（见 layout.freeRect）。只在载入 / 改尺寸 / 按「适配」时跑，编辑时画面不跳
  const fit = useCallback(() => {
    if (!size.w) return
    const b = boundsRef.current ?? [0, 0, 10000, 8000]
    const bw = Math.max(1, b[2] - b[0]), bh = Math.max(1, b[3] - b[1])
    if (mini) {
      const pad = 14, k = Math.min((size.w - 2 * pad) / bw, (size.h - 2 * pad) / bh)
      setXf({ k, x: size.w / 2 - (b[0] + bw / 2) * k, y: size.h / 2 - (b[1] + bh / 2) * k })
      return
    }
    const dim = 44 // 总尺寸线在外侧 30px
    const r = freeRect(size.w, size.h, mobile, (bw + 0) / bh)
    const aw = Math.max(60, r.x1 - r.x0 - 2 * dim), ah = Math.max(60, r.y1 - r.y0 - 2 * dim)
    const k = Math.min(aw / bw, ah / bh)
    const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2
    setXf({ k, x: cx - (b[0] + bw / 2) * k, y: cy - (b[1] + bh / 2) * k })
  }, [size.w, size.h, mini, mobile, pipShift])

  useLayoutEffect(() => { fit() }, [fit, fitNonce, hasBounds])

  // 测试和演示用：平面坐标 ↔ 屏幕坐标（只读）
  useEffect(() => {
    if (mini) return
    const w = window as unknown as Record<string, unknown>
    w.__plan2screen = (p: Vec2) => { const r = box.current!.getBoundingClientRect(); return [r.left + xf.x + p[0] * xf.k, r.top + xf.y + p[1] * xf.k] }
  }, [xf, mini])

  // 手机：底部抽屉会盖住下半屏，选中后把构件平移到抽屉上方；取消选中时回到适配
  const selKey = sel.map(s => s.id).join(',')
  const hadSel = useRef(false)
  useEffect(() => {
    if (!mobile || mini || !plan || !size.w) return
    if (!sel.length) { if (hadSel.current) fit(); hadSel.current = false; return }
    hadSel.current = true
    const c = refCenter(plan, view!.base, sel[0])
    if (!c) return
    const top = 236, bottom = size.h * 0.5 - 12
    setXf(v => {
      const sy = v.y + c[1] * v.k, sx = v.x + c[0] * v.k
      if (sy > top && sy < bottom && sx > 24 && sx < size.w - 24) return v
      return { ...v, x: size.w / 2 - c[0] * v.k, y: (top + bottom) / 2 - c[1] * v.k }
    })
  }, [selKey, mobile])

  useEffect(() => {
    if (mini) return
    const onZoom = (e: Event) => {
      const f = (e as CustomEvent<number>).detail
      setXf(v => { const cx = size.w / 2, cy = size.h / 2, k = clampK(v.k * f); return { k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) } })
    }
    window.addEventListener('plan-zoom', onZoom)
    return () => window.removeEventListener('plan-zoom', onZoom)
  }, [mini, size.w, size.h])

  useEffect(() => {
    const el = box.current
    if (!el || mini) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top
      const mouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40)
      if (e.ctrlKey || mouseWheel) {
        const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0018))
        setXf(v => { const k = clampK(v.k * f); return { k, x: sx - (sx - v.x) * (k / v.k), y: sy - (sy - v.y) * (k / v.k) } })
      } else setXf(v => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [mini])

  const bulgeBlocked = useRef<string | null>(null)
  /** 门窗工具：在 s 处放一扇 kind；放不下时把原因说清楚（墙太短 / 空当不够 / 墙太矮），弧墙同样适用 */
  const tryOpening = (full: Plan, w: Wall, s: number, kind: OpeningKind): Change | { error: string } => {
    const width = Math.min(DEFAULTS.opening[kind].width, wallLength(w))
    const r = addOpening(full, w.id, s - width / 2, kind)
    if (!('error' in r)) return r
    const P = t.s2a.place, name = t.opening[kind], H = effectiveWallHeight(full, w)
    if (Math.min(DEFAULTS.opening[kind].head, H) <= DEFAULTS.opening[kind].sill) return { error: fmt(P.tooLow, { H: H.toFixed(2), kind: name }) }
    if (full.openings.some(o => o.wall === w.id)) return { error: fmt(P.noSlot, { W: (width / 1000).toFixed(2) }) }
    return { error: fmt(P.tooLong, { L: (wallLength(w) / 1000).toFixed(2), W: (DEFAULTS.opening[kind].width / 1000).toFixed(2), kind: name }) }
  }
  /** 拉弧失败时的原因（core 给的：洞口放不下、受保护墙要确认等） */
  const arcBlockReason = (p: Plan, w: Wall, bulge: number) => {
    const r = applyChanges(p, [updateWall(w.id, { bulge })]).results[0]
    return r.ok ? null : r.error ?? null
  }
  const ptrs = useRef(new Map<number, Vec2>())
  const g = useRef<Gesture | null>(null)
  const toPlan = (s: Vec2): Vec2 => [(s[0] - xf.x) / xf.k, (s[1] - xf.y) / xf.k]
  const toScreen = (p: Vec2): Vec2 => [xf.x + p[0] * xf.k, xf.y + p[1] * xf.k]
  const local = (e: { clientX: number; clientY: number }) => { const r = box.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as Vec2 }
  const px = (v: number) => v / xf.k

  /** 画墙 / 画梁的吸附：core snap（端点、墙中线、洞口端、网格、0/45/90°） */
  const snapDraw = (raw: Vec2, anchor: Vec2 | null, p: Plan = cur()!.plan) => snap(p, raw, { tolerance: px(12), anchor: anchor ?? undefined, gridSize: 100, grid: { tolerance: px(40) }, angles: { tolerance: px(10) } })

  /** 选中墙的手柄（端点 / 中点）*/
  const handleAt = (s: Vec2): { kind: 'joint'; p: Vec2 } | { kind: 'bulge'; wall: string } | null => {
    const st = S()
    if (st.sel.length !== 1 || st.sel[0].type !== 'wall' || st.tool !== 'select') return null
    const w = cur()?.plan.walls.find(w => w.id === st.sel[0].id)
    if (!w) return null
    for (const q of [w.a, w.b]) if (len2(toScreen(q), s) < 11) return { kind: 'joint', p: q }
    if (len2(toScreen(pointAt(w, wallLength(w) / 2)), s) < 11) return { kind: 'bulge', wall: w.id }
    return null
  }

  /* ───────── 装修态：点哪选哪、拖家具（贴墙 + 净距）、沿墙拖出柜子、刷材质、放家具 ───────── */
  const dmode = mode === 'decor'
  const decorDown = (s: Vec2): boolean => {
    const ds = useDecor.getState(), dp = getDecorPlan()
    if (!dp?.decor) return false
    const p = toPlan(s)
    if (ds.tool === 'select') {
      const hit = decorHit(dp.plan, dp.decor, p, decorIssues(dp.plan, dp.base))
      if (hit?.k === 'furniture') {
        const f = dp.decor.furniture.find(x => x.id === hit.id)!
        ds.select(hit)
        // 放在宿主里的家电只跟宿主走：选中，不拖（检查器里「拿出来」以后才能拖）
        if (f.in || !f.at) return true
        g.current = { kind: 'dfurn', sx: s[0], sy: s[1], id: f.id, grab: [p[0] - f.at[0], p[1] - f.at[1]], moved: false }
        return true
      }
    }
    if (ds.tool === 'cabinet') {
      const fn = faceNear(dp.plan, p, 400)
      if (fn) { g.current = { kind: 'dcab', sx: s[0], sy: s[1], face: fn.face, s0: fn.s, s1: fn.s, moved: false }; return true }
    }
    return false
  }
  const decorMove = (s: Vec2): boolean => {
    const d = g.current
    if (!d || (d.kind !== 'dfurn' && d.kind !== 'dcab')) return false
    const far = Math.hypot(s[0] - d.sx, s[1] - d.sy) > 4
    if (!d.moved && !far) return true
    d.moved = true
    const p = toPlan(s), dp = getDecorPlan()
    if (!dp?.decor) return true
    if (d.kind === 'dfurn') {
      const f = dp.decor.furniture.find(x => x.id === d.id)
      if (!f) return true
      const raw: Vec2 = [Math.round((p[0] - d.grab[0]) / 10) * 10, Math.round((p[1] - d.grab[1]) / 10) * 10]
      const sn = snapFurniture(dp.plan, f, raw)
      useDecor.getState().set({ dragging: d.id })
      patchFurniture(d.id, { at: sn.at, against: sn.against }, `drag-${d.id}`)
    } else {
      const fn = faceNear(dp.plan, p, 2000)
      d.s1 = fn && fn.face.wall === d.face.wall && fn.face.side === d.face.side ? fn.s : d.s1
      useDecor.getState().set({ hover: { k: 'face', face: d.face }, dragging: `cab:${d.face.wall}:${d.face.side}:${Math.round(d.s0)}:${Math.round(d.s1)}` })
    }
    return true
  }
  const decorClick = (p: Vec2) => {
    const ds = useDecor.getState(), dp = getDecorPlan()
    if (!dp) return
    const decor = dp.decor ?? tempDecor()
    const hit = decorHit(dp.plan, decor, p, decorIssues(dp.plan, dp.base))
    if (ds.tool === 'material') {
      if (hit?.k === 'floor') { paintFloor(hit.id, ds.brush); ds.select(hit) }
      else if (hit?.k === 'face') { paintFace(hit.face, ds.brush); ds.select(hit) }
      else S().showToast('点地面或墙边，刷上当前材料')
      return
    }
    if (ds.tool === 'furniture' && ds.placing) {
      addFurniture(ds.placing, p)
      ds.set({ placing: null, tool: 'select' })
      return
    }
    if (ds.tool === 'cabinet') return
    if (ds.tool === 'elevpick') {
      if (hit?.k === 'face') openElevAt(hit.face, { p, s: hit.s })
      else S().showToast('点一面墙的墙边，进它的立面')
      return
    }
    ds.select(hit)
  }
  const decorDouble = (p: Vec2) => {
    const ds = useDecor.getState(), dp = getDecorPlan()
    if (!dp) return
    const decor = dp.decor ?? tempDecor()
    const hit = decorHit(dp.plan, decor, p, decorIssues(dp.plan, dp.base))
    // 双击在哪间房里，就进这间房的那一段立面（D6 A3）
    if (hit?.k === 'face') openElevAt(hit.face, { p, s: hit.s })
    else if (hit?.k === 'cabinet') {
      const c = decor.cabinets.find(x => x.id === hit.id)
      if (c && 'face' in c.place) openCabinetAt(c.id, c.place.face)
    } else if (hit?.k === 'panel') {
      const pn = decor.panels.find(x => x.id === hit.id)
      if (pn?.span) { openElevAt(pn.span.face, { item: pn.id }); ds.select(hit) }
    }
  }

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const s = local(e)
    ptrs.current.set(e.pointerId, s)
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    if (ptrs.current.size === 2 && !mini) {
      if (g.current && g.current.kind !== 'pan' && g.current.kind !== 'pinch' && g.current.moved) S().txEnd()
      const [a, b] = [...ptrs.current.values()]
      g.current = { kind: 'pinch', d: len2(a, b), k: xf.k, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, x: xf.x, y: xf.y, moved: true }
      return
    }
    if (dmode && !mini && decorDown(s)) return
    const st = S(), c = cur(), v = c && { plan: c.plan }
    if (editable && !dmode && v && st.tool === 'select' && !st.measure) {
      const h = handleAt(s)
      if (h?.kind === 'joint') {
        const moving = new Set(jointsAt(v.plan, h.p).map(j => j.wall.id))
        g.current = { kind: 'joint', sx: s[0], sy: s[1], from: h.p, moved: false, start: v.plan, snapPlan: { ...v.plan, walls: v.plan.walls.filter(w => !moving.has(w.id)), openings: v.plan.openings.filter(o => !moving.has(o.wall)) } }
        return
      }
      if (h?.kind === 'bulge') { g.current = { kind: 'bulge', sx: s[0], sy: s[1], wall: h.wall, moved: false }; return }
      const p = toPlan(s), hit = pick(p, px(6))
      if (hit?.type === 'opening' && st.sel.length === 1 && st.sel[0].id === hit.id) {
        const o = v.plan.openings.find(o => o.id === hit.id)!, w = v.plan.walls.find(w => w.id === o.wall)!
        g.current = { kind: 'opening', sx: s[0], sy: s[1], id: o.id, grab: projectToWall(w, p).s - o.offset, moved: false }
        return
      }
    }
    if (editable && st.tool === 'underlay' && !st.calib && v?.plan.underlay) {
      g.current = { kind: 'underlay', sx: s[0], sy: s[1], origin: [...v.plan.underlay.origin], start: toPlan(s), moved: false }
      return
    }
    g.current = { kind: 'pan', sx: s[0], sy: s[1], x: xf.x, y: xf.y, moved: false }
  }

  const onMove = (e: React.PointerEvent) => {
    const s = local(e)
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, s)
    const d = g.current, st = S()
    if (d?.kind === 'pinch') {
      if (ptrs.current.size !== 2) return
      const [a, b] = [...ptrs.current.values()], f = len2(a, b) / d.d, k = clampK(d.k * f), c = mid(a, b)
      setXf({ k, x: c[0] - (d.cx - d.x) * (k / d.k), y: c[1] - (d.cy - d.y) * (k / d.k) })
      return
    }
    if (decorMove(s)) return
    if (d) {
      const far = Math.hypot(s[0] - d.sx, s[1] - d.sy) > 4
      if (!d.moved && !far) return
      if (d.kind === 'pan') {
        if (mini) return
        d.moved = true
        setXf(v => ({ ...v, x: d.x + s[0] - d.sx, y: d.y + s[1] - d.sy }))
        return
      }
      if (!d.moved) { d.moved = true; st.txBegin() }
      const p = toPlan(s), v = getView()
      if (!v) return
      if (d.kind === 'joint') {
        const sn = snapDraw(p, null, d.snapPlan)
        setSnapKind(sn.kind)
        st.setDraw({ cursor: sn.point })
        st.txSet(moveJoint(d.start, d.from, sn.point))
      } else if (d.kind === 'bulge') {
        const w = v.plan.walls.find(w => w.id === d.wall)
        if (!w) return
        // 矢高 = 光标到弦中点沿法向 n 的距离；离弦很近时吸回直墙
        const n = wallNormal(w), m = mid(w.a, w.b)
        let bulge = Math.round(((p[0] - m[0]) * n[0] + (p[1] - m[1]) * n[1]) / 10) * 10
        if (Math.abs(bulge) < px(10)) bulge = 0
        if (!st.txSet([updateWall(w.id, { bulge })])) bulgeBlocked.current = arcBlockReason(v.plan, w, bulge)
        else bulgeBlocked.current = null
      } else if (d.kind === 'opening') {
        const o = v.plan.openings.find(o => o.id === d.id), w = o && v.plan.walls.find(w => w.id === o.wall)
        if (!o || !w) return
        const sNew = Math.round((projectToWall(w, p).s - d.grab) / 10) * 10
        const c = moveOpening(v.plan, o.id, sNew)
        if (!('error' in c)) st.txSet([c])
      } else if (d.kind === 'underlay') {
        const u = v.plan.underlay
        if (!u) return
        const sx = (u.flipX ? -1 : 1) * u.mmPerPx, sy = (u.flipY ? -1 : 1) * (u.mmPerPxY ?? u.mmPerPx)
        st.setUnderlay({ origin: [d.origin[0] - (p[0] - d.start[0]) / sx, d.origin[1] - (p[1] - d.start[1]) / sy] }, { history: true, key: 'underlay-drag' })
      }
      return
    }
    if (mini || !plan) return
    const p = toPlan(s)
    if (dmode) {
      const dp = getDecorPlan(), ds = useDecor.getState()
      if (dp?.decor && e.pointerType === 'mouse') {
        const h = ds.tool === 'cabinet' ? (() => { const fn = faceNear(dp.plan, p, 400); return fn ? { k: 'face' as const, face: fn.face } : null })() : decorHit(dp.plan, dp.decor, p, decorIssues(dp.plan, dp.base))
        const key = (x: typeof h) => !x ? '' : x.k === 'face' ? `f${x.face.wall}${x.face.side}` : 'id' in x ? x.k + x.id : ''
        if (key(h) !== key(ds.hover)) ds.set({ hover: h })
        box.current!.style.cursor = ds.tool === 'select' && h?.k === 'furniture' ? 'grab' : ''
      }
      return
    }
    if ((st.tool === 'wall' || st.tool === 'beam') && editable) {
      const sn = snapDraw(p, st.draw.anchor)
      setSnapKind(sn.kind)
      st.setDraw({ cursor: sn.point })
    } else if (st.tool === 'room' && st.roomPoly && editable) {
      const sn = snapDraw(p, st.roomPoly[st.roomPoly.length - 1])
      setSnapKind(sn.kind)
      st.setDraw({ cursor: sn.point })
    } else if (st.tool === 'opening' && editable) {
      // 直墙、弧墙都能放（C3 起 core 按弧长定位）；放不下时说清楚原因
      const w = plan.walls.map(w => ({ w, pr: projectToWall(w, p) })).filter(x => x.pr.dist <= x.w.thickness / 2 + px(14)).sort((a, b) => a.pr.dist - b.pr.dist)[0]
      if (!w) { setPreview(null); return }
      const r = tryOpening(fullPlan!, w.w, w.pr.s, st.openingKind)
      setPreview('error' in r ? { error: r.error, at: w.pr.point } : { opening: r.data as unknown as Opening })
    } else if ((st.tool === 'shaft' || st.tool === 'stair' || st.tool === 'void' || st.tool === 'column') && editable) {
      st.setDraw({ cursor: snapDraw(p, null).point })
    }
    if (!mini && alt && st.tool === 'select' && st.sel.length && !g.current) {
      const ht = pick(p, px(6)), wid = ht?.type === 'wall' ? ht.id : ht?.type === 'opening' ? plan.openings.find(o => o.id === ht.id)?.wall : undefined
      if (wid && wid !== lastWall(st.sel)) setAltTarget(wid)
    }
    if (e.pointerType === 'mouse' && st.tool === 'select') {
      const h = handleAt(s)
      box.current!.style.cursor = h ? 'grab' : ''
      st.setHover(h ? st.sel[0] : pick(p, px(6)))
    }
  }

  const onUp = (e: React.PointerEvent) => {
    const d = g.current
    ptrs.current.delete(e.pointerId)
    if (ptrs.current.size > 0) return
    g.current = null
    const st = S()
    if (d && (d.kind === 'dfurn' || d.kind === 'dcab')) {
      useDecor.getState().set({ dragging: null })
      if (d.kind === 'dcab') {
        addCabinet(d.face, Math.min(d.s0, d.s1), d.moved ? Math.max(d.s0, d.s1) : Math.min(d.s0, d.s1), useDecor.getState().cabFamily)
        useDecor.getState().set({ tool: 'select', hover: null })
        return
      }
      if (d.moved) return
    }
    if (dmode && !mini && (!d || d.kind === 'dfurn' || !d.moved)) {
      if (d?.kind !== 'dfurn') decorClick(toPlan(local(e)))
      return
    }
    if (dmode && mini && (!d || !d.moved) && size.w < 500) {
      // 立面里点画中画（平面）= 回平面
      if (useDecor.getState().canvas.k !== 'plan') useDecor.getState().backToPlan()
      return
    }
    if (d && d.kind !== 'pan' && d.kind !== 'pinch') {
      if (d.moved) {
        st.txEnd(); st.setDraw({ cursor: null }); setSnapKind('none')
        if (d.kind === 'bulge' && bulgeBlocked.current) { st.showToast(bulgeBlocked.current); bulgeBlocked.current = null }
        return
      }
    } else if (!d || d.moved) return
    const s = local(e), p = toPlan(s), v = getView()
    if (!v) return
    if (st.measure && !mini) {
      // 触屏测距：检查器里按了「测距」，这一下点的是第二面墙（选中不变）
      const ht = pick(p, px(8)), wid = ht?.type === 'wall' ? ht.id : ht?.type === 'opening' ? v.plan.openings.find(o => o.id === ht.id)?.wall : undefined
      if (wid && wid !== st.measure.from) st.setMeasure({ ...st.measure, to: wid })
      return
    }
    if (mini || st.tool === 'select' || st.mode === 'compare') {
      const ref = pick(p, px(6))
      st.select(ref, e.shiftKey || e.metaKey || e.ctrlKey, p)
      return
    }
    clickTool(p)
  }

  /** 工具点击（不是拖动）：画墙、放门窗、画梁、识别房间、定比例 */
  const clickTool = (raw: Vec2) => {
    const st = S(), c0 = cur()!, v = { plan: c0.plan }, full = c0.full, lf = levelField(full, c0.lvId)
    if (st.tool === 'wall') {
      const pt = snapDraw(raw, st.draw.anchor).point
      const { anchor, start } = st.draw
      if (!anchor) { st.setDraw({ anchor: pt, start: pt, cursor: pt }); return }
      if (distance(pt, anchor) < 1) return
      const c = addWall(full, anchor, pt, 'partition', lf)
      if (!st.edit([c], { select: null })) return
      if (start && distance(pt, start) < 1) { st.setDraw({ anchor: null, start: null }); st.showToast(t.loopClosed) }
      else st.setDraw({ anchor: pt })
    } else if (st.tool === 'beam') {
      const pt = snapDraw(raw, st.draw.anchor).point
      const anchor = st.draw.anchor
      if (!anchor) { st.setDraw({ anchor: pt, cursor: pt }); return }
      if (distance(pt, anchor) < 1) return
      const c = addBeam(full, anchor, pt, lf)
      if (st.edit([c], { select: { type: 'beam', id: (c.data as { id: string }).id } })) st.setDraw({ anchor: null })
    } else if (st.tool === 'opening') {
      const w = v.plan.walls.map(w => ({ w, pr: projectToWall(w, raw) })).filter(x => x.pr.dist <= x.w.thickness / 2 + px(14)).sort((a, b) => a.pr.dist - b.pr.dist)[0]
      if (!w) { st.showToast(t.s2a.place.notOnWall); return }
      const r = tryOpening(full, w.w, w.pr.s, st.openingKind)
      if ('error' in r) { st.showToast(r.error); return }
      if (st.edit([r], { select: { type: 'opening', id: (r.data as { id: string }).id } })) { setPreview(null); st.setTool('select') }
    } else if (st.tool === 'room') {
      if (st.roomPoly) {
        const pt = snapDraw(raw, st.roomPoly[st.roomPoly.length - 1]).point
        if (st.roomPoly.length >= 3 && len2(toScreen(pt), toScreen(st.roomPoly[0])) < 12) { commitRoom(st.roomPoly); return }
        st.setRoomPoly([...st.roomPoly, pt])
        return
      }
      const inside = v.plan.rooms.find(r => pointInPolygon(raw, r.poly))
      if (inside) { st.select({ type: 'room', id: inside.id }); st.showToast(fmt(t.roomExists, { name: inside.name })); return }
      const poly = detectRoom(full, raw, c0.lvId)
      if (poly) commitRoom(poly)
      else { st.showToast(t.noEnclosure); st.setRoomPoly([snapDraw(raw, null).point]) }
    } else if (st.tool === 'underlay' && st.calib) {
      if (st.calib.length < 2) st.setCalib([...st.calib, raw])
    } else if (st.tool === 'column') {
      const pt = snapDraw(raw, null).point
      const ch = addElement(full, 'column', { ...lf, center: pt, shape: 'rect', size: [400, 400], kind: 'bearing' })
      if (st.edit([ch], { select: { type: 'column', id: (ch.data as { id: string }).id } })) st.setTool('select')
    } else if (st.tool === 'shaft' || st.tool === 'stair' || st.tool === 'void') {
      const pt = snapDraw(raw, null).point, anchor = st.draw.anchor
      if (!anchor) { st.setDraw({ anchor: pt, cursor: pt }); return }
      const r = rectFrom(anchor, pt)
      if (!r) return
      const made = extraFromRect(full, c0.lvId, st.tool, anchor, pt)
      if ('error' in made) { st.showToast(made.error); return }
      if (st.edit(made.changes, { select: made.select })) { st.setDraw({ anchor: null, cursor: null }); st.setTool('select') }
    }
  }
  const commitRoom = (poly: Vec2[]) => {
    const st = S(), c0 = cur()!
    const c = addRoom(poly, fmt(t.roomN, { n: c0.plan.rooms.length + 1 }))
    const id = newId(c0.full, 'room')
    c.data = { ...c.data, id, ...levelField(c0.full, c0.lvId) }
    if (st.edit([c], { select: { type: 'room', id } })) { st.setRoomPoly(null); st.showToast(fmt(t.roomAdded, { a: (polygonArea(poly) / 1e6).toFixed(1) })) }
  }
  const onDouble = (e: React.MouseEvent) => {
    if (dmode && !mini) { decorDouble(toPlan(local(e))); return }
    const st = S()
    if (st.tool === 'wall' || st.tool === 'beam') st.setDraw({ anchor: null, start: null })
    if (st.tool === 'room' && st.roomPoly && st.roomPoly.length >= 3) commitRoom(st.roomPoly)
  }

  // 问题针（同一处的摊开）和房间标签的排布：标签让开针、互不压字（canvas2d/labels）
  const pinQs = useMemo(() => plan && mode === 'original' ? plan.questions.filter(q => !q.answer || q.id === qOpen) : [], [plan, mode, qOpen])
  const pinMap = useMemo(() => plan ? pinPositions(plan, pinQs, xf.k) : new Map<string, Vec2>(), [plan, pinQs, xf.k])
  const diff = view?.diff
  // Agent 待确认提议的热点位置：先定下来，房间标签再让开它（选中这面墙时固定在尺寸胶囊的另一侧）
  const selKey1 = sel.length === 1 ? sel[0].id : ''
  const propSpots = useMemo(() => {
    const m = new Map<string, Vec2>()
    if (!plan || mini || mode === 'original' || mode === 'decor' || !diff) return m // 装修态不出提议热点（D6 B5）
    for (const c of diff.pending.filter(c => c.op === 'add' && c.type === 'opening')) {
      const s = spanOf(plan, c.data as unknown as Opening)
      if (!s) continue
      const off = s.wall.thickness / 2 + 34 / xf.k
      m.set(c.id, selKey1 === s.wall.id ? [s.center[0] + s.normal[0] * off, s.center[1] + s.normal[1] * off] : awayFromLabels(plan, s.center, s.normal, off))
    }
    return m
  }, [plan, mini, mode, diff, xf.k, selKey1])
  const pinList = useMemo(() => [...pinMap.values(), ...propSpots.values()], [pinMap, propSpots])
  const roomLabels = useMemo(() => {
    if (!plan || mini) return null
    const tagged = new Set(mode === 'compare' && diff ? plan.rooms.filter(r => diff.modified.has(r.id)).map(r => r.id) : [])
    // 选中墙 / 梁时沿构件画的墨色尺寸胶囊也要让开（见 PlanLayers SelectionDims）
    const blocks: { c: Vec2; r: number }[] = []
    const one = sel.length === 1 ? sel[0] : null
    const w = one?.type === 'wall' ? plan.walls.find(x => x.id === one.id) : one?.type === 'beam' ? plan.beams.find(x => x.id === one.id) : undefined
    if (w) {
      const isWall = 'thickness' in w, L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), n = wallNormal(w)
      const m: Vec2 = isWall ? pointAt(w as Wall, wallLength(w as Wall) / 2) : mid(w.a, w.b), off = (isWall ? (w as Wall).thickness : (w as Beam).width) / 2 + 22 / xf.k
      blocks.push({ c: [m[0] - n[0] * off, m[1] - n[1] * off], r: (`${fmtLen(L)} m`.length * 6.6 + 12) / 2 + 4 })
    }
    return layoutRoomLabels(plan, xf.k, { pins: pinList, sqm: t.sqm, ceilLabel: lang === 'zh' ? '层高' : 'H', tagged, blocks })
  }, [plan, xf.k, pinList, mini, mode, diff, lang, t.sqm, sel])

  // 其他楼层：淡显墙体轮廓，对位用（图层里可关）
  const otherLevels = useMemo(() => {
    if (!fullPlan || !multi || mini || !layers.otherLevels) return []
    return levelsOf(fullPlan).filter(l => l.id !== lvId).map(l => { try { return { id: l.id, d: multiPolyPath(wallOutlines(fullPlan, l.id)) } } catch { return { id: l.id, d: '' } } })
  }, [fullPlan, multi, mini, layers.otherLevels, lvId])
  // 测距：⌥ 悬停（起点 = 最后选中的墙）或检查器「测距」按钮选的第二面墙
  const mPair: [string, string] | null = measure?.to ? [measure.from, measure.to] : alt && altTarget && lastWall(sel) && altTarget !== lastWall(sel) ? [lastWall(sel)!, altTarget] : null
  const measured = useMemo(() => {
    if (!plan || !mPair || mini) return null
    try { return { m: measureWalls(plan, mPair[0], mPair[1]), a: plan.walls.find(w => w.id === mPair[0])!, b: plan.walls.find(w => w.id === mPair[1])! } } catch { return null }
  }, [plan, mPair?.[0], mPair?.[1], mini])

  // 装修层（装修态才画）：地面材料、柜子、造型在墙下；家具、嵌入、色带、选中在门窗上
  const decorLayers = (() => {
    if (!dmode || !plan || !view) return null
    // 没有装修层时悬停风格：用 core createDecor 临时生成一份来画，不写进数据（D6 A1）
    const decor = shownDecor(baseDecor, dPreview)
    if (!decor) return null
    const dplan = decorPlanOf(plan, decor)
    const issues = decorIssues(dplan, view.base)
    const styleId = dPreview ?? decor.style
    const props = { plan: dplan, base: basePlan!, decor, k: xf.k, pid, styleId, keep: dPreview ? dKeep : true, sel: dSel, hover: dHover, issues, mini, focusFace: mini && dCanvas.k !== 'plan' ? dCanvas.face : null }
    const dragF = dDragging && !dDragging.startsWith('cab:') ? decor.furniture.find(f => f.id === dDragging) : null
    const drag = dragF ? <DragClearance cl={clearances(dplan, decor, dragF)} k={xf.k} /> : dDragging?.startsWith('cab:') ? <CabinetDraft plan={dplan} spec={dDragging} k={xf.k} family={dFamily} /> : undefined
    return { under: <DecorUnder {...props} />, over: <DecorOver {...props} drag={drag} />, issues, dplan }
  })()

  if (!view || !plan) return <div ref={box} className="absolute inset-0" />

  const u = plan.underlay
  const showUnderlay = !!u && u.visible && !!imgSize
  const certainty = layers.certainty || panel === 'questions' || !!qOpen
  const gridStep = xf.k * 1000 >= 36 ? 1000 : 2000
  const gs = gridStep * xf.k
  const drawing = !mini && editable && (tool === 'wall' || tool === 'beam' || (tool === 'room' && !!roomPoly))
  const sx = u ? (u.flipX ? -1 : 1) * u.mmPerPx : 1, sy = u ? (u.flipY ? -1 : 1) * (u.mmPerPxY ?? u.mmPerPx) : 1

  return (
    <div ref={box} data-canvas={mini ? 'mini' : 'main'}
      className={cn('absolute inset-0 touch-none select-none overflow-hidden', !mini && dmode && dTool !== 'select' ? 'cursor-crosshair' : !mini && tool !== 'select' && tool !== 'underlay' ? 'cursor-crosshair' : tool === 'underlay' && !calib ? 'cursor-move' : 'cursor-default')}
      style={mini ? undefined : {
        backgroundImage: `radial-gradient(circle at 1px 1px, rgb(22 27 36 / 0.13) 1px, transparent 1.3px)`,
        backgroundSize: `${gs}px ${gs}px`,
        backgroundPosition: `${xf.x - 1}px ${xf.y - 1}px`,
      }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDouble}
      onPointerLeave={() => { if (!g.current) { S().setHover(null); setPreview(null) } }}>
      <svg width="100%" height="100%" className="absolute inset-0 block" style={{ fontFamily: 'var(--font-sans)' }}>
        <Defs pid={pid} />
        <g transform={`translate(${xf.x} ${xf.y}) scale(${xf.k})`}>
          {showUnderlay && u && imgSize && (
            <g opacity={u.opacity / 100} transform={`matrix(${sx} 0 0 ${sy} ${-u.origin[0] * sx} ${-u.origin[1] * sy})`}>
              <image href={href} x={0} y={0} width={imgSize[0]} height={imgSize[1]} preserveAspectRatio="none" pointerEvents="none" />
            </g>
          )}
          <g opacity={showUnderlay ? 0.82 : 1}>
            <PlanLayers plan={plan} base={basePlan!} diff={view.diff} hideSelDims={!!measured} mode={mode} k={xf.k} pid={pid} sel={dmode ? NO_SEL : sel} hover={dmode ? null : hover}
              decorUnder={decorLayers?.under} decorOver={decorLayers?.over}
              layers={layers} mini={mini} certainty={certainty} lang={lang}
              labels={{ sqm: t.sqm, ceiling: lang === 'zh' ? '层高' : 'H', entry: lang === 'zh' ? '入户' : 'IN', platform: t.prop.floorOffset }} roomLabels={roomLabels} pins={pinList} />
          </g>
          {!mini && tool === 'opening' && preview?.opening && <OpeningPreview plan={plan} o={preview.opening} k={xf.k} />}
          {!mini && tool === 'opening' && preview?.error && preview.at && <circle cx={preview.at[0]} cy={preview.at[1]} r={px(7)} fill="rgb(232 96 79 / 0.2)" stroke={C.coral500} strokeWidth={px(1.6)} pointerEvents="none" />}
          {/* 其他楼层：墙体轮廓淡显在上面（虚线 + 极淡填充），对位用，不接收点击 */}
          {otherLevels.map(o => <path key={'lv-' + o.id} d={o.d} fill="rgb(22 25 30 / 0.05)" stroke="rgb(22 25 30 / 0.34)" strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} pointerEvents="none" data-other-level={o.id} />)}
          {!mini && editable && (tool === 'shaft' || tool === 'stair' || tool === 'void' || tool === 'column') && <RectOverlay k={xf.k} tool={tool} anchor={draw.anchor} cursor={draw.cursor} />}
          {measured && <MeasureOverlay k={xf.k} m={measured.m} a={measured.a} b={measured.b} t={t} onCopy={v => { void navigator.clipboard?.writeText(String(v)).catch(() => {}); S().showToast(fmt(t.s2a.measure.copied, { v: fmtMm(v) })) }} />}
          {drawing && <DrawOverlay k={xf.k} tool={tool} anchor={tool === 'room' ? roomPoly![roomPoly!.length - 1] : draw.anchor} cursor={draw.cursor} snapKind={snapKind} lang={lang} poly={tool === 'room' ? roomPoly : null} />}
          {!mini && draw.cursor && tool === 'select' && <circle cx={draw.cursor[0]} cy={draw.cursor[1]} r={px(snapKind === 'none' ? 0 : 8)} fill="rgb(85 211 165 / 0.18)" stroke={C.mint500} strokeWidth={px(2)} pointerEvents="none" />}
          {!mini && calib && calib.map((q, i) => (
            <g key={i} pointerEvents="none">
              <circle cx={q[0]} cy={q[1]} r={px(7)} fill="#fff" stroke={C.lav500} strokeWidth={px(2.4)} />
              <text x={q[0] + px(10)} y={q[1] - px(10)} fontSize={px(11)} fontWeight={700} fill={C.lav500}>{i + 1}</text>
            </g>
          ))}
          {!mini && calib?.length === 2 && <path d={`M${calib[0][0]} ${calib[0][1]}L${calib[1][0]} ${calib[1][1]}`} stroke={C.lav500} strokeWidth={px(1.6)} strokeDasharray={`${px(5)} ${px(4)}`} pointerEvents="none" />}
        </g>
      </svg>
      {!mini && <Pins xf={xf} plan={plan} pinMap={pinMap} propSpots={propSpots} roomLabels={roomLabels} />}
      {!mini && decorLayers && <DecorPins xf={xf} plan={decorLayers.dplan} issues={decorLayers.issues} />}
    </div>
  )
}

const fmtMm = (v: number) => Math.round(v).toLocaleString('en-US')
const lastWall = (sel: Ref[]) => [...sel].reverse().find(r => r.type === 'wall')?.id
const rectFrom = (a: Vec2, b: Vec2): [number, number, number, number] | null => {
  const r: [number, number, number, number] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]
  return r[2] - r[0] >= 100 && r[3] - r[1] >= 100 ? r : null
}
const rectPoly = (r: [number, number, number, number]): Vec2[] => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]

/**
 * 管道井 / 楼梯 / 挑空：两点拉出的矩形 → Change。楼梯沿长边从第一下那头往上走，通到上一层，
 * 同时在上一层同一位置开一个楼梯洞（挑空），两条记录同组（撤销、清单一起处理）。
 */
function extraFromRect(full: Plan, lvId: string, tool: 'shaft' | 'stair' | 'void', a: Vec2, b: Vec2): { changes: Change[]; select: Ref } | { error: string } {
  const r = rectFrom(a, b)!
  const poly = rectPoly(r), lf = levelField(full, lvId)
  const zh = useStore.getState().lang === 'zh'
  if (tool === 'shaft') { const c = addElement(full, 'shaft', { ...lf, poly, kind: 'pipe' }); return { changes: [c], select: { type: 'shaft', id: (c.data as { id: string }).id } } }
  if (tool === 'void') { const c = addElement(full, 'void', { level: lvId, poly }); return { changes: [c], select: { type: 'void', id: (c.data as { id: string }).id } } }
  const levels = [...levelsOf(full)].sort((x, y) => x.elevation - y.elevation), here = levels.find(l => l.id === lvId)!
  const up = levels.find(l => l.elevation > here.elevation)
  if (!up) return { error: zh ? '楼梯要通到上一层：先在「更多结构」里新建楼层' : 'A stair needs a floor above: add one under “More structure”' }
  const w = r[2] - r[0], h = r[3] - r[1], horizontal = w >= h
  const cy = (r[1] + r[3]) / 2, cx = (r[0] + r[2]) / 2
  const path: Vec2[] = horizontal
    ? (a[0] <= b[0] ? [[r[0], cy], [r[2], cy]] : [[r[2], cy], [r[0], cy]])
    : (a[1] <= b[1] ? [[cx, r[1]], [cx, r[3]]] : [[cx, r[3]], [cx, r[1]]])
  const c1 = addElement(full, 'stair', { level: lvId, to: up.id, poly, path, width: horizontal ? h : w, kind: 'straight' })
  const p2 = { ...full, changes: [...full.changes, c1] }
  const c2 = addElement(p2, 'void', { level: up.id, poly, name: zh ? '楼梯洞' : 'Stair opening' })
  const group = newId({ ...p2, changes: [...p2.changes, c2] }, 'stairs')
  return { changes: [{ ...c1, group }, { ...c2, group }], select: { type: 'stair', id: (c1.data as { id: string }).id } }
}

/* ───────── 管道井 / 楼梯 / 挑空：两点拉矩形；柱：光标处的预览 ───────── */
function RectOverlay({ k, tool, anchor, cursor }: { k: number; tool: string; anchor: Vec2 | null; cursor: Vec2 | null }) {
  if (!cursor) return null
  const px = (v: number) => v / k
  if (tool === 'column') return <rect x={cursor[0] - 200} y={cursor[1] - 200} width={400} height={400} fill="rgb(85 211 165 / 0.4)" stroke={C.mint700} strokeWidth={px(1.4)} strokeDasharray={`${px(4)} ${px(3)}`} pointerEvents="none" />
  if (!anchor) return <circle cx={cursor[0]} cy={cursor[1]} r={px(5)} fill="#fff" stroke={C.mint500} strokeWidth={px(2)} pointerEvents="none" />
  const r = [Math.min(anchor[0], cursor[0]), Math.min(anchor[1], cursor[1]), Math.max(anchor[0], cursor[0]), Math.max(anchor[1], cursor[1])]
  const W = r[2] - r[0], H = r[3] - r[1]
  return (
    <g pointerEvents="none">
      <rect x={r[0]} y={r[1]} width={W} height={H} fill="rgb(85 211 165 / 0.16)" stroke={C.mint500} strokeWidth={px(1.6)} strokeDasharray={`${px(5)} ${px(4)}`} />
      <circle cx={anchor[0]} cy={anchor[1]} r={px(5)} fill="#fff" stroke={C.mint500} strokeWidth={px(2)} />
      <g transform={`translate(${cursor[0] + px(14)} ${cursor[1] + px(22)})`}>
        <rect x={0} y={px(-11)} width={px(98)} height={px(22)} rx={px(11)} fill={C.ink} />
        <text x={px(10)} y={px(4)} fontSize={px(11)} fontWeight={600} fill={C.mint300} className="num">{fmtLen(W)} × {fmtLen(H)} m</text>
      </g>
    </g>
  )
}

/* ───────── 测距（docs/specs/测距.md）：洋红标注线、两端短竖线、延长虚线、胶囊（点了复制） ───────── */
function MeasureOverlay({ k, m, a, b, t, onCopy }: { k: number; m: WallMeasurement; a: Wall; b: Wall; t: ReturnType<typeof useT>; onCopy(v: number): void }) {
  const px = (v: number) => v / k
  const col = C.magenta500
  const faces = [a, b].map(w => <path key={w.id} d={polyPath(wallFootprint(w))} fill="rgb(214 51 160 / 0.08)" stroke={col} strokeWidth={px(1.2)} />)
  if (m.intersect) {
    const c = mid(pointAt(a, wallLength(a) / 2), pointAt(b, wallLength(b) / 2))
    return <g pointerEvents="none" data-measure="intersect">{faces}<Capsule at={c} k={k} text={t.s2a.measure.intersect} /></g>
  }
  return (
    <g data-measure="on">
      <g pointerEvents="none">{faces}</g>
      {m.segments.map((sg, i) => {
        const v = sg.kind === 'dx' ? m.dx! : sg.kind === 'dy' ? m.dy! : sg.kind === 'normal' ? m.normal! : m.nearest!
        const cl = m.centerline?.[sg.kind]
        const L = Math.max(1e-6, len2(sg.a, sg.b)), u: Vec2 = [(sg.b[0] - sg.a[0]) / L, (sg.b[1] - sg.a[1]) / L], n: Vec2 = [-u[1], u[0]]
        const tick = (p: Vec2) => `M${p[0] - n[0] * px(6)} ${p[1] - n[1] * px(6)}L${p[0] + n[0] * px(6)} ${p[1] + n[1] * px(6)}`
        const sub = sg.kind === 'nearest' ? `Δx ${fmtMm(m.dx ?? 0)} · Δy ${fmtMm(m.dy ?? 0)}` : undefined
        return (
          <g key={i}>
            <g pointerEvents="none">
              {sg.extensions.map((e, j) => <path key={j} d={`M${e.a[0]} ${e.a[1]}L${e.b[0]} ${e.b[1]}`} stroke={col} strokeWidth={px(1)} strokeDasharray={`${px(3)} ${px(3)}`} />)}
              <path d={`M${sg.a[0]} ${sg.a[1]}L${sg.b[0]} ${sg.b[1]}`} stroke={col} strokeWidth={px(1.5)} />
              <path d={tick(sg.a) + tick(sg.b)} stroke={col} strokeWidth={px(1.5)} strokeLinecap="round" />
            </g>
            <Capsule at={mid(sg.a, sg.b)} k={k} text={fmtMm(v)} sub={sub} value={v} title={cl !== undefined ? `${t.s2a.measure.clear} ${fmtMm(v)} mm · ${fmt(t.s2a.measure.center, { v: fmtMm(cl) })} mm` : undefined} onCopy={() => onCopy(Math.round(v))} />
          </g>
        )
      })}
    </g>
  )
}
function Capsule({ at, k, text, sub, value, title, onCopy }: { at: Vec2; k: number; text: string; sub?: string; value?: number; title?: string; onCopy?(): void }) {
  const px = (v: number) => v / k
  const w = px(text.length * 7.6 + 18), sw = sub ? px(sub.length * 5.6 + 14) : 0
  return (
    <g transform={`translate(${at[0]} ${at[1]})`} data-measure-value={value !== undefined ? Math.round(value) : undefined} style={{ cursor: onCopy ? 'copy' : undefined }}
      onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onCopy?.() }}>
      {title && <title>{title}</title>}
      <rect x={-w / 2} y={px(-11)} width={w} height={px(22)} rx={px(11)} fill={C.magenta500} stroke="#fff" strokeWidth={px(1.5)} />
      <text y={px(4.2)} fontSize={px(12)} fontWeight={700} textAnchor="middle" fill="#fff" className="num">{text}</text>
      {sub && <g transform={`translate(0 ${px(22)})`}><rect x={-sw / 2} y={px(-8)} width={sw} height={px(16)} rx={px(8)} fill="#fff" stroke={C.magenta500} strokeWidth={px(1)} /><text y={px(3.4)} fontSize={px(9.5)} fontWeight={650} textAnchor="middle" fill={C.magenta700} className="num">{sub}</text></g>}
    </g>
  )
}

const clampK = (k: number) => Math.min(1.2, Math.max(0.012, k))

/* ───────── 门窗工具：悬停预览 ───────── */
function OpeningPreview({ plan, o, k }: { plan: Plan; o: Opening; k: number }) {
  const s = spanOf(plan, o)
  if (!s) return null
  const r = segmentRect(s.wall, o.offset, o.offset + o.width, s.wall.thickness + 60 / 1)
  return (
    <g pointerEvents="none">
      <path d={polyPath(r)} fill="rgb(85 211 165 / 0.42)" stroke={C.mint700} strokeWidth={1.6 / k} strokeDasharray={`${5 / k} ${3 / k}`} />
      <path d={`M${s.a[0]} ${s.a[1]}L${s.b[0]} ${s.b[1]}`} stroke={C.mint700} strokeWidth={2 / k} />
    </g>
  )
}

/* ───────── 画墙 / 画梁 / 描房间：吸附点 + 橡皮筋 + 长度 ───────── */
function DrawOverlay({ k, tool, anchor, cursor, snapKind, lang, poly }: { k: number; tool: string; anchor: Vec2 | null; cursor: Vec2 | null; snapKind: SnapResult['kind']; lang: string; poly: Vec2[] | null }) {
  if (!cursor && !poly) return null
  const px = (v: number) => v / k
  const names: Record<string, [string, string]> = { endpoint: ['端点', 'Endpoint'], wall: ['墙中线', 'On wall'], opening: ['洞口端', 'Opening'], grid: ['网格', 'Grid'], angle: ['角度', 'Angle'], none: ['', ''] }
  const label = names[snapKind]?.[lang === 'zh' ? 0 : 1]
  const L = anchor && cursor ? len2(anchor, cursor) : 0
  const thick = tool === 'beam' ? DEFAULTS.beam.width : DEFAULTS.thickness.partition
  const ghost = anchor && cursor && L > 1 ? segmentRect({ id: 'ghost', a: anchor, b: cursor, thickness: thick, kind: 'partition' }, 0, L) : null
  return (
    <g pointerEvents="none">
      {poly && poly.length > 0 && <path d={polyPath(cursor ? [...poly, cursor] : poly, false)} fill="rgb(85 211 165 / 0.12)" stroke={C.mint500} strokeWidth={px(1.6)} strokeDasharray={`${px(5)} ${px(4)}`} />}
      {poly?.map((q, i) => <circle key={i} cx={q[0]} cy={q[1]} r={px(i ? 3.5 : 6)} fill="#fff" stroke={C.mint500} strokeWidth={px(2)} />)}
      {ghost && !poly && <path d={polyPath(ghost)} fill={tool === 'beam' ? 'rgb(22 25 30 / 0.06)' : 'rgb(85 211 165 / 0.35)'} stroke={C.mint500} strokeWidth={px(1.4)} strokeDasharray={`${px(5)} ${px(4)}`} />}
      {anchor && !poly && <circle cx={anchor[0]} cy={anchor[1]} r={px(5)} fill="#fff" stroke={C.mint500} strokeWidth={px(2)} />}
      {cursor && <>
        <circle cx={cursor[0]} cy={cursor[1]} r={px(snapKind === 'none' ? 3 : 8)} fill={snapKind === 'none' ? C.ink : 'rgb(85 211 165 / 0.18)'} stroke={C.mint500} strokeWidth={px(snapKind === 'none' ? 0 : 2)} />
        {snapKind !== 'none' && <circle cx={cursor[0]} cy={cursor[1]} r={px(2.4)} fill={C.mint700} />}
        {(label || L > 1) && (
          <g transform={`translate(${cursor[0] + px(14)} ${cursor[1] + px(22)})`}>
            <rect x={0} y={px(-11)} width={px((L > 1 ? 52 : 0) + (label ? label.length * 12 + 18 : 10))} height={px(22)} rx={px(11)} fill={C.ink} />
            <text x={px(10)} y={px(4)} fontSize={px(11)} fontWeight={600} fill="#fff">
              {label}{L > 1 ? <tspan className="num" dx={label ? px(6) : 0} fill={C.mint300}>{fmtLen(L)} m</tspan> : null}
            </text>
          </g>
        )}
      </>}
    </g>
  )
}

/* ───────── HTML 覆盖层：问题针、锁、Agent 提议 ───────── */
function Pins({ xf, plan: levelPlan, pinMap, propSpots, roomLabels }: { xf: Xf; plan: Plan; pinMap: Map<string, Vec2>; propSpots: Map<string, Vec2>; roomLabels: Map<string, RoomLabelLayout> | null }) {
  const view = useView()
  const mode = useStore(s => s.mode), qOpen = useStore(s => s.qOpen), sel = useStore(s => s.sel), hover = useStore(s => s.hover)
  const { openQuestion, select } = useStore.getState()
  const placed = useMemo(() => view, [view])
  if (!placed) return null
  const { diff } = placed, plan = levelPlan
  const S = (p: Vec2) => ({ left: xf.x + p[0] * xf.k, top: xf.y + p[1] * xf.k })
  const qs = mode === 'original' ? plan.questions.filter(q => !q.answer || q.id === qOpen) : []
  const focusIds = new Set([...sel.map(s => s.id), hover?.id].filter(Boolean) as string[])
  const locks = mode !== 'original'
    ? plan.walls.filter(w => isProtectedWall(w) && focusIds.has(w.id)).map(w => ({ id: w.id, p: pointAt(w, wallLength(w) * 0.2), n: wallNormal(w), t: w.thickness }))
    : []
  const proposals = mode !== 'original' && mode !== 'decor' && diff ? diff.pending.filter(c => c.op === 'add' && c.type === 'opening') : []

  return (
    <div className="pointer-events-none absolute inset-0">
      <AnimatePresence>
        {qs.map((q, i) => {
          if (!q.bbox) return null
          const c: Vec2 = pinMap.get(q.id) ?? [(q.bbox[0] + q.bbox[2]) / 2, (q.bbox[1] + q.bbox[3]) / 2]
          const done = !!q.answer, open = qOpen === q.id
          return (
            <motion.div key={q.id} className="pointer-events-auto absolute" style={{ ...S(c), x: '-50%', y: '-50%' }}
              initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1, transition: { delay: 0.15 + i * 0.06, type: 'spring', stiffness: 500, damping: 24 } }} exit={{ opacity: 0, scale: 0.6 }}>
              {done
                ? <button onClick={() => openQuestion(q.id)} onPointerDown={e => e.stopPropagation()} className={cn('grid size-6 place-items-center rounded-full bg-white/90 text-mint-700 shadow-[0_4px_10px_-4px_rgb(0_0_0/0.3)] ring-1 ring-ink-900/5 transition hover:scale-110', open && 'ring-2 ring-ink-900')}><Check size={13} strokeWidth={3} /></button>
                : <span onPointerDown={e => e.stopPropagation()}><Hotspot tone="lemon" active={open} pulse={!open && !qOpen} icon={<CircleQuestionMark size={18} strokeWidth={2.2} />} label={q.text} onClick={() => openQuestion(open ? null : q.id)} size={40} /></span>}
            </motion.div>
          )
        })}
        {locks.map(l => (
          <motion.div key={`lock-${l.id}`} className="absolute" style={{ ...S(awayFromLabels(plan, l.p, l.n, l.t / 2 + 26 / xf.k, roomLabels)), x: '-50%', y: '-50%' }}
            initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.5 }} transition={{ type: 'spring', stiffness: 520, damping: 26 }}>
            <span className="grid size-7 place-items-center rounded-full bg-white text-ink-800 shadow-[0_6px_14px_-6px_rgb(0_0_0/0.35)] ring-1 ring-ink-900/5"><Lock size={13} strokeWidth={2.4} /></span>
          </motion.div>
        ))}
        {proposals.map(c => {
          const o = c.data as unknown as Opening
          const s = spanOf(plan, o)
          if (!s) return null
          const at: Vec2 = propSpots.get(c.id) ?? awayFromLabels(plan, s.center, s.normal, s.wall.thickness / 2 + 34 / xf.k, roomLabels)
          return (
            <motion.div key={`pp-${c.id}`} className="pointer-events-auto absolute" style={{ ...S(at), x: '-50%', y: '-50%' }} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
              <span onPointerDown={e => e.stopPropagation()}><Hotspot tone="lav" icon={<Sparkles size={16} strokeWidth={2.2} />} plus={false} size={36} label={c.note} active={sel.some(r => r.id === s.wall.id)}
                onClick={() => select({ type: 'wall', id: s.wall.id })} /></span>
            </motion.div>
          )
        })}
      </AnimatePresence>
      {qOpen && <QuestionAnchor xf={xf} />}
    </div>
  )
}

/** 墙两侧各取一个点，选离房间标签远的那个，热点不压字 */
function awayFromLabels(plan: Plan, c: Vec2, n: Vec2, off: number, laid?: Map<string, RoomLabelLayout> | null): Vec2 {
  const cands: Vec2[] = [1, -1].map(d => [c[0] + n[0] * off * d, c[1] + n[1] * off * d])
  const labels = plan.rooms.map(r => laid?.get(r.id)?.at ?? labelPoint(r.poly))
  if (!labels.length) return cands[0]
  const room = (p: Vec2) => Math.min(...labels.map(l => len2(l, p)))
  return room(cands[0]) >= room(cands[1]) ? cands[0] : cands[1]
}

/** 问题卡在桌面端钉在针旁边：这里只算位置，内容由 QuestionCard 渲染 */
function QuestionAnchor({ xf }: { xf: Xf }) {
  const view = useView(), qOpen = useStore(s => s.qOpen)
  const q = view?.plan.questions.find(q => q.id === qOpen)
  useEffect(() => {
    // 没有位置的问题（比如简版的「窗户没读出来」）：清掉上一张卡的锚点，问题卡回到画面中间
    if (!q?.bbox) { if (q) window.dispatchEvent(new CustomEvent('q-anchor', { detail: null })); return }
    const c: Vec2 = [(q.bbox[0] + q.bbox[2]) / 2, (q.bbox[1] + q.bbox[3]) / 2]
    window.dispatchEvent(new CustomEvent('q-anchor', { detail: { x: xf.x + c[0] * xf.k, y: xf.y + c[1] * xf.k } }))
  })
  return null
}
