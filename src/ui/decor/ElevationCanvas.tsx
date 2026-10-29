/**
 * 墙面立面编辑器（装修 2D 的主力，样张 03 / 04）：主画布换成这面墙的立面，画中画换成平面。
 * 选择：点选、拖四边改尺寸、拖动换位置（吸附梁底、顶面、门窗洞底洞顶、墙两端）；
 * 造型 / 挖 / 柜子：在墙上拖一个框；柜体编辑：点格子、拖竖线改列宽。
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Vec2 } from '@/core/types'
import type { Cabinet } from '@/core/decor/types'
import { layoutCabinet } from '@/core/decor/cabinets'
import { useStore } from '../store'
import { freeRect, useIsMobile } from '../layout'
import { C } from '../canvas2d/style'
import { useDecor, type DSel } from './dstore'
import { decorIssues, useDecorPlan, findItem } from './model'
import { elevationModel, type ElevModel } from './elev-model'
import { ElevDefs, ElevDrawing, Pill, rectOfSel, X, Y, type Frame } from './ElevDrawing'
import { addCabinet, addCut, addPanel, paintFace, patchCabinet, patchPanel, patchRecess, patchFurniture } from './actions'

type Drag =
  | { kind: 'pan'; sx: number; sy: number; tx: number; ty: number; moved: boolean }
  | { kind: 'rect'; sx: number; sy: number; a: Vec2; b: Vec2; moved: boolean; tool: 'panel' | 'cut' | 'cabinet' }
  | { kind: 'edit'; sx: number; sy: number; sel: DSel; handle: 'body' | 'l' | 'r' | 't' | 'b'; start: { u: [number, number]; z: [number, number] }; a: Vec2; moved: boolean }
  | { kind: 'divider'; sx: number; sy: number; cab: string; col: number; start: number[]; a: Vec2; moved: boolean }

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

/** 吸附候选：墙两端、门窗洞底洞顶、梁底、顶面、其他构件的边、墙面中线 */
function snapZ(m: ElevModel, z: number, tolM: number, skip?: string): { z: number; label?: string } {
  const c: { z: number; label: string }[] = [{ z: 0, label: '地面' }, { z: m.H, label: `顶面 ${m.H.toFixed(2)}` }]
  for (const b of m.beams) c.push({ z: b.bottom, label: `梁底 ${b.bottom.toFixed(2)}` })
  for (const o of m.openings) { c.push({ z: o.o.sill, label: `洞底 ${o.o.sill.toFixed(2)}` }); c.push({ z: o.o.head, label: `洞顶 ${o.o.head.toFixed(2)}` }) }
  for (const x of m.cabinets) if (x.c.id !== skip) { c.push({ z: x.c.z[1], label: `${x.c.name ?? '柜'}顶 ${x.c.z[1].toFixed(2)}` }) }
  const best = c.filter(x => Math.abs(x.z - z) < tolM).sort((a, b) => Math.abs(a.z - z) - Math.abs(b.z - z))[0]
  return best ? { z: best.z, label: best.label } : { z }
}
function snapU(m: ElevModel, u: number, tol: number, skip?: string): { u: number; label?: string } {
  const c: { u: number; label: string }[] = [{ u: m.u[0], label: '墙端' }, { u: m.u[1], label: '墙端' }, { u: (m.u[0] + m.u[1]) / 2, label: '墙面中线' }]
  for (const o of m.openings) { c.push({ u: o.u[0], label: '洞口边' }); c.push({ u: o.u[1], label: '洞口边' }) }
  for (const x of m.cabinets) if (x.c.id !== skip) { c.push({ u: x.u0, label: '柜边' }); c.push({ u: x.u0 + x.c.width, label: '柜边' }) }
  for (const x of m.panels) if (x.p.id !== skip) { c.push({ u: x.u0, label: '造型边' }); c.push({ u: x.u0 + x.geo.rect.u[1], label: '造型边' }) }
  for (const sg of m.segments) { c.push({ u: sg.u[0], label: '房间分界' }); c.push({ u: sg.u[1], label: '房间分界' }) }
  const best = c.filter(x => Math.abs(x.u - u) < tol).sort((a, b) => Math.abs(a.u - u) - Math.abs(b.u - u))[0]
  return best ? { u: best.u, label: best.label } : { u: Math.round(u / 10) * 10 }
}

export function ElevationCanvas() {
  const id = 'e' + useId().replace(/[:«»]/g, '')
  const dp = useDecorPlan()
  const canvas = useDecor(s => s.canvas), sel = useDecor(s => s.sel), hover = useDecor(s => s.hover), tool = useDecor(s => s.tool), preview = useDecor(s => s.preview)
  const fitNonce = useStore(s => s.fitNonce)
  const mobile = useIsMobile()
  const box = useRef<HTMLDivElement>(null)
  const size = useSize(box)
  const [F, setF] = useState<Frame>({ k: 0.1, tx: 0, ty: 0 })
  const [draft, setDraft] = useState<{ a: Vec2; b: Vec2; tool: string } | null>(null)
  const [snapLbl, setSnapLbl] = useState<{ text: string; u: number; z: number } | null>(null)
  const drag = useRef<Drag | null>(null)
  const face = canvas.k !== 'plan' ? canvas.face : null
  const m = useMemo(() => dp && face ? elevationModel(dp.plan, dp.base, dp.decor, face) : null, [dp, face?.wall, face?.side])
  const issues = useMemo(() => dp?.decor ? decorIssues(dp.plan, dp.base) : null, [dp])
  const cabId = canvas.k === 'cabinet' ? canvas.id : null
  const roomId = canvas.k !== 'plan' ? canvas.room : undefined

  // 取景：柜体编辑 = 这个柜子；立面 = 装修最多的那个房间段（另一段淡出），只有一段就整面墙
  const range = useMemo((): [number, number] | null => {
    if (!m) return null
    if (cabId) { const c = m.cabinets.find(x => x.c.id === cabId); if (c) return [c.u0 - 260, c.u0 + c.c.width + 260] }
    // 立面按房间分段（D6 A3）：从哪间房看就取景哪一段（core elevationOf 的 segments）；墙面只有这一间时整面墙
    const seg = roomId ? m.segments.find(sg => sg.room.id === roomId) : null
    if (seg && m.segments.length > 1) return [Math.max(m.u[0], seg.u[0]), Math.min(m.u[1], seg.u[1])]
    // 没指定房间：core 给的默认取景段（装修最多的那个房间段；只有一段就整面墙）
    if (m.focus[0] > m.u[0] + 10 || m.focus[1] < m.u[1] - 10) return [m.focus[0], m.focus[1]]
    return m.u
  }, [m, cabId, roomId])
  const fade: [number, number] | null = range && m && (range[0] > m.u[0] + 10 || range[1] < m.u[1] - 10) ? range : null

  const fit = useCallback(() => {
    if (!m || !range || !size.w) return
    const endL = m.ends.find(e => e.side === 'l')?.thickness ?? 0
    const wMm = range[1] - range[0] + (range[0] <= m.u[0] + 1 ? endL : 0) + 400
    const hMm = m.H * 1000 + 240
    const r = freeRect(size.w, size.h, mobile, wMm / hMm)
    const padL = 96, padB = 96, padT = 24
    const aw = r.x1 - r.x0 - padL - 24, ah = r.y1 - r.y0 - padB - padT
    const k = Math.min(aw / wMm, ah / hMm)
    const cx = r.x0 + padL + aw / 2, cy = r.y0 + padT + ah / 2
    const uc = (range[0] + range[1]) / 2 - (range[0] <= m.u[0] + 1 ? endL / 2 : 0)
    setF({ k, tx: cx - uc * k, ty: cy + (m.H * 1000 / 2) * k })
  }, [m?.face.wall, m?.face.side, range?.[0], range?.[1], size.w, size.h, mobile, cabId])
  // e2e：当前取景段（立面 u，只读）
  useEffect(() => { (window as unknown as Record<string, unknown>).__elevRange = range }, [range])
  useLayoutEffect(() => { fit() }, [fit, fitNonce])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top
      const mouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 40)
      if (e.ctrlKey || mouseWheel) { const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0018)); setF(v => { const k = Math.max(0.02, Math.min(2, v.k * f)); return { k, tx: sx - (sx - v.tx) * (k / v.k), ty: sy - (sy - v.ty) * (k / v.k) } }) }
      else setF(v => ({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY }))
    }
    const onZoom = (e: Event) => { const f = (e as CustomEvent<number>).detail; setF(v => { const cx = size.w / 2, cy = size.h / 2, k = Math.max(0.02, Math.min(2, v.k * f)); return { k, tx: cx - (cx - v.tx) * (k / v.k), ty: cy - (cy - v.ty) * (k / v.k) } }) }
    el.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('plan-zoom', onZoom)
    return () => { el.removeEventListener('wheel', onWheel); window.removeEventListener('plan-zoom', onZoom) }
  }, [size.w, size.h])

  // e2e / 演示用：立面坐标 → 屏幕坐标（只读）
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>
    w.__elev2screen = (u: number, z: number) => { const r = box.current!.getBoundingClientRect(); return [r.left + X(F, u), r.top + Y(F, z)] }
    w.__elevModel = m
    return () => { delete w.__elev2screen }
  }, [F, m])

  if (!dp || !m || !face) return <div ref={box} className="absolute inset-0" />
  const decor = dp.decor
  const styleId = preview ?? decor?.style ?? 'cream'
  const toE = (sx: number, sy: number): Vec2 => [(sx - F.tx) / F.k, (F.ty - sy) / F.k / 1000]
  const local = (e: { clientX: number; clientY: number }): Vec2 => { const r = box.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }

  /** 点到了什么：家电 → 洞 / 壁龛 → 柜子（柜体编辑里是格子）→ 造型 → 墙面 */
  const hitAt = (u: number, z: number): DSel | null => {
    const inR = (r: { u: [number, number]; z: [number, number] } | null) => !!r && u >= r.u[0] && u <= r.u[1] && z >= r.z[0] && z <= r.z[1]
    for (const f of m.furniture) if (f.held && inR({ u: f.u, z: f.z })) return { k: 'furniture', id: f.f.id }
    for (const r of decor?.recesses ?? []) if (inR(rectOfSel(m, decor, 'recess', r.id))) return { k: 'recess', id: r.id }
    for (const c of m.cabinets) {
      if (!inR({ u: [c.u0, c.u0 + c.c.width], z: c.c.z })) continue
      if (cabId === c.c.id) { const cell = c.L.cells.find(x => u >= c.u0 + x.u[0] && u <= c.u0 + x.u[1] && z >= x.z[0] && z <= x.z[1]); if (cell) return { k: 'cell', id: c.c.id, col: cell.column, row: cell.row } }
      return { k: 'cabinet', id: c.c.id }
    }
    for (const p of m.panels) if (inR(rectOfSel(m, decor, 'panel', p.p.id))) return { k: 'panel', id: p.p.id }
    if (u >= m.u[0] && u <= m.u[1] && z >= 0 && z <= m.H) return { k: 'face', face }
    return null
  }
  const handleAt = (s: Vec2): 'body' | 'l' | 'r' | 't' | 'b' | null => {
    if (!sel || !('id' in sel) || sel.k === 'cell') return null
    const r = rectOfSel(m, decor, sel.k, sel.id)
    if (!r) return null
    const x0 = X(F, r.u[0]), x1 = X(F, r.u[1]), y0 = Y(F, r.z[1]), y1 = Y(F, r.z[0]), t = 7
    const inY = s[1] > y0 - t && s[1] < y1 + t, inX = s[0] > x0 - t && s[0] < x1 + t
    if (inY && Math.abs(s[0] - x0) < t) return 'l'
    if (inY && Math.abs(s[0] - x1) < t) return 'r'
    if (inX && Math.abs(s[1] - y0) < t) return 't'
    if (inX && Math.abs(s[1] - y1) < t && r.z[0] > 0.01) return 'b'
    if (inX && inY) return 'body'
    return null
  }

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const s = local(e), a = toE(s[0], s[1])
    const ds = useDecor.getState()
    const divEl = (e.target as Element).closest?.('[data-elev=divider]') as HTMLElement | null
    if (divEl && cabId) {
      const c = decor?.cabinets.find(x => x.id === cabId)
      if (c) { drag.current = { kind: 'divider', sx: s[0], sy: s[1], cab: cabId, col: +divEl.dataset.col!, start: layoutCabinet(c).columns.map(x => x.width), a, moved: false }; return }
    }
    if (ds.tool === 'panel' || ds.tool === 'cut' || ds.tool === 'cabinet') {
      const tolU = 10 / F.k, tolZ = 10 / F.k / 1000
      const a2: Vec2 = [snapU(m, a[0], tolU).u, Math.round(snapZ(m, a[1], tolZ).z * 100) / 100]
      drag.current = { kind: 'rect', sx: s[0], sy: s[1], a: a2, b: a2, moved: false, tool: ds.tool }; return
    }
    if (ds.tool === 'select') {
      const h = handleAt(s)
      if (h && sel && 'id' in sel && sel.k !== 'cell') {
        const r = rectOfSel(m, decor, sel.k, sel.id)!
        drag.current = { kind: 'edit', sx: s[0], sy: s[1], sel, handle: h, start: { u: [...r.u], z: [...r.z] }, a, moved: false }
        return
      }
    }
    drag.current = { kind: 'pan', sx: s[0], sy: s[1], tx: F.tx, ty: F.ty, moved: false }
  }
  const onMove = (e: React.PointerEvent) => {
    const s = local(e), d = drag.current
    if (!d) {
      if (e.pointerType === 'mouse') {
        const h = useDecor.getState().tool === 'select' ? handleAt(s) : null
        box.current!.style.cursor = h === 'l' || h === 'r' ? 'ew-resize' : h === 't' || h === 'b' ? 'ns-resize' : h === 'body' ? 'move' : ''
        const ht = hitAt(...toE(s[0], s[1]))
        const key = (x: DSel | null) => !x ? '' : x.k === 'face' ? 'face' : x.k === 'cell' ? `c${x.col}${x.row}` : x.k + x.id
        if (key(ht) !== key(useDecor.getState().hover)) useDecor.getState().set({ hover: ht })
      }
      return
    }
    if (!d.moved && Math.hypot(s[0] - d.sx, s[1] - d.sy) < 4) return
    d.moved = true
    const b = toE(s[0], s[1])
    const tolU = 10 / F.k, tolZ = 10 / F.k / 1000
    if (d.kind === 'pan') { setF(v => ({ ...v, tx: d.tx + s[0] - d.sx, ty: d.ty + s[1] - d.sy })); return }
    if (d.kind === 'rect') {
      const su = snapU(m, b[0], tolU), sz = snapZ(m, b[1], tolZ)
      d.b = [su.u, Math.round(sz.z * 100) / 100]
      setDraft({ a: d.a, b: d.b, tool: d.tool })
      setSnapLbl(sz.label || su.label ? { text: [sz.label, su.label].filter(Boolean).join(' · '), u: d.b[0], z: d.b[1] } : null)
      return
    }
    if (d.kind === 'divider') {
      const c = decor?.cabinets.find(x => x.id === d.cab)
      if (!c) return
      // 改列宽：相邻两列一让一（Agent 和界面同一条规则），每列不小于 150
      const du = Math.round((b[0] - d.a[0]) / 10) * 10
      const w = [...d.start], i = d.col
      const left = Math.max(150, w[i - 1] + du), delta = left - w[i - 1], right = w[i] - delta
      if (right < 150) return
      w[i - 1] = left; w[i] = right
      patchCabinet(d.cab, cc => { cc.columns = cc.columns.map((col, j) => j === cc.columns.length - 1 ? { ...col, width: undefined } : { ...col, width: w[j] }) }, `col-${d.cab}`)
      return
    }
    if (d.kind === 'edit') {
      const r = { u: [...d.start.u] as [number, number], z: [...d.start.z] as [number, number] }
      const du = b[0] - d.a[0], dz = b[1] - d.a[1]
      let lbl: string | undefined
      const skip = 'id' in d.sel ? d.sel.id : undefined
      if (d.handle === 'body') {
        const su = snapU(m, r.u[0] + du, tolU, skip), su2 = snapU(m, r.u[1] + du, tolU, skip)
        const sh = su.label ? su.u - r.u[0] : su2.label ? su2.u - r.u[1] : Math.round(du / 10) * 10
        r.u = [r.u[0] + sh, r.u[1] + sh]; lbl = su.label ?? su2.label
        if (d.sel.k === 'recess') { const dzz = Math.round(dz * 100) / 100; r.z = [r.z[0] + dzz, r.z[1] + dzz] }
      } else if (d.handle === 'l' || d.handle === 'r') {
        const i = d.handle === 'l' ? 0 : 1, su = snapU(m, r.u[i] + du, tolU, skip)
        r.u[i] = su.u; lbl = su.label
        if (r.u[1] - r.u[0] < 100) return
      } else {
        const i = d.handle === 'b' ? 0 : 1, sz = snapZ(m, r.z[i] + dz, tolZ, skip)
        r.z[i] = Math.round(sz.z * 100) / 100; lbl = sz.label
        if (r.z[1] - r.z[0] < 0.1) return
      }
      setSnapLbl(lbl ? { text: lbl, u: d.handle === 'r' ? r.u[1] : d.handle === 'l' ? r.u[0] : (r.u[0] + r.u[1]) / 2, z: d.handle === 'b' ? r.z[0] : r.z[1] } : null)
      applyRect(d.sel, r, `edit-${skip}`)
    }
  }
  const applyRect = (sl: DSel, r: { u: [number, number]; z: [number, number] }, key: string) => {
    if (!('id' in sl) || !decor) return
    const ax = m.ax
    const sOf = (u: [number, number]): [number, number] => { const a = ax.toS(u[0]), b = ax.toS(u[1]); return [Math.round(Math.min(a, b)), Math.round(Math.max(a, b))] }
    if (sl.k === 'panel') patchPanel(sl.id, p => { if (p.span) p.span = { ...p.span, s: sOf(r.u), z: [Math.max(0, r.z[0]), Math.min(m.H, r.z[1])] } }, key)
    else if (sl.k === 'cabinet') patchCabinet(sl.id, c => {
      const ss = sOf(r.u), w = ss[1] - ss[0]
      if ('face' in c.place) c.place = { ...c.place, s: ss[0] }
      if (Math.abs(w - c.width) > 1) { rescaleColumns(c, w) }
      if (Math.abs(r.z[1] - c.z[1]) > 0.001 || Math.abs(r.z[0] - c.z[0]) > 0.001) { const dzTop = r.z[1] - c.z[1]; c.z = [r.z[0], r.z[1]]; growTopCells(c, dzTop) }
    }, key)
    else if (sl.k === 'recess') {
      const rc = decor.recesses.find(x => x.id === sl.id)
      if (!rc) return
      if ('panel' in rc.host) { const p = m.panels.find(x => x.p.id === (rc.host as { panel: string }).panel); if (p) patchRecess(sl.id, x => { x.rect = { u: [Math.round(r.u[0] - p.u0), Math.round(r.u[1] - p.u0)], z: r.z } }, key) }
      else patchRecess(sl.id, x => { x.rect = { s: sOf(r.u), z: r.z } }, key)
    } else if (sl.k === 'furniture') {
      const f = decor.furniture.find(x => x.id === sl.id)
      if (f) patchFurniture(sl.id, { z: r.z[0] }, key)
    }
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    setSnapLbl(null)
    const s = local(e), p = toE(s[0], s[1])
    const ds = useDecor.getState()
    if (d?.kind === 'rect') {
      setDraft(null)
      const u: [number, number] = [Math.min(d.a[0], d.b[0]), Math.max(d.a[0], d.b[0])], z: [number, number] = [Math.max(0, Math.min(d.a[1], d.b[1])), Math.min(m.H, Math.max(d.a[1], d.b[1]))]
      if (!d.moved || u[1] - u[0] < 80) { useStore.getState().showToast(d.tool === 'cabinet' ? '沿墙拖出柜子的宽度' : '在墙上拖一个框'); return }
      if (d.tool === 'panel') addPanel(face, [m.ax.toS(u[0]), m.ax.toS(u[1])], ds.panelKind === 'skirting' ? [0, 0.08] : z, ds.panelKind)
      else if (d.tool === 'cabinet') addCabinet(face, Math.min(m.ax.toS(u[0]), m.ax.toS(u[1])), Math.max(m.ax.toS(u[0]), m.ax.toS(u[1])), ds.cabFamily)
      else {
        // 挖：框在哪就挖在哪
        const cu = (u[0] + u[1]) / 2, cz = (z[0] + z[1]) / 2
        const pn = m.panels.find(x => cu >= x.u0 && cu <= x.u0 + x.geo.rect.u[1] && cz >= x.geo.rect.z[0] && cz <= x.geo.rect.z[1])
        const cb = m.cabinets.find(x => cu >= x.u0 && cu <= x.u0 + x.c.width && cz >= x.c.z[0] && cz <= x.c.z[1])
        if (cb) addCut(face, u, z, { cabinet: cb.c.id, u0: cb.u0, z0: cb.c.z[0] })
        else if (pn) addCut(face, [Math.max(u[0], pn.u0), Math.min(u[1], pn.u0 + pn.geo.rect.u[1])], [Math.max(z[0], pn.geo.rect.z[0]), Math.min(z[1], pn.geo.rect.z[1])], { panel: pn.p.id, u0: pn.u0 })
        else {
          const hit = m.openings.find(o => o.u[0] < u[1] && o.u[1] > u[0] && o.o.sill < z[1] && o.o.head > z[0])
          if (hit) { useStore.getState().showToast(`这里是${hit.o.kind.includes('window') ? '窗洞' : '门洞'}`); return }
          addCut(face, u, z, null)
        }
      }
      ds.set({ tool: 'select' })
      return
    }
    if (d && d.moved) return
    const hit = hitAt(p[0], p[1])
    if (ds.tool === 'material') {
      if (hit?.k === 'panel') patchPanel(hit.id, x => { x.material = ds.brush })
      else if (hit?.k === 'cabinet' || hit?.k === 'cell') patchCabinet(hit.id, c => { c.materials.front = ds.brush })
      else if (hit?.k === 'recess') patchRecess(hit.id, r => { r.back = ds.brush })
      else if (hit?.k === 'face') paintFace(face, ds.brush)
      return
    }
    ds.select(hit)
  }
  const onDouble = (e: React.MouseEvent) => {
    const s = local(e), p = toE(s[0], s[1]), hit = hitAt(p[0], p[1])
    if (hit?.k === 'cabinet') useDecor.getState().openCabinet(hit.id, face, roomId)
  }

  const dr = draft && { x: X(F, Math.min(draft.a[0], draft.b[0])), y: Y(F, Math.max(draft.a[1], draft.b[1])), w: Math.abs(draft.b[0] - draft.a[0]) * F.k, h: Math.abs(draft.b[1] - draft.a[1]) * 1000 * F.k }
  return (
    <div ref={box} data-canvas="elev" className={'absolute inset-0 touch-none select-none overflow-hidden ' + (tool !== 'select' ? 'cursor-crosshair' : '')}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDouble}
      onPointerLeave={() => { if (!drag.current) useDecor.getState().set({ hover: null }) }}>
      <svg width="100%" height="100%" className="absolute inset-0 block" style={{ fontFamily: 'var(--font-sans)' }}>
        <ElevDefs id={id} />
        {/* 立面只画取景框里的部分（左边留 90px 给高度尺寸）；右边还有墙时用蒙版淡出 */}
        {range && <clipPath id={`${id}-clip`}><rect x={X(F, range[0] - (range[0] <= m.u[0] + 1 ? (m.ends.find(e => e.side === 'l')?.thickness ?? 0) : 0)) - (cabId ? 70 : 110)} y={-4000} width={(range[1] - range[0] + 600) * F.k + (cabId ? 110 : 150)} height={12000} /></clipPath>}
        <g clipPath={range ? `url(#${id}-clip)` : undefined}>
          <ElevDrawing id={id} F={F} m={m} plan={dp.plan} decor={decor} styleId={styleId} sel={sel} hover={hover} issues={issues} dims cabEdit={cabId} fade={cabId ? null : fade} />
        </g>
        {dr && <g pointerEvents="none"><rect x={dr.x} y={dr.y} width={dr.w} height={dr.h} fill="rgb(85 211 165 / 0.14)" stroke={C.mint500} strokeWidth={1.6} strokeDasharray="5 3" />
          <Pill x={dr.x + dr.w / 2} y={dr.y + dr.h + 16} text={`${Math.round(dr.w / F.k).toLocaleString('en-US')} × ${(dr.h / F.k / 1000).toFixed(2)}`} tone="ink" /></g>}
        {snapLbl && <Pill x={X(F, snapLbl.u)} y={Y(F, snapLbl.z) - 18} text={snapLbl.text} tone="ink" />}
        {cabId && (() => { const c = m.cabinets.find(x => x.c.id === cabId); if (!c) return null; const x = X(F, c.u0 + c.c.width) + 30, y = Y(F, (c.c.z[0] + c.c.z[1]) / 2); return <g data-testid="add-col" style={{ cursor: 'pointer' }} onPointerDown={e => { e.stopPropagation(); addColumn(c.c.id) }}><circle cx={x} cy={y} r={14} fill="#fff" stroke="rgb(22 27 36 / .1)" /><path d={`M${x - 5} ${y}H${x + 5}M${x} ${y - 5}V${y + 5}`} stroke={C.ink} strokeWidth={2} strokeLinecap="round" /></g> })()}
      </svg>
    </div>
  )
}

/** 改柜宽：按比例缩各列（最后一列取剩下的） */
function rescaleColumns(c: Cabinet, w: number) {
  const L = layoutCabinet(c), f = w / c.width
  let acc = 0
  c.columns = c.columns.map((col, i) => { if (i === c.columns.length - 1) return { ...col, width: undefined }; const ww = Math.max(150, Math.round(L.columns[i].width * f)); acc += ww; return { ...col, width: ww } })
  void acc
  c.width = Math.round(w)
}
/** 改柜高：最上一格吃掉变化（省略 h 的格子本来就取剩下的） */
function growTopCells(c: Cabinet, _dz: number) {
  c.columns = c.columns.map(col => ({ ...col, cells: col.cells.map((cell, i) => i === col.cells.length - 1 ? { ...cell, h: undefined } : cell) }))
}
export function addColumn(id: string) {
  patchCabinet(id, c => {
    const L = layoutCabinet(c), n = c.columns.length + 1, w = Math.round(c.width / n)
    void L
    c.columns = [...c.columns.map(col => ({ ...col, width: w })), { cells: [{ type: 'door' as const, hinge: 'right' as const }] }]
  })
}
export { findItem }
