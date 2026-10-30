import type { Plan, Question, QuestionOutcome, QuestionReply, QuestionStatus } from './types.ts'
import { applyChanges, collection, elements } from './changes.ts'

export const QUESTION_STATUSES = ['open', 'answered', 'resolved'] as const
export const QUESTION_OUTCOMES = ['changed', 'confirmed', 'inferred', 'noted', 'ask', 'withdrawn'] as const

export function questionStatus(q: Question): QuestionStatus {
  if (QUESTION_STATUSES.includes(q.status as QuestionStatus)) return q.status!
  if (!q.answer?.trim()) return 'open'
  if (!q.reply) return 'answered'
  return q.reply.outcome === 'ask' ? 'open' : 'resolved'
}
export function questionCounts(plan: Plan): { open: number; answered: number; resolved: number } {
  const counts = { open: 0, answered: 0, resolved: 0 }
  for (const q of plan.questions) counts[questionStatus(q)]++
  return counts
}
export function answerQuestion(q: Question, text: string, by: string, at: string): Question {
  text = text.trim()
  if (!text) throw new Error(`问题卡 ${q.id}：答复不能为空，请填写答复`)
  const next = { ...q }
  if (q.reply) {
    next.log = [...(q.log ?? [])]
    if (q.answer?.trim()) next.log.push({ role: 'user', text: q.answer, by: q.answeredBy, at: q.answeredAt })
    next.log.push({ role: 'agent', ...q.reply, ...(q.reply.changed ? { changed: [...q.reply.changed] } : {}) })
    delete next.reply
  }
  return { ...next, answer: text, answeredBy: by, answeredAt: at, status: 'answered' }
}
export function resolveQuestion(q: Question, { outcome, text, changed, by = 'Agent', at }: Omit<QuestionReply, 'by'> & { by?: string }): Question {
  const status = questionStatus(q)
  if (!QUESTION_OUTCOMES.includes(outcome as QuestionOutcome)) throw new Error(`问题卡 ${q.id}：不认识处理结果 ${outcome}，请使用 ${QUESTION_OUTCOMES.join('、')}`)
  if (status !== 'answered' && !(outcome === 'withdrawn' && status === 'open')) throw new Error(`问题卡 ${q.id}：现在是 ${status}（${status === 'open' ? '待回答' : '已处理'}），请先记录用户答复，status 变为 answered 后再处理${status === 'open' ? '；不用再问可用 withdrawn 撤回' : ''}`)
  text = text.trim()
  if (!text) throw new Error(`问题卡 ${q.id}：回复不能为空，请说明处理结果`)
  return { ...q, status: outcome === 'ask' ? 'open' : 'resolved', reply: { outcome, text, ...(changed ? { changed: [...new Set(changed)] } : {}), by, at } }
}
/** 包括原始构件及成功改造产生的构件（即使后续又移除）。 */
export function questionElementIds(plan: Plan): Set<string> {
  const ids = new Set(Object.keys(collection).flatMap(type => elements(plan, type as keyof typeof collection).map(e => e.id)))
  if (plan.changes.length) for (const r of applyChanges(plan, plan.changes).results) if (r.ok) for (const id of r.affected) ids.add(id)
  return ids
}
