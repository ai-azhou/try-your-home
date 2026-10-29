import type { Plan, Wall } from '../types.ts'
import type { Cabinet, Decor, DecorIssue, FaceSpan, Furniture, Recess } from './types.ts'
import { columnFootprint, dot, effectiveWallHeight, polygonArea, sub, wallDir, wallLength } from '../geometry.ts'
import { levelOf } from '../levels.ts'
import { faceAxis, faceExtent, faceIntervals, faceRun, faceWall, runS } from './faces.ts'
import { furnitureFootprint } from './furniture.ts'
import { panelSpan } from './panels.ts'
import { intersection, ordered, overlap } from './math.ts'
export type EmbedItem = Recess | Cabinet | Furniture
export interface WallEmbed extends FaceSpan { id: string; depth: number | 'through' }
export function wallEmbed(plan: Plan, item: EmbedItem): WallEmbed | undefined {
  if ('host' in item) return 'face' in item.host && item.rect.s ? { id: item.id, face: item.host.face, s: item.rect.s, z: item.rect.z, depth: item.depth } : undefined
  if (!item.embed) return undefined
  if ('place' in item) return 'face' in item.place ? { id: item.id, face: item.place.face, s: [item.place.s, item.place.s + item.width], z: item.z, depth: item.embed } : undefined
  if (!item.against) return undefined
  const wall = faceWall(plan, item.against.face), ss = furnitureFootprint(item, plan).map(p => dot(sub(p, wall.a), wallDir(wall)))
  return { id: item.id, face: item.against.face, s: [Math.min(...ss), Math.max(...ss)], z: [item.z ?? 0, (item.z ?? 0) + item.height], depth: item.embed }
}
export function embedsOf(plan: Plan, decor: Decor): WallEmbed[] {
  return [...decor.recesses, ...decor.cabinets, ...decor.furniture].flatMap(item => { try { const e = wallEmbed(plan, item); return e ? [e] : [] } catch { return [] } })
}
export function embedFootprint(plan: Plan, e: WallEmbed) {
  const a = faceAxis(plan, e.face), depth = e.depth === 'through' ? a.wall.thickness : e.depth
  return [a.at(e.s[0]), a.at(e.s[1]), a.at(e.s[1], -depth), a.at(e.s[0], -depth)]
}
function protectedFact(id: string, host: Wall | NonNullable<Plan['columns']>[number], label: string): DecorIssue {
  const certainty = host.evidence?.certainty ?? 'unknown'
  const source = certainty === 'seen' ? '读图看到' : certainty === 'inferred' ? '读图推断，没确认' : '读图把握程度未知'
  return { id, code: 'protected', level: 'warn', text: `这面在方案里标为${label}（${source}）。嵌入、挖槽能不能做、能挖多深，需要专业人员到现场确认。` }
}
/** Geometry errors block the edit; protected facts are warnings only. Pass source plan to preserve original protection. */
export function checkEmbed(plan: Plan, decor: Decor, item: EmbedItem, originalPlan: Plan = plan): DecorIssue[] {
  const issues: DecorIssue[] = [], issue = (code: DecorIssue['code'], text: string) => issues.push({ id: item.id, code, level: 'error', text })
  const requestedDepth = 'host' in item ? item.depth : item.embed
  if (requestedDepth !== undefined && requestedDepth !== 'through' && (!Number.isFinite(requestedDepth) || requestedDepth < 0 || 'host' in item && requestedDepth === 0)) { issue('invalid', '嵌入深度必须是有效正数'); return issues }
  if ('host' in item && !('face' in item.host)) {
    const host = 'panel' in item.host ? decor.panels.find(p => p.id === (item.host as { panel: string }).panel) : decor.cabinets.find(c => c.id === (item.host as { cabinet: string }).cabinet)
    if (!host) { issue('host-missing', '挖洞的造型或柜体不存在，没地方挂了'); return issues }
    const thickness = 'thickness' in host ? (host.type === 'slats' ? host.slats?.depth ?? host.thickness : host.thickness) : host.depth
    if (item.depth !== 'through' && item.depth > thickness) issue('host-depth', `宿主只有 ${thickness} mm 厚，要挖墙请按墙面嵌入处理`)
    const span = 'thickness' in host ? panelSpan(plan, host) : undefined
    const width = span ? span.s[1] - span.s[0] : (host as Cabinet).width, z = span?.z ?? (host as Cabinet).z
    if (!item.rect.u || item.rect.u[0] < 0 || item.rect.u[1] > width || item.rect.z[0] < z[0] || item.rect.z[1] > z[1]) issue('out-of-face', '挖洞范围超出宿主')
    return issues
  }
  let e: WallEmbed | undefined
  try { e = wallEmbed(plan, item) } catch { issue('host-missing', '宿主墙不存在，没地方挂了'); return issues }
  if (!e) { if ('embed' in item && item.embed) issue('host-missing', '嵌入需要指定靠墙的墙面'); return issues }
  let wall: Wall
  try { wall = faceWall(plan, e.face) } catch { issue('host-missing', '宿主墙不存在，没地方挂了'); return issues }
  if (wall.bulge) { issue('arc-unsupported', '弧墙暂只支持整面材质，嵌入暂不支持'); return issues }
  const run = faceRun(plan, e.face), lo = run[0].s[0], hi = run[run.length - 1].s[1]
  if (e.s[0] < lo - 1e-5 || e.s[1] > hi + 1e-5 || e.z[0] < 0) issue('out-of-face', '超出这面墙了')
  const axis = faceAxis(plan, e.face), covered = run.filter(p => overlap(p.s, e!.s))
  for (const part of covered) {
    const w = part.wall, depth = e.depth === 'through' ? w.thickness : e.depth, extent = faceExtent(plan, part.face), visible = ordered(runS(part, extent[0]), runS(part, extent[1]))
    if (faceIntervals(plan, part.face).map(v => ordered(runS(part, v[0]), runS(part, v[1]))).reduce((sum, v) => sum + Math.max(0, Math.min(v[1], e!.s[1]) - Math.max(v[0], e!.s[0])), 0) < Math.min(part.s[1], e.s[1]) - Math.max(part.s[0], e.s[0]) - .01 || Math.max(e.s[0], part.s[0]) < visible[0] - .01 || Math.min(e.s[1], part.s[1]) > visible[1] + .01 || e.z[1] > effectiveWallHeight(plan, w) + 1e-7) issue('out-of-face', '超出这面墙看得见的范围或墙高了')
    if (depth >= w.thickness) issue('through-wall', `挖到 ${w.thickness} mm 就穿了；请到改造里开洞，添加结构洞口`)
    if (w.kind === 'glass' || ['half', 'half-glass'].includes(w.kind) && e.z[1] > (w.lowHeight ?? 1)) issue('wall-kind', w.kind === 'glass' ? '玻璃隔断上挖不了' : `矮墙实体只有 ${w.lowHeight ?? 1} m 高`)
    for (const o of plan.openings.filter(o => o.wall === w.id)) if (overlap(e.s, ordered(runS(part, o.offset), runS(part, o.offset + o.width))) && overlap(e.z, [o.sill, o.head])) issue('over-opening', `这里是${o.kind.includes('window') ? '窗洞' : '门洞'} ${o.id}`)
    const original = originalPlan.walls.find(v => v.id === w.id) ?? originalPlan.walls.filter(v => w.id.startsWith(`${v.id}~`)).sort((a, b) => b.id.length - a.id.length)[0]
    const protectedWall = [w, original].find(v => v && ['bearing', 'exterior'].includes(v.kind))
    if (protectedWall) issues.push(protectedFact(item.id, protectedWall, protectedWall.kind === 'exterior' ? '外墙' : '承重墙'))
  }
  for (const other of embedsOf(plan, decor)) {
    if (other.id === item.id || !overlap(e.z, other.z)) continue
    const ow = faceWall(plan, other.face)
    if (levelOf(plan, ow).id !== levelOf(plan, wall).id || ow.bulge) continue
    const oa = faceAxis(plan, other.face)
    if (dot(axis.normal, oa.normal) > -.999999) continue
    // Opposite sides can be anchored on different records in the same chain.
    const shared = covered.find(p => p.wall.id === ow.id) ?? covered.find(p => faceRun(plan, other.face).some(q => q.wall.id === p.wall.id))
    if (!shared) continue
    const points = other.s.map(s => oa.at(s)), projected = ordered(...points.map(p => dot(sub(p, wall.a), wallDir(wall))) as [number, number])
    const depth = e.depth === 'through' ? shared.wall.thickness : e.depth, otherDepth = other.depth === 'through' ? shared.wall.thickness : other.depth
    if (overlap(e.s, projected) && depth + otherDepth >= shared.wall.thickness) issue('meet-other-side', `这面墙另一侧也挖了 ${otherDepth} mm，两边合计 ${depth + otherDepth} mm，达到或超过墙厚 ${shared.wall.thickness} mm`)
  }
  const footprint = embedFootprint(plan, e), intersects = (poly: import('../types.ts').Vec2[]) => intersection([[footprint]], [[poly]]).some(r => polygonArea(r[0]) > 1e-6)
  for (const s of plan.shafts ?? []) if (levelOf(plan, s).id === levelOf(plan, wall).id && intersects(s.poly)) issue('into-shaft', `这里是管道井 / 烟道 ${s.id} 的位置`)
  for (const c of plan.columns ?? []) { const original = originalPlan.columns?.find(v => v.id === c.id), protectedColumn = c.kind === 'bearing' ? c : original?.kind === 'bearing' ? original : undefined; if (protectedColumn && levelOf(plan, c).id === levelOf(plan, wall).id && intersects(columnFootprint(c))) issues.push(protectedFact(item.id, protectedColumn, '承重柱')) }
  return issues.filter((i, n) => issues.findIndex(j => j.code === i.code && j.text === i.text) === n)
}
