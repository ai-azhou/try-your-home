import { describe, expect, it } from 'vitest'
import type { Vec2, Wall } from './types.ts'
import { emptyPlan } from './io.ts'
import { measureWalls } from './measure.ts'
import { dot, sub, wallDir } from './geometry.ts'
const w = (id: string, a: Vec2, b: Vec2, extra: Partial<Wall> = {}): Wall => ({ id, a, b, kind: 'partition', thickness: 200, ...extra })
const measure = (a: Wall, b: Wall) => measureWalls({ ...emptyPlan(), walls: [a, b] }, a.id, b.id)
describe('C3 测距', () => {
  it('平行竖墙与横墙给墙面净距及中心线距离，标注落在重叠中点', () => {
    const v = measure(w('a', [0, 0], [0, 3000]), w('b', [2000, 500], [2000, 2500]))
    expect(v).toMatchObject({ dx: 1800, centerline: { dx: 2000 }, intersect: false }); expect(v.dy).toBeUndefined()
    expect(v.segments[0]).toEqual({ kind: 'dx', a: [100, 1500], b: [1900, 1500], extensions: [] })
    expect(measure(w('a', [0, 0], [3000, 0]), w('b', [500, 2000], [2500, 2000]))).toMatchObject({ dy: 1800, centerline: { dy: 2000 } })
  })
  it('横竖墙两向分离时返回 X/Y 以及连接真实墙面的延长虚线', () => {
    const m = measure(w('a', [0, 0], [1000, 0]), w('b', [2000, 1000], [2000, 2000]))
    expect(m).toMatchObject({ dx: 900, dy: 900, intersect: false }); expect(m.segments).toHaveLength(2)
    expect(m.segments[0]).toEqual({ kind: 'dx', a: [1000, 550], b: [1900, 550], extensions: [{ a: [1000, 100], b: [1000, 550] }, { a: [1900, 1000], b: [1900, 550] }] })
  })
  it.each([0, 200])('墙面相交或相接（偏移 %s）只给相交标签', offset => {
    const m = measure(w('a', [0, 0], [2000, 0]), w('b', [0, offset], [2000, offset]))
    expect(m).toEqual({ intersect: true, segments: [] })
  })
  it('横竖交叉、完全包含都没有距离数字', () => {
    expect(measure(w('a', [-1000, 0], [1000, 0]), w('b', [0, -1000], [0, 1000])).intersect).toBe(true)
    expect(measure(w('a', [0, 0], [1000, 0], { thickness: 1000 }), w('b', [100, 0], [900, 0])).intersect).toBe(true)
  })
  it('平行斜墙以法向测净距，不受反向端点顺序影响', () => {
    const a = w('a', [0, 0], [3000, 3000]), b = w('b', [2000, 4000], [-1000, 1000]), m = measure(a, b)
    expect(m.normal).toBeCloseTo(Math.SQRT2 * 1000 - 200); expect(m.centerline?.normal).toBeCloseTo(Math.SQRT2 * 1000)
    expect(m.nearest).toBeUndefined(); expect(dot(sub(m.segments[0].b, m.segments[0].a), wallDir(a))).toBeCloseTo(0)
  })
  it('非平行斜墙返回有限足迹最近点与分量，交换顺序距离相同', () => {
    const a = w('a', [0, 0], [1000, 1000]), b = w('b', [3000, 0], [4000, -500]), m = measure(a, b)
    expect(m.nearest).toBeGreaterThan(0); expect(Math.hypot(m.dx!, m.dy!)).toBeCloseTo(m.nearest!)
    expect(measure(b, a).nearest).toBeCloseTo(m.nearest!); expect(m.segments[0].kind).toBe('nearest')
  })
  it('弧墙按离散足迹测最近距离，弧内接触也能识别', () => {
    const a = w('a', [0, 0], [4000, 0], { bulge: 2000 }), b = w('b', [1500, 3000], [2500, 3000]), m = measure(a, b)
    expect(m.nearest).toBeCloseTo(800, 0); expect(m.centerline?.nearest).toBeCloseTo(1000, 0)
    expect(measure(a, { ...b, a: [1500, 2000], b: [2500, 2000] }).intersect).toBe(true)
  })
  it('平行但纵向分离的有限斜墙使用最近端面距离，缺失 id 抛错', () => {
    expect(measure(w('a', [0, 0], [1000, 1000]), w('b', [2000, 2000], [3000, 3000])).nearest).toBeCloseTo(Math.SQRT2 * 1000)
    expect(() => measureWalls(emptyPlan(), 'a', 'b')).toThrow('不存在')
  })
})
