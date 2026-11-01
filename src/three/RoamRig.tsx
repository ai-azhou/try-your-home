/**
 * 漫游的第一人称相机（Canvas 内）：拖动转头、WASD / 方向键走、滚轮前后、点地面走过去、点画中画平面跳过去。
 * 开着的时候 OrbitControls 停用（CameraRig），R3F 的点选事件也关掉：漫游只看不改，要改先退出。
 * 算路（碰撞、站位）都在 ./roam。
 */
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import type { Plan } from '@/core/types'
import type { Decor } from '@/core/decor/types'
import { levelOf, levelsOf } from '@/core/levels'
import { roomCeiling } from '@/core/geometry'
import { buildSolids, type Solid } from '@/core/solids'
import { buildDecorSolids, decorWallSolids } from '@/core/decor/solids'
import { difference } from '@/core/decor/math'
import { curLevelId } from '@/ui/levels-ui'
import { useStore } from '@/ui/store'
import { ROAM_GOTO, roamPose, roamStart, useRoam } from '@/ui/roam'
import { solidToGeometry } from './geometry'
import { ROAM, buildWorld, forwardOf, groundAt, hFovOf, moveWithSlide, nearestFree, spawnSpot, vFovFor, walkTarget, type SolidLike } from './roam'

const MAX_PITCH = 80 * Math.PI / 180
const NEAR = 0.05, ORBIT_NEAR = 0.1
/** 这次打开里上一次站在哪：退出再进还在原地 */
let last: { x: number; z: number; yaw: number; pitch: number } | null = null

const smooth = (rate: number, dt: number) => 1 - Math.exp(-rate * dt)
const ease = (t: number) => t * t * (3 - 2 * t)

export function RoamRig({ plan, decor }: { plan: Plan; decor?: Decor }) {
  const camera = useThree(s => s.camera) as THREE.PerspectiveCamera, gl = useThree(s => s.gl), scene = useThree(s => s.scene), set = useThree(s => s.set)
  const size = useThree(s => s.size)
  const level = useStore(s => s.level), eye = useRoam(s => s.eye)
  const lv = curLevelId(plan, level)
  const bodyEye = Math.min(eye, ROAM.bodyTop)
  const world = useMemo(() => {
    let solids: SolidLike[]
    try { solids = decor ? [...decorWallSolids({ ...plan, decor }, decor), ...buildDecorSolids({ ...plan, decor })] : buildSolids(plan) }
    catch (e) { console.warn('roam solids', e); solids = buildSolids(plan) }
    return buildWorld(plan, lv, solids, bodyEye)
  }, [plan, decor, lv, bodyEye])

  // 进来站哪：选中的房间 > 上次的位置（还站得下）> 这一层最大的一间
  const pose = useRef<{ x: number; z: number; y: number; yaw: number; pitch: number } | null>(null)
  if (!pose.current) {
    const again = last && !roamStart.room ? nearestFree(world, last.x, last.z, undefined, 0.3) : null
    const s = again && last ? { x: again[0], z: again[1], yaw: last.yaw, pitch: last.pitch } : { ...spawnSpot(plan, lv, world, roamStart.room), pitch: 0 }
    const g = groundAt(plan, lv, s.x, s.z)
    pose.current = { ...s, y: Math.min((g?.floor ?? world.floorZ) + eye, (g?.ceiling ?? Infinity) - 0.08) }
  }
  const ground = useRef({ floor: world.floorZ, ceiling: Infinity })
  const keys = useRef(new Set<string>())
  const wheel = useRef(0)
  const glide = useRef<{ x: number; z: number } | null>(null)
  const drag = useRef<{ id: number; x: number; y: number; sx: number; sy: number; t: number; moved: boolean } | null>(null)
  const ring = useRef<THREE.Mesh>(null)
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  // 从斜视飞进屋里；CameraRig 退出时飞回去
  const intro = useRef<{ t: number; pos: THREE.Vector3; q: THREE.Quaternion; fov: number } | null>(reduced ? null : { t: 0, pos: camera.position.clone(), q: camera.quaternion.clone(), fov: camera.fov })
  const worldRef = useRef(world); worldRef.current = world

  // 相机进入第一人称：让位画面偏移（第一人称的正中就是眼睛看的方向）、近裁面拉近（贴墙不穿帮）、点选事件关掉
  useEffect(() => {
    camera.clearViewOffset(); camera.near = NEAR; camera.updateProjectionMatrix()
    set(st => ({ events: { ...st.events, enabled: false } }))
    const el = gl.domElement, cursor = el.style.cursor, touch = el.style.touchAction
    el.style.cursor = 'grab'; el.style.touchAction = 'none'
    return () => {
      const p = pose.current
      if (p) last = { x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch }
      roamPose.ready = false
      camera.near = ORBIT_NEAR; camera.updateProjectionMatrix()
      set(st => ({ events: { ...st.events, enabled: true } }))
      el.style.cursor = cursor; el.style.touchAction = touch
    }
  }, [camera, gl, set])

  // 拖动转头（抓着画面走，和 3D 平时转模型的手感一致）；没拖动的一下点击 = 走过去
  useEffect(() => {
    const el = gl.domElement
    const down = (e: PointerEvent) => {
      if (drag.current || (e.pointerType === 'mouse' && e.button !== 0)) return
      el.setPointerCapture(e.pointerId)
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), moved: false }
    }
    const move = (e: PointerEvent) => {
      const d = drag.current, p = pose.current
      if (!d || d.id !== e.pointerId || !p) return
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) { d.moved = true; el.style.cursor = 'grabbing'; glide.current = null }
      if (d.moved) {
        // 拖过一屏宽 = 转过一个视角宽度：画面跟着手走，不会时快时慢
        const per = hFovOf(camera.fov, camera.aspect) * Math.PI / 180 / Math.max(1, el.clientWidth)
        p.yaw += (e.clientX - d.x) * per
        p.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, p.pitch + (e.clientY - d.y) * per))
      }
      d.x = e.clientX; d.y = e.clientY
    }
    const up = (e: PointerEvent) => {
      const d = drag.current
      if (!d || d.id !== e.pointerId) return
      drag.current = null
      el.style.cursor = 'grab'
      if (!d.moved && e.type === 'pointerup' && performance.now() - d.t < 500) walkToPixel(e)
    }
    const walkToPixel = (e: PointerEvent) => {
      const r = el.getBoundingClientRect(), p = pose.current
      if (!p) return
      const ray = new THREE.Raycaster()
      ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera)
      const hit = ray.intersectObjects(scene.children, true).find(h => (h.object as THREE.Mesh).isMesh && h.object.visible && !h.object.userData.ui)
      const to = hit && walkTarget(worldRef.current, hit.point.x, hit.point.z, p.x, p.z)
      if (to) glide.current = { x: to[0], z: to[1] }
    }
    const onWheel = (e: WheelEvent) => { e.preventDefault(); wheel.current = Math.max(-3, Math.min(3, wheel.current - e.deltaY * 0.002)); glide.current = null }
    el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', onWheel)
    }
  }, [camera, gl, scene])

  // 键盘：WASD、方向键（←→ 转头，给不打游戏的人）、⇧ 走快点。Esc 和切视角在 App 的快捷键里
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]'))) return
      const k = e.key.toLowerCase()
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) { e.preventDefault(); keys.current.add(k); glide.current = null }
      if (k === 'shift') keys.current.add(k)
    }
    const up = (e: KeyboardEvent) => { keys.current.delete(e.key.toLowerCase()) }
    const clear = () => keys.current.clear()
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', clear)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear) }
  }, [])

  // 点画中画平面：走到那里（找不到能站人的地方就不动）
  useEffect(() => {
    const on = (e: Event) => {
      const [x, z] = (e as CustomEvent<[number, number]>).detail
      const to = nearestFree(worldRef.current, x, z, undefined, 1.2)
      if (to) glide.current = { x: to[0], z: to[1] }
    }
    window.addEventListener(ROAM_GOTO, on)
    return () => window.removeEventListener(ROAM_GOTO, on)
  }, [])

  // 换楼层：平面上同一处有房间就站那，没有就重新找地方
  useEffect(() => {
    const p = pose.current
    if (!p) return
    ground.current = { floor: world.floorZ, ceiling: Infinity }
    if (!nearestFree(world, p.x, p.z, undefined, 0.3)) { const s = spawnSpot(plan, lv, world); p.x = s.x; p.z = s.z; p.yaw = s.yaw; glide.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lv])

  // e2e / 截图：读站位、把人放到指定位置
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>
    w.__roam = {
      pose: () => { const p = pose.current!; return { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, vFov: camera.fov, hFov: hFovOf(camera.fov, camera.aspect), intro: !!intro.current, glide: !!glide.current } },
      place: (x: number, z: number, yaw: number, pitch = 0) => { const p = pose.current!; p.x = x; p.z = z; p.yaw = yaw; p.pitch = pitch; glide.current = null; intro.current = null },
    }
    return () => { delete w.__roam }
  }, [camera])

  const euler = useMemo(() => new THREE.Euler(0, 0, 0, 'YXZ'), []), q = useMemo(() => new THREE.Quaternion(), []), at = useMemo(() => new THREE.Vector3(), [])
  useFrame((_, raw) => {
    const p = pose.current
    if (!p) return
    const dt = Math.min(raw, 0.05), k = keys.current, w = worldRef.current
    // 转头
    const turn = (k.has('arrowleft') ? 1 : 0) - (k.has('arrowright') ? 1 : 0)
    if (turn) p.yaw += turn * ROAM.turn * Math.PI / 180 * dt
    // 走：前后、左右，顺墙滑
    const fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0), strafe = (k.has('d') ? 1 : 0) - (k.has('a') ? 1 : 0)
    const [fx, fz] = forwardOf(p.yaw)
    if (fwd || strafe) {
      const len = Math.hypot(fwd, strafe), step = (k.has('shift') ? ROAM.run : ROAM.walk) * dt / len
      ;[p.x, p.z] = moveWithSlide(w, p.x, p.z, (fx * fwd - fz * strafe) * step, (fz * fwd + fx * strafe) * step)
    }
    // 滚轮：攒下来的距离慢慢走完
    if (Math.abs(wheel.current) > 0.002) {
      const d = wheel.current * smooth(9, dt)
      wheel.current -= d
      ;[p.x, p.z] = moveWithSlide(w, p.x, p.z, fx * d, fz * d)
    } else wheel.current = 0
    // 点了地面：滑过去（不判碰撞：目标已经确认站得下，顺路的矮家具不拦，不会卡在半路）
    const g = glide.current
    if (g) {
      const f = smooth(3.5, dt)
      p.x += (g.x - p.x) * f; p.z += (g.z - p.z) * f
      if (Math.hypot(g.x - p.x, g.z - p.z) < 0.01) glide.current = null
    }
    // 高度跟着脚下的地面走（抬高、下沉的房间），门洞里没有房间就沿用上一步；顶面矮的地方压到顶面以下
    const here = groundAt(plan, lv, p.x, p.z)
    if (here) ground.current = here
    const wantY = Math.min(ground.current.floor + useRoam.getState().eye, ground.current.ceiling - 0.08)
    p.y += (wantY - p.y) * smooth(10, dt)
    // 视角宽度（换算成 three 要的竖直视角）
    const aspect = size.width / Math.max(1, size.height), wantV = vFovFor(useRoam.getState().fov, aspect)
    at.set(p.x, p.y, p.z)
    euler.set(p.pitch, p.yaw, 0)
    q.setFromEuler(euler)
    const I = intro.current
    if (I) {
      I.t = Math.min(1, I.t + dt / 0.8)
      const e = ease(I.t)
      camera.position.lerpVectors(I.pos, at, e)
      camera.quaternion.slerpQuaternions(I.q, q, e)
      camera.fov = I.fov + (wantV - I.fov) * e
      camera.updateProjectionMatrix()
      if (I.t >= 1) intro.current = null
    } else {
      camera.position.copy(at)
      camera.quaternion.copy(q)
      if (Math.abs(camera.fov - wantV) > 0.01) { camera.fov += (wantV - camera.fov) * smooth(12, dt); camera.updateProjectionMatrix() }
    }
    roamPose.x = p.x; roamPose.z = p.z; roamPose.yaw = p.yaw; roamPose.hFov = hFovOf(camera.fov, aspect); roamPose.ready = !I
    // 点地面的落点圈
    const m = ring.current
    if (m) {
      m.visible = !!g
      if (g) m.position.set(g.x, (groundAt(plan, lv, g.x, g.z)?.floor ?? w.floorZ) + 0.012, g.z)
    }
  })

  return (
    <mesh ref={ring} visible={false} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null} userData={{ ui: true }} renderOrder={6}>
      <ringGeometry args={[0.2, 0.26, 48]} />
      <meshBasicMaterial color="#2fb98a" transparent opacity={0.85} depthWrite={false} />
    </mesh>
  )
}

const CEILING = new THREE.MeshStandardMaterial({ color: '#f3f2ee', emissive: '#f3f2ee', emissiveIntensity: 0.42, roughness: 0.92, metalness: 0 })

/**
 * 漫游里头顶要有东西（模型平时没有顶面，抬头会看到背景）：当前层每间房在自己的层高铺一块，挑空处让开。
 * 只在漫游里画；不投影（盖住了屋里就全黑了），也不响应点击。吊顶、顶灯在它下面。
 */
export function RoamCeilings({ plan }: { plan: Plan }) {
  const level = useStore(s => s.level), lv = curLevelId(plan, level)
  const geos = useMemo(() => {
    const levels = levelsOf(plan), cur = levels.find(l => l.id === lv) ?? levels[0]
    const holes = (plan.voids ?? []).filter(v => (levels.find(l => l.id === v.level)?.elevation ?? -Infinity) > cur.elevation).map(v => [v.poly])
    return plan.rooms.filter(r => levelOf(plan, r).id === cur.id && r.poly.length >= 3).flatMap(r => {
      const z = cur.elevation + roomCeiling(plan, r), polygons = difference([[r.poly]], holes)
      return polygons.length ? [{ key: r.id, geo: solidToGeometry({ kind: 'floor', polygons, z0: z, z1: z + 0.03, ids: [r.id] } as Solid) }] : []
    })
  }, [plan, lv])
  useEffect(() => () => geos.forEach(g => g.geo.dispose()), [geos])
  return <group data-roam-ceilings="">{geos.map(g => <mesh key={g.key} geometry={g.geo} material={CEILING} raycast={() => null} />)}</group>
}
