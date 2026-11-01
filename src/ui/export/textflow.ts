/**
 * 右栏文字排版：把条目拆成一块块（Atom），按真实高度流进栏里，放不下就接到下一张同样的页。
 * 版式对标 Web 列表：序号在左边单独一栏，文字左对齐一条线；标题 → 正文 → 变化 → 标签 → 提示，字阶固定（canvas.ts 的 T），
 * 间距固定（同一条里 4 / 8，条目之间 16 + 分隔线 + 16）。不缩字号、不截断，内容一个字都不丢。
 * Atom 是不拆开的最小块（一处改动的标题连它的说明）；只有一块比整栏还高时，才按行拆。
 */
import { K, T, badge, lines, lockIcon, rrect, wrap, type Ctx, type Tok } from './canvas'

/** 序号那一栏的宽；BAR = 说明文字相对竖线缩进多少 */
export const GUTTER_L = 34, BAR = 10
const BADGE_D = 22
const ITEM_GAP = 16, ATOM_GAP = 12, CONT_H = 20, LEAD_GAP = 12

export type Run =
  | { kind: 'text'; tok: Tok; lines: string[]; gap: number; bar?: string; indent?: number }
  | { kind: 'custom'; h: number; gap: number; draw(ctx: Ctx, x: number, y: number, w: number): void }
export interface Atom { runs: Run[] }
export interface FlowItem<T> { item: T; number: number | string; atoms: Atom[] }
export interface FlowBlock<T> { item: T; number: number | string; atoms: Atom[]; cont: boolean }
export interface FlowCol<T> { lead: Run[]; blocks: FlowBlock<T>[]; used: number }

export const runH = (r: Run) => r.kind === 'text' ? r.lines.length * r.tok.lh : r.h
export const atomH = (a: Atom) => a.runs.reduce((h, r, i) => h + runH(r) + (i ? r.gap : 0), 0)
const leadH = (lead: Run[]) => lead.length ? atomH({ runs: lead }) + LEAD_GAP * 2 + 1 : 0

/** 灰底提示条：受保护的墙（只陈述图上的标注） */
export function alertRun(ctx: Ctx, msg: string, w: number, gap: number): Run {
  const textW = w - 32, ls = wrap(ctx, msg, textW, T.caption), h = ls.length * T.caption.lh + 12
  return { kind: 'custom', h, gap, draw(c, x, y) {
    rrect(c, x, y, w, h, 8); c.fillStyle = K.ink50; c.fill(); c.strokeStyle = K.ink200; c.lineWidth = 1; c.stroke()
    lockIcon(c, x + 13, y + 6 + T.caption.lh / 2, 0.9)
    lines(c, ls, x + 24, y + 6, { ...T.caption, color: K.ink800 })
  } }
}

/** 把一块拆成「这一栏放得下的头」和「剩下的」；一行都放不下时头为 null */
export function splitAtom(a: Atom, room: number): [Atom | null, Atom] {
  const head: Run[] = []
  let used = 0
  for (const [i, r] of a.runs.entries()) {
    const gap = head.length ? r.gap : 0
    if (used + gap + runH(r) <= room) { head.push(r); used += gap + runH(r); continue }
    const rest = a.runs.slice(i + 1)
    if (r.kind === 'text') {
      const n = Math.floor((room - used - gap) / r.tok.lh)
      if (n > 0) {
        head.push({ ...r, lines: r.lines.slice(0, n) })
        return [{ runs: head }, { runs: [{ ...r, lines: r.lines.slice(n), gap: 0 }, ...rest] }]
      }
    }
    return [head.length ? { runs: head } : null, { runs: [r, ...rest] }]
  }
  return [{ runs: head }, { runs: [] }]
}

/** 流进若干栏，每栏高 height；lead 只放在第一栏顶上 */
export function flow<T>(items: FlowItem<T>[], lead: Run[], height: number): FlowCol<T>[] {
  const cols: FlowCol<T>[] = [{ lead, blocks: [], used: leadH(lead) }]
  let col = cols[0]
  const open = () => { col = { lead: [], blocks: [], used: 0 }; cols.push(col) }
  for (const it of items) {
    const queue = [...it.atoms]
    let block: FlowBlock<T> | null = null, started = false
    while (queue.length) {
      const atom = queue.shift()!
      if (!atom.runs.length) continue
      const fresh = !block, cont = fresh && started
      const sep = fresh ? (col.blocks.length ? ITEM_GAP * 2 + 1 : 0) : ATOM_GAP
      const head = cont ? CONT_H : 0, h = atomH(atom)
      const place = (a: Atom, ah: number) => {
        if (!block) { block = { item: it.item, number: it.number, atoms: [], cont }; col.blocks.push(block) }
        block.atoms.push(a); col.used += sep + head + ah; started = true
      }
      if (col.used + sep + head + h <= height) { place(atom, h); continue }
      if (head + h > height) {
        // 比整栏还高：先把这一栏剩下的地方填上，其余下一栏接着写
        const [a, b] = splitAtom(atom, height - col.used - sep - head)
        if (a) { place(a, atomH(a)); queue.unshift(b); block = null; open(); continue }
      }
      if (!col.blocks.length && col.used === 0) { place(atom, h); continue } // 兜底：空栏也放不下（不会发生），不死循环
      queue.unshift(atom); block = null; open()
    }
  }
  return cols
}

/** 画一栏，返回写到哪（e2e 用它断言没有超出栏底） */
export function drawCol<T>(ctx: Ctx, col: FlowCol<T>, x: number, y: number, w: number, contLabel: string): number {
  let yy = y
  const tx = x + GUTTER_L, tw = w - GUTTER_L
  if (col.lead.length) {
    yy = drawRuns(ctx, col.lead, x, yy, w) + LEAD_GAP
    ctx.fillStyle = K.ink100; ctx.fillRect(x, yy, w, 1)
    yy += 1 + LEAD_GAP
  }
  col.blocks.forEach((b, i) => {
    if (i) { yy += ITEM_GAP; ctx.fillStyle = K.ink100; ctx.fillRect(tx, yy, tw, 1); yy += 1 + ITEM_GAP }
    badge(ctx, x + BADGE_D / 2, yy + 10, b.number, { d: BADGE_D })
    if (b.cont) { lines(ctx, [contLabel], tx, yy + 2, T.caption); yy += CONT_H }
    b.atoms.forEach((a, k) => { if (k) yy += ATOM_GAP; yy = drawRuns(ctx, a.runs, tx, yy, tw) })
  })
  return yy
}

function drawRuns(ctx: Ctx, runs: Run[], x: number, top: number, w: number): number {
  let y = top
  runs.forEach((r, i) => {
    if (i) y += r.gap
    if (r.kind === 'custom') { r.draw(ctx, x, y, w); y += r.h; return }
    if (r.bar) { ctx.fillStyle = r.bar; ctx.fillRect(x, y + 2, 2, r.lines.length * r.tok.lh - 4) }
    y = lines(ctx, r.lines, x + (r.indent ?? 0), y, r.tok)
  })
  return y
}
