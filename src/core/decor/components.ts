import pc from 'polygon-clipping'
import type { Vec2 } from '../types.ts'
import type { ComponentCategory, ComponentPath, CustomComponent, Decor, DecorIssue } from './types.ts'
import { flattenPath, pathBounds, pathRegion } from './svg-path.ts'

export const COMPONENT_CATEGORIES: Record<ComponentCategory, string> = { furniture: '家具', appliance: '家电', sanitary: '卫浴', lighting: '灯具', ceiling: '吊顶', plant: '绿植', soft: '软装', storage: '收纳', other: '其他' }
export const isCustomType = (type: string) => typeof type === 'string' && type.startsWith('custom:')
export const componentOf = (decor: Decor | undefined, type: string): CustomComponent | undefined => isCustomType(type) ? decor?.components?.find(c => c.id === type.slice(7)) : undefined
export interface ComponentPrism { polygons: Vec2[][][]; z0: number; z1: number; color?: string; material?: string; part: number }
const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[][][] => [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]]
export function componentPrisms(def: CustomComponent): ComponentPrism[] {
  const result: ComponentPrism[] = []
  def.parts.forEach((p, part) => {
    const push = (polygons: Vec2[][][], z0: number, z1: number) => {
      if (!polygons.length) return
      if (result.length >= 400) throw new Error(`part ${part + 1}：定义展开超过 400 个棱柱，请简化路径或部件`)
      result.push({ polygons, z0, z1, part, ...(p.color ? { color: p.color } : {}), ...(p.material ? { material: p.material } : {}) })
    }
    if (p.kind === undefined || p.kind === 'extrude') { push(pathRegion(p.outline), ...p.z); return }
    if (p.kind !== 'side' && p.kind !== 'revolve') throw new Error(`part ${part + 1}：未知 kind`)
    const paths = flattenPath(p.profile), ys = [...new Set(paths.flatMap(s => s.points.map(v => v[1])))].sort((a, b) => a - b)
    const sloping = paths.some(s => s.points.some((a, i) => { const b = s.points[(i + 1) % s.points.length]; return Math.abs(a[0] - b[0]) > 1e-6 && Math.abs(a[1] - b[1]) > 1e-6 }))
    const bands = !sloping && ys.length <= 25 ? ys : Array.from({ length: 25 }, (_, i) => ys[0] + (ys.at(-1)! - ys[0]) * i / 24)
    for (let i = 1; i < bands.length; i++) {
      const y = (bands[i - 1] + bands[i]) / 2, xs: number[] = []
      for (const { points } of paths) points.forEach((a, j) => { const b = points[(j + 1) % points.length]; if ((a[1] <= y && y < b[1]) || (b[1] <= y && y < a[1])) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) })
      xs.sort((a, b) => a - b)
      for (let j = 1; j < xs.length; j += 2) {
        const lo = xs[j - 1], hi = xs[j]; if (hi - lo < 1e-8) continue
        let polygons: Vec2[][][]
        if (p.kind === 'side') polygons = p.along === 'width' ? rect(p.span[0], lo, p.span[1], hi) : rect(lo, p.span[0], hi, p.span[1])
        else {
          const center = p.center ?? [def.size[0] / 2, def.size[1] / 2]
          const circle = (r: number): Vec2[] => Array.from({ length: 33 }, (_, k) => [center[0] + r * Math.cos(2 * Math.PI * k / 32), center[1] + r * Math.sin(2 * Math.PI * k / 32)])
          polygons = [[circle(hi), ...(lo > 1e-6 ? [circle(lo).reverse()] : [])]]
        }
        push(polygons, def.height - bands[i], def.height - bands[i - 1])
      }
    }
  })
  return result
}
function projectionPaths(polys: Vec2[][][][]): ComponentPath[] {
  if (!polys.length) return []
  const union = pc.union(polys[0], ...polys.slice(1))
  return [{ d: union.flatMap(p => p.map(r => 'M' + r.map(v => v.join(' ')).join('L') + 'Z')).join(' '), style: 'outline' }]
}
export function componentPlanPaths(def: CustomComponent): ComponentPath[] { return def.plan ?? projectionPaths(componentPrisms(def).map(p => p.polygons)) }
export function componentFrontPaths(def: CustomComponent): ComponentPath[] {
  return def.front ?? projectionPaths(componentPrisms(def).flatMap(p => p.polygons.map(rings => { const xs = rings[0].map(v => v[0]); return rect(Math.min(...xs), def.height - p.z1, Math.max(...xs), def.height - p.z0) })))
}
/** Shared SVG canvas rules for component projections and door fronts; all dimensions mm. */
export function validateComponentPaths(paths: ComponentPath[], width: number, height: number, fail: (field: string, message: string) => void): void {
  if (!Array.isArray(paths)) { fail('', '必须为路径数组'); return }
  paths.forEach((p, i) => {
    const field = ` ${i + 1}`
    if (!p || typeof p !== 'object') { fail(field, '需要路径对象'); return }
    try {
      const b = pathBounds(p.d)
      if (b[0] < -1 || b[1] < -1 || b[2] > width + 1 || b[3] > height + 1) fail(`${field}.d`, `超出 ${width} × ${height} mm 画布（容差 1 mm）`)
    } catch (e) { fail(`${field}.d`, (e as Error).message) }
    if (p.style !== undefined && !['outline', 'detail', 'dashed'].includes(p.style)) fail(`${field}.style`, '未知路径样式')
    for (const key of ['fill', 'stroke'] as const) if (p[key] !== undefined && p[key] !== 'none' && !(typeof p[key] === 'string' && /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(p[key]))) fail(`${field}.${key}`, '需要 #RGB / #RRGGBB 或 none')
  })
}
/** Defensive validation for definitions from JSON; dimensions here are always mm. */
export function validateComponent(def: CustomComponent, materials: Set<string>): DecorIssue[] {
  const issues: DecorIssue[] = [], fail = (field: string, message: string) => issues.push({ id: def?.id ?? 'components', code: 'component-invalid', level: 'error', text: `${field}：${message}` } as DecorIssue)
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  const pair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(num)
  const color = (v: unknown) => typeof v === 'string' && /^#[\da-f]{3}(?:[\da-f]{3})?$/i.test(v)
  if (!def || typeof def !== 'object') { fail('定义', '必须是对象'); return issues }
  if (def.look !== undefined && (typeof def.look !== 'string' || [...def.look].length > 300)) issues.push({ id: def.id, code: 'invalid', level: 'error', text: 'look 必须是最多 300 字的字符串' })
  if (!def.id || typeof def.id !== 'string' || !def.name || typeof def.name !== 'string') fail('id/name', '需要非空字符串')
  if (!Object.hasOwn(COMPONENT_CATEGORIES, def.category)) fail('category', '未知类别')
  if (def.category === 'other' && (typeof def.label !== 'string' || !def.label.trim())) fail('label', 'other 必须写类别的白话说明')
  if (!pair(def.size) || def.size.some(v => v <= 0) || !num(def.height) || def.height <= 0) { fail('size/height', '需要正数 mm'); return issues }
  const path = (d: string, field: string, w: number, h: number, region = false) => {
    try { const b = pathBounds(d); if (b[0] < -1 || b[1] < -1 || b[2] > w + 1 || b[3] > h + 1) fail(field, `超出 ${w} × ${h} mm 画布（容差 1 mm）`); if (region && !pathRegion(d).length) fail(field, '必须围出非空面积') }
    catch (e) { fail(field, (e as Error).message) }
  }
  for (const view of ['plan', 'front'] as const) if (def[view] !== undefined)
    validateComponentPaths(def[view], def.size[0], view === 'plan' ? def.size[1] : def.height, (field, message) => fail(`${view}${field}`, message))
  if (!Array.isArray(def.parts) || !def.parts.length) { fail('parts', '至少需要一个部件'); return issues }
  def.parts.forEach((p, i) => {
    const at = `part ${i + 1}`
    if (!p || typeof p !== 'object') { fail(at, '需要对象'); return }
    if (p.color !== undefined && !color(p.color)) fail(`${at}.color`, '需要 #RGB / #RRGGBB')
    if (p.material !== undefined && !materials.has(p.material)) fail(`${at}.material`, `材料 ${p.material} 不存在`)
    if (p.kind === undefined || p.kind === 'extrude') {
      path(p.outline, `${at}.outline`, ...def.size, true)
      if (!pair(p.z) || p.z[0] < 0 || p.z[1] <= p.z[0] || p.z[1] > def.height) fail(`${at}.z`, '需要 0 ≤ z0 < z1 ≤ height（从构件底向上 mm）')
    } else if (p.kind === 'side') {
      if (!['width', 'depth'].includes(p.along)) fail(`${at}.along`, '需要 width 或 depth')
      const w = def.size[p.along === 'width' ? 1 : 0], span = def.size[p.along === 'width' ? 0 : 1]
      path(p.profile, `${at}.profile`, w, def.height, true)
      if (!pair(p.span) || p.span[0] < -1 || p.span[1] <= p.span[0] || p.span[1] > span + 1) fail(`${at}.span`, '越界或不是递增区间')
    } else if (p.kind === 'revolve') {
      const c = p.center ?? [def.size[0] / 2, def.size[1] / 2]
      if (!pair(c)) { fail(`${at}.center`, '需要 [x,y]'); return }
      path(p.profile, `${at}.profile`, Math.min(c[0], c[1], def.size[0] - c[0], def.size[1] - c[1]), def.height, true)
      try { if (pathBounds(p.profile)[0] < 0) fail(`${at}.profile`, '旋转半径不能为负') } catch { /* path already reported */ }
    } else fail(`${at}.kind`, '未知部件类型')
  })
  if (!issues.length) try { if (!componentPrisms(def).length) fail('parts', '未展开出实体') } catch (e) { fail('parts', (e as Error).message) }
  return issues
}
