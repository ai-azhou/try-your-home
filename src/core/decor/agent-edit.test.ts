import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { decorPlan, cabinet, panel, niche } from './fixtures.ts'
import { componentExamples } from './component-fixtures.ts'
import { planFileValue, parsePlanText } from '../io.ts'
import { replaceDecorText } from '../../../scripts/decor-edit.ts'
import { materialTakeoff } from './surfaces.ts'
import { faceAxis } from './faces.ts'

let directory: string, file: string
const cli = (command: string, ...args: string[]) => spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/plan.ts', command, file, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
const edit = (...ops: any[]) => spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/plan.ts', 'decor-edit', file, '-'], { input: JSON.stringify({ ops }), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
const read = () => readFileSync(file, 'utf8')
const raw = () => JSON.parse(read())
const save = (v: any) => writeFileSync(file, JSON.stringify(v, null, 2) + '\n')
const ok = (r: ReturnType<typeof edit>) => { expect(r.stderr).toBe(''); expect(r.status, r.stderr).toBe(0); return JSON.parse(r.stdout) }
const sofa = { id: 'sofa', type: 'sofa-3', at: [2000, 900], rot: 0, size: [2400, 900], height: 850 }
const add = (item: any = sofa, status?: string) => ({ op: 'add', kind: 'furniture', item, ...(status ? { status } : {}) })
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'decor-cli-')); file = join(directory, 'plan.json')
  const p = decorPlan(); p.rooms = [{ id: 'room', name: '客厅', poly: [[120, 120], [5880, 120], [5880, 4000], [120, 4000]] }]
  p.questions = [{ id: 'q', category: 'original', text: '虚构测试问题', targets: ['w'] }]
  save(planFileValue(p))
})
afterEach(() => rmSync(directory, { recursive: true, force: true }))

it('init/style/material/preset/component/add/update/remove/rehost; query includes file-mm library and room-side faces', () => {
  const v = raw(); delete v.decor; save(v)
  ok(edit({ op: 'init', style: 'cream' }, { op: 'material', material: { id: 'local', name: '测试色', category: 'paint', color: '#abc' } }, { op: 'preset', preset: { id: 'agent-style', name: '测试风格', roles: { 'wall.main': 'local' }, by: 'user' } }, { op: 'style', style: 'agent-style' }, { op: 'component', component: componentExamples[0] }, add({ id: 'tv', type: 'custom:tv65', at: [1000, 1000], rot: 0 })))
  expect(JSON.parse(cli('decor-list').stdout).items[0].name).toBe('65 寸电视示例')
  expect(raw().decor.presets[0].by).toBe('agent'); expect(raw().decor.furniture[0]).toMatchObject({ height: 830, size: [1450, 80], status: 'pending', by: 'agent' })
  ok(edit({ op: 'component', component: { ...componentExamples[0], height: 900 } }, { op: 'update', id: 'tv', set: { name: '改名', note: '临时' } }, { op: 'update', id: 'tv', set: {}, unset: ['note'] }, { op: 'rehost' }))
  expect(raw().decor.furniture[0]).toMatchObject({ name: '改名', height: 900 }); expect(raw().decor.furniture[0]).not.toHaveProperty('note')
  const q = cli('decor-list'); expect(q.status, q.stderr).toBe(0); const list = JSON.parse(q.stdout)
  expect(list.furniture.find((f: any) => f.type === 'sofa-3').height).toBe(850); expect(list.componentCategories).toHaveLength(9); expect(list.components[0].height).toBe(900)
  expect(list.faces[0]).toMatchObject({ room: 'room', roomName: '客厅', side: 1, wall: 'w', dir: '上' }); expect(list.items[0].name).toBe('改名')
  ok(edit({ op: 'remove', id: 'tv' })); expect(raw().decor.furniture).toHaveLength(0)
  const patch = join(directory, 'patch.json'); writeFileSync(patch, JSON.stringify({ ops: [add({ ...sofa, id: undefined })] })); expect(cli('decor-edit', patch).status).toBe(0); expect(raw().decor.furniture[0].id).toBe('furniture-1')
})
it('supports every add kind and copies only used builtin material references into a minimal decor', () => {
  const v = raw(); v.decor.materials = []; save(v)
  const p = decorPlan(); p.decor!.cabinets = [cabinet()]; p.decor!.panels = [panel()]; p.decor!.recesses = [niche()]; const d = planFileValue(p).decor
  ok(edit({ op: 'add', kind: 'cabinet', item: clean(d.cabinets[0]) }, { op: 'add', kind: 'panel', item: clean(d.panels[0]) }, { op: 'add', kind: 'recess', item: clean(d.recesses[0]) }, { op: 'add', kind: 'surface', item: { id: 's', target: { floor: 'room' }, material: 'oak' } }))
  expect(raw().decor.materials.map((m: any) => m.id)).toEqual(expect.arrayContaining(['creamDoor', 'micro', 'oak', 'oakVeneer', 'white']))
  const status = cli('decor'); expect(status.status, status.stderr).toBe(0); expect(JSON.parse(status.stdout).pendingCount).toBe(4)
  const pendingPlan = parsePlanText(read()).plan, expected = decorPlan(); expected.rooms = pendingPlan.rooms; expected.decor!.materials = pendingPlan.decor!.materials
  expect(materialTakeoff(pendingPlan)).toEqual(materialTakeoff(expected))
})
function clean(v: any) { const { by, status, ...item } = v; return item }
it('preserves all bytes outside decor including BOM, data URL, exponent numbers, questions, changes and unknown fields', () => {
  const v = raw(); v.underlay = { src: 'data:image/png;base64,' + 'abcd0123'.repeat(160000), visible: true, opacity: 50, origin: [0, 0], mmPerPx: 1 }; v.unknownFuture = { z: 1e-7, text: 'literal \\" braces { }' }; v.walls[0].futureField = { preserve: true }
  let original = '\uFEFF' + JSON.stringify(v, null, '\t').replace('"ceiling": 2800', '"ceiling"  :  2.800e3') + '\r\n'; writeFileSync(file, original)
  ok(edit(add()))
  const after = JSON.parse(read().replace(/^\uFEFF/, '')); expect(read()).toBe(replaceDecorText(original, after.decor)); expect(read()).toContain('"ceiling"  :  2.800e3'); expect(read()).toContain('abcd0123'.repeat(160000))
  const noDecor = structuredClone(v); delete noDecor.decor; original = JSON.stringify(noDecor); writeFileSync(file, original); ok(edit({ op: 'init' })); expect(read().startsWith(original.slice(0, -1))).toBe(true)
  expect(readdirSync(directory)).toEqual(['plan.json'])
})
it('rejects bad units, hosts, columns, duplicate ids, protected fields, invalid status/kind and keeps file bytes intact', () => {
  const p = decorPlan(); p.decor!.cabinets = [cabinet()]; const badCab = clean(planFileValue(p).decor.cabinets[0]); badCab.columns = [{ width: 2000, cells: [{ type: 'door' }] }]
  const failures = [add({ ...sofa, height: .85 }), add({ ...sofa, size: [2.4, .9] }), add({ ...sofa, at: undefined, in: 'missing' }), add({ ...sofa, against: { face: { wall: 'missing', side: 1 }, gap: 0 } }), { op: 'add', kind: 'cabinet', item: badCab }, add({ ...sofa, id: 'w' }), ...['ack', 'by', 'prev', 'cache'].map(k => add({ ...sofa, [k]: {} })), { op: 'add', kind: 'oops', item: sofa }, add(sofa, 'oops'), { op: 'style', style: 'not-a-style' }, { op: 'init' }, add({ ...sofa, type: 'custom:missing' }), { op: 'add', kind: 'surface', item: { id: 's', target: { floor: 'missing' }, material: 'oak' } }]
  for (const op of failures) { const before = read(), result = edit(op); expect(result.status, JSON.stringify(op) + result.stderr).toBe(1); expect(result.stderr).toMatch(/第 \d+ 条 op/); expect(read()).toBe(before) }
  const before = read(); const r = edit(add(), add({ ...sofa, height: .85, id: 'bad' })); expect(r.status).toBe(1); expect(r.stderr).toContain('第 2 条 op'); expect(read()).toBe(before)
  expect(readdirSync(directory)).toEqual(['plan.json'])
})
it('unknown type warns; validate catches the previous height:0.85 gap and mismatch with definition', () => {
  const result = ok(edit(add({ ...sofa, type: 'sfa-3' }))); expect(result.issues.some((i: any) => i.code === 'decor-unknown-type' && i.message.includes('sofa-3'))).toBe(true)
  let v = raw(); v.decor.furniture[0].height = .85; save(v); const invalid = cli('validate'); expect(invalid.status).toBe(1); expect(JSON.parse(invalid.stdout).issues.some((i: any) => i.code === 'decor-unit-suspect')).toBe(true)
  v = raw(); v.decor.furniture = []; save(v); const bad = edit({ op: 'component', component: componentExamples[0] }, add({ ...sofa, type: 'custom:tv65' })); expect(bad.status).toBe(1)
})
it('pending update snapshots are stable across further edits, reject restores, confirm clears; all prev height paths roundtrip', () => {
  ok(edit(add(sofa, 'confirmed'))); const original = raw().decor.furniture[0]
  ok(edit({ op: 'update', id: 'sofa', set: { height: 900, z: 100 }, status: 'pending' })); expect(raw().decor.furniture[0].prev).toEqual(original)
  ok(edit({ op: 'update', id: 'sofa', set: { height: 950 } })); expect(raw().decor.furniture[0].prev).toEqual(original)
  expect(parsePlanText(read()).plan.decor!.furniture[0].prev!.height).toBe(.85)
  ok(edit({ op: 'reject', ids: ['sofa'] })); expect(raw().decor.furniture[0]).toEqual(original)
  ok(edit({ op: 'update', id: 'sofa', set: { height: 900 } }, { op: 'confirm', ids: ['sofa'] })); expect(raw().decor.furniture[0].status).toBe('confirmed'); expect(raw().decor.furniture[0]).not.toHaveProperty('prev')
  ok(edit(add({ ...sofa, id: 'new' }), { op: 'reject', ids: ['new'] })); expect(raw().decor.furniture).toHaveLength(1)
  const p = decorPlan(); p.decor!.cabinets = [cabinet()]; const c = clean(planFileValue(p).decor.cabinets[0]); ok(edit({ op: 'add', kind: 'cabinet', item: c, status: 'confirmed' }, { op: 'update', id: c.id, set: { name: '待定' }, status: 'pending' })); const old = parsePlanText(read()).plan.decor!.cabinets[0].prev as any; expect(old.z).toEqual([0, 2.8]); expect(old.columns[1].cells[0].void.top.z).toBe(.73)
})
it('rejects removal of occupied hosts and protected updates; allows handling children first', () => {
  const p = decorPlan(); p.decor!.panels = [panel()]; const pa = clean(planFileValue(p).decor.panels[0]); ok(edit({ op: 'add', kind: 'panel', item: pa }, add({ ...sofa, id: 'child', type: 'tv', in: pa.id, at: undefined, size: [1000, 40], height: 800 })))
  for (const op of [{ op: 'remove', id: pa.id }, { op: 'update', id: 'child', set: { ack: { by: 'agent' } } }, { op: 'update', id: 'child', set: {}, unset: ['by'] }]) { const before = read(); expect(edit(op).status).toBe(1); expect(read()).toBe(before) }
  ok(edit({ op: 'remove', id: 'child' }, { op: 'remove', id: pa.id }))
})
it('wall convenience on both sides puts the back flush with the face and the front into its room', () => {
  for (const side of [1, -1] as const) {
    ok(edit({ op: 'add', kind: 'furniture', item: { ...sofa, id: 'f' + side, at: undefined, rot: undefined }, status: 'confirmed', wall: { face: { wall: 'w', side }, s: 2500, gap: 20, z: 900 } }))
    const plan = parsePlanText(read()).plan, f = plan.decor!.furniture.find(f => f.id === 'f' + side)!, axis = faceAxis(plan, { wall: 'w', side }), a = (f.rot ?? 0) * Math.PI / 180, front = [-Math.sin(a), Math.cos(a)], back = f.at!.map((v, i) => v - front[i] * f.size[1] / 2)
    expect(back[0]).toBeCloseTo(axis.at(2500, 20)[0]); expect(back[1]).toBeCloseTo(axis.at(2500, 20)[1]); expect(front[1]).toBeCloseTo(side); expect(f.z).toBe(.9)
  }
  const before = read(); expect(edit({ op: 'add', kind: 'furniture', item: { ...sofa, id: 'bad' }, wall: { face: { wall: 'w', side: 1 }, s: 7000 } }).status).toBe(1); expect(read()).toBe(before)
})
it('CLI render hides pending across every pass; include-pending differs; prev renders the confirmed geometry', () => {
  const fixture = raw(); fixture.openings = [{ id: 'window', wall: 'w', kind: 'window', offset: 1500, width: 1800, sill: 900, head: 2200 }]; save(fixture)
  ok(edit(add()))
  const render = (name: string, ...extra: string[]) => { const dir = join(directory, name), r = cli('render', dir, '--views', 'top', '--size', '96x96', '--passes', 'clay,depth,lines,seg,openings', ...extra); expect(r.status, r.stderr).toBe(0); return { dir, r } }
  const hidden = render('hidden'), bare = render('bare', '--no-decor'), shown = render('shown', '--include-pending')
  expect(hidden.r.stderr).toContain('1 件待确认没画')
  expect(readdirSync(hidden.dir)).toContain('top-white.depth16.png'); expect(readdirSync(hidden.dir)).toContain('top-white.openings.png')
  for (const name of readdirSync(hidden.dir).filter(n => n.endsWith('.png'))) expect(readFileSync(join(hidden.dir, name))).toEqual(readFileSync(join(bare.dir, name)))
  expect(readFileSync(join(hidden.dir, 'top-white.png'))).not.toEqual(readFileSync(join(shown.dir, 'top-white.png')))
  const camera = JSON.parse(readFileSync(join(hidden.dir, 'top-white.camera.json'), 'utf8')); expect(camera.decor).toMatchObject({ pendingHidden: 1, includePending: false })
  ok(edit({ op: 'confirm', ids: ['sofa'] })); const old = render('old'); ok(edit({ op: 'update', id: 'sofa', set: { at: [4500, 2800] }, status: 'pending' })); const prev = render('prev'); expect(readFileSync(join(old.dir, 'top-white.png'))).toEqual(readFileSync(join(prev.dir, 'top-white.png')))
})

it('rejects parent and child proposals together independent of ids order, and a missing against stays a warning', () => {
  const p = decorPlan(); p.decor!.panels = [panel()]; const pa = clean(planFileValue(p).decor.panels[0])
  ok(edit({ op: 'add', kind: 'panel', item: pa }, add({ ...sofa, id: 'child', type: 'tv', in: pa.id, at: undefined, size: [1000, 40], height: 800 })))
  ok(edit({ op: 'reject', ids: [pa.id, 'child'] })); expect(raw().decor.panels).toHaveLength(0); expect(raw().decor.furniture).toHaveLength(0)
  ok(edit(add(sofa, 'confirmed'), { op: 'add', kind: 'panel', item: pa }, { op: 'update', id: 'sofa', set: { in: pa.id, size: [1000, 40], height: 800 }, unset: ['at'], status: 'pending' }))
  ok(edit({ op: 'reject', ids: [pa.id, 'sofa'] })); expect(raw().decor.furniture[0]).toMatchObject(sofa); expect(raw().decor.panels).toHaveLength(0)
  const v = raw(); v.decor.furniture = [{ ...sofa, by: 'agent', status: 'confirmed', against: { face: { wall: 'missing', side: 1 }, gap: 0 } }]; save(v)
  const result = cli('validate'); expect(result.status).toBe(0); expect(JSON.parse(result.stdout).issues.some((i: any) => i.code === 'decor-host-missing' && i.level === 'warn')).toBe(true)
})

it('update set.width on a cabinet: last column absorbs, so width changes are never rejected for column sums', () => {
  ok(edit({ op: 'add', kind: 'cabinet', status: 'confirmed', item: { id: 'c', family: 'tall', place: { face: { wall: 'w', side: 1 }, s: 500 }, width: 1800, depth: 400, z: [0, 2400], columns: [{ width: 900, cells: [{ type: 'door' }] }, { width: 900, cells: [{ type: 'door' }] }], materials: { carcass: 'creamDoor', front: 'creamDoor' } } }))
  ok(edit({ op: 'update', id: 'c', set: { width: 2400 }, status: 'confirmed' }))
  expect(raw().decor.cabinets[0].columns.map((c: any) => c.width)).toEqual([900, 1500])
  // 同时给 columns：照 Agent 写的，不替它改
  ok(edit({ op: 'update', id: 'c', set: { width: 2000, columns: [{ width: 500, cells: [{ type: 'door' }] }, { width: 1500, cells: [{ type: 'door' }] }] }, status: 'confirmed' }))
  expect(raw().decor.cabinets[0].columns.map((c: any) => c.width)).toEqual([500, 1500])
  const bad = edit({ op: 'update', id: 'c', set: { width: 2000, columns: [{ width: 500, cells: [{ type: 'door' }] }, { width: 900, cells: [{ type: 'door' }] }] }, status: 'confirmed' })
  expect(bad.status).toBe(1)
})

it('a wall-mounted item over a door or window gets a factual warning, and the write still goes through', () => {
  const p = raw(); p.openings = [{ id: 'd1', wall: 'w', offset: 1000, width: 900, kind: 'door', sill: 0, head: 2100, name: '入户' }]; save(p)
  const r = ok(edit({ op: 'add', kind: 'furniture', status: 'confirmed', wall: { face: { wall: 'w', side: 1 }, s: 1400, z: 1000 }, item: { id: 'tv', type: 'tv', size: [1450, 80], height: 830 } }))
  expect(r.issues.map((i: any) => i.message).join()).toContain('压在入户门上')
  expect(raw().decor.furniture[0].id).toBe('tv')
})

it('update without status keeps it; library furniture needs no size; preset and unused component can be removed; decor --brief is short', () => {
  ok(edit({ op: 'add', kind: 'furniture', status: 'confirmed', item: { id: 's1', type: 'sofa-3', at: [3000, 1500], rot: 0 } }))
  expect(raw().decor.furniture[0]).toMatchObject({ size: [2400, 900], height: 850, status: 'confirmed' })
  ok(edit({ op: 'update', id: 's1', set: { name: '改名' } }))
  expect(raw().decor.furniture[0].status).toBe('confirmed'); expect(raw().decor.furniture[0]).not.toHaveProperty('prev')
  const bad = edit({ op: 'add', kind: 'furniture', item: { id: 's2', type: 'sofa-xx', at: [3000, 1500], rot: 0 } })
  expect(bad.status).toBe(1); expect(bad.stderr).toContain('要写 size 和 height')
  ok(edit({ op: 'preset', preset: { id: 'warm', name: '暖', roles: {} } }, { op: 'component', component: componentExamples[0] }))
  ok(edit({ op: 'reject', ids: ['warm'] }, { op: 'remove', id: componentExamples[0].id }))
  expect(raw().decor.presets ?? []).toEqual([]); expect(raw().decor.components ?? []).toEqual([])
  const brief = JSON.parse(cli('decor', '--brief').stdout)
  expect(brief.items[0]).toEqual({ id: 's1', status: 'placed', reasons: [] }); expect(brief).not.toHaveProperty('materials')
})

it('demolishing the wall under a cabinet keeps the data and does not jam validate, render or later edits', () => {
  const p = raw(); p.walls.push({ ...p.walls[0], id: 'w2', a: [0, 3000], b: [6000, 3000] }); save(p)
  const c = clean(planFileValue((() => { const d = decorPlan(); d.decor!.cabinets = [cabinet()]; return d })()).decor.cabinets[0])
  ok(edit({ op: 'add', kind: 'cabinet', item: { ...c, place: { face: { wall: 'w2', side: 1 }, s: 500 } }, status: 'confirmed' }))
  const q = raw(); q.changes.push({ id: 'c1', op: 'remove', type: 'wall', target: 'w2', by: 'agent', status: 'confirmed', at: '2026-10-30' }); save(q)
  const v = cli('validate'); expect(v.status).toBe(0); expect(JSON.parse(v.stdout).valid).toBe(true)
  expect(JSON.parse(v.stdout).issues.filter((i: any) => i.code === 'decor-host-missing').every((i: any) => i.level === 'warn')).toBe(true)
  const r = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/plan.ts', 'render', file, join(directory, 'out'), '--state', 'renovated', '--views', 'top', '--passes', 'clay', '--size', '200x150'], { encoding: 'utf8' })
  expect(r.status, r.stderr).toBe(0); expect(r.stderr).toContain('数据还在')
  const later = ok(edit({ op: 'add', kind: 'furniture', item: { id: 'rug1', type: 'rug', at: [3000, 1500], rot: 0 } }))
  expect(later.issues.some((i: any) => i.code === 'decor-host-missing' && i.level === 'warn')).toBe(true)
  expect(raw().decor.cabinets).toHaveLength(1)
  const bad = edit({ op: 'add', kind: 'cabinet', item: { ...c, id: 'c2', place: { face: { wall: 'gone', side: 1 }, s: 500 } }, status: 'confirmed' })
  expect(bad.status).toBe(1); expect(raw().decor.cabinets).toHaveLength(1)
})

it('a cabinet standing against a window only warns; one embedded into the wall is still refused', () => {
  const p = raw(); p.openings = [{ id: 'win', wall: 'w', offset: 1000, width: 900, kind: 'window', sill: 900, head: 2100, name: '北窗' }]; save(p)
  const d = decorPlan(); d.decor!.cabinets = [cabinet()]; const c = clean(planFileValue(d).decor.cabinets[0])
  const r = ok(edit({ op: 'add', kind: 'cabinet', item: { ...c, place: { face: { wall: 'w', side: 1 }, s: 500 } }, status: 'confirmed' }))
  expect(r.issues.find((i: any) => i.code === 'decor-over-opening')).toMatchObject({ level: 'warn' })
  expect(r.issues.map((i: any) => i.message).join()).toContain('挡住了窗 北窗')
  expect(raw().decor.cabinets).toHaveLength(1)
  const bad = edit({ op: 'add', kind: 'cabinet', item: { ...c, id: 'c2', embed: 50, place: { face: { wall: 'w', side: -1 }, s: 500 } }, status: 'confirmed' })
  expect(bad.status).toBe(1); expect(raw().decor.cabinets).toHaveLength(1)
})
