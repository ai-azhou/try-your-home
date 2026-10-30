import { describe, expect, it } from 'vitest'
import { answerQuestion, questionCounts, questionElementIds, questionStatus, resolveQuestion, QUESTION_OUTCOMES, QUESTION_STATUSES } from './questions.ts'
import { emptyPlan, parsePlanText, planFileValue, serializePlan } from './io.ts'
import { validatePlanFile } from './schema.ts'
import { validatePlan } from './validate.ts'
import { planStats } from './summary.ts'
import type { Question, QuestionReply } from './types.ts'

const q: Question = { id: 'q-kitchen', category: 'original', text: '厨房有门吗？' }
const reply: QuestionReply = { outcome: 'confirmed', text: '已确认', by: 'Agent', at: '2026-10-30', changed: ['w'] }
const answered: Question = { ...q, answer: '没有门', answeredBy: '业主', answeredAt: '2026-10-29' }

describe('问题卡状态', () => {
  it.each([
    [{}, 'open'], [{ answer: ' \n ' }, 'open'], [{ answer: '有门' }, 'answered'],
    [{ answer: '有门', reply }, 'resolved'], [{ answer: '有门', reply: { ...reply, outcome: 'ask' } }, 'open'],
    [{ reply }, 'open'], [{ status: 'invalid', answer: '有门' }, 'answered'],
  ])('旧卡按答复及回复推导 %j', (fields, expected) => expect(questionStatus({ ...q, ...fields } as Question)).toBe(expected))
  it.each(QUESTION_STATUSES)('显式 %s 优先于答复和 reply', status => {
    expect(questionStatus({ ...answered, status, reply: { ...reply, outcome: 'ask' } })).toBe(status)
  })
  it('统计包含所有楼层和追问，兼容计数等于 open', () => {
    const p = emptyPlan()
    p.levels = [{ id: 'L1', name: '一层', elevation: 0 }, { id: 'L2', name: '二层', elevation: 3 }]
    p.questions = [q, { ...answered, id: 'q2', level: 'L2' }, { ...answered, id: 'q3', reply }, { ...answered, id: 'q4', reply: { ...reply, outcome: 'ask' } }]
    expect(questionCounts(p)).toEqual({ open: 2, answered: 1, resolved: 1 })
    expect(planStats(p)).toMatchObject({ questions: { open: 2, answered: 1, resolved: 1 }, unansweredQuestions: 2 })
    expect(questionCounts(emptyPlan())).toEqual({ open: 0, answered: 0, resolved: 0 })
  })
})
describe('答复与多轮记录', () => {
  it('首次答和未处理改答都直接覆盖，去首尾空白', () => {
    const next = answerQuestion(q, ' 没有门\n', '业主', '2026-10-30')
    expect(next).toEqual({ ...q, answer: '没有门', answeredBy: '业主', answeredAt: '2026-10-30', status: 'answered' })
    expect(answerQuestion(next, '有门', '家人', '2026-10-31')).toEqual({ ...next, answer: '有门', answeredBy: '家人', answeredAt: '2026-10-31' })
    expect(q.answer).toBeUndefined()
  })
  it.each(['confirmed', 'ask'] as const)('已有 %s 回复先追加旧轮，保留更早记录且不改入参', outcome => {
    const old: Question = { ...answered, reply: { ...reply, outcome }, log: [{ role: 'agent', text: '更早回复' }] }
    const snapshot = structuredClone(old)
    Object.freeze(old.log); Object.freeze(old.reply!.changed); Object.freeze(old.reply); Object.freeze(old)
    const next = answerQuestion(old, ' 还有一扇门 ', '业主', '2026-10-31')
    expect(next.log).toEqual([...snapshot.log!, { role: 'user', text: '没有门', by: '业主', at: '2026-10-29' }, { role: 'agent', ...snapshot.reply }])
    expect(next).toMatchObject({ status: 'answered', answer: '还有一扇门' })
    expect(next).not.toHaveProperty('reply'); expect(old).toEqual(snapshot)
    next.log!.at(-1)!.changed!.push('other'); expect(old.reply!.changed).toEqual(['w'])
  })
  it('撤回后再答，没有旧用户答复就只存 Agent 回复', () => {
    const next = answerQuestion({ ...q, status: 'resolved', reply: { ...reply, outcome: 'withdrawn' } }, '仍想确认', '业主', '今天')
    expect(next.log).toEqual([{ role: 'agent', ...reply, outcome: 'withdrawn' }])
  })
  it('没有 reply 时不追加已有 log', () => {
    const old = { ...answered, log: [{ role: 'agent' as const, text: '上一轮' }] }
    expect(answerQuestion(old, '改答', '业主', '今天').log).toEqual(old.log)
  })
  it('空白答复拒绝', () => expect(() => answerQuestion(q, ' \n ', '业主', '今天')).toThrow('答复不能为空'))
  it.each(QUESTION_OUTCOMES)('%s 从 answered 处理，不改 answer*，去重 changed', outcome => {
    const old = structuredClone(answered), changed = ['w', 'w', 'o']
    const next = resolveQuestion(old, { outcome, text: ' 处理说明\n', changed, at: '2026-10-30' })
    expect(next).toEqual({ ...answered, status: outcome === 'ask' ? 'open' : 'resolved', reply: { outcome, text: '处理说明', changed: ['w', 'o'], by: 'Agent', at: '2026-10-30' } })
    expect(old).toEqual(answered); expect(changed).toEqual(['w', 'w', 'o'])
  })
  it.each(QUESTION_OUTCOMES.filter(o => o !== 'withdrawn'))('%s 不能处理 open', outcome => {
    expect(() => resolveQuestion(q, { outcome, text: '说明', at: '今天' })).toThrow(/现在是 open.*先记录用户答复/)
  })
  it.each(QUESTION_OUTCOMES)('%s 不能重复处理 resolved', outcome => {
    expect(() => resolveQuestion({ ...answered, status: 'resolved', reply }, { outcome, text: '说明', at: '今天' })).toThrow(/现在是 resolved.*先记录用户答复/)
  })
  it('withdrawn 可从 open 撤回，支持指定处理人', () => {
    expect(resolveQuestion(q, { outcome: 'withdrawn', text: '图上已读清', by: 'Chat', at: '今天' })).toEqual({ ...q, status: 'resolved', reply: { outcome: 'withdrawn', text: '图上已读清', by: 'Chat', at: '今天' } })
  })
  it('空白回复拒绝', () => expect(() => resolveQuestion(answered, { outcome: 'noted', text: ' \n', at: '今天' })).toThrow('回复不能为空'))
})
describe('问题卡 schema 与载入', () => {
  const raw = () => planFileValue({ ...emptyPlan(), questions: [{ ...answered, status: 'resolved', reply, log: [{ role: 'user', text: '以前的答复' }, { role: 'agent', ...reply }] }] })
  it('新字段和可选 log 字段往返保留，旧文件仍可载入', () => {
    const value = raw(), loaded = parsePlanText(JSON.stringify(value))
    expect(loaded.issues.some(i => i.level === 'error')).toBe(false)
    expect(JSON.parse(serializePlan(loaded.plan)).questions).toEqual(value.questions)
    expect(validatePlanFile(planFileValue({ ...emptyPlan(), questions: [q] }))).toEqual([])
  })
  it.each(['outcome', 'text', 'by', 'at'])('reply 必填 %s', key => {
    const value = raw(); delete value.questions[0].reply[key]
    expect(validatePlanFile(value).some(i => i.message.includes(`/reply/${key}`))).toBe(true)
  })
  it.each(['role', 'text'])('log 必填 %s', key => {
    const value = raw(); delete value.questions[0].log[0][key]
    expect(validatePlanFile(value).some(i => i.message.includes(`/log/0/${key}`))).toBe(true)
  })
  it.each([
    ['status', 'bogus'], ['reply', { ...reply, outcome: 'bogus' }], ['reply', { ...reply, changed: [''] }],
    ['log', [{ role: 'system', text: '无效' }]], ['log', [{ role: 'agent', text: '无效', changed: [123] }]],
  ])('拒绝不合法 %s', (key, value) => {
    const plan = raw(); plan.questions[0][key] = value
    expect(validatePlanFile(plan).length).toBeGreaterThan(0)
  })
  it.each(['root', 'question', 'reply', 'log'])('未知字段 %s 保持 error，并提示第一条路径和升级', where => {
    const value = raw(), obj = where === 'root' ? value : where === 'question' ? value.questions[0] : where === 'reply' ? value.questions[0].reply : value.questions[0].log[0]
    obj.future = true; obj.future2 = true
    const path = ({ root: '/future', question: '/questions/0/future', reply: '/questions/0/reply/future', log: '/questions/0/log/0/future' })[where]!
    const loaded = parsePlanText(JSON.stringify(value)), tips = loaded.issues.filter(i => i.message.startsWith('方案里有这个版本'))
    expect(tips).toEqual([{ level: 'error', code: 'schema', message: `方案里有这个版本不认识的字段（${path}）：可能是更新版本的工具或 Skill 写的，请把 try-your-home 和 see-your-home 升级到最新版` }])
    expect(loaded.issues.some(i => i.message.includes('additional properties'))).toBe(true)
    expect(loaded.plan.questions).toEqual([])
  })
  it('普通格式错误不误报升级', () => {
    const value = raw(); value.questions[0].text = 1
    expect(parsePlanText(JSON.stringify(value)).issues.some(i => i.message.includes('升级'))).toBe(false)
  })
})
describe('状态一致性只提醒', () => {
  it.each([
    [{ status: 'answered', answer: ' ' }, 'status 是 answered，但没有答复'],
    [{ ...answered, status: 'answered', reply }, 'status 是 answered，但还挂着 reply'],
    [{ status: 'resolved' }, 'status 是 resolved，但没有 reply'],
    [{ ...answered, status: 'resolved', reply: { ...reply, outcome: 'ask', changed: [] } }, 'reply.outcome 是 ask，但 status 不是 open'],
    [{ ...answered, status: 'resolved', reply }, 'reply.changed 里的构件 w 在方案里找不到'],
  ])('%s', (fields, message) => {
    const p = { ...emptyPlan(), questions: [{ ...q, ...fields } as Question] }
    const issues = parsePlanText(serializePlan(p)).issues
    expect(issues).toContainEqual({ level: 'warn', code: 'question-status', message: `问题卡 q-kitchen：${message}` })
    expect(issues.some(i => i.level === 'error')).toBe(false)
  })
  it('查八类构件、改造新增和分段 id，不把问题及改造记录 id 当构件', () => {
    const p = emptyPlan()
    p.walls = [{ id: 'w', a: [0, 0], b: [5000, 0], thickness: 100, kind: 'partition' }]
    p.openings = [{ id: 'o', wall: 'w', offset: 3000, width: 900, sill: 0, head: 2.1, kind: 'door' }]
    p.beams = [{ id: 'b', a: [0, 0], b: [5000, 0], width: 100, bottom: 2.5 }]
    p.rooms = [{ id: 'r', name: '房间', poly: [[0, 0], [5000, 0], [5000, 3000], [0, 3000]] }]
    p.levels = [{ id: 'L1', name: '一层', elevation: 0 }, { id: 'L2', name: '二层', elevation: 3 }]
    const poly: [number, number][] = [[0, 0], [300, 0], [300, 300], [0, 300]]
    p.columns = [{ id: 'col', center: [0, 0], size: [300, 300], shape: 'rect', kind: 'bearing' }]
    p.shafts = [{ id: 'sh', poly, kind: 'pipe' }]
    p.stairs = [{ id: 'st', level: 'L1', to: 'L2', poly, path: [[0, 0], [300, 300]], width: 300, kind: 'straight' }]
    p.voids = [{ id: 'v', level: 'L2', poly }]
    p.changes = [
      { id: 'split', op: 'remove', type: 'wall', target: 'w', range: [1000, 2000], by: 'agent', status: 'pending' },
      { id: 'add', op: 'add', type: 'wall', data: { ...p.walls[0], id: 'new' }, by: 'agent', status: 'confirmed' },
      { id: 'remove', op: 'remove', type: 'wall', target: 'new', by: 'agent', status: 'confirmed' },
    ]
    const ids = ['w', 'o', 'b', 'r', 'col', 'sh', 'st', 'v', 'new', 'w~split']
    p.questions = [{ ...answered, status: 'resolved', reply: { ...reply, changed: ids } }]
    expect(questionElementIds(p)).toEqual(new Set(ids))
    expect(validatePlan(p).filter(i => i.code === 'question-status')).toEqual([])
    p.questions[0].reply!.changed = ['split', 'q-kitchen', 'L1', 'missing']
    expect(validatePlan(p).filter(i => i.code === 'question-status')).toHaveLength(4)
  })
})
