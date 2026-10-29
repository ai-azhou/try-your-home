import type { Level, Opening, Plan } from './types.ts'

/** Array order is floor order; validatePlan requires strictly increasing elevations. */
export function levelsOf(plan: Plan): Level[] {
  return plan.levels?.length ? plan.levels : [{ id: 'L1', name: '1F', elevation: 0 }]
}
export function levelOf(plan: Plan, element: { level?: string } | Opening): Level {
  const levels = levelsOf(plan)
  const id = 'wall' in element ? plan.walls.find(w => w.id === element.wall)?.level : element.level
  return levels.find(l => l.id === id) ?? levels[0]
}
export function levelCeiling(plan: Plan, levelId: string): number {
  return levelsOf(plan).find(l => l.id === levelId)?.ceiling ?? plan.ceiling
}
/** Enables additive result metadata only for plans that actually use the extension. */
export function hasLevelData(plan: Plan): boolean {
  return !!(plan.levels?.length || plan.columns?.length || plan.shafts?.length || plan.stairs?.length || plan.voids?.length)
}
/** Read-only view: retains levels so omitted level fields still refer to the original first floor. */
export function onLevel(plan: Plan, levelId: string): Plan {
  const matches = (e: { level?: string } | Opening) => levelOf(plan, e).id === levelId
  return { ...plan, ceiling: levelCeiling(plan, levelId), walls: plan.walls.filter(matches),
    openings: plan.openings.filter(matches), beams: plan.beams.filter(matches), rooms: plan.rooms.filter(matches),
    questions: plan.questions.filter(matches),
    ...(plan.columns ? { columns: plan.columns.filter(matches) } : {}),
    ...(plan.shafts ? { shafts: plan.shafts.filter(matches) } : {}),
    ...(plan.stairs ? { stairs: plan.stairs.filter(matches) } : {}),
    ...(plan.voids ? { voids: plan.voids.filter(matches) } : {}),
    ...(plan.levelUnderlays?.[levelId] ? { underlay: plan.levelUnderlays[levelId] } : {}),
  }
}

export function assertLevel(plan: Plan, level?: string): void {
  if (level !== undefined && !levelsOf(plan).some(l => l.id === level)) throw new Error(`未知楼层：${level}`)
}
