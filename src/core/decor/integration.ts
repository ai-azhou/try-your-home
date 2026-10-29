import { agentUnits, lengthUnit, planFileValue } from '../io.ts'
import type { Plan } from '../types.ts'
import { applyChanges } from '../changes.ts'
import { faceAxis } from './faces.ts'
import { decorItems, itemSpan, resolveDecor } from './resolve.ts'
import { materialTakeoff } from './surfaces.ts'
import { validateDecor } from './validate.ts'
export type DecorRef = { type: 'furniture' | 'cabinet' | 'panel' | 'recess' | 'surface' | 'decor'; id: string }
export const isDecorRef = (ref: { type: string }): ref is DecorRef => ['furniture', 'cabinet', 'panel', 'recess', 'surface', 'decor'].includes(ref.type)
export function decorHandoff(plan: Plan, ref: DecorRef | readonly string[]): string {
  if (Array.isArray(ref)) return ref.map(id => decorHandoff(plan, { type: 'decor', id })).join('\n')
  ref = ref as DecorRef
  const id = ref.id
  const item = plan.decor && decorItems(plan.decor).find(i => i.id === id)
  if (!item) return `- 装修 ${ref.id}：不存在`
  if (ref.type === 'decor') ref = { ...ref, type: 'place' in item ? 'cabinet' : 'thickness' in item ? 'panel' : 'host' in item ? 'recess' : 'target' in item ? 'surface' : 'furniture' }
  const labels = { furniture: '家具', cabinet: '柜体', panel: '造型', recess: '壁龛 / 挖洞', surface: '材料覆盖', decor: '装修' }
  let location = ''
  try { const sp = itemSpan(plan, item); if (sp) { const a = faceAxis(plan, sp.face), u = sp.s.map(a.toU).sort((a, b) => a - b); location = `；${a.wall.name ?? a.wall.id}（${({ exterior: '外墙', bearing: '承重墙', partition: '隔墙', glass: '玻璃墙', half: '矮墙', 'half-glass': '半玻墙' })[a.wall.kind]}），${sp.face.side === 1 ? '法向' : '反法向'}这一面，从左数 ${u.map(x => Math.round(x)).join('–')} mm，离地 ${sp.z.map(v => lengthUnit(v)).join('–')} mm；FaceRef=${JSON.stringify(sp.face)}` } } catch { location = '；宿主不存在，没地方挂了' }
  const facts = validateDecor(plan).filter(i => i.id === item.id).map(i => agentUnits(i.text)).join('；')
  return `- ${labels[ref.type]} ${item.id}${'name' in item && item.name ? ` / ${item.name}` : ''}${location}。\n  数据：${JSON.stringify(decorItems(planFileValue(plan).decor).find(i => i.id === item.id))}${facts ? `\n  事实：${facts}` : ''}`
}
export function decorStats(plan: Plan) {
  const d = plan.decor
  if (!d) return undefined
  const after = plan.legacy?.__structureReplayFrame ? plan : applyChanges(plan, plan.changes.filter(c => c.status === 'confirmed')).plan
  const resolved = resolveDecor(plan, after)
  return { furniture: d.furniture.length, cabinets: d.cabinets.length, panels: d.panels.length, recesses: d.recesses.length, surfaces: d.surfaces.length, materials: d.materials.length, pending: decorItems(d).filter(x => x.status === 'pending').length, total: decorItems(d).length, issues: resolved.issues.length, materialAreas: materialTakeoff({ ...after, decor: resolved.decor }) }
}
/** Only confirmed structural changes are the decor host context; never replay a changed view twice. */
export function validatePlanDecor(plan: Plan) {
  if (plan.decor === undefined) return []
  // Shape validation first, before attempting geometric resolution of imported JSON.
  const shape = validateDecor(plan).filter(i => ['invalid', 'duplicate-id', 'material-missing'].includes(i.code))
  if (shape.some(i => i.code === 'invalid')) return shape
  const after = plan.legacy?.__structureReplayFrame ? plan : applyChanges(plan, plan.changes.filter(c => c.status === 'confirmed')).plan
  return resolveDecor(plan, after).issues
}
