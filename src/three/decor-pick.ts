/**
 * 装修态 3D 的点选（D6 B6 / B7）：3D 里点到什么，右侧就出那张装修卡（和平面同一个 useDecor.sel）。
 * - 装修构件（柜子、造型、家具）：命中点往表面里退 3 mm，落在哪个 core buildDecorSolids 实体里就是哪一件；
 * - 壁龛 / 挖在墙上的洞：命中点落在 core embedFootprint 里、高度在洞的范围里；
 * - 墙：按命中面的法向分清是哪一侧（朝房间那面 / 室外那面）；点在墙顶上（法向朝上）= 室内一侧，明确点在外侧才选室外一侧；
 * - 地面：那间房的地面。
 */
import type * as THREE from 'three'
import type { Plan, Vec2 } from '@/core/types'
import type { Decor } from '@/core/decor/types'
import type { DecorSolid } from '@/core/decor/solids'
import { embedFootprint, embedsOf } from '@/core/decor/embed'
import { pointInPolygon, wallDir, wallLength, wallNormal } from '@/core/geometry'
import { levelOf } from '@/core/levels'
import { findItem, indoorSide } from '@/ui/decor/model'
import type { DSel } from '@/ui/decor/dstore'

const inPoly = (p: Vec2, rings: Vec2[][]) => pointInPolygon(p, rings[0]) && !rings.slice(1).some(h => pointInPolygon(p, h))

/** 命中点落在哪个装修实体里（往表面里退 3 mm 再判断） */
export function pickDecorItem(plan: Plan, decor: Decor, solids: DecorSolid[], point: THREE.Vector3, normal?: THREE.Vector3 | null): DSel | null {
  const q = normal ? point.clone().addScaledVector(normal, -0.003) : point
  const p: Vec2 = [q.x * 1000, q.z * 1000], y = q.y
  let best: { id: string; vol: number } | null = null
  for (const s of solids) {
    if (s.replaces || !s.ids.length || y < s.z0 - 0.004 || y > s.z1 + 0.004) continue
    if (!s.polygons.some(rings => inPoly(p, rings))) continue
    const vol = s.z1 - s.z0
    if (!best || vol < best.vol) best = { id: s.ids[0], vol }
  }
  if (best) { const hit = findItem(decor, best.id); if (hit) return { k: hit.k, id: best.id } as DSel }
  // 墙上的壁龛、挖洞（替换墙上扣出来的凹槽）
  for (const e of embedsOf(plan, decor)) {
    const r = decor.recesses.find(x => x.id === e.id)
    if (!r) continue
    try {
      const fp = embedFootprint(plan, e), w = plan.walls.find(x => x.id === e.face.wall), el = w ? levelOf(plan, w).elevation : 0
      const pp: Vec2 = [point.x * 1000, point.z * 1000]
      if (pointInPolygon(pp, fp) && point.y >= el + e.z[0] - 0.01 && point.y <= el + e.z[1] + 0.01) return { k: 'recess', id: r.id }
    } catch { /* 挂不上 */ }
  }
  return null
}

/** 点到一面墙：分清哪一侧，s = 沿墙的位置（mm） */
export function faceOfWallHit(plan: Plan, wallId: string, point: THREE.Vector3, normal?: THREE.Vector3 | null): DSel | null {
  const w = plan.walls.find(x => x.id === wallId)
  if (!w) return null
  const p: Vec2 = [point.x * 1000, point.z * 1000], d = wallDir(w), n = wallNormal(w)
  const s = Math.max(0, Math.min(wallLength(w), (p[0] - w.a[0]) * d[0] + (p[1] - w.a[1]) * d[1]))
  const off = (p[0] - w.a[0]) * n[0] + (p[1] - w.a[1]) * n[1]
  let side: 1 | -1
  if (normal && Math.abs(normal.y) < 0.6 && Math.abs(normal.x * n[0] + normal.z * n[1]) > 0.6) side = normal.x * n[0] + normal.z * n[1] > 0 ? 1 : -1
  else side = indoorSide(plan, w.id) ?? (off >= 0 ? 1 : -1) // 墙顶、洞口侧壁：默认室内一侧
  return { k: 'face', face: { wall: w.id, side }, s }
}
