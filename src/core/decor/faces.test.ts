import { describe, expect, it } from 'vitest'
import { faceAxis, faceExtent, faceFrame, faceIntervals, faceRun } from './faces.ts'
import { elevationOf } from './elevation.ts'
import { decorPlan, panel, probeP2 } from './fixtures.ts'
import { wallLength } from '../geometry.ts'
describe('墙面寻址与立面', () => {
  it('两侧立面左右相反、平面向外偏移半墙厚', () => {
    const p = decorPlan(), a = faceFrame(p, { face: { wall: 'w', side: 1 }, s: [500, 900], z: [0, 2] }), b = faceFrame(p, { face: { wall: 'w', side: -1 }, s: [500, 900], z: [0, 2] })
    expect(a.segment).toEqual([[500, 120], [900, 120]]); expect(a.normal).toEqual([-0, 1]); expect(a.u).toEqual([500, 900]); expect(b.u).toEqual([5100, 5500]); expect(b.a).toEqual([500, -120]); expect(b.toS(b.toU(332))).toBe(332)
  })
  it('房间内皮排除墙角，外侧不被错误裁短', () => {
    const p = decorPlan(); p.walls.push({ id: 'left', a: [0, 0], b: [0, 3000], thickness: 240, kind: 'partition' }, { id: 'right', a: [6000, 0], b: [6000, 3000], thickness: 240, kind: 'partition' })
    expect(faceExtent(p, { wall: 'w', side: 1 })).toEqual([120, 5880]); expect(faceExtent(p, { wall: 'w', side: -1 })).toEqual([0, 6000])
  })
  it('内部 T 形遮挡保留为可见区间，不填平', () => { const p = decorPlan(); p.walls.push({ id: 't', a: [3000, 0], b: [3000, 1500], thickness: 200, kind: 'partition' }); expect(faceIntervals(p, { wall: 'w', side: 1 })).toEqual([[0, 2900], [3100, 6000]]) })
  it('跨共线链支持反向记录，忽略另一层和不同面', () => {
    const p = probeP2(); p.walls[1].a = [6000, 0]; p.walls[1].b = [3000, 0]; p.levels = [{ id: 'l1', name: '一层', elevation: 0 }, { id: 'l2', name: '二层', elevation: 3 }]; p.walls.push({ ...p.walls[0], id: 'other', level: 'l2' })
    const run = faceRun(p, { wall: 'w', side: 1 }); expect(run.map(r => r.face)).toEqual([{ wall: 'w', side: 1 }, { wall: 'w2', side: -1 }]); expect(faceFrame(p, panel().span!).b).toEqual([3500, 120])
  })
  it('链断时返回明确 host-cut，缺墙返回 host-missing', () => { const p = probeP2(); p.walls[1].a = [3100, 0]; expect(() => faceFrame(p, panel().span!)).toThrow(/链断/); expect(() => faceAxis(p, { wall: 'missing', side: 1 })).toThrow(/不存在/) })
  it('弧墙材质按实际面弧长展开，嵌入明确暂不支持', () => { const p = decorPlan(); p.walls[0].bulge = 500; const a = faceAxis(p, { wall: 'w', side: 1 }); expect(a.faceLength).toBeGreaterThan(wallLength(p.walls[0])); expect(a.toS(a.toU(500))).toBeCloseTo(500); expect(() => faceFrame(p, panel().span!)).toThrow(/暂不支持/); expect(faceFrame(p, { wall: 'w', side: 1 }).length).toBeGreaterThan(6000) })
  it('立面包含跨墙洞口、梁、地顶线及造型宿主洞', () => { const e = elevationOf(probeP2(), 'w', 1); expect(e.width).toBe(6000); expect(e.openings[0].u).toEqual([3000, 3700]); expect(e.beams[0].u[0]).toBeCloseTo(1880); expect(e.beams[0].z).toEqual([2.55, 2.8]); expect(e.floorLines).toHaveLength(2); expect(e.ceilingLines).toHaveLength(2); expect(e.items.find(x => x.id === 'tv-hole')?.u).toEqual([1000, 2600]) })
  it('立面相邻墙截面和反侧洞口坐标正确', () => { const p = probeP2(); p.walls.push({ id: 't', a: [2000, 0], b: [2000, -1000], thickness: 120, kind: 'partition' }); const e = elevationOf(p, 'w', -1); expect(e.adjacentWalls.find(w => w.id === 't')?.u[0]).toBeCloseTo(940); expect(e.openings[0].u).toEqual([-700, 0]) })
})
