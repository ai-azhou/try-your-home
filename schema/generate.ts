import { writeFileSync } from 'node:fs'
import { decorDefinitions } from './decor.ts'
/** Current schema builder: node scripts/plan.ts schema (or node schema/generate.ts). */
const ref = (name: string) => ({ $ref: `#/$defs/${name}` })
const str = { type: 'string' }, num = { type: 'number' }, positive = { type: 'number', exclusiveMinimum: 0 }, nonnegative = { type: 'number', minimum: 0 }, bool = { type: 'boolean' }
const enumeration = (...values: string[]) => ({ type: 'string', enum: values })
const array = (items: unknown, minItems?: number) => ({ type: 'array', items, ...(minItems === undefined ? {} : { minItems }) })
const tuple = (items: unknown[]) => ({ type: 'array', prefixItems: items, minItems: items.length, maxItems: items.length })
const object = (properties: Record<string, unknown>, required: string[] = [], additionalProperties = false) => ({ type: 'object', properties, required, additionalProperties })
const id = { type: 'string', minLength: 1 }
const confirmed = object({ by: id, at: str, note: str }, ['by'])
const common = { id, evidence: ref('Evidence') }
const defs: Record<string, unknown> = {
  Vec2: tuple([num, num]), Box: tuple([num, num, num, num]),
  Certainty: enumeration('seen', 'inferred', 'unknown'),
  WallKind: enumeration('exterior', 'bearing', 'partition', 'glass', 'half', 'half-glass'),
  OpeningKind: enumeration('door', 'sliding', 'doorway', 'window', 'floor-window', 'bay-window', 'open-balcony'),
  PaneKind: enumeration('fixed', 'casement', 'sliding'),
  Evidence: object({ certainty: ref('Certainty'), basis: str, pixelBox: ref('Box'), confirmed }, ['certainty']),
  Wall: object({ ...common, level: id, a: ref('Vec2'), b: ref('Vec2'), thickness: positive, kind: ref('WallKind'), height: positive, lowHeight: nonnegative, bulge: num, name: str }, ['id', 'a', 'b', 'thickness', 'kind']),
  Opening: object({ ...common, wall: id, offset: nonnegative, width: positive, kind: ref('OpeningKind'), sill: nonnegative, head: positive, swing: object({ hinge: enumeration('start', 'end'), side: { enum: [1, -1] } }, ['hinge', 'side']), panes: array(object({ width: positive, kind: ref('PaneKind') }, ['width', 'kind']), 1), entry: bool, name: str }, ['id', 'wall', 'offset', 'width', 'kind', 'sill', 'head']),
  Beam: object({ ...common, level: id, a: ref('Vec2'), b: ref('Vec2'), width: positive, bottom: nonnegative, name: str }, ['id', 'a', 'b', 'width', 'bottom']),
  Room: object({ ...common, level: id, name: str, poly: array(ref('Vec2'), 3), ceiling: positive, floorOffset: num, use: str, counted: bool }, ['id', 'name', 'poly']),
  Level: object({ id, name: str, elevation: num, ceiling: positive }, ['id', 'name', 'elevation']),
  Column: object({ ...common, level: id, center: ref('Vec2'), shape: enumeration('rect', 'round'), size: tuple([positive, positive]), rotation: num, kind: enumeration('bearing', 'decorative'), name: str }, ['id', 'center', 'shape', 'size', 'kind']),
  Shaft: object({ ...common, level: id, poly: array(ref('Vec2'), 3), kind: enumeration('flue', 'pipe', 'vent', 'other'), name: str }, ['id', 'poly', 'kind']),
  Stair: object({ ...common, level: id, to: id, poly: array(ref('Vec2'), 3), path: array(ref('Vec2'), 2), width: positive, kind: enumeration('straight', 'L', 'U', 'spiral'), steps: { type: 'integer', minimum: 1 }, name: str }, ['id', 'level', 'to', 'poly', 'path', 'width', 'kind']),
  Void: object({ id, level: id, poly: array(ref('Vec2'), 3), name: str }, ['id', 'level', 'poly']),
  Underlay: object({ src: { type: 'string', minLength: 1, pattern: '^(?:(?![A-Za-z][A-Za-z0-9+.-]*:|[/\\\\]{2}).+|data:image/(?:png|jpe?g|webp|gif|bmp|avif);base64,.+|data:image/svg\\+xml(?:;charset=utf-8)?(?:;base64)?,.+)$' }, mmPerPx: positive, mmPerPxY: positive, origin: ref('Vec2'), rotation: num, flipX: bool, flipY: bool, opacity: { type: 'number', minimum: 0, maximum: 100 }, visible: bool, calibrations: array(object({ p1: ref('Vec2'), p2: ref('Vec2'), length: positive, note: str }, ['p1', 'p2', 'length'])) }, ['src', 'mmPerPx', 'origin', 'opacity', 'visible']),
  Question: object({ id, level: id, text: str, category: enumeration('original', 'renovation'), certainty: ref('Certainty'), bbox: ref('Box'), targets: array(str), options: array(str), answer: str, answeredBy: str, answeredAt: str }, ['id', 'text', 'category']),
  Change: object({ id, op: enumeration('add', 'remove', 'update'), type: enumeration('wall', 'opening', 'beam', 'room', 'column', 'shaft', 'stair', 'void'), target: id, data: { type: 'object' }, range: tuple([nonnegative, nonnegative]), note: str, group: str, by: enumeration('user', 'agent'), status: enumeration('pending', 'confirmed'), confirm: object({ by: id, at: str }, ['by']), at: str }, ['id', 'op', 'type', 'by', 'status']),
}
Object.assign(defs, decorDefinitions())
// Schema describes files, never the mixed-unit runtime objects.
for (const [name, keys] of Object.entries({ Wall: ['height', 'lowHeight'], Opening: ['sill', 'head'], Beam: ['bottom'], Room: ['ceiling', 'floorOffset'], Level: ['elevation', 'ceiling'] })) {
  for (const key of keys) (defs[name] as any).properties[key] = { ...(defs[name] as any).properties[key], description: '长度单位 mm' }
}
const changeDef = defs.Change as any
changeDef.allOf = [
  { if: { properties: { op: { const: 'add' } } }, then: { required: ['data'] }, else: { required: ['target'] } },
  { if: { properties: { op: { const: 'update' } } }, then: { required: ['data'] } },
  ...['wall', 'opening', 'beam', 'room', 'column', 'shaft', 'stair', 'void'].map(type => ({ if: { properties: { op: { const: 'update' }, type: { const: type } } }, then: { properties: { data: { ...(defs[type[0].toUpperCase() + type.slice(1)] as object), required: [] } } } })),
  ...['wall', 'opening', 'beam', 'room', 'column', 'shaft', 'stair', 'void'].map(type => ({ if: { properties: { op: { const: 'add' }, type: { const: type } } }, then: { properties: { data: ref(type[0].toUpperCase() + type.slice(1)) } } })),
]
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:floorplan-structure:v3',
  title: '户型结构方案 v3（全部长度 mm）',
  description: '所有长度含高度均为 mm；像素坐标为 px、角度为度、面积为 m²、panes.width 为比例。legacy 是不透明旧格式快照，不参与 v3 换算。',
  ...object({ decor: ref('Decor'), format: { const: 'floorplan-structure' }, version: { const: 3 }, title: str, ceiling: positive, north: num, levels: array(ref('Level'), 1), columns: array(ref('Column')), shafts: array(ref('Shaft')), stairs: array(ref('Stair')), voids: array(ref('Void')), levelUnderlays: { type: 'object', additionalProperties: ref('Underlay') }, walls: array(ref('Wall')), openings: array(ref('Opening')), beams: array(ref('Beam')), rooms: array(ref('Room')), underlay: ref('Underlay'), questions: array(ref('Question')), changes: array(ref('Change')), legacy: { type: 'object', additionalProperties: true }, meta: object({ planFile: str, source: str, createdAt: str, updatedAt: str }) }, ['format', 'version', 'title', 'ceiling', 'walls', 'openings', 'beams', 'rooms', 'questions', 'changes']),
  $defs: defs,
}
writeFileSync('schema/plan.schema.json', JSON.stringify(schema, null, 2) + '\n')
