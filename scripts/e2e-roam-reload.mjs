// 漫游时 Agent 改了方案文件：node scripts/e2e-roam-reload.mjs   （先 npm run build；CHROME_PATH 指向本机 Chrome）
// 手册工具连接 4.2 写着「自动重新载入，视角保持不变」：起 scripts/serve.mjs（记 PID，结束时只 kill 这个 PID），
// 按手册 4.3 原子写改文件，人应该还在漫游里、站在原地，方案已经是新的；用户自己打开别的方案才退出。只用虚构示例 fixtures/agent-decor.json。
import puppeteer from 'puppeteer-core'
import { chromePath } from './browser-path.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roam-reload-')), file = path.join(dir, '方案.json')
fs.copyFileSync(path.join(root, 'fixtures/agent-decor.json'), file)
const PORT = 5187, sleep = ms => new Promise(r => setTimeout(r, ms))
const server = spawn(process.execPath, ['scripts/serve.mjs', dir, String(PORT)], { cwd: root, stdio: 'pipe' })
await new Promise((res, rej) => { server.stdout.on('data', c => { if (String(c).includes('打开')) res() }); server.once('exit', c => rej(Error('serve exit ' + c))); setTimeout(() => rej(Error('serve timeout')), 15000) })
const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--window-size=1440,900'] })
let failed = 0
const check = (ok, msg) => { console.log(ok ? '  ok' : 'FAIL', msg); if (!ok) failed++ }
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900 })
  const errors = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto(`http://127.0.0.1:${PORT}/?plan=${encodeURIComponent('方案.json')}&mode=decor&view=3d&cam=roam`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.__roam && !window.__roam.pose().intro, { timeout: 30000 })
  await sleep(300)
  const a = await page.evaluate(() => { const p = window.__roam.pose(); window.__roam.place(p.x + 0.1, p.z, p.yaw + 0.3, 0); return window.__roam.pose() })
  await sleep(200)
  // 手册 4.3：写临时文件再改名
  const plan = JSON.parse(fs.readFileSync(file, 'utf8')); plan.title = 'Agent 改过的标题'
  fs.writeFileSync(file + '.tmp', JSON.stringify(plan, null, 2)); fs.renameSync(file + '.tmp', file)
  await page.waitForFunction(() => window.__fss.store.getState().base?.title === 'Agent 改过的标题', { timeout: 15000 })
  await sleep(500)
  const s = await page.evaluate(() => { const st = window.__fss.store.getState(); return { roam: !!window.__roam, mode: st.mode, main: st.main, hud: !!document.querySelector('[data-testid=roam-hud]') } })
  check(s.roam && s.hud, `Agent 改文件后还在漫游里（${JSON.stringify(s)}）`)
  check(s.mode === 'decor' && s.main === '3d', '模式和主画布不变')
  if (s.roam) {
    const b = await page.evaluate(() => window.__roam.pose())
    check(Math.abs(b.x - (a.x)) < 0.01 && Math.abs(b.yaw - a.yaw) < 0.01, '还站在原地、朝向不变')
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !window.__roam, { timeout: 5000 })
    check(true, 'Esc 还能退出')
  }
  check(!errors.length, `页面零报错 ${errors.slice(0, 2).join(' | ')}`)
  // 用户自己换方案（不是自动刷新）：应该退出
  await page.keyboard.press('0'); await page.waitForFunction(() => window.__roam, { timeout: 10000 })
  await page.evaluate(() => { const s = window.__fss.store.getState(); s.loadPlan(s.base, { kind: 'file' }) })
  await sleep(300)
  check(await page.evaluate(() => !window.__roam), '用户重新打开方案：退出漫游')
} finally {
  await browser.close()
  server.kill()
  fs.rmSync(dir, { recursive: true, force: true })
}
console.log(failed ? `\n失败 ${failed} 项` : '\n全部通过')
process.exit(failed ? 1 : 0)
