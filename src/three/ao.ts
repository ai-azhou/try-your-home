/**
 * 「2.5D」环境光遮蔽：户型是竖直挤出的，大部分 AO 都发生在墙脚和墙与墙的阴角里，
 * 所以在平面上烘一张场贴图，着色器按世界坐标 (x, z) 取样，不用后处理（软件渲染、透明导出都稳定）。
 *
 * 贴图三个通道（平面 25mm / 像素，覆盖方案外扩 1.2m）：
 *   R = 到墙体距离的两段指数衰减（贴墙 6cm 的接触暗线 + 30cm 的软边）→ 地面、飘窗台、底板上离墙越近越暗；
 *   G = 墙体轮廓的「阴角」（从房间看是凹角）处的一团径向渐变 → 竖直墙面在阴角两侧变暗；
 *   B = 墙体占地本身（不模糊）→ 着色器据此跳过墙顶、窗台顶这些「在墙里」的朝上面。
 * 竖直面另有一条按高度衰减的墙脚暗带（着色器里算，见 materials.ts）。
 */
import * as THREE from 'three'
import type { Plan, Vec2 } from '@/core/types'
import { planBounds } from '@/core/geometry'
import { buildSolids, unionPolygons } from '@/core/solids'

const RES = 25 // mm / px
const MARGIN = 1200 // mm

export interface AOField { tex: THREE.DataTexture; xf: THREE.Vector4 }

/** 共享的 uniform：所有打了 AO 补丁的材质都引用这几个对象，换方案时只改 value */
export const aoUniforms = {
  uAoMap: { value: null as THREE.Texture | null },
  uAoXf: { value: new THREE.Vector4(0, 0, 1, 1) },
  /** x = 地面强度，y = 墙脚强度（竖直面贴地处），z = 阴角强度，w = 总开关（0 关） */
  uAoK: { value: new THREE.Vector4(0.8, 0.46, 0.5, 1) },
}

let last: { key: string; field: AOField } | null = null
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__aoUniforms = aoUniforms

export function aoFieldFor(plan: Plan): AOField | null {
  const key = JSON.stringify([plan.walls, plan.openings.map(o => [o.wall, o.offset, o.width, o.sill])])
  if (last?.key === key) return last.field
  const field = build(plan)
  if (!field) return null
  last?.field.tex.dispose()
  last = { key, field }
  return field
}

/** 把当前方案的场贴图挂到共享 uniform 上 */
/** ?ao=0 关掉（对比截图、排查用） */
const aoOff = typeof location !== 'undefined' && new URLSearchParams(location.search).get('ao') === '0'

export function applyAOField(plan: Plan) {
  const f = aoOff ? null : aoFieldFor(plan)
  aoUniforms.uAoMap.value = f?.tex ?? null
  aoUniforms.uAoK.value.w = f ? 1 : 0
  if (f) aoUniforms.uAoXf.value.copy(f.xf)
}

function build(plan: Plan): AOField | null {
  const bb = planBounds(plan)
  if (!bb) return null
  // 落地的墙体（z0 = 0 那一层：门洞处没有墙，窗下有墙）；玻璃不挡光，不算
  const solids = buildSolids({ ...plan, beams: [], rooms: [] }).filter(s => (s.kind === 'wall' || s.kind === 'sill') && s.z0 < 0.01 && s.wallKind !== 'glass')
  if (!solids.length) return null
  const x0 = bb[0] - MARGIN, y0 = bb[1] - MARGIN
  const W = Math.min(2048, Math.ceil((bb[2] - bb[0] + 2 * MARGIN) / RES)), H = Math.min(2048, Math.ceil((bb[3] - bb[1] + 2 * MARGIN) / RES))
  const sx = W / ((bb[2] - bb[0] + 2 * MARGIN)), sy = H / ((bb[3] - bb[1] + 2 * MARGIN))
  const px = (p: Vec2): [number, number] => [(p[0] - x0) * sx, (p[1] - y0) * sy]

  // 墙体占地栅格
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H)
  g.fillStyle = '#fff'
  let mass: Vec2[][][] = []
  try { mass = unionPolygons(solids.flatMap(s => s.polygons)) } catch { mass = solids.flatMap(s => s.polygons) }
  for (const poly of mass) {
    g.beginPath()
    for (const ring of poly) ring.forEach((p, i) => { const [a, b] = px(p); if (i) g.lineTo(a, b); else g.moveTo(a, b) })
    g.fill('evenodd')
  }
  const occ = g.getImageData(0, 0, W, H).data
  const mask = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) mask[i] = occ[i * 4] / 255

  const dist = distanceField(mask, W, H)

  // 阴角：墙体外轮廓上「从墙体看是凹的」顶点（房间的凸角 = 墙体的凹顶点）
  const corners = new Float32Array(W * H)
  const R = 260 / RES
  dbgCorners.length = 0; dbgRings.length = 0
  for (const poly of mass) dbgRings.push(poly.map(r => [r.length, Math.round(ringArea(r) / 1e4)]))
  for (const poly of mass) poly.forEach((ring, ri) => {
    const n = ring.length - (samePt(ring[0], ring[ring.length - 1]) ? 1 : 0)
    if (n < 3) return
    const area = ringArea(ring)
    for (let i = 0; i < n; i++) {
      const a = ring[(i - 1 + n) % n], b = ring[i], d = ring[(i + 1) % n]
      const cr = (b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0])
      // 对墙体来说是凹的：外环（ri = 0）上的凹顶点；洞（被墙围死的房间）上的凸顶点
      const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(d[0] - b[0], d[1] - b[1])
      if (l1 < 30 || l2 < 30) continue
      const sin = cr / (l1 * l2)
      const concave = ri === 0 ? Math.sign(cr) !== Math.sign(area) : Math.sign(cr) === Math.sign(area)
      if (!concave || Math.abs(sin) < 0.4) continue
      dbgCorners.push([Math.round(b[0]), Math.round(b[1]), ri, Math.round(l1), Math.round(l2), +sin.toFixed(2)])
      const [cx, cy] = px(b)
      const r = Math.ceil(R * 2.2)
      for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(H, cy + r); y++) for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(W, cx + r); x++) {
        const v = Math.exp(-Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / R)
        const k = y * W + x
        if (v > corners[k]) corners[k] = v
      }
    }
  })

  const data = new Uint8Array(W * H * 4)
  // 地面：离墙 d 的两段指数衰减（贴墙 6cm 的接触暗线 + 30cm 的软边），阴角再由 G 加深
  const kNear = RES / 70, kFar = RES / 380
  for (let i = 0; i < W * H; i++) {
    const d = dist[i]
    const r = Math.min(1, 0.4 * Math.exp(-d * kNear) + 0.6 * Math.exp(-d * kFar))
    data[i * 4] = r * 255
    data[i * 4 + 1] = corners[i] * 255
    data[i * 4 + 2] = mask[i] * 255
    data[i * 4 + 3] = 255
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat)
  tex.flipY = false
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  // 世界坐标（米）→ uv：world x = 平面 x / 1000，world z = 平面 y / 1000
  const xf = new THREE.Vector4(x0 / 1000, y0 / 1000, sx * 1000 / W, sy * 1000 / H)
  return { tex, xf }
}

export const dbgCorners: number[][] = []
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__aoCorners = () => ({ corners: dbgCorners, rings: dbgRings })
export const dbgRings: number[][][] = []
const samePt = (a: Vec2, b: Vec2) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6
function ringArea(r: Vec2[]) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1] } return a / 2 }

/** 到墙体的距离（像素）：两遍 3-4 倒角距离变换，墙里为 0 */
function distanceField(mask: Float32Array, W: number, H: number): Float32Array {
  const INF = 1e9, d = new Float32Array(W * H)
  for (let i = 0; i < W * H; i++) d[i] = mask[i] > 0.5 ? 0 : INF
  const a = 1, b = Math.SQRT2
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    let v = d[i]
    if (x > 0) v = Math.min(v, d[i - 1] + a)
    if (y > 0) { v = Math.min(v, d[i - W] + a); if (x > 0) v = Math.min(v, d[i - W - 1] + b); if (x < W - 1) v = Math.min(v, d[i - W + 1] + b) }
    d[i] = v
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x
    let v = d[i]
    if (x < W - 1) v = Math.min(v, d[i + 1] + a)
    if (y < H - 1) { v = Math.min(v, d[i + W] + a); if (x < W - 1) v = Math.min(v, d[i + W + 1] + b); if (x > 0) v = Math.min(v, d[i + W - 1] + b) }
    d[i] = v
  }
  return d
}

/** 给材质打 AO 补丁（onBeforeCompile），共享 aoUniforms */
export function withFieldAO<T extends THREE.MeshStandardMaterial>(m: T): T {
  m.defines = { ...(m.defines ?? {}), USE_FIELD_AO: '' }
  m.customProgramCacheKey = () => 'field-ao'
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, aoUniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAoWorld;\nvarying vec3 vAoNormal;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvAoWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvAoNormal = normalize(mat3(modelMatrix) * objectNormal);')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAoWorld;\nvarying vec3 vAoNormal;\nuniform sampler2D uAoMap;\nuniform vec4 uAoXf;\nuniform vec4 uAoK;')
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      if (uAoK.w > 0.5) {
        vec3 nW = normalize(vAoNormal);
        float up = nW.y;
        float vert = 1.0 - smoothstep(0.3, 0.7, abs(up));
        // 竖直面往房间一侧推 5cm 取样，读到的是墙外（房间）的值
        vec2 q = vAoWorld.xz + nW.xz * 0.05 * vert;
        vec4 f = texture2D(uAoMap, (q - uAoXf.xy) * uAoXf.zw);
        float floorW = smoothstep(0.7, 0.92, up) * (1.0 - smoothstep(0.25, 0.6, f.b)) * step(vAoWorld.y, 0.7);
        float foot = exp(-max(vAoWorld.y, 0.0) / 0.36) * (1.0 - smoothstep(0.0, 0.02, -vAoWorld.y - 0.09));
        float occ = floorW * (f.r + 0.6 * f.g) * uAoK.x + vert * (foot * uAoK.y + f.g * uAoK.z * (0.55 + 0.45 * exp(-max(vAoWorld.y, 0.0) / 1.2)));
        float ao = clamp(1.0 - occ, 0.4, 1.0);
        reflectedLight.indirectDiffuse *= ao;
        reflectedLight.indirectSpecular *= ao;
        reflectedLight.directDiffuse *= mix(1.0, ao, 0.85);
      }`)
  }
  return m
}

// 排查用（只读）：把当前场贴图画成 PNG data URL
if (typeof window !== 'undefined') (window as unknown as Record<string, unknown>).__aoDebug = () => {
  const t = last?.field.tex
  if (!t) return null
  const { width: W, height: H, data } = t.image as { width: number; height: number; data: Uint8Array }
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')!, img = g.createImageData(W, H)
  img.data.set(data)
  g.putImageData(img, 0, 0)
  return c.toDataURL('image/png')
}
