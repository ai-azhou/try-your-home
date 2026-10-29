// Bundle the shared structural core; only Node built-ins remain external.
import { defineConfig } from 'vite'
import { execFileSync } from 'node:child_process'
import { relative, resolve } from 'node:path'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
const coreCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
// Name uncommitted core/CLI sources honestly in the banner instead of a hand-written note.
const dirty = execFileSync('git', ['status', '--porcelain', '--', 'src/core', 'scripts/plan.ts', 'schema', 'package.json'], { encoding: 'utf8' }).split('\n').filter(Boolean).map(l => l.slice(3)).filter(f => !f.endsWith('.test.ts')).sort()
export default defineConfig({
  plugins: [{ name: 'cli-schema-snapshot', load(id) {
    if (id !== resolve('schema/generate.ts')) return
    const scratch = mkdtempSync(resolve('../发布/_internal/schema-'))
    try {
      mkdirSync(resolve(scratch, 'schema'))
      execFileSync(process.execPath, [resolve('schema/generate.ts')], { cwd: scratch })
      const schema = readFileSync(resolve(scratch, 'schema/plan.schema.json'), 'utf8')
      return `import { mkdirSync, writeFileSync } from 'node:fs'; mkdirSync('schema', {recursive:true}); writeFileSync('schema/plan.schema.json', ${JSON.stringify(schema)});`
    } finally { rmSync(scratch, { recursive: true, force: true }) }
  } }, { name: 'cli-metafile', generateBundle(_options, bundle) {
    const inputs: Record<string, { renderedLength: number }> = {}
    const outputs: Record<string, unknown> = {}
    for (const [file, chunk] of Object.entries(bundle)) if (chunk.type === 'chunk') {
      const modules: Record<string, { renderedLength: number }> = {}
      for (const [id, data] of Object.entries(chunk.modules)) {
        const key = relative(process.cwd(), id.replace(/^\0/, '')).replaceAll('\\', '/')
        modules[key] = { renderedLength: data.renderedLength }; inputs[key] = modules[key]
      }
      outputs[file] = { inputs: modules, imports: chunk.imports, dynamicImports: chunk.dynamicImports }
    }
    this.emitFile({ type: 'asset', fileName: 'plan-cli.metafile.json', source: JSON.stringify({ bundler: 'vite/rolldown generateBundle', coreCommit, inputs, outputs }, null, 2) + '\n' })
  } }],
  build: { ssr: 'scripts/plan.ts', outDir: 'cli-dist', emptyOutDir: true, target: 'node20', minify: false,
    rollupOptions: { output: { format: 'es', entryFileNames: 'plan-cli.mjs', codeSplitting: false,
      banner: `// Shared core base git commit: ${coreCommit}; ${dirty.length ? `plus uncommitted changes in ${dirty.join(', ')}` : 'no uncommitted core changes'}.\n// Third-party licenses: see THIRD-PARTY-NOTICES.md distributed with this Skill.` } } },
  ssr: { noExternal: true, target: 'node' },
})
