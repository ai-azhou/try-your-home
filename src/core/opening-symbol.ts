import type { Opening, PaneKind, Plan, Vec2, Wall } from './types.ts'
import { add, arcParams, mul, pointAt, wallLength, wallTangent } from './geometry.ts'

/** Plan-space paths (mm). Only divisions are physical mullions; path vertices are curve tessellation. */
export interface OpeningSymbol {
  id: string; wall: string; curved: boolean; path: Vec2[]; edges: [Vec2[], Vec2[]]
  jambs: [Vec2, Vec2][]; divisions: [Vec2, Vec2][]
  leaves: { index: number; kind: PaneKind | 'door'; s: [number, number]; path: Vec2[]; footprint: Vec2[]; hinge?: Vec2 }[]
}
export function openingPath(w: Wall, from: number, to: number, depth = 0): Vec2[] {
  const arc = arcParams(w), n = arc ? Math.max(2, Math.ceil(Math.abs(to - from) / 150), Math.ceil(Math.abs(to - from) / wallLength(w) * Math.abs(arc.angle) / 5)) : 1
  return Array.from({ length: n + 1 }, (_, i) => {
    const s = from + (to - from) * i / n, d = wallTangent(w, s)
    return add(pointAt(w, s), mul([-d[1], d[0]], depth))
  })
}
export function openingStrip(w: Wall, from: number, to: number, thickness: number): Vec2[] {
  return [...openingPath(w, from, to, thickness / 2), ...openingPath(w, from, to, -thickness / 2).reverse()]
}
export function openingPanes(o: Opening): { width: number; kind: PaneKind | 'door' }[] {
  return o.kind === 'door' ? (o.panes?.length ? o.panes.map(p => ({ width: p.width, kind: 'door' as const })) : [{ width: 1, kind: 'door' }]) : o.kind === 'doorway' || o.kind === 'open-balcony' ? [] : o.panes?.length ? o.panes : o.kind === 'sliding' ? [{ width: 1, kind: 'sliding' }, { width: 1, kind: 'sliding' }] : [{ width: 1, kind: 'fixed' }]
}
export function openingSymbol(plan: Plan, id: string, opts: { doorAngle?: number } = {}): OpeningSymbol {
  const o = plan.openings.find(o => o.id === id), w = plan.walls.find(w => w.id === o?.wall)
  if (!o || !w) throw new Error(`洞口或宿主墙不存在：${id}`)
  const end = o.offset + o.width, edges: [Vec2[], Vec2[]] = [openingPath(w, o.offset, end, w.thickness / 2), openingPath(w, o.offset, end, -w.thickness / 2)]
  const divider = (s: number): [Vec2, Vec2] => {
    const p = pointAt(w, s), d = wallTangent(w, s), n: Vec2 = [-d[1], d[0]]
    return [add(p, mul(n, w.thickness / 2)), add(p, mul(n, -w.thickness / 2))]
  }
  const result: OpeningSymbol = { id, wall: w.id, curved: !!w.bulge, path: openingPath(w, o.offset, end), edges, jambs: [divider(o.offset), divider(end)], divisions: [], leaves: [] }
  const panes = openingPanes(o).filter(p => p.width > 0), total = panes.reduce((s, p) => s + p.width, 0)
  let from = o.offset
  panes.forEach((pane, index) => {
    const to = index === panes.length - 1 ? end : from + o.width * pane.width / total
    let path = openingPath(w, from, to), footprint = openingStrip(w, from, to, pane.kind === 'door' ? 40 : 30), hinge: Vec2 | undefined
    if (pane.kind === 'door') {
      const swing = o.swing ?? { hinge: panes.length > 1 && index === panes.length - 1 ? 'end' : 'start', side: 1 }, angle = Math.max(0, Math.min(90, opts.doorAngle ?? 60)) * Math.PI / 180 * swing.side * (swing.hinge === 'start' ? 1 : -1)
      hinge = pointAt(w, swing.hinge === 'start' ? from : to)
      const rotate = (p: Vec2): Vec2 => { const x = p[0] - hinge![0], y = p[1] - hinge![1]; return [hinge![0] + x * Math.cos(angle) - y * Math.sin(angle), hinge![1] + x * Math.sin(angle) + y * Math.cos(angle)] }
      path = path.map(rotate); footprint = footprint.map(rotate)
    }
    result.leaves.push({ index, kind: pane.kind, s: [from, to], path, footprint, ...(hinge ? { hinge } : {}) })
    if (index < panes.length - 1) result.divisions.push(divider(to))
    from = to
  })
  return result
}
