import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parsePlanText, serializePlan } from '../core/io.ts'
import { analysePaste, chatIssuesText, chatPlanText, extractPlanJson, failedChatText, keepUnderlays, truncatedChatText, CHAT_FIRST_LINE, SIMPLE_FIRST_LINE } from './chat-text.ts'
import { CHAT_REPLY_TAIL, SIMPLE_RULES, SIMPLE_TEMPLATE, simpleFormatChatText } from '../core/simple.ts'

const v3 = serializePlan(parsePlanText(readFileSync(new URL('../../fixtures/example-v2.json', import.meta.url), 'utf8')).plan)

describe('extractPlanJson', () => {
  it('去掉说明文字和代码块标记', () => {
    const r = extractPlanJson(`好的，这是方案：\n\n\`\`\`json\n${v3}\`\`\`\n\n说明：我把 {客厅} 合并了。`)
    expect(r.kind).toBe('ok')
    if (r.kind === 'ok') expect(JSON.parse(r.json).title).toBe('虚构冒烟户型')
  })
  it('多个代码块取最大的', () => {
    const r = extractPlanJson(`先看小的：\n\`\`\`json\n{"a":1}\n\`\`\`\n方案：\n\`\`\`\n${v3}\`\`\`\n`)
    expect(r.kind === 'ok' && JSON.parse(r.json).format).toBe('floorplan-structure')
  })
  it('没有代码块：整段里找最大的对象', () => {
    const r = extractPlanJson(`比如 {x} 这种。\n${v3}\n就这样`)
    expect(r.kind).toBe('ok')
  })
  it('截断：报不完整和位置', () => {
    const cut = v3.slice(0, 1234)
    const r = extractPlanJson('```json\n' + cut)
    expect(r.kind).toBe('incomplete')
    if (r.kind === 'incomplete') { expect(r.at).toBe(cut.trimEnd().length); expect(truncatedChatText(r.at)).toContain(`第 ${r.at} 个字符`) }
  })
  it('注释、结尾逗号自动修掉', () => {
    const r = extractPlanJson('```json\n{"a": 1, // 注释\n "b": [1,2,],}\n```')
    expect(r.kind === 'ok' && r.repaired).toBe(true)
  })
  it('找不到', () => expect(extractPlanJson('没有 JSON').kind).toBe('none'))
})

describe('chatIssuesText', () => {
  it('几何错误写清墙、洞口和差多少（mm）', () => {
    const j = JSON.parse(v3); j.openings[0].offset = 6000
    const r = analysePaste('```json\n' + JSON.stringify(j) + '\n```')
    expect(r.fatal).toMatch(/几何/)
    const text = chatIssuesText({ plan: r.parsed!.plan, issues: r.parsed!.issues, raw: r.raw, note: '客厅南墙的窗位置不对' })
    expect(text.split('\n')[0]).toBe(CHAT_FIRST_LINE)
    expect(text).toContain(`洞口 ${j.openings[0].id}`)
    expect(text).toMatch(/墙长 \d+ mm，洞口 offset 6000 mm/)
    expect(text).toContain('## 各房间面积')
    expect(text).toContain('客厅南墙的窗位置不对')
  })
  it('格式错误写字段路径和构件 id', () => {
    const j = JSON.parse(v3); j.walls[1].thickness = 'x'
    const r = analysePaste(JSON.stringify(j))
    const text = chatIssuesText({ plan: null, issues: r.parsed!.issues, raw: r.raw })
    expect(text).toContain(`walls[1].thickness（墙 ${j.walls[1].id}）`)
    expect(text).toContain('必须是数字')
  })
})

describe('底图', () => {
  const data = 'data:image/png;base64,iVBORw0KGgo='
  it('复制方案给 Chat：不带 data:image', () => {
    const p = parsePlanText(v3).plan
    p.underlay = { ...p.underlay!, src: data }
    const text = chatPlanText(p, { main: 'home.png' })
    expect(text).not.toContain('data:image')
    expect(text).toContain('"src":"home.png"')
    expect(analysePaste(text).fatal).toBeNull()
  })
  it('第二轮粘贴沿用当前底图图片、用新方案的比例', () => {
    const cur = parsePlanText(v3).plan; cur.underlay = { ...cur.underlay!, src: data, mmPerPx: 10 }
    const next = parsePlanText(v3).plan; next.underlay = { ...next.underlay!, src: 'home.png', mmPerPx: 12.5, origin: [7, 8] }
    const { plan, kept } = keepUnderlays(next, cur)
    expect(plan.underlay).toMatchObject({ src: data, mmPerPx: 12.5, origin: [7, 8] })
    expect(kept).toEqual([{ key: 'main', name: 'home.png' }])
  })
})

describe('D7 简版：粘贴的三种情况', () => {
  const weak = '{"floorplan-structure":"version 3","layout":{"rooms":[{"name":"客厅","poly":[[0,0],[5000,0],[5000,4000],[0,4000]],"area":20,"type":"living"}],"walls":[],"doors":[{"from":"客厅","to":"卧室"}]}}'
  it('简版能转换：可以载入，带 simple 标记', () => {
    const r = analysePaste('好的：\n```json\n' + SIMPLE_TEMPLATE + '\n```')
    expect(r.fatal).toBeNull()
    expect(r.simple).toBe(true)
    expect(r.parsed?.report.source).toBe('simple')
    expect(r.parsed?.plan.openings.length).toBe(4)
    expect(r.parsed?.plan.walls.length).toBeGreaterThan(0)
  })
  it('简版有阻断错误：不载入；复制的文字第一行固定，附 core 的规则和模板', () => {
    const bad = JSON.parse(SIMPLE_TEMPLATE); bad.rooms[0].poly = [[0, 0], [3600, 0]]
    const r = analysePaste(JSON.stringify(bad))
    expect(r.fatal).toBeTruthy()
    expect(r.simple).toBe(true)
    expect(r.shape).toBeUndefined()
    const text = failedChatText(r, '主卧画错了')
    expect(text.split('\n')[0]).toBe(SIMPLE_FIRST_LINE)
    expect(text).toContain('rooms[0]（主卧）.poly：至少要 3 个点')
    expect(text).toContain(SIMPLE_TEMPLATE)
    for (const rule of SIMPLE_RULES) expect(text).toContain(rule)
    expect(text).toContain('主卧画错了')
  })
  it('格式根本不对：不载入，不列字段错误，复制 core 的简版模板文字', () => {
    const r = analysePaste('```json\n' + weak + '\n```')
    expect(r.fatal).toBe('shape')
    expect(r.shape?.length).toBeGreaterThan(0)
    const text = failedChatText(r)
    expect(text.trimEnd()).toBe(simpleFormatChatText(r.shape!).trimEnd())
    expect(text).toContain('floorplan-simple')
    expect(text).toContain(CHAT_REPLY_TAIL)
  })
  it('rooms 有、walls 空的 v3 也按格式不对拦下；合法 v3 不受影响', () => {
    const roomsOnly = JSON.parse(v3); roomsOnly.walls = []; roomsOnly.openings = []
    expect(analysePaste(JSON.stringify(roomsOnly)).fatal).toBe('shape')
    const ok = analysePaste(v3)
    expect(ok.fatal).toBeNull()
    expect(ok.shape).toBeUndefined()
    expect(ok.simple).toBe(false)
  })
  it('根本不是方案的 JSON（B8）：说「不像是方案」，不给简版模板', () => {
    const camera = { projection: 'orthographic', id: 'top', pos: [0, 30000, 6000], format: 'floorplan-camera', version: 1, unit: 'mm' }
    for (const input of [camera, { walls: 14, rooms: 7, netArea: 80.2 }, {}]) {
      const r = analysePaste('```json\n' + JSON.stringify(input) + '\n```')
      expect(r.fatal).toBe('empty')
      expect(r.shape).toBeUndefined()
    }
  })
})

describe('复制给 Chat 的文字都用 core 的收尾', () => {
  it('不写「只输出一个」，结尾指回 try-your-home', () => {
    const p = parsePlanText(v3).plan
    const weak = analysePaste('{"floorplan-structure":"version 3","layout":{"rooms":[{"name":"客厅","poly":[[0,0],[5000,0],[5000,4000],[0,4000]]}],"walls":[]}}')
    const texts = [truncatedChatText(1999), chatIssuesText({ plan: p, issues: [] }), chatPlanText(p), failedChatText(weak)]
    for (const t of texts) {
      expect(t.trimEnd().endsWith(CHAT_REPLY_TAIL)).toBe(true)
      expect(t).not.toContain('只输出一个')
    }
    expect(analysePaste(chatPlanText(p)).fatal).toBeNull()
  })
})
