/**
 * 方向键挪东西（步幅 10 mm，⇧ 100 mm，方向按屏幕；连按合成一步撤销）。
 * 平面：家具、独立摆放的柜子走平面坐标；靠墙的柜子只沿墙走。
 * 立面：选中可拖动的构件时，左右沿墙、上下调离地高度，和拖动写同一份数据（applyElevRect）。
 */
import type { Vec2 } from '@/core/types'
import type { Cabinet, Decor } from '@/core/decor/types'
import { resizeCabinet } from '@/core/decor/cabinets'
import { dot, wallDir } from '@/core/geometry'
import { useStore } from '../store'
import { useDecor, type DSel } from './dstore'
import { getDecorPlan } from './model'
import { elevationModel, type ElevModel } from './elev-model'
import { rectOfSel } from './ElevDrawing'
import { patchCabinet, patchFurniture, patchPanel, patchRecess } from './actions'
import { nudgeFurniture } from './plan-ctl'

type Rect = { u: [number, number]; z: [number, number] }

/** 改柜高：最上一格吃掉变化（省略 h 的格子本来就取剩下的） */
function growTopCells(c: Cabinet) {
  c.columns = c.columns.map(col => ({ ...col, cells: col.cells.map((cell, i) => i === col.cells.length - 1 ? { ...cell, h: undefined } : cell) }))
}

/** 立面上的矩形写回各自的数据（拖动、方向键共用） */
export function applyElevRect(m: ElevModel, decor: Decor, sl: DSel, r: Rect, key: string) {
  if (!('id' in sl)) return
  const ax = m.ax
  const sOf = (u: [number, number]): [number, number] => { const a = ax.toS(u[0]), b = ax.toS(u[1]); return [Math.round(Math.min(a, b)), Math.round(Math.max(a, b))] }
  if (sl.k === 'panel') patchPanel(sl.id, p => { if (p.span) p.span = { ...p.span, s: sOf(r.u), z: [Math.max(0, r.z[0]), Math.min(m.H, r.z[1])] } }, key)
  else if (sl.k === 'cabinet') patchCabinet(sl.id, c => {
    const ss = sOf(r.u), w = ss[1] - ss[0]
    if ('face' in c.place) c.place = { ...c.place, s: ss[0] }
    if (Math.abs(w - c.width) > 1) { const n = resizeCabinet(c, w); c.width = n.width; c.columns = n.columns }
    if (Math.abs(r.z[1] - c.z[1]) > 0.001 || Math.abs(r.z[0] - c.z[0]) > 0.001) { c.z = [r.z[0], r.z[1]]; growTopCells(c) }
  }, key)
  else if (sl.k === 'recess') {
    const rc = decor.recesses.find(x => x.id === sl.id)
    if (!rc) return
    if ('panel' in rc.host) { const p = m.panels.find(x => x.p.id === (rc.host as { panel: string }).panel); if (p) patchRecess(sl.id, x => { x.rect = { u: [Math.round(r.u[0] - p.u0), Math.round(r.u[1] - p.u0)], z: r.z } }, key) }
    else patchRecess(sl.id, x => { x.rect = { s: sOf(r.u), z: r.z } }, key)
  } else if (sl.k === 'furniture') {
    const f = decor.furniture.find(x => x.id === sl.id), cur = m.furniture.find(x => x.f.id === sl.id)
    if (!f) return
    if (f.in || !f.at || !cur) patchFurniture(sl.id, { z: r.z[0] }, key)
    else { const du = r.u[0] - cur.u[0]; patchFurniture(sl.id, { at: [Math.round(f.at[0] + ax.dir[0] * du), Math.round(f.at[1] + ax.dir[1] * du)], z: Math.max(0, r.z[0]) }, key) }
  }
}

const DIRS: Record<string, Vec2> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }
const toast = (s: string) => useStore.getState().showToast(s)
let nudgeTimer: ReturnType<typeof setTimeout> | undefined
/** 净距多留一会儿：读得到数，下一次按键接着显示 */
function showClearance(id: string) {
  clearTimeout(nudgeTimer)
  useDecor.getState().set({ nudging: id })
  nudgeTimer = setTimeout(() => useDecor.getState().set({ nudging: null }), 1500)
}

/** 处理了就返回 true（调用方拦掉默认滚动）；没选中能挪的东西返回 false */
export function nudgeSelected(key: string, shift: boolean): boolean {
  const dir = DIRS[key], D = useDecor.getState(), sel = D.sel, dp = getDecorPlan()
  if (!dir || !sel || !('id' in sel) || sel.k === 'cell' || sel.k === 'floor' || sel.k === 'door' || !dp?.decor) return false
  const step = shift ? 100 : 10, id = sel.id, decor = dp.decor, k = `nudge-${id}`
  if (D.canvas.k !== 'plan') return nudgeElevation(dir, step, sel, decor, k)
  const d: Vec2 = [dir[0] * step, dir[1] * step]
  if (sel.k === 'furniture') {
    const f = decor.furniture.find(x => x.id === id)
    if (!f) return false
    if (f.in || !f.at) { toast('放在里面的家电跟着宿主走；先「拿出来」再挪'); return true }
    const n = nudgeFurniture(dp.plan, f, d)
    patchFurniture(id, { at: n.at, against: n.against }, k)
    showClearance(id)
    return true
  }
  if (sel.k === 'panel' && decor.panels.find(x => x.id === id)?.type === 'arch') { toast('拱形门套跟着门洞走，门在改造里挪'); return true }
  if (sel.k === 'cabinet') {
    const c = decor.cabinets.find(x => x.id === id)
    if (!c) return false
    if ('at' in c.place) {
      const at = c.place.at
      patchCabinet(id, x => { if ('at' in x.place) x.place = { ...x.place, at: [at[0] + d[0], at[1] + d[1]] } }, k)
      showClearance(id)
      return true
    }
    const w = dp.plan.walls.find(x => x.id === (c.place as { face: { wall: string } }).face.wall)
    const along = w ? dot(d, wallDir(w)) : 0
    if (Math.abs(along) < step / 2) { toast('靠墙的柜子只能沿墙挪'); return true }
    patchCabinet(id, x => { if ('face' in x.place) x.place = { ...x.place, s: Math.round(x.place.s + along) } }, k)
    showClearance(id)
    return true
  }
  return false
}

function nudgeElevation(dir: Vec2, step: number, sel: DSel & { id: string }, decor: Decor, key: string): boolean {
  const D = useDecor.getState(), dp = getDecorPlan()
  if (!dp || D.canvas.k === 'plan') return false
  if (sel.k === 'panel' && decor.panels.find(x => x.id === sel.id)?.type === 'arch') { toast('拱形门套跟着门洞走，门在改造里挪'); return true }
  const m = elevationModel(dp.plan, dp.base, decor, D.canvas.face)
  if (!m) return false
  const r = rectOfSel(m, decor, sel.k, sel.id)
  if (!r) return false
  if (dir[0]) {
    if (sel.k === 'furniture' && decor.furniture.find(x => x.id === sel.id)?.in) { toast('放在里面的家电跟着宿主走；先「拿出来」再挪'); return true }
    const du = dir[0] * step
    applyElevRect(m, decor, sel, { u: [r.u[0] + du, r.u[1] + du], z: r.z }, key)
    return true
  }
  // 上下：屏幕朝上 = 离地更高；不许钻到地下，有顶的构件不许顶穿（整块平移，不改高度）
  const want = -dir[1] * step / 1000
  const room = sel.k === 'furniture' ? Infinity : m.H - r.z[1]
  const dz = Math.round(Math.min(room, Math.max(-r.z[0], want)) * 1000) / 1000
  if (!dz) return true
  applyElevRect(m, decor, sel, { u: r.u, z: [Math.round((r.z[0] + dz) * 1000) / 1000, Math.round((r.z[1] + dz) * 1000) / 1000] }, key)
  return true
}
