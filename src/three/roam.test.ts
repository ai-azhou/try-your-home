import { describe, expect, it } from 'vitest'
import type { Plan } from '@/core/types'
import { buildSolids } from '@/core/solids'
import { ROOM_CAMERA } from '@/core/raster'
import { ROAM, buildWorld, clearance, forwardOf, groundAt, hFovOf, isFree, moveWithSlide, nearestFree, spawnSpot, vFovFor, walkTarget, yawOf, type SolidLike } from './roam'

/** 两间房：西 4×4 m、东 4×4 m，中间隔墙（y=2 m 处开 900 宽门），东房南墙一扇窗，西房北墙一个落地门洞通向外面 */
function plan(extra: Partial<Plan> = {}): Plan {
  const wall = (id: string, a: [number, number], b: [number, number]) => ({ id, a, b, thickness: 200, kind: 'partition' as const, evidence: { source: 'estimate' } })
  return {
    format: 'floorplan-structure', version: 3, title: 't', ceiling: 2.8, north: 0,
    walls: [wall('n', [0, 0], [8000, 0]), wall('s', [0, 4000], [8000, 4000]), wall('w', [0, 0], [0, 4000]), wall('e', [8000, 0], [8000, 4000]), wall('mid', [4000, 0], [4000, 4000])],
    openings: [
      { id: 'door', wall: 'mid', kind: 'door', offset: 1550, width: 900, sill: 0, head: 2.1 },
      { id: 'win', wall: 's', kind: 'window', offset: 5500, width: 1500, sill: 0.9, head: 2.4 },
      { id: 'out', wall: 'n', kind: 'doorway', offset: 1500, width: 1000, sill: 0, head: 2.1 },
    ],
    beams: [],
    rooms: [
      { id: 'a', name: '西', poly: [[100, 100], [3900, 100], [3900, 3900], [100, 3900]] },
      { id: 'b', name: '东', poly: [[4100, 100], [7900, 100], [7900, 3900], [4100, 3900]], floorOffset: 0.45 },
    ],
    questions: [], changes: [], ...extra,
  } as unknown as Plan
}
const world = (p: Plan, eye = 1.45, extra: SolidLike[] = []) => buildWorld(p, p.levels?.[0]?.id ?? 'L1', [...buildSolids(p), ...extra], eye)
/** 一直往一个方向走 */
function walk(w: ReturnType<typeof world>, from: [number, number], d: [number, number], meters: number): [number, number] {
  let [x, z] = from
  for (let i = 0; i < meters / 0.05; i++) [x, z] = moveWithSlide(w, x, z, d[0] * 0.05, d[1] * 0.05)
  return [x, z]
}

describe('视角宽度', () => {
  it('横屏：水平视角 → 竖直视角换回来还是它', () => {
    for (const h of [40, 60, 90, 120]) expect(hFovOf(vFovFor(h, 16 / 10), 16 / 10)).toBeCloseTo(h, 5)
    expect(vFovFor(90, 1)).toBeCloseTo(90, 5)
  })
  it('竖屏封顶：竖直视角不超过上限，实际水平视角变窄', () => {
    const a = 390 / 844
    expect(vFovFor(120, a)).toBe(ROAM.maxV)
    expect(hFovOf(vFovFor(120, a), a)).toBeLessThan(120)
    expect(hFovOf(vFovFor(40, a), a)).toBeCloseTo(40, 5) // 窄视角不受影响
  })
})

describe('平视高度', () => {
  it('默认值和生图的房间平视机位一致', () => expect(ROAM.eye.def * 1000).toBe(ROOM_CAMERA.eye))
})

describe('碰撞', () => {
  it('撞墙停下，不穿墙', () => {
    const w = world(plan())
    const [x] = walk(w, [2, 1], [1, 0], 5) // 朝隔墙走，这一段没有门
    expect(x).toBeLessThan(3.9)
    expect(x).toBeGreaterThan(3.5)
  })
  it('门洞过得去，门头比视线低也过得去', () => {
    const p = plan()
    for (const eye of [1.45, 2.0]) {
      const [x] = walk(world(p, eye), [2, 2], [1, 0], 4)
      expect(x).toBeGreaterThan(4.5)
    }
  })
  it('窗台挡人，落地门洞通向外面时只能走到门外一点点', () => {
    const w = world(plan())
    const [, z] = walk(w, [6.25, 2], [0, 1], 4) // 朝南窗走
    expect(z).toBeLessThan(3.9)
    const [, z2] = walk(w, [2, 2], [0, -1], 6) // 朝北边通向外面的门洞走
    expect(z2).toBeGreaterThan(-0.5 - ROAM.radius)
  })
  it('斜着撞墙会顺墙滑', () => {
    const w = world(plan())
    const [x, z] = walk(w, [3.5, 1], [Math.SQRT1_2, Math.SQRT1_2], 0.8)
    expect(x).toBeLessThan(3.9)
    expect(z).toBeGreaterThan(1.3)
  })
  it('身体高度内的家具挡人；地毯和吊柜（头顶）不挡', () => {
    const box = (kind: string, z0: number, z1: number): SolidLike => ({ kind, z0, z1, polygons: [[[[1500, 1500], [2500, 1500], [2500, 2500], [1500, 2500]]]] })
    expect(isFree(world(plan(), 1.45, [box('decor-furniture', 0, 0.8)]), 2, 2)).toBe(false)
    expect(isFree(world(plan(), 1.45, [box('decor-rug', 0, 0.02)]), 2, 2)).toBe(true)
    expect(isFree(world(plan(), 1.45, [box('decor-furniture', 2.4, 2.7)]), 2, 2)).toBe(true)
  })
  it('替换墙的原实体不算两次（replaces 由结构实体负责）', () => {
    const rep: SolidLike = { kind: 'decor-x', replaces: 'wall', z0: 0, z1: 2.8, polygons: [[[[1500, 1500], [2500, 1500], [2500, 2500], [1500, 2500]]]] }
    expect(isFree(world(plan(), 1.45, [rep]), 2, 2)).toBe(true)
  })
  it('方案被改、人卡在东西里时能走出来', () => {
    const box: SolidLike = { kind: 'decor-furniture', z0: 0, z1: 0.8, polygons: [[[[1500, 1500], [2500, 1500], [2500, 2500], [1500, 2500]]]] }
    const w = world(plan(), 1.45, [box])
    expect(moveWithSlide(w, 2, 2, 0.05, 0)).toEqual([2.05, 2])
  })
})

describe('站位', () => {
  it('方向约定和 three 一致：yaw=0 朝 −z', () => {
    expect(forwardOf(0)[0]).toBeCloseTo(0)
    expect(forwardOf(0)[1]).toBeCloseTo(-1)
    const [fx, fz] = forwardOf(1.1)
    expect(yawOf(fx, fz)).toBeCloseTo(1.1)
  })
  it('选中的房间优先，否则站最大的能站人的一间，站的地方都能站人', () => {
    const p = plan({ rooms: [
      { id: 'a', name: '小', poly: [[100, 100], [3900, 100], [3900, 2000], [100, 2000]] },
      { id: 'b', name: '大', poly: [[4100, 100], [7900, 100], [7900, 3900], [4100, 3900]] },
    ] } as Partial<Plan>)
    const w = world(p)
    const def = spawnSpot(p, 'L1', w), chosen = spawnSpot(p, 'L1', w, 'a')
    expect(def.x).toBeGreaterThan(4)
    expect(chosen.x).toBeLessThan(4)
    expect(isFree(w, def.x, def.z)).toBe(true)
    expect(isFree(w, chosen.x, chosen.z)).toBe(true)
  })
  it('背靠一边看向整间房：长条房间看长边，眼前不贴墙', () => {
    const p = plan({ walls: plan().walls.filter(w => w.id !== 'mid'), openings: [], rooms: [{ id: 'a', name: '长', poly: [[100, 100], [7900, 100], [7900, 3900], [100, 3900]] }] } as Partial<Plan>)
    const w = world(p), s = spawnSpot(p, 'L1', w), [fx, fz] = forwardOf(s.yaw)
    expect(Math.abs(fx)).toBeGreaterThan(Math.abs(fz))
    expect(clearance(w, s.x, s.z, fx, fz)).toBeGreaterThan(4)
    // 视野两侧（±45°）也有纵深，不是半屏贴墙
    for (const a of [-Math.PI / 4, Math.PI / 4]) {
      const [lx, lz] = forwardOf(s.yaw + a)
      expect(clearance(w, s.x, s.z, lx, lz)).toBeGreaterThan(1)
    }
  })
  it('家具挤满整间也能站（离中心最近的空地），实在站不下换一间', () => {
    const box = (x0: number, y0: number, x1: number, y1: number): SolidLike => ({ kind: 'decor-furniture', z0: 0, z1: 0.8, polygons: [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1]]]] })
    const p = plan(), full = world(p, 1.45, [box(100, 100, 3900, 3900)])
    const s = spawnSpot(p, 'L1', full, 'a')
    expect(s.x).toBeGreaterThan(4) // a 间满了，站到 b
    expect(isFree(full, s.x, s.z)).toBe(true)
  })
  it('没有房间也不崩', () => {
    const p = plan({ rooms: [] } as Partial<Plan>)
    const s = spawnSpot(p, 'L1', world(p))
    expect(Number.isFinite(s.x) && Number.isFinite(s.z)).toBe(true)
  })
  it('点地面走到那里；点墙走到墙跟前；隔窗点到楼外走到窗边；脚下不算', () => {
    const w = world(plan())
    expect(walkTarget(w, 3, 1, 1, 1)).toEqual([3, 1])
    const [wx] = walkTarget(w, 4, 1, 1, 1)! // 点到隔墙
    expect(wx).toBeLessThan(3.9)
    expect(wx).toBeGreaterThan(3.3)
    const [, oz] = walkTarget(w, 6.25, 6, 6.25, 1)! // 南窗外的地面
    expect(oz).toBeLessThan(3.9)
    expect(oz).toBeGreaterThan(3.3)
    expect(walkTarget(w, 1.05, 1, 1, 1)).toBeNull()
  })
  it('墙外的点找不到屋里的位置', () => {
    expect(nearestFree(world(plan()), -20, -20)).toBeNull()
  })
  it('脚下地面跟着房间的抬高走，门洞里没有房间', () => {
    const p = plan()
    expect(groundAt(p, 'L1', 2, 2)).toEqual({ floor: 0, ceiling: 2.8 })
    expect(groundAt(p, 'L1', 6, 2)).toEqual({ floor: 0.45, ceiling: 2.8 })
    expect(groundAt(p, 'L1', 4, 2)).toBeNull()
  })
})
