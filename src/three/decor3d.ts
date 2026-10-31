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
import { unionPolygons, type Solid } from '@/core/solids'
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
interface FaceHit { face: FaceRef; a: Vec2; dir: Vec2; n: Vec2; L: number; t: number; color: THREE.Color; elev: number; painted: boolean; top: number }
export function wallFaceTable(plan: Plan, decor: Decor, styleId: string, keep: boolean): FaceHit[] {
  const p = { ...plan, decor }
  const out: FaceHit[] = []
  for (const w of plan.walls) {
    if (w.bulge) continue
    const L = wallLength(w), d = wallDir(w), n = wallNormal(w), elev = levelOf(plan, w).elevation
    for (const side of [1, -1] as const) {
      const face = { wall: w.id, side }
      let col = WHITE, painted = false
      try {
        const f = resolveFinish(p, { face }, { styleId, keep })
        // 墙外（不朝任何房间）的一面：留白模白
        const into: Vec2 = [n[0] * side, n[1] * side], mid: Vec2 = [w.a[0] + d[0] * L / 2 + into[0] * (w.thickness / 2 + 200), w.a[1] + d[1] * L / 2 + into[1] * (w.thickness / 2 + 200)]
        if (plan.rooms.some(r => pointInPolygon(mid, r.poly))) { col = tone3d(f.material.color); painted = true }
      } catch { /* 弧墙等 */ }
      out.push({ face, a: w.a, dir: d, n: [n[0] * side, n[1] * side], L, t: w.thickness, color: new THREE.Color(col), elev, painted, top: elev + effectiveWallHeight(plan, w) })
    }
  }
  return out
}
/* ───────── 墙体：去掉墙段之间的内部面 ───────── */
const inSolid = (s: Solid, p: Vec2) => s.polygons.some(rings => pointInPolygon(p, rings[0]) && !rings.slice(1).some(r => pointInPolygon(p, r)))
/** 实心墙段按平面包围盒预筛：一张几何要查上万个点，绝大多数点离大多数墙段很远，不用走点在多边形内 */
function massIndex(mass: Solid[]) {
  const boxes = mass.map(s => {
    const pts = s.polygons.flatMap(rs => rs[0])
    return { s, x0: Math.min(...pts.map(p => p[0])), x1: Math.max(...pts.map(p => p[0])), y0: Math.min(...pts.map(p => p[1])), y1: Math.max(...pts.map(p => p[1])) }
  })
  /** 平面上 lo..hi 这个范围（mm）碰得到的墙段 */
  return (x0: number, y0: number, x1: number, y1: number) => boxes.filter(b => b.x0 <= x1 && b.x1 >= x0 && b.y0 <= y1 && b.y1 >= y0).map(b => b.s)
}
/** 三角形（y 朝上）夹到 lo..hi 这段高度：Sutherland–Hodgman，结果是凸多边形 */
function clipY(tri: THREE.Vector3[], lo: number, hi: number): THREE.Vector3[] {
  const cut = (poly: THREE.Vector3[], inside: (y: number) => boolean, y0: number) => poly.flatMap((p, i) => {
    const q = poly[(i + 1) % poly.length], out = inside(p.y) ? [p] : []
    if (inside(p.y) !== inside(q.y)) out.push(p.clone().lerp(q, (y0 - p.y) / (q.y - p.y)))
    return out
  })
  return cut(cut(tri, y => y >= lo, lo), y => y <= hi, hi)
}
/**
 * 墙体几何去掉埋在别的墙段里的面。core 在洞口边界把墙切成一段段（wall / sill / lintel），每段都是封闭的盒子，相邻两段之间各留一个端面。
 * 端面的边顶在墙面上，又几乎侧对相机：屏幕上深度变化极陡，深度插值的误差超过皮的 1.5 mm，个别 MSAA 采样点赢过皮，
 * 端面的颜色和光照混进来，就是门洞、窗户两侧、洞口延长线上那道断断续续的接缝。这些面本来就不该有，加大偏移只是遮，这里直接不生成。
 * 真正露出来的部分（门窗侧壁）留着：一个端面可能下半截贴窗台、中间露在窗洞里、上半截贴过梁，所以按高度裁，不是整片删。
 * mass：当前画出来的实心墙段（玻璃不算，透过玻璃看得见端面；平视剖掉的墙不算，它不在了端面就露出来了）。
 */
export function wallBodyGeometry(src: THREE.BufferGeometry, mass: Solid[]): THREE.BufferGeometry {
  const g = src.index ? src.toNonIndexed() : src
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const positions: number[] = [], normals: number[] = []
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e = new THREE.Vector3()
  const near = massIndex(mass)
  const emit = (poly: THREE.Vector3[]) => { for (let i = 1; i + 1 < poly.length; i++) for (const v of [poly[0], poly[i], poly[i + 1]]) { positions.push(v.x, v.y, v.z); normals.push(n.x, n.y, n.z) } }
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2)
    n.subVectors(c, b).cross(e.subVectors(a, b)).normalize()
    const tri = [a.clone(), b.clone(), c.clone()]
    if (Math.abs(n.y) > 0.9) {
      // 顶面、底面：往外 1 mm 还在别的墙段里 = 被压住了（上下叠的两段之间）
      const y = (a.y + b.y + c.y) / 3 + n.y * 0.001, p: Vec2 = [(a.x + b.x + c.x) / 3 * 1000, (a.z + b.z + c.z) / 3 * 1000]
      if (!near(p[0], p[1], p[0], p[1]).some(s => y > s.z0 && y < s.z1 && inSolid(s, p))) emit(tri)
      continue
    }
    if (Math.abs(n.y) > 0.3) { emit(tri); continue }
    // 竖直面：取水平方向上最远的两个顶点当这条边，沿边取三点往外推 1 mm，三点都落在别的墙段里的那段高度才算埋住
    const [p, q] = [[a, b], [b, c], [c, a]].map(([u, v]) => [u, v, u.distanceToSquared(v) - (u.y - v.y) ** 2] as const).sort((x, y) => y[2] - x[2])[0]
    const samples = [0.1, 0.5, 0.9].map((t): Vec2 => [(p.x + (q.x - p.x) * t + n.x * 0.001) * 1000, (p.z + (q.z - p.z) * t + n.z * 0.001) * 1000])
    const y0 = Math.min(a.y, b.y, c.y), y1 = Math.max(a.y, b.y, c.y)
    const xs = samples.map(pt => pt[0]), zs = samples.map(pt => pt[1]), around = near(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs))
    if (!around.length) { emit(tri); continue }
    const ys = [...new Set([y0, y1, ...around.flatMap(s => [s.z0, s.z1]).filter(y => y > y0 + 1e-6 && y < y1 - 1e-6)])].sort((u, v) => u - v)
    let lo: number | null = null
    for (let k = 1; k <= ys.length; k++) {
      const mid = k < ys.length ? (ys[k - 1] + ys[k]) / 2 : 0
      const open = k < ys.length && !samples.every(pt => around.some(s => mid > s.z0 && mid < s.z1 && inSolid(s, pt)))
      if (open && lo === null) lo = ys[k - 1]
      if (!open && lo !== null) { const poly = clipY(tri, lo, ys[k - 1]); if (poly.length >= 3) emit(poly); lo = null }
    }
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  const { triangleRanges: _dropped, ...userData } = src.userData as Record<string, unknown>
  out.userData = userData
  if (g !== src) g.dispose()
  return out
}

/**
 * 平涂下墙体的棱线：只留真正凸出来的棱（墙顶外沿、门窗洞的边）。
 * 每段墙各有一圈棱线，段与段的交界在连续的墙面、墙顶上就是一道多余的线；墙面上那部分还在皮后面 1.5 mm，线的取样和皮的取样差半个像素，
 * 离得一远深度差就超过 1.5 mm，线断断续续透出来。分段是实体的切法，不是墙上真有的线。
 * 判断不看线属于哪段，看线周围实际有什么：绕线一圈取点，落在实体里的不到一半才是凸棱。约一半 = 平面上的交界；超过一半 = 阴角，线全埋在皮后面，也不画。
 */
export function wallCreases(geos: THREE.BufferGeometry[], mass: Solid[]): THREE.BufferGeometry {
  const segs = geos.flatMap(geo => {
    const e = new THREE.EdgesGeometry(geo, 28), p = e.getAttribute('position') as THREE.BufferAttribute, out: [THREE.Vector3, THREE.Vector3][] = []
    for (let i = 0; i < p.count; i += 2) out.push([new THREE.Vector3().fromBufferAttribute(p, i), new THREE.Vector3().fromBufferAttribute(p, i + 1)])
    e.dispose()
    return out
  })
  // 长线可能只有一部分贴着别的墙段（比如外墙顶上丁字接进来的隔墙）：先在所有端点处打断，再逐小段判断
  const ends = segs.flat()
  const positions: number[] = [], seen = new Set<string>(), N = 24, near = massIndex(mass)
  const q = new THREE.Vector3()
  const keyOf = (v: THREE.Vector3) => [v.x, v.y, v.z].map(c => Math.round(c * 1e4)).join(',')
  for (const [a, b] of segs) {
    const d = b.clone().sub(a), L = d.length()
    if (L < 1e-6) continue
    d.divideScalar(L)
    const ts = [0, L]
    for (const e of ends) {
      const dx = e.x - a.x, dy = e.y - a.y, dz = e.z - a.z, t = dx * d.x + dy * d.y + dz * d.z
      if (t <= 1e-5 || t >= L - 1e-5) continue
      const ox = dx - d.x * t, oy = dy - d.y * t, oz = dz - d.z * t
      if (ox * ox + oy * oy + oz * oz < 1e-10) ts.push(t)
    }
    ts.sort((x, y) => x - y)
    const u = new THREE.Vector3(d.y, d.z, d.x).cross(d).normalize(), v = d.clone().cross(u)
    for (let i = 1; i < ts.length; i++) {
      if (ts[i] - ts[i - 1] < 1e-5) continue
      const p0 = a.clone().addScaledVector(d, ts[i - 1]), p1 = a.clone().addScaledVector(d, ts[i]), k = [keyOf(p0), keyOf(p1)].sort().join('|')
      if (seen.has(k)) continue
      seen.add(k)
      const m = p0.clone().add(p1).multiplyScalar(0.5)
      let filled = 0
      const around = near(m.x * 1000 - 3, m.z * 1000 - 3, m.x * 1000 + 3, m.z * 1000 + 3)
      // 半径 2 mm 一圈，起始角避开轴向（取样点不要正好落在相邻的面上）
      for (let j = 0; j < N; j++) {
        const t = 0.37 + j / N * Math.PI * 2
        q.copy(m).addScaledVector(u, Math.cos(t) * 0.002).addScaledVector(v, Math.sin(t) * 0.002)
        if (around.some(s => q.y > s.z0 && q.y < s.z1 && inSolid(s, [q.x * 1000, q.z * 1000]))) filled++
      }
      if (filled > 0 && filled < N / 2 - 1) positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z)
    }
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  return out
}

/** 给墙体几何加顶点色（非索引；顶面用墙类型浅灰，竖直面查墙面表，查不到 = 白模白） */
/** 洞口这一圈属于哪面墙：返回这面墙的两侧。墙真正的顶不算（高度到墙顶），底贴地也不算 */
function revealFaces(faces: FaceHit[], cx: number, cz: number, cy: number, nn: THREE.Vector3): FaceHit[] {
  const flat = Math.abs(nn.y) > 0.9
  for (const f of faces) {
    if (!flat && Math.abs(nn.x * f.dir[0] + nn.z * f.dir[1]) < 0.9) continue
    const qx = cx - f.a[0], qz = cz - f.a[1], off = qx * f.n[0] + qz * f.n[1], s = qx * f.dir[0] + qz * f.dir[1]
    if (Math.abs(off) > f.t / 2 + 1 || s < -1 || s > f.L + 1) continue
    if (flat && (cy >= f.top - 0.02 || cy <= f.elev + 0.001)) continue
    return faces.filter(o => o.face.wall === f.face.wall)
  }
  return []
}
/** 只有一侧朝房间：整圈跟那一侧（窗外那面不刷）。两侧都刷：顶点归自己那一侧，颜色不同时中间过渡 */
function revealColor(pair: FaceHit[], x: number, z: number): THREE.Color | undefined {
  const painted = pair.filter(f => f.painted)
  if (painted.length < 2) return painted[0]?.color
  const own = painted.find(f => (x - f.a[0]) * f.n[0] + (z - f.a[1]) * f.n[1] > 0)
  return (own ?? painted[0]).color
}
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
    const cx = (a.x + b.x + c.x) / 3 * 1000, cz = (a.z + b.z + c.z) / 3 * 1000, cy = (a.y + b.y + c.y) / 3
    if (nn.y > 0.9) color = cTop
    if (Math.abs(nn.y) < 0.3) {
      for (const f of faces) {
        if (nn.x * f.n[0] + nn.z * f.n[1] < 0.9) continue
        const qx = cx - f.a[0], qz = cz - f.a[1]
        const off = qx * f.n[0] + qz * f.n[1], s = qx * f.dir[0] + qz * f.dir[1]
        if (Math.abs(off - f.t / 2) > 12 || s < -f.t || s > f.L + f.t || cy < f.elev - 0.05) continue
        color = f.color; break
      }
    }
    // 墙的大面和墙顶之外，还剩门窗洞口的一圈：侧壁、窗台上沿、过梁底
    const reveal = color === cWhite || nn.y > 0.9 ? revealFaces(faces, cx, cz, cy, nn) : []
    for (let v = 0; v < 3; v++) {
      const p = [a, b, c][v]
      const vc = reveal.length ? revealColor(reveal, p.x * 1000, p.z * 1000) ?? color : color
      col[(i * 3 + v) * 3] = vc.r; col[(i * 3 + v) * 3 + 1] = vc.g; col[(i * 3 + v) * 3 + 2] = vc.b
    }
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
 * 贴在墙面外 1.5 mm（offset），盖住下面按墙分段的墙体（内部端面见 wallBodyGeometry）。不贴房间的那一侧（外墙外侧）不铺，留白模白（和 D5 一样）；
 * 夹在房间之间的那一小段（enclosed：拆了隔墙留下的缝）是室内，要铺，不然连续的墙面上露一条没刷的竖条。
 */
export function wallSkinMeshes(plan: Plan, decor: Decor, styleId: string, keep: boolean): { key: string; geo: THREE.BufferGeometry; color: string; room?: string; wall: string; side: number; wallIds: string[] }[] {
  let skins: WallSkin[]
  try { skins = wallSkins({ ...plan, decor }, { styleId, keep, offset: 1.5 }) } catch (e) { console.warn('wallSkins', e); return [] }
  return skins.filter(k => (k.room || k.enclosed) && k.positions.length >= 9).map((k, i) => {
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
  const groups = new Map<string, Vec2[][][]>()
  for (const s of sec) {
    const k = s.kind === 'glass' ? 'glass' : s.kind === 'decor-furniture' ? 'furniture' : s.kind.startsWith('decor-') && !s.kind.startsWith('decor-wall') && !s.kind.startsWith('decor-sill') && !s.kind.startsWith('decor-lintel') ? (s.kind === 'decor-glass' ? 'glass' : 'decor') : (s.kind === 'wall' || s.kind === 'sill' || s.kind === 'lintel' || s.kind === 'column' || s.kind === 'shaft' || s.kind.startsWith('decor-')) ? 'wall' : null
    if (!k) continue
    groups.set(k, [...(groups.get(k) ?? []), ...s.polygons])
  }
  const out: { kind: 'wall' | 'glass' | 'decor' | 'furniture'; geo: THREE.BufferGeometry }[] = []
  for (const [kind, polygons] of groups) {
    // 墙的切面并成一整块：不然段与段的交界在盖子上是一道道线（窗台高过切面的窗户两侧、墙和墙的接头）。柜子、家具各是各的，不并
    let merged = polygons
    if (kind === 'wall') try { merged = unionPolygons(polygons) } catch { /* 并不了就按原样画 */ }
    const shapes = merged.map(rings => {
      const shape = new THREE.Shape(rings[0].map(p => new THREE.Vector2(p[0] / 1000, -p[1] / 1000)))
      shape.holes = rings.slice(1).map(r => new THREE.Path(r.map(p => new THREE.Vector2(p[0] / 1000, -p[1] / 1000))))
      return shape
    })
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
