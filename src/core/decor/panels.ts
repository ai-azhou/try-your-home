import type { Plan, Vec2 } from '../types.ts'
import type { FaceSpan, Panel } from './types.ts'
import { faceAxis, faceFrame, faceRun, runS, DecorGeometryError } from './faces.ts'
import { difference, rectPoly, ordered } from './math.ts'
import type { ElevationRect } from './math.ts'

export function panelSpan(plan: Plan, panel: Panel): FaceSpan {
  if (panel.type !== 'arch' && panel.span) return panel.span
  const opening = plan.openings.find(o => o.id === panel.opening)
  if (!opening) throw new DecorGeometryError('host-missing', '拱形门套的原门洞不存在')
  // Draft has no side for arch: span.face supplies it optionally, otherwise +n.
  return { face: panel.span?.face ?? { wall: opening.wall, side: 1 }, s: [opening.offset, opening.offset + opening.width], z: [opening.sill, opening.head] }
}
export interface PanelGeometry { span: FaceSpan; rect: ElevationRect; polygons: Vec2[][][]; visiblePolygons: Vec2[][][]; grooves: [Vec2, Vec2][]; frames: Vec2[][][]; thickness: number }
/** Coordinates local to the panel's left edge (u mm), heights remain floor-relative m. */
export function panelGeometry(plan: Plan, panel: Panel): PanelGeometry {
  const span = panelSpan(plan, panel), f = faceFrame(plan, span), width = f.u[1] - f.u[0], rect: ElevationRect = { u: [0, width], z: span.z }
  let polygons: Vec2[][][] = [[rectPoly(rect)]]
  if (panel.type === 'arch') {
    const radius = Math.max(width / 2, panel.arch?.radius ?? width / 2), rise = radius - Math.sqrt(Math.max(0, radius * radius - width * width / 4)), base = span.z[1] - rise / 1000
    const curve: Vec2[] = Array.from({ length: 65 }, (_, i) => { const x = width * i / 64; return [x, base + (Math.sqrt(Math.max(0, radius * radius - (x - width / 2) ** 2)) - Math.sqrt(Math.max(0, radius * radius - width * width / 4))) / 1000] })
    const hole: Vec2[] = [[0, span.z[0]], [width, span.z[0]], ...curve.reverse()]
    polygons = difference(polygons, [[hole]])
  } else if (panel.type === 'slats') {
    const slat = panel.slats ?? { width: 30, gap: 30, depth: panel.thickness }
    if (!(slat.width > 0 && slat.gap >= 0)) throw new DecorGeometryError('invalid', '格栅条宽须为正、间隙不能为负')
    polygons = []
    for (let x = 0; x < width; x += slat.width + slat.gap) polygons.push([rectPoly({ u: [x, Math.min(width, x + slat.width)], z: span.z })])
  }
  const cuts: Vec2[][][] = []
  if (panel.type !== 'arch' && panel.avoid !== 'none') for (const part of faceRun(plan, span.face)) for (const o of plan.openings.filter(o => o.wall === part.wall.id)) {
    const u = ordered(f.toU(runS(part, o.offset)), f.toU(runS(part, o.offset + o.width)))
    cuts.push([rectPoly({ u: [u[0] - f.u[0], u[1] - f.u[0]], z: [o.sill, o.head] })])
  }
  polygons = difference(polygons, cuts)
  // Front-view holes include both blind and through recesses; solid generation retains blind backs.
  const fronts = (plan.decor?.recesses ?? []).filter(r => 'panel' in r.host && r.host.panel === panel.id && r.rect.u)
  const visible = difference(polygons, fronts.map(r => [rectPoly({ u: r.rect.u!, z: r.rect.z })]))
  const grooves: [Vec2, Vec2][] = []
  if (panel.grooves && panel.grooves.spacing > 0) {
    const g = panel.grooves, vertical = g.dir === 'v', start = vertical ? 0 : span.z[0], end = vertical ? width : span.z[1], step = vertical ? g.spacing : g.spacing / 1000
    // Intersect line with visible polygon boundaries, so joints never run across a window/hole.
    for (let v = start + step; v < end; v += step) for (const rings of visible) {
      const hits: number[] = []
      for (const ring of rings) ring.forEach((a, i) => { const b = ring[(i + 1) % ring.length], axis = vertical ? 0 : 1, other = 1 - axis; if ((a[axis] <= v && b[axis] > v) || (b[axis] <= v && a[axis] > v)) hits.push(a[other] + (v - a[axis]) / (b[axis] - a[axis]) * (b[other] - a[other])) })
      hits.sort((a, b) => a - b)
      for (let i = 1; i < hits.length; i += 2) grooves.push(vertical ? [[v, hits[i - 1]], [v, hits[i]]] : [[hits[i - 1], v], [hits[i], v]])
    }
  }
  let frames: Vec2[][][] = []
  if (panel.frame) {
    const m = panel.frame.margin, inner: ElevationRect = { u: [m, width - m], z: [span.z[0] + m / 1000, span.z[1] - m / 1000] }
    if (inner.u[1] > inner.u[0] && inner.z[1] > inner.z[0]) frames = difference([[rectPoly(inner)]], [[rectPoly({ u: [inner.u[0] + 18, inner.u[1] - 18], z: [inner.z[0] + .018, inner.z[1] - .018] })]])
    frames = difference(frames, [...cuts, ...fronts.map(r => [rectPoly({ u: r.rect.u!, z: r.rect.z })])])
  }
  return { span, rect, polygons, visiblePolygons: visible, grooves, frames, thickness: panel.type === 'slats' ? panel.slats?.depth ?? panel.thickness : panel.thickness }
}
export function panelTransform(plan: Plan, panel: Panel) {
  const span = panelSpan(plan, panel), axis = faceAxis(plan, span.face), u0 = Math.min(...span.s.map(axis.toU))
  return (u: number, depth: number) => axis.at(axis.toS(u0 + u), depth)
}
