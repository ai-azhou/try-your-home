/**
 * 装修态 3D（本人 10-29 定走 A：白模加平涂色）。
 * - 平涂：墙面、地面按 core 的材料（resolveFinish / resolveSurfaces）铺平涂色，比平面样色略浓（tone3d，见 design.md §12.1）；
 *   柜体、造型按材料色；家具保持白盒；不铺照片纹理，地面只有极淡的程序线（木地板缝、砖缝）。
 * - 1.1 m 水平剖切：core sectionAt 的切面画成实心盖子（墙浅墨、装修构件浅杏、家具白），嵌墙的缺口、柜子挖洞看得清楚。
 * - 「对着这面墙看」的通用机位：取墙面法向，仰角取能越过前面的墙和梁的最小角。
 * 这里只做画法；几何、材料查找都来自 core，不在界面重算。
 */
import { wallSkins, type WallSkin } from '@/core/decor/wall-skins'
import * as THREE from 'three'
import type { Plan, Vec2, WallKind } from '@/core/types'
import type { Decor, FaceRef, Material } from '@/core/decor/types'
import { faceAxis, faceExtent } from '@/core/decor/faces'
import { resolveFinish, resolveSurfaces } from '@/core/decor/surfaces'
import type { SectionPolygon } from '@/core/decor/solids'
import { beamFootprint, pointInPolygon, wallDir, wallLength, wallNormal, effectiveWallHeight } from '@/core/geometry'
import { joinedWallFootprint } from '@/core/walls'
import { levelOf } from '@/core/levels'
import { oklch, fromOklch } from '@/ui/canvas2d/style'
import { withFieldAO } from './ao'

/* ───────── 3D 平涂色 ───────── */
/**
 * 3D 样色：明度往纸白拉 30%（下限 0.80、上限 0.965），彩度 ×0.8 且不超过 0.06。
 * 比平面（拉 50%、彩度 ≤ 0.033）浓一档：3D 里有光影把颜色再压暗一点，同样的值在屏幕上读起来和平面差不多「轻」；
 * 上限 0.06 仍不到语义粉彩（0.12+）的一半，薄荷选中、柠檬提醒照样跳出来。
 */
export const TONE3D = { pull: 0.3, Lmin: 0.8, Lmax: 0.965, Cmul: 0.8, Cmax: 0.06 }
const toneCache = new Map<string, string>()
export function tone3d(hex: string, dL = 0) {
  const key = hex + dL
  let v = toneCache.get(key)
  if (!v) { const c = oklch(hex); v = fromOklch({ L: Math.min(TONE3D.Lmax, Math.max(TONE3D.Lmin, c.L + (1 - c.L) * TONE3D.pull)) + dL, C: Math.min(c.C * TONE3D.Cmul, TONE3D.Cmax), h: c.h }); toneCache.set(key, v) }
  return v
}

const matCache = new Map<string, THREE.MeshStandardMaterial>()
/** 平涂材质：和白模同一套粗糙度、场 AO，只换颜色 */
export function flatMat(hex: string, opts: { rough?: number; key?: string } = {}) {
  const key = `${hex}:${opts.key ?? ''}`
  let m = matCache.get(key)
  if (!m) { m = withFieldAO(new THREE.MeshStandardMaterial({ color: hex, roughness: opts.rough ?? 0.92, metalness: 0 })); matCache.set(key, m) }
  return m
}
/** 墙体：顶面 + 侧面都用顶点色（一张合并几何里有好几面墙、两侧材料不同） */
let vcMat: THREE.MeshStandardMaterial | null = null
export function vertexColorMat() { return (vcMat ??= withFieldAO(new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.93, metalness: 0 }))) }

/** 平涂下的墙顶：按墙类型的浅灰（俯视读得出外墙 / 隔墙，但不抢材料） */
export const FLAT_TOP: Record<WallKind, string> = { exterior: '#b9bdc4', bearing: '#aeb3bb', partition: '#d9dce0', half: '#e1e3e6', 'half-glass': '#e1e3e6', glass: '#d6e7f2' }
const WHITE = '#f3f3f2'

/* ───────── 地面：极淡的程序线 ───────── */
const texCache = new Map<string, THREE.Texture>()
function floorTexture(m: Material, base: string): THREE.Texture | null {
  const t = m.texture
  if (!t || (t.kind !== 'planks' && t.kind !== 'tiles' && t.kind !== 'herringbone')) return null
  const key = `${m.id}:${base}`
  const hit = texCache.get(key)
  if (hit) return hit
  const [W, H] = t.kind === 'tiles' ? t.size ?? [600, 600] : t.size ?? [1200, 190]
  const rows = t.kind === 'tiles' ? 1 : 2
  const px = 512, sx = px / W, sy = px / (H * rows)
  const c = document.createElement('canvas'); c.width = px; c.height = px
  const g = c.getContext('2d')!
  g.fillStyle = base; g.fillRect(0, 0, px, px)
  g.strokeStyle = tone3d(m.color, -0.045); g.globalAlpha = 0.55; g.lineWidth = t.kind === 'tiles' ? 3 : 2
  g.beginPath()
  if (t.kind === 'tiles') { g.moveTo(0, 1); g.lineTo(px, 1); g.moveTo(1, 0); g.lineTo(1, px) }
  else {
    // 错缝木地板：两排一循环，第二排接缝错开半块
    g.moveTo(0, 1); g.lineTo(px, 1); g.moveTo(0, H * sy); g.lineTo(px, H * sy)
    g.moveTo(1, 0); g.lineTo(1, H * sy); g.moveTo(W * 0.5 * sx, H * sy); g.lineTo(W * 0.5 * sx, px)
  }
  g.stroke()
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  // 地面顶面 UV = 平面坐标（米）：一格纹理 = W × (H·rows) mm
  tex.repeat.set(1000 / W, 1000 / (H * rows))
  texCache.set(key, tex)
  return tex
}
export function floorMat(m: Material) {
  const base = tone3d(m.color)
  const key = `floor:${m.id}:${base}`
  let mm = matCache.get(key)
  if (!mm) {
    const map = floorTexture(m, base)
    mm = withFieldAO(new THREE.MeshStandardMaterial({ color: map ? '#ffffff' : base, map, roughness: 0.95, metalness: 0 }))
    matCache.set(key, mm)
  }
  return mm
}

/* ───────── 墙面：每个三角形落在哪面墙面上，就上那一面的材料色 ───────── */
interface FaceHit { face: FaceRef; a: Vec2; dir: Vec2; n: Vec2; L: number; t: number; color: THREE.Color; elev: number }
export function wallFaceTable(plan: Plan, decor: Decor, styleId: string, keep: boolean): FaceHit[] {
  const p = { ...plan, decor }
  const out: FaceHit[] = []
  for (const w of plan.walls) {
    if (w.bulge) continue
    const L = wallLength(w), d = wallDir(w), n = wallNormal(w), elev = levelOf(plan, w).elevation
    for (const side of [1, -1] as const) {
      const face = { wall: w.id, side }
      let col = WHITE
      try {
        const f = resolveFinish(p, { face }, { styleId, keep })
        // 墙外（不朝任何房间）的一面：留白模白
        const into: Vec2 = [n[0] * side, n[1] * side], mid: Vec2 = [w.a[0] + d[0] * L / 2 + into[0] * (w.thickness / 2 + 200), w.a[1] + d[1] * L / 2 + into[1] * (w.thickness / 2 + 200)]
        if (plan.rooms.some(r => pointInPolygon(mid, r.poly))) col = tone3d(f.material.color)
      } catch { /* 弧墙等 */ }
      out.push({ face, a: w.a, dir: d, n: [n[0] * side, n[1] * side], L, t: w.thickness, color: new THREE.Color(col), elev })
    }
  }
  return out
}
/** 给墙体几何加顶点色（非索引；顶面用墙类型浅灰，竖直面查墙面表，查不到 = 白模白） */
export function paintWalls(src: THREE.BufferGeometry, faces: FaceHit[], top: string): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src.clone()
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const col = new Float32Array(pos.count * 3)
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3(), e = new THREE.Vector3()
  const cTop = new THREE.Color(top), cWhite = new THREE.Color(WHITE)
  for (let i = 0; i < pos.count / 3; i++) {
    a.fromBufferAttribute(pos, i * 3); b.fromBufferAttribute(pos, i * 3 + 1); c.fromBufferAttribute(pos, i * 3 + 2)
    nn.subVectors(c, b).cross(e.subVectors(a, b)).normalize()
    let color = cWhite
    if (nn.y > 0.9) color = cTop
    else if (Math.abs(nn.y) < 0.3) {
      const cx = (a.x + b.x + c.x) / 3 * 1000, cz = (a.z + b.z + c.z) / 3 * 1000, cy = (a.y + b.y + c.y) / 3
      for (const f of faces) {
        if (nn.x * f.n[0] + nn.z * f.n[1] < 0.9) continue
        const qx = cx - f.a[0], qz = cz - f.a[1]
        const off = qx * f.n[0] + qz * f.n[1], s = qx * f.dir[0] + qz * f.dir[1]
        if (Math.abs(off - f.t / 2) > 12 || s < -f.t || s > f.L + f.t || cy < f.elev - 0.05) continue
        color = f.color; break
      }
    }
    for (let v = 0; v < 3; v++) { col[(i * 3 + v) * 3] = color.r; col[(i * 3 + v) * 3 + 1] = color.g; col[(i * 3 + v) * 3 + 2] = color.b }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.userData = { ...src.userData }
  return g
}

/**
 * 一段 / 到某个高度的墙面覆盖、跨房间时另一段的材料：core resolveSurfaces 按片给（s mm × z m，洞口已扣），
 * 和这一面整面材料不同的片贴一层 1.5 mm 的皮。
 */
/**
 * 墙面皮（D6，接 core C6 wallSkins）：每面墙的每一侧一整张连续的面，门洞扣轮廓、窗洞留孔、按材料分片、片与片零缝，
 * 跨共线墙段合并——平涂下门洞上方、门洞两侧不再有一段一段的接缝。core 已给 Y 朝上、单位米的非索引三角形，直接画；
 * 贴在墙面外 1.5 mm（offset），盖住下面按墙分段的墙体。不贴房间的那一侧（外墙外侧）不铺，留白模白（和 D5 一样）。
 */
export function wallSkinMeshes(plan: Plan, decor: Decor, styleId: string, keep: boolean): { key: string; geo: THREE.BufferGeometry; color: string; room?: string; wall: string; side: number; wallIds: string[] }[] {
  let skins: WallSkin[]
  try { skins = wallSkins({ ...plan, decor }, { styleId, keep, offset: 1.5 }) } catch (e) { console.warn('wallSkins', e); return [] }
  return skins.filter(k => k.room && k.positions.length >= 9).map((k, i) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(k.positions, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(k.normals, 3))
    return { key: `ws:${k.key}:${i}`, geo: g, color: tone3d(k.material.color), room: k.room, wall: k.wall, side: k.side, wallIds: k.wallIds }
  })
}
/** D5 的局部覆盖皮（只铺和整面不同的那几片）；D6 起平涂改用 wallSkinMeshes，这个只留着对照 */
export function surfaceSkins(plan: Plan, decor: Decor, styleId: string, keep: boolean): { key: string; geo: THREE.BufferGeometry; color: string }[] {
  const p = { ...plan, decor }
  const out: { key: string; geo: THREE.BufferGeometry; color: string }[] = []
  let all
  try { all = resolveSurfaces(p, { styleId, keep }).walls } catch { return out }
  for (const s of all) {
    if (!('face' in s.target)) continue
    const face = s.target.face
    let whole: string
    try { whole = resolveFinish(p, { face }, { styleId, keep }).material.id } catch { continue }
    if (s.material.id === whole) continue
    let ax: ReturnType<typeof faceAxis>
    try { ax = faceAxis(p, face) } catch { continue }
    const w = ax.wall, elev = levelOf(plan, w).elevation
    const into: Vec2 = ax.normalAt(ax.length / 2), mid = ax.at(ax.length / 2, 200)
    if (!plan.rooms.some(r => pointInPolygon(mid, r.poly))) continue
    void into
    for (const rings of s.polygons) {
      const shape = new THREE.Shape(rings[0].map(([x, z]) => new THREE.Vector2(x, z)))
      shape.holes = rings.slice(1).map(r => new THREE.Path(r.map(([x, z]) => new THREE.Vector2(x, z))))
      const g = new THREE.ShapeGeometry(shape)
      const P = g.getAttribute('position') as THREE.BufferAttribute
      for (let i = 0; i < P.count; i++) { const q = ax.at(P.getX(i), 1.5); P.setXYZ(i, q[0] / 1000, P.getY(i) + elev, q[1] / 1000) }
      g.computeVertexNormals()
      // ShapeGeometry 的朝向随 s 方向而定：统一让法向朝房间
      const nrm = g.getAttribute('normal') as THREE.BufferAttribute, n0 = ax.normalAt(0)
      if (nrm.count && nrm.getX(0) * n0[0] + nrm.getZ(0) * n0[1] < 0) { const idx = g.index!; for (let i = 0; i < idx.count; i += 3) { const t = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, t) } g.computeVertexNormals() }
      out.push({ key: `${face.wall}:${face.side}:${s.target.s?.join('-')}:${s.target.z?.join('-')}:${out.length}`, geo: g, color: tone3d(s.material.color) })
    }
  }
  return out
}

/* ───────── 1.1 m 剖切盖子 ───────── */
export const SECTION_Z = 1.1
export const CAP = { wall: '#7d838c', glass: '#bcd9ec', decor: '#d9c6a6', furniture: '#ffffff', edge: '#2a2f37' }
export function capGeometry(sec: SectionPolygon[], z: number): { kind: 'wall' | 'glass' | 'decor' | 'furniture'; geo: THREE.BufferGeometry }[] {
  const groups = new Map<string, THREE.Shape[]>()
  for (const s of sec) {
    const k = s.kind === 'glass' ? 'glass' : s.kind === 'decor-furniture' ? 'furniture' : s.kind.startsWith('decor-') && !s.kind.startsWith('decor-wall') && !s.kind.startsWith('decor-sill') && !s.kind.startsWith('decor-lintel') ? (s.kind === 'decor-glass' ? 'glass' : 'decor') : (s.kind === 'wall' || s.kind === 'sill' || s.kind === 'lintel' || s.kind === 'column' || s.kind === 'shaft' || s.kind.startsWith('decor-')) ? 'wall' : null
    if (!k) continue
    for (const rings of s.polygons) {
      const shape = new THREE.Shape(rings[0].map(p => new THREE.Vector2(p[0] / 1000, -p[1] / 1000)))
      shape.holes = rings.slice(1).map(r => new THREE.Path(r.map(p => new THREE.Vector2(p[0] / 1000, -p[1] / 1000))))
      groups.set(k, [...(groups.get(k) ?? []), shape])
    }
  }
  const out: { kind: 'wall' | 'glass' | 'decor' | 'furniture'; geo: THREE.BufferGeometry }[] = []
  for (const [kind, shapes] of groups) {
    const g = new THREE.ExtrudeGeometry(shapes, { depth: 0.006, bevelEnabled: false, curveSegments: 1 })
    g.rotateX(-Math.PI / 2); g.translate(0, z - 0.0065, 0)
    out.push({ kind: kind as 'wall', geo: g })
  }
  return out
}

/* ───────── 「对着这面墙看」 ───────── */
/**
 * 通用机位：水平方向 = 墙面法向（人站在房间里面对墙），仰角取「从墙面中心（离地 1.3 m）往相机看，
 * 越得过前面的墙顶和梁底」的最小角（从 26° 起每 4° 试一次，再多留 4°），最高 64°。
 * 返回 Scene3D 相机约定的 az / el（az：相机在目标的 (sin az, cos az) 方向，平面 x / y）。
 */
export function faceCamera(plan: Plan, face: FaceRef, box: [number, number, number, number], span?: { s: [number, number]; z: [number, number] }): { az: number; el: number } | null {
  let ax: ReturnType<typeof faceAxis>, ext: [number, number]
  try { ax = faceAxis(plan, face); ext = faceExtent(plan, face) } catch { return null }
  const n = ax.normalAt((ext[0] + ext[1]) / 2)
  const az = Math.atan2(n[0], n[1]) * 180 / Math.PI
  // 看的目标：构件在墙面上的那一块（沿墙取 5 个点、高度取中间和上下四分之一）；没给就取取景框中心正对的墙面、离地 1.3 m
  const wd = wallDir(ax.wall)
  let targets: { p: Vec2; z: number }[]
  if (span) {
    const s0 = Math.max(ext[0], Math.min(...span.s)), s1 = Math.min(ext[1], Math.max(...span.s)), zs = [0.25, 0.5, 0.75].map(f => span.z[0] + (span.z[1] - span.z[0]) * f)
    targets = [0.1, 0.3, 0.5, 0.7, 0.9].flatMap(f => zs.map(z => ({ p: ax.at(s0 + (s1 - s0) * f, 60), z })))
  } else {
    // s 沿墙 a → b 增大（和 ax.dir 无关，ax.dir 是站在房间里看的从左到右）
    const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2, o = ax.at((ext[0] + ext[1]) / 2, 0), t0 = (cx - o[0]) * wd[0] + (cy - o[1]) * wd[1]
    targets = [{ p: ax.at(Math.max(ext[0], Math.min(ext[1], (ext[0] + ext[1]) / 2 + t0)), 60), z: 1.3 }]
  }
  const level = levelOf(plan, ax.wall).id
  const walls = plan.walls.filter(w => w.id !== ax.wall.id && levelOf(plan, w).id === level).map(w => ({ fp: joinedWallFootprint(plan, w), top: effectiveWallHeight(plan, w) }))
  const beams = plan.beams.filter(b => levelOf(plan, b).id === level).map(b => ({ fp: beamFootprint(b), bottom: b.bottom }))
  const blockedFrom = (T: Vec2, z0: number, dir: Vec2, tan: number) => {
    for (let d = 250; d < 9000; d += 100) {
      const p: Vec2 = [T[0] + dir[0] * d, T[1] + dir[1] * d], z = z0 + tan * d / 1000
      if (z > 3.4) return false
      if (walls.some(w => z < w.top && w.fp.some(r => pointInPolygon(p, r[0])))) return true
      if (beams.some(b => z > b.bottom - 0.02 && z < 3.0 && pointInPolygon(p, b.fp))) return true
    }
    return false
  }
  const blocked = (dir: Vec2, el: number) => { const tan = Math.tan(el * Math.PI / 180); return targets.filter(t => blockedFrom(t.p, t.z, dir, tan)).length }
  // 正对着看被梁挡住时（梁垂直于这面墙、正好在视线上），水平方向偏一点再试；都挡就取挡得最少的
  let best: { az: number; el: number; n: number } | null = null
  for (const turn of [0, 15, -15, 25, -25, 35, -35, 45, -45]) {
    const r = turn * Math.PI / 180, dir: Vec2 = [n[0] * Math.cos(r) - n[1] * Math.sin(r), n[0] * Math.sin(r) + n[1] * Math.cos(r)]
    for (let el = 26; el <= 60; el += 4) {
      const k = blocked(dir, el)
      if (!k) return { az: Math.atan2(dir[0], dir[1]) * 180 / Math.PI, el: el + 4 }
      if (!best || k < best.n) best = { az: Math.atan2(dir[0], dir[1]) * 180 / Math.PI, el, n: k }
    }
  }
  return best ? { az: best.az, el: best.el } : { az, el: 60 }
}
