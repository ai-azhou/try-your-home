import clipping from 'polygon-clipping'
import type { Box, Plan, Question, Vec2, Wall } from './types.ts'
import { DEFAULTS } from './types.ts'
import { emptyPlan, fromLegacy } from './legacy.ts'
import { invalidPolygon, validatePlan } from './validate.ts'
import type { Issue } from './validate.ts'
import { polygonArea } from './geometry.ts'

export const SIMPLE_FORMAT = 'floorplan-simple'
export const SIMPLE_BASIS = '简版格式自动生成'
export const SIMPLE_SNAP = 150
export const SIMPLE_TEMPLATE = `{
  "format": "floorplan-simple",
  "version": 1,
  "title": "我家",
  "rooms": [
    {"name": "主卧", "poly": [[0, 0], [3600, 0], [3600, 4000], [0, 4000]]},
    {"name": "客餐厅", "rect": [3600, 0, 6000, 5400]},
    {"name": "次卧", "rect": [0, 4000, 3600, 4000]},
    {"name": "卫生间", "rect": [3600, 5400, 2400, 2600]},
    {"name": "厨房", "rect": [6000, 5400, 3600, 2600]}
  ],
  "doors": [
    {"between": ["客餐厅", "外面"]},
    {"between": ["客餐厅", "主卧"]},
    {"between": ["客餐厅", "次卧"]},
    {"between": ["客餐厅", "卫生间"]},
    {"between": ["客餐厅", "厨房"], "open": true}
  ]
}`
export const SIMPLE_RULES: string[] = [
  "字段只有 format、version、title、rooms、doors。不要加别的字段，不要在外面再套一层。",
  "长度一律毫米（mm）。x 向右、y 向下，和图片的方向一致。",
  "每间房写一个 name，名字不重复（两间卧室写「主卧」「次卧」）。形状用 rect 或 poly 二选一：rect 是 [左上角 x, 左上角 y, 宽, 深]；poly 是按顺序排的顶点 [[x, y], …]，最后不重复第一个点。",
  "相邻的两间房，共用的那条边坐标要写成一样。房间之间不要重叠，也不要留缝。",
  "doors 只写门在哪两间房之间：[\"A\", \"B\"]。入户门写 [\"房间名\", \"外面\"]。两间房之间没有墙、敞开相通，写 \"open\": true。",
  "不要写墙和窗（没有 walls、windows）。墙和门洞由工具按房间自动生成，窗户在工具里自己加。"
]

const EPS = 1e-5
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const evidence = () => ({ certainty: 'inferred' as const, basis: SIMPLE_BASIS })
const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]]
const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1]
const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0]
const distance = (a: Vec2, b: Vec2) => Math.hypot(...sub(a, b))
const round = (p: Vec2): Vec2 => p.map(n => Math.round(n * 1e6) / 1e6) as Vec2
const at = (a: Vec2, d: Vec2, s: number): Vec2 => round([a[0] + d[0] * s, a[1] + d[1] * s])
const direction = (a: Vec2, b: Vec2): Vec2 => { const l = distance(a, b); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l] }
const bbox = (points: Vec2[]): Box => [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))]
const signedArea = (poly: Vec2[]) => poly.reduce((s, p, i) => s + cross(p, poly[(i + 1) % poly.length]), 0) / 2
const area = (polys: clipping.MultiPolygon) => polys.reduce((s, p) => s + polygonArea(p[0]) - p.slice(1).reduce((n, h) => n + polygonArea(h), 0), 0)
const outside = (v: unknown) => typeof v === 'string' && ['外面', '室外', '户外', 'outside'].includes(v)

function simpleObject(value: unknown): { value: Record<string, unknown>; wrapper?: string } | null {
  if (!record(value)) return null
  if (value.format === SIMPLE_FORMAT || value[SIMPLE_FORMAT] === 1 || value[SIMPLE_FORMAT] === 'version 1') return { value }
  const keys = Object.keys(value), child = value[keys[0]]
  if (keys.length === 1 && record(child) && child.format === SIMPLE_FORMAT) return { value: child, wrapper: keys[0] }
  return null
}
export function isSimplePlan(value: unknown): boolean { return simpleObject(value) !== null }
export function isSimpleDerived(plan: Plan): boolean { return plan.meta?.source === SIMPLE_FORMAT }

interface SimpleRoom { id: string; name: string; poly: Vec2[] }
interface Edge { a: Vec2; b: Vec2; owners: number[] }
interface WallRun extends Edge { kind: 'partition' | 'exterior'; pieces: Edge[]; wall?: Wall }
interface Door { index: number; a?: number; b?: number; entry: boolean; open: boolean; label: string }

/** Remove closing/collinear vertices from clipping output, without rounding away thin shapes. */
function cleanRing(poly: Vec2[]): Vec2[] {
  let points = poly.filter((p, i) => distance(p, poly[(i + 1) % poly.length]) > EPS)
  let changed = true
  while (changed && points.length > 3) {
    changed = false
    for (let i = 0; i < points.length; i++) {
      const a = points[(i + points.length - 1) % points.length], p = points[i], b = points[(i + 1) % points.length]
      if (Math.abs(cross(sub(p, a), sub(b, a))) <= EPS * distance(a, b) && dot(sub(p, a), sub(p, b)) <= EPS) {
        points.splice(i, 1); changed = true; break
      }
    }
  }
  return points
}

/** Cluster vertices across rooms, then project shared clusters together onto nearby edge interiors. */
function snapRooms(rooms: SimpleRoom[], notes: string[]) {
  const vertices = rooms.flatMap((r, room) => r.poly.map((p, vertex) => ({ p, room, vertex })))
  const groups = vertices.map((_, i) => [i])
  const candidates: { i: number; j: number; d: number }[] = []
  for (let i = 0; i < vertices.length; i++) for (let j = i + 1; j < vertices.length; j++) {
    const d = distance(vertices[i].p, vertices[j].p)
    if (vertices[i].room !== vertices[j].room && d <= SIMPLE_SNAP) candidates.push({ i, j, d })
  }
  candidates.sort((a, b) => a.d - b.d)
  for (const { i, j } of candidates) {
    const a = groups.find(g => g.includes(i))!, b = groups.find(g => g.includes(j))!
    // Avoid collapsing a short edge or joining a chain spanning more than the tolerance.
    if (a === b || a.some(x => b.some(y => vertices[x].room === vertices[y].room || distance(vertices[x].p, vertices[y].p) > SIMPLE_SNAP))) continue
    a.push(...b); groups.splice(groups.indexOf(b), 1)
  }
  const original = rooms.map(r => r.poly)
  const clustered = rooms.map(r => r.poly.map(p => [...p] as Vec2))
  for (const group of groups) {
    const p = round(group.reduce<Vec2>((p, i) => [p[0] + vertices[i].p[0] / group.length, p[1] + vertices[i].p[1] / group.length], [0, 0]))
    for (const i of group) clustered[vertices[i].room][vertices[i].vertex] = p
  }
  if (clustered.some(invalidPolygon)) { notes.push('顶点吸附会使房间退化或自交，保留原顶点'); return }
  const projected = clustered.map(poly => poly.map(p => [...p] as Vec2))
  for (const group of groups) {
    const first = vertices[group[0]], p = clustered[first.room][first.vertex]
    let best: Vec2 | undefined, bestDistance = SIMPLE_SNAP + EPS
    for (let ri = 0; ri < rooms.length; ri++) {
      if (group.some(i => vertices[i].room === ri)) continue
      const poly = clustered[ri]
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length], d = direction(a, b), s = dot(sub(p, a), d)
        if (s <= EPS || s >= distance(a, b) - EPS) continue
        const q = at(a, d, s), gap = distance(p, q)
        if (gap < bestDistance) { best = q; bestDistance = gap }
      }
    }
    if (best) for (const i of group) projected[vertices[i].room][vertices[i].vertex] = best
  }
  const final = projected.some(invalidPolygon) ? clustered : projected
  if (final !== projected) notes.push('边投影会使房间退化或自交，仅保留顶点吸附')
  rooms.forEach((r, i) => { r.poly = final[i] })
  if (final.some((p, i) => p.some((v, j) => distance(v, original[i][j]) > EPS))) notes.push(`已按 ${SIMPLE_SNAP} mm 容差吸附房间顶点和边`)
}

function splitEdges(rooms: SimpleRoom[]): Edge[] {
  const vertices = rooms.flatMap(r => r.poly), segments = new Map<string, Edge>()
  rooms.forEach((r, room) => r.poly.forEach((a, i) => {
    const b = r.poly[(i + 1) % r.poly.length], d = direction(a, b), length = distance(a, b)
    const cuts = [0, length]
    for (const p of vertices) {
      const s = dot(sub(p, a), d)
      if (s > EPS && s < length - EPS && Math.abs(cross(sub(p, a), d)) <= EPS) cuts.push(s)
    }
    cuts.sort((a, b) => a - b)
    for (let j = 1; j < cuts.length; j++) {
      if (cuts[j] - cuts[j - 1] <= EPS) continue
      let p = at(a, d, cuts[j - 1]), q = at(a, d, cuts[j])
      if (p[0] > q[0] || p[0] === q[0] && p[1] > q[1]) [p, q] = [q, p]
      const key = `${p}:${q}`, existing = segments.get(key)
      if (existing) { if (!existing.owners.includes(room)) existing.owners.push(room) }
      else segments.set(key, { a: p, b: q, owners: [room] })
    }
  }))
  return [...segments.values()]
}
function collinear(a: Edge, b: Edge): boolean {
  const d = direction(a.a, a.b)
  return Math.abs(cross(d, direction(b.a, b.b))) < 1e-8 && Math.abs(cross(sub(b.a, a.a), d)) <= EPS
}
function mergeRuns(edges: Edge[]): WallRun[] {
  const runs: WallRun[] = edges.map(e => ({ ...e, kind: e.owners.length > 1 ? 'partition' : 'exterior', pieces: [e] }))
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
    const a = runs[i], b = runs[j]
    if (a.kind !== b.kind || !collinear(a, b)) continue
    const d = direction(a.a, a.b), s = dot(sub(b.a, a.a), d), t = dot(sub(b.b, a.a), d), length = distance(a.a, a.b)
    if (Math.min(s, t) > length + EPS || Math.max(s, t) < -EPS) continue
    const start = at(a.a, d, Math.min(0, s, t)), end = at(a.a, d, Math.max(length, s, t))
    a.a = start; a.b = end; a.pieces.push(...b.pieces); a.owners = [...new Set([...a.owners, ...b.owners])]
    runs.splice(j, 1); i--; break
  }
  return runs
}
function intervals(run: WallRun, belongs: (piece: Edge) => boolean): [number, number][] {
  const d = direction(run.a, run.b)
  const spans = run.pieces.filter(belongs).map(p => [dot(sub(p.a, run.a), d), dot(sub(p.b, run.a), d)].sort((a, b) => a - b) as [number, number]).sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const span of spans) {
    const last = merged.at(-1)
    if (last && span[0] <= last[1] + EPS) last[1] = Math.max(last[1], span[1])
    else merged.push([...span])
  }
  return merged
}
function wallRect(w: Wall): clipping.Polygon {
  const d = direction(w.a, w.b), n: Vec2 = [-d[1], d[0]], h = w.thickness / 2
  return [[at(w.a, n, h), at(w.b, n, h), at(w.b, n, -h), at(w.a, n, -h)]]
}

export function simpleToPlan(value: unknown): { plan: Plan | null; issues: Issue[]; notes: string[] } {
  const notes: string[] = [], issues: Issue[] = [], parsed = simpleObject(value)
  const error = (message: string) => issues.push({ level: 'error', code: 'simple-shape', message })
  if (!parsed) { error('format：要写 "floorplan-simple"，version：要写 1'); return { plan: null, issues, notes } }
  const input = parsed.value
  if (parsed.wrapper) notes.push(`已拆掉外面多套的一层 ${parsed.wrapper}`)
  if (input[SIMPLE_FORMAT] !== undefined) notes.push('格式标记写成了键，已按 format: "floorplan-simple", version: 1 读取')
  if (input.version === undefined || input.version === '1') notes.push('version 缺失或是字符串，已按 1 读取')
  else if (input.version !== 1) error('version：简版格式只支持 1')
  const extras = new Set<string>()
  const extra = (o: Record<string, unknown>, allowed: string[]) => Object.keys(o).filter(k => !allowed.includes(k)).forEach(k => extras.add(k))
  extra(input, ['format', 'version', 'title', 'rooms', 'doors', SIMPLE_FORMAT])
  if (!Array.isArray(input.rooms) || !input.rooms.length) { error('rooms：至少要写一间房'); return { plan: null, issues, notes } }
  const rooms: SimpleRoom[] = [], aliases = new Map<string, number>(), names = new Set<string>()
  // Question IDs have a reserved namespace; all generated element IDs avoid room IDs.
  const ids = new Set<string>(), reserved = new Set(input.rooms.flatMap(r => record(r) && typeof r.id === 'string' && r.id && !r.id.startsWith('simple-') ? [r.id] : []))
  const unique = (base: string) => { let id = base, i = 2; while (ids.has(id) || reserved.has(id)) id = `${base}-${i++}`; ids.add(id); return id }
  const coordinates: number[] = []
  input.rooms.forEach((raw, index) => {
    const r = record(raw) ? raw : {}, name = typeof r.name === 'string' ? r.name.trim() : ''
    const path = `rooms[${index}]${name ? `（${name}）` : ''}`
    if (!name) error(`${path}.name：每间房要写 name`)
    extra(r, ['id', 'name', 'rect', 'poly'])
    let poly: Vec2[] = []
    if (r.rect !== undefined && r.poly !== undefined) { error(`${path}：rect 和 poly 要二选一`); return }
    if (r.poly !== undefined) {
      if (!Array.isArray(r.poly) || r.poly.length < 3) { error(`${path}.poly：至少要 3 个点`); return }
      let objects = false
      for (const [i, rawPoint] of r.poly.entries()) {
        const p = record(rawPoint) ? (objects = true, extra(rawPoint, ['x', 'y']), [rawPoint.x, rawPoint.y]) : rawPoint
        if (!Array.isArray(p) || p.length !== 2 || !p.every(finite)) { error(`${path}.poly[${i}]：坐标要写两个有限数`); continue }
        poly.push([p[0], p[1]]); coordinates.push(...p)
      }
      if (objects) notes.push(`${path}.poly 的 {x, y} 已转成 [x, y]`)
    } else {
      let rect = r.rect
      if (record(rect)) { extra(rect, ['x', 'y', 'w', 'h', 'width', 'height']); rect = [rect.x, rect.y, rect.w ?? rect.width, rect.h ?? rect.height]; notes.push(`${path}.rect 的对象已转成 [x, y, 宽, 深]`) }
      if (!Array.isArray(rect) || rect.length !== 4 || !rect.every(finite)) { error(`${path}.rect：要写 [左上角 x, 左上角 y, 宽, 深] 四个有限数`); return }
      const [x, y, w, h] = rect
      if (w <= 0 || h <= 0) { error(`${path}.rect：宽和深必须大于 0`); return }
      coordinates.push(...rect); poly = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]
    }
    if (poly.length < 3 || poly.some(p => !p.every(finite)) || invalidPolygon(poly)) { error(`${path}.${r.poly !== undefined ? 'poly' : 'rect'}：多边形自交或退化，请按边界顺序写顶点`); return }
    let renamed = name, n = 2
    while (names.has(renamed)) renamed = `${name} ${n++}`
    if (renamed !== name) notes.push(`${path} 重名，已改成「${renamed}」；doors 引用「${name}」时按第一间`)
    names.add(renamed)
    let id: string
    if (typeof r.id === 'string' && r.id && !ids.has(r.id) && !r.id.startsWith('simple-')) { id = r.id; ids.add(id) }
    else { id = unique(`r${index + 1}`); if (r.id !== undefined) notes.push(`${path}.id 无效、重复或占用 simple- 问题卡前缀，已改为 ${id}`) }
    const roomIndex = rooms.length
    for (const alias of [name, renamed, typeof r.id === 'string' ? r.id : id]) if (!aliases.has(alias)) aliases.set(alias, roomIndex)
    rooms.push({ id, name: renamed, poly })
  })
  if (issues.length) return { plan: null, issues, notes }
  const plan = { ...emptyPlan(), title: typeof input.title === 'string' ? input.title : '简版方案', meta: { source: SIMPLE_FORMAT } }
  const question = (id: string, text: string, fields: Partial<Question> = {}) => plan.questions.push({ id: unique(id), text, category: 'original', certainty: 'inferred', ...fields })
  const warn = (id: string, text: string, fields: Partial<Question> = {}) => { issues.push({ level: 'warn', code: id, message: text }); question(id, text, fields) }
  question('simple-windows', '这是简版方案：窗户没有读出来，请在工具里自己加。', { certainty: 'unknown' })
  if (coordinates.every(n => Math.abs(n) <= 100)) {
    rooms.forEach(r => { r.poly = r.poly.map(p => [p[0] * 1000, p[1] * 1000]) })
    const text = '坐标像是米，已按毫米 ×1000 换算，请核对尺寸'
    notes.push(text); question('simple-units', text)
  }
  snapRooms(rooms, notes)
  const edges = splitEdges(rooms), doors: Door[] = []
  if (input.doors !== undefined && !Array.isArray(input.doors)) warn('simple-doors', 'doors：要写门的数组，已忽略，需自行补门')
  for (const [index, raw] of (Array.isArray(input.doors) ? input.doors : []).entries()) {
    const d = record(raw) ? raw : {}
    extra(d, ['between', 'open', 'from', 'to'])
    let between = d.between
    if (between === undefined && ('from' in d || 'to' in d)) { between = [d.from, d.to]; notes.push(`doors[${index}] 的 from/to 已转成 between`) }
    const pair = Array.isArray(between) && between.length === 2 ? between : []
    const entry = pair.some(outside), refs = entry && outside(pair[0]) ? [pair[1], pair[0]] : pair
    const a = typeof refs[0] === 'string' && !outside(refs[0]) ? aliases.get(refs[0]) : undefined
    const b = typeof refs[1] === 'string' && !outside(refs[1]) ? aliases.get(refs[1]) : undefined
    const label = `doors[${index}]（${pair.map(String).join(' / ')}）`
    if (a === undefined || !entry && b === undefined || a === b) { warn(`simple-door-${index + 1}`, `${label}：房间不存在或两端是同一间房，未生成门`); continue }
    if (!entry && !edges.some(e => e.owners.includes(a) && e.owners.includes(b!))) { warn(`simple-door-${index + 1}`, `${label}：两间房没有共用边，未生成门`); continue }
    doors.push({ index, a, b, entry, open: d.open === true, label })
  }
  if (extras.size) notes.push(`已忽略多余字段：${[...extras].sort().join('、')}`)
  const openPairs = doors.filter(d => d.open && !d.entry)
  const keptEdges = edges.filter(e => !openPairs.some(d => e.owners.includes(d.a!) && e.owners.includes(d.b!)))
  const runs = mergeRuns(keptEdges)
  runs.forEach((run, i) => {
    const wall: Wall = { id: unique(`w${i + 1}`), a: run.a, b: run.b, thickness: DEFAULTS.thickness[run.kind], kind: run.kind, name: run.owners.map(n => rooms[n].name).join(' / ') + (run.kind === 'exterior' ? ' 外墙' : ''), evidence: evidence() }
    run.wall = wall; plan.walls.push(wall)
  })
  for (const door of doors) {
    if (door.open && !door.entry) continue
    const choices = runs.flatMap(run => intervals(run, e => door.entry ? run.kind === 'exterior' && e.owners.includes(door.a!) : e.owners.includes(door.a!) && e.owners.includes(door.b!)).map(span => ({ run, span, length: span[1] - span[0] }))).sort((a, b) => b.length - a.length)
    const chosen = choices[0], qid = `simple-door-${door.index + 1}`
    if (!chosen) { warn(qid, `${door.label}：${door.entry ? '这间房没有外墙' : '共用边为敞开区域，没有墙'}，未生成门`); continue }
    const { run, span, length } = chosen, normalWidth = door.entry ? 1000 : DEFAULTS.opening.door.width
    const width = Math.min(normalWidth, length - 200)
    if (width < 600) { warn(qid, `${door.label}：共用段或外墙段长 ${Math.round(length)} mm，留两侧各 100 mm 后门宽不足 600 mm，未生成门`, { targets: [run.wall!.id] }); continue }
    const offset = Math.max(0, (span[0] + span[1] - width) / 2)
    if (plan.openings.some(o => o.wall === run.wall!.id && Math.min(o.offset + o.width, offset + width) - Math.max(o.offset, offset) > EPS)) {
      warn(qid, `${door.label}：居中位置与已有门重叠，未重复生成门`, { targets: [run.wall!.id] }); continue
    }
    const id = unique(`o${door.index + 1}`)
    plan.openings.push({ id, wall: run.wall!.id, offset, width, kind: 'door', sill: 0, head: DEFAULTS.opening.door.head, ...(door.entry ? { entry: true } : {}), name: door.label, evidence: evidence() })
    if (width < normalWidth) notes.push(`${door.label}：门宽已缩为 ${Math.round(width)} mm，两侧各留 100 mm`)
    if (door.entry) question('simple-entry', `入户门放在了『${rooms[door.a!].name}』最长的那段外墙中间，是工具猜的，请确认，不对就在工具里挪`, { targets: [id] })
  }
  addGeometryQuestions(rooms, edges, question)
  const footprints = plan.walls.map(wallRect)
  // Quantize between boolean operations: rotated wall junctions otherwise leave
  // ulp-sized fragments that polygon-clipping cannot stitch into closed rings.
  const wallArea = footprints.reduce<clipping.MultiPolygon>((all, footprint) => clipping.union(all, footprint).map(p => p.map(r => r.map(round))), [])
  rooms.forEach((room, index) => {
    let net = wallArea.length ? clipping.difference([room.poly], wallArea) : [[room.poly]]
    // Room.poly cannot represent holes. Open each hole to the outside with a 0.01 mm slit.
    const holes = net.flatMap(p => p.slice(1)), bounds = bbox(room.poly)
    if (holes.length) {
      notes.push(`rooms[${index}]（${room.name}）净面含内孔，已用 0.01 mm 细缝连到外缘以保留扣除面积`)
      for (const hole of holes) {
        const p = hole.reduce((a, b) => a[0] < b[0] ? a : b)
        net = clipping.difference(net, [[[bounds[0] - 1, p[1] - .005], [p[0] + .005, p[1] - .005], [p[0] + .005, p[1] + .005], [bounds[0] - 1, p[1] + .005]]])
      }
    }
    net.sort((a, b) => area([b]) - area([a]))
    const poly = net[0] ? cleanRing(net[0][0]) : []
    if (poly.length < 3 || invalidPolygon(poly)) { warn(`simple-room-${index + 1}`, `rooms[${index}]（${room.name}）：扣墙后没有有效净面，未生成房间，请核对尺寸`); return }
    if (net.length > 1) notes.push(`rooms[${index}]（${room.name}）扣墙后分成 ${net.length} 块，保留面积最大的一块`)
    plan.rooms.push({ id: room.id, name: room.name, poly, evidence: evidence() })
  })
  issues.push(...validatePlan(plan))
  return { plan, issues, notes }
}

function addGeometryQuestions(rooms: SimpleRoom[], edges: Edge[], question: (id: string, text: string, fields?: Partial<Question>) => void) {
  let overlap = 0, gap = 0, hole = 0
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const intersection = clipping.intersection([rooms[i].poly], [rooms[j].poly])
    if (area(intersection) > 50000) question(`simple-overlap-${++overlap}`, `『${rooms[i].name}』和『${rooms[j].name}』有重叠，墙可能不对，请核对`, { bbox: bbox(intersection.flat(2)), targets: [rooms[i].id, rooms[j].id] })
  }
  const union = clipping.union([rooms[0].poly], ...rooms.slice(1).map(r => [r.poly]))
  for (const p of union) for (const ring of p.slice(1)) if (polygonArea(ring) > 100000) question(`simple-hole-${++hole}`, '这里有一块空白没有房间，可能漏了房间或坐标没对齐', { bbox: bbox(ring) })
  const external = rooms.flatMap((_, i) => mergeRuns(edges.filter(e => e.owners.length === 1 && e.owners[0] === i)))
  const outward = (e: Edge): Vec2 => {
    const room = rooms[e.owners[0]], d = direction(e.a, e.b)
    const mid = at(e.a, d, distance(e.a, e.b) / 2)
    const index = room.poly.findIndex((a, i) => {
      const b = room.poly[(i + 1) % room.poly.length]
      return Math.abs(cross(sub(mid, a), direction(a, b))) <= EPS && dot(sub(mid, a), sub(mid, b)) <= EPS
    })
    const a = room.poly[index], b = room.poly[(index + 1) % room.poly.length]
    const sign = Math.sign(signedArea(room.poly) * dot(sub(b, a), d))
    return [d[1] * sign, -d[0] * sign]
  }
  for (let i = 0; i < external.length; i++) for (let j = i + 1; j < external.length; j++) {
    const a = external[i], b = external[j], ra = a.owners[0], rb = b.owners[0]
    if (ra === rb) continue
    const d = direction(a.a, a.b)
    if (Math.abs(cross(d, direction(b.a, b.b))) > 1e-8) continue
    const n = outward(a), m = outward(b), delta = sub(b.a, a.a), separation = dot(delta, n)
    if (dot(n, m) > -.999999 || separation <= SIMPLE_SNAP + EPS || separation > 600 + EPS) continue
    const s = dot(delta, d), t = dot(sub(b.b, a.a), d)
    const lo = Math.max(0, Math.min(s, t)), hi = Math.min(distance(a.a, a.b), Math.max(s, t))
    if (hi - lo < 300 - EPS) continue
    const p = at(a.a, d, lo), q = at(a.a, d, hi), corridor: Vec2[] = [p, q, at(q, n, separation), at(p, n, separation)]
    // Parallel segments separated by another room are not an empty gap.
    if (area(clipping.intersection([corridor], union)) > 2 * EPS * (hi - lo + separation)) continue
    question(`simple-gap-${++gap}`, `『${rooms[ra].name}』和『${rooms[rb].name}』之间有一条 ${Math.round(separation)} mm 的缝，生成了两道外墙，请核对`, { bbox: bbox(corridor), targets: [rooms[ra].id, rooms[rb].id] })
  }
}

/** Diagnose shape, not individual full-format field/geometry errors. Legacy recognition comes first. */
export function diagnoseShape(value: unknown): { wrong: boolean; reasons: string[] } {
  if (isSimplePlan(value)) return { wrong: false, reasons: [] }
  if (!record(value)) return { wrong: true, reasons: ['最外层不是一个 JSON 对象'] }
  const arrays = ['walls', 'openings', 'beams', 'rooms', 'questions', 'changes']
  const roomsOnly = (v: Record<string, unknown>) => Array.isArray(v.rooms) && v.rooms.length > 0 && (!Array.isArray(v.walls) || v.walls.length === 0)
  if (value.format === 'floorplan-structure' && [2, 3].includes(value.version as number) && arrays.every(k => Array.isArray(value[k])) && !roomsOnly(value)) return { wrong: false, reasons: [] }
  try { if (fromLegacy(value).plan.walls.length > 0) return { wrong: false, reasons: [] } } catch { /* Not an importable legacy layout. */ }
  const reasons: string[] = []
  if (!('format' in value) || !('version' in value)) reasons.push('没有 format 和 version 两个字段')
  if ('floorplan-structure' in value) reasons.push(`格式标记写成了 "floorplan-structure": ${JSON.stringify(value['floorplan-structure'])}，应该是 format、version 两个字段`)
  const wrappers = !('walls' in value) && !('rooms' in value) ? Object.entries(value).filter(([, v]) => record(v) && ('walls' in v || 'rooms' in v)) : []
  for (const [key] of wrappers) reasons.push(`外面多套了一层 ${key}`)
  const shapes = [value, ...wrappers.map(([, v]) => v as Record<string, unknown>)]
  if (shapes.some(roomsOnly)) reasons.push('walls 是空的，只有房间')
  if (shapes.some(v => Array.isArray(v.doors) || Array.isArray(v.openings) && v.openings.some(o => record(o) && !('wall' in o) && !('offset' in o) && !('width' in o) && ('from' in o || 'to' in o)))) reasons.push('门写成了房间之间的关系，没有位置和宽度')
  return { wrong: reasons.length > 0, reasons }
}

/** 每段复制给 Chat 的文字都用这段收尾。只说 JSON 怎么放，不说「只输出」：推理一般的 Chat 会照最后一条消息做，把提示词要的使用段落挤掉；再把「去工具里看」说死，免得它说要自己渲染 */
export const CHAT_REPLY_TAIL = 'JSON 放在一个 ```json 代码块里，从 { 到 } 完整输出，不要拆开。代码块前面先写一句：「看效果：复制下面整段 JSON，回到『改改你的家』（try-your-home），点『粘贴方案』贴进去。」不要自己画图、写 SVG / HTML 代码，也不要说要帮我渲染或预览：看 3D、看效果都在 try-your-home 里。'

export function simpleFormatChatText(reasons: string[]): string {
  const intro = reasons.length
    ? `你上次输出的方案 JSON 格式不对，工具读不了：\n${reasons.map(r => `- ${r}`).join('\n')}\n\n不要再写完整格式了。请改用下面的「简版格式」重新输出：只写房间和门，墙和门洞由工具自动生成。`
    : '请改用下面的简版格式重新输出方案：只写房间和门，墙和门洞由工具自动生成。'
  return `${intro}\n\n简版规则：\n${SIMPLE_RULES.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\n简版模板（照这个结构写你家的房间和门）：\n\`\`\`json\n${SIMPLE_TEMPLATE}\n\`\`\`\n\n${CHAT_REPLY_TAIL}`
}
