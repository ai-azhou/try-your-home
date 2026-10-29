/**
 * 演示用「原始户型图」：按方案画一张开发商户型图风格的 SVG，转成 data URL 当底图。
 * 只给虚构示例用（问题卡的底图缩略图要有东西可看）；真实方案用用户导入的图。
 * 比例：10 mm / 像素，平面 (0,0) 在原图 (120,120)。
 */
import type { Plan } from '@/core/types'
import { labelPoint, polygonArea, wallFootprint } from '@/core/geometry'
import { isArc, polyPath, segmentRect, spanOf } from './geom'
import { solidIntervals } from './render-plan'

export function drawUnderlay(plan: Plan) {
  const W = 1200, H = 1120
  const parts: string[] = []
  // 墙：开发商图里墙一律涂黑，隔墙稍浅
  for (const w of plan.walls) {
    const fill = w.kind === 'partition' ? '#3a3a3a' : w.kind === 'glass' ? 'none' : w.kind === 'half' || w.kind === 'half-glass' ? '#8a8a8a' : '#161616'
    if (w.kind === 'glass') {
      for (const [a, b] of solidIntervals(plan, w)) {
        const r = segmentRect(w, a, b)
        parts.push(`<path d="${polyPath(r)}" fill="#fff" stroke="#222" stroke-width="10"/>`)
      }
      continue
    }
    const d = isArc(w) ? polyPath(wallFootprint(w)) : solidIntervals(plan, w).map(([a, b]) => polyPath(segmentRect(w, a, b))).join('')
    parts.push(`<path d="${d}" fill="${fill}"/>`)
  }
  // 门窗
  for (const o of plan.openings) {
    const s = spanOf(plan, o); if (!s) continue
    const t = s.wall.thickness, n = s.normal
    if (o.kind === 'door' && o.swing) {
      const hinge = o.swing.hinge === 'start' ? s.a : s.b, other = o.swing.hinge === 'start' ? s.b : s.a
      const side = o.swing.side, leafEnd: [number, number] = [hinge[0] + n[0] * side * o.width, hinge[1] + n[1] * side * o.width]
      parts.push(`<path d="M${hinge[0]} ${hinge[1]}L${leafEnd[0]} ${leafEnd[1]}" stroke="#222" stroke-width="16"/>`)
      const sweep = cross(sub(other, hinge), sub(leafEnd, hinge)) > 0 ? 1 : 0
      parts.push(`<path d="M${leafEnd[0]} ${leafEnd[1]}A${o.width} ${o.width} 0 0 ${sweep ? 0 : 1} ${other[0]} ${other[1]}" fill="none" stroke="#333" stroke-width="8"/>`)
    } else if (o.kind === 'sliding') {
      const r1 = segmentRect(s.wall, o.offset, o.offset + o.width * 0.55, t * 0.28)
      const r2 = segmentRect(s.wall, o.offset + o.width * 0.45, o.offset + o.width, t * 0.28)
      const sh = (r: [number, number][], k: number) => r.map(p => [p[0] + n[0] * k, p[1] + n[1] * k] as [number, number])
      parts.push(`<path d="${polyPath(sh(r1, t * 0.18))}${polyPath(sh(r2, -t * 0.18))}" fill="#fff" stroke="#222" stroke-width="8"/>`)
    } else if (o.kind !== 'doorway') {
      const r = segmentRect(s.wall, o.offset, o.offset + o.width)
      parts.push(`<path d="${polyPath(r)}" fill="#fff" stroke="#222" stroke-width="8"/>`)
      for (const k of [-0.17, 0.17]) {
        const a = [s.a[0] + n[0] * t * k, s.a[1] + n[1] * t * k], b = [s.b[0] + n[0] * t * k, s.b[1] + n[1] * t * k]
        parts.push(`<path d="M${a[0]} ${a[1]}L${b[0]} ${b[1]}" stroke="#222" stroke-width="6"/>`)
      }
    }
  }
  // 梁：虚线
  for (const b of plan.beams) {
    parts.push(`<path d="M${b.a[0]} ${b.a[1]}L${b.b[0]} ${b.b[1]}" stroke="#555" stroke-width="10" stroke-dasharray="120 80" fill="none"/>`)
  }
  // 房间名和面积
  for (const r of plan.rooms) {
    const p = labelPoint(r.poly), a = polygonArea(r.poly) / 1e6
    if (a < 2) { parts.push(`<text x="${p[0]}" y="${p[1] + 60}" font-size="150" text-anchor="middle" fill="#333">${r.name}</text>`); continue }
    parts.push(`<text x="${p[0]}" y="${p[1] - 30}" font-size="230" text-anchor="middle" fill="#1a1a1a" font-weight="600">${r.name}</text>`)
    parts.push(`<text x="${p[0]}" y="${p[1] + 220}" font-size="160" text-anchor="middle" fill="#555">${a.toFixed(1)}㎡</text>`)
  }
  // 尺寸链（上、左）
  const xs = [0, 3300, 5400, 9600], ys = [0, 2400, 3600, 7200]
  const dim = (horizontal: boolean, stops: number[], at: number) => {
    const o: string[] = []
    const P = (u: number, v: number) => horizontal ? `${u} ${v}` : `${v} ${u}`
    o.push(`<path d="M${P(stops[0], at)}L${P(stops[stops.length - 1], at)}" stroke="#666" stroke-width="8"/>`)
    for (const s of stops) o.push(`<path d="M${P(s - 60, at + 60)}L${P(s + 60, at - 60)}" stroke="#444" stroke-width="12"/>`)
    for (let i = 1; i < stops.length; i++) {
      const c = (stops[i] + stops[i - 1]) / 2, v = stops[i] - stops[i - 1]
      o.push(horizontal
        ? `<text x="${c}" y="${at - 90}" font-size="150" text-anchor="middle" fill="#444">${v}</text>`
        : `<text x="${at - 90}" y="${c}" font-size="150" text-anchor="middle" fill="#444" transform="rotate(-90 ${at - 90} ${c})">${v}</text>`)
    }
    return o.join('')
  }
  parts.push(dim(true, xs, -700), dim(false, ys, -700))
  // 指北
  parts.push(`<g transform="translate(10100 -600)"><circle r="260" fill="none" stroke="#333" stroke-width="12"/><path d="M0 -230L90 120L0 60L-90 120Z" fill="#222"/><text y="-300" font-size="150" text-anchor="middle" fill="#333">N</text></g>`)

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect width="${W}" height="${H}" fill="#fbfaf6"/>`
    + `<g transform="translate(120 120) scale(0.1)" font-family="PingFang SC, Hiragino Sans GB, sans-serif">${parts.join('')}</g>`
    + `<text x="${W - 40}" y="${H - 36}" font-size="15" text-anchor="end" fill="#999" font-family="PingFang SC, sans-serif">虚构户型 · 仅供演示</text>`
    + `</svg>`
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
}

const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1]]
const cross = (a: number[], b: number[]) => a[0] * b[1] - a[1] * b[0]
