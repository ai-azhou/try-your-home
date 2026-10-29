/**
 * 序号圆的排布：先放在锚点上，太近的两两推开（确定性、和输入顺序无关），推开的画引线回到锚点。
 * 保证同一张图里序号圆心两两间距 ≥ minGap（纸面 10mm）。
 */
import type { Rect } from './plan-draw'

export interface BadgeIn { n: number | string; anchor: [number, number]; /** 序号圆的起始位置（缺省在锚点上），比如放到洞口上方，不盖住洞口 */ start?: [number, number] }
export interface Placed extends BadgeIn { x: number; y: number }
export interface Layout { placed: Placed[]; ok: boolean; maxShift: number }

export function layoutBadges(items: BadgeIn[], bounds: Rect, minGap: number, radius = 12): Layout {
  const inset = radius + 4
  const clampX = (v: number) => Math.min(bounds.x + bounds.w - inset, Math.max(bounds.x + inset, v))
  const clampY = (v: number) => Math.min(bounds.y + bounds.h - inset, Math.max(bounds.y + inset, v))
  const pts = [...items].sort((a, b) => String(a.n).localeCompare(String(b.n), undefined, { numeric: true }))
    .map(it => ({ ...it, x: clampX((it.start ?? it.anchor)[0]), y: clampY((it.start ?? it.anchor)[1]) }))
  const need = minGap + 0.5
  const violations = () => {
    let v = 0
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < minGap) v++
    return v
  }
  for (let iter = 0; iter < 600 && violations(); iter++) {
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j]
      let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy)
      if (d >= need) continue
      if (d < 1e-6) { const ang = (j * 2.399963) % (Math.PI * 2); dx = Math.cos(ang); dy = Math.sin(ang); d = 1 } // 同一点：按黄金角错开
      const push = (need - Math.hypot(b.x - a.x, b.y - a.y)) / 2 + 0.2
      const ux = dx / d, uy = dy / d
      a.x = clampX(a.x - ux * push); a.y = clampY(a.y - uy * push)
      b.x = clampX(b.x + ux * push); b.y = clampY(b.y + uy * push)
    }
    // 轻轻拉回锚点，避免整体飘走
    if (iter % 4 === 3) for (const p of pts) { const g = p.start ?? p.anchor; p.x = clampX(p.x + (g[0] - p.x) * 0.01); p.y = clampY(p.y + (g[1] - p.y) * 0.01) }
  }
  const maxShift = Math.max(0, ...pts.map(p => Math.hypot(p.x - p.anchor[0], p.y - p.anchor[1])))
  return { placed: pts, ok: violations() === 0, maxShift }
}

export function minDistance(pts: { x: number; y: number }[]): number {
  let m = Infinity
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) m = Math.min(m, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y))
  return m
}
