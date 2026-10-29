import type { Plan } from '../types.ts'
import type { Furniture, Material, StylePreset } from './types.ts'
import { FURNITURE_LIBRARY } from './furniture.ts'
const aliases: Record<string, string> = { sofa: 'sofa-3', bed: 'bed-1800', table: 'dining-table', dining: 'dining-table', coffee: 'coffee-table', refrigerator: 'fridge', washing: 'washer', television: 'tv', cabinet: 'wardrobe', single: 'armchair' }
/** Returns converted values without touching either the archival legacy snapshot or plan. */
export function fromLegacyFurniture(plan: Plan): { furniture: Furniture[]; materials: Material[]; presets: StylePreset[]; style?: string; warnings: string[] } {
  const legacy = plan.legacy ?? {}, layout = legacy.layout as Record<string, unknown> | undefined
  const raw = legacy.furniture ?? layout?.furniture, result: ReturnType<typeof fromLegacyFurniture> = { furniture: [], materials: [], presets: [], warnings: [] }
  const ids = new Set([...plan.walls, ...plan.openings, ...plan.rooms, ...plan.beams, ...plan.questions, ...plan.changes, ...(plan.levels ?? []), ...(plan.columns ?? []), ...(plan.shafts ?? []), ...(plan.stairs ?? []), ...(plan.voids ?? []), ...(plan.decor?.furniture ?? []), ...(plan.decor?.materials ?? []), ...(plan.decor?.surfaces ?? []), ...(plan.decor?.cabinets ?? []), ...(plan.decor?.panels ?? []), ...(plan.decor?.recesses ?? []), ...(plan.decor?.presets ?? [])].map(x => x.id))
  const id = (base: string) => { let next = base, n = 1; while (ids.has(next)) next = `${base}-${n++}`; ids.add(next); return next }
  if (Array.isArray(raw)) raw.forEach((f, i) => {
    if (!f || ![f.cx, f.cy, f.w, f.d].every(Number.isFinite) || f.w <= 0 || f.d <= 0 || f.rot !== undefined && !Number.isFinite(f.rot)) { result.warnings.push(`旧家具第 ${i + 1} 件尺寸无效，保留在 legacy`); return }
    const type = aliases[f.type] ?? f.type, entry = FURNITURE_LIBRARY.find(e => e.type === type)
    const item: Furniture = { id: id(`legacy-furniture-${i + 1}`), type: entry?.type ?? `placeholder:${String(f.type ?? 'unknown')}`, at: [f.cx, f.cy], size: [f.w, f.d], rot: f.rot ?? 0, height: entry?.height ?? 1, by: 'user', status: 'confirmed', ...(typeof f.name === 'string' ? { name: f.name } : {}) }
    if (typeof f.color === 'string' && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(f.color)) {
      const material = { id: id(`${item.id}-color`), name: `${item.name ?? entry?.name ?? '旧家具'}颜色`, category: 'other' as const, color: f.color }; result.materials.push(material); item.materials = { body: material.id }
    }
    result.furniture.push(item)
  })
  const color = legacy.wallColor ?? layout?.wallColor
  if (typeof color === 'string' && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(color)) {
    const material = { id: id('legacy-wall-color'), name: '旧方案墙漆', category: 'paint' as const, color }; result.materials.push(material)
    const style = id('legacy-style'); result.presets.push({ id: style, name: '旧方案配色', roles: { 'wall.main': material.id }, by: 'user' }); result.style = style
  }
  return result
}
