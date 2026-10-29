// 截图：node scripts/shot.mjs <url> <输出.png> [宽 高] [--wait 毫秒] [--eval "js"]
// 用本机 Chrome 无头模式（WebGL 走 SwiftShader）。只启动自己的浏览器实例，结束时自己关闭。
import puppeteer from 'puppeteer-core'
import { chromePath } from './browser-path.mjs'
import path from 'node:path'
import fs from 'node:fs'

const [url, out, w = '1440', h = '900', ...rest] = process.argv.slice(2)
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d }
const root = path.resolve(import.meta.dirname, '..')
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true })
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  userDataDir: path.join(root, '.shots/.chrome'),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
})
try {
  const page = await browser.newPage()
  await page.setViewport({ width: +w, height: +h, deviceScaleFactor: +(process.env.DSF || 2) })
  const logs = []
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`))
  page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`))
  page.on('request', r => { const u = r.url(); if (!/^(http:\/\/(127\.0\.0\.1|localhost)|data:|blob:|file:)/.test(u)) logs.push(`[EXTERNAL REQUEST] ${u}`) })
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 })
  const js = opt('--eval')
  if (js) await page.evaluate(js)
  await new Promise(r => setTimeout(r, +opt('--wait', '1500')))
  await page.screenshot({ path: out })
  if (logs.length) console.log(logs.join('\n'))
  console.log('saved', out)
} finally {
  await browser.close()
}
