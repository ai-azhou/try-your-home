/**
 * 3D 结构查看：白模 + 墙顶切面上色（或纯白模）+ 顶面轮廓 + 热点。
 * 几何：core buildSolids → three/geometry mergeByKind / solidToGeometry，门窗扇来自 core buildFixtures（见 ./pieces）。
 * 点选：射线命中点换回平面坐标（x·1000, z·1000）调 core hitTest；选中 / 悬停单独生成该构件的实体叠一层。
 */
import { memo, useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { ContactShadows, OrbitControls } from '@react-three/drei'
import { Pin, Projector } from './Overlay3D'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { CircleQuestionMark, Lock, Sparkles } from 'lucide-react'
import type { Opening, Plan, Question, Room, Vec2 } from '@/core/types'
import { PROTECTED_KINDS } from '@/core/types'
import { hitTest, hitTestExtra, labelPoint, planBounds, pointAt, pointInPolygon, roomCeiling, sliceWall, wallFootprint, wallLength, wallNormal } from '@/core/geometry'
import { levelCeiling, levelOf, levelsOf, onLevel } from '@/core/levels'
import { curLevelId, isMultiLevel } from '@/ui/levels-ui'
import { getView, useStore, useView, type Cam, type Ref } from '@/ui/store'
import { Hotspot } from '@/ui/kit'
import { spanOf } from '@/ui/geom'
import { freeRect, rectToInsets, useIsMobile } from '@/ui/layout'
import { buildPieces, elementGeometries, mergedPieces, plinthGeometry, prism, type Piece } from './pieces'
import { buildDecorSolids, decorWallSolids, sectionAt, type DecorSolid } from '@/core/decor/solids'
import { materialOf, resolveFinish } from '@/core/decor/surfaces'
import { STYLE_PRESETS } from '@/core/decor/presets'
import { CAP, FLAT_TOP, SECTION_Z, capGeometry, flatMat, floorMat, paintWalls, wallSkinMeshes, tone3d, vertexColorMat, wallFaceTable } from './decor3d'
import type { Solid } from '@/core/solids'
import { mergeByKind } from './geometry'
import { useDecor } from '@/ui/decor/dstore'
import { openCabinetAt, openElevAt, selKey as selKey3, tempDecor, useShownDecor } from '@/ui/decor/model'
import type { DSel } from '@/ui/decor/dstore'
import { faceOfWallHit, pickDecorItem } from './decor-pick'
import { DecorHighlight3D, DecorSpotLayer, DecorSpotProjector } from './DecorOverlay3D'
import { mats } from './materials'
import { applyAOField } from './ao'
import { solidToGeometry } from './geometry'
import { unionPolygons } from '@/core/solids'

const M = (v: number) => v / 1000
/** 构件所在楼层的楼面标高（m）；单层方案为 0 */
const elev = (plan: Plan, e: { level?: string } | Opening) => levelOf(plan, e).elevation

/** 3D 显示的方案：默认全部楼层上下叠放；「3D 只看这一层」时是当前层的只读视图（core onLevel，标高保留） */
let plan3dCache: { plan: Plan | null; key: string; out: Plan | null } = { plan: null, key: '', out: null }
function plan3dOf(plan: Plan, solo: boolean, level: string | null): Plan {
  if (!solo || !isMultiLevel(plan)) return plan
  const id = curLevelId(plan, level)
  if (plan3dCache.plan !== plan || plan3dCache.key !== id) plan3dCache = { plan, key: id, out: onLevel(plan, id) }
  return plan3dCache.out!
}
export function usePlan3d(): Plan | null {
  const view = useView(), solo = useStore(s => s.solo3d), level = useStore(s => s.level)
  return useMemo(() => view ? plan3dOf(view.plan, solo, level) : null, [view, solo, level])
}

/** 白模开关：结构态看 store.style3d；装修态有自己的「平涂 / 白模」（默认平涂） */
export function useClay() {
  const st = useStore(s => s.style3d), mode = useStore(s => s.mode), look = useDecor(s => s.look3d)
  return mode === 'decor' ? look === 'clay' : st === 'clay'
}
export function Scene3D({ mini }: { mini?: boolean }) {
  const view = useView()
  const select = useStore(s => s.select)
  const clay = useClay()
  const down = useRef<[number, number] | null>(null)
  if (!view) return null
  return (
    <div className="absolute inset-0" data-canvas3d={mini ? 'mini' : 'main'} onPointerDown={e => { down.current = [e.clientX, e.clientY] }}>
      <Canvas
        shadows="percentage"
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true, toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 0.92 }}
        camera={{ fov: 26, near: 0.1, far: 400, position: [8, 14, 18] }}
        onPointerMissed={e => {
          const d = down.current
          if (d && Math.hypot(e.clientX - d[0], e.clientY - d[1]) < 5) { select(null); if (useStore.getState().mode === 'decor' && !mini) useDecor.getState().select(null) }
        }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <Env clay={clay} />
        <Lights plan={view.plan} clay={clay} />
        <Model mini={mini} />
        <SectionClip mini={mini} />
        <CameraRig plan={view.plan} mini={mini} />
        {!mini && <SpotProjector />}
        {!mini && <DecorSpotProjector />}
        {!mini && <ExportBridge />}
      </Canvas>
      {!mini && !clay && <SpotLayer />}
      {!mini && <DecorSpotLayer />}
    </div>
  )
}
/** 天光：three 自带的 RoomEnvironment（不联网）。只当柔和的环境光和玻璃反射用，强度压低，体积靠主光和 AO 出 */
function Env({ clay }: { clay: boolean }) {
  const { gl, scene } = useThree()
  useEffect(() => {
    const pm = new THREE.PMREMGenerator(gl)
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = env
    return () => { env.dispose(); pm.dispose(); scene.environment = null }
  }, [gl, scene])
  useEffect(() => { scene.environmentIntensity = clay ? 0.36 : 0.42 }, [scene, clay])
  return null
}

/**
 * 灯（design.md §6）：半球天光（天白 / 地冷灰）+ 一盏带软阴影的主光 + 一盏很弱的冷色回光。
 * 主光从相机左前上方来（斜视时朝向相机的面亮、朝右的面暗一档、顶面最亮——参考图 2 的三段明度），
 * 影子落向右后方，房间里靠南墙的地面有一道影子，读得出墙高。
 */
function Lights({ plan, clay }: { plan: Plan; clay: boolean }) {
  const bb = planBounds(plan) ?? [0, 0, 10000, 10000]
  const cx = M(bb[0] + bb[2]) / 2, cz = M(bb[1] + bb[3]) / 2, r = Math.max(M(bb[2] - bb[0]), M(bb[3] - bb[1])) * 0.62 + 1.6
  const light = useRef<THREE.DirectionalLight>(null)
  // 方向：水平从 +z（南）往 −x（西）偏 58°，仰角 66°：影子落向东北，斜视时看得到墙东侧地面上的一道影子，但不会把整间房罩暗
  const az = THREE.MathUtils.degToRad(-58), el = THREE.MathUtils.degToRad(66), D = 24
  const pos: [number, number, number] = [cx + Math.sin(az) * Math.cos(el) * D, Math.sin(el) * D, cz + Math.cos(az) * Math.cos(el) * D]
  useEffect(() => {
    const l = light.current
    if (!l) return
    l.target.position.set(cx, 0, cz); l.target.updateMatrixWorld()
    const c = l.shadow.camera
    c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 4; c.far = 48
    c.updateProjectionMatrix()
    l.shadow.needsUpdate = true
  }, [cx, cz, r])
  return (
    <>
      <hemisphereLight args={['#ffffff', clay ? '#c4c7ce' : '#cdd2da', clay ? 1.0 : 0.95]} />
      <directionalLight ref={light} position={pos} intensity={clay ? 1.05 : 1.05} color="#fff8ef"
        castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0003} shadow-normalBias={0.02} shadow-radius={7} shadow-intensity={clay ? 0.55 : 0.5}
        shadow-camera-left={-r} shadow-camera-right={r} shadow-camera-top={r} shadow-camera-bottom={-r} shadow-camera-near={4} shadow-camera-far={48} />
      <directionalLight position={[cx + 12, 7, cz + 6]} intensity={clay ? 0.22 : 0.22} color="#e8eeff" />
    </>
  )
}

/* ───────── 模型 ───────── */
/** 射线命中点 → 平面坐标 → core hitTest。types 限定这块网格可能是哪类构件（地面只认房间，梁只认梁）；多层时按命中点高度定楼层 */
function pickAt(point: THREE.Vector3, types: Ref['type'][]): Ref | null {
  const v = getView()
  if (!v) return null
  const st = useStore.getState(), full = plan3dOf(v.plan, st.solo3d, st.level)
  const p: Vec2 = [point.x * 1000, point.z * 1000]
  const extra = types.filter(t => t === 'column' || t === 'shaft' || t === 'stair' || t === 'void')
  if (extra.length) {
    const hit = hitTestExtra({ ...full, ...(extra.includes('column') ? {} : { columns: [] }), ...(extra.includes('shaft') ? {} : { shafts: [] }), ...(extra.includes('stair') ? {} : { stairs: [] }), ...(extra.includes('void') ? {} : { voids: [] }) }, p, 80)
    if (hit) return hit
  }
  const lv = [...levelsOf(full)].sort((a, b) => a.elevation - b.elevation).filter(l => l.elevation <= point.y + 0.05).pop() ?? levelsOf(full)[0]
  const plan = isMultiLevel(full) ? onLevel(full, lv.id) : full
  const sub: Plan = { ...plan, walls: types.includes('wall') || types.includes('opening') ? plan.walls : [], openings: types.includes('opening') ? plan.openings : [], beams: types.includes('beam') ? plan.beams : [], rooms: types.includes('room') ? plan.rooms : [] }
  const r = hitTest(sub, p, 80)
  if (r && (types.includes(r.type))) return r
  if (v.diff && useStore.getState().mode === 'compare') {
    const removed = new Set(v.diff.removed.map(x => x.id))
    return hitTest({ ...v.base, walls: v.base.walls.filter(w => removed.has(w.id)), openings: v.base.openings.filter(o => removed.has(o.id)), beams: [], rooms: [] }, p, 80)
  }
  return null
}
const PICK: Record<string, Ref['type'][]> = { wall: ['opening', 'wall'], sill: ['opening', 'wall'], lintel: ['opening', 'wall'], glass: ['opening', 'wall'], beam: ['beam'], floor: ['room'], platform: ['room'], slab: ['room'], leaf: ['opening'], pane: ['opening'], rail: ['opening'], column: ['column'], shaft: ['shaft'], stair: ['stair'] }

/** 电视（放进电视位的家电）：白模里唯一的深色块，看得出「洞里放着东西」 */
const TV_MAT = new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.4, metalness: 0.1 })
const Model = memo(function Model({ mini }: { mini?: boolean }) {
  const view = useView()!
  const mode = useStore(s => s.mode), sel = useStore(s => s.sel), hover = useStore(s => s.hover), layers = useStore(s => s.layers), cam = useStore(s => s.cam)
  const clay = useClay()
  const { select, setHover } = useStore.getState()
  const { base, diff } = view
  const plan = usePlan3d()!
  const compare = mode === 'compare' && !!diff
  // 平视剖切：装修态对准某处（探针 / 对着这面墙看）时，按那个机位的方位剖掉朝相机的外墙
  // 对准期间相机不看 store.cam（视角按钮都不亮），按斜视处理：不剖墙
  const aiming = useDecor(s => !!s.probe) && mode === 'decor' && !mini
  const cut = useMemo(() => cutawayWalls(plan, aiming ? 'iso' : cam), [plan, cam, aiming])
  // 装修态（docs/decor 探针 P1–P3 → D5 正式）：core buildDecorSolids——柜体板件、造型、挖洞、家具盒子；
  // 有嵌入的墙给替换实体（墙体真的变薄），只藏 core 列出的那几面（hideWallIds），其余墙照常按墙分组上色、剖切、点选
  // 没有装修层时悬停风格：画 core createDecor 临时生成的一份（不写进数据，D6 A1）
  const decor = useShownDecor()
  const decorSolids = useMemo((): (DecorSolid[] & { hideWallIds?: string[] }) => {
    if (mode !== 'decor' || !decor) return []
    try { return buildDecorSolids({ ...plan, decor }) } catch (e) { console.warn('buildDecorSolids', e); return [] }
  }, [mode, decor, plan])
  const hidden = useMemo(() => new Set(decorSolids.hideWallIds ?? []), [decorSolids])
  const pieces = useMemo(() => buildPieces(plan, id => hidden.has(id) ? 'hidden' : cut.has(id) ? 'cut' : compare ? (diff!.added.has(id) ? 'added' : 'muted') : 'base'), [plan, cut, compare, diff, hidden])
  useEffect(() => () => pieces.forEach(p => p.geo.dispose()), [pieces])
  const plinth = useMemo(() => plinthGeometry(plan), [plan])
  useMemo(() => applyAOField(plan), [plan])
  const ghosts = useMemo(() => {
    if (!compare || clay) return []
    const out: { key: string; geo: THREE.BufferGeometry }[] = []
    const removedWalls = diff!.removed.filter(r => r.type === 'wall').map(r => r.id)
    const ghostPlan = { ...base, walls: base.walls.filter(w => removedWalls.includes(w.id)), openings: [], beams: [] }
    removedWalls.forEach(id => elementGeometries(ghostPlan, { type: 'wall', id }).forEach((geo, i) => out.push({ key: `gw-${id}-${i}`, geo })))
    for (const r of diff!.removed.filter(r => r.type === 'opening')) {
      const o = base.openings.find(o => o.id === r.id), w = o && plan.walls.find(w => w.id === o.wall)
      if (o && w) out.push({ key: 'go-' + o.id, geo: prism(wallFootprint(sliceWall({ ...w, thickness: w.thickness + 50 }, o.offset, o.offset + o.width)), elev(plan, w), elev(plan, w) + o.head) })
    }
    return out
  }, [compare, clay, diff, base, plan])
  const proposals = useMemo(() => {
    if (mode === 'original' || !diff || clay) return []
    return diff.pending.filter(c => c.op === 'add' && c.type === 'opening').map(c => {
      const o = c.data as unknown as Opening, s = spanOf(plan, o)
      return s ? { key: 'pp-' + c.id, geo: prism(wallFootprint(sliceWall({ ...s.wall, thickness: s.wall.thickness + 60 }, o.offset, o.offset + o.width)), elev(plan, s.wall), elev(plan, s.wall) + o.head) } : null
    }).filter(Boolean) as { key: string; geo: THREE.BufferGeometry }[]
  }, [mode, diff, plan, clay])
  // 选中 / 悬停：单独生成该构件的实体叠一层（不给合并几何换材质）；被替换的墙用替换实体（凹槽不被高亮层堵上）
  const selKey = sel.map(r => r.type + r.id).join(',')
  const repGeos = (id: string) => decorSolids.filter(s => s.replaces && s.ids.includes(id)).map(s => solidToGeometry({ ...s, kind: s.replaces! } as Solid))
  const highlights = useMemo(() => {
    if (clay) return []
    const ghostPlan = compare ? { ...base, walls: base.walls, openings: base.openings } : plan
    return sel.flatMap(r => (r.type === 'wall' && hidden.has(r.id) ? repGeos(r.id) : plan === ghostPlan || r.type !== 'wall' || plan.walls.some(w => w.id === r.id) ? elementGeometries(plan, r) : elementGeometries(ghostPlan, r)).map((geo, i) => ({ key: `sel-${r.id}-${i}`, ref: r, geo })))
  }, [selKey, plan, clay, hidden, decorSolids])
  const hoverGeo = useMemo(() => (!mini && !clay && hover && !sel.some(s => s.id === hover.id) ? (hover.type === 'wall' && hidden.has(hover.id) ? repGeos(hover.id) : elementGeometries(plan, hover)) : []), [hover?.id, plan, mini, clay, selKey, hidden, decorSolids])
  const m = mats()
  // 平涂（装修态默认）：墙面、地面按 core 材料铺平涂色；风格悬停预览时跟着预览
  const preview = useDecor(s => s.preview), keepOv = useDecor(s => s.keepOverrides)
  const flat = mode === 'decor' && !clay && !!decor
  const styleId = preview ?? decor?.style ?? 'cream', keep = preview ? keepOv : true
  const faces = useMemo(() => flat ? wallFaceTable(plan, decor!, styleId, keep) : null, [flat, plan, decor, styleId, keep])
  const decorPieces = useMemo(() => {
    if (!decorSolids.length) return { rep: [] as Piece[], items: [] as { key: string; kind: string; material?: string; geo: THREE.BufferGeometry }[] }
    // 替换墙跟原墙同一个显示分组（平视剖切的那几面照样剖）
    const repSolids = decorSolids.filter(s => s.replaces).map(s => ({ ...s, kind: s.replaces! }) as Solid)
    const rep = [...mergedPieces(repSolids.filter(s => !s.ids.some(id => cut.has(id))), 'base'), ...mergedPieces(repSolids.filter(s => s.ids.some(id => cut.has(id))), 'cut')].map(p => ({ ...p, key: 'rep:' + p.key }))
    const tv = new Set((decor?.furniture ?? []).filter(f => f.type === 'tv').map(f => f.id))
    const rug = new Set((decor?.furniture ?? []).filter(f => f.type === 'rug').map(f => f.id))
    // 平涂下按材料分组（柜体、造型各用自己的材料色）；白模下只按类型
    const keyed = decorSolids.filter(s => !s.replaces).map(s => {
      const k = s.kind === 'decor-furniture' ? (s.ids.some(id => tv.has(id)) ? 'decor-tv' : s.ids.some(id => rug.has(id)) ? 'decor-rug' : 'decor-furniture') : s.kind
      return { s, k: flat && !['decor-tv', 'decor-furniture', 'decor-rug'].includes(k) ? `${k}|${s.material ?? ''}` : k }
    })
    const items: { key: string; kind: string; material?: string; geo: THREE.BufferGeometry }[] = []
    for (const key of [...new Set(keyed.map(x => x.k))]) {
      const list = keyed.filter(x => x.k === key).map(x => ({ ...x.s, kind: 'decor' }) as unknown as Solid)
      const geo = mergeByKind(list)['decor' as never] as THREE.BufferGeometry | undefined
      if (geo) items.push({ key: 'dx-' + key, kind: key.split('|')[0], material: key.split('|')[1] || undefined, geo })
    }
    return { rep, items }
  }, [decorSolids, decor, flat, cut])
  useEffect(() => () => { decorPieces.rep.forEach(p => p.geo.dispose()); decorPieces.items.forEach(p => p.geo.dispose()) }, [decorPieces])
  // 平涂：墙体几何加顶点色（每个三角形查它在哪面墙面上）
  const painted = useMemo(() => {
    const out = new Map<string, THREE.BufferGeometry>()
    if (!faces) return out
    for (const p of [...pieces, ...decorPieces.rep]) if ((p.kind === 'wall' || p.kind === 'sill' || p.kind === 'lintel' || p.kind === 'column' || p.kind === 'shaft') && p.group !== 'hidden') out.set(p.key, paintWalls(p.geo, faces, FLAT_TOP[p.wallKind ?? 'partition']))
    return out
  }, [faces, pieces, decorPieces])
  useEffect(() => () => painted.forEach(g => g.dispose()), [painted])
  // e2e：装修 3D 的实体、藏了哪几面墙、平涂 / 白模（只读）
  // e2e：某件装修构件在 3D 里的中心（世界坐标，米）
  useEffect(() => {
    if (mini) return
    Object.assign(window, { __itemCenter3d: (id: string) => {
      const ss = decorSolids.filter(x => x.ids.includes(id) && !x.replaces)
      const pts = ss.flatMap(x => x.polygons.flatMap(r => r[0]))
      if (!pts.length) return null
      const z0 = Math.min(...ss.map(x => x.z0)), z1 = Math.max(...ss.map(x => x.z1))
      return [pts.reduce((a, q) => a + q[0], 0) / pts.length / 1000, (z0 + z1) / 2, pts.reduce((a, q) => a + q[1], 0) / pts.length / 1000]
    } })
  }, [decorSolids, mini])
  useEffect(() => { if (!mini) Object.assign(window, { __fixtures3d: pieces.filter(p => p.group === 'fixture').map(p => ({ kind: p.kind, ids: p.ids, key: p.key })) }) }, [pieces, mini])
  useEffect(() => { if (!mini) Object.assign(window, { __decorSolids: decorSolids.map(s => ({ kind: s.kind, ids: s.ids, z0: s.z0, z1: s.z1, replaces: s.replaces })), __decor3d: { hide: [...hidden], hiddenPieces: pieces.filter(p => p.group === 'hidden').length, wallPieces: pieces.filter(p => p.kind === 'wall' && p.group !== 'hidden').length, flat, painted: painted.size, look: clay ? 'clay' : flat ? 'flat' : 'struct', preview: !useStore.getState().base?.decor && !!decor } }) }, [decorSolids, mini, hidden, pieces, flat, painted, clay, decor])
  // 平涂墙面：core wallSkins 一整张连续的面（D6），不再按墙段一段段铺
  const skins = useMemo(() => flat ? wallSkinMeshes(plan, decor!, styleId, keep) : [], [flat, plan, decor, styleId, keep])
  useEffect(() => () => skins.forEach(s => s.geo.dispose()), [skins])
  useEffect(() => { if (!mini) Object.assign(window, { __wallSkins: skins.map(k => ({ wall: k.wall, side: k.side, room: k.room, color: k.color })) }) }, [skins, mini])
  const floorOf = useMemo(() => {
    const mm = new Map<string, THREE.Material>()
    if (!flat) return mm
    for (const r of plan.rooms) try { mm.set(r.id, floorMat(resolveFinish({ ...plan, decor: decor! }, { floor: r.id }, { styleId, keep, room: r }).material)) } catch { /* */ }
    return mm
  }, [flat, plan, decor, styleId, keep])
  // e2e：探针实体的件数（只读）


  const matFor = (p: Piece): THREE.Material | THREE.Material[] => {
    const wk = p.wallKind ?? 'partition', muted = p.group === 'muted', added = p.group === 'added'
    if (clay) {
      switch (p.kind) {
        case 'wall': case 'sill': case 'lintel': return [m.clay3.top, m.clay3.wall]
        case 'glass': case 'pane': return m.clay3.glass
        case 'floor': return m.clay3.floor
        case 'platform': return m.clay3.platform
        case 'beam': return m.clay3.beam
        case 'slab': return m.clay3.floor
        case 'stair': return m.clay3.platform
        case 'column': case 'shaft': return [m.clay3.top, m.clay3.wall]
        case 'leaf': return m.clay3.leaf
        case 'rail': return m.clay3.frame
        default: return m.clay3.wall
      }
    }
    if (p.group === 'cut' && (p.kind === 'wall' || p.kind === 'lintel' || p.kind === 'sill')) return m.cutaway
    if (flat) {
      if (painted.has(p.key)) return vertexColorMat()
      if ((p.kind === 'floor' || p.kind === 'platform') && floorOf.has(p.ids[0])) return floorOf.get(p.ids[0])!
      switch (p.kind) {
        // 平涂下玻璃用白模那种极淡的冷白：结构态的天青在大面积玻璃隔断上太抢，压过了材料
        case 'glass': case 'pane': return m.clay3.glass
        case 'beam': return m.clay3.beam
        case 'leaf': return m.clay3.leaf
        case 'rail': return m.clay3.frame
        case 'slab': case 'stair': return m.clay3.platform
      }
    }
    switch (p.kind) {
      case 'wall': case 'sill': case 'lintel':
        if (added) return [m.addedTop, m.added]
        if (muted) return [m.topMuted[wk], m.clayMuted]
        return [m.top[wk], m.clay]
      case 'glass': return added ? m.addedGlass : m.glass
      case 'floor': return compare && diff!.modified.has(p.ids[0]) ? m.modFloor : m.floor
      case 'platform': return m.platform
      case 'slab': return m.floor
      case 'stair': return m.platform
      // 柱顶按承重 / 装饰上色（同一张合并几何里分不开，承重最常见，统一墨色斜线）；管道井顶用外墙的石板灰
      case 'column': return [m.top.bearing, m.clay]
      case 'shaft': return [m.top.exterior, m.clay]
      case 'beam': return m.beam
      case 'leaf': return compare && diff!.added.has(p.ids[0]) ? m.added : m.leaf
      case 'rail': return m.frame
      case 'pane': return m.pane
      default: return m.clay
    }
  }
  // 装修态 3D（D6 B6）：点到什么就出那张装修卡（useDecor.sel，和平面同一套）；双击墙面进立面、双击柜子进柜体编辑
  const dmode3d = mode === 'decor' && !mini
  const decorPick = (e: ThreeEvent<MouseEvent | PointerEvent>, types: Ref['type'][]): DSel | null => {
    const n = e.face ? e.face.normal.clone().transformDirection(e.object.matrixWorld) : null
    const d = decor ?? tempDecor()
    const it = pickDecorItem(plan, d, decorSolids, e.point, n)
    if (it) return it
    const ref = pickAt(e.point, types)
    const wallId = ref?.type === 'wall' ? ref.id : ref?.type === 'opening' ? plan.openings.find(o => o.id === ref.id)?.wall : undefined
    if (wallId) return faceOfWallHit(plan, wallId, e.point, n)
    if (ref?.type === 'room') return { k: 'floor', id: ref.id }
    return null
  }
  const onClick = (types: Ref['type'][]) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (e.delta > 5) return
    if (dmode3d) { select(null); useDecor.getState().select(decorPick(e, types)); return }
    select(pickAt(e.point, types), e.nativeEvent.shiftKey)
  }
  const onDouble = (types: Ref['type'][]) => (e: ThreeEvent<MouseEvent>) => {
    if (!dmode3d) return
    e.stopPropagation()
    const hit = decorPick(e, types), d = decor ?? tempDecor()
    if (hit?.k === 'face') { useStore.getState().setMain('2d'); openElevAt(hit.face, { s: hit.s }) }
    else if (hit?.k === 'cabinet') { const c = d.cabinets.find(x => x.id === hit.id); if (c && 'face' in c.place) { useStore.getState().setMain('2d'); openCabinetAt(c.id, c.place.face) } }
    else if (hit?.k === 'panel') { const pn = d.panels.find(x => x.id === hit.id); if (pn?.span) { useStore.getState().setMain('2d'); openElevAt(pn.span.face, { item: pn.id }); useDecor.getState().select(hit) } }
  }
  const onMove = (types: Ref['type'][]) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    if (mini) return
    if (dmode3d) { const h = decorPick(e, types), cur = useDecor.getState().hover; if (selKey3(h) !== selKey3(cur)) useDecor.getState().set({ hover: h }); return }
    if (!clay) setHover(pickAt(e.point, types))
  }
  const onOut = () => { if (mini) return; if (dmode3d) useDecor.getState().set({ hover: null }); else setHover(null) }
  const edgeMat = (p: Piece) => p.kind === 'glass' ? m.edgeGlass : p.group === 'cut' ? m.edgeCut : m.edge
  // 白模 + 平视：朝相机一侧的外墙直接不画（剖切模型），不留半透明的幽灵墙——导出给生图模型时形体要干净
  // 白模：各房间的地面并成一整块（相邻房间的地面接缝在白模里是一道道细线，喂给生图模型像地砖缝）
  const clayFloor = useMemo(() => {
    if (!clay) return null
    try {
      // 只并第一层的地面（上层地面是 core 的楼板 slab，标高不同）
      const first = levelsOf(plan)[0].id
      const polys = unionPolygons(plan.rooms.filter(r => r.poly.length >= 3 && levelOf(plan, r).id === first && !(r.floorOffset && r.floorOffset < 0)).map(r => [r.poly]))
      return polys.length ? solidToGeometry({ kind: 'floor', polygons: polys, z0: -0.08, z1: 0, ids: [] }) : null
    } catch { return null }
  }, [clay, plan])
  useEffect(() => () => clayFloor?.dispose(), [clayFloor])
  const cutOpenings = useMemo(() => new Set(plan.openings.filter(o => cut.has(o.wall)).map(o => o.id)), [plan, cut])
  const shown0 = pieces.filter(p => p.group !== 'hidden')
  // 白模、平涂下平视剖切都直接不画朝相机的外墙（不留半透明幽灵墙，形体干净）
  const shown = clay || flat ? shown0.filter(p => (p.group !== 'cut' || p.kind === 'floor' || p.kind === 'platform') && !(p.group === 'fixture' && p.ids.some(id => cutOpenings.has(id))) && !(clayFloor && p.kind === 'floor')) : shown0

  return (
    <group>
      {plinth && <mesh geometry={plinth} material={clay ? m.clay3.plinth : m.plinth} receiveShadow raycast={() => null} userData={{ fit: true }} />}
      <ContactShadows position={[0, -0.074, 0]} scale={80} blur={2.2} far={4} opacity={clay ? 0.26 : 0.3} resolution={1024} frames={1} color="#1c2032" key={'c' + plan.walls.length + ':' + plan.rooms.length + clay} />
      {/* 底板落在桌面上的影子：在底板下面再取一次，模型像放在桌上而不是飘着 */}
      {plinth && <PlinthShadow plan={plan} clay={clay} />}
      {clayFloor && <mesh geometry={clayFloor} material={m.clay3.floor} receiveShadow userData={{ fit: true }} onClick={onClick(['room'])} />}
      {shown.map(p => (
        <group key={p.key}>
          {/* 梁不投影：俯视时梁的影子在地面上是一道道灰带，和墙影混在一起读不清；梁本身看得见 */}
          <mesh geometry={painted.get(p.key) ?? p.geo} material={matFor(p)} castShadow={p.kind !== 'glass' && p.kind !== 'pane' && p.kind !== 'beam'} receiveShadow userData={{ fit: true }}
            onClick={onClick(PICK[p.kind] ?? ['wall'])} onDoubleClick={onDouble(PICK[p.kind] ?? ['wall'])} onPointerMove={onMove(PICK[p.kind] ?? ['wall'])} onPointerOut={onOut}
            renderOrder={p.kind === 'glass' || p.kind === 'pane' ? 2 : 0} />
          {!clay && (p.kind === 'wall' || p.kind === 'lintel' || p.kind === 'sill' || p.kind === 'beam' || p.kind === 'platform' || p.kind === 'glass' || p.kind === 'pane' || p.kind === 'stair' || p.kind === 'column' || p.kind === 'shaft' || p.kind === 'slab') && <Edges geo={p.geo} mat={edgeMat(p)} />}
        </group>
      ))}
      {decorPieces.rep.filter(p => !((clay || flat) && p.group === 'cut')).map(p => (
        <group key={p.key}>
          <mesh geometry={painted.get(p.key) ?? p.geo} material={matFor(p)} castShadow receiveShadow userData={{ fit: true }} onClick={onClick(PICK[p.kind] ?? ['wall'])} onDoubleClick={onDouble(PICK[p.kind] ?? ['wall'])} onPointerMove={onMove(PICK[p.kind] ?? ['wall'])} onPointerOut={onOut} />
          {!clay && <Edges geo={p.geo} mat={edgeMat(p)} />}
        </group>
      ))}
      {decorPieces.items.map(p => (
        <group key={p.key} userData={{ decor: p.kind }}>
          <mesh geometry={p.geo} material={p.kind === 'decor-tv' ? TV_MAT : p.kind === 'decor-rug' ? (flat ? flatMat(tone3d(materialOf({ ...plan, decor }, styleRoles(decor, styleId)?.rug).color)) : clay ? m.clay3.platform : m.platform) : p.kind === 'decor-furniture' ? (clay ? m.clay3.platform : m.platform) : clay ? m.clay3.wall : flat ? flatMat(tone3d(materialOf({ ...plan, decor }, p.material).color)) : m.clay} castShadow={p.kind !== 'decor-furniture' && p.kind !== 'decor-rug'} receiveShadow userData={{ fit: true }}
            {...(dmode3d ? { onClick: onClick(['wall', 'room']), onDoubleClick: onDouble(['wall', 'room']), onPointerMove: onMove(['wall', 'room']), onPointerOut: onOut } : { raycast: () => null })} />
          {/* 平涂下柜门之间的缝、造型的边靠一层很淡的棱线读出来（D4 P3 坑 4）；白模下不画线 */}
          {!clay && <Edges geo={p.geo} mat={flat && p.kind.startsWith('decor-cabinet') ? m.edgeCab : m.edge} />}
        </group>
      ))}
      {skins.filter(s => !s.wallIds.some(id => cut.has(id))).map(s => <mesh key={s.key} geometry={s.geo} material={flatMat(s.color, { key: 'skin' })} receiveShadow raycast={() => null} />)}
      {mode === 'decor' && !mini && <SectionCaps plan={plan} decorSolids={decorSolids} />}
      {dmode3d && <DecorHighlight3D plan={plan} decor={decor} solids={decorSolids} />}
      {ghosts.map(g => (
        <group key={g.key}>
          <mesh geometry={g.geo} material={m.ghostCoral} renderOrder={3} onClick={onClick(['wall', 'opening'])} />
          <Edges geo={g.geo} mat={m.edgeCoral} />
        </group>
      ))}
      {proposals.map(g => (
        // Agent 待确认的结构提议：界面上照旧画淡紫，导出 PNG（给生图）时当界面层藏掉
        <group key={g.key} userData={{ ui: mode === 'decor' }}>
          {/* 装修态（D6 B5）：只留一圈边线，不铺淡紫体块 */}
          {mode !== 'decor' && <mesh geometry={g.geo} material={m.ghostLav} renderOrder={3} raycast={() => null} />}
          <Edges geo={g.geo} mat={m.edgeLav} />
        </group>
      ))}
      <group userData={{ ui: true }}>
        {highlights.map(h => (
          <group key={h.key}>
            <mesh geometry={h.geo} material={h.ref.type === 'opening' ? m.openGlow : h.ref.type === 'room' ? m.selFloorO : m.selO} raycast={() => null} renderOrder={4} />
            <Edges geo={h.geo} mat={m.edgeSel} />
          </group>
        ))}
        {hoverGeo.map((g, i) => <mesh key={i} geometry={g} material={hover?.type === 'opening' ? m.openGlow : m.hoverO} raycast={() => null} renderOrder={4} />)}
        {layers.ceilings && !clay && plan.rooms.filter(r => !r.floorOffset && (sel.some(s => s.id === r.id) || Math.abs(roomCeiling(plan, r) - levelCeiling(plan, levelOf(plan, r).id)) > 0.005)).map(r => <Ceiling key={r.id} plan={plan} r={r} selected={sel.some(s => s.id === r.id)} />)}
      </group>
    </group>
  )
})

/* ───────── 1.1 m 水平剖切（装修态，白模和平涂都能开） ───────── */
const CLIP = new THREE.Plane(new THREE.Vector3(0, -1, 0), SECTION_Z)
/** 剖切高度：当前楼层标高 + 1.1 m（core sectionAt 的 z 是绝对标高） */
function useSectionZ(plan: Plan | null) {
  const level = useStore(s => s.level)
  return plan ? levelOf(plan, { level: curLevelId(plan, level) }).elevation + SECTION_Z : SECTION_Z
}
function SectionClip({ mini }: { mini?: boolean }) {
  const { gl } = useThree()
  const sec = useDecor(s => s.section3d), mode = useStore(s => s.mode)
  const on = sec && mode === 'decor' && !mini
  const z = useSectionZ(usePlan3d())
  useEffect(() => {
    CLIP.constant = z
    gl.clippingPlanes = on ? [CLIP] : []
    return () => { gl.clippingPlanes = [] }
  }, [gl, on, z])
  return null
}
const capMats = {
  wall: new THREE.MeshBasicMaterial({ color: CAP.wall }), glass: new THREE.MeshBasicMaterial({ color: CAP.glass }),
  decor: new THREE.MeshBasicMaterial({ color: CAP.decor }), furniture: new THREE.MeshBasicMaterial({ color: CAP.furniture }),
  edge: new THREE.LineBasicMaterial({ color: CAP.edge, transparent: true, opacity: 0.55 }),
}
/** 切面盖子：core sectionAt（结构实体用 decorWallSolids——墙上已经扣掉嵌入的凹槽，和平面 embedFootprint 一致） */
function SectionCaps({ plan, decorSolids }: { plan: Plan; decorSolids: DecorSolid[] }) {
  const on = useDecor(s => s.section3d)
  const decor = useStore(s => s.base?.decor)
  const z = useSectionZ(plan)
  const caps = useMemo(() => {
    if (!on || !decor) return []
    try {
      const solids = [...decorWallSolids({ ...plan, decor }), ...decorSolids.filter(s => !s.replaces)]
      return capGeometry(sectionAt(solids, z), z)
    } catch (e) { console.warn('sectionAt', e); return [] }
  }, [on, plan, decor, decorSolids, z])
  useEffect(() => () => caps.forEach(c => c.geo.dispose()), [caps])
  useEffect(() => { (window as unknown as Record<string, unknown>).__sectionCaps = caps.map(c => c.kind) }, [caps])
  return (
    <group userData={{ section: true }}>
      {caps.map(c => (
        <group key={c.kind}>
          <mesh geometry={c.geo} material={capMats[c.kind]} raycast={() => null} renderOrder={1} />
          <Edges geo={c.geo} mat={capMats.edge} />
        </group>
      ))}
    </group>
  )
}

/** 风格的材料角色（风格悬停预览时用预览的那套） */
const styleRoles = (decor: { style: string; presets?: { id: string; roles: Record<string, string | undefined> }[] } | undefined, id: string) => decor?.presets?.find(p => p.id === id)?.roles ?? STYLE_PRESETS.find(p => p.id === id)?.roles
const SOLID_GLASS = new THREE.MeshStandardMaterial({ color: '#dfe2e6', roughness: 0.9, metalness: 0 })
/** 白模导出：当前相机、2 倍像素、不带界面（隐藏 userData.ui 的高亮层），背景纯白或透明 */
function ExportBridge() {
  const { gl, scene, camera, size } = useThree()
  useEffect(() => {
    const on = (e: Event) => {
      const { bg, name, done, glass, aspect } = (e as CustomEvent<{ bg: 'white' | 'transparent'; glass?: 'solid' | 'clear'; aspect?: 'view' | '16:9'; name: string; done(ok: boolean, w: number, h: number): void }>).detail
      const hidden: THREE.Object3D[] = []
      scene.traverse(o => { if (o.userData.ui && o.visible) { o.visible = false; hidden.push(o) } })
      // 透明背景 + 窗户实心浅灰：玻璃、窗扇临时换成不透明浅灰（生图输入的轮廓更干净），导出完换回
      const swapped: [THREE.Mesh, THREE.Material | THREE.Material[]][] = []
      if (glass === 'solid') {
        const m = mats(), glassy = new Set<THREE.Material>([m.glass, m.pane, m.clay3.glass, m.addedGlass])
        scene.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh && !Array.isArray(mesh.material) && glassy.has(mesh.material)) { swapped.push([mesh, mesh.material]); mesh.material = SOLID_GLASS } })
      }
      const prevRatio = gl.getPixelRatio(), prevBg = scene.background, prevClear = gl.getClearAlpha()
      // 界面里相机为了让开浮卡做了画面偏移；导出不带界面，去掉偏移，再按模型的实际轮廓取景（机位、朝向、透视都不变，只是裁到模型）
      const cam = camera as THREE.PerspectiveCamera, view = cam.view ? { ...cam.view } : null
      try {
        if (view?.enabled) { cam.clearViewOffset(); cam.updateProjectionMatrix() }
        // 16:9（给生图模型，画幅不一致容易被重新构图）：取景框按 16:9 补，输出固定 16:9 像素（长边 ≥ 1920）
        const wide = aspect === '16:9', A = 16 / 9
        const crop = wide ? frameModel(scene, cam, size.width, size.height, A, true) ?? centerFrame(size.width, size.height, A) : frameModel(scene, cam, size.width, size.height)
        if (crop) { cam.setViewOffset(size.width, size.height, crop[0], crop[1], crop[2], crop[3]); cam.updateProjectionMatrix() }
        if (wide) {
          const outW = Math.round(Math.min(3840, Math.max(1920, crop![2] * 2)))
          gl.setPixelRatio(1); gl.setSize(outW, Math.round(outW / A), false)
        } else { gl.setPixelRatio(2); gl.setSize(size.width, size.height, false) }
        scene.background = bg === 'white' ? new THREE.Color('#ffffff') : null
        gl.setClearAlpha(bg === 'white' ? 1 : 0)
        gl.render(scene, camera)
        const w = gl.domElement.width, h = gl.domElement.height
        gl.domElement.toBlob(blob => {
          if (blob) {
            const url = URL.createObjectURL(blob), a = document.createElement('a')
            a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
            setTimeout(() => URL.revokeObjectURL(url), 3000)
          }
          done(!!blob, w, h)
        }, 'image/png')
      } finally {
        swapped.forEach(([mesh, mat]) => { mesh.material = mat })
        hidden.forEach(o => { o.visible = true })
        scene.background = prevBg; gl.setClearAlpha(prevClear)
        if (view?.enabled) cam.setViewOffset(view.fullWidth, view.fullHeight, view.offsetX, view.offsetY, view.width, view.height)
        else cam.clearViewOffset()
        cam.updateProjectionMatrix()
        gl.setPixelRatio(prevRatio); gl.setSize(size.width, size.height, false)
      }
    }
    window.addEventListener('export-3d', on)
    // e2e / 演示用：世界坐标（米）→ 屏幕坐标
    const w = window as unknown as Record<string, unknown>
    w.__world2screen = (p: [number, number, number]) => {
      const v = new THREE.Vector3(...p).project(camera), r = gl.domElement.getBoundingClientRect()
      return [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height]
    }
    return () => window.removeEventListener('export-3d', on)
  }, [gl, scene, camera, size.width, size.height])
  return null
}

/**
 * 导出取景：把模型（userData.fit 的网格）所有顶点投到屏幕，取外接框，四周留 7%，补成画面比例。
 * 模型整个在画面里时裁紧（模型居中、占满）；用户放大到只看局部时（外接框超出画面）保持原取景。
 */
function frameModel(scene: THREE.Scene, cam: THREE.PerspectiveCamera, W: number, H: number, aspect = W / H, allowBeyond = false): [number, number, number, number] | null {
  cam.updateMatrixWorld()
  const v = new THREE.Vector3()
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  scene.traverse(o => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !o.userData.fit || !o.visible) return
    const pos = mesh.geometry.getAttribute('position')
    if (!pos) return
    mesh.updateWorldMatrix(true, false)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).project(cam)
      if (v.z > 1) continue
      const sx = (v.x * 0.5 + 0.5) * W, sy = (-v.y * 0.5 + 0.5) * H
      if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy
    }
  })
  if (!isFinite(x0)) return null
  const m = 0.07, A = aspect
  let cw = (x1 - x0) * (1 + 2 * m), ch = (y1 - y0) * (1 + 2 * m)
  if (cw / ch > A) ch = cw / A; else cw = ch * A
  // 画幅和屏幕不同（16:9 而手机是竖屏）时取景框可以超出屏幕：模型完整在框里就行；用户放大到只看局部（模型本身出了屏幕）时不裁
  if (allowBeyond ? x0 < 0 || y0 < 0 || x1 > W || y1 > H : cw >= W || ch >= H) return null
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  return [cx - cw / 2, cy - ch / 2, cw, ch]
}

/** 屏幕中间按画幅取一个框（模型超出屏幕时用：保持用户的取景，只补成 16:9） */
function centerFrame(W: number, H: number, A: number): [number, number, number, number] {
  const cw = W / H > A ? H * A : W, ch = cw / A
  return [(W - cw) / 2, (H - ch) / 2, cw, ch]
}

/** 底板落在桌面上的一圈软影：只取底板附近，范围贴着方案，避免整张图四周发灰 */
function PlinthShadow({ plan, clay }: { plan: Plan; clay: boolean }) {
  const bb = planBounds(plan)!
  const cx = M(bb[0] + bb[2]) / 2, cz = M(bb[1] + bb[3]) / 2, s = Math.max(M(bb[2] - bb[0]), M(bb[3] - bb[1])) + 5
  return <ContactShadows position={[cx, -0.161, cz]} scale={s} blur={1.6} far={0.5} opacity={clay ? 0.3 : 0.26} resolution={512} frames={1} color="#2a2c48" key={'p' + plan.walls.length + ':' + plan.rooms.length + clay} />
}

/**
 * 平视时把朝向相机那一侧的外墙剖掉（结构色 = 半透明，白模 = 不画），才看得到里面的梁、窗台和层高。
 * 「朝相机一侧」= 墙面大致朝相机，且墙外（朝相机方向 25cm）多数位置不在任何房间里——外立面，不论前面有没有阳台凸出去。
 */
function cutawayWalls(plan: Plan, cam: Cam, azDeg?: number): Set<string> {
  const out = new Set<string>()
  if (cam !== 'eye') return out
  const az = THREE.MathUtils.degToRad(azDeg ?? PRESET.eye.az)
  const dir: Vec2 = [Math.sin(az), Math.cos(az)]
  for (const w of plan.walls) {
    const n = wallNormal(w), facing = n[0] * dir[0] + n[1] * dir[1]
    if (Math.abs(facing) < 0.5) continue
    const sgn = Math.sign(facing), L = wallLength(w)
    const outside = [0.2, 0.5, 0.8].filter(f => {
      const q = pointAt(w, L * f), off = w.thickness / 2 + 250
      const s: Vec2 = [q[0] + n[0] * sgn * off, q[1] + n[1] * sgn * off]
      return !plan.rooms.some(r => pointInPolygon(s, r.poly))
    }).length
    if (outside >= 2) out.add(w.id)
  }
  return out
}

function Edges({ geo, mat }: { geo: THREE.BufferGeometry; mat: THREE.LineBasicMaterial }) {
  const e = useMemo(() => new THREE.EdgesGeometry(geo, 28), [geo])
  return <lineSegments geometry={e} material={mat} raycast={() => null} />
}

/** 顶面轮廓：每间房在自己的层高画一圈线 + 极淡的面，层高不同一眼看出高低；梁挂在下面 */
function Ceiling({ plan, r, selected }: { plan: Plan; r: Room; selected: boolean }) {
  const { line, plane } = useMemo(() => {
    const h = roomCeiling(plan, r) + elev(plan, r), pts = r.poly.map(([x, y]) => new THREE.Vector3(M(x), h, M(y)))
    const line = new THREE.BufferGeometry().setFromPoints([...pts, pts[0]])
    const shape = new THREE.Shape(r.poly.map(([x, y]) => new THREE.Vector2(M(x), -M(y))))
    const plane = new THREE.ShapeGeometry(shape)
    plane.rotateX(-Math.PI / 2); plane.translate(0, h, 0)
    return { line, plane }
  }, [plan, r])
  const m = mats()
  return (
    <group>
      {selected && <mesh geometry={plane} material={m.ceilingSel} raycast={() => null} renderOrder={5} />}
      {/* @ts-expect-error three line element */}
      <line geometry={line} material={selected ? m.ceilLineSel : m.ceilLine} raycast={() => null} />
    </group>
  )
}

/* ───────── 相机 ───────── */
const PRESET: Record<Cam, { az: number; el: number; dist: number; ty: number }> = {
  iso: { az: 24, el: 50, dist: 1, ty: 0.6 },
  top: { az: 0, el: 89, dist: 0.95, ty: 0 },
  eye: { az: 14, el: 20, dist: 0.86, ty: 1.2 },
}

function CameraRig({ plan, mini }: { plan: Plan; mini?: boolean }) {
  const mobile = useIsMobile()
  const cam = useStore(s => s.cam), nonce = useStore(s => s.camNonce)
  useStore(s => s.pipShift) // 画中画让位后重新算可用区域
  const { camera, size } = useThree()
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null)
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null)
  const first = useRef(true)
  const probe = useDecor(s => s.probe)
  const mode = useStore(s => s.mode)
  const section = useDecor(s => s.section3d) && mode === 'decor' && !mini
  const bb = probe && mode === 'decor' && !mini ? probe.box : planBounds(plan)
  const key = (bb ? bb.map(v => Math.round(v)).join(',') : '') + ':' + levelsOf(plan).length
  const bbA = bb ? Math.max(0.2, (bb[2] - bb[0]) / Math.max(1, bb[3] - bb[1])) : 1.3
  const pad = mini ? { top: 8, right: 8, bottom: 8, left: 8 } : rectToInsets(freeRect(size.width, size.height, mobile, bbA * 1.25), size.width, size.height)

  useEffect(() => {
    const c = camera as THREE.PerspectiveCamera
    const w = size.width, h = size.height
    if (!w || !h) return
    // 让模型居中在面板没挡住的区域
    c.setViewOffset(w, h, -(pad.left - pad.right) / 2, -(pad.top - pad.bottom) / 2, w, h)
    c.updateProjectionMatrix()
    if (!bb) return
    const focus = probe && mode === 'decor' && !mini
    // 对准某处 + 平视：仰角压到平视（剖掉朝相机的外墙后看进房间）
    // 对准（D6）：只用对准算出来的机位，不看 store.cam；点任一视角会先退出对准（App.tsx 订阅 camNonce），取消对准回到最后选的视角
    const p0 = focus ? { az: probe.az, el: probe.el, dist: 0.86, ty: 1.0 } : PRESET[cam]
    // 1.1 m 剖切打开时相机自动转到偏俯视：切面盖子、嵌墙的缺口要从上往下看
    const p = section ? { ...p0, el: Math.max(p0.el, 62), ty: Math.min(p0.ty, 0.6) } : p0
    const cx = M(bb[0] + bb[2]) / 2, cz = M(bb[1] + bb[3]) / 2
    const bw = M(bb[2] - bb[0]), bh = M(bb[3] - bb[1])
    const aw = Math.max(60, w - pad.left - pad.right), ah = Math.max(60, h - pad.top - pad.bottom)
    // 可用区域对应的视角：竖向按高度比例缩，横向先算整幅横向视角再按宽度比例缩
    const vf = THREE.MathUtils.degToRad(c.fov)
    const hfFull = 2 * Math.atan(Math.tan(vf / 2) * (w / h))
    const fitAngle = Math.min(vf * (ah / h), hfFull * (aw / w))
    // 多层：模型变高，取景半径算上总高度，目标点抬到中间偏下
    const zTop = focus ? 2.4 : isMultiLevel(plan) ? Math.max(...levelsOf(plan).map(l => l.elevation + (l.ceiling ?? plan.ceiling))) : 0
    const R = 0.5 * Math.hypot(bw, bh, zTop) + 0.4
    const dist = (R / Math.sin(fitAngle / 2)) * p.dist * (mini ? 0.9 : 1.0)
    const az = THREE.MathUtils.degToRad(p.az), el = THREE.MathUtils.degToRad(p.el)
    const ty = p.ty + zTop * 0.32
    const target = new THREE.Vector3(cx, ty, cz)
    const pos = new THREE.Vector3(cx + Math.sin(az) * Math.cos(el) * dist, ty + Math.sin(el) * dist, cz + Math.cos(az) * Math.cos(el) * dist)
    if (first.current) {
      camera.position.copy(pos)
      controls.current?.target.copy(target)
      controls.current?.update()
      first.current = false
    } else goal.current = { pos, target }
  }, [cam, nonce, key, size.width, size.height, mini, pad.left, pad.right, pad.top, pad.bottom, probe?.id, probe?.az, probe?.el, section])

  // e2e：相机仰角（度）（只读；世界坐标 → 屏幕坐标用已有的 __world2screen）
  useEffect(() => {
    if (mini) return
    const w = window as unknown as Record<string, unknown>
    w.__cam3d = () => {
      const t = controls.current?.target ?? new THREE.Vector3(), d = camera.position.clone().sub(t)
      return { el: THREE.MathUtils.radToDeg(Math.asin(d.y / Math.max(1e-6, d.length()))), goal: !!goal.current }
    }
  }, [camera, size.width, size.height, mini])

  useFrame((_, dt) => {
    const g = goal.current, ctl = controls.current
    if (!g || !ctl) return
    const f = 1 - Math.exp(-dt * 6.5)
    camera.position.lerp(g.pos, f)
    ctl.target.lerp(g.target, f)
    ctl.update()
    if (camera.position.distanceTo(g.pos) < 0.005) goal.current = null
  })

  return (
    <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12} minPolarAngle={0.02} maxPolarAngle={1.5}
      minDistance={probe && mode === 'decor' ? 1.2 : 2.5} maxDistance={80} screenSpacePanning enablePan={!mini} enableZoom={!mini} rotateSpeed={0.7}
      onStart={() => { goal.current = null }} />
  )
}

/* ───────── 热点（DOM 覆盖层，见 Overlay3D） ───────── */
interface Spot { key: string; pos: [number, number, number]; node: React.ReactNode; pass?: boolean }

function useSpots(): Spot[] {
  const view = useView()
  const mode = useStore(s => s.mode), sel = useStore(s => s.sel), qOpen = useStore(s => s.qOpen), layers = useStore(s => s.layers), hover = useStore(s => s.hover), lang = useStore(s => s.lang)
  const plan3d = usePlan3d()
  const section = useDecor(s => s.section3d) && mode === 'decor'
  if (!view || !plan3d) return []
  const { openQuestion, select } = useStore.getState()
  const { diff } = view, plan = plan3d
  const selIds = new Set(sel.map(s => s.id))
  const out: Spot[] = []
  // 同一处的几个问题（比如两个都问客厅）左右摊开，不叠成一个
  const qs = mode === 'original' ? plan.questions.filter(q => q.bbox && !q.answer) : []
  const spot = (q: Question) => `${Math.round((q.bbox![0] + q.bbox![2]) / 600)}:${Math.round((q.bbox![1] + q.bbox![3]) / 600)}`
  for (const q of qs) {
    const b = q.bbox!, same = qs.filter(o => spot(o) === spot(q)), i = same.indexOf(q)
    const dx = (i - (same.length - 1) / 2) * 46
    out.push({ key: 'q' + q.id, pos: [M(b[0] + b[2]) / 2, 3.25 + elev(plan, q), M(b[1] + b[3]) / 2], node: (
      <div className="flex translate-y-[14px] flex-col items-center" style={{ transform: `translateX(${dx}px)` }}>
        <Hotspot tone="lemon" size={38} active={qOpen === q.id} icon={<CircleQuestionMark size={17} strokeWidth={2.2} />} onClick={() => openQuestion(qOpen === q.id ? null : q.id)} label={q.text} />
        <span className="h-6 w-px bg-gradient-to-b from-ink-900/35 to-transparent" />
      </div>
    ) })
  }
  // 1.1 m 剖切时顶面已经切掉了，层高胶囊不出
  if (layers.ceilings && !section && mode !== 'decor') for (const r of plan.rooms.filter(r => !r.floorOffset && (Math.abs(roomCeiling(plan, r) - levelCeiling(plan, levelOf(plan, r).id)) > 0.005 || selIds.has(r.id)))) {
    const p = labelPoint(r.poly), h = roomCeiling(plan, r)
    out.push({ key: 'c' + r.id, pass: true, pos: [M(p[0]), h + 0.08 + elev(plan, r), M(p[1])], node: (
      <div className={'num whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold shadow-[0_6px_14px_-8px_rgb(0_0_0/0.4)] backdrop-blur-md ' + (selIds.has(r.id) ? 'bg-ink-900 text-white' : 'bg-white/85 text-ink-700 ring-1 ring-ink-900/5')}>
        {r.name} · {h.toFixed(2)} m
      </div>
    ) })
  }
  for (const r of plan.rooms.filter(r => r.floorOffset)) {
    const p = labelPoint(r.poly)
    out.push({ key: 'p' + r.id, pass: true, pos: [M(p[0]), (r.floorOffset ?? 0) + 0.06 + elev(plan, r), M(p[1])], node: (
      <div className="num whitespace-nowrap rounded-full bg-white/85 px-2 py-0.5 text-[10.5px] font-bold text-ink-600 ring-1 ring-ink-900/5 backdrop-blur-md">{r.name} {(r.floorOffset ?? 0) > 0 ? '+' : ''}{(r.floorOffset ?? 0).toFixed(2)}</div>
    ) })
  }
  for (const b of plan.beams.filter(b => selIds.has(b.id) || hover?.id === b.id)) out.push({ key: 'b' + b.id, pass: true, pos: [M(b.a[0] + b.b[0]) / 2, b.bottom - 0.14 + elev(plan, b), M(b.a[1] + b.b[1]) / 2], node: (
    <div className="num whitespace-nowrap rounded-full bg-ink-900 px-2.5 py-1 text-[11px] font-bold text-white shadow-lg">{lang === 'zh' ? '梁底' : 'Bottom'} {b.bottom.toFixed(2)} m</div>
  ) })
  const focus = new Set([...selIds, hover?.id].filter(Boolean) as string[])
  if (mode !== 'original') for (const w of plan.walls.filter(w => PROTECTED_KINDS.includes(w.kind) && focus.has(w.id))) {
    const p = pointAt(w, wallLength(w) / 2)
    out.push({ key: 'l' + w.id, pass: true, pos: [M(p[0]), 3.05 + elev(plan, w), M(p[1])], node: (
      <span className="grid size-7 place-items-center rounded-full bg-white text-ink-800 shadow-[0_6px_14px_-6px_rgb(0_0_0/0.35)] ring-1 ring-ink-900/5"><Lock size={13} strokeWidth={2.4} /></span>
    ) })
  }
  if (mode !== 'original' && mode !== 'decor' && diff) for (const c of diff.pending.filter(c => c.op === 'add' && c.type === 'opening')) {
    const o = c.data as unknown as Opening, s = spanOf(plan, o)
    if (!s) continue
    out.push({ key: 'pp' + c.id, pos: [M(s.center[0]), o.head + 0.75 + elev(plan, s.wall), M(s.center[1])], node: (
      <Hotspot tone="lav" size={34} plus={false} icon={<Sparkles size={15} strokeWidth={2.2} />} onClick={() => select({ type: 'wall', id: s.wall.id })} label={c.note} />
    ) })
  }
  return out
}

function SpotProjector() {
  const spots = useSpots()
  return <Projector anchors={spots} />
}

function SpotLayer() {
  const spots = useSpots()
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {spots.map(s => <Pin key={s.key} id={s.key} pass={s.pass}>{s.node}</Pin>)}
    </div>
  )
}
