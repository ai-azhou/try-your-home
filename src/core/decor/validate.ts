import { applyChanges, replayOrigin } from '../changes.ts'
import { decorStatus, resolveDecor } from './resolve.ts'
import { componentOf, isCustomType, validateComponent, validateComponentPaths } from './components.ts'
import { FURNITURE_LIBRARY, furnitureFootprint, furniturePose, isFlatFurniture } from './furniture.ts'
import type { Opening, Plan } from '../types.ts'
import type { Decor, DecorIssue, FaceSpan, MaterialRole } from './types.ts'
import { dot, effectiveWallHeight, sub, wallDir } from '../geometry.ts'
import { levelsOf } from '../levels.ts'
import { faceExtent, faceFrame, faceRun, runS } from './faces.ts'
import { layoutCabinet } from './cabinets.ts'
import { checkEmbed } from './embed.ts'
import { panelSpan } from './panels.ts'
import { STYLE_PRESETS } from './presets.ts'
import { ordered, overlap } from './math.ts'
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const point = (x: any): boolean => Array.isArray(x) && x.length === 2 && x.every(finite)
const interval = (x: any): boolean => point(x) && x[1] > x[0]
const obj = (x: any): boolean => !!x && typeof x === 'object' && !Array.isArray(x)
const face = (x: any): boolean => obj(x) && typeof x.wall === 'string' && [1, -1].includes(x.side)
const span = (x: any): boolean => obj(x) && face(x.face) && interval(x.s) && interval(x.z)
const positive = (x: any): boolean => finite(x) && x > 0
const depth = (x: any): boolean => x === 'through' || positive(x)
const optional = (x: any, check: (x: any) => boolean) => x === undefined || check(x)
const roles: MaterialRole[] = ['floor.main', 'floor.wet', 'floor.outdoor', 'threshold', 'wall.main', 'wall.wet', 'wall.accent', 'ceiling', 'skirting', 'wood.main', 'cabinet.front', 'cabinet.carcass', 'stone.top', 'metal', 'fabric.main', 'fabric.accent', 'rug']
function validateDecorData(plan: Plan, decor: Decor | undefined = plan.decor, originalPlan: Plan = plan): DecorIssue[] {
  if (decor === undefined) return []
  originalPlan = replayOrigin(originalPlan)?.base ?? originalPlan
  const issues: DecorIssue[] = [], add = (id: string, code: DecorIssue['code'], text: string, level: DecorIssue['level'] = 'error') => issues.push({ id, code, level, text })
  const invalid = (id: string, text: string) => add(id, 'invalid', text)
  if (!obj(decor) || decor.version !== 1 || typeof decor.style !== 'string') { invalid('decor', '装修层必须是 version=1 的对象，并指定 style'); return issues }
  for (const k of ['materials', 'surfaces', 'furniture', 'cabinets', 'panels', 'recesses'] as const) if (!Array.isArray(decor[k])) invalid('decor', `${k} 必须为数组`)
  if (!optional(decor.doors, Array.isArray)) invalid('decor', 'doors 必须为数组')
  if (!optional(decor.components, Array.isArray)) invalid('decor', 'components 必须为数组')
  if (!optional(decor.presets, Array.isArray)) invalid('decor', 'presets 必须为数组')
  if (issues.length) return issues
  const structural = [...plan.walls, ...plan.openings, ...plan.beams, ...plan.rooms, ...plan.questions, ...plan.changes, ...(plan.levels ?? []), ...(plan.columns ?? []), ...(plan.shafts ?? []), ...(plan.stairs ?? []), ...(plan.voids ?? [])]
  const seen = new Set(structural.map(e => e.id)), levelIds = levelsOf(plan).map(l => l.id)
  const groups = { doors: decor.doors ?? [], components: decor.components ?? [], materials: decor.materials, presets: decor.presets ?? [], surfaces: decor.surfaces, furniture: decor.furniture, cabinets: decor.cabinets, panels: decor.panels, recesses: decor.recesses }
  for (const [key, items] of Object.entries(groups)) for (const e of items as any[]) {
    if (!obj(e) || typeof e.id !== 'string' || !e.id) { invalid('decor', `${key} 条目需要有效 id`); continue }
    if (seen.has(e.id)) add(e.id, key === 'components' ? 'component-invalid' : 'duplicate-id', `重复 id：${e.id}`); seen.add(e.id)
    if (!['materials', 'presets', 'components'].includes(key) && (!['user', 'agent'].includes(e.by) || !['pending', 'confirmed'].includes(e.status))) invalid(e.id, '构件必须指定 by 和 status')
    if (e.look !== undefined && (typeof e.look !== 'string' || [...e.look].length > 300)) invalid(e.id, 'look 必须是最多 300 字的字符串')
    if (e.level !== undefined && !levelIds.includes(e.level)) invalid(e.id, '楼层不存在')
    if (e.ack !== undefined && (!obj(e.ack) || typeof e.ack.by !== 'string')) invalid(e.id, 'ack 需要 by')
  }
  if (issues.some(i => i.code === 'invalid')) return issues
  const materialIds = new Set(decor.materials.map(m => m.id)), mat = (id: string, value: any) => { if (typeof value !== 'string' || !materialIds.has(value)) add(id, 'material-missing', `材料 ${String(value)} 未保存在 decor.materials`) }
  for (const def of decor.components ?? []) issues.push(...validateComponent(def, materialIds))
  const unit = (id: string) => add(id, 'unit-suspect', '可能把 mm 写成了 m：文件里长度和高度一律是 mm，比如 850')
  for (const item of [...decor.cabinets, ...decor.panels, ...decor.recesses]) {
    const z = 'columns' in item ? item.z : 'rect' in item ? item.rect?.z : item.span?.z
    if (z && (z[1] - z[0] < .01 || z[1] - z[0] > 10)) unit(item.id)
  }
  for (const m of decor.materials) {
    if (typeof m.name !== 'string' || !['wood-floor', 'tile', 'stone', 'paint', 'texture-paint', 'wallpaper', 'veneer', 'microcement', 'laminate', 'fabric', 'leather', 'metal', 'glass', 'rattan', 'other'].includes(m.category) || typeof m.color !== 'string' || !/^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(m.color)) invalid(m.id, '材料名称、分类或 sRGB 十六进制颜色无效')
    if (m.texture && (!obj(m.texture) || !['planks', 'tiles', 'herringbone', 'grain', 'speckle', 'veins', 'weave'].includes(m.texture.kind) || !optional(m.texture.size, x => point(x) && x.every(positive)) || !optional(m.texture.joint, x => finite(x) && x >= 0))) invalid(m.id, '材料纹理参数无效')
    if (m.pbr) {
      if (!obj(m.pbr)) invalid(m.id, 'PBR 必须是对象')
      for (const v of [m.pbr.roughness, m.pbr.metalness, m.pbr.sheen]) if (!optional(v, x => finite(x) && x >= 0 && x <= 1)) invalid(m.id, 'PBR 系数须在 0–1')
      if (m.pbr.maps && !obj(m.pbr.maps)) invalid(m.id, '贴图必须是本地路径对象')
      for (const path of Object.values(m.pbr.maps ?? {})) if (typeof path !== 'string' || !path.trim() || /^(?:[a-z][a-z\d+.-]*:|[/\\])/i.test(path.trim())) invalid(m.id, '贴图只能是本地相对路径，禁止远程地址、协议和绝对路径')
    }
  }
  for (const p of decor.presets ?? []) {
    if (typeof p.name !== 'string' || !obj(p.roles) || Object.keys(p.roles).some(r => !roles.includes(r as MaterialRole))) { invalid(p.id, '风格名称或材料角色无效'); continue }
    Object.values(p.roles).forEach(v => mat(p.id, v))
    if (p.rooms && (!Array.isArray(p.rooms) || p.rooms.some(r => !obj(r) || !Array.isArray(r.match) || !r.match.every(x => typeof x === 'string') || r.floor && !roles.includes(r.floor) || r.wall && !roles.includes(r.wall)))) invalid(p.id, '房间材料规则无效')
  }
  if (![...STYLE_PRESETS, ...(decor.presets ?? [])].some(s => s.id === decor.style)) invalid('decor', '整体风格不存在')
  for (const s of decor.surfaces) {
    const t = s.target
    if (!obj(t) || Object.keys(t).filter(k => ['floor', 'ceiling', 'face'].includes(k)).length !== 1 || ('face' in t ? !face(t.face) || !optional(t.s, interval) || !optional(t.z, interval) : !('floor' in t || 'ceiling' in t))) invalid(s.id, '面的覆盖需要一种有效目标及递增区间')
    mat(s.id, s.material)
    if (s.layout && (!['straight', 'staggered', 'herringbone', 'chevron', 'grid', 'diagonal'].includes(s.layout.pattern) || !optional(s.layout.size, x => point(x) && x.every(positive)) || !optional(s.layout.origin, point) || !optional(s.layout.angle, finite))) invalid(s.id, '铺法参数无效')
  }
  const doorOpenings = new Set<string>()
  // A finish belongs to the confirmed renovation, including newly added doors. Do not validate it against the original opening kind.
  const doorPlan = decor.doors?.length && !plan.legacy?.__structureReplayFrame ? applyChanges(plan, plan.changes.filter(c => c.status === 'confirmed')).plan : plan
  const lastOpening = (id: string): Opening | undefined => {
    const changes = originalPlan.changes.filter(c => c.status === 'confirmed')
    // Keep the last real dimensions/kind before demolition (also handles an added door or a resized door later removed with its wall).
    for (let end = changes.length - 1; end > 0; end--) {
      const opening = applyChanges(originalPlan, changes.slice(0, end)).plan.openings.find(o => o.id === id)
      if (opening) return opening
    }
    return originalPlan.openings.find(o => o.id === id)
  }
  for (const d of decor.doors ?? []) {
    if (typeof d.opening !== 'string' || !d.opening) { invalid(d.id, '门的外观需要 opening id'); continue }
    if (doorOpenings.has(d.opening)) invalid(d.id, `洞口 ${d.opening} 只能有一条门的外观`)
    doorOpenings.add(d.opening)
    const current = doorPlan.openings.find(o => o.id === d.opening), opening = current ?? lastOpening(d.opening)
    if (!opening) invalid(d.id, `opening ${d.opening} 不存在，请核对洞口 id`)
    else {
      if (opening.kind === 'doorway') invalid(d.id, '门洞没有门扇，要做门套用造型 arch')
      else if (!['door', 'sliding'].includes(opening.kind) || Math.abs(opening.sill) > 1e-7) invalid(d.id, 'opening 必须是洞底贴地、有门扇的 door 或 sliding')
      if (!current) add(d.id, 'host-missing', `洞口 ${d.opening} 已拆除，门的外观没地方挂了`, 'info')
      if (d.front !== undefined) validateComponentPaths(d.front, opening.width, (opening.head - opening.sill) * 1000, (field, message) => invalid(d.id, `front${field}：${message}`))
    }
    const color = (value: unknown) => { if (value !== undefined && !(typeof value === 'string' && /^#[\da-f]{6}$/i.test(value))) mat(d.id, value) }
    color(d.color)
    if (d.material !== undefined) mat(d.id, d.material)
    if (d.frame !== undefined) {
      if (!obj(d.frame)) invalid(d.id, 'frame 必须是门框外观对象')
      else { color(d.frame.color); if (d.frame.material !== undefined) mat(d.id, d.frame.material) }
    }
    if (d.flip !== undefined && typeof d.flip !== 'boolean') invalid(d.id, 'flip 必须为布尔值')
  }
  for (const f of decor.furniture) {
    if (typeof f.type !== 'string' || (f.in !== undefined ? typeof f.in !== 'string' || !f.in || f.at !== undefined : !point(f.at)) || !point(f.size) || !f.size.every(positive) || !positive(f.height) || !(f.in ? optional(f.rot, finite) : finite(f.rot)) || !optional(f.z, finite) || !optional(f.embed, x => finite(x) && x >= 0) || f.against && (!face(f.against.face) || (!finite(f.against.gap) || f.against.gap < 0))) invalid(f.id, '家具位置、尺寸、高度、旋转或靠墙参数无效')
    if (f.height < .003 || f.height > 10 || f.size?.some(v => v < 10)) unit(f.id)
    if (isCustomType(f.type)) {
      const def = componentOf(decor, f.type)
      if (!def) add(f.id, 'component-missing', `构件定义 ${f.type.slice(7)} 不存在，请先写 component`)
      else if (Math.abs(f.height * 1000 - def.height) > 1 || f.size?.some((v, i) => Math.abs(v - def.size[i]) > 1)) unit(f.id)
    } else if (typeof f.type === 'string' && !FURNITURE_LIBRARY.some(e => e.type === f.type)) {
      const near = [...FURNITURE_LIBRARY].sort((a, b) => editDistance(f.type, a.type) - editDistance(f.type, b.type)).slice(0, 3)
      add(f.id, 'unknown-type', `未知家具 type ${f.type}；最接近的 id：${near.map(e => e.type).join('、')}，请用 decor-list 核对`, 'warn')
    }
    if (f.flip !== undefined && typeof f.flip !== 'boolean') invalid(f.id, 'flip 必须为布尔值')
    Object.values(f.materials ?? {}).forEach(v => mat(f.id, v))
  }
  for (const c of decor.cabinets) {
    if (!['tall', 'base', 'wall'].includes(c.family) || !obj(c.place) || ('face' in c.place ? !face(c.place.face) || !finite(c.place.s) || !optional(c.place.gap, x => finite(x) && x >= 0) : !('at' in c.place) || !point(c.place.at) || !finite(c.place.rot)) || !positive(c.width) || !positive(c.depth) || !interval(c.z) || !optional(c.plinth, x => finite(x) && x >= 0) || !optional(c.embed, x => finite(x) && x >= 0) || !Array.isArray(c.columns) || !obj(c.materials)) { invalid(c.id, '柜体位置、尺寸、分列或材料无效'); continue }
    mat(c.id, c.materials.carcass); mat(c.id, c.materials.front)
    if (c.top && (!positive(c.top.thickness) || !optional(c.top.overhang, x => finite(x) && x >= 0))) invalid(c.id, '台面尺寸无效')
    if (c.top) mat(c.id, c.top.material)
    if (c.cuts && (!Array.isArray(c.cuts) || c.cuts.some(x => !obj(x) || !interval(x.u) || !interval(x.z) || !depth(x.depth)))) invalid(c.id, '柜体挖洞参数无效')
    for (const col of c.columns) {
      if (!obj(col) || !optional(col.width, positive) || !Array.isArray(col.cells)) { invalid(c.id, '柜列参数无效'); continue }
      for (const cell of col.cells) {
        if (!obj(cell) || !['door', 'doors', 'drawers', 'flap', 'open', 'void', 'appliance'].includes(cell.type) || !optional(cell.h, positive) || !optional(cell.count, x => Number.isInteger(x) && x >= 0 && x <= 1000) || !optional(cell.hinge, x => ['left', 'right'].includes(x))) { invalid(c.id, '柜格参数无效'); continue }
        if (cell.void && (!obj(cell.void) || !depth(cell.void.depth) || cell.void.top && !finite(cell.void.top.z))) invalid(c.id, '柜格挖洞参数无效')
        if (cell.appliance && (!obj(cell.appliance) || !['fridge', 'washer', 'dryer', 'oven', 'steamer', 'dishwasher', 'microwave', 'tv', 'other'].includes(cell.appliance.type) || !optional(cell.appliance.size, x => Array.isArray(x) && x.length === 3 && x.every(positive)))) invalid(c.id, '家电位参数无效')
        if (cell.material) mat(c.id, cell.material)
        if (cell.void?.top?.material) mat(c.id, cell.void.top.material)
      }
    }
  }
  for (const p of decor.panels) {
    if (!['feature', 'wainscot', 'slats', 'skirting', 'arch'].includes(p.type) || !positive(p.thickness) || (p.type === 'arch' ? typeof p.opening !== 'string' || !optional(p.span, span) : !span(p.span))) invalid(p.id, '造型类型、厚度或宿主区间无效')
    if (p.grooves && (!['v', 'h'].includes(p.grooves.dir) || !positive(p.grooves.spacing) || !optional(p.grooves.width, positive))) invalid(p.id, '分缝参数无效')
    if (p.slats && (!positive(p.slats.width) || !finite(p.slats.gap) || p.slats.gap < 0 || !positive(p.slats.depth))) invalid(p.id, '格栅尺寸无效')
    if (p.frame && (!['flat', 'raised'].includes(p.frame.style) || !positive(p.frame.margin))) invalid(p.id, '框线参数无效')
    if (p.arch && !optional(p.arch.radius, positive)) invalid(p.id, '拱半径无效')
    mat(p.id, p.material)
  }
  for (const r of decor.recesses) {
    if (!obj(r.host) || Object.keys(r.host).length !== 1 || !obj(r.rect) || !interval(r.rect.z) || !depth(r.depth) || ('face' in r.host ? !face(r.host.face) || !interval(r.rect.s) || r.rect.u !== undefined || r.kind !== 'niche' : !('panel' in r.host || 'cabinet' in r.host) || !interval(r.rect.u) || r.rect.s !== undefined || r.kind !== 'hole')) invalid(r.id, '壁龛 / 挖洞的宿主、类型、区间或深度无效')
    if (r.shelves && (!Array.isArray(r.shelves) || r.shelves.some(h => !finite(h) || h <= r.rect.z[0] || h >= r.rect.z[1]))) invalid(r.id, '层板须在壁龛高度内')
    if (r.back) mat(r.id, r.back); if (r.trim) mat(r.id, r.trim)
  }
  if (decor.cache && (!obj(decor.cache) || Object.values(decor.cache).some(c => !obj(c) || !Array.isArray(c.box) || c.box.length !== 4 || !c.box.every(finite) || c.face && (!Array.isArray(c.face) || c.face.length !== 2 || !c.face.every(point))))) invalid('decor', 'cache 几何无效')
  for (const c of Object.values(decor.cache ?? {})) {
    if (c.pose && (!point(c.pose.at) || !finite(c.pose.rot) || !finite(c.pose.z))) invalid('decor', 'cache.pose 几何无效')
    if (c.anchor && (typeof c.anchor.wall !== 'string' || !point(c.anchor.a) || !point(c.anchor.b))) invalid('decor', 'cache.anchor 几何无效')
  }
  if (issues.some(i => i.code === 'invalid')) return issues
  const checkSpan = (id: string, sp: FaceSpan, embedded = false, into = false) => {
    try {
      const f = faceFrame(plan, sp), run = faceRun(plan, sp.face)
      if (sp.z[0] < 0 || run.filter(p => overlap(p.s, sp.s)).some(p => {
        const e = faceExtent(plan, p.face), s = ordered(runS(p, e[0]), runS(p, e[1]))
        return Math.max(sp.s[0], p.s[0]) < s[0] - .01 || Math.min(sp.s[1], p.s[1]) > s[1] + .01 || sp.z[1] > effectiveWallHeight(plan, p.wall) + 1e-7
      })) add(id, 'out-of-face', '超出这面墙看得见的范围或墙高了')
      if (embedded && (f.wall.kind === 'glass' || ['half', 'half-glass'].includes(f.wall.kind) && sp.z[1] > (f.wall.lowHeight ?? 1))) add(id, 'wall-kind', '玻璃或矮墙实体范围无法容纳这件柜子')
      // 嵌进墙的柜子撞洞口做不到，拦；靠墙的挡住门窗只是事实，提示
      if (embedded) for (const part of run) for (const o of plan.openings.filter(o => o.wall === part.wall.id)) if (overlap(sp.s, ordered(runS(part, o.offset), runS(part, o.offset + o.width))) && overlap(sp.z, [o.sill, o.head])) add(id, 'over-opening', into ? `柜子嵌进墙的部分撞到洞口 ${o.id}，这样做不了` : `柜子挡住了${o.kind.includes('window') ? '窗' : '门'} ${o.name ?? o.id}`, into ? 'error' : 'warn')
    } catch (e) { add(id, (e as { code?: DecorIssue['code'] }).code ?? 'invalid', (e as Error).message) }
  }
  for (const p of decor.panels) { try { checkSpan(p.id, panelSpan(plan, p)) } catch (e) { add(p.id, 'host-missing', (e as Error).message) } }
  for (const c of decor.cabinets) { issues.push(...layoutCabinet(c).issues); if ('face' in c.place) checkSpan(c.id, { face: c.place.face, s: [c.place.s, c.place.s + c.width], z: c.z }, true, !!c.embed) }
  for (const item of [...decor.recesses, ...decor.cabinets, ...decor.furniture]) { try { issues.push(...checkEmbed(plan, decor, item, originalPlan)) } catch (e) { add(item.id, 'host-missing', (e as Error).message) } }
  for (const f of decor.furniture) {
    if (f.against && !plan.walls.some(w => w.id === f.against!.face.wall)) add(f.id, 'host-missing', '靠墙家具的墙不存在，请核对 against.face.wall')
    if (f.in && furniturePose({ ...plan, decor }, f).missing) add(f.id, 'host-missing', `家具宿主 ${f.in} 不存在`)
    // 靠墙的家具压在门窗上：只给事实，不拦（地毯这类贴地的不算）
    if (f.against && !f.in && !isFlatFurniture(decor, f)) try {
      const wall = plan.walls.find(w => w.id === f.against!.face.wall)
      if (wall) {
        const ss = furnitureFootprint(f, plan).map(p => dot(sub(p, wall.a), wallDir(wall))), span: [number, number] = [Math.min(...ss), Math.max(...ss)], z: [number, number] = [f.z ?? 0, (f.z ?? 0) + f.height]
        const hit = faceRun(plan, f.against.face).flatMap(part => plan.openings.filter(o => o.wall === part.wall.id && overlap(span, ordered(runS(part, o.offset), runS(part, o.offset + o.width))) && overlap(z, [o.sill, o.head])))
        if (hit.length) { const names = [...new Set(hit.map(openingWord))].join('、'); add(f.id, 'over-opening', `压在${names}${/[\x21-\x7e]$/.test(names) ? ' ' : ''}上`, 'warn') }
      }
    } catch { /* 弧墙等：faceRun 算不出来就不提示 */ }
  }
  for (const s of decor.surfaces) {
    if ('face' in s.target) {
      const t = s.target, w = plan.walls.find(w => w.id === t.face.wall)
      if (!w) add(s.id, 'host-missing', '墙面不存在')
      else if (w.bulge && (t.s || t.z)) add(s.id, 'arc-unsupported', '弧墙暂只支持整面材质')
      else if (t.s || t.z) checkSpan(s.id, { face: t.face, s: t.s ?? faceExtent(plan, t.face), z: t.z ?? [0, effectiveWallHeight(plan, w)] })
    } else if (!plan.rooms.some(r => r.id === ('floor' in s.target ? s.target.floor : 'ceiling' in s.target ? s.target.ceiling : ''))) add(s.id, 'room-missing', '目标房间不存在，请核对房间 id', originalPlan !== plan && originalPlan.rooms.some(r => r.id === ('floor' in s.target ? s.target.floor : 'ceiling' in s.target ? s.target.ceiling : '')) ? 'info' : 'error')
  }
  return issues.filter((i, n) => issues.findIndex(j => j.id === i.id && j.code === i.code && j.text === i.text) === n)
}

/** Imported JSON is untrusted: malformed nested fields are diagnostics, never exceptions. */
export function validateDecorRaw(plan: Plan, decor: Decor | undefined = plan.decor, originalPlan: Plan = plan): DecorIssue[] {
  try {
    const issues = validateDecorData(plan, decor, originalPlan)
    if (!decor || issues.some(i => i.code === 'invalid')) return issues
    const previous = structuredClone(decor), ids = new Set<string>()
    for (const key of ['furniture', 'cabinets', 'panels', 'recesses', 'surfaces', 'doors'] as const) if (previous[key]) previous[key] = previous[key]!.map(item => {
      if (item.prev === undefined) return item
      if (!obj(item.prev) || item.status !== 'pending' || item.prev.id !== item.id || item.prev.status !== 'confirmed' || item.prev.prev !== undefined) {
        issues.push({ id: item.id, code: 'invalid', level: 'error', text: 'prev 必须是同 id 的完整 confirmed 项，不能嵌套 prev，且仅 pending 项可携带' })
        return item
      }
      ids.add(item.id)
      return item.prev
    }) as never
    if (ids.size) issues.push(...validateDecorData({ ...plan, decor: previous }, previous, originalPlan).filter(i => ids.has(i.id)).map(i => ({ ...i, text: `prev：${i.text}` })))
    return issues
  } catch (error) { return [{ id: "decor", code: "invalid", level: "error", text: `装修数据结构无效：${error instanceof Error ? error.message : String(error)}` }] }
}

/** Host diagnostics use the same resolution as the status UI; malformed input stays diagnostic-only. */
export function validateDecor(plan: Plan, decor: Decor | undefined = plan.decor, originalPlan: Plan = replayOrigin(plan)?.base ?? plan): DecorIssue[] {
  const raw = validateDecorRaw(plan, decor, originalPlan)
  if (raw.some(i => i.code === 'invalid') || !decor) return raw
  try {
    return originalPlan !== plan ? resolveDecor({ ...originalPlan, decor }, plan).issues : decorStatus({ ...plan, decor }).issues
  } catch { return raw }
}

const openingWord = (o: Opening) => { const word = o.kind.includes('window') || o.kind === 'open-balcony' ? '窗' : '门'; return o.name ? (o.name.includes(word) ? o.name : `${o.name}${word}`) : `${word} ${o.id}` }
function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 0; i < a.length; i++) { const next = [i + 1]; for (let j = 0; j < b.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === b[j] ? 0 : 1))); row = next }
  return row[b.length]
}
