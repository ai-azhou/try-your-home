import type { Box, Plan, Vec2 } from './types.ts'
import { planBounds } from './geometry.ts'

/** Replayed plans retain their source frame so mirror and replay use the same axis. */
export function mirrorBounds(plan: Plan): Box | null {
  const stored = plan.legacy?.__structureReplayFrame
  if (Array.isArray(stored) && stored.length === 4 && stored.every(v => typeof v === 'number' && Number.isFinite(v))) return stored as Box
  const bounds = planBounds(plan)
  if (bounds) return bounds
  const points = plan.changes.flatMap(c => {
    const d = c.data ?? {}
    return [d.a, d.b, ...(Array.isArray(d.poly) ? d.poly : [])].filter((p): p is Vec2 => Array.isArray(p) && p.length === 2 && p.every(v => typeof v === 'number' && Number.isFinite(v)))
  })
  return points.length ? [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))] : null
}
