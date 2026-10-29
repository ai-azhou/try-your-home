import { afterEach, describe, expect, it, vi } from 'vitest'
import { mirror } from '../ui/actions.ts'
import { useStore } from '../ui/store.ts'
import { emptyPlan } from './io.ts'
import { updateWall } from './edit.ts'

const setup = () => {
  vi.useFakeTimers()
  const p = emptyPlan()
  p.walls = [{ id: 'w', a: [0, 0], b: [3000, 0], thickness: 200, kind: 'partition' }]
  p.changes = [updateWall('w', { a: [100, 50] })]
  useStore.getState().loadPlan(p)
  return p
}
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('C2 mirror action and shared undo integration', () => {
  it('仅原始模式允许镜像；改造/对比提示且没有写入历史', () => {
    const p = setup()
    for (const mode of ['renovation', 'compare'] as const) {
      useStore.getState().setMode(mode)
      mirror('x')
      expect(useStore.getState().base).toEqual(p)
      expect(useStore.getState().toast).toBe('镜像请在原始模式做')
      expect(useStore.getState().hist.original.past).toHaveLength(0)
    }
  })
  it.each(['original', 'renovation', 'compare'] as const)('%s 可一次撤回和重做镜像，同时还原 base 与 changes', mode => {
    const p = setup(); mirror('x')
    const mirrored = useStore.getState().base
    expect(mirrored!.changes[0].data!.a).toEqual([2900, 50])
    useStore.getState().setMode(mode)
    expect(useStore.getState().hist.renovation.past).toHaveLength(1)
    useStore.getState().undo(); expect(useStore.getState().base).toEqual(p)
    useStore.getState().redo(); expect(useStore.getState().base).toEqual(mirrored)
  })
  it('镜像后交替原始/改造编辑按时间撤回，不覆写另一模式的数据', () => {
    const p = setup(); mirror('y')
    const mirrored = useStore.getState().base
    useStore.getState().edit([updateWall('w', { thickness: 250 })])
    const originalEdit = useStore.getState().base
    useStore.getState().setMode('renovation')
    useStore.getState().edit([updateWall('w', { height: 3 })])
    const renovated = useStore.getState().base
    useStore.getState().undo(); expect(useStore.getState().base).toEqual(originalEdit)
    useStore.getState().undo(); expect(useStore.getState().base).toEqual(mirrored)
    useStore.getState().undo(); expect(useStore.getState().base).toEqual(p)
    useStore.getState().setMode('original')
    useStore.getState().redo(); useStore.getState().redo(); useStore.getState().redo()
    expect(useStore.getState().base).toEqual(renovated)
    useStore.getState().loadPlan(p)
    expect(useStore.getState().hist.original.past).toEqual([])
    expect(useStore.getState().hist.renovation.future).toEqual([])
  })
  it('连续字段编辑和拖动仍只占一步；撤销后的新编辑清除 redo', () => {
    const p = setup()
    useStore.getState().edit([updateWall('w', { thickness: 250 })], { key: 'thickness' })
    useStore.getState().edit([updateWall('w', { thickness: 300 })], { key: 'thickness' })
    expect(useStore.getState().hist.original.past).toHaveLength(1)
    useStore.getState().undo(); expect(useStore.getState().base).toEqual(p)
    useStore.getState().txBegin()
    useStore.getState().txSet([updateWall('w', { b: [3200, 0] })])
    useStore.getState().txSet([updateWall('w', { b: [3400, 0] })])
    useStore.getState().txEnd()
    expect(useStore.getState().hist.original.future).toHaveLength(0)
    expect(useStore.getState().hist.original.past).toHaveLength(1)
    useStore.getState().undo(); expect(useStore.getState().base).toEqual(p)
  })
})

it('改造模式菜单两项置灰并给提示，原始模式恢复；菜单事件不能绕过动作守卫', async () => {
  vi.resetModules()
  const listeners = new Map<string, (event: any) => void>()
  let observerCallback: (() => void) | undefined
  class FakeElement {
    attrs = new Map<string, string>([['role', 'menuitem']])
    title = ''
    style = { opacity: '' }
    nextElementSibling: FakeElement | null = null
    setAttribute(key: string, value: string) { this.attrs.set(key, value) }
    getAttribute(key: string) { return this.attrs.get(key) ?? null }
    toggleAttribute(key: string, enabled: boolean) { if (enabled) this.attrs.set(key, ''); else this.attrs.delete(key) }
    contains(other: unknown) { return other === this }
  }
  const x = new FakeElement(), y = new FakeElement(); x.nextElementSibling = y
  vi.stubGlobal('HTMLElement', FakeElement); vi.stubGlobal('Node', FakeElement)
  vi.stubGlobal('KeyboardEvent', class {})
  vi.stubGlobal('MutationObserver', class { constructor(callback: () => void) { observerCallback = callback } observe() {} })
  vi.stubGlobal('document', { documentElement: {}, querySelector: () => x, addEventListener: (name: string, cb: (event: any) => void) => listeners.set(name, cb) })
  vi.useFakeTimers()
  try {
    await import('../ui/actions.ts')
    const { useStore: menuStore } = await import('../ui/store.ts')
    menuStore.getState().loadPlan(emptyPlan())
    menuStore.getState().setMode('renovation')
    observerCallback!()
    for (const entry of [x, y]) {
      expect(entry.getAttribute('aria-disabled')).toBe('true')
      expect(entry.attrs.has('data-disabled')).toBe(true)
      expect(entry.style.opacity).toBe('0.4')
      expect(entry.title).toBe('镜像请在原始模式做')
    }
    const event = { target: x, preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() }
    listeners.get('click')!(event)
    expect(event.preventDefault).toHaveBeenCalled()
    menuStore.getState().setMode('original')
    expect(x.getAttribute('aria-disabled')).toBe('false')
    expect(y.attrs.has('data-disabled')).toBe(false)
  } finally { vi.unstubAllGlobals(); vi.clearAllTimers(); vi.useRealTimers() }
})
