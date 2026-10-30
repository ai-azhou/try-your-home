import { elements, replayOrigin } from './changes.ts'
import { agentUnits, lengthUnit } from './io.ts'
import { questionStatus } from './questions.ts'
import { decorHandoff, isDecorRef } from './decor/integration.ts'
import type { DecorRef } from './decor/integration.ts'
import type { Plan } from './types.ts'
import type { ElementRef, ExtraElementRef } from './geometry.ts'
import { effectiveWallHeight, openingSpan, polygonArea, roomCeiling, roomsBesideWall, wallLength } from './geometry.ts'
import { levelOf } from './levels.ts'
export function agentHandoff(plan: Plan, refs: (ElementRef | ExtraElementRef | DecorRef)[], userText: string, opts: { planFile?: string; mode: 'original' | 'renovation' | 'compare' | '原始' | '改造' | '对比' | 'decor' | '装修'; answers?: 'saved' | 'unsaved'; otherUnsaved?: boolean }): string {
  const mode = ({ 原始: 'original', 改造: 'renovation', 对比: 'compare', 装修: 'decor' } as Record<string, string>)[opts.mode] ?? opts.mode
  const origin = replayOrigin(plan), original = origin?.base ?? plan
  const file = opts.planFile ?? plan.meta?.planFile
  const pathNote = !file?.trim() ? '未指定：请 Agent 先问用户方案文件在哪，取得完整路径后再改。' : `${file}${/^(?:\/|[A-Za-z]:[\\/])/.test(file) ? '（仅服务模式可确认这是完整路径；非服务模式请先向用户确认文件位置）' : '（不是完整路径，请 Agent 先向用户确认文件位置）'}`
  const lines = [
    '改之前先读 Agent 手册「格式」；涉及拆改再读「改造」3.2–3.6。Skill 内在 references/，工具内在 docs/agent手册/；工具连接 4.3 说明改文件的规矩。',
    '# 改改你的家 · 户型结构交接', `方案文件：${pathNote}`, `当前模式：${({ original: '原始', renovation: '改造', compare: '对比', decor: '装修' } as Record<string, string>)[mode]}`,
    '交接文字使用中文，与手册一致。',
    '单位：全部长度 mm（文件 v3），面积 m²；法向 n=(-dy,dx)/长度；洞口 offset 从墙 a 端起量。',
  ]
  const answered = plan.questions.filter(q => questionStatus(q) === 'answered')
  if (opts.answers && answered.length) {
    lines.push('', `## 待核对答复（${answered.length} 条，等你处理）`, opts.answers === 'saved'
      ? '这些答复已经存进方案文件（status 是 answered）。处理方法见读图 2.8「答复之后」、工具连接 4.6。'
      : '方案文件里还没有这些答复：先按下面原文写进对应问题卡的 answer、answeredBy、answeredAt，status 写 answered，再处理。处理方法见读图 2.8「答复之后」、工具连接 4.6。')
    if (opts.otherUnsaved) lines.push('工具里还有答复以外的改动没导出，这段文字里没有；要一起处理，请用户先导出方案文件。')
    for (const q of answered) {
      const text = Array.from(agentUnits(q.text))
      lines.push(`- ${q.id}（${q.category === 'original' ? '原始信息' : '改造'}）`, `  问：${text.length > 80 ? text.slice(0, 80).join('') + '……' : text.join('')}${q.options?.length ? `（选项：${q.options.map(agentUnits).join(' / ')}）` : ''}`)
      if (q.targets?.length) lines.push(`  问的是：${q.targets.join('、')}`)
      lines.push(`  答：${q.answer ?? ''}（${q.answeredBy ?? '业主'} · ${q.answeredAt ?? '未记录日期'}）`)
      const user = [...(q.log ?? [])].reverse().find(e => e.role === 'user'), agent = [...(q.log ?? [])].reverse().find(e => e.role === 'agent')
      if (user || agent) lines.push(`  上一轮：${[user && `答「${user.text}」`, agent && `你回复「${agent.text}」`].filter(Boolean).join('，')}。这次是用户有异议。`)
    }
  }
  lines.push('', '## 选中构件')
  if (!refs.length) lines.push('（没选构件）')
  if (mode !== 'original') lines.push('以下为重放全部改造记录（含待确认）后的值；缺二次确认等失败记录会跳过。原始数组见方案文件，勿把这些值抄回原始数组。')

  for (const ref of refs) {
    if (isDecorRef(ref)) { lines.push(decorHandoff(plan, ref)); continue }
    const collections = { wall: plan.walls, opening: plan.openings, beam: plan.beams, room: plan.rooms, column: plan.columns, shaft: plan.shafts, stair: plan.stairs, void: plan.voids }
    const element = collections[ref.type]?.find(e => e.id === ref.id)
    if (element) {
      lines.push(`楼层：${levelOf(plan, element).name}（${levelOf(plan, element).id}）`)
      if (mode !== 'original' && (origin ? !elements(original, ref.type).some(e => e.id === ref.id) : plan.changes.some(c => c.op === 'add' && c.type === ref.type && c.data?.id === ref.id) || ref.id.includes('~'))) lines.push('  改造产生，只能用 changes 修改。')
      const protectedElement = ref.type === 'wall' && (origin?.protectedWalls.has(ref.id) || 'kind' in element && ['bearing', 'exterior'].includes(element.kind))
        || ref.type === 'column' && (origin?.bearingColumns.has(ref.id) || 'kind' in element && element.kind === 'bearing')
      if (protectedElement) lines.push('  受保护结构：改动需要二次确认（改造 3.4；拆、挪、削、降、改类型、开洞先问用户）。')
      if (ref.type === 'shaft') lines.push('  管道井 / 烟道不可拆（改造 3.5）。')
      lines.push(ref.type === 'void' ? '  certainty：不适用；basis：挑空不带 evidence，疑问写问题卡。' : `  certainty：${element.evidence?.certainty ?? '未记录'}；basis：${element.evidence?.basis ?? '未记录'}。`)
    }
    if (ref.type === 'wall') {
      const w = plan.walls.find(x => x.id === ref.id)
      if (!w) { lines.push(`- 墙 ${ref.id}：不存在`); continue }
      const sides = roomsBesideWall(plan, w.id)
      lines.push(`- 墙 ${w.id} / ${w.kind}${w.name ? ` / ${w.name}` : ''}：长 ${Math.round(wallLength(w))}、厚 ${w.thickness}、高 ${lengthUnit(effectiveWallHeight(plan, w))}；端点 a=${JSON.stringify(w.a)}，b=${JSON.stringify(w.b)}${w.bulge ? `，矢高 ${w.bulge}` : ''}。`, `  法向侧房间：${sides.positive.map(r => `${r.name}(${r.id})`).join('、') || '无'}；反侧：${sides.negative.map(r => `${r.name}(${r.id})`).join('、') || '无'}。`, `  洞口：${plan.openings.filter(o => o.wall === w.id).map(o => `${o.id}/${o.kind}，offset=${o.offset}，宽=${o.width}，洞底=${lengthUnit(o.sill)}，洞顶=${lengthUnit(o.head)}`).join('；') || '无'}。`)
    } else if (ref.type === 'opening') {
      const o = plan.openings.find(x => x.id === ref.id)
      if (!o) { lines.push(`- 洞口 ${ref.id}：不存在`); continue }
      const host = plan.walls.find(w => w.id === o.wall), s = host ? openingSpan(plan, o) : null, sides = roomsBesideWall(plan, o.wall)
      lines.push(`- 洞口 ${o.id} / ${o.kind}：宿主 ${o.wall}，offset=${o.offset}，宽 ${o.width}、高 ${lengthUnit(o.head - o.sill)}（洞底 ${lengthUnit(o.sill)}、洞顶 ${lengthUnit(o.head)}）；端点 ${s ? `${JSON.stringify(s.a)} → ${JSON.stringify(s.b)}` : '宿主不存在'}；两侧房间：${[...sides.positive, ...sides.negative].map(r => r.name).join('、') || '无'}。`)
    } else if (ref.type === 'beam') {
      const b = plan.beams.find(x => x.id === ref.id); lines.push(b ? `- 梁 ${b.id}：端点 ${JSON.stringify(b.a)} → ${JSON.stringify(b.b)}；宽 ${b.width}，梁底 ${lengthUnit(b.bottom)}。` : `- 梁 ${ref.id}：不存在`)
    } else if (ref.type === 'room') {
      const r = plan.rooms.find(x => x.id === ref.id); lines.push(r ? `- 房间 ${r.id} / ${r.name}：层高 ${lengthUnit(roomCeiling(plan, r))}，地面抬高 ${lengthUnit(r.floorOffset ?? 0)}，面积 ${(polygonArea(r.poly) / 1e6).toFixed(1)}㎡；顶点 ${JSON.stringify(r.poly)}。` : `- 房间 ${ref.id}：不存在`)
    } else {
      const names = { column: '柱', shaft: '管道井 / 烟道', stair: '楼梯', void: '挑空' }
      lines.push(element ? `- ${names[ref.type]} ${ref.id}：${JSON.stringify(element)}。` : `- ${names[ref.type]} ${ref.id}：不存在`)
    }
  }
  const related = new Set(refs.map(r => r.id))
  for (const o of [...plan.openings, ...original.openings]) {
    if (related.has(o.id)) related.add(o.wall)
    if (refs.some(r => r.type === 'wall' && r.id === o.wall)) related.add(o.id)
  }
  const pending = plan.changes.filter(c => c.status === 'pending' && [c.target, c.data?.id, c.data?.wall].some(id => typeof id === 'string' && (related.has(id) || [...related].some(r => r.startsWith(id + '~')))))
  lines.push('', '## 相关待确认改造', ...(pending.length ? pending.map(c => `- ${c.id}：${c.note || '未写说明'}（${c.op} ${c.type}，目标 ${c.target ?? c.data?.id ?? '未指定'}）；尚未确认，请勿重复追加。`) : ['无。']))
  const instructions: Record<string, string> = {
    original: '读图纠错直接改原始结构并在 evidence.confirmed 记确认（读图 2.8），不要把纠错写成改造；用户要拆改时先按改造 3.1 明确进入改造流程。纠错后重新 validate 并重出原始模型和图。',
    renovation: '追加 changes，承重墙、外墙、承重柱的拆、挪、削、降、改类型、开洞先问用户并写 confirm（改造 3.4）；改完 validate、apply、export --state renovated 并重出图（改造 3.6）。',
    compare: '对比视图只读；要改先说明是纠错还是改造（改造 3.1）。',
    decor: '装修写入 decor，Agent 新增或修改的装修项标 pending；不写入 changes。见装修篇（当前为占位，契约见 docs/format.md）。',
  }
  lines.push('', '## 用户原话', userText, '', instructions[mode])
  return lines.join('\n')
}
