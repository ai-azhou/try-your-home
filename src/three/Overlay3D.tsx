/**
 * 3D 热点的 DOM 覆盖层：每帧把 3D 点投到屏幕，直接改 DOM 的 transform。
 * 不用 drei <Html>（它每个热点一个 React 根，React 19 下增删时会报同步卸载的错），
 * 热点本身就是普通 React 组件，和 2D 用同一套 Hotspot。
 */
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { ReactNode } from 'react'

export interface Anchor { key: string; pos: [number, number, number] }

const els = new Map<string, HTMLElement>()
const v = new THREE.Vector3()

/** Canvas 内：投影并写位置 */
export function Projector({ anchors }: { anchors: Anchor[] }) {
  const { camera, size } = useThree()
  useFrame(() => {
    for (const a of anchors) {
      const el = els.get(a.key)
      if (!el) continue
      v.set(...a.pos).project(camera)
      const behind = v.z > 1
      const x = (v.x * 0.5 + 0.5) * size.width, y = (-v.y * 0.5 + 0.5) * size.height
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`
      el.style.visibility = behind ? 'hidden' : 'visible'
    }
  })
  return null
}

/** Canvas 外：一个绝对定位的点，内容自定 */
export function Pin({ id, children, pass }: { id: string; children: ReactNode; pass?: boolean }) {
  return (
    <div ref={el => { if (el) els.set(id, el); else els.delete(id) }}
      className={pass ? 'pointer-events-none absolute left-0 top-0' : 'pointer-events-none absolute left-0 top-0 [&_button]:pointer-events-auto'} style={{ visibility: 'hidden', willChange: 'transform' }}>
      {children}
    </div>
  )
}
