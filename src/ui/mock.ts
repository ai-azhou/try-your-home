/**
 * 手写的虚构两室方案，形状严格按 src/core/types.ts。
 * fixtures/example-v2.json（codex 生成）出现后由 data.ts 换成它；这里只做界面外壳的演示数据。
 * 坐标 mm，y 向下；房间多边形取墙内皮。
 */
import type { Plan } from '@/core/types'
import { drawUnderlay } from './underlay-art'
import type { Decor } from '@/core/decor/types'
import { BUILTIN_MATERIALS } from '@/core/decor/presets'

const seen = (basis: string) => ({ certainty: 'seen' as const, basis })
const inferred = (basis: string) => ({ certainty: 'inferred' as const, basis })
const unknown = (basis: string) => ({ certainty: 'unknown' as const, basis })

const base: Omit<Plan, 'underlay'> = {
  format: 'floorplan-structure',
  version: 2,
  title: '示例 · 虚构两室',
  ceiling: 2.8,
  north: 0,
  walls: [
    { id: 'w-n', a: [0, 0], b: [9600, 0], thickness: 240, kind: 'exterior', name: '北外墙', evidence: seen('实心黑粗线，240mm') },
    { id: 'w-e', a: [9600, 0], b: [9600, 7200], thickness: 240, kind: 'exterior', name: '东外墙', evidence: seen('实心黑粗线，240mm') },
    { id: 'w-s', a: [0, 7200], b: [9600, 7200], thickness: 240, kind: 'exterior', name: '南外墙', evidence: seen('实心黑粗线，240mm') },
    { id: 'w-w', a: [0, 0], b: [0, 7200], thickness: 240, kind: 'exterior', name: '西外墙', evidence: seen('实心黑粗线，240mm') },
    { id: 'w-bw', a: [600, 7200], b: [600, 8600], thickness: 200, kind: 'exterior', name: '阳台西墙', evidence: seen('实心黑线') },
    { id: 'w-be', a: [4200, 7200], b: [4200, 8600], thickness: 200, kind: 'exterior', name: '阳台东墙', evidence: seen('实心黑线') },
    { id: 'w-arc', a: [600, 8600], b: [4200, 8600], thickness: 120, kind: 'half', lowHeight: 1.1, bulge: 360, name: '阳台弧形栏板', evidence: inferred('弧线，按常见栏板 1.1m 推断') },
    { id: 'w-a', a: [3300, 0], b: [3300, 3600], thickness: 200, kind: 'bearing', name: '次卧东墙', evidence: inferred('黑色实心，比隔墙厚，推测承重') },
    { id: 'w-b', a: [0, 3600], b: [3300, 3600], thickness: 120, kind: 'partition', name: '次卧南墙', evidence: seen('双细线填灰，120mm') },
    { id: 'w-c', a: [3300, 2400], b: [5400, 2400], thickness: 120, kind: 'partition', name: '卫生间南墙', evidence: seen('双细线填灰') },
    { id: 'w-d', a: [5400, 0], b: [5400, 3600], thickness: 200, kind: 'bearing', name: '主卧西墙', evidence: seen('图上标注「承重」') },
    { id: 'w-m', a: [5400, 3600], b: [9600, 3600], thickness: 120, kind: 'partition', name: '主卧南墙', evidence: seen('双细线填灰') },
    { id: 'w-k', a: [6600, 3600], b: [6600, 5400], thickness: 80, kind: 'glass', name: '厨房玻璃隔断', evidence: seen('细双线，标注「玻璃」') },
    { id: 'w-bar', a: [6600, 5400], b: [9600, 5400], thickness: 120, kind: 'half-glass', lowHeight: 1.0, name: '厨房吧台矮墙', evidence: inferred('矮墙线 + 玻璃，高度按 1.0m 推断') },
  ],
  openings: [
    { id: 'o-bed2-win', wall: 'w-n', offset: 900, width: 1500, kind: 'window', sill: 0.9, head: 2.4, panes: [{ width: 0.5, kind: 'casement' }, { width: 0.5, kind: 'fixed' }], name: '次卧窗', evidence: seen('三线窗') },
    { id: 'o-bath-win', wall: 'w-n', offset: 3950, width: 800, kind: 'window', sill: 1.4, head: 2.2, panes: [{ width: 1, kind: 'casement' }], name: '卫生间高窗', evidence: inferred('窗宽看得到，离地按卫生间高窗推断') },
    { id: 'o-bay', wall: 'w-n', offset: 6400, width: 2200, kind: 'bay-window', sill: 0.45, head: 2.4, panes: [{ width: 0.25, kind: 'casement' }, { width: 0.5, kind: 'fixed' }, { width: 0.25, kind: 'casement' }], name: '主卧飘窗', evidence: seen('飘窗符号') },
    { id: 'o-master-win', wall: 'w-e', offset: 1200, width: 1200, kind: 'window', sill: 0.9, head: 2.4, name: '主卧侧窗', evidence: seen('三线窗') },
    { id: 'o-kitchen-win', wall: 'w-e', offset: 3950, width: 1100, kind: 'window', sill: 1.0, head: 2.3, name: '厨房窗', evidence: seen('三线窗') },
    { id: 'o-entry', wall: 'w-e', offset: 5850, width: 1000, kind: 'door', sill: 0, head: 2.1, swing: { hinge: 'end', side: 1 }, entry: true, name: '入户门', evidence: seen('门弧线 + 入户箭头') },
    { id: 'o-living', wall: 'w-s', offset: 1000, width: 2800, kind: 'sliding', sill: 0, head: 2.4, name: '客厅推拉门', evidence: seen('推拉门符号') },
    { id: 'o-dining', wall: 'w-s', offset: 6900, width: 2100, kind: 'floor-window', sill: 0.05, head: 2.5, panes: [{ width: 0.5, kind: 'sliding' }, { width: 0.5, kind: 'sliding' }], name: '餐厅落地窗', evidence: seen('落地窗符号') },
    { id: 'o-bed2', wall: 'w-a', offset: 2600, width: 900, kind: 'door', sill: 0, head: 2.1, swing: { hinge: 'end', side: 1 }, name: '次卧门', evidence: seen('门弧线') },
    { id: 'o-bath', wall: 'w-c', offset: 700, width: 800, kind: 'door', sill: 0, head: 2.1, swing: { hinge: 'start', side: -1 }, name: '卫生间门', evidence: seen('门弧线') },
    { id: 'o-master', wall: 'w-m', offset: 200, width: 900, kind: 'door', sill: 0, head: 2.1, swing: { hinge: 'start', side: -1 }, name: '主卧门', evidence: seen('门弧线') },
    { id: 'o-k', wall: 'w-k', offset: 250, width: 1300, kind: 'sliding', sill: 0, head: 2.2, name: '厨房门', evidence: inferred('细线看不清门扇，按推拉门推断') },
  ],
  beams: [
    { id: 'b-1', a: [0, 5000], b: [6600, 5000], width: 240, bottom: 2.55, name: '客厅横梁', evidence: unknown('图上有虚线，没标梁底高度') },
    { id: 'b-2', a: [5400, 1800], b: [9600, 1800], width: 200, bottom: 2.6, name: '主卧横梁', evidence: seen('标注「梁底 2.60」') },
  ],
  rooms: [
    { id: 'r-bed2', name: '次卧', poly: [[120, 120], [3200, 120], [3200, 3540], [120, 3540]], evidence: seen('房间名') },
    { id: 'r-bath', name: '卫生间', poly: [[3400, 120], [5300, 120], [5300, 2340], [3400, 2340]], ceiling: 2.55, evidence: inferred('卫生间常见降板，层高按 2.55m 推断') },
    {
      id: 'r-master', name: '主卧',
      poly: [[5500, 120], [6400, 120], [6400, 720], [8600, 720], [8600, 120], [9480, 120], [9480, 3540], [5500, 3540]],
      evidence: seen('房间名'),
    },
    { id: 'r-bay', name: '飘窗台', poly: [[6400, 120], [8600, 120], [8600, 720], [6400, 720]], floorOffset: 0.45, counted: false, use: '飘窗台', evidence: seen('飘窗符号') },
    { id: 'r-kitchen', name: '厨房', poly: [[6640, 3660], [9480, 3660], [9480, 5340], [6640, 5340]], evidence: seen('房间名') },
    {
      id: 'r-living', name: '客餐厅',
      poly: [[120, 3660], [3400, 3660], [3400, 2460], [5300, 2460], [5300, 3660], [6560, 3660], [6560, 5460], [9480, 5460], [9480, 7080], [120, 7080]],
      evidence: seen('房间名'),
    },
    {
      id: 'r-balcony', name: '阳台',
      poly: [[700, 7320], [4100, 7320], [4100, 8576], [3250, 8821], [2400, 8900], [1550, 8821], [700, 8576]],
      ceiling: 2.75, evidence: inferred('层高按阳台常见 2.75m 推断'),
    },
  ],
  questions: [
    {
      id: 'q-beam', category: 'original', certainty: 'unknown',
      text: '客厅这根梁，梁底离地多高？图上只有虚线，没标高度。',
      bbox: [2600, 4650, 4000, 5350], targets: ['b-1'], options: ['约 2.50 m', '约 2.60 m', '到现场量了再说'],
    },
    {
      id: 'q-bearing', category: 'original', certainty: 'inferred',
      text: '次卧和卫生间之间这面墙，是承重墙吗？图上是黑色实心粗线。',
      bbox: [3050, 500, 3550, 2300], targets: ['w-a'], options: ['是承重墙', '不是，普通隔墙', '不知道'],
    },
    {
      id: 'q-kitchen', category: 'original', certainty: 'inferred',
      text: '厨房这扇门是推拉门还是平开门？图上的线太细，看不清门扇。',
      bbox: [6350, 3800, 6850, 5200], targets: ['o-k'], options: ['推拉门', '平开门', '只是门洞'],
      status: 'answered', answer: '推拉门，往客厅那边推', answeredBy: '业主', answeredAt: '2026-10-28',
    },
    {
      id: 'q-bay', category: 'original', certainty: 'inferred',
      text: '飘窗台离地是 45cm 吗？',
      bbox: [6400, 120, 8600, 720], targets: ['r-bay'], options: ['是', '不是'],
      answer: '是，量过 45cm', answeredBy: '业主', answeredAt: '2026-10-27',
      status: 'resolved', reply: { outcome: 'confirmed', text: '飘窗台按 450 mm，和图上读的一致，模型不用改。', by: 'Agent', at: '2026-10-27' },
    },
  ],
  changes: [
    { id: 'c1', op: 'remove', type: 'wall', target: 'w-b', note: '拆掉次卧和客厅之间的隔墙，次卧改开放书房', group: 'g1', by: 'user', status: 'confirmed', at: '2026-10-28T20:10' },
    {
      id: 'c2', op: 'add', type: 'wall', group: 'g1', by: 'user', status: 'confirmed', at: '2026-10-28T20:11',
      data: { id: 'w-new1', a: [1800, 3600], b: [3300, 3600], thickness: 80, kind: 'glass', name: '书房玻璃隔断' },
      note: '留一段 1.5m 玻璃隔断，挡一下视线',
    },
    { id: 'c3', op: 'remove', type: 'opening', target: 'o-bed2', note: '原来的次卧门封掉', by: 'user', status: 'confirmed', at: '2026-10-28T20:12' },
    { id: 'c4', op: 'update', type: 'room', target: 'r-bed2', data: { name: '书房', use: '开放书房' }, note: '次卧改书房', by: 'user', status: 'confirmed', at: '2026-10-28T20:12' },
    {
      id: 'c5', op: 'add', type: 'opening', by: 'agent', status: 'pending', at: '2026-10-28T20:30',
      data: { id: 'o-ensuite', wall: 'w-d', offset: 900, width: 800, kind: 'door', sill: 0, head: 2.1, swing: { hinge: 'start', side: 1 }, name: '主卫门' },
      note: '主卧和卫生间之间开一扇 800 宽的门，卫生间改成主卫。这面是承重墙，要你确认',
    },
  ],
  meta: { planFile: 'plans/示例两室.json', source: 'mock', createdAt: '2026-10-27', updatedAt: '2026-10-28' },
}

/**
 * 装修层示例（docs/decor/样张 01、03 那套）：挂在改造后的结构上（拆掉 w-b、加了书房玻璃隔断）。
 * 坐标见 docs/decor/数据格式草案.md：西外墙 w-w 朝房间是 side −1，立面左右 u = L − s。
 */
const U = { by: 'user' as const, status: 'confirmed' as const }
export const mockDecor: Decor = {
  version: 1,
  style: 'cream',
  materials: structuredClone(BUILTIN_MATERIALS),
  surfaces: [
    { id: 'sf-bedwall', target: { face: { wall: 'w-m', side: -1 } }, material: 'mist', ...U },
  ],
  furniture: [
    { id: 'f-rug', type: 'rug', at: [2650, 5000], rot: 90, size: [2600, 2000], height: 0.01, name: '地毯', ...U },
    { id: 'f-sofa', type: 'sofa-3', at: [3750, 5000], rot: 90, size: [2400, 900], height: 0.85, name: '三人沙发', ...U },
    { id: 'f-coffee', type: 'coffee-table', at: [2575, 5000], rot: 90, size: [1200, 550], height: 0.4, name: '茶几', ...U },
    { id: 'f-table', type: 'dining-table', at: [7600, 6300], rot: 0, size: [1300, 800], height: 0.75, name: '餐桌', ...U },
    { id: 'f-c1', type: 'chair', at: [7300, 5800], rot: 0, size: [450, 480], height: 0.85, ...U },
    { id: 'f-c2', type: 'chair', at: [7900, 5800], rot: 0, size: [450, 480], height: 0.85, ...U },
    { id: 'f-c3', type: 'chair', at: [7300, 6800], rot: 180, size: [450, 480], height: 0.85, ...U },
    { id: 'f-c4', type: 'chair', at: [7900, 6800], rot: 180, size: [450, 480], height: 0.85, ...U },
    { id: 'f-dchair', type: 'desk-chair', at: [1000, 1780], rot: 90, size: [520, 520], height: 0.9, name: '书桌椅', ...U },
    { id: 'f-bed', type: 'bed-1800', at: [8000, 2540], rot: 180, size: [1800, 2000], height: 0.5, name: '双人床', against: { face: { wall: 'w-m', side: -1 }, gap: 0 }, ...U },
    { id: 'f-ns1', type: 'nightstand', at: [6830, 3330], rot: 180, size: [450, 400], height: 0.5, ...U },
    { id: 'f-ns2', type: 'nightstand', at: [9170, 3330], rot: 180, size: [450, 400], height: 0.5, ...U },
    { id: 'f-bay', type: 'cushion', at: [7500, 420], rot: 0, size: [2100, 520], height: 0.12, name: '飘窗垫', ...U },
    { id: 'f-wc', type: 'toilet', at: [3730, 560], rot: -90, size: [400, 680], height: 0.75, ...U },
    { id: 'f-shower', type: 'shower', at: [4900, 560], rot: 0, size: [800, 880], height: 2.0, name: '淋浴区', ...U },
    { id: 'f-tv', type: 'tv', in: 'rc-tv', size: [1450, 60], height: 0.83, z: 1.02, name: '电视', ...U },
  ],
  cabinets: [
    {
      id: 'cab-desk', name: '书房书桌柜', family: 'tall', ...U,
      place: { face: { wall: 'w-w', side: -1 }, s: 280 }, width: 3100, depth: 400, z: [0, 2.8], plinth: 0.08,
      columns: [
        { width: 900, cells: [{ type: 'doors' }] },
        { width: 1400, cells: [
          { h: 1.47, type: 'void', void: { depth: 'through', top: { z: 0.73, overhang: 200 } } },
          { h: 0.62, type: 'open', count: 1 },
          { type: 'open', count: 1 }] },
        { cells: [{ h: 0.67, type: 'drawers', count: 2 }, { h: 0.8, type: 'open' }, { type: 'door', hinge: 'left' }] },
      ],
      materials: { carcass: 'oakVeneer', front: 'creamDoor' }, handle: 'bar',
    },
    {
      id: 'cab-tall-1', name: '客厅嵌墙柜', family: 'tall', ...U, note: '玄关这边做个嵌进墙里的高柜，放吸尘器和杂物',
      place: { face: { wall: 'w-w', side: -1 }, s: 6360 }, width: 600, depth: 420, embed: 120, z: [0, 2.4], plinth: 0.08,
      columns: [{ cells: [{ type: 'door', hinge: 'right' }] }],
      materials: { carcass: 'creamDoor', front: 'creamDoor' }, handle: 'bar',
    },
    {
      id: 'cab-tv', name: '悬浮电视柜', family: 'base', ...U,
      place: { face: { wall: 'w-w', side: -1 }, s: 4020, gap: 150 }, width: 1960, depth: 330, z: [0.25, 0.58],
      columns: [{ width: 653, cells: [{ type: 'flap' }] }, { width: 654, cells: [{ type: 'flap' }] }, { cells: [{ type: 'flap' }] }],
      materials: { carcass: 'creamDoor', front: 'creamDoor' }, handle: 'bar',
    },
    {
      id: 'cab-fridge', name: '冰箱高柜', family: 'tall', ...U,
      place: { face: { wall: 'w-m', side: 1 }, s: 1900 }, width: 700, depth: 700, z: [0, 2.4],
      columns: [{ cells: [{ h: 1.86, type: 'appliance', appliance: { type: 'fridge', size: [640, 650, 1.82] } }, { type: 'flap' }] }],
      materials: { carcass: 'creamDoor', front: 'creamDoor' },
    },
    {
      id: 'cab-kbase', name: '厨房地柜', family: 'base', ...U,
      place: { face: { wall: 'w-m', side: 1 }, s: 2600 }, width: 1480, depth: 600, z: [0, 0.82], plinth: 0.1,
      top: { material: 'slab', thickness: 20 },
      columns: [{ width: 500, cells: [{ type: 'drawers', count: 3 }] }, { width: 600, cells: [{ type: 'doors' }] }, { cells: [{ type: 'door', hinge: 'right' }] }],
      materials: { carcass: 'creamDoor', front: 'creamDoor' }, handle: 'edge',
    },
    {
      id: 'cab-kbase2', name: '厨房地柜（转角）', family: 'base', ...U,
      place: { face: { wall: 'w-e', side: 1 }, s: 4260 }, width: 1080, depth: 600, z: [0, 0.82], plinth: 0.1,
      top: { material: 'slab', thickness: 20 },
      columns: [{ width: 600, cells: [{ type: 'appliance', appliance: { type: 'dishwasher' } }] }, { cells: [{ type: 'door', hinge: 'left' }] }],
      materials: { carcass: 'creamDoor', front: 'creamDoor' }, handle: 'edge',
    },
    {
      id: 'cab-kwall', name: '厨房吊柜', family: 'wall', ...U,
      place: { face: { wall: 'w-m', side: 1 }, s: 2600 }, width: 880, depth: 350, z: [1.55, 2.25],
      columns: [{ width: 440, cells: [{ type: 'door', hinge: 'left' }] }, { cells: [{ type: 'door', hinge: 'right' }] }],
      materials: { carcass: 'creamDoor', front: 'creamDoor' }, handle: 'edge',
    },
    {
      id: 'cab-vanity', name: '浴室柜', family: 'base', ...U,
      place: { face: { wall: 'w-a', side: -1 }, s: 1000 }, width: 800, depth: 500, z: [0.2, 0.85],
      top: { material: 'slab', thickness: 20 },
      columns: [{ cells: [{ type: 'drawers', count: 2 }] }],
      materials: { carcass: 'oakVeneer', front: 'oakVeneer' }, handle: 'edge',
    },
    {
      id: 'cab-ward', name: '主卧衣柜', family: 'tall', ...U,
      place: { face: { wall: 'w-n', side: 1 }, s: 5500 }, width: 900, depth: 600, z: [0, 2.4], plinth: 0.08,
      columns: [{ cells: [{ type: 'doors' }] }],
      materials: { carcass: 'creamDoor', front: 'creamDoor' }, handle: 'bar',
    },
    {
      id: 'cab-washer', name: '阳台洗衣机柜', family: 'base', ...U,
      place: { face: { wall: 'w-bw', side: -1 }, s: 200 }, width: 900, depth: 650, z: [0, 1.05],
      top: { material: 'slab', thickness: 20 },
      columns: [{ cells: [{ type: 'appliance', appliance: { type: 'washer' } }] }],
      materials: { carcass: 'creamDoor', front: 'creamDoor' },
    },
    {
      // 挂在次卧南墙（改造里拆掉了）上的衣柜：数据原样保留，装修态里标「没地方挂了」
      id: 'cab-orphan', name: '书房衣柜', family: 'tall', ...U,
      place: { face: { wall: 'w-b', side: -1 }, s: 720 }, width: 1400, depth: 600, z: [0, 2.4], plinth: 0.08,
      columns: [{ width: 700, cells: [{ type: 'door', hinge: 'left' }] }, { cells: [{ type: 'door', hinge: 'right' }] }],
      materials: { carcass: 'creamDoor', front: 'creamDoor' }, handle: 'bar',
    },
  ],
  panels: [
    {
      id: 'pn-tv', name: '电视背景墙', type: 'feature', ...U, note: '电视墙做微水泥，电视嵌进去',
      span: { face: { wall: 'w-w', side: -1 }, s: [3780, 6220], z: [0, 2.55] }, thickness: 150, material: 'micro',
    },
  ],
  recesses: [
    { id: 'rc-tv', name: '电视位', kind: 'hole', ...U, host: { panel: 'pn-tv' }, rect: { u: [420, 2020], z: [0.98, 1.88] }, depth: 100 },
    { id: 'rc-niche', name: '淋浴壁龛', kind: 'niche', ...U, host: { face: { wall: 'w-c', side: -1 } }, rect: { s: [1560, 1960], z: [1.0, 1.4] }, depth: 60, shelves: [1.2] },
  ],
  cache: {
    'cab-orphan': { box: [720, 2940, 2120, 3540], face: [[120, 3540], [3200, 3540]] },
  },
}

export const mockPlan: Plan = {
  ...base,
  decor: mockDecor,
  underlay: {
    src: drawUnderlay(base as Plan),
    mmPerPx: 10,
    origin: [120, 120],
    opacity: 45,
    visible: false,
    calibrations: [{ p1: [120, 120], p2: [1080, 120], length: 9600, note: '按北外墙总长' }],
  },
}
