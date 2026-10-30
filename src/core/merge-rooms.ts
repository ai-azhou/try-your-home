import { polygonArea, projectToWall, roomsBesideWall, sliceWall, wallFootprint } from './geometry.ts'
import { unionPolygons } from './solids.ts'
import type { Plan, Room, Vec2 } from './types.ts'

/**
 * 拆掉一面隔墙以后，两边的房间能不能合成一间：墙两侧各正好一个房间、贴着墙的那段有重合（≥ 300 mm）、
 * 地面高差和计不计面积一样。合并后的轮廓 = 两个房间 + 两者之间那段墙的占地；面积大的那间留名字。
 * 只算，不改方案；界面拿结果写 update room + remove room，和手册教 Agent 的写法一样。
 */
export interface RoomMerge { keep: Room; drop: Room; poly: Vec2[] }
export function mergeAcrossWall(plan: Plan, wallId: string): RoomMerge | null {
  const w = plan.walls.find(x => x.id === wallId)
  if (!w) return null
  const { positive, negative } = roomsBesideWall(plan, wallId)
  if (positive.length !== 1 || negative.length !== 1 || positive[0].id === negative[0].id) return null
  const [a, b] = [positive[0], negative[0]]
  if ((a.floorOffset ?? 0) !== (b.floorOffset ?? 0) || (a.counted ?? true) !== (b.counted ?? true)) return null
  const along = (r: Room) => { const s = r.poly.map(p => projectToWall(w, p)).filter(q => q.dist <= w.thickness / 2 + 60).map(q => q.s); return s.length ? [Math.min(...s), Math.max(...s)] : null }
  const sa = along(a), sb = along(b)
  if (!sa || !sb) return null
  const s0 = Math.max(sa[0], sb[0]), s1 = Math.min(sa[1], sb[1])
  if (s1 - s0 < 300) return null
  const bridge = wallFootprint(sliceWall({ ...w, thickness: w.thickness + 20 }, s0, s1))
  const union = unionPolygons([[a.poly], [b.poly], [bridge]])
  if (union.length !== 1 || union[0].length !== 1) return null
  const poly = tidy(union[0][0])
  if (poly.length < 3) return null
  const [keep, drop] = polygonArea(a.poly) >= polygonArea(b.poly) ? [a, b] : [b, a]
  return { keep, drop, poly }
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
