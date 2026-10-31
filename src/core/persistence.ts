import { parsePlanText, serializePlan } from './io.ts'
import type { Plan } from './types.ts'
import type { Issue } from './validate.ts'
import type { DecorIssue } from './decor/types.ts'

// Placement diagnostics are editable work states, even when validation calls them errors.
// Exhaustive so new decor codes require an explicit persistence decision.
const decorBlocksPersistence: Record<DecorIssue['code'], boolean> = {
  'host-missing': false, 'host-cut': false, 'out-of-face': false,
  'too-deep': false, 'wall-kind': false, 'over-opening': false,
  'through-wall': false, 'meet-other-side': false, 'into-shaft': false,
  'host-depth': false, protected: false, 'room-missing': false,
  'arc-unsupported': false,
  'unknown-type': false, 'unit-suspect': true, 'component-invalid': true, 'component-missing': false, 'column-width': true,
  invalid: true, 'duplicate-id': true, 'material-missing': true,
}

export function blocksPersistence(issue: { level: string; code: string }): boolean {
  return issue.level === 'error' && !(issue.code.startsWith('decor-')
    && decorBlocksPersistence[issue.code.slice(6) as DecorIssue['code']] === false)
}

/** Blank parser fallback/new document; an underlay or actual decor item is user data too. */
export function isEmptyPlan(plan: Plan): boolean {
  return !['walls', 'openings', 'beams', 'rooms', 'columns', 'shafts', 'stairs', 'voids', 'questions', 'changes'].some(k => (plan[k as keyof Plan] as unknown[] | undefined)?.length)
    && !plan.underlay && !Object.keys(plan.levelUnderlays ?? {}).length
    && !['furniture', 'cabinets', 'panels', 'recesses', 'surfaces', 'doors'].some(k => (plan.decor?.[k as keyof NonNullable<Plan['decor']>] as unknown[] | undefined)?.length)
}

export function loadError(issues: Issue[]): string | null {
  const errors = issues.filter(blocksPersistence)
  if (!errors.length) return null
  const kind = errors.some(i => i.code === 'schema' || i.code === 'parse') ? '格式' : '几何'
  return `这个方案文件有${kind}错误，没有载入：\n${errors.slice(0, 3).map(i => i.message).join('\n')}${errors.length > 3 ? `\n另有 ${errors.length - 3} 条错误` : ''}`
}

/** Validate the actual serialized boundary, including schema, before any UI persistence. */
export function planWriteError(plan: Plan | null, allowEmpty = false): string | null {
  if (!plan) return '当前没有方案，不能保存。'
  try {
    const error = loadError(parsePlanText(serializePlan(plan)).issues)
    if (error) return error.replace('没有载入', '不能保存或导出')
    if (!allowEmpty && isEmptyPlan(plan)) return '当前方案为空，不能保存或导出；原文件保持不变。'
    return null
  } catch (e) { return `方案无法序列化，不能保存：${e instanceof Error ? e.message : String(e)}` }
}
