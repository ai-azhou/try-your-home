import type { Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/** Capture emitted modules before the single-file plugin consumes JS/CSS chunks. */
export function bundleInventory(): Plugin {
  let root = ''
  return {
    name: 'try-your-home-bundle-inventory',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) { root = config.root },
    generateBundle: {
      order: 'pre',
      handler(_options, bundle) {
        const relative = (id: string) => id.replaceAll('\\', '/').replace(root.replaceAll('\\', '/') + '/', '')
        const modules = Object.values(bundle).filter(x => x.type === 'chunk').flatMap(chunk =>
          Object.entries(chunk.modules).filter(([, m]) => m.renderedLength > 0).map(([id, m]) => ({ id: relative(id), renderedLength: m.renderedLength })))
        const assets: { id: string; bytes: number; sha256: string }[] = []
        fs.mkdirSync(path.join(root, 'docs/build'), { recursive: true })
        fs.writeFileSync(path.join(root, 'docs/build/web-modules.json'), JSON.stringify({ source: 'Vite/Rolldown generateBundle: rendered chunk.modules; CSS asset bytes verified in emitted output', modules: modules.sort((a,b) => a.id.localeCompare(b.id)), assets }, null, 2) + '\n')
      },
    },
    closeBundle() {
      const metadataFile = path.join(root, 'docs/build/web-modules.json')
      const htmlFile = path.join(root, 'dist/index.html')
      if (!fs.existsSync(metadataFile) || !fs.existsSync(htmlFile)) return
      const meta = JSON.parse(fs.readFileSync(metadataFile, 'utf8'))
      const html = fs.readFileSync(htmlFile, 'utf8')
      const files = fs.readdirSync(path.join(root, 'src'), { recursive: true }).map(String).filter(p => p.endsWith('.css'))
      for (const cssPath of files) {
        const id = path.join(root, 'src', cssPath)
        for (const match of fs.readFileSync(id, 'utf8').matchAll(/url\(["']?([^\s"')]+)["']?\)/g)) {
          const file = path.resolve(path.dirname(id), match[1])
          if (!fs.existsSync(file) || !/\.(woff2?|ttf|otf)$/.test(file)) continue
          const bytes = fs.readFileSync(file)
          if (html.includes(bytes.toString('base64'))) meta.assets.push({ id: path.relative(root, file).replaceAll('\\', '/'), bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') })
        }
      }
      meta.embeddedFontCount = [...html.matchAll(/data:(?:font\/[^;,]+|application\/(?:font-woff|x-font-ttf|vnd.ms-fontobject));base64,/g)].length
      if (meta.embeddedFontCount !== meta.assets.length) throw new Error('Unattributed embedded font: inspect output and update inventory')
      fs.writeFileSync(metadataFile, JSON.stringify(meta, null, 2) + '\n')
    },
  }
}
