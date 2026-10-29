import Ajv2020 from 'ajv/dist/2020.js'
import schema from '../../schema/plan.schema.json' with { type: 'json' }
import type { Issue } from './validate.ts'
// One compiled validator per process; no network or external schema lookup.
const check = new Ajv2020({ allErrors: true, strict: false }).compile(schema)
export function validatePlanFile(value: unknown): Issue[] {
  if (check(value)) return []
  return (check.errors ?? []).filter(e => e.keyword !== 'if').map(e => ({
    level: 'error', code: 'schema',
    message: `格式错误 ${e.instancePath || '/'}${e.params.additionalProperty ? '/' + e.params.additionalProperty : e.params.missingProperty ? '/' + e.params.missingProperty : ''}：${e.message}`,
  }))
}
