import type { Plan, Vec2 } from '../types.ts'
import type { Cabinet, CabinetCell, DecorIssue } from './types.ts'
import type { ElevationRect, Interval } from './math.ts'
import { subtractRects, rectPoly } from './math.ts'
import { add, mul } from '../geometry.ts'
import { DecorGeometryError, faceAxis } from './faces.ts'

export interface CabinetLayoutCell extends ElevationRect { column: number; row: number; cell: CabinetCell; type: CabinetCell['type']; pieces: ElevationRect[] }
export interface CabinetPart extends ElevationRect { kind: 'carcass' | 'front' | 'shelf' | 'top' | 'appliance' | 'plinth'; depth: Interval; material?: string; column?: number; row?: number; pieces: ElevationRect[]; polygons: Vec2[][][] }
export interface CabinetLayout { width: number; depth: number; z: Interval; columns: { width: number; u: Interval }[]; cells: CabinetLayoutCell[]; parts: CabinetPart[]; cuts: (ElevationRect & { depth: number | 'through' })[]; footprint: Vec2[]; issues: DecorIssue[] }
/** Only the last width / top cell h may be omitted. No implicit rescaling of explicit dimensions. */
export function layoutCabinet(cab: Cabinet): CabinetLayout {
  const issues: DecorIssue[] = [], invalid = (text: string) => issues.push({ id: cab.id, code: 'invalid', level: 'error', text })
  const columns: CabinetLayout['columns'] = [], cells: CabinetLayoutCell[] = [], parts: CabinetPart[] = [], cuts = [...(cab.cuts ?? [])]
  const bodyBottom = cab.z[0] + (cab.plinth ?? 0), height = cab.z[1] - bodyBottom
  if (!(cab.width > 0 && cab.depth > 0 && height > 0) || !cab.columns.length) invalid('柜宽、柜深、柜高及分列必须有效')
  let x = 0
  cab.columns.forEach((col, ci) => {
    if (col.width === undefined && ci !== cab.columns.length - 1) invalid('只有最后一列可以省略宽度')
    const width = col.width ?? cab.width - x
    if (!(width > 0) || !col.cells.length) invalid('每列必须有正宽度和至少一个格子')
    columns.push({ width, u: [x, x + width] })
    let z = bodyBottom
    col.cells.forEach((cell, ri) => {
      if (cell.h === undefined && ri !== col.cells.length - 1) invalid('只有最上面一格可以省略高度')
      const h = cell.h ?? cab.z[1] - z, rect: ElevationRect = { u: [x, x + width], z: [z, z + h] }
      if (!(h > 0)) invalid('每格高度必须为正')
      cells.push({ ...rect, column: ci, row: ri, cell, type: cell.type, pieces: subtractRects(rect, cab.cuts ?? []) })
      if (cell.type === 'void') cuts.push({ ...rect, depth: cell.void?.depth ?? 'through' })
      z += h
    })
    if (Math.abs(z - cab.z[1]) > 1e-7) invalid('各格高度之和必须等于柜高减踢脚')
    x += width
  })
  if (Math.abs(x - cab.width) > 1e-5) invalid('各列宽度之和必须等于柜宽；改列宽时仅末列省略值承担余量')
  for (const c of cuts) {
    if (c.depth !== 'through' && (!(c.depth > 0) || c.depth > cab.depth)) issues.push({ id: cab.id, code: 'host-depth', level: 'error', text: `柜深只有 ${cab.depth} mm` })
    if (c.u[0] < 0 || c.u[1] > cab.width || c.z[0] < cab.z[0] || c.z[1] > cab.z[1] || c.u[1] <= c.u[0] || c.z[1] <= c.z[0]) invalid('柜体挖洞范围超出柜体')
  }
  const t = Math.min(18, cab.width / 4, cab.depth / 4), tm = t / 1000
  const put = (kind: CabinetPart['kind'], u: Interval, z: Interval, depth: Interval, material = cab.materials.carcass, column?: number, row?: number) => {
    if (u[1] > u[0] && z[1] > z[0] && depth[1] > depth[0]) parts.push({ kind, u, z, depth, material, pieces: [], polygons: [], ...(column === undefined ? {} : { column, row }) })
  }
  put('carcass', [0, cab.width], [bodyBottom, cab.z[1]], [0, t]) // back
  put('carcass', [0, t], [bodyBottom, cab.z[1]], [t, cab.depth]); put('carcass', [cab.width - t, cab.width], [bodyBottom, cab.z[1]], [t, cab.depth])
  put('carcass', [t, cab.width - t], [bodyBottom, bodyBottom + tm], [t, cab.depth]); put('carcass', [t, cab.width - t], [cab.z[1] - tm, cab.z[1]], [t, cab.depth])
  for (const col of columns.slice(1)) put('carcass', [col.u[0] - t / 2, col.u[0] + t / 2], [bodyBottom, cab.z[1]], [t, cab.depth])
  if (cab.plinth) put('plinth', [0, cab.width], [cab.z[0], bodyBottom], [0, Math.max(t, cab.depth - 50)])
  for (const c of cells) {
    const { u, z, cell } = c, count = Math.max(1, Math.floor(cell.count ?? (cell.type === 'drawers' ? 3 : 1)))
    if (c.row > 0) put('shelf', u, [z[0] - tm / 2, z[0] + tm / 2], [t, cab.depth])
    if (['door', 'doors', 'drawers', 'flap'].includes(cell.type)) {
      const nx = cell.type === 'doors' ? 2 : 1, nz = cell.type === 'drawers' ? count : 1
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) put('front', [u[0] + (u[1] - u[0]) * i / nx + 1.5, u[0] + (u[1] - u[0]) * (i + 1) / nx - 1.5], [z[0] + (z[1] - z[0]) * j / nz + .0015, z[0] + (z[1] - z[0]) * (j + 1) / nz - .0015], [cab.depth - t, cab.depth], cell.material ?? cab.materials.front, c.column, c.row)
    }
    if (cell.type === 'open') for (let j = 1; j <= (cell.count ?? 0); j++) { const h = z[0] + (z[1] - z[0]) * j / ((cell.count ?? 0) + 1); put('shelf', u, [h - tm / 2, h + tm / 2], [t, cab.depth]) }
    if (cell.type === 'appliance') {
      const size = cell.appliance?.size ?? [u[1] - u[0] - t * 2, cab.depth - t, z[1] - z[0] - tm * 2], center = (u[0] + u[1]) / 2
      put('appliance', [center - size[0] / 2, center + size[0] / 2], [z[0] + tm, z[0] + tm + size[2]], [cab.depth - size[1], cab.depth], undefined, c.column, c.row)
    }
    if (cell.void?.top) put('top', u, [cell.void.top.z - .018, cell.void.top.z], [0, cab.depth + (cell.void.top.overhang ?? 0)], cell.void.top.material ?? cab.top?.material ?? cab.materials.carcass)
  }
  if (cab.top) put('top', [-(cab.top.overhang ?? 0), cab.width + (cab.top.overhang ?? 0)], [cab.z[1], cab.z[1] + cab.top.thickness / 1000], [0, cab.depth + (cab.top.overhang ?? 0)], cab.top.material)
  for (const part of parts) {
    const frontCuts = part.kind === 'top' ? [] : cuts.filter(c => c.depth === 'through' || c.depth > 0)
    part.pieces = subtractRects(part, frontCuts)
    part.polygons = part.pieces.map(p => [rectPoly(p)])
  }
  return { width: cab.width, depth: cab.depth, z: [...cab.z], columns, cells, parts, cuts, footprint: [[0, 0], [cab.width, 0], [cab.width, cab.depth], [0, cab.depth]], issues }
}
export const cabinetLayout = layoutCabinet
/** 一列至少这么宽（mm）；和立面上拖分列线的下限同一个数 */
export const MIN_COLUMN_WIDTH = 150
/**
 * 改柜宽：末列承担变化，前面各列不动；末列被压到放不下（< 150 mm）时才按比例分摊到所有列。
 * 界面（检查器、立面拖边）和 decor-edit 的 set.width 都走这里。只看 width 和 columns，文件形状、内存形状都能用；不改入参。
 * 末列原来省略宽度就继续省略，原来写了就写新值。
 */
export function resizeCabinet<T extends Pick<Cabinet, 'width' | 'columns'>>(c: T, width: number): T {
  const next = { ...c, width, columns: c.columns.map(col => ({ ...col })) }
  const cols = next.columns, last = cols.at(-1)
  if (!last || !(width > 0) || !Number.isFinite(width)) return next
  const before = cols.slice(0, -1).reduce((a, col) => a + (col.width ?? 0), 0)
  const rest = width - before
  if (rest >= MIN_COLUMN_WIDTH) {
    if (last.width !== undefined) last.width = rest
    return next
  }
  const f = width / c.width
  let used = 0
  cols.slice(0, -1).forEach(col => { col.width = Math.round((col.width ?? 0) * f); used += col.width })
  if (last.width !== undefined) last.width = width - used
  return next
}
/** Returns a local-to-world transform; independent cabinets' at is their center. */
export function cabinetTransform(plan: Plan, cab: Cabinet) {
  if ('face' in cab.place) {
    const place = cab.place, axis = faceAxis(plan, place.face)
    if (axis.wall.bulge) throw new DecorGeometryError('arc-unsupported', '弧墙靠柜暂不支持')
    const start = axis.toU(place.s + (place.face.side === -1 ? cab.width : 0))
    return (u: number, depth: number): Vec2 => axis.at(axis.toS(start + u), (place.gap ?? 0) - (cab.embed ?? 0) + depth)
  }
  const p = cab.place, theta = p.rot * Math.PI / 180, right: Vec2 = [Math.cos(theta), Math.sin(theta)], normal: Vec2 = [-Math.sin(theta), Math.cos(theta)]
  return (u: number, depth: number): Vec2 => add(p.at, add(mul(right, u - cab.width / 2), mul(normal, depth - cab.depth / 2)))
}
export function cabinetFootprint(plan: Plan, cab: Cabinet): Vec2[] {
  const at = cabinetTransform(plan, cab)
  return [[0, 0], [cab.width, 0], [cab.width, cab.depth], [0, cab.depth]].map(([u, d]) => at(u, d))
}
export function cabinetElevation(cab: Cabinet) { return layoutCabinet(cab) }
