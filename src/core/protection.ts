import type { Plan } from './types.ts'
/** Runtime guard also catches a malformed/forward-compatible Change targeting a shaft. */
export function shaftRemovalError(plan: Plan, target?: string): string | undefined {
  return plan.shafts?.some(s => s.id === target) ? '管道井 / 烟道不能拆' : undefined
}
