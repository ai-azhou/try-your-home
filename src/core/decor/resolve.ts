import { applyChanges } from '../changes.ts'
import type { Plan, Vec2 } from '../types.ts'
import type { Cabinet, Decor, DecorIssue, FaceRef, FaceSpan, Furniture, Panel, Recess, Surface, DoorFinish } from './types.ts'
import { add, dot, mul, sub, wallDir, wallLength, pointInPolygon, roomsBesideWall } from '../geometry.ts'
import { levelOf } from '../levels.ts'
import { cabinetFootprint, cabinetTransform } from './cabinets.ts'
import { faceAxis, faceFrame, faceRun } from './faces.ts'
import { furnitureFootprint, furniturePose } from './furniture.ts'
import { panelSpan, panelTransform } from './panels.ts'
import { validateDecorRaw } from './validate.ts'
import { bounds, ordered } from './math.ts'
export type DecorItem = Furniture | Cabinet | Panel | Recess | Surface | DoorFinish
export const decorItems = (d: Decor): DecorItem[] => [...d.surfaces, ...d.furniture, ...d.cabinets, ...d.panels, ...d.recesses, ...(d.doors ?? [])]
export function itemSpan(plan: Plan, item: DecorItem): FaceSpan | undefined {
  if ('span' in item || 'thickness' in item) return panelSpan(plan, item as Panel)
  if ('place' in item) return 'face' in item.place ? { face: item.place.face, s: [item.place.s, item.place.s + item.width], z: item.z } : undefined
  if ('host' in item) return 'face' in item.host && item.rect.s ? { face: item.host.face, s: item.rect.s, z: item.rect.z } : undefined
  if ('target' in item && 'face' in item.target) { const a = faceAxis(plan, item.target.face); return { face: item.target.face, s: item.target.s ?? [0, a.length], z: item.target.z ?? [0, plan.ceiling] } }
  if ('against' in item && item.against) {
    const a = faceAxis(plan, item.against.face), values = furnitureFootprint(item, plan).map(p => dot(sub(p, a.wall.a), wallDir(a.wall)))
    return { face: item.against.face, s: [Math.min(...values), Math.max(...values)], z: [item.z ?? 0, (item.z ?? 0) + item.height] }
  }
}
/** Local horizontal u and outward depth to plan coordinates; recesses use the host's left origin. */
export function hostTransform(plan: Plan, decor: Decor, id: string): ((u: number, depth: number) => Vec2) | undefined {
  const panel = decor.panels.find(p => p.id === id); if (panel) return panelTransform(plan, panel)
  const cabinet = decor.cabinets.find(c => c.id === id); if (cabinet) return cabinetTransform(plan, cabinet)
  const recess = decor.recesses.find(r => r.id === id)
  if (!recess) return undefined
  if ('face' in recess.host && recess.rect.s) { const a = faceAxis(plan, recess.host.face), start = Math.min(...recess.rect.s.map(a.toU)); return (u, d) => a.at(a.toS(start + u), d) }
  const parent = 'panel' in recess.host ? panelTransform(plan, decor.panels.find(p => p.id === (recess.host as { panel: string }).panel)!) : 'cabinet' in recess.host ? cabinetTransform(plan, decor.cabinets.find(c => c.id === (recess.host as { cabinet: string }).cabinet)!) : undefined
  return parent && ((u, d) => parent(u + (recess.rect.u?.[0] ?? 0), d))
}
export function itemFootprint(plan: Plan, decor: Decor, item: DecorItem): Vec2[] {
  if ('size' in item) return furniturePose({ ...plan, decor }, item).footprint
  if ('place' in item) return cabinetFootprint(plan, item)
  if ('thickness' in item) { const g = panelSpan(plan, item), at = panelTransform(plan, item), width = g.s[1] - g.s[0]; return [at(0, 0), at(width, 0), at(width, item.type === 'slats' ? item.slats?.depth ?? item.thickness : item.thickness), at(0, item.type === 'slats' ? item.slats?.depth ?? item.thickness : item.thickness)] }
  if ('host' in item) {
    const at = hostTransform(plan, decor, item.id); if (!at) return []
    const width = item.rect.u ? item.rect.u[1] - item.rect.u[0] : item.rect.s ? item.rect.s[1] - item.rect.s[0] : 0
    const host = 'panel' in item.host ? decor.panels.find(p => p.id === (item.host as { panel: string }).panel) : 'cabinet' in item.host ? decor.cabinets.find(c => c.id === (item.host as { cabinet: string }).cabinet) : undefined
    const thick = host ? 'thickness' in host ? (host.type === 'slats' ? host.slats?.depth ?? host.thickness : host.thickness) : host.depth : 0, dep = item.depth === 'through' ? thick : item.depth
    return [at(0, thick), at(width, thick), at(width, thick - dep), at(0, thick - dep)]
  }
  if (!('target' in item)) return []
  if ('floor' in item.target || 'ceiling' in item.target) return plan.rooms.find(r => r.id === ('floor' in item.target ? item.target.floor : 'ceiling' in item.target ? item.target.ceiling : ''))?.poly ?? []
  const a = faceAxis(plan, item.target.face), s = item.target.s ?? [0, a.length]
  return [a.at(s[0]), a.at(s[1]), a.at(s[1], 1), a.at(s[0], 1)]
}
export interface PlacedDecor { id: string; status: 'placed' | 'moved' | 'missing'; text: '挂得上' | '挪到剩下那段' | '没地方挂了'; reasons: string[]; footprint: Vec2[]; face?: { a: Vec2; b: Vec2; side: 1 | -1 }; level: string; item: DecorItem }
export interface DecorResolution { decor?: Decor; placed: PlacedDecor[]; items: PlacedDecor[]; issues: DecorIssue[] }
/** Overloads cover the task's before/after form and the draft's already-applied-plan/decor form. */
export function resolveDecor(plan: Plan, structureAfterChanges: Plan): DecorResolution
export function resolveDecor(plan: Plan, decor?: Decor): DecorResolution
export function resolveDecor(plan: Plan, afterOrDecor?: Plan | Decor): DecorResolution {
  const after = afterOrDecor && 'walls' in afterOrDecor ? afterOrDecor : plan, source = afterOrDecor && !('walls' in afterOrDecor) ? afterOrDecor : plan.decor
  if (!source) return { placed: [], items: [], issues: [] }
  const decor = structuredClone(source), items = decorItems(decor), issues: DecorIssue[] = [], moved = new Set<string>(), missing = new Set<string>()
  const problem = (id: string, code: DecorIssue['code'], text: string) => { issues.push({ id, code, level: 'error', text, fix: ['move', 'clip', 'keep', 'delete'] }); missing.add(id) }
  const remap = (id: string, sp: FaceSpan): FaceSpan | undefined => {
    const saved = source.cache?.[id]?.anchor
    const original = plan.walls.find(w => w.id === sp.face.wall) ?? plan.walls.find(w => sp.face.wall.startsWith(w.id + '~')) ?? after.walls.find(w => sp.face.wall.startsWith(w.id + '~'))
    const before = saved?.wall === sp.face.wall && original ? { ...original, id: saved.wall, a: saved.a, b: saved.b } : original?.id === sp.face.wall ? original : undefined
    const current = after.walls.find(w => w.id === sp.face.wall)
    const root = sp.face.wall.split('~')[0]
    const split = (before && current && wallLength(current) > wallLength(before) + 1e-5 && (saved || plan.changes.some(c => c.op === 'remove' && c.type === 'wall' && c.target === root && c.range))) || sp.face.wall.includes('~') || after.walls.some(w => w.id.startsWith(`${sp.face.wall}~`)) || after.changes.some(c => c.type === 'wall' && c.op === 'remove' && c.target === sp.face.wall && c.range)
    if (!before || !split || before.bulge) {
      if (!current) { problem(id, 'host-missing', '宿主墙拆了，没地方挂了'); return }
      return sp
    }
    const dir = wallDir(before), candidates = after.walls.filter(w => (w.id === root || w.id.startsWith(`${root}~`)) && !w.bulge && levelOf(after, w).id === levelOf(plan, before).id)
    const match = candidates.find(w => { const ss = ordered(dot(sub(w.a, before.a), dir), dot(sub(w.b, before.a), dir)); return sp.s[0] >= ss[0] - 1e-5 && sp.s[1] <= ss[1] + 1e-5 })
    if (!match) { problem(id, candidates.length ? 'host-cut' : 'host-missing', candidates.length ? '构件跨过拆掉的墙段，需裁到剩下的墙上或挪位置' : '宿主墙拆了，没地方挂了'); return }
    const shift = dot(sub(match.a, before.a), dir), reversed = dot(wallDir(match), dir) < 0
    const s = ordered((sp.s[0] - shift) * (reversed ? -1 : 1), (sp.s[1] - shift) * (reversed ? -1 : 1)), face: FaceRef = { wall: match.id, side: (reversed ? -sp.face.side : sp.face.side) as 1 | -1 }
    if (face.wall !== sp.face.wall || s.some((v, i) => Math.abs(v - sp.s[i]) > 1e-7)) moved.add(id)
    return { ...sp, face, s }
  }
  for (const item of items) {
    if ('in' in item && item.in) continue
    let sp: FaceSpan | undefined
    try { sp = itemSpan(plan, item) } catch { try { sp = itemSpan(after, item) } catch { problem(item.id, 'host-missing', '装修宿主不存在'); continue } }
    if (!sp) continue
    const next = remap(item.id, sp); if (!next) { if ('against' in item) { delete item.against; missing.delete(item.id); const warning = issues.find(i => i.id === item.id && i.code === 'host-missing'); if (warning && plan.walls.some(w => w.id === sp!.face.wall)) warning.level = 'info' }; continue }
    if ('thickness' in item) { if (item.type !== 'arch') item.span = next; else if (item.span) item.span.face = next.face }
    else if ('place' in item && 'face' in item.place) { item.place.face = next.face; item.place.s = next.s[0] }
    else if ('host' in item && 'face' in item.host) { item.host.face = next.face; item.rect.s = next.s }
    else if ('target' in item && 'face' in item.target) { item.target.face = next.face; if (item.target.s) item.target.s = next.s }
    else if ('at' in item && item.against) {
      item.against.face = next.face
      const a = faceAxis(after, next.face), old = source.furniture.find(f => f.id === item.id)!, theta = Math.atan2(a.normal[1], a.normal[0]) * 180 / Math.PI - 90
      // Keep longitudinal offset; align the back to the new face using actual depth.
      if (after !== plan && (JSON.stringify(plan.walls.find(w => w.id === sp!.face.wall)) !== JSON.stringify(a.wall))) { item.rot = theta; item.at = a.at((next.s[0] + next.s[1]) / 2, item.against.gap + item.size[1] / 2 - (item.embed ?? 0)) } else item.at = [...old.at!]
    }
  }
  // Parent panels/cabinets resolve first. Local holes follow without rewriting their u coordinates.
  for (const r of decor.recesses) if (!('face' in r.host)) { const id = 'panel' in r.host ? r.host.panel : r.host.cabinet; if (missing.has(id)) problem(r.id, 'host-missing', `宿主 ${id} 没地方挂了`); else if (moved.has(id)) moved.add(r.id) }
  for (const f of decor.furniture) if (f.in) {
    const parent = f.in.split(':cell:')[0]
    if (moved.has(parent)) moved.add(f.id)
    if (missing.has(parent) || furniturePose({ ...after, decor }, f).missing) problem(f.id, 'host-missing', '家具的宿主链不存在')
  }
  const resolvedPlan = { ...after, decor }
  issues.push(...validateDecorRaw(resolvedPlan, decor, plan))
  // A shortened original wall keeps s; distinguish it from a previously continuous multi-wall run that was cut.
  for (const i of issues) if (i.code === 'host-cut' && after !== plan) {
    const item = items.find(x => x.id === i.id)
    try { const sp = item && itemSpan(plan, item), before = plan.walls.find(w => w.id === sp?.face.wall), current = after.walls.find(w => w.id === sp?.face.wall); if (sp && before && current && faceRun(plan, sp.face).length === 1 && wallLength(current) < wallLength(before) && !after.changes.some(c => c.type === 'wall' && c.op === 'remove' && c.target === before.id && c.range)) { i.code = 'out-of-face'; i.text = '墙变短了，构件保持原 s 后超出墙面' } } catch { /* retain host-cut */ }
  }
  for (const i of [...issues]) {
    if (['host-missing', 'host-cut', 'out-of-face', 'arc-unsupported', 'room-missing'].includes(i.code) && (i.level === 'error' || i.code === 'room-missing' || decor.doors?.some(d => d.id === i.id))) missing.add(i.id)
    if (i.code === 'through-wall' && after !== plan) { const sp = (() => { try { return itemSpan(after, items.find(x => x.id === i.id)!) } catch { return undefined } })(), oldWall = plan.walls.find(w => w.id === sp?.face.wall), newWall = after.walls.find(w => w.id === sp?.face.wall); if (oldWall && newWall && newWall.thickness < oldWall.thickness) issues.push({ ...i, code: 'too-deep', text: `墙变薄了。${i.text}` }) }
  }
  // Validation may discover a parent's lost face after the initial remapping pass.
  for (const r of decor.recesses) if (!('face' in r.host)) {
    const parent = 'panel' in r.host ? r.host.panel : r.host.cabinet
    if (missing.has(parent) && !missing.has(r.id)) problem(r.id, 'host-missing', `宿主 ${parent} 没地方挂了`)
  }
  for (const f of decor.furniture) if (f.in && missing.has(f.in.split(':cell:')[0]) && !missing.has(f.id)) problem(f.id, 'host-missing', '家具的宿主链不存在')
  const placed: PlacedDecor[] = items.map(item => {
    let footprint: Vec2[] = [], face: PlacedDecor['face'], level = levelOf(after, 'level' in item ? item : {}).id
    try {
      const sp = itemSpan(after, item)
      if (sp) { const wholeSurface = 'target' in item && 'face' in item.target && !item.target.s && !item.target.z; const f = faceFrame(after, wholeSurface ? sp.face : sp); face = { a: f.a, b: f.b, side: sp.face.side }; level = levelOf(after, f.wall).id }
      if (!missing.has(item.id)) footprint = itemFootprint(resolvedPlan, decor, item)
    } catch { missing.add(item.id) }
    if (missing.has(item.id)) { const c = decor.cache?.[item.id]; if (c) { const [x0, y0, x1, y1] = c.box; footprint = 'size' in item && c.pose ? furniturePose(resolvedPlan, item).footprint : [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; level = c.level ?? level } else try { footprint = itemFootprint(plan, source, decorItems(source).find(x => x.id === item.id)!) } catch { /* no last known location */ } }
    const status = missing.has(item.id) ? 'missing' : moved.has(item.id) ? 'moved' : 'placed'
    return { id: item.id, status, reasons: [...new Set(issues.filter(i => i.id === item.id).map(i => i.text))], text: status === 'missing' ? '没地方挂了' : status === 'moved' ? '挪到剩下那段' : '挂得上', footprint, ...(face ? { face } : {}), level, item }
  })
  const byId = new Map(placed.map(p => [p.id, p]))
  for (const p of placed) if ('host' in p.item && !('face' in p.item.host)) { const parent = byId.get('panel' in p.item.host ? p.item.host.panel : p.item.host.cabinet); if (parent) p.level = parent.level }
  for (const p of placed) if ('in' in p.item && p.item.in) { const parent = byId.get(p.item.in.split(':cell:')[0]); if (parent) p.level = parent.level }
  return { decor, placed, items: placed, issues: issues.filter((i, n) => issues.findIndex(j => j.id === i.id && j.code === i.code && (i.code !== 'component-invalid' || j.text === i.text)) === n) }
}
/** Resolve by the actual span/footprint, then host; never select an unrelated floor. */
export function decorRoom(plan: Plan, item: DecorItem, visited = new Set<string>()): string | undefined {
  if (visited.has(item.id)) return undefined
  visited.add(item.id)
  if ('target' in item && 'floor' in item.target) return item.target.floor
  if ('target' in item && 'ceiling' in item.target) return item.target.ceiling
  if (plan.decor) {
    const host = 'in' in item ? item.in?.split(':cell:')[0] : 'host' in item ? ('panel' in item.host ? item.host.panel : 'cabinet' in item.host ? item.host.cabinet : undefined) : undefined
    const parent = host && decorItems(plan.decor).find(i => i.id === host)
    if (parent) return decorRoom(plan, parent, visited)
  }
  try {
    const span = itemSpan(plan, item)
    if (span) {
      const axis = faceAxis(plan, span.face), mid = (span.s[0] + span.s[1]) / 2
      const room = plan.rooms.find(r => levelOf(plan, r).id === levelOf(plan, axis.wall).id && pointInPolygon(axis.at(mid, 1), r.poly))
      if (room) return room.id
      const neighbors = roomsBesideWall(plan, axis.wall.id)[span.face.side === 1 ? 'positive' : 'negative']
      if (neighbors.length === 1) return neighbors[0].id
    }
    if (plan.decor) {
      const fp = itemFootprint(plan, plan.decor, item), box = bounds(fp), center: Vec2 = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]
      const level = 'size' in item ? furniturePose(plan, item).level : levelOf(plan, 'level' in item ? { level: item.level } : {}).id
      return fp.length ? plan.rooms.find(r => levelOf(plan, r).id === level && pointInPolygon(center, r.poly))?.id : undefined
    }
  } catch { /* missing hosts have no invented room */ }
  return undefined
}
export function decorFocus(plan: Plan) {
  const resolved = resolveDecor(plan), view = { ...plan, decor: resolved.decor }
  return resolved.placed.filter(p => !('at' in p.item) && p.footprint.length).map(p => {
    const bbox = bounds(p.footprint), room = decorRoom(view, p.item)
    return { id: p.id, anchor: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] as Vec2, bbox, level: p.level, room, view: 'place' in p.item ? 'cabinet' as const : p.face ? 'elevation' as const : 'plan' as const, ...(p.face ? { face: p.face } : {}) }
  })
}

/** Persistable reattachment, including last valid ghost geometry. */
export function rehostDecor(before: Plan, after: Plan, decor: Decor): Decor {
  const resolved = resolveDecor({ ...before, decor }, after), result = resolved.decor!
  result.cache ??= {}
  for (const p of resolved.placed) if (p.status !== 'missing' && p.footprint.length) {
    const span = itemSpan({ ...after, decor: result }, p.item), wall = after.walls.find(w => w.id === span?.face.wall)
    const pose = 'size' in p.item ? furniturePose({ ...after, decor: result }, p.item) : undefined
    result.cache[p.id] = { level: p.level, box: bounds(p.footprint), ...(p.face ? { face: [p.face.a, p.face.b] } : {}), ...(wall ? { anchor: { wall: wall.id, a: [...wall.a], b: [...wall.b] } } : {}), ...(pose ? { pose: { at: pose.at, rot: pose.rot, z: pose.z } } : {}) }
  }
  for (const p of resolved.placed) if (p.status === 'missing' && !result.cache[p.id]) try {
    const original = decorItems(decor).find(i => i.id === p.id)!, footprint = itemFootprint({ ...before, decor }, decor, original)
    if (!footprint.length) continue
    const pose = 'size' in original ? furniturePose({ ...before, decor }, original) : undefined
    result.cache[p.id] = { level: pose?.level ?? p.level, box: bounds(footprint), ...(pose && !pose.missing ? { pose: { at: pose.at, rot: pose.rot, z: pose.z } } : {}) }
  } catch { /* no valid prior geometry */ }
  return result
}
export function decorStatus(plan: Plan): DecorResolution {
  const after = plan.legacy?.__structureReplayFrame ? plan : applyChanges(plan, plan.changes.filter(c => c.status === 'confirmed')).plan
  return resolveDecor(plan, after)
}

export const pendingCount = (decor: Decor | undefined): number => decor ? decorItems(decor).filter(i => i.status === 'pending').length : 0
/** Reject one pending edit. Undefined means a newly proposed item should be deleted. No mutation. */
export function restoreDecorItem<T extends DecorItem>(item: T): T | undefined {
  if (item.status !== 'pending') return structuredClone(item)
  return item.prev ? structuredClone(item.prev) as unknown as T : undefined
}
/** 挂在谁上面（in / 挖洞的宿主）；没有宿主返回 undefined */
export function decorHostOf(item: DecorItem): string | undefined {
  if ('in' in item && item.in) return item.in.replace(/:cell:\d+:\d+$/, '')
  if ('host' in item) return 'panel' in item.host ? item.host.panel : 'cabinet' in item.host ? item.host.cabinet : undefined
  return undefined
}
const groupOf = (decor: Decor, id: string) => (['furniture', 'cabinets', 'panels', 'recesses', 'surfaces', 'doors'] as const).map(key => (decor[key] ?? []) as DecorItem[]).find(list => list.some(i => i.id === id))
/**
 * 用户确认：status 改 confirmed、删 prev。直接改传进来的 decor（界面在 commitDecor 的拷贝上调）。
 * 宿主还在待确认时一起确认：否则这一条确认了也进不了 render（confirmedDecor 会把挂在被去掉宿主上的项一起去掉）。
 * 返回实际确认的 id（含被带上的宿主）。
 */
export function confirmDecorItems(decor: Decor, ids: readonly string[]): string[] {
  const done: string[] = [], items = decorItems(decor)
  const go = (id: string | undefined, seen = new Set<string>()) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    const item = items.find(i => i.id === id)
    if (!item) return
    if (item.status === 'pending') { item.status = 'confirmed'; delete item.prev; done.push(id) }
    go(decorHostOf(item), seen)
  }
  for (const id of ids) go(id)
  return done
}
/**
 * 用户否掉：有 prev 的恢复，没有的删除。和 decor-edit 的 reject 同一个顺序：先恢复，再处理要删的项的子项。
 * 子项：同样没 prev 的提议一起删；有 prev 的恢复；已确认的挖洞没宿主就存不下，跟着删；已确认的家电不丢，用 release 变成自由摆放
 * （release 要在宿主还在时算世界位置，这里在删之前调）。直接改传进来的 decor，返回删掉和恢复的 id。
 */
export function rejectDecorItems(decor: Decor, ids: readonly string[], release: (f: Furniture) => Furniture): { removed: string[]; restored: string[] } {
  const removed = new Set<string>(), restored: string[] = []
  const restore = (id: string) => {
    const list = groupOf(decor, id), index = list?.findIndex(i => i.id === id) ?? -1
    if (!list || index < 0 || list[index].status !== 'pending') return
    const next = restoreDecorItem(list[index])
    if (next) { list[index] = next; restored.push(id) } else removed.add(id)
  }
  for (const id of ids) restore(id)
  let changed = true
  while (changed) {
    changed = false
    for (const item of decorItems(decor)) {
      if (removed.has(item.id)) continue
      const host = decorHostOf(item)
      if (!host || !removed.has(host)) continue
      if (item.status === 'pending') { restore(item.id); changed = true; continue }
      if ('size' in item) { const list = decor.furniture, index = list.findIndex(f => f.id === item.id); list[index] = release(list[index]); changed = true; continue }
      removed.add(item.id); changed = true
    }
  }
  const drop = <T extends DecorItem>(list: T[]) => list.filter(i => !removed.has(i.id))
  decor.furniture = drop(decor.furniture); decor.cabinets = drop(decor.cabinets); decor.panels = drop(decor.panels); decor.recesses = drop(decor.recesses); decor.surfaces = drop(decor.surfaces)
  if (decor.doors) decor.doors = drop(decor.doors)
  for (const id of removed) if (decor.cache) delete decor.cache[id]
  return { removed: [...removed], restored }
}
/** Confirmed rendering/takeoff view. Restore previous versions, then drop dependent children transitively. */
export function confirmedDecor(decor: Decor | undefined): Decor | undefined {
  if (!decor) return undefined
  const result = structuredClone(decor), removed = new Set<string>()
  const groups = ['furniture', 'cabinets', 'panels', 'recesses', 'surfaces', 'doors'] as const
  for (const key of groups) if (decor[key]) (result[key] as DecorItem[]) = (decor[key] ?? []).flatMap(item => {
    const next = restoreDecorItem(item)
    if (!next) { removed.add(item.id); return [] }
    return [next]
  })
  let changed = true
  while (changed) {
    changed = false
    for (const key of groups) if (decor[key]) (result[key] as DecorItem[]) = (result[key] ?? []).filter(item => {
      const host = decorHostOf(item)
      if (host && removed.has(host)) { removed.add(item.id); changed = true; return false }
      return true
    })
  }
  for (const id of removed) if (result.cache) delete result.cache[id]
  return result
}
