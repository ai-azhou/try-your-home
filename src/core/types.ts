import type { Decor } from "./decor/types"

/**
 * 户型结构方案：文件 v3、内存 v2；Skill 写、工具读写、Agent 改，三方共用这一份格式。
 *
 * 单位：平面坐标和长度用 mm（x 向右、y 向下，和图片像素方向一致）；内存高度用 m；v3 文件的全部长度（含高度）用 mm，由 io 换算；角度用度。
 * 枚举值用英文，界面文案在 ui 层翻译。
 * 本文件只放类型和少量常量，不放逻辑；改字段要同步 docs/format.md 和 schema。
 */

export type Vec2 = [number, number]
/** [x0, y0, x1, y1]，x0 < x1、y0 < y1 */
export type Box = [number, number, number, number]

/** 读图时每个判断的来源：看到 / 推断 / 不知道 */
export type Certainty = 'seen' | 'inferred' | 'unknown'

export interface Evidence {
  certainty: Certainty
  /** 一句话依据，例如「实心黑粗线，240mm」 */
  basis?: string
  /** 在原图上的像素框，用于叠图回溯 */
  pixelBox?: Box
  /** 用户确认过：谁、何时、补充说明 */
  confirmed?: { by: string; at?: string; note?: string }
}

/**
 * 墙的类型。只是画面分类，不证明实际承重，不能据此做施工决定。
 * exterior 外墙 / bearing 承重墙 / partition 非承重墙 / glass 玻璃隔断（通高）
 * half 矮墙（只有下部实体）/ half-glass 下部实体 + 上部玻璃
 */
export type WallKind = 'exterior' | 'bearing' | 'partition' | 'glass' | 'half' | 'half-glass'

export interface Wall {
  id: string
  /** 所在楼层 id；缺省为第一层（单层户型不用写） */
  level?: string
  /** 中心线起点、终点 */
  a: Vec2
  b: Vec2
  /** 墙厚 mm */
  thickness: number
  kind: WallKind
  /** 墙顶高度 m；缺省取两侧房间层高的较大值，再缺省取 plan.ceiling */
  height?: number
  /** half / half-glass 的实体部分高度 m，缺省 1.0 */
  lowHeight?: number
  /** 圆弧矢高 mm；0 或缺省为直墙。正值朝法向 n 一侧鼓起，负值朝反方向（n 的定义见文件末 NORMAL_CONVENTION） */
  bulge?: number
  name?: string
  evidence?: Evidence
}

/**
 * 洞口（门、窗、门洞）。挂在一面墙上（直墙、弧墙都可以），用沿中心线（弧墙按弧长）的距离定位；墙动，洞口跟着动。
 * door 平开门 / sliding 推拉门 / doorway 门洞（无门扇）
 * window 普通窗 / floor-window 落地窗 / bay-window 飘窗 / open-balcony 未封阳台（栏杆，无窗扇）
 */
export type OpeningKind =
  | 'door'
  | 'sliding'
  | 'doorway'
  | 'window'
  | 'floor-window'
  | 'bay-window'
  | 'open-balcony'

export type PaneKind = 'fixed' | 'casement' | 'sliding'

export interface Opening {
  id: string
  /** 宿主墙 id；楼层跟随宿主墙。直墙、弧墙都可以开洞 */
  wall: string
  /** 洞口近端离宿主墙 a 端的距离 mm（沿中心线；弧墙按弧长） */
  offset: number
  /** 洞口宽 mm */
  width: number
  kind: OpeningKind
  /** 洞底离地 m；门和门洞为 0 */
  sill: number
  /** 洞顶离地 m；洞顶到墙顶之间自动补过梁 */
  head: number
  /** 平开门：铰链在洞口哪一端（start = 靠墙 a 端）；门扇开向哪一侧：1 = 朝墙的法向 n 一侧，-1 = 反方向 */
  swing?: { hinge: 'start' | 'end'; side: 1 | -1 }
  /** 窗分扇，按宽度比例铺满洞口 */
  panes?: { width: number; kind: PaneKind }[]
  /** 入户门 */
  entry?: boolean
  name?: string
  evidence?: Evidence
}

/** 横梁：从梁底到所在房间顶面的实体 */
export interface Beam {
  id: string
  level?: string
  a: Vec2
  b: Vec2
  /** 梁宽 mm */
  width: number
  /** 梁底离地 m */
  bottom: number
  name?: string
  evidence?: Evidence
}

export interface Room {
  id: string
  level?: string
  name: string
  /** 依序顶点，不重复末点、不自交 */
  poly: Vec2[]
  /** 层高 m；缺省取 plan.ceiling */
  ceiling?: number
  /** 地面相对本层楼面的高差 m：飘窗台 0.45 为正，卫生间降板 −0.05 为负；缺省 0 */
  floorOffset?: number
  /** 用途的自由文字，例如「衣帽间」「健身区」 */
  use?: string
  /** 是否计入使用面积；缺省 true（空调平台、飘窗台一般 false） */
  counted?: boolean
  evidence?: Evidence
}

/** 底图：原始户型图，用于描图和叠图核对。禁止远程地址 */
export interface Underlay {
  /** 页面相对的本地路径，或本地导入生成的 data URL */
  src: string
  /** 每像素多少 mm；mmPerPxY 缺省等于 mmPerPx */
  mmPerPx: number
  mmPerPxY?: number
  /** 平面 (0,0) 在原图上的像素位置 */
  origin: Vec2
  rotation?: number
  flipX?: boolean
  flipY?: boolean
  /** 0–100 */
  opacity: number
  visible: boolean
  /** 定比例记录：原图上两点、它们之间的真实长度 mm */
  calibrations?: { p1: Vec2; p2: Vec2; length: number; note?: string }[]
}

export type QuestionCategory = 'original' | 'renovation'

export interface Question {
  id: string
  level?: string
  text: string
  /** original 原始信息 / renovation 改造 */
  category: QuestionCategory
  /** 为什么问：推断出来的需要确认，或完全不知道 */
  certainty?: Certainty
  /** 问题在平面上的位置框 mm，用于钉在图上和截取底图缩略图 */
  bbox?: Box
  /** 问的是哪些构件 */
  targets?: string[]
  options?: string[]
  /** 空或缺省 = 待答。工具只存答复文字，几何由 Agent 按答复去改 */
  answer?: string
  answeredBy?: string
  answeredAt?: string
}

/** 楼层：复式、跃层用。单层户型可以不写 levels */
export interface Level {
  id: string
  /** 「1F」「2F」「阁楼」 */
  name: string
  /** 本层楼面标高 m，第一层为 0 */
  elevation: number
  /** 本层默认层高 m；缺省取 plan.ceiling */
  ceiling?: number
}

/** 柱：独立柱或墙垛。bearing 视为受保护，拆除要二次确认 */
export interface Column {
  id: string
  level?: string
  center: Vec2
  shape: 'rect' | 'round'
  /** rect 为 [宽, 深] mm；round 为 [直径, 直径] */
  size: Vec2
  /** 绕中心旋转角，度 */
  rotation?: number
  kind: 'bearing' | 'decorative'
  name?: string
  evidence?: Evidence
}

/** 管道井、烟道、风道：不可拆，改造时提示 */
export interface Shaft {
  id: string
  level?: string
  poly: Vec2[]
  kind: 'flue' | 'pipe' | 'vent' | 'other'
  name?: string
  evidence?: Evidence
}

/** 楼梯：从 level 走到 to。path 是上行方向的踏步中心线（起点在低处），poly 是平面占地 */
export interface Stair {
  id: string
  level: string
  to: string
  poly: Vec2[]
  path: Vec2[]
  /** 梯段宽 mm */
  width: number
  kind: 'straight' | 'L' | 'U' | 'spiral'
  /** 踏步数；缺省按每步约 170mm 高自动算 */
  steps?: number
  name?: string
  evidence?: Evidence
}

/** 楼板开洞（挑空、楼梯洞）：这一层在 poly 范围内没有楼面 */
export interface Void {
  id: string
  level: string
  poly: Vec2[]
  name?: string
  /** 挑空不允许 evidence；拿不准写问题卡。 */
  evidence?: never
}

/**
 * 能被选中、被 changes 指向的构件类型。S2a（10-29）把柱、管道井、楼梯、挑空并了进来：
 * 改造记录可以新增 / 修改 / 拆除它们（管道井拆除一律报错，承重柱拆除要二次确认）。
 */
export type ElementType = 'wall' | 'opening' | 'beam' | 'room' | 'column' | 'shaft' | 'stair' | 'void'
export type PlanElement = Wall | Opening | Beam | Room | Column | Shaft | Stair | Void
/** 10-29 新增的四类结构构件（ElementType 的子集，保留这个名字给按类型分支的代码用） */
export type ExtraElementType = Extract<ElementType, 'column' | 'shaft' | 'stair' | 'void'>
export type ExtraElement = Column | Shaft | Stair | Void

/**
 * 改造记录：叠在原始结构上按顺序重放，原始结构始终保留。
 * add 新增（data 是完整对象）/ remove 拆除（可用 range 只拆墙的一段）/ update 修改（data 是要改的字段）
 */
export interface Change {
  id: string
  op: 'add' | 'remove' | 'update'
  type: ElementType
  /** remove / update 的目标 id */
  target?: string
  data?: Record<string, unknown>
  /** 只拆墙的一段：沿中心线离 a 端的 [起, 止] mm。拆后第一段保留原 id，第二段 id 为 `${target}~${change.id}` */
  range?: [number, number]
  /** 一句白话：想做什么、哪里是近似 */
  note?: string
  /** 同一次操作产生的多条记录共用一个 group（例如拖一个墙角同时改两面墙），撤销和清单按组处理 */
  group?: string
  by: 'user' | 'agent'
  /** 待确认 / 已确认（用户看过 Agent 的提议） */
  status: 'pending' | 'confirmed'
  /** 拆或开洞承重墙、外墙时必须有：用户的二次确认。缺了这一条，重放时只报 needsConfirm，不执行 */
  confirm?: { by: string; at?: string }
  at?: string
}

export interface Plan {
  decor?: Decor
  format: 'floorplan-structure'
  version: 2 | 3
  title: string
  /** 全屋默认层高 m */
  ceiling: number
  /** 北向角：0 = 图上方，顺时针为正 */
  north?: number
  walls: Wall[]
  openings: Opening[]
  beams: Beam[]
  rooms: Room[]
  /** 以下为可选构件，缺省视为空 */
  levels?: Level[]
  columns?: Column[]
  shafts?: Shaft[]
  stairs?: Stair[]
  voids?: Void[]
  /** 每层一张底图时用：键为楼层 id；缺省用 underlay */
  levelUnderlays?: Record<string, Underlay>
  underlay?: Underlay
  questions: Question[]
  changes: Change[]
  /** 旧格式里这一阶段不用的字段（家具、灯光、墙漆、日照……）原样保留，导出时带回，不丢数据 */
  legacy?: Record<string, unknown>
  meta?: {
    /** 方案文件的本地相对路径，用于 Agent 交接和本地服务轮询 */
    planFile?: string
    source?: string
    createdAt?: string
    updatedAt?: string
  }
}

/** 新建构件时的默认值（mm / m） */
export const DEFAULTS = {
  ceiling: 2.8,
  thickness: { exterior: 240, bearing: 200, partition: 120, glass: 80, half: 120, 'half-glass': 120 } as Record<WallKind, number>,
  lowHeight: 1.0,
  opening: {
    door: { width: 900, sill: 0, head: 2.1 },
    sliding: { width: 1600, sill: 0, head: 2.2 },
    doorway: { width: 900, sill: 0, head: 2.1 },
    window: { width: 1500, sill: 0.9, head: 2.4 },
    'floor-window': { width: 2400, sill: 0.05, head: 2.5 },
    'bay-window': { width: 1800, sill: 0.45, head: 2.4 },
    'open-balcony': { width: 2400, sill: 0, head: 2.5 },
  } as Record<OpeningKind, { width: number; sill: number; head: number }>,
  beam: { width: 240, bottom: 2.5 },
} as const

/** 拆除或开洞时需要用户二次确认的墙类型；承重柱（Column.kind = bearing）同样受保护，管道井不可拆（拆除记录一律报 error） */
export const PROTECTED_KINDS: readonly WallKind[] = ['bearing', 'exterior']

/**
 * 墙的法向约定（全工程统一）：墙方向 d = b − a，法向 n = (−d.y, d.x) / |d|。
 * 平面坐标 y 向下，所以一面从左往右画的墙（d 指向屏幕右方），n 指向屏幕下方。
 * 和旧格式 freeWalls 的 bulge 方向一致，旧数据可直接搬。
 */
export const NORMAL_CONVENTION = 'n = (-dy, dx) / |b - a|' as const
