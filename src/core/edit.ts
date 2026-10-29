import { mirrorDecor } from './decor/mirror.ts'
import { bounds as decorBounds } from './decor/math.ts'
import clipping from 'polygon-clipping'
import { DEFAULTS } from './types.ts'
import type { Beam, Change, ElementType, Opening, OpeningKind, Plan, Room, Vec2, Wall, WallKind } from './types.ts'
import { applyChanges } from './changes.ts'
import { newId } from './io.ts'
import { add, clamp, distance, dot, effectiveWallHeight, jointsAt, planBounds, pointInPolygon, sliceWall, sub, wallLength, wallNormal } from './geometry.ts'
import { wallFootprints } from './walls.ts'
import { mirrorBounds } from './mirror-frame.ts'
import type { ElementRef } from './geometry.ts'
import { onLevel } from './levels.ts'
export { shaftRemovalError } from './protection.ts'
let sequence = 0
function change(op: Change['op'], type: Change['type'], target?: string, data?: Record<string, unknown>, plan?: Plan): Change {
  const id = plan ? newId(plan, 'change') : `edit-${Date.now().toString(36)}-${++sequence}`
  return { id, op, type, ...(target ? { target } : {}), ...(data ? { data } : {}), by: 'user', status: 'confirmed' }
}
export function bakeChange(plan: Plan, c: Change): Plan { const { plan: next, results } = applyChanges(plan, [c]); if (!results[0].ok) throw new Error(results[0].error ?? '改造未执行'); return next }
export function addWall(plan: Plan, a: Vec2, b: Vec2, kind: WallKind = 'partition', opts: Partial<Omit<Wall, 'a' | 'b' | 'kind'>> = {}): Change { return change('add', 'wall', undefined, { id: newId(plan, 'wall'), thickness: DEFAULTS.thickness[kind], ...opts, a, b, kind }, plan) }
export function updateWall(id: string, patch: Partial<Omit<Wall, 'id'>>): Change { return change('update', 'wall', id, patch) }
export function moveJoint(plan: Plan, p: Vec2, to: Vec2): Change[] {
  const group = newId(plan, 'joint'), byWall = new Map<string, Partial<Wall>>()
  const joints = jointsAt(plan, p)
  for (const { wall, end } of joints) byWall.set(wall.id, { ...byWall.get(wall.id), [end]: [...to] })
  const changes = [...byWall].map(([id, patch]) => ({ ...updateWall(id, patch), group }))
  if (!joints.length) return changes
  const walls = [...new Map(joints.map(j => [j.wall.id, j.wall])).values()]
  const radius = Math.hypot(...walls.map(w => w.thickness / 2)) + 30
  const delta = sub(to, p)
  for (const room of plan.rooms) {
    let moved = false
    const poly = room.poly.map(vertex => {
      const offset = sub(vertex, p)
      if (distance(vertex, p) > radius || !walls.every(w => Math.abs(dot(offset, wallNormal(w))) <= w.thickness / 2 + 30)) return vertex
      moved = true
      return add(vertex, delta)
    })
    if (moved) changes.push({ ...updateRoom(room.id, { poly }), group })
  }
  return changes
}
export function removeElement(plan: Plan, ref: ElementRef): Change { return change('remove', ref.type, ref.id, undefined, plan) }
export function splitWall(plan: Plan, id: string, s: number): Plan {
  const next = structuredClone(plan), w = next.walls.find(w => w.id === id)
  if (!w) throw new Error(`墙 ${id} 不存在`)
  const len = wallLength(w)
  if (!Number.isFinite(s) || s <= 0 || s >= len) throw new Error('分割点必须在墙内部')
  if (next.openings.some(o => o.wall === id && o.offset < s && o.offset + o.width > s)) throw new Error('分割点穿过洞口，请移至洞口之外')
  const first = sliceWall(w, 0, s), second = { ...sliceWall(w, s, len), id: newId(next, `${id}~split`) }
  next.walls.splice(next.walls.indexOf(w), 1, first, second)
  for (const o of next.openings) if (o.wall === id && o.offset >= s) { o.wall = second.id; o.offset -= s }
  return next
}
export type EditResult = Change | { error: string }
function placeOpening(plan: Plan, wall: Wall, offset: number, width: number, except?: string): number | null {
  const length = wallLength(wall)
  if (width <= 0 || width > length || !Number.isFinite(offset)) return null
  const occupied = plan.openings.filter(o => o.wall === wall.id && o.id !== except).sort((a, b) => a.offset - b.offset)
  const slots: [number, number][] = []; let end = 0
  for (const o of occupied) { if (o.offset - end >= width) slots.push([end, o.offset - width]); end = Math.max(end, o.offset + o.width) }
  if (length - end >= width) slots.push([end, length - width])
  if (!slots.length) return null
  return slots.map(([a, b]) => clamp(offset, a, b)).sort((a, b) => Math.abs(a - offset) - Math.abs(b - offset))[0]
}
/** s is the desired near-end distance, measured from wall.a. */
export function addOpening(plan: Plan, wallId: string, s: number, kind: OpeningKind): EditResult {
  const wall = plan.walls.find(w => w.id === wallId)
  if (!wall) return { error: `墙 ${wallId} 不存在` }
  const defaults = DEFAULTS.opening[kind]
  if (!defaults) return { error: '洞口类型不认识' }
  const width = Math.min(defaults.width, wallLength(wall)), offset = placeOpening(plan, wall, s, width), head = Math.min(defaults.head, effectiveWallHeight(plan, wall))
  if (offset === null || head <= defaults.sill) return { error: '墙上没有足够空间放置洞口' }
  return change('add', 'opening', undefined, { id: newId(plan, 'opening'), wall: wallId, offset, ...defaults, width, head, kind, ...(kind === 'door' ? { swing: { hinge: 'start', side: 1 } } : {}) }, plan)
}
export function moveOpening(plan: Plan, id: string, s: number, wallId?: string): EditResult {
  const o = plan.openings.find(o => o.id === id), wall = plan.walls.find(w => w.id === (wallId ?? o?.wall))
  if (!o || !wall) return { error: '洞口或宿主墙不存在' }
  const offset = placeOpening(plan, wall, s, o.width, id)
  if (offset === null) return { error: '墙上没有足够空间移动洞口' }
  return change('update', 'opening', id, { wall: wall.id, offset }, plan)
}
export function updateOpening(id: string, patch: Partial<Omit<Opening, 'id'>>): Change { return change('update', 'opening', id, patch) }
export function addBeam(plan: Plan, a: Vec2, b: Vec2, opts: Partial<Omit<Beam, 'a' | 'b'>> = {}): Change { return change('add', 'beam', undefined, { id: newId(plan, 'beam'), a, b, ...DEFAULTS.beam, ...opts }, plan) }
export function updateBeam(id: string, patch: Partial<Omit<Beam, 'id'>>): Change { return change('update', 'beam', id, patch) }
/** 新增柱 / 管道井 / 楼梯 / 挑空（以及任何构件）：data 是完整对象，缺 id 时按类型生成 */
export function addElement(plan: Plan, type: ElementType, data: Record<string, unknown>): Change {
  return change('add', type, undefined, { ...data, id: typeof data.id === 'string' && data.id ? data.id : newId(plan, type) }, plan)
}
/** 修改任何构件的字段（柱、管道井、楼梯、挑空用；墙 / 洞口 / 梁 / 房间也有各自的 update*） */
export function updateElement(type: ElementType, id: string, patch: Record<string, unknown>): Change { return change('update', type, id, patch) }
export function addRoom(poly: Vec2[], name: string): Change { const c = change('add', 'room'); c.data = { id: `room-${c.id}`, name, poly }; return c }
export function updateRoom(id: string, patch: Partial<Omit<Room, 'id'>>): Change { return change('update', 'room', id, patch) }
export function detectRoom(plan: Plan, p: Vec2, levelId?: string): Vec2[] | null {
  if (levelId) plan = onLevel(plan, levelId)
  const bounds = planBounds(plan)
  if (!bounds || !plan.walls.length) return null
  const pad = 1000, [x0, y0, x1, y1] = [bounds[0] - pad, bounds[1] - pad, bounds[2] + pad, bounds[3] + pad], outer: Vec2[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
  const polys = wallFootprints(plan)
  if (!polys.length) return null
  const union = clipping.union(polys[0], ...polys.slice(1)), free = clipping.difference([outer], union)
  const found = free.find(poly => pointInPolygon(p, poly[0] as Vec2[]) && !poly.slice(1).some(h => pointInPolygon(p, h as Vec2[])) && !poly[0].some(v => v[0] <= x0 + .01 || v[0] >= x1 - .01 || v[1] <= y0 + .01 || v[1] >= y1 - .01))
  // Room has no holes in the contract. Reject courtyards/islands instead of filling them silently.
  if (!found || found.length > 1) return null
  let poly = (found[0] as Vec2[]).slice(0, -1)
  poly = poly.filter((b, i) => { const a = poly[(i + poly.length - 1) % poly.length], c = poly[(i + 1) % poly.length]; return Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) > 1e-5 })
  return poly.length >= 3 ? poly : null
}
/** axis x reflects x coordinates; axis y reflects y coordinates. Legacy source remains archival. */
export function mirrorPlan(plan: Plan, axis: 'x' | 'y'): Plan {
  const next = structuredClone(plan), bounds = mirrorBounds(plan) ?? (plan.decor?.furniture.length ? decorBounds(plan.decor.furniture.map(f => f.at)) : plan.decor?.cabinets.some(c => 'at' in c.place) ? decorBounds(plan.decor.cabinets.flatMap(c => 'at' in c.place ? [c.place.at] : [])) : null)
  if (!bounds) return next
  const index = axis === 'x' ? 0 : 1
  let sum = bounds[index] + bounds[index + 2]
  const cacheKey = '__structureMirror'
  const cache = (next.legacy?.[cacheKey] ?? {}) as Record<string, any>, previous = cache[axis]
  if (previous && Math.abs(previous.sum - sum) < 1e-6) sum = previous.sum
  const state: any = { legacyAbsent: next.legacy === undefined, corrections: {}, boxes: {}, sum }
  const reflected = (value: number, key: string) => {
    const saved = previous?.corrections?.[key]
    if (saved?.[0] === value) return saved[1] as number
    const result = sum - value
    if (sum - result !== value) state.corrections[key] = [result, value]
    return result
  }
  const mirror = (p: Vec2, key: string): Vec2 => index === 0 ? [reflected(p[0], key), p[1]] : [p[0], reflected(p[1], key)]
  const transform = (o: any, type: string, key: string) => {
    if (o.a) o.a = mirror(o.a, key + '.a'); if (o.b) o.b = mirror(o.b, key + '.b')
    if (o.center) o.center = mirror(o.center, key + '.center')
    if (o.path) o.path = o.path.map((p: Vec2, i: number) => mirror(p, key + '.path.' + i))
    if (type === 'column' && o.rotation !== undefined) o.rotation = -o.rotation
    if (o.poly) o.poly = o.poly.map((p: Vec2, i: number) => mirror(p, key + '.poly.' + i))
    if (type === 'wall' && o.bulge !== undefined) o.bulge = -o.bulge
    if (o.swing?.side !== undefined) o.swing.side = -o.swing.side
  }
  next.walls.forEach(w => transform(w, 'wall', 'wall.' + w.id)); next.beams.forEach(b => transform(b, 'beam', 'beam.' + b.id)); next.rooms.forEach(r => transform(r, 'room', 'room.' + r.id)); next.openings.forEach(o => {
    if (o.kind === 'door' && !o.swing) { o.swing = { hinge: 'start', side: 1 }; (state.defaultSwings ??= []).push(o.id) }
    transform(o, 'opening', 'opening.' + o.id)
    if (previous?.defaultSwings?.includes(o.id) && o.swing?.hinge === 'start' && o.swing.side === 1) delete o.swing
  })
  for (const [type, items] of [['column', next.columns], ['shaft', next.shafts], ['stair', next.stairs], ['void', next.voids]] as const) items?.forEach(e => transform(e, type, type + '.' + e.id))
  next.changes.forEach(c => {
    if (!c.data || c.op === 'remove') return
    if (c.type === 'opening' && c.op === 'add' && c.data.kind === 'door' && !c.data.swing) {
      c.data.swing = { hinge: 'start', side: 1 }; (state.defaultChangeSwings ??= []).push(c.id)
    }
    transform(c.data, c.type, 'change.' + c.id)
    const swing = c.data.swing as Opening['swing']
    if (previous?.defaultChangeSwings?.includes(c.id) && swing?.hinge === 'start' && swing.side === 1) delete c.data.swing
  })
  for (const q of next.questions) if (q.bbox) {
    const before = [...q.bbox], old = previous?.boxes?.[q.id]
    if (old && JSON.stringify(old.after) === JSON.stringify(q.bbox)) q.bbox = old.before
    else {
      const a = mirror([q.bbox[0], q.bbox[1]], 'q.' + q.id + '.a'), b = mirror([q.bbox[2], q.bbox[3]], 'q.' + q.id + '.b')
      q.bbox = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]
    }
    state.boxes[q.id] = { before, after: [...q.bbox!] }
  }
  if (next.north !== undefined) {
    state.northBefore = next.north
    next.north = previous?.northAfter === next.north ? previous.northBefore : axis === 'x' ? -next.north : 180 - next.north
    state.northAfter = next.north
  }
  const underlays = [...(next.underlay ? [['default', next.underlay] as const] : []), ...Object.entries(next.levelUnderlays ?? {})]
  for (const [underlayId, u] of underlays) {
    const oldState = previous?.underlays?.[underlayId] ?? (underlayId === 'default' ? previous : undefined)
    const underlayState: any = {}
    const key = axis === 'x' ? 'flipX' : 'flipY', radians = (u.rotation ?? 0) * Math.PI / 180
    const sx = (u.flipX ? -1 : 1) * u.mmPerPx, sy = (u.flipY ? -1 : 1) * (u.mmPerPxY ?? u.mmPerPx)
    const dx = axis === 'x' ? sum : 0, dy = axis === 'y' ? sum : 0
    underlayState.originBefore = [...u.origin]; underlayState.absent = u[key] === undefined
    u.origin = oldState?.originAfter && JSON.stringify(oldState.originAfter) === JSON.stringify(u.origin)
      ? oldState.originBefore
      : [u.origin[0] + (Math.cos(radians) * dx + Math.sin(radians) * dy) / sx, u.origin[1] + (-Math.sin(radians) * dx + Math.cos(radians) * dy) / sy]
    underlayState.originAfter = [...u.origin]
    if (oldState?.absent) delete u[key]; else u[key] = !u[key]
    if (u.rotation !== undefined) u.rotation = -u.rotation
    ;(state.underlays ??= {})[underlayId] = underlayState
  }
  if (plan.decor) {
    state.decorBefore = structuredClone(plan.decor)
    next.decor = previous?.decorAfter && JSON.stringify(previous.decorAfter) === JSON.stringify(plan.decor)
      ? structuredClone(previous.decorBefore)
      : mirrorDecor(plan, axis, sum, (p, key) => mirror(p, 'decor.' + key))
    state.decorAfter = structuredClone(next.decor)
  }
  if (previous) delete cache[axis]; else cache[axis] = state
  if (Object.keys(cache).length) { next.legacy ??= {}; next.legacy[cacheKey] = cache }
  else { delete next.legacy?.[cacheKey]; if (previous?.legacyAbsent && next.legacy && !Object.keys(next.legacy).length) delete next.legacy }
  return next
}
