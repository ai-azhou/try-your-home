import { fromLegacyFurniture } from './decor/legacy.ts'
import { createDecor } from './decor/presets.ts'
import { decorItems } from './decor/resolve.ts'
import type { Plan } from './types.ts'
import { validatePlanFile } from './schema.ts'
import { validatePlan } from './validate.ts'
import { emptyPlan, fromLegacy, importReport } from './legacy.ts'
import { isSimplePlan, simpleToPlan } from './simple.ts'
export { emptyPlan } from './legacy.ts'
export function newId(plan: Plan, prefix: string): string {
  const ids = new Set([...plan.walls, ...plan.openings, ...plan.beams, ...plan.rooms, ...plan.questions, ...plan.changes, ...(plan.levels ?? []), ...(plan.columns ?? []), ...(plan.shafts ?? []), ...(plan.stairs ?? []), ...(plan.voids ?? [])].flatMap(x => [x.id, ...('data' in x && x.data && typeof x.data.id === 'string' ? [x.data.id] : []), ...('group' in x && x.group ? [x.group] : [])]))
  if (plan.decor) for (const item of [...decorItems(plan.decor), ...plan.decor.materials, ...(plan.decor.presets ?? [])]) ids.add(item.id)
  let i = 1; while (ids.has(`${prefix}${i}`)) i++; return `${prefix}${i}`
}
function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => [k, stable(value[k])]))
  return value
}
/** Decimal exponent shift avoids introducing binary multiplication noise at file boundaries. */
export function lengthUnit(value: number, exponent = 3): number {
  const [coefficient, power = '0'] = String(value).split('e')
  return Number(`${coefficient}e${Number(power) + exponent}`)
}
/** Only explicit metre quantities in prose; pixel values, areas, IDs and unlabelled numbers stay intact. */
export function agentUnits(text: string): string {
  return text.replace(/([+−-]?\d+(?:\.\d+)?(?:\s*[–—~～至到-]\s*[+−-]?\d+(?:\.\d+)?)*)\s*(?:m(?![a-zA-Z²³^\d])|米(?![²³]|平方|立方))/g, (_, values: string) => values.replace(/[+−-]?\d+(?:\.\d+)?/g, n => String(lengthUnit(Number(n.replace('−', '-'))))) + ' mm')
}
/** Persisted length paths whose in-memory representation is metres. Never recurse by bare key names. */
export const METRE_PATHS = [
  'ceiling', 'walls.*.height', 'walls.*.lowHeight', 'openings.*.sill', 'openings.*.head',
  'beams.*.bottom', 'rooms.*.ceiling', 'rooms.*.floorOffset', 'levels.*.elevation', 'levels.*.ceiling',
  'decor.furniture.*.height', 'decor.furniture.*.z', 'decor.cabinets.*.z.*', 'decor.cabinets.*.plinth',
  'decor.cabinets.*.columns.*.cells.*.h', 'decor.cabinets.*.columns.*.cells.*.void.top.z',
  'decor.cabinets.*.columns.*.cells.*.appliance.size.2', 'decor.cabinets.*.cuts.*.z.*',
  'decor.panels.*.span.z.*', 'decor.recesses.*.rect.z.*', 'decor.recesses.*.shelves.*',
  'decor.surfaces.*.target.z.*', 'decor.presets.*.trims.skirting.height', 'decor.cache.*.pose.z',
] as const
const ELEMENT_METRES: Record<string, string[]> = { wall: ['height', 'lowHeight'], opening: ['sill', 'head'], beam: ['bottom'], room: ['ceiling', 'floorOffset'] }
function shiftPath(value: any, path: string[], exponent: number) {
  if (!value || typeof value !== 'object') return
  const [key, ...rest] = path
  for (const k of key === '*' ? Object.keys(value) : [key]) {
    if (rest.length) shiftPath(value[k], rest, exponent)
    else if (typeof value[k] === 'number') value[k] = lengthUnit(value[k], exponent)
  }
}
function shiftPlan(plan: any, exponent: number) {
  for (const path of METRE_PATHS) shiftPath(plan, path.split('.'), exponent)
  for (const c of Array.isArray(plan.changes) ? plan.changes : [])
    for (const key of ELEMENT_METRES[c?.type] ?? []) shiftPath(c?.data, [key], exponent)
}
export function planFileValue(plan: Plan): any {
  const value = structuredClone(plan)
  if (value.legacy) delete value.legacy.__structureReplayFrame
  shiftPlan(value, 3)
  value.version = 3
  for (const q of value.questions ?? []) if (q) {
    if (typeof q.text === 'string') q.text = agentUnits(q.text)
    if (typeof q.answer === 'string') q.answer = agentUnits(q.answer)
    if (Array.isArray(q.options)) q.options = q.options.map(v => typeof v === 'string' ? agentUnits(v) : v)
    if (typeof q.reply?.text === 'string') q.reply.text = agentUnits(q.reply.text)
    for (const e of Array.isArray(q.log) ? q.log : []) if (typeof e?.text === 'string') e.text = agentUnits(e.text)
  }
  return value
}
export function serializePlan(plan: Plan): string { return JSON.stringify(stable(planFileValue(plan)), null, 2) + '\n' }
/**
 * Format marker and the six arrays of a v2/v3 file. Chat replies often leave out arrays that may be empty
 * (beams / questions / changes): those become [] and are reported back; anything else is named, never guessed.
 */
function shapeOf(value: Record<string, unknown>): string[] {
  const problems: string[] = [], filled: string[] = [], seen = (v: unknown) => v === undefined ? '缺失' : v === null ? 'null' : Array.isArray(v) ? '数组' : JSON.stringify(v).length <= 24 ? JSON.stringify(v) : typeof v
  if (value.format !== 'floorplan-structure') problems.push(`format 应为 "floorplan-structure"（现在是 ${seen(value.format)}）`)
  if (![2, 3].includes(value.version as number)) problems.push(`version 应为 3（现在是 ${seen(value.version)}）`)
  for (const k of ['walls', 'openings', 'beams', 'rooms', 'questions', 'changes']) {
    if (Array.isArray(value[k])) continue
    if (value[k] === undefined && ['beams', 'questions', 'changes'].includes(k)) { value[k] = []; filled.push(k); continue }
    problems.push(value[k] === undefined ? `缺 ${k} 数组（没有就写 []）` : `${k} 应为数组（现在是 ${seen(value[k])}）`)
  }
  if (problems.length) throw new Error(`方案格式不完整：${problems.join('；')}`)
  return filled
}
export function parsePlanText(text: string) {
  try {
    const value = JSON.parse(text.replace(/^\uFEFF/, ''))
    if (isSimplePlan(value)) {
      const converted = simpleToPlan(value), report = importReport('simple'), plan = converted.plan ?? emptyPlan()
      report.approximations = converted.notes
      report.counts = Object.fromEntries((['walls', 'openings', 'beams', 'rooms', 'questions', 'changes'] as const).map(k => [k, plan[k].length]))
      report.warnings = converted.issues.filter(i => i.level === 'warn').map(i => i.message)
      return { plan, report, issues: converted.issues }
    }
    if (value?.format === 'floorplan-structure' || [2, 3].includes(value?.version)) {
      const report = importReport('v2'), filled = shapeOf(value)
      if (value.version === 3) shiftPlan(value, -3)
      value.version = 2 // Runtime contract stays mixed-unit v2; serialization always upgrades to v3.
      if (Array.isArray(value.decor?.furniture)) for (const f of value.decor.furniture) {
        if (f && typeof f.in === 'string' && f.at !== undefined) {
          delete f.at
          report.approximations.push(`家具 ${f.id} 已迁移为仅随宿主定位，移除旧 at`)
        }
      }
      if (value.legacy) delete value.legacy.__structureReplayFrame
      const schemaIssues = validatePlanFile(planFileValue(value as Plan))
      const unknown = schemaIssues.find(i => /不允许的字段|additional propert/i.test(i.message))
      if (unknown) {
        const path = (/^格式错误 (.*?)：/.exec(unknown.message)?.[1] ?? '/').replace(/^\/\//, '/')
        schemaIssues.push({ level: 'error', code: 'schema', message: `方案里有这个版本不认识的字段（${path}）：可能是更新版本的工具或 Skill 写的，请把 try-your-home 和 see-your-home 升级到最新版` })
      }
      if (schemaIssues.length) return { plan: emptyPlan(), report, issues: schemaIssues }
      report.counts = Object.fromEntries(['walls', 'openings', 'beams', 'rooms', 'questions', 'changes'].map(k => [k, value[k].length]))
      const missing = filled.map(k => ({ level: 'warn' as const, code: 'missing-array', message: `方案里没写 ${k}，已按空数组 [] 载入` }))
      return { plan: value as Plan, report, issues: [...missing, ...validatePlan(value as Plan)] }
    }
    const converted = fromLegacy(value)
    const furniture = fromLegacyFurniture(converted.plan)
    if (furniture.furniture.length || furniture.style) {
      converted.plan.decor = { ...createDecor(furniture.style ?? 'cream'), furniture: furniture.furniture, presets: furniture.presets }
      converted.plan.decor.materials.push(...furniture.materials)
      converted.report.counts.furniture = furniture.furniture.length
      converted.report.approximations.push(`家具 ${furniture.furniture.length} 件已转入装修层；未识别类型使用占位块和 1 m 参考高度`)
      converted.report.warnings.push(...furniture.warnings)
    }
    if (converted.plan.legacy) delete converted.plan.legacy.__structureReplayFrame
    const schemaIssues = validatePlanFile(planFileValue(converted.plan))
    if (schemaIssues.length) return { plan: emptyPlan(), report: converted.report, issues: schemaIssues }
    const issues = validatePlan(converted.plan)
    return { ...converted, issues }
  } catch (e) {
    return { plan: emptyPlan(), report: importReport('v2'), issues: [{ level: 'error' as const, code: 'parse', message: `无法读取方案：${e instanceof Error ? e.message : String(e)}` }] }
  }
}
