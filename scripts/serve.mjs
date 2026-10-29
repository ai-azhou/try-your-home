// 本地服务模式：node scripts/serve.mjs <方案所在目录> [端口]
// 只监听 127.0.0.1；/ 返回 dist/index.html，其它路径返回方案目录下的文件（不能跳出目录）。
// 文件带 ETag（大小 + 修改时间），页面每 2 秒用 If-None-Match 查一次，Agent 改了文件就刷新。
// 响应头 X-Plan-Root 给出方案目录的绝对路径，页面据此把方案文件的完整路径写进交接文字。
// POST /save?plan=<文件>（S2a）：页面「保存」写回方案文件。只许写方案目录里已存在的 .json，
// 先写同目录临时文件再改名（原子替换，Agent 不会读到半个文件）；只认本机页面发来的 JSON。
import { parsePlanText, serializePlan } from '../src/core/io.ts'
import { isEmptyPlan, loadError } from '../src/core/persistence.ts'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const [dirArg, portArg] = process.argv.slice(2)
if (!dirArg) {
  console.error('用法：node scripts/serve.mjs <方案所在目录> [端口]')
  process.exit(1)
}
const root = fs.realpathSync(path.resolve(dirArg))
const port = Number(portArg ?? 5180)
const app = path.resolve(import.meta.dirname, '..')
const indexFile = path.join(app, 'dist', 'index.html')
if (!fs.existsSync(indexFile)) {
  console.error('没有 dist/index.html：先运行 npm run build')
  process.exit(1)
}

const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif' }

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers })
  res.end(body)
}

/** 方案目录里的文件；跳出目录（../、符号链接指出去）一律 403 */
function resolveInRoot(urlPath) {
  let rel
  try { rel = decodeURIComponent(urlPath) } catch { return null }
  if (rel.includes('\0')) return null
  const abs = path.resolve(root, '.' + path.posix.normalize('/' + rel))
  if (abs !== root && !abs.startsWith(root + path.sep)) return null
  if (!fs.existsSync(abs)) return abs
  const real = fs.realpathSync(abs)
  if (real !== root && !real.startsWith(root + path.sep)) return null
  return real
}

const MAX_BODY = 64 * 1024 * 1024
const etagOf = st => `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`

/** 写回：校验路径和来源 → 读完请求体 → 必须是 v2/v3 方案 JSON → 临时文件 + fsync + rename */
function save(req, res, url) {
  // 只认本服务自己的页面：Host 必须是本机这个端口；带 Origin 时也必须同源。
  // Content-Type 必须是 application/json：别的网站发不了「简单请求」，预检又没有 CORS 头，浏览器会拦下
  const host = req.headers.host ?? ''
  const okHosts = [`127.0.0.1:${port}`, `localhost:${port}`]
  if (!okHosts.includes(host)) return send(res, 403, 'forbidden host')
  const origin = req.headers.origin
  if (origin && !okHosts.some(h => origin === `http://${h}`)) return send(res, 403, 'forbidden origin')
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return send(res, 415, 'json only')
  const rel = url.searchParams.get('plan') ?? ''
  if (!rel.toLowerCase().endsWith('.json')) return send(res, 400, 'plan must be a .json file')
  const file = resolveInRoot(rel.startsWith('/') ? rel : '/' + rel)
  if (!file) return send(res, 403, 'forbidden')
  let st
  try { st = fs.statSync(file) } catch { return send(res, 404, 'plan file not found (only existing files can be saved)') }
  if (!st.isFile()) return send(res, 404, 'not a file')
  const chunks = []
  let size = 0, aborted = false
  req.on('data', c => { size += c.length; if (size > MAX_BODY) { aborted = true; send(res, 413, 'too large'); req.destroy() } else chunks.push(c) })
  req.on('end', () => {
    if (aborted) return
    const body = Buffer.concat(chunks).toString('utf8')
    const parsed = parsePlanText(body)
    const error = loadError(parsed.issues)
    if (error || !/^\s*\{/.test(body)) return send(res, 400, `拒绝保存：${error ?? 'invalid plan json'}`)
    // Re-read immediately before the atomic replacement; never trust the parser's empty fallback.
    try {
      const current = fs.statSync(file)
      if (req.headers['if-match'] && req.headers['if-match'] !== etagOf(current)) return send(res, 409, '文件已变化，拒绝覆盖；请重新载入后保存。')
      const oldText = fs.readFileSync(file, 'utf8'), old = parsePlanText(oldText)
      if (isEmptyPlan(parsed.plan) && (loadError(old.issues) || !isEmptyPlan(old.plan))) return send(res, 400, '拒绝保存空方案：旧文件含有数据或无法完整读取，原文件保持不变。')
    } catch (e) { return send(res, 400, `拒绝保存：无法核对原文件：${e.message}`) }
    const stored = serializePlan(parsed.plan)
    const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`)
    try {
      const fd = fs.openSync(tmp, 'wx', st.mode & 0o777)
      try { fs.writeFileSync(fd, stored); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
      fs.renameSync(tmp, file)
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }) } catch {}
      return send(res, 500, `write failed: ${e.message}`)
    }
    const after = fs.statSync(file)
    console.log(`已保存 ${path.relative(root, file)}（${after.size} 字节）`)
    send(res, 200, JSON.stringify({ ok: true, size: after.size }), { ETag: etagOf(after), 'Content-Type': types['.json'] })
  })
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  if (req.method === 'POST' && url.pathname === '/save') return save(req, res, url)
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed')
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return send(res, 200, req.method === 'HEAD' ? '' : fs.readFileSync(indexFile), { 'Content-Type': types['.html'] })
  }
  const file = resolveInRoot(url.pathname)
  if (!file) return send(res, 403, 'forbidden')
  let st
  try { st = fs.statSync(file) } catch { return send(res, 404, 'not found') }
  if (!st.isFile()) return send(res, 404, 'not found')
  const etag = etagOf(st)
  const headers = { ETag: etag, 'Content-Type': types[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'X-Plan-Root': encodeURIComponent(root) }
  if (req.headers['if-none-match'] === etag) return send(res, 304, '', headers)
  send(res, 200, req.method === 'HEAD' ? '' : fs.readFileSync(file), headers)
})

server.listen(port, '127.0.0.1', () => {
  const plans = fs.readdirSync(root).filter(f => f.toLowerCase().endsWith('.json'))
  console.log(`方案目录：${root}`)
  if (!plans.length) console.log(`打开：http://127.0.0.1:${port}/  （目录里还没有 .json 方案）`)
  for (const f of plans) console.log(`打开：http://127.0.0.1:${port}/?plan=${encodeURIComponent(f)}`)
})
const stop = () => server.close(() => process.exit(0))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
