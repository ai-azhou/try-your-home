import type { Plan } from './types.ts'

/** Full-plan snapshots keep original geometry and renovation geometry in the same coordinate frame. */
export interface PlanHistory { past: Plan[]; future: Plan[] }
export const emptyHistory = (): PlanHistory => ({ past: [], future: [] })
export function recordHistory(history: PlanHistory, before: Plan): PlanHistory {
  return { past: [...history.past, before].slice(-100), future: [] }
}
export function stepHistory(history: PlanHistory, current: Plan, direction: 'undo' | 'redo'): { plan: Plan; history: PlanHistory } | null {
  if (direction === 'undo') {
    const plan = history.past.at(-1)
    return plan ? { plan, history: { past: history.past.slice(0, -1), future: [current, ...history.future].slice(0, 100) } } : null
  }
  const plan = history.future[0]
  return plan ? { plan, history: { past: [...history.past, current].slice(-100), future: history.future.slice(1) } } : null
}
