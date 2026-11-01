// 房间名开关和 3D 漫游 e2e：node scripts/e2e-roam.mjs   （先 npm run build:fast；CHROME_PATH 指向本机 Chrome）
// 用真实鼠标键盘：装修态切房间名（开关、L）；进漫游（按钮、0），转头、走路、撞墙、过门、改视角宽度和平视高度、点地面走过去、点画中画跳过去、退出后恢复。
// 全程零报错、零外部请求。截图在 .shots/roam/。只用公开示例数据；E2E_PLAN 可以指向别的方案文件再多跑一遍看图（不写回）。
import puppeteer from 'puppeteer-core'
import { chromePath } from './browser-path.mjs'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, process.env.E2E_OUT ?? '.shots/roam')
const profile = path.join(out, '.chrome')
fs.rmSync(profile, { recursive: true, force: true }); fs.mkdirSync(profile, { recursive: true })
const html = path.resolve(process.env.E2E_HTML ?? path.join(root, 'dist/index.html'))
if (!fs.existsSync(html)) { console.error(`没有 ${html}：先运行 npm run build:fast`); process.exit(1) }
const URL0 = `file://${html}`, W = 1440, H = 900
const sleep = ms => new Promise(r => setTimeout(r, ms))
const errors = [], external = [], results = []
const assert = (c, msg) => { if (!c) throw new Error(msg) }
const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}：${a} 不接近 ${b}`)

const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, userDataDir: profile,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--window-size=${W},${H}`] })
async function open(query, w = W, h = H) {
  const page = await browser.newPage()
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 })
  page.on('console', m => { if (m.type() === 'error') errors.push(`[console] ${m.text()}`) })
  page.on('pageerror', e => errors.push(`[pageerror] ${e.message}`))
  page.on('request', r => { const u = r.url(); if (!/^(file:|data:|blob:)/.test(u)) external.push(u) })
  await page.goto(`${URL0}?${query}`, { waitUntil: 'load', timeout: 60000 })
  await page.waitForFunction(() => window.__fss?.store.getState().base, { timeout: 30000 })
  return page
}
const until = (page, fn, arg, timeout = 30000) => page.waitForFunction(fn, { timeout, polling: 100 }, arg)
const pose = page => page.evaluate(() => window.__roam?.pose())
const on = page => page.evaluate(() => !!window.__roam)
const settled = page => until(page, () => { const p = window.__roam?.pose(); return p && !p.intro && !p.glide })
const shot = (page, name) => page.screenshot({ path: path.join(out, name + '.png') })
const step = async (name, fn) => { try { await fn(); results.push(['ok', name]); console.log('  ok', name) } catch (e) { results.push(['FAIL', name, e.message]); console.log('FAIL', name, e.message) } }
async function hold(page, key, ms) { await page.keyboard.down(key); await sleep(ms); await page.keyboard.up(key) }
const click = (page, id) => page.click(`[data-testid="${id}"]`)
const labels = page => page.evaluate(() => [...document.querySelectorAll('[data-canvas="main"] svg text')].map(t => t.textContent).filter(t => /客厅|卧/.test(t)).length)

/* ───────── 房间名 ───────── */
{
  const page = await open('mode=decor')
  await sleep(800)
  await page.keyboard.press('Escape'); await sleep(300) // 收起第一次进装修的风格卡
  await step('装修态默认显示房间名', async () => assert(await labels(page) > 0, '画布上没有房间名'))
  const dirty0 = await page.evaluate(() => JSON.stringify(window.__fss.store.getState().base.rooms))
  await step('L 关掉、再按打开', async () => {
    await page.keyboard.press('l'); await sleep(200)
    assert(await labels(page) === 0, '按 L 后房间名还在')
    await shot(page, '房间名-关')
    await page.keyboard.press('l'); await sleep(200)
    assert(await labels(page) > 0, '再按 L 没回来')
    await shot(page, '房间名-开')
  })
  await step('「显示」弹窗里的开关', async () => {
    await page.evaluate(() => window.__fss.store.getState().setPanel('layers')); await sleep(300)
    assert(await page.$('[data-testid="layer-room-names"]'), '弹窗里没有房间名这一行')
    await shot(page, '房间名-显示弹窗')
    await page.click('[data-testid="layer-room-names"] [role="switch"]'); await sleep(200)
    assert(await labels(page) === 0, '关开关后房间名还在')
    await page.click('[data-testid="layer-room-names"] [role="switch"]'); await sleep(200)
    assert(await labels(page) > 0, '开开关后没回来')
    await page.evaluate(() => window.__fss.store.getState().setPanel(null))
  })
  await step('不写进方案、不算改动', async () => {
    const { rooms, dirty } = await page.evaluate(() => { const s = window.__fss.store.getState(); return { rooms: JSON.stringify(s.base.rooms), dirty: s.dirty } })
    assert(rooms === dirty0, '方案变了'); assert(!/roomNames/.test(await page.evaluate(() => window.__fss.serialize(window.__fss.store.getState().base))), '写进了方案')
    void dirty
  })
  await step('别的模式不受影响，也没有这一格', async () => {
    await page.keyboard.press('l'); await sleep(100)
    await page.keyboard.press('1'); await sleep(500)
    assert(await labels(page) > 0, '原始模式房间名被关了')
    await page.evaluate(() => window.__fss.store.getState().setPanel('layers')); await sleep(300)
    assert(!await page.$('[data-testid="layer-room-names"]'), '原始模式出现了开关')
    await page.evaluate(() => window.__fss.store.getState().setPanel(null))
  })
  await page.close()
}

/* ───────── 漫游 ───────── */
async function roamFlow(page, tag) {
  await step(`${tag}按钮进漫游：界面让开，相机到人眼`, async () => {
    await click(page, 'cam-roam')
    await until(page, () => window.__roam); await settled(page)
    assert(await page.$('[data-testid="roam-hud"]'), '没有设置卡')
    assert(!await page.$('[data-testid="mode-decor"]'), '顶栏没让开')
    const p = await pose(page), s = await page.evaluate(() => window.__fss.store.getState().main)
    assert(s === '3d', '主画布不是 3D')
    near(p.y, 1.45, 0.08, '默认平视高度')
    near(p.hFov, 90, 1.5, '默认视角宽度')
    await shot(page, `${tag}漫游-默认`)
  })
  await step(`${tag}视角宽度：三档和滑块都生效，相机真的变了`, async () => {
    for (const n of [60, 120, 90]) {
      await click(page, `roam-fov-${n}`)
      await until(page, n => Math.abs(window.__roam.pose().hFov - n) < 1, n)
      if (n !== 90) await shot(page, `${tag}漫游-视角${n}`)
    }
    const b = await (await page.$('[data-testid="roam-fov"] input')).boundingBox()
    await page.mouse.click(b.x + b.width * 0.25, b.y + b.height / 2)
    await until(page, () => Math.abs(window.__roam.pose().hFov - 60) < 2)
    await click(page, 'roam-fov-90')
    await until(page, () => Math.abs(window.__roam.pose().hFov - 90) < 1)
  })
  await step(`${tag}平视高度：坐着 / 站着 / 高个和滑块`, async () => {
    for (const [id, m] of [['roam-eye-115', 1.15], ['roam-eye-165', 1.65], ['roam-eye-145', 1.45]]) {
      await click(page, id)
      await until(page, m => Math.abs(window.__roam.pose().y - m) < 0.04, m)
      if (m === 1.15) await shot(page, `${tag}漫游-坐着`)
    }
    const b = await (await page.$('[data-testid="roam-eye"] input')).boundingBox()
    await page.mouse.click(b.x + b.width * 0.5, b.y + b.height / 2)
    await until(page, () => Math.abs(window.__roam.pose().y - 1.3) < 0.1)
    assert(await page.evaluate(() => document.activeElement === document.body), '滑块松手后焦点没还给页面，WASD 会被吃掉')
    // 键盘调滑块：焦点留着，能连续按
    await page.focus('[data-testid="roam-eye"] input')
    const v0 = await page.$eval('[data-testid="roam-eye"] input', e => +e.value)
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await sleep(60)
    assert(await page.$eval('[data-testid="roam-eye"] input', e => +e.value) === v0 + 2, '键盘连按滑块没生效')
    await page.evaluate(() => document.activeElement?.blur())
    await click(page, 'roam-eye-145')
    await until(page, () => Math.abs(window.__roam.pose().y - 1.45) < 0.04)
  })
  await step(`${tag}拖动转头：向右拖，画面跟手（朝左转），松手不走路`, async () => {
    const a = await pose(page)
    await page.mouse.move(W / 2, H / 2); await page.mouse.down(); await page.mouse.move(W / 2 + 200, H / 2 - 40, { steps: 5 }); await page.mouse.up()
    await sleep(150)
    const b = await pose(page)
    near(b.yaw - a.yaw, 200 / W * Math.PI / 2, 0.03, '水平转头')
    assert(b.pitch < a.pitch, '向上拖应该低头')
    near(b.x, a.x, 0.001, '拖动不该走路')
    await page.evaluate(([y]) => { const p = window.__roam.pose(); window.__roam.place(p.x, p.z, y, 0) }, [a.yaw])
  })
  await step(`${tag}WASD 真的走、方向键转头、滚轮前后`, async () => {
    const a = await pose(page)
    await hold(page, 'w', 500)
    const b = await pose(page), moved = Math.hypot(b.x - a.x, b.z - a.z)
    if (moved > 0.02) { const dot = ((b.x - a.x) * -Math.sin(a.yaw) + (b.z - a.z) * -Math.cos(a.yaw)) / moved; assert(dot > 0.5, 'W 没有朝前走') }
    await hold(page, 's', 500)
    const c = await pose(page)
    assert(moved > 0.02 || Math.hypot(c.x - b.x, c.z - b.z) > 0.02, 'WS 都没动')
    await hold(page, 'ArrowLeft', 300)
    const d = await pose(page)
    assert(d.yaw > c.yaw, '← 应该朝左转')
    await page.mouse.move(W / 2, H / 3); await page.mouse.wheel({ deltaY: -300 }); await sleep(700)
    const e = await pose(page); await page.mouse.wheel({ deltaY: 300 }); await sleep(700)
    const f = await pose(page)
    assert(Math.hypot(e.x - d.x, e.z - d.z) > 0.02 || Math.hypot(f.x - e.x, f.z - e.z) > 0.02, '滚轮没走')
    await page.evaluate(([y]) => { const p = window.__roam.pose(); window.__roam.place(p.x, p.z, y, 0) }, [a.yaw])
  })
  await step(`${tag}点地面走过去，还能走回来`, async () => {
    const p0 = await pose(page)
    await page.evaluate(() => { const p = window.__roam.pose(); window.__roam.place(p.x, p.z, p.yaw, -0.45) }); await sleep(200)
    await page.mouse.click(W / 2 - 100, H * 0.72)
    await sleep(150)
    await settled(page)
    const a = await pose(page)
    assert(Math.hypot(a.x - p0.x, a.z - p0.z) > 0.2, '点地面没走')
    assert(a.y > 1.2 && a.y < 2, '走完高度不对')
    await page.evaluate(() => { const p = window.__roam.pose(); window.__roam.place(p.x, p.z, p.yaw, 0) })
  })
  await step(`${tag}点画中画平面跳到别处；画中画上有站位`, async () => {
    const el = await page.$('[data-canvas="mini"]'), b = await el.boundingBox(), a = await pose(page)
    assert(await page.$eval('[data-testid="roam-marker"]', e => e.style.display !== 'none'), '站位标记没显示')
    await page.mouse.click(b.x + b.width * 0.3, b.y + b.height * 0.55); await sleep(150); await settled(page)
    const c = await pose(page)
    assert(Math.hypot(c.x - a.x, c.z - a.z) > 0.2, '点画中画没跳过去')
    // 点到墙上也一样：不选中构件（平时画中画点一下是选中）
    const w0 = await page.evaluate(() => { const w = window.__fss.getView().plan.walls[0]; return [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2] })
    const px = await page.evaluate(([x, y]) => { const svg = document.querySelector('[data-canvas="mini"] svg g[transform]'), m = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)/.exec(svg.getAttribute('transform')); return [+m[1] + x * +m[3], +m[2] + y * +m[3]] }, w0)
    await page.mouse.click(b.x + px[0], b.y + px[1]); await sleep(150); await settled(page)
    assert(await page.evaluate(() => window.__fss.store.getState().sel.length === 0), '点画中画不该选中构件')
    assert(await on(page), '点画中画不该退出漫游')
    await page.mouse.click(b.x + b.width * 0.3, b.y + b.height * 0.55); await sleep(150); await settled(page)
    await shot(page, `${tag}漫游-画中画跳转后`)
  })
  await step(`${tag}工具快捷键不响应（漫游只看不改），改动不会被记`, async () => {
    const a = await page.evaluate(() => { const s = window.__fss.store.getState(); return [s.mode, s.tool, s.agentOpen] })
    for (const k of ['2', 'a', 'v', 'Backspace', 'q']) await page.keyboard.press(k)
    const b = await page.evaluate(() => { const s = window.__fss.store.getState(); return [s.mode, s.tool, s.agentOpen] })
    assert(JSON.stringify(a) === JSON.stringify(b), `状态变了 ${a} → ${b}`)
    assert(await on(page), '不该退出漫游')
  })
  await step(`${tag}Esc 退出：界面回来，相机回模型视角，点选恢复`, async () => {
    await page.keyboard.press('Escape')
    await until(page, () => !window.__roam)
    assert(await page.$('[data-testid="mode-decor"]'), '顶栏没回来')
    assert(!await page.$('[data-testid="roam-hud"]'), '设置卡没收')
    await sleep(2500)
    await shot(page, `${tag}退出后`)
    const cam = await page.evaluate(() => window.__cam3d())
    assert(cam.el > 20, `相机没回到斜视，仰角 ${cam.el}`)
  })
  await step(`${tag}再进来站在原地；切视角退出`, async () => {
    await page.keyboard.press('0')
    await until(page, () => window.__roam); await settled(page)
    await page.keyboard.press('8')
    await until(page, () => !window.__roam)
  })
}
{
  const page = await open('view=3d')
  await sleep(1500)
  await roamFlow(page, '结构-')
  await step('结构-撞墙不穿，门洞过得去（用实体直接核对）', async () => {
    await page.keyboard.press('0'); await until(page, () => window.__roam); await settled(page)
    const q = await page.evaluate(() => {
      const plan = window.__fss.getView().plan, o = plan.openings.find(o => o.kind === 'door' || o.kind === 'doorway')
      const w = plan.walls.find(w => w.id === o.wall), L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L
      const mid = o.offset + o.width / 2, cx = w.a[0] + ux * mid, cy = w.a[1] + uy * mid
      return { door: [cx / 1000, cy / 1000], n: [-uy, ux], t: w.thickness / 1000 }
    })
    // 对着门走：能穿过去
    const side = 0.6 + q.t / 2, sx = q.door[0] + q.n[0] * side, sz = q.door[1] + q.n[1] * side
    await page.evaluate(([x, z, y]) => window.__roam.place(x, z, y, 0), [sx, sz, Math.atan2(q.n[0], q.n[1])])
    await sleep(100)
    await hold(page, 'w', 2500)
    const a = await pose(page)
    const along = (a.x - q.door[0]) * q.n[0] + (a.z - q.door[1]) * q.n[1]
    assert(along < -q.t / 2, `没穿过门洞，停在 ${along}`)
    // 对着没有门窗的墙走：停在墙跟前，穿不过去
    const wq = await page.evaluate(() => {
      const plan = window.__fss.getView().plan, inside = (p, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i][1] > p[1]) !== (poly[j][1] > p[1]) && p[0] < (poly[j][0] - poly[i][0]) * (p[1] - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c; return c }
      for (const w of plan.walls) {
        const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
        if (w.bulge || L < 2000 || plan.openings.some(o => o.wall === w.id)) continue
        const ux = (w.b[0] - w.a[0]) / L, uy = (w.b[1] - w.a[1]) / L, mx = (w.a[0] + w.b[0]) / 2, my = (w.a[1] + w.b[1]) / 2
        for (const s of [1, -1]) { const n = [-uy * s, ux * s], off = w.thickness / 2 + 900, p = [mx + n[0] * off, my + n[1] * off]; if (plan.rooms.some(r => inside(p, r.poly))) return { mid: [mx / 1000, my / 1000], n, t: w.thickness / 1000, p: [p[0] / 1000, p[1] / 1000] } }
      }
      return null
    })
    assert(wq, '示例里没找到合适的墙')
    await page.evaluate(([x, z, y]) => window.__roam.place(x, z, y, 0), [wq.p[0], wq.p[1], Math.atan2(wq.n[0], wq.n[1])])
    await sleep(100)
    await hold(page, 'w', 2500)
    const c = await pose(page), dist = (c.x - wq.mid[0]) * wq.n[0] + (c.z - wq.mid[1]) * wq.n[1]
    assert(dist >= wq.t / 2 + 0.15, `穿墙了，离墙心 ${dist}`)
    assert(dist < wq.t / 2 + 0.75, `根本没往前走，离墙心 ${dist}`)
    await page.keyboard.press('Escape'); await until(page, () => !window.__roam)
  })
  await page.close()
}
{
  const page = await open('view=3d')
  await sleep(800)
  await step('多层：换层后站到那一层、高度跟着变，顶面不盖挑空，退出不报错', async () => {
    const ok = await page.evaluate(() => {
      const s = window.__fss.store.getState(), p = structuredClone(s.base), up = 3.2
      const cp = (arr, f) => arr.map(x => ({ ...structuredClone(x), id: 'u-' + x.id, level: 'L2', ...f?.(x) }))
      const walls = cp(p.walls), rooms = cp(p.rooms), openings = p.openings.map(o => ({ ...structuredClone(o), id: 'u-' + o.id, wall: 'u-' + o.wall }))
      const r0 = p.rooms[0], cx = r0.poly.reduce((v, q) => v + q[0], 0) / r0.poly.length, cy = r0.poly.reduce((v, q) => v + q[1], 0) / r0.poly.length
      s.loadPlan({ ...p, changes: [], questions: [], decor: undefined, underlay: undefined, levels: [{ id: 'L1', name: '1F', elevation: 0 }, { id: 'L2', name: '2F', elevation: up }], walls: [...p.walls, ...walls], rooms: [...p.rooms, ...rooms], openings: [...p.openings, ...openings], beams: [], columns: [], shafts: [], stairs: [], voids: [{ id: 'v1', level: 'L2', poly: [[cx - 500, cy - 500], [cx + 500, cy - 500], [cx + 500, cy + 500], [cx - 500, cy + 500]] }] }, { kind: 'demo' })
      return !window.__fss.store.getState().loadFailure
    })
    assert(ok, '多层方案载入失败：' + await page.evaluate(() => window.__fss.store.getState().loadFailure))
    await page.evaluate(() => { const s = window.__fss.store.getState(); s.setMain('3d') }); await sleep(800)
    await page.keyboard.press('0'); await until(page, () => window.__roam); await settled(page)
    const a = await pose(page); near(a.y, 1.45, 0.08, '一层高度')
    assert(await page.$('[data-testid="level-L2"]'), '多层时设置卡上要能换层')
    await shot(page, '多层-一层')
    await page.click('[data-testid="level-L2"]')
    await until(page, () => Math.abs(window.__roam.pose().y - 4.65) < 0.1)
    await shot(page, '多层-二层')
    assert(await on(page), '换层不该退出漫游')
    await page.keyboard.press('Escape'); await until(page, () => !window.__roam)
  })
  await page.close()
}
{
  const page = await open('mode=decor&view=3d')
  await sleep(1500)
  await page.keyboard.press('Escape'); await sleep(300)
  await page.click('[data-testid="section-3d"]'); await sleep(300)
  await roamFlow(page, '装修-')
  await step('装修-剖开看进漫游时已关，平涂下吊顶、顶灯照常画', async () => {
    assert(await page.evaluate(() => !window.__decorUI().section3d), '剖切没关')
  })
  await page.close()
}
{
  const page = await open('view=3d', 390, 844)
  await sleep(1500)
  await step('手机：工具坞放得下漫游，进去后设置卡默认收起', async () => {
    const overflow = await page.evaluate(() => { const d = document.querySelector('[data-float].rounded-\\[26px\\]'); return d ? d.scrollWidth - d.clientWidth : 0 })
    assert(overflow <= 1, `工具坞溢出 ${overflow}px`)
    await shot(page, '手机-工具坞')
    await page.tap('[data-testid="cam-roam"]')
    await until(page, () => window.__roam); await settled(page)
    assert(await page.$('[data-testid="roam-summary"]'), '手机上应该默认收起')
    await shot(page, '手机-漫游收起')
    await page.tap('[data-testid="roam-collapse"]'); await sleep(250)
    await shot(page, '手机-漫游展开')
    await page.tap('[data-testid="roam-fov-120"]'); await sleep(800)
    const p = await pose(page)
    assert(p.hFov < 120 && p.vFov <= 110.5, `竖屏没封顶 h=${p.hFov} v=${p.vFov}`)
    assert(/竖屏放不下/.test(await page.$eval('[data-testid="roam-fov-note"]', e => e.textContent)), '竖屏封顶没有说明')
    await shot(page, '手机-漫游竖屏封顶')
    await page.tap('[data-testid="roam-exit"]')
    await until(page, () => !window.__roam)
  })
  await page.close()
}
{
  const page = await open('mode=decor&view=3d', 390, 844)
  await sleep(1500)
  await step('手机：装修态工具坞（8 格）放得下', async () => {
    const r = await page.evaluate(() => { const a = document.querySelector('[data-testid="cam-roam"]').getBoundingClientRect(), b = document.querySelector('[data-testid="shot-open"]').getBoundingClientRect(); return { left: a.left, right: b.right, w: innerWidth } })
    assert(r.right <= r.w && r.left >= 0, `工具坞出界 ${JSON.stringify(r)}`)
    await shot(page, '手机-装修工具坞')
  })
  await page.close()
}
await step('PNG 导出：漫游里能导，文件名带漫游', async () => {
  const page = await open('view=3d&cam=roam')
  const dl = path.join(out, 'downloads'); fs.rmSync(dl, { recursive: true, force: true }); fs.mkdirSync(dl, { recursive: true })
  const cdp = await page.createCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl })
  await until(page, () => window.__roam); await settled(page)
  await click(page, 'shot-open'); await sleep(300); await click(page, 'shot-go')
  for (let i = 0; i < 40 && !fs.readdirSync(dl).some(f => f.endsWith('.png')); i++) await sleep(250)
  const f = fs.readdirSync(dl).find(f => f.endsWith('.png'))
  assert(f && /漫游/.test(f), `文件名不对：${f}`)
  await page.close()
})
await browser.close()
const failed = results.filter(r => r[0] === 'FAIL')
console.log(`\n${results.length - failed.length}/${results.length} 通过；报错 ${errors.length}；外部请求 ${external.length}`)
errors.slice(0, 12).forEach(e => console.log(e)); external.slice(0, 5).forEach(e => console.log('EXTERNAL', e))
process.exit(failed.length || errors.length || external.length ? 1 : 0)
