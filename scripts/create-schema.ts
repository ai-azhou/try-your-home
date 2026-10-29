/** Reproducible schema builder. Run from the app root using Node 24. */
import { writeFileSync } from 'node:fs'
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
  Wall: object({ ...common, a: ref('Vec2'), b: ref('Vec2'), thickness: positive, kind: ref('WallKind'), height: positive, lowHeight: nonnegative, bulge: num, name: str }, ['id', 'a', 'b', 'thickness', 'kind']),
  Opening: object({ ...common, wall: id, offset: nonnegative, width: positive, kind: ref('OpeningKind'), sill: nonnegative, head: positive, swing: object({ hinge: enumeration('start', 'end'), side: { enum: [1, -1] } }, ['hinge', 'side']), panes: array(object({ width: positive, kind: ref('PaneKind') }, ['width', 'kind']), 1), entry: bool, name: str }, ['id', 'wall', 'offset', 'width', 'kind', 'sill', 'head']),
  Beam: object({ ...common, a: ref('Vec2'), b: ref('Vec2'), width: positive, bottom: nonnegative, name: str }, ['id', 'a', 'b', 'width', 'bottom']),
  Room: object({ ...common, name: str, poly: array(ref('Vec2'), 3), ceiling: positive, floorOffset: nonnegative, use: str, counted: bool }, ['id', 'name', 'poly']),
  Underlay: object({ src: { type: 'string', minLength: 1, pattern: '^(?:(?![A-Za-z][A-Za-z0-9+.-]*:|[/\\\\]{2}).+|data:image/(?:png|jpe?g|webp|gif|bmp|avif);base64,.+)$' }, mmPerPx: positive, mmPerPxY: positive, origin: ref('Vec2'), rotation: num, flipX: bool, flipY: bool, opacity: { type: 'number', minimum: 0, maximum: 100 }, visible: bool, calibrations: array(object({ p1: ref('Vec2'), p2: ref('Vec2'), length: positive, note: str }, ['p1', 'p2', 'length'])) }, ['src', 'mmPerPx', 'origin', 'opacity', 'visible']),
  Question: object({ id, text: str, category: enumeration('original', 'renovation'), certainty: ref('Certainty'), bbox: ref('Box'), targets: array(str), options: array(str), answer: str, answeredBy: str, answeredAt: str }, ['id', 'text', 'category']),
  Change: object({ id, op: enumeration('add', 'remove', 'update'), type: enumeration('wall', 'opening', 'beam', 'room'), target: id, data: { type: 'object' }, range: tuple([nonnegative, nonnegative]), note: str, group: str, by: enumeration('user', 'agent'), status: enumeration('pending', 'confirmed'), confirm: object({ by: id, at: str }, ['by']), at: str }, ['id', 'op', 'type', 'by', 'status']),
}
const changeDef = defs.Change as any
changeDef.allOf = [
  { if: { properties: { op: { const: 'add' } } }, then: { required: ['data'] }, else: { required: ['target'] } },
  { if: { properties: { op: { const: 'update' } } }, then: { required: ['data'] } },
  ...['wall', 'opening', 'beam', 'room'].map(type => ({ if: { properties: { op: { const: 'add' }, type: { const: type } } }, then: { properties: { data: ref(type[0].toUpperCase() + type.slice(1)) } } })),
]
const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'urn:floorplan-structure:v2',
  title: '户型结构方案 v2',
  ...object({ format: { const: 'floorplan-structure' }, version: { const: 2 }, title: str, ceiling: positive, north: num, walls: array(ref('Wall')), openings: array(ref('Opening')), beams: array(ref('Beam')), rooms: array(ref('Room')), underlay: ref('Underlay'), questions: array(ref('Question')), changes: array(ref('Change')), legacy: { type: 'object', additionalProperties: true }, meta: object({ planFile: str, source: str, createdAt: str, updatedAt: str }) }, ['format', 'version', 'title', 'ceiling', 'walls', 'openings', 'beams', 'rooms', 'questions', 'changes']),
  $defs: defs,
}
writeFileSync('schema/plan.schema.json', JSON.stringify(schema, null, 2) + '\n')
