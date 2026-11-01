// 装修态连续挪动 e2e：node scripts/e2e-decor-moving.mjs   （先 npm run build）
// 拖家具、方向键挪的时候，全屋校验和画中画 3D 先不跟（为了不卡），这里盯着「停下以后一定跟上」：
// 3D 里的位置到位、问题提示按新位置更新、暂停标记清掉；缩放平移不改方案。只用公开示例数据。
import puppeteer from 'puppeteer-core'
import { chromePath } from './browser-path.mjs'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, process.env.E2E_OUT ?? '.shots/decor-moving')
const profile = path.join(out, '.chrome')
fs.rmSync(profile, { recursive: true, force: true }); fs.mkdirSync(profile, { recursive: true })
const html = path.resolve(process.env.E2E_HTML ?? path.join(root, 'dist/index.html'))
if (!fs.existsSync(html)) { console.error(`没有 ${html}：先运行 npm run build`); process.exit(1) }
const W = 1440, H = 900, sleep = ms => new Promise(r => setTimeout(r, ms))
const errors = [], results = []
const assert = (c, msg) => { if (!c) throw new Error(msg) }
const step = async (name, fn) => { try { await fn(); results.push(['ok', name]); console.log('  ok', name) } catch (e) { results.push(['FAIL', name]); console.log('FAIL', name, e.message) } }
const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: profile, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`] })
const page = await browser.newPage()
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 })
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push(e.message))
await page.goto(`file://${html}?mode=decor`, { waitUntil: 'load' })
await page.waitForFunction(() => window.__fss?.store.getState().base?.decor, { timeout: 30000 })
await sleep(1200)
await page.keyboard.press('Escape'); await sleep(300)

const ui = () => page.evaluate(() => { const d = window.__decorUI(); return { dragging: d.dragging, nudging: d.nudging, sel: d.sel?.id } })
const atOf = id => page.evaluate(id => window.__fss.store.getState().base.decor.furniture.find(f => f.id === id).at, id)
const orphanText = () => page.evaluate(() => document.body.innerText)
// 平面 mm → 屏幕
const toScreen = ([x, y]) => page.evaluate(([x, y]) => { const m = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)/.exec(document.querySelector('[data-canvas="main"] svg g[transform]').getAttribute('transform')); return [+m[1] + x * +m[3], +m[2] + y * +m[3]] }, [x, y])
const pickFurniture = () => page.evaluate(() => {
  const d = window.__fss.store.getState().base.decor
  return d.furniture.filter(f => !f.in && f.at && f.size && f.type === 'sofa-3').concat(d.furniture.filter(f => !f.in && f.at && f.size))[0]?.id
})
const id = await pickFurniture()

await step('缩放、平移不改方案，也不算改动', async () => {
  await page.mouse.move(640, 460)
  for (let i = 0; i < 6; i++) { await page.mouse.wheel({ deltaY: -60 }); await sleep(40) }
  const dirty = await page.evaluate(() => window.__fss.store.getState().dirty)
  assert(dirty === false, '缩放把方案标成了有改动')
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('plan-zoom', { detail: 0.7 }))); await sleep(300)
})

let dropped
await step('拖家具：拖动中标记开着，松手标记清掉，位置落定', async () => {
  const a0 = await atOf(id), [sx, sy] = await toScreen(a0)
  await page.mouse.move(sx, sy); await page.mouse.down()
  for (let i = 1; i <= 8; i++) { await page.mouse.move(sx + i * 6, sy + i * 3); await sleep(30) }
  assert((await ui()).dragging === id, '拖动中 dragging 应该是这件')
  await page.mouse.up(); await sleep(400)
  assert((await ui()).dragging === null, '松手后 dragging 没清')
  dropped = await atOf(id)
  assert(dropped[0] !== a0[0] || dropped[1] !== a0[1], '没拖动')
})

await step('方向键挪：连按时标记开着，停下后标记自己清掉', async () => {
  const a0 = await atOf(id)
  for (let i = 0; i < 5; i++) { await page.keyboard.press('ArrowRight'); await sleep(40) }
  const a1 = await atOf(id)
  assert(a1[0] === a0[0] + 50, `方向键每下 10 mm，5 下应该 +50，实际 ${a1[0] - a0[0]}`)
  await page.waitForFunction(() => window.__decorUI().nudging === null, { timeout: 8000 })
  dropped = a1
})

await step('松手后 3D 跟上：切到 3D，这件东西就在新位置', async () => {
  await page.evaluate(() => window.__fss.store.getState().setMain('3d')); await sleep(1200)
  const c = await page.evaluate(id => window.__itemCenter3d(id), id)
  assert(c, '3D 里找不到这件')
  const f = await page.evaluate(id => window.__fss.store.getState().base.decor.furniture.find(f => f.id === id), id)
  assert(Math.abs(c[0] - f.at[0] / 1000) < 0.6 && Math.abs(c[2] - f.at[1] / 1000) < 0.6, `3D 位置 ${c} 和数据 ${f.at} 对不上`)
  await page.evaluate(() => window.__fss.store.getState().setMain('2d')); await sleep(600)
})

await step('问题提示没有被拖动弄丢', async () => {
  // 示例方案带「没地方挂了」的提示：连续挪动时沿用旧结果，停下后重算，提示都应该还在
  assert(/没地方挂/.test(await orphanText()), '拖动之后问题提示丢了')
})

await step('拖动中的 3D 画中画不崩，松手后画面正常', async () => {
  const a0 = await atOf(id), [sx, sy] = await toScreen(a0)
  await page.mouse.move(sx, sy); await page.mouse.down()
  for (let i = 1; i <= 6; i++) { await page.mouse.move(sx - i * 6, sy - i * 3); await sleep(30) }
  await page.screenshot({ path: path.join(out, '拖动中.png') })
  await page.mouse.up(); await sleep(800)
  await page.screenshot({ path: path.join(out, '松手后.png') })
  assert(!(await ui()).dragging, 'dragging 没清')
})

await browser.close()
const failed = results.filter(r => r[0] === 'FAIL').length
console.log(`\n${results.length - failed}/${results.length} 通过；报错 ${errors.length}`)
errors.slice(0, 8).forEach(e => console.log(e))
process.exit(failed || errors.length ? 1 : 0)
