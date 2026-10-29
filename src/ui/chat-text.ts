/**
 * 网页 Chat 流程（T2）：从 Chat 回复里抠出方案 JSON、生成「复制问题给 Chat」「复制方案给 Chat」的文字。
 * 纯函数（只依赖 core），vitest 直接测（chat-text.test.ts）。界面在 panels/ChatSheet.tsx。
 *
 * 文字一律中文、长度 mm（和格式 v3、交接文字一致）；运行时方案里的高度是米，写出去时换成 mm。
 */
import type { Plan, Wall, Opening, Room } from '@/core/types'
import type { Issue } from '@/core/validate'
import { parsePlanText, serializePlan, agentUnits } from '@/core/io'
import { isEmptyPlan, loadError } from '@/core/persistence'
import { applyChanges } from '@/core/changes'
import { polygonArea, wallLength, effectiveWallHeight } from '@/core/geometry'
import { levelsOf } from '@/core/levels'
import { diagnoseShape, isSimplePlan, simpleFormatChatText, SIMPLE_RULES, SIMPLE_TEMPLATE } from '@/core/simple'

/* ───────── 1. 从粘贴的文字里找 JSON ───────── */

export type Extracted =
  | { kind: 'ok'; json: string; repaired: boolean }
  /** 括号没配完 / 字符串没收尾就到头了：多半是 Chat 回复被截断。at = 从 JSON 的「{」起数，第几个字符附近断的 */
  | { kind: 'incomplete'; json: string; at: number }
  /** 括号配完了但不是合法 JSON（多半是写错了格式）；at 同上 */
  | { kind: 'syntax'; json: string; at: number; detail: string }
  | { kind: 'none' }

interface Block { body: string; closed: boolean }
/** 按行找 ``` / ~~~ 代码块；最后一个没收尾的块一直算到文末（被截断时常见） */
function fencedBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let cur: string[] | null = null, fence = ''
  for (const line of text.split('\n')) {
    const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(line)
    if (cur === null) {
      if (!m) continue
      // 一行里开头结尾都是 ```：```json {...} ```
      const rest = m[2], close = rest.lastIndexOf(m[1])
      if (close > 0 && rest.slice(close).trim() === m[1]) { blocks.push({ body: rest.slice(0, close).replace(/^[\w-]*\s/, ''), closed: true }); continue }
      cur = []; fence = m[1][0]
      // ```json { 同一行就开始的内容
      const after = rest.replace(/^[\w-]*/, '')
      if (after.trim()) cur.push(after)
    } else if (m && m[1][0] === fence && !m[2].trim()) { blocks.push({ body: cur.join('\n'), closed: true }); cur = null }
    else cur.push(line)
  }
  if (cur) blocks.push({ body: cur.join('\n'), closed: false })
  return blocks
}

type Scan = { ok: true; end: number } | { ok: false; end: -1; at: number; detail?: undefined } | { ok: false; end: -2; at: number; detail: string }
/** 从 s[i] 的「{」开始配括号（跳过字符串里的括号）。end = 收尾「}」之后的位置 */
function scanObject(s: string, i: number): Scan {
  const stack: string[] = []
  let inStr = false, esc = false
  for (let k = i; k < s.length; k++) {
    const c = s[k]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{' || c === '[') stack.push(c)
    else if (c === '}' || c === ']') {
      const open = stack.pop()
      if (open !== (c === '}' ? '{' : '[')) return { ok: false, end: -2, at: k - i + 1, detail: `第 ${k - i + 1} 个字符的「${c}」和前面的括号对不上` }
      if (!stack.length) return { ok: true, end: k + 1 }
    }
  }
  return { ok: false, end: -1, at: s.slice(i).trimEnd().length }
}

/** 宽松修一下 Chat 常见的小毛病：// 和 /* *\/ 注释、结尾多余的逗号（只在字符串外面动） */
function relax(json: string): string {
  let out = '', inStr = false, esc = false
  for (let k = 0; k < json.length; k++) {
    const c = json[k]
    if (inStr) { out += c; if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue }
    if (c === '"') { inStr = true; out += c; continue }
    if (c === '/' && json[k + 1] === '/') { while (k < json.length && json[k] !== '\n') k++; out += '\n'; continue }
    if (c === '/' && json[k + 1] === '*') { const e = json.indexOf('*/', k + 2); k = e < 0 ? json.length : e + 1; continue }
    out += c
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

function syntaxAt(e: unknown, json: string): { at: number; detail: string } {
  const msg = e instanceof Error ? e.message : String(e)
  const pos = /position (\d+)/.exec(msg)
  const lc = /line (\d+) column (\d+)/.exec(msg)
  let at = pos ? Number(pos[1]) + 1 : 0
  if (!pos && lc) { const lines = json.split('\n'); at = lines.slice(0, Number(lc[1]) - 1).reduce((n, l) => n + l.length + 1, 0) + Number(lc[2]) }
  return { at: at || 1, detail: msg }
}

/**
 * 在一段 Chat 回复里找方案 JSON：去掉代码块标记和前后说明；有多个代码块时取最大的那个（方案最长）。
 * 没有代码块时在整段文字里找最大的一个 {…}（说明文字里的小括号片段不算）。
 */
export function extractPlanJson(raw: string): Extracted {
  const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const blocks = fencedBlocks(text).filter(b => b.body.includes('{'))
  const region = blocks.length ? blocks.reduce((a, b) => (b.body.length > a.body.length ? b : a)).body : text
  // 逐个 { 扫过去，取最大的完整对象；最后一个没配完、又比完整的都大 → 截断
  let best: { json: string } | null = null, broken: { json: string; at: number } | null = null, bad: { json: string; at: number; detail: string } | null = null
  for (let i = region.indexOf('{'); i >= 0; ) {
    const r = scanObject(region, i)
    if (!r.ok && r.end === -1) { broken = { json: region.slice(i).trimEnd(), at: r.at }; break }
    if (!r.ok) { bad = bad ?? { json: region.slice(i), at: r.at, detail: r.detail ?? '' }; i = region.indexOf('{', i + 1); continue }
    const json = region.slice(i, r.end)
    if (!best || json.length > best.json.length) best = { json }
    i = region.indexOf('{', r.end)
  }
  if (broken && (!best || broken.json.length > best.json.length)) return { kind: 'incomplete', json: broken.json, at: broken.at }
  // 外层括号对不上时，里面的小对象（某面墙）也能配平；不能拿它当方案
  if (bad && (!best || bad.at > best.json.length)) return { kind: 'syntax', ...bad }
  if (!best) return { kind: 'none' }
  try { JSON.parse(best.json); return { kind: 'ok', json: best.json, repaired: false } } catch (e) {
    const relaxed = relax(best.json)
    try { JSON.parse(relaxed); return { kind: 'ok', json: relaxed, repaired: true } } catch { /* 修不好，报原文的位置 */ }
    return { kind: 'syntax', json: best.json, ...syntaxAt(e, best.json) }
  }
}

/** 截断时复制给 Chat 的那一句 */
export const truncatedChatText = (at: number) => `你上次输出的方案 JSON 不完整（在第 ${at} 个字符附近断了），请重新输出完整的 JSON，只输出一个代码块`

/* ───────── 2. 解析 + 校验（core parsePlanText 那一套，不碰界面状态） ───────── */

export interface PasteResult {
  extracted: Extracted
  /** core 解析结果；只有找到完整 JSON 时才有 */
  parsed?: ReturnType<typeof parsePlanText>
  /** 挡住载入的原因：core loadError 的文字，或 'none' / 'incomplete' / 'syntax' / 'empty'（解析出来是空方案）/ 'shape'（格式根本不对）；null = 可以载入 */
  fatal: string | null
  /** 原始 JSON 值（v3，mm）：格式错误时 parsed.plan 是空方案，靠它找字段路径对应的构件 id、算房间面积 */
  raw?: unknown
  /** D7：粘的是简版格式（网页 Chat 专用：只有房间和门，墙和门洞由 core 自动生成） */
  simple?: boolean
  /** D7：格式根本不对（core diagnoseShape）时的短句原因；有它就不载入、不列字段错误，改给 Chat 简版模板 */
  shape?: string[]
}
export function analysePaste(text: string): PasteResult {
  const extracted = extractPlanJson(text)
  if (extracted.kind !== 'ok') return { extracted, fatal: extracted.kind === 'none' ? 'none' : extracted.kind }
  const parsed = parsePlanText(extracted.json)
  let raw: unknown
  try { raw = JSON.parse(extracted.json) } catch { /* extract 已保证能解析 */ }
  const simple = isSimplePlan(raw)
  // 格式根本不对（多半是 Chat 写不对完整格式）：放在格式 / 几何错误之前，不列一长串字段错误，改让 Chat 用简版重写。
  // 合法 v3 和能转出墙的旧格式 diagnoseShape 返回 wrong=false，不受影响；「rooms 有、walls 空」的 v3 在这里拦下
  if (!simple) {
    const d = diagnoseShape(raw)
    if (d.wrong) return { extracted, parsed, raw, fatal: 'shape', shape: d.reasons }
  }
  const fatal = loadError(parsed.issues)
  // 不是方案的 JSON（比如 {"a":1}）会被当成旧格式转成空方案：不能拿空方案替换当前方案
  return { extracted, parsed, raw, simple, fatal: fatal ?? (isEmptyPlan(parsed.plan) ? 'empty' : null) }
}

/* ───────── 2b. 简版（D7）：格式不对 → 给 Chat 简版模板；简版有阻断错误 → 问题 + 简版规则和模板 ───────── */

/** 格式根本不对时复制给 Chat 的文字：core 的 simpleFormatChatText，用户补的一句接在最后 */
export function shapeChatText(reasons: string[], note?: string): string {
  const said = note?.trim()
  return simpleFormatChatText(reasons) + (said ? `\n\n我还想说：${said}` : '') + '\n'
}

export const SIMPLE_FIRST_LINE = '请按下面的问题修改简版方案，改完重新输出完整的简版 JSON（一个代码块），不要改用别的格式。'
/** 简版有阻断错误：第一行固定那句 + 问题列表 + 简版规则和模板（规则、模板只用 core 常量） */
export function simpleIssuesText(issues: Issue[], note?: string): string {
  const list = issues.filter(i => i.level === 'error' || i.level === 'warn')
  const nE = list.filter(i => i.level === 'error').length
  const lines = [SIMPLE_FIRST_LINE, '', `## 问题：${nE} 条错误、${list.length - nE} 条提醒`]
  list.slice(0, 30).forEach((i, k) => lines.push(`${k + 1}. [${i.level === 'error' ? '错误' : '提醒'}] ${i.message}`))
  if (list.length > 30) lines.push(`……另有 ${list.length - 30} 条，先改上面这些`)
  const said = note?.trim()
  if (said) lines.push('', '## 我还想说', said)
  lines.push('', '## 简版规则', ...SIMPLE_RULES.map((r, i) => `${i + 1}. ${r}`), '', '## 简版模板（照这个结构写）', '```json', SIMPLE_TEMPLATE, '```', '', '只输出一个 ```json 代码块。')
  return lines.join('\n') + '\n'
}

/** 没载入的那段文字该复制什么：格式不对 → 简版模板；简版有错 → 简版问题；其余 → 完整格式的问题清单 */
export function failedChatText(r: PasteResult, note?: string): string {
  if (r.shape) return shapeChatText(r.shape, note)
  if (r.simple && r.parsed) return simpleIssuesText(r.parsed.issues, note)
  return chatIssuesText({ plan: r.parsed && r.parsed.plan.walls.length + r.parsed.plan.rooms.length ? r.parsed.plan : null, issues: r.parsed?.issues ?? [], raw: r.raw, note, extracted: r.extracted })
}

/* ───────── 3. 「复制问题给 Chat」 ───────── */

const mm = (m: number) => `${Math.round(m * 1000)} mm`
const n0 = (v: number) => `${Math.round(v)} mm`
const KIND_ZH: Record<string, string> = { wall: '墙', opening: '洞口', beam: '梁', room: '房间', column: '柱', shaft: '管道井', stair: '楼梯', void: '挑空' }
const WALL_ZH: Record<string, string> = { exterior: '外墙', bearing: '承重墙', partition: '非承重墙', glass: '玻璃隔断', half: '矮墙', 'half-glass': '矮墙+玻璃' }
const OPEN_ZH: Record<string, string> = { door: '平开门', sliding: '推拉门', doorway: '门洞', window: '窗', 'floor-window': '落地窗', 'bay-window': '飘窗', 'open-balcony': '未封阳台' }
const COLL: Record<string, string> = { walls: '墙', openings: '洞口', beams: '梁', rooms: '房间', columns: '柱', shafts: '管道井', stairs: '楼梯', voids: '挑空', questions: '问题卡', changes: '改造记录', levels: '楼层' }

function wallName(plan: Plan, id: string) {
  const w = plan.walls.find(w => w && w.id === id)
  if (!w) return `墙 ${id}`
  return `墙 ${id}（${[WALL_ZH[w.kind] ?? w.kind, w.name].filter(Boolean).join('·')}）`
}
const safe = <T,>(f: () => T, fb: T): T => { try { return f() } catch { return fb } }

/** 几何问题写清：哪面墙、哪个洞口、差多少 */
function geometryDetail(plan: Plan, i: Issue): string {
  const ref = i.ref
  if (!ref) return ''
  if (ref.type === 'opening') {
    const o = plan.openings.find(o => o && o.id === ref.id) as Opening | undefined
    if (!o) return ''
    const w = plan.walls.find(w => w && w.id === o.wall) as Wall | undefined
    const where = `${OPEN_ZH[o.kind] ?? o.kind}，在${w ? wallName(plan, w.id) : `墙 ${o.wall}`}上`
    if (i.code === 'opening-range' && w) {
      const len = safe(() => wallLength(w), NaN), end = o.offset + o.width
      return `${where}。墙长 ${n0(len)}，洞口 offset ${n0(o.offset)} + 宽 ${n0(o.width)} = ${n0(end)}${end > len ? `，超出 ${n0(end - len)}` : ''}${o.offset < 0 ? '，offset 不能是负数' : ''}${!(o.width > 0) ? '，宽度必须大于 0' : ''}`
    }
    if (i.code === 'opening-head' && w) return `${where}。洞顶 ${mm(o.head)}，墙高只有 ${mm(safe(() => effectiveWallHeight(plan, w), NaN))}`
    if (i.code === 'opening-height') return `${where}。洞底 sill ${mm(o.sill)}，洞顶 head ${mm(o.head)}：洞底要 ≥ 0 且低于洞顶`
    if (i.code === 'opening-overlap') {
      const other = /与 (\S+) 重叠/.exec(i.message)?.[1], b = plan.openings.find(x => x && x.id === other)
      return `${where}。${o.id} 占 ${n0(o.offset)}–${n0(o.offset + o.width)}${b ? `，${b.id} 占 ${n0(b.offset)}–${n0(b.offset + b.width)}` : ''}（都从墙 a 端起量）`
    }
    if (i.code === 'opening-host') return `宿主墙 ${o.wall} 在 walls 里找不到或端点无效`
    return where
  }
  if (ref.type === 'wall') {
    const w = plan.walls.find(w => w && w.id === ref.id) as Wall | undefined
    if (!w) return ''
    const pt = (p: unknown) => Array.isArray(p) ? `[${p.join(', ')}]` : String(p)
    if (i.code === 'wall-geometry') return `${wallName(plan, w.id)}：a=${pt(w.a)}，b=${pt(w.b)}，厚 ${typeof w.thickness === 'number' ? n0(w.thickness) : String(w.thickness)}；两端点不能重合，厚度要大于 0`
    return wallName(plan, w.id)
  }
  if (ref.type === 'room') {
    const r = plan.rooms.find(r => r && r.id === ref.id) as Room | undefined
    if (!r) return ''
    return `房间「${r.name}」，${Array.isArray(r.poly) ? r.poly.length : 0} 个顶点${i.code === 'room-self-intersection' ? '；顶点要按顺时针或逆时针沿墙一圈排，边不能交叉' : ''}`
  }
  return ''
}

/** ajv 的英文提示翻成中文 */
function schemaZh(msg: string): string {
  return msg
    .replace(/^must have required property '(.+)'$/, '缺少必填字段 $1')
    .replace(/^must NOT have additional properties$/, '有格式里没有的字段')
    .replace(/^must be (number|string|boolean|integer|array|object|null)$/, (_, t) => `必须是${({ number: '数字', string: '字符串', boolean: 'true/false', integer: '整数', array: '数组', object: '对象', null: 'null' } as Record<string, string>)[t]}`)
    .replace(/^must be equal to one of the allowed values$/, '取值不在允许的范围里')
    .replace(/^must be equal to constant$/, '取值必须是固定值')
    .replace(/^must be (>=|>|<=|<) (.+)$/, (_, op, v) => `必须 ${({ '>=': '≥', '>': '>', '<=': '≤', '<': '<' } as Record<string, string>)[op]} ${v}`)
    .replace(/^must match pattern .*$/, '写法不对（底图 src 只能是本地文件名或 data:image 编码，不能是网址）')
    .replace(/^must NOT have fewer than (\d+) items$/, '至少要 $1 项')
    .replace(/^must NOT have more than (\d+) items$/, '最多 $1 项')
    .replace(/^must NOT have fewer than (\d+) characters$/, '不能为空')
    .replace(/^must match "then" schema$/, '和同一对象里其他字段的组合不匹配')
}
/** 「格式错误 /walls/2/thickness：must be number」→ 字段路径 + 构件 id + 中文 */
function schemaLine(raw: unknown, msg: string): string {
  const m = /^格式错误 (\S+)：(.*)$/.exec(msg)
  if (!m) return msg
  const parts = m[1].split('/').filter(Boolean)
  const path = parts.map((p, k) => /^\d+$/.test(p) ? `[${p}]` : (k ? '.' : '') + p).join('') || '(整个方案)'
  let who = ''
  if (parts.length >= 2 && /^\d+$/.test(parts[1]) && raw && typeof raw === 'object') {
    const item = (raw as Record<string, unknown[]>)[parts[0]]?.[Number(parts[1])] as { id?: unknown } | undefined
    if (item && typeof item.id === 'string') who = `（${COLL[parts[0]] ?? parts[0]} ${item.id}）`
  }
  return `字段 ${path}${who}：${schemaZh(m[2])}`
}

export interface IssueLine { level: 'error' | 'warn'; text: string }
/** 校验结果 → 一行一条（error + warn + 改造记录重放失败） */
export function issueLines(plan: Plan | null, issues: Issue[], raw?: unknown): IssueLine[] {
  const out: IssueLine[] = []
  for (const i of issues) {
    let text: string
    if (i.code === 'schema') text = schemaLine(raw, i.message)
    else if (i.code === 'parse') text = i.message
    else {
      const detail = plan ? geometryDetail(plan, i) : ''
      const head = i.ref ? `${KIND_ZH[i.ref.type] ?? i.ref.type} ${i.ref.id}` : ''
      text = [head && !i.message.startsWith(head) ? head : '', agentUnits(i.message), detail].filter(Boolean).join('：').replace(/：：/g, '：')
    }
    out.push({ level: i.level, text })
  }
  if (plan && !issues.some(i => i.level === 'error') && plan.changes?.length) {
    const replay = safe(() => applyChanges(plan, plan.changes).results, [])
    for (const r of replay) {
      if (!r.ok && r.error) out.push({ level: 'error', text: `改造记录 ${r.id}：${agentUnits(r.error)}` })
      else if (r.needsConfirm) out.push({ level: 'warn', text: `改造记录 ${r.id}：动到承重墙 / 外墙，缺用户的二次确认（confirm），重放时被跳过` })
      for (const w of r.warnings ?? []) out.push({ level: 'warn', text: `改造记录 ${r.id}：${agentUnits(w)}` })
    }
  }
  return out
}

interface RoomRow { id: string; name: string; area: number; counted: boolean; level?: string }
function roomRows(plan: Plan | null, raw: unknown): RoomRow[] {
  const src = (plan && plan.rooms.length ? plan : raw) as { rooms?: unknown; levels?: unknown } | undefined
  const rooms = Array.isArray(src?.rooms) ? src.rooms as Partial<Room>[] : []
  const levels = plan ? safe(() => levelsOf(plan), []) : Array.isArray(src?.levels) ? src.levels as { id: string; name: string }[] : []
  const multi = levels.length > 1
  return rooms.filter(r => r && typeof r === 'object').map(r => {
    const poly = Array.isArray(r.poly) && r.poly.every(p => Array.isArray(p) && p.length === 2 && p.every(n => typeof n === 'number')) ? r.poly : []
    return { id: String(r.id ?? '?'), name: String(r.name ?? '（没写名称）'), area: poly.length >= 3 ? polygonArea(poly) / 1e6 : NaN, counted: r.counted !== false, level: multi ? levels.find(l => l.id === (r.level ?? levels[0].id))?.name : undefined }
  })
}

export interface ChatIssuesInput {
  /** 能解析出来的方案（几何错误时有；格式错误时为 null，用 raw 兜底） */
  plan: Plan | null
  issues: Issue[]
  raw?: unknown
  /** 用户补的一句 */
  note?: string
  /** 截断 / 语法错误：没有 issues，单独写一条 */
  extracted?: Extracted
}
export const CHAT_FIRST_LINE = '请按下面的问题修改方案，改完重新输出完整的 JSON（一个代码块），不要只输出改动的部分。'

export function chatIssuesText({ plan, issues, raw, note, extracted }: ChatIssuesInput): string {
  const lines: string[] = [CHAT_FIRST_LINE, '单位：长度全部 mm（方案格式 v3），面积 m²。', '']
  const list = issueLines(plan, issues, raw)
  if (extracted?.kind === 'incomplete') list.unshift({ level: 'error', text: `JSON 不完整：在第 ${extracted.at} 个字符附近断了，可能是回复被截断` })
  if (extracted?.kind === 'syntax') list.unshift({ level: 'error', text: `JSON 语法错误：第 ${extracted.at} 个字符附近（${extracted.detail}）` })
  const nE = list.filter(l => l.level === 'error').length, nW = list.length - nE
  lines.push(list.length ? `## 校验结果：${nE} 条错误、${nW} 条提醒` : '## 校验结果：没有错误和提醒')
  const MAX = 30
  list.slice(0, MAX).forEach((l, k) => lines.push(`${k + 1}. [${l.level === 'error' ? '错误' : '提醒'}] ${l.text}`))
  if (list.length > MAX) lines.push(`……另有 ${list.length - MAX} 条，先改上面这些`)

  const rooms = roomRows(plan, raw)
  lines.push('', '## 各房间面积（按方案坐标算的使用面积，不含墙；请对照图上的标注）')
  if (!rooms.length) lines.push('（方案里没有房间）')
  for (const r of rooms) lines.push(`- ${r.level ? `${r.level} ` : ''}${r.name}（${r.id}）：${Number.isFinite(r.area) ? `${r.area.toFixed(2)} m²` : '顶点无效，算不出'}${r.counted ? '' : '（不计入面积）'}`)
  const total = rooms.filter(r => r.counted && Number.isFinite(r.area)).reduce((s, r) => s + r.area, 0)
  if (rooms.length) lines.push(`合计（计入面积的房间）：${total.toFixed(2)} m²`)

  const qs = ((plan && plan.questions.length ? plan.questions : (raw as { questions?: unknown })?.questions) ?? []) as { id?: string; text?: string; answer?: string; options?: string[]; targets?: string[] }[]
  const pending = Array.isArray(qs) ? qs.filter(q => q && !q.answer?.trim()) : []
  lines.push('', `## 还没答的问题卡（${pending.length} 个）`)
  if (!pending.length) lines.push('（没有）')
  for (const q of pending) lines.push(`- ${q.id ?? '?'}：${agentUnits(String(q.text ?? ''))}${q.targets?.length ? `（问的是 ${q.targets.join('、')}）` : ''}${q.options?.length ? `（选项：${q.options.map(o => agentUnits(String(o))).join(' / ')}）` : ''}`)

  const said = note?.trim()
  if (said) lines.push('', '## 我还想说', said)
  return lines.join('\n') + '\n'
}

/* ───────── 4. 「复制方案给 Chat」：不带底图编码的 v3 JSON ───────── */

export const isDataSrc = (src?: string) => !!src && /^data:/i.test(src.trim())
export const baseName = (src: string) => src.split(/[?#]/)[0].split(/[\\/]/).pop() || src
const extOf = (src: string) => {
  const t = /^data:image\/([\w+.-]+)/i.exec(src)?.[1]?.toLowerCase() ?? 'png'
  return ({ jpeg: 'jpg', 'svg+xml': 'svg' } as Record<string, string>)[t] ?? t
}

/** 底图 src 换回文件名（data URL 动辄几 MB，贴进 Chat 会被截断）；names 记着用户导入时的原文件名 */
export function planForChat(plan: Plan, names: Record<string, string> = {}): Plan {
  const p = structuredClone(plan)
  const fix = (u: NonNullable<Plan['underlay']>, key: string) => {
    if (!isDataSrc(u.src)) return u
    return { ...u, src: names[key] ?? (key === 'main' ? `户型图.${extOf(u.src)}` : `户型图-${key}.${extOf(u.src)}`) }
  }
  if (p.underlay) p.underlay = fix(p.underlay, 'main')
  if (p.levelUnderlays) p.levelUnderlays = Object.fromEntries(Object.entries(p.levelUnderlays).map(([k, u]) => [k, fix(u, k)]))
  return p
}
export function chatPlanText(plan: Plan, names: Record<string, string> = {}): string {
  // 规范序列化（键排序、v3 mm）后压成一行：缩进版里坐标一个数一行，体积翻两三倍，长方案贴进 Chat 容易被截断
  const json = JSON.stringify(JSON.parse(serializePlan(planForChat(plan, names))))
  return `这是我现在的方案 JSON（底图只写了文件名，图片我这边有）。请在它的基础上改，改完重新输出完整的 JSON（一个代码块）。\n\n\`\`\`json\n${json}\n\`\`\`\n`
}

/**
 * 粘贴第二轮方案时沿用当前底图：当前底图是导入过的图片（data URL），新方案里的底图只是文件名（或干脆没写）
 * → 图片用当前的，比例 / 原点 / 透明度 / 镜像用新方案里的（Chat 估的）。返回新方案和沿用了哪些。
 */
export function keepUnderlays(next: Plan, cur: Plan | null): { plan: Plan; kept: { key: string; name?: string }[] } {
  if (!cur) return { plan: next, kept: [] }
  const plan = { ...next }, kept: { key: string; name?: string }[] = []
  const pick = (n: Plan['underlay'] | undefined, c: Plan['underlay'] | undefined, key: string) => {
    if (!c || !isDataSrc(c.src)) return n
    if (n && isDataSrc(n.src)) return n
    if (n) { kept.push({ key, name: baseName(n.src) }); return { ...n, src: c.src } }
    kept.push({ key }); return c
  }
  const u = pick(next.underlay, cur.underlay, 'main')
  if (u) plan.underlay = u
  if (cur.levelUnderlays || next.levelUnderlays) {
    const keys = new Set([...Object.keys(next.levelUnderlays ?? {}), ...Object.keys(cur.levelUnderlays ?? {})])
    const levelIds = new Set(levelsOf(next).map(l => l.id))
    const out: NonNullable<Plan['levelUnderlays']> = {}
    for (const k of keys) {
      if (!levelIds.has(k)) { if (next.levelUnderlays?.[k]) out[k] = next.levelUnderlays[k]; continue }
      const v = pick(next.levelUnderlays?.[k], cur.levelUnderlays?.[k], k)
      if (v) out[k] = v
    }
    if (Object.keys(out).length) plan.levelUnderlays = out
  }
  return { plan, kept }
}
