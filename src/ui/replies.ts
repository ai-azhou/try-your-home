/**
 * Agent 回复「看过没」：只记在本机（localStorage），不写进方案文件。
 * 指纹 = 问题 id + 回复日期 + 回复文字；按方案文件名（没有就用标题）分开记。用户自己标的「我自己改好了」不算。
 */
import { create } from 'zustand'
import type { Plan, Question } from '@/core/types'
import { useStore } from './store'

const KEY = 'tyh.seenReplies'
const SELF = '业主'
const planKey = (plan: Plan) => plan.meta?.planFile?.split('/').pop() || plan.title || '未命名'
export const replyMark = (q: Question) => q.reply ? `${q.id}@${q.reply.at}:${q.reply.text}` : ''

function read(): Record<string, string[]> {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {} } catch { return {} }
}
export const useReplies = create<{ seen: Record<string, string[]> }>(() => ({ seen: read() }))

/** 还没看过的 Agent 回复 */
export function unseenReplies(plan: Plan, seen = useReplies.getState().seen): Question[] {
  const done = new Set(seen[planKey(plan)] ?? [])
  return plan.questions.filter(q => q.reply && q.reply.by !== SELF && !done.has(replyMark(q)))
}
export function markSeen(plan: Plan, qs: Question[] = plan.questions) {
  const marks = qs.filter(q => q.reply).map(replyMark)
  if (!marks.length) return
  const seen = useReplies.getState().seen, k = planKey(plan), had = new Set(seen[k] ?? [])
  if (marks.every(m => had.has(m))) return
  const next = { ...seen, [k]: [...had, ...marks].slice(-500) }
  useReplies.setState({ seen: next })
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* 隐私模式等：只在这次会话里记 */ }
}

// 「待核对」面板收起（点 ×、按 Q、切模式）时，这次摆出来的回复都算看过。桌面上右侧列表常驻，不能只靠列表卸载
useStore.subscribe((s, prev) => { if (prev.panel === 'questions' && s.panel !== 'questions' && s.base) markSeen(s.base) })
