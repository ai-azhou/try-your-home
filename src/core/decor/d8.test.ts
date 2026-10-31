import { describe, expect, it } from 'vitest'
import { confirmDecorItems, rejectDecorItems } from './resolve.ts'
import { resizeCabinet, layoutCabinet } from './cabinets.ts'
import { validateDecor } from './validate.ts'
import { authored, cabinet, decorPlan, panel } from './fixtures.ts'
import type { Cabinet, Decor, Furniture, Recess } from './types.ts'

const agent = { by: 'agent' as const, status: 'pending' as const }
const freed = (f: Furniture): Furniture => ({ ...f, in: undefined, at: [0, 0], rot: 0 }) as Furniture
const cab = (cols: (number | undefined)[], width: number): Cabinet => ({ ...cabinet(), width, columns: cols.map(w => ({ ...(w === undefined ? {} : { width: w }), cells: [{ type: 'door' as const }] })) })
const widths = (c: Cabinet) => layoutCabinet(c).columns.map(x => x.width)

describe('resizeCabinet', () => {
  it('last column absorbs the change; the others stay', () => {
    expect(widths(resizeCabinet(cab([900, 900, undefined], 2700), 3000))).toEqual([900, 900, 1200])
    expect(widths(resizeCabinet(cab([900, 900, undefined], 2700), 2400))).toEqual([900, 900, 600])
  })
  it('keeps the last width explicit when it was explicit', () => {
    const c = resizeCabinet(cab([900, 900], 1800), 2400)
    expect(c.columns.map(x => x.width)).toEqual([900, 1500])
    expect(layoutCabinet(c).issues).toEqual([])
  })
  it('falls back to proportional only when the last column would not fit', () => {
    const c = resizeCabinet(cab([900, 900, undefined], 2700), 1800)
    expect(widths(c)).toEqual([600, 600, 600])
    expect(layoutCabinet(c).issues).toEqual([])
    // 正好放得下（150）还是末列承担
    expect(widths(resizeCabinet(cab([900, 900, undefined], 2700), 1950))).toEqual([900, 900, 150])
  })
  it('sums stay exact after rounding and the input is not mutated', () => {
    const before = cab([1000, 1000, 1000], 3000), copy = structuredClone(before)
    const c = resizeCabinet(before, 1000)
    expect(widths(c).reduce((a, b) => a + b)).toBe(1000)
    expect(layoutCabinet(c).issues).toEqual([])
    expect(before).toEqual(copy)
  })
  it('a single column just follows the width', () => {
    expect(widths(resizeCabinet(cab([undefined], 900), 1500))).toEqual([1500])
  })
})

describe('confirmDecorItems / rejectDecorItems', () => {
  const sofa = (over: Partial<Furniture> = {}): Furniture => ({ id: 'f', type: 'sofa-3', at: [100, 100], rot: 0, size: [2400, 900], height: .85, ...authored, ...over }) as Furniture
  const decor = (over: Partial<Decor>): Decor => ({ ...decorPlan().decor!, ...over })
  it('confirm clears prev and sets confirmed', () => {
    const d = decor({ furniture: [sofa({ ...agent, prev: { ...sofa() } })] })
    expect(confirmDecorItems(d, ['f'])).toEqual(['f'])
    expect(d.furniture[0].status).toBe('confirmed')
    expect(d.furniture[0].prev).toBeUndefined()
  })
  it('confirming a child also confirms its pending host chain', () => {
    const pn = { ...panel(), ...agent }, hole: Recess = { id: 'h', ...agent, kind: 'hole', host: { panel: 'panel' }, rect: { u: [0, 500], z: [1, 1.5] }, depth: 50 }
    const d = decor({ panels: [pn], recesses: [hole], furniture: [sofa({ id: 'tv', type: 'tv', in: 'h', at: undefined, ...agent })] })
    expect(confirmDecorItems(d, ['tv']).sort()).toEqual(['h', 'panel', 'tv'])
    expect([d.panels[0].status, d.recesses[0].status]).toEqual(['confirmed', 'confirmed'])
  })
  it('reject restores prev, or deletes when there is none', () => {
    const d = decor({ furniture: [sofa({ ...agent, at: [9, 9], prev: { ...sofa() } }), sofa({ id: 'new', ...agent })], cache: { new: { box: [0, 0, 1, 1] } } })
    const r = rejectDecorItems(d, ['f', 'new'], freed)
    expect(r).toEqual({ removed: ['new'], restored: ['f'] })
    expect(d.furniture.map(f => [f.id, f.status, f.at, f.prev])).toEqual([['f', 'confirmed', [100, 100], undefined]])
    expect(d.cache?.new).toBeUndefined()
  })
  it('rejecting a new host: pending children go with it, confirmed holes go, confirmed appliances are kept and freed', () => {
    const hole = (id: string, s: 'p' | 'c'): Recess => ({ id, ...(s === 'p' ? agent : authored), kind: 'hole', host: { panel: 'panel' }, rect: { u: [0, 500], z: [1, 1.5] }, depth: 50 })
    const d = decor({ panels: [{ ...panel(), ...agent }], recesses: [hole('a', 'p'), hole('b', 'c')], furniture: [sofa({ id: 'tv', type: 'tv', in: 'panel', at: undefined }), sofa({ id: 'in-hole', type: 'tv', in: 'a', at: undefined, ...agent })] })
    const r = rejectDecorItems(d, ['panel'], freed)
    expect(r.removed.sort()).toEqual(['a', 'b', 'in-hole', 'panel'])
    expect(d.panels).toEqual([]); expect(d.recesses).toEqual([])
    expect(d.furniture.map(f => [f.id, f.in, f.at])).toEqual([['tv', undefined, [0, 0]]])
  })
  it('ignores items that are not pending', () => {
    const d = decor({ furniture: [sofa()] })
    expect(rejectDecorItems(d, ['f'], freed)).toEqual({ removed: [], restored: [] })
    expect(d.furniture).toHaveLength(1)
  })
})

describe('over-opening warning for wall-mounted items', () => {
  const plan = (f: Partial<Furniture>, kind: 'door' | 'window' = 'door', name?: string) => {
    const p = decorPlan()
    p.rooms = [{ id: 'room', name: '客厅', poly: [[120, 120], [5880, 120], [5880, 4000], [120, 4000]] }]
    p.openings = [{ id: 'o1', wall: 'w', offset: 1000, width: 900, kind, sill: kind === 'door' ? 0 : .9, head: 2.1, ...(name ? { name } : {}) }]
    p.decor!.furniture = [{ id: 'tv', type: 'tv', at: [1400, 160], rot: 0, size: [1450, 80], height: .83, z: 1, against: { face: { wall: 'w', side: 1 }, gap: 0 }, ...authored, ...f } as Furniture]
    return p
  }
  const warn = (p: ReturnType<typeof plan>) => validateDecor(p).filter(i => i.code === 'over-opening')
  it('warns with the door or window name, as a fact, not an error', () => {
    const [i] = warn(plan({}, 'door', '入户'))
    expect(i).toMatchObject({ id: 'tv', level: 'warn', text: '压在入户门上' })
    expect(warn(plan({}, 'window'))[0].text).toBe('压在窗 o1 上')
  })
  it('stays silent when the z range or s range misses the opening', () => {
    expect(warn(plan({ z: 2.2 }))).toEqual([])
    expect(warn(plan({ at: [4000, 160] }))).toEqual([])
    expect(warn(plan({ z: 0, height: .8 }, 'window'))).toEqual([]) // 矮柜在窗台下面
  })
  it('only items standing against the wall count, and rugs never do', () => {
    expect(warn(plan({ against: undefined }))).toEqual([])
    expect(warn(plan({ type: 'rug', z: 0, height: .01 }))).toEqual([])
  })
})
