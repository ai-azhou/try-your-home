import { PROTECTED_KINDS } from './types.ts'
import type { Change, Column, ElementType, Opening, Plan, PlanElement, Wall } from './types.ts'
import { effectiveWallHeight, roomsBesideWall, sliceWall, wallLength } from './geometry.ts'
import { shaftRemovalError } from './protection.ts'
import { levelsOf } from './levels.ts'
import { mirrorBounds } from './mirror-frame.ts'
import { invalidPolygon, validatePlan } from './validate.ts'
export interface ChangeResult { id: string; ok: boolean; error?: string; needsConfirm?: boolean; affected: string[]; removed: string[]; warnings?: string[] }
// In-memory provenance for handoff; never trust or persist user-supplied metadata for this.
const replayOrigins = new WeakMap<Plan, { base: Plan; protectedWalls: Set<string>; bearingColumns: Set<string> }>()
export const replayOrigin = (plan: Plan) => replayOrigins.get(plan)
export const collection = { wall: 'walls', opening: 'openings', beam: 'beams', room: 'rooms', column: 'columns', shaft: 'shafts', stair: 'stairs', void: 'voids' } as const
/** 某类构件的数组；可选集合（柱、管道井、楼梯、挑空）缺省时返回空数组（不写回方案） */
export function elements(plan: Plan, type: ElementType): PlanElement[] { return (plan[collection[type]] ?? []) as PlanElement[] }
/** 可写的数组：可选集合缺省时在 plan 上建一个空数组 */
function mutableElements(plan: Plan, type: ElementType): PlanElement[] { const key = collection[type]; return ((plan as unknown as Record<string, PlanElement[]>)[key] ??= []) }
const allIds = (plan: Plan) => new Set([...plan.walls, ...plan.openings, ...plan.beams, ...plan.rooms, ...plan.changes, ...plan.questions, ...(plan.levels ?? []), ...(plan.columns ?? []), ...(plan.shafts ?? []), ...(plan.stairs ?? []), ...(plan.voids ?? [])].map(x => x.id))
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const point = (v: any) => Array.isArray(v) && v.length === 2 && v.every(finite)
function checkElement(plan: Plan, type: ElementType, item: any): string | undefined {
  if (!item || typeof item.id !== 'string' || !item.id) return '构件缺少有效 id'
  if (item.level !== undefined && !levelsOf(plan).some(l => l.id === item.level)) return '楼层引用不存在'
  if (type === 'wall' || type === 'beam') {
    if (!point(item.a) || !point(item.b) || Math.hypot(item.b[0] - item.a[0], item.b[1] - item.a[1]) < 1e-7) return '端点缺失或长度为零'
    if (!finite(type === 'wall' ? item.thickness : item.width) || (type === 'wall' ? item.thickness : item.width) <= 0) return '厚度或宽度必须为正数'
    if (type === 'wall' && !['exterior', 'bearing', 'partition', 'glass', 'half', 'half-glass'].includes(item.kind)) return '墙类型不认识'
    if (type === 'wall' && (item.height !== undefined && (!finite(item.height) || item.height <= 0) || item.bulge !== undefined && !finite(item.bulge) || item.lowHeight !== undefined && (!finite(item.lowHeight) || item.lowHeight < 0))) return '墙高或矢高无效'
    if (type === 'beam' && (!finite(item.bottom) || item.bottom < 0)) return '梁底高度无效'
  }
  if (type === 'room') {
    if (typeof item.name !== 'string' || !Array.isArray(item.poly) || item.poly.length < 3 || !item.poly.every(point)) return '房间需要名称和至少三个有效顶点'
    if (item.ceiling !== undefined && (!finite(item.ceiling) || item.ceiling <= 0) || item.floorOffset !== undefined && !finite(item.floorOffset)) return '房间高度无效'
  }
  if (type === 'opening') {
    const w = plan.walls.find(w => w.id === item.wall)
    if (!w) return `宿主墙 ${item.wall ?? ''} 不存在`
    if (!['door', 'sliding', 'doorway', 'window', 'floor-window', 'bay-window', 'open-balcony'].includes(item.kind)) return '洞口类型不认识'
    if (![item.offset, item.width, item.sill, item.head].every(finite) || item.width <= 0 || item.offset < 0 || item.offset + item.width > wallLength(w) + 1e-6) return '洞口尺寸缺失或超出墙长'
    if (item.sill < 0 || item.head <= item.sill || item.head > effectiveWallHeight(plan, w) + 1e-7) return '洞底、洞顶与墙高不相容'
    if (plan.openings.some(o => o.id !== item.id && o.wall === item.wall && Math.min(o.offset + o.width, item.offset + item.width) - Math.max(o.offset, item.offset) > 1e-6)) return '同墙洞口重叠'
    if (item.panes && (!Array.isArray(item.panes) || !item.panes.length || item.panes.some((p: any) => !finite(p.width) || p.width <= 0 || !['fixed', 'casement', 'sliding'].includes(p.kind)))) return '窗分扇无效'
    if (item.swing && (!['start', 'end'].includes(item.swing.hinge) || ![1, -1].includes(item.swing.side))) return '门开向无效'
  }
  const poly = (v: any) => Array.isArray(v) && v.length >= 3 && v.every(point) && !invalidPolygon(v)
  if (type === 'column') {
    if (!point(item.center) || !point(item.size) || item.size.some((v: number) => v <= 0)) return '柱的位置或尺寸无效'
    if (!['rect', 'round'].includes(item.shape) || !['bearing', 'decorative'].includes(item.kind)) return '柱的形状或类型不认识'
    if (item.shape === 'round' && item.size[0] !== item.size[1]) return '圆柱的两个尺寸必须相等'
    if (item.rotation !== undefined && !finite(item.rotation)) return '柱的旋转角无效'
  }
  if (type === 'shaft') {
    if (!poly(item.poly)) return '管道井需要至少三个不自交的顶点'
    if (!['flue', 'pipe', 'vent', 'other'].includes(item.kind)) return '管道井类型不认识'
  }
  if (type === 'void') {
    if (!levelsOf(plan).some(l => l.id === item.level)) return '挑空必须指定有效楼层'
    if (!poly(item.poly)) return '挑空需要至少三个不自交的顶点'
  }
  if (type === 'stair') {
    const levels = levelsOf(plan), from = levels.find(l => l.id === item.level), to = levels.find(l => l.id === item.to)
    if (!from || !to || from.id === to.id) return '楼梯的起止楼层必须存在且不同'
    if (to.elevation <= from.elevation) return '楼梯要通到更高的一层'
    if (!poly(item.poly)) return '楼梯占地需要至少三个不自交的顶点'
    if (!Array.isArray(item.path) || item.path.length < 2 || !item.path.every(point) || item.path.slice(1).some((p: number[], i: number) => p[0] === item.path[i][0] && p[1] === item.path[i][1])) return '楼梯上行路径需要至少两个不重合的点'
    if (!finite(item.width) || item.width <= 0 || item.steps !== undefined && (!Number.isInteger(item.steps) || item.steps <= 0)) return '楼梯宽度或踏步数无效'
    if (!['straight', 'L', 'U', 'spiral'].includes(item.kind)) return '楼梯类型不认识'
  }
}
export function applyChanges(base: Plan, changes: Change[]): { plan: Plan; results: ChangeResult[] } {
  let plan = structuredClone(base)
  const results: ChangeResult[] = [], protectedIds = new Set(base.walls.filter(w => PROTECTED_KINDS.includes(w.kind) || w.evidence?.certainty === 'unknown').map(w => w.id))
  const isProtected = (w: Wall | undefined) => !!w && (protectedIds.has(w.id) || PROTECTED_KINDS.includes(w.kind))
  // 承重柱和承重墙同一套规则：拆除要二次确认（按原始结构里的类型记，改成装饰柱再拆也要确认）
  const bearingColumns = new Set((base.columns ?? []).filter(c => c.kind === 'bearing').map(c => c.id))
  for (const change of changes) {
    const r: ChangeResult = { id: change.id, ok: false, affected: [], removed: [] }, next = structuredClone(plan)
    try {
      const blocked = change.op === 'remove' ? shaftRemovalError(next, change.target) : undefined
      if (blocked) throw new Error(blocked)
      if (!collection[change.type] || !['add', 'remove', 'update'].includes(change.op)) throw new Error('改造操作或构件类型不认识')
      if (!['user', 'agent'].includes(change.by) || !['pending', 'confirmed'].includes(change.status)) throw new Error('改造作者或状态无效')
      const list = mutableElements(next, change.type), old = list.find(x => x.id === change.target)
      if (change.op !== 'add' && !old) throw new Error(`目标 ${change.target ?? '（未指定）'} 不存在`)
      if (change.op !== 'remove' && (!change.data || typeof change.data !== 'object' || Array.isArray(change.data))) throw new Error('缺少 data 参数')
      if (change.op === 'update' && change.data!.id !== undefined && change.data!.id !== change.target) throw new Error('更新不能修改构件 id')
      const item = change.op === 'add' ? structuredClone(change.data) : change.op === 'update' ? { ...old, ...structuredClone(change.data) } : old
      let protectedWall: Wall | undefined
      if (change.type === 'wall' && change.op !== 'add') {
        const before = old as Wall, after = item as Wall
        const moved = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b)
        if (change.op === 'remove' || moved(before.a, after.a) || moved(before.b, after.b)
          || (before.bulge ?? 0) !== (after.bulge ?? 0) || (before.level ?? levelsOf(next)[0].id) !== (after.level ?? levelsOf(next)[0].id)
          || after.thickness < before.thickness || effectiveWallHeight(next, after) < effectiveWallHeight(next, before)
          || (after.lowHeight ?? 1) < (before.lowHeight ?? 1) || after.kind !== before.kind) protectedWall = before
      }
      if (change.type === 'opening' && change.op !== 'remove') {
        const o = item as Opening, prev = old as Opening | undefined
        if (!prev || o.wall !== prev.wall || o.offset !== prev.offset || o.width > prev.width || o.sill < prev.sill || o.head > prev.head) protectedWall = next.walls.find(w => w.id === o.wall)
      }
      const beforeColumn = old as Column | undefined, afterColumn = item as Column
      const protectedColumn = change.type === 'column' && change.op !== 'add' && (bearingColumns.has(old!.id) || beforeColumn?.kind === 'bearing') &&
        (change.op === 'remove' || JSON.stringify(beforeColumn!.center) !== JSON.stringify(afterColumn.center)
          || afterColumn.size?.some((v, i) => v < beforeColumn!.size[i]) || afterColumn.kind !== beforeColumn!.kind
          || afterColumn.shape !== beforeColumn!.shape || (afterColumn.rotation ?? 0) !== (beforeColumn!.rotation ?? 0)
          || (afterColumn.level ?? levelsOf(next)[0].id) !== (beforeColumn!.level ?? levelsOf(next)[0].id))
      if ((isProtected(protectedWall) || protectedColumn) && !(change.confirm && typeof change.confirm.by === 'string' && change.confirm.by.trim())) { r.needsConfirm = true; r.error = protectedColumn ? '削减、移动或拆除承重柱需要用户二次确认' : '削减、移动、改类型、拆除或开洞承重墙、外墙、承重情况不确定的墙需要用户二次确认'; results.push(r); continue }
      if (change.op === 'add') {
        const error = checkElement(next, change.type, item); if (error) throw new Error(error)
        if (allIds(next).has((item as any).id)) throw new Error(`id ${(item as any).id} 已存在`)
        list.push(item as unknown as PlanElement); r.affected.push((item as any).id)
      } else if (change.op === 'update') {
        const error = checkElement(next, change.type, item); if (error) throw new Error(error)
        list[list.indexOf(old!)] = item as PlanElement; r.affected.push(old!.id)
        if (change.type === 'wall') {
          const openings = next.openings.filter(o => o.wall === old!.id).sort((a, b) => a.offset - b.offset || a.id.localeCompare(b.id))
          if (Object.hasOwn(change.data!, 'bulge')) {
            const length = wallLength(item as Wall)
            // Retain widths where possible, pack backwards only when a shortened arc requires it.
            if (openings.length === 1 && openings[0].width > length) {
              openings[0].width = length
              ;(r.warnings ??= []).push(`洞口 ${openings[0].id} 宽度超过新墙长，已缩至 ${length.toFixed(1)}mm`)
            }
            if (openings.reduce((sum, o) => sum + o.width, 0) > length + 1e-6) throw new Error('新墙长不足以容纳所有洞口，未修改墙和洞口')
            let end = length
            for (const o of [...openings].reverse()) {
              const offset = Math.max(0, Math.min(o.offset, end - o.width))
              if (Math.abs(offset - o.offset) > 1e-7 || openings.length === 1 && o.width !== plan.openings.find(p => p.id === o.id)?.width) {
                if (offset !== o.offset) (r.warnings ??= []).push(`洞口 ${o.id} 超出新墙长或与夹回洞口相遇，offset 已从 ${o.offset.toFixed(1)} 夹至 ${offset.toFixed(1)}mm`)
                o.offset = offset; r.affected.push(o.id)
              }
              end = offset
            }
          }
          for (const o of openings) { const err = checkElement(next, 'opening', o); if (err) throw new Error(`墙更新导致洞口 ${o.id} 无效：${err}`) }
        }
      } else if (change.type === 'wall') {
        const wall = old as Wall, len = wallLength(wall), range = change.range ?? [0, len], [from, to] = range
        if (range.length !== 2 || !range.every(finite) || from < 0 || to > len + 1e-6 || to <= from) throw new Error('拆除区间必须在墙长范围内，且起点小于终点')
        const intervals: [number, number][] = []; if (from > 1e-6) intervals.push([0, from]); if (to < len - 1e-6) intervals.push([to, len])
        const segments = intervals.map(([a, b], i) => ({ ...sliceWall(wall, a, b), id: i ? `${wall.id}~${change.id}` : wall.id }))
        if (segments[1] && allIds(next).has(segments[1].id)) throw new Error(`分段 id ${segments[1].id} 已存在`)
        next.walls.splice(next.walls.indexOf(wall), 1, ...segments)
        next.openings = next.openings.filter(o => {
          if (o.wall !== wall.id) return true
          const i = intervals.findIndex(([a, b]) => o.offset >= a - 1e-6 && o.offset + o.width <= b + 1e-6)
          if (i < 0) { r.removed.push(o.id); return false }
          o.wall = segments[i].id; o.offset -= intervals[i][0]; r.affected.push(o.id); return true
        })
        r.affected.push(...segments.map(s => s.id)); if (!segments.length) r.removed.push(wall.id)
        if (isProtected(wall)) segments.forEach(s => protectedIds.add(s.id))
      } else { list.splice(list.indexOf(old!), 1); r.removed.push(old!.id) }
      // Remember original protection even if a later update changes the display category.
      for (const w of next.walls) if (PROTECTED_KINDS.includes(w.kind)) protectedIds.add(w.id)
      for (const c of next.columns ?? []) if (c.kind === 'bearing') bearingColumns.add(c.id)
      r.ok = true; plan = next
    } catch (error) { r.error = error instanceof Error ? error.message : String(error); r.affected = []; r.removed = []; delete r.warnings }
    results.push(r)
  }
  // Only retained renovation records identify a replayed view; baking original edits stays unmarked.
  if (changes.length && changes.every(c => base.changes.some(saved => saved.id === c.id)) && results.some(r => r.ok)) {
    const frame = mirrorBounds(base)
    if (frame) { plan.legacy ??= {}; plan.legacy.__structureReplayFrame = frame }
  }
  replayOrigins.set(plan, { base: replayOrigins.get(base)?.base ?? base, protectedWalls: protectedIds, bearingColumns })
  return { plan, results }
}
export type DiffGroup = Record<ElementType, string[]>
export function diffPlans(before: Plan, after: Plan): { added: DiffGroup; removed: DiffGroup; modified: DiffGroup } {
  const blank = (): DiffGroup => ({ wall: [], opening: [], beam: [], room: [], column: [], shaft: [], stair: [], void: [] }), result = { added: blank(), removed: blank(), modified: blank() }
  const stable = (v: any): any => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v
  for (const type of Object.keys(collection) as ElementType[]) {
    const old = new Map(elements(before, type).map(x => [x.id, x])), current = new Map(elements(after, type).map(x => [x.id, x]))
    for (const [id, item] of current) if (!old.has(id)) result.added[type].push(id); else if (JSON.stringify(stable(old.get(id))) !== JSON.stringify(stable(item))) result.modified[type].push(id)
    for (const id of old.keys()) if (!current.has(id)) result.removed[type].push(id)
  }
  return result
}
const kindNames: Record<string, string> = { exterior: '外墙', bearing: '承重墙', partition: '非承重墙', glass: '玻璃隔断', half: '矮墙', 'half-glass': '半墙玻璃', door: '门', sliding: '推拉门', doorway: '门洞', window: '窗', 'floor-window': '落地窗', 'bay-window': '飘窗', 'open-balcony': '未封阳台' }
export function describeChange(base: Plan, change: Change): string {
  const verb = { add: '新增', remove: '拆除', update: '修改' }[change.op], item: any = change.op === 'add' ? change.data : elements(base, change.type)?.find(x => x.id === change.target)
  if (!item) return `${verb} ${change.target ?? '未知构件'}（目标不存在）`
  if (change.type === 'wall') {
    const beside = roomsBesideWall(base, item.id), names = [...new Set([...beside.positive, ...beside.negative].map(r => r.name))], place = item.name ?? (names.length > 1 ? `${names.join('与')}之间的` : names.length ? `${names[0]}旁的` : '')
    const len = change.range ? change.range[1] - change.range[0] : wallLength(item)
    return `${verb} ${place}${kindNames[item.kind] ?? '墙'}（${(len / 1000).toFixed(1)}m）`
  }
  if (change.type === 'opening') return `${change.op === 'add' ? '在 ' + item.wall + ' 开' : verb} ${Math.round(item.width)}mm 宽${kindNames[item.kind] ?? '洞口'}${item.name ? `「${item.name}」` : ''}`
  if (change.type === 'room' || change.type === 'beam') return `${verb} ${item.name ?? item.id}${change.type === 'room' ? '房间' : '横梁'}`
  const typeNames: Record<string, string> = { column: '柱', shaft: '管道井', stair: '楼梯', void: '挑空' }
  const named = `${verb}${typeNames[change.type] ?? '构件'}${item.name ? `「${item.name}」` : ''}`
  if (change.type === 'column' && Array.isArray(item.size)) return `${named}（${item.shape === 'round' ? `直径 ${Math.round(item.size[0])}` : `${Math.round(item.size[0])}×${Math.round(item.size[1])}`}mm）`
  if (change.type === 'stair') { const ls = levelsOf(base), a = ls.find(l => l.id === item.level), b = ls.find(l => l.id === item.to); if (a && b) return `${named}（${a.name} → ${b.name}）` }
  return named
}

/** Validate the final replay once; attach contributing change IDs to each diagnostic. */
export function validateReplay(replay: ReturnType<typeof applyChanges>, changes: Change[], base?: Plan) {
  const issues = validatePlan(replay.plan)
  const introduced = new Map<string, string>()
  const key = (issue: typeof issues[number]) => JSON.stringify([issue.code, issue.ref, issue.message])
  // On failure only, replay prefixes to identify the change that introduced each surviving error.
  // This also attributes indirect failures (e.g. lowering a room ceiling invalidates a wall opening).
  if (base && issues.some(i => i.level === 'error')) {
    let previous = new Set(validatePlan(base).filter(i => i.level === 'error').map(key))
    for (let i = 0; i < changes.length; i++) {
      const current = new Set(validatePlan(applyChanges(base, changes.slice(0, i + 1)).plan).filter(i => i.level === 'error').map(key))
      for (const id of current) if (!previous.has(id)) introduced.set(id, changes[i].id)
      for (const id of previous) if (!current.has(id)) introduced.delete(id)
      previous = current
    }
  }
  return issues.map(issue => {
    const related = replay.results.filter(r => r.ok && (!issue.ref || [...r.affected, ...r.removed].includes(issue.ref.id)))
    const cause = introduced.get(key(issue))
    const changeIds = cause ? [cause] : (related.length ? related : replay.results.filter(r => r.ok)).map(r => r.id)
    return { ...issue, changeIds, message: `${issue.message}${changeIds.length ? `（改造 ${changeIds.join('、')}；${changes.filter(c => changeIds.includes(c.id)).map(c => `${c.type}:${c.target ?? c.data?.id ?? ''}`).join('、')}）` : ''}` }
  })
}
