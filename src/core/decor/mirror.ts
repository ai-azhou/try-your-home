import type { Plan, Vec2 } from '../types.ts'
import type { Decor, FaceRef } from './types.ts'
import { layoutCabinet } from './cabinets.ts'
import { panelSpan } from './panels.ts'
/** Derived mirror. mirrorPlan maintains original optional-field/roundoff state for exact round trips. */
export function mirrorDecor(plan: Plan, axis: 'x' | 'y', sum: number, mirrorPoint?: (p: Vec2, key: string) => Vec2): Decor | undefined {
  if (!plan.decor) return undefined
  const d = structuredClone(plan.decor), index = axis === 'x' ? 0 : 1
  const point = mirrorPoint ?? ((p: Vec2): Vec2 => index === 0 ? [sum - p[0], p[1]] : [p[0], sum - p[1]])
  const face = (f: FaceRef) => { f.side = -f.side as 1 | -1 }, interval = (u: [number, number], width: number): [number, number] => [width - u[1], width - u[0]]
  for (const door of d.doors ?? []) if (door.front) door.flip = !door.flip
  for (const f of d.furniture) { f.flip = !f.flip; if (f.at) f.at = point(f.at, `furniture.${f.id}`); if (f.rot !== undefined) f.rot = f.in ? -f.rot : axis === 'x' ? -f.rot : 180 - f.rot; if (f.against) face(f.against.face) }
  for (const f of d.furniture) if (f.in) {
    const match = /^(.*):cell:(\d+):(\d+)$/.exec(f.in)
    const cabinet = match && plan.decor.cabinets.find(c => c.id === match[1])
    if (match && cabinet) f.in = `${match[1]}:cell:${cabinet.columns.length - 1 - Number(match[2])}:${match[3]}`
  }
  for (const c of d.cabinets) {
    const layout = layoutCabinet(c)
    if ('face' in c.place) face(c.place.face); else { c.place.at = point(c.place.at, `cabinet.${c.id}`); c.place.rot = axis === 'x' ? -c.place.rot : 180 - c.place.rot }
    c.columns = c.columns.map((col, i) => ({ ...col, width: layout.columns[i].width, cells: col.cells.map(cell => ({ ...cell, ...(cell.hinge ? { hinge: cell.hinge === 'left' ? 'right' as const : 'left' as const } : {}) })) })).reverse()
    for (const cut of c.cuts ?? []) cut.u = interval(cut.u, c.width)
  }
  for (const p of d.panels) {
    if (p.span) face(p.span.face)
    else if (p.type === 'arch') { const span = panelSpan(plan, p); p.span = { ...span, face: { ...span.face, side: -span.face.side as 1 | -1 } } }
  }
  for (const r of d.recesses) {
    if ('face' in r.host) face(r.host.face)
    else if (r.rect.u) {
      const host = 'panel' in r.host ? plan.decor.panels.find(p => p.id === (r.host as { panel: string }).panel) : plan.decor.cabinets.find(c => c.id === (r.host as { cabinet: string }).cabinet)
      if (host) { const width = 'width' in host ? host.width : (() => { const s = panelSpan(plan, host); return s.s[1] - s.s[0] })(); r.rect.u = interval(r.rect.u, width) }
    }
  }
  for (const s of d.surfaces) {
    if ('face' in s.target) face(s.target.face)
    if (s.layout?.origin) s.layout.origin = point(s.layout.origin, `surface.${s.id}`)
    if (s.layout?.angle !== undefined) s.layout.angle = axis === 'x' ? 180 - s.layout.angle : -s.layout.angle
  }
  for (const [id, cache] of Object.entries(d.cache ?? {})) {
    const a = point([cache.box[0], cache.box[1]], `cache.${id}.a`), b = point([cache.box[2], cache.box[3]], `cache.${id}.b`)
    cache.box = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]
    if (cache.anchor) { cache.anchor.a = point(cache.anchor.a, `cache.${id}.anchor.a`); cache.anchor.b = point(cache.anchor.b, `cache.${id}.anchor.b`) }
    if (cache.pose) { cache.pose.at = point(cache.pose.at, `cache.${id}.pose`); cache.pose.rot = axis === 'x' ? -cache.pose.rot : 180 - cache.pose.rot }
    if (cache.face) cache.face = cache.face.map((p, i) => point(p, `cache.${id}.face.${i}`)) as [Vec2, Vec2]
  }
  // Snapshots are world-space items too; mirror them against the same source hosts.
  const snapshot = structuredClone(plan.decor)
  let hasPrev = false
  for (const key of ['furniture', 'cabinets', 'panels', 'recesses', 'surfaces', 'doors'] as const) if (snapshot[key]) snapshot[key] = snapshot[key]!.map(item => {
    if (!item.prev) return item
    hasPrev = true
    const old = structuredClone(item.prev); delete old.prev
    return old
  }) as never
  if (hasPrev) {
    const mirrored = mirrorDecor({ ...plan, decor: snapshot }, axis, sum)!
    for (const key of ['furniture', 'cabinets', 'panels', 'recesses', 'surfaces', 'doors'] as const) for (const item of d[key] ?? []) if (item.prev) item.prev = mirrored[key]?.find(v => v.id === item.id) as unknown as Record<string, unknown>
  }
  return d
}
