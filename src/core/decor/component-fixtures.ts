import type { CustomComponent } from './types.ts'
const box = (w: number, d: number) => `M0 0H${w}V${d}H0Z`
/** Fictional dimensions for regression/examples; not a product specification. */
export const componentExamples: CustomComponent[] = [
  { id: 'tv65', name: '65 寸电视示例', category: 'appliance', basis: '虚构测试尺寸，非产品参数', size: [1450, 80], height: 830,
    front: [{ d: 'M20 20H1430V810H20Z', style: 'detail', stroke: '#222' }], parts: [{ outline: box(1450, 80), z: [0, 830], color: '#222222' }] },
  { id: 'round-rug', name: '圆地毯', category: 'soft', size: [1600, 1600], height: 10,
    parts: [{ outline: 'M1600 800A800 800 0 1 1 0 800A800 800 0 1 1 1600 800Z', z: [0, 10] }] },
  { id: 'l-sofa', name: 'L 形沙发', category: 'furniture', size: [2400, 1600], height: 850,
    parts: [{ outline: box(2400, 850), z: [0, 450] }, { outline: 'M0 850H800V1600H0Z', z: [0, 450] }, { kind: 'side', along: 'width', profile: 'M0 0H180L280 400H0Z', span: [0, 2400] }] },
  { id: 'four-leg-table', name: '四腿餐桌', category: 'furniture', size: [1600, 800], height: 750,
    parts: [{ outline: box(1600, 800), z: [700, 750] }, ...[[60, 60], [1460, 60], [60, 660], [1460, 660]].map(([x, y]) => ({ outline: `M${x} ${y}h80v80h-80Z`, z: [0, 700] as [number, number] }))] },
  { id: 'lamp', name: '台灯', category: 'lighting', size: [400, 400], height: 600,
    parts: [{ kind: 'revolve', profile: 'M0 580H160V600H0Z' }, { kind: 'revolve', profile: 'M0 220H15V580H0Z' }, { kind: 'revolve', profile: 'M80 0H100L200 240H180Z', color: '#efc' }] },
]
