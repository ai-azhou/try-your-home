import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { mockPlan } from '../ui/mock.ts'
import { exportPlan, openPlanText, saveServed } from '../ui/actions.ts'
import { useStore } from '../ui/store.ts'
import { parsePlanText, serializePlan } from './io.ts'
import { loadError, planWriteError } from './persistence.ts'
import { decorPlan, niche } from './decor/fixtures.ts'
import { decorStatus } from './decor/resolve.ts'

const initial = useStore.getState()
afterEach(() => { useStore.setState(initial); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function orphanPlan() {
  const p = decorPlan()
  p.decor!.recesses = [niche()]
  p.changes = [{ id: 'remove-wall', op: 'remove', type: 'wall', target: 'w', by: 'user', status: 'confirmed' }]
  return p
}
it.each(['mock', 'orphan'])('%s loads directly and from JSON, saves and exports with placement errors intact', async kind => {
  vi.useFakeTimers()
  const p = kind === 'mock' ? structuredClone(mockPlan) : orphanPlan()
  const parsed = parsePlanText(serializePlan(p))
  expect(parsed.issues.some(i => i.level === 'error' && i.code === 'decor-host-missing')).toBe(true)
  expect(decorStatus(p).items.some(i => i.status === 'missing')).toBe(true)
  expect(loadError(parsed.issues)).toBeNull()
  expect(planWriteError(p)).toBeNull()
  useStore.getState().loadPlan(p, { kind: 'served' })
  expect(useStore.getState().base).toBe(p)
  expect(useStore.getState().loadFailure).toBeNull()
  expect(openPlanText(serializePlan(p), { kind: 'served' })).toBe(true)
  const fetch = vi.fn(async () => new Response('ok', { headers: { etag: 'saved' } }))
  vi.stubGlobal('fetch', fetch)
  vi.stubGlobal('location', { search: '?plan=plan.json' })
  expect(await saveServed()).toBe(true)
  expect(fetch).toHaveBeenCalledWith('/save?plan=plan.json', expect.objectContaining({ method: 'POST' }))
  const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
  vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { appendChild: vi.fn() } })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
  exportPlan()
  expect(anchor.click).toHaveBeenCalledOnce()
})
it.each(['host-missing', 'host-cut', 'out-of-face', 'too-deep', 'wall-kind', 'over-opening', 'through-wall', 'meet-other-side', 'into-shaft', 'host-depth', 'protected', 'room-missing', 'arc-unsupported'])('allows decor-%s even at error level, without suppressing structural errors', code => {
  const issue = { code: `decor-${code}`, level: 'error' as const, message: code }
  expect(loadError([issue])).toBeNull()
  expect(loadError([issue, { code: 'wall-geometry', level: 'error', message: 'bad wall' }])).toContain('bad wall')
})
it.each(['invalid', 'duplicate-id', 'material-missing'])('still blocks malformed decor data: %s', code => {
  const p = orphanPlan()
  if (code === 'invalid') p.decor!.style = 'unknown-style'
  if (code === 'duplicate-id') p.decor!.recesses[0].id = p.decor!.materials[0].id
  if (code === 'material-missing') p.decor!.recesses[0].back = 'unknown-material'
  const parsed = parsePlanText(serializePlan(p))
  expect(parsed.issues.some(i => i.code === `decor-${code}`)).toBe(true)
  expect(loadError(parsed.issues)).not.toBeNull()
  expect(planWriteError(p)).not.toBeNull()
  expect(openPlanText(serializePlan(p), { kind: 'file' })).toBe(false)
})
it('all bundled public fixtures pass the load guard', () => {
  const visit = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).filter(e => e.name !== 'private').flatMap(e => e.isDirectory() ? visit(join(dir, e.name)) : e.name.endsWith('.json') ? [join(dir, e.name)] : [])
  const files = visit('fixtures')
  expect(files.length).toBeGreaterThan(0)
  for (const file of files) expect(loadError(parsePlanText(readFileSync(file, 'utf8')).issues), file).toBeNull()
})
