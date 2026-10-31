import pc from 'polygon-clipping'
import type { Vec2 } from '../types.ts'

export interface PathCommand { command: string; values: number[] }
export type ParsedPath = { commands: PathCommand[]; error?: never } | { commands?: never; error: string }
const arity: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 }
/** SVG path data only. Errors identify the expanded command, including implicit repeats. */
export function parsePath(d: string): ParsedPath {
  const commands: PathCommand[] = []
  const fail = (message: string): ParsedPath => ({ error: `第 ${commands.length + 1} 个命令：${message}` })
  if (typeof d !== 'string' || new TextEncoder().encode(d).length > 8192) return fail('路径必须是最多 8 KB 的 d 字符串')
  let i = 0, command = ''
  const ws = () => { while (/\s/.test(d[i] ?? '') && i < d.length) i++ }
  ws()
  while (i < d.length) {
    const explicit = /[a-z]/i.test(d[i])
    if (explicit) { command = d[i++]; if (!(command.toUpperCase() in arity)) return fail(`不支持字符 ${command}`) }
    else if (!command || command.toUpperCase() === 'Z') return fail('需要命令字母')
    const upper = command.toUpperCase(), n = arity[upper], values: number[] = []
    if (!commands.length && upper !== 'M') return fail('必须以 M 开始')
    for (let j = 0; j < n; j++) {
      ws()
      if (d[i] === ',') { if (j === 0 && explicit) return fail('命令后不能直接跟逗号'); i++; ws() }
      if (upper === 'A' && (j === 3 || j === 4)) {
        if (!/[01]/.test(d[i] ?? '') || i >= d.length) return fail('圆弧标志必须是 0 或 1')
        values.push(Number(d[i++])); continue
      }
      const m = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(d.slice(i))
      if (!m || !Number.isFinite(Number(m[0]))) return fail(`参数 ${j + 1} 需要有限数值`)
      values.push(Number(m[0])); i += m[0].length
    }
    if (upper === 'A' && (values[0] < 0 || values[1] < 0)) return fail('圆弧半径不能为负')
    commands.push({ command, values })
    if (upper === 'M') command = command === 'm' ? 'l' : 'L'
    ws()
    if (d[i] === ',') {
      if (upper === 'Z') return fail('Z 后不能跟逗号')
      i++; ws(); if (i === d.length || /[a-z,]/i.test(d[i])) return fail('逗号后需要坐标')
    }
  }
  return commands.length ? { commands } : fail('路径不能为空')
}
export interface FlatSubpath { points: Vec2[]; closed: boolean }
const mix = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])
function flatten(d: string, tol: number, limit: number): FlatSubpath[] {
  const parsed = parsePath(d)
  if (parsed.error !== undefined) throw new Error(parsed.error)
  if (!Number.isFinite(tol) || tol <= 0) throw new Error('tol 必须为正数')
  const paths: FlatSubpath[] = []
  let p: Vec2 = [0, 0], start: Vec2 = p, control: Vec2 = p, previous = '', path: FlatSubpath | undefined
  const push = (v: Vec2) => { path!.points.push(v); p = v }
  const curve = (a: Vec2, b: Vec2, c: Vec2, end: Vec2, depth = 0) => {
    // Control-polygon excess also catches collinear curves that double back.
    if (depth >= 10 || dist(a, b) + dist(b, c) + dist(c, end) - dist(a, end) <= tol / 4 && Math.max(dist(b, mix(a, end, 1 / 3)), dist(c, mix(a, end, 2 / 3))) <= tol) { push(end); return }
    const ab = mix(a, b, .5), bc = mix(b, c, .5), ce = mix(c, end, .5), abc = mix(ab, bc, .5), bce = mix(bc, ce, .5), mid = mix(abc, bce, .5)
    curve(a, ab, abc, mid, depth + 1); curve(mid, bce, ce, end, depth + 1)
  }
  for (const { command, values: v } of parsed.commands) {
    const k = command.toUpperCase(), relative = command !== k, origin = p
    const xy = (i: number): Vec2 => [v[i] + (relative ? origin[0] : 0), v[i + 1] + (relative ? origin[1] : 0)]
    if (k === 'M') { p = xy(0); start = p; path = { points: [p], closed: false }; paths.push(path) }
    else if (k === 'Z') { path!.closed = true; p = start }
    else {
      if (path!.closed) { path = { points: [p], closed: false }; paths.push(path); start = p }
      if (k === 'L') push(xy(0))
      else if (k === 'H') push([v[0] + (relative ? p[0] : 0), p[1]])
      else if (k === 'V') push([p[0], v[0] + (relative ? p[1] : 0)])
      else if (k === 'C' || k === 'S') {
        const b: Vec2 = k === 'C' ? xy(0) : ['C', 'S'].includes(previous) ? [2 * p[0] - control[0], 2 * p[1] - control[1]] : p
        const c = xy(k === 'C' ? 2 : 0), end = xy(k === 'C' ? 4 : 2)
        curve(p, b, c, end); control = c
      } else if (k === 'Q' || k === 'T') {
        const c: Vec2 = k === 'Q' ? xy(0) : ['Q', 'T'].includes(previous) ? [2 * p[0] - control[0], 2 * p[1] - control[1]] : p
        const end = xy(k === 'Q' ? 2 : 0); curve(p, mix(p, c, 2 / 3), mix(end, c, 2 / 3), end); control = c
      } else if (k === 'A') {
        const end = xy(5), phi = v[2] * Math.PI / 180, co = Math.cos(phi), si = Math.sin(phi)
        let rx = v[0], ry = v[1]
        if (!rx || !ry) push(end)
        else if (dist(p, end) > 1e-10) {
          const dx = (p[0] - end[0]) / 2, dy = (p[1] - end[1]) / 2, x = co * dx + si * dy, y = -si * dx + co * dy
          const scale = Math.sqrt(x * x / (rx * rx) + y * y / (ry * ry)); if (scale > 1) { rx *= scale; ry *= scale }
          const factor = (v[3] === v[4] ? -1 : 1) * Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * y * y - ry * ry * x * x) / (rx * rx * y * y + ry * ry * x * x)))
          const cx = factor * rx * y / ry, cy = -factor * ry * x / rx, center: Vec2 = [co * cx - si * cy + (p[0] + end[0]) / 2, si * cx + co * cy + (p[1] + end[1]) / 2]
          const a = Math.atan2((y - cy) / ry, (x - cx) / rx), b = Math.atan2((-y - cy) / ry, (-x - cx) / rx)
          let delta = b - a; if (!v[4] && delta > 0) delta -= 2 * Math.PI; if (v[4] && delta < 0) delta += 2 * Math.PI
          const steps = Math.min(255, Math.max(1, Math.ceil(Math.abs(delta) / (2 * Math.acos(Math.max(-1, 1 - tol / Math.max(rx, ry)))))))
          for (let j = 1; j <= steps; j++) { const t = a + delta * j / steps; push(j === steps ? end : [center[0] + co * rx * Math.cos(t) - si * ry * Math.sin(t), center[1] + si * rx * Math.cos(t) + co * ry * Math.sin(t)]) }
        }
      }
    }
    previous = k
  }
  for (const sub of paths) if (sub.points.length > limit) {
    const points = sub.points; sub.points = Array.from({ length: limit }, (_, i) => points[Math.round(i * (points.length - 1) / (limit - 1))])
  }
  return paths
}
export function flattenPath(d: string, tol = 3): FlatSubpath[] { return flatten(d, tol, 256) }
export function pathRegion(d: string): Vec2[][][] {
  const rings = flattenPath(d).filter(p => p.points.length >= 3).map(p => [p.points])
  return rings.length ? pc.xor(rings[0], ...rings.slice(1)) as Vec2[][][] : []
}
export function pathBounds(d: string): [number, number, number, number] {
  const points = flatten(d, .1, Infinity).flatMap(p => p.points)
  return points.reduce<[number, number, number, number]>((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity])
}
