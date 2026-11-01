/**
 * 3D 漫游的纯逻辑（不碰 three、不碰 React，好测）：视角宽度换算、人能不能站在这、撞墙滑行、进来站哪。
 * 坐标：世界米制，x = 平面 x / 1000，z = 平面 y / 1000。
 * 障碍来自和画面同一份实体（core buildSolids + 装修实体）：门洞在实体里本来就是缺口、窗台和玻璃本来就是实体，
 * 所以不用单独判断门窗，「看着能过」和「走得过去」是一回事。
 */
import type { Plan, Vec2 } from '@/core/types'
import { levelOf, levelsOf } from '@/core/levels'
import { labelPoint, pointInPolygon, polygonArea, roomCeiling } from '@/core/geometry'

export const ROAM = {
  /** 人的半径（m）。比 60 cm 的窄门留得出余量 */
  radius: 0.18,
  /** 从这个高度以上才算挡路：地毯、踢脚不挡 */
  knee: 0.3,
  /** 挡路的上限（m）：眼睛再高也不算过梁（门头至少 1.9 m 左右），不然调高视线就过不了门 */
  bodyTop: 1.9,
  /** 能离开房间多远（m）：过门时人在墙厚里；再远就是走到楼外了（开敞阳台、入户门没有东西挡） */
  roomSlack: 0.5,
  walk: 1.4, run: 2.8,
  /** 方向键转头（度 / 秒） */
  turn: 70,
  /** 水平视角（度）：60 注视，不转头看得清的范围；120 双眼同时看得到的范围（约 114–120°）。再宽平面屏幕放不下，边缘拉伸得没法看 */
  fov: { min: 40, max: 120, def: 90, presets: [60, 90, 120] },
  /** 平视高度（m，脚下地面到眼睛）。默认和生图的房间平视机位（core raster ROOM_CAMERA.eye）一致，漫游里看到的和出的平视图能对上 */
  eye: { min: 0.6, max: 2.0, def: 1.45, presets: [1.15, 1.45, 1.65] },
  /** 竖屏时按水平视角算出来的竖直视角太大、画面拉伸得没法看：封顶（度） */
  maxV: 110,
} as const

const rad = (d: number) => d * Math.PI / 180, deg = (r: number) => r * 180 / Math.PI

/** 水平视角 → 相机要的竖直视角（three 的 fov 是竖直的），竖屏封顶 */
export function vFovFor(hDeg: number, aspect: number, maxV: number = ROAM.maxV): number {
  return Math.min(maxV, deg(2 * Math.atan(Math.tan(rad(hDeg) / 2) / Math.max(0.01, aspect))))
}
/** 竖直视角 → 水平视角：竖屏封顶后实际有多宽 */
export function hFovOf(vDeg: number, aspect: number): number {
  return deg(2 * Math.atan(Math.tan(rad(vDeg) / 2) * aspect))
}

type P = readonly [number, number]
interface Obstacle { polys: P[][][]; box: [number, number, number, number] }
export interface RoamWorld { obstacles: Obstacle[]; rooms: P[][]; floorZ: number }
/** core Solid 和 DecorSolid 共有的部分（平面 mm，高度 m） */
export interface SolidLike { kind: string; polygons: Vec2[][][]; z0: number; z1: number; replaces?: string }

/** 地面类不算障碍：抬高的房间（榻榻米）是走上去，不是撞上 */
const UNDERFOOT = new Set(['floor', 'platform', 'slab'])

/** 这一层人走路时会撞到的实体：只看身体这一段高度（脚边的地毯、头顶的吊顶和梁都不挡） */
export function buildWorld(plan: Plan, levelId: string, solids: SolidLike[], eye: number): RoamWorld {
  const floorZ = levelsOf(plan).find(l => l.id === levelId)?.elevation ?? 0
  const lo = floorZ + ROAM.knee, hi = floorZ + Math.min(eye, ROAM.bodyTop)
  const obstacles = solids.filter(s => !UNDERFOOT.has(s.kind) && !s.replaces && s.z1 > lo && s.z0 < hi).map((s): Obstacle => {
    const polys = s.polygons.map(poly => poly.map(ring => ring.map(([x, y]) => [x / 1000, y / 1000] as const)))
    const pts = polys.flat(2)
    return { polys, box: [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))] }
  })
  const rooms = plan.rooms.filter(r => levelOf(plan, r).id === levelId && r.poly.length >= 3).map(r => r.poly.map(([x, y]) => [x / 1000, y / 1000] as const))
  return { obstacles, rooms, floorZ }
}

function inRing(x: number, z: number, ring: readonly P[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j]
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside
  }
  return inside
}
function nearRing(x: number, z: number, ring: readonly P[], r: number): boolean {
  const r2 = r * r
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j], [bx, bz] = ring[i], dx = bx - ax, dz = bz - az
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)))
    const ex = ax + dx * t - x, ez = az + dz * t - z
    if (ex * ex + ez * ez < r2) return true
  }
  return false
}
function hits(o: Obstacle, x: number, z: number, r: number): boolean {
  if (x < o.box[0] - r || x > o.box[2] + r || z < o.box[1] - r || z > o.box[3] + r) return false
  for (const [outer, ...holes] of o.polys) {
    if (inRing(x, z, outer) && !holes.some(h => inRing(x, z, h))) return true
    if (nearRing(x, z, outer, r) || holes.some(h => nearRing(x, z, h, r))) return true
  }
  return false
}
const inAnyRoom = (w: RoamWorld, x: number, z: number) => w.rooms.some(r => inRing(x, z, r))

/** 这里站得下人吗：不撞东西，而且还在屋里（或正过门） */
export function isFree(w: RoamWorld, x: number, z: number): boolean {
  if (w.obstacles.some(o => hits(o, x, z, ROAM.radius))) return false
  return !w.rooms.length || inAnyRoom(w, x, z) || w.rooms.some(r => nearRing(x, z, r, ROAM.roomSlack))
}

/** 走一小步：正面撞上就顺着墙滑（试几个偏转角，斜墙也滑得动）；本来就卡在东西里（方案刚被改）时不拦，先让人走出来 */
export function moveWithSlide(w: RoamWorld, x: number, z: number, dx: number, dz: number): [number, number] {
  if (!isFree(w, x, z)) return [x + dx, z + dz]
  for (const a of [0, 25, -25, 50, -50, 75, -75]) {
    const c = Math.cos(rad(a)), s = Math.sin(rad(a)), mx = (dx * c - dz * s) * c, mz = (dx * s + dz * c) * c
    if (isFree(w, x + mx, z + mz)) return [x + mx, z + mz]
  }
  return [x, z]
}

/** 朝某个方向走多远会撞上 */
export function clearance(w: RoamWorld, x: number, z: number, fx: number, fz: number, max = 12, step = 0.1): number {
  for (let d = step; d <= max; d += step) if (!isFree(w, x + fx * d, z + fz * d)) return d - step
  return max
}

/** 从 (x,z) 往外一圈圈找最近的能站人的地方；within 给了就只认那个房间里的点 */
export function nearestFree(w: RoamWorld, x: number, z: number, within?: readonly P[], maxR = 3): [number, number] | null {
  const ok = (a: number, b: number) => isFree(w, a, b) && (within ? inRing(a, b, within) : !w.rooms.length || inAnyRoom(w, a, b))
  if (ok(x, z)) return [x, z]
  for (let r = 0.15; r <= maxR; r += 0.15) for (let i = 0; i < 24; i++) {
    const a = x + Math.cos(i * Math.PI / 12) * r, b = z + Math.sin(i * Math.PI / 12) * r
    if (ok(a, b)) return [a, b]
  }
  return null
}

/**
 * 点到 (hx,hz)（地面、家具、墙都算）要走到哪：从点到的地方往人这边退，退到第一个站得下、又在屋里的位置。
 * 点墙 = 走到墙跟前，点沙发 = 走到沙发边上，隔着窗点到楼外 = 走到窗边。离脚下太近（原地）算没动。
 */
export function walkTarget(w: RoamWorld, hx: number, hz: number, x: number, z: number): [number, number] | null {
  const d = Math.hypot(hx - x, hz - z)
  if (d < 0.2) return null
  const ux = (x - hx) / d, uz = (z - hz) / d
  for (let t = 0; t < d - 0.15; t += 0.08) {
    const a = hx + ux * t, b = hz + uz * t
    if (isFree(w, a, b) && (!w.rooms.length || inAnyRoom(w, a, b))) return [a, b]
  }
  return null
}

/** yaw = 0 朝 −z（平面的上方），逆时针（从上往下看）为正，和 three 绕 Y 轴一致 */
export const yawOf = (fx: number, fz: number) => Math.atan2(-fx, -fz)
export const forwardOf = (yaw: number): [number, number] => [-Math.sin(yaw), -Math.cos(yaw)]

export interface RoamSpot { x: number; z: number; yaw: number }

/**
 * 进这间房站哪：在房间里取一圈候选点，每个点朝 24 个方向看视线有多远，选「眼前 ±45° 最开阔」的点和朝向。
 * 视线取对数再加权（正前方权重高）：近处一堵墙扣分很重，远处多几米加分有限——不然两侧的长视线会把正前方贴脸的墙抵消掉。
 * 结果通常是背靠一边、看向整间房，和拍房间照片差不多。
 */
export function spotInRoom(w: RoamWorld, poly: Vec2[]): RoamSpot | null {
  const ring = poly.map(([x, y]) => [x / 1000, y / 1000] as const), c = labelPoint(poly), cx = c[0] / 1000, cz = c[1] / 1000
  const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs)
  const cands: [number, number][] = [[cx, cz]]
  for (let i = 1; i <= 5; i++) for (let j = 1; j <= 5; j++) cands.push([x0 + (x1 - x0) * i / 6, z0 + (z1 - z0) * j / 6])
  const N = 24, dirs = Array.from({ length: N }, (_, i) => [Math.cos(i * Math.PI * 2 / N), Math.sin(i * Math.PI * 2 / N)] as const)
  let best: RoamSpot | null = null, bestScore = -1
  for (const [x, z] of cands) {
    if (!inRing(x, z, ring) || !isFree(w, x, z)) continue
    const reach = dirs.map(d => clearance(w, x, z, d[0], d[1], 8, 0.2))
    // 四周太挤（夹在家具缝里）打个折
    const room = Math.min(...reach) < 0.3 ? 0.7 : 1
    for (let i = 0; i < N; i++) {
      let sum = 0
      for (let k = -3; k <= 3; k++) sum += (4 - Math.abs(k)) * Math.log(0.5 + reach[(i + k + N) % N])
      const score = Math.max(0, sum) * room
      if (score > bestScore + 1e-6) { bestScore = score; best = { x, z, yaw: yawOf(dirs[i][0], dirs[i][1]) } }
    }
  }
  if (best) return best
  const at = nearestFree(w, cx, cz, ring) // 候选点都站不下（小房间、挤满家具）：离中心最近的空地
  return at && { x: at[0], z: at[1], yaw: 0 }
}

/** 第一次进漫游站哪：指定的房间（选中的那间）；否则这一层能站人的最大一间（客厅多半是它） */
export function spawnSpot(plan: Plan, levelId: string, w: RoamWorld, roomId?: string): RoamSpot {
  const rooms = plan.rooms.filter(r => levelOf(plan, r).id === levelId && r.poly.length >= 3)
  const big = [...rooms].filter(r => r.counted !== false && (r.floorOffset ?? 0) <= 0.3).sort((a, b) => polygonArea(b.poly) - polygonArea(a.poly))
  const order = [rooms.find(r => r.id === roomId), ...big, ...rooms].filter(Boolean) as typeof rooms
  for (const r of order) { const s = spotInRoom(w, r.poly); if (s) return s }
  // 没有房间（只画了墙）：站到障碍外接框中间附近
  const xs = w.obstacles.flatMap(o => [o.box[0], o.box[2]]), zs = w.obstacles.flatMap(o => [o.box[1], o.box[3]])
  const cx = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0, cz = zs.length ? (Math.min(...zs) + Math.max(...zs)) / 2 : 0
  const at = nearestFree(w, cx, cz, undefined, 8) ?? [cx, cz]
  return { x: at[0], z: at[1], yaw: 0 }
}

/** 脚下地面和头顶顶面的标高（m）。不在任何房间里（门洞、墙厚）时 null：沿用上一步的值 */
export function groundAt(plan: Plan, levelId: string, x: number, z: number): { floor: number; ceiling: number } | null {
  const p: Vec2 = [x * 1000, z * 1000], el = levelsOf(plan).find(l => l.id === levelId)?.elevation ?? 0
  const r = plan.rooms.find(r => levelOf(plan, r).id === levelId && r.poly.length >= 3 && pointInPolygon(p, r.poly))
  return r ? { floor: el + (r.floorOffset ?? 0), ceiling: el + roomCeiling(plan, r) } : null
}
