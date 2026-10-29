import type { Box, Change, ExtraElementType, Plan, Vec2 } from './types.ts'
import { beamFootprint, columnFootprint, labelPoint, openingFootprint, openingSpan, planBounds, pointAt, sliceWall, wallFootprint, wallLength } from './geometry.ts'
import { collection } from './changes.ts'
/** Preview-only extension; persisted Plan.changes continues to use the unchanged Change contract. */
export type FocusChange = Omit<Change, 'type'> & { type: Change['type'] | ExtraElementType }
import { levelOf, onLevel } from './levels.ts'

export type FocusView = 'plan' | 'elevation' | '3d'
export interface Focus {
  /** Representative change id, lexically smallest id within the group. */
  changeId: string
  changeIds: string[]
  group?: string
  anchor: Vec2
  bbox: Box
  level: string
  view: FocusView
  reason: string
  wall?: string
  room?: string
  /** Whole-level frame used for the first overview attempt. */
  overview: Box
}
export interface Page {
  view: FocusView
  level: string
  frame: Box
  wall?: string
  room?: string
  items: { changeId: string; number: number; anchor: Vec2 }[]
}
export interface PaginationOptions {
  /** Width / height of the drawable image area, excluding text/margins. Default A4 landscape. */
  aspectRatio?: number
  /** Actual paper width of that image area, mm. Default 277. */
  pageWidthMm?: number
  /** Minimum Euclidean distance between badge centers on paper, mm. Default 10. */
  minNumberSpacing?: number
  maxItems?: number
  /** Model-space padding around a detail frame, mm. Default 200. */
  margin?: number
}
const box = (points: Vec2[]): Box => [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])), Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))]
const union = (boxes: Box[]): Box => [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])), Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))]
function viewFor(c: FocusChange): { view: FocusView; reason: string } {
  const d = c.data ?? {}
  if (c.type === 'stair') return { view: '3d', reason: '楼梯连接不同楼层，需要空间视图说明' }
  if (c.type === 'room' && c.op !== 'remove' && ('ceiling' in d || 'floorOffset' in d)) return { view: '3d', reason: '房间层高或地面高差需要空间视图说明' }
  if (c.type === 'beam') return { view: 'elevation', reason: '梁底和梁顶高度需要立面说明' }
  if (c.type === 'opening' && c.op === 'update' && ['sill', 'head', 'kind'].some(k => k in d)) return { view: 'elevation', reason: '洞底、洞顶或洞口类型变化需要宿主墙立面说明' }
  if (c.type === 'wall' && c.op === 'update' && ['glass', 'half', 'half-glass'].includes(String(d.kind))) return { view: 'elevation', reason: '玻璃或矮墙的竖向构成需要立面说明' }
  return { view: 'plan', reason: '墙体、开洞封洞或房间边界适合平面前后对比' }
}
function geometry(plan: Plan, c: FocusChange, item: any): { anchor: Vec2; bbox: Box; level: string; wall?: string; room?: string } | null {
  if (!item) return null
  let points: Vec2[], anchor: Vec2, wall: string | undefined, room: string | undefined
  if (c.type === 'wall') {
    const w = c.range ? sliceWall(item, c.range[0], c.range[1]) : item
    points = wallFootprint(w); anchor = pointAt(w, wallLength(w) / 2); wall = item.id
  } else if (c.type === 'opening') {
    if (!plan.walls.some(w => w.id === item.wall)) return null
    points = openingFootprint(plan, item); anchor = openingSpan(plan, item).center; wall = item.wall
  } else if (c.type === 'beam') {
    points = beamFootprint(item); anchor = [(item.a[0] + item.b[0]) / 2, (item.a[1] + item.b[1]) / 2]
    // A beam has no host wall in the contract. Its id identifies an independent elevation plane.
    wall = item.id
  } else if (c.type === 'column') { points = columnFootprint(item); anchor = item.center }
  else { points = item.poly; anchor = labelPoint(points); if (c.type === 'room' || c.type === 'stair') room = item.id }
  if (!points.length) return null
  return { anchor, bbox: box(points), level: levelOf(plan, item).id, ...(wall ? { wall } : {}), ...(room ? { room } : {}) }
}
/** Focuses describe proposals, including pending protected operations, without executing them. */
export function changeFocus(base: Plan, changes: FocusChange[]): Focus[] {
  const collections = { ...collection, column: 'columns', shaft: 'shafts', stair: 'stairs', void: 'voids' } as const
  const state = structuredClone(base), groups = new Map<string, Focus[]>()
  for (const c of changes) {
    const list = (state[collections[c.type]] ??= []) as any[]
    if (!list) throw new Error(`改造 ${c.id} 的构件类型暂不支持关注框`)
    const old = list.find(e => e.id === c.target), item = c.op === 'add' ? structuredClone(c.data) : c.op === 'update' ? { ...old, ...structuredClone(c.data) } : old
    if (!item || c.op !== 'add' && !old) throw new Error(`改造 ${c.id} 的目标不存在`)
    const before = geometry(state, c, old), current = geometry(state, c, item)
    const g = c.op === 'remove' ? before : current
    if (!g) throw new Error(`改造 ${c.id} 缺少可定位的几何`)
    const bbox = union([g.bbox, ...(before ? [before.bbox] : [])]), overview = planBounds(onLevel(state, g.level)) ?? bbox
    const f: Focus = { changeId: c.id, changeIds: [c.id], ...(c.group ? { group: c.group } : {}), ...g, bbox, ...viewFor(c), overview: union([overview, bbox]) }
    const key = c.group ? `group:${c.group}` : `change:${c.id}`
    groups.set(key, [...(groups.get(key) ?? []), f])
    // Update a private geometry-only timeline, so later edits can reference newly added elements.
    if (c.op === 'add') list.push(item)
    else if (c.op === 'update') list[list.indexOf(old)] = item
    else if (c.type === 'wall' && c.range) {
      const length = wallLength(old), intervals = [[0, c.range[0]], [c.range[1], length]].filter(([a, b]) => b > a)
      const walls = intervals.map(([a, b], i) => ({ ...sliceWall(old, a, b), id: i ? `${old.id}~${c.id}` : old.id }))
      list.splice(list.indexOf(old), 1, ...walls)
      state.openings = state.openings.flatMap(o => {
        if (o.wall !== old.id) return [o]
        const index = intervals.findIndex(([a, b]) => o.offset >= a && o.offset + o.width <= b)
        return index < 0 ? [] : [{ ...o, wall: walls[index].id, offset: o.offset - intervals[index][0] }]
      })
    } else {
      list.splice(list.indexOf(old), 1)
      if (c.type === 'wall') state.openings = state.openings.filter(o => o.wall !== old.id)
    }
  }
  const rank = { plan: 0, elevation: 1, '3d': 2 }
  return [...groups.values()].map(items => {
    const sorted = [...items].sort((a, b) => rank[b.view] - rank[a.view] || a.changeId.localeCompare(b.changeId)), chosen = sorted[0]
    const changeIds = items.flatMap(f => f.changeIds).sort()
    return { ...chosen, changeId: changeIds[0], changeIds, bbox: union(items.map(f => f.bbox)), overview: union(items.map(f => f.overview)), reason: [...new Set(sorted.map(f => f.reason))].join('；') }
  })
}

/** One page per item/group exactly: a successful overview is also its detail page. */
export function paginate(focuses: Focus[], opts: PaginationOptions = {}): Page[] {
  const aspect = opts.aspectRatio ?? 277 / 190, paperWidth = opts.pageWidthMm ?? 277, spacing = opts.minNumberSpacing ?? 10, limit = opts.maxItems ?? 8, margin = opts.margin ?? 200
  if (![aspect, paperWidth, spacing, limit, margin].every(Number.isFinite) || aspect <= 0 || paperWidth <= 0 || spacing < 0 || limit < 1 || !Number.isInteger(limit) || margin < 0) throw new Error('分页参数无效')
  if (new Set(focuses.map(f => f.changeId)).size !== focuses.length) throw new Error('关注条目 changeId 必须唯一')
  for (const f of focuses) if (![...f.anchor, ...f.bbox, ...f.overview].every(Number.isFinite) || f.bbox[2] < f.bbox[0] || f.bbox[3] < f.bbox[1]) throw new Error('关注框或锚点无效')
  const ordered = [...focuses].sort((a, b) => a.anchor[1] - b.anchor[1] || a.anchor[0] - b.anchor[0] || a.level.localeCompare(b.level) || a.changeId.localeCompare(b.changeId))
  const numbers = new Map(ordered.map((f, i) => [f.changeId, i + 1])), groups = new Map<string, Focus[]>()
  for (const f of ordered) {
    const key = JSON.stringify([f.view, f.level, f.view === 'plan' ? '' : f.wall ?? f.room ?? f.changeId])
    groups.set(key, [...(groups.get(key) ?? []), f])
  }
  const frameFor = (boxes: Box[]): Box => {
    const b = union(boxes), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2
    let width = Math.max(1, b[2] - b[0] + 2 * margin), height = Math.max(1, b[3] - b[1] + 2 * margin)
    if (width / height < aspect) width = height * aspect; else height = width / aspect
    return [cx - width / 2, cy - height / 2, cx + width / 2, cy + height / 2]
  }
  const fits = (items: Focus[], frame: Box) => items.length <= limit && items.every((a, i) => items.slice(i + 1).every(b => Math.hypot(a.anchor[0] - b.anchor[0], a.anchor[1] - b.anchor[1]) * paperWidth / (frame[2] - frame[0]) >= spacing - 1e-9))
  const pages: Page[] = []
  const split = (items: Focus[], overview: boolean) => {
    const frame = frameFor(items.map(f => overview ? f.overview : f.bbox))
    if (items.length === 1 || fits(items, frame)) {
      const first = items[0]
      pages.push({ view: first.view, level: first.level, frame, ...(first.view !== 'plan' && first.wall ? { wall: first.wall } : {}), ...(first.view !== 'plan' && first.room ? { room: first.room } : {}),
        items: [...items].sort((a, b) => numbers.get(a.changeId)! - numbers.get(b.changeId)!).map(f => ({ changeId: f.changeId, number: numbers.get(f.changeId)!, anchor: [...f.anchor] })) })
      return
    }
    // Retry at detail scale before partitioning; shrinking the frame can resolve the crowding.
    if (overview) { split(items, false); return }
    const b = box(items.map(f => f.anchor)), axis = b[2] - b[0] >= b[3] - b[1] ? 0 : 1
    const sorted = [...items].sort((a, b) => a.anchor[axis] - b.anchor[axis] || a.changeId.localeCompare(b.changeId)), middle = Math.ceil(sorted.length / 2)
    split(sorted.slice(0, middle), false); split(sorted.slice(middle), false)
  }
  for (const items of groups.values()) split(items, items[0].view === 'plan')
  return pages
}
