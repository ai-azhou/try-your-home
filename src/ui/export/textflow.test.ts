import { describe, expect, it } from 'vitest'
import { T, clampLines, wrap, type Ctx } from './canvas'
import { atomH, flow, splitAtom, type Atom, type Run } from './textflow'

/** 不用浏览器的量字：中文一个字 = 字号宽，其余 0.55 字号宽 */
function fakeCtx(): Ctx {
  const c = { font: '', fillStyle: '', textAlign: 'left', textBaseline: 'alphabetic', measureText: (s: string) => {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(c.font)?.[1] ?? 12)
    return { width: [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 0x2e80 ? size : size * 0.55), 0) }
  } }
  return c as unknown as Ctx
}
const ctx = fakeCtx()
const tx = (s: string, w = 200): Run => ({ kind: 'text', tok: T.body, lines: wrap(ctx, s, w, T.body), gap: 4 })
const atom = (...r: Run[]): Atom => ({ runs: r })
const words = (n: number) => '改造想法的说明文字'.repeat(n)
const textOf = (a: Atom[]) => a.flatMap(x => x.runs.flatMap(r => (r.kind === 'text' ? r.lines : []))).join('')

describe('wrap 避头尾', () => {
  const w = 120 // 10 个字
  it('所有行都不超过 maxW', () => {
    for (const s of ['砸掉卧室飘窗台，地面和房间平齐；窗洞不动。', '拆掉这段墙（X 3800–7000），连同阳台门', 'A'.repeat(80), '门高 2.10 m → 2.40 m，宽 800 mm']) {
      for (const l of wrap(ctx, s, w, T.body)) expect(ctx.measureText(l).width).toBeLessThanOrEqual(w + 0.01)
    }
  })
  it('标点不放行首，开括号不放行尾', () => {
    const ls = wrap(ctx, '一二三四五六七八九十，后面的文字（括号里的内容）结尾。', w, T.body)
    expect(ls.length).toBeGreaterThan(1)
    for (const l of ls) { expect(l).not.toMatch(/^[，。）]/); expect(l).not.toMatch(/（$/) }
  })
  it('数字和单位不分行', () => {
    for (const l of wrap(ctx, '一二三四五六七八 0.98 m 后面', 120, T.body)) expect(l).not.toMatch(/^m\b/)
  })
  it('千分位的数字不分行', () => {
    const ls = wrap(ctx, '第 2 列 1,400：挖洞', 50, T.body)
    expect(ls.some(l => l.includes('1,400'))).toBe(true)
  })
  it('内容一个字不少', () => {
    const s = '两卧之间卫生间南墙连同门北推 1000 做干湿分离；门在墙上的位置不变（待确认）。'
    expect(wrap(ctx, s, 90, T.body).join('').replace(/[\s ]/g, '')).toBe(s.replace(/\s/g, ''))
  })
  it('clampLines 只在超行时加省略号', () => {
    expect(clampLines(ctx, '短句', 200, T.body, 1)).toEqual(['短句'])
    const c = clampLines(ctx, words(9), 120, T.body, 2)
    expect(c).toHaveLength(2)
    expect(c[1].endsWith('…')).toBe(true)
  })
})

describe('右栏文字流', () => {
  const H = 300
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ item: i, number: i + 1, atoms: [atom(tx(`第${i}条${words(3)}`)), atom(tx(`补充${i}${words(2)}`))] }))

  it('放不下就接下一栏：不缩不丢、每栏不超高', () => {
    const src = items(9), cols = flow(src, [], H)
    expect(cols.length).toBeGreaterThan(1)
    for (const c of cols) expect(c.used).toBeLessThanOrEqual(H)
    expect(cols.flatMap(c => c.blocks).flatMap(b => b.atoms).map(a => textOf([a])).join('')).toBe(src.flatMap(s => s.atoms).map(a => textOf([a])).join(''))
  })
  it('放得下就一栏', () => {
    expect(flow(items(1), [], H)).toHaveLength(1)
  })
  it('跨栏的条目在下一栏标「接上页」，序号不变', () => {
    const cols = flow(items(9), [], H), conts = cols.flatMap(c => c.blocks).filter(b => b.cont)
    for (const b of conts) expect(b.number).toBe((b.item as number) + 1)
  })
  it('比整栏还高的一块按行拆，一行不丢', () => {
    const big = atom(tx(words(60)))
    expect(atomH(big)).toBeGreaterThan(H)
    const cols = flow([{ item: 0, number: 1, atoms: [big] }], [], H)
    expect(cols.length).toBeGreaterThan(1)
    for (const c of cols) expect(c.used).toBeLessThanOrEqual(H)
    expect(cols.flatMap(c => c.blocks).flatMap(b => b.atoms).map(a => textOf([a])).join('')).toBe(textOf([big]))
  })
  it('lead 只占第一栏', () => {
    const cols = flow(items(9), [tx('风格：奶油原木')], H)
    expect(cols[0].lead).toHaveLength(1)
    expect(cols.slice(1).every(c => !c.lead.length)).toBe(true)
  })
  it('splitAtom：一行都放不下时头为空', () => {
    expect(splitAtom(atom(tx(words(5))), 5)[0]).toBeNull()
  })
})
