import type { Box, Vec2 } from "../types"

/** 装修层：Plan 上的可选块。没有这个字段 = 还没开始装修 */
export interface DecorLayer {
  version: 1
  /** 当前整体风格：内置风格 id（'cream' 奶油原木 …）或 presets 里的自定义风格 id */
  style: string
  /** 方案里用到的材料。内置材料被用到时复制一份进来（自包含）；用户自定义颜色也在这里 */
  materials: Material[]
  /** 自定义风格：用户另存的、Agent 配的 */
  presets?: StylePreset[]
  components?: CustomComponent[]
  /** 面的覆盖（地面、墙面、顶面）。没写的面 = 跟风格 */
  surfaces: Surface[]
  furniture: Furniture[]
  /** 门扇和门框的外观；位置及开法仍由结构 Opening 决定 */
  doors?: DoorFinish[]
  cabinets: Cabinet[]
  /** 造型：背景墙板、护墙板、格栅、踢脚线、拱形门套 */
  panels: Panel[]
  /** 用户画的壁龛和挖洞。柜子、家电的「嵌进墙里」由它们自己的 embed 字段派生，不存在这里 */
  recesses: Recess[]
  /**
   * 每个构件最后一次挂得上时的位置（平面 mm 外接框 + 所在墙面线段）。
   * 工具维护，Agent 不用写；墙被拆以后靠它把「没地方挂」的幽灵画在原处、推荐就近的墙。
   */
  cache?: Record<string, { level?: string; box: Box; anchor?: { wall: string; a: Vec2; b: Vec2 }; pose?: { at: Vec2; rot: number; z: number }; face?: [Vec2, Vec2] }>
}

/** 所有装修构件共有 */
export interface DecorBase {
  /** 修改前的 confirmed 项；否掉恢复，确认清除。单位同所在项。 */
  prev?: Record<string, unknown>
  id: string
  name?: string
  /** 楼层：挂在墙上的跟墙走，自由摆放的（家具、岛台）写自己的；缺省第一层 */
  level?: string
  by: 'user' | 'agent'
  status: 'pending' | 'confirmed'
  /** 一句白话：想做什么 */
  note?: string
  /** 外观描述，最多 300 字；不影响几何 */
  look?: string
  /**
   * 受保护墙（承重 / 外墙 / 承重柱）上的嵌入：用户看过事实说明，点了「知道了」。
   * 这不是「允许」，只是「看过了」；改造清单照样列进「需要专业确认」。
   */
  ack?: { by: string; at?: string }
}

/**
 * 墙面 = 一面墙的一侧。side 和 Opening.swing.side 同义：1 = 墙法向 n 那一侧，−1 = 反方向。
 * （n = (−dy, dx) / |b − a|，见 types.ts NORMAL_CONVENTION）
 */
export interface FaceRef { wall: string; side: 1 | -1 }

/** 墙面上的一块：s 沿中心线离墙 a 端（mm，弧墙按弧长），z 离本层楼面（m） */
export interface FaceSpan { face: FaceRef; s: [number, number]; z: [number, number] }

export interface Recess extends DecorBase {
  /** niche 壁龛（挖在墙上，可以空着、加层板）/ hole 挖洞（挖在造型板或柜子上） */
  kind: 'niche' | 'hole'
  host: { face: FaceRef } | { panel: string } | { cabinet: string }
  /** 墙上用 s（沿墙 mm）；造型、柜子上用 u（宿主局部 mm）；z 一律离地 m */
  rect: { s?: [number, number]; u?: [number, number]; z: [number, number] }
  /** 从宿主表面往里多深（mm）。'through' 只给造型和柜子：挖穿，露出后面的墙面 */
  depth: number | 'through'
  /** 龛里背板的材料，缺省同所在面 */
  back?: string
  /** 龛里层板离地高度（m） */
  shelves?: number[]
  /** 收边材料（1b） */
  trim?: string
}

export interface Cabinet extends DecorBase {
  /** 高柜 / 地柜 / 吊柜：平面画法按这个分（设计规范 §4.3） */
  family: 'tall' | 'base' | 'wall'
  /** 靠墙：贴哪面墙、近端在哪（s，mm）、离墙面多远；或独立摆放（岛台）：中心点、角度 */
  place: { face: FaceRef; s: number; gap?: number } | { at: Vec2; rot: number }
  /** 宽（沿墙 mm）、柜深（mm，从墙面量，含嵌进墙里的部分） */
  width: number
  depth: number
  /** 柜底、柜顶离地 m（地柜 [0, 0.82]、吊柜 [1.55, 2.25] 是常见值，只做新建时的默认） */
  z: [number, number]
  /** 踢脚（底座）高 m；悬空柜、吊柜为 0 */
  plinth?: number
  /** 嵌进墙里 mm。>0 时派生一个墙上嵌入（规则见 §4） */
  embed?: number
  /** 台面：地柜、洞里的书桌板都用它 */
  top?: { material: string; thickness: number; overhang?: number }
  /** 分列，从左到右（站在柜子前面看的左右，和立面一致） */
  columns: CabinetColumn[]
  /** 跨格的洞：在柜子立面上画一个框，压到的格子被裁掉 */
  cuts?: { u: [number, number]; z: [number, number]; depth: 'through' | number }[]
  materials: { carcass: string; front: string }
  handle?: 'none' | 'bar' | 'knob' | 'edge'
}

export interface CabinetColumn {
  /** mm；各列之和 = width；最后一列可以省略，取剩下的 */
  width?: number
  /** 从下往上；各格高度之和 = 柜高 − 踢脚；最上一格可以省略 h */
  cells: CabinetCell[]
}

export type ApplianceType = 'fridge' | 'washer' | 'dryer' | 'oven' | 'steamer' | 'dishwasher' | 'microwave' | 'tv' | 'other'

export interface CabinetCell {
  h?: number
  /** 单开门 / 对开门 / 抽屉 / 上翻门 / 开放格 / 挖洞 / 家电位 */
  type: 'door' | 'doors' | 'drawers' | 'flap' | 'open' | 'void' | 'appliance'
  hinge?: 'left' | 'right'
  /** 抽屉个数；开放格里的层板数 */
  count?: number
  /** 挖洞：挖穿柜体露出墙面，或留一块背板（mm，从门板面往里挖多深）；洞里可以加一块台面 */
  void?: { depth: 'through' | number; top?: { z: number; overhang?: number; material?: string } }
  /** 家电位：放什么、外形（宽深 mm、高 m；缺省按家具库的常见尺寸） */
  appliance?: { type: ApplianceType; size?: [number, number, number] }
  /** 这一格门板单独换色 */
  material?: string
}

export interface Panel extends DecorBase {
  /** 背景墙板 / 护墙板 / 格栅 / 踢脚线 / 拱形门套 */
  type: 'feature' | 'wainscot' | 'slats' | 'skirting' | 'arch'
  /** 贴在哪面墙的哪一块；arch 用 opening 定位，不写 span */
  span?: FaceSpan
  opening?: string
  /** 出墙厚度 mm（含龙骨、基层） */
  thickness: number
  material: string
  /** 分缝：竖缝 / 横缝，间距、缝宽 mm */
  grooves?: { dir: 'v' | 'h'; spacing: number; width?: number }
  /** 护墙板的框线 */
  frame?: { style: 'flat' | 'raised'; margin: number }
  /** 格栅：条宽、间隙、条深 mm */
  slats?: { width: number; gap: number; depth: number }
  /** 拱形门套：拱顶半径 mm，缺省 = 洞宽 / 2（半圆拱）。只在原门洞里做，不改洞口 */
  arch?: { radius?: number }
  /** 遇到门窗：缺省自动让开（造型板上扣掉洞口） */
  avoid?: 'openings' | 'none'
}

/** 自由家具存世界 at/rot；宿主家具只存 in，rot 是相对宿主的角度偏移。 */
export type Furniture = FurnitureBase & ({ at: Vec2; rot: number; in?: never } | { in: string; at?: never; rot?: number })

export interface FurnitureBase extends DecorBase {
  flip?: boolean
  /** 家具库 id：'sofa-3'、'bed-1800'、'fridge' …；custom:<id> 引用构件定义；未知 id 警告并画通用盒子 */
  type: string
  /** 宽 × 深 mm；高 m（立面淡显轮廓用，以后 3D 用） */
  size: [number, number]
  height: number
  /** 离地 m：壁挂电视、悬空床头柜 */
  z?: number
  /** 靠墙：结构改了以后按它重新贴墙；拖到离墙面 150mm 以内自动记上 */
  against?: { face: FaceRef; gap: number }
  /** 家电嵌进墙里 mm（规则同柜子 embed） */
  embed?: number
  materials?: { body?: string; fabric?: string }
}

export type MaterialCategory = 'wood-floor' | 'tile' | 'stone' | 'paint' | 'texture-paint' | 'wallpaper' | 'veneer' | 'microcement' | 'laminate' | 'fabric' | 'leather' | 'metal' | 'glass' | 'rattan' | 'other'

export interface Material {
  id: string
  name: string
  category: MaterialCategory
  /** 真实色 sRGB。卡片色块、立面用它；平面显示时界面统一压低彩度（设计规范 §2.3），数据里不存第二份 */
  color: string
  /** 2D 轻量纹理（按真实尺寸画） */
  texture?: { kind: 'planks' | 'tiles' | 'herringbone' | 'grain' | 'speckle' | 'veins' | 'weave'; size?: [number, number]; joint?: number }
  /** 3D 以后用：PBR 子集。现在只存不用；贴图只能是本地相对路径 */
  pbr?: { roughness?: number; metalness?: number; sheen?: number; maps?: { base?: string; normal?: string; rough?: string } }
  /** 用户自己写的备注（品牌、色号）。工具不联网查，也不推荐品牌 */
  ref?: string
}

/** 材料角色：风格预设按角色给材料，面和构件按角色取 */
export type MaterialRole =
  | 'floor.main' | 'floor.wet' | 'floor.outdoor' | 'threshold'
  | 'wall.main' | 'wall.wet' | 'wall.accent' | 'ceiling' | 'skirting'
  | 'wood.main' | 'cabinet.front' | 'cabinet.carcass' | 'stone.top' | 'metal'
  | 'fabric.main' | 'fabric.accent' | 'rug'

export interface StylePreset {
  id: string
  name: string
  blurb?: string
  roles: Partial<Record<MaterialRole, string>>
  /** 房间规则：名称或用途里含这些字的房间用哪个地面 / 墙面角色。缺省：卫、厨、淋浴、浴室、马桶、盥洗、洗手、洗衣、阳台 → 湿区；景观、休闲、观景阳台不算 */
  rooms?: { match: string[]; floor?: MaterialRole; wall?: MaterialRole }[]
  trims?: { skirting?: { height: number; role: MaterialRole }; threshold?: boolean }
  /** 风格卡上材料板用哪几块（4–6 块） */
  board?: string[]
  by?: 'builtin' | 'user' | 'agent'
}

export type SurfaceTarget =
  | { floor: string }
  | { ceiling: string }
  /** 墙面：不写 s / z = 整面；写 s = 一段；写 z = 到某个高度（双色墙、护墙漆） */
  | { face: FaceRef; s?: [number, number]; z?: [number, number] }

export interface Surface {
  prev?: Record<string, unknown>
  id: string
  target: SurfaceTarget
  material: string
  /** 铺法：直铺 / 错缝 / 人字拼 / 鱼骨拼 / 对缝 / 斜铺；砖的规格、起铺点、角度 */
  layout?: { pattern: 'straight' | 'staggered' | 'herringbone' | 'chevron' | 'grid' | 'diagonal'; size?: [number, number]; origin?: Vec2; angle?: number; joint?: number }
  by: 'user' | 'agent'
  status: 'pending' | 'confirmed'
}

export type Decor = DecorLayer

export interface DecorIssue {
  id: string
  code: "unknown-type" | "unit-suspect" | "component-invalid" | "component-missing" | "column-width" | "host-missing" | "host-cut" | "out-of-face" | "too-deep" | "wall-kind" | "over-opening" | "through-wall" | "meet-other-side" | "into-shaft" | "host-depth" | "protected" | "room-missing" | "arc-unsupported" | "invalid" | "duplicate-id" | "material-missing"
  level: "error" | "warn" | "info"
  text: string
  fix?: ("move" | "clip" | "keep" | "delete")[]
}

/** 分类决定界面分组和分割，不限制几何。 */
export type ComponentCategory = 'furniture' | 'appliance' | 'sanitary' | 'lighting' | 'ceiling' | 'plant' | 'soft' | 'storage' | 'other'
export interface ComponentPath { d: string; style?: 'outline' | 'detail' | 'dashed'; fill?: string; stroke?: string }
interface ComponentPartBase { name?: string; color?: string; material?: string }
export type ComponentPart = ComponentPartBase & (
  | { kind?: 'extrude'; outline: string; z: [number, number] }
  | { kind: 'side'; along: 'width' | 'depth'; profile: string; span: [number, number] }
  | { kind: 'revolve'; profile: string; center?: Vec2 })
/** 每张图均为 SVG 画布：左上角 (0,0)，x 向右，y 向下。所有长度在文件和内存中均为 mm。 */
export interface CustomComponent {
  id: string
  name: string
  category: ComponentCategory
  label?: string
  basis?: string
  look?: string
  size: [number, number]
  height: number
  plan?: ComponentPath[]
  front?: ComponentPath[]
  parts: ComponentPart[]
  seg?: string
}

/** 门的外观。门的位置、宽高、开法还是结构 Opening。 */
export interface DoorFinish extends DecorBase {
  opening: string
  /** #RRGGBB 或材料 id */
  color?: string
  material?: string
  frame?: { color?: string; material?: string }
  /** 洞口宽 × 洞口高 mm，y=0 是顶；不改变白模几何 */
  front?: ComponentPath[]
  /** 正面图 x 翻转：x → 洞口宽 − x */
  flip?: boolean
}
