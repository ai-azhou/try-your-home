/**
 * 楼层（S2a）：界面层的薄包装。2D 只画当前层（core onLevel 的只读视图），编辑仍落在完整方案上。
 * 单层方案（没有 levels）时一切照旧：视图就是完整方案，新构件不写 level 字段。
 */
import type { Plan, Vec2 } from '@/core/types'
import { levelsOf, onLevel } from '@/core/levels'
import { hitTest, hitTestExtra } from '@/core/geometry'
import type { Ref } from './model'

export const isMultiLevel = (plan: Plan | null | undefined) => !!plan && levelsOf(plan).length > 1

/** 当前楼层 id：store.level 不存在于方案里时退回第一层 */
export function curLevelId(plan: Plan, level: string | null): string {
  const levels = levelsOf(plan)
  return levels.find(l => l.id === level)?.id ?? levels[0].id
}

let cache: { plan: Plan | null; id: string; view: Plan | null } = { plan: null, id: '', view: null }
/** 当前层的只读视图（单层方案直接返回原方案，引用不变，下游 useMemo 不会白算） */
export function levelView(plan: Plan, levelId: string): Plan {
  if (!isMultiLevel(plan)) return plan
  if (cache.plan !== plan || cache.id !== levelId) cache = { plan, id: levelId, view: onLevel(plan, levelId) }
  return cache.view!
}

/** 新建构件写的楼层字段：第一层不写（和单层方案一致），其他层写 level */
export function levelField(plan: Plan, levelId: string): { level?: string } {
  return levelsOf(plan)[0].id === levelId ? {} : { level: levelId }
}

/**
 * 平面点选（当前层视图上调）：柱（压在墙上的墙垛也算）→ 门窗 → 墙 → 管道井 → 梁 → 楼梯 → 挑空 → 房间。
 * 小而「实」的构件先认，大面积的房间最后。
 */
export function pickAll(plan: Plan, p: Vec2, tol: number): Ref | null {
  const col = hitTestExtra({ ...plan, shafts: [], stairs: [], voids: [] }, p, 0)
  if (col) return col
  const ow = hitTest({ ...plan, beams: [], rooms: [] }, p, tol)
  if (ow) return ow
  const shaft = hitTestExtra({ ...plan, columns: [], stairs: [], voids: [] }, p, tol)
  if (shaft) return shaft
  const beam = hitTest({ ...plan, walls: [], openings: [], rooms: [] }, p, tol)
  if (beam) return beam
  const sv = hitTestExtra({ ...plan, columns: [], shafts: [] }, p, tol)
  if (sv) return sv
  return hitTest({ ...plan, walls: [], openings: [], beams: [] }, p, tol)
}
