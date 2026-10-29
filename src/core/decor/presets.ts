import type { Decor, Material, MaterialCategory, StylePreset } from "./types.ts"

// Names, colors and boards copied from the approved sample 02.
const sampleMaterials = {
  oak: { name: '浅橡木地板', cat: '木地板', color: '#cfb28a', tex: 'planks', size: [1200, 190] },
  oakHb: { name: '橡木人字拼', cat: '木地板', color: '#c9a77c', tex: 'herring' },
  walnut: { name: '胡桃木地板', cat: '木地板', color: '#7f5a3d', tex: 'herring' },
  ash: { name: '白蜡木地板', cat: '木地板', color: '#e2d2b4', tex: 'planks', size: [1200, 160] },
  smokeOak: { name: '烟熏橡木地板', cat: '木地板', color: '#8f7d69', tex: 'planks', size: [1500, 200] },
  tileWarm: { name: '暖灰哑光砖', cat: '瓷砖', color: '#cdc8bf', tex: 'tiles', size: [600, 600] },
  tileGrey: { name: '浅灰大板砖', cat: '瓷砖', color: '#d4d4d1', tex: 'tiles', size: [900, 1800] },
  tileSage: { name: '灰绿小方砖', cat: '瓷砖', color: '#aeb8a8', tex: 'tiles', size: [200, 200] },
  micro: { name: '暖灰微水泥', cat: '微水泥', color: '#c6bcae', tex: 'speckle' },
  microPale: { name: '米灰微水泥', cat: '微水泥', color: '#d5ccbf', tex: 'speckle' },
  limewash: { name: '肌理艺术涂料', cat: '涂料', color: '#d7ccbc', tex: 'speckle' },
  cream: { name: '奶油白乳胶漆', cat: '乳胶漆', color: '#efe7da' },
  white: { name: '暖白乳胶漆', cat: '乳胶漆', color: '#f3f2ee' },
  mist: { name: '雾霾蓝乳胶漆', cat: '乳胶漆', color: '#a9b6bf' },
  forest: { name: '墨绿乳胶漆', cat: '乳胶漆', color: '#3f5b4d' },
  daiqing: { name: '黛青乳胶漆', cat: '乳胶漆', color: '#59686e' },
  rice: { name: '宣纸白乳胶漆', cat: '乳胶漆', color: '#eee8dc' },
  oakVeneer: { name: '白橡木饰面', cat: '木饰面', color: '#d4bc95', tex: 'grain' },
  elm: { name: '老榆木饰面', cat: '木饰面', color: '#9d8669', tex: 'grain' },
  teak: { name: '柚木饰面', cat: '木饰面', color: '#9b6b44', tex: 'grain' },
  walnutV: { name: '黑胡桃木饰面', cat: '木饰面', color: '#5b4231', tex: 'grain' },
  creamDoor: { name: '奶油白哑光柜门', cat: '柜门', color: '#ebe3d5' },
  greyDoor: { name: '雾灰哑光柜门', cat: '柜门', color: '#c9c8c4' },
  slab: { name: '鱼肚白岩板', cat: '石材', color: '#e8e5df', tex: 'veins' },
  travertine: { name: '米黄洞石', cat: '石材', color: '#d8ccb6', tex: 'veins' },
  blackSlab: { name: '黑色岩板', cat: '石材', color: '#3a3a3c', tex: 'veins' },
  brass: { name: '香槟金', cat: '金属', color: '#b9a079' },
  gunmetal: { name: '枪灰金属', cat: '金属', color: '#4a4b4e' },
  bronze: { name: '古铜', cat: '金属', color: '#8b6a48' },
  oat: { name: '燕麦色布艺', cat: '布艺', color: '#d8ccb8' },
  linen: { name: '亚麻原色', cat: '布艺', color: '#d6cab6' },
  charcoal: { name: '炭灰布艺', cat: '布艺', color: '#77797b' },
  mustard: { name: '芥末黄布艺', cat: '布艺', color: '#c89b3c' },
  caramel: { name: '焦糖皮革', cat: '皮革', color: '#a8673a' },
  fog: { name: '雾灰布艺', cat: '布艺', color: '#c9ccca' },
  rugWool: { name: '米白羊毛地毯', cat: '地毯', color: '#e7e0d3' },
  rugGrey: { name: '浅灰手工毯', cat: '地毯', color: '#d6d6d2' },
  rattan: { name: '藤编', cat: '藤编', color: '#c7a87a', tex: 'weave' },
} as const

/* ───────── 风格预设：材料角色 → 材料（数据格式草案 §5）。board = 风格卡上的材料板 ───────── */
const sampleStyles = {
  cream: {
    name: '奶油原木', blurb: '浅橡木 · 奶油白 · 岩板', roles: {
      'floor.main': 'oak', 'floor.wet': 'tileWarm', 'wall.main': 'cream', 'wall.accent': 'micro', 'wood.main': 'oakVeneer',
      'cabinet.front': 'creamDoor', 'stone.top': 'slab', 'metal': 'brass', 'fabric.main': 'oat', 'fabric.accent': 'caramel', 'rug': 'rugWool',
    }, board: ['oak', 'cream', 'micro', 'slab', 'oat', 'brass'],
  },
  wabi: {
    name: '侘寂', blurb: '微水泥 · 老榆木 · 亚麻', roles: {
      'floor.main': 'microPale', 'floor.wet': 'microPale', 'wall.main': 'limewash', 'wall.accent': 'limewash', 'wood.main': 'elm',
      'cabinet.front': 'elm', 'stone.top': 'travertine', 'metal': 'gunmetal', 'fabric.main': 'linen', 'fabric.accent': 'charcoal', 'rug': 'rugGrey',
    }, board: ['microPale', 'limewash', 'elm', 'travertine', 'linen', 'gunmetal'],
  },
  minimal: {
    name: '现代极简', blurb: '大板砖 · 暖白 · 黑钛', roles: {
      'floor.main': 'tileGrey', 'floor.wet': 'tileGrey', 'wall.main': 'white', 'wall.accent': 'white', 'wood.main': 'smokeOak',
      'cabinet.front': 'greyDoor', 'stone.top': 'blackSlab', 'metal': 'gunmetal', 'fabric.main': 'fog', 'fabric.accent': 'charcoal', 'rug': 'rugGrey',
    }, board: ['tileGrey', 'white', 'greyDoor', 'blackSlab', 'smokeOak', 'gunmetal'],
  },
  mid: {
    name: '中古', blurb: '胡桃人字拼 · 墨绿 · 焦糖皮', roles: {
      'floor.main': 'walnut', 'floor.wet': 'tileSage', 'wall.main': 'cream', 'wall.accent': 'forest', 'wood.main': 'teak',
      'cabinet.front': 'teak', 'stone.top': 'travertine', 'metal': 'brass', 'fabric.main': 'mustard', 'fabric.accent': 'caramel', 'rug': 'rugWool',
    }, board: ['walnut', 'forest', 'teak', 'caramel', 'mustard', 'brass'],
  },
  nordic: {
    name: '北欧', blurb: '白蜡木 · 雾霾蓝 · 浅灰布', roles: {
      'floor.main': 'ash', 'floor.wet': 'tileGrey', 'wall.main': 'white', 'wall.accent': 'mist', 'wood.main': 'ash',
      'cabinet.front': 'white', 'stone.top': 'slab', 'metal': 'gunmetal', 'fabric.main': 'fog', 'fabric.accent': 'mist', 'rug': 'rugGrey',
    }, board: ['ash', 'white', 'mist', 'fog', 'slab', 'rattan'],
  },
  zh: {
    name: '新中式', blurb: '黑胡桃 · 宣纸白 · 黛青', roles: {
      'floor.main': 'walnut', 'floor.wet': 'tileWarm', 'wall.main': 'rice', 'wall.accent': 'daiqing', 'wood.main': 'walnutV',
      'cabinet.front': 'walnutV', 'stone.top': 'slab', 'metal': 'bronze', 'fabric.main': 'linen', 'fabric.accent': 'daiqing', 'rug': 'rugWool',
    }, board: ['walnutV', 'rice', 'daiqing', 'slab', 'linen', 'bronze'],
  },
} as const

const categories: Record<string, MaterialCategory> = { '木地板': 'wood-floor', '瓷砖': 'tile', '微水泥': 'microcement', '涂料': 'texture-paint', '乳胶漆': 'paint', '木饰面': 'veneer', '柜门': 'laminate', '石材': 'stone', '金属': 'metal', '布艺': 'fabric', '皮革': 'leather', '地毯': 'fabric', '藤编': 'rattan' }
export const BUILTIN_MATERIALS: Material[] = Object.entries(sampleMaterials).map(([id, value]) => {
  const m = value as { name: string; cat: string; color: string; tex?: string; size?: readonly number[] }
  return { id, name: m.name, category: categories[m.cat], color: m.color, ...(m.tex ? { texture: { kind: (m.tex === 'herring' ? 'herringbone' : m.tex) as NonNullable<Material['texture']>['kind'], ...(m.size ? { size: [...m.size] as [number, number] } : {}) } } : {}) }
})
export const STYLE_PRESETS: StylePreset[] = Object.entries(sampleStyles).map(([id, p]) => ({ id, name: p.name, blurb: p.blurb, by: 'builtin', roles: { ...p.roles, 'floor.outdoor': p.roles['floor.wet'], 'wall.wet': p.roles['floor.wet'], ceiling: 'white', skirting: p.roles['wood.main'], threshold: p.roles['stone.top'], 'cabinet.carcass': p.roles['cabinet.front'] }, board: [...p.board], rooms: [{ match: ['卫', '厨'], floor: 'floor.wet', wall: 'wall.wet' }, { match: ['阳台'], floor: 'floor.outdoor' }], trims: { skirting: { height: .08, role: 'skirting' }, threshold: true } }))
export const STYLES = STYLE_PRESETS
export const MATERIALS = BUILTIN_MATERIALS
export function createDecor(style = 'cream'): Decor { return { version: 1, style, materials: structuredClone(BUILTIN_MATERIALS), surfaces: [], furniture: [], cabinets: [], panels: [], recesses: [] } }
