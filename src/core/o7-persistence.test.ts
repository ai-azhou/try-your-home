import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { mockPlan } from '../ui/mock.ts'
import { exportPlan, loadServed, openPlanText, readAutosave, saveServed, startAutosave, startPolling } from '../ui/actions.ts'
import { useStore } from '../ui/store.ts'
import { emptyPlan, parsePlanText, planFileValue, serializePlan } from './io.ts'
import { validatePlan } from './validate.ts'
import { validatePlanFile } from './schema.ts'
import { planWriteError } from './persistence.ts'

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
function plan() {
  const p = emptyPlan(); p.walls = [{ id: 'w', a: [0, 0], b: [3000, 0], thickness: 120, kind: 'partition' }]
  return p
}
it('UI example and every non-private JSON fixture round-trip with zero schema errors', () => {
  const visit = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).filter(e => e.name !== 'private').flatMap(e => e.isDirectory() ? visit(join(dir, e.name)) : e.name.endsWith('.json') ? [join(dir, e.name)] : [])
  for (const p of [mockPlan, ...visit('fixtures').map(f => {
    const parsed = parsePlanText(readFileSync(f, 'utf8'))
    expect(parsed.issues.filter(i => i.code === 'schema' || i.code === 'parse'), f).toEqual([])
    return parsed.plan
  })]) {
    const parsed = parsePlanText(serializePlan(p))
    expect(parsed.issues.filter(i => i.code === 'schema' || i.code === 'parse')).toEqual([])
    expect(parsed.plan.walls).toEqual(p.walls)
  }
})
it('schema and runtime accept URL/base64 SVG consistently, including per-level underlays; still reject remote protocols', () => {
  const p = plan()
  p.underlay = { src: '', mmPerPx: 10, origin: [0, 0], opacity: 50, visible: true }
  for (const src of ['data:image/svg+xml,%3Csvg%2F%3E', 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/svg+xml;charset=utf-8;base64,PHN2Zy8+']) {
    p.underlay.src = src; p.levelUnderlays = { L1: { ...p.underlay } }
    expect(validatePlanFile(planFileValue(p))).toEqual([])
    expect(validatePlan(p)).toEqual([])
  }
  delete p.levelUnderlays
  for (const src of ['https://example.test/a.svg', '//example.test/a.svg', 'file:///a.svg', 'javascript:alert(1)', 'data:text/html,a', 'data:image/svg+xml,']) {
    p.underlay.src = src
    expect(validatePlanFile(planFileValue(p)).length).toBeGreaterThan(0)
    expect(validatePlan(p).some(i => i.code === 'underlay-remote')).toBe(true)
  }
})
it('schema/geometry failure preserves plan, history, selection, dirty state and source; direct store loads are guarded too', () => {
  vi.useFakeTimers()
  useStore.getState().loadPlan(plan(), { kind: 'served', file: '/plans/plan.json', etag: 'old' })
  useStore.setState({ dirty: true, sel: [{ type: 'wall', id: 'w' }] })
  const before = useStore.getState()
  const invalid = plan(); invalid.walls[0].b = [0, 0]
  for (const text of ['{', serializePlan(invalid), serializePlan(plan()).replace('"thickness": 120', '"thickness": 120,"typo":1')]) {
    expect(openPlanText(text, { kind: 'file', file: 'bad.json' })).toBe(false)
    const after = useStore.getState()
    for (const key of ['base', 'hist', 'sel', 'dirty', 'source'] as const) expect(after[key]).toBe(before[key])
    expect(after.notice?.text).toContain('没有载入')
  }
  useStore.getState().loadPlan(invalid)
  expect(useStore.getState().base).toBe(before.base)
  expect(useStore.getState().loadFailure).toBeTruthy()
  expect(openPlanText(serializePlan(plan()), { kind: 'file' })).toBe(true)
  expect(useStore.getState().loadFailure).toBeNull()
})
it.each([false, true])('polling rejects bad geometry once (dirty=%s), retains local changes, then offers/loads the repaired revision', async dirty => {
  vi.useFakeTimers()
  useStore.getState().loadPlan(plan(), { kind: 'served', file: '/plans/plan.json', etag: 'old' })
  useStore.setState({ dirty })
  const base = useStore.getState().base, invalid = plan(); invalid.walls[0].b = [0, 0]
  let text = serializePlan(invalid), etag = 'bad'
  vi.stubGlobal('fetch', vi.fn(async () => new Response(text, { headers: { etag } })))
  const notice = vi.spyOn(useStore.getState(), 'setNotice'), stop = startPolling('plan.json')
  try {
    await vi.advanceTimersByTimeAsync(6000)
    expect(notice).toHaveBeenCalledTimes(1)
    expect(useStore.getState().base).toBe(base)
    expect(useStore.getState().dirty).toBe(dirty)
    text = serializePlan({ ...plan(), title: 'repaired' }); etag = 'repaired'
    await vi.advanceTimersByTimeAsync(2000)
    if (dirty) {
      expect(useStore.getState().base).toBe(base)
      useStore.getState().notice!.actions[0].run()
    }
    expect(useStore.getState().base?.title).toBe('repaired')
    expect(useStore.getState().loadFailure).toBeNull()
  } finally { stop() }
})
it('empty/invalid/failed-load states cannot export, POST or overwrite the last autosave', async () => {
  vi.useFakeTimers()
  const key = 'floorplan-structure:autosave:v2', memory = new Map([[key, JSON.stringify({ plan: planFileValue(plan()) })]])
  const original = memory.get(key)
  vi.stubGlobal('localStorage', { getItem: (k: string) => memory.get(k), setItem: (k: string, v: string) => memory.set(k, v) })
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
  const document = { createElement: vi.fn() }; vi.stubGlobal('document', document)
  vi.stubGlobal('location', { search: '?plan=plan.json' })
  useStore.getState().loadPlan(plan(), { kind: 'served' })
  const stop = startAutosave()
  const invalid = plan(); invalid.walls[0].b = [0, 0]
  try {
    for (const p of [emptyPlan(), invalid, plan()]) {
      useStore.setState({ base: p, loadFailure: p === invalid || !p.walls.length ? null : 'failed' })
      await vi.advanceTimersByTimeAsync(500)
      exportPlan(); expect(await saveServed()).toBe(false)
      expect(memory.get(key)).toBe(original)
    }
    expect(fetch).not.toHaveBeenCalled(); expect(document.createElement).not.toHaveBeenCalled()
    memory.set(key, JSON.stringify({ plan: planFileValue(invalid) })); expect(readAutosave()).toBeNull()
    expect(planWriteError(plan())).toBeNull()
  } finally { stop() }
})
it('first served load failure can recover through polling without ever accepting an empty fallback', async () => {
  vi.useFakeTimers()
  useStore.getState().loadPlan(null)
  let text = '{', etag = 'bad'
  vi.stubGlobal('fetch', vi.fn(async () => new Response(text, { headers: { etag, 'x-plan-root': encodeURIComponent('/plans') } })))
  expect(await loadServed('first.json')).toBe(false)
  expect(useStore.getState().base).toBeNull()
  const stop = startPolling('first.json')
  try {
    await vi.advanceTimersByTimeAsync(2000)
    expect(useStore.getState().base).toBeNull()
    text = serializePlan(plan()); etag = 'good'
    await vi.advanceTimersByTimeAsync(2000)
    expect(useStore.getState().base?.walls).toHaveLength(1)
    expect(useStore.getState().source).toEqual({ kind: 'served', file: '/plans/first.json', etag: 'good' })
    expect(useStore.getState().loadFailure).toBeNull()
  } finally { stop() }
})
it('CLI convert refuses geometry errors and empty-over-nonempty before touching output bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'floorplan-o7-convert-')), input = join(dir, 'in.json'), output = join(dir, 'out.json')
  const original = serializePlan(plan()), invalid = plan(); invalid.walls[0].b = [0, 0]
  try {
    writeFileSync(output, original)
    for (const p of [emptyPlan(), invalid]) {
      writeFileSync(input, serializePlan(p))
      const result = spawnSync(process.execPath, ['scripts/plan.ts', 'convert', input, output], { encoding: 'utf8' })
      expect(result.status).toBe(1); expect(readFileSync(output, 'utf8')).toBe(original)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
