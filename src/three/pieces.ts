/**
 * 3D 网格：core buildSolids（按高度分段并集）→ three/geometry 的 mergeByKind / solidToGeometry，门扇窗扇栏杆来自 core buildFixtures。
 * 这里只做两件界面的事：
 *  1. 按「显示状态」分组（正常 / 对比态退灰 / 新增 / 平视剖切），每组单独 buildSolids，各用一套材质；
 *  2. 墙顶上色：把合并几何里朝上的三角形排到材质组 0（顶面），其余组 1（侧面白模）。
 * 点选不靠三角形 id（并集后一片三角形可能属于多面墙），见 Scene3D 的 pickAt。
 */
import * as THREE from 'three'
import type { Plan, Vec2, WallKind } from '@/core/types'
import { buildFixtures, buildSolids, type Solid, type SolidKind } from '@/core/solids'
import { sliceWall, wallFootprint, planBounds } from '@/core/geometry'
import { levelOf } from '@/core/levels'
import { mergeByKind, solidToGeometry } from './geometry'
import { openingStrip, openingSymbol } from '@/core/opening-symbol'

/** 门扇开角：全工程统一一个值（2D 门扇画 90° 开足，3D 开 68° 好看到门洞） */
export const DOOR_ANGLE = 68

export type PieceKind = SolidKind | 'leaf' | 'pane' | 'rail' | 'plinth'
export interface Piece { key: string; kind: PieceKind; wallKind?: WallKind; group: string; ids: string[]; geo: THREE.BufferGeometry }

const M = (v: number) => v / 1000

/** 把朝上的三角形排到前面成组 0（顶面上色），其余成组 1 */
export function groupTopFaces(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined
  const tri = pos.count / 3
  const top: number[] = [], rest: number[] = []
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3()
  for (let i = 0; i < tri; i++) {
    a.fromBufferAttribute(pos, i * 3); b.fromBufferAttribute(pos, i * 3 + 1); c.fromBufferAttribute(pos, i * 3 + 2)
    n.subVectors(c, b).cross(e.subVectors(a, b)).normalize()
    ;(n.y > 0.9 ? top : rest).push(i)
  }
  const order = [...top, ...rest]
  const P = new Float32Array(pos.count * 3), U = uv ? new Float32Array(pos.count * 2) : null
  order.forEach((t, j) => {
    for (let v = 0; v < 3; v++) {
      const s = t * 3 + v, d = j * 3 + v
      P[d * 3] = pos.getX(s); P[d * 3 + 1] = pos.getY(s); P[d * 3 + 2] = pos.getZ(s)
      if (U && uv) { U[d * 2] = uv.getX(s); U[d * 2 + 1] = uv.getY(s) }
    }
  })
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(P, 3))
  if (U) out.setAttribute('uv', new THREE.BufferAttribute(U, 2))
  out.computeVertexNormals()
  out.addGroup(0, top.length * 3, 0)
  out.addGroup(top.length * 3, rest.length * 3, 1)
  out.userData = { ...src.userData }
  if (g !== src) g.dispose()
  if (out !== src) src.dispose()
  return out
}

const TOPPED: PieceKind[] = ['wall', 'sill', 'lintel', 'column', 'shaft']
/** 每层一份、不跟墙分组走的实体：楼板、楼梯、柱、管道井（只在 base 组出一次，避免各显示组重复） */
const LEVEL_KINDS: SolidKind[] = ['slab', 'stair', 'column', 'shaft']

/** 一组墙（及其洞口）的实体；rooms 保留（墙高、梁顶要用），地面只在 withFloors 时出 */
function solidsFor(plan: Plan, wallIds: Set<string> | null, opts: { beams: boolean; floors: boolean }): Solid[] {
  const sub = { ...plan, beams: opts.beams ? plan.beams : [] }
  return buildSolids(sub, w => wallIds === null || wallIds.has(w.id)).filter(s => opts.floors || (s.kind !== 'floor' && s.kind !== 'platform' && !LEVEL_KINDS.includes(s.kind)))
}

/** 合并：同一 SolidKind + 墙类型一张几何（mergeByKind 按 kind 合，这里先按墙类型分开，墙顶才能分色） */
export function mergedPieces(solids: Solid[], group: string): Piece[] {
  const out: Piece[] = []
  const byWk = new Map<string, Solid[]>()
  for (const s of solids) { if (s.kind === 'floor' || s.kind === 'platform') continue; const k = s.wallKind ?? ''; byWk.set(k, [...(byWk.get(k) ?? []), s]) }
  for (const [wk, list] of byWk) {
    const merged = mergeByKind(list)
    for (const [kind, geo] of Object.entries(merged) as [SolidKind, THREE.BufferGeometry][]) {
      const g = TOPPED.includes(kind) ? groupTopFaces(geo) : geo
      out.push({ key: `${group}:${kind}:${wk}`, kind, wallKind: (wk || undefined) as WallKind | undefined, group, ids: [...new Set(list.filter(s => s.kind === kind).flatMap(s => s.ids))], geo: g })
    }
  }
  // 地面、台面一间一张（地面要贴各自的 AO 图）
  for (const s of solids.filter(s => s.kind === 'floor' || s.kind === 'platform')) out.push({ key: `${group}:${s.kind}:${s.ids[0]}`, kind: s.kind, group, ids: s.ids, geo: solidToGeometry(s) })
  return out
}

/** 主模型：groupOf(wallId) 给每面墙分组；'base' 组带梁和地面 */
export function buildPieces(plan: Plan, groupOf: (wallId: string) => string): Piece[] {
  const groups = new Map<string, Set<string>>()
  for (const w of plan.walls) { const g = groupOf(w.id); groups.set(g, (groups.get(g) ?? new Set()).add(w.id)) }
  if (!groups.has('base')) groups.set('base', new Set())
  const out: Piece[] = []
  for (const [g, ids] of groups) out.push(...mergedPieces(solidsFor(plan, ids, { beams: g === 'base', floors: g === 'base' }), g))
  out.push(...fixturePieces(plan))
  return out
}

/**
 * 门扇、窗扇、栏杆（core buildFixtures）。
 * 弧墙上的门窗（D6 B9，C6 起）：core 每扇给一个对象，带 footprint（整扇弧面板材的平面占地）——直接挤出成一整片弧面玻璃 / 门扇，
 * 不再按 center / dir 画直盒；框只在洞口两端（jambs）和扇与扇交界（divisions）画竖框，上下沿弧各一条横框（平开门不画底框），
 * 和 core/mesh buildMesh 同一个口径。直墙门窗照旧。
 */
export function fixturePieces(plan: Plan): Piece[] {
  const out: Piece[] = []
  buildFixtures(plan, { doorAngle: DOOR_ANGLE }).forEach((f, i) => {
    if (f.footprint && f.kind !== 'railing') {
      out.push({ key: `fx${i}`, kind: f.kind === 'door' ? 'leaf' : 'pane', group: 'fixture', ids: [f.id], geo: prism(f.footprint, f.z0 + (f.kind === 'door' ? 0.01 : 0), f.kind === 'door' ? f.z0 + f.height - 0.01 : f.z1) })
      return
    }
    if (f.kind === 'door') out.push({ key: `fx${i}`, kind: 'leaf', group: 'fixture', ids: [f.id], geo: box(f.position, f.dir, f.width - 20, f.thickness, f.z0 + 0.01, f.z0 + f.height - 0.01) })
    else if (f.kind === 'pane') out.push({ key: `fx${i}`, kind: 'pane', group: 'fixture', ids: [f.id], geo: box(f.center, f.dir, Math.max(10, f.width - 30), f.thickness, f.z0, f.z1) })
    else {
      const c: Vec2 = [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2], L = Math.hypot(f.b[0] - f.a[0], f.b[1] - f.a[1])
      const dir: Vec2 = [(f.b[0] - f.a[0]) / (L || 1), (f.b[1] - f.a[1]) / (L || 1)]
      out.push({ key: `fx${i}t`, kind: 'rail', group: 'fixture', ids: [f.id], geo: box(c, dir, L, 50, f.z1 - 0.05, f.z1) })
      out.push({ key: `fx${i}p`, kind: 'pane', group: 'fixture', ids: [f.id], geo: box(c, dir, L - 40, 16, f.z0 + 0.05, f.z1 - 0.05) })
    }
  })
  for (const o of plan.openings) {
    const w = plan.walls.find(x => x.id === o.wall)
    if (!w?.bulge || o.kind === 'doorway' || o.kind === 'open-balcony' || o.head <= o.sill) continue
    try {
      const sym = openingSymbol(plan, o.id, { doorAngle: DOOR_ANGLE }), e = levelOf(plan, w).elevation, z0 = e + o.sill, z1 = e + o.head
      ;[...sym.jambs, ...sym.divisions].forEach(([a, b], j) => {
        const n = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
        out.push({ key: `fxf-${o.id}-${j}`, kind: 'rail', group: 'fixture', ids: [o.id], geo: box([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [-(b[1] - a[1]) / n, (b[0] - a[0]) / n], 30, 40, z0, z1) })
      })
      const strip = openingStrip(w, o.offset, o.offset + o.width, 40)
      out.push({ key: `fxf-${o.id}-top`, kind: 'rail', group: 'fixture', ids: [o.id], geo: prism(strip, z1 - 0.03, z1) })
      if (o.kind !== 'door') out.push({ key: `fxf-${o.id}-bot`, kind: 'rail', group: 'fixture', ids: [o.id], geo: prism(strip, z0, z0 + 0.03) })
    } catch { /* 墙不在了 */ }
  }
  return out
}

function box(center: Vec2, dir: Vec2, w: number, d: number, z0: number, z1: number) {
  const g = new THREE.BoxGeometry(M(w), Math.max(0.001, z1 - z0), M(d))
  g.rotateY(Math.atan2(-dir[1], dir[0]))
  g.translate(M(center[0]), (z0 + z1) / 2, M(center[1]))
  return g
}

/** 单个构件的实体（选中 / 悬停高亮叠一层；对比态拆掉的墙），每段一张几何 */
export function elementGeometries(plan: Plan, ref: { type: string; id: string }): THREE.BufferGeometry[] {
  let solids: Solid[] = []
  if (ref.type === 'wall') solids = solidsFor(plan, new Set([ref.id]), { beams: false, floors: false })
  else if (ref.type === 'beam') solids = buildSolids({ ...plan, walls: [], openings: [], beams: plan.beams.filter(b => b.id === ref.id) }).filter(s => s.kind === 'beam')
  else if (ref.type === 'room') solids = buildSolids({ ...plan, walls: [], openings: [], beams: [], rooms: plan.rooms.filter(r => r.id === ref.id) })
  else if (ref.type === 'column' || ref.type === 'shaft' || ref.type === 'stair') {
    // 新构件：只留这一件的实体（buildSolids 按层出标高）
    const only = <T extends { id: string }>(xs?: T[]) => (xs ?? []).filter(x => x.id === ref.id)
    solids = buildSolids({ ...plan, walls: [], openings: [], beams: [], rooms: [], columns: only(plan.columns), shafts: only(plan.shafts), stairs: only(plan.stairs), voids: [] }).filter(s => s.ids.includes(ref.id))
  } else if (ref.type === 'void') {
    const v = plan.voids?.find(v => v.id === ref.id), lv = v && (plan.levels ?? []).find(l => l.id === v.level)
    return v ? [prism(v.poly, (lv?.elevation ?? 0) - 0.14, (lv?.elevation ?? 0) + 0.02)] : []
  }
  else if (ref.type === 'opening') {
    const o = plan.openings.find(o => o.id === ref.id), w = o && plan.walls.find(w => w.id === o.wall)
    if (!o || !w) return []
    const e = levelOf(plan, w).elevation
    return [prism(wallFootprint(sliceWall({ ...w, thickness: w.thickness + 50 }, o.offset, o.offset + o.width)), e + o.sill, e + o.head)]
  }
  return solids.map(solidToGeometry)
}

/** 一块平面多边形挤出（提议的洞口、被拆的洞口） */
export function prism(poly: Vec2[], z0: number, z1: number) {
  return solidToGeometry({ kind: 'wall', polygons: [[poly]], z0, z1, ids: [] })
}

/** 模型底板：方案外扩 0.7m 的圆角白台 */
export function plinthGeometry(plan: Plan): THREE.BufferGeometry | null {
  const bb = planBounds(plan)
  if (!bb) return null
  const m = 700, [x0, y0, x1, y1] = [bb[0] - m, bb[1] - m, bb[2] + m, bb[3] + m], r = 600
  const pts: Vec2[] = []
  const corner = (cx: number, cy: number, a0: number) => { for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]) } }
  corner(x1 - r, y1 - r, 0); corner(x0 + r, y1 - r, Math.PI / 2); corner(x0 + r, y0 + r, Math.PI); corner(x1 - r, y0 + r, Math.PI * 1.5)
  return prism(pts, -0.16, -0.085)
}
