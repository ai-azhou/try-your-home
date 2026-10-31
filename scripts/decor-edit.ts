import { readFileSync, openSync, closeSync, writeFileSync, fsyncSync, renameSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parsePlanText as parseStrictPlanText, planFileValue, newId, lengthUnit } from '../src/core/io.ts'
import { applyChanges } from '../src/core/changes.ts'
import { createDecor, STYLE_PRESETS, BUILTIN_MATERIALS } from '../src/core/decor/presets.ts'
import { componentOf, COMPONENT_CATEGORIES } from '../src/core/decor/components.ts'
import { FURNITURE_LIBRARY } from '../src/core/decor/furniture.ts'
import { decorItems, restoreDecorItem, rehostDecor } from '../src/core/decor/resolve.ts'
import { faceAxis, faceIntervals } from '../src/core/decor/faces.ts'
import { resizeCabinet } from '../src/core/decor/cabinets.ts'
import { roomSpanOnWall } from '../src/core/merge-rooms.ts'
import { effectiveWallHeight, roomsBesideWall, roomCeiling } from '../src/core/geometry.ts'
import { blocksPersistence } from '../src/core/persistence.ts'
import { wallDirection } from '../src/core/decor/surfaces.ts'
import { validateDecorRaw } from '../src/core/decor/validate.ts'
import { levelOf } from '../src/core/levels.ts'
import type { Plan } from '../src/core/types.ts'

const parsePlanText = (text: string) => parseStrictPlanText(text, { allowUnknownOutsideDecor: true })
const groups = { furniture: 'furniture', cabinet: 'cabinets', panel: 'panels', recess: 'recesses', surface: 'surfaces', door: 'doors' } as const
const protectedKeys = ['ack', 'by', 'prev', 'cache']
const object = (v: any) => v && typeof v === 'object' && !Array.isArray(v)
const afterPlan = (plan: Plan) => plan.legacy?.__structureReplayFrame ? plan : applyChanges(plan, plan.changes.filter(c => c.status === 'confirmed')).plan

/** Replace exactly one top-level value, preserving every other source byte (including BOM and number spellings). */
export function replaceDecorText(source: string, decor: unknown): string {
  JSON.parse(source.replace(/^\uFEFF/, ''))
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0
  const space = () => { while (/\s/.test(source[i] ?? '') && i < source.length) i++ }
  const stringEnd = () => { i++; while (i < source.length) { const c = source[i++]; if (c === '\\') i++; else if (c === '"') break } }
  const valueEnd = () => {
    if (source[i] === '"') { stringEnd(); return }
    if (source[i] === '[' || source[i] === '{') { let depth = 0; do { if (source[i] === '"') { stringEnd(); continue } const c = source[i++]; if (c === '[' || c === '{') depth++; else if (c === ']' || c === '}') depth-- } while (depth); return }
    while (i < source.length && !/[,}\]\s]/.test(source[i])) i++
  }
  space(); if (source[i++] !== '{') throw new Error('方案必须是 JSON 对象')
  space(); const matches: [number, number][] = []; let count = 0
  while (source[i] !== '}') {
    const keyStart = i; stringEnd(); const key = JSON.parse(source.slice(keyStart, i)); space(); i++; space()
    const start = i; valueEnd(); if (key === 'decor') matches.push([start, i]); count++; space()
    if (source[i] === ',') { i++; space() } else break
  }
  if (matches.length > 1) throw new Error('顶层 decor 重复，请先移除重复字段')
  const replacement = JSON.stringify(decor, null, 2)
  if (matches.length) { const [a, b] = matches[0]; return source.slice(0, a) + replacement + source.slice(b) }
  return source.slice(0, i) + (count ? ',' : '') + '\n"decor": ' + replacement + source.slice(i)
}
function atomicWrite(file: string, source: string, text: string) {
  const temp = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`)
  let fd: number | undefined
  try {
    fd = openSync(temp, 'wx', statSync(file).mode & 0o777); writeFileSync(fd, text); fsyncSync(fd); closeSync(fd); fd = undefined
    if (readFileSync(file, 'utf8') !== source) throw new Error('方案在编辑期间被修改，请重新读取后重试')
    renameSync(temp, file)
  } finally { if (fd !== undefined) closeSync(fd); rmSync(temp, { force: true }) }
}
function copyMaterials(d: any) {
  const refs = new Set<string>()
  const walk = (v: any, key = '') => {
    if (typeof v === 'string') { if (['material', 'back', 'trim', 'body', 'fabric', 'carcass', 'front', 'color'].includes(key)) refs.add(v); return }
    if (!object(v) && !Array.isArray(v)) return
    if (['roles', 'board'].includes(key)) Object.values(v).forEach(x => { if (typeof x === 'string') refs.add(x) })
    for (const [k, child] of Object.entries(v)) if (k !== 'materials' || !Array.isArray(child)) walk(child, k)
  }
  walk(d)
  walk([...(d.presets ?? []), ...STYLE_PRESETS].find(p => p.id === d.style))
  for (const id of refs) if (!d.materials.some((m: any) => m.id === id)) { const m = BUILTIN_MATERIALS.find(m => m.id === id); if (m) d.materials.push(structuredClone(m)) }
}
export function editDecorFile(file: string, source: string, patch: any) {
  if (file === '-') throw new Error('decor-edit 需要方案文件路径；补丁路径可以为 -')
  const raw = JSON.parse(source.replace(/^\uFEFF/, ''))
  if (raw.format !== 'floorplan-structure' || raw.version !== 3) throw new Error('decor-edit 只支持 v3，请先 convert 并核对')
  if (!object(patch) || !Array.isArray(patch.ops) || !patch.ops.length) throw new Error('补丁需要非空 ops 数组')
  const touched = new Map<string, number>()
  const locate = (id: string): { list: any[]; index: number; item: any; kind: string } => {
    for (const [kind, key] of Object.entries(groups)) { const list = raw.decor[key] ?? [], index = list.findIndex((v: any) => v.id === id); if (index >= 0) return { list, index, item: list[index], kind } }
    throw new Error(`装修项 ${id} 不存在，请用 decor-list 查看 id`)
  }
  const statusOf = (op: any) => { const s = op.status ?? 'pending'; if (!['pending', 'confirmed'].includes(s)) throw new Error('status 必须是 pending 或 confirmed'); return s }
  const writable = (v: any) => { if (!object(v)) throw new Error('item/set 必须是对象'); for (const k of protectedKeys) if (Object.hasOwn(v, k)) throw new Error(`禁止写 ${k}，请移除该字段；ack 只能由用户在工具中记录`) }
  const remove = (id: string, rejecting = new Set<string>()) => {
    const found = locate(id)
    for (const item of decorItems(raw.decor) as any[]) {
      const refs = [item, item.prev].filter(Boolean)
      if (item.id !== id && !rejecting.has(item.id) && refs.some(v => v.in === id || v.in?.startsWith(id + ':cell:') || v.host?.panel === id || v.host?.cabinet === id)) throw new Error(`${id} 被 ${item.id} 挂着，请先处理该项的 in/host`)
    }
    found.list.splice(found.index, 1); if (raw.decor.cache) delete raw.decor.cache[id]
  }
  const upsert = (key: string, item: any) => { if (!object(item) || typeof item.id !== 'string' || !item.id) throw new Error(`${key} 需要非空 id`); const list = raw.decor[key] ??= [], index = list.findIndex((v: any) => v.id === item.id); if (index < 0) list.push(item); else list[index] = item }
  patch.ops.forEach((op: any, index: number) => {
    try {
      if (!object(op)) throw new Error('op 必须是对象')
      if (op.op === 'init') { if (raw.decor !== undefined) throw new Error('已有 decor，不可重复 init'); raw.decor = createDecor(op.style); return }
      if (!raw.decor) throw new Error('还没有 decor，请先加 init 操作')
      const d = raw.decor
      switch (op.op) {
        case 'style': { const ids = [...STYLE_PRESETS, ...(d.presets ?? [])].map(s => s.id); if (!ids.includes(op.style)) throw new Error(`style 不存在，可选：${ids.join('、')}`); d.style = op.style; break }
        case 'add': {
          if (!Object.hasOwn(groups, op.kind)) throw new Error(`未知 kind ${op.kind}；可选 ${Object.keys(groups).join('、')}`)
          writable(op.item)
          const item = structuredClone(op.item); item.id ??= newId(raw, op.kind + '-')
          if ([...decorItems(d), ...d.materials, ...(d.presets ?? []), ...(d.components ?? []), ...raw.walls, ...raw.openings, ...raw.rooms, ...raw.beams, ...raw.questions, ...raw.changes, ...(raw.levels ?? []), ...(raw.columns ?? []), ...(raw.shafts ?? []), ...(raw.stairs ?? []), ...(raw.voids ?? [])].some(x => x.id === item.id)) throw new Error(`重复 id ${item.id}，请换一个 id 或省略 id 自动生成`)
          item.by = 'agent'; item.status = statusOf(op)
          if (op.kind === 'furniture') {
            const def = componentOf(d, item.type), entry = FURNITURE_LIBRARY.find(f => f.type === item.type)
            if (def) { item.size ??= [...def.size]; item.height ??= def.height } else if (entry) { item.size ??= [...entry.size]; item.height ??= lengthUnit(entry.height) }
            if (!Array.isArray(item.size) || item.height === undefined) throw new Error(`家具库和方案里都没有 ${item.type}：要写 size 和 height（mm），或者先用 component 画一个`)
            if (op.wall !== undefined && op.ceiling !== undefined) throw new Error('ceiling 与 wall 不能同时使用，请选择一种定位')
            if (op.ceiling !== undefined) {
              if (!object(op.ceiling) || typeof op.ceiling.room !== 'string') throw new Error('ceiling 需要 room id')
              if (item.in || item.against) throw new Error('ceiling 与 in/against 不能同时使用，请选择一种定位')
              const plan = afterPlan(parsePlanText(JSON.stringify(raw)).plan), room = plan.rooms.find(r => r.id === op.ceiling.room)
              if (!room) throw new Error(`房间 ${op.ceiling.room} 不存在；可选房间 id：${plan.rooms.map(r => r.id).join('、') || '（无）'}`)
              item.z = lengthUnit(roomCeiling(plan, room)) - item.height
              if (item.z < 0) throw new Error('构件高超过房间层高，无法贴顶')
              item.at ??= [0, 1].map(axis => (Math.min(...room.poly.map(p => p[axis])) + Math.max(...room.poly.map(p => p[axis]))) / 2)
              item.rot ??= 0
              item.level = levelOf(plan, room).id
            }
            if (op.wall !== undefined) {
              if (!object(op.wall) || !object(op.wall.face) || ![1, -1].includes(op.wall.face.side)) throw new Error('wall.face 需要 wall id 和 side: 1 或 -1')
              if (item.in) throw new Error('wall 与 in 不能同时使用，请选择一种定位')
              const plan = afterPlan(parsePlanText(JSON.stringify(raw)).plan), axis = faceAxis(plan, op.wall.face), s = op.wall.s, gap = op.wall.gap ?? 0, z = op.wall.z ?? 0
              if (!Number.isFinite(s) || s < 0 || s > axis.length) throw new Error(`wall.s 应在 0–${axis.length} mm 内，表示中心离墙 a 端的距离`)
              if (!Number.isFinite(gap) || gap < 0 || !Number.isFinite(z) || z < 0 ) throw new Error('wall.gap/z 必须为非负 mm')
              const normal = axis.normalAt(s); item.at = axis.at(s, gap + item.size[1] / 2); item.rot = Math.atan2(normal[1], normal[0]) * 180 / Math.PI - 90; item.z = z; item.against = { face: structuredClone(op.wall.face), gap }
            }
          } else if (op.wall !== undefined || op.ceiling !== undefined) throw new Error('wall/ceiling 便捷定位仅用于 furniture')
          ;(d[groups[op.kind as keyof typeof groups]] ??= []).push(item); touched.set(item.id, index + 1); break
        }
        case 'update': {
          writable(op.set); if (Object.hasOwn(op.set, 'id') && op.set.id !== op.id) throw new Error('update 不可改 id，请保留原 id')
          if (op.unset !== undefined && (!Array.isArray(op.unset) || op.unset.some((k: unknown) => typeof k !== 'string'))) throw new Error('unset 需要字段名数组')
          if (op.unset?.some((k: string) => [...protectedKeys, 'id', 'status'].includes(k))) throw new Error('unset 不可移除 id/status 或受保护字段 ack/by/prev/cache')
          const found = locate(op.id), item = structuredClone(found.item), status = op.status === undefined ? item.status : statusOf(op)
          const prev = item.status === 'confirmed' && status === 'pending' ? structuredClone(item) : item.prev
          // 只改柜宽（不同时给 columns）：和界面同一条规则，末列承担；Agent 说「宽度改成 2400」不会因列宽和不符被拒
          const resized = found.kind === 'cabinet' && typeof op.set.width === 'number' && !Object.hasOwn(op.set, 'columns') && Array.isArray(item.columns) ? resizeCabinet(item, op.set.width).columns : undefined
          Object.assign(item, op.set); if (resized) item.columns = resized
          for (const k of op.unset ?? []) delete item[k]
          item.by = 'agent'; item.status = status
          if (status === 'pending' && prev) item.prev = prev; else delete item.prev
          found.list[found.index] = item; touched.set(item.id, index + 1); break
        }
        case 'remove': {
          const preset = (d.presets ?? []).findIndex((v: any) => v.id === op.id), comp = (d.components ?? []).findIndex((v: any) => v.id === op.id)
          if (preset >= 0) { if (d.style === op.id) throw new Error(`${op.id} 是当前风格，先用 style 换一个`); d.presets.splice(preset, 1) }
          else if (comp >= 0) { const used = d.furniture.find((f: any) => f.type === `custom:${op.id}`); if (used) throw new Error(`${op.id} 还摆着 ${used.id}，先删掉它`); d.components.splice(comp, 1) }
          else remove(op.id)
          break
        }
        case 'confirm': case 'reject': {
          if (!Array.isArray(op.ids) || !op.ids.length || op.ids.some((id: unknown) => typeof id !== 'string')) throw new Error('ids 需要非空 id 数组')
          const ids = [...new Set<string>(op.ids)], rejecting = new Set<string>()
          for (const id of ids) {
            // 风格没有待确认状态：不要 = 删掉 Agent 配的这一套，可以 = 不用动（用户点「应用」或 style 才切）
            const preset = (d.presets ?? []).findIndex((v: any) => v.id === id)
            if (preset >= 0) { if (op.op === 'reject') { if (d.style === id) throw new Error(`${id} 是当前风格，先用 style 换一个`); d.presets.splice(preset, 1) } continue }
            const found = locate(id)
            if (op.op === 'confirm') { found.item.status = 'confirmed'; delete found.item.prev }
            else { const restored = restoreDecorItem(found.item); if (restored) found.list[found.index] = restored; else rejecting.add(id) }
            touched.set(id, index + 1)
          }
          // Restore all old hosts/children before checking the references of deleted proposals.
          for (const id of rejecting) remove(id, rejecting)
          break
        }
        case 'component': {
          const c = structuredClone(op.component); upsert('components', c); touched.set(c.id, index + 1)
          if ('by' in c || 'status' in c) throw new Error('component 定义没有 by/status，请移除')
          for (const f of d.furniture) if (f.type === `custom:${c.id}`) { f.size = [...c.size]; f.height = c.height; if (f.prev?.type === f.type) { f.prev.size = [...c.size]; f.prev.height = c.height } touched.set(f.id, index + 1) }
          break
        }
        case 'preset': upsert('presets', { ...op.preset, by: 'agent' }); touched.set(op.preset.id, index + 1); break
        case 'material': upsert('materials', structuredClone(op.material)); touched.set(op.material.id, index + 1); break
        case 'rehost': { const p = parsePlanText(JSON.stringify(raw)).plan; d.cache ??= {}; raw.decor = planFileValue({ ...p, decor: rehostDecor(p, afterPlan(p), p.decor!) }).decor; break }
        default: throw new Error(`未知 op ${op.op}，请使用 init/style/add/update/remove/confirm/reject/component/preset/material/rehost`)
      }
    } catch (e) { throw new Error(`第 ${index + 1} 条 op (${op?.op ?? '?'})：${(e as Error).message}；文件未写入`) }
  })
  copyMaterials(raw.decor)
  const text = replaceDecorText(source, raw.decor), parsed = parsePlanText(text)
  // 拆墙留下的「没地方挂」是等用户决定的中间状态：这次没动的不挡写入，这次新造成的才拦
  const before = parsePlanText(source)
  const known = new Set([...before.issues.filter(i => i.level === 'error').map(i => i.message), ...(before.plan.decor ? validateDecorRaw(afterPlan(before.plan), before.plan.decor, before.plan).map(i => i.id + '：' + i.text) : [])])
  const errors = parsed.issues.filter(i => blocksPersistence(i) || (i.level === 'error' && !known.has(i.message)))
  // Resolution intentionally releases demolished-wall furniture. A write must still reject an explicitly missing host.
  const hostErrors = validateDecorRaw(afterPlan(parsed.plan), parsed.plan.decor, parsed.plan).filter(i => i.level === 'error' && ['host-missing', 'room-missing'].includes(i.code) && !known.has(i.id + '：' + i.text))
  if (errors.length || hostErrors.length) throw new Error(`第 ${patch.ops.length} 条 op 后校验未通过；请修正下列字段后重试，文件未写入：\n` + [...errors.map(i => i.message), ...hostErrors.map(i => i.id + '：' + i.text)].map(message => { const location = /^格式错误 \/decor\/([^/]+)\/(\d+)/.exec(message), id = location ? raw.decor[location[1]]?.[+location[2]]?.id : [...touched.keys()].find(id => message.startsWith(id + '：')); return `${id && touched.has(id) ? `第 ${touched.get(id)} 条 op：` : ''}${message}` }).join('\n'))
  atomicWrite(file, source, text)
  return { ok: true, applied: patch.ops.length, issues: parsed.issues.filter(i => !blocksPersistence(i)).map(i => ({ ...i, level: i.level === 'error' ? 'warn' : i.level })), items: Object.entries(groups).flatMap(([kind, key]) => (raw.decor[key] ?? []).map((i: any) => ({ id: i.id, status: i.status, kind }))) }
}
export function listDecor(plan: Plan) {
  plan = afterPlan(plan)
  const d = plan.decor, doorIds = new Map(d?.doors?.map(d => [d.opening, d.id])), combine = (a: any[], b: any[]) => [...new Map([...a, ...b].map(i => [i.id, i])).values()]
  return {
    furniture: FURNITURE_LIBRARY.map(({ type, name, category, size, height }) => ({ type, name, category, size, height: lengthUnit(height) })),
    styles: combine(STYLE_PRESETS, d?.presets ?? []).map(({ id, name }) => ({ id, name })),
    materials: combine(BUILTIN_MATERIALS, d?.materials ?? []).map(({ id, name, category, color }) => ({ id, name, category, color })),
    componentCategories: Object.entries(COMPONENT_CATEGORIES).map(([id, name]) => ({ id, name })),
    components: d?.components?.map(({ id, name, category, size, height }) => ({ id, name, category, size, height })) ?? [],
    doors: d?.doors ?? [],
    faces: plan.walls.flatMap(w => ([1, -1] as const).flatMap(side => {
      const face = { wall: w.id, side }, rooms = roomsBesideWall(plan, w.id)[side === 1 ? 'positive' : 'negative'], axis = faceAxis(plan, face)
      return rooms.flatMap(room => {
        const span = roomSpanOnWall(w, room.poly); if (!span) return []
        return faceIntervals(plan, face).flatMap(([a, b]) => {
          const s = [Math.max(a, span[0]), Math.min(b, span[1])]; if (s[1] <= s[0]) return []
          return [{ room: room.id, roomName: room.name, dir: wallDirection(plan, face, (s[0] + s[1]) / 2), wall: w.id, side, s, length: s[1] - s[0], wallLength: axis.length, height: lengthUnit(effectiveWallHeight(plan, w)), wallKind: w.kind,
            openings: plan.openings.filter(o => o.wall === w.id && o.offset < s[1] && o.offset + o.width > s[0]).map(o => ({ id: o.id, kind: o.kind, s: [o.offset, o.offset + o.width], sill: lengthUnit(o.sill), head: lengthUnit(o.head), ...(doorIds.has(o.id) ? { door: doorIds.get(o.id) } : {}) })) }]
        })
      })
    })),
    items: d ? Object.entries(groups).flatMap(([kind, key]) => (d[key] ?? []).map(i => ({ id: i.id, kind, name: ('name' in i ? i.name : undefined) ?? ('type' in i ? componentOf(d, i.type)?.name ?? FURNITURE_LIBRARY.find(f => f.type === i.type)?.name : undefined) ?? ({ furniture: '家具', cabinet: '柜体', panel: '造型', recess: '壁龛 / 挖洞', surface: '材料覆盖', door: '门的外观' } as Record<string, string>)[kind], status: i.status, by: i.by }))) : [],
  }
}
