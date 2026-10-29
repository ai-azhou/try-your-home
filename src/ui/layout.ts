import { useEffect, useState } from 'react'
import { useStore } from './store'

/** 断点：< 768 走手机布局（底部抽屉 + 底部工具坞）。桌面优先，390 宽不崩。 */
export function useIsMobile() {
  const q = '(max-width: 767px)'
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches)
  useEffect(() => {
    const mq = window.matchMedia(q)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return m
}

export interface Insets { top: number; right: number; bottom: number; left: number }
export interface Rect { x0: number; y0: number; x1: number; y1: number }

export const PIP = { w: 312, h: 216, mw: 108, mh: 108 }

/** 画中画小窗的位置（Stage 和适配共用）。桌面上工具栏太高时往右让开 pipShift */
export function pipRect(W: number, H: number, mobile: boolean, shift = useStore.getState().pipShift): Rect {
  return mobile
    ? { x0: W - 12 - PIP.mw, y0: 118, x1: W - 12, y1: 118 + PIP.mh }
    : { x0: 20 + shift, y0: H - 20 - PIP.h, x1: 20 + shift + PIP.w, y1: H - 20 }
}

/**
 * 四周浮卡占的区域：DOM 里带 data-float 的元素（顶栏各块、标题、工具栏、下一步条、缩放条）实测，
 * 再加上固定预留：画中画、右侧卡（桌面，无论此刻有没有卡都预留，避免选中时画面跳）、底部下一步条带。
 */
export function obstacles(W: number, H: number, mobile: boolean): Rect[] {
  const out: Rect[] = [pipRect(W, H, mobile)]
  if (typeof document !== 'undefined') {
    document.querySelectorAll<HTMLElement>('[data-float]').forEach(el => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) out.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom })
    })
  }
  if (mobile) {
    out.push({ x0: 0, y0: 0, x1: W, y1: 120 }) // 顶栏两行
    out.push({ x0: 0, y0: H - 156, x1: W, y1: H }) // 工具坞 + 下一步条
  } else {
    out.push({ x0: 0, y0: 0, x1: W, y1: 80 }) // 顶栏
    out.push({ x0: W - 20 - 372 - 8, y0: 80, x1: W, y1: H - 80 }) // 右侧卡
    out.push({ x0: W / 2 - 300, y0: H - 84, x1: W / 2 + 300, y1: H }) // 下一步条
  }
  return out
}

/**
 * 在不被任何浮卡压住的区域里，找能把 aspect（宽/高）的内容放得最大的矩形。
 * 候选边 = 屏幕边 + 每个障碍的四条边；障碍不到 15 个，穷举就够快。
 */
export function freeRect(W: number, H: number, mobile: boolean, aspect: number, gap = 10): Rect {
  const obs = obstacles(W, H, mobile).map(r => ({ x0: r.x0 - gap, y0: r.y0 - gap, x1: r.x1 + gap, y1: r.y1 + gap }))
  const xs0 = [0, ...obs.map(r => r.x1)].filter(v => v >= 0 && v < W), xs1 = [W, ...obs.map(r => r.x0)].filter(v => v > 0 && v <= W)
  const ys0 = [0, ...obs.map(r => r.y1)].filter(v => v >= 0 && v < H), ys1 = [H, ...obs.map(r => r.y0)].filter(v => v > 0 && v <= H)
  let best: Rect = { x0: 0, y0: 0, x1: W, y1: H }, score = -1
  for (const x0 of xs0) for (const x1 of xs1) {
    if (x1 - x0 < 80) continue
    for (const y0 of ys0) for (const y1 of ys1) {
      if (y1 - y0 < 80) continue
      if (obs.some(r => r.x0 < x1 && r.x1 > x0 && r.y0 < y1 && r.y1 > y0)) continue
      const s = Math.min((x1 - x0) / aspect, y1 - y0)
      if (s > score) { score = s; best = { x0, y0, x1, y1 } }
    }
  }
  return best
}

export const rectToInsets = (r: Rect, W: number, H: number): Insets => ({ left: r.x0, top: r.y0, right: W - r.x1, bottom: H - r.y1 })
