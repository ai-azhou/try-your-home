/**
 * 整页画成一张图的基础件：A4 横版画布（2 倍像素）、字体、换行、胶囊、序号圆、斜纹。
 * 打印友好：白底、不用玻璃和光晕；拆 / 加 / 改除了颜色还靠线型区分（虚线 + 斜纹 / 实心 / 实线框）。
 */
/** A4 横版，按 CSS 像素排（1 px = 297/1123 mm），画布按 2 倍像素 */
export const PAGE = { w: 1123, h: 794, scale: 2, margin: 40 } as const

export const SANS = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif'
export const NUM = '"Manrope Variable", "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif'

/** 打印用色：和工具同一套（design.md §2.1），线和字的对比度够 */
export const K = {
  paper: '#ffffff',
  ink: '#16191e',
  ink800: '#262a31',
  ink700: '#3b4048',
  ink600: '#535962',
  ink500: '#6c727c',
  ink400: '#8e949d',
  ink300: '#b3b8c0',
  ink200: '#d3d7dd',
  ink100: '#e9ebee',
  ink50: '#f5f6f8',
  coral: '#e8604f',
  coralDeep: '#c4402f',
  coralTint: '#fde3df',
  cobalt: '#4b76f2',
  cobaltDeep: '#2f56cf',
  cobaltTint: '#dfe8ff',
  lav: '#8a72ef',
  lavTint: '#ece8fe',
  mint: '#55d3a5',
  mintDeep: '#12825e',
  sky: '#4fa3d8',
  skyFill: '#e1f1fb',
  wallExt: '#3c424b',
  wallBearing: '#1f232a',
  wallPart: '#adb3bc',
  hair: '#dfe2e7',
} as const

export type Ctx = CanvasRenderingContext2D

/**
 * 字阶：全部页面只用这几档（页面 px，1 px = 0.75 pt），同一类文字每页一样大；放不下就翻页，不缩字号。
 * 最小 10.5 px ≈ 8 pt，打印还看得清。lh = 行高，排版都按行盒的顶算（lines）。
 */
export const T = {
  h1: { size: 22, lh: 28, weight: 600, color: K.ink },
  h2: { size: 14, lh: 20, weight: 600, color: K.ink },
  title: { size: 13, lh: 20, weight: 600, color: K.ink },
  body: { size: 12, lh: 19, weight: 400, color: K.ink700 },
  strong: { size: 12, lh: 19, weight: 600, color: K.ink800 },
  caption: { size: 11, lh: 16, weight: 500, color: K.ink500 },
  micro: { size: 10.5, lh: 14, weight: 500, color: K.ink500 },
} as const
export type Tok = { size: number; lh: number; weight: number; color: string; family?: string }

export function newPage(): { canvas: HTMLCanvasElement; ctx: Ctx } {
  const canvas = document.createElement('canvas')
  canvas.width = PAGE.w * PAGE.scale
  canvas.height = PAGE.h * PAGE.scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(PAGE.scale, PAGE.scale)
  ctx.fillStyle = K.paper
  ctx.fillRect(0, 0, PAGE.w, PAGE.h)
  ctx.textBaseline = 'alphabetic'
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  return { canvas, ctx }
}

export interface TextStyle { size: number; weight?: number; color?: string; family?: string; align?: CanvasTextAlign; baseline?: CanvasTextBaseline; letter?: number }
export function font(ctx: Ctx, s: TextStyle) {
  ctx.font = `${s.weight ?? 400} ${s.size}px ${s.family ?? SANS}`
  ctx.fillStyle = s.color ?? K.ink
  ctx.textAlign = s.align ?? 'left'
  ctx.textBaseline = s.baseline ?? 'alphabetic'
  ;(ctx as unknown as { letterSpacing: string }).letterSpacing = `${s.letter ?? 0}px`
}
export function text(ctx: Ctx, str: string, x: number, y: number, s: TextStyle): number {
  font(ctx, s)
  ctx.fillText(str, x, y)
  const w = ctx.measureText(str).width
  ;(ctx as unknown as { letterSpacing: string }).letterSpacing = '0px'
  return w
}
export function measure(ctx: Ctx, str: string, s: TextStyle): number {
  font(ctx, s)
  const w = ctx.measureText(str).width
  ;(ctx as unknown as { letterSpacing: string }).letterSpacing = '0px'
  return w
}

/** 行首不放的标点、行尾不放的开括号（避头尾） */
const NO_START = /^[，。、；：！？）」』》〉,.;:!?)\]}%·…—]/
const NO_END = /[（「『《〈(\[{]$/
const WORD = "A-Za-z0-9.,\\-+/×→~%°'\"\\u00a0"
const TOKEN = new RegExp(`[${WORD}]+|\\s+|.`, 'gu'), LAST_TOKEN = new RegExp(`(?:[${WORD}]+|.)$`, 'u')
/** 中文按字、拉丁和数字按词断行；避头尾时把上一行的字带下来，所有行都不超过 maxW */
export function wrap(ctx: Ctx, str: string, maxW: number, s: TextStyle): string[] {
  font(ctx, s)
  const fits = (v: string) => ctx.measureText(v).width <= maxW
  // 一个词比整行还长（长编号、长英文）：只能逐字断
  const glued = str.replace(/(\d) (mm|m|㎡)(?![A-Za-z])/g, '$1\u00a0$2') // 数字和单位不分行
  const tokens = (glued.match(TOKEN) ?? []).flatMap(tok => (fits(tok) ? [tok] : [...tok]))
  const lines: string[] = []
  let line = ''
  for (const tok of tokens) {
    const next = line + tok
    if (fits(next) || !line.trim()) { line = next; continue }
    let carry = ''
    if (NO_START.test(tok)) { carry = line.match(LAST_TOKEN)?.[0] ?? ''; line = line.slice(0, line.length - carry.length) }
    while (NO_END.test(line.trimEnd())) { const t = line.trimEnd(), ch = t.slice(-1); carry = ch + carry; line = t.slice(0, -1) }
    if (line.trim()) lines.push(line.trimEnd())
    line = (carry + tok).trimStart()
  }
  if (line.trim()) lines.push(line.trimEnd())
  return lines
}
/** 按行盒画几行：top 是第一行行盒的顶，文字在行盒里垂直居中 */
export function lines(ctx: Ctx, strs: string[], x: number, top: number, t: Tok, align: CanvasTextAlign = 'left') {
  strs.forEach((l, i) => text(ctx, l, x, top + i * t.lh + t.lh / 2 + t.size * 0.36, { size: t.size, weight: t.weight, color: t.color, family: t.family, align }))
  return top + strs.length * t.lh
}
/** 按宽度换行，超过 maxLines 行时末尾加省略号（只给摘要、目录这类「详情在别处」的文字用） */
export function clampLines(ctx: Ctx, str: string, maxW: number, t: Tok, maxLines = 99): string[] {
  const all = wrap(ctx, str, maxW, t)
  if (all.length <= maxLines) return all
  const out = all.slice(0, maxLines)
  let last = out[maxLines - 1]
  font(ctx, t)
  while (last.length > 1 && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1)
  out[maxLines - 1] = `${last}…`
  return out
}
/** 段落：返回画完后的 y（下一行的基线位置之前） */
export function para(ctx: Ctx, str: string, x: number, y: number, maxW: number, lh: number, s: TextStyle, maxLines = 99, dry = false): { y: number; lines: number } {
  let lines = wrap(ctx, str, maxW, s)
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines)
    let last = lines[maxLines - 1]
    font(ctx, s)
    while (last.length > 1 && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1)
    lines[maxLines - 1] = last + '…'
  }
  if (!dry) lines.forEach((l, i) => text(ctx, l, x, y + i * lh, s))
  return { y: y + lines.length * lh, lines: lines.length }
}

export function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/** 小胶囊标签：返回宽度 */
export function chip(ctx: Ctx, x: number, y: number, label: string, o: { fill?: string; stroke?: string; color?: string; dashed?: boolean; size?: number; weight?: number; h?: number; icon?: (cx: number, cy: number) => void; dry?: boolean } = {}): number {
  const size = o.size ?? 11, h = o.h ?? 20, padX = 8, iconW = o.icon ? 12 : 0
  const w = measure(ctx, label, { size, weight: o.weight ?? 600 }) + padX * 2 + iconW
  if (o.dry) return w
  rrect(ctx, x, y, w, h, h / 2)
  if (o.fill) { ctx.fillStyle = o.fill; ctx.fill() }
  if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = 1; ctx.setLineDash(o.dashed ? [3, 2.4] : []); ctx.stroke(); ctx.setLineDash([]) }
  if (o.icon) o.icon(x + padX + 4, y + h / 2)
  text(ctx, label, x + padX + iconW, y + h / 2 + size * 0.36, { size, weight: o.weight ?? 600, color: o.color ?? K.ink700 })
  return w
}

/** 锁图标（受保护） */
export function lockIcon(ctx: Ctx, cx: number, cy: number, s = 1, color: string = K.ink) {
  ctx.save()
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1.4 * s
  ctx.beginPath(); ctx.arc(cx, cy - 2.2 * s, 2.6 * s, Math.PI, 0); ctx.stroke()
  rrect(ctx, cx - 4 * s, cy - 2.2 * s, 8 * s, 6.4 * s, 1.4 * s); ctx.fill()
  ctx.restore()
}

/** 序号圆：墨底白字，黑白打印也清楚；anchor 不在圆心时画一根引线 + 锚点 */
export function badge(ctx: Ctx, x: number, y: number, n: number | string, o: { anchor?: [number, number]; d?: number; tone?: 'ink' | 'white' } = {}) {
  const d = o.d ?? 24, r = d / 2
  if (o.anchor && Math.hypot(o.anchor[0] - x, o.anchor[1] - y) > r + 2) {
    ctx.save()
    ctx.strokeStyle = K.ink; ctx.lineWidth = 1.2
    ctx.beginPath(); ctx.moveTo(o.anchor[0], o.anchor[1]); ctx.lineTo(x, y); ctx.stroke()
    ctx.fillStyle = K.paper; ctx.beginPath(); ctx.arc(o.anchor[0], o.anchor[1], 3.6, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = K.ink; ctx.beginPath(); ctx.arc(o.anchor[0], o.anchor[1], 2.4, 0, Math.PI * 2); ctx.fill()
    ctx.restore()
  }
  ctx.save()
  // 白边把序号和底下的墙线分开
  ctx.fillStyle = K.paper; ctx.beginPath(); ctx.arc(x, y, r + 2.2, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = o.tone === 'white' ? K.paper : K.ink; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
  if (o.tone === 'white') { ctx.strokeStyle = K.ink; ctx.lineWidth = 1.6; ctx.stroke() }
  const label = String(n), size = label.length > 2 ? d * 0.4 : label.length > 1 ? d * 0.5 : d * 0.56
  text(ctx, label, x, y + size * 0.36, { size, weight: 750, family: NUM, align: 'center', color: o.tone === 'white' ? K.ink : K.paper })
  ctx.restore()
}

/** 斜纹 / 点纹（按 2 倍像素画瓦片，再缩回页面坐标，打印不糊） */
const patCache = new Map<string, HTMLCanvasElement>()
export function pattern(ctx: Ctx, kind: 'coral' | 'bearing' | 'bearingMuted' | 'half' | 'halfMuted' | 'platform' | 'lav' | 'ground'): CanvasPattern {
  let tile = patCache.get(kind)
  if (!tile) {
    const spec = {
      coral: { s: 7, bg: 'rgba(253,227,223,0.55)', fg: '#e8604f', w: 1.3, a: 1 },
      bearing: { s: 5, bg: '#1f232a', fg: '#59606b', w: 1.3, a: 1 },
      bearingMuted: { s: 5, bg: '#b4b9c0', fg: '#d0d3d8', w: 1.3, a: 1 },
      half: { s: 5, bg: '#e3e6ea', fg: '#8e949d', w: 0, a: 0 },
      halfMuted: { s: 5, bg: '#eff0f2', fg: '#c6cad0', w: 0, a: 0 },
      platform: { s: 8, bg: '#f7f8f9', fg: '#dfe2e6', w: 1, a: 1 },
      lav: { s: 7, bg: 'rgba(236,232,254,0.9)', fg: '#a693f6', w: 1.3, a: 1 },
      ground: { s: 6, bg: '#ffffff', fg: '#9aa0a8', w: 0.9, a: 1 },
    }[kind]
    const S = PAGE.scale, n = spec.s * S
    tile = document.createElement('canvas')
    tile.width = tile.height = n
    const g = tile.getContext('2d')!
    g.fillStyle = spec.bg; g.fillRect(0, 0, n, n)
    if (spec.a) {
      g.strokeStyle = spec.fg; g.lineWidth = spec.w * S
      for (const o of [-n, 0, n]) { g.beginPath(); g.moveTo(o, n); g.lineTo(o + n, 0); g.stroke() }
    } else {
      g.fillStyle = spec.fg; g.beginPath(); g.arc(n / 2, n / 2, 1.05 * S, 0, Math.PI * 2); g.fill()
    }
    patCache.set(kind, tile)
  }
  const p = ctx.createPattern(tile, 'repeat')!
  p.setTransform(new DOMMatrix().scale(1 / PAGE.scale))
  return p
}

/** 竖向高度标注：一条线 + 两端短横 + 数字胶囊 */
export function vdim(ctx: Ctx, x: number, y0: number, y1: number, label: string, o: { color?: string; strong?: boolean; side?: 'left' | 'right'; prefix?: string } = {}) {
  const col = o.color ?? (o.strong ? K.ink : K.ink600)
  ctx.save()
  ctx.strokeStyle = col; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke()
  ctx.lineWidth = 1.3
  for (const y of [y0, y1]) { ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.stroke() }
  const str = (o.prefix ? o.prefix + ' ' : '') + label
  const w = measure(ctx, str, { size: 10.5, weight: 700, family: NUM }) + 12
  const cy = (y0 + y1) / 2, side = o.side ?? 'right'
  const bx = side === 'right' ? x + 6 : x - 6 - w
  rrect(ctx, bx, cy - 9, w, 18, 9)
  ctx.fillStyle = o.strong ? K.ink : K.paper; ctx.fill()
  if (!o.strong) { ctx.strokeStyle = col; ctx.lineWidth = 0.9; ctx.stroke() }
  text(ctx, str, bx + w / 2, cy + 3.8, { size: 10.5, weight: 700, family: NUM, align: 'center', color: o.strong ? K.paper : col })
  ctx.restore()
}

/** 图框：白底 + 发丝线 + 左上角标签 */
export function panel(ctx: Ctx, x: number, y: number, w: number, h: number, label?: string, o: { tone?: 'ink' | 'plain'; right?: string } = {}) {
  rrect(ctx, x, y, w, h, 16)
  ctx.fillStyle = K.paper; ctx.fill()
  ctx.strokeStyle = K.hair; ctx.lineWidth = 1; ctx.stroke()
  if (label) {
    const ink = o.tone === 'ink'
    chip(ctx, x + 12, y + 11, label, { fill: ink ? K.ink : K.ink50, color: ink ? K.paper : K.ink700, size: 11.5, weight: 650, h: 21, stroke: ink ? undefined : K.ink200 })
  }
  if (o.right) lines(ctx, [o.right], x + w - 16, y + 13, T.caption, 'right')
}

/** 页眉：左边标识 + 文档名 + 页标题，右边一块（图例或口吻）；标题放不下就省略，不压右边 */
export function pageHead(ctx: Ctx, o: { mark: (x: number, y: number, s: number) => void; kicker: string; title: string; rightW?: number }) {
  const x = PAGE.margin + 36, maxW = PAGE.w - PAGE.margin - x - (o.rightW ? o.rightW + 24 : 0)
  o.mark(PAGE.margin, 40, 26)
  lines(ctx, clampLines(ctx, o.kicker, maxW, T.caption, 1), x, 38, T.caption)
  lines(ctx, clampLines(ctx, o.title, maxW, T.h1, 1), x, 56, T.h1)
  ctx.fillStyle = K.ink100; ctx.fillRect(PAGE.margin, 96, PAGE.w - 2 * PAGE.margin, 1)
}
/** 页眉右边那块的垂直中线：和页标题同一行 */
export const HEAD_RIGHT_Y = 70
