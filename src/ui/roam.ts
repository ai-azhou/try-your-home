/**
 * 漫游的界面状态：开没开、视角宽度、平视高度。都不进方案文件。
 * 视角宽度和平视高度是「这个人看房的习惯」，和方案无关，记在本机（localStorage）；站位只记在这次打开里。
 */
import { create } from 'zustand'
import { ROAM } from '@/three/roam'
import { useDecor } from './decor/dstore'
import { useStore } from './store'

const KEY = 'tyh.roam'
const clamp = (v: unknown, lo: number, hi: number, def: number) => typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def
function readPrefs(): { fov: number; eye: number } {
  let raw: { fov?: unknown; eye?: unknown } = {}
  try { raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {} } catch { /* 隐私模式等：用默认值 */ }
  return { fov: clamp(raw.fov, ROAM.fov.min, ROAM.fov.max, ROAM.fov.def), eye: clamp(raw.eye, ROAM.eye.min, ROAM.eye.max, ROAM.eye.def) }
}

interface RoamState {
  on: boolean
  /** 水平视角（度） */
  fov: number
  /** 平视高度（m，脚下地面到眼睛） */
  eye: number
  set(p: Partial<Pick<RoamState, 'fov' | 'eye'>>): void
}
export const useRoam = create<RoamState>()((set, get) => ({
  on: false,
  ...readPrefs(),
  set: p => {
    set(p)
    const { fov, eye } = get()
    try { localStorage.setItem(KEY, JSON.stringify({ fov, eye })) } catch { /* 只在这次会话里记 */ }
  },
}))

/** 进漫游前选中的房间：从那间开始走。进来时选中要清掉（漫游里没有检查器），先记下 */
export const roamStart: { room?: string } = {}

export function enterRoam() {
  const s = useStore.getState(), D = useDecor.getState()
  if (!s.base || useRoam.getState().on) return
  roamStart.room = s.mode === 'decor' ? (D.sel?.k === 'floor' ? D.sel.id : undefined) : s.sel.find(r => r.type === 'room')?.id
  if (s.main !== '3d') s.setMain('3d')
  s.select(null); s.setHover(null); s.setPanel(null)
  // 漫游要站在完整的房子里：不剖开、不对准，也没有选中和悬停
  D.set({ probe: null, section3d: false, sel: null, hover: null })
  useRoam.setState({ on: true })
}
export function exitRoam() { if (useRoam.getState().on) useRoam.setState({ on: false }) }

/**
 * Agent 改完文件自动刷新（keepView）：载入过程中模式、相机计数会先重置再恢复。
 * 这不是用户要退出，手册工具连接 4.2 也承诺「视角保持不变」，所以这段时间不判退出。
 */
let keeping = false
export function keepRoamDuring(fn: () => void) { keeping = true; try { fn() } finally { keeping = false } }

/** 点了别的视角、切回平面、换模式、换方案：都算退出漫游 */
if (typeof window !== 'undefined') useStore.subscribe((s, prev) => {
  if (!keeping && useRoam.getState().on && (s.camNonce !== prev.camNonce || s.main !== '3d' || s.mode !== prev.mode || !s.base)) exitRoam()
})

/** 这一帧站在哪（平面画中画的小人每帧读，不走 React） */
export const roamPose = { x: 0, z: 0, yaw: 0, hFov: ROAM.fov.def as number, ready: false }

/** 点画中画平面：走到那里（x、z 是世界米制） */
export const ROAM_GOTO = 'roam-goto'
export const roamGoto = (x: number, z: number) => window.dispatchEvent(new CustomEvent(ROAM_GOTO, { detail: [x, z] }))
