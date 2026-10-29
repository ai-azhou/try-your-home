import { DEFAULTS } from './types.ts'
import { validatePlan } from './validate.ts'
import { applyChanges } from './changes.ts'
import type { Change, Evidence, Opening, OpeningKind, Plan, Vec2, Wall, WallKind } from './types.ts'
import { distance, dot, effectiveWallHeight, projectToWall, wallDir, wallLength, wallNormal } from './geometry.ts'

export interface ImportReport {
  source: 'legacy' | 'v2'
  counts: Record<string, number>
  approximations: string[]
  unsupported: string[]
  idMap: Record<string, { wall: string; offset: number }>
  warnings: string[]
}
export function importReport(source: ImportReport['source']): ImportReport { return { source, counts: {}, approximations: [], unsupported: [], idMap: {}, warnings: [] } }
export function emptyPlan(): Plan { return { format: 'floorplan-structure', version: 2, title: '未命名方案', ceiling: DEFAULTS.ceiling, walls: [], openings: [], beams: [], rooms: [], questions: [], changes: [] } }
const kinds: Record<string, WallKind> = { b: 'bearing', e: 'exterior', n: 'partition', hg: 'half-glass', low: 'half', glass: 'glass' }
const windowKinds: Record<string, OpeningKind> = { normal: 'window', floor: 'floor-window', bay: 'bay-window', open: 'open-balcony' }
const doorKinds: Record<string, OpeningKind> = { swing: 'door', sliding: 'sliding', open: 'doorway' }
const certainty = (v: string): Evidence['certainty'] => ({ '看到': 'seen', '推断': 'inferred', '不知道': 'unknown', seen: 'seen', inferred: 'inferred', unknown: 'unknown' } as const)[v] ?? 'unknown'
function wallKind(v: string | undefined): WallKind { return kinds[v ?? 'n'] ?? (Object.values(kinds).includes(v as WallKind) ? v as WallKind : 'partition') }
function rectWall(rect: number[], id: string, kind: WallKind): Wall {
  const [x0, y0, x1, y1] = rect, horizontal = x1 - x0 >= y1 - y0
  return { id, a: horizontal ? [x0, (y0 + y1) / 2] : [(x0 + x1) / 2, y0], b: horizontal ? [x1, (y0 + y1) / 2] : [(x0 + x1) / 2, y1], thickness: horizontal ? y1 - y0 : x1 - x0, kind }
}
function freeWall(o: any, id: string): Wall { return { id, a: o.a, b: o.b, thickness: o.t ?? DEFAULTS.thickness.partition, kind: wallKind(o.kind), ...(o.bulge !== undefined ? { bulge: o.bulge } : {}), ...(o.h !== undefined ? { height: o.h } : {}) } }
function paneData(panes: any[]) { return panes.map(p => ({ width: p.w ?? p.width, kind: p.kind })) }
function evidence(e: any): Evidence { return { certainty: certainty(e.kind ?? e.certainty), ...(e.basis ? { basis: e.basis } : {}), ...(e.pixelBBox ? { pixelBox: e.pixelBBox } : {}), ...(e.confirmed && typeof e.confirmed === 'object' ? { confirmed: e.confirmed } : {}) } }
/** Unknown and original fields remain at their original paths in a complete legacy snapshot. */
export function fromLegacy(json: unknown): { plan: Plan; report: ImportReport } {
  if (!json || typeof json !== 'object' || !('layout' in json)) throw new Error('旧方案缺少 layout 对象')
  const source = structuredClone(json) as any, l = source.layout
  if (!l || typeof l !== 'object' || !Array.isArray(l.walls)) throw new Error('旧方案 layout.walls 必须是数组')
  const plan = emptyPlan(), report = importReport('legacy')
  plan.legacy = structuredClone(source)
  plan.title = l.title?.zh ?? (typeof l.title === 'string' ? l.title : '导入方案')
  plan.ceiling = l.height ?? DEFAULTS.ceiling
  if (l.north !== undefined) plan.north = l.north
  if (source.planFile) plan.meta = { planFile: source.planFile }
  const original: Wall[] = l.walls.map((r: any[], i: number) => rectWall(r as number[], typeof r[5] === 'string' ? r[5] : `w${i}`, wallKind(r[4])))
  const targetMap: Record<string, string> = {}
  type Gap = { rect: number[]; raw: any; id: string; key: string; kind: OpeningKind; sill: number; head: number }
  const gaps: Gap[] = []
  const append = (arr: any[], group: string) => (arr ?? []).forEach((raw, i) => {
    const obj = Array.isArray(raw) ? { rect: raw.slice(0, 4), sill: raw[4] } : raw
    if (!Array.isArray(obj.rect)) { report.unsupported.push(`${group}[${i}] 缺少矩形，已保留原文`); return }
    const kind = group === 'wins' ? windowKinds[obj.type ?? 'normal'] ?? 'window' : group === 'slides' ? 'sliding' : group === 'openings' || group === 'lintels' ? 'doorway' : doorKinds[obj.type ?? 'swing'] ?? 'door'
    gaps.push({ rect: obj.rect, raw: obj, id: obj.id ?? (group === 'wins' ? `window${i}` : `${group}:${i}`), key: `${group}[${i}]`, kind, sill: obj.sill ?? (group === 'wins' ? .9 : 0), head: obj.head ?? obj.height ?? Math.min(group === 'wins' ? 2.4 : group === 'slides' ? 2.2 : 2.1, plan.ceiling) })
  })
  append(l.wins, 'wins'); append(l.doors, 'doors'); append(l.slides, 'slides'); append(l.openings, 'openings')
  ;(l.lintels ?? []).forEach((v: any, i: number) => {
    const existing = gaps.find(g => JSON.stringify(g.rect) === JSON.stringify(v[0]))
    if (existing) { existing.head = v[1]; targetMap[`lintels[${i}]`] = existing.id }
    else gaps.push({ rect: v[0], raw: {}, id: `lintels:${i}`, key: `lintels[${i}]`, kind: 'doorway', sill: 0, head: v[1] })
  })
  // Merge only same-kind collinear segments connected directly or covered by opening intervals.
  const parents = original.map((_, i) => i)
  const root = (i: number): number => parents[i] === i ? i : (parents[i] = root(parents[i]))
  const aligned = (a: Wall, b: Wall) => Math.abs(dot(wallDir(a), wallNormal(b))) < 1e-6 && Math.abs(dot([b.a[0] - a.a[0], b.a[1] - a.a[1]], wallNormal(a))) <= 15 && Math.abs(a.thickness - b.thickness) <= 30
  for (let i = 0; i < original.length; i++) for (let j = i + 1; j < original.length; j++) {
    const a = original[i], b = original[j]
    if (a.kind !== b.kind || !aligned(a, b)) continue
    const d = wallDir(a), start = dot(a.a, d), end = dot(a.b, d), bs = dot(b.a, d), be = dot(b.b, d)
    const lo = Math.min(end, be), hi = Math.max(start, bs)
    const intervals = gaps.map(g => rectWall(g.rect, '', a.kind)).filter(g => aligned(a, g)).map(g => [dot(g.a, d), dot(g.b, d)]).sort((a, b) => a[0] - b[0])
    let covered = lo
    for (const [s, e] of intervals) if (s <= covered + 1 && e >= covered) covered = Math.max(covered, e)
    if (hi <= lo + 1 || covered >= hi - 1) parents[root(j)] = root(i)
  }
  const groups = new Map<number, Wall[]>()
  original.forEach((w, i) => { const key = root(i); groups.set(key, [...(groups.get(key) ?? []), w]) })
  for (const ws of groups.values()) {
    const first = ws[0], d = wallDir(first), all = ws.flatMap(w => [w.a, w.b]).sort((a, b) => dot(a, d) - dot(b, d))
    const onLine = (p: Vec2): Vec2 => { const s = dot([p[0] - first.a[0], p[1] - first.a[1]], d); return [first.a[0] + d[0] * s, first.a[1] + d[1] * s] }
    const w: Wall = { ...first, a: onLine(all[0]), b: onLine(all[all.length - 1]) }; plan.walls.push(w)
    for (const old of ws) report.idMap[old.id] = { wall: w.id, offset: dot([old.a[0] - w.a[0], old.a[1] - w.a[1]], d) }
    if (ws.some(x => x.thickness !== first.thickness || Math.abs(dot([x.a[0] - first.a[0], x.a[1] - first.a[1]], wallNormal(first))) > .001)) report.approximations.push(`合并墙 ${w.id} 的厚度及中心线取第一段，容差分别为 30mm、15mm`)
  }
  original.forEach((w, i) => { targetMap[`walls[${i}]`] = report.idMap[w.id].wall; targetMap[w.id] = report.idMap[w.id].wall })
  for (const gap of gaps) {
    const gw = rectWall(gap.rect, '', 'partition'), len = wallLength(gw), d = wallDir(gw)
    let wall = plan.walls.find(w => aligned(w, gw) && dot(w.a, d) <= dot(gw.a, d) + 1 && dot(w.b, d) >= dot(gw.b, d) - 1)
    if (!wall) {
      const neighbors = plan.walls.filter(w => aligned(w, gw) && Math.min(distance(w.a, gw.b), distance(w.b, gw.a)) <= 31)
      const requested = gap.raw.wallType ? wallKind(gap.raw.wallType) : undefined
      let id = `${gap.id}:host`; while (plan.walls.some(w => w.id === id)) id += '_'
      wall = { ...gw, id, kind: requested ?? neighbors[0]?.kind ?? 'partition' }
      plan.walls.push(wall)
      report.approximations.push(`洞口 ${gap.id} 未能跨同类墙合并，单建宿主 ${id}（${wall.kind}）；未将不同类型墙合并`)
    }
    const offset = projectToWall(wall, gw.a).s
    const o: Opening = { id: gap.id, wall: wall.id, offset, width: len, kind: gap.kind, sill: gap.sill, head: gap.head }
    if (gap.raw.name) o.name = gap.raw.name
    if (gap.raw.entry !== undefined) o.entry = gap.raw.entry
    if (gap.raw.panes) o.panes = paneData(gap.raw.panes)
    if (o.kind === 'door') o.swing = { hinge: gap.raw.h && distance(gap.raw.h, gw.b) < distance(gap.raw.h, gw.a) ? 'end' : 'start', side: gap.raw.o && dot(gap.raw.o, wallNormal(wall)) < 0 ? -1 : 1 }
    if (gap.raw.source) o.evidence = evidence(gap.raw.source)
    plan.openings.push(o); targetMap[gap.key] = o.id; targetMap[o.id] = o.id
  }
  ;(l.freeWalls ?? []).forEach((o: any, i: number) => { const w = freeWall(o, o.id ?? `free${i}`); plan.walls.push(w); report.idMap[w.id] = { wall: w.id, offset: 0 }; targetMap[`freeWalls[${i}]`] = w.id })
  plan.beams = (l.beams ?? []).map((o: any, i: number) => { const w = rectWall(o.rect, o.id ?? `beam${i}`, 'partition'); targetMap[`beams[${i}]`] = w.id; return { id: w.id, a: w.a, b: w.b, width: w.thickness, bottom: o.bottom ?? DEFAULTS.beam.bottom, ...(o.name ? { name: o.name } : {}) } })
  plan.rooms = (l.rooms ?? []).map((r: any, i: number) => {
    const id = r.id ?? `room${i}`; targetMap[`rooms[${i}]`] = id; targetMap[id] = id
    return { id, name: r.name ?? id, poly: r.poly ?? [], ...(r.height !== undefined ? { ceiling: r.height } : {}), ...(r.floorHeight !== undefined || id.startsWith('bay') ? { floorOffset: r.floorHeight ?? .45 } : {}), ...(r.counted !== undefined ? { counted: r.counted } : {}), ...(r.use ? { use: r.use } : {}) }
  })
  if (l.underlay) {
    const u = l.underlay
    plan.underlay = { src: u.src, mmPerPx: u.mmPerPx, origin: u.origin ?? [0, 0], opacity: u.opacity ?? 50, visible: u.visible ?? true }
    for (const k of ['mmPerPxY', 'rotation', 'flipX', 'flipY'] as const) if (u[k] !== undefined) (plan.underlay as any)[k] = u[k]
    if (u.calibrations) plan.underlay.calibrations = u.calibrations.map((c: any) => ({ p1: c.p1 ?? c.points[0], p2: c.p2 ?? c.points[1], length: c.length, ...(c.note ? { note: c.note } : {}) }))
  }
  plan.questions = (l.questions ?? []).map((q: any, i: number) => {
    if (q.category === '风格') report.approximations.push(`问题 ${q.id ?? i} 的风格分类归入 renovation，原文保留在 legacy.layout.questions`)
    return { id: q.id ?? `q${i}`, text: q.text ?? '', category: q.category === '改造' || q.category === '风格' ? 'renovation' : 'original', ...(q.kind ? { certainty: certainty(q.kind) } : {}), ...(q.bbox ? { bbox: q.bbox } : {}), ...(q.targets ? { targets: q.targets.map((t: string) => targetMap[t] ?? t) } : {}), ...(q.options ? { options: q.options.map((o: any) => typeof o === 'string' ? o : o.zh ?? o.en ?? '') } : {}), ...(q.answer != null ? { answer: q.answer } : {}), ...(q.answeredBy ? { answeredBy: q.answeredBy } : {}), ...(q.answeredAt ? { answeredAt: q.answeredAt } : {}) }
  })
  for (const e of l.evidence ?? []) {
    const id = targetMap[e.target?.replace(/^layout\./, '')] ?? e.target
    const item = [...plan.walls, ...plan.openings, ...plan.beams, ...plan.rooms].find(x => x.id === id)
    if (item) { if (item.evidence) report.approximations.push(`构件 ${id} 有多段证据，显示最后一条，全部原证据保留在 legacy.layout.evidence`); item.evidence = evidence(e) }
    else report.warnings.push(`证据 ${e.id ?? ''} 的目标 ${e.target} 无法挂接，原文已保留`)
  }
  // Maintain aliases in current-wall coordinates as earlier legacy mods split merged hosts.
  const aliases: Record<string, { wall: string; offset: number; length: number }> = {}
  for (const [id, mapping] of Object.entries(report.idMap)) aliases[id] = { ...mapping, length: wallLength(original.find(w => w.id === id) ?? plan.walls.find(w => w.id === mapping.wall)!) }
  const deletedAliases = new Set<string>()
  let cursor = structuredClone(plan)
  const pushChange = (c: Change, legacyModId: string) => {
    plan.changes.push(c)
    const before = cursor, replay = applyChanges(cursor, [c])
    if (!replay.results[0].ok) return
    cursor = replay.plan
    if (c.type === 'wall' && c.op === 'remove') {
      const w = before.walls.find(w => w.id === c.target)!, len = wallLength(w), [from, to] = c.range ?? [0, len]
      const intervals: [number, number][] = []; if (from > 1e-6) intervals.push([0, from]); if (to < len - 1e-6) intervals.push([to, len])
      for (const [id, alias] of Object.entries(aliases)) if (alias.wall === c.target) {
        const spans = intervals.map(([a, b], i) => ({ wall: i ? `${w.id}~${c.id}` : w.id, offset: Math.max(a, alias.offset) - a, length: Math.min(b, alias.offset + alias.length) - Math.max(a, alias.offset) })).filter(s => s.length > 1e-6)
        if (spans.length) { aliases[id] = spans[0]; if (spans[1]) aliases[`${id}:${legacyModId}`] = spans[1] }
        else { delete aliases[id]; deletedAliases.add(id) }
      }
    } else if (c.type === 'wall' && c.op === 'add') {
      const w = cursor.walls.find(w => w.id === c.data!.id)!
      aliases[w.id] = { wall: w.id, offset: 0, length: wallLength(w) }
    }
  }
  for (const mod of source.mods ?? []) {
    const p = mod.params ?? {}, mapping = aliases[mod.target], target = deletedAliases.has(mod.target) ? `${mod.target}~removed` : mapping?.wall ?? targetMap[mod.target] ?? mod.target
    const c: Change = { id: mod.id, op: 'update', type: 'wall', ...(target ? { target } : {}), by: mod.by === 'Agent' ? 'agent' : 'user', status: mod.status === '已确认' ? 'confirmed' : 'pending', ...(mod.note ? { note: mod.note } : {}), ...(mod.at ? { at: mod.at } : {}) }
    if (mod.confirm === '二次确认' && mod.confirmedBy) c.confirm = { by: mod.confirmedBy, ...(mod.confirmedAt ? { at: mod.confirmedAt } : {}) }
    else if (mod.confirm) report.warnings.push(`改造 ${mod.id} 缺少有效 confirmedBy，未生成二次确认`)
    const offset = mapping?.offset ?? 0
    switch (mod.op) {
      case 'demolish': {
        c.op = 'remove'; const merged = cursor.walls.find(w => w.id === target)
        if (p.from !== undefined || p.to !== undefined || mapping && merged && mapping.length < wallLength(merged) - 1) c.range = [offset + (p.from ?? 0), offset + (p.to ?? mapping?.length ?? (merged ? wallLength(merged) : 0))]
        break
      }
      case 'add-wall': c.op = 'add'; delete c.target; c.data = { ...rectWall(p.rect, p.id ?? `${mod.id}:wall`, wallKind(p.type)) }; break
      case 'wall-type': c.data = { kind: wallKind(p.type) }; if (mapping && original.filter(w => report.idMap[w.id].wall === target).length > 1) report.approximations.push(`改造 ${mod.id} 类型调整应用于合并后的整墙 ${target}`); break
      case 'open': c.op = 'add'; c.type = 'opening'; delete c.target; c.data = { id: `${mod.id}:opening`, wall: target, offset: offset + (p.from ?? 0), width: p.width, sill: 0, head: p.height ?? 2.1, kind: doorKinds[p.type ?? 'open'] ?? 'doorway', ...(p.name ? { name: p.name } : {}) }; break
      case 'close': c.op = 'remove'; c.type = 'opening'; break
      case 'window': c.type = 'opening'; c.data = {}; for (const k of ['sill', 'head', 'name']) if (p[k] !== undefined) c.data[k] = p[k]; if (p.type) c.data.kind = windowKinds[p.type]; if (p.panes) c.data.panes = paneData(p.panes); break
      case 'balcony': c.type = 'opening'; c.data = { kind: p.enclosed ? 'window' : 'open-balcony' }; break
      case 'room': c.type = 'room'; c.data = {}; for (const k of ['name', 'use', 'poly']) if (p[k] !== undefined) c.data[k] = p[k]; if (p.height !== undefined) c.data.ceiling = p.height; break
      case 'bay-remove': c.type = 'room'; c.data = { floorOffset: 0, counted: true }; c.group = mod.id; pushChange(c, mod.id); for (const [i, id] of (p.windows ?? []).entries()) pushChange({ ...c, id: `${c.id}:window${i}`, type: 'opening', target: targetMap[id] ?? id, data: { sill: p.sill ?? .9, kind: 'window' } }, mod.id); report.approximations.push(`改造 ${mod.id} 取消台面并计入面积；父房间和材质信息保留在 legacy.mods`); continue
      case 'add-free-wall': c.op = 'add'; delete c.target; c.data = { ...freeWall(p, p.id ?? `${mod.id}:wall`) }; break
      case 'free-wall': c.data = {}; for (const k of ['a', 'b', 'bulge']) if (p[k] !== undefined) c.data[k] = p[k]; if (p.t !== undefined) c.data.thickness = p.t; if (p.h !== undefined) c.data.height = p.h; if (p.kind) c.data.kind = wallKind(p.kind); break
      default: report.unsupported.push(`改造 ${mod.id}（${mod.op}）不能换算，原文保留在 legacy.mods`); continue
    }
    pushChange(c, mod.id)
  }
  report.counts = { walls: plan.walls.length, openings: plan.openings.length, beams: plan.beams.length, rooms: plan.rooms.length, questions: plan.questions.length, changes: plan.changes.length, legacyMods: source.mods?.length ?? 0 }
  // Report legacy geometry defects without silently changing source dimensions.
  for (const o of plan.openings) { const w = plan.walls.find(w => w.id === o.wall)!; if (o.head > effectiveWallHeight(plan, w)) report.warnings.push(`洞口 ${o.id} 洞顶超过墙高，保留原尺寸，需核对`); if (o.sill >= o.head) report.warnings.push(`洞口 ${o.id} 窗台不低于洞顶，保留原尺寸，需核对`) }
  for (const issue of validatePlan(plan)) report.warnings.push(`[${issue.code}] ${issue.message}（旧数据原尺寸保留，需核对）`)
  return { plan, report }
}
