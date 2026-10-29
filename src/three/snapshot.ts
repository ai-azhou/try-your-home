/**
 * 离屏 3D 白模截图（改造清单导出用）：自己建 renderer 和场景，不碰页面上的 3D 画布。
 * 几何和材质复用 pieces.ts / materials.ts（白模 clay3），灯光和 Scene3D 同一套配方（design.md §6）。
 * 场 AO 的 uniform 是全局共享的：截图时换成这份方案的场贴图，截完立刻换回页面当前的方案。
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { Box, Plan, Vec2 } from '@/core/types'
import { planBounds } from '@/core/geometry'
import { unionPolygons } from '@/core/solids'
import { buildPieces, plinthGeometry, type Piece } from './pieces'
import { mats } from './materials'
import { solidToGeometry } from './geometry'
import { applyAOField } from './ao'

export interface SnapshotOptions {
  /** 目标图片尺寸（CSS 像素）；实际按 pixelRatio 渲染 */
  width: number
  height: number
  pixelRatio?: number
  /** 取景框（平面 mm）；缺省整屋 */
  focus?: Box
  /** 取景时顶部要算进去的高度（m），缺省取层高 */
  focusTop?: number
  /** 方位角 / 仰角（度），缺省斜视 24° / 50°，北朝里 */
  azimuth?: number
  elevation?: number
  /** 这些房间的地面染一层淡钴蓝 */
  highlightRooms?: string[]
  /** 取景四周留白（占画面比例） */
  margin?: number
  background?: string
}
export interface Snapshot {
  canvas: HTMLCanvasElement
  width: number
  height: number
  /** 平面点（mm）+ 高度（m）→ 图片上的 CSS 像素坐标 */
  project(p: Vec2, z: number): [number, number] | null
}

const M = (v: number) => v / 1000

export class SnapshotRenderer {
  private renderer: THREE.WebGLRenderer
  private pm: THREE.PMREMGenerator
  private env: THREE.Texture
  constructor() {
    const canvas = document.createElement('canvas')
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true })
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 0.92
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.pm = new THREE.PMREMGenerator(this.renderer)
    this.env = this.pm.fromScene(new RoomEnvironment(), 0.04).texture
  }

  render(plan: Plan, o: SnapshotOptions, restore?: Plan | null): Snapshot {
    const pr = o.pixelRatio ?? 2
    const W = Math.round(o.width), H = Math.round(o.height)
    const r = this.renderer
    r.setPixelRatio(pr)
    r.setSize(W, H, false)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(o.background ?? '#ffffff')
    scene.environment = this.env
    scene.environmentIntensity = 0.36
    const disposables: THREE.BufferGeometry[] = []
    const m = mats()
    const bb = planBounds(plan) ?? [0, 0, 10000, 10000]
    const cx = M(bb[0] + bb[2]) / 2, cz = M(bb[1] + bb[3]) / 2, rad = Math.max(M(bb[2] - bb[0]), M(bb[3] - bb[1])) * 0.62 + 1.6

    // 灯：半球天光 + 带软阴影的主光（南偏西 58°、仰角 66°）+ 一盏弱的冷色回光
    scene.add(new THREE.HemisphereLight('#ffffff', '#c4c7ce', 1.0))
    const az = THREE.MathUtils.degToRad(-58), el = THREE.MathUtils.degToRad(66), D = 24
    const sun = new THREE.DirectionalLight('#fff8ef', 1.05)
    sun.position.set(cx + Math.sin(az) * Math.cos(el) * D, Math.sin(el) * D, cz + Math.cos(az) * Math.cos(el) * D)
    sun.target.position.set(cx, 0, cz)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02; sun.shadow.radius = 4
    ;(sun.shadow as unknown as { intensity: number }).intensity = 0.55
    Object.assign(sun.shadow.camera, { left: -rad, right: rad, top: rad, bottom: -rad, near: 4, far: 48 })
    sun.shadow.camera.updateProjectionMatrix()
    scene.add(sun, sun.target)
    const back = new THREE.DirectionalLight('#e8eeff', 0.22)
    back.position.set(cx + 12, 7, cz + 6)
    scene.add(back)

    // 模型：白模，地面并成一整块
    const pieces: Piece[] = buildPieces(plan, () => 'base')
    const matFor = (p: Piece): THREE.Material | THREE.Material[] => {
      switch (p.kind) {
        case 'wall': case 'sill': case 'lintel': return [m.clay3.top, m.clay3.wall]
        case 'glass': case 'pane': return m.clay3.glass
        case 'platform': return m.clay3.platform
        case 'beam': return m.clay3.beam
        case 'leaf': return m.clay3.leaf
        case 'rail': return m.clay3.frame
        default: return m.clay3.wall
      }
    }
    for (const p of pieces) {
      disposables.push(p.geo)
      if (p.kind === 'floor') continue
      const mesh = new THREE.Mesh(p.geo, matFor(p))
      mesh.castShadow = p.kind !== 'glass' && p.kind !== 'pane' && p.kind !== 'beam'
      mesh.receiveShadow = true
      mesh.renderOrder = p.kind === 'glass' || p.kind === 'pane' ? 2 : 0
      scene.add(mesh)
    }
    try {
      const polys = unionPolygons(plan.rooms.filter(x => x.poly.length >= 3).map(x => [x.poly]))
      if (polys.length) {
        const g = solidToGeometry({ kind: 'floor', polygons: polys, z0: -0.08, z1: 0, ids: [] })
        disposables.push(g)
        const f = new THREE.Mesh(g, m.clay3.floor); f.receiveShadow = true; scene.add(f)
      }
    } catch { /* 房间并集失败：没有地面也能看 */ }
    const tint = new THREE.MeshStandardMaterial({ color: '#d9e3ff', roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })
    for (const id of o.highlightRooms ?? []) {
      const room = plan.rooms.find(x => x.id === id)
      if (!room || room.poly.length < 3) continue
      const z = room.floorOffset ?? 0
      const g = solidToGeometry({ kind: 'floor', polygons: [[room.poly]], z0: z - 0.002, z1: z + 0.003, ids: [] })
      disposables.push(g)
      const f = new THREE.Mesh(g, tint); f.receiveShadow = true; scene.add(f)
    }
    const plinth = plinthGeometry(plan)
    if (plinth) { disposables.push(plinth); const pm = new THREE.Mesh(plinth, m.clay3.plinth); pm.receiveShadow = true; scene.add(pm) }

    // 相机：26° 窄视角，按取景框的 8 个角收紧
    const cam = new THREE.PerspectiveCamera(26, W / H, 0.1, 400)
    const fb = o.focus ?? bb
    const top = o.focusTop ?? plan.ceiling
    const corners: THREE.Vector3[] = []
    for (const x of [fb[0], fb[2]]) for (const y of [fb[1], fb[3]]) for (const z of [0, top]) corners.push(new THREE.Vector3(M(x), z, M(y)))
    const target = new THREE.Vector3(M(fb[0] + fb[2]) / 2, top * 0.35, M(fb[1] + fb[3]) / 2)
    const caz = THREE.MathUtils.degToRad(o.azimuth ?? 24), cel = THREE.MathUtils.degToRad(o.elevation ?? 50)
    const dir = new THREE.Vector3(Math.sin(caz) * Math.cos(cel), Math.sin(cel), Math.cos(caz) * Math.cos(cel))
    const R = 0.5 * Math.hypot(M(fb[2] - fb[0]), M(fb[3] - fb[1]), top)
    const vf = THREE.MathUtils.degToRad(cam.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * cam.aspect)
    let dist = R / Math.sin(Math.min(vf, hf) / 2)
    const margin = o.margin ?? 0.06
    for (let k = 0; k < 4; k++) {
      cam.position.copy(target).addScaledVector(dir, dist)
      cam.lookAt(target)
      cam.updateMatrixWorld(); cam.updateProjectionMatrix()
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const c of corners) { const v = c.clone().project(cam); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y) }
      // 平移目标让框居中，再按占比调距离
      const ndcCx = (x0 + x1) / 2, ndcCy = (y0 + y1) / 2
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1)
      const halfH = Math.tan(vf / 2) * dist, halfW = halfH * cam.aspect
      target.addScaledVector(right, ndcCx * halfW).addScaledVector(up, ndcCy * halfH)
      const fill = Math.max((x1 - x0) / 2, (y1 - y0) / 2) / (1 - 2 * margin)
      dist *= Math.max(0.3, Math.min(3, fill))
    }
    cam.position.copy(target).addScaledVector(dir, dist)
    cam.lookAt(target)
    cam.updateMatrixWorld(); cam.updateProjectionMatrix()

    applyAOField(plan)
    try { r.render(scene, cam) } finally {
      // 换回页面上 3D 画布正在用的场贴图
      if (restore) applyAOField(restore)
    }
    const out = document.createElement('canvas')
    out.width = W * pr; out.height = H * pr
    out.getContext('2d')!.drawImage(r.domElement, 0, 0)
    disposables.forEach(g => g.dispose())
    tint.dispose()
    scene.clear()
    const project = (p: Vec2, z: number): [number, number] | null => {
      const v = new THREE.Vector3(M(p[0]), z, M(p[1])).project(cam)
      if (v.z > 1) return null
      return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H]
    }
    return { canvas: out, width: W, height: H, project }
  }

  dispose() {
    this.env.dispose()
    this.pm.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
  }
}

/** 一次性截一张（内部建、用完即释放 renderer） */
export function renderSnapshot(plan: Plan, o: SnapshotOptions, restore?: Plan | null): Snapshot {
  const r = new SnapshotRenderer()
  try { return r.render(plan, o, restore) } finally { r.dispose() }
}
