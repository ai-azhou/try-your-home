/** 2D styles consume core's joined, opening-aware wall outlines. */
import clipping from 'polygon-clipping'
import type { Plan, Vec2, Wall, WallKind } from '@/core/types'
import { wallOutlines } from '@/core/walls'
export { solidIntervals } from '@/core/walls'

/** Compatibility for existing layer callers; all joining now happens in core footprints. */
export const withJoinedCorners = (plan: Plan): Plan => plan

/** One wall, retaining the complete plan's junction context. */
export function wallSolidPolys(plan: Plan, w: Wall): Vec2[][] {
  return wallOutlines(plan, candidate => candidate.id === w.id).map(rings => rings[0])
}

/** 画的先后：硬的先占（墙角归更「硬」的那面），后来的扣掉已占的部分 */
const HARDNESS: Record<WallKind, number> = { exterior: 0, bearing: 1, partition: 2, glass: 3, 'half-glass': 4, half: 5 }

export interface WallGroup { key: string; kind: WallKind; polys: Vec2[][][] }
/** 按 key（通常 = 墙类型 + 显示状态）把墙并成多边形组；T 形、L 形交接没有缝 */
export function wallGroups(plan: Plan, keyOf: (w: Wall) => string): WallGroup[] {
  const byKey = new Map<string, { kind: WallKind; ids: Set<string> }>()
  for (const w of [...plan.walls].sort((a, b) => HARDNESS[a.kind] - HARDNESS[b.kind])) {
    const k = keyOf(w)
    const g = byKey.get(k) ?? { kind: w.kind, ids: new Set<string>() }
    g.ids.add(w.id)
    byKey.set(k, g)
  }
  const out: WallGroup[] = []
  let occupied: Vec2[][][] = []
  for (const [key, g] of byKey) {
    const merged = wallOutlines(plan, w => g.ids.has(w.id))
    if (!merged.length) continue
    const polys = occupied.length ? clipping.difference(merged, occupied) as Vec2[][][] : merged
    if (polys.length) out.push({ key, kind: g.kind, polys })
    occupied = occupied.length ? clipping.union(occupied, merged) as Vec2[][][] : merged
  }
  return out
}

export function multiPolyPath(polys: Vec2[][][]): string {
  return polys.map(rings => rings.map(r => r.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('') + 'Z').join('')).join('')
}
