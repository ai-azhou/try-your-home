import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { emptyPlan, planFileValue } from './io.ts'
import { QUESTION_OUTCOMES } from './questions.ts'

let directory: string, file: string
const cli = (...args: string[]) => spawnSync(process.execPath, ['scripts/plan.ts', args[0], file, ...args.slice(1)], { encoding: 'utf8' })
const read = () => readFileSync(file, 'utf8')
const raw = () => JSON.parse(read())
const save = (value: unknown) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n')
const answer = () => cli('answer', 'q', '--text', ' 没有门 ', '--at', '2026-10-30')
const resolve = (outcome: string) => cli('resolve', 'q', '--outcome', outcome, '--reply', ' 已处理 ', '--at', '2026-10-31')
const fail = (result: ReturnType<typeof cli>) => { expect(result.status).toBe(1); expect(result.stderr).toMatch(/^错误：/); expect(result.stdout).toBe('') }
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'question-cli-')); file = join(directory, 'plan.json')
  const p = emptyPlan()
  p.walls = [{ id: 'w', a: [0, 0], b: [5000, 0], thickness: 120, height: 3.150125, kind: 'partition' }]
  p.questions = [
    { id: 'q', category: 'original', text: '门高 2.1 m？', bbox: [0, 0, 100, 100], targets: ['w'], options: ['2 m', '不知道'] },
    { id: 'q-other', category: 'renovation', text: '还有别的', answer: '未处理', answeredBy: '家人', answeredAt: '2026-10-29' },
  ]
  const value = planFileValue(p)
  value.questions[0].text = '门高 2.1 m？'; value.questions[0].options = ['2 m', '不知道']
  value.underlay = { visible: true, src: 'data:image/png;base64,' + 'abCD0123'.repeat(15000), opacity: 50, origin: [13.375, 24], mmPerPx: 12.345 }
  value.legacy = { original: { z: '2.1 m', a: ' 保留原文\n与键序 ' } }
  save(value)
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))

it('questions 输出精简数组及有效状态，支持过滤，不带底图和 bbox', () => {
  const value = raw()
  value.questions.push({ id: 'done', category: 'original', text: '结束', answer: '对', reply: { outcome: 'confirmed', text: '已确认', by: 'Agent', at: '今天' } })
  value.questions.push({ id: 'ask', category: 'original', text: '再问', answer: '等等', reply: { outcome: 'ask', text: '量好了吗', by: 'Agent', at: '今天' }, log: [{ role: 'user', text: '以前' }] })
  save(value)
  const before = read(), result = cli('questions'), cards = JSON.parse(result.stdout)
  expect(result.status).toBe(0); expect(cards.map((q: any) => q.status)).toEqual(['open', 'answered', 'resolved', 'open'])
  expect(cards[0]).toEqual({ id: 'q', status: 'open', category: 'original', text: '门高 2.1 m？', targets: ['w'], options: ['2 m', '不知道'] })
  expect(cards[3].log).toEqual([{ role: 'user', text: '以前' }])
  expect(result.stdout).not.toMatch(/bbox|data:image|underlay/)
  for (const status of ['open', 'answered', 'resolved']) {
    const filtered = cli('questions', '--status', status)
    expect(filtered.status).toBe(0); expect(JSON.parse(filtered.stdout)).toEqual(cards.filter((q: any) => q.status === status))
  }
  fail(cli('questions', '--status', 'invalid')); expect(read()).toBe(before)
}, 10000)
it('answer → answered，原始 v3 单位、底图、键序及其他卡逐字节保留，输出只有一行', () => {
  const before = read(), original = raw(), result = answer(), after = raw()
  expect(result.status).toBe(0)
  expect(after.questions[0]).toEqual({ ...original.questions[0], answer: '没有门', answeredBy: '业主', answeredAt: '2026-10-30', status: 'answered' })
  const block = (q: unknown) => JSON.stringify(q, null, 2).replace(/\n/g, '\n    ')
  expect(read()).toBe(before.replace(block(original.questions[0]), block(after.questions[0])))
  const { bbox, ...card } = after.questions[0]
  expect(result.stdout).toBe(JSON.stringify(card) + '\n')
  expect(after.walls[0].height).toBe(3150.125); expect(after.questions[0].text).toBe('门高 2.1 m？')
  expect(readdirSync(directory)).toEqual(['plan.json'])
})
it.each(QUESTION_OUTCOMES)('resolve %s，从 answered 处理并保留 answer*', outcome => {
  expect(answer().status).toBe(0)
  const before = raw(), result = resolve(outcome), after = raw()
  expect(result.status).toBe(0)
  expect(after.questions[0]).toEqual({ ...before.questions[0], status: outcome === 'ask' ? 'open' : 'resolved', reply: { outcome, text: '已处理', by: 'Agent', at: '2026-10-31' } })
  const block = (q: unknown) => JSON.stringify(q, null, 2).replace(/\n/g, '\n    ')
  expect(read()).toBe((JSON.stringify(before, null, 2) + '\n').replace(block(before.questions[0]), block(after.questions[0])))
  expect(JSON.parse(result.stdout)).not.toHaveProperty('bbox')
  expect(readdirSync(directory)).toEqual(['plan.json'])
})
it.each(QUESTION_OUTCOMES.filter(o => o !== 'withdrawn'))('resolve %s 拒绝 open，原文件不动', outcome => {
  const before = read(), result = resolve(outcome)
  fail(result); expect(result.stderr).toMatch(/现在是 open.*先记录用户答复/); expect(read()).toBe(before)
})
it.each(QUESTION_OUTCOMES)('resolve %s 拒绝 resolved，原文件不动', outcome => {
  const value = raw(); value.questions[0].status = 'resolved'; value.questions[0].reply = { outcome: 'withdrawn', text: '撤回', by: 'Agent', at: '今天' }; save(value)
  const before = read(), result = resolve(outcome)
  fail(result); expect(result.stderr).toMatch(/现在是 resolved.*先记录用户答复/); expect(read()).toBe(before)
})
it('withdrawn 可撤回 open；再答自动归档；指定 by；缺省 at 为本地日期', () => {
  expect(resolve('withdrawn').status).toBe(0)
  const date = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  const before = date(), result = cli('answer', 'q', '--text', '仍有异议', '--by', '家人'), card = JSON.parse(result.stdout)
  expect(result.status).toBe(0); expect([before, date()]).toContain(card.answeredAt)
  expect(card).toMatchObject({ status: 'answered', answeredBy: '家人', answer: '仍有异议', log: [{ role: 'agent', outcome: 'withdrawn', text: '已处理', by: 'Agent', at: '2026-10-31' }] })
  expect(card).not.toHaveProperty('reply')
  const done = cli('resolve', 'q', '--outcome', 'noted', '--reply', '记下了', '--by', 'Chat')
  expect(done.status).toBe(0); expect(JSON.parse(done.stdout).reply.by).toBe('Chat'); expect([before, date()]).toContain(JSON.parse(done.stdout).reply.at)
})
it('追问再答保留上一轮用户和 Agent 原话', () => {
  expect(answer().status).toBe(0); expect(resolve('ask').status).toBe(0)
  const result = cli('answer', 'q', '--text', '已量好', '--at', '2026-11-01')
  expect(result.status).toBe(0)
  expect(raw().questions[0].log).toEqual([
    { role: 'user', text: '没有门', by: '业主', at: '2026-10-30' },
    { role: 'agent', outcome: 'ask', text: '已处理', by: 'Agent', at: '2026-10-31' },
  ])
})
it('--changed 校验全部 id 并去重，含改造新增和拆墙分段', () => {
  const value = raw()
  value.changes = [
    { id: 'split', op: 'remove', type: 'wall', target: 'w', range: [1000, 2000], by: 'agent', status: 'pending' },
    { id: 'add', op: 'add', type: 'wall', data: { ...value.walls[0], id: 'new' }, by: 'agent', status: 'confirmed' },
  ]; save(value)
  expect(answer().status).toBe(0)
  const before = read(), bad = cli('resolve', 'q', '--outcome', 'changed', '--reply', '说明', '--changed', 'w,missing')
  fail(bad); expect(bad.stderr).toContain('missing 在方案里找不到'); expect(read()).toBe(before)
  const result = cli('resolve', 'q', '--outcome', 'changed', '--reply', '说明', '--changed', 'w, new,w~split,w', '--at', '2026-10-31')
  expect(result.status).toBe(0); expect(raw().questions[0].reply.changed).toEqual(['w', 'new', 'w~split'])
})
it.each([
  ['answer', 'q', '--text', ' \n '], ['answer', 'q'], ['answer', 'q', '--text'], ['answer', 'missing', '--text', '答复'],
  ['resolve', 'q-other', '--outcome', 'noted', '--reply', ' '], ['resolve', 'q-other', '--outcome', 'invalid', '--reply', '说明'],
  ['resolve', 'q-other', '--outcome', 'noted'], ['resolve', 'q-other', '--outcome', 'noted', '--reply', '说明', '--changed', ''],
  ['questions', '--unknown', 'x'],
])('无效参数 %j 报错且不写文件', (...args) => {
  const before = read(); fail(cli(...args)); expect(read()).toBe(before); expect(readdirSync(directory)).toEqual(['plan.json'])
})
it.each(['answer', 'resolve'])('%s 新文本有几何 error 就不写（只改卡也须通过整份校验）', command => {
  const value = raw(); value.walls[0].b = value.walls[0].a; save(value)
  const before = read(), result = command === 'answer' ? answer() : cli('resolve', 'q-other', '--outcome', 'noted', '--reply', '记下')
  fail(result); expect(result.stderr).toContain('修改后的方案校验未通过，文件未写入'); expect(read()).toBe(before)
  expect(readdirSync(directory)).toEqual(['plan.json'])
})
it('旧版及未知字段方案不原地写入', () => {
  const value = raw(); value.version = 2; value.ceiling = 2.8; save(value)
  let before = read(); const old = answer(); fail(old); expect(old.stderr).toContain('只支持 v3'); expect(read()).toBe(before)
  value.version = 3; value.ceiling = 2800; value.future = true; save(value); before = read()
  const future = answer(); fail(future); expect(future.stderr).toContain('升级到最新版'); expect(read()).toBe(before)
})
it('stats 输出三态计数及兼容 unansweredQuestions', () => {
  expect(answer().status).toBe(0); expect(resolve('ask').status).toBe(0)
  const result = cli('stats'); expect(result.status).toBe(0)
  expect(JSON.parse(result.stdout)).toMatchObject({ questions: { open: 1, answered: 1, resolved: 0 }, unansweredQuestions: 1 })
})
