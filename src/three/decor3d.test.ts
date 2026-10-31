import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { parsePlanText } from '@/core/io'
import { applyChanges } from '@/core/changes'
import { buildSolids } from '@/core/solids'
import { createDecor } from '@/core/decor/presets'
import { wallSkins } from '@/core/decor/wall-skins'
import { sectionAt } from '@/core/decor/solids'
import { mergeByKind } from './geometry'
import { capGeometry, paintWalls, wallBodyGeometry, wallCreases, wallFaceTable, wallSkinMeshes } from './decor3d'

const parsed = parsePlanText(readFileSync('fixtures/skill-two-bed/plan.json', 'utf8')).plan
const { plan } = applyChanges(parsed, parsed.changes.filter(c => c.status === 'confirmed'))
const decor = createDecor('cream')
const BODY = ['wall', 'sill', 'lintel']
const solids = buildSolids(plan).filter(s => BODY.includes(s.kind) && s.wallKind !== 'glass' && s.wallKind !== 'half-glass')
const geos = Object.values(mergeByKind(solids)) as THREE.BufferGeometry[]
const eps = 1e-4

/** 示例的北墙 w-n（y = 0，厚 240，朝室内的面在 z = 0.12）；书房窗 x 0.9 ~ 2.4、z 0.9 ~ 2.4 */
const JAMBS = [0.9, 2.4], SILL = 0.9, HEAD = 2.4

function triangles(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position'), out: THREE.Vector3[][] = []
  for (let i = 0; i < p.count; i += 3) out.push([0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(p, i + k)))
  return out
}
function segments(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position'), out: THREE.Vector3[][] = []
  for (let i = 0; i < p.count; i += 2) out.push([0, 1].map(k => new THREE.Vector3().fromBufferAttribute(p, i + k)))
  return out
}

describe('平涂的墙体：门窗两侧没有接缝', () => {
  const bodies = geos.map(g => wallBodyGeometry(g, solids))
  const creases = wallCreases(geos, solids)

  it('段与段之间的内部端面去掉了，窗洞侧壁留着', () => {
    for (const x of JAMBS) {
      const onPlane = bodies.flatMap(triangles).filter(t => t.every(v => Math.abs(v.x - x) < eps && Math.abs(v.z) <= 0.12 + eps))
      expect(onPlane.length).toBeGreaterThan(0)
      const ys = onPlane.flat().map(v => v.y)
      expect(Math.min(...ys)).toBeCloseTo(SILL, 5)
      expect(Math.max(...ys)).toBeCloseTo(HEAD, 5)
    }
  })

  it('切掉端面前的几何确实有这些面（防止上一条空过）', () => {
    const raw = geos.flatMap(g => triangles(g.index ? g.toNonIndexed() : g)).filter(t => t.every(v => Math.abs(v.x - JAMBS[0]) < eps && Math.abs(v.z) <= 0.12 + eps))
    expect(Math.min(...raw.flat().map(v => v.y))).toBeCloseTo(0, 5)
    expect(Math.max(...raw.flat().map(v => v.y))).toBeCloseTo(2.8, 5)
  })

  it('洞口边线的延长线上没有棱线，墙顶没有横穿的分段线', () => {
    for (const x of JAMBS) {
      const here = segments(creases).filter(s => s.every(v => Math.abs(v.x - x) < eps && Math.abs(v.z) <= 0.12 + eps))
      // 只剩窗洞本身那一段：两个面各一根竖线，都在窗台和窗顶之间
      for (const v of here.flat().filter(v => Math.abs(v.z) > eps)) expect(v.y >= SILL - eps && v.y <= HEAD + eps).toBe(true)
      // 墙顶（y = 2.8）横跨墙厚的线一根都没有
      expect(here.filter(s => s.every(v => Math.abs(v.y - 2.8) < eps))).toHaveLength(0)
    }
  })

  it('真正的棱还在：墙顶外沿、窗洞四边', () => {
    const lines = segments(creases)
    const topOuter = lines.filter(s => s.every(v => Math.abs(v.y - 2.8) < eps && Math.abs(v.z - 0.12) < eps))
    expect(topOuter.reduce((n, s) => n + s[0].distanceTo(s[1]), 0)).toBeGreaterThan(3)
    expect(lines.some(s => s.every(v => Math.abs(v.x - JAMBS[0]) < eps && Math.abs(v.z - 0.12) < eps) && Math.abs(s[0].y - s[1].y) > 1)).toBe(true)
    expect(lines.some(s => s.every(v => Math.abs(v.y - HEAD) < eps && Math.abs(v.z - 0.12) < eps) && s.every(v => v.x > JAMBS[0] - eps && v.x < JAMBS[1] + eps))).toBe(true)
  })

  it('线不重复画（半透明线叠两层会更深）', () => {
    const keys = segments(creases).map(s => s.map(v => [v.x, v.y, v.z].map(c => c.toFixed(4)).join()).sort().join('|'))
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('拆墙留下的缝也要刷', () => {
  const skins = wallSkins({ ...plan, decor }, { styleId: 'cream', keep: true, offset: 1.5 })

  it('夹在两间房之间的那段算室内，外墙外侧不算', () => {
    const gap = skins.find(k => k.wall === 'w-w' && k.side === -1 && !k.room)
    expect(gap?.enclosed).toBe(true)
    expect(skins.find(k => k.wall === 'w-w' && k.side === 1)?.enclosed).toBeUndefined()
    expect(skins.find(k => k.wall === 'w-n' && k.side === -1)?.enclosed).toBeUndefined()
  })

  it('wallSkinMeshes 铺这一段，不铺外墙外侧', () => {
    const meshes = wallSkinMeshes(plan, decor, 'cream', true)
    expect(meshes.filter(m => m.wall === 'w-w' && m.side === -1)).toHaveLength(3)
    expect(meshes.filter(m => m.wall === 'w-w' && m.side === 1)).toHaveLength(0)
  })
})

describe('1.1 m 切面', () => {
  it('墙的切面并成一块，卫生间窗（窗台 1.4，高过切面）两侧没有分段线', () => {
    const wall = capGeometry(sectionAt(buildSolids(plan), 1.1), 1.1).find(c => c.kind === 'wall')!
    const edges = new THREE.EdgesGeometry(wall.geo, 28)
    for (const x of [3.95, 4.75]) {
      const across = segments(edges).filter(s => s.every(v => Math.abs(v.x - x) < eps && Math.abs(v.z) <= 0.12 + eps) && Math.abs(s[0].z - s[1].z) > 0.1)
      expect(across).toHaveLength(0)
    }
  })
})

describe('门窗洞口的一圈上漆', () => {
  const faces = wallFaceTable(plan, decor, 'cream', false)
  const painted = geos.map(g => paintWalls(wallBodyGeometry(g, solids), faces, '#102030'))
  const white = new THREE.Color('#ffffff')
  /** 书房窗上取样：x、z 在洞口范围内，返回匹配到的三角形颜色 */
  function colorsAt(match: (t: THREE.Vector3[], n: THREE.Vector3) => boolean) {
    const out: THREE.Color[] = []
    for (const g of painted) {
      const p = g.getAttribute('position'), c = g.getAttribute('color')
      for (let i = 0; i < p.count; i += 3) {
        const t = [0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(p, i + k))
        const n = new THREE.Vector3().subVectors(t[2], t[1]).cross(new THREE.Vector3().subVectors(t[0], t[1])).normalize()
        if (match(t, n)) out.push(new THREE.Color(c.getX(i), c.getY(i), c.getZ(i)))
      }
    }
    return out
  }
  const inWall = (t: THREE.Vector3[]) => t.every(v => Math.abs(v.z) < 0.121)
  const wallColor = faces.find(f => f.face.wall === 'w-n' && f.painted)!.color

  it('窗的侧壁和窗台上沿跟室内这一面，不再是白模白或墙顶色', () => {
    const jamb = colorsAt((t, n) => inWall(t) && Math.abs(n.x) > 0.9 && JAMBS.some(x => t.every(v => Math.abs(v.x - x) < 1e-3)) && t.every(v => v.y > SILL - 1e-3 && v.y < HEAD + 1e-3))
    const sill = colorsAt((t, n) => inWall(t) && n.y > 0.9 && t.every(v => Math.abs(v.y - SILL) < 1e-3 && v.x > JAMBS[0] - 1e-3 && v.x < JAMBS[1] + 1e-3))
    expect(jamb.length).toBeGreaterThan(0)
    expect(sill.length).toBeGreaterThan(0)
    for (const c of [...jamb, ...sill]) { expect(c.equals(white)).toBe(false); expect(c.getHex()).toBe(wallColor.getHex()) }
  })
  it('墙真正的顶还是墙顶色', () => {
    const tops = colorsAt((t, n) => inWall(t) && n.y > 0.9 && t.every(v => v.y > 2.7))
    expect(tops.length).toBeGreaterThan(0)
    for (const c of tops) expect(c.getHex()).toBe(new THREE.Color('#102030').getHex())
  })
})
