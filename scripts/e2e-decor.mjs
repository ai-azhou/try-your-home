// 装修阶段 e2e：node scripts/e2e-decor.mjs   （先 npm run build）
// 本机 Chrome 无头（puppeteer-core，跑完自己关；不起任何服务，直接 file:// 打开单文件产物 dist/index.html）。
// 用真实鼠标键盘走一遍：切装修 → 换风格；换地面、换墙面；进立面画背景墙、挖电视洞；外墙上嵌柜子（事实卡、俯视图剩余厚度）；
// 挖到墙厚被引导去改造；放沙发并拖动（净距）；改造态拆一面挂着柜子的墙 → 装修态标「没地方挂了」；3D 白模三个探针；
// 撤销 / 重做、自动保存、导出 JSON 带装修层；全程零报错、零外部请求。截图在 .shots/D4/。只用公开示例数据。
// 最后一组（A*）例外：起 scripts/serve.mjs（记 PID，结束时只 kill 这个 PID）打开虚构示例 fixtures/agent-decor.json，走 Agent 写装修的流程。
import puppeteer from 'puppeteer-core'
import { chromePath } from './browser-path.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

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
  // 右侧卡片切换时旧卡片会被整张换掉：刚取到的按钮可能已经从页面上摘下（puppeteer 报 not clickable）。重新取一次再点，断言不放宽
  const click0 = page.click.bind(page)
  page.click = async (sel, o) => { for (let i = 0; ; i++) { try { return await click0(sel, o) } catch (e) { if (i >= 4 || !/not clickable/.test(e.message)) throw e; await sleep(250) } } }
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

  // ── 地面缺口：门洞的墙厚范围归房间地面（预览、已应用都一样），开敞处不画纸白线 ──
  const floorGaps = () => S(page, () => {
    const c = document.querySelector('[data-canvas=main]'), v = window.__fss.getView().plan
    const fill = id => c.querySelector(`[data-floor="${id}"]`)?.getAttribute('fill')
    const low = v.openings.filter(o => o.sill <= 0.01), high = v.openings.filter(o => o.sill > 0.01)
    const parts = [...c.querySelectorAll('[data-threshold-room]')]
    return {
      low: low.length,
      missing: low.filter(o => !c.querySelector(`[data-threshold="${o.id}"]`)).map(o => o.id),
      overWindow: high.filter(o => c.querySelector(`[data-threshold="${o.id}"]`)).map(o => o.id),
      wrongFill: parts.filter(e => !fill(e.dataset.thresholdRoom) || e.getAttribute('fill') !== fill(e.dataset.thresholdRoom)).map(e => e.dataset.thresholdRoom),
      paperGap: low.filter(o => { const g = c.querySelector(`[data-type=opening][data-id="${o.id}"] path`); return g && g.getAttribute('fill') !== 'none' }).map(o => o.id),
      closedEdge: [...new Set(parts.map(e => e.dataset.thresholdRoom))].filter(id => /Z$/.test(c.querySelector(`[data-floor-edge="${id}"]`)?.getAttribute('d') ?? 'Z')),
    }
  })
  const assertFloor = (r, tag) => {
    assert(r.low > 0, `${tag}：示例里应该有贴地的洞口`)
    assert(!r.missing.length, `${tag}：门洞没铺地面 ${r.missing}`)
    assert(!r.overWindow.length, `${tag}：窗下不该铺 ${r.overWindow}`)
    assert(!r.wrongFill.length, `${tag}：门槛和房间地面不是同一种材料 ${r.wrongFill}`)
    assert(!r.paperGap.length, `${tag}：门洞还垫着纸白底 ${r.paperGap}`)
    assert(!r.closedEdge.length, `${tag}：纸白线跨过了门口 ${r.closedEdge}`)
  }
  await step('7a 门洞的地面：已应用、风格预览、3D 都铺上了；窗下不铺', page, async () => {
    await S(page, () => { window.__decorUI().select(null); window.__decorUI().backToPlan() }); await sleep(400)
    const applied = await floorGaps(); assertFloor(applied, '已应用')
    await S(page, () => window.__decorUI().set({ preview: 'mid' })); await sleep(500)
    const preview = await floorGaps(); assertFloor(preview, '预览')
    // 中古：干区胡桃木、湿区小方砖，卫生间门从墙中线分开，两半是两种材料
    const twoTone = await S(page, () => [...document.querySelectorAll('[data-canvas=main] [data-threshold]')].filter(g => new Set([...g.querySelectorAll('[data-threshold-room]')].map(e => e.getAttribute('fill'))).size === 2).length)
    assert(twoTone >= 1, '干湿两边地面不同的门洞应该分两半')
    await shot(page, '07a-floor-preview.png')
    await S(page, () => window.__decorUI().set({ preview: null })); await sleep(300)
    await S(page, () => window.__fss.store.getState().setMain('3d')); await sleep(2200)
    const n3d = await S(page, () => (window.__floorPatches3d ?? []).length)
    await S(page, () => window.__fss.store.getState().setMain('2d')); await sleep(800)
    assert(n3d >= applied.low, `3D 门洞地面块数 ${n3d} < 洞口 ${applied.low}`)
    return `贴地洞口 ${applied.low} 个，3D 补丁 ${n3d} 块`
  })

  const pressShift = async k => { await page.keyboard.down('Shift'); await page.keyboard.press(k); await page.keyboard.up('Shift') }
  await step('7b 方向键挪家具：10 / 100 mm，方向按屏幕，连按合成一步撤销，输入框有焦点时不抢键，净距跟着显示', page, async () => {
    const d0 = await decor(page), f = d0.furniture.filter(x => x.at).at(-1)
    await S(page, id => window.__decorUI().select({ k: 'furniture', id }), f.id); await sleep(350)
    assert((await nextText(page)).includes('方向键'), `提示条没提方向键：${await nextText(page)}`)
    const at = async () => (await decor(page)).furniture.find(x => x.id === f.id).at
    await page.keyboard.press('ArrowRight'); await sleep(60)
    let p = await at()
    assert(p[0] === f.at[0] + 10 && p[1] === f.at[1], `→ 应挪 10：${f.at} → ${p}`)
    assert(await page.$('[data-testid=drag-clearance]'), '方向键挪动时没显示净距')
    await pressShift('ArrowDown'); await sleep(60)
    p = await at()
    assert(p[0] === f.at[0] + 10 && p[1] === f.at[1] + 100, `⇧↓ 应挪 100：${p}`)
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowUp'); await sleep(60)
    p = await at()
    assert(p[0] === f.at[0] && p[1] === f.at[1] + 90, `←↑：${p}`)
    await shot(page, '07b-nudge.png')
    await page.keyboard.down('Meta'); await page.keyboard.press('z'); await page.keyboard.up('Meta'); await sleep(250)
    p = await at()
    assert(p[0] === f.at[0] && p[1] === f.at[1], `一次撤销应回到起点：${p} vs ${f.at}`)
    await S(page, id => window.__decorUI().select({ k: 'furniture', id }), f.id); await sleep(1700)
    assert(!(await page.$('[data-testid=drag-clearance]')), '停手后净距应该收起来')
    const input = await page.$('[data-testid=furn-w]')
    assert(input, '卡片上没有宽度输入框')
    await input.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowUp'); await sleep(100)
    p = await at()
    assert(p[0] === f.at[0] && p[1] === f.at[1], `输入框有焦点时不该挪：${p}`)
    await S(page, () => document.activeElement?.blur()); await sleep(100)
    return `${f.id}：(${f.at}) → +10 → +100 → 撤销一步回到起点`
  })

  await step('7c ⌥ 测距：选中家具，按住 ⌥ 悬停另一件家具或墙出净距，松开消失', page, async () => {
    const d0 = await decor(page), f = d0.furniture.filter(x => x.at && x.type !== 'rug' && !x.in).at(-1), g = d0.furniture.find(x => x.id !== f.id && x.at && x.type !== 'rug' && !x.in)
    assert(g, '示例里要有第二件家具')
    await S(page, id => window.__decorUI().select({ k: 'furniture', id }), f.id); await sleep(300)
    const hover = async q => { const [x, y] = await P(page, q); await page.mouse.move(x - 6, y); await sleep(60); await page.mouse.move(x, y); await sleep(250) }
    const values = () => S(page, () => [...document.querySelectorAll('[data-canvas=main] [data-measure-value]')].map(e => +e.dataset.measureValue))
    await page.keyboard.down('Alt'); await sleep(60)
    await hover(g.at)
    const toItem = await values()
    assert(await page.$('[data-canvas=main] [data-measure]'), '悬停另一件家具没出测距')
    await shot(page, '07c-alt-measure.png')
    const wall = await S(page, () => { const w = window.__fss.getView().plan.walls.find(x => !x.bulge && Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1]) > 2000), o = window.__fss.getView().plan.openings.filter(z => z.wall === w.id), L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]); let t = .5; for (const c of [.5, .2, .8, .1, .9]) if (!o.some(z => z.offset < c * L && z.offset + z.width > c * L)) { t = c; break } return [w.a[0] + (w.b[0] - w.a[0]) * t, w.a[1] + (w.b[1] - w.a[1]) * t] })
    await hover(wall)
    const toWall = await values()
    await page.keyboard.up('Alt'); await sleep(200)
    assert(!(await page.$('[data-canvas=main] [data-measure]')), '松开 ⌥ 测距应消失')
    assert(toWall.length >= 1, '悬停墙没出净距')
    return `到另一件家具 ${toItem.join('/')} mm，到墙 ${toWall.join('/')} mm`
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

  await step('D6-C7 刷漆后门窗两侧连续的墙面没有接缝：洞口边线的延长线上、墙顶分段处，像素没有细线', page, async () => {
    await freshDecor()
    await page.keyboard.press('Tab'); await sleep(2400)
    const list = await S(page, () => {
      const plan = window.__fss.getView().plan, skins = window.__wallSkins
      return plan.openings.flatMap(o => {
        const w = plan.walls.find(x => x.id === o.wall), skin = skins.find(k => k.wall === o.wall && k.room)
        return w && !w.bulge && skin && w.kind !== 'glass' && w.kind !== 'half-glass' && o.head < plan.ceiling - 0.2 ? [{ id: o.id, a: w.a, b: w.b, t: w.thickness, side: skin.side, offset: o.offset, width: o.width, head: o.head, H: plan.ceiling }] : []
      })
    })
    assert(list.length > 0, '示例里没有可查的门窗')
    const seen = []
    for (const o of list) {
      const L = Math.hypot(o.b[0] - o.a[0], o.b[1] - o.a[1]), d = [(o.b[0] - o.a[0]) / L, (o.b[1] - o.a[1]) / L], n = [-d[1] * o.side, d[0] * o.side]
      const at = (s, off, z) => [(o.a[0] + d[0] * s + n[0] * off) / 1000, z, (o.a[1] + d[1] * s + n[1] * off) / 1000]
      const mid = o.offset + o.width / 2
      await S(page, (p, t) => window.__setCam3d(p, t), at(mid, 5000, 7), at(mid, 0, 1.4)); await sleep(900)
      // 两道洞口边线：过梁区几个高度沿墙取一排，墙顶沿中线取一排；细线 = 比左右两边都暗一截的一个像素
      // 只取边线两侧 60 mm：门离丁字墙可能只有 200 mm，取宽了会跨到真的墙角，那是棱不是缝
      const rows = [o.offset, o.offset + o.width].flatMap(s => [
        ...[0.2, 0.4, 0.6, 0.8].map(f => [at(s - 60, o.t / 2 + 2, o.head + (o.H - o.head) * f), at(s + 60, o.t / 2 + 2, o.head + (o.H - o.head) * f)]),
        [at(s - 60, 0, o.H), at(s + 60, 0, o.H)],
      ])
      const worst = await S(page, rows => {
        const cv = document.querySelector('[data-canvas3d=main] canvas'), k = cv.width / cv.getBoundingClientRect().width, r0 = cv.getBoundingClientRect()
        const c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height
        const g = c2.getContext('2d', { willReadFrequently: true }); g.drawImage(cv, 0, 0)
        let max = 0
        for (const [p, q] of rows) {
          const [x0, y0] = window.__world2screen(p), [x1, y1] = window.__world2screen(q), n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * k), lum = []
          for (let i = 0; i <= n; i++) { const d = g.getImageData((x0 + (x1 - x0) * i / n - r0.left) * k, (y0 + (y1 - y0) * i / n - r0.top) * k, 1, 1).data; lum.push(d[0] + d[1] + d[2]) }
          for (let i = 2; i < lum.length - 2; i++) { const side = (lum[i - 2] + lum[i + 2]) / 2; max = Math.max(max, side - Math.min(lum[i - 1], lum[i], lum[i + 1])) }
        }
        return max
      }, rows)
      seen.push(`${o.id} ${worst.toFixed(0)}`)
      assert(worst < 12, `${o.id} 两侧的墙面有接缝（暗 ${worst.toFixed(0)}，RGB 三通道之和，门限 12）；各洞口：${seen.join('、')}`)
    }
    return `查了 ${list.length} 个门窗：${seen.join('、')}`
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

  // ── Agent 写的装修（D8）：连着服务模式打开虚构示例 fixtures/agent-decor.json，方案用真实的 decor-edit 命令改 ──
  const A = await (async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd8-agent-')), file = path.join(dir, 'plan.json'), PORT = 5298
    fs.copyFileSync(path.join(root, 'fixtures/agent-decor.json'), file)
    const srv = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs'), dir, String(PORT)], { stdio: 'ignore' }) // 只 kill 这个 PID
    await sleep(800)
    return { dir, file, srv, url: `http://127.0.0.1:${PORT}/?plan=plan.json&mode=decor` }
  })()
  const agentEdit = (...ops) => { const r = spawnSync(process.execPath, ['--experimental-strip-types', path.join(root, 'scripts/plan.ts'), 'decor-edit', A.file, '-'], { input: JSON.stringify({ ops }), encoding: 'utf8', cwd: root }); if (r.status !== 0) throw new Error(`decor-edit：${r.stderr}`); return JSON.parse(r.stdout) }
  const onDisk = () => JSON.parse(fs.readFileSync(A.file, 'utf8')).decor
  const box = { id: 'ext-box', name: '外部小柜', category: 'storage', basis: '照片估算，未核实', size: [600, 400], height: 900, parts: [{ outline: 'M0 0H600V400H0Z', z: [0, 900], color: '#8a6' }], front: [{ d: 'M300 0V900', style: 'detail' }] }
  try {
    const before = errors.length
    // 有 prev 的两条（沙发、餐桌改成待确认）+ 没 prev 的一条（示例里的台灯）；另外一件侧着靠墙、一台挂在门上
    agentEdit(
      { op: 'update', id: 'example-l-sofa', set: { at: [2200, 4600] }, status: 'pending' },
      { op: 'update', id: 'example-four-leg-table', set: { at: [5100, 4300] }, status: 'pending' },
      { op: 'add', kind: 'furniture', status: 'confirmed', item: { id: 'side-tv', type: 'custom:tv65', at: [1000, 900], rot: 90 } },
      { op: 'add', kind: 'furniture', status: 'confirmed', wall: { face: { wall: 'south', side: 1 }, s: 1450, z: 1000 }, item: { id: 'door-tv', type: 'custom:tv65' } },
    )
    const ap = await newPage(1)
    const X_ = fn => S(ap, fn)
    const plan2 = p => P(ap, p)
    await ap.goto(A.url, { waitUntil: 'load' }); await ap.waitForFunction(() => !!window.__fss?.store.getState().base?.decor, { timeout: 20000 }); await sleep(1800)
    const pendingNow = () => X_(() => { const d = window.__fss.store.getState().base.decor; return ['furniture', 'cabinets', 'panels', 'recesses', 'surfaces'].flatMap(k => d[k]).filter(i => i.status === 'pending').map(i => i.id).sort() })
    const item = id => X_(`window.__fss.store.getState().base.decor.furniture.find(f => f.id === ${JSON.stringify(id)})`)
    const cardText = () => X_(() => [...document.querySelectorAll('.glass, .glass-strong')].map(e => e.textContent).filter(t => t.includes('交给 Agent') || t.includes('这套房的装修')).join(' '))
    const unselect = async () => { await X_(() => window.__decorUI().select(null)); await sleep(600) }
    // 右侧卡片换的时候有一小段进出场动画：等它在了再点
    const tap = async sel => { await ap.waitForSelector(sel, { visible: true, timeout: 4000 }); await sleep(250); await ap.click(sel) }

    await step('A1 打开方案：5 种构件都画出来（路径，不是盒子），待确认的是淡紫斜纹', ap, async () => {
      const drawn = await X_(() => [...new Set([...document.querySelectorAll('[data-custom]')].map(e => e.dataset.custom))].sort())
      assert(JSON.stringify(drawn) === JSON.stringify(['four-leg-table', 'l-sofa', 'lamp', 'round-rug', 'tv65']), `画出来的构件：${drawn}`)
      const paths = await X_(() => document.querySelector('[data-custom=l-sofa] path')?.getAttribute('d') ?? '')
      assert(/L/.test(paths), `L 形沙发应是路径：${paths}`)
      const marks = await X_(() => [...document.querySelectorAll('[data-pending]')].map(e => e.dataset.pending).sort())
      assert(JSON.stringify(marks) === JSON.stringify(['example-four-leg-table', 'example-l-sofa', 'example-lamp']), `淡紫标记：${marks}`)
      const fill = await X_(() => document.querySelector('[data-pending=example-lamp] path')?.getAttribute('fill') ?? '')
      assert(/-lav\)/.test(fill), `待确认应是淡紫斜纹：${fill}`)
      const zoomW = await X_(() => +document.querySelector('[data-custom=l-sofa] path').getAttribute('stroke-width'))
      // 线宽按屏幕 px 算：放大后 mm 单位的线宽变小
      await X_(() => window.dispatchEvent(new CustomEvent('plan-zoom', { detail: 1.5625 }))); await sleep(300)
      const zoomW2 = await X_(() => +document.querySelector('[data-custom=l-sofa] path').getAttribute('stroke-width'))
      assert(zoomW2 < zoomW * 0.8, `线宽应随缩放换算：${zoomW} → ${zoomW2}`)
      await X_(() => window.dispatchEvent(new CustomEvent('plan-zoom', { detail: 0.64 }))); await sleep(300)
      const text = await cardText()
      assert(text.includes('有 3 条 Agent 提议待你看') && !/pending|status|custom/i.test(text), `总览卡：${text.slice(0, 200)}`)
      await ap.mouse.move(700, 880); await sleep(200); await shot(ap, 'A1-plan.png')
      return `构件 ${drawn.length} 种；待确认 ${marks.length} 条`
    })

    await step('A2 构件卡片：名称、类别、尺寸、依据、标签、交给 Agent；挂在门上有事实提示', ap, async () => {
      await clickPlan(ap, await X_(() => window.__fss.store.getState().base.decor.furniture.find(f => f.id === 'example-tv65').at))
      assert((await X_(() => window.__decorUI().sel?.id)) === 'example-tv65', '点电视没选中')
      let t = await cardText()
      for (const want of ['65 寸电视示例', '家电', '1450 × 80 × 830 mm', '尺寸依据：虚构测试尺寸', 'Agent 加的', '贴着虚构客厅北墙', '交给 Agent']) assert(t.includes(want), `卡片缺「${want}」：${t}`)
      assert(!/Agent 提议/.test(t), '确认过的不该再写 Agent 提议')
      assert(!(await ap.$('[data-testid=furn-w]')), '构件的形状不能在工具里改')
      await X_(() => window.__decorUI().select({ k: 'furniture', id: 'door-tv' })); await sleep(300)
      const iss = await X_(() => [...document.querySelectorAll('[data-testid=item-issue]')].map(e => e.dataset.code + ':' + e.textContent))
      assert(iss.some(x => x.startsWith('over-opening:') && x.includes('压在') && x.includes('门')), `挂门上的提示：${iss}`)
      await X_(() => window.__decorUI().select({ k: 'furniture', id: 'example-lamp' })); await sleep(300)
      t = await cardText()
      assert(t.includes('Agent 提议') && t.includes('我确认') && t.includes('不要这条') && t.includes('这是新加的'), `待确认的卡片：${t}`)
      await X_(() => window.__decorUI().select({ k: 'furniture', id: 'example-l-sofa' })); await sleep(300)
      t = await cardText()
      assert(t.includes('改了位置'), `有改动的要说改了什么：${t}`)
      await ap.mouse.move(700, 880); await sleep(200); await shot(ap, 'A2-card-pending.png')
      await unselect()
    })

    await step('A3 立面：正对着看画构件正面（线宽不随缩放），侧着的画外形矩形；待确认的淡紫', ap, async () => {
      await X_(() => window.__decorUI().openElevation({ wall: 'north', side: 1 })); await sleep(1200)
      const q = await X_(() => ({ front: [...document.querySelectorAll('[data-elev=furniture][data-front]')].map(e => e.dataset.id), outline: [...document.querySelectorAll('[data-elev-outline]')].map(e => e.dataset.elevOutline), screen: document.querySelector('[data-id=example-tv65] path')?.getAttribute('d'), effect: document.querySelector('[data-id=example-tv65] path')?.getAttribute('vector-effect') }))
      assert(q.front.includes('example-tv65'), `电视应画正面：${JSON.stringify(q)}`)
      assert(q.outline.includes('side-tv'), `侧着的应画外形矩形：${JSON.stringify(q)}`)
      assert(q.screen === 'M20 20H1430V810H20Z' && q.effect === 'non-scaling-stroke', `屏幕线：${JSON.stringify(q)}`)
      // 立面里点电视选中，上下拖改离地高度（构件字段都在）
      const c = await X_(() => { const m = window.__elevModel, f = m.furniture.find(x => x.f.id === 'example-tv65'); return { pt: window.__elev2screen((f.u[0] + f.u[1]) / 2, (f.z[0] + f.z[1]) / 2), k: f.z[0] } })
      await ap.mouse.click(c.pt[0], c.pt[1]); await sleep(300)
      assert((await X_(() => window.__decorUI().sel?.id)) === 'example-tv65', '立面里点电视没选中')
      await drag(ap, c.pt, [c.pt[0], c.pt[1] - 30])
      const tv = await item('example-tv65')
      assert(tv.z > 0.95 && tv.type === 'custom:tv65' && tv.against?.face.wall === 'north', `立面拖动后：${JSON.stringify(tv)}`)
      await ap.mouse.move(700, 880); await sleep(200); await shot(ap, 'A3-elev.png')
      await X_(() => window.__fss.store.getState().undo()); await sleep(300)
      await X_(() => window.__decorUI().backToPlan()); await sleep(600)
    })

    await step('A4 3D：多个部件的构件整件选中，平涂用定义的颜色，白模保持白模，待确认淡紫', ap, async () => {
      await X_(() => window.__fss.store.getState().setMain('3d')); await sleep(2600)
      const solids = await X_(() => window.__decorSolids.filter(s => s.ids.includes('example-four-leg-table')).length)
      assert(solids === 5, `餐桌应是 5 个实体：${solids}`)
      const groups = await X_(() => ({ look: window.__decor3d.look }))
      assert(groups.look === 'flat', JSON.stringify(groups))
      const c = await X_(() => window.__itemCenter3d('example-tv65'))
      const pt = await X_(`window.__world2screen(${JSON.stringify(c)})`)
      await ap.mouse.click(pt[0], pt[1]); await sleep(400)
      assert((await X_(() => window.__decorUI().sel?.id)) === 'example-tv65', '3D 里点电视没选中')
      await ap.mouse.move(700, 880); await sleep(300); await shot(ap, 'A4-3d-flat.png')
      await unselect()
      await X_(() => window.__decorUI().set({ look3d: 'clay' })); await sleep(1000); await shot(ap, 'A4-3d-clay.png')
      await X_(() => { window.__decorUI().set({ look3d: 'flat' }); window.__fss.store.getState().setMain('2d') }); await sleep(800)
    })

    await step('A5 拖动、旋转照常，构件字段不丢', ap, async () => {
      const f0 = await item('side-tv')
      const a = await plan2(f0.at), b = [a[0] + 60, a[1] + 40]
      await drag(ap, a, b)
      const f1 = await item('side-tv')
      assert(f1.at[0] !== f0.at[0] && f1.type === f0.type && f1.rot === f0.rot && JSON.stringify(f1.size) === JSON.stringify(f0.size) && f1.height === f0.height && f1.by === 'agent', `拖动后：${JSON.stringify(f1)}`)
      await X_(() => window.__decorUI().select({ k: 'furniture', id: 'side-tv' })); await ap.keyboard.press('r'); await sleep(250)
      assert((await item('side-tv')).type === f0.type, '旋转后 type 丢了')
      await X_(() => { const s = window.__fss.store.getState(); s.undo(); s.undo() }); await sleep(300)
      assert((await item('side-tv')).at[0] === f0.at[0], '撤销没回去')
      await unselect()
    })

    await step('A6 确认一条、否掉两条（有 prev、没 prev），能撤销，保存后文件正确，刷新后还在', ap, async () => {
      await tap('[data-testid=look-pending-toggle]'); await sleep(250)
      await tap('[data-testid=pending-item-example-l-sofa]'); await sleep(300)
      assert((await X_(() => window.__decorUI().sel?.id)) === 'example-l-sofa', '逐条跳到没选中')
      await tap('[data-testid=pending-reject]'); await sleep(350)
      let f = await item('example-l-sofa')
      assert(f.status === 'confirmed' && !f.prev && f.at[1] === 4900, `否掉有 prev 的应恢复：${JSON.stringify(f)}`)
      await X_(() => window.__decorUI().select({ k: 'furniture', id: 'example-lamp' })); await sleep(300)
      await tap('[data-testid=pending-reject]'); await sleep(350)
      assert(!(await item('example-lamp')), '否掉没 prev 的应删除')
      assert((await X_(() => window.__decorUI().sel)) === null, '删掉以后选中应清掉')
      await X_(() => window.__decorUI().select({ k: 'furniture', id: 'example-four-leg-table' })); await sleep(300)
      await tap('[data-testid=pending-confirm]'); await sleep(350)
      f = await item('example-four-leg-table')
      assert(f.status === 'confirmed' && !f.prev && f.at[1] === 4300, `确认后：${JSON.stringify(f)}`)
      assert(!(await pendingNow()).length, `还有待确认：${await pendingNow()}`)
      let t = await cardText()
      assert(t.includes('Agent 加的'), `确认后标签：${t}`)
      await X_(() => window.__fss.store.getState().undo()); await sleep(300)
      f = await item('example-four-leg-table')
      assert(f.status === 'pending' && f.prev?.at[1] === 4500, `撤销确认：${JSON.stringify(f)}`)
      await X_(() => window.__fss.store.getState().redo()); await sleep(300)
      await unselect()
      await tap('[data-testid=save]'); await ap.waitForFunction(() => !window.__fss.store.getState().dirty, { timeout: 5000 }); await sleep(300)
      const d = onDisk(), by = id => d.furniture.find(x => x.id === id)
      assert(!by('example-lamp'), '文件里台灯应删掉')
      assert(by('example-l-sofa').status === 'confirmed' && !('prev' in by('example-l-sofa')) && by('example-l-sofa').at[1] === 4900, `文件里沙发：${JSON.stringify(by('example-l-sofa'))}`)
      assert(by('example-four-leg-table').status === 'confirmed' && !('prev' in by('example-four-leg-table')) && by('example-four-leg-table').at[1] === 4300, '文件里餐桌')
      assert(by('example-tv65').height === 830 && by('example-tv65').type === 'custom:tv65' && d.components.length === 5, `文件里单位或定义不对：${JSON.stringify(by('example-tv65'))}`)
      await ap.reload({ waitUntil: 'load' }); await ap.waitForFunction(() => !!window.__fss?.store.getState().base?.decor, { timeout: 20000 }); await sleep(1500)
      assert(!(await pendingNow()).length && !(await item('example-lamp')) && (await item('example-four-leg-table')).status === 'confirmed', '刷新后状态不对')
      return '文件 prev 已清，单位仍是 mm，刷新后一致'
    })

    await step('A7 Agent 改文件：页面出现新构件；选中的被删了就清掉，不报错', ap, async () => {
      await X_(() => window.__decorUI().select({ k: 'furniture', id: 'example-four-leg-table' })); await sleep(250)
      const t0 = Date.now()
      agentEdit({ op: 'component', component: box }, { op: 'add', kind: 'furniture', item: { id: 'ext-1', type: 'custom:ext-box', at: [1500, 2500], rot: 0 } }, { op: 'remove', id: 'example-four-leg-table' })
      await ap.waitForSelector('[data-custom=ext-box]', { timeout: 4500 })
      const ms = Date.now() - t0
      await sleep(300)
      assert((await X_(() => window.__decorUI().sel)) === null, `选中的已不存在应清掉：${JSON.stringify(await X_(() => window.__decorUI().sel))}`)
      assert(await ap.$('[data-pending=ext-1]'), '新构件没 status 应是待确认')
      await X_(() => window.__decorUI().select({ k: 'furniture', id: 'ext-1' })); await sleep(300)
      const t = await cardText()
      assert(t.includes('收纳') && t.includes('尺寸依据：照片估算，未核实'), `外部构件卡片：${t}`)
      await unselect()
      return `${ms} ms 内出现`
    })

    await step('A8 本地有没保存的改动：Agent 再改文件不会盖掉，先问', ap, async () => {
      await X_(() => window.__decorUI().select({ k: 'furniture', id: 'ext-1' })); await sleep(250)
      await tap('[data-testid=pending-confirm]'); await sleep(300)
      assert(await X_(() => window.__fss.store.getState().dirty), '确认后应算未保存')
      agentEdit({ op: 'add', kind: 'furniture', item: { id: 'ext-2', type: 'custom:ext-box', at: [3000, 2500], rot: 0 } })
      await ap.waitForSelector('[data-testid=notice]', { timeout: 4500 })
      assert(!(await item('ext-2')) && (await item('ext-1')).status === 'confirmed', '本地改动被盖掉了')
      await tap('[data-testid=notice-primary]'); await sleep(500)
      assert(await item('ext-2'), '点载入后应出现 ext-2')
      await unselect()
    })

    await step('A9 导出：PNG 默认不画待确认；粗估写「未计入」；改造清单标待确认', ap, async () => {
      agentEdit({ op: 'add', kind: 'panel', item: { id: 'ext-panel', type: 'feature', span: { face: { wall: 'west', side: 1 }, s: [1000, 3000], z: [0, 2400] }, thickness: 150, material: 'micro' } })
      await ap.waitForSelector('[data-pending=ext-panel]', { timeout: 4500 }); await sleep(300)
      const waiting = (await pendingNow()).length
      const note = await X_(() => document.querySelector('[data-testid=material-not-counted]')?.textContent ?? '')
      assert(note.includes(`另有 ${waiting} 条待确认未计入`), `粗估提示：${note}`)
      await tap('[data-testid=global-export]'); await sleep(350)
      assert(await ap.$('[data-testid=gexp-pending]'), '有待确认时应能选把它们也画进去')
      await tap('[data-testid=gexp-png-flat]'); await sleep(5000)
      const last = await X_(() => window.__lastShot)
      assert(last?.ok && last.exportView === 'confirmed' && last.pendingHidden === waiting, `PNG：${JSON.stringify(last)}`)
      assert((await X_(() => window.__decorUI().exportView)) === null, '导出完要换回来')
      assert((await X_(() => window.__decorSolids.some(s => s.ids.includes('ext-panel')))), '导出完界面上待确认的要回来')
      await X_(() => window.__fss.store.getState().setMain('2d')); await sleep(500)
      await tap('[data-testid=global-export]'); await sleep(350)
      await tap('[data-testid=gexp-pdf]'); await sleep(500)
      await ap.waitForFunction(() => window.__fssExport?.pages?.length > 1, { timeout: 30000 }); await sleep(600)
      const ex = await X_(() => window.__fssExport.decor)
      assert(ex.items.find(i => i.id === 'ext-panel')?.status === 'pending', `清单里的状态：${JSON.stringify(ex.items.map(i => [i.id, i.status]))}`)
      const page = await X_(() => window.__fssExport.pages.findIndex(p => p.kind === 'decor-room'))
      const png = await X_(`window.__fssExport.png(${page})`)
      fs.writeFileSync(path.join(out, 'A9-export-room.png'), Buffer.from(png.split(',')[1], 'base64'))
      await ap.keyboard.press('Escape'); await sleep(400)
      return `PNG 藏了 ${waiting} 条；清单页 ${ex.items.length} 项`
    })

    await step('A10 家具库：方案里的构件可以再摆一个；风格列表带「Agent 配的」角标，点应用才生效', ap, async () => {
      await X_(() => window.__decorUI().setTool('furniture')); await sleep(400)
      await tap('[data-testid=furn-cat-own]'); await sleep(300)
      const groups = await X_(() => [...document.querySelectorAll('[data-testid=furn-own-group] > div:first-child')].map(e => e.textContent))
      assert(groups.includes('家电') && groups.includes('收纳'), `分组：${groups}`)
      assert(await ap.$('[data-testid=furn-own-tv65] svg path'), '缩略图没出来')
      await shot(ap, 'A10-lib.png')
      await tap('[data-testid=furn-own-ext-box]'); await sleep(200)
      await clickPlan(ap, [1500, 1500])
      const n = await X_(() => { const d = window.__fss.store.getState().base.decor; return d.furniture.filter(f => f.type === 'custom:ext-box').map(f => ({ size: f.size, height: f.height, by: f.by, status: f.status })) })
      const placed = n.find(f => f.by === 'user')
      assert(placed && placed.status === 'confirmed' && placed.height === 0.9 && placed.size[0] === 600, `再摆一个：${JSON.stringify(n)}`)
      await unselect()
      await tap('[data-testid=save]'); await ap.waitForFunction(() => !window.__fss.store.getState().dirty, { timeout: 5000 }); await sleep(400)
      agentEdit({ op: 'preset', preset: { id: 'agent-warm', name: '暖一点', roles: { 'floor.main': 'walnut', 'wall.main': 'mist', 'wood.main': 'walnut' } } })
      await ap.waitForFunction(() => window.__fss.store.getState().base.decor.presets?.some(p => p.id === 'agent-warm'), { timeout: 4500 }); await sleep(300)
      assert((await X_(() => document.querySelector('[data-testid=agent-style-hint]')?.textContent ?? '')).includes('暖一点'), '总览卡上应提一句')
      await tap('[data-testid=change-style]'); await sleep(700)
      const tile = await X_(() => document.querySelector('[data-testid=style-agent-warm]')?.textContent ?? '')
      assert(tile.includes('Agent 配的'), `风格卡：${tile}`)
      await shot(ap, 'A10-style.png')
      assert((await X_(() => window.__fss.store.getState().base.decor.style)) === 'cream', '点应用之前不该生效')
      // 第 7 张在吸底的「应用」后面：和用户一样先滚到能看见
      await X_(() => document.querySelector('[data-testid=style-agent-warm]').scrollIntoView({ block: 'start' })); await sleep(300)
      await tap('[data-testid=style-agent-warm]'); await sleep(200); await tap('[data-testid=style-apply]'); await sleep(400)
      assert((await X_(() => window.__fss.store.getState().base.decor.style)) === 'agent-warm', '点应用没生效')
      await X_(() => window.__fss.store.getState().undo()); await sleep(300)
    })

    await step('A10b 柜体、壁龛、面覆盖：一样画淡紫、卡片上能确认或不要，总览能全部确认', ap, async () => {
      await tap('[data-testid=save]'); await ap.waitForFunction(() => !window.__fss.store.getState().dirty, { timeout: 5000 }); await sleep(400)
      await X_(() => window.__decorUI().set({ styleCard: false, preview: null })); await sleep(300)
      agentEdit(
        { op: 'add', kind: 'cabinet', item: { id: 'p-cab', family: 'tall', place: { face: { wall: 'south', side: 1 }, s: 3000 }, width: 1200, depth: 400, z: [0, 2400], columns: [{ width: 600, cells: [{ type: 'door' }] }, { cells: [{ type: 'door' }] }], materials: { carcass: 'creamDoor', front: 'creamDoor' } } },
        { op: 'add', kind: 'recess', item: { id: 'p-niche', kind: 'niche', host: { face: { wall: 'east', side: 1 } }, rect: { s: [4000, 4800], z: [1000, 1500] }, depth: 60 } },
        { op: 'add', kind: 'surface', item: { id: 'p-wall', target: { face: { wall: 'north', side: 1 } }, material: 'mist' } },
        { op: 'add', kind: 'surface', item: { id: 'p-floor', target: { floor: 'living' }, material: 'walnut' } },
      )
      await ap.waitForSelector('[data-pending=p-cab]', { timeout: 4500 }); await sleep(400)
      const marks = await X_(() => [...document.querySelectorAll('[data-pending]')].map(e => e.dataset.pending))
      for (const id of ['p-cab', 'p-niche', 'p-wall', 'p-floor']) assert(marks.includes(id), `平面上没有 ${id} 的淡紫标记：${marks}`)
      const shown = async sel => { await X_(`window.__decorUI().select(${JSON.stringify(sel)})`); await sleep(500); return X_(() => [...document.querySelectorAll('[data-testid=pending-callout]')].map(e => e.dataset.id)) }
      for (const [sel, id] of [[{ k: 'cabinet', id: 'p-cab' }, 'p-cab'], [{ k: 'recess', id: 'p-niche' }, 'p-niche'], [{ k: 'face', face: { wall: 'north', side: 1 } }, 'p-wall'], [{ k: 'floor', id: 'living' }, 'p-floor']]) {
        const ids = await shown(sel)
        assert(ids.includes(id), `${id} 的卡片上没有确认入口：${ids}`)
      }
      await tap('[data-testid=pending-reject]'); await sleep(350) // 现在选中的是地面：不要这条
      assert(!(await X_(() => window.__fss.store.getState().base.decor.surfaces.some(x => x.id === 'p-floor'))), '地面覆盖否掉后应删除')
      await X_(() => window.__decorUI().openElevation({ wall: 'south', side: 1 })); await sleep(1000)
      assert(await ap.$('[data-canvas=elev] [data-pending=p-cab]'), '立面上柜子没有淡紫标记')
      await X_(() => window.__decorUI().openElevation({ wall: 'north', side: 1 })); await sleep(1000)
      assert(await ap.$('[data-canvas=elev] [data-pending=p-wall]'), '立面上墙面覆盖没有淡紫标记')
      await X_(() => window.__decorUI().backToPlan()); await sleep(600)
      await tap('[data-testid=look-pending-toggle]'); await sleep(250)
      await tap('[data-testid=pending-confirm-all]'); await sleep(400)
      assert(!(await pendingNow()).length, `全部确认后还有：${await pendingNow()}`)
      assert(!(await ap.$('[data-testid=look-pending]')), '都确认了，那一行应该消失')
      assert(!(await ap.$('[data-pending]')), '都确认了，淡紫标记应该消失')
    })

    await step('A10c 立面里选中挂墙电视：←→ 沿墙挪、↑↓ 调离地高度、⇧ 大步，一步撤销；保存后写进文件', ap, async () => {
      await X_(() => window.__decorUI().openElevation({ wall: 'north', side: 1 })); await sleep(1000)
      const tv = () => X_(() => { const m = window.__elevModel, f = m.furniture.find(x => x.f.id === 'example-tv65'); return { u: f.u, z: f.z, at: f.f.at } })
      await X_(() => window.__decorUI().select({ k: 'furniture', id: 'example-tv65' })); await sleep(300)
      assert((await X_(() => document.querySelector('[data-testid=next-step]')?.textContent ?? '')).includes('沿墙挪'), '立面提示条没提方向键')
      const t0 = await tv()
      await ap.keyboard.press('ArrowRight'); await sleep(120)
      let t = await tv()
      assert(Math.abs(t.u[0] - t0.u[0] - 10) < 1.01 && Math.abs(t.z[0] - t0.z[0]) < 1e-6, `→ 沿墙 10：${JSON.stringify([t0, t])}`)
      await ap.keyboard.press('ArrowUp'); await sleep(120)
      t = await tv()
      assert(Math.abs(t.z[0] - t0.z[0] - 0.01) < 1e-6, `↑ 高 10 mm：${t0.z[0]} → ${t.z[0]}`)
      await ap.keyboard.down('Shift'); await ap.keyboard.press('ArrowUp'); await ap.keyboard.press('ArrowLeft'); await ap.keyboard.up('Shift'); await sleep(120)
      t = await tv()
      assert(Math.abs(t.z[0] - t0.z[0] - 0.11) < 1e-6 && Math.abs(t.u[0] - t0.u[0] + 90) < 2.01, `⇧：${JSON.stringify([t0, t])}`)
      await ap.keyboard.down('Meta'); await ap.keyboard.press('z'); await ap.keyboard.up('Meta'); await sleep(400)
      t = await tv()
      assert(Math.abs(t.u[0] - t0.u[0]) < 1e-6 && Math.abs(t.z[0] - t0.z[0]) < 1e-6, `一次撤销应回到起点：${JSON.stringify([t0, t])}`)
      await X_(() => window.__decorUI().select({ k: 'furniture', id: 'example-tv65' })); await sleep(200)
      await ap.keyboard.press('ArrowRight'); await ap.keyboard.press('ArrowUp'); await sleep(150)
      const moved = await tv()
      await tap('[data-testid=save]'); await ap.waitForFunction(() => !window.__fss.store.getState().dirty, { timeout: 5000 })
      const disk = onDisk().furniture.find(f => f.id === 'example-tv65')
      assert(JSON.stringify(disk.at) === JSON.stringify(moved.at), `文件里的位置 ${disk.at} vs ${moved.at}`)
      await X_(() => window.__decorUI().backToPlan()); await sleep(600)
      await X_(() => window.__decorUI().select({ k: 'furniture', id: 'example-tv65' })); await sleep(300)
      await ap.keyboard.down('Alt'); await sleep(60)
      const wid = await X_(() => { const w = window.__fss.getView().plan.walls.find(x => x.id === 'south'); return [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2] })
      const [wx, wy] = await plan2(wid); await ap.mouse.move(wx - 6, wy); await sleep(60); await ap.mouse.move(wx, wy); await sleep(250)
      const v = await X_(() => [...document.querySelectorAll('[data-canvas=main] [data-measure-value]')].map(e => +e.dataset.measureValue))
      await ap.keyboard.up('Alt'); await sleep(150)
      assert(v.length && v[0] > 0, `custom 构件 ⌥ 量到墙：${v}`)
      await unselect()
      return `电视沿墙 / 离地都按 10 mm 走，文件 at=${disk.at}，到南墙 ${v.join('/')} mm`
    })

    await step('A11 这一组全程零报错', ap, async () => {
      const errs = errors.slice(before).filter(e => !/WebGL|GPU stall|GL_|swiftshader/i.test(e))
      assert(!errs.length, errs.slice(0, 4).join(' | '))
    })
    await ap.close()
    // ── D9：门的外观、吊顶和灯、外观描述、拱形门套（虚构示例的副本，方案用真实的 decor-edit 写）──
    const d9File = path.join(A.dir, 'd9.json')
    {
      const base = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/agent-decor.json'), 'utf8'))
      base.openings.push(
        { id: 'master-door', wall: 'west', offset: 2400, width: 900, kind: 'door', sill: 0, head: 2100, swing: { hinge: 'start', side: 1 }, name: '主卧门' },
        { id: 'plain-door', wall: 'north', offset: 800, width: 800, kind: 'door', sill: 0, head: 2100, swing: { hinge: 'start', side: 1 } },
        { id: 'study-slide', wall: 'east', offset: 4000, width: 1600, kind: 'sliding', sill: 0, head: 2200 },
      )
      fs.writeFileSync(d9File, JSON.stringify(base))
    }
    const d9Edit = (...ops) => { const r = spawnSync(process.execPath, ['--experimental-strip-types', path.join(root, 'scripts/plan.ts'), 'decor-edit', d9File, '-'], { input: JSON.stringify({ ops }), encoding: 'utf8', cwd: root }); if (r.status !== 0) throw new Error(`decor-edit：${r.stderr}`); return JSON.parse(r.stdout) }
    const D9_FRONT = 'M120 120H780V1980H120ZM680 980h40v160h-40Z', D9_GRAIN = 'M300 120V1980M450 120V1980M600 120V1980'
    d9Edit(
      { op: 'component', component: { id: 'ceil-a', name: '客厅石膏吊顶', category: 'ceiling', look: '暖白石膏，四周隐藏灯带', size: [5000, 4000], height: 350, parts: [{ outline: 'M0 0H5000V4000H0Z', z: [0, 200], color: '#d9c9a8' }, { outline: 'M0 0H5000V300H0Z', z: [200, 350], color: '#d9c9a8' }] } },
      { op: 'component', component: { id: 'pendant', name: '餐桌吊灯', category: 'lighting', size: [600, 600], height: 700, parts: [{ outline: 'M0 0H600V600H0Z', z: [0, 200], color: '#b08a4a' }, { outline: 'M280 280H320V320H280Z', z: [200, 700], color: '#333333' }] } },
      { op: 'component', component: { id: 'flush', name: '吸顶灯', category: 'lighting', size: [500, 500], height: 30, parts: [{ outline: 'M0 0H500V500H0Z', z: [0, 30], color: '#f4f0dc' }] } },
      { op: 'add', kind: 'furniture', status: 'confirmed', item: { id: 'ceil-1', type: 'custom:ceil-a', at: [3500, 3250] }, ceiling: { room: 'living' } },
      { op: 'add', kind: 'furniture', status: 'pending', item: { id: 'pend-1', type: 'custom:pendant', at: [5100, 4500] }, ceiling: { room: 'living' } },
      { op: 'add', kind: 'furniture', status: 'confirmed', item: { id: 'flush-1', type: 'custom:flush', at: [1800, 2000] }, ceiling: { room: 'living' } },
      { op: 'update', id: 'example-l-sofa', set: { look: '奶白布艺，低靠背' } },
      { op: 'add', kind: 'door', status: 'pending', item: { id: 'door-master', opening: 'master-door', color: '#705040', frame: { color: '#222222' }, look: '胡桃木竖纹门扇，黑色细门框', front: [{ d: D9_FRONT, style: 'outline' }, { d: D9_GRAIN, style: 'detail' }] } },
      { op: 'add', kind: 'door', status: 'confirmed', item: { id: 'door-slide', opening: 'study-slide', material: 'walnut', frame: { material: 'gunmetal' }, name: '书房推拉门' } },
      { op: 'add', kind: 'panel', status: 'confirmed', item: { id: 'arch-1', type: 'arch', opening: 'entry', thickness: 80, material: 'walnutV', name: '入口拱形门套', look: '胡桃木饰面，半圆拱' } },
      { op: 'add', kind: 'cabinet', status: 'confirmed', item: { id: 'look-cab', family: 'tall', place: { face: { wall: 'south', side: 1 }, s: 3000 }, width: 1200, depth: 400, z: [0, 2400], columns: [{ width: 600, cells: [{ type: 'door' }] }, { cells: [{ type: 'door' }] }], materials: { carcass: 'creamDoor', front: 'creamDoor' }, look: '奶白平板门，无拉手' } },
    )
    const dp = await newPage(1)
    {
      const before = errors.length
      const Q = (fn, ...a) => dp.evaluate(fn, ...a)
      const sel = () => Q(() => window.__decorUI().sel)
      const fur = id => Q(i => window.__fss.store.getState().base.decor.furniture.find(f => f.id === i), id)
      const door = id => Q(i => window.__fss.store.getState().base.decor.doors?.find(f => f.id === i) ?? null, id)
      const card = () => Q(() => [...document.querySelectorAll('.glass, .glass-strong')].map(e => e.textContent).filter(t => t.includes('交给 Agent') || t.includes('这套房的装修')).join(' '))
      const noJargon = t => assert(!/pending|custom|overhead|look\b|status|confirmed/i.test(t), `卡片有开发用词：${t.slice(0, 200)}`)
      const tapD = async s => { await dp.waitForSelector(s, { visible: true, timeout: 4000 }); await sleep(250); await dp.click(s) }
      const pick = async d => { await Q(x => window.__decorUI().select(x), d); await sleep(350) }
      const away = async () => { await dp.mouse.move(700, 880); await sleep(250) }
      const solidsOf = id => Q(i => window.__decorSolids.filter(s => s.ids.includes(i)).length, id)
      const to3d = async () => { await Q(() => { window.__decorUI().set({ hover: null }); window.__fss.store.getState().setMain('3d') }); await sleep(2200) }
      const to2d = async () => { await Q(() => { window.__decorUI().set({ look3d: 'flat', overhead3d: false }); const s = window.__fss.store.getState(); s.setCam('iso'); s.setMain('2d') }); await sleep(800) }
      const undo = async () => { await Q(() => window.__fss.store.getState().undo()); await sleep(300) }
      await dp.goto(`http://127.0.0.1:5298/?plan=d9.json&mode=decor`, { waitUntil: 'load' }); await dp.waitForFunction(() => !!window.__fss?.store.getState().base?.decor?.doors, { timeout: 20000 }); await sleep(1800)

      await step('D9-1 平面：吊顶和灯只有虚线轮廓，不盖地面和家具；点中间选地面、家具，点虚线、名字选吊顶；卡片有外观，确认、否掉照常', dp, async () => {
        const q = await Q(() => [...document.querySelectorAll('[data-overhead]')].map(g => ({ id: g.dataset.id, fills: [...g.querySelectorAll(':scope > g path')].map(p => p.getAttribute('fill')), dash: [...g.querySelectorAll(':scope > g path')].every(p => !!p.getAttribute('stroke-dasharray')), filter: g.getAttribute('filter') })))
        assert(q.map(x => x.id).sort().join() === 'ceil-1,flush-1,pend-1', `顶上的东西：${JSON.stringify(q)}`)
        assert(q.every(x => x.fills.length && x.fills.every(f => f === 'none') && x.dash && !x.filter), `应只有虚线：${JSON.stringify(q)}`)
        assert(!(await Q(() => !!document.querySelector('[data-pending=pend-1] [fill*=lav]'))), '待确认的顶灯也不铺斜纹')
        // 吊顶中间：地面、地毯、家具照常选得到
        await clickPlan(dp, [2500, 3000]); assert((await sel())?.k === 'floor', `吊顶中间应选地面：${JSON.stringify(await sel())}`)
        await clickPlan(dp, [3500, 3100]); assert((await sel())?.id === 'example-round-rug', `吊顶中间的地毯：${JSON.stringify(await sel())}`)
        await clickPlan(dp, [4500, 4500]); assert((await sel())?.id === 'example-four-leg-table', `吊灯旁边的桌子：${JSON.stringify(await sel())}`)
        await clickPlan(dp, [5100, 4500]); assert((await sel())?.id === 'pend-1', `桌上的吊灯：${JSON.stringify(await sel())}`)
        let t = await card()
        assert(t.includes('Agent 提议') && t.includes('我确认') && t.includes('不要这条') && t.includes('在顶上') && t.includes('平视'), `吊灯卡片：${t}`)
        await clickPlan(dp, [2000, 1250]); assert((await sel())?.id === 'ceil-1', `点虚线应选吊顶：${JSON.stringify(await sel())}`)
        t = await card()
        assert(t.includes('外观：暖白石膏，四周隐藏灯带') && t.includes('吊顶') && !t.includes('Agent 提议'), `吊顶卡片：${t}`); noJargon(t)
        assert(!(await dp.$('[data-testid=item-look] input, [data-testid=item-look] button')), '外观是只读的')
        await away(); await shot(dp, 'D9-plan-ceiling.png')
        await Q(() => window.__decorUI().select(null)); await sleep(300)
        const lb = await Q(() => { const r = document.querySelector('[data-overhead-label=ceil-1] rect').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })
        await dp.mouse.click(lb[0], lb[1]); await sleep(320); assert((await sel())?.id === 'ceil-1', '点名字也能选吊顶')
        await pick({ k: 'furniture', id: 'example-l-sofa' })
        t = await card(); assert(t.includes('外观：奶白布艺，低靠背'), `摆放项优先：${t}`)
        await pick({ k: 'cabinet', id: 'look-cab' }); assert((await card()).includes('外观：奶白平板门，无拉手'), '柜体外观')
        await pick({ k: 'furniture', id: 'example-tv65' }); assert(!(await dp.$('[data-testid=item-look]')), '没写外观就不该有这行')
        await pick(null)
        return `${q.length} 件都是虚线`
      })

      await step('D9-2 拖动、方向键挪顶上的东西：平面位置变，离地高度不变，不贴墙', dp, async () => {
        const f0 = await fur('ceil-1')
        assert(Math.abs(f0.z - 2.45) < 1e-6, `吊顶贴顶：${f0.z}`)
        const a = await P(dp, [2000, 1250]), b = await P(dp, [1400, 1000])
        await drag(dp, a, b)
        const f1 = await fur('ceil-1')
        assert(f1.at[0] < f0.at[0] && f1.at[1] < f0.at[1] && f1.z === f0.z && !f1.against, `拖动后：${JSON.stringify(f1)}`)
        await undo(); await sleep(1700) // 1.6 秒内同一件的连续拖动算一步，等过这个窗口
        // 拖到贴墙也不吸附、不记靠墙
        const near = await P(dp, [1000, 3000]), wall = await P(dp, [170, 3000])
        await drag(dp, near, wall)
        const f2 = await fur('ceil-1')
        assert(!f2.against && f2.z === f0.z && f2.at[1] === f0.at[1], `贴墙也不吸附：${JSON.stringify(f2)}`)
        await undo(); await sleep(1700)
        await pick({ k: 'furniture', id: 'ceil-1' })
        await dp.keyboard.press('ArrowRight'); await dp.keyboard.press('ArrowDown'); await sleep(200)
        const f3 = await fur('ceil-1')
        assert(f3.at[0] === f0.at[0] + 10 && f3.at[1] === f0.at[1] + 10 && f3.z === f0.z && !f3.against, `方向键：${JSON.stringify(f3)}`)
        await undo(); await pick(null)
      })

      await step('D9-3 3D：斜视、俯视不画吊顶和顶灯，落地灯还在；平视才画；「3D 顶面和梁」打开时也画但不进导出；白模同样', dp, async () => {
        await to3d(); await pick(null)
        assert((await solidsOf('ceil-1')) === 0 && (await solidsOf('flush-1')) === 0 && (await solidsOf('pend-1')) === 0, '斜视不该画顶上的东西')
        assert((await solidsOf('example-lamp')) > 0 && (await solidsOf('example-l-sofa')) > 0, '落地灯、家具要在')
        await away(); await shot(dp, 'D9-3d-iso.png')
        await tapD('[data-testid=cam-top]'); await sleep(1500)
        assert((await solidsOf('ceil-1')) === 0, '俯视不该画')
        await shot(dp, 'D9-3d-top.png')
        const png = async name => { const r = await dp.evaluate(n => new Promise(res => window.dispatchEvent(new CustomEvent('export-3d', { detail: { bg: 'white', aspect: '16:9', name: n, done: (ok, w, h) => res([ok, w, h]) } }))), name); assert(r[0], '导出失败'); await sleep(900); return fs.readFileSync(path.join(downloads, name)) }
        await tapD('[data-testid=cam-iso]'); await sleep(1600)
        // 比像素：同一机位重画一次阴影、抗锯齿会有细微差别，吊顶进了图则有一大片变色
        const diff = (a, b) => dp.evaluate(async (x, y) => {
          const load = async u => { const im = new Image(); im.src = u; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); return g.getImageData(0, 0, im.width, im.height).data }
          const A = await load(x), B = await load(y); let n = 0
          for (let i = 0; i < A.length; i += 4) if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 48) n++
          return n / (A.length / 4)
        }, `data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`)
        const off = await png('d9-off.png')
        await Q(() => window.__decorUI().set({ overhead3d: true })); await sleep(800)
        assert((await solidsOf('ceil-1')) > 0 && (await Q(() => window.__decor3d.overhead.uiOnly)), '图层打开时斜视也画')
        await away(); await shot(dp, 'D9-3d-iso-layer.png')
        const on = await png('d9-on.png')
        const layerDiff = await diff(off, on)
        assert(layerDiff < 0.002, `图层打开时导出不该带吊顶：差 ${(layerDiff * 100).toFixed(2)}% 像素`)
        await Q(() => window.__decorUI().set({ overhead3d: false })); await sleep(500)
        await tapD('[data-testid=cam-eye]'); await sleep(1800)
        assert((await solidsOf('ceil-1')) > 0 && (await solidsOf('flush-1')) > 0 && (await solidsOf('pend-1')) > 0, '平视要画')
        assert(!(await Q(() => window.__decor3d.overhead.uiOnly)), '平视进导出')
        await away(); await shot(dp, 'D9-3d-eye.png')
        const eye = await png('d9-eye.png')
        await tapD('[data-testid=cam-iso]'); await sleep(1500)
        const iso2 = await png('d9-iso2.png')
        assert((await diff(eye, iso2)) > 0.05, '平视导出和斜视不该一样')
        await Q(() => window.__decorUI().set({ look3d: 'clay' })); await sleep(900)
        assert((await solidsOf('ceil-1')) === 0, '白模斜视不画')
        await away(); await shot(dp, 'D9-3d-iso-clay.png')
        await tapD('[data-testid=cam-eye]'); await sleep(1500)
        assert((await solidsOf('ceil-1')) > 0, '白模平视画')
        await away(); await shot(dp, 'D9-3d-eye-clay.png')
        await Q(() => { window.__decorUI().set({ look3d: 'flat' }) }); await sleep(600)
        // 室内机位看吊顶吊灯
        await Q(() => { window.__decorUI().set({ hover: null }); window.__setCam3d([0.6, 1.3, 6.1], [5.1, 2.2, 4.5]) }); await sleep(600); await away(); await shot(dp, 'D9-3d-eye-inside.png')
        await to2d()
        return `图层开关前后导出差 ${(layerDiff * 100).toFixed(3)}% 像素`
      })

      await step('D9-4 门的外观：点门出卡片，没外观的门还是墙面；提议列表能跳到；确认、否掉、恢复 prev', dp, async () => {
        await to2d(); await pick(null)
        await clickPlan(dp, [1200, 0])
        let s = await sel(); assert(s?.k === 'face' && s.face.wall === 'north', `没外观的门应保持原样：${JSON.stringify(s)}`)
        await pick(null)
        await tapD('[data-testid=look-pending-toggle]'); await sleep(250)
        const label = await Q(() => document.querySelector('[data-testid=pending-item-door-master]')?.textContent ?? '')
        assert(label.includes('主卧门的外观'), `列表里的名字：${label}`)
        await tapD('[data-testid=pending-item-door-master]'); await sleep(300)
        s = await sel(); assert(s?.k === 'door' && s.id === 'door-master', `逐条跳到门：${JSON.stringify(s)}`)
        let t = await card()
        for (const want of ['主卧门', '门的外观', '平开门', '外观：胡桃木竖纹门扇，黑色细门框', '门扇', '门框', '我确认', '不要这条', '这是新加的']) assert(t.includes(want), `门的卡片缺「${want}」：${t}`)
        noJargon(t)
        await away(); await shot(dp, 'D9-door-card-pending.png')
        await pick(null)
        await clickPlan(dp, [0, 3650])
        s = await sel(); assert(s?.k === 'door' && s.id === 'door-master', `点门应选门：${JSON.stringify(s)}`)
        assert(await Q(() => !!document.querySelector('[data-door-highlight=door-master]')), '平面上选中的门要有高亮')
        await away(); await shot(dp, 'D9-plan-door.png')
        await tapD('[data-testid=pending-confirm]'); await sleep(350)
        let d = await door('door-master')
        assert(d.status === 'confirmed', `确认后：${JSON.stringify(d)}`)
        t = await card(); assert(t.includes('Agent 加的') && !t.includes('我确认'), `确认后的卡片：${t}`)
        await undo(); assert((await door('door-master')).status === 'pending', '撤销确认')
        await tapD('[data-testid=pending-reject]'); await sleep(350)
        assert(!(await door('door-master')) && !(await sel()), '否掉新加的门外观应删除')
        await undo(); assert(await door('door-master'), '撤销否掉')
        // 有改动的：卡片写改了什么，否掉回到改之前（保存后 Agent 再改文件）
        await tapD('[data-testid=save]'); await dp.waitForFunction(() => !window.__fss.store.getState().dirty, { timeout: 5000 }); await sleep(300)
        d9Edit({ op: 'update', id: 'door-slide', set: { material: 'teak', look: '柚木推拉门' }, status: 'pending' })
        await dp.waitForFunction(() => window.__fss.store.getState().base.decor.doors.find(x => x.id === 'door-slide')?.status === 'pending', { timeout: 6000 }); await sleep(300)
        await pick({ k: 'door', id: 'door-slide' })
        t = await card(); assert(t.includes('书房推拉门') && t.includes('推拉门') && t.includes('改了') && t.includes('材料') && t.includes('柚木') && t.includes('外观：柚木推拉门'), `有改动的门：${t}`); noJargon(t)
        await tapD('[data-testid=pending-reject]'); await sleep(350)
        d = await door('door-slide'); assert(d.status === 'confirmed' && d.material === 'walnut' && !d.look && !d.prev, `否掉恢复：${JSON.stringify(d)}`)
        await pick(null)
        // 交给 Agent 带门的 ref，写明门的外观
        await pick({ k: 'door', id: 'door-master' })
        await tapD('[data-testid=inspector-agent]'); await sleep(500)
        const ag = await Q(() => document.querySelector('[data-testid=agent-decor-refs]')?.textContent ?? '')
        assert(ag.includes('主卧门的外观'), `交给 Agent：${ag}`)
        await Q(() => window.__fss.store.getState().openAgent(false)); await sleep(300); await pick(null)
      })

      await step('D9-5 门在 3D：平涂用外观颜色（材料也取得到），待确认淡紫，白模不变；点门扇出卡片', dp, async () => {
        await to2d(); await pick(null)
        await to3d()
        let L = await Q(() => window.__doorLeaves3d)
        const m = L.find(x => x.opening === 'master-door'), sl = L.filter(x => x.opening === 'study-slide')
        assert(m?.pending && m.mat === 'b7a8f7', `待确认应淡紫：${JSON.stringify(m)}`)
        assert(sl.length && sl.every(x => x.color && x.color.startsWith('#') && !x.pending), `推拉门取材料颜色：${JSON.stringify(sl)}`)
        const walnut = await Q(() => window.__fss.store.getState().base.decor.materials.find(x => x.id === 'walnut').color)
        assert(sl[0].color === walnut, `材料颜色 ${sl[0].color} vs ${walnut}`)
        await away(); await shot(dp, 'D9-3d-door-pending.png')
        // 门在西墙内侧：从房间里看
        await Q(() => window.__setCam3d([4.2, 1.7, 3.65], [0, 1.1, 3.65])); await sleep(700); await away(); await shot(dp, 'D9-3d-door-pending-inside.png')
        await Q(() => window.__decorUI().select({ k: 'door', id: 'door-master' })); await sleep(250)
        await tapD('[data-testid=pending-confirm]'); await sleep(900)
        L = await Q(() => window.__doorLeaves3d)
        const m2 = L.find(x => x.opening === 'master-door')
        assert(!m2.pending && m2.mat !== 'b7a8f7', `确认后用外观颜色：${JSON.stringify(m2)}`)
        await Q(() => window.__decorUI().select(null)); await sleep(300); await away(); await shot(dp, 'D9-3d-door-confirmed-inside.png')
        const hit = await Q(() => { const leaf = window.__fixtures3d.find(x => x.ids.includes('master-door') && x.kind === 'leaf'); return !!leaf })
        assert(hit, '门扇网格')
        const clayBefore = await Q(() => { window.__decorUI().set({ look3d: 'clay' }); return true }); await sleep(900)
        const c = (await Q(() => window.__doorLeaves3d)).find(x => x.opening === 'master-door')
        const plainClay = await Q(() => window.__decor3d.look)
        assert(clayBefore && plainClay === 'clay' && c.mat !== m2.mat, `白模不用外观颜色：${JSON.stringify(c)}`)
        await Q(() => window.__decorUI().set({ look3d: 'flat' })); await sleep(700)
        // 3D 里点门扇（门开 68°，命中点不在洞口里）
        const pt = await Q(() => { const v = [0.417, 1.05, 3.932]; return window.__world2screen(v) })
        await dp.mouse.click(pt[0], pt[1]); await sleep(450)
        const s = await sel()
        assert(s?.k === 'door' && s.id === 'door-master', `3D 点门扇：${JSON.stringify(s)}`)
        await away(); await shot(dp, 'D9-3d-door-selected.png')
        await pick(null); await to2d()
        return `推拉门 ${sl[0].color}；主卧门 ${m2.mat}`
      })

      await step('D9-6 门在立面：门板颜色 + 正面路径（d 属性、线宽不缩放），从另一侧看左右翻；能选中，不能拖；窗和没外观的门不变', dp, async () => {
        await Q(() => window.__decorUI().openElevation({ wall: 'west', side: 1 })); await sleep(1200)
        const q = () => Q(() => { const g = document.querySelector('[data-elev=door][data-id=door-master]'); if (!g) return null; const ps = [...g.querySelectorAll(':scope > g path')]; return { fill: g.querySelector('[data-door-fill]')?.getAttribute('fill'), frame: g.querySelector('[data-door-frame]')?.getAttribute('stroke'), d: ps.map(p => p.getAttribute('d')), effect: ps.map(p => p.getAttribute('vector-effect')), sw: ps.map(p => p.getAttribute('stroke-width')), mirror: g.dataset.mirror ?? '', tr: g.querySelector('g').getAttribute('transform') } })
        const a = await q()
        assert(a && a.fill && a.frame, `门板：${JSON.stringify(a)}`)
        assert(a.d[0] === D9_FRONT && a.d[1] === D9_GRAIN && a.effect.every(e => e === 'non-scaling-stroke'), `正面路径：${JSON.stringify(a)}`)
        assert(!a.mirror, `从房间里看不翻：${JSON.stringify(a)}`)
        const hasHtml = await Q(() => [...document.querySelectorAll('[data-elev=door] *')].some(e => e.tagName.toLowerCase() === 'foreignobject'))
        assert(!hasHtml, '不该有 HTML')
        await away(); await shot(dp, 'D9-elev-door.png')
        await Q(() => window.dispatchEvent(new CustomEvent('plan-zoom', { detail: 1.5 }))); await sleep(300)
        const z = await q(); assert(z.sw.join() === a.sw.join() && z.tr !== a.tr, `放大后线宽不变：${a.sw} → ${z.sw}`)
        await Q(() => window.dispatchEvent(new CustomEvent('plan-zoom', { detail: 1 / 1.5 }))); await sleep(300)
        const c = await Q(() => { const m = window.__elevModel, o = m.openings.find(x => x.o.id === 'master-door'); return window.__elev2screen((o.u[0] + o.u[1]) / 2, 1) })
        await dp.mouse.click(c[0], c[1]); await sleep(300)
        const s = await sel(); assert(s?.k === 'door' && s.id === 'door-master', `立面点门板：${JSON.stringify(s)}`)
        const u0 = await Q(() => window.__fss.store.getState().base.openings.find(o => o.id === 'master-door').offset)
        await drag(dp, c, [c[0] + 60, c[1] - 30])
        await dp.keyboard.press('ArrowRight'); await sleep(200)
        const d0 = await door('door-master')
        assert((await Q(() => window.__fss.store.getState().base.openings.find(o => o.id === 'master-door').offset)) === u0 && d0.opening === 'master-door', '门不能在这里挪')
        await away(); await shot(dp, 'D9-elev-door-selected.png')
        await Q(() => window.__decorUI().openElevation({ wall: 'west', side: -1 })); await sleep(1000)
        const b = await q(); assert(b?.mirror === '1' && b.d[0] === D9_FRONT, `从另一侧看应翻：${JSON.stringify(b)}`)
        await Q(() => window.__decorUI().openElevation({ wall: 'north', side: 1 })); await sleep(1000)
        assert(!(await Q(() => !!document.querySelector('[data-elev=door]'))), '没外观的门不该画门板')
        await Q(() => window.__decorUI().backToPlan()); await sleep(600)
      })

      await step('D9-7 拱形门套：平面虚线能选中，立面画拱，3D 有实体能点到，卡片不报错；不能拖', dp, async () => {
        await to2d(); await Q(() => window.__decorUI().backToPlan()); await sleep(500)
        const g = await Q(() => { const e = document.querySelector('[data-decor=panel][data-id=arch-1]'); return e && { fill: e.getAttribute('fill'), dash: e.getAttribute('stroke-dasharray') } })
        assert(g && g.dash, `平面：${JSON.stringify(g)}`)
        await clickPlan(dp, [5550, 6365])
        let s = await sel(); assert(s?.k === 'panel' && s.id === 'arch-1', `平面选中：${JSON.stringify(s)}`)
        let t = await card()
        for (const want of ['入口拱形门套', '拱形门套', '外观：胡桃木饰面，半圆拱', '跟着门洞走']) assert(t.includes(want), `卡片缺「${want}」：${t}`)
        assert(!t.includes('贴在') && !(await dp.$('[data-testid=panel-w]')), `不该有墙面造型的字段：${t}`); noJargon(t)
        await away(); await shot(dp, 'D9-plan-arch.png')
        await Q(() => window.__decorUI().openElevation({ wall: 'south', side: 1 })); await sleep(1100)
        await pick({ k: 'panel', id: 'arch-1' })
        const e = await Q(() => { const p = document.querySelector('[data-elev=panel][data-id=arch-1] path'); return { n: (p?.getAttribute('d') ?? '').split('L').length, handles: !!document.querySelector('[data-testid=elev-sel] rect[rx="2.5"]') } })
        assert(e.n > 40 && !e.handles, `立面应画弧、没有改尺寸的抓手：${JSON.stringify(e)}`)
        await away(); await shot(dp, 'D9-elev-arch.png')
        const c = await Q(() => { const m = window.__elevModel, o = m.openings.find(x => x.o.id === 'entry'); return window.__elev2screen((o.u[0] + o.u[1]) / 2, 2.05) })
        const before3 = JSON.stringify(await Q(() => window.__fss.store.getState().base.decor.panels.find(p => p.id === 'arch-1')))
        await dp.mouse.move(c[0], c[1]); await drag(dp, c, [c[0] + 50, c[1]])
        await dp.keyboard.press('ArrowLeft'); await sleep(200)
        assert(JSON.stringify(await Q(() => window.__fss.store.getState().base.decor.panels.find(p => p.id === 'arch-1'))) === before3, '拱形门套不该被拖动改掉')
        await Q(() => window.__decorUI().backToPlan()); await sleep(500)
        await to3d()
        assert((await solidsOf('arch-1')) > 20, `3D 实体数：${await solidsOf('arch-1')}`)
        await Q(() => window.__setCam3d([5.55, 1.3, 0.9], [5.55, 1.2, 6.5])); await sleep(700)
        await Q(() => window.__decorUI().select(null)); await away(); await shot(dp, 'D9-3d-arch.png')
        // 点拱肩（洞口左上角）
        const pt = await Q(() => window.__world2screen([5.14, 2.04, 6.32]))
        await dp.mouse.click(pt[0], pt[1]); await sleep(400)
        s = await sel(); assert(s?.k === 'panel' && s.id === 'arch-1', `3D 点到拱形门套：${JSON.stringify(s)}`)
        await away(); await shot(dp, 'D9-3d-arch-selected.png')
        await pick(null); await to2d()
      })

      await step('D9-8 家具库「方案里的构件」有「吊顶」组；再摆一个贴到顶上；门的外观拆了门不报错', dp, async () => {
        await to2d(); await Q(() => window.__decorUI().backToPlan()); await sleep(500)
        await Q(() => window.__decorUI().setTool('furniture')); await sleep(400)
        await tapD('[data-testid=furn-cat-own]'); await sleep(300)
        const groups = await Q(() => [...document.querySelectorAll('[data-testid=furn-own-group] > div:first-child')].map(e => e.textContent))
        assert(groups.includes('吊顶'), `分组：${groups}`)
        await away(); await shot(dp, 'D9-lib.png')
        await tapD('[data-testid=furn-own-ceil-a]'); await sleep(200)
        await clickPlan(dp, [2500, 3000])
        const n = await Q(() => window.__fss.store.getState().base.decor.furniture.filter(f => f.type === 'custom:ceil-a').map(f => ({ by: f.by, z: f.z })))
        const mine = n.find(x => x.by === 'user')
        assert(mine && Math.abs(mine.z - 2.45) < 1e-6, `再摆一个：${JSON.stringify(n)}`)
        await undo(); await pick(null)
        // 洞口被拆：卡片说明白，总览不崩
        await Q(() => { const s = window.__fss.store.getState(); s.setMode('renovation'); s.edit([{ id: 'c-rm-door', op: 'remove', type: 'opening', target: 'master-door', by: 'user', status: 'confirmed' }], { silent: true }); s.setMode('decor') }); await sleep(900)
        await pick({ k: 'door', id: 'door-master' })
        const t = await card()
        assert((await dp.$('[data-testid=door-missing]')) && t.includes('拆掉'), `门被拆：${t}`)
        await pick(null)
        assert((await card()).includes('这套房的装修'), '总览应正常')
        await undo(); await sleep(300)
      })

      await step('D9-9 这一组全程零报错', dp, async () => {
        const errs = errors.slice(before).filter(e => !/WebGL|GPU stall|GL_|swiftshader/i.test(e))
        assert(!errs.length, errs.slice(0, 4).join(' | '))
      })
    }
    await dp.close()
    // ── 底图的不透明度、显隐：连着文件松手就写回；有别的未保存改动就等下一次保存；不盖 Agent 刚写的；每层各管各的 ──
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    const uPlan = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/skill-two-bed/plan.json'), 'utf8'))
    uPlan.underlay = { src: PNG, mmPerPx: 10, origin: [0, 0], opacity: 50, visible: true }
    const uFile = path.join(A.dir, 'under.json'), lFile = path.join(A.dir, 'levels.json')
    fs.writeFileSync(uFile, JSON.stringify(uPlan))
    fs.writeFileSync(lFile, JSON.stringify({ ...uPlan, levels: [{ id: 'L1', name: '1F', elevation: 0 }, { id: 'L2', name: '2F', elevation: 3 }], levelUnderlays: { L2: { ...uPlan.underlay, opacity: 30 } } }))
    const readU = f => JSON.parse(fs.readFileSync(f, 'utf8'))
    const up = await newPage(1)
    const uState = () => up.evaluate(() => { const s = window.__fss.store.getState(); return { opacity: s.base.underlay.opacity, visible: s.base.underlay.visible, dirty: s.dirty, title: s.base.title, past: s.hist.original.past.length } })
    const openU = async name => { await up.goto(`http://127.0.0.1:5298/?plan=${name}`, { waitUntil: 'load' }); await up.waitForFunction(() => !!window.__fss?.store.getState().base, { timeout: 20000 }); await sleep(600); await up.evaluate(() => window.__fss.store.getState().setNotice(null)) }
    const openLayers = async () => { await up.click('[aria-label="图层"]'); await up.waitForSelector('[data-testid=underlay-opacity] input', { visible: true, timeout: 3000 }); await sleep(250) }
    const closeLayers = async () => { await up.evaluate(() => window.__fss.store.getState().setPanel(null)); await sleep(250) }
    const dragSlider = async pct => {
      const b = await (await up.$('[data-testid=underlay-opacity] input')).boundingBox(), y = b.y + b.height / 2
      await up.mouse.move(b.x + b.width * .5, y); await up.mouse.down()
      for (let i = 1; i <= 6; i++) { await up.mouse.move(b.x + b.width * (.5 + (pct - .5) * i / 6), y); await sleep(20) }
      await up.mouse.up(); await sleep(60)
    }
    const clean = () => up.waitForFunction(() => !window.__fss.store.getState().dirty, { timeout: 6000 })
    await step('U1 连着文件：拖一次滑块，松手就写回，不进撤销历史，重开还是这个值；显隐开关同样', up, async () => {
      await openU('under.json'); await openLayers()
      await dragSlider(.82); await clean()
      const s = await uState(), disk = readU(uFile)
      assert(s.opacity !== 50 && disk.underlay.opacity === s.opacity, `文件 ${disk.underlay.opacity} vs 工具 ${s.opacity}`)
      assert(s.past === 0, `不透明度不该进撤销历史：${s.past}`)
      await closeLayers(); await openU('under.json')
      assert((await uState()).opacity === s.opacity, `重开后 ${(await uState()).opacity}，应该是 ${s.opacity}`)
      await openLayers()
      await up.click('[role=switch][aria-label="底图"]'); await clean()
      assert(readU(uFile).underlay.visible === false, '关底图没写回文件')
      await up.click('[role=switch][aria-label="底图"]'); await clean()
      assert(readU(uFile).underlay.visible === true, '开底图没写回文件')
      await closeLayers()
      return `不透明度 ${s.opacity} 写进文件、重开还在；显隐也写回`
    })
    await step('U2 有别的未保存改动：松手不写文件，⌘S 时一起写；撤销别的改动不动这个值', up, async () => {
      const before = readU(uFile), o0 = before.underlay.opacity
      await up.evaluate(() => { const s = window.__fss.store.getState(); s.replaceBase({ ...s.base, title: '本地改动' }) }); await sleep(100)
      await openLayers(); await dragSlider(.3); await sleep(900)
      const s = await uState()
      assert(s.dirty && s.opacity !== o0, `应该还没保存：${JSON.stringify(s)}`)
      const mid = readU(uFile)
      assert(mid.title === before.title && mid.underlay.opacity === o0, '有别的改动时不该自动写文件')
      await closeLayers()
      await up.keyboard.down('Meta'); await up.keyboard.press('s'); await up.keyboard.up('Meta'); await clean()
      const disk = readU(uFile)
      assert(disk.title === '本地改动' && disk.underlay.opacity === s.opacity, `⌘S 没一起写：${disk.title} ${disk.underlay.opacity}`)
      await up.evaluate(() => window.__fss.store.getState().undo()); await sleep(200)
      const u = await uState()
      assert(u.title !== '本地改动' && u.opacity === s.opacity, `撤销改标题不该带回旧不透明度：${JSON.stringify(u)}`)
      await up.keyboard.down('Meta'); await up.keyboard.press('s'); await up.keyboard.up('Meta'); await clean()
      return `⌘S 一起写；撤销后不透明度还是 ${u.opacity}`
    })
    await step('U3 Agent 刚写了文件：不盖掉，内容和这个值都留下', up, async () => {
      const ext = readU(uFile); ext.title = 'Agent 刚写的'; fs.writeFileSync(uFile, JSON.stringify(ext)); const o0 = ext.underlay.opacity
      await openLayers(); await dragSlider(.65)
      const want = (await uState()).opacity
      assert(want !== o0, '滑块没动')
      await up.waitForFunction(t => { const s = window.__fss.store.getState(); return s.base.title === t && !s.dirty }, { timeout: 9000 }, 'Agent 刚写的')
      await sleep(300); await closeLayers()
      const disk = readU(uFile), s = await uState()
      assert(disk.title === 'Agent 刚写的' && disk.underlay.opacity === want && s.opacity === want, `文件 ${disk.title} ${disk.underlay.opacity}，工具 ${s.title} ${s.opacity}，要 ${want}`)
      return `标题没丢，不透明度 ${want}`
    })
    await step('U4 多层：每层的底图各管各的，写回文件、重开都对', up, async () => {
      await openU('levels.json')
      await up.evaluate(() => window.__fss.store.getState().setLevel('L2')); await sleep(300)
      await openLayers()
      const v0 = await up.$eval('[data-testid=underlay-opacity] input', e => +e.value)
      assert(v0 === 30, `二层滑块应该是 30：${v0}`)
      await dragSlider(.9); await clean()
      const v1 = await up.$eval('[data-testid=underlay-opacity] input', e => +e.value), disk = readU(lFile)
      assert(v1 !== 30 && disk.levelUnderlays.L2.opacity === v1 && disk.underlay.opacity === 50, `文件 L2=${disk.levelUnderlays.L2.opacity} 主=${disk.underlay.opacity} 滑块=${v1}`)
      await up.evaluate(() => window.__fss.store.getState().setLevel('L1')); await sleep(300)
      assert((await up.$eval('[data-testid=underlay-opacity] input', e => +e.value)) === 50, '一层应该还是 50')
      await closeLayers()
      return `二层 ${v1}，一层 50`
    })
    await step('U6 连接文件（Chrome / Edge 打开方案的默认方式）：松手写回原文件；Agent 刚写过也不盖；重开还在', up, async () => {
      const lk = await newPage(1)
      await lk.evaluateOnNewDocument(() => { window.showOpenFilePicker = async () => [await (await navigator.storage.getDirectory()).getFileHandle('link-u.json', { create: true })] })
      const extWrite = text => lk.evaluate(async t => { const r = await navigator.storage.getDirectory(), tmp = await r.getFileHandle('link-u.tmp', { create: true }), w = await tmp.createWritable(); await w.write(t); await w.close(); await tmp.move(r, 'link-u.json') }, text)
      const extRead = async () => JSON.parse(await lk.evaluate(async () => (await (await (await navigator.storage.getDirectory()).getFileHandle('link-u.json')).getFile()).text()))
      await lk.goto('http://127.0.0.1:5298/', { waitUntil: 'load' }); await lk.waitForFunction(() => !!window.__fss); await sleep(600)
      await extWrite(JSON.stringify({ ...uPlan, title: '连接-A' }))
      await lk.click('[data-testid=file-menu]'); await lk.waitForSelector('[data-testid=menu-open]'); await lk.click('[data-testid=menu-open]')
      await lk.waitForFunction(() => window.__fss.store.getState().base?.title === '连接-A' && window.__fss.store.getState().source.kind === 'linked', { timeout: 8000 }); await sleep(400)
      const drag = async pct => {
        await lk.click('[aria-label="图层"]'); await lk.waitForSelector('[data-testid=underlay-opacity] input', { visible: true }); await sleep(250)
        const b = await (await lk.$('[data-testid=underlay-opacity] input')).boundingBox()
        await lk.mouse.click(b.x + b.width * pct, b.y + b.height / 2); await sleep(150)
        await lk.evaluate(() => window.__fss.store.getState().setPanel(null)); await sleep(200)
        return lk.evaluate(() => window.__fss.store.getState().base.underlay.opacity)
      }
      const o1 = await drag(.8)
      await lk.waitForFunction(() => !window.__fss.store.getState().dirty, { timeout: 6000 })
      assert((await extRead()).underlay.opacity === o1 && o1 !== 50, `文件没写回：${(await extRead()).underlay.opacity} vs ${o1}`)
      await extWrite(JSON.stringify({ ...(await extRead()), title: '连接-B' }))
      const o2 = await drag(.25)
      assert(o2 !== o1, '第二次滑块没动')
      await lk.waitForFunction(() => { const s = window.__fss.store.getState(); return s.base.title === '连接-B' && !s.dirty }, { timeout: 9000 })
      await sleep(300)
      const disk = await extRead(), st2 = await lk.evaluate(() => window.__fss.store.getState().base.underlay.opacity)
      assert(disk.title === '连接-B' && disk.underlay.opacity === o2 && st2 === o2, `文件 ${disk.title} ${disk.underlay.opacity}，工具 ${st2}，要 ${o2}`)
      await lk.reload({ waitUntil: 'load' }); await lk.waitForFunction(() => window.__fss?.store.getState().base?.title === '连接-B', { timeout: 8000 })
      assert((await lk.evaluate(() => window.__fss.store.getState().base.underlay.opacity)) === o2, '重开后值不对')
      await lk.close()
      return `写回 ${o1}；Agent 写过之后 ${o2} 也写回且标题没丢；重开还在`
    })
    await up.close()
    await step('U5 没连文件：刷新靠自动保存恢复，导出的方案带上这个值', up, async () => {
      const lp = await newPage(1)
      const text = JSON.stringify(uPlan)
      await lp.goto(URL0, { waitUntil: 'load' }); await lp.waitForFunction(() => window.__fss && !window.__fss.store.getState().booting); await sleep(300)
      await lp.evaluate(t => { const dt = new DataTransfer(); dt.items.add(new File([t], 'under.json', { type: 'application/json' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })) }, text)
      await lp.waitForFunction(() => window.__fss.store.getState().base?.underlay?.opacity === 50, { timeout: 8000 }); await sleep(400)
      await lp.evaluate(() => window.__fss.store.getState().setNotice(null))
      await lp.click('[aria-label="图层"]'); await lp.waitForSelector('[data-testid=underlay-opacity] input', { visible: true }); await sleep(250)
      const b = await (await lp.$('[data-testid=underlay-opacity] input')).boundingBox()
      await lp.mouse.click(b.x + b.width * .75, b.y + b.height / 2); await sleep(900)
      const o = await lp.evaluate(() => window.__fss.store.getState().base.underlay.opacity)
      assert(o !== 50, '滑块没动')
      await lp.evaluate(() => window.__fss.store.getState().setPanel(null)); await sleep(200)
      // 同名文件会被覆盖（前面的步骤导出过同一个方案）：看修改时间，不看文件名
      const t0 = Date.now() - 50
      await lp.click('[data-testid=file-menu]'); await sleep(300); await lp.click('[data-testid=menu-export]'); await sleep(1500)
      const dl = fs.readdirSync(downloads).find(x => x.endsWith('.json') && fs.statSync(path.join(downloads, x)).mtimeMs >= t0)
      assert(dl && JSON.parse(fs.readFileSync(path.join(downloads, dl), 'utf8')).underlay.opacity === o, `导出没带上：${dl}`)
      await lp.goto(URL0, { waitUntil: 'load' }); await lp.waitForFunction(() => !!window.__fss?.store.getState().base, { timeout: 10000 })
      const back = await lp.evaluate(() => window.__fss.store.getState().base.underlay.opacity)
      assert(back === o, `刷新后 ${back}，应该是 ${o}`)
      await lp.close()
      return `导出、刷新都是 ${o}`
    })
  } finally {
    A.srv.kill()
    fs.rmSync(A.dir, { recursive: true, force: true })
  }
} finally {
  await browser.close()
}
fs.writeFileSync(path.join(out, 'e2e-decor-result.json'), JSON.stringify({ results, errors, external }, null, 2))
const bad = results.filter(r => !r.ok)
console.log(`\n${results.length - bad.length}/${results.length} 通过`)
process.exit(bad.length ? 1 : 0)
