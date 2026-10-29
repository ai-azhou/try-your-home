/**
 * 界面对 core 的薄包装：查找构件、显示名、当前模式下的视图（重放 + 对比）。
 * 逻辑都在 core（changes.applyChanges / diffPlans / edit.elements），这里只把结果整理成界面要的形状。
 */
import type { Change, ElementType, Opening, Plan, PlanElement, Room, Wall } from '@/core/types'
import { applyChanges, collection, diffPlans, elements, type ChangeResult } from '@/core/changes'
import { polygonArea } from '@/core/geometry'

export type { ChangeResult }
export interface Ref { type: ElementType; id: string }
/** 装修（decor）是第四段：画改造后的结构（同改造态重放），结构只读 */
export type Mode = 'original' | 'renovation' | 'compare' | 'decor'

export function findEl(plan: Plan, ref: Ref): PlanElement | undefined {
  return elements(plan, ref.type).find(e => e.id === ref.id)
}
export function findAny(plan: Plan, id: string): Ref | null {
  for (const type of Object.keys(collection) as ElementType[]) if (elements(plan, type).some(e => e.id === id)) return { type, id }
  return null
}
export const roomArea = (r: Room) => polygonArea(r.poly) / 1e6

const kindZh: Record<string, string> = { exterior: '外墙', bearing: '承重墙', partition: '非承重墙', glass: '玻璃隔断', half: '矮墙', 'half-glass': '矮墙+玻璃' }
const openZh: Record<string, string> = { door: '平开门', sliding: '推拉门', doorway: '门洞', window: '窗', 'floor-window': '落地窗', 'bay-window': '飘窗', 'open-balcony': '未封阳台' }
const kindEn: Record<string, string> = { exterior: 'Exterior', bearing: 'Load-bearing', partition: 'Partition', glass: 'Glass', half: 'Half wall', 'half-glass': 'Half + glass' }
const openEn: Record<string, string> = { door: 'Door', sliding: 'Sliding', doorway: 'Doorway', window: 'Window', 'floor-window': 'Floor window', 'bay-window': 'Bay window', 'open-balcony': 'Open balcony' }

export function elementLabel(plan: Plan, ref: Ref, lang: 'zh' | 'en' = 'zh'): string {
  const el = findEl(plan, ref) as (PlanElement & { name?: string }) | undefined
  if (!el) return ref.id
  if (el.name) return el.name
  if (ref.type === 'wall') return (lang === 'zh' ? kindZh : kindEn)[(el as Wall).kind]
  if (ref.type === 'opening') return (lang === 'zh' ? openZh : openEn)[(el as Opening).kind]
  const extra: Record<string, [string, string]> = { column: ['柱', 'Column'], shaft: ['管道井', 'Shaft'], stair: ['楼梯', 'Stair'], void: ['挑空', 'Void'] }
  if (extra[ref.type]) return extra[ref.type][lang === 'zh' ? 0 : 1]
  return ref.id
}

/** 对比态要的形状：新增 / 修改用 Set 查，拆掉的带类型，待确认 = 重放时报 needsConfirm 的改造 */
export interface Diff { added: Set<string>; removed: Ref[]; modified: Set<string>; pending: Change[] }
export interface View { plan: Plan; base: Plan; results: ChangeResult[]; diff: Diff | null }

export function computeView(base: Plan, mode: Mode): View {
  if (mode === 'original') return { plan: base, base, results: [], diff: null }
  const { plan, results } = applyChanges(base, base.changes)
  const d = diffPlans(base, plan)
  const flat = (g: Record<ElementType, string[]>) => new Set(Object.values(g).flat())
  const removed = (Object.keys(d.removed) as ElementType[]).flatMap(type => d.removed[type].map(id => ({ type, id })))
  const pending = base.changes.filter(c => results.find(r => r.id === c.id)?.needsConfirm)
  return { plan, base, results, diff: { added: flat(d.added), modified: flat(d.modified), removed, pending } }
}
