/**
 * 演示数据来源。
 * - 默认：src/ui/mock.ts（手写虚构两室，覆盖六种墙、七类洞口里的五类、梁、飘窗台、弧墙、问题卡、改造记录）。
 * - ?data=example：codex 生成的 fixtures/example-v2.json（旧格式样例转换，只有外墙和隔墙），文件不存在时退回 mock。
 * 仅载入随附的公开示例。
 */
import type { Plan } from '@/core/types'
import { mockPlan } from './mock'
import drawingUrl from '../../fixtures/example-drawing.png?inline'

const found = import.meta.glob('../../fixtures/example-v2.json', { eager: true, import: 'default' }) as Record<string, Plan>
const example = Object.values(found)[0]

function withLocalUnderlay(p: Plan): Plan {
  if (!p.underlay) return p
  const src = p.underlay.src
  if (/^(data:|blob:)/.test(src)) return p
  // 方案里是相对路径（如 ../drawing.png）：演示时换成打进包里的公开样例图
  return { ...p, underlay: { ...p.underlay, src: drawingUrl } }
}

const want = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('data') : null

export const examplePlan: Plan | null = example ? withLocalUnderlay(structuredClone(example)) : null
export const demoPlan: Plan = want === 'example' && examplePlan ? examplePlan : mockPlan
