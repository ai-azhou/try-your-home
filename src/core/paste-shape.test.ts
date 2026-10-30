import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parsePlanText } from './io.ts'

// B7 (线上bug-1030): a Chat reply that leaves out an array gets told exactly which one.
const sample = () => JSON.parse(readFileSync('fixtures/skill-two-bed/plan.json', 'utf8'))

it('arrays that may be empty load as [] with a warning naming them', () => {
  const v = sample(); delete v.changes; delete v.questions
  const r = parsePlanText(JSON.stringify(v))
  expect(r.issues.filter(i => i.level === 'error')).toEqual([])
  expect(r.plan.changes).toEqual([]); expect(r.plan.questions).toEqual([])
  expect(r.issues.filter(i => i.code === 'missing-array').map(i => i.message)).toEqual(['方案里没写 questions，已按空数组 [] 载入', '方案里没写 changes，已按空数组 [] 载入'])
})
it('other shape problems are named one by one instead of a generic error', () => {
  const v = sample(); delete v.walls; v.openings = {}; v.version = '3'
  const [issue] = parsePlanText(JSON.stringify(v)).issues
  expect(issue.code).toBe('parse')
  for (const part of ['version 应为 3（现在是 "3"）', '缺 walls 数组（没有就写 []）', 'openings 应为数组（现在是 {}）']) expect(issue.message).toContain(part)
})
