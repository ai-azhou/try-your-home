import clipping from 'polygon-clipping'
import { polygonArea, projectToWall, roomsBesideWall, sliceWall, wallFootprint, wallLength } from './geometry.ts'
import { levelOf } from './levels.ts'
import { unionPolygons } from './solids.ts'
import type { Plan, Room, Vec2, Wall } from './types.ts'

const MIN_SPAN = 300
const ring = (poly: Vec2[]): clipping.Polygon => [poly as clipping.Ring]
/**
 * 房间贴着这面墙的那段（沿墙 mm）：墙带和房间多边形求交，再取沿墙范围。
 * 不能靠房间顶点：房间比墙长时，顶点都在墙端以外，投影过去离墙很远。
 */
export function roomSpanOnWall(w: Wall, poly: Vec2[]): [number, number] | null {
  const hit = clipping.intersection(ring(wallFootprint({ ...w, thickness: w.thickness + 120 })), ring(poly)).flat(2) as Vec2[]
  if (!hit.length) return null
  const s = hit.map(p => projectToWall(w, p).s)
  return [Math.min(...s), Math.max(...s)]
}
/** 墙两侧贴着 [from, to] 这段的房间，和各自贴着的范围 */
function beside(plan: Plan, w: Wall, range?: [number, number]) {
  const [from, to] = range ?? [0, wallLength(w)], { positive, negative } = roomsBesideWall(plan, w.id)
  const touching = (rooms: Room[]) => rooms.flatMap(room => {
    const s = roomSpanOnWall(w, room.poly), lo = s ? Math.max(s[0], from) : 0, hi = s ? Math.min(s[1], to) : 0
    return s && hi - lo >= MIN_SPAN ? [{ room, lo, hi }] : []
  })
  return { positive: touching(positive), negative: touching(negative) }
}

/**
 * 拆掉一面隔墙（或其中一段）以后，两边的房间能不能合成一间：这段两侧各正好一个房间、贴着墙的那段有重合（≥ 300 mm）、
 * 地面高差和计不计面积一样。合并后的轮廓 = 两个房间 + 两者之间那段墙的占地；面积大的那间留名字。
 * 只算，不改方案；界面拿结果写 update room + remove room，和手册教 Agent 的写法一样。
 */
export interface RoomMerge { keep: Room; drop: Room; poly: Vec2[] }
export function mergeAcrossWall(plan: Plan, wallId: string, range?: [number, number]): RoomMerge | null {
  const w = plan.walls.find(x => x.id === wallId)
  if (!w) return null
  const { positive, negative } = beside(plan, w, range)
  if (positive.length !== 1 || negative.length !== 1 || positive[0].room.id === negative[0].room.id) return null
  const [a, b] = [positive[0], negative[0]]
  if ((a.room.floorOffset ?? 0) !== (b.room.floorOffset ?? 0) || (a.room.counted ?? true) !== (b.room.counted ?? true)) return null
  const s0 = Math.max(a.lo, b.lo), s1 = Math.min(a.hi, b.hi)
  if (s1 - s0 < MIN_SPAN) return null
  const bridge = wallFootprint(sliceWall({ ...w, thickness: w.thickness + 20 }, s0, s1))
  const union = unionPolygons([[a.room.poly], [b.room.poly], [bridge]])
  if (union.length !== 1 || union[0].length !== 1) return null
  const poly = tidy(union[0][0])
  if (poly.length < 3) return null
  const [keep, drop] = polygonArea(a.room.poly) >= polygonArea(b.room.poly) ? [a.room, b.room] : [b.room, a.room]
  return { keep, drop, poly }
}

/**
 * 墙占地算给其中一侧：两间都留着，这一侧每间收下自己贴着的那段，所以一侧有多间也不留缝。
 * 只算，不改方案；界面写 update room。收进来的地方不压别的房间。
 */
export interface FootprintSide { rooms: { room: Room; poly: Vec2[] }[]; gained: number }
export function wallFootprintSides(plan: Plan, wallId: string, range?: [number, number]): { positive: FootprintSide | null; negative: FootprintSide | null } {
  const w = plan.walls.find(x => x.id === wallId)
  if (!w) return { positive: null, negative: null }
  const sides = beside(plan, w, range), level = levelOf(plan, w).id
  const side = (list: typeof sides.positive): FootprintSide | null => {
    let gained = 0
    const rooms = list.flatMap(({ room, lo, hi }) => {
      const others = plan.rooms.filter(r => r.id !== room.id && levelOf(plan, r).id === level).map(r => ring(r.poly))
      const union = unionPolygons([[room.poly], [wallFootprint(sliceWall({ ...w, thickness: w.thickness + 20 }, lo, hi))]]) as clipping.MultiPolygon
      const rest = clipping.difference(union, ...others)
      if (rest.length !== 1 || rest[0].length !== 1) return []
      const poly = tidy(rest[0][0] as Vec2[])
      if (poly.length < 3) return []
      gained += polygonArea(poly) - polygonArea(room.poly)
      return [{ room, poly }]
    })
    return rooms.length ? { rooms, gained } : null
  }
  return { positive: side(sides.positive), negative: side(sides.negative) }
}

/** 这块地方压住了同层哪些房间（重叠 ≥ 0.3 m²）：房间工具在开敞区域点一下，可能围出一大片 */
export function roomsOverlapping(plan: Plan, poly: Vec2[], levelId: string): Room[] {
  return plan.rooms.filter(r => levelOf(plan, r).id === levelId && clipping.intersection(ring(poly), ring(r.poly)).reduce((sum, part) => sum + polygonArea(part[0] as Vec2[]), 0) >= 3e5)
}
/** 取整到 mm，去掉重复点和共线点（并集在墙面接缝处会留下这些） */
function tidy(ring: Vec2[]): Vec2[] {
  let pts = ring.map(p => [Math.round(p[0]), Math.round(p[1])] as Vec2)
  if (pts.length > 1 && pts[0][0] === pts.at(-1)![0] && pts[0][1] === pts.at(-1)![1]) pts = pts.slice(0, -1)
  for (let changed = true; changed && pts.length > 3;) {
    changed = false
    for (let i = 0; i < pts.length; i++) {
      const p = pts[(i + pts.length - 1) % pts.length], q = pts[i], r = pts[(i + 1) % pts.length]
      const cross = (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0])
      if ((q[0] === p[0] && q[1] === p[1]) || Math.abs(cross) <= Math.hypot(r[0] - p[0], r[1] - p[1]) * 1.5) { pts.splice(i, 1); changed = true; break }
    }
  }
  return pts
}
