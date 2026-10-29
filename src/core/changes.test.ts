import { describe, expect, it } from 'vitest'
import type { Change, Plan } from './types.ts'
import { emptyPlan } from './io.ts'
import { applyChanges, describeChange, diffPlans } from './changes.ts'
import { addBeam, addOpening, addRoom, addWall, bakeChange, detectRoom, mirrorPlan, moveJoint, moveOpening, removeElement, splitWall, updateOpening, updateRoom, updateWall } from './edit.ts'
import { pointInPolygon, wallLength } from './geometry.ts'
const base = (): Plan => ({ ...emptyPlan(), walls: [{ id: 'w', a: [0, 0], b: [5000, 0], thickness: 120, kind: 'partition' }], openings: [{ id: 'a', wall: 'w', offset: 100, width: 500, sill: 0, head: 2.1, kind: 'door' }, { id: 'b', wall: 'w', offset: 3500, width: 900, sill: .9, head: 2.4, kind: 'window' }, { id: 'c', wall: 'w', offset: 2000, width: 700, sill: 0, head: 2.1, kind: 'doorway' }] })
const removal = (patch: Partial<Change> = {}): Change => ({ id: 'cut', op: 'remove', type: 'wall', target: 'w', by: 'user', status: 'confirmed', ...patch })
describe('改造重放', () => {
  it('部分拆墙的稳定 id、洞口重挂与移除清单', () => {
    const p = base(), saved = structuredClone(p), { plan, results } = applyChanges(p, [removal({ range: [1800, 3000] })])
    expect(p).toEqual(saved); expect(plan.walls.map(w => w.id)).toEqual(['w', 'w~cut']); expect(wallLength(plan.walls[0])).toBe(1800)
    expect(plan.openings.map(o => [o.id, o.wall, o.offset])).toEqual([['a', 'w', 100], ['b', 'w~cut', 500]])
    expect(results[0]).toMatchObject({ ok: true, removed: ['c'] })
    expect(diffPlans(p, plan)).toMatchObject({ added: { wall: ['w~cut'] }, removed: { opening: ['c'] }, modified: { wall: ['w'], opening: ['b'] } })
  })
  it('拆起始段保留原 id，整墙拆除带走全部洞口', () => {
    const a = applyChanges(base(), [removal({ range: [0, 3000] })]); expect(a.plan.walls[0].id).toBe('w'); expect(a.plan.openings[0].offset).toBe(500)
    const b = applyChanges(base(), [removal()]); expect(b.plan.walls).toEqual([]); expect(b.plan.openings).toEqual([]); expect(b.results[0].removed).toEqual(expect.arrayContaining(['w', 'a', 'b', 'c']))
  })
  it('受保护墙不靠 status 放行，改类型也不能绕过原始保护', () => {
    const p = base(); p.walls[0].kind = 'bearing'
    const blocked = applyChanges(p, [removal()]); expect(blocked.results[0].needsConfirm).toBe(true); expect(blocked.plan).toEqual(p)
    const modified = applyChanges(p, [updateWall('w', { kind: 'partition' }), removal()]); expect(modified.results[1].needsConfirm).toBe(true)
    expect(applyChanges(p, [removal({ confirm: { by: '本人' } })]).results[0].ok).toBe(true)
  })
  it('受保护墙新增或扩大洞口需要 confirm，关洞不需要', () => {
    const p = base(); p.walls[0].kind = 'exterior'
    const c = addOpening(p, 'w', 800, 'doorway'); expect('error' in c).toBe(false)
    if ('error' in c) return
    expect(applyChanges(p, [c]).results[0].needsConfirm).toBe(true)
    expect(applyChanges(p, [{ ...c, confirm: { by: '本人' } }]).results[0].ok).toBe(true)
    expect(applyChanges(p, [updateOpening('a', { width: 700 })]).results[0].needsConfirm).toBe(true)
    expect(applyChanges(p, [removeElement(p, { type: 'opening', id: 'a' })]).results[0].ok).toBe(true)
  })
  it('unknown 隔墙整拆、局拆、移动和削减都要确认；status 不能替代 confirm', () => {
    const p = base(); p.walls[0].evidence = { certainty: 'unknown' }; p.openings = []
    const changes = [removal(), removal({ range: [0, 500] }), updateWall('w', { a: [10, 0] }),
      updateWall('w', { thickness: 100 }), updateWall('w', { height: 2 }), updateWall('w', { kind: 'half' })]
    for (const change of changes) {
      const blocked = applyChanges(p, [change])
      expect(blocked.results[0]).toMatchObject({ ok: false, needsConfirm: true })
      expect(blocked.plan).toEqual(p)
      expect(applyChanges(p, [{ ...change, confirm: { by: '业主' } }]).results[0].ok).toBe(true)
    }
  })
  it('unknown 原始保护不能靠改证据绕过，局拆后的两段都继承保护', () => {
    const p = base(); p.walls[0].evidence = { certainty: 'unknown' }
    const replay = applyChanges(p, [updateWall('w', { evidence: { certainty: 'seen' } }),
      removal({ range: [1800, 3000], confirm: { by: '业主' } }),
      removal({ id: 'left' }), removal({ id: 'right', target: 'w~cut' })])
    expect(replay.results.map(r => r.ok)).toEqual([true, true, false, false])
    expect(replay.results.slice(2).every(r => r.needsConfirm)).toBe(true)
  })
  it('seen / inferred 隔墙照常拆改，unknown 改名加厚加高不要求确认', () => {
    for (const certainty of ['seen', 'inferred'] as const) {
      const p = base(); p.walls[0].evidence = { certainty }
      expect(applyChanges(p, [removal()]).results[0].ok).toBe(true)
      expect(applyChanges(p, [updateWall('w', { thickness: 100 })]).results[0].ok).toBe(true)
    }
    const p = base(); p.walls[0].evidence = { certainty: 'unknown' }
    expect(applyChanges(p, [updateWall('w', { name: '待核墙', thickness: 150, height: 4 })]).results[0].ok).toBe(true)
    expect(applyChanges(p, [updateOpening('a', { width: 700 })]).results[0].needsConfirm).toBe(true)
    expect(applyChanges(p, [updateOpening('a', { width: 400 })]).results[0].ok).toBe(true)
  })
  it('参数错误事务回滚且继续后续条目', () => {
    const p = base(), changes = [removal({ target: 'missing' }), removal({ range: [-1, 30] }), updateWall('w', { b: [50, 0] }), updateWall('w', { thickness: 150 })]
    const { plan, results } = applyChanges(p, changes); expect(results.map(r => r.ok)).toEqual([false, false, false, true]); expect(plan.walls[0].b).toEqual([5000, 0]); expect(plan.walls[0].thickness).toBe(150)
  })
  it('描述包含尺寸和类型', () => { expect(describeChange(base(), removal())).toBe('拆除 非承重墙（5.0m）') })
})
describe('编辑', () => {
  it('生成新增和更新操作，烘焙保留既有 changes', () => {
    let p = emptyPlan(); p.changes = [removal({ target: 'historic' })]
    p = bakeChange(p, addWall(p, [0, 0], [2000, 0], 'partition'))
    p = bakeChange(p, addBeam(p, [0, 500], [2000, 500]))
    const r = addRoom([[0, 0], [2000, 0], [2000, 2000], [0, 2000]], '客厅'); p = bakeChange(p, r)
    p = bakeChange(p, updateRoom(r.data!.id as string, { ceiling: 3 }))
    expect(p.changes).toHaveLength(1); expect(p.rooms[0].ceiling).toBe(3); expect(p.beams).toHaveLength(1)
    expect(() => bakeChange(p, removal({ target: 'missing' }))).toThrow('不存在')
  })
  it('共同墙角生成同 group 的多个 Change', () => {
    const p = base(); p.walls.push({ ...p.walls[0], id: 'w2', a: [0, 0], b: [0, 2000] })
    const changes = moveJoint(p, [0, 0], [100, 100]); expect(changes).toHaveLength(2); expect(changes[0].group).toBe(changes[1].group); expect(changes[0].id).not.toBe(changes[1].id)
  })
  it('分墙重挂洞口，拒绝穿洞，弧长分段守恒', () => {
    const p = base(), split = splitWall(p, 'w', 3000)
    expect(split.walls).toHaveLength(2); expect(split.openings.find(o => o.id === 'b')).toMatchObject({ wall: split.walls[1].id, offset: 500 })
    expect(() => splitWall(p, 'w', 2300)).toThrow('洞口')
    p.openings = []; p.walls[0].bulge = 500; const len = wallLength(p.walls[0]), curved = splitWall(p, 'w', len * .3)
    expect(curved.walls.reduce((sum, w) => sum + wallLength(w), 0)).toBeCloseTo(len)
  })
  it('洞口沿墙找最近可用位置，空间不足返回 error，弧墙可放洞口', () => {
    const p = base(), move = moveOpening(p, 'b', 200)
    expect('error' in move).toBe(false); if (!('error' in move)) expect(move.data?.offset).toBe(600)
    const add = addOpening(p, 'w', 2800, 'sliding'); expect('error' in add).toBe(true)
    p.walls[0].bulge = 100; expect(addOpening(p, 'w', 800, 'door')).not.toHaveProperty('error')
    const q = emptyPlan(); q.walls = [{ ...base().walls[0], b: [500, 0] }]; const short = addOpening(q, 'w', -30, 'door'); if ('error' in short) throw Error(short.error); expect(short.data?.width).toBe(500); expect(short.data?.offset).toBe(0)
  })
  it('镜像改造几何、门开向和问题框，不改归档原文', () => {
    const p = base(); p.walls[0].bulge = 123.4; p.openings[0].swing = { hinge: 'start', side: 1 }; p.questions = [{ id: 'q', category: 'original', text: '?', bbox: [10.1, 20.2, 30.3, 40.4] }]; p.changes = [updateWall('w', { a: [0.1, 20.1], bulge: 20 })]; p.legacy = { untouched: { a: [1, 2] } }
    const m = mirrorPlan(p, 'x'); expect(m.walls[0].bulge).toBe(-123.4); expect(m.openings[0].swing?.side).toBe(-1); expect(m.changes[0].data?.bulge).toBe(-20); expect(m.legacy?.untouched).toEqual(p.legacy.untouched); expect(mirrorPlan(m, 'x')).toEqual(p)
  })
  it('识别封闭凹房间，开口区域返回 null', () => {
    const p = emptyPlan(), outline: [number, number][] = [[0, 0], [4000, 0], [4000, 2000], [2000, 2000], [2000, 4000], [0, 4000]]
    p.walls = outline.map((a, i) => ({ id: `w${i}`, a, b: outline[(i + 1) % outline.length], thickness: 100, kind: 'partition' }))
    const poly = detectRoom(p, [1000, 1000]); expect(poly).not.toBeNull(); expect(pointInPolygon([1000, 1000], poly!)).toBe(true)
    p.walls.pop(); expect(detectRoom(p, [1000, 1000])).toBeNull()
  })
})
