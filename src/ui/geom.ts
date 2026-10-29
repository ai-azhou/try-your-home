/**
 * 界面层的小工具。几何一律用 core/geometry；这里只有 SVG 路径、格式化和「不抛错的」包装。
 */
import { openingSpan, sliceWall, wallFootprint } from '@/core/geometry'
import type { Opening, Plan, Vec2, Wall } from '@/core/types'

export const isArc = (w: Wall) => Math.abs(w.bulge ?? 0) > 1e-6

/** 墙上 [s0, s1] 一段的平面足迹（可指定厚度，用于高亮外扩）= core wallFootprint(sliceWall) */
export function segmentRect(w: Wall, s0: number, s1: number, thickness = w.thickness): Vec2[] {
  return wallFootprint(sliceWall({ ...w, thickness }, s0, s1))
}

export function openingsOn(plan: Plan, wallId: string): Opening[] {
  return plan.openings.filter(o => o.wall === wallId).sort((a, b) => a.offset - b.offset)
}

export function polyPath(poly: Vec2[], close = true) {
  if (!poly.length) return ''
  return poly.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('') + (close ? 'Z' : '')
}

export const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
export const len2 = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1])

/** core openingSpan 在宿主墙不存在时会抛错；画图时只要跳过 */
export function spanOf(plan: Plan, o: Opening) {
  try { return openingSpan(plan, o) } catch { return null }
}

export function fmtLen(mm: number, unit: 'm' | 'mm' = 'm') {
  if (unit === 'mm') return `${Math.round(mm)}`
  return (mm / 1000).toFixed(mm >= 10000 ? 1 : 2)
}
export const fmtH = (m: number) => m.toFixed(2)

/**
 * 底图地址：data: / blob: 直接用；相对路径只有本地服务模式（方案目录可读）才去取，
 * 浏览器里直接打开的方案文件不知道它旁边有什么，不发注定 404 的请求。
 */
export function underlayHref(src: string | undefined, served: boolean): string | undefined {
  if (!src) return undefined
  if (/^(data:|blob:)/.test(src)) return src
  if (/^[a-z]+:/i.test(src) || src.startsWith('//')) return undefined // 契约禁止远程地址
  return served ? src : undefined
}
