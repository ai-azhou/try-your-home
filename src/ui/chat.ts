/**
 * 网页 Chat 流程（T2）的界面状态和动作：粘贴方案、复制问题给 Chat、复制方案给 Chat。
 * 文字怎么生成在 chat-text.ts（纯函数）；对话框在 panels/ChatSheet.tsx。
 */
import { create } from 'zustand'
import { parsePlanText, serializePlan } from '@/core/io'
import { useStore } from './store'
import { dicts } from './i18n'
import { analysePaste, chatIssuesText, chatPlanText, keepUnderlays, planForChat, truncatedChatText, type PasteResult } from './chat-text'

export type ChatView = 'paste' | 'issues' | 'plan'
interface ChatState {
  open: boolean
  view: ChatView
  /** 粘贴框里的文字 */
  text: string
  /** 「还想告诉 Chat 什么？」 */
  note: string
  /** 最近一次解析的结果（载入失败时留着，「复制问题给 Chat」用它） */
  result: PasteResult | null
  /** 问题清单来自哪里：刚才没载入的那段（failed）还是当前方案（current） */
  issuesFrom: 'failed' | 'current'
  /** 能载入、但当前方案有没保存的改动：等用户点「替换」 */
  confirmReplace: boolean
  /** 复制失败：弹出来让用户手动全选复制的文字 */
  manual: string | null
  /** 刚复制成功的是哪个按钮（按钮变「已复制」） */
  copied: string | null
  /** e2e / 调试：最近一次要复制的文字（不管成没成功） */
  lastCopy: string | null
}
export const useChat = create<ChatState>(() => ({ open: false, view: 'paste', text: '', note: '', result: null, issuesFrom: 'current', confirmReplace: false, manual: null, copied: null, lastCopy: null }))
if (typeof window !== 'undefined') Object.assign(window, { __chat: useChat })

const t = () => dicts[useStore.getState().lang].chat
const fmt = (s: string, v: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''))

export function openPaste() {
  useStore.getState().setPanel(null)
  useChat.setState({ open: true, view: 'paste', result: null, confirmReplace: false, manual: null, copied: null })
}
export function closeChat() { useChat.setState({ open: false, manual: null, copied: null, confirmReplace: false }) }

/** 当前方案的问题（文件菜单「复制问题给 Chat」） */
export function openChatIssues() {
  useStore.getState().setPanel(null)
  useChat.setState({ open: true, view: 'issues', issuesFrom: 'current', manual: null, copied: null })
}
/** 载入失败的那段文字的问题（打开文件 / 服务模式载入失败时的提示条） */
export function openChatIssuesFor(text: string) {
  useChat.setState({ open: true, view: 'issues', issuesFrom: 'failed', result: analysePaste(text), manual: null, copied: null })
}

/** 「复制问题给 Chat」的完整文字 */
export function issuesTextNow(): string {
  const c = useChat.getState(), base = useStore.getState().base
  if (c.issuesFrom === 'failed' && c.result) {
    const r = c.result
    return chatIssuesText({ plan: r.parsed && r.parsed.plan.walls.length + r.parsed.plan.rooms.length ? r.parsed.plan : null, issues: r.parsed?.issues ?? [], raw: r.raw, note: c.note, extracted: r.extracted })
  }
  if (!base) return chatIssuesText({ plan: null, issues: [], note: c.note })
  // 走一遍文件边界（序列化 + parsePlanText）：格式和几何问题都和 Chat 那边看到的 v3 文件一致
  const text = serializePlan(base)
  const parsed = parsePlanText(text)
  let raw: unknown
  try { raw = JSON.parse(text) } catch { /* 序列化结果一定能解析 */ }
  return chatIssuesText({ plan: base, issues: parsed.issues, raw, note: c.note })
}

/* ───────── 粘贴 → 解析 → 载入 ───────── */

export function submitPaste() {
  const c = useChat.getState()
  if (!c.text.trim()) return
  const result = analysePaste(c.text)
  const s = useStore.getState()
  if (result.fatal) { useChat.setState({ result, confirmReplace: false, copied: null, manual: null }); return }
  if (s.base && s.dirty) { useChat.setState({ result, confirmReplace: true, copied: null }); return }
  useChat.setState({ result })
  applyPaste()
}

export function applyPaste() {
  const r = useChat.getState().result
  if (!r?.parsed || r.fatal) return
  const s = useStore.getState(), tt = t()
  // 第二轮：当前底图是导入过的图片、新方案里只是文件名 → 图片沿用当前的，比例 / 原点用新方案里 Chat 估的
  const prevNames = s.underlayNames
  const { plan, kept } = keepUnderlays(structuredClone(r.parsed.plan), s.base)
  plan.meta = { ...plan.meta }
  delete plan.meta.planFile // 粘贴的方案没有文件；导出时再起名
  s.loadPlan(plan, { kind: 'paste' }, r.parsed.report)
  if (useStore.getState().base !== plan) { useChat.setState({ confirmReplace: false }); return } // loadPlan 自己的守卫拦下了（不该发生，parsePlanText 已过）
  if (kept.length) useStore.setState(x => ({ underlayNames: { ...x.underlayNames, ...Object.fromEntries(kept.map(k => [k.key, k.name ?? prevNames[k.key] ?? ''] as const).filter(([, v]) => v)) } }))
  closeChat()
  useChat.setState({ text: '', result: null, note: '' })
  const n = useStore.getState().base!
  s.showToast(fmt(tt.loaded, { w: n.walls.length, o: n.openings.length, r: n.rooms.length }) + (kept.length ? tt.keptUnderlay : ''))
}

/* ───────── 复制（经得起没有剪贴板权限的环境） ───────── */

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* 往下试 */ }
  try {
    const ta = document.createElement('textarea')
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'
    document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch { return false }
}
/** 复制；失败时把文字放进对话框里的文本框，让用户手动全选复制 */
export async function copyForChat(text: string, key: string, view?: ChatView): Promise<boolean> {
  useChat.setState({ lastCopy: text })
  const ok = await writeClipboard(text)
  if (ok) { useChat.setState({ copied: key, manual: null }); return true }
  useChat.setState({ open: true, ...(view ? { view } : {}), manual: text, copied: null })
  useStore.getState().showToast(t().manual)
  return false
}

export const copyTruncated = (at: number) => copyForChat(truncatedChatText(at), 'truncated')
export const copyIssues = () => copyForChat(issuesTextNow(), 'issues')

/** 「复制方案给 Chat」：不带底图编码的 v3 JSON（底图 src 换回文件名） */
export function planTextNow(): string | null {
  const s = useStore.getState()
  return s.base ? chatPlanText(s.base, s.underlayNames) : null
}
export async function copyPlan(_fromDialog = false) {
  const s = useStore.getState(), text = planTextNow()
  if (!text || !s.base) return
  const name = planForChat(s.base, s.underlayNames).underlay?.src
  // 复制失败一律换到「复制方案」页手动复制（不把方案 JSON 塞进问题页）
  const ok = await copyForChat(text, 'plan', 'plan')
  if (ok) useStore.getState().showToast(name ? fmt(t().planCopied, { name }) : t().planCopiedNoUnderlay)
}
