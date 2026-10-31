/** 手册装修篇的例子必须真能跑通：按顺序喂给 decor-edit，改了手册或命令都会在这里露出来。 */
import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const manual = 'docs/agent手册/装修.md', sample = 'fixtures/skill-two-bed/plan.json'
describe.skipIf(!existsSync(manual) || !existsSync(sample))('装修篇例子', () => {
  it('每个补丁都能写入，最后没有 error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'decor-manual-')), plan = join(dir, 'plan.json'), patch = join(dir, 'patch.json')
    copyFileSync(sample, plan)
    const blocks = [...readFileSync(manual, 'utf8').matchAll(/```json\n([\s\S]*?)```/g)].map(m => m[1]).filter(b => b.includes('"ops"'))
    expect(blocks.length).toBeGreaterThan(10)
    for (const block of blocks) {
      writeFileSync(patch, block)
      const r = spawnSync('node', ['scripts/plan.ts', 'decor-edit', plan, patch], { encoding: 'utf8' })
      expect(r.status, `${block.slice(0, 200)}\n${r.stderr}`).toBe(0)
    }
    const decor = spawnSync('node', ['scripts/plan.ts', 'decor', plan], { encoding: 'utf8' })
    expect(decor.status).toBe(0)
    expect(JSON.parse(decor.stdout).issues.filter((i: { level: string }) => i.level === 'error')).toEqual([])
  }, 60000)
})
