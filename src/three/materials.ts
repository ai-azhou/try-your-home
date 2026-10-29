/**
 * 3D 观感：白模（clay）+ 墙顶切面上色。墙顶的颜色和 2D 墙的画法一一对应，
 * 俯视时 3D 就是「立起来的平面图」。规格见 docs/design.md §6。
 */
import * as THREE from 'three'
import type { WallKind } from '@/core/types'
import { withFieldAO } from './ao'

const std = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...o })
/** 不透明的实体材质都打上场 AO（墙脚、阴角、地面靠墙处变暗，见 ./ao） */
const solid = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => withFieldAO(std(color, o))

function hatchTexture(bg: string, line: string) {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = bg; g.fillRect(0, 0, 64, 64)
  g.strokeStyle = line; g.lineWidth = 10
  for (let i = -64; i <= 128; i += 32) { g.beginPath(); g.moveTo(i, 64); g.lineTo(i + 64, 0); g.stroke() }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(1 / 0.11, 1 / 0.11)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

let cache: ReturnType<typeof make> | null = null
export function mats() { return (cache ??= make()) }

function make() {
  const clay = solid('#f6f7f8', { roughness: 0.92 })
  const clayMuted = solid('#f3f4f6', { roughness: 0.95 })
  const top: Record<WallKind, THREE.Material> = {
    exterior: std('#424852', { roughness: 0.8 }),
    bearing: std('#ffffff', { map: hatchTexture('#20242b', '#4c535e'), roughness: 0.8 }),
    partition: std('#b4b9c1'),
    half: std('#c9cdd4'),
    'half-glass': std('#c9cdd4'),
    glass: std('#c7e6f8'),
  }
  const topMuted: Record<WallKind, THREE.Material> = {
    exterior: std('#c4c8ce'), bearing: std('#b9bdc4'), partition: std('#dcdfe3'), half: std('#e2e4e8'), 'half-glass': std('#e2e4e8'), glass: std('#e4eef4'),
  }
  const glass = new THREE.MeshStandardMaterial({ color: '#9fcdf0', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4 })
  const pane = new THREE.MeshStandardMaterial({ color: '#cfe7f8', roughness: 0.05, metalness: 0.05, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.6 })
  const frame = solid('#e4e6ea', { roughness: 0.6 })
  const leaf = solid('#fbfbfc', { roughness: 0.7 })
  const floor = solid('#e6e8ec', { roughness: 0.96 })
  const platform = solid('#f5f6f8', { roughness: 0.9 })
  const beam = solid('#dfe2e6', { roughness: 0.9 })
  const plinth = solid('#fafafb', { roughness: 0.98 })
  const sel = std('#55d3a5', { roughness: 0.75, emissive: new THREE.Color('#1ea377'), emissiveIntensity: 0.18 })
  const selTop = std('#2dbf8c', { roughness: 0.7, emissive: new THREE.Color('#12825e'), emissiveIntensity: 0.15 })
  const selFloor = std('#b4eed6', { roughness: 0.9 })
  const hover = std('#c9f3e2', { roughness: 0.85 })
  const added = std('#7c9efc', { roughness: 0.7, emissive: new THREE.Color('#2a4fc4'), emissiveIntensity: 0.12 })
  const addedTop = std('#4b76f2', { roughness: 0.6 })
  const addedGlass = new THREE.MeshStandardMaterial({ color: '#6d93fb', transparent: true, opacity: 0.55, depthWrite: false, roughness: 0.2, side: THREE.DoubleSide })
  const ghostCoral = new THREE.MeshStandardMaterial({ color: '#f07d71', transparent: true, opacity: 0.13, depthWrite: false, roughness: 0.6 })
  const ghostLav = new THREE.MeshStandardMaterial({ color: '#a693f6', transparent: true, opacity: 0.34, depthWrite: false, roughness: 0.6 })
  const modFloor = solid('#dfe8ff', { roughness: 0.9 })
  const ceiling = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide })
  const ceilingSel = new THREE.MeshBasicMaterial({ color: '#55d3a5', transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide })
  const cutaway = new THREE.MeshStandardMaterial({ color: '#f3f4f6', transparent: true, opacity: 0.14, depthWrite: false, roughness: 0.9 })
  const edgeCut = new THREE.LineBasicMaterial({ color: '#1c2434', transparent: true, opacity: 0.18 })
  const edge = new THREE.LineBasicMaterial({ color: '#1c2434', transparent: true, opacity: 0.09 })
  const edgeCoral = new THREE.LineBasicMaterial({ color: '#e8604f', transparent: true, opacity: 0.9 })
  const edgeLav = new THREE.LineBasicMaterial({ color: '#8a72ef', transparent: true, opacity: 0.9 })
  const edgeGlass = new THREE.LineBasicMaterial({ color: '#4fa3d8', transparent: true, opacity: 0.55 })
  // 平涂下柜体棱线（门缝、抽屉缝）：比墙的棱线深一档，柜子不读成一整块
  const edgeCab = new THREE.LineBasicMaterial({ color: '#1c2434', transparent: true, opacity: 0.2 })
  const edgeSel = new THREE.LineBasicMaterial({ color: '#12825e', transparent: true, opacity: 0.6 })
  const ceilLine = new THREE.LineBasicMaterial({ color: '#3b4048', transparent: true, opacity: 0.22 })
  const ceilLineSel = new THREE.LineBasicMaterial({ color: '#12825e', transparent: true, opacity: 0.8 })
  // 叠在合并几何上的高亮（选中 / 悬停 / 新增）：和底下的面共面，用 polygonOffset 压过去
  const over = (m: THREE.MeshStandardMaterial) => { const c = m.clone(); c.polygonOffset = true; c.polygonOffsetFactor = -2; c.polygonOffsetUnits = -4; return c }
  const selO = over(sel), selTopO = over(selTop), hoverO = over(hover), selFloorO = over(selFloor)
  /*
   * 白模（给生图 / 生视频模型的几何底图，参考图 1、2）：中性白，和墙类型无关。
   * 明度只差一点：墙面 / 墙顶最白，地面低一档，底板介于两者——光和 AO 负责分出体积，颜色不负责。
   * 不画棱线（真的白模没有描边），玻璃是极淡的冷白半透明，看得出是窗但不抢形体。
   */
  const clay3 = {
    wall: solid('#f4f4f3', { roughness: 0.94 }),
    top: solid('#f7f7f6', { roughness: 0.94 }),
    floor: solid('#e8e8e6', { roughness: 0.97 }),
    platform: solid('#f0f0ee', { roughness: 0.95 }),
    beam: solid('#f1f1f0', { roughness: 0.94 }),
    leaf: solid('#f6f6f5', { roughness: 0.8 }),
    frame: solid('#ececea', { roughness: 0.7 }),
    glass: new THREE.MeshStandardMaterial({ color: '#eef3f7', roughness: 0.15, metalness: 0, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.2 }),
    plinth: solid('#f2f2f1', { roughness: 0.98 }),
    edge: new THREE.LineBasicMaterial({ color: '#2a2622', transparent: true, opacity: 0 }),
  }
  const openGlow = new THREE.MeshBasicMaterial({ color: '#55d3a5', transparent: true, opacity: 0.28, depthWrite: false })
  return { openGlow, selO, selTopO, hoverO, selFloorO, clay3, addedGlass, cutaway, edgeCut, clay, clayMuted, top, topMuted, glass, pane, frame, leaf, floor, platform, beam, plinth, sel, selTop, selFloor, hover, added, addedTop, ghostCoral, ghostLav, modFloor, ceiling, ceilingSel, edge, edgeCoral, edgeLav, edgeGlass, edgeCab, edgeSel, ceilLine, ceilLineSel }
}
