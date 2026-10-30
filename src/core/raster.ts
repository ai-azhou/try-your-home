import { assertLevel, levelOf, levelsOf, onLevel } from './levels.ts'
import { labelPoint, pointInPolygon, polygonArea, projectToWall, openingSpan, columnFootprint, roomsBesideWall, roomCeiling, openingFootprint } from './geometry.ts'
import { deflateSync } from 'node:zlib'
import { modelPlan, buildMesh, solidMesh, CLAY_COLORS, GLASS_KINDS, GLASS_OPACITY, type ModelState, type MeshOptions, type MeshPart, type V3 } from './mesh.ts'
import { buildDecorSolids } from './decor/solids.ts'
import { FURNITURE_LIBRARY } from './decor/furniture.ts'
import type { Plan, Vec2 } from './types.ts'
export type RenderView = 'iso-sw' | 'iso-ne' | 'iso-se' | 'iso-nw' | 'top'
/**
 * All appearance controls live here (tuned against the tool's D3 white model).
 * The key light follows the camera like a studio key: `key` = [toward viewer's left, up, toward viewer], so every
 * view gets a front-left key. Ambient is a three-band hemisphere (up / vertical / down faces).
 * Preset view azimuths refer to model axes, independent of plan.north.
 */
export const RENDER_STYLE = {
  supersample: 2,
  /** Floor sits one step below the walls in the render (the tool reaches the same through tone mapping). */
  colors: { ...CLAY_COLORS, floor: '#e3e3e0' },
  background: '#ffffff',
  light: {
    key: [.32, .9, .3] as V3, keyStrength: .36, keyTint: [1, .985, .955] as V3,
    fill: [-.25, .25, .93] as V3, fillStrength: .12, fillTint: [.97, .985, 1] as V3,
    sky: .66, horizon: .74, ground: .86, ambientTint: [.99, .993, 1] as V3,
    /** Eye-level views inside a room (with ceilings) get flatter, more ambient light, like a lit interior. */
    interior: { keyStrength: .22, fillStrength: .14, sky: .74, horizon: .78, ground: .86 },
  },
  /** Soft shadow map for the key light only; ceilings and glass do not cast. Interior (ceilinged) views skip it. */
  shadow: { strength: .45, interiorStrength: 0, texel: .02, bias: .03, softness: .07, samples: 12, maxSize: 4096 },
  glass: { opacity: GLASS_OPACITY, rim: .5, rimColor: '#ffffff' },
  outline: { width: .65, strength: .07, color: '#58606b', depthThreshold: .035, normalThreshold: .70 },
  ao: { strength: .38, radius: .24, bias: .012, samples: 8, radii: [.45, 1], contactStrength: .22, contactRadius: .09, contactSoftStrength: .16, contactSoftRadius: .4, contactGrid: .035, contactHeightTolerance: .18 },
  base: { color: '#f2f2f1', shadow: .07, shadowRadius: .9, margin: .7, thickness: .075, gap: .005, radius: .6, cornerSegments: 6 },
  /** Oblique presets sit 24° off the main axis at 50° elevation, like the tool's default oblique view. */
  camera: { elevation: 50, azimuth: { 'iso-sw': 114, 'iso-ne': -66, 'iso-se': 66, 'iso-nw': -114 }, padding: .09 },
  cutHeight: 1.2,
}
const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: number[], b: number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (v: V3): V3 => { const d = Math.hypot(...v); return v.map(x => x / d) as V3 }
/** Camera files use mm, Y-up: [plan.x, elevation, plan.y]. fov is vertical degrees. */
export interface CameraSpec {
  projection: 'perspective' | 'orthographic'; pos: V3; target: V3; up?: V3
  fov?: number; span?: number; near?: number; far?: number
  id?: string; description?: string; level?: string
}
export interface CameraRecord extends CameraSpec {
  format: 'floorplan-camera'; version: 1; unit: 'mm'; width: number; height: number
  state: ModelState; section?: number; transparent: boolean; passes: RenderPass[]
  intrinsics: { fx: number; fy: number; cx: number; cy: number }
  viewMatrix: number[]; projectionMatrix: number[]; world: string
  openings: VisibleOpening[]
  decor?: DecorView
}
/** What the decor layer put into this picture; gen_prompt.py words the prompt from `visible`. */
export interface DecorView {
  drawn: boolean
  /** Why nothing was drawn: nothing to draw, decor belongs to the renovated plan, --no-decor, or core could not build it. */
  skipped?: 'none' | 'original-state' | 'disabled' | 'error'
  error?: string
  visible: { id: string; kind: 'furniture' | 'cabinet' | 'panel' | 'shelf'; type?: string; name: string; seg: SegClass; visible_px: number }[]
}
export type RenderPass = 'clay' | 'depth' | 'lines' | 'seg' | 'openings'
export interface VisibleOpening { idx: number; id: string; name: string; kind: string; cls: 'window' | 'door'; width_mm: number; sill_mm: number; head_mm: number; visible_px: number; bbox_xyxy: number[]; mask: string }
export interface RenderOptions extends MeshOptions {
  view?: RenderView; camera?: string | CameraSpec; width?: number; height?: number; transparent?: boolean
  section?: number; passes?: RenderPass[]
  /** Draw the decor layer (default true). Decor is laid out on the renovated plan, so an original-state render skips it once there are confirmed changes. */
  decor?: boolean
}
export interface CameraChoice { id: string; description: string; level: string; camera: CameraSpec }
const sub3 = (a: V3, b: V3): V3 => a.map((v,i)=>v-b[i]) as V3
const dist2 = (a: Vec2,b: Vec2) => Math.hypot(a[0]-b[0],a[1]-b[1])
/** Eye-level room cameras: height above the room floor, vertical fov, the evaluation raster and how far the camera may tilt down. */
export const ROOM_CAMERA = { eye: 1450, fov: 75, clearances: [900, 600, 450, 300, 180], furnitureClearances: [600, 200], grid: 7, yaws: 36, pitches: [0, 3, 6], probe: { width: 96, height: 64 }, coarseProbe: { width: 48, height: 32 } }
interface RoomScene { parts: MeshPart[]; proxies: { part: MeshPart; opening: Plan['openings'][number] }[] }
interface RenderCache { states: WeakMap<Plan, Map<ModelState, Plan>>; floors: WeakMap<Plan, Map<string, Plan>>; meshes: WeakMap<Plan, Map<string, ReturnType<typeof buildMesh>>> }
const renderCaches = new WeakMap<Plan, RenderCache>()
function preparedPlan(source: Plan, state: ModelState = 'original'): Plan {
  const cache = renderCaches.get(source)
  if (!cache) return modelPlan(source, state)
  let states = cache.states.get(source); if (!states) cache.states.set(source, states = new Map())
  let plan = states.get(state)
  if (!plan) { plan = modelPlan(source, state); states.set(state, plan); renderCaches.set(plan, cache) }
  return plan
}
function selectedLevel(plan: Plan, level: string): Plan {
  const cache = renderCaches.get(plan)
  if (!cache) return onLevel(plan, level)
  let floors = cache.floors.get(plan); if (!floors) cache.floors.set(plan, floors = new Map())
  let floor = floors.get(level)
  if (!floor) { floor = onLevel(plan, level); floors.set(level, floor); renderCaches.set(floor, cache) }
  return floor
}
function sharedMesh(plan: Plan, options: MeshOptions = {}) {
  const cache = renderCaches.get(plan)
  if (!cache) return buildMesh(plan, options)
  let meshes = cache.meshes.get(plan); if (!meshes) cache.meshes.set(plan, meshes = new Map())
  const key = JSON.stringify(options)
  let mesh = meshes.get(key); if (!mesh) { mesh = buildMesh(plan, options); meshes.set(key, mesh) }
  return mesh
}
/** Snapshot ownership prevents stale geometry when callers edit their live Plan between renders. */
export function createRenderSession(source: Plan) {
  const plan = structuredClone(source)
  renderCaches.set(plan, { states: new WeakMap(), floors: new WeakMap(), meshes: new WeakMap() })
  return { renderKit: (options: RenderOptions = {}) => renderKit(plan, options) }
}
const roomScenes = new WeakMap<Plan, Map<string, RoomScene>>()
/** Everything an eye-level photo on this level can see: structure, fixtures, room ceilings and opening volumes. */
function roomScene(plan: Plan, levelId: string): RoomScene {
  let byLevel = roomScenes.get(plan); if (!byLevel) roomScenes.set(plan, byLevel = new Map())
  const cached = byLevel.get(levelId); if (cached) return cached
  const floor = selectedLevel(plan, levelId), parts = sharedMesh(floor).flatMap(g => g.parts)
  for (const r of floor.rooms) { const y = levelOf(floor, r).elevation + roomCeiling(floor, r); parts.push(solidMesh({ kind: 'ceiling', ids: [r.id], level: levelId, polygons: [[r.poly]], z0: y, z1: y + .04 })) }
  const proxies = floor.openings.flatMap(o => {
    const wall = floor.walls.find(w => w.id === o.wall); if (!wall) return []
    const widened = { ...floor, walls: floor.walls.map(w => w.id === wall.id ? { ...w, thickness: w.thickness + 20 } : w) }, el = levelOf(floor, wall).elevation
    return [{ opening: o, part: solidMesh({ kind: 'pane', ids: [o.id], polygons: [[openingFootprint(widened, o)]], z0: el + o.sill, z1: el + o.head }) }]
  })
  const scene = { parts, proxies }; byLevel.set(levelId, scene); return scene
}
const isWindow = (o: Plan['openings'][number]) => o.kind.includes('window') || o.kind === 'open-balcony'
interface ViewScore { score: number; crowd: number; leaf: number; ceiling: number; floor: number; roomFloor: number; roomArea: number; centerNear: number; near: number; openings: Map<string, number>; walls: Map<string, number>; centerWall?: string }
/** Rasterise a tiny probe frame and score it like a photo: room floor, doors/windows and the key wall in view; no wall in the face. */
function probeView(scene: RoomScene, room: Plan['rooms'][number], area: number, pos: V3, yaw: number, pitch: number, focus: { wall?: string; walls: Map<string, number>; centre: number; window: number }, coarse = false): ViewScore {
  const { width: W, height: H } = coarse ? ROOM_CAMERA.coarseProbe : ROOM_CAMERA.probe, fy = H / 2 / Math.tan(ROOM_CAMERA.fov * Math.PI / 360), p = pitch * Math.PI / 180
  const toward = [-Math.cos(yaw) * Math.cos(p), Math.sin(p), -Math.sin(yaw) * Math.cos(p)] as V3, right = unit(cross([0, 1, 0], toward)), up = cross(toward, right)
  const target = { W, H, right, up, toward, pos: pos.map(v => v / 1000) as V3, fx: fy, fy, camera: { projection: 'perspective' as const, near: 50, far: 100000 } }
  const depth = new Float32Array(W * H).fill(Infinity), at = new Int32Array(W * H).fill(-1), facing = new Uint8Array(W * H)
  scene.parts.forEach((part, index) => rasterPart(target, part, (i, z, n) => { if (z < depth[i]) { depth[i] = z; at[i] = index; facing[i] = dot(n, toward) > .75 ? 1 : 0 } }))
  const openingAt = new Int32Array(W * H).fill(-1)
  scene.proxies.forEach(({ part }, index) => rasterPart(target, part, (i, z) => { if (z <= depth[i] + .05) openingAt[i] = index }))
  let ceiling = 0, floor = 0, roomFloor = 0, roomArea = 0, centerNear = 0, near = 0, crowd = 0, centerCount = 0, leaf = 0, centerWindow = 0
  const openings = new Map<string, number>(), walls = new Map<string, number>(), centerWalls = new Map<string, number>()
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, center = x >= W * .3 && x < W * .7 && y >= H * .25 && y < H * .75
    if (center) { centerCount++; if (depth[i] < 1.5) centerNear++ }
    if (depth[i] < 1) near++
    if (depth[i] < 2) crowd++
    if (openingAt[i] >= 0) { const o = scene.proxies[openingAt[i]].opening; openings.set(o.id, (openings.get(o.id) ?? 0) + 1); if (center && isWindow(o)) centerWindow++ }
    if (at[i] < 0) continue
    const part = scene.parts[at[i]]
    if (part.kind === 'ceiling') ceiling++
    else if (part.kind === 'leaf') leaf++
    else if (['floor', 'platform', 'slab', 'stair'].includes(part.kind)) {
      floor++
      if (part.ids.includes(room.id)) {
        // Floor patch seen by this pixel, m²: (z/f)² over the cosine between the view ray and the floor normal.
        const cx = (x + .5 - W / 2) / fy, cy = (H / 2 - y - .5) / fy, ray = [0, 1, 2].map(k => right[k] * cx + up[k] * cy - toward[k])
        roomFloor++; roomArea += (depth[i] / fy) ** 2 * Math.hypot(...ray) / Math.max(.05, Math.abs(ray[1]))
      }
    }
    else if (['wall', 'sill', 'lintel'].includes(part.kind)) { walls.set(part.ids[0], (walls.get(part.ids[0]) ?? 0) + 1); if (center && facing[i]) centerWalls.set(part.ids[0], (centerWalls.get(part.ids[0]) ?? 0) + 1) }
  }
  const N = W * H, f = (v: number) => v / N
  const openingValue = [...openings].reduce((sum, [id, px]) => { const o = scene.proxies.find(q => q.opening.id === id)!.opening; return sum + f(px) * (isWindow(o) ? 1 : .6) }, 0)
  const wallValue = [...walls].reduce((sum, [id, px]) => sum + f(px) * (focus.walls.get(id) ?? 0), 0)
  const result: ViewScore = { score: 0, crowd: f(crowd), leaf: f(leaf), ceiling: f(ceiling), floor: f(floor), roomFloor: f(roomFloor), roomArea: Math.min(1, roomArea / area), centerNear: centerNear / centerCount, near: f(near), openings, walls, centerWall: [...centerWalls].sort((a, b) => b[1] - a[1])[0]?.[0] }
  result.score = 3 * result.roomArea + 3 * Math.min(openingValue, .15) + 2.5 * Math.min(wallValue, .3) + (result.centerWall && focus.walls.get(result.centerWall) ? focus.centre : 0) + focus.window * Math.min(centerWindow / centerCount, .25) - 8 * result.leaf
    + (focus.wall ? 5 * Math.min(f(walls.get(focus.wall) ?? 0) + [...openings].filter(([id]) => scene.proxies.find(q => q.opening.id === id)!.opening.wall === focus.wall).reduce((s, [, px]) => s + f(px), 0), .5) : 0)
    - 6 * result.centerNear - 3 * Math.max(0, result.near - .08) - 2 * Math.max(0, result.crowd - .15) - 4 * Math.max(0, result.ceiling - .22) - 3 * Math.max(0, .12 - result.floor) - 2 * Math.max(0, result.floor - .45) - .05 * pitch
  return result
}
/**
 * Pick an eye-level camera like a photographer would: stand ≥ 0.6 m from walls (relaxed only for narrow rooms), keep the
 * frame centre clear of near walls, ceiling ≲ 1/4, and show this room's floor, doors/windows and its longest solid wall
 * (the TV / bed wall in most homes). With wallId the camera faces that wall from the most useful spot.
 */
export function cameraRoomEligible(room: Plan['rooms'][number]): boolean {
  return room.counted !== false && polygonArea(room.poly) >= 1.5e6 && (room.floorOffset ?? 0) <= .3
}
function roomCamera(plan: Plan, room: Plan['rooms'][number], wallId?: string, obstacles: DecorObstacle[] = []): CameraSpec {
  if (!cameraRoomEligible(room)) throw new Error(`房间 ${room.id} 不适合站人平视：不计入面积、面积小于 1.5 m² 或地面抬高超过 0.3 m`)
  const level = levelOf(plan, room), floorY = (level.elevation + (room.floorOffset ?? 0)) * 1000, eye = floorY + ROOM_CAMERA.eye
  const walls = plan.walls.filter(w => levelOf(plan, w).id === level.id), wall = wallId ? walls.find(w => w.id === wallId) : undefined
  if (wallId && !wall) throw new Error(`房间机位的墙不存在：${wallId}`)
  // Only hinged doors sweep the floor; sliding doors and open doorways do not.
  const doors = plan.openings.filter(o => o.kind === 'door' && levelOf(plan, o).id === level.id).map(o => ({ o, span: openingSpan(plan, o) }))
  const edgeDistance = (p: Vec2, a: Vec2, b: Vec2) => { const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) }
  const clearOf = (p: Vec2, gap: number) => pointInPolygon(p, room.poly) && room.poly.every((a, i) => edgeDistance(p, a, room.poly[(i + 1) % room.poly.length]) >= gap) && walls.every(w => projectToWall(w, p).dist > w.thickness / 2 + gap) &&
    !(plan.columns ?? []).some(c => levelOf(plan, c).id === level.id && pointInPolygon(p, columnFootprint(c))) &&
    !(plan.shafts ?? []).some(s => levelOf(plan, s).id === level.id && pointInPolygon(p, s.poly)) &&
    doors.every(({ o, span }) => dist2(p, o.swing?.hinge === 'end' ? span.b : span.a) > o.width + 200)
  // Stand clear of furniture and floor-standing cabinets (rugs and wall cabinets above the eye do not count):
  // a walkway's width first, then just outside them, and only then as if the room were empty.
  const blockers = obstacles.filter(o => levelOf(plan, { level: o.level }).id === level.id && o.z1 > floorY / 1000 + .1 && o.z0 < eye / 1000).flatMap(o => o.rings)
  const free = (p: Vec2, margin: number) => blockers.every(r => !pointInPolygon(p, r) && r.every((a, i) => edgeDistance(p, a, r[(i + 1) % r.length]) >= margin))
  const xs = room.poly.map(p => p[0]), ys = room.poly.map(p => p[1]), x0 = Math.min(...xs), y0 = Math.min(...ys), dx = Math.max(...xs) - x0, dy = Math.max(...ys) - y0
  const grid: Vec2[] = [], n = ROOM_CAMERA.grid
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) grid.push([x0 + dx * i / n, y0 + dy * j / n])
  for (const corner of room.poly) { const c = labelPoint(room.poly), l = dist2(corner, c); for (const inset of [700, 1000]) if (l > inset) grid.push([corner[0] + (c[0] - corner[0]) * inset / l, corner[1] + (c[1] - corner[1]) * inset / l]) }
  let gap = 0, usable: Vec2[] = []
  search: for (const margin of blockers.length ? [...ROOM_CAMERA.furnitureClearances, 0] : [0]) for (gap of ROOM_CAMERA.clearances) {
    usable = grid.filter(p => clearOf(p, gap) && (!margin || free(p, margin))); if (usable.length) break search
  }
  if (!usable.length) throw new Error(`房间 ${room.id} 没有避开墙体和门扇的机位，请提供自定义相机`)
  // Key wall = the longest continuous full-height stretch of this room's boundary without doors or windows (TV / bed wall).
  const focusWalls = new Map<string, number>()
  for (const w of walls) {
    if (!['exterior', 'bearing', 'partition'].includes(w.kind) || !Object.values(roomsBesideWall(plan, w.id)).flat().some(r => r.id === room.id)) continue
    let spans = room.poly.flatMap((a, i) => { const b = room.poly[(i + 1) % room.poly.length], pa = projectToWall(w, a), pb = projectToWall(w, b); return pa.dist <= w.thickness / 2 + 60 && pb.dist <= w.thickness / 2 + 60 ? [[Math.min(pa.s, pb.s), Math.max(pa.s, pb.s)]] : [] })
    for (const o of plan.openings.filter(o => o.wall === w.id)) spans = spans.flatMap(([a, b]) => [[a, Math.min(b, o.offset)], [Math.max(a, o.offset + o.width), b]].filter(([p, q]) => q > p))
    focusWalls.set(w.id, Math.max(0, ...spans.map(([a, b]) => b - a)))
  }
  const longest = Math.max(1, ...focusWalls.values())
  for (const [id, v] of focusWalls) focusWalls.set(id, v / longest >= .8 ? 1 : 0)
  const living = /客|起居|living|lounge/i.test(room.name ?? ''), scene = roomScene(plan, level.id), focus = { wall: wall?.id, walls: focusWalls, centre: wall ? 0 : living ? 1 : .5, window: wall || living ? 0 : 2 }, area = Math.max(.5, polygonArea(room.poly) / 1e6)
  const aimAt = (w: Plan['walls'][number]): Vec2 => {
    const edges = room.poly.map((a, i) => [a, room.poly[(i + 1) % room.poly.length]] as const).filter(e => e.every(p => projectToWall(w, p).dist <= w.thickness / 2 + 60))
    const total = edges.reduce((s, [a, b]) => s + dist2(a, b), 0)
    return total ? edges.reduce((m, [a, b]) => [m[0] + (a[0] + b[0]) / 2 * dist2(a, b) / total, m[1] + (a[1] + b[1]) / 2 * dist2(a, b) / total] as Vec2, [0, 0] as Vec2) : projectToWall(w, labelPoint(room.poly)).point
  }
  // A wall view looks straight at that wall. A living room looks at one of its key walls (the TV wall), give or take 12°.
  // TV wall: a key wall square to the room's main window / balcony wall (sofa and TV face each other across the room).
  const glazing = (w: Plan['walls'][number]) => plan.openings.filter(o => o.wall === w.id && o.kind !== 'door' && o.kind !== 'doorway').reduce((s, o) => s + o.width, 0)
  const lightWall = walls.filter(w => Object.values(roomsBesideWall(plan, w.id)).flat().some(r => r.id === room.id)).sort((a, b) => glazing(b) - glazing(a))[0]
  const direction = (w: Plan['walls'][number]) => { const d = [w.b[0] - w.a[0], w.b[1] - w.a[1]], l = Math.hypot(d[0], d[1]) || 1; return [d[0] / l, d[1] / l] }
  const keyWalls = walls.filter(w => focusWalls.get(w.id)), square = lightWall && glazing(lightWall) ? keyWalls.filter(w => Math.abs(direction(w)[0] * direction(lightWall)[0] + direction(w)[1] * direction(lightWall)[1]) < .3) : []
  const aims = wall ? [aimAt(wall)] : living ? (square.length ? square : keyWalls).map(aimAt) : []
  // Include every wall-view direction in the default search; the TV-wall preference must not hide openings.
  const boundaryAims = wall ? [] : walls.filter(w => Object.values(roomsBesideWall(plan, w.id)).flat().some(r => r.id === room.id)).map(aimAt)
  const yawsFor = (p: Vec2) => [...new Set([
    ...(aims.length ? aims.flatMap(a => (wall ? [0] : [-12, 0, 12]).map(d => Math.atan2(a[1] - p[1], a[0] - p[0]) + d * Math.PI / 180)) : Array.from({ length: ROOM_CAMERA.yaws }, (_, k) => k * 2 * Math.PI / ROOM_CAMERA.yaws)),
    ...boundaryAims.map(a => Math.atan2(a[1] - p[1], a[0] - p[0])),
  ])]
  const pitch0 = ROOM_CAMERA.pitches[1]
  // Cheap full search, then full-resolution rescoring of finalists at all pitches.
  const coarse = usable.flatMap(p => yawsFor(p).map(yaw => ({ p, yaw, view: probeView(scene, room, area, [p[0], eye, p[1]], yaw, pitch0, focus, true) }))).sort((a, b) => b.view.score - a.view.score)
  const seesOpening = (view: ViewScore, pixels: number) => [...view.openings.values()].some(px => px >= pixels)
  const refine = (c: typeof coarse[number]) => ROOM_CAMERA.pitches.map(pitch => ({ ...c, pitch, view: probeView(scene, room, area, [c.p[0], eye, c.p[1]], c.yaw, pitch, focus) }))
  // Keep opening-bearing candidates through both stages, even when a blank wall scores higher.
  const withOpenings = wall ? [] : coarse.filter(c => seesOpening(c.view, 3)).sort((a, b) =>
    Number(seesOpening(b.view, 16)) - Number(seesOpening(a.view, 16)) || b.view.score - a.view.score)
  const finalists = [...new Set([...coarse.slice(0, 6), ...withOpenings.slice(0, 6)])].flatMap(refine)
  let visible = finalists.filter(c => seesOpening(c.view, 12))
  // Resolve coarse/fine sampling disagreements before falling back to a blank view.
  if (!wall && scene.proxies.length && !visible.length) for (const c of coarse.slice(6)) {
    const candidates = refine(c).filter(c => seesOpening(c.view, 12))
    if (candidates.length) { visible = candidates; break }
  }
  // A door clipped to a thin edge technically has pixels, but still reads as a blank-wall photo.
  // Prefer an opening occupying at least 1% of the probe when one is available.
  const informative = visible.filter(c => seesOpening(c.view, Math.ceil(ROOM_CAMERA.probe.width * ROOM_CAMERA.probe.height * .01)))
  const best = (!wall && informative.length ? informative : !wall && visible.length ? visible : finalists).sort((a, b) => b.view.score - a.view.score)[0]
  const { p: pos, yaw, pitch, view } = best, reach = 4000, drop = Math.tan(pitch * Math.PI / 180) * reach
  const name = (id?: string) => id ? (walls.find(w => w.id === id)?.name ?? plan.openings.find(o => o.id === id)?.name ?? id) : ''
  const sees = [...view.openings].filter(([, px]) => px >= 12).sort((a, b) => b[1] - a[1]).map(([id]) => name(id))
  const back = [...walls].sort((a, b) => projectToWall(a, pos).dist - projectToWall(b, pos).dist)[0]
  // A low visible fraction of a large / concave room does not mean the room is narrow.
  const narrow = gap < 600
  const facing = name(wall?.id ?? view.centerWall)
  const openBalcony = plan.openings.some(o => o.kind === 'open-balcony' && Object.values(roomsBesideWall(plan, o.wall)).flat().some(r => r.id === room.id))
  const description = `${room.name}${openBalcony ? '（开敞阳台，平视多半是天空）' : ''}，${back ? `靠${name(back.id)}站，` : ''}${facing ? `看向${facing}` : '平视'}${sees.length ? `；画面里有${sees.join('、')}` : ''}${narrow ? '（房间窄，平视画面有限，建议同时看俯视或斜视）' : ''}`
  return { projection: 'perspective', pos: [pos[0], eye, pos[1]], target: [pos[0] + Math.cos(yaw) * reach, eye - drop, pos[1] + Math.sin(yaw) * reach], fov: ROOM_CAMERA.fov, near: 50, far: 100000, level: level.id,
    id: `room:${room.id}${wallId ? ':' + wallId : ''}`, description }
}
export function listCameras(source: Plan, state: ModelState = 'original', opts: { all?: boolean; level?: string } = {}): CameraChoice[] {
  const plan=preparedPlan(source,state), result:CameraChoice[]=[], obstacles=decorObstacles(source,plan,{state})
  assertLevel(plan, opts.level)
  for(const level of levelsOf(plan)) {
    if (opts.level && level.id !== opts.level) continue
    const floor=selectedLevel(plan,level.id)
    if(sharedMesh(floor).length) for(const id of ['iso-sw','iso-ne','iso-se','iso-nw','top'] as RenderView[]) {
      const camera=resolveCamera(floor,{view:id,level:level.id,width:2400,height:1600})
      result.push({id,level:level.id,description:`${level.name}，${({ 'iso-sw':'西南斜视','iso-ne':'东北斜视','iso-se':'东南斜视','iso-nw':'西北斜视',top:'俯视剖切' })[id]}`,camera})
    }
    // A room without any spot clear of walls and door swings is left out; render room:<id> explains why.
    const add=(room:Plan['rooms'][number],wallId?:string)=>{try{const camera=roomCamera(floor,room,wallId,obstacles);result.push({id:camera.id!,description:camera.description!,level:level.id,camera})}catch{/* skipped */}}
    for(const room of floor.rooms) {
      if (!cameraRoomEligible(room)) continue
      add(room)
      if (opts.all) for(const wall of floor.walls.filter(w=>Object.values(roomsBesideWall(floor,w.id)).flat().some(r=>r.id===room.id)))add(room,wall.id)
    }
  }
  return result
}
export function resolveCamera(source: Plan, options: RenderOptions = {}): CameraSpec {
  const selected=preparedPlan(source,options.state), plan=options.level?selectedLevel(selected,options.level):selected
  assertLevel(selected, options.level)
  if(typeof options.camera==='object') {
    const c=structuredClone(options.camera)
    if(!['perspective','orthographic'].includes(c.projection)||![c.pos,c.target].every(v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite))||Math.hypot(...sub3(c.pos,c.target))<1e-6)throw new Error('无效相机：pos/target 必须是不同的有限三维 mm 坐标')
    if(c.projection==='perspective'&&(!Number.isFinite(c.fov??75)||(c.fov??75)<=1||(c.fov??75)>=179))throw new Error('fov 须在 1–179 度之间')
    if(c.projection==='orthographic'&&(!(c.span!>0)||!Number.isFinite(c.span)))throw new Error('正交相机需要正数 span（画幅垂直跨度 mm）')
    if(!Number.isFinite(c.near??50)||!Number.isFinite(c.far??100000))throw new Error('near/far 必须是有限 mm 数值')
    if(!((c.near??50)>0))throw new Error('near 必须大于 0')
    if((c.far??100000)<=(c.near??50))throw new Error('far 必须大于 near')
    return c
  }
  if(options.camera?.startsWith('pos=')) {
    const m=/^pos=([^;]+);target=([^;]+);fov=([^;]+)$/.exec(options.camera)
    if(!m)throw new Error('相机格式：pos=x,y,z;target=x,y,z;fov=75，单位 mm')
    return resolveCamera(plan,{...options,camera:{projection:'perspective',pos:m[1].split(',').map(Number) as V3,target:m[2].split(',').map(Number) as V3,fov:Number(m[3])}})
  }
  if(options.camera?.startsWith('room:')) {
    // IDs may themselves contain colons. Match the longest room ID first.
    const suffix=options.camera.slice(5),room=[...plan.rooms].sort((a,b)=>b.id.length-a.id.length).find(r=>suffix===r.id||suffix.startsWith(r.id+':'))
    if(!room)throw new Error(`未知房间机位：${options.camera}`)
    return roomCamera(plan,room,suffix===room.id?undefined:suffix.slice(room.id.length+1),decorObstacles(source,selected,options))
  }
  const view=(options.camera??options.view??'iso-sw') as RenderView
  if(!['iso-sw','iso-ne','iso-se','iso-nw','top'].includes(view))throw new Error(`未知视角：${view}`)
  const parts=sharedMesh(plan,{cutHeight:options.section!==undefined?options.section/1000:view==='top'?RENDER_STYLE.cutHeight:options.cutHeight}).flatMap(g=>g.parts)
  if(!parts.length)throw new Error('方案没有可渲染的实体')
  const S=RENDER_STYLE,az=(view==='top'?0:S.camera.azimuth[view])*Math.PI/180,el=S.camera.elevation*Math.PI/180
  const toward:V3=view==='top'?[0,1,0]:[Math.cos(az)*Math.cos(el),Math.sin(el),Math.sin(az)*Math.cos(el)],right:V3=view==='top'?[1,0,0]:unit(cross([0,1,0],toward)),up=cross(toward,right)
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity]
  for(const p of parts)for(let i=0;i<p.positions.length;i+=3){const v=p.positions.slice(i,i+3);[right,up,toward].forEach((axis,k)=>{const d=dot(v,axis);lo[k]=Math.min(lo[k],d);hi[k]=Math.max(hi[k],d)})}
  const mid=lo.map((v,i)=>(v+hi[i])/2),target=right.map((v,i)=>(v*mid[0]+up[i]*mid[1]+toward[i]*mid[2])*1000) as V3
  const span=Math.max(hi[1]-lo[1]+2*S.base.margin,(hi[0]-lo[0]+2*S.base.margin)*(options.height??1600)/(options.width??2400))/(1-2*S.camera.padding)*1000
  const distance=Math.max(span, (hi[2]-lo[2])*1000)*2+1000
  return {projection:'orthographic',id:view,pos:target.map((v,i)=>v+toward[i]*distance) as V3,target,up,span,near:1,far:distance*3,level:options.level}
}

type DecorItem = Omit<DecorView['visible'][number], 'visible_px'>
const decorInfo = new WeakMap<MeshPart, DecorItem>()
/** Library types → ADE20K classes; sized variants (bed-1500) fall back to their family, anything unknown is a box. */
const FURNITURE_SEG: Record<string, SegClass> = {
  sofa: 'sofa', armchair: 'armchair', 'coffee-table': 'table', 'dining-table': 'table', table: 'table', desk: 'desk', chair: 'chair', 'desk-chair': 'chair',
  bed: 'bed', nightstand: 'cabinet', 'tv-stand': 'cabinet', bookshelf: 'shelf', wardrobe: 'wardrobe', fridge: 'refrigerator',
  washer: 'cabinet', dryer: 'cabinet', oven: 'cabinet', steamer: 'cabinet', dishwasher: 'cabinet', microwave: 'cabinet',
  rug: 'rug', toilet: 'toilet', basin: 'sink', bathtub: 'bathtub',
}
const furnitureSeg = (type: string): SegClass => FURNITURE_SEG[type] ?? FURNITURE_SEG[type.replace(/-\d+$/, '')] ?? 'box'
/**
 * The decor layer as the tool's decor mode shows it in clay: furniture boxes, cabinet and panel solids, recess shelves,
 * and walls with niches swapped for their cut replacements (`replaced` keys the structural parts to drop).
 */
function decorSkipped(source: Plan, full: Plan, options: Pick<RenderOptions, 'state' | 'decor'>): DecorView['skipped'] {
  if (options.decor === false) return 'disabled'
  if (!full.decor) return 'none'
  if ((options.state ?? 'original') === 'original' && source.changes.some(c => c.status === 'confirmed')) return 'original-state'
}
interface DecorObstacle { level?: string; z0: number; z1: number; rings: Vec2[][] }
/** Footprints of the furniture and cabinets a render will draw, so room cameras stand clear of them. */
function decorObstacles(source: Plan, full: Plan, options: Pick<RenderOptions, 'state' | 'decor'>): DecorObstacle[] {
  if (decorSkipped(source, full, options)) return []
  try {
    return buildDecorSolids(full).filter(s => !s.replaces && !s.missing && (s.kind === 'decor-furniture' || s.kind.startsWith('decor-cabinet')))
      .map(s => ({ level: s.level, z0: s.z0, z1: s.z1, rings: s.polygons.map(p => p[0]) }))
  } catch { return [] }
}
function decorScene(source: Plan, full: Plan, options: RenderOptions, level: string | undefined, cutHeight: number | undefined) {
  const parts: MeshPart[] = [], replaced = new Set<string>(), skip = (skipped: DecorView['skipped'], error?: string) => ({ parts, replaced, view: { drawn: false, skipped, ...(error ? { error } : {}), visible: [] } as DecorView })
  const skipped = decorSkipped(source, full, options)
  if (skipped) return skip(skipped)
  let solids: ReturnType<typeof buildDecorSolids>
  try { solids = buildDecorSolids(full) } catch (e) { return skip('error', e instanceof Error ? e.message : String(e)) }
  const d = full.decor!, first = levelsOf(full)[0].id
  for (const s of solids) {
    const lv = s.level ?? first
    if (s.missing || (level && lv !== level)) continue
    const z1 = cutHeight === undefined ? s.z1 : Math.min(s.z1, levelOf(full, { level: lv }).elevation + cutHeight)
    const kind = s.replaces ?? (s.kind === 'decor-furniture' ? 'furniture' : 'cabinet'), part = solidMesh({ kind, ids: s.ids, level: lv, polygons: s.polygons, z0: s.z0, z1 })
    if (s.replaces) replaced.add(`${s.replaces}|${s.ids.join(',')}`)
    if (!part.positions.length) continue
    const id = s.ids[0], f = d.furniture.find(x => x.id === id), c = d.cabinets.find(x => x.id === id), panel = d.panels.find(x => x.id === id)
    if (s.replaces) { /* structural surface: keeps its own class */ }
    else if (f) decorInfo.set(part, { id, kind: 'furniture', type: f.type, name: f.name ?? FURNITURE_LIBRARY.find(e => e.type === f.type)?.name ?? f.type, seg: furnitureSeg(f.type) })
    else if (c) decorInfo.set(part, { id, kind: 'cabinet', name: c.name ?? '柜体', seg: 'cabinet' })
    else if (panel) decorInfo.set(part, { id, kind: 'panel', name: panel.name ?? '墙面造型', seg: 'wall' })
    else decorInfo.set(part, { id, kind: 'shelf', name: '壁龛层板', seg: 'shelf' })
    parts.push(part)
  }
  return { parts, replaced, view: { drawn: true, visible: [] } as DecorView }
}
/** Visible decor items in the final frame (supersampled hits folded back to output pixels), largest first. */
function visibleDecor(frame: Pick<Frame, 'partAt' | 'parts' | 'ss'>): DecorView['visible'] {
  const counts = new Map<string, { item: DecorItem; n: number }>()
  for (const index of frame.partAt) {
    const item = index >= 0 ? decorInfo.get(frame.parts[index]) : undefined
    if (item) { const c = counts.get(item.id); if (c) c.n++; else counts.set(item.id, { item, n: 1 }) }
  }
  return [...counts.values()].map(({ item, n }) => ({ ...item, visible_px: Math.round(n / frame.ss ** 2) })).filter(v => v.visible_px > 0).sort((a, b) => b.visible_px - a.visible_px)
}

interface Frame {
  width: number; height: number; W: number; H: number; ss: number; rgba: Uint8Array
  depth: Float32Array; normals: Float32Array; partAt: Int32Array; parts: MeshPart[]
  camera: CameraRecord; plan: Plan; right: V3; up: V3; toward: V3; pos: V3; fx: number; fy: number
}
function cameraBasis(c: CameraSpec) {
  const toward=unit(sub3(c.pos,c.target)), hint=c.up??(Math.abs(toward[1])>.999?[0,0,-1]:[0,1,0])
  if(hint.length!==3||!hint.every(Number.isFinite)||Math.hypot(...cross(hint,toward))<1e-8)throw new Error('相机 up 不得与视线平行')
  const right=unit(cross(hint,toward)),up=cross(toward,right)
  return {right,up,toward}
}
/** Camera-space near/far clipping, perspective-correct linear z, two-sided geometry. */
type RasterTarget = Pick<Frame,'W'|'H'|'right'|'up'|'toward'|'pos'|'fx'|'fy'> & { camera: Pick<CameraSpec,'projection'|'near'|'far'> }
function rasterPart(frame: RasterTarget, part: MeshPart, visit: (i:number,z:number,n:V3,part:MeshPart)=>void) {
  const {W,H,right,up,toward,pos,camera,fx,fy}=frame,perspective=camera.projection==='perspective',near=(camera.near??50)/1000,far=(camera.far??100000)/1000
  const clip=(poly:V3[],plane:number,greater:boolean):V3[]=>{
    const out:V3[]=[]
    poly.forEach((a,i)=>{const b=poly[(i+1)%poly.length],ia=greater?a[2]>=plane:a[2]<=plane,ib=greater?b[2]>=plane:b[2]<=plane;if(ia)out.push(a);if(ia!==ib){const t=(plane-a[2])/(b[2]-a[2]);out.push(a.map((v,k)=>v+(b[k]-v)*t) as V3)}})
    return out
  }
  for(let t=0;t<part.positions.length;t+=9) {
    let verts: V3[] = []
    for (let k = t; k < t + 9; k += 3) {
      const x = part.positions[k] - pos[0], y = part.positions[k + 1] - pos[1], z = part.positions[k + 2] - pos[2]
      verts.push([x * right[0] + y * right[1] + z * right[2], x * up[0] + y * up[1] + z * up[2], -(x * toward[0] + y * toward[1] + z * toward[2])])
    }
    const minZ = Math.min(verts[0][2], verts[1][2], verts[2][2]), maxZ = Math.max(verts[0][2], verts[1][2], verts[2][2])
    if (maxZ < near || minZ > far) continue
    if (minZ < near) verts = clip(verts, near, true)
    if (maxZ > far) verts = clip(verts, far, false)
    if (verts.length < 3) continue
    let n=part.normals.slice(t,t+3) as V3
    const world=part.positions.slice(t,t+3) as V3
    if(dot(n,sub3(pos,world))<0)n=n.map(v=>-v) as V3
    const screen=verts.map(p=>[W/2+p[0]*fx/(perspective?p[2]:1),H/2-p[1]*fy/(perspective?p[2]:1),p[2]] as V3)
    for(let j=1;j<screen.length-1;j++) {
      const [a,b,c]=[screen[0],screen[j],screen[j+1]],area=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
      if(Math.abs(area)<1e-10)continue
      const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),x1=Math.min(W-1,Math.ceil(Math.max(a[0],b[0],c[0]))),y0=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),y1=Math.min(H-1,Math.ceil(Math.max(a[1],b[1],c[1])))
      for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++) {
        const px=x+.5,py=y+.5,u=((b[0]-px)*(c[1]-py)-(b[1]-py)*(c[0]-px))/area,v=((c[0]-px)*(a[1]-py)-(c[1]-py)*(a[0]-px))/area,w=1-u-v
        if(u< -1e-9||v< -1e-9||w< -1e-9)continue
        const z=perspective?1/(u/a[2]+v/b[2]+w/c[2]):u*a[2]+v*b[2]+w*c[2]
        visit(y*W+x,z,n,part)
      }
    }
  }
}
function worldAt(f:Frame,i:number):V3 { return worldAtDepth(f,i,f.depth[i]) }
function worldAtDepth(f:Frame,i:number,z:number):V3 {
  const x=((i%f.W)+.5-f.W/2)/f.fx*(f.camera.projection==='perspective'?z:1),y=(f.H/2-(Math.floor(i/f.W)+.5))/f.fy*(f.camera.projection==='perspective'?z:1)
  return f.pos.map((v,k)=>v+f.right[k]*x+f.up[k]*y-f.toward[k]*z) as V3
}
function edgeAt(f:Frame,i:number,dx:number,dy:number):boolean {
  const x=i%f.W,y=Math.floor(i/f.W),X=x+dx,Y=y+dy
  if(X<0||X>=f.W||Y<0||Y>=f.H)return false
  const j=Y*f.W+X,a=Number.isFinite(f.depth[i]),b=Number.isFinite(f.depth[j])
  if(!a||!b)return a!==b
  const k=i*3,l=j*3,nx=f.normals[k],ny=f.normals[k+1],nz=f.normals[k+2]
  if(nx*f.normals[l]+ny*f.normals[l+1]+nz*f.normals[l+2]<RENDER_STYLE.outline.normalThreshold)return true
  // Dot the displacement in camera space: no per-neighbour arrays or world-position allocations.
  const zi=f.depth[i],zj=f.depth[j],perspective=f.camera.projection==='perspective'
  const dxCam=perspective?((X+.5-f.W/2)*zj-(x+.5-f.W/2)*zi)/f.fx:dx/f.fx
  const dyCam=perspective?((f.H/2-Y-.5)*zj-(f.H/2-y-.5)*zi)/f.fy:-dy/f.fy
  const nr=nx*f.right[0]+ny*f.right[1]+nz*f.right[2],nu=nx*f.up[0]+ny*f.up[1]+nz*f.up[2],nt=nx*f.toward[0]+ny*f.toward[1]+nz*f.toward[2]
  return Math.abs(nr*dxCam+nu*dyCam-nt*(zj-zi))>RENDER_STYLE.outline.depthThreshold
}
/** Retain O1's world-space contact field so top views also read wall/floor junctions. */
function contactField(parts:MeshPart[],lo:number[],hi:number[]) {
  const S=RENDER_STYLE,step=S.ao.contactGrid,x0=lo[0]-S.base.margin,z0=lo[2]-S.base.margin,gw=Math.ceil((hi[0]-lo[0]+2*S.base.margin)/step)+1,gh=Math.ceil((hi[2]-lo[2]+2*S.base.margin)/step)+1
  const segments:{a:V3;b:V3;low:number;high:number}[]=[],seen=new Set<string>(),fields=new Map<number,Float32Array>()
  for(const p of parts.filter(p=>!['floor','slab','platform','plinth','ceiling'].includes(p.kind)))for(let t=0;t<p.positions.length;t+=9){
    if(Math.abs(p.normals[t+1])>.01)continue
    const v=[0,3,6].map(k=>p.positions.slice(t+k,t+k+3) as V3),low=Math.min(...v.map(p=>p[1])),high=Math.max(...v.map(p=>p[1]))
    for(let j=0;j<3;j++){const a=v[j],b=v[(j+1)%3];if(Math.abs(a[1]-b[1])>1e-6)continue;const key=[a[0],a[2],b[0],b[2],low,high].map(x=>x.toFixed(5)).join(',');if(!seen.has(key)){seen.add(key);segments.push({a,b,low,high})}}
  }
  return (world:V3,elevation:number)=>{
    let field=fields.get(elevation)
    if(!field){field=new Float32Array(gw*gh);const r=Math.max(S.ao.contactRadius,S.ao.contactSoftRadius)
      for(const {a,b,low,high} of segments){
        if(low>elevation+S.ao.contactHeightTolerance||high<=elevation+.01)continue
        const ix0=Math.max(0,Math.floor((Math.min(a[0],b[0])-r-x0)/step)),ix1=Math.min(gw-1,Math.ceil((Math.max(a[0],b[0])+r-x0)/step)),iz0=Math.max(0,Math.floor((Math.min(a[2],b[2])-r-z0)/step)),iz1=Math.min(gh-1,Math.ceil((Math.max(a[2],b[2])+r-z0)/step)),dx=b[0]-a[0],dz=b[2]-a[2],l2=dx*dx+dz*dz
        for(let iz=iz0;iz<=iz1;iz++)for(let ix=ix0;ix<=ix1;ix++){const px=x0+ix*step,pz=z0+iz*step,t=Math.max(0,Math.min(1,((px-a[0])*dx+(pz-a[2])*dz)/(l2||1))),d=Math.hypot(px-a[0]-dx*t,pz-a[2]-dz*t,Math.max(0,low-elevation));field[iz*gw+ix]=Math.max(field[iz*gw+ix],S.ao.contactStrength*Math.max(0,1-d/S.ao.contactRadius)**2+S.ao.contactSoftStrength*Math.max(0,1-d/S.ao.contactSoftRadius)**2)}
      }
      fields.set(elevation,field)
    }
    const fx=Math.max(0,Math.min(gw-1.001,(world[0]-x0)/step)),fz=Math.max(0,Math.min(gh-1.001,(world[2]-z0)/step)),ix=Math.floor(fx),iz=Math.floor(fz),tx=fx-ix,tz=fz-iz
    const a=field[iz*gw+ix]*(1-tx)+field[iz*gw+ix+1]*tx,b=field[(iz+1)*gw+ix]*(1-tx)+field[(iz+1)*gw+ix+1]*tx
    return 1-(a*(1-tz)+b*tz)
  }
}
/** Orthographic depth map seen from the key light; returns 0 (lit) … 1 (fully shadowed) with PCF softening. Furniture boxes do not cast, as in the tool. */
function shadowMap(parts:MeshPart[],key:V3,strength:number) {
  const S=RENDER_STYLE.shadow,casters=parts.filter(p=>!GLASS_KINDS.has(p.kind)&&p.kind!=='ceiling'&&p.kind!=='plinth'&&p.kind!=='furniture')
  if(!casters.length||strength<=0)return (_:V3)=>0
  const toward=key,right=unit(cross(Math.abs(key[1])>.999?[0,0,1]:[0,1,0],toward)),up=cross(toward,right)
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity]
  for(const p of casters)for(let i=0;i<p.positions.length;i+=3){const v=p.positions.slice(i,i+3);[right,up,toward].forEach((a,k)=>{const d=dot(v,a);lo[k]=Math.min(lo[k],d);hi[k]=Math.max(hi[k],d)})}
  const pad=S.softness*2+S.texel*2,texel=Math.max(S.texel,(Math.max(hi[0]-lo[0],hi[1]-lo[1])+2*pad)/S.maxSize)
  const W=Math.ceil((hi[0]-lo[0]+2*pad)/texel),H=Math.ceil((hi[1]-lo[1]+2*pad)/texel),cx=(lo[0]+hi[0])/2,cy=(lo[1]+hi[1])/2,cz=hi[2]+1
  const pos=[0,1,2].map(k=>right[k]*cx+up[k]*cy+toward[k]*cz) as V3,map=new Float32Array(W*H).fill(Infinity)
  const target={W,H,right,up,toward,pos,fx:1/texel,fy:1/texel,camera:{projection:'orthographic' as const,near:1,far:(hi[2]-lo[2]+2)*1000}}
  for(const p of casters)rasterPart(target,p,(i,z)=>{if(z<map[i])map[i]=z})
  const taps=Array.from({length:S.samples},(_,j)=>{const r=S.softness*Math.sqrt((j+.5)/S.samples),a=j*2.39996;return [Math.cos(a)*r,Math.sin(a)*r]})
  return (p:V3)=>{
    const q=sub3(p,pos),x=dot(q,right),y=dot(q,up),z=-dot(q,toward)
    let hidden=0
    for(const [dx,dy] of taps){const X=Math.floor(W/2+(x+dx)/texel),Y=Math.floor(H/2-(y+dy)/texel);if(X>=0&&X<W&&Y>=0&&Y<H&&z>map[Y*W+X]+S.bias)hidden++}
    return strength*hidden/taps.length
  }
}
function renderFrame(source: Plan, options: RenderOptions = {}): Frame {
  const width=options.width??2400,height=options.height??1600,S=RENDER_STYLE,ss=S.supersample,W=width*ss,H=height*ss
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>16_000_000||width>8192||height>8192)throw new Error('图片尺寸须为正整数，单边不超过 8192，总像素不超过 1600 万')
  if(options.section!==undefined&&(!Number.isFinite(options.section)||options.section<=0))throw new Error('--section 必须是正数 mm')
  const c=resolveCamera(source,options),full=preparedPlan(source,options.state),level=options.level??c.level,plan=level?selectedLevel(full,level):full
  const cutHeight=options.section!==undefined?options.section/1000:c.id==='top'?S.cutHeight:options.cutHeight
  const decor=decorScene(source,full,options,level,cutHeight)
  const parts=[...sharedMesh(plan,{cutHeight}).flatMap(g=>g.parts).filter(p=>!decor.replaced.has(`${p.kind}|${p.ids.join(',')}`)),...decor.parts]
  if(!parts.length)throw new Error('方案没有可渲染的实体')
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity]
  for(const part of parts)part.positions.forEach((v,i)=>{lo[i%3]=Math.min(lo[i%3],v);hi[i%3]=Math.max(hi[i%3],v)})
  if(c.projection==='perspective'&&cutHeight===undefined) for(const r of plan.rooms) {
    const y=levelOf(plan,r).elevation+roomCeiling(plan,r)
    parts.push(solidMesh({kind:'ceiling',ids:[r.id],level:levelOf(plan,r).id,polygons:[[r.poly]],z0:y,z1:y+.04}))
  }
  let plinth:{x0:number;x1:number;z0:number;z1:number;radius:number;y:number}|undefined
  if(c.projection==='orthographic') {
    const x0=lo[0]-S.base.margin,x1=hi[0]+S.base.margin,z0=lo[2]-S.base.margin,z1=hi[2]+S.base.margin,radius=Math.min(S.base.radius,(x1-x0)/2,(z1-z0)/2),poly:Vec2[]=[]
    for(const [cx,cz,angle] of [[x1-radius,z1-radius,0],[x0+radius,z1-radius,Math.PI/2],[x0+radius,z0+radius,Math.PI],[x1-radius,z0+radius,Math.PI*1.5]])for(let i=0;i<=S.base.cornerSegments;i++){const a=angle+i/S.base.cornerSegments*Math.PI/2;poly.push([(cx+Math.cos(a)*radius)*1000,(cz+Math.sin(a)*radius)*1000])}
    parts.push(solidMesh({kind:'plinth',ids:[],polygons:[[poly]],z0:lo[1]-S.base.gap-S.base.thickness,z1:lo[1]-S.base.gap}))
    plinth={x0,x1,z0,z1,radius,y:lo[1]-S.base.gap-S.base.thickness}
  }
  const {right,up,toward}=cameraBasis(c),pos=c.pos.map(v=>v/1000) as V3,perspective=c.projection==='perspective'
  const fy=perspective?H/2/Math.tan((c.fov??75)*Math.PI/360):H/(c.span!/1000),fx=fy,near=c.near??50,far=c.far??100000
  const viewMatrix=[right[0],up[0],toward[0],0,right[1],up[1],toward[1],0,right[2],up[2],toward[2],0,-dot(c.pos,right),-dot(c.pos,up),-dot(c.pos,toward),1]
  const projectionMatrix=perspective?[2*fx/W,0,0,0,0,2*fy/H,0,0,0,0,-(far+near)/(far-near),-1,0,0,-2*far*near/(far-near),0]:[2*fx/W/1000,0,0,0,0,2*fy/H/1000,0,0,0,0,-2/(far-near),0,0,0,-(far+near)/(far-near),1]
  const camera:CameraRecord={...c,up,format:'floorplan-camera',version:1,unit:'mm',width,height,state:options.state??'original',section:options.section??(options.cutHeight!==undefined?options.cutHeight*1000:c.id==='top'?S.cutHeight*1000:undefined),transparent:options.transparent??false,passes:options.passes??['clay'],level,near,far,
    intrinsics:{fx:fx/ss/(perspective?1:1000),fy:fy/ss/(perspective?1:1000),cx:width/2,cy:height/2},viewMatrix,projectionMatrix,world:'右手系 mm；x=平面 x，z=平面 y，y 向上；矩阵列主序，相机看向 -Z；bbox 为左上原点闭区间像素',openings:[]}
  const frame:Frame={width,height,W,H,ss,rgba:new Uint8Array(width*height*4),depth:new Float32Array(W*H).fill(Infinity),normals:new Float32Array(W*H*3),partAt:new Int32Array(W*H).fill(-1),parts,camera,plan,right,up,toward,pos,fx,fy}
  parts.forEach((part,index)=>rasterPart(frame,part,(i,z,n)=>{if(z>=frame.depth[i]-1e-6)return;frame.depth[i]=z;frame.partAt[i]=index;frame.normals.set(n,i*3)}))
  camera.decor={...decor.view,visible:decor.view.drawn?visibleDecor(frame):[]}
  const contactAt=contactField(parts,lo,hi),floorElevations=parts.map(p=>p.positions.reduce((h,v,i)=>i%3===1?Math.max(h,v):h,-Infinity))
  const bg=rgb(S.background),line=rgb(S.outline.color),rim=rgb(S.glass.rimColor),palette=parts.map(p=>rgb(p.kind==='plinth'?S.base.color:S.colors[p.kind])),er=Math.max(1,Math.round(S.outline.width*ss))
  // Camera-relative lights: [viewer's left, world up, horizontal direction back toward the viewer].
  const flat=(v:V3):V3|undefined=>{const l=Math.hypot(v[0],v[2]);return l>1e-6?[v[0]/l,0,v[2]/l]:undefined}
  const front=flat(sub3(toward,up))??[0,0,1],side=flat(right)??[1,0,0]
  const relative=([l,u,f]:V3)=>unit([-side[0]*l+front[0]*f,u,-side[2]*l+front[2]*f])
  const interior=parts.some(p=>p.kind==='ceiling'),key=relative(S.light.key),fill=relative(S.light.fill),shadowAt=shadowMap(parts,key,interior?S.shadow.interiorStrength:S.shadow.strength)
  const L={...S.light,...(interior?S.light.interior:{})}
  const lightAt=(n:ArrayLike<number>,p:V3)=>{
    const ambient=n[1]>=0?L.horizon+(L.sky-L.horizon)*n[1]:L.horizon+(L.ground-L.horizon)*-n[1]
    const nk=dot(n as number[],key),k=nk>0?L.keyStrength*nk*(1-shadowAt(p)):0,f=L.fillStrength*Math.max(0,dot(n as number[],fill))
    return [0,1,2].map(c=>ambient*S.light.ambientTint[c]+k*S.light.keyTint[c]+f*S.light.fillTint[c])
  }
  // Soft halo on the white background around the base, so the model sits on a table instead of floating.
  const halo=(X:number,Y:number)=>{
    if(!plinth||perspective||S.base.shadow<=0||toward[1]<=1e-6)return 1
    const cx=(X+.5-W/2)/fy,cy=(H/2-Y-.5)/fy,o=[0,1,2].map(k=>pos[k]+right[k]*cx+up[k]*cy),t=(o[1]-plinth.y)/toward[1],px=o[0]-toward[0]*t,pz=o[2]-toward[2]*t
    const qx=Math.abs(px-(plinth.x0+plinth.x1)/2)-((plinth.x1-plinth.x0)/2-plinth.radius),qz=Math.abs(pz-(plinth.z0+plinth.z1)/2)-((plinth.z1-plinth.z0)/2-plinth.radius)
    const d=Math.hypot(Math.max(qx,0),Math.max(qz,0))+Math.min(Math.max(qx,qz),0)-plinth.radius
    return 1-S.base.shadow*Math.max(0,1-Math.max(0,d)/S.base.shadowRadius)**2
  }
  const glassy=parts.map(p=>GLASS_KINDS.has(p.kind))
  // One see-through layer: the nearest opaque surface behind front glass. No sorting between several glass layers.
  let behind:{depth:Float32Array;part:Int32Array;normals:Int8Array}|undefined
  if(glassy.some(Boolean)){
    const b={depth:new Float32Array(W*H).fill(Infinity),part:new Int32Array(W*H).fill(-1),normals:new Int8Array(W*H*3)}
    parts.forEach((part,index)=>{if(!glassy[index])rasterPart(frame,part,(i,z,n)=>{const f=frame.partAt[i];if(f<0||!glassy[f]||z>=b.depth[i]-1e-6)return;b.depth[i]=z;b.part[i]=index;for(let k=0;k<3;k++)b.normals[i*3+k]=Math.round(n[k]*127)})})
    behind=b
  }
  const surface=(index:number,n:ArrayLike<number>,p:V3)=>{
    const l=lightAt(n,p),contact=n[1]>.99&&['floor','slab','platform','plinth'].includes(parts[index].kind)?contactAt(p,floorElevations[index]):1
    return palette[index].map((v,k)=>v*l[k]*contact)
  }
  const aoTaps=S.ao.radii.flatMap(r=>Array.from({length:S.ao.samples},(_,j)=>{const angle=j/S.ao.samples*Math.PI*2;return [Math.cos(angle)*S.ao.radius*r,Math.sin(angle)*S.ao.radius*r]}))
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const sum=[0,0,0];let alpha=0
    for(let sy=0;sy<ss;sy++)for(let sx=0;sx<ss;sx++) {
      const X=x*ss+sx,Y=y*ss+sy,i=Y*W+X,index=frame.partAt[i]
      if(index<0){if(!options.transparent){const h=halo(X,Y);bg.forEach((v,k)=>sum[k]+=v*h);alpha++}continue}
      const n=[frame.normals[i*3],frame.normals[i*3+1],frame.normals[i*3+2]],edge=edgeAt(frame,i,-er,0)||edgeAt(frame,i,er,0)||edgeAt(frame,i,0,-er)||edgeAt(frame,i,0,er)
      if(glassy[index]) {
        const pane=surface(index,n,worldAt(frame,i)),o=S.glass.opacity,j=behind!.part[i]
        let color:number[],weight=1
        if(j>=0){const bn=Array.from(behind!.normals.subarray(i*3,i*3+3),v=>v/127),back=surface(j,bn,worldAtDepth(frame,i,behind!.depth[i]));color=back.map((v,k)=>v*(1-o)+pane[k]*o)}
        else if(!options.transparent)color=bg.map((v,k)=>v*(1-o)+pane[k]*o)
        else{color=pane;weight=o}
        if(edge)color=color.map((v,k)=>v*(1-S.glass.rim)+rim[k]*S.glass.rim)
        color.forEach((v,k)=>sum[k]+=Math.min(255,v)*weight);alpha+=weight;continue
      }
      const scale=perspective?fy/frame.depth[i]:fy,nr=dot(n,right),nu=dot(n,up),nt=dot(n,toward),camX=(X+.5-W/2)/scale,camY=(H/2-Y-.5)/scale
      let occlusion=0
      for(let j=0;j<aoTaps.length;j++) {
        const dx=Math.round(aoTaps[j][0]*scale),dy=Math.round(aoTaps[j][1]*scale),xx=X+dx,yy=Y+dy
        if(xx<0||xx>=W||yy<0||yy>=H)continue
        const q=yy*W+xx;if(!Number.isFinite(frame.depth[q]))continue
        const qs=perspective?fy/frame.depth[q]:fy,dxCam=(xx+.5-W/2)/qs-camX,dyCam=(H/2-yy-.5)/qs-camY,dzCam=frame.depth[q]-frame.depth[i],length=Math.hypot(dxCam,dyCam,dzCam)
        if(length<=S.ao.radius&&length>1e-6)occlusion+=Math.max(0,(nr*dxCam+nu*dyCam-nt*dzCam-S.ao.bias)/length)*(1-length/S.ao.radius)
      }
      const shade=1-S.ao.strength*Math.min(1,occlusion/(S.ao.radii.length*S.ao.samples)*4),mix=edge?S.outline.strength:0
      surface(index,n,worldAt(frame,i)).forEach((v,k)=>sum[k]+=Math.min(255,v*shade)*(1-mix)+line[k]*mix);alpha++
    }
    const i=(y*width+x)*4;sum.forEach((v,k)=>frame.rgba[i+k]=alpha?Math.round(v/alpha):0);frame.rgba[i+3]=Math.round(alpha/(ss*ss)*255)
  }
  return frame
}
export function renderRgba(plan:Plan,options:RenderOptions={}) {const {width,height,rgba}=renderFrame(plan,options);return {width,height,rgba}}
export function renderWithCamera(plan:Plan,options:RenderOptions={}) {const f=renderFrame(plan,options);return {png:encodePng(f.width,f.height,f.rgba),camera:f.camera}}

/** ADE20K palette. Decor classes come from the furniture type; their names are listed in DECOR_SEG_CLASSES. */
export const SEG_CLASSES = {wall:[120,120,120],floor:[80,50,50],ceiling:[120,120,80],window:[230,230,230],door:[8,255,51],
  bed:[204,5,255],cabinet:[224,5,255],table:[255,6,82],chair:[204,70,3],sofa:[11,102,255],shelf:[255,7,71],rug:[255,9,92],armchair:[8,255,214],desk:[10,255,71],
  wardrobe:[7,255,255],bathtub:[102,8,255],box:[0,255,20],sink:[0,163,255],refrigerator:[20,255,0],toilet:[0,255,133],none:[0,0,0]} as const
export type SegClass = keyof typeof SEG_CLASSES
/** Furniture and cabinet classes: gen_score.py leaves their edges out of the structure score. */
export const DECOR_SEG_CLASSES: SegClass[] = ['bed','cabinet','table','chair','sofa','shelf','rug','armchair','desk','wardrobe','bathtub','box','sink','refrigerator','toilet']
function classOf(part:MeshPart):SegClass {
  const decor=decorInfo.get(part);if(decor)return decor.seg
  const kind=part.kind
  if(kind==='ceiling')return 'ceiling'
  if(['floor','platform','slab','stair','plinth'].includes(kind))return 'floor'
  if(['glass','pane','rail'].includes(kind))return 'window'
  if(kind==='leaf')return 'door'
  return 'wall'
}
export function renderKit(plan:Plan,options:RenderOptions={}) {
  const passes=options.passes??['clay']
  if(!passes.length||passes.some(p=>!['clay','depth','lines','seg','openings'].includes(p)))throw new Error('passes 只支持 clay,depth,lines,seg,openings')
  const f=renderFrame(plan,options),{width,height,W,H,ss}=f,N=width*height
  const files:Record<string,Uint8Array>={},sample=new Int32Array(N).fill(-1),mm=new Uint16Array(N)
  let min=Infinity,max=0
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const i=y*width+x;let best=Infinity
    for(let sy=0;sy<ss;sy++)for(let sx=0;sx<ss;sx++){const j=(y*ss+sy)*W+x*ss+sx;if(f.depth[j]<best){best=f.depth[j];sample[i]=j}}
    if(Number.isFinite(best)){mm[i]=Math.max(1,Math.min(65535,Math.round(best*1000)));min=Math.min(min,best*1000);max=Math.max(max,best*1000)}
  }
  const pixels=(fn:(i:number)=>readonly number[])=>{const data=new Uint8Array(N*4);for(let i=0;i<N;i++){const v=fn(i);data.set([v[0],v[1]??v[0],v[2]??v[0],255],i*4)}return encodePng(width,height,data)}
  if(passes.includes('clay'))files['clay.png']=encodePng(width,height,f.rgba)
  if(passes.includes('depth')) {
    let invMin=Infinity,invMax=0
    for(const d of mm)if(d){invMin=Math.min(invMin,1/d);invMax=Math.max(invMax,1/d)}
    files['depth16.png']=encodeGray16(width,height,mm)
    files['depth-inv.png']=pixels(i=>[mm[i]?invMax===invMin?255:Math.round(255*(1/mm[i]-invMin)/(invMax-invMin)):0])
    files['depth.png']=files['depth-inv.png']
    files['raw-depthmm.png']=pixels(i=>[mm[i]>>8,mm[i]&255,0])
  }
  if(passes.includes('lines')) {
    const ink=new Uint8Array(N),radius=Math.max(1,Math.round(RENDER_STYLE.outline.width*ss))
    for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let sy=0;sy<ss;sy++)for(let sx=0;sx<ss;sx++) {
      const i=(y*ss+sy)*W+x*ss+sx
      if([[-radius,0],[radius,0],[0,-radius],[0,radius]].some(([dx,dy])=>edgeAt(f,i,dx,dy)))ink[y*width+x]=1
    }
    files['lines.png']=pixels(i=>[ink[i]?0:255]);files['lines-inv.png']=pixels(i=>[ink[i]?255:0])
  }
  // Opening volumes participate only in semantic passes. Real scene depth still occludes them.
  const idAt=new Int32Array(W*H),openingDepth=new Float32Array(W*H).fill(Infinity)
  f.plan.openings.forEach((o,index)=>{
    const wall=f.plan.walls.find(w=>w.id===o.wall);if(!wall)return
    const widened={...f.plan,walls:f.plan.walls.map(w=>w.id===wall.id?{...w,thickness:w.thickness+20}:w)},el=levelOf(f.plan,wall).elevation
    const cap=f.camera.section!==undefined?el+f.camera.section/1000:Infinity
    const proxy=solidMesh({kind:'pane',ids:[o.id],polygons:[[openingFootprint(widened,o)]],z0:el+o.sill,z1:Math.min(el+o.head,cap)})
    rasterPart(f,proxy,(i,z)=>{if(z<=f.depth[i]+.012&&z<openingDepth[i]){openingDepth[i]=z;idAt[i]=index+1}})
  })
  const instance=new Uint16Array(N),counts=new Uint32Array(f.plan.openings.length),boxes=f.plan.openings.map(()=>[width,height,-1,-1])
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    let closest=Infinity,id=0
    for(let sy=0;sy<ss;sy++)for(let sx=0;sx<ss;sx++){const j=(y*ss+sy)*W+x*ss+sx;if(idAt[j]&&openingDepth[j]<closest){id=idAt[j];closest=openingDepth[j]}}
    if(id){instance[y*width+x]=id;counts[id-1]++;const b=boxes[id-1];b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],y)}
  }
  const instances=f.plan.openings.map((o,i)=>({idx:i+1,id:o.id,name:o.name??o.id,kind:o.kind,cls: o.kind.includes('window')||o.kind==='open-balcony'?'window' as const:'door' as const,width_mm:o.width,sill_mm:o.sill*1000,head_mm:o.head*1000,visible_px:counts[i],bbox_xyxy:boxes[i],mask:`opening-${String(i+1).padStart(3,'0')}.png`}))
  f.camera.openings=instances.filter(o=>o.visible_px>0)
  if(passes.includes('openings')) {
    files['openings.png']=encodeGray16(width,height,instance)
    for(const o of instances)files[o.mask]=pixels(i=>[instance[i]===o.idx?255:0])
  }
  if(passes.includes('seg')) {
    files['seg-ade20k.png']=pixels(i=>{
      const opening=instance[i]?instances[instance[i]-1]:undefined,j=sample[i]
      return SEG_CLASSES[opening?.cls??(j<0?'none':classOf(f.parts[f.partAt[j]]))]
    });files['seg.png']=files['seg-ade20k.png']
  }
  const camera={...f.camera,depth:{encoding:'depth16.png：16-bit gray，线性相机 z 毫米；0=无几何；超过65535截断。raw-depthmm.png：R*256+G。depth-inv.png：1/z 单张 min-max 归一化，近白远黑。',min_mm:Number.isFinite(min)?min:0,max_mm:max,clipped:max>65535},segClasses:SEG_CLASSES,segDecorClasses:DECOR_SEG_CLASSES,openingId:'openings.png：16-bit gray = idx，0=无洞口；单扇 opening-NNN.png 为白色可见区域、黑色遮挡/背景；bbox 为闭区间',openingMasks:instances}
  return {files,camera}
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1; return n >>> 0 })
const crc32 = (data: Uint8Array) => { let crc = 0xffffffff; for (const b of data) crc = crcTable[(crc ^ b) & 255] ^ crc >>> 8; return (crc ^ 0xffffffff) >>> 0 }
function pngBytes(width: number, height: number, bytes: Uint8Array, channels: number, bitDepth: number): Uint8Array {
  if (bytes.length !== width * height * channels * bitDepth / 8) throw new Error('像素长度与尺寸不符')
  const stride = width * channels * bitDepth / 8
  const chunk = (type: string, bytes: Uint8Array) => {
    const out = Buffer.alloc(bytes.length + 12); out.writeUInt32BE(bytes.length, 0); out.write(type, 4, 4, 'ascii'); out.set(bytes, 8); out.writeUInt32BE(crc32(out.subarray(4, bytes.length + 8)), bytes.length + 8); return out
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = bitDepth; header[9] = channels === 4 ? 6 : 0
  const scanlines = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) scanlines.set(bytes.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('sRGB', Uint8Array.of(0)), chunk('IDAT', deflateSync(scanlines, { level: 9 })), chunk('IEND', new Uint8Array())])
}
export function renderPng(plan: Plan, options: RenderOptions = {}): Uint8Array { const image = renderRgba(plan, options); return encodePng(image.width, image.height, image.rgba) }

export function encodePng(width:number,height:number,rgba:Uint8Array):Uint8Array { return pngBytes(width,height,rgba,4,8) }
export function encodeGray16(width:number,height:number,values:Uint16Array):Uint8Array {
  const bytes=Buffer.alloc(values.length*2);values.forEach((v,i)=>bytes.writeUInt16BE(v,i*2));return pngBytes(width,height,bytes,1,16)
}
