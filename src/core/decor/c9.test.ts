import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { editDecorFile, listDecor } from '../../../scripts/decor-edit.ts'
import { emptyPlan, parsePlanText, planFileValue, serializePlan } from '../io.ts'
import { mirrorPlan } from '../edit.ts'
import { applyChanges } from '../changes.ts'
import { renderKit, resolveCamera, type RenderOptions } from '../raster.ts'
import { createDecor } from './presets.ts'
import { furnitureCollisions, isOverhead } from './furniture.ts'
import { confirmedDecor, confirmDecorItems, rejectDecorItems, decorStatus } from './resolve.ts'
import { validateDecorRaw } from './validate.ts'
import { validateComponent } from './components.ts'
import { decorHandoff } from './integration.ts'
import type { CustomComponent, DoorFinish, Furniture } from './types.ts'
import type { Plan, Vec2 } from '../types.ts'

function roomPlan(): Plan {
  const p = emptyPlan()
  const corners: Vec2[] = [[0, 0], [4000, 0], [4000, 4000], [0, 4000]]
  p.walls = corners.map((a, i) => ({ id: ['n', 'e', 's', 'w'][i], a, b: corners[(i + 1) % 4], thickness: 200, kind: 'partition' }))
  p.rooms = [{ id: 'r', name: '客厅', ceiling: 3.1, poly: [[100, 100], [3900, 100], [3900, 3900], [100, 3900]] }]
  p.openings = [{ id: 'o', wall: 'n', offset: 1500, width: 1000, sill: 0, head: 2.2, kind: 'door' }]
  p.decor = createDecor()
  return p
}
const ceiling: CustomComponent = { id: 'roof', name: '石膏吊顶', category: 'ceiling', look: '暖白石膏，四周隐藏灯带', size: [3600, 3600], height: 350, parts: [{ outline: 'M0 0H3600V3600H0Z', z: [0, 200] }, { outline: 'M0 0H300V3600H0Z', z: [200, 350] }] }
const lamp: CustomComponent = { id: 'lamp', name: '吊灯', category: 'lighting', size: [600, 600], height: 600, parts: [{ outline: 'M0 0H600V600H0Z', z: [0, 600] }] }
const door = { id: 'finish', opening: 'o', look: '胡桃木竖纹门扇，黑色细门框', color: '#705040', material: 'oak', frame: { color: '#111111', material: 'oak' }, front: [{ d: 'M20 20H980V2180H20ZM800 1000h40v100h-40Z', style: 'outline' as const }] }
const size = { width: 144, height: 108 }
const camera = { projection: 'perspective' as const, pos: [2000, 1450, 3400] as [number, number, number], target: [2000, 1700, 0] as [number, number, number], fov: 80 }
let directory: string, file: string
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'decor-c9-')); file = join(directory, 'plan.json'); save(roomPlan()) })
afterEach(() => rmSync(directory, { recursive: true, force: true }))
const text = () => readFileSync(file, 'utf8')
const raw = () => JSON.parse(text())
const read = () => parsePlanText(text()).plan
const save = (p: Plan) => writeFileSync(file, serializePlan(p))
const edit = (...ops: unknown[]) => editDecorFile(file, text(), { ops })
const addDoor = (item = door, status = 'confirmed') => ({ op: 'add', kind: 'door', status, item })
function addCeiling() { edit({ op: 'component', component: ceiling }, { op: 'add', kind: 'furniture', status: 'confirmed', item: { id: 'roof-1', type: 'custom:roof' }, ceiling: { room: 'r' } }) }
function unchanged(action: () => unknown, message: RegExp) { const before = text(); expect(action).toThrow(message); expect(text()).toBe(before) }
function kit(p: Plan, options: RenderOptions = {}) { return renderKit(p, { ...size, camera, passes: ['clay', 'depth', 'lines', 'seg', 'openings'], ...options }) }

it('look writes and round trips, definition fallback and instance priority reach visible decor without changing pixels', () => {
  addCeiling()
  const p = read(), first = kit(p)
  expect(first.camera.decor!.visible.find(v => v.id === 'roof-1')?.look).toBe(ceiling.look)
  edit({ op: 'update', id: 'roof-1', set: { look: '浅灰水泥面，窄边灯槽' } })
  expect(parsePlanText(serializePlan(read())).plan.decor).toEqual(read().decor)
  const next = kit(read())
  expect(next.camera.decor!.visible.find(v => v.id === 'roof-1')?.look).toBe('浅灰水泥面，窄边灯槽')
  expect(next.files).toEqual(first.files)
  edit({ op: 'update', id: 'roof-1', set: {}, unset: ['look'] })
  expect(kit(read()).camera.decor!.visible.find(v => v.id === 'roof-1')?.look).toBe(ceiling.look)
  edit({ op: 'update', id: 'roof-1', set: { look: '字'.repeat(300) } })
  unchanged(() => edit({ op: 'update', id: 'roof-1', set: { look: '字'.repeat(301) } }), /look.*300/)
  unchanged(() => edit({ op: 'component', component: { ...ceiling, look: '字'.repeat(301) } }), /look.*300/)
  expect(validateComponent({ ...ceiling, look: '字'.repeat(301) }, new Set())).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'invalid' })]))
})
it('ceiling shorthand uses room height/bounds and preserves supplied position/rotation; bad rooms and incompatible locators are atomic errors', () => {
  addCeiling()
  expect(raw().decor.furniture[0]).toMatchObject({ at: [2000, 2000], rot: 0, z: 2750, height: 350 })
  edit({ op: 'component', component: lamp }, { op: 'add', kind: 'furniture', item: { id: 'lamp-1', type: 'custom:lamp', at: [1700, 2200], rot: 30 }, ceiling: { room: 'r' } })
  expect(raw().decor.furniture[1]).toMatchObject({ at: [1700, 2200], rot: 30, z: 2500 })
  const add = { op: 'add', kind: 'furniture', item: { type: 'custom:lamp' }, ceiling: { room: 'absent' } }
  unchanged(() => edit(add), /可选房间 id：r/)
  unchanged(() => edit({ ...add, wall: { face: { wall: 'n', side: 1 }, s: 2000 } }), /ceiling 与 wall/)
  unchanged(() => edit({ ...add, ceiling: { room: 'r' }, item: { type: 'custom:lamp', in: 'cabinet' } }), /ceiling 与 in/)
})
it('overhead is absent in iso/top/section across all passes, visible in room/custom cameras, counted once per instance and segmented ceiling', () => {
  addCeiling()
  const p = read(), bare = structuredClone(p); bare.decor!.furniture = []
  for (const options of [{ view: 'iso-sw', camera: undefined }, { view: 'top', camera: undefined }, { camera: 'iso-ne' }, { camera, section: 3000 }] as RenderOptions[]) {
    const k = kit(p, options), b = kit(bare, options)
    expect(k.files).toEqual(b.files)
    expect(k.camera.decor).toMatchObject({ overheadHidden: 1, visible: [] })
  }
  for (const selected of [camera, 'room:r']) {
    const k = kit(p, { camera: selected }), b = kit(bare, { camera: selected })
    expect(k.files['clay.png']).not.toEqual(b.files['clay.png'])
    expect(k.camera.decor).toMatchObject({ overheadHidden: 0 })
    expect(k.camera.decor!.visible).toContainEqual(expect.objectContaining({ id: 'roof-1', seg: 'ceiling' }))
  }
  p.decor!.furniture[0].status = 'pending'
  expect(kit(p, { camera: 'top' }).camera.decor).toMatchObject({ pendingHidden: 1, overheadHidden: 0 })
  expect(kit(p, { camera: 'top', includePending: true }).camera.decor).toMatchObject({ pendingHidden: 0, overheadHidden: 1 })
})
it('overhead classification handles lights, 50 mm tolerance, wall fallback and floor levels, and excludes both collision directions', () => {
  const p = roomPlan(); p.decor!.components = [ceiling, lamp]
  const f: Furniture = { id: 'light', type: 'custom:lamp', size: lamp.size, height: .6, z: 2.5, at: [2000, 2000], rot: 0, by: 'agent', status: 'confirmed' }
  expect(isOverhead(p, f)).toBe(true)
  expect(isOverhead(p, { ...f, z: 2.45 })).toBe(true)
  expect(isOverhead(p, { ...f, z: 2.449 })).toBe(false)
  expect(isOverhead(p, { ...f, z: 2.56 })).toBe(false)
  expect(isOverhead(p, { ...f, z: 0 })).toBe(false)
  const block: Furniture = { ...f, id: 'block', type: 'wardrobe', height: 3, z: 0 }
  p.decor!.furniture = [f, block]
  expect(furnitureCollisions(p, block)).toEqual([])
  expect(furnitureCollisions(p, f)).toEqual([])
  f.z = 0
  expect(furnitureCollisions(p, block)).toContainEqual({ id: f.id, type: 'furniture' })
  p.rooms = []; p.walls[0].height = 3.4
  expect(isOverhead(p, { ...f, z: 2.8 })).toBe(true)
  p.levels = [{ id: 'L1', name: '一层', elevation: 0 }, { id: 'L2', name: '二层', elevation: 3.5, ceiling: 3.6 }]
  expect(isOverhead(p, { ...f, level: 'L2', z: 3 })).toBe(true)
  expect(isOverhead(p, { ...f, type: 'custom:roof', z: 0 })).toBe(true)
})
it('ceiling shorthand follows the specified room floor and camera fitting ignores overhead obstacles', () => {
  const p = roomPlan(); p.levels = [{ id: 'L1', name: '一层', elevation: 0 }, { id: 'L2', name: '二层', elevation: 4, ceiling: 3.4 }]
  p.rooms.push({ ...structuredClone(p.rooms[0]), id: 'up', level: 'L2', ceiling: undefined }); save(p)
  edit({ op: 'component', component: lamp }, { op: 'add', kind: 'furniture', status: 'confirmed', item: { id: 'up-light', type: 'custom:lamp' }, ceiling: { room: 'up' } })
  expect(raw().decor.furniture[0]).toMatchObject({ level: 'L2', z: 2800 })
  expect(isOverhead(read(), read().decor!.furniture[0])).toBe(true)
  const low = roomPlan(); low.decor!.components = [{ ...ceiling, height: 2000 }]; low.decor!.furniture = [{ id: 'roof', type: 'custom:roof', at: [2000, 2000], rot: 0, z: 1.1, height: 2, size: ceiling.size, by: 'user', status: 'confirmed' }]
  const bare = structuredClone(low); bare.decor!.furniture = []
  expect(resolveCamera(low, { camera: 'room:r' })).toEqual(resolveCamera(bare, { camera: 'room:r' }))
})
it('door add/update/confirm/reject/remove and core helpers preserve prev and all bytes outside decor', () => {
  const before = raw(); delete before.decor.materials; before.decor.materials = []; writeFileSync(file, JSON.stringify(before))
  edit(addDoor())
  const original = raw().decor.doors[0]
  expect(original).toMatchObject({ by: 'agent', status: 'confirmed' })
  expect(raw().decor.materials.some((m: { id: string }) => m.id === 'oak')).toBe(true)
  edit({ op: 'update', id: 'finish', status: 'pending', set: { look: '磨砂玻璃门', color: '#eeeeee' } }, { op: 'update', id: 'finish', set: { look: '透明玻璃门' } })
  expect(raw().decor.doors[0].prev).toEqual(original)
  expect(confirmedDecor(read().decor)!.doors![0].look).toBe(original.look)
  expect(parsePlanText(serializePlan(read())).plan.decor).toEqual(read().decor)
  edit({ op: 'reject', ids: ['finish'] }); expect(raw().decor.doors[0]).toEqual(original)
  edit({ op: 'update', id: 'finish', status: 'pending', set: { look: '新门' } }, { op: 'confirm', ids: ['finish'] })
  expect(raw().decor.doors[0]).toMatchObject({ status: 'confirmed', look: '新门' }); expect(raw().decor.doors[0]).not.toHaveProperty('prev')
  edit({ op: 'remove', id: 'finish' }); expect(raw().decor.doors).toEqual([])
  edit(addDoor(door, 'pending')); const d = read().decor!
  expect(confirmDecorItems(d, ['finish'])).toEqual(['finish'])
  d.doors![0].status = 'pending'; expect(rejectDecorItems(d, ['finish'], f => f).removed).toEqual(['finish']); expect(d.doors).toEqual([])
  edit({ op: 'reject', ids: ['finish'] }); expect(raw().decor.doors).toEqual([])
  expect({ ...raw(), decor: undefined }).toEqual({ ...before, decor: undefined })
})
it('doors reject unknown/mismatched openings, doorway, duplicate attachment, invalid front, color and snapshots atomically', () => {
  unchanged(() => edit(addDoor({ ...door, opening: 'absent' })), /opening absent 不存在/)
  for (const kind of ['doorway', 'window'] as const) {
    const p = roomPlan(); p.openings[0].kind = kind; save(p)
    unchanged(() => edit(addDoor()), kind === 'doorway' ? /门洞没有门扇，要做门套用造型 arch/ : /洞底贴地/)
  }
  const raised = roomPlan(); raised.openings[0].sill = .1; save(raised); unchanged(() => edit(addDoor()), /洞底贴地/)
  save(roomPlan()); edit(addDoor())
  unchanged(() => edit(addDoor({ ...door, id: 'second' })), /只能有一条/)
  for (const front of [[{ d: 'M0 0H1100' }], [{ d: 'M0 0H500', stroke: 'red' }], [{ d: 'nope' }], [{ d: 'M0 0H500', style: 'bad' }], [{ d: 'M0 0H500V2300Z' }]]) {
    unchanged(() => edit({ op: 'update', id: 'finish', set: { front } }), /front|格式错误/)
  }
  unchanged(() => edit({ op: 'update', id: 'finish', set: { color: 'absent-material' } }), /材料/)
  const p = read(); p.decor!.doors![0] = { ...p.decor!.doors![0], status: 'pending', prev: { ...p.decor!.doors![0], look: '字'.repeat(301) } }
  expect(validateDecorRaw(p)).toContainEqual(expect.objectContaining({ code: 'invalid', text: expect.stringContaining('prev：look') }))
})
it('sliding door and material ids in color/frame.color are accepted and copied', () => {
  const p = roomPlan(); p.openings[0].kind = 'sliding'; p.decor!.materials = []; save(p)
  edit(addDoor({ ...door, color: 'oak', frame: { color: 'walnut', material: 'oak' } }))
  expect(raw().decor.materials.map((m: { id: string }) => m.id)).toEqual(expect.arrayContaining(['oak', 'walnut']))
})
it('demolished door opening is host-missing, remains valid/writable/renderable and is absent from camera metadata', () => {
  edit(addDoor()); const p = read()
  p.changes = [{ id: 'remove-door', op: 'remove', type: 'opening', target: 'o', status: 'confirmed', by: 'user' }]; save(p)
  const result = spawnSync(process.execPath, ['scripts/plan.ts', 'validate', file], { encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ valid: true, issues: expect.arrayContaining([expect.objectContaining({ code: 'decor-host-missing' })]) })
  expect(decorStatus(read()).items.find(i => i.id === 'finish')?.status).toBe('missing')
  edit({ op: 'update', id: 'finish', set: { look: '保留备选门扇' } }, { op: 'rehost' })
  expect(kit(read(), { state: 'renovated' }).camera.openings).toEqual([])
  const after = applyChanges(read(), read().changes).plan
  expect(validateDecorRaw(after, after.decor, read())).toContainEqual(expect.objectContaining({ id: 'finish', code: 'host-missing' }))
})
it('door appearance reaches camera openings only through the requested confirmation view and leaves geometry unchanged', () => {
  const bare = kit(read()); expect(bare.camera.openings.some(o => o.id === 'o')).toBe(true)
  edit(addDoor(door, 'pending'))
  expect(kit(read()).camera.openings[0]).not.toHaveProperty('look')
  expect(kit(read(), { includePending: true }).camera.openings[0]).toMatchObject({ look: door.look, color: door.color })
  edit({ op: 'confirm', ids: ['finish'] })
  const old = kit(read()); expect(old.files).toEqual(bare.files)
  edit({ op: 'update', id: 'finish', status: 'pending', set: { look: '新外观', color: '#ffffff' } })
  expect(kit(read()).camera.openings[0]).toMatchObject({ look: door.look, color: door.color })
  expect(kit(read(), { includePending: true }).camera.openings[0]).toMatchObject({ look: '新外观', color: '#ffffff' })
  expect(kit(read(), { decor: false }).camera.openings[0]).not.toHaveProperty('look')
})
it('door front mirroring and prev round trip exactly; list and handoff identify the door finish', () => {
  edit(addDoor()); edit({ op: 'update', id: 'finish', status: 'pending', set: { look: '提议' } })
  const p = read()
  for (const axis of ['x', 'y'] as const) {
    const mirrored = mirrorPlan(p, axis)
    expect(mirrored.decor!.doors![0].flip).toBe(true)
    expect(mirrored.decor!.doors![0].prev!.flip).toBe(true)
    expect(mirrorPlan(mirrored, axis)).toEqual(p)
    expect(mirrorPlan(parsePlanText(serializePlan(mirrored)).plan, axis).decor).toEqual(p.decor)
  }
  const list = listDecor(p)
  expect(list.doors[0]).toMatchObject({ id: 'finish', opening: 'o' })
  expect(list.faces.flatMap(f => f.openings)).toContainEqual(expect.objectContaining({ id: 'o', door: 'finish' }))
  expect(list.items.find(i => i.id === 'finish')).toMatchObject({ kind: 'door', name: '门的外观' })
  expect(decorHandoff(p, ['finish'])).toContain('门的外观 finish')
  expect(decorHandoff(p, { type: 'door', id: 'finish' })).toContain('门的外观')
  const fileDoor: DoorFinish = planFileValue(p).decor.doors[0]
  expect(fileDoor.front).toEqual(p.decor!.doors![0].front)
})

it('door host validation uses confirmed renovation for added doors and doorway conversions, including later demolition', () => {
  const p = roomPlan(), opening = p.openings[0]; p.openings = []
  p.changes = [{ id: 'add-o', op: 'add', type: 'opening', data: { ...opening }, status: 'confirmed', by: 'user' }]; save(p)
  edit(addDoor()); expect(kit(read(), { state: 'renovated' }).camera.openings[0]).toMatchObject({ id: 'o', look: door.look })
  const removed = read(); removed.changes.push({ id: 'remove-n', op: 'remove', type: 'wall', target: 'n', status: 'confirmed', by: 'user' }); save(removed)
  edit({ op: 'update', id: 'finish', set: { look: '保留' } })
  expect(parsePlanText(text()).issues.some(i => i.code === 'decor-invalid')).toBe(false)
  expect(kit(read(), { state: 'renovated' }).camera.openings).toEqual([])
  const converted = roomPlan(); converted.openings[0].kind = 'doorway'
  converted.changes = [{ id: 'door-leaf', op: 'update', type: 'opening', target: 'o', data: { kind: 'door' }, status: 'confirmed', by: 'user' }]; save(converted)
  edit(addDoor()); expect(kit(read(), { state: 'renovated' }).camera.openings[0]).toMatchObject({ look: door.look })
  const pending = roomPlan(); pending.openings = []; pending.changes = [{ id: 'add-o', op: 'add', type: 'opening', data: { ...opening }, status: 'pending', by: 'agent' }]; save(pending)
  unchanged(() => edit(addDoor()), /opening o 不存在/)
})
it('bird views retain floor lamps while hiding ceiling lights', () => {
  const p = roomPlan(); p.decor!.components = [lamp]
  const base: Furniture = { id: 'hanging', type: 'custom:lamp', size: lamp.size, height: .6, z: 2.5, at: [2000, 2000], rot: 0, by: 'user', status: 'confirmed' }
  p.decor!.furniture = [base, { ...base, id: 'floor', z: 0 }]
  const k = kit(p, { camera: 'iso-sw' })
  expect(k.camera.decor!.overheadHidden).toBe(1)
  expect(k.camera.decor!.visible.map(v => v.id)).toContain('floor')
  expect(k.camera.decor!.visible.map(v => v.id)).not.toContain('hanging')
  const onlyFloor = structuredClone(p); onlyFloor.decor!.furniture.shift()
  expect(k.files).toEqual(kit(onlyFloor, { camera: 'iso-sw' }).files)
  expect(kit(p).camera.decor!.visible.map(v => v.id)).toContain('hanging')
})
