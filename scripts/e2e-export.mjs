// 改造清单导出 e2e：node scripts/e2e-export.mjs   （先 npm run build；或 E2E_HTML=<别的单文件产物> 指向另一份构建）
// 本机 Chrome 无头（puppeteer-core，跑完自己关；不起任何服务，直接 file:// 打开单文件产物）。
// 载入示例方案（自带 5 条改造），再加 10 条凑到 15 条，导出 PDF，断言：
//   1. 没有改造记录时入口置灰、提示「还没有改造记录」；
//   2. 文件生成，文件名 <方案标题>-改造清单-<YYYYMMDD>.pdf；
//   3. PDF 页数 = 封面 + 总览 + core paginate 页数（Node 里用 core 独立复算一遍）；打开「原始结构页」再多 1 页；
//   4. 同一页内图上序号的位置两两间距 ≥ 纸面 10mm；
//   5. 运行时零网络请求。
// 每页整页 PNG 存到 .shots/S2b/（从页面画布直接取，导出前就是这些画布）。只用公开示例数据。
import puppeteer from 'puppeteer-core'
import { chromePath } from './browser-path.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { changeFocus, paginate } from '../src/core/pagination.ts'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, process.env.E2E_OUT ?? '.shots/D5/export')
const downloads = path.join(out, 'downloads')
const profile = path.join(out, '.chrome')
for (const d of [downloads, profile]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }
const html = path.resolve(process.env.E2E_HTML ?? path.join(root, 'dist/index.html'))
if (!fs.existsSync(html)) { console.error(`没有 ${html}：先运行 npm run build`); process.exit(1) }
const W = 1440, H = 900
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = [], errors = [], external = []
const assert = (c, msg) => { if (!c) throw new Error(msg) }

/** 在示例方案上再加 10 条：立面（窗高、门换类型、墙改矮墙、梁底）、3D（层高、飘窗台）、平面（开窗、封门、拆玻璃隔断、加衣帽间隔墙） */
const EXTRA = [
  { id: 'c6', op: 'update', type: 'opening', target: 'o-bath-win', data: { sill: 1.2, head: 2.3 }, note: '卫生间高窗往下放一点，站着能看到外面', by: 'user', status: 'confirmed', confirm: { by: '业主' } },
  { id: 'c7', op: 'update', type: 'room', target: 'r-bath', data: { ceiling: 2.45 }, note: '卫生间吊顶压到 2.45，藏排风管', by: 'user', status: 'confirmed' },
  { id: 'c8', op: 'update', type: 'wall', target: 'w-bar', data: { kind: 'half', lowHeight: 1.05 }, note: '吧台上面的玻璃不要了，只留 1.05m 的矮墙当吧台', by: 'user', status: 'confirmed' },
  { id: 'c9', op: 'remove', type: 'opening', target: 'o-k', note: '厨房推拉门先拆掉，做成开放厨房', by: 'user', status: 'confirmed' },
  { id: 'c10', op: 'add', type: 'opening', data: { id: 'o-west', wall: 'w-w', offset: 4400, width: 1200, kind: 'window', sill: 0.9, head: 2.4 }, note: '客厅西墙想开一扇窗，下午有光', by: 'user', status: 'confirmed', confirm: { by: '业主' } },
  { id: 'c11', op: 'update', type: 'beam', target: 'b-1', data: { bottom: 2.6 }, note: '量过了，客厅梁底大概 2.60', by: 'user', status: 'confirmed' },
  { id: 'c12', op: 'update', type: 'room', target: 'r-bay', data: { floorOffset: 0.3 }, note: '飘窗台想降到 30cm，当坐榻', by: 'agent', status: 'pending' },
  { id: 'c13', op: 'add', type: 'wall', data: { id: 'w-closet', a: [8200, 720], b: [8200, 3540], thickness: 100, kind: 'partition', name: '衣帽间隔墙' }, note: '主卧东边隔出一个衣帽间', by: 'user', status: 'confirmed' },
  { id: 'c14', op: 'update', type: 'opening', target: 'o-master-win', data: { kind: 'floor-window', sill: 0.05, head: 2.5 }, note: '主卧侧窗改成落地窗', by: 'agent', status: 'pending' },
  { id: 'c15', op: 'remove', type: 'wall', target: 'w-k', note: '厨房玻璃隔断也拆掉，客餐厅和厨房连成一片', by: 'user', status: 'confirmed' },
]

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  userDataDir: profile,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`],
})
async function step(name, page, fn) {
  const t0 = Date.now()
  try { const note = await fn(); results.push({ name, ok: true, note: note ?? '', ms: Date.now() - t0 }); console.log(`✔ ${name}${note ? ' — ' + note : ''}`) }
  catch (e) { results.push({ name, ok: false, note: e.message, ms: Date.now() - t0 }); console.log(`✘ ${name} — ${e.message}`); await page.screenshot({ path: path.join(out, `FAIL-${results.length}.png`) }).catch(() => {}) }
}
const waitReady = page => page.waitForFunction(() => { const b = document.querySelector('[data-testid=export-download]'); const s = document.querySelector('[data-testid=export-status]')?.textContent ?? ''; return b && !b.disabled && !/正在/.test(s) }, { timeout: 180000 })
const waitFile = async (before, ms = 60000) => {
  for (let t = 0; t < ms; t += 250) {
    const f = fs.readdirSync(downloads).filter(f => f.endsWith('.pdf') && !before.includes(f))
    if (f.length && !fs.readdirSync(downloads).some(x => x.endsWith('.crdownload'))) return f[0]
    await sleep(250)
  }
  throw new Error('等不到 PDF 下载')
}
const pdfPages = file => (fs.readFileSync(file, 'latin1').match(/\/Type\s*\/Page(?!s)/g) ?? []).length

let page
try {
  page = await browser.newPage()
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true })
  page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`) })
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`))
  page.on('request', r => { const u = r.url(); if (!/^(file:|data:|blob:)/.test(u)) external.push(u) })
  await page.goto(pathToFileURL(html).href + '?state=renovation', { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => !!window.__fss?.store.getState().base, { timeout: 30000 })

  await step('1 没有改造记录时入口置灰', page, async () => {
    const saved = await page.evaluate(() => window.__fss.store.getState().base.changes.length)
    // D5：有装修层时也能导出（只有装修想法），所以这里连装修层一起清掉
    await page.evaluate(() => { const s = window.__fss.store; s.setState({ base: { ...s.getState().base, changes: [], decor: undefined } }) })
    await sleep(400)
    const st = await page.$eval('[data-testid=export-changes]', b => ({ disabled: b.disabled, text: b.textContent }))
    assert(st.disabled, '按钮没置灰')
    assert(st.text.includes('还没有改造记录'), `提示不对：${st.text}`)
    await page.screenshot({ path: path.join(out, 'panel-0-empty.png') })
    return `示例自带 ${saved} 条；清空后置灰`
  })

  let base
  await step('2 载入示例方案并凑到 15 条改造', page, async () => {
    // 重新载入示例（state=renovation 的演示方案），再追加 EXTRA
    await page.goto(pathToFileURL(html).href + '?state=renovation', { waitUntil: 'load' })
    await page.waitForFunction(() => !!window.__fss?.store.getState().base)
    const n0 = await page.evaluate(() => window.__fss.store.getState().base.changes.length)
    assert(n0 === 5, `示例方案应自带 5 条改造，实际 ${n0}`)
    await page.evaluate(extra => { const s = window.__fss.store; const b = s.getState().base; s.setState({ base: { ...b, changes: [...b.changes, ...extra] } }) }, EXTRA)
    base = await page.evaluate(() => window.__fss.store.getState().base)
    const bad = await page.evaluate(() => window.__fss.getView().results.filter(r => !r.ok).map(r => `${r.id}${r.needsConfirm ? '(待二次确认)' : ':' + r.error}`))
    await sleep(300)
    await page.screenshot({ path: path.join(out, 'panel-1-changes-card.png') })
    return `${base.changes.length} 条；重放未执行：${bad.join('、') || '无'}`
  })

  let info
  await step('3 打开导出面板，预览页数和缩略图', page, async () => {
    await page.click('[data-testid=export-changes]')
    await page.waitForSelector('[data-testid=export-panel]')
    await waitReady(page)
    info = await page.evaluate(() => ({ ...window.__fssExport, png: undefined }))
    const count = await page.$eval('[data-testid=export-page-count]', e => e.textContent)
    const thumbs = await page.$$eval('[data-testid=export-thumbs] img', l => l.length)
    assert(+count === info.pages.length, `面板页数 ${count} ≠ ${info.pages.length}`)
    assert(thumbs === info.pages.length, `缩略图 ${thumbs} 张 ≠ ${info.pages.length}`)
    await page.screenshot({ path: path.join(out, 'panel-2-preview.png') })
    return `${info.pages.length} 页（paginate ${info.paginate} 页），默认不含原始结构页、含 3D 页`
  })

  const isDecor = p => p.kind.startsWith('decor-')
  await step('4 页数 = 封面 + 总览 + paginate（Node 里用 core 复算）+ 装修想法几页', page, async () => {
    const pages = paginate(changeFocus(base, base.changes), info.paginateOpts)
    const struct = info.pages.filter(p => !isDecor(p))
    assert(pages.length === info.paginate, `core 复算 paginate ${pages.length} 页 ≠ 页面里 ${info.paginate} 页`)
    assert(struct.length === 2 + pages.length, `结构页数 ${struct.length} ≠ 2 + ${pages.length}`)
    assert(info.pages[0].kind === 'cover' && info.pages[1].kind === 'overview' && struct.slice(2).every(p => p.kind === 'detail'), '页序不对')
    assert(info.pages.findIndex(isDecor) === struct.length, '装修页应接在结构页后面')
    const views = pages.map(p => p.view).join(' ')
    return `paginate ${pages.length} 页：${views}`
  })

  await step('5 同一页内序号两两间距 ≥ 10mm', page, async () => {
    const gap = info.minGapPx, worst = []
    info.pages.forEach((p, i) => {
      const pts = p.badges.flat()
      let m = Infinity
      for (let a = 0; a < pts.length; a++) for (let b = a + 1; b < pts.length; b++) m = Math.min(m, Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y))
      if (pts.length > 1) worst.push(`${i + 1}:${m.toFixed(0)}`)
      assert(!(m < gap - 0.5), `第 ${i + 1} 页序号最近只有 ${m.toFixed(1)}px（阈值 ${gap.toFixed(1)}px）`)
    })
    // 每条改造在细节页里恰好出现一次
    const seen = info.pages.slice(2).filter(p => !isDecor(p)).flatMap(p => p.badges[p.badges.length - 1].map(b => b.n))
    const want = info.items.map(i => i.n)
    assert(want.every(n => seen.includes(n)), `细节页缺序号：${want.filter(n => !seen.includes(n))}`)
    return `阈值 ${gap.toFixed(1)}px（页面 px，1123 宽）；各页最近：${worst.join(' ')}；总览${info.pages[1].regions ? '只标区域' : '逐条标号'}`
  })

  await step('5b 装修想法：总览、每个房间一块、材料表、需要专业确认；序号接在结构后面；口吻和事实', page, async () => {
    const d = info.decor
    assert(d && d.items.length > 0, '没有装修想法')
    const kinds = info.pages.filter(isDecor).map(p => p.kind)
    assert(kinds[0] === 'decor-overview' && kinds.includes('decor-room') && kinds.includes('decor-materials') && kinds.at(-1) === 'decor-pro', `装修页序：${kinds.join(',')}`)
    const maxStruct = Math.max(...info.items.map(i => i.n)), nums = d.items.map(i => i.n).sort((a, b) => a - b)
    assert(nums[0] === maxStruct + 1 && nums.every((n, i) => n === nums[0] + i), `装修序号应从 ${maxStruct + 1} 连续编：${nums.join(',')}`)
    // 每一项都在它那一页的图上出现
    for (const it of d.items) {
      const pg = info.pages[it.page - 1]
      assert(pg?.kind === 'decor-room', `${it.id} 的页码 ${it.page} 不是房间页`)
      assert(pg.badges.flat().some(b => b.n === it.n), `${it.id}（${it.n}）没标在第 ${it.page} 页的图上`)
    }
    // 受保护墙上的嵌入进「需要专业确认」，只写事实
    const pro = d.items.filter(i => i.protect)
    assert(pro.some(i => i.id === 'cab-tall-1') && pro.every(i => /外墙|承重墙/.test(i.protect) && /墙厚/.test(i.protect)), `需要专业确认：${JSON.stringify(pro.map(i => i.protect))}`)
    const allText = JSON.stringify(d.items) + info.pages.map(p => p.title).join('')
    assert(!/给设计师|危险|禁止|不建议/.test(allText), '装修页出现了不该有的说法')
    const cab = d.items.find(i => i.id === 'cab-tall-1')
    assert(cab && cab.lines.some(l => /嵌进墙里 120 mm/.test(l)) && cab.lines.some(l => /宽 600/.test(l)), `柜子文字：${JSON.stringify(cab?.lines)}`)
    return `装修 ${d.items.length} 项（${nums[0]}–${nums.at(-1)}），${kinds.length} 页：${kinds.join(' ')}；需要专业确认 ${pro.length} 项`
  })

  await step('6 每页存 PNG', page, async () => {
    for (const f of fs.readdirSync(out).filter(f => /^page-\d+\.png$/.test(f))) fs.rmSync(path.join(out, f))
    for (let i = 0; i < info.pages.length; i++) {
      const url = await page.evaluate(i => window.__fssExport.png(i), i)
      fs.writeFileSync(path.join(out, `page-${String(i + 1).padStart(2, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'))
    }
    return `${info.pages.length} 张 → ${path.relative(root, out)}/page-XX.png`
  })

  let pdf1
  await step('7 生成并下载 PDF，文件名、页数', page, async () => {
    const before = fs.readdirSync(downloads)
    await page.click('[data-testid=export-download]')
    await page.waitForFunction(() => /已下载/.test(document.querySelector('[data-testid=export-status]')?.textContent ?? ''), { timeout: 120000 })
    const f = await waitFile(before)
    pdf1 = path.join(downloads, f)
    const d = new Date(), ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    assert(f === `示例·虚构两室-改造清单-${ymd}.pdf`, `文件名不对：${f}`)
    const n = pdfPages(pdf1), size = fs.statSync(pdf1).size
    assert(n === info.pages.length, `PDF ${n} 页 ≠ ${info.pages.length}`)
    assert(fs.readFileSync(pdf1, 'latin1').startsWith('%PDF-'), '不是 PDF')
    fs.copyFileSync(pdf1, path.join(out, 'sample.pdf'))
    fs.rmSync(pdf1) // 同名文件第二次下载会覆盖，先挪走
    await page.screenshot({ path: path.join(out, 'panel-3-done.png') })
    return `${f}：${n} 页，${(size / 1024 / 1024).toFixed(1)} MB → .shots/S2b/sample.pdf`
  })

  await step('8 打开「包含原始结构页」、关掉「包含 3D 页」再导出', page, async () => {
    await page.click('[data-testid=export-opt-original]')
    await page.click('[data-testid=export-opt-3d]')
    await sleep(200)
    await waitReady(page)
    const i2 = await page.evaluate(() => ({ ...window.__fssExport, png: undefined }))
    assert(i2.opts.original && !i2.opts.threeD, '开关没生效')
    assert(i2.pages.filter(p => !isDecor(p)).length === 3 + info.paginate, `结构页数 ${i2.pages.filter(p => !isDecor(p)).length} ≠ 3 + ${info.paginate}`)
    assert(i2.pages[2].kind === 'original', '第 3 页不是原始结构页')
    for (const f of fs.readdirSync(out).filter(f => /^alt-page-\d+\.png$/.test(f))) fs.rmSync(path.join(out, f))
    for (let i = 0; i < i2.pages.length; i++) {
      const url = await page.evaluate(i => window.__fssExport.png(i), i)
      fs.writeFileSync(path.join(out, `alt-page-${String(i + 1).padStart(2, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'))
    }
    const before = fs.readdirSync(downloads)
    await page.click('[data-testid=export-download]')
    await page.waitForFunction(() => /已下载/.test(document.querySelector('[data-testid=export-status]')?.textContent ?? ''), { timeout: 120000 })
    const f = await waitFile(before)
    const n = pdfPages(path.join(downloads, f))
    assert(n === i2.pages.length, `PDF ${n} 页 ≠ ${i2.pages.length}`)
    fs.copyFileSync(path.join(downloads, f), path.join(out, 'sample-original-no3d.pdf'))
    return `${n} 页（多一页原始结构；3D 页换成剖面）→ alt-page-XX.png、sample-original-no3d.pdf`
  })

  await step('9 文件菜单里也有入口', page, async () => {
    await page.keyboard.press('Escape')
    await sleep(300)
    await page.click('[data-testid=file-menu]')
    await page.waitForSelector('[data-testid=menu-export-changes]')
    const dis = await page.$eval('[data-testid=menu-export-changes]', e => e.hasAttribute('data-disabled'))
    assert(!dis, '有改造时菜单项不该置灰')
    await page.screenshot({ path: path.join(out, 'panel-4-file-menu.png') })
    await page.click('[data-testid=menu-export-changes]')
    await page.waitForSelector('[data-testid=export-panel]')
    return '菜单项可点，点了打开同一个面板'
  })

  await step('10 运行时零网络请求、无报错', page, async () => {
    assert(!external.length, `外部请求：${external.slice(0, 5).join(', ')}`)
    const errs = errors.filter(e => !/WebGL|GPU stall|GL_/.test(e))
    assert(!errs.length, errs.slice(0, 3).join(' | '))
    return '0 个外部请求'
  })
} finally {
  await browser.close()
}
fs.writeFileSync(path.join(out, 'e2e-results.json'), JSON.stringify({ results, errors, external }, null, 2))
const bad = results.filter(r => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} 通过`)
process.exit(bad.length ? 1 : 0)
