// 装修阶段 e2e：node scripts/e2e-decor.mjs   （先 npm run build）
// 本机 Chrome 无头（puppeteer-core，跑完自己关；不起任何服务，直接 file:// 打开单文件产物 dist/index.html）。
// 用真实鼠标键盘走一遍：切装修 → 换风格；换地面、换墙面；进立面画背景墙、挖电视洞；外墙上嵌柜子（事实卡、俯视图剩余厚度）；
// 挖到墙厚被引导去改造；放沙发并拖动（净距）；改造态拆一面挂着柜子的墙 → 装修态标「没地方挂了」；3D 白模三个探针；
// 撤销 / 重做、自动保存、导出 JSON 带装修层；全程零报错、零外部请求。截图在 .shots/D4/。只用公开示例数据。
import puppeteer from 'puppeteer-core'
import { chromePath } from './browser-path.mjs'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, process.env.E2E_OUT ?? '.shots/D6/e2e-decor')
const downloads = path.join(out, 'downloads')
const profile = path.join(out, '.chrome')
for (const d of [downloads, profile]) { fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true }) }
const html = path.resolve(process.env.E2E_HTML ?? path.join(root, 'dist/index.html'))
if (!fs.existsSync(html)) { console.error(`没有 ${html}：先运行 npm run build`); process.exit(1) }
const URL0 = `file://${html}`
const W = 1440, H = 900
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = [], errors = [], external = []
const assert = (c, msg) => { if (!c) throw new Error(msg) }

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  userDataDir: profile,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`],
})
function watch(page, tag) {
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${tag} console] ${m.text()}`) })
  page.on('pageerror', e => errors.push(`[${tag} pageerror] ${e.message}`))
  page.on('request', r => { const u = r.url(); if (!/^(file:|data:|blob:)/.test(u)) external.push(u) })
}
async function newPage(dsf = 1) {
  const page = await browser.newPage()
  await page.setViewport({ width: W, height: H, deviceScaleFactor: dsf })
  const cdp = await page.createCDPSession()
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true })
  watch(page, `dsf${dsf}`)
  return page
}
async function step(name, page, fn) {
  if (process.env.E2E_ONLY && !new RegExp(process.env.E2E_ONLY).test(name)) return // 只跑名字匹配的几步（开发时用）
  const t0 = Date.now()
  try { const note = await fn(); results.push({ name, ok: true, note: note ?? '', ms: Date.now() - t0 }); console.log(`✔ ${name}${note ? ' — ' + note : ''}`) }
  catch (e) { results.push({ name, ok: false, note: e.message, ms: Date.now() - t0 }); console.log(`✘ ${name} — ${e.message}`); await page.screenshot({ path: path.join(out, `FAIL-${results.length}.png`) }).catch(() => {}) }
}
const shot = (page, f) => page.screenshot({ path: path.join(out, f) })
const S = (page, fn, ...a) => page.evaluate(fn, ...a)
const decor = page => S(page, () => window.__fss.store.getState().base?.decor)
const mode = page => S(page, () => window.__fss.store.getState().mode)
const P = (page, p) => S(page, q => window.__plan2screen(q), p)
const E = (page, s, z) => S(page, ([s, z]) => { const m = window.__elevModel; return window.__elev2screen(m.ax.toU(s), z) }, [s, z])
async function clickPlan(page, p, opts) { const [x, y] = await P(page, p); await page.mouse.click(x, y, opts); await sleep(320) }
async function drag(page, [x0, y0], [x1, y1], steps = 14, mid) {
  await page.mouse.move(x0, y0); await page.mouse.down()
  for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await sleep(18); if (mid && i === Math.round(steps * 0.7)) await mid() }
  await page.mouse.up(); await sleep(300)
}
async function typeInto(page, sel, text) {
  await page.click(sel); await sleep(120)
  await page.keyboard.down('Meta'); await page.keyboard.press('a'); await page.keyboard.up('Meta')
  await page.keyboard.type(text); await page.keyboard.press('Enter'); await sleep(350)
}
const nextText = page => S(page, () => document.querySelector('[data-testid=next-step]')?.textContent ?? '')

try {
  const page = await newPage(1)
  await page.goto(`${URL0}?mode=renovation`, { waitUntil: 'load' })
  await page.waitForFunction(() => !!window.__fss?.store.getState().base, { timeout: 20000 })
  await sleep(1200)

  await step('1 切装修 → 换风格（悬停实时预览，点一下选中，应用；保留单独改过的面）', page, async () => {
    await page.click('[data-testid=mode-decor]'); await sleep(700)
    assert(await mode(page) === 'decor', '没切到装修')
    assert(await S(page, () => !!document.querySelector('.app-bg.mode-decor')), '装修态底色没换成杏色那套')
    const rail = await S(page, () => [...document.querySelectorAll('[data-rail-item]')].map(e => e.textContent))
    assert(rail.join('') === '选择材质家具柜子立面', `工具栏不是装修那套：${rail.join(',')}`)
    const ro = await S(page, () => { const s = window.__fss.store.getState(); const n = s.base.changes.length; s.edit([{ id: 'x', op: 'remove', type: 'wall', target: 'w-c', by: 'user', status: 'confirmed' }], { silent: true }); return n === window.__fss.store.getState().base.changes.length })
    assert(ro, '装修态里结构应该只读')
    const before = await S(page, () => document.querySelector('[data-floor=r-living]')?.getAttribute('fill'))
    await page.click('[data-testid=change-style]'); await sleep(900)
    await page.waitForSelector('[data-testid=style-wabi]', { visible: true })
    await page.hover('[data-testid=style-wabi]'); await sleep(500)
    const pv = await S(page, () => window.__decorUI?.().preview)
    const during = await S(page, () => document.querySelector('[data-floor=r-living]')?.getAttribute('fill'))
    assert(pv === 'wabi', `悬停没进预览：${pv}`)
    assert(during !== before, '预览时平面地面没换')
    assert((await decor(page)).style === 'cream', '悬停不该改数据')
    await shot(page, '01-style-preview.png')
    await page.click('[data-testid=style-wabi]'); await sleep(200)
    await page.click('[data-testid=style-apply]'); await sleep(600)
    const d = await decor(page)
    assert(d.style === 'wabi', `没应用：${d.style}`)
    assert(d.surfaces.some(s => s.id === 'sf-bedwall'), '保留单独改过的面：床头墙被清掉了')
    await shot(page, '02-style-applied.png')
    return `预览 fill ${before} → ${during}；应用后 style=wabi，单独改过的 ${d.surfaces.length} 处保留`
  })

  await step('2 给房间换地面、给墙面换材料（点墙边选那一侧）', page, async () => {
    await clickPlan(page, [5000, 6600])
    let sel = await S(page, () => window.__decorUI().sel)
    assert(sel?.k === 'floor' && sel.id === 'r-living', `点客餐厅中间应选中地面：${JSON.stringify(sel)}`)
    await page.click('[data-testid=floor-picker] [data-testid=mcat-木地板]'); await sleep(150)
    await page.click('[data-testid=floor-picker] [data-testid=mat-walnut]'); await sleep(300)
    let d = await decor(page)
    assert(d.surfaces.some(s => s.target.floor === 'r-living' && s.material === 'walnut'), '客餐厅地面没换成胡桃木')
    await shot(page, '03-floor.png')
    await clickPlan(page, [7600, 3575])
    sel = await S(page, () => window.__decorUI().sel)
    assert(sel?.k === 'face' && sel.face.wall === 'w-m' && sel.face.side === -1, `点主卧南墙朝主卧那边应选中这一侧：${JSON.stringify(sel)}`)
    await page.click('[data-testid=face-picker] [data-testid=mcat-乳胶漆]'); await sleep(150)
    await page.click('[data-testid=face-picker] [data-testid=mat-forest]'); await sleep(300)
    d = await decor(page)
    assert(d.surfaces.some(s => s.target.face?.wall === 'w-m' && s.target.face.side === -1 && s.material === 'forest'), '床头墙没换成墨绿')
    assert(!d.surfaces.some(s => s.target.face?.wall === 'w-m' && s.target.face.side === 1), '另一侧（厨房）不该被刷')
    await shot(page, '04-face.png')
    return '客餐厅地面 = 胡桃木；主卧床头墙（w-m 朝主卧一侧）= 墨绿，厨房一侧不变'
  })

  await step('3 进立面，画背景墙，在背景墙上挖电视洞', page, async () => {
    await page.keyboard.press('Escape'); await sleep(200)
    const [x, y] = await P(page, [5000, 7020])
    await page.mouse.click(x, y, { count: 2 }); await sleep(1500)
    const cv = await S(page, () => window.__decorUI().canvas)
    assert(cv.k === 'elev' && cv.face.wall === 'w-s' && cv.face.side === -1, `双击南墙内侧应进它的立面：${JSON.stringify(cv)}`)
    assert(await S(page, () => /墙面立面/.test(document.querySelector('[data-testid=decor-title]')?.textContent ?? '')), '标题没换成墙面立面')
    const n0 = (await decor(page)).panels.length
    await page.keyboard.press('p'); await sleep(200)
    await drag(page, await E(page, 3950, 0.02), await E(page, 5850, 2.45))
    let d = await decor(page)
    assert(d.panels.length === n0 + 1, '没画出背景墙')
    const pn = d.panels.at(-1)
    assert(pn.span.face.wall === 'w-s' && pn.span.face.side === -1, '背景墙挂错了墙面')
    await page.keyboard.press('n'); await sleep(200)
    await drag(page, await E(page, 4300, 1.0), await E(page, 5500, 1.75))
    d = await decor(page)
    const hole = d.recesses.find(r => r.host.panel === pn.id)
    assert(hole && hole.kind === 'hole', `框在背景墙上应是挖洞（宿主 = 造型）：${JSON.stringify(d.recesses.at(-1))}`)
    assert(typeof hole.depth === 'number' && hole.depth < pn.thickness, '挖洞深度不能超过造型厚度')
    await shot(page, '05-elev-panel-hole.png')
    return `背景墙 ${pn.id} s=${pn.span.s.join('–')} z=${pn.span.z.join('–')}；电视洞 ${hole.id} u=${hole.rect.u.join('–')} 挖进 ${hole.depth} / 板厚 ${pn.thickness}`
  })

  await step('4 外墙上嵌一个柜子：事实卡、俯视图剩余厚度', page, async () => {
    await page.keyboard.press('Escape'); await sleep(150)
    const n0 = (await decor(page)).cabinets.length
    await page.keyboard.press('c'); await sleep(200)
    await drag(page, await E(page, 6100, 0.3), await E(page, 6700, 0.3))
    let d = await decor(page)
    assert(d.cabinets.length === n0 + 1, '没加出柜子')
    const cab = d.cabinets.at(-1)
    assert(cab.place.face.wall === 'w-s', '柜子没靠在南外墙上')
    await typeInto(page, '[data-testid=cab-embed]', '120')
    d = await decor(page)
    assert(d.cabinets.find(c => c.id === cab.id).embed === 120, '嵌进墙里没写成 120')
    await page.waitForSelector('[data-testid=fact-card]', { timeout: 3000 })
    const fact = await S(page, () => document.querySelector('[data-testid=fact-card]').textContent)
    assert(/外墙（读图看到）/.test(fact) && /专业人员到现场确认/.test(fact), `事实卡文案：${fact}`)
    assert(!/危险|禁止|不建议|违规/.test(fact), '事实卡不该下结论')
    const tv = await S(page, () => { const e = document.querySelector('[data-testid=top-view]'); return { wall: e?.dataset.wall, depth: e?.dataset.depth, left: e?.dataset.left, text: e?.textContent } })
    assert(tv.wall === '240' && tv.depth === '120' && tv.left === '120' && /剩 120/.test(tv.text), `俯视局部：${JSON.stringify(tv)}`)
    await shot(page, '06-embed-fact.png')
    await page.click('[data-testid=fact-ack]'); await sleep(300)
    assert((await decor(page)).cabinets.find(c => c.id === cab.id).ack, '「知道了」没记下 ack')
    assert(await S(page, () => !!document.querySelector('[data-testid=fact-card-acked]')), '知道了以后卡片应收成一行')
    return `${cab.id}：外墙 240 · 挖进 120 · 剩 120 · 柜深 ${cab.depth}；事实卡不拦，「知道了」后收成一行`
  })

  await step('5 挖到墙厚：数据保留上一次的有效值，输入框旁就地提示 +「去改造开洞」', page, async () => {
    const before = (await decor(page)).cabinets.at(-1).embed
    await typeInto(page, '[data-testid=cab-embed]', '240')
    const d = await decor(page), cab = d.cabinets.at(-1)
    assert(cab.embed === before, `挖透时数据应保留上一次的有效值 ${before}：embed=${cab.embed}`)
    const shown = await S(page, () => document.querySelector('[data-testid=cab-embed] input')?.value ?? document.querySelector('input[data-testid=cab-embed]')?.value)
    const hint = await S(page, () => { const e = document.querySelector('[data-testid=through-hint]'); return e ? { text: e.textContent, tried: e.dataset.tried } : null })
    assert(hint && /挖到 240 就穿了，那是开洞，属于结构改造/.test(hint.text) && /去改造开洞/.test(hint.text) && hint.tried === '240', `输入框旁没有就地提示：${JSON.stringify(hint)}`)
    const nt = await nextText(page)
    assert(/去改造开洞/.test(nt), `下一步条：${nt}`)
    await shot(page, '07-through.png')
    await page.click('[data-testid=go-opening]'); await sleep(600)
    const st = await S(page, () => { const s = window.__fss.store.getState(); return { mode: s.mode, tool: s.tool, kind: s.openingKind, sel: s.sel } })
    assert(st.mode === 'renovation' && st.tool === 'opening' && st.kind === 'doorway' && st.sel[0]?.id === 'w-s', `没转去改造开洞：${JSON.stringify(st)}`)
    await shot(page, '08-to-renovation.png')
    await page.keyboard.press('Escape'); await sleep(150)
    await page.click('[data-testid=mode-decor]'); await sleep(600)
    return `输 240：数据仍是 ${cab.embed}（输入框显示 ${shown}），提示就地出现；点「去改造开洞」→ 改造态、选中南外墙、门窗工具（门洞）`
  })

  await step('6 放沙发并拖动：贴墙吸附、显示四个方向的净距', page, async () => {
    await page.keyboard.press('f'); await sleep(300)
    // 家具库卡片有进场动画，等它稳定再点（D5 自查时偶发「Node is detached」）
    await page.waitForSelector('[data-testid=furn-sofa-2]', { visible: true }); await sleep(450)
    await page.click('[data-testid=furn-sofa-2]'); await sleep(200)
    await clickPlan(page, [5200, 5600])
    let d = await decor(page)
    const sofa = d.furniture.at(-1)
    assert(sofa.type === 'sofa-2', `没放下双人沙发：${sofa.type}`)
    const from = await P(page, sofa.at), to = await P(page, [5000, 6300])
    let mid = null, fit = null
    const fitNow = () => S(page, () => { const e = document.querySelector('[data-testid=drag-fit]'); return e && { fit: e.dataset.fit, text: e.textContent } })
    await drag(page, from, to, 16, async () => {
      mid = await S(page, () => [...document.querySelectorAll('[data-testid=drag-clearance] [data-clear]')].map(e => `${e.dataset.clear}:${e.dataset.dist}`))
      fit = await fitNow()
      await shot(page, '09-drag-clearance.png')
    })
    d = await decor(page)
    const moved = d.furniture.find(f => f.id === sofa.id)
    assert(Math.hypot(moved.at[0] - sofa.at[0], moved.at[1] - sofa.at[1]) > 300, '沙发没拖动')
    assert(mid && mid.length >= 2, `拖动时应显示净距胶囊：${JSON.stringify(mid)}`)
    assert(fit?.fit === 'ok' || fit?.fit === 'blocked', `拖动时应提示放不放得下：${JSON.stringify(fit)}`)
    // 线上 bug B5：按住沙发拖过去看提示，再拖回起点才松手（净位移为零；同一件家具的连续拖动会合成一步撤销，所以不用 ⌘Z）。
    // 客厅中间的空地 → 放得下；三人沙发上 → 放不下
    const big = d.furniture.find(f => f.type === 'sofa-3')
    const tryDrag = async (target, name) => {
      const [x0, y0] = await P(page, moved.at), [x1, y1] = await P(page, target)
      await page.mouse.move(x0, y0); await page.mouse.down()
      for (let i = 1; i <= 16; i++) { await page.mouse.move(x0 + (x1 - x0) * i / 16, y0 + (y1 - y0) * i / 16); await sleep(18) }
      await sleep(120); const got = await fitNow(); await shot(page, name)
      for (let i = 15; i >= 0; i--) { await page.mouse.move(x0 + (x1 - x0) * i / 16, y0 + (y1 - y0) * i / 16); await sleep(18) }
      await page.mouse.up(); await sleep(300)
      const back = (await decor(page)).furniture.find(f => f.id === sofa.id)
      assert(Math.hypot(back.at[0] - moved.at[0], back.at[1] - moved.at[1]) < 5, `拖回起点后位置变了：${back.at} vs ${moved.at}`)
      return got
    }
    const clear = await tryDrag([5300, 4800], '09b-drag-fits.png'), blocked = await tryDrag(big.at, '09c-drag-blocked.png')
    assert(clear?.fit === 'ok' && clear.text === '放得下', `拖到客厅空地应提示放得下：${JSON.stringify(clear)}`)
    assert(blocked?.fit === 'blocked' && /^放不下 · .*三人沙发/.test(blocked.text), `拖到三人沙发上应提示放不下：${JSON.stringify(blocked)}`)
    return `沙发 ${sofa.id} 从 (${sofa.at}) 拖到 (${moved.at})；拖动中净距 ${mid.join('、')} mm、「${fit.text}」；空地「${clear.text}」；压到三人沙发「${blocked.text}」`
  })

  await step('7 撤销 / 重做带装修层（转 90° → ⌘Z → ⇧⌘Z）', page, async () => {
    const d0 = await decor(page), f = d0.furniture.at(-1)
    await page.keyboard.press('r'); await sleep(250)
    const r1 = (await decor(page)).furniture.find(x => x.id === f.id).rot
    await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta'); await sleep(250)
    const r2 = (await decor(page)).furniture.find(x => x.id === f.id).rot
    await page.keyboard.down('Meta'); await page.keyboard.down('Shift'); await page.keyboard.press('z'); await page.keyboard.up('Shift'); await page.keyboard.up('Meta'); await sleep(250)
    const r3 = (await decor(page)).furniture.find(x => x.id === f.id)?.rot
    assert(r1 === (f.rot + 90) % 360 && r2 === f.rot && r3 === r1, `rot ${f.rot} → ${r1} → 撤销 ${r2} → 重做 ${r3}`)
    return `rot ${f.rot} → ${r1} → 撤销 ${r2} → 重做 ${r3}`
  })

  await step('8 回改造态拆一面挂着柜子的墙，再回装修态：柜子标「没地方挂了」', page, async () => {
    await page.click('[data-testid=mode-renovation]'); await sleep(500)
    await clickPlan(page, [7600, 3600])
    const sel = await S(page, () => window.__fss.store.getState().sel)
    assert(sel[0]?.id === 'w-m', `改造态没选中主卧南墙：${JSON.stringify(sel)}`)
    await page.keyboard.press('Backspace'); await sleep(500)
    assert(await S(page, () => window.__fss.store.getState().base.changes.some(c => c.op === 'remove' && c.target === 'w-m')), '没记下拆墙')
    await page.click('[data-testid=mode-decor]'); await sleep(900)
    const pins = await S(page, () => [...document.querySelectorAll('[data-testid^=orphan-pin-]')].map(e => e.dataset.testid.replace('orphan-pin-', '')))
    assert(['cab-fridge', 'cab-kbase', 'cab-kwall'].every(id => pins.includes(id)), `没地方挂的柜子没标出来：${pins.join(',')}`)
    const nt = await nextText(page)
    assert(/没地方挂了/.test(nt), `下一步条没优先说没地方挂：${nt}`)
    const d = await decor(page)
    assert(d.cabinets.some(c => c.id === 'cab-fridge'), '数据不该被偷偷删掉')
    await shot(page, '10-orphans.png')
    await page.click('[data-testid=next-cta]'); await sleep(500)
    assert(await S(page, () => !!document.querySelector('[data-testid=orphan-card]')), '「去处理」没打开问题卡')
    await shot(page, '11-orphan-card.png')
    return `拆主卧南墙后 ${pins.length} 项标柠檬：${pins.join('、')}；数据原样保留；「去处理」出问题卡`
  })

  await step('10 自动保存、导出 JSON 都带装修层', page, async () => {
    await sleep(1600)
    const saved = await S(page, () => { const r = localStorage.getItem('floorplan-structure:autosave:v2'); return r ? JSON.parse(r).plan.decor : null })
    const d = await decor(page)
    assert(saved && saved.furniture.length === d.furniture.length && saved.cabinets.length === d.cabinets.length, '本地自动保存里没有装修层')
    const before = fs.readdirSync(downloads)
    await page.click('[data-testid=file-menu]'); await sleep(300)
    await page.click('[data-testid=menu-export]'); await sleep(1200)
    const f = fs.readdirSync(downloads).find(x => x.endsWith('.json') && !before.includes(x))
    assert(f, '没下载到 JSON')
    const j = JSON.parse(fs.readFileSync(path.join(downloads, f), 'utf8'))
    assert(j.decor && j.decor.style === d.style && j.decor.panels.length === d.panels.length && j.decor.recesses.length === d.recesses.length, '导出的 JSON 没带装修层')
    return `自动保存 + 导出 ${f}：style=${j.decor.style}，家具 ${j.decor.furniture.length}、柜子 ${j.decor.cabinets.length}、造型 ${j.decor.panels.length}、挖 ${j.decor.recesses.length}`
  })

  await step('11 旧方案里的家具（legacy.furniture）第一次进装修时用 core fromLegacyFurniture 转进来', page, async () => {
    const r = await S(page, () => {
      const st = window.__fss.store.getState()
      const p = structuredClone(st.base); delete p.decor
      p.legacy = { furniture: [{ type: 'sofa', name: '旧沙发', cx: 3000, cy: 5200, w: 2000, d: 900, rot: 0, color: '#c8b8a0' }, { type: 'bed', name: '旧床', cx: 7600, cy: 2400, w: 1800, d: 2000, rot: 0 }, { type: 'mystery', cx: 1500, cy: 1500, w: 600, d: 600, rot: 0 }] }
      st.loadPlan(p, { kind: 'file' })
      return true
    })
    assert(r, '载入失败')
    await sleep(400)
    await page.click('[data-testid=mode-decor]'); await sleep(600)
    assert(await S(page, () => window.__decorUI().styleCard), '没有装修层时应先出风格卡')
    assert(/先选一个整体风格/.test(await nextText(page)), '下一步条应说先选风格')
    await page.click('[data-testid=style-nordic]'); await sleep(200)
    await page.click('[data-testid=style-apply]'); await sleep(600)
    const d = await decor(page)
    assert(d && d.style === 'nordic' && d.furniture.length === 3, `旧家具没转进来：${d?.furniture.length}`)
    await shot(page, '13-legacy-furniture.png')
    return `新建装修层 style=nordic，旧家具 ${d.furniture.length} 件转入（类型 ${d.furniture.map(f => f.type).join('、')}）`
  })

  // ── D5 新增：每步之前重新载入示例方案（装修态） ──
  const freshDecor = async (q = '?mode=decor') => { await page.goto(`${URL0}${q}`, { waitUntil: 'load' }); await page.evaluate(() => localStorage.clear()); await page.goto(`${URL0}${q}`, { waitUntil: 'load' }); await page.waitForFunction(() => !!window.__fss?.store.getState().base); await sleep(1200) }
  const undo = async () => { await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta'); await sleep(400) }

  await step('D5-3 洞里的电视只跟宿主走：平面位置 = core furniturePose；检查器「在电视位里」+「拿出来」、不显示 x / y；挪背景墙电视跟着走', page, async () => {
    await freshDecor()
    const before = await S(page, () => { const g = document.querySelector('[data-decor=furniture][data-id=f-tv]'); return g?.getAttribute('transform') })
    const d0 = await decor(page), tv0 = d0.furniture.find(f => f.id === 'f-tv')
    assert(tv0.in === 'rc-tv' && tv0.at === undefined, `示例里的电视应只存 in：${JSON.stringify(tv0)}`)
    // 点电视（它在背景墙洞里）：用 transform 里的中心点
    const c = before.match(/translate\(([-\d.]+) ([-\d.]+)\)/).slice(1).map(Number)
    await clickPlan(page, [c[0] + 15, c[1]])
    let sel = await S(page, () => window.__decorUI().sel)
    if (sel?.id !== 'f-tv') { await S(page, () => window.__decorUI().select({ k: 'furniture', id: 'f-tv' })); await sleep(300) }
    const card = await S(page, () => ({ host: document.querySelector('[data-testid=furn-host]')?.textContent ?? '', xy: !!document.querySelector('[data-testid=furn-xy]') }))
    assert(/在电视位里/.test(card.host) && /拿出来/.test(card.host) && !card.xy, `检查器：${JSON.stringify(card)}`)
    await shot(page, 'd5-03-tv-host.png')
    // 挪背景墙（宿主的宿主）：电视跟着走
    await S(page, () => { const s = window.__fss.store; const b = s.getState().base; s.setState({ base: { ...b, decor: { ...b.decor, panels: b.decor.panels.map(p => p.id === 'pn-tv' ? { ...p, span: { ...p.span, s: [p.span.s[0] - 400, p.span.s[1] - 400] } } : p) } } }) }); await sleep(400)
    const after = await S(page, () => document.querySelector('[data-decor=furniture][data-id=f-tv]')?.getAttribute('transform'))
    const c2 = after.match(/translate\(([-\d.]+) ([-\d.]+)\)/).slice(1).map(Number)
    assert(Math.abs(Math.hypot(c2[0] - c[0], c2[1] - c[1]) - 400) < 2, `背景墙挪 400，电视应跟着挪 400：${c} → ${c2}`)
    await page.click('[data-testid=furn-takeout]'); await sleep(400)
    const tv1 = (await decor(page)).furniture.find(f => f.id === 'f-tv')
    assert(!tv1.in && Math.hypot(tv1.at[0] - c2[0], tv1.at[1] - c2[1]) < 2, `拿出来以后位置不变、改成 at：${JSON.stringify(tv1)}`)
    return `电视 (${c.map(Math.round)}) → 背景墙挪 400 后 (${c2.map(Math.round)})；拿出来 → at (${tv1.at})`
  })

  await step('D5-4 部分拆墙：留在剩下那段上的柜子写回新墙 id、不标柠檬；⌘Z 一步撤回（结构 + 装修）', page, async () => {
    await freshDecor('?mode=renovation')
    const n0 = (await S(page, () => window.__fss.store.getState().base.changes.length))
    await S(page, () => window.__fss.store.getState().edit([{ id: 'cx-part', op: 'remove', type: 'wall', target: 'w-m', range: [400, 1200], by: 'user', status: 'confirmed' }]))
    await sleep(500)
    const st = await S(page, () => { const b = window.__fss.store.getState().base; return { n: b.changes.length, faces: b.decor.cabinets.filter(c => ['cab-fridge', 'cab-kbase', 'cab-kwall'].includes(c.id)).map(c => c.place.face.wall) } })
    assert(st.n === n0 + 1, '没记下拆一段墙')
    assert(st.faces.every(w => w === 'w-m~cx-part'), `剩下那段上的柜子应写回新墙 id：${st.faces}`)
    await page.click('[data-testid=mode-decor]'); await sleep(900)
    const pins = await S(page, () => [...document.querySelectorAll('[data-testid^=orphan-pin-]')].map(e => e.dataset.testid.replace('orphan-pin-', '')))
    assert(!['cab-fridge', 'cab-kbase', 'cab-kwall'].some(id => pins.includes(id)), `留在剩下那段上的柜子不该标柠檬：${pins}`)
    await shot(page, 'd5-04-partial-wall.png')
    await undo()
    const u = await S(page, () => { const b = window.__fss.store.getState().base; return { n: b.changes.length, faces: b.decor.cabinets.filter(c => c.id === 'cab-fridge').map(c => c.place.face.wall) } })
    assert(u.n === n0 && u.faces[0] === 'w-m', `⌘Z 应一步撤回结构和装修：${JSON.stringify(u)}`)
    return `拆 w-m 的 400–1200：3 个柜子挂到 w-m~cx-part，柠檬热点 ${pins.length} 个（${pins.join('、') || '无'}）；⌘Z 回到 ${u.n} 条、w-m`
  })

  await step('D5-5 风格卡：点一下预览、按应用才生效；不保留单独改过的 → 应用算一步，⌘Z 整步撤回', page, async () => {
    await freshDecor()
    const d0 = await decor(page)
    await page.click('[data-testid=change-style]'); await sleep(800)
    await page.click('[data-testid=style-minimal]'); await sleep(300)
    assert((await decor(page)).style === d0.style, '点一下不该改数据')
    const sw = await page.$('[aria-label=保留单独改过的]')
    if (sw) { await sw.click(); await sleep(200) }
    await page.click('[data-testid=style-apply]'); await sleep(600)
    const d1 = await decor(page)
    assert(d1.style === 'minimal' && !d1.surfaces.some(s => s.by === 'user'), `应用（不保留）：style=${d1.style} surfaces=${d1.surfaces.length}`)
    await undo()
    const d2 = await decor(page)
    assert(d2.style === d0.style && d2.surfaces.length === d0.surfaces.length && JSON.stringify(d2.panels) === JSON.stringify(d0.panels), `⌘Z 应整步撤回：style=${d2.style} surfaces=${d2.surfaces.length}`)
    return `${d0.style} → 应用 minimal（清掉 ${d0.surfaces.length} 处覆盖、造型换点缀材料）→ ⌘Z 一步回到 ${d2.style}、${d2.surfaces.length} 处`
  })

  await step('D5-6/7 3D：只藏有嵌入的那几面墙；平涂 / 白模切换；1.1 m 剖切出实心盖子', page, async () => {
    await freshDecor()
    await page.keyboard.press('Tab'); await sleep(2600)
    let d3 = await S(page, () => window.__decor3d)
    const walls = await S(page, () => window.__fss.getView().plan.walls.length)
    assert(d3.hide.length > 0 && d3.hide.length < walls && d3.hide.includes('w-w'), `应只藏有嵌入的墙：${d3.hide.join(',')} / ${walls}`)
    assert(d3.look === 'flat' && d3.painted > 0, `装修态 3D 默认平涂：${JSON.stringify(d3)}`)
    await shot(page, 'd5-06-3d-flat.png')
    const painted = d3.painted
    await page.click('[data-testid=look-clay]'); await sleep(1500)
    d3 = await S(page, () => window.__decor3d)
    assert(d3.look === 'clay', '白模没切过去')
    await page.click('[data-testid=look-clay]'); await sleep(600)
    await page.click('[data-testid=section-3d]'); await sleep(2600)
    const caps = await S(page, () => window.__sectionCaps)
    assert(caps?.includes('wall') && caps.includes('decor'), `剖切盖子：${caps}`)
    await shot(page, 'd5-06-3d-section.png')
    // 导出 PNG（平涂 + 剖切），透明背景窗户默认实心浅灰
    await page.click('[data-testid=shot-open]'); await sleep(300)
    await page.click('[data-testid=shot-bg-transparent]'); await sleep(200)
    const glass = await S(page, () => !!document.querySelector('[data-testid=shot-glass-solid][aria-selected=true]'))
    await page.click('[data-testid=shot-go]'); await sleep(2500)
    const last = await S(page, () => window.__lastShot)
    assert(glass && last?.ok && /装修平涂-剖切/.test(last.name), `导出：${JSON.stringify(last)} 实心窗 ${glass}`)
    await page.click('[data-testid=section-3d]'); await sleep(300)
    await page.keyboard.press('Tab'); await sleep(800)
    return `藏 ${d3.hide.join('、')}（共 ${walls} 面墙）；平涂顶点色 ${painted} 块；剖切盖子 ${caps.join('/')}；导出 ${last.name}`
  })

  await step('D5-15 原始模式删管道井：先问「这是在纠正读图吗？」，不删 / 是，删掉', page, async () => {
    await freshDecor('?mode=original')
    await S(page, () => { const s = window.__fss.store; const b = s.getState().base; s.setState({ base: { ...b, shafts: [...(b.shafts ?? []), { id: 'sh-e2e', name: '管道井', poly: [[3400, 200], [3700, 200], [3700, 500], [3400, 500]] }] } }); s.getState().select({ type: 'shaft', id: 'sh-e2e' }) })
    await sleep(500)
    await page.keyboard.press('Delete'); await sleep(400)
    assert(await page.$('[data-testid=shaft-confirm]'), '没出轻确认')
    const txt = await S(page, () => document.querySelector('[data-testid=shaft-confirm]').textContent)
    assert(/这是在纠正读图吗/.test(txt) && /是，删掉/.test(txt) && /不删/.test(txt), `轻确认文案：${txt}`)
    await shot(page, 'd5-15-shaft-confirm.png')
    await page.click('[data-testid=confirm-no]'); await sleep(300)
    assert(await S(page, () => window.__fss.store.getState().base.shafts.some(x => x.id === 'sh-e2e')), '「不删」不该删')
    await page.keyboard.press('Delete'); await sleep(300)
    await page.click('[data-testid=confirm-yes]'); await sleep(400)
    assert(await S(page, () => !window.__fss.store.getState().base.shafts.some(x => x.id === 'sh-e2e')), '「是，删掉」没删')
    return '轻确认出现；不删 → 还在；是，删掉 → 删了'
  })

  await step('D5-17/19 概览单列不计入的房间；交给 Agent 带装修构件 ref（core decorHandoff）', page, async () => {
    await freshDecor('?mode=renovation')
    const ex = await S(page, () => document.querySelector('[data-testid=area-excluded]')?.textContent ?? '')
    assert(/另有 飘窗台/.test(ex) && /不计入/.test(ex), `概览：${ex}`)
    await page.click('[data-testid=mode-decor]'); await sleep(700)
    await S(page, () => window.__decorUI().select({ k: 'cabinet', id: 'cab-tall-1' })); await sleep(400)
    await page.click('[data-testid=inspector-agent]'); await sleep(600)
    const pv = await S(page, () => ({ refs: document.querySelector('[data-testid=agent-decor-refs]')?.textContent ?? '', md: document.querySelector('[data-testid=agent-preview]')?.textContent ?? '' }))
    assert(/cab-tall-1/.test(pv.refs) && /FaceRef/.test(pv.md) && /柜体 cab-tall-1/.test(pv.md) && /外墙/.test(pv.md), `交接：${pv.refs} / ${pv.md.slice(0, 200)}`)
    await shot(page, 'd5-19-agent-decor.png')
    await page.keyboard.press('Escape'); await sleep(300)
    return `概览「${ex.trim()}」；交接带 ref：${pv.refs.trim()}`
  })


  // ── D6 新增 ──
  const toW = (page, xyz) => S(page, a => window.__world2screen(a), xyz)
  async function click3dItem(page, id, opts) {
    const at = await S(page, id => window.__itemCenter3d?.(id), id)
    assert(at, `算不出 ${id} 在 3D 里的位置`)
    const [x, y] = await toW(page, at)
    await page.mouse.click(x, y, opts); await sleep(700)
    return [x, y]
  }

  await step('D6-A1 没有装修层的方案：悬停风格，平面地面和 3D 平涂都跟着预览（数据不写）', page, async () => {
    await freshDecor('?mode=renovation')
    await S(page, () => { const st = window.__fss.store.getState(); const p = structuredClone(st.base); delete p.decor; st.loadPlan(p, { kind: 'file' }) }); await sleep(500)
    await page.click('[data-testid=mode-decor]'); await sleep(700)
    const f0 = await S(page, () => document.querySelector('[data-floor=r-living]')?.getAttribute('fill') ?? null)
    await page.waitForSelector('[data-testid=style-wabi]', { visible: true })
    await page.hover('[data-testid=style-wabi]'); await sleep(600)
    const f1 = await S(page, () => document.querySelector('[data-floor=r-living]')?.getAttribute('fill') ?? null)
    assert(f1 && f1 !== f0, `悬停预览时平面地面没画出来：${f0} → ${f1}`)
    await shot(page, 'd6-a1-preview-2d.png')
    await page.keyboard.press('Tab'); await sleep(2400)
    await page.hover('[data-testid=style-wabi]'); await sleep(1200)
    const d3 = await S(page, () => window.__decor3d)
    assert(d3.flat && d3.look === 'flat' && d3.preview, `3D 平涂没跟着预览：${JSON.stringify(d3)}`)
    const sk = await S(page, () => window.__wallSkins.length)
    assert(sk > 0, '预览时 3D 墙面皮没铺')
    await shot(page, 'd6-a1-preview-3d.png')
    await page.hover('[data-testid=style-nordic]'); await sleep(900)
    const c1 = await S(page, () => window.__wallSkins.map(k => k.color).join())
    assert(!(await decor(page)), '悬停不该创建装修层')
    await page.click('[data-testid=style-nordic]'); await sleep(200)
    await page.click('[data-testid=style-apply]'); await sleep(700)
    const d = await decor(page)
    assert(d?.style === 'nordic', '按应用才创建装修层')
    await page.keyboard.press('Tab'); await sleep(600)
    return `平面 fill ${f0} → ${f1}；3D 平涂 ${sk} 张墙面皮；按应用后 style=${d.style}（墙面色 ${c1.slice(0, 30)}…）`
  })

  await step('D6-A2 窗口在桌面和手机宽度之间来回拉（结构 / 装修平面 / 装修 3D / 立面）：零报错', page, async () => {
    const n0 = errors.length
    await freshDecor('?mode=renovation')
    const flip = async () => { for (let i = 0; i < 2; i++) { await page.setViewport({ width: 390, height: 844 }); await sleep(700); await page.setViewport({ width: W, height: H }); await sleep(700) } }
    await clickPlan(page, [3300, 1500]); await flip() // 选中一面墙（检查器）
    await page.click('[data-testid=mode-decor]'); await sleep(600); await flip()
    await clickPlan(page, [7600, 3575]); await flip() // 装修选中墙面
    await page.keyboard.press('Tab'); await sleep(1500); await flip()
    await page.keyboard.press('Tab'); await sleep(800)
    const [x, y] = await P(page, [60, 1800]); await page.mouse.click(x, y, { count: 2 }); await sleep(1200); await flip()
    await page.keyboard.press('Escape'); await sleep(200); await page.keyboard.press('Escape'); await sleep(300)
    const errs = errors.slice(n0).filter(e => !/WebGL|GPU stall|GL_|swiftshader/i.test(e))
    assert(!errs.length, errs.slice(0, 3).join(' | '))
    return '1440 → 390 → 1440 × 2，五种状态，0 报错'
  })

  await step('D6-A3 立面按房间分段：书房西墙（满墙柜）双击进书房那段；‹ › 绕书房；「这面墙还连着 客餐厅 ›」切过去', page, async () => {
    await freshDecor()
    const [x, y] = await P(page, [60, 1800]); await page.mouse.click(x, y, { count: 2 }); await sleep(1600)
    const cv = await S(page, () => window.__decorUI().canvas)
    assert(cv.k === 'elev' && cv.face.wall === 'w-w' && cv.room === 'r-bed2', `双击书房西墙应进书房那段：${JSON.stringify(cv)}`)
    const r = await S(page, () => { const m = window.__elevModel, c = m.cabinets.find(c => c.c.id === 'cab-desk'); return { range: window.__elevRange, desk: [c.u0, c.u0 + c.c.width], title: document.querySelector('[data-testid=decor-title]').textContent } })
    assert(r.range[0] <= r.desk[0] + 1 && r.range[1] >= r.desk[1] - 1, `取景段没包住满墙柜：${JSON.stringify(r)}`)
    assert(/书房 · 西墙/.test(r.title) && /从书房看/.test(r.title) && /这面墙还连着/.test(r.title), `标题：${r.title}`)
    // 满墙柜在画面里（屏幕上看得到它的两端）
    const sx = await S(page, d => [window.__elev2screen(d[0], 1.2)[0], window.__elev2screen(d[1], 1.2)[0]], r.desk)
    assert(sx[0] > 80 && sx[1] < W - 380, `满墙柜不在画面里：${sx}`)
    await shot(page, 'd6-a3-study-west.png')
    // ‹ › 绕书房走：转一圈都还是书房的墙
    const rooms = []
    for (let i = 0; i < 4; i++) { await page.click('[data-testid=elev-next]'); await sleep(700); rooms.push(await S(page, () => window.__decorUI().canvas.room)) }
    assert(rooms.every(x => x === 'r-bed2'), `› 应绕书房走：${rooms}`)
    // 回到西墙，切到客餐厅那段
    await S(page, () => window.__decorUI().openElevation({ wall: 'w-w', side: -1 }, 'r-bed2')); await sleep(800)
    await page.click('[data-testid=elev-also-r-living]'); await sleep(1000)
    const cv2 = await S(page, () => window.__decorUI().canvas), title2 = await S(page, () => document.querySelector('[data-testid=decor-title]').textContent)
    assert(cv2.room === 'r-living' && /客餐厅 · 西墙/.test(title2), `切到客餐厅那段：${JSON.stringify(cv2)} ${title2}`)
    await shot(page, 'd6-a3-living-west.png')
    await page.keyboard.press('Escape'); await sleep(200); await page.keyboard.press('Escape'); await sleep(300)
    return `取景 ${r.range.map(Math.round)} ⊇ 满墙柜 ${r.desk}；› 四次都在书房；切到客餐厅`
  })

  await step('D6-A4 对准：3D 里选中嵌墙柜 →「对准」→ 点俯视 = 退出对准、真的俯视 → 再对准 → 取消对准仍是俯视', page, async () => {
    await freshDecor()
    await page.keyboard.press('Tab'); await sleep(2400)
    // 俯视里点柜子（斜视时它躲在南外墙、阳台后面），再切回斜视去对准
    await page.click('[data-testid=cam-top]'); await sleep(2600)
    await click3dItem(page, 'cab-tall-1')
    await page.click('[data-testid=cam-iso]'); await sleep(2600)
    const sel = await S(page, () => window.__decorUI().sel)
    assert(sel?.k === 'cabinet' && sel.id === 'cab-tall-1', `3D 里点嵌墙柜应选中它：${JSON.stringify(sel)}`)
    const acts = await S(page, () => document.querySelector('[data-testid=decor-3d-actions]')?.textContent ?? '')
    assert(/对准/.test(acts) && /剖开看看/.test(acts), `选中嵌墙柜旁边应有「对准」「剖开看看」：${acts}`)
    const card = await S(page, () => document.querySelector('[data-testid=decor-card]')?.textContent ?? document.body.textContent)
    assert(/客厅嵌墙柜/.test(card), '右侧没出柜子检查器')
    await shot(page, 'd6-a4-select.png')
    await page.click('[data-testid=aim-item]'); await sleep(2200)
    let st = await S(page, () => ({ probe: window.__decorUI().probe?.item, pressed: [...document.querySelectorAll('[data-testid^=cam-]')].filter(e => e.getAttribute('aria-pressed') === 'true').map(e => e.dataset.testid) }))
    assert(st.probe === 'cab-tall-1' && !st.pressed.length, `对准期间视角按钮都不亮：${JSON.stringify(st)}`)
    await shot(page, 'd6-a4-aimed.png')
    await page.click('[data-testid=cam-top]'); await sleep(2600)
    let cam = await S(page, () => ({ probe: window.__decorUI().probe, cam: window.__fss.store.getState().cam, el: window.__cam3d().el, pressed: document.querySelector('[data-testid=cam-top]').getAttribute('aria-pressed') }))
    assert(!cam.probe && cam.cam === 'top' && cam.el > 80 && cam.pressed === 'true', `点俯视应退出对准、切到俯视：${JSON.stringify(cam)}`)
    await shot(page, 'd6-a4-top.png')
    await page.click('[data-testid=aim-item]'); await sleep(2200)
    const el1 = await S(page, () => window.__cam3d().el)
    await page.click('[data-testid=aim-cancel]'); await sleep(2600)
    cam = await S(page, () => ({ probe: window.__decorUI().probe, cam: window.__fss.store.getState().cam, el: window.__cam3d().el }))
    assert(!cam.probe && cam.cam === 'top' && cam.el > 80, `取消对准应回到最后选的俯视：${JSON.stringify(cam)}（对准时仰角 ${el1.toFixed(0)}°）`)
    await page.keyboard.press('Tab'); await sleep(600)
    return `对准仰角 ${el1.toFixed(0)}°；点俯视 → ${cam.el.toFixed(0)}°；取消对准仍俯视`
  })

  await step('D6-B5 Agent 待确认的结构提议：装修态只画细虚线、没有热点；右侧一行，点了切到改造并选中', page, async () => {
    await freshDecor()
    const pr = await S(page, () => [...document.querySelectorAll('[data-proposal]')].map(e => [e.getAttribute('fill'), e.getAttribute('stroke-dasharray')]))
    assert(pr.length > 0 && pr.every(([f]) => f === 'none'), `提议应只画虚线框：${JSON.stringify(pr)}`)
    const hot = await S(page, () => document.querySelectorAll('[data-canvas=main] ~ div button .lucide-sparkles, [data-canvas=main] div.absolute button[aria-label] .lucide-sparkles').length)
    assert(hot === 0, `装修态不该有提议热点：${hot}`)
    const row = await S(page, () => document.querySelector('[data-testid=look-proposals]')?.textContent ?? '')
    assert(/有 1 条结构提议还没确认，装修按现在的结构算/.test(row), `右侧那一行：${row}`)
    await shot(page, 'd6-b5-proposal.png')
    await page.click('[data-testid=look-proposals]'); await sleep(700)
    const st = await S(page, () => ({ mode: window.__fss.store.getState().mode, sel: window.__fss.store.getState().sel }))
    assert(st.mode === 'renovation' && st.sel.length === 1, `应切到改造并选中：${JSON.stringify(st)}`)
    return `虚线框 ${pr.length} 个；点了 → 改造态选中 ${st.sel[0].type} ${st.sel[0].id}`
  })

  await step('D6-B6 墙的两侧：平面悬停 / 选中带「客厅一侧」；外墙点在墙体上默认室内一侧；3D 点墙出墙面卡、双击进立面', page, async () => {
    await freshDecor()
    let [x, y] = await P(page, [60, 5000]); await page.mouse.move(x, y); await sleep(300)
    const hov = await S(page, () => document.querySelector('[data-face-label]')?.getAttribute('data-face-label'))
    assert(hov === '客餐厅一侧', `悬停外墙墙体，标签应是室内那侧：${hov}`)
    await page.mouse.click(x, y); await sleep(400)
    let sel = await S(page, () => window.__decorUI().sel)
    const lab = await S(page, () => [...document.querySelectorAll('[data-face-label]')].map(e => e.textContent).join('|'))
    assert(sel?.k === 'face' && sel.face.wall === 'w-w' && /客餐厅一侧/.test(lab), `点外墙墙体应选室内一侧：${JSON.stringify(sel)} ${lab}`)
    ;[x, y] = await P(page, [-150, 5000]); await page.mouse.click(x, y); await sleep(400)
    sel = await S(page, () => window.__decorUI().sel)
    const lab2 = await S(page, () => [...document.querySelectorAll('[data-face-label]')].map(e => e.textContent).join('|'))
    assert(sel?.k === 'face' && sel.face.wall === 'w-w' && /室外一侧/.test(lab2), `明确点在外侧才选室外一侧：${JSON.stringify(sel)} ${lab2}`)
    await shot(page, 'd6-b6-outside.png')
    await clickPlan(page, [60, 5000])
    await shot(page, 'd6-b6-inside.png')
    // 3D：点客餐厅西墙（室内一侧）→ 墙面卡 +「进立面」；双击 → 立面
    await page.keyboard.press('Escape'); await sleep(200)
    await page.keyboard.press('Tab'); await sleep(2400)
    await page.click('[data-testid=cam-top]'); await sleep(2600)
    const pt = [5.0, 2.7, 7.2] // 南外墙墙顶：点在墙顶上 = 室内一侧
    const [wx, wy] = await toW(page, pt)
    await page.mouse.click(wx, wy); await sleep(700)
    sel = await S(page, () => window.__decorUI().sel)
    const ui = await S(page, () => ({ btn: !!document.querySelector('[data-testid=open-elevation]'), label: document.querySelector('[data-testid=face-side-3d]')?.textContent }))
    assert(sel?.k === 'face' && sel.face.wall === 'w-s' && ui.btn && ui.label === '客餐厅一侧', `3D 点外墙墙顶应选室内一侧、出墙面卡和「进立面」：${JSON.stringify(sel)} ${JSON.stringify(ui)}`)
    await shot(page, 'd6-b6-3d-face.png')
    await page.mouse.click(wx, wy, { count: 2 }); await sleep(1600)
    const st = await S(page, () => ({ main: window.__fss.store.getState().main, cv: window.__decorUI().canvas, title: document.querySelector('[data-testid=decor-title]')?.textContent }))
    assert(st.main === '2d' && st.cv.k === 'elev' && /从.+看/.test(st.title), `3D 双击墙面应进立面：${JSON.stringify(st)}`)
    await page.keyboard.press('Escape'); await sleep(200); await page.keyboard.press('Escape'); await sleep(300)
    await S(page, () => window.__fss.store.getState().setCam('iso'))
    return `平面：${lab.split('|')[0]} / ${lab2.split('|')[0]}；3D：${ui.label} → 双击进「${st.title.slice(0, 12)}…」`
  })

  await step('D6-B7 剖切：按钮带字「剖开看」+ 白话提示；3D 选中嵌墙柜 →「剖开看看」打开剖切并对准它', page, async () => {
    await freshDecor()
    await page.keyboard.press('Tab'); await sleep(2400)
    const txt = await S(page, () => document.querySelector('[data-testid=section-3d]')?.textContent)
    assert(txt === '剖开看', `按钮文字：${txt}`)
    await page.hover('[data-testid=section-3d]'); await sleep(700)
    const tip = await S(page, () => document.body.innerText.includes('像在腰的高度把房子横着切开往下看'))
    assert(tip, '悬停没出白话提示')
    await shot(page, 'd6-b7-tip.png')
    await page.mouse.move(700, 450); await sleep(300)
    await page.click('[data-testid=cam-top]'); await sleep(2600)
    await click3dItem(page, 'cab-tall-1')
    await page.click('[data-testid=section-item]'); await sleep(2600)
    const st = await S(page, () => ({ sec: window.__decorUI().section3d, probe: window.__decorUI().probe?.item, caps: window.__sectionCaps, el: window.__cam3d().el }))
    assert(st.sec && st.probe === 'cab-tall-1' && st.caps?.includes('decor'), `剖开看看：${JSON.stringify(st)}`)
    await shot(page, 'd6-b7-section-item.png')
    await page.click('[data-testid=aim-cancel]'); await sleep(600)
    await page.keyboard.press('Tab'); await sleep(600)
    return `剖切 ${st.sec}，对准 ${st.probe}，盖子 ${st.caps.join('/')}，仰角 ${st.el.toFixed(0)}°`
  })

  await step('D6-B8 右上角全局「导出」：PDF 两节分别勾、方案 JSON、当前 3D 视角 PNG', page, async () => {
    await freshDecor()
    await page.click('[data-testid=global-export]'); await sleep(500)
    const menu = await S(page, () => document.querySelector('[data-testid=global-export-menu]')?.innerText ?? '')
    assert(/改造清单 PDF/.test(menu) && /结构改造/.test(menu) && /装修想法/.test(menu) && /方案文件 JSON/.test(menu) && /图片 PNG/.test(menu), `菜单：${menu}`)
    assert(/可行性待专业确认/.test(menu) && !/给设计师/.test(menu), '口吻：我的想法，可行性待专业确认；不叫「给设计师」')
    await shot(page, 'd6-b8-menu.png')
    await page.click('[data-testid=gexp-structure]'); await sleep(150)
    await page.click('[data-testid=gexp-pdf]'); await sleep(400)
    await page.waitForFunction(() => window.__fssExport?.pages?.length > 0 && document.querySelector('[data-testid=export-page-count]'), { timeout: 30000 })
    await sleep(800)
    const ex = await S(page, () => ({ kinds: window.__fssExport.pages.map(p => p.kind), opts: window.__fssExport.opts, first: window.__fssExport.decor?.items[0]?.n }))
    assert(ex.opts.structure === false && !ex.kinds.includes('detail') && !ex.kinds.includes('overview') && ex.first === 1, `只导装修想法：${JSON.stringify(ex)}`)
    await shot(page, 'd6-b8-pdf-decor-only.png')
    await page.keyboard.press('Escape'); await sleep(400)
    await S(page, () => { const u = window.__fssExport; void u })
    // JSON
    for (const f of fs.readdirSync(downloads).filter(f => /\.json$/.test(f))) fs.rmSync(path.join(downloads, f))
    await page.click('[data-testid=global-export]'); await sleep(400)
    await page.click('[data-testid=gexp-json]'); await sleep(1200)
    const files = fs.readdirSync(downloads).filter(f => /\.json$/.test(f))
    assert(files.length && JSON.parse(fs.readFileSync(path.join(downloads, files[0]), 'utf8')).decor, `JSON 没下载 / 没带装修层：${fs.readdirSync(downloads)}`)
    // PNG（在 2D 里点：先切到 3D 再导）
    await page.click('[data-testid=global-export]'); await sleep(400)
    await page.click('[data-testid=gexp-png-flat]'); await sleep(4200)
    const last = await S(page, () => window.__lastShot)
    assert(last?.ok && /装修平涂/.test(last.name), `PNG：${JSON.stringify(last)}`)
    await page.keyboard.press('Tab'); await sleep(500)
    // 改造态也能点（任何模式）
    await page.keyboard.press('2'); await sleep(500)
    assert(await S(page, () => !!document.querySelector('[data-testid=global-export]')), '改造态右上角也要有导出')
    return `只导装修：${ex.kinds.join(',')}；JSON ${files.at(-1)}；PNG ${last.name}`
  })

  await step('D6-B9 弧墙上的窗：选「一扇」= 3D 一整片弧面玻璃、2D 沿弧不分隔；三扇 = 只在扇间分隔；检查器一句事实', page, async () => {
    await freshDecor('?mode=original')
    await S(page, () => {
      const st = window.__fss.store.getState(), p = structuredClone(st.base)
      const w = p.walls.find(w => w.id === 'w-arc'); w.kind = 'exterior'; w.thickness = 200
      p.openings.push({ id: 'o-arc', wall: 'w-arc', kind: 'window', offset: 500, width: 2700, sill: 0.9, head: 2.4, panes: [{ width: 1, kind: 'fixed' }] })
      st.loadPlan(p, { kind: 'file' })
    }); await sleep(800)
    let sym = await S(page, () => { const g = document.querySelector('[data-curved-opening=o-arc]'); return g ? { leaves: +g.getAttribute('data-leaves'), div: g.querySelectorAll('[data-division]').length } : null })
    assert(sym && sym.leaves === 1 && sym.div === 0, `一扇：2D 不该有分隔：${JSON.stringify(sym)}`)
    await page.keyboard.press('Tab'); await sleep(2200)
    let fx = await S(page, () => window.__fixtures3d.filter(f => f.ids.includes('o-arc')))
    let panes = fx.filter(f => f.kind === 'pane'), frames = fx.filter(f => f.kind === 'rail')
    assert(panes.length === 1 && frames.length === 4, `一扇：3D 应是一整片玻璃 + 两根竖框 + 上下横框：${panes.length} 片玻璃 / ${frames.length} 根框`)
    await shot(page, 'd6-b9-arc-3d-one.png')
    await page.keyboard.press('Tab'); await sleep(500)
    await S(page, () => { const st = window.__fss.store.getState(), p = structuredClone(st.base); p.openings.find(o => o.id === 'o-arc').panes = [{ width: 0.25, kind: 'casement' }, { width: 0.5, kind: 'fixed' }, { width: 0.25, kind: 'casement' }]; st.loadPlan(p, { kind: 'file' }) }); await sleep(800)
    sym = await S(page, () => { const g = document.querySelector('[data-curved-opening=o-arc]'); return { leaves: +g.getAttribute('data-leaves'), div: g.querySelectorAll('[data-division]').length } })
    assert(sym.leaves === 3 && sym.div === 2, `三扇：2D 只在扇间分隔两道：${JSON.stringify(sym)}`)
    await page.keyboard.press('Tab'); await sleep(2200)
    await shot(page, 'd6-b9-arc-3d-three.png')
    fx = await S(page, () => window.__fixtures3d.filter(f => f.ids.includes('o-arc')))
    panes = fx.filter(f => f.kind === 'pane'); frames = fx.filter(f => f.kind === 'rail')
    assert(panes.length === 3 && frames.length === 6, `三扇：3 片玻璃、2 竖框 + 2 扇间竖框 + 上下横框：${panes.length} / ${frames.length}`)
    // 直墙门窗不变：o-living 推拉门两扇
    const straight = await S(page, () => window.__fixtures3d.filter(f => f.ids.includes('o-living')).map(f => f.kind).join(','))
    assert(straight === 'pane,pane', `直墙推拉门应仍是两扇直板：${straight}`)
    await page.keyboard.press('Tab'); await sleep(500)
    await S(page, () => window.__fss.store.getState().select({ type: 'opening', id: 'o-arc' })); await sleep(500)
    const note = await S(page, () => document.querySelector('[data-testid=arc-opening-note]')?.textContent ?? '')
    assert(/弧形的玻璃、门一般要定制，可行性待专业确认/.test(note), `检查器提示：${note} / sel ${JSON.stringify(await S(page, () => window.__fss.store.getState().sel))}`)
    await shot(page, 'd6-b9-arc-2d-three.png')
    return `一扇：2D 0 道分隔、3D 1 片玻璃 4 根框；三扇：2D 2 道、3D 3 片 6 根；直墙推拉门 ${straight}`
  })

  await step('D6-C6 平涂墙面改用 core wallSkins：每面墙每一侧一整张（门洞上方、两侧不再分段）；立面材料用 core surfaces', page, async () => {
    await freshDecor()
    await page.keyboard.press('Tab'); await sleep(2400)
    const sk = await S(page, () => window.__wallSkins)
    const per = {}
    for (const k of sk) { const key = `${k.wall}:${k.side}:${k.room}:${k.color}`; per[key] = (per[key] ?? 0) + 1 }
    const dup = Object.entries(per).filter(([, n]) => n > 1)
    assert(sk.length > 0 && !dup.length, `同一面墙、同一间房、同一种材料应是一张：${JSON.stringify(dup)}`)
    await shot(page, 'd6-c6-skins.png')
    await page.keyboard.press('Tab'); await sleep(600)
    // 切回 2D 后平面还在适配动画里：等屏幕坐标停稳再双击（固定 600ms 在慢机上会点到书房，T2 实测）
    let prev = null
    for (let i = 0; i < 40; i++) { const q = await P(page, [7600, 3575]); if (prev && Math.hypot(q[0] - prev[0], q[1] - prev[1]) < 0.5) break; prev = q; await sleep(100) }
    const [x, y] = await P(page, [7600, 3575]); await page.mouse.click(x, y, { count: 2 }); await sleep(1400)
    const m = await S(page, () => ({ surf: window.__elevModel.surfaces.length, u: window.__elevModel.u, ends: window.__elevModel.ends.length }))
    assert(m.surf > 0 && m.ends > 0, `立面：${JSON.stringify(m)}`)
    await page.keyboard.press('Escape'); await sleep(200); await page.keyboard.press('Escape'); await sleep(300)
    return `墙面皮 ${sk.length} 张；主卧南墙立面 ${m.surf} 片材料、两端剖块 ${m.ends}`
  })

  await step('9 3D 白模里三个探针都看得到（网址参数 ?probe=p1|p2|p3；工具栏上不再有 P1–P3。D6 起放在最后：另开一页会改写本地自动保存）', page, async () => {
    const notes = []
    const pp = await newPage(1)
    for (const [id, want] of [['p1', 'cab-tall-1'], ['p2', 'pn-tv'], ['p3', 'cab-desk']]) {
      await pp.goto(`${URL0}?probe=${id}`, { waitUntil: 'load' }); await pp.waitForFunction(() => !!window.__fss?.store.getState().base); await sleep(2600)
      const st = await S(pp, () => ({ probe: window.__decorUI().probe, main: window.__fss.store.getState().main, mode: window.__fss.store.getState().mode, rail: !!document.querySelector('[data-testid^=probe-]') }))
      assert(st.mode === 'decor' && st.main === '3d' && st.probe?.item === want, `${id}：网址参数没对准 ${want}：${JSON.stringify(st)}`)
      assert(!st.rail, '工具栏上不该再有 P1–P3')
      const solids = await S(pp, () => window.__decorSolids)
      const mine = solids.filter(s => s.ids.includes(want))
      assert(mine.length > 0, `${id}：3D 里没有 ${want} 的实体`)
      if (id === 'p1') assert(solids.some(s => s.replaces === 'wall'), 'P1：有嵌入时应生成「墙体真的变薄」的替换墙')
      if (id === 'p2') assert(solids.some(s => s.ids.includes('f-tv')) && solids.some(s => s.kind === 'decor-panel'), 'P2：电视、背景墙实体缺一')
      if (id === 'p3') assert(mine.some(s => s.kind === 'decor-cabinet-top'), 'P3：书桌柜洞里的台面没出来')
      await shot(pp, `12-probe-${id}.png`)
      notes.push(`${id} ${want} ${mine.length} 块`)
    }
    await pp.close()
    return notes.join('；')
  })

  await step('12 全程零报错、零外部请求', page, async () => {
    const errs = errors.filter(e => !/WebGL|GPU stall|GL_|swiftshader/i.test(e))
    assert(!external.length, `外部请求：${external.slice(0, 5).join(', ')}`)
    assert(!errs.length, errs.slice(0, 4).join(' | '))
    return '0 报错，0 外部请求'
  })
  await page.close()

  // ── 和样张同状态的对照截图（2 倍像素，和 docs/decor/样张/png 同尺寸） ──
  const cmp = await newPage(2)
  const fresh = async () => { await cmp.goto(`${URL0}?mode=decor`, { waitUntil: 'load' }); await cmp.evaluate(() => localStorage.clear()); await cmp.goto(`${URL0}?mode=decor`, { waitUntil: 'load' }); await cmp.waitForFunction(() => !!window.__fss?.store.getState().base); await sleep(1500) }
  await step('C1 对照样张 01 装修主界面', cmp, async () => { await fresh(); await cmp.mouse.move(700, 880); await sleep(400); await shot(cmp, 'cmp-01-main.png') })
  await step('C2 对照样张 02 风格选择（预览侘寂）', cmp, async () => { await fresh(); await cmp.click('[data-testid=change-style]'); await sleep(900); await cmp.waitForSelector('[data-testid=style-wabi]', { visible: true }); await cmp.hover('[data-testid=style-wabi]'); await sleep(200); await cmp.click('[data-testid=style-wabi]'); await sleep(500); await shot(cmp, 'cmp-02-style.png') })
  await step('C3 对照样张 03 墙面立面（嵌墙柜选中）', cmp, async () => {
    await fresh(); const [x, y] = await P(cmp, [180, 6990]); await cmp.mouse.click(x, y, { count: 2 }); await sleep(1600)
    const [cx, cy] = await S(cmp, () => { const m = window.__elevModel, c = m.cabinets.find(c => c.c.id === 'cab-tall-1'); return window.__elev2screen(c.u0 + 300, 1.3) })
    await cmp.mouse.click(cx, cy); await sleep(600); await cmp.mouse.move(700, 880); await sleep(300); await shot(cmp, 'cmp-03-elevation.png')
  })
  await step('C4 对照样张 04 柜体编辑（挖洞那一格）', cmp, async () => {
    await fresh(); const [x, y] = await P(cmp, [300, 1800]); await cmp.mouse.click(x, y, { count: 2 }); await sleep(1600)
    const [cx, cy] = await S(cmp, () => { const m = window.__elevModel, c = m.cabinets.find(c => c.c.id === 'cab-desk'); return window.__elev2screen(c.u0 + 1600, 0.6) })
    await cmp.mouse.click(cx, cy); await sleep(600); await cmp.mouse.move(700, 880); await sleep(300); await shot(cmp, 'cmp-04-cabinet.png')
  })
  await step('C5 对照样张 05 墙面材质（床头墙）', cmp, async () => { await fresh(); await clickPlan(cmp, [7600, 3575]); await cmp.mouse.move(700, 880); await sleep(400); await shot(cmp, 'cmp-05-face.png') })
} finally {
  await browser.close()
}
fs.writeFileSync(path.join(out, 'e2e-decor-result.json'), JSON.stringify({ results, errors, external }, null, 2))
const bad = results.filter(r => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} 通过`)
process.exit(bad.length ? 1 : 0)
