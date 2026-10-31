/**
 * 装修层的编辑动作。全部走 commitDecor（一份拷贝上改 → 写回 base.decor → 进撤销历史）。
 * 嵌入深度、挖洞这类几何硬约束用 core checkEmbed 判；受保护墙只提示不拦。
 */
import type { Plan, Vec2 } from '@/core/types'
import type { Cabinet, CabinetColumn, Decor, FaceRef, Furniture, Panel, Recess, Surface } from '@/core/decor/types'
import { checkEmbed } from '@/core/decor/embed'
import { faceAxis, faceExtent } from '@/core/decor/faces'
import { fromLegacyFurniture } from '@/core/decor/legacy'
import { effectiveWallHeight, pointInPolygon, roomCeiling } from '@/core/geometry'
import { useStore } from '../store'
import { styleOf } from './model'
import { faceOfItem, footprintOf } from './model'
import { faceCamera } from '@/three/decor3d'
import { itemSpan } from '@/core/decor/resolve'
import { furniturePose } from '@/core/decor/furniture'
import { commitDecor, decorPlanOf, faceSurfaces, getDecorPlan, newDecor, newDecorId, findItem, isWholeFace, matOf, overheadOf, unhostFurniture } from './model'
import { furnEntry } from './furniture'
import { componentOf } from '@/core/decor/components'
import { useDecor, type CabFamily, type PanelKind } from './dstore'

const U = { by: 'user' as const, status: 'confirmed' as const }
const toast = (s: string) => useStore.getState().showToast(s)

/** 第一次进装修：没有装修层时先不建（「没有这个字段 = 还没开始装修」），右侧出风格卡；旧方案里的家具一并转进来 */
export function enterDecor() {
  const s = useStore.getState()
  s.setMode('decor')
  const d = useDecor.getState()
  d.set({ canvas: { k: 'plan' }, sel: null, tool: 'select', styleCard: !s.base?.decor, preview: null })
}
export function applyStyle(styleId: string, keep: boolean) {
  const s = useStore.getState()
  if (!s.base) return
  const fresh = !s.base.decor
  commitDecor(d => {
    const next: Decor = fresh ? newDecor(styleId) : d
    next.style = styleId
    // 不保留单独改过的：墙面、地面覆盖去掉，造型换成新风格的点缀墙材料。整个应用是一步撤销（commitDecor 推一步）
    if (!keep) {
      next.surfaces = next.surfaces.filter(x => x.by !== 'user')
      const accent = styleOf(styleId, next).roles['wall.accent']
      if (accent) for (const p of next.panels) p.material = accent
    }
    if (fresh) {
      // 旧格式方案里的家具（legacy.furniture）用 core 转进装修层
      try {
        const r = fromLegacyFurniture(s.base!)
        if (r.furniture.length) {
          next.furniture.push(...r.furniture)
          for (const m of r.materials) if (!next.materials.some(x => x.id === m.id)) next.materials.push(m)
          for (const p of r.presets) (next.presets ??= []).push(p)
          toast(`旧方案里的 ${r.furniture.length} 件家具已转入装修层`)
        }
      } catch { /* 没有旧家具 */ }
    }
    return next
  })
  useDecor.getState().set({ styleCard: false, preview: null })
}

/* ───────── 材质 ───────── */
export function paintFloor(roomId: string, material: string) {
  commitDecor(d => {
    d.surfaces = d.surfaces.filter(s => !('floor' in s.target && s.target.floor === roomId))
    d.surfaces.push({ id: newDecorId(d, getDecorPlan()!.plan, 'sf-'), target: { floor: roomId }, material, ...U })
  })
}
export function paintFace(face: FaceRef, material: string, scope: { s?: [number, number]; z?: [number, number] } = {}) {
  commitDecor(d => {
    const whole = !scope.s && !scope.z
    d.surfaces = d.surfaces.filter(s => !('face' in s.target && s.target.face.wall === face.wall && s.target.face.side === face.side && (whole ? true : !isWholeFace(s) && JSON.stringify(s.target.s) === JSON.stringify(scope.s) && JSON.stringify(s.target.z) === JSON.stringify(scope.z))))
    const sf: Surface = { id: newDecorId(d, getDecorPlan()!.plan, 'sf-'), target: { face, ...(scope.s ? { s: scope.s } : {}), ...(scope.z ? { z: scope.z } : {}) }, material, ...U }
    d.surfaces.push(sf)
  })
}
export function resetFace(face: FaceRef) {
  commitDecor(d => { d.surfaces = d.surfaces.filter(s => !faceSurfaces(d, face).includes(s)) })
}
export function resetFloor(roomId: string) {
  commitDecor(d => { d.surfaces = d.surfaces.filter(s => !('floor' in s.target && s.target.floor === roomId)) })
}

/* ───────── 家具 ───────── */
export function addFurniture(type: string, at: Vec2, rot = 0) {
  const dp = getDecorPlan()
  if (!dp?.decor) return null
  // 方案里的构件再摆一个：尺寸照定义（定义里是 mm，内存里的高度是 m），形状跟着定义走
  const def = componentOf(dp.decor, type)
  const e = def ? { name: def.name, size: def.size, height: def.height / 1000 } : furnEntry(type)
  if (!e) return null
  // 顶上的东西再摆一个不能落到地上：吊顶贴到所在房间顶面（和 decor-edit 的 ceiling 写法一样）；顶灯照已有那件的离地高度
  const room = dp.plan.rooms.find(r => pointInPolygon(at, r.poly))
  const sibling = dp.decor.furniture.find(f => f.type === type && overheadOf(dp.plan, f))
  const z = def?.category === 'ceiling' ? +((room ? roomCeiling(dp.plan, room) : dp.plan.ceiling) - e.height).toFixed(3) : sibling?.z
  let id = ''
  commitDecor(d => {
    id = newDecorId(d, dp.plan, 'f-')
    d.furniture.push({ id, type, name: e.name, at: [Math.round(at[0]), Math.round(at[1])], rot, size: [e.size[0], e.size[1]], height: e.height, ...(z !== undefined ? { z } : {}), ...U })
  })
  useDecor.getState().select({ k: 'furniture', id })
  return id
}
type FurniturePatch = Partial<Omit<Furniture, 'at' | 'in'>> & { at?: Vec2; rot?: number }
export function patchFurniture(id: string, patch: FurniturePatch, key?: string) {
  commitDecor(d => { d.furniture = d.furniture.map(f => f.id === id ? ({ ...f, ...patch } as Furniture) : f) }, { key })
}
export function rotateFurniture(id: string, by = 90) {
  const f = getDecorPlan()?.decor?.furniture.find(x => x.id === id)
  if (!f) return
  if (f.in) { toast('放在里面的家电跟着宿主转；先「拿出来」再转'); return }
  patchFurniture(id, { rot: (((f.rot ?? 0) + by) % 360 + 360) % 360, against: undefined })
}
/** 检查器「拿出来」：宿主里的家电变成自由摆放，位置就是它现在的位置 */
export function takeOutFurniture(id: string) {
  const dp = getDecorPlan()
  const f = dp?.decor?.furniture.find(x => x.id === id)
  if (!dp || !f?.in) return
  commitDecor(d => { d.furniture = d.furniture.map(x => x.id === id ? unhostFurniture(dp.plan, x) : x) })
  toast('拿出来了，现在可以拖动；⌘Z 放回去')
}

/* ───────── 柜子 ───────── */
const CAB_DEFAULT: Record<CabFamily, { depth: number; z: [number, number]; plinth?: number; top?: boolean }> = {
  tall: { depth: 600, z: [0, 2.4], plinth: 0.08 },
  base: { depth: 600, z: [0, 0.82], plinth: 0.1, top: true },
  wall: { depth: 350, z: [1.55, 2.25] },
}
/** 新柜子按宽度自动分列（每列不超过 900，常见值），默认全是门 */
export function autoColumns(width: number): CabinetColumn[] {
  const n = Math.max(1, Math.ceil(width / 900)), w = Math.round(width / n)
  return Array.from({ length: n }, (_, i) => i < n - 1 ? { width: w, cells: [{ type: 'doors' as const }] } : { cells: [{ type: 'doors' as const }] })
}
export function addCabinet(face: FaceRef, s0: number, s1: number, family: CabFamily) {
  const dp = getDecorPlan()
  if (!dp?.decor) return null
  let ext: [number, number]
  try { ext = faceExtent(dp.plan, face) } catch { toast('弧墙上的柜子下一期做'); return null }
  let a = Math.max(ext[0], Math.min(s0, s1)), b = Math.min(ext[1], Math.max(s0, s1))
  if (b - a < 300) { const c = (a + b) / 2; a = Math.max(ext[0], c - 450); b = Math.min(ext[1], a + 900) }
  const def = CAB_DEFAULT[family], width = Math.round(b - a)
  const w = dp.plan.walls.find(x => x.id === face.wall)!
  const H = effectiveWallHeight(dp.plan, w)
  let id = ''
  commitDecor(d => {
    id = newDecorId(d, dp.plan, 'cab-')
    const st = d.style
    void st
    const cab: Cabinet = {
      id, name: { tall: '高柜', base: '地柜', wall: '吊柜' }[family], family, ...U,
      place: { face, s: Math.round(a) }, width, depth: def.depth, z: family === 'tall' ? [0, Math.min(def.z[1], H)] : def.z,
      ...(def.plinth ? { plinth: def.plinth } : {}),
      ...(def.top ? { top: { material: 'slab', thickness: 20 } } : {}),
      columns: autoColumns(width), materials: { carcass: 'creamDoor', front: 'creamDoor' }, handle: 'bar',
    }
    d.cabinets.push(cab)
  })
  useDecor.getState().select({ k: 'cabinet', id })
  return id
}
export function patchCabinet(id: string, fn: (c: Cabinet) => void, key?: string) {
  commitDecor(d => { const c = d.cabinets.find(x => x.id === id); if (c) fn(c) }, { key })
}

/**
 * 嵌进墙里：挖到墙厚（挖透）不写数据——数据保留上一次的有效值，输入框旁就地提示「那是开洞，属于结构改造」+「去改造开洞」；
 * 不替用户把数字改成别的值（D4 坑 4，本人 10-29 定）。受保护墙只提示（检查器事实卡），不拦。
 */
export function setEmbed(kind: 'cabinet' | 'furniture' | 'recess', id: string, depth: number): boolean {
  const dp = getDecorPlan()
  if (!dp?.decor) return false
  const it = findItem(dp.decor, id)
  if (!it) return false
  const face = 'place' in it.it && 'face' in it.it.place ? it.it.place.face : 'host' in it.it && 'face' in it.it.host ? it.it.host.face : 'against' in it.it ? it.it.against?.face : undefined
  const wall = face && dp.plan.walls.find(w => w.id === face.wall)
  if (!wall || !face) { toast('先靠墙放，才能嵌进墙里'); return false }
  const next = structuredClone(dp.decor)
  const item = findItem(next, id)!.it as Cabinet & Recess & Furniture
  if (kind === 'recess') item.depth = depth; else item.embed = depth
  const issues = checkEmbed(decorPlanOf(dp.plan, next), next, item, dp.base)
  const through = issues.find(i => i.code === 'through-wall' || i.code === 'meet-other-side')
  if (through || depth >= wall.thickness) {
    const pl = (item as Cabinet).place, rs = (item as Recess).rect?.s
    const s = pl && 'face' in pl ? [pl.s, pl.s + ((item as Cabinet).width ?? 0)] : rs ?? [0, 0]
    useDecor.getState().set({ throughHint: { id, tried: depth, other: through?.code === 'meet-other-side' ? through.text : undefined, wall: wall.id, s: s[0], width: s[1] - s[0], z: (item as Cabinet).z ?? (item as Recess).rect?.z ?? [0, 2.1], thickness: wall.thickness } })
    return false
  }
  const hard = issues.find(i => i.level === 'error' && i.code !== 'protected')
  if (hard) { toast(hard.text); return false }
  useDecor.getState().set({ throughHint: null })
  commitDecor(() => next, { key: `embed-${id}` })
  return true
}

/* ───────── 造型、挖 ───────── */
export function addPanel(face: FaceRef, s: [number, number], z: [number, number], type: PanelKind) {
  const dp = getDecorPlan()
  if (!dp?.decor) return null
  let id = ''
  const th = { feature: 150, wainscot: 30, slats: 40, skirting: 12 }[type]
  commitDecor(d => {
    id = newDecorId(d, dp.plan, 'pn-')
    const p: Panel = {
      id, name: { feature: '背景墙', wainscot: '护墙板', slats: '格栅', skirting: '踢脚线' }[type], type, ...U,
      span: { face, s: [Math.round(Math.min(...s)), Math.round(Math.max(...s))], z: [Math.max(0, Math.min(...z)), Math.max(...z)] },
      thickness: th, material: type === 'feature' ? 'micro' : type === 'slats' ? 'oakVeneer' : 'creamDoor',
      ...(type === 'slats' ? { slats: { width: 30, gap: 30, depth: 40 } } : {}),
      ...(type === 'wainscot' ? { frame: { style: 'flat' as const, margin: 80 } } : {}),
    }
    d.panels.push(p)
  })
  useDecor.getState().select({ k: 'panel', id })
  return id
}
export function patchPanel(id: string, fn: (p: Panel) => void, key?: string) {
  commitDecor(d => { const p = d.panels.find(x => x.id === id); if (p) fn(p) }, { key })
}
/**
 * 「挖」：框在哪就挖在哪。框在造型板 / 柜子上 = 在它上面挖洞；框在空墙上 = 壁龛（不挖透）。
 * u 是立面横坐标（mm，站在房间里看从左到右），z 离地 m。
 */
export function addCut(face: FaceRef, u: [number, number], z: [number, number], host: { panel: string; u0: number } | { cabinet: string; u0: number; z0: number } | null) {
  const dp = getDecorPlan()
  if (!dp?.decor) return null
  const ax = faceAxis(dp.plan, face)
  let id = ''
  const r: Recess = host && 'panel' in host
    ? { id: '', kind: 'hole', name: '挖洞', ...U, host: { panel: host.panel }, rect: { u: [Math.round(u[0] - host.u0), Math.round(u[1] - host.u0)], z }, depth: 50 }
    : { id: '', kind: 'niche', name: '壁龛', ...U, host: { face }, rect: { s: [Math.round(Math.min(ax.toS(u[0]), ax.toS(u[1]))), Math.round(Math.max(ax.toS(u[0]), ax.toS(u[1])))], z }, depth: 60 }
  if (host && 'cabinet' in host) {
    // 柜子上：裁格子（cuts），不单独存 recess
    patchCabinet(host.cabinet, c => { (c.cuts ??= []).push({ u: [Math.round(u[0] - host.u0), Math.round(u[1] - host.u0)], z, depth: 'through' }) })
    useDecor.getState().select({ k: 'cabinet', id: host.cabinet })
    return host.cabinet
  }
  if (host && 'panel' in host) {
    const p = dp.decor.panels.find(x => x.id === host.panel)
    // 常见电视位挖进 100（常见值），板太薄时留 30
    if (p) r.depth = Math.max(10, Math.min(100, p.thickness - 30))
  }
  commitDecor(d => {
    id = newDecorId(d, dp.plan, 'rc-')
    d.recesses.push({ ...r, id })
  })
  useDecor.getState().select({ k: 'recess', id })
  return id
}
export function patchRecess(id: string, fn: (r: Recess) => void, key?: string) {
  commitDecor(d => { const r = d.recesses.find(x => x.id === id); if (r) fn(r) }, { key })
}
export function ackItem(id: string) {
  commitDecor(d => {
    for (const L of [d.cabinets, d.recesses, d.furniture, d.panels] as { id: string; ack?: { by: string; at?: string } }[][]) for (const x of L) if (x.id === id) x.ack = { by: '业主', at: new Date().toISOString().slice(0, 10) }
  })
}

/* ───────── 没地方挂了：挪到最近的同朝向墙面 / 先留着 / 删掉 ───────── */
export function nearestFaces(plan: Plan, decor: Decor, id: string): { face: FaceRef; s: number; dist: number }[] {
  const c = decor.cache?.[id]
  if (!c) return []
  const cx = (c.box[0] + c.box[2]) / 2, cy = (c.box[1] + c.box[3]) / 2
  const out: { face: FaceRef; s: number; dist: number }[] = []
  for (const w of plan.walls) for (const side of [1, -1] as const) {
    if (w.bulge || w.kind === 'glass' || w.kind === 'half-glass') continue
    try {
      const ax = faceAxis(plan, { wall: w.id, side }), ext = faceExtent(plan, { wall: w.id, side })
      if (ext[1] - ext[0] < 600) continue
      const o = ax.at(0), d = [ax.dir[0] * side, ax.dir[1] * side]
      void d
      // 投影到这面墙上
      const u = (w.b[0] - w.a[0]) / Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), v = (w.b[1] - w.a[1]) / Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
      const s = Math.max(ext[0], Math.min(ext[1], (cx - o[0]) * u + (cy - o[1]) * v))
      const p = ax.at(s)
      const n = ax.normalAt(s)
      if ((cx - p[0]) * n[0] + (cy - p[1]) * n[1] < -10) continue // 要在这面墙的房间一侧
      out.push({ face: { wall: w.id, side }, s, dist: Math.hypot(cx - p[0], cy - p[1]) })
    } catch { /* 跳过 */ }
  }
  return out.sort((a, b) => a.dist - b.dist).slice(0, 3)
}
export function moveOrphan(id: string, face: FaceRef, s: number) {
  const dp = getDecorPlan()
  if (!dp?.decor) return
  const it = findItem(dp.decor, id)
  if (!it) return
  let ext: [number, number] = [0, 0]
  try { ext = faceExtent(dp.plan, face) } catch { return }
  commitDecor(d => {
    const x = findItem(d, id)!.it
    if ('place' in x && 'face' in x.place) {
      const w = (x as Cabinet).width
      const s0 = Math.max(ext[0], Math.min(ext[1] - w, s - w / 2))
      x.place = { face, s: Math.round(s0) }
      ;(x as Cabinet).embed = undefined
    } else if ('span' in x && x.span) {
      const w = x.span.s[1] - x.span.s[0], s0 = Math.max(ext[0], Math.min(ext[1] - w, s - w / 2))
      x.span = { ...x.span, face, s: [Math.round(s0), Math.round(s0 + w)] }
    } else if ('host' in x && 'face' in x.host) {
      const w = (x.rect.s?.[1] ?? 0) - (x.rect.s?.[0] ?? 0), s0 = Math.max(ext[0], Math.min(ext[1] - w, s - w / 2))
      x.host = { face }; x.rect = { ...x.rect, s: [Math.round(s0), Math.round(s0 + w)] }
    }
  })
  toast('挪过去了，⌘Z 可以撤回')
}

export const matName = (id: string) => matOf(getDecorPlan()?.decor, id).name

/* ───────── 3D 白模探针（P1 嵌墙柜 + 壁龛、P2 背景墙 + 电视挖洞、P3 带挖洞的高柜）：相机对准示例方案里的那一处 ───────── */
/** look：机位要看清的那一件（P2 看的是洞里的电视，不是整块背景墙：梁正好压在背景墙中线上） */
export const PROBES: { id: 'p1' | 'p2' | 'p3'; label: string; sub: string; box: [number, number, number, number]; item: string; look?: string; az: number; el: number }[] = [
  { id: 'p1', label: 'P1 嵌墙柜', sub: '外墙里挖进 120，墙真的变薄', box: [-300, 5900, 900, 7300], item: 'cab-tall-1', az: 74, el: 46 },
  { id: 'p2', label: 'P2 电视墙', sub: '背景墙板上挖电视位，挖进 100', box: [-300, 3500, 900, 6500], item: 'pn-tv', look: 'f-tv', az: 90, el: 40 },
  { id: 'p3', label: 'P3 书桌柜', sub: '高柜中间挖穿放书桌', box: [-300, 100, 900, 3500], item: 'cab-desk', az: 104, el: 48 },
]
/**
 * 探针机位（D5）：不再手调方位，用「对着这面墙看」的通用机位（three/decor3d faceCamera：墙面法向 + 越得过前面墙顶、梁的最小仰角）；
 * 取景框 = 这个构件的平面外接框四周放 900。算不出来（构件挂不上）才退回 D4 的手调值。
 */
export function showProbe(id: 'p1' | 'p2' | 'p3' | null) {
  const pr = PROBES.find(p => p.id === id)
  if (!pr) { aimAt(null); return }
  aimAt(pr.item, { look: pr.look, fallback: { box: pr.box, az: pr.az, el: pr.el }, tag: pr.id })
}

/**
 * 「对准」（D6，取代工具栏上的 P1–P3）：3D 相机框住一个装修构件（柜子、造型、挖洞、家具）。
 * 挂在墙面上的用「对着这面墙看」的通用机位（three/decor3d faceCamera）；自由摆放的家具从斜上方看。
 * 对准期间视角按钮都不亮；点任一视角 / 复位 = 退出对准、切到那个视角（App.tsx 订阅 camNonce）；
 * 取消对准 = 回到最后选的那个视角（store.cam 在对准期间不改）。
 */
export function aimAt(itemId: string | null, opts: { look?: string; fallback?: { box: [number, number, number, number]; az: number; el: number }; tag?: string } = {}) {
  const s = useStore.getState()
  if (!itemId) { useDecor.getState().set({ probe: null }); return }
  let cam = opts.fallback ?? null
  const dp = getDecorPlan(), hit = dp?.decor ? findItem(dp.decor, itemId) : null
  if (dp && hit) {
    const face = faceOfItem(hit.it), fp = footprintOf(dp.plan, hit.k, hit.it)
    if (fp?.length) {
      const pad = hit.k === 'furniture' ? 1200 : 900
      const box: [number, number, number, number] = [Math.min(...fp.map(p => p[0])) - pad, Math.min(...fp.map(p => p[1])) - pad, Math.max(...fp.map(p => p[0])) + pad, Math.max(...fp.map(p => p[1])) + pad]
      if (face) {
        let span: { s: [number, number]; z: [number, number] } | undefined
        try { const sp = itemSpan(dp.plan, hit.it); if (sp) span = { s: sp.s, z: sp.z } } catch { /* */ }
        const look = opts.look ? dp.decor?.furniture.find(f => f.id === opts.look) : undefined
        if (look) try {
          const pose = furniturePose(dp.plan, look), w = dp.plan.walls.find(x => x.id === face.wall)!
          const d = [w.b[0] - w.a[0], w.b[1] - w.a[1]], L = Math.hypot(d[0], d[1]), ss = pose.footprint.map(q => ((q[0] - w.a[0]) * d[0] + (q[1] - w.a[1]) * d[1]) / L)
          span = { s: [Math.min(...ss), Math.max(...ss)], z: [pose.z, pose.z + look.height] }
        } catch { /* */ }
        const c = faceCamera(dp.plan, face, box, span)
        cam = c ? { box, az: c.az, el: c.el } : cam ?? { box, az: 30, el: 48 }
      } else cam = { box, az: 30, el: 52 }
    }
  }
  if (!cam) { toast('这一件对不准（挂的墙不在了）'); return }
  useDecor.getState().set({ probe: { id: opts.tag ?? itemId, item: itemId, ...cam } })
  if (s.main !== '3d') s.setMain('3d')
}
