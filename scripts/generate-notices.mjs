// Inventory comes from emitted web modules, never from a hand-maintained dependency list.
import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const meta = JSON.parse(read('docs/build/web-modules.json'))
const supplements = JSON.parse(read('licenses/sources.json'))
const packageOf = id => {
  if (id === '\0rolldown/runtime.js') return 'rolldown'
  if (id.startsWith('\0vite/')) return 'vite'
  if (!id.includes('node_modules/')) return null
  const parts = id.split('node_modules/').pop().split('/')
  return parts.slice(0, parts[0].startsWith('@') ? 2 : 1).join('/')
}
const packages = new Map()
for (const item of [...meta.modules, ...meta.assets]) {
  const name = packageOf(item.id)
  if (name) packages.set(name, [...(packages.get(name) ?? []), item.id])
}
const rows = [], sections = [], records = []
for (const [name, ids] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const base = `node_modules/${name}`
  const pkg = JSON.parse(read(`${base}/package.json`))
  const blocks = new Map()
  for (const f of fs.readdirSync(path.join(root, base)).sort()) {
    if (/^(licen[sc]e|copying|copyrightnotice|notice|ofl)(\.|$)/i.test(f) && fs.statSync(path.join(root, base, f)).isFile()) {
      const txt = read(`${base}/${f}`).trim()
      blocks.set(txt, `${base}/${f}`)
    }
  }
  if (!blocks.size) {
    const s = supplements[name]
    if (!s || s.version !== pkg.version) throw new Error(`Missing pinned license: ${name}@${pkg.version}`)
    blocks.set(read(s.file).trim(), `${s.file} — ${s.url}`)
  }
  // Preserve embedded upstream notices (e.g. jsPDF image codecs, pako's zlib code).
  for (const id of ids) {
    const clean = id.replace(/\?.*$/, '')
    if (!clean.startsWith('node_modules/') || !/\.[cm]?js$/.test(clean) || !fs.existsSync(path.join(root, clean))) continue
    for (const m of read(clean).matchAll(/\/\*[\s\S]*?\*\//g)) {
      if (/copyright|\(c\)\s+\d{4}|permission is hereby granted|licensed under|@license/i.test(m[0])) blocks.set(m[0].trim(), clean)
    }
  }
  const text = [...blocks.keys()].join('\n\n')
  const copyright = [...new Set(text.split('\n').map(x => x.trim().replace(/^\*\s?/, '')).filter(x => /copyright\s*(?:\([cC]\)|\d)|^\([cC]\)\s*\d|^©/i.test(x) && !/permission notice|must retain|copyright holders|copyright owner|copyright and related/i.test(x)))]
  if (!copyright.length) throw new Error(`No copyright attribution found for ${name}; inspect upstream license`)
  rows.push(`| ${name} | ${pkg.version} | ${pkg.license} | ${copyright.map(x => x.replaceAll('|', '\\|').replaceAll('<', '&lt;').replaceAll('>', '&gt;')).join('<br>')} |`)
  sections.push(`## ${name} ${pkg.version}\n\n模块 / 资产：${ids.length} 个；精确路径见 web-modules.json。\n\n` + [...blocks].map(([txt, source]) => `来源：${source}\n\n\`\`\`text\n${txt}\n\`\`\`\n`).join('\n'))
  records.push({ name, version: pkg.version, license: pkg.license, copyright, modules: ids })
}
const legacy = read('licenses/floorplan-3d-MIT.txt').trim()
const markdown = `# Third-party notices\n\n由 scripts/generate-notices.mjs 生成。包范围来自本次 web 构建的 [模块与字体清单](docs/build/web-modules.json)，版本、许可及版权行从已安装的对应 npm 包提取。少数 npm 包未随附许可全文，使用 licenses/sources.json 中固定的上游原文；react-remove-scroll-bar 的发布包和发布提交均缺许可文件，其全文取自后续固定提交，版本本身的 package.json 声明 MIT。构建器注入的 Vite、Rolldown 运行时也计入。以下第三方组件保留各自许可，不适用本项目的非商业许可。\n\n| 包 | 版本 | 许可 | 原始版权行 |\n| --- | --- | --- | --- |\n${rows.join('\n')}\n\n## 字体\n\n实际嵌入 ${meta.assets.length} 个字体文件：${meta.assets.map(x => `\`${x.id}\`（${x.bytes} bytes，SHA-256 ${x.sha256}）`).join('、')}。Manrope 按 SIL OFL 1.1 使用。中文及其他系统字体只引用用户设备上的字体，不随本工具分发。jsPDF 的标准 PDF 字体度量代码归入 jsPDF 声明，不含额外字体文件。\n\n## 旧工具几何片段的归属\n\n旧工具源自 wy51ai/floorplan-3d（作者 wuyi，MIT）。发布前比对发现点到线段投影、多边形面积及包围盒等短片段高度相似；不能据此断言完全没有复用。保留原 MIT 声明，涉及 src/core/raster.ts、src/core/geometry.ts、src/ui/canvas2d/PlanCanvas.tsx、src/ui/panels/Inspector.tsx、src/ui/export/plan-draw.ts。旧项目未声明软件版本；归属原文随附于 licenses/floorplan-3d-MIT.txt。\n\n\`\`\`text\n${legacy}\n\`\`\`\n\n${sections.join('\n')}`
fs.writeFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), markdown)
fs.writeFileSync(path.join(root, 'docs/build/third-party-packages.json'), JSON.stringify(records, null, 2) + '\n')
console.log(`Generated notices for ${records.length} packages and ${meta.assets.length} embedded font(s).`)
