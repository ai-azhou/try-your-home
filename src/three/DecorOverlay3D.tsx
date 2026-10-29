/**
 * 装修态 3D 的选中 / 悬停和旁边的小按钮（D6 B6 / B7 / A4）：
 * - 选中、悬停的墙面：那一侧贴一层薄荷（core wallSkins 取这一面，只取这间房那一段），旁边小标签「客厅一侧 / 室外一侧」；
 * - 选中的装修构件：实体上叠一层薄荷；旁边「对准」（相机框住它），嵌墙的柜子、壁龛、挖洞多一个「剖开看看」（打开 1.1 m 剖切并对准）；
 * - 对准期间：旁边「取消对准」，回到最后选的那个视角。
 * 投影用 Overlay3D 的 Projector / Pin（每帧改 DOM 位置），白模、平涂下都出。
 */
import { useMemo } from 'react'
import * as THREE from 'three'
import { Crosshair, Scissors, X } from 'lucide-react'
import type { Plan, Vec2 } from '@/core/types'
import type { Decor } from '@/core/decor/types'
import type { DecorSolid } from '@/core/decor/solids'
import { wallSkins } from '@/core/decor/wall-skins'
import { faceAxis } from '@/core/decor/faces'
import { levelOf } from '@/core/levels'
import { solidToGeometry } from './geometry'
import type { Solid } from '@/core/solids'
import { Pin, Projector, type Anchor } from './Overlay3D'
import { useDecor, type DSel } from '@/ui/decor/dstore'
import { elevRoomAt, faceSideName, findItem, footprintOf, selKey, useShownDecor } from '@/ui/decor/model'
import { aimAt } from '@/ui/decor/actions'
import { useStore } from '@/ui/store'
import { usePlan3d } from './Scene3D'

const MINT = new THREE.MeshBasicMaterial({ color: '#55d3a5', transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
const MINT_HOVER = new THREE.MeshBasicMaterial({ color: '#55d3a5', transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })

/** 这面墙这一侧、这间房那一段的墙面皮（离墙面 4 mm） */
function faceGeos(plan: Plan, decor: Decor | undefined, s: Extract<DSel, { k: 'face' }>): THREE.BufferGeometry[] {
  try {
    const room = elevRoomAt(plan, s.face, { s: s.s })
    const skins = wallSkins(decor ? { ...plan, decor } : plan, { face: s.face, offset: 4 })
    const mine = skins.filter(k => !room || k.room === room)
    return (mine.length ? mine : skins).filter(k => k.positions.length >= 9).map(k => {
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(k.positions, 3))
      return g
    })
  } catch { return [] }
}

/** Canvas 内：选中 / 悬停的墙面、装修构件叠一层薄荷 */
export function DecorHighlight3D({ plan, decor, solids }: { plan: Plan; decor: Decor | undefined; solids: DecorSolid[] }) {
  const sel = useDecor(s => s.sel), hover = useDecor(s => s.hover)
  const sk = selKey(sel), hk = selKey(hover)
  const selGeos = useMemo(() => geosOf(plan, decor, solids, sel), [sk, plan, decor, solids])
  const hoverGeos = useMemo(() => hk === sk ? [] : geosOf(plan, decor, solids, hover), [hk, sk, plan, decor, solids])
  return (
    <group userData={{ ui: true }}>
      {selGeos.map((g, i) => <mesh key={'ds' + i} geometry={g} material={MINT} raycast={() => null} renderOrder={5} />)}
      {hoverGeos.map((g, i) => <mesh key={'dh' + i} geometry={g} material={MINT_HOVER} raycast={() => null} renderOrder={5} />)}
    </group>
  )
}
function geosOf(plan: Plan, decor: Decor | undefined, solids: DecorSolid[], s: DSel | null): THREE.BufferGeometry[] {
  if (!s) return []
  if (s.k === 'face') return faceGeos(plan, decor, s)
  if (s.k === 'floor' || s.k === 'cell') return []
  const id = s.id
  // 和实体重合的面靠材质的 polygonOffset 盖在上面
  return solids.filter(x => !x.replaces && x.ids.includes(id)).map(x => solidToGeometry({ ...x, kind: 'wall' } as unknown as Solid))
}

/* ───────── 旁边的小标签 / 按钮 ───────── */
interface DSpot extends Anchor { node: React.ReactNode }

/** 构件头顶的位置（平面足迹中心 + 顶高） */
function itemTop(plan: Plan, decor: Decor, id: string): [number, number, number] | null {
  const hit = findItem(decor, id)
  if (!hit) return null
  let fp = footprintOf(plan, hit.k, hit.it)
  if (!fp && hit.k === 'recess' && 'host' in hit.it && 'panel' in hit.it.host) {
    const pn = decor.panels.find(x => x.id === (hit.it as { host: { panel: string } }).host.panel)
    if (pn) fp = footprintOf(plan, 'panel', pn)
  }
  if (!fp?.length) return null
  const c: Vec2 = [fp.reduce((a, q) => a + q[0], 0) / fp.length, fp.reduce((a, q) => a + q[1], 0) / fp.length]
  const it = hit.it as { z?: [number, number] | number; rect?: { z: [number, number] }; span?: { z?: [number, number] }; height?: number }
  const top = Array.isArray(it.z) ? it.z[1] : it.rect ? it.rect.z[1] : it.span?.z ? it.span.z[1] : (typeof it.z === 'number' ? it.z : 0) + (it.height ?? 0.8)
  const w = 'place' in hit.it && 'face' in hit.it.place ? plan.walls.find(x => x.id === (hit.it as { place: { face: { wall: string } } }).place.face.wall) : undefined
  const el = w ? levelOf(plan, w).elevation : 0
  return [c[0] / 1000, el + Math.min(top, 2.6) + 0.18, c[1] / 1000]
}
/** 嵌墙的柜子、壁龛、挖洞：从外面看不到嵌进去多少，切开才看得到 */
function embedded(decor: Decor, id: string) {
  const hit = findItem(decor, id)
  if (!hit) return false
  if (hit.k === 'recess') return true
  return 'embed' in hit.it && !!hit.it.embed
}

function useDecorSpots(): DSpot[] {
  const plan = usePlan3d(), decor = useShownDecor()
  const mode = useStore(s => s.mode), main = useStore(s => s.main)
  const sel = useDecor(s => s.sel), hover = useDecor(s => s.hover), probe = useDecor(s => s.probe), section = useDecor(s => s.section3d)
  return useMemo(() => {
    if (!plan || !decor || mode !== 'decor' || main !== '3d') return []
    const out: DSpot[] = []
    // 墙面：「客厅一侧」（悬停淡，选中墨底）
    for (const [s, on] of [[hover, false], [sel, true]] as const) {
      if (s?.k !== 'face' || (!on && selKey(hover) === selKey(sel))) continue
      try {
        const ax = faceAxis(plan, s.face), w = ax.wall, mid = s.s ?? ax.length / 2, q = ax.at(mid, 260)
        const name = `${faceSideName(plan, s.face, mid)}一侧`
        out.push({ key: `d3-face-${on ? 's' : 'h'}`, pos: [q[0] / 1000, levelOf(plan, w).elevation + 1.55, q[1] / 1000], node: (
          <span data-testid={on ? 'face-side-3d' : 'face-side-3d-hover'} className={on ? 'pointer-events-none whitespace-nowrap rounded-full bg-ink-900 px-2.5 py-1 text-[11.5px] font-semibold text-white shadow-lg' : 'pointer-events-none whitespace-nowrap rounded-full bg-white/94 px-2.5 py-1 text-[11.5px] font-semibold text-mint-800 ring-1 ring-mint-400'}>{name}</span>
        ) })
      } catch { /* 弧墙等 */ }
    }
    // 对准中：取消对准（不管有没有选中）；选中构件：对准 / 剖开看看
    const target = probe?.item ?? (sel && 'id' in sel && sel.k !== 'cell' ? sel.id : null)
    const pos = target ? itemTop(plan, decor, target) : null
    if (target && pos) {
      const btn = 'pointer-events-auto flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[12px] font-semibold shadow-[0_8px_20px_-10px_rgb(20_22_40/0.5)] transition active:scale-95'
      out.push({ key: 'd3-item-acts', pos, node: (
        <div className="flex -translate-y-5 gap-1.5" data-testid="decor-3d-actions">
          {probe
            ? <button data-testid="aim-cancel" onClick={() => { aimAt(null); if (section && embedded(decor, target)) useDecor.getState().set({ section3d: false }) }} className={btn + ' bg-ink-900 text-white'}><X size={13} strokeWidth={2.6} />取消对准</button>
            : <button data-testid="aim-item" onClick={() => aimAt(target)} className={btn + ' glass-strong text-ink-800 hover:bg-white'}><Crosshair size={13} strokeWidth={2.4} />对准</button>}
          {embedded(decor, target) && !(probe && section) && (
            <button data-testid="section-item" onClick={() => { useDecor.getState().set({ section3d: true }); aimAt(target) }} className={btn + ' glass-strong text-ink-800 hover:bg-white'}><Scissors size={13} strokeWidth={2.4} />剖开看看</button>
          )}
        </div>
      ) })
    }
    return out
  }, [plan, decor, mode, main, sel, hover, probe, section])
}

export function DecorSpotProjector() {
  const spots = useDecorSpots()
  return <Projector anchors={spots} />
}
export function DecorSpotLayer() {
  const spots = useDecorSpots()
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {spots.map(s => <Pin key={s.key} id={s.key} pass={false}>{s.node}</Pin>)}
    </div>
  )
}
