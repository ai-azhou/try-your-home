import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
const root = path.resolve(import.meta.dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const legal = ['NOTICE', 'LICENSE', 'LICENSE-docs.md', 'THIRD-PARTY-NOTICES.md'].map(p => `${p}\n\n${read(p)}`).join('\n\n')
const html = read('dist/index.html').replace('</body>', `<template id="distribution-licenses"><pre>${escape(legal)}</pre></template>\n</body>`)
for (const file of ['dist/index.html', 'try-your-home.html']) fs.writeFileSync(path.join(root, file), html)
const bytes = Buffer.from(html)
const sha = createHash('sha256').update(bytes).digest('hex')
fs.writeFileSync(path.join(root, 'SHA256SUMS'), `${sha}  try-your-home.html\n`)
console.log(`try-your-home.html: ${bytes.length} bytes; SHA-256 ${sha}`)
