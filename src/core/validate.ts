import { validatePlanDecor } from './decor/integration.ts'
import type { Plan, Vec2 } from './types.ts'
import type { ElementRef } from './geometry.ts'
import { effectiveWallHeight, polygonArea, wallLength } from './geometry.ts'
import { levelsOf } from './levels.ts'
import { questionElementIds, questionStatus } from './questions.ts'

export interface Issue { level: 'error' | 'warn'; code: string; message: string; ref?: ElementRef }
export const WALL_KINDS = ['exterior', 'bearing', 'partition', 'glass', 'half', 'half-glass']
export const OPENING_KINDS = ['door', 'sliding', 'doorway', 'window', 'floor-window', 'bay-window', 'open-balcony']
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const point = (p: any): p is Vec2 => Array.isArray(p) && p.length === 2 && p.every(finite)
function intersects(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const cross = (p: Vec2, q: Vec2, r: Vec2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const on = (p: Vec2, q: Vec2, r: Vec2) => Math.abs(cross(p, q, r)) < 1e-7 && r[0] >= Math.min(p[0], q[0]) && r[0] <= Math.max(p[0], q[0]) && r[1] >= Math.min(p[1], q[1]) && r[1] <= Math.max(p[1], q[1])
  const x = cross(a, b, c), y = cross(a, b, d), z = cross(c, d, a), w = cross(c, d, b)
  return x * y < 0 && z * w < 0 || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b)
}
export function invalidPolygon(poly: Vec2[]): boolean {
  if (polygonArea(poly) < 1e-7) return true
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    if (a[0] === b[0] && a[1] === b[1]) return true
    for (let j = i + 1; j < poly.length; j++) if (j !== i + 1 && !(i === 0 && j === poly.length - 1) && intersects(a, b, poly[j], poly[(j + 1) % poly.length])) return true
  }
  return false
}
export function validatePlan(plan: Plan): Issue[] {
  const issues: Issue[] = [], error = (code: string, message: string, ref?: ElementRef) => issues.push({ level: 'error', code, message, ...(ref ? { ref } : {}) })
  if (!plan || typeof plan !== 'object') { error('shape', '方案必须是对象'); return issues }
  if (plan.format !== 'floorplan-structure' || plan.version !== 2) error('format', '方案必须使用 floorplan-structure v2')
  if (typeof plan.title !== 'string' || !finite(plan.ceiling) || plan.ceiling <= 0) error('plan', '方案标题或层高无效')
  for (const k of ['walls', 'openings', 'beams', 'rooms', 'questions', 'changes'] as const) if (!Array.isArray(plan[k])) error('shape', `${k} 必须是数组`)
  for (const k of ['levels', 'columns', 'shafts', 'stairs', 'voids'] as const) if (plan[k] !== undefined && !Array.isArray(plan[k])) error('shape', `${k} 必须是数组`)
  if (issues.some(i => i.code === 'shape')) return issues
  const seen = new Set<string>()
  for (const [type, items] of Object.entries({ wall: plan.walls, opening: plan.openings, beam: plan.beams, room: plan.rooms, question: plan.questions, change: plan.changes, level: plan.levels ?? [], column: plan.columns ?? [], shaft: plan.shafts ?? [], stair: plan.stairs ?? [], void: plan.voids ?? [] })) for (const item of items) {
    if (!item || typeof item !== 'object') { error('shape', `${type} 包含非对象条目`); continue }
    const ref = ['wall', 'opening', 'beam', 'room', 'column', 'shaft', 'stair', 'void'].includes(type) ? { type, id: item.id } as ElementRef : undefined
    if (typeof item.id !== 'string' || !item.id) error('id', `${type} 缺少有效 id`, ref)
    else if (seen.has(item.id)) error('duplicate-id', `重复 id：${item.id}`, ref); else seen.add(item.id)
    if ('evidence' in item && item.evidence && !['seen', 'inferred', 'unknown'].includes(item.evidence.certainty)) error('enum', `${item.id} 的证据确定度不认识`, ref)
  }
  if (issues.some(i => i.code === 'shape')) return issues
  const levels = levelsOf(plan).filter(Boolean), levelIds = new Set(levels.map(l => l.id))
  if (plan.levels && !plan.levels.length) error('levels', 'levels 至少包含一层，单层可省略 levels')
  levels.forEach((l, i) => {
    if (typeof l.name !== 'string' || !finite(l.elevation) || l.ceiling !== undefined && (!finite(l.ceiling) || l.ceiling <= 0)) error('level', `楼层 ${l.id} 的名称、标高或层高无效`)
    if (i > 0 && l.elevation <= levels[i - 1].elevation) error('level-order', '各层标高必须按数组顺序严格递增')
  })
  for (const e of [...plan.walls, ...plan.beams, ...plan.rooms, ...plan.questions, ...(plan.columns ?? []), ...(plan.shafts ?? []), ...(plan.stairs ?? []), ...(plan.voids ?? [])].filter(Boolean)) {
    if (e.level !== undefined && !levelIds.has(e.level)) error('level-reference', `构件 ${e.id} 的楼层 ${e.level} 不存在`)
  }
  for (const e of [...(plan.shafts ?? []), ...(plan.stairs ?? []), ...(plan.voids ?? [])].filter(Boolean)) {
    if (!Array.isArray(e.poly) || e.poly.length < 3 || !e.poly.every(point)) { error('extra-points', `构件 ${e.id} 需要至少三个有效顶点`); continue }
    if (invalidPolygon(e.poly)) error('extra-polygon', `构件 ${e.id} 多边形退化或自交`)
  }
  for (const c of (plan.columns ?? []).filter(Boolean)) {
    if (!point(c.center) || !point(c.size) || c.size.some(s => s <= 0) || c.shape === 'round' && c.size[0] !== c.size[1] || c.rotation !== undefined && !finite(c.rotation)) error('column', `柱 ${c.id} 的位置、尺寸或旋转无效`)
    if (!['rect', 'round'].includes(c.shape) || !['bearing', 'decorative'].includes(c.kind)) error('enum', `柱 ${c.id} 的类型无效`)
  }
  for (const s of (plan.shafts ?? []).filter(Boolean)) if (!['flue', 'pipe', 'vent', 'other'].includes(s.kind)) error('enum', `管道井 ${s.id} 类型无效`)
  for (const s of (plan.stairs ?? []).filter(Boolean)) {
    if (!levelIds.has(s.level) || !levelIds.has(s.to) || s.level === s.to) error('stair-level', `楼梯 ${s.id} 的起止楼层必须存在且不同`)
    else if (levels.find(l => l.id === s.to)!.elevation <= levels.find(l => l.id === s.level)!.elevation) error('stair-direction', `楼梯 ${s.id} 的目标层必须高于起点层`)
    if (!Array.isArray(s.path) || s.path.length < 2 || !s.path.every(point) || s.path.slice(1).some((p, i) => p[0] === s.path[i][0] && p[1] === s.path[i][1])) error('stair-path', `楼梯 ${s.id} 的上行路径需要至少两个不重合的有效点`)
    if (!finite(s.width) || s.width <= 0 || s.steps !== undefined && (!Number.isInteger(s.steps) || s.steps <= 0)) error('stair-size', `楼梯 ${s.id} 的宽度或踏步数无效`)
    if (!['straight', 'L', 'U', 'spiral'].includes(s.kind)) error('enum', `楼梯 ${s.id} 类型无效`)
  }
  for (const v of (plan.voids ?? []).filter(Boolean)) if (!levelIds.has(v.level)) error('level-reference', `挑空 ${v.id} 必须指定有效楼层`)
  const validWalls = plan.walls.filter(w => w && point(w.a) && point(w.b) && (w.bulge === undefined || finite(w.bulge)))
  const safePlan = { ...plan, walls: validWalls, rooms: plan.rooms.filter(r => r && Array.isArray(r.poly) && r.poly.every(point)) }
  for (const w of plan.walls.filter(Boolean)) {
    const ref: ElementRef = { type: 'wall', id: w.id }
    if (!validWalls.includes(w) || !finite(w.thickness) || w.thickness <= 0 || validWalls.includes(w) && wallLength(w) <= 1e-7) error('wall-geometry', `墙 ${w.id} 的端点、厚度或长度无效`, ref)
    if (!WALL_KINDS.includes(w.kind)) error('enum', `墙 ${w.id} 的类型不认识`, ref)
    if (w.height !== undefined && (!finite(w.height) || w.height <= 0) || w.lowHeight !== undefined && (!finite(w.lowHeight) || w.lowHeight < 0)) error('height', `墙 ${w.id} 的高度无效`, ref)
  }
  for (const o of plan.openings.filter(Boolean)) {
    const ref: ElementRef = { type: 'opening', id: o.id }, w = validWalls.find(w => w.id === o.wall)
    if (!OPENING_KINDS.includes(o.kind)) error('enum', `洞口 ${o.id} 的类型不认识`, ref)
    if (!w) error('opening-host', `洞口 ${o.id} 的宿主墙 ${o.wall} 不存在或几何无效`, ref)
    else {
      if (![o.offset, o.width].every(finite) || o.width <= 0 || o.offset < 0 || o.offset + o.width > wallLength(w) + 1e-5) error('opening-range', `洞口 ${o.id} 超出墙长或宽度无效`, ref)
      if (o.head > effectiveWallHeight(safePlan, w) + 1e-7) error('opening-head', `洞口 ${o.id} 洞顶超过墙高`, ref)
    }
    if (![o.sill, o.head].every(finite) || o.sill < 0 || o.sill >= o.head) error('opening-height', `洞口 ${o.id} 洞底必须非负且低于洞顶`, ref)
    if (o.swing && (!['start', 'end'].includes(o.swing.hinge) || ![1, -1].includes(o.swing.side))) error('enum', `洞口 ${o.id} 开向无效`, ref)
    if (o.panes && (!Array.isArray(o.panes) || !o.panes.length || o.panes.some(p => !p || !finite(p.width) || p.width <= 0 || !['fixed', 'casement', 'sliding'].includes(p.kind)))) error('pane', `洞口 ${o.id} 分扇比例或类型无效`, ref)
  }
  for (let i = 0; i < plan.openings.length; i++) for (let j = i + 1; j < plan.openings.length; j++) { const a = plan.openings[i], b = plan.openings[j]; if (a && b && a.wall === b.wall && Math.min(a.offset + a.width, b.offset + b.width) - Math.max(a.offset, b.offset) > 1e-5) error('opening-overlap', `同墙洞口 ${a.id} 与 ${b.id} 重叠`, { type: 'opening', id: a.id }) }
  for (const r of plan.rooms.filter(Boolean)) {
    const ref: ElementRef = { type: 'room', id: r.id }
    if (typeof r.name !== 'string' || !Array.isArray(r.poly) || r.poly.length < 3 || !r.poly.every(point)) { error('room-points', `房间 ${r.id} 需要名称和至少三个有效顶点`, ref); continue }
    let invalid = false
    for (let i = 0; i < r.poly.length; i++) for (let j = i + 1; j < r.poly.length; j++) if (j !== i + 1 && !(i === 0 && j === r.poly.length - 1) && intersects(r.poly[i], r.poly[(i + 1) % r.poly.length], r.poly[j], r.poly[(j + 1) % r.poly.length])) invalid = true
    if (invalid || invalidPolygon(r.poly)) error('room-self-intersection', `房间 ${r.id} 多边形自交`, ref)
    if (r.ceiling !== undefined && (!finite(r.ceiling) || r.ceiling <= 0) || r.floorOffset !== undefined && !finite(r.floorOffset)) error('height', `房间 ${r.id} 层高或地面抬高无效`, ref)
  }
  for (const b of plan.beams.filter(Boolean)) if (!point(b.a) || !point(b.b) || !finite(b.width) || b.width <= 0 || !finite(b.bottom) || b.bottom < 0) error('beam', `梁 ${b.id} 的端点、宽度或梁底无效`, { type: 'beam', id: b.id })
  for (const q of plan.questions.filter(Boolean)) if (!['original', 'renovation'].includes(q.category) || q.certainty !== undefined && !['seen', 'inferred', 'unknown'].includes(q.certainty)) error('enum', `问题 ${q.id} 的分类或确定度不认识`)
  const questionIds = plan.questions.some(q => q?.reply?.changed?.length) ? questionElementIds(plan) : new Set<string>()
  for (const q of plan.questions.filter(Boolean)) {
    const status = questionStatus(q), warn = (message: string) => issues.push({ level: 'warn', code: 'question-status', message: `问题卡 ${q.id}：${message}` })
    if (status === 'answered' && !q.answer?.trim()) warn('status 是 answered，但没有答复')
    if (status === 'answered' && q.reply) warn('status 是 answered，但还挂着 reply')
    if (status === 'resolved' && !q.reply) warn('status 是 resolved，但没有 reply')
    if (q.reply?.outcome === 'ask' && status !== 'open') warn('reply.outcome 是 ask，但 status 不是 open')
    for (const id of q.reply?.changed ?? []) if (!questionIds.has(id)) warn(`reply.changed 里的构件 ${id} 在方案里找不到`)
  }
  for (const c of plan.changes.filter(Boolean)) {
    if (!['add', 'remove', 'update'].includes(c.op) || !['wall', 'opening', 'beam', 'room', 'column', 'shaft', 'stair', 'void'].includes(c.type) || !['user', 'agent'].includes(c.by) || !['pending', 'confirmed'].includes(c.status)) error('enum', `改造 ${c.id} 的操作、类型、作者或状态不认识`)
    if (c.op !== 'add' && !c.target || c.op !== 'remove' && (!c.data || typeof c.data !== 'object')) error('change-params', `改造 ${c.id} 缺少目标或参数`)
  }
  if (plan.levelUnderlays && (typeof plan.levelUnderlays !== 'object' || Array.isArray(plan.levelUnderlays))) error('underlay', 'levelUnderlays 必须是按楼层 id 索引的对象')
  for (const id of Object.keys(plan.levelUnderlays ?? {})) if (!levelIds.has(id)) error('level-reference', `底图楼层 ${id} 不存在`)
  for (const u of [plan.underlay, ...Object.values(plan.levelUnderlays ?? {})].filter(Boolean)) {
    if (!u || typeof u !== 'object') { error('underlay', '底图必须是对象'); continue }
    const src = typeof u.src === 'string' ? u.src.trim() : ''
    if (/^(?:[a-z][a-z\d+.-]*:|[/\\]{2})/i.test(src) && !/^data:image\/(?:(?:png|jpe?g|webp|gif|bmp|avif);base64|svg\+xml(?:;charset=utf-8)?(?:;base64)?),.+$/i.test(src)) error('underlay-remote', '底图必须为本地相对路径或内嵌图片（含 SVG）data URL，禁止远程地址和外部协议')
    if (!src || !finite(u.mmPerPx) || u.mmPerPx <= 0 || !point(u.origin) || !finite(u.opacity) || u.opacity < 0 || u.opacity > 100 || typeof u.visible !== 'boolean' || u.mmPerPxY !== undefined && (!finite(u.mmPerPxY) || u.mmPerPxY <= 0)) error('underlay', '底图路径、比例、原点或显示参数无效')
  }
  if (plan.decor !== undefined && !issues.some(i => i.level === 'error')) for (const i of validatePlanDecor(plan)) issues.push({ level: i.level === 'error' ? 'error' : 'warn', code: 'decor-' + i.code, message: `${i.id}：${i.text}` })
  return issues
}
