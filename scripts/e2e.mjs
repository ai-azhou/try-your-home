// 端到端：node scripts/e2e.mjs   （先 npm run build）
// 起 scripts/serve.mjs（记 PID，结束时只 kill 这个 PID）+ 本机 Chrome 无头（puppeteer-core，跑完自己关），
// 用真的鼠标键盘事件走一遍，每步断言并截图到 .shots/D2/。只读公开 fixtures。
import puppeteer from 'puppeteer-core'
import { chromePath } from './browser-path.mjs'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, '.shots/S2a')
// E2E_ONLY=S2a 只跑 S2a 新加的步骤（调试用；验收跑全部）
const ONLY = process.env.E2E_ONLY ?? ''
const served = path.join(out, 'served')
const downloads = path.join(out, 'downloads')
const profile = path.join(out, '.chrome')
for (const d of [served, downloads, profile]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }
const PORT = 5191, BASE = `http://127.0.0.1:${PORT}`
const W = 1440, H = 900

const results = []
const errors = [], external = []
const sleep = ms => new Promise(r => setTimeout(r, ms))

// ── 本地服务（只 kill 自己记下的 PID）──
const srv = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs'), served, String(PORT)], { stdio: ['ignore', 'pipe', 'pipe'] })
const srvPid = srv.pid
let srvOut = ''
srv.stdout.on('data', d => { srvOut += d })
srv.stderr.on('data', d => { srvOut += d })
for (let i = 0; i < 50 && !srvOut.includes('方案目录'); i++) await sleep(100)
console.log(`serve.mjs PID ${srvPid}\n${srvOut.trim()}`)

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  userDataDir: profile,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`],
})

function watch(page, tag) {
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${tag} console] ${m.text()}`) })
  page.on('pageerror', e => errors.push(`[${tag} pageerror] ${e.message}`))
  page.on('response', r => { if (r.status() >= 400) errors.push(`[${tag} http ${r.status()}] ${r.url()}`) })
  page.on('request', r => { const u = r.url(); if (!/^(http:\/\/127\.0\.0\.1[:/]|data:|blob:)/.test(u)) external.push(u) })
}
async function newPage(w = W, h = H, dsf = 1) {
  const page = await browser.newPage()
  await page.setViewport({ width: w, height: h, deviceScaleFactor: dsf })
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true })
  watch(page, `${w}x${h}`)
  return page
}

async function step(name, page, fn) {
  const t0 = Date.now()
  try {
    const note = await fn()
    results.push({ name, ok: true, note: note ?? '', ms: Date.now() - t0 })
    console.log(`✔ ${name}${note ? ' — ' + note : ''}`)
  } catch (e) {
    results.push({ name, ok: false, note: e.message, ms: Date.now() - t0 })
    console.log(`✘ ${name} — ${e.message}`)
    await page.screenshot({ path: path.join(out, `FAIL-${name.slice(0, 2)}.png`) }).catch(() => {})
  }
}
const assert = (c, msg) => { if (!c) throw new Error(msg) }
const shot = (page, f) => page.screenshot({ path: path.join(out, f) })
const S = (page, fn, ...a) => page.evaluate(fn, ...a)
const st = page => S(page, () => { const s = window.__fss.store.getState(); return { title: s.base?.title, walls: s.base?.walls.length, rooms: s.base?.rooms.length, openings: s.base?.openings.length, sel: s.sel, mode: s.mode, main: s.main, changes: s.base?.changes, anchor: s.draw.anchor, confirm: !!s.confirm, style: s.style3d, planFile: s.base?.meta?.planFile } })
const P = (page, p) => S(page, q => window.__plan2screen(q), p)
async function clickPlan(page, p, opts) { const [x, y] = await P(page, p); await page.mouse.click(x, y, opts) }
/** 沿墙找一个没被热点盖住的点（2D：命中 svg；3D：命中 canvas） */
async function freeSpot(page, pts, tag) {
  for (const q of pts) {
    const xy = await page.evaluate((q, tag) => tag === 'svg' ? window.__plan2screen(q) : window.__world2screen(q), q, tag)
    const ok = await page.evaluate(([x, y], tag) => { const e = document.elementFromPoint(x, y); return !!e && (tag === 'svg' ? !!e.closest('[data-canvas=main]') && !e.closest('button,.pointer-events-auto') : e.tagName === 'CANVAS' && !!e.closest('[data-canvas3d=main]')) }, xy, tag)
    if (ok) return xy
  }
  throw new Error('墙上找不到没被遮住的点')
}
const along = (a, b, n = 12) => Array.from({ length: n }, (_, i) => [a[0] + (b[0] - a[0]) * (i + 0.5) / n, a[1] + (b[1] - a[1]) * (i + 0.5) / n])
async function dragPlan(page, a, b, steps = 12) {
  const [x0, y0] = await P(page, a), [x1, y1] = await P(page, b)
  await page.mouse.move(x0, y0); await page.mouse.down()
  for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await sleep(16) }
  await page.mouse.up()
}
async function waitFile(dir, re, since, ms = 8000) {
  for (let i = 0; i < ms / 100; i++) {
    const f = fs.readdirSync(dir).filter(f => re.test(f) && !f.endsWith('.crdownload')).map(f => path.join(dir, f)).find(f => fs.statSync(f).mtimeMs >= since)
    if (f) { await sleep(150); return f }
    await sleep(100)
  }
  throw new Error(`没等到下载文件 ${re}`)
}
async function pickFileVia(page, testId, file) {
  await page.click('[data-testid=file-menu]')
  await page.waitForSelector(`[data-testid=${testId}]`)
  const [chooser] = await Promise.all([page.waitForFileChooser(), page.click(`[data-testid=${testId}]`)])
  await chooser.accept([file])
}

const page = await newPage()
if (!ONLY) try {
  // 1. 空状态 → 打开示例
  await step('1 空状态 → 打开示例', page, async () => {
    await page.goto(BASE + '/', { waitUntil: 'networkidle0' })
    await page.waitForSelector('[data-testid=open-demo]', { timeout: 8000 })
    assert(await page.$eval('body', b => b.innerText.includes('拖到这里')), '没有空状态')
    await shot(page, '01-empty.png')
    await page.click('[data-testid=open-demo]')
    await sleep(1200)
    const s = await st(page)
    assert(s.title?.includes('示例'), `标题没写示例：${s.title}`)
    assert(await page.$eval('body', b => b.innerText.includes('示例 · 虚构两室')), '标题块没显示「示例」')
    // 适配后平面不被任何浮卡压住（PM 验收第 2 条）
    const cover = await S(page, () => {
      const b = window.__fss.planBounds(window.__fss.store.getState().base)
      const [x0, y0] = window.__plan2screen([b[0], b[1]]), [x1, y1] = window.__plan2screen([b[2], b[3]])
      const els = [...document.querySelectorAll('[data-float],[data-pip]')]
      return els.map(e => { const r = e.getBoundingClientRect(); return { n: e.getAttribute('data-pip') ? 'pip' : e.textContent.slice(0, 10), hit: r.left < x1 && r.right > x0 && r.top < y1 && r.bottom > y0 } }).filter(x => x.hit).map(x => x.n)
    })
    assert(!cover.length, `平面被浮卡压住：${cover.join(',')}`)
    await shot(page, '01-demo.png')
    return `标题「${s.title}」，平面四周无遮挡`
  })

  // 2. 画三段墙闭合 → 点进去识别房间
  const T0 = [11000, 1000], T1 = [14000, 1000], T2 = [14000, 4000]
  await step('2 画三段墙并闭合 → 识别房间', page, async () => {
    const before = await st(page)
    for (let i = 0; i < 6; i++) { const [x] = await P(page, [14600, 0]); if (x < W - 430) break; await page.keyboard.press('-'); await sleep(150) }
    await page.keyboard.press('w'); await sleep(200)
    for (const p of [T0, T1, T2]) { await clickPlan(page, p); await sleep(180) }
    await shot(page, '02a-drawing.png')
    await clickPlan(page, T0); await sleep(250)
    let s = await st(page)
    assert(s.walls === before.walls + 3, `墙数 ${before.walls} → ${s.walls}`)
    assert(!s.anchor, '回到起点后没有自动闭合')
    await page.keyboard.press('r'); await sleep(150)
    await clickPlan(page, [13200, 2000]); await sleep(300)
    s = await st(page)
    assert(s.rooms === before.rooms + 1, `房间数没加：${s.rooms}`)
    assert(s.sel[0]?.type === 'room', '新房间没选中')
    await shot(page, '02-room.png')
    return `墙 +3、房间 +1（${s.sel[0].id}）`
  })

  // 3. 放窗 → 沿墙拖 → 改离地
  let winId = ''
  await step('3 放窗、沿墙拖动、改离地高度', page, async () => {
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
    await page.keyboard.press('d'); await sleep(200)
    await page.click('[data-testid=okind-window]'); await sleep(100)
    const [x, y] = await P(page, [12500, 1000])
    await page.mouse.move(x - 30, y); await page.mouse.move(x, y); await sleep(150)
    await shot(page, '03a-preview.png')
    await page.mouse.click(x, y); await sleep(300)
    let s = await st(page)
    assert(s.sel[0]?.type === 'opening', '窗没有放下 / 没选中')
    winId = s.sel[0].id
    const o0 = await S(page, id => window.__fss.store.getState().base.openings.find(o => o.id === id), winId)
    assert(o0.kind === 'window', `类型是 ${o0.kind}`)
    const c = await S(page, id => { const v = window.__fss.getView(); const o = v.plan.openings.find(o => o.id === id); const w = v.plan.walls.find(w => w.id === o.wall); const t = (o.offset + o.width / 2) / Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]); return [w.a[0] + (w.b[0] - w.a[0]) * t, w.a[1] + (w.b[1] - w.a[1]) * t] }, winId)
    await dragPlan(page, c, [c[0] + 600, c[1] + 40]); await sleep(250)
    const o1 = await S(page, id => window.__fss.store.getState().base.openings.find(o => o.id === id), winId)
    assert(Math.abs(o1.offset - o0.offset - 600) <= 20, `拖动后 offset ${o0.offset} → ${o1.offset}`)
    // S2a：数字框是 Figma 式（没有加减号了）：点进去按两下 ↑（步长 0.05）
    await page.click('[data-testid=sill]'); await sleep(80)
    await page.keyboard.press('ArrowUp'); await sleep(80)
    await page.keyboard.press('ArrowUp'); await sleep(80)
    await page.keyboard.press('Enter'); await sleep(200)
    const o2 = await S(page, id => window.__fss.store.getState().base.openings.find(o => o.id === id), winId)
    assert(Math.abs(o2.sill - (o0.sill + 0.1)) < 1e-6, `离地 ${o0.sill} → ${o2.sill}`)
    await shot(page, '03-window.png')
    return `${winId}：offset ${Math.round(o0.offset)} → ${Math.round(o1.offset)}，离地 ${o0.sill} → ${o2.sill}`
  })

  // 4. 拖墙角，相连的墙跟着动
  await step('4 拖墙角，相连的墙一起动', page, async () => {
    await page.keyboard.press('Escape')
    await clickPlan(page, [14000, 2300]); await sleep(250)
    let s = await st(page)
    assert(s.sel[0]?.type === 'wall', '没选中墙')
    const to = [14600, 600]
    await dragPlan(page, T1, to); await sleep(300)
    const walls = await S(page, p => window.__fss.store.getState().base.walls.filter(w => [w.a, w.b].some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1)).map(w => w.id), to)
    assert(walls.length === 2, `落在新墙角的墙：${walls.length} 面`)
    await shot(page, '04-joint.png')
    return `墙角 ${T1} → ${to}，${walls.join(' + ')} 一起动`
  })

  // 4b. 其它编辑：画梁、拉弧墙、分段、底图两点定比例、整体镜像
  await step('4b 画梁 / 拉弧墙 / 分段 / 定比例 / 镜像', page, async () => {
    const notes = []
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
    const nb = (await S(page, () => window.__fss.store.getState().base.beams.length))
    await page.keyboard.press('b'); await sleep(150)
    await clickPlan(page, [11500, 3000]); await sleep(120); await clickPlan(page, [13000, 3000]); await sleep(250)
    assert((await S(page, () => window.__fss.store.getState().base.beams.length)) === nb + 1, '梁没画上')
    notes.push('梁 +1')
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape')
    // 拉弧：选中斜边（墙角已拖到 14600,600），拖中点菱形
    const mid = await S(page, () => { const w = window.__fss.store.getState().base.walls.find(w => w.id === 'wall2'); return [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2] })
    await clickPlan(page, [mid[0] - 400, mid[1] - 400 * 0]); await sleep(50)
    await clickPlan(page, mid); await sleep(250)
    await dragPlan(page, mid, [mid[0] + 500, mid[1]]); await sleep(250)
    const bulge = await S(page, () => window.__fss.store.getState().base.walls.find(w => w.id === 'wall2').bulge)
    assert(Math.abs(bulge ?? 0) > 100, `弧墙矢高 ${bulge}`)
    notes.push(`弧墙矢高 ${bulge}`)
    await shot(page, '04b-arc-beam.png')
    // 分段：点选第一面新墙靠起点的位置，再按检查器的剪刀
    const nw = (await st(page)).walls
    await page.keyboard.press('Escape')
    const q = await S(page, () => { const w = window.__fss.store.getState().base.walls.find(w => w.id === 'wall1'); return [w.a[0] + (w.b[0] - w.a[0]) * 0.12, w.a[1] + (w.b[1] - w.a[1]) * 0.12] })
    await clickPlan(page, q); await sleep(600)
    assert((await st(page)).sel[0]?.id === 'wall1', `分段前选中的是 ${JSON.stringify((await st(page)).sel)}`)
    await page.click('[data-testid=inspector-split]'); await sleep(250)
    assert((await st(page)).walls === nw + 1, '分段没生效')
    notes.push('分段 +1 墙')
    // 底图两点定比例
    await page.keyboard.press('Escape')
    const k0 = await S(page, () => window.__fss.store.getState().base.underlay.mmPerPx)
    await page.keyboard.press('u'); await sleep(200)
    await page.click('[data-testid=calib-start]'); await sleep(100)
    await clickPlan(page, [0, 0]); await sleep(100); await clickPlan(page, [9600, 0]); await sleep(200)
    await page.click('[data-testid=calib-len]', { count: 3 }); await page.keyboard.type('4800'); await page.keyboard.press('Enter'); await sleep(250)
    const k1 = await S(page, () => window.__fss.store.getState().base.underlay.mmPerPx)
    assert(Math.abs(k1 - k0 / 2) < 0.01, `比例 ${k0} → ${k1}（应减半）`)
    notes.push(`mmPerPx ${k0} → ${k1.toFixed(2)}`)
    await shot(page, '04c-calibrate.png')
    await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta'); await sleep(200)
    await page.keyboard.press('Escape')
    // 整体镜像两次回到原样
    const before = await S(page, () => JSON.stringify(window.__fss.store.getState().base.walls))
    for (let i = 0; i < 2; i++) { await page.click('[data-testid=file-menu]'); await page.waitForSelector('[data-testid=menu-mirror]'); await page.click('[data-testid=menu-mirror]'); await sleep(300) }
    assert(before === await S(page, () => JSON.stringify(window.__fss.store.getState().base.walls)), '镜像两次没回到原样')
    notes.push('镜像往返一致')
    return notes.join('；')
  })

  // 5. 切 3D，点一面墙
  await step('5 切 3D，点墙 → 检查器显示这面墙', page, async () => {
    await page.keyboard.press('Escape')
    await page.keyboard.press('Tab'); await sleep(2500)
    assert((await st(page)).main === '3d', '没切到 3D')
    const [x, y] = await freeSpot(page, along([5.4, 0.3], [5.4, 3.3]).map(([a, b]) => [a, 2.8, b]), 'canvas')
    await page.mouse.click(x, y); await sleep(500)
    const s = await st(page)
    assert(s.sel[0]?.id === 'w-d', `选中的是 ${JSON.stringify(s.sel)}`)
    assert(await page.$eval('body', b => b.innerText.includes('主卧西墙')), '检查器没显示「主卧西墙」')
    await shot(page, '05-3d-wall.png')
    return '3D 点中 w-d（主卧西墙），检查器同步'
  })

  // 6. 改造态删承重墙 → 二次确认 → 对比态珊瑚 → 撤销
  await step('6 改造态删承重墙 → 确认 → 对比珊瑚 → 撤销', page, async () => {
    await page.keyboard.press('Tab'); await sleep(1600)
    await page.keyboard.press('2'); await sleep(300)
    const n0 = (await st(page)).changes.length
    const [wx, wy] = await freeSpot(page, along([3300, 200], [3300, 2500]), 'svg')
    await page.mouse.click(wx, wy); await sleep(250)
    assert((await st(page)).sel[0]?.id === 'w-a', `改造态没选中 w-a：${JSON.stringify((await st(page)).sel)}`)
    await page.keyboard.press('Delete'); await sleep(300)
    assert((await st(page)).confirm, '没有弹二次确认')
    await page.waitForSelector('[data-testid=confirm-yes]')
    await shot(page, '06a-confirm.png')
    await page.click('[data-testid=confirm-yes]'); await sleep(300)
    let s = await st(page)
    const c = s.changes[s.changes.length - 1]
    assert(s.changes.length === n0 + 1 && c.op === 'remove' && c.target === 'w-a' && c.confirm?.by, `改造记录不对：${JSON.stringify(c)}`)
    await page.keyboard.press('3'); await sleep(500)
    const coral = await S(page, () => [...document.querySelectorAll('[data-canvas=main] path')].some(p => /-coral\)/.test(p.getAttribute('fill') ?? '')))
    const removed = await S(page, () => window.__fss.getView().diff.removed.map(r => r.id))
    assert(coral && removed.includes('w-a'), `对比态没有珊瑚色拆除（removed=${removed}）`)
    await shot(page, '06b-compare.png')
    await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta'); await sleep(400)
    s = await st(page)
    assert(s.changes.length === n0, `撤销后改造数 ${s.changes.length}（应为 ${n0}）`)
    await shot(page, '06c-undo.png')
    return `确认记下 confirm.by=${c.confirm.by}；对比态珊瑚；⌘Z 回到 ${n0} 条`
  })

  // 6b. 白模 → 导出 PNG（2 倍像素，不带界面）
  await step('6b 白模 → 导出 PNG', page, async () => {
    await page.keyboard.press('1'); await sleep(200)
    await page.keyboard.press('Tab'); await sleep(1500)
    await page.click('[data-testid=style-clay]'); await sleep(1200)
    assert((await st(page)).style === 'clay', '没切到白模')
    const pins = await S(page, () => document.querySelectorAll('[data-canvas3d=main] .pointer-events-auto, [data-canvas3d=main] .pointer-events-none.absolute.left-0.top-0').length)
    assert(pins === 0, `白模下还有 ${pins} 个热点 DOM`)
    await shot(page, '06d-clay.png')
    const since = Date.now()
    await page.click('[data-testid=shot-open]'); await page.waitForSelector('[data-testid=shot-go]')
    await page.click('[data-testid=shot-go]')
    const f = await waitFile(downloads, /\.png$/, since - 1000)
    const buf = fs.readFileSync(f), w = buf.readUInt32BE(16), h = buf.readUInt32BE(20)
    assert(buf.subarray(1, 4).toString() === 'PNG', '不是 PNG')
    assert(w === W * 2 && h === H * 2, `尺寸 ${w}×${h}，应为 ${W * 2}×${H * 2}`)
    fs.copyFileSync(f, path.join(out, '06e-clay-export.png'))
    await page.click('[data-testid=style-clay]'); await sleep(300)
    await page.keyboard.press('Tab'); await sleep(1600)
    return `${path.basename(f)} ${w}×${h}，热点 DOM 0`
  })

  // 7. 导出 JSON → 再导入，内容一致
  await step('7 导出 JSON → 再导入，一致', page, async () => {
    const since = Date.now()
    await page.click('[data-testid=file-menu]'); await page.waitForSelector('[data-testid=menu-export]')
    await page.click('[data-testid=menu-export]')
    const f = await waitFile(downloads, /\.json$/, since - 1000)
    const text = fs.readFileSync(f, 'utf8')
    await S(page, () => window.__fss.store.getState().loadPlan(null))
    await sleep(300)
    await pickFileVia(page, 'menu-open', f)
    await sleep(800)
    const again = await S(page, () => window.__fss.serialize(window.__fss.store.getState().base))
    assert(again === text, '再导入后序列化结果和导出文件不一致')
    await shot(page, '07-reimport.png')
    return `${path.basename(f)}（${(text.length / 1024).toFixed(0)} KB）逐字一致`
  })

  // 8. 导入旧格式
  await step('8 导入旧格式 legacy-example.json', page, async () => {
    await pickFileVia(page, 'menu-open', path.join(root, 'fixtures/legacy-example.json'))
    await sleep(1200)
    const s = await st(page)
    assert(s.walls > 0 && s.rooms > 0, `旧格式没显示：墙 ${s.walls} 房间 ${s.rooms}`)
    const notice = await page.$('[data-testid=notice]')
    assert(notice, '没有转换提示')
    const txt = await notice.evaluate(n => n.innerText)
    await shot(page, '08-legacy.png')
    return `墙 ${s.walls}、房间 ${s.rooms}；提示「${txt.split('\n')[0]}」`
  })
} finally { /* 下面继续 */ }

// 9. 本地服务模式：?plan= 带 2 秒轮询
const p9 = ONLY ? null : await newPage()
if (p9) await step('9 serve.mjs + ?plan=，改文件 2 秒内刷新', p9, async () => {
  const planPath = path.join(served, 'plan.json')
  fs.copyFileSync(path.join(root, 'fixtures/example-v2.json'), planPath)
  // 方案里的底图是相对路径 ../drawing.png；服务模式不许跳出目录，所以把公开样例图放进目录、路径改成 drawing.png
  fs.copyFileSync(path.join(root, 'fixtures/example-drawing.png'), path.join(served, 'drawing.png'))
  fs.writeFileSync(planPath, fs.readFileSync(planPath, 'utf8').replaceAll('"../drawing.png"', '"drawing.png"'))
  await p9.goto(`${BASE}/?plan=plan.json`, { waitUntil: 'networkidle0' })
  await sleep(1200)
  let s = await st(p9)
  assert(s.walls > 0, '没载入方案')
  assert(s.planFile === path.join(fs.realpathSync(served), 'plan.json'), `planFile = ${s.planFile}`)
  await sleep(2300) // 让轮询至少跑过一次，确认不变时不刷新
  const j = JSON.parse(fs.readFileSync(planPath, 'utf8'))
  j.title = 'Agent 改过的方案'
  const t0 = Date.now()
  fs.writeFileSync(planPath, JSON.stringify(j, null, 2))
  let dt = -1
  for (let i = 0; i < 40; i++) { await sleep(100); if ((await st(p9)).title === j.title) { dt = Date.now() - t0; break } }
  assert(dt >= 0, '4 秒内没刷新')
  assert(dt <= 2600, `刷新用了 ${dt}ms`)
  await shot(p9, '09-served.png')
  // 本地有改动时不覆盖，改成提示
  const mw = await S(p9, () => { const w = window.__fss.store.getState().base.walls[0]; return [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2] })
  await clickPlan(p9, mw); await sleep(200)
  await p9.keyboard.press('Delete'); await sleep(300)
  assert((await S(p9, () => window.__fss.store.getState().dirty)), '本地删墙后没标记改动')
  j.title = 'Agent 第二次改'
  fs.writeFileSync(planPath, JSON.stringify(j, null, 2))
  await p9.waitForSelector('[data-testid=notice]', { timeout: 4000 })
  s = await st(p9)
  assert(s.title === 'Agent 改过的方案', '有本地改动时被覆盖了')
  await shot(p9, '09b-served-conflict.png')
  await p9.click('[data-testid=notice-primary]'); await sleep(300)
  assert((await st(p9)).title === 'Agent 第二次改', '点「载入」没生效')
  return `planFile=${s.planFile}；${dt}ms 内刷新；有改动时弹「载入 / 稍后」`
})

// 手机 390×844
const pm = ONLY ? null : await newPage(390, 844, 2)
if (pm) await step('M 手机截图：平面、选中墙、底部抽屉', pm, async () => {
  await pm.goto(`${BASE}/?mode=original`, { waitUntil: 'networkidle0' }); await sleep(1500)
  const cover = await S(pm, () => {
    const b = window.__fss.planBounds(window.__fss.store.getState().base)
    const [x0, y0] = window.__plan2screen([b[0], b[1]]), [x1, y1] = window.__plan2screen([b[2], b[3]])
    return [...document.querySelectorAll('[data-float],[data-pip]')].filter(e => { const r = e.getBoundingClientRect(); return r.left < x1 && r.right > x0 && r.top < y1 && r.bottom > y0 }).length
  })
  assert(cover === 0, `手机平面被 ${cover} 块浮卡压住`)
  await shot(pm, 'M1-plan.png')
  const [mx, my] = await freeSpot(pm, along([3300, 200], [3300, 2500]), 'svg')
  await pm.mouse.click(mx, my); await sleep(900)
  assert((await st(pm)).sel[0]?.id === 'w-a', '手机没选中墙')
  await shot(pm, 'M2-wall.png')
  await pm.evaluate(() => window.__fss.store.getState().setSheetTall(true)); await sleep(700)
  await shot(pm, 'M3-drawer-tall.png')
  await pm.evaluate(() => { const s = window.__fss.store.getState(); s.select(null); s.setMode('renovation'); s.setPanel('changes') }); await sleep(900)
  await shot(pm, 'M4-changes-drawer.png')
  return '平面无遮挡；选中墙抽屉；抽屉展开；改造清单抽屉'
})

/* ═════════ S2a 新增步骤 ═════════ */
const pa = await newPage()
const base = page2 => S(page2, () => window.__fss.store.getState().base)
const wallOf = (page2, id) => S(page2, id => window.__fss.store.getState().base.walls.find(w => w.id === id), id)
const midOf = (page2, id) => S(page2, id => { const v = window.__fss.getView(); const w = v.plan.walls.find(w => w.id === id); const L = window.__fss.arcParams(w) ? window.__fss.arcParams(w).radius * Math.abs(window.__fss.arcParams(w).angle) * Math.PI / 180 : Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]); return { L } }, id)
const toastText = page2 => S(page2, () => window.__fss.store.getState().toast ?? '')
async function selectWall(page2, id, at = 0.5) {
  await page2.keyboard.press('Escape'); await page2.keyboard.press('Escape')
  const q = await S(page2, ([id, at]) => { const w = window.__fss.store.getState().base.walls.find(w => w.id === id); return [w.a[0] + (w.b[0] - w.a[0]) * at, w.a[1] + (w.b[1] - w.a[1]) * at] }, [id, at])
  const pts = [at, at - 0.08, at + 0.08, at - 0.16, at + 0.16].map(f => S(page2, ([id, f]) => { const w = window.__fss.store.getState().base.walls.find(w => w.id === id); return [w.a[0] + (w.b[0] - w.a[0]) * f, w.a[1] + (w.b[1] - w.a[1]) * f] }, [id, f]))
  const xy = await freeSpot(page2, await Promise.all(pts), 'svg').catch(() => null)
  if (xy) await page2.mouse.click(xy[0], xy[1]); else await clickPlan(page2, q)
  await sleep(300)
  const s = await st(page2)
  assert(s.sel[0]?.id === id, `没选中 ${id}：${JSON.stringify(s.sel)}`)
}

await step('S1 数字框：键盘输入、回车生效、Esc 还原、↑↓ 步长、超范围夹回、拖标签改值', pa, async () => {
  await pa.goto(BASE + '/?sel=w-a', { waitUntil: 'networkidle0' }); await sleep(1300)
  const notes = []
  const thick = async () => (await wallOf(pa, 'w-a')).thickness
  const t0 = await thick()
  // 点数字直接输入，回车生效
  await pa.click('[data-testid=thickness]'); await sleep(80)
  await pa.keyboard.type('180'); await pa.keyboard.press('Enter'); await sleep(250)
  assert(await thick() === 180, `输入 180 回车后厚度 ${await thick()}`)
  notes.push(`${t0} → 输入 180`)
  // Esc 还原（不生效）
  await pa.click('[data-testid=thickness]'); await pa.keyboard.type('260'); await pa.keyboard.press('Escape'); await sleep(250)
  assert(await thick() === 180, `Esc 后厚度 ${await thick()}（应还是 180）`)
  assert((await st(pa)).sel[0]?.id === 'w-a', 'Esc 把选中也取消了（应只还原数字框）')
  notes.push('Esc 还原')
  // ↑ 步长 10、⇧↑ ×10
  await pa.click('[data-testid=thickness]'); await pa.keyboard.press('ArrowUp'); await sleep(120)
  await pa.keyboard.down('Shift'); await pa.keyboard.press('ArrowUp'); await pa.keyboard.up('Shift'); await sleep(120)
  await pa.keyboard.press('ArrowDown'); await pa.keyboard.press('Enter'); await sleep(250)
  assert(await thick() === 280, `↑ ⇧↑ ↓ 后厚度 ${await thick()}（应 280）`)
  notes.push('↑⇧↑↓ → 280')
  // 超范围：夹回 600 并提示
  await pa.click('[data-testid=thickness]'); await pa.keyboard.type('9999'); await pa.keyboard.press('Enter'); await sleep(150)
  assert(await thick() === 600, `输入 9999 后厚度 ${await thick()}（应夹回 600）`)
  const note = await pa.$eval('[data-testid=thickness-note]', n => n.innerText).catch(() => '')
  assert(/最大 600/.test(note), `没有超范围提示：「${note}」`)
  await shot(pa, 'S1-number-clamp.png')
  notes.push(`9999 → 600「${note}」`)
  // 失焦生效
  await pa.click('[data-testid=thickness]'); await pa.keyboard.type('240'); await pa.mouse.click(700, 120); await sleep(250)
  assert(await thick() === 240, `失焦后厚度 ${await thick()}`)
  await selectWall(pa, 'w-a', 0.3)
  // 按住标签左右拖：每 4px 一个步长
  const lb = await pa.$eval('[data-testid=thickness-label]', e => { const r = e.getBoundingClientRect(); return [r.left + 12, r.top + r.height / 2] })
  await pa.mouse.move(lb[0], lb[1]); await pa.mouse.down()
  for (let i = 1; i <= 10; i++) { await pa.mouse.move(lb[0] + i * 4, lb[1]); await sleep(16) }
  await pa.mouse.up(); await sleep(250)
  assert(await thick() === 340, `拖标签 40px 后厚度 ${await thick()}（应 240 + 10×10 = 340）`)
  notes.push('拖标签 +40px → 340')
  // 门窗离地：带小数
  await pa.keyboard.press('Escape')
  await pa.goto(BASE + '/?sel=o-bed2-win', { waitUntil: 'networkidle0' }); await sleep(1200)
  await pa.click('[data-testid=sill]'); await pa.keyboard.type('1.05'); await pa.keyboard.press('Enter'); await sleep(250)
  const sill = await S(pa, () => window.__fss.store.getState().base.openings.find(o => o.id === 'o-bed2-win').sill)
  assert(Math.abs(sill - 1.05) < 1e-9, `离地输入 1.05 → ${sill}`)
  await shot(pa, 'S1-number.png')
  notes.push('离地 1.05')
  return notes.join('；')
})

await step('S2 带 3 个洞口的东外墙拉弯 → 弧墙上放窗（沿弧画）→ 放不下时说原因', pa, async () => {
  await pa.goto(BASE + '/?sel=w-e', { waitUntil: 'networkidle0' }); await sleep(1300)
  const ops0 = (await base(pa)).openings.filter(o => o.wall === 'w-e').map(o => [o.id, o.offset])
  assert(ops0.length === 3, `东外墙洞口 ${ops0.length}`)
  // 拖中点菱形往东拉 900mm
  await dragPlan(pa, [9600, 3600], [10500, 3600], 16); await sleep(350)
  const w = await wallOf(pa, 'w-e')
  assert(Math.abs(w.bulge ?? 0) > 500, `东外墙没拉弯：bulge=${w.bulge}`)
  const ops1 = (await base(pa)).openings.filter(o => o.wall === 'w-e').map(o => [o.id, o.offset])
  assert(JSON.stringify(ops1) === JSON.stringify(ops0), `拉弯后洞口变了：${JSON.stringify(ops1)}`)
  await shot(pa, 'S2a-arc-with-openings.png')
  // 门窗工具：在弧墙 2400–3950 的空当里放一扇窗（1.5m）
  await pa.keyboard.press('Escape'); await pa.keyboard.press('d'); await sleep(200)
  await pa.click('[data-testid=okind-window]'); await sleep(100)
  const at = await S(pa, () => { const v = window.__fss.getView(); const w = v.plan.walls.find(w => w.id === 'w-e'); const a = window.__fss.arcParams(w); const L = a.radius * Math.abs(a.angle) * Math.PI / 180; const s = 3175, t = a.angle * Math.PI / 180; const st0 = Math.atan2(w.a[1] - a.center[1], w.a[0] - a.center[0]); const sweep = -t; const ang = st0 + sweep * (s / L); return [a.center[0] + Math.cos(ang) * a.radius, a.center[1] + Math.sin(ang) * a.radius] })
  const [x, y] = await P(pa, at)
  await pa.mouse.move(x - 20, y); await pa.mouse.move(x, y); await sleep(200)
  await shot(pa, 'S2b-arc-window-preview.png')
  await pa.mouse.click(x, y); await sleep(350)
  const s1 = await st(pa)
  assert(s1.sel[0]?.type === 'opening', `弧墙上没放下窗：toast「${await toastText(pa)}」`)
  const win = (await base(pa)).openings.find(o => o.id === s1.sel[0].id)
  assert(win.wall === 'w-e' && win.kind === 'window', `窗不在东外墙上：${JSON.stringify(win)}`)
  // 2D：窗的玻璃中线沿弧（路径里有多段）
  const segs = await S(pa, id => { const g = document.querySelector(`[data-canvas=main] g[data-type=opening][data-id="${id}"]`); return g ? Math.max(...[...g.querySelectorAll('path')].map(p => (p.getAttribute('d') ?? '').split('L').length)) : 0 }, win.id)
  assert(segs >= 6, `弧墙窗符号没沿弧画（最多 ${segs} 段）`)
  await pa.keyboard.press('Escape'); await sleep(100)
  await shot(pa, 'S2c-arc-window.png')
  // 放不下：落地窗 2.4m，墙上剩下的空当都不够 → 提示原因（不再是「要把窗放到墙上」）
  await pa.keyboard.press('Escape'); await pa.keyboard.press('d'); await sleep(150)
  await pa.click('[data-testid=okind-floor-window]'); await sleep(100)
  await pa.mouse.click(x, y); await sleep(250)
  const tt = await toastText(pa)
  assert(/空当都不到 2\.40 m/.test(tt), `放不下时提示不对：「${tt}」`)
  await shot(pa, 'S2d-arc-no-room.png')
  await pa.keyboard.press('Escape')
  return `bulge ${Math.round(w.bulge)}，洞口 offset 不变；放窗 ${win.id}（offset ${Math.round(win.offset)}，${segs} 段弧线）；落地窗提示「${tt}」`
})

await step('S3 输入圆心角 270°：2D、3D、墙角接缝', pa, async () => {
  await pa.goto(BASE + '/?sel=w-b', { waitUntil: 'networkidle0' }); await sleep(1300)
  await pa.click('[data-testid=arc-angle]'); await pa.keyboard.type('270'); await pa.keyboard.press('Enter'); await sleep(400)
  const w = await wallOf(pa, 'w-b')
  const a = await S(pa, () => window.__fss.arcParams(window.__fss.store.getState().base.walls.find(w => w.id === 'w-b')))
  assert(a && Math.abs(a.angle - 270) < 0.5, `圆心角 ${a?.angle}`)
  const shown = await pa.$eval('[data-testid=arc-angle]', i => i.value)
  assert(shown === '270', `数字框显示 ${shown}`)
  // 2D 墙体并集里有这面弧墙；3D 实体能三角化（buildSolids 有这面墙、高度正常）
  const solids = await S(pa, () => window.__fss.buildSolids(window.__fss.store.getState().base).filter(s => s.ids.includes('w-b')).map(s => [s.kind, s.z0, s.z1]))
  assert(solids.length && solids.every(s => s[2] > s[1]), `3D 实体不对：${JSON.stringify(solids)}`)
  await pa.mouse.click(700, 120); await sleep(200)
  await shot(pa, 'S3a-arc270-2d.png')
  await pa.keyboard.press('Tab'); await sleep(2600)
  await shot(pa, 'S3b-arc270-3d.png')
  await pa.keyboard.press('Tab'); await sleep(1500)
  // 半径：输入后圆心角跟着变、仍是优弧
  await selectWall(pa, 'w-a', 0.25)
  return `bulge ${Math.round(w.bulge)}（半径 ${Math.round(a.radius)}），3D ${solids.length} 块`
})

await step('S4 ⌥ 测距：两面平行墙的净距；触屏「测距」按钮', pa, async () => {
  await pa.goto(BASE + '/?sel=w-a', { waitUntil: 'networkidle0' }); await sleep(1300)
  const [A, D] = [await wallOf(pa, 'w-a'), await wallOf(pa, 'w-d')]
  const expect = Math.abs(D.a[0] - A.a[0]) - A.thickness / 2 - D.thickness / 2
  await pa.keyboard.down('Alt'); await sleep(100)
  const target = await freeSpot(pa, along([5400, 400], [5400, 3200]), 'svg')
  await pa.mouse.move(target[0] - 30, target[1]); await pa.mouse.move(target[0], target[1]); await sleep(300)
  const v = await S(pa, () => [...document.querySelectorAll('[data-canvas=main] [data-measure-value]')].map(g => [g.getAttribute('data-measure-value'), g.querySelector(':scope > text')?.textContent ?? '']))
  await shot(pa, 'S4a-measure-alt.png')
  await pa.keyboard.up('Alt'); await sleep(200)
  assert(v.length === 1, `测距胶囊 ${v.length} 个：${JSON.stringify(v)}`)
  assert(+v[0][0] === expect, `净距 ${v[0][0]}，应为 ${expect}`)
  assert(v[0][1].includes(expect.toLocaleString('en-US')), `胶囊文字「${v[0][1]}」`)
  const gone = await S(pa, () => document.querySelectorAll('[data-canvas=main] [data-measure]').length)
  assert(gone === 0, '松开 ⌥ 后标注没消失')
  // 触屏：检查器「测距」→ 点另一面墙
  await pa.click('[data-testid=inspector-measure]'); await sleep(150)
  const [x2, y2] = await freeSpot(pa, along([9600, 600], [9600, 3000]), 'svg')
  await pa.mouse.click(x2, y2); await sleep(300)
  const v2 = await S(pa, () => [...document.querySelectorAll('[data-canvas=main] [data-measure-value]')].map(g => +g.getAttribute('data-measure-value')))
  const E = await wallOf(pa, 'w-e')
  const expect2 = Math.abs(E.a[0] - A.a[0]) - A.thickness / 2 - E.thickness / 2
  assert(v2.length === 1 && v2[0] === expect2, `按钮测距 ${JSON.stringify(v2)}，应 ${expect2}`)
  assert((await st(pa)).sel[0]?.id === 'w-a', '测距时选中被改了')
  await shot(pa, 'S4b-measure-button.png')
  await pa.keyboard.press('Escape'); await sleep(150)
  assert(!(await S(pa, () => window.__fss.store.getState().measure)), 'Esc 没退出测距')
  return `w-a ↔ w-d 净距 ${v[0][1]}（应 ${expect}）；按钮测距 w-a ↔ w-e ${v2[0]}`
})

await step('S5 新建第二层、放楼梯（一层通到二层）、二层画墙 → 3D 两层叠放', pa, async () => {
  await pa.goto(BASE + '/?mode=original', { waitUntil: 'networkidle0' }); await sleep(1300)
  await pa.click('[data-testid=tool-more]'); await pa.waitForSelector('[data-testid=more-level]')
  await shot(pa, 'S5a-more-menu.png')
  await pa.click('[data-testid=more-level]'); await sleep(500)
  let b = await base(pa)
  assert(b.levels?.length === 2, `楼层数 ${b.levels?.length}`)
  const L2 = b.levels[1]
  assert((await S(pa, () => window.__fss.store.getState().level)) === L2.id, '新建后没切到新楼层')
  assert(await pa.$(`[data-testid=level-${L2.id}]`), '标题区没有楼层切换')
  // 二层：画四面墙围一圈
  const box = [[1000, 1000], [5000, 1000], [5000, 4600], [1000, 4600]]
  await pa.keyboard.press('w'); await sleep(150)
  for (const q of [...box, box[0]]) { await clickPlan(pa, q); await sleep(160) }
  await pa.keyboard.press('Escape'); await pa.keyboard.press('r'); await sleep(120)
  await clickPlan(pa, [3000, 3000]); await sleep(300)
  b = await base(pa)
  const up = b.walls.filter(w => w.level === L2.id)
  assert(up.length === 4, `二层墙 ${up.length}`)
  assert(b.rooms.some(r => r.level === L2.id), '二层房间没识别出来')
  await pa.keyboard.press('Escape'); await pa.keyboard.press('Escape')
  await shot(pa, 'S5b-level2.png')
  // 回一层放楼梯（客厅里，从南往北上）
  await pa.click(`[data-testid=level-${b.levels[0].id}]`); await sleep(400)
  await pa.click('[data-testid=tool-more]'); await pa.waitForSelector('[data-testid=more-stair]'); await pa.click('[data-testid=more-stair]'); await sleep(150)
  await clickPlan(pa, [1200, 6800]); await sleep(150); await clickPlan(pa, [2200, 4000]); await sleep(350)
  b = await base(pa)
  const stair = b.stairs?.[0]
  assert(stair && stair.level === b.levels[0].id && stair.to === L2.id, `楼梯不对：${JSON.stringify(stair)}`)
  assert(stair.path[0][1] > stair.path[1][1], '楼梯方向不对（应从第一下那头往上走）')
  assert(b.voids?.some(v => v.level === L2.id), '二层没有自动开楼梯洞')
  await pa.keyboard.press('Escape')
  await shot(pa, 'S5c-stair-2d.png')
  // 3D：两层叠放
  const z = await S(pa, id => { const s = window.__fss.buildSolids(window.__fss.store.getState().base); const up = s.filter(x => x.level === id && x.kind === 'wall'); const st = s.filter(x => x.kind === 'stair'); return { upMin: Math.min(...up.map(x => x.z0)), upMax: Math.max(...up.map(x => x.z1)), stairTop: Math.max(...st.map(x => x.z1)), steps: st.length } }, L2.id)
  assert(Math.abs(z.upMin - L2.elevation) < 1e-6 && z.upMax > L2.elevation + 2, `二层墙标高 ${z.upMin}–${z.upMax}`)
  assert(Math.abs(z.stairTop - L2.elevation) < 1e-6, `楼梯顶 ${z.stairTop}，应到二层楼面 ${L2.elevation}`)
  await pa.keyboard.press('Tab'); await sleep(2800)
  await shot(pa, 'S5d-3d-stacked.png')
  // 3D 只看这一层
  await pa.click('[data-testid=level-edit]'); await sleep(300)
  await shot(pa, 'S5e-level-popover.png')
  await pa.keyboard.press('Escape'); await sleep(150)
  await S(pa, () => window.__fss.store.getState().setSolo3d(true)); await sleep(1500)
  await shot(pa, 'S5f-3d-solo.png')
  await S(pa, () => window.__fss.store.getState().setSolo3d(false))
  await pa.keyboard.press('Tab'); await sleep(1500)
  return `二层 ${L2.name} 标高 ${L2.elevation} m，墙 ${up.length}；楼梯 ${z.steps} 步，顶 ${z.stairTop} m；二层墙 ${z.upMin}–${z.upMax.toFixed(2)} m`
})

await step('S6 放柱、管道井；管道井删不掉（有提示）', pa, async () => {
  await pa.goto(BASE + '/?mode=original', { waitUntil: 'networkidle0' }); await sleep(1300)
  await pa.keyboard.press('2'); await sleep(200)
  const n0 = (await base(pa)).changes.length
  await pa.click('[data-testid=tool-more]'); await pa.waitForSelector('[data-testid=more-column]'); await pa.click('[data-testid=more-column]'); await sleep(150)
  await clickPlan(pa, [2000, 5200]); await sleep(300)
  let b = await base(pa), s = await st(pa)
  assert(s.sel[0]?.type === 'column' && b.changes.length === n0 + 1 && b.changes.at(-1).type === 'column', `柱没放下：${JSON.stringify(s.sel)} changes ${b.changes.length}`)
  await shot(pa, 'S6a-column.png')
  await pa.keyboard.press('Escape')
  await pa.click('[data-testid=tool-more]'); await pa.waitForSelector('[data-testid=more-shaft]'); await pa.click('[data-testid=more-shaft]'); await sleep(150)
  await clickPlan(pa, [8900, 3900]); await sleep(150); await clickPlan(pa, [9400, 4400]); await sleep(300)
  s = await st(pa); b = await base(pa)
  assert(s.sel[0]?.type === 'shaft', `管道井没放下：${JSON.stringify(s.sel)}`)
  const sid = s.sel[0].id
  await shot(pa, 'S6b-shaft.png')
  // 删：Delete 键和检查器按钮都不行，提示原因
  await pa.keyboard.press('Delete'); await sleep(250)
  const t1 = await toastText(pa)
  assert(/管道井 \/ 烟道不能拆/.test(t1), `Delete 后提示「${t1}」`)
  await pa.click('[data-testid=inspector-remove]'); await sleep(250)
  const t2 = await toastText(pa)
  b = await base(pa)
  const { shafts } = await S(pa, () => ({ shafts: window.__fss.getView().plan.shafts?.map(x => x.id) ?? [] }))
  assert(shafts.includes(sid), '管道井被删掉了')
  assert(await pa.$('[data-testid=shaft-note]'), '检查器里没有「不能拆」说明')
  await shot(pa, 'S6c-shaft-blocked.png')
  // 3D 看柱和管道井
  await pa.keyboard.press('Escape'); await pa.keyboard.press('Tab'); await sleep(2600)
  await shot(pa, 'S6d-3d.png')
  await pa.keyboard.press('Tab'); await sleep(1200)
  return `柱 ${b.changes.find(c => c.type === 'column')?.data?.id}、管道井 ${sid}；删管道井提示「${t1}」/「${t2}」`
})

await step('S7 服务模式「保存」写回方案文件；页面不弹「Agent 更新了」', pa, async () => {
  const planPath = path.join(served, 'save.json')
  fs.copyFileSync(path.join(root, 'fixtures/example-drawing.png'), path.join(served, 'drawing.png'))
  fs.writeFileSync(planPath, fs.readFileSync(path.join(root, 'fixtures/example-v2.json'), 'utf8').replaceAll('"../drawing.png"', '"drawing.png"'))
  const before = fs.readFileSync(planPath, 'utf8'), nWalls = JSON.parse(before).walls.length
  await pa.goto(`${BASE}/?plan=save.json`, { waitUntil: 'networkidle0' }); await sleep(1400)
  assert(await pa.$('[data-testid=save]'), '服务模式没有「保存」按钮')
  // 选一面没有洞口的墙删掉（点在墙中点可能点到洞口上，所以直接选）
  await S(pa, () => { const b = window.__fss.store.getState().base; const w = b.walls.find(w => !b.openings.some(o => o.wall === w.id)); window.__fss.store.getState().select({ type: 'wall', id: w.id }) }); await sleep(200)
  await pa.keyboard.press('Delete'); await sleep(300)
  assert(await S(pa, () => window.__fss.store.getState().dirty), '删墙后没标记改动')
  await shot(pa, 'S7a-dirty.png')
  // ⌘S 保存
  await pa.keyboard.down('Meta'); await pa.keyboard.press('s'); await pa.keyboard.up('Meta'); await sleep(800)
  const after = fs.readFileSync(planPath, 'utf8'), j = JSON.parse(after)
  assert(after !== before && j.walls.length === nWalls - 1, `文件没写回：墙 ${nWalls} → ${j.walls.length}（提示「${await toastText(pa)}」，saving=${await S(pa, () => window.__fss.store.getState().saving)}）`)
  assert(j.meta?.planFile === 'save.json', `写回的 planFile 是 ${j.meta?.planFile}（不应把本机绝对路径写进文件）`)
  assert(!fs.readdirSync(served).some(f => f.endsWith('.tmp')), '留下了临时文件')
  assert(!(await S(pa, () => window.__fss.store.getState().dirty)), '保存后仍标着未保存')
  // 等两轮轮询：不弹提示、不重新载入
  await sleep(4500)
  assert(!(await pa.$('[data-testid=notice]')), '保存后弹了「Agent 更新了」')
  assert((await S(pa, () => window.__fss.store.getState().base.walls.length)) === nWalls - 1, '保存后被重新载入')
  await shot(pa, 'S7b-saved.png')
  // 之后 Agent 真改了文件：照常刷新
  j.title = 'Agent 在保存之后改的'
  fs.writeFileSync(planPath, JSON.stringify(j, null, 2))
  let ok = false
  for (let i = 0; i < 40 && !ok; i++) { await sleep(100); ok = (await st(pa)).title === j.title }
  assert(ok, '保存之后 Agent 再改文件，没刷新')
  // 安全：跳出目录、不存在的文件、非 JSON 都拒绝
  // （从 Node 直接发，不经页面：页面控制台的 4xx 会被第 10 步当成报错）
  const outside = fs.readFileSync(path.join(root, 'package.json'), 'utf8'), keep = fs.readFileSync(planPath, 'utf8')
  const post = (q, body = '{"format":"floorplan-structure","version":2,"walls":[]}', headers = {}) => fetch(`${BASE}/save?plan=${encodeURIComponent(q)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body }).then(r => r.status)
  const codes = [await post('../../../package.json'), await post('nope.json'), await post('save.json', 'not json'), await post('save.json', '{}', { 'Content-Type': 'text/plain' }), await post('drawing.png'), await post('save.json', undefined, { Origin: 'http://evil.example' })]
  assert(codes[0] === 403 || codes[0] === 404, `越界写 ${codes[0]}`)
  assert(JSON.stringify(codes.slice(1)) === JSON.stringify([404, 400, 415, 400, 403]), `不存在 / 非 JSON / 非 json 类型 / 非 .json / 别的网站：${codes}`)
  assert(fs.readFileSync(path.join(root, 'package.json'), 'utf8') === outside && fs.readFileSync(planPath, 'utf8') === keep, '被拒绝的请求改了文件')
  return `墙 ${nWalls} → ${j.walls.length}，planFile 相对路径，4.5 s 内无提示；越界等拒绝 ${codes.join('/')}`
})

await step('S8 手机：工具坞「更多」、检查器测距按钮、楼层切换', pa, async () => {
  const pm2 = await newPage(390, 844, 2)
  await pm2.goto(`${BASE}/?sel=w-a`, { waitUntil: 'networkidle0' }); await sleep(1500)
  await shot(pm2, 'S8a-mobile-wall.png')
  assert(await pm2.$('[data-testid=inspector-measure]'), '手机检查器没有测距按钮')
  await pm2.click('[data-testid=inspector-measure]'); await sleep(200)
  await S(pm2, () => window.__fss.store.getState().setSheetTall(false))
  const ok = await S(pm2, () => !!window.__fss.store.getState().measure)
  assert(ok, '手机测距没进入')
  await pm2.evaluate(() => window.__fss.store.getState().select(null)); await sleep(500)
  await pm2.click('[data-testid=tool-more]'); await sleep(400)
  await shot(pm2, 'S8b-mobile-more.png')
  await pm2.close()
  return '测距按钮、「更多结构」菜单'
})

/* ═════════ T2 网页 Chat：粘贴方案 / 复制问题给 Chat / 复制方案给 Chat / 16:9 导出 ═════════ */
const outT2 = path.join(root, '.shots/T2')
fs.mkdirSync(outT2, { recursive: true })
const shotT2 = (pg, f) => pg.screenshot({ path: path.join(outT2, f) })
// 合法方案：fixtures/example-v2.json 用 CLI 转成 v3（长度全 mm），底图 src 换成文件名（Chat 只知道文件名）
const v3file = path.join(downloads, 't2-example-v3.json')
execFileSync(process.execPath, [path.join(root, 'scripts/plan.ts'), 'convert', path.join(root, 'fixtures/example-v2.json'), v3file], { stdio: 'ignore' })
const v3 = JSON.parse(fs.readFileSync(v3file, 'utf8'))
v3.underlay.src = 'example-drawing.png'
const v3text = JSON.stringify(v3, null, 2)
const chatReply = json => `好的，我按户型图整理了方案（格式 v3，长度单位 mm）：\n\n\`\`\`json\n${json}\n\`\`\`\n\n说明：\n1. 南面的窗按图上的标注放在了 {w0} 上；\n2. 有拿不准的地方我写进了 questions。`
await browser.defaultBrowserContext().overridePermissions(BASE, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write'])
const readClip = pg => pg.evaluate(() => navigator.clipboard.readText())
const chatState = pg => S(pg, () => { const c = window.__chat.getState(); return { open: c.open, view: c.view, lastCopy: c.lastCopy, copied: c.copied } })
async function fillPaste(pg, text) {
  await pg.waitForSelector('[data-testid=chat-paste-input]')
  await pg.$eval('[data-testid=chat-paste-input]', (el, v) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }, text)
  await sleep(80)
  await pg.click('[data-testid=chat-load]'); await sleep(350)
}
async function openMenuItem(pg, testId) {
  await pg.waitForSelector('[data-testid=chat-sheet]', { hidden: true }) // 对话框退场动画还盖着画面时点不到菜单
  await pg.click('[data-testid=file-menu]'); await pg.waitForSelector(`[data-testid=${testId}]`)
  await pg.click(`[data-testid=${testId}]`); await sleep(350)
}
const pc = await newPage()
const T2 = {}

await step('T2-1 空状态「粘贴方案」→ 真实键盘粘贴整段 Chat 回复 → 载入', pc, async () => {
  await pc.goto(BASE + '/?state=empty', { waitUntil: 'networkidle0' })
  await pc.waitForSelector('[data-testid=empty-paste]')
  await shotT2(pc, 'T2-01-empty.png')
  await pc.click('[data-testid=empty-paste]'); await pc.waitForSelector('[data-testid=chat-paste-input]'); await sleep(450)
  await shotT2(pc, 'T2-02-dialog.png')
  const reply = chatReply(v3text)
  await pc.evaluate(t => navigator.clipboard.writeText(t), reply)
  await pc.focus('[data-testid=chat-paste-input]')
  // 真实键盘粘贴：⌘V（无头 Chrome 里按键不会自己触发编辑命令，用 commands 让它执行 Paste）
  await pc.keyboard.down('Meta'); await pc.keyboard.press('KeyV', { commands: ['Paste'] }); await pc.keyboard.up('Meta')
  await sleep(700)
  // 先读状态再截图：无头 + SwiftShader 截一张图可能超过提示的 2.6 秒
  const s = await S(pc, () => { const s = window.__fss.store.getState(); return { title: s.base?.title, walls: s.base?.walls.length, openings: s.base?.openings.length, rooms: s.base?.rooms.length, kind: s.source.kind, toast: s.toast, notice: s.notice?.text } })
  await shotT2(pc, 'T2-03a-loaded-toast.png')
  assert(s.title === '虚构冒烟户型' && s.walls === 6, `没载入：${JSON.stringify(s)}`)
  assert(s.kind === 'paste', `source ${s.kind}`)
  assert(s.toast === '已载入：6 面墙、4 扇门窗、3 个房间', `提示「${s.toast}」`)
  assert(!(await chatState(pc)).open, '载入后对话框没关')
  assert(s.notice === '方案里引用了底图 example-drawing.png，点这里导入户型图', `底图提示「${s.notice}」`)
  await shotT2(pc, 'T2-03-loaded.png')
  // 接到导入底图：只换图片，比例和原点保留方案里的值
  const [chooser] = await Promise.all([pc.waitForFileChooser(), pc.click('[data-testid=notice-primary]')])
  await chooser.accept([path.join(root, 'fixtures/example-drawing.png')]); await sleep(600)
  const u = await S(pc, () => { const u = window.__fss.store.getState().base.underlay; return { data: u.src.startsWith('data:image/'), mmPerPx: u.mmPerPx, origin: u.origin, names: window.__fss.store.getState().underlayNames } })
  assert(u.data && u.mmPerPx === v3.underlay.mmPerPx && JSON.stringify(u.origin) === JSON.stringify(v3.underlay.origin), `底图 ${JSON.stringify(u)}`)
  assert(u.names.main === 'example-drawing.png', `底图文件名 ${JSON.stringify(u.names)}`)
  await shotT2(pc, 'T2-03b-underlay.png')
  return `${s.toast}；底图导入后比例 ${u.mmPerPx}、原点 ${u.origin} 保留`
})

await step('T2-2 第二轮粘贴：有没保存的改动先确认；底图图片沿用、比例用新方案的', pc, async () => {
  const before = await S(pc, () => window.__fss.store.getState().base.underlay.src)
  const r2 = structuredClone(v3); r2.title = '第二轮'; r2.underlay = { ...r2.underlay, mmPerPx: 12, origin: [50, 40] }
  assert(await S(pc, () => window.__fss.store.getState().dirty), '导入底图后应算有改动')
  await openMenuItem(pc, 'menu-paste')
  await fillPaste(pc, chatReply(JSON.stringify(r2)))
  await pc.waitForSelector('[data-testid=chat-confirm]')
  assert((await S(pc, () => window.__fss.store.getState().base.title)) === '虚构冒烟户型', '确认前就替换了')
  await shotT2(pc, 'T2-04-confirm.png')
  await pc.click('[data-testid=chat-replace]'); await sleep(600)
  const u = await S(pc, () => { const s = window.__fss.store.getState(); return { title: s.base.title, same: s.base.underlay.src, mmPerPx: s.base.underlay.mmPerPx, origin: s.base.underlay.origin, toast: s.toast, notice: s.notice?.text ?? null } })
  assert(u.title === '第二轮', `标题 ${u.title}`)
  assert(u.same === before, '底图图片没沿用')
  assert(u.mmPerPx === 12 && JSON.stringify(u.origin) === '[50,40]', `比例 / 原点没用新方案的：${u.mmPerPx} ${u.origin}`)
  assert(u.toast.includes('底图沿用当前的图片'), `提示「${u.toast}」`)
  assert(!u.notice, `不该再提示导入底图：${u.notice}`)
  await shotT2(pc, 'T2-04b-round2.png')
  return `${u.toast}；比例 12、原点 [50,40]`
})

await step('T2-3「复制方案给 Chat」：没有 data:image，底图写回文件名，能原样粘回来', pc, async () => {
  await openMenuItem(pc, 'menu-chat-plan'); await sleep(200)
  const clip = await readClip(pc)
  assert(clip === (await chatState(pc)).lastCopy, '剪贴板和要复制的文字不一致')
  assert(!clip.includes('data:image'), '复制出去的方案里有 data:image')
  const json = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(clip)[1])
  assert(json.underlay.src === 'example-drawing.png' && json.version === 3 && json.walls.length === 6 && json.title === '第二轮', `方案 ${json.underlay.src} v${json.version}`)
  T2.planClip = clip
  fs.writeFileSync(path.join(outT2, 'T2-copy-plan.txt'), clip)
  // 原样粘回来：能载入，底图图片仍在（文件名对得上当前底图）
  const before = await S(pc, () => window.__fss.store.getState().base.underlay.src)
  await openMenuItem(pc, 'menu-paste'); await fillPaste(pc, clip)
  if (await pc.$('[data-testid=chat-replace]')) { await pc.click('[data-testid=chat-replace]'); await sleep(500) }
  const back = await S(pc, () => { const s = window.__fss.store.getState(); return { title: s.base.title, src: s.base.underlay.src, open: window.__chat.getState().open } })
  assert(back.title === '第二轮' && back.src === before && !back.open, `粘回来 ${JSON.stringify({ ...back, src: back.src.slice(0, 30) })}`)
  const kb = (clip.length / 1024).toFixed(1), full = await S(pc, () => window.__fss.serialize(window.__fss.store.getState().base).length)
  return `${kb} KB（带底图编码的完整方案 ${(full / 1024).toFixed(1)} KB）；src=${json.underlay.src}`
})

await step('T2-4 粘贴截断的 JSON → 提示不完整，「复制给 Chat」文字正确', pc, async () => {
  const cut = v3text.slice(0, 2000)
  await openMenuItem(pc, 'menu-paste')
  await fillPaste(pc, '好的，方案如下：\n```json\n' + cut)
  await pc.waitForSelector('[data-testid=chat-incomplete]')
  const at = cut.trimEnd().length
  const shown = await pc.$eval('[data-testid=chat-incomplete]', e => e.innerText)
  assert(shown.includes('这段 JSON 不完整，可能是 Chat 的回复被截断了'), `提示 ${shown}`)
  await pc.click('[data-testid=chat-copy-truncated]'); await sleep(250)
  const clip = await readClip(pc)
  const want = `你上次输出的方案 JSON 不完整（在第 ${at} 个字符附近断了），请重新输出完整的 JSON。`
  assert(clip.startsWith(want + '\n\n') && clip.includes('看效果：复制下面整段 JSON') && !clip.includes('只输出'), `复制的是「${clip}」`)
  assert((await S(pc, () => window.__fss.store.getState().base.title)) === '第二轮', '截断的 JSON 替换了当前方案')
  await shotT2(pc, 'T2-05-incomplete.png')
  T2.truncClip = clip
  return clip
})

await step('T2-5 粘贴有几何错误的方案 → 不替换；「复制问题给 Chat」里有那个错误和用户补的话', pc, async () => {
  const bad = structuredClone(v3); bad.title = '坏方案'; bad.openings[0].offset = 6000
  const host = bad.walls.find(w => w.id === bad.openings[0].wall)
  await pc.click('[data-testid=chat-paste-input]')
  await fillPaste(pc, chatReply(JSON.stringify(bad, null, 2)))
  await pc.waitForSelector('[data-testid=chat-failed]')
  const listed = await pc.$eval('[data-testid=chat-errors]', e => e.innerText)
  assert(listed.includes(`洞口 ${bad.openings[0].id}`), `列表 ${listed}`)
  const s = await S(pc, () => ({ title: window.__fss.store.getState().base.title, walls: window.__fss.store.getState().base.walls.length }))
  assert(s.title === '第二轮', `被替换成了 ${s.title}`)
  await shotT2(pc, 'T2-06-failed.png')
  await pc.click('[data-testid=chat-to-issues]'); await pc.waitForSelector('[data-testid=chat-note]')
  await pc.click('[data-testid=chat-note]'); await pc.keyboard.type('客厅南墙的窗位置不对'); await sleep(150)
  await pc.click('[data-testid=chat-copy-issues]'); await sleep(250)
  const clip = await readClip(pc)
  const len = Math.hypot(host.b[0] - host.a[0], host.b[1] - host.a[1])
  assert(clip.split('\n')[0] === '请按下面的问题修改方案，改完重新输出完整的 JSON（一个代码块），不要只输出改动的部分。', `第一行 ${clip.split('\n')[0]}`)
  assert(clip.includes(`洞口 ${bad.openings[0].id}`) && clip.includes(`墙 ${host.id}`) && clip.includes(`超出 ${Math.round(6000 + bad.openings[0].width - len)} mm`), '没写清哪个洞口、哪面墙、超多少')
  assert(clip.includes('## 各房间面积') && clip.includes('## 还没答的问题卡') && clip.includes('客厅南墙的窗位置不对'), '缺面积 / 问题卡 / 用户补充')
  await shotT2(pc, 'T2-07-issues.png')
  fs.writeFileSync(path.join(outT2, 'T2-copy-issues-failed.txt'), clip)
  T2.issuesClip = clip
  return clip.split('\n').find(l => l.includes('[错误]'))
})

await step('T2-6 剪贴板不可用 → 弹出文本框全选，手动复制', pc, async () => {
  await S(pc, () => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); document.execCommand = () => false })
  await pc.click('[data-testid=chat-copy-issues]'); await sleep(400)
  await pc.waitForSelector('[data-testid=chat-manual] textarea')
  const m = await pc.$eval('[data-testid=chat-manual] textarea', e => ({ v: e.value, a: e.selectionStart, b: e.selectionEnd, focus: document.activeElement === e }))
  const c = await chatState(pc)
  assert(m.v === c.lastCopy && m.a === 0 && m.b === m.v.length && m.focus, `手动复制框 ${m.a}-${m.b}/${m.v.length} focus=${m.focus}`)
  await shotT2(pc, 'T2-08-manual.png')
  // 复制方案也一样
  await pc.keyboard.press('Escape'); await sleep(300)
  await openMenuItem(pc, 'menu-chat-plan'); await sleep(300)
  const v = await chatState(pc)
  assert(v.open && v.view === 'plan' && !v.lastCopy.includes('data:image'), `复制方案失败时 ${JSON.stringify({ open: v.open, view: v.view })}`)
  await pc.waitForSelector('[data-testid=chat-manual] textarea')
  await shotT2(pc, 'T2-08b-manual-plan.png')
  await pc.keyboard.press('Escape'); await sleep(300)
  return '问题、方案两处都弹出全选的文本框'
})

await step('T2-7 已载入的方案：文件菜单「复制问题给 Chat」；打开坏文件的失败提示里也能复制', pc, async () => {
  await pc.goto(BASE + '/', { waitUntil: 'networkidle0' }); await sleep(1200) // 重新打开页面：恢复剪贴板（上一步打了桩）；自动保存回到「第二轮」
  assert((await S(pc, () => window.__fss.store.getState().base?.title)) === '第二轮', '自动保存没恢复')
  assert((await S(pc, () => window.__fss.store.getState().underlayNames.main)) === 'example-drawing.png', '自动保存没记住底图文件名')
  await openMenuItem(pc, 'menu-chat-issues')
  await pc.waitForSelector('[data-testid=chat-issues-preview]'); await sleep(300)
  await shotT2(pc, 'T2-09-issues-current.png')
  await pc.click('[data-testid=chat-copy-issues]'); await sleep(250)
  const clip = await readClip(pc)
  assert(clip.includes('## 校验结果：没有错误和提醒') && /区域\d（r\d）：\d+\.\d\d m²/.test(clip), '当前方案的问题文字不对')
  fs.writeFileSync(path.join(outT2, 'T2-copy-issues-current.txt'), clip)
  await pc.keyboard.press('Escape'); await sleep(300)
  // 「打开方案」选了一个坏文件：提示条里有「复制问题给 Chat」
  const badFile = path.join(downloads, 't2-bad.json'), bad = structuredClone(v3); bad.walls[1].thickness = -5
  fs.writeFileSync(badFile, JSON.stringify(bad))
  await pc.waitForSelector('[data-testid=chat-sheet]', { hidden: true })
  await pickFileVia(pc, 'menu-open', badFile); await sleep(500)
  await pc.waitForSelector('[data-testid=notice]')
  const notice = await pc.$eval('[data-testid=notice]', e => e.innerText)
  assert(notice.includes('复制问题给 Chat'), `失败提示 ${notice}`)
  await shotT2(pc, 'T2-10-load-failed-notice.png')
  await pc.click('[data-testid=notice-primary]'); await pc.waitForSelector('[data-testid=chat-copy-issues]'); await sleep(300)
  await pc.click('[data-testid=chat-copy-issues]'); await sleep(250)
  const clip2 = await readClip(pc)
  assert(clip2.includes(`墙 ${bad.walls[1].id}`) && clip2.includes('[错误]'), `失败文件的问题文字 ${clip2.slice(0, 300)}`)
  fs.writeFileSync(path.join(outT2, 'T2-copy-issues-openfile.txt'), clip2)
  await pc.keyboard.press('Escape'); await sleep(300)
  return clip2.split('\n').find(l => l.includes('[错误]'))
})

await step('T2-8 3D 导出图片 16:9', pc, async () => {
  await pc.keyboard.press('Tab'); await sleep(1800)
  const since = Date.now()
  await pc.click('[data-testid=shot-open]'); await pc.waitForSelector('[data-testid=shot-aspect-169]')
  await pc.click('[data-testid=shot-aspect-169]'); await sleep(200)
  await shotT2(pc, 'T2-11-shot-169-popover.png')
  await pc.click('[data-testid=shot-go]')
  const f = await waitFile(downloads, /16x9\.png$/, since - 1000)
  const buf = fs.readFileSync(f), w = buf.readUInt32BE(16), h = buf.readUInt32BE(20)
  assert(Math.abs(w / h - 16 / 9) < 0.002 && w >= 1920, `尺寸 ${w}×${h}`)
  fs.copyFileSync(f, path.join(outT2, 'T2-12-export-16x9.png'))
  await pc.keyboard.press('Tab'); await sleep(800)
  return `${path.basename(f)} ${w}×${h}`
})

await step('T2-9 手机：空状态入口、粘贴对话框、错误、文件菜单', pc, async () => {
  const pmc = await newPage(390, 844, 2)
  await pmc.goto(BASE + '/?state=empty', { waitUntil: 'networkidle0' }); await sleep(600)
  await shotT2(pmc, 'T2-M1-empty.png')
  await pmc.click('[data-testid=empty-paste]'); await sleep(600)
  await shotT2(pmc, 'T2-M2-dialog.png')
  const bad = structuredClone(v3); bad.openings[0].offset = 6000
  await fillPaste(pmc, chatReply(JSON.stringify(bad)))
  await pmc.waitForSelector('[data-testid=chat-failed]'); await sleep(300)
  await shotT2(pmc, 'T2-M3-failed.png')
  await fillPaste(pmc, '```json\n' + v3text.slice(0, 900))
  await pmc.waitForSelector('[data-testid=chat-incomplete]'); await sleep(300)
  await shotT2(pmc, 'T2-M4-incomplete.png')
  await fillPaste(pmc, chatReply(v3text)); await sleep(700)
  assert((await S(pmc, () => window.__fss.store.getState().base?.walls.length)) === 6, '手机上没载入')
  await shotT2(pmc, 'T2-M5-loaded.png')
  await pmc.click('[data-testid=file-menu]'); await pmc.waitForSelector('[data-testid=menu-chat-issues]'); await sleep(300)
  await shotT2(pmc, 'T2-M6-menu.png')
  await pmc.click('[data-testid=menu-chat-issues]'); await sleep(700)
  await shotT2(pmc, 'T2-M7-issues.png')
  const wide = await S(pmc, () => document.documentElement.scrollWidth <= window.innerWidth)
  assert(wide, '手机上横向溢出')
  await pmc.close()
  return '截图 T2-M1…M7'
})
await pc.close()

/* ═════════ D7 简版格式（界面）：粘贴简版 / 说明条 + 「简版」标记 / 格式不对给简版模板 / 简版有错 ═════════ */
const outD7 = path.join(root, '.shots/D7')
fs.mkdirSync(outD7, { recursive: true })
const shotD7 = (pg, f) => pg.screenshot({ path: path.join(outD7, f) })
const { SIMPLE_TEMPLATE, SIMPLE_RULES } = await import('../src/core/simple.ts')
// 虚构的弱模型失败样本（任务书原文）
const WEAK = '{"floorplan-structure":"version 3","layout":{"rooms":[{"name":"客厅","poly":[[0,0],[5000,0],[5000,4000],[0,4000]],"area":20,"type":"living"}],"walls":[],"doors":[{"from":"客厅","to":"卧室"}]}}'
const simpleReply = json => `好的，按简版格式整理如下：\n\n\`\`\`json\n${json}\n\`\`\`\n`
const d7state = pg => S(pg, () => { const s = window.__fss.store.getState(); return { title: s.base?.title, walls: s.base?.walls.length, openings: s.base?.openings.length, windows: s.base?.openings.filter(o => /window/.test(o.kind)).length, rooms: s.base?.rooms.length, source: s.base?.meta?.source, note: s.simpleNote, tool: s.tool, kind: s.openingKind, toast: s.toast, sel: s.sel, dirty: s.dirty } })
const visible = (pg, sel) => pg.$eval(sel, e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' }).catch(() => false)
async function pasteVia(pg, text) {
  await pg.waitForSelector('[data-testid=chat-sheet]', { hidden: true })
  await pg.click('[data-testid=file-menu]'); await pg.waitForSelector('[data-testid=menu-paste]')
  await pg.click('[data-testid=menu-paste]'); await pg.waitForSelector('[data-testid=chat-paste-input]'); await sleep(500)
  await fillPaste(pg, text)
}
const pd = await newPage()
const D7 = {}

await step('D7-1 粘贴简版模板 → 载入（墙 > 0、门洞 4、窗 0）；说明条醒目可见', pd, async () => {
  await pd.goto(BASE + '/?state=empty', { waitUntil: 'networkidle0' })
  await pd.waitForSelector('[data-testid=empty-paste]'); await sleep(300)
  await pd.click('[data-testid=empty-paste]'); await pd.waitForSelector('[data-testid=chat-paste-input]'); await sleep(450)
  await fillPaste(pd, simpleReply(SIMPLE_TEMPLATE)); await sleep(700)
  const s = await d7state(pd)
  assert(s.walls > 0 && s.openings === 4 && s.windows === 0 && s.rooms === 5, `载入结果 ${JSON.stringify(s)}`)
  assert(s.source === 'floorplan-simple', `meta.source ${s.source}`)
  assert(s.toast === `已载入简版方案：${s.walls} 面墙、4 个门洞、5 个房间（墙和门洞是自动生成的），没有窗户`, `提示「${s.toast}」`)
  await pd.waitForSelector('[data-testid=simple-banner]')
  const text = await pd.$eval('[data-testid=simple-banner]', e => e.innerText)
  assert(text.includes('简版方案') && text.includes('墙和门洞是工具按房间自动生成的，没有窗户。') && text.includes('不是提示词或工具的问题') && text.includes('装了 Skill 的 Agent 版'), `说明条 ${text}`)
  assert(await visible(pd, '[data-testid=simple-mark]'), '标题区没有「简版」标记')
  // 说明条不压住平面、不和右侧卡 / 顶栏重叠
  const geo = await S(pd, () => {
    const r = document.querySelector('[data-testid=simple-banner]').getBoundingClientRect()
    const b = window.__fss.planBounds(window.__fss.store.getState().base)
    const a = window.__plan2screen([b.x0 ?? b[0], b.y0 ?? b[1]])
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, planTop: a[1] }
  })
  assert(geo.top >= 80 && geo.right < W - 392, `说明条位置 ${JSON.stringify(geo)}`)
  assert(geo.planTop > geo.bottom, `平面被说明条压住：平面顶 ${geo.planTop}，说明条底 ${geo.bottom}`)
  await sleep(1800) // 等提示消失再截图
  await shotD7(pd, 'D7-01-desktop-banner.png')
  D7.walls = s.walls
  return `${s.walls} 面墙、${s.openings} 个门洞、窗 ${s.windows}；${s.toast}`
})

await step('D7-2 收起 → 标题区「简版」标记；点标记再展开；怎么补窗 → 开始加窗；问题卡能定位', pd, async () => {
  await pd.click('[data-testid=simple-collapse]'); await sleep(500)
  assert(!(await pd.$('[data-testid=simple-banner]')), '收起后说明条还在')
  assert(await visible(pd, '[data-testid=simple-mark]'), '收起后没有「简版」标记')
  await shotD7(pd, 'D7-02-desktop-collapsed.png')
  await pd.click('[data-testid=simple-mark]'); await pd.waitForSelector('[data-testid=simple-banner]'); await sleep(400)
  assert((await d7state(pd)).note, '点标记没展开')
  // 怎么补窗：说明里写实际入口，「开始加窗」直接进门窗工具、类型选窗
  await pd.click('[data-testid=simple-how-window]'); await pd.waitForSelector('[data-testid=simple-how]'); await sleep(350)
  const how = await pd.$eval('[data-testid=simple-how]', e => e.innerText)
  assert(how.includes('门窗') && how.includes('窗'), `怎么补窗 ${how}`)
  await shotD7(pd, 'D7-03-desktop-how-window.png')
  await pd.click('[data-testid=simple-start-window]'); await sleep(400)
  const s = await d7state(pd)
  assert(s.tool === 'opening' && s.kind === 'window' && !s.note, `开始加窗后 ${JSON.stringify({ tool: s.tool, kind: s.kind, note: s.note })}`)
  assert(!(await pd.$('[data-testid=simple-banner]')), '工具激活时说明条应让开')
  await pd.keyboard.press('Escape'); await sleep(200)
  // 问题卡：simple-windows、simple-entry 都在待核对列表里；入户门那张能定位到门
  const list = await S(pd, () => document.body.innerText)
  assert(list.includes('这是简版方案：窗户没有读出来') && list.includes('入户门放在了『客餐厅』'), '待核对列表里没有简版问题卡')
  await S(pd, () => [...document.querySelectorAll('button')].find(b => b.innerText.includes('入户门放在了'))?.click()); await sleep(500)
  await S(pd, () => [...document.querySelectorAll('button')].find(b => b.innerText.startsWith('问的是'))?.click()); await sleep(300)
  const sel = (await d7state(pd)).sel
  const entry = await S(pd, () => window.__fss.store.getState().base.questions.find(q => q.id === 'simple-entry').targets[0])
  assert(sel.length === 1 && sel[0].id === entry, `定位到 ${JSON.stringify(sel)}，应为 ${entry}`)
  await shotD7(pd, 'D7-04-desktop-question-entry.png')
  await pd.keyboard.press('Escape'); await pd.keyboard.press('Escape'); await sleep(200)
  return `标记可点；开始加窗 → 门窗工具 / 窗；问题卡定位到 ${entry}`
})

await step('D7-3 导出 JSON 存盘 → 刷新（自动保存恢复）→「简版」标记还在', pd, async () => {
  const since = Date.now()
  await pd.click('[data-testid=file-menu]'); await pd.waitForSelector('[data-testid=menu-export]')
  await pd.click('[data-testid=menu-export]')
  const f = await waitFile(downloads, /\.json$/, since - 1000)
  const saved = JSON.parse(fs.readFileSync(f, 'utf8'))
  assert(saved.version === 3 && saved.meta?.source === 'floorplan-simple', `存出的文件 v${saved.version} source=${saved.meta?.source}`)
  await sleep(600)
  await pd.goto(BASE + '/', { waitUntil: 'networkidle0' }); await sleep(1200)
  const s = await d7state(pd)
  assert(s.source === 'floorplan-simple' && s.walls === D7.walls, `刷新后 ${JSON.stringify(s)}`)
  assert(await visible(pd, '[data-testid=simple-mark]'), '刷新后没有「简版」标记')
  // 打开刚存的文件（完整 v3，meta.source 记着简版来源）：标记照样在；说明条和刷新一样保持收起，点标记再看
  await pickFileVia(pd, 'menu-open', f); await sleep(700)
  assert(await visible(pd, '[data-testid=simple-mark]'), '打开存盘文件后没有「简版」标记')
  await shotD7(pd, 'D7-05-desktop-reloaded.png')
  return `${path.basename(f)}：meta.source=floorplan-simple；刷新、重新打开后标记都在`
})

await step('D7-4 弱模型失败样本 → 不载入；「格式不对」；复制简版模板给 Chat', pd, async () => {
  const before = (await d7state(pd)).title
  await pasteVia(pd, '这是方案：\n```json\n' + WEAK + '\n```')
  await pd.waitForSelector('[data-testid=chat-shape]')
  const box = await pd.$eval('[data-testid=chat-shape]', e => e.innerText)
  assert(box.includes('格式不对，工具读不了') && box.includes('多半是 Chat 写不对完整格式'), `结果框 ${box}`)
  const reasons = await pd.$$eval('[data-testid=chat-shape-reasons] li', l => l.length)
  assert(reasons >= 1 && reasons <= 4 && !box.includes('字段 '), `原因 ${reasons} 条：${box}`)
  assert((await d7state(pd)).title === before, '格式不对的方案替换了当前方案')
  await pd.click('[data-testid=chat-copy-shape]'); await sleep(300)
  const clip = await readClip(pd)
  assert(clip.includes('floorplan-simple') && clip.includes('看效果：复制下面整段 JSON') && !clip.includes('只输出'), `复制的文字 ${clip.slice(0, 200)}`)
  fs.writeFileSync(path.join(outD7, 'D7-copy-shape.txt'), clip)
  await shotD7(pd, 'D7-06-desktop-shape.png')
  // 复制问题页的预览也是这段
  await pd.click('[data-testid=chat-to-issues]'); await pd.waitForSelector('[data-testid=chat-issues-preview]'); await sleep(300)
  const pv = await pd.$eval('[data-testid=chat-issues-preview]', e => e.innerText)
  const label = await pd.$eval('[data-testid=chat-copy-issues]', e => e.innerText)
  assert(pv.includes('floorplan-simple') && pv.includes('不要再写完整格式了') && label.includes('复制简版模板给 Chat'), `预览 / 按钮 ${label}`)
  await shotD7(pd, 'D7-07-desktop-shape-preview.png')
  await pd.keyboard.press('Escape'); await sleep(300)
  return clip.split('\n').slice(0, 3).join(' / ')
})

await step('D7-5 简版有阻断错误（poly 只有两个点）→ 不载入；复制的文字第一行固定、含模板', pd, async () => {
  const before = (await d7state(pd)).title
  const bad = JSON.parse(SIMPLE_TEMPLATE); bad.title = '坏简版'; bad.rooms[0].poly = [[0, 0], [3600, 0]]
  await pasteVia(pd, simpleReply(JSON.stringify(bad, null, 2)))
  await pd.waitForSelector('[data-testid=chat-simple-failed]')
  const box = await pd.$eval('[data-testid=chat-simple-failed]', e => e.innerText)
  assert(box.includes('简版方案有错误，没有载入') && box.includes('至少要 3 个点'), `结果框 ${box}`)
  assert((await d7state(pd)).title === before, '有错误的简版替换了当前方案')
  await shotD7(pd, 'D7-08-desktop-simple-failed.png')
  await pd.click('[data-testid=chat-to-issues]'); await pd.waitForSelector('[data-testid=chat-copy-issues]'); await sleep(300)
  await pd.click('[data-testid=chat-copy-issues]'); await sleep(300)
  const clip = await readClip(pd)
  assert(clip.split('\n')[0].startsWith('请按下面的问题修改简版方案'), `第一行 ${clip.split('\n')[0]}`)
  assert(clip.includes(SIMPLE_TEMPLATE) && SIMPLE_RULES.every(r => clip.includes(r)), '没附简版规则和模板')
  fs.writeFileSync(path.join(outD7, 'D7-copy-simple-failed.txt'), clip)
  await pd.keyboard.press('Escape'); await sleep(300)
  return clip.split('\n')[0]
})

await step('D7-6 打开格式不对的文件 → 不载入；提示条「复制问题给 Chat」给简版模板', pd, async () => {
  const before = (await d7state(pd)).title
  const weakFile = path.join(downloads, 'd7-weak.json'); fs.writeFileSync(weakFile, WEAK)
  await pd.waitForSelector('[data-testid=chat-sheet]', { hidden: true })
  await pickFileVia(pd, 'menu-open', weakFile); await sleep(500)
  await pd.waitForSelector('[data-testid=notice]')
  const notice = await pd.$eval('[data-testid=notice]', e => e.innerText)
  assert(notice.includes('格式不对') && notice.includes('复制问题给 Chat'), `提示条 ${notice}`)
  assert((await d7state(pd)).title === before, '格式不对的文件替换了当前方案')
  await pd.click('[data-testid=notice-primary]'); await pd.waitForSelector('[data-testid=chat-copy-issues]'); await sleep(300)
  await pd.click('[data-testid=chat-copy-issues]'); await sleep(300)
  const clip = await readClip(pd)
  assert(clip.includes('floorplan-simple') && clip.includes('看效果：复制下面整段 JSON') && !clip.includes('只输出'), `复制的文字 ${clip.slice(0, 200)}`)
  await pd.keyboard.press('Escape'); await sleep(300)
  return notice.split('\n')[0]
})

await step('D7-7 合法 v3 照旧能载入，没有简版说明条和标记', pd, async () => {
  await pasteVia(pd, chatReply(v3text)); await sleep(300)
  if (await pd.$('[data-testid=chat-replace]')) { await pd.click('[data-testid=chat-replace]'); await sleep(500) }
  await sleep(400)
  const s = await d7state(pd)
  assert(s.walls === 6 && s.title === '虚构冒烟户型' && s.source !== 'floorplan-simple', `载入 ${JSON.stringify(s)}`)
  assert(!(await pd.$('[data-testid=simple-banner]')) && !(await pd.$('[data-testid=simple-mark]')), '合法 v3 出现了简版说明条 / 标记')
  return `${s.title}：${s.walls} 面墙，无简版标记`
})
await pd.close()

await step('D7-8 手机 390×844：说明条完整显示、不挡主要操作；标记不挤掉方案名', page, async () => {
  const pm = await newPage(390, 844, 2)
  await pm.goto(BASE + '/?state=empty', { waitUntil: 'networkidle0' }); await sleep(700)
  await pm.click('[data-testid=empty-paste]'); await pm.waitForSelector('[data-testid=chat-paste-input]'); await sleep(700)
  await fillPaste(pm, simpleReply(SIMPLE_TEMPLATE)); await sleep(900)
  await pm.waitForSelector('[data-testid=simple-banner]')
  const g = await S(pm, () => {
    const rect = s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom } }
    const name = [...document.querySelectorAll('[data-testid=file-menu] span[title]')][0]
    return { banner: rect('[data-testid=simple-banner]'), mark: rect('[data-testid=simple-mark]'), menu: rect('[data-testid=file-menu]'), dock: rect('[data-testid=tool-more]'), seg: rect('[data-testid=mode-original]'),
      name: name ? { text: name.textContent, clipped: name.scrollWidth > name.clientWidth + 1 } : null, wide: document.documentElement.scrollWidth <= window.innerWidth, vw: window.innerWidth }
  })
  assert(g.banner.l >= 0 && g.banner.r <= g.vw && g.banner.t >= 120, `说明条位置 ${JSON.stringify(g.banner)}`)
  assert(g.dock && g.banner.b < g.dock.t - 120, `说明条压到底部工具坞 / 下一步条：${g.banner.b} vs ${g.dock?.t}`)
  assert(g.mark && g.mark.t >= g.menu.b, '标记不在第二行')
  assert(g.name && g.name.text === '我家' && !g.name.clipped, `方案名被挤：${JSON.stringify(g.name)}`)
  assert(g.wide, '手机上横向溢出')
  await sleep(1800)
  await shotD7(pm, 'D7-M1-mobile-banner.png')
  await pm.click('[data-testid=simple-collapse]'); await sleep(600)
  assert(await visible(pm, '[data-testid=simple-mark]') && !(await pm.$('[data-testid=simple-banner]')), '手机收起后')
  await shotD7(pm, 'D7-M2-mobile-collapsed.png')
  await pasteVia(pm, '```json\n' + WEAK + '\n```')
  await pm.waitForSelector('[data-testid=chat-shape]'); await sleep(400)
  await shotD7(pm, 'D7-M3-mobile-shape.png')
  await pm.close()
  return `说明条 ${Math.round(g.banner.t)}–${Math.round(g.banner.b)} px；方案名「${g.name.text}」完整`
})

await browser.close()
try { process.kill(srvPid, 'SIGTERM') } catch {}

const ok = results.every(r => r.ok) && !errors.length && !external.length
results.push({ name: '10 控制台零报错、零外部请求', ok: !errors.length && !external.length, note: `报错 ${errors.length}，外部请求 ${external.length}` })
console.log(`${!errors.length && !external.length ? '✔' : '✘'} 10 控制台零报错、零外部请求 — 报错 ${errors.length}，外部请求 ${external.length}`)
if (errors.length) console.log(errors.join('\n'))
if (external.length) console.log(external.join('\n'))
fs.writeFileSync(path.join(out, 'e2e-result.json'), JSON.stringify({ results, errors, external, at: new Date().toISOString() }, null, 2))
console.log(ok ? '\n全部通过' : '\n有失败')
process.exit(ok ? 0 : 1)
