/**
 * 漫游时画中画平面上的站位：一个点 + 一把视野扇形，看得出人在哪、朝哪、视角多宽。
 * 每帧直接改 SVG（站位在 Canvas 里每帧变，不走 React）。坐标是平面 mm，k 把屏幕 px 换回来。
 */
import { useEffect, useRef } from 'react'
import { roamPose } from '../roam'

export function RoamMarker({ k }: { k: number }) {
  const g = useRef<SVGGElement>(null), wedge = useRef<SVGPathElement>(null)
  const R = 40 / k
  useEffect(() => {
    let raf = 0, drawn = -1
    const tick = () => {
      const el = g.current, w = wedge.current, p = roamPose
      if (el) {
        el.style.display = p.ready ? '' : 'none'
        el.setAttribute('transform', `translate(${(p.x * 1000).toFixed(0)} ${(p.z * 1000).toFixed(0)}) rotate(${(-p.yaw * 180 / Math.PI).toFixed(1)})`)
      }
      if (w && Math.abs(p.hFov - drawn) > 0.3) {
        drawn = p.hFov
        const a = p.hFov / 2 * Math.PI / 180, x = R * Math.sin(a), y = -R * Math.cos(a)
        w.setAttribute('d', `M0 0L${-x} ${y}A${R} ${R} 0 0 1 ${x} ${y}Z`)
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [R])
  return (
    <g ref={g} pointerEvents="none" data-testid="roam-marker" style={{ display: 'none' }}>
      <path ref={wedge} fill="rgb(47 185 138 / 0.28)" stroke="#2fb98a" strokeWidth={1.2 / k} />
      <circle r={5 / k} fill="#16191e" stroke="#fff" strokeWidth={1.6 / k} />
    </g>
  )
}
