/**
 * 装修态的界面状态（不进方案文件）：画哪张图、选中什么、工具、风格预览。
 * 装修数据本身在 base.decor 里（主 store），编辑走 decor/model.ts 的 commitDecor。
 */
import { create } from 'zustand'
import type { FaceRef } from '@/core/decor/types'

export type DSel =
  | { k: 'floor'; id: string }
  | { k: 'face'; face: FaceRef; s?: number }
  | { k: 'furniture' | 'cabinet' | 'panel' | 'recess'; id: string }
  | { k: 'cell'; id: string; col: number; row: number }

/**
 * 主画布：平面 / 某一面墙的立面 / 某个柜子的柜体编辑（立面放大到这个柜子）。
 * 立面按房间分段（D6 A3）：一面墙面跨几间房（共线墙连成一条）时，room = 从哪间房看、取景这一段；
 * 没给就用 core 的默认取景段（装修最多的那段）。
 */
export type DCanvas = { k: 'plan' } | { k: 'elev'; face: FaceRef; room?: string } | { k: 'cabinet'; id: string; face: FaceRef; room?: string }

export type DTool = 'select' | 'material' | 'furniture' | 'cabinet' | 'panel' | 'cut' | 'elevpick'
export type PanelKind = 'feature' | 'wainscot' | 'slats' | 'skirting'
export type CabFamily = 'tall' | 'base' | 'wall'

interface DState {
  canvas: DCanvas
  sel: DSel | null
  hover: DSel | null
  tool: DTool
  /** 风格卡：第一次进装修、点「换风格」时打开 */
  styleCard: boolean
  /** 悬停风格卡 = 平面实时预览这套（不改数据） */
  preview: string | null
  keepOverrides: boolean
  /** 材质刷子当前材料 */
  brush: string
  panelKind: PanelKind
  cabFamily: CabFamily
  /** 家具库里点了一件，下一下点在平面上放 */
  placing: string | null
  /** 家具库分类 */
  furnCat: string
  /** 拖家具时的净距（屏幕上画洋红胶囊） */
  dragging: string | null
  /** 墙面检查器「刷到哪」 */
  paintScope: 'whole' | 'span' | 'height'
  /** 进过立面（下一步条规则 5） */
  elevVisited: boolean
  /** 挖到墙厚时的引导：数据没改（保留上一次的有效值），输入框旁提示 +「去改造开洞」。tried = 用户输的值；other = 两侧加起来挖透时 core 的原话 */
  throughHint: { id: string; tried: number; other?: string; wall: string; s: number; width: number; z: [number, number]; thickness: number } | null
  /** 装修态 3D：平涂（默认，墙地按材料铺平涂色）/ 白模（纯白，给生图当轮廓）。和结构态的「白模」开关分开记 */
  look3d: 'flat' | 'clay'
  /** 装修态 3D 的 1.1 m 水平剖切（看嵌墙的缺口、柜子挖洞），白模和平涂下都能开 */
  section3d: boolean
  /** 透明背景导出时窗户：实心浅灰（默认，生图输入轮廓更干净）/ 半透明 */
  exportGlass: 'solid' | 'clear'
  /** 交给 Agent 时带上的装修构件 id（AgentSheet 用 core decorHandoff 展开） */
  agentRefs: string[]
  /** 3D「对准」：相机框住这一件（平面 mm 外接框）。id = 构件 id，或网址 ?probe=p1|p2|p3 的探针名；null = 整个方案 */
  probe: { id: string; item: string; box: [number, number, number, number]; az: number; el: number } | null
}
interface DActions {
  set(p: Partial<DState>): void
  select(s: DSel | null): void
  setTool(t: DTool): void
  openElevation(face: FaceRef, room?: string): void
  openCabinet(id: string, face: FaceRef, room?: string): void
  backToPlan(): void
}

export const useDecor = create<DState & DActions>()(set => ({
  canvas: { k: 'plan' },
  sel: null,
  hover: null,
  tool: 'select',
  styleCard: false,
  preview: null,
  keepOverrides: true,
  brush: 'mist',
  panelKind: 'feature',
  cabFamily: 'tall',
  placing: null,
  furnCat: '客厅',
  dragging: null,
  paintScope: 'whole',
  elevVisited: false,
  throughHint: null,
  probe: null,
  agentRefs: [],
  look3d: 'flat',
  section3d: false,
  exportGlass: 'solid',
  set: p => set(p),
  select: sel => set({ sel, styleCard: false, throughHint: null }),
  setTool: tool => set({ tool, placing: null, hover: null, throughHint: null }),
  openElevation: (face, room) => set({ canvas: { k: 'elev', face, ...(room ? { room } : {}) }, elevVisited: true, tool: 'select', sel: { k: 'face', face }, styleCard: false, placing: null }),
  openCabinet: (id, face, room) => set({ canvas: { k: 'cabinet', id, face, ...(room ? { room } : {}) }, elevVisited: true, tool: 'select', sel: { k: 'cabinet', id }, styleCard: false }),
  backToPlan: () => set({ canvas: { k: 'plan' }, tool: 'select', sel: null, throughHint: null }),
}))

export const sameFace = (a?: FaceRef | null, b?: FaceRef | null) => !!a && !!b && a.wall === b.wall && a.side === b.side
export const selId = (s: DSel | null) => s && 'id' in s ? s.id : null
