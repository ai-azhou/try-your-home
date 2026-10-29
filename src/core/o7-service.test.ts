import { expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { createHash } from 'node:crypto'
import { emptyPlan, serializePlan } from './io.ts'
import { loadServed, saveServed, startPolling } from '../ui/actions.ts'
import { useStore } from '../ui/store.ts'

// O7_BEFORE=1 runs the identical HTTP/UI workflow with the pre-fix assertions.
it('O7: bad file → read → poll → Save; preserves every original byte', async () => {
  const before = process.env.O7_BEFORE === '1'
  const directory = mkdtempSync(join(tmpdir(), 'floorplan-o7-')), file = join(directory, 'plan.json')
  const p = emptyPlan(); p.walls = [{ id: 'w', a: [0, 0], b: [3000, 0], thickness: 120, kind: 'partition' }]
  const good = serializePlan(p), bad = good.replace('"thickness": 120', '"thickness": 120, "heigth": 2800')
  writeFileSync(file, good)
  const reserve = createServer()
  await new Promise<void>(r => reserve.listen(0, '127.0.0.1', r))
  const port = (reserve.address() as { port: number }).port
  await new Promise<void>(r => reserve.close(() => r()))
  const child = spawn(process.execPath, ['scripts/serve.mjs', directory, String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
  let err = '', output = '', stop: (() => void) | undefined
  child.stderr.on('data', c => { err += c })
  const saved = useStore.getState(), realFetch = globalThis.fetch
  const url = `http://127.0.0.1:${port}`
  const requests: string[] = []
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => { requests.push(init?.method ?? 'GET'); return realFetch(new URL(input, url), init) })
  vi.stubGlobal('location', { search: '?plan=plan.json' })
  let tick: () => Promise<void> = async () => {}
  vi.stubGlobal('setInterval', (fn: typeof tick) => { tick = fn; return 1 })
  vi.stubGlobal('clearInterval', () => {})
  try {
    await new Promise<void>((res, rej) => {
      const timer = setTimeout(() => rej(Error('service timeout ' + err)), 5000)
      child.once('exit', code => { clearTimeout(timer); rej(Error('service exit ' + code + ' ' + err)) })
      child.stdout.on('data', c => { output += c; if (output.includes('打开：')) { clearTimeout(timer); res() } })
    })
    expect(await loadServed('plan.json')).toBe(true)
    const previous = useStore.getState().base, oldEtag = useStore.getState().source.etag!
    writeFileSync(file, bad)
    expect(await loadServed('plan.json')).toBe(before)
    stop = startPolling('plan.json')
    await tick(); await tick()
    expect(await saveServed()).toBe(before)
    const bytes = readFileSync(file)
    const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex')
    if (before) {
      expect(JSON.parse(bytes.toString()).walls).toEqual([])
      expect(bytes.equals(Buffer.from(bad))).toBe(false)
    } else {
      expect(useStore.getState().base).toBe(previous)
      expect(bytes.equals(Buffer.from(bad))).toBe(true)
      expect(requests).not.toContain('POST')
      // Bypass UI: both a schema error and the old parser's empty fallback must be refused.
      const geometry = structuredClone(p); geometry.walls[0].b = [0, 0]
      const conflict = await realFetch(url + '/save?plan=plan.json', { method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': oldEtag }, body: good })
      expect(conflict.status).toBe(409)
      expect(readFileSync(file).equals(Buffer.from(bad))).toBe(true)
      for (const body of [bad, serializePlan(emptyPlan()), serializePlan(geometry)]) {
        const res = await realFetch(url + '/save?plan=plan.json', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
        expect(res.status).toBe(400)
        expect(await res.text()).toMatch(/拒绝|错误/)
        expect(readFileSync(file).equals(Buffer.from(bad))).toBe(true)
      }
      // A repaired file can load and save again.
      writeFileSync(file, good)
      expect(await loadServed('plan.json')).toBe(true)
      expect(await saveServed()).toBe(true)
      expect(JSON.parse(readFileSync(file, 'utf8')).walls).toHaveLength(1)
    }
    const evidence = JSON.stringify({ phase: before ? 'before' : 'after', originalSha256: hash(bad), savedSha256: hash(bytes), byteIdentical: bytes.equals(Buffer.from(bad)), wallsAfterSave: JSON.parse(bytes.toString()).walls.length })
    writeFileSync(join(tmpdir(), `o7-${before ? 'before' : 'after'}-evidence.json`), evidence + '\n')
    console.log(evidence)
  } finally {
    stop?.(); useStore.setState(saved, true); vi.unstubAllGlobals()
    if (child.exitCode === null) { const exited = new Promise<void>(r => child.once('exit', () => r())); child.kill('SIGTERM'); await exited }
    rmSync(directory, { recursive: true, force: true })
  }
}, 15000)
