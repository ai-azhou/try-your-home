/** Generate storage-shape definitions from the decor TypeScript contract, then add numeric/path constraints. */
import ts from 'typescript'
import { readFileSync } from 'node:fs'
export function decorDefinitions(): Record<string, any> {
  const source = ts.createSourceFile('decor/types.ts', readFileSync(new URL('../src/core/decor/types.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true)
  const declarations = new Map<string, ts.InterfaceDeclaration | ts.TypeAliasDeclaration>()
  source.forEachChild(n => { if (ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) declarations.set(n.name.text, n) })
  const definitions: Record<string, any> = {}, ref = (id: string) => ({ $ref: `#/$defs/${id}` })
  const members = (nodes: ts.NodeArray<ts.TypeElement>) => {
    const properties: Record<string, any> = {}, required: string[] = []
    for (const n of nodes) if (ts.isPropertySignature(n) && n.type && n.name) { const key = ts.isIdentifier(n.name) || ts.isStringLiteral(n.name) ? n.name.text : n.name.getText(source); properties[key] = convert(n.type); if (!n.questionToken) required.push(key) }
    return { type: 'object', properties, required, additionalProperties: false }
  }
  const convert = (node: ts.TypeNode): any => {
    if (node.kind === ts.SyntaxKind.UnknownKeyword) return {}
    if (node.kind === ts.SyntaxKind.StringKeyword) return { type: 'string' }
    if (node.kind === ts.SyntaxKind.NumberKeyword) return { type: 'number' }
    if (node.kind === ts.SyntaxKind.NeverKeyword) return false
    if (ts.isIntersectionTypeNode(node)) return { allOf: node.types.map(convert) }
    if (node.kind === ts.SyntaxKind.BooleanKeyword) return { type: 'boolean' }
    if (ts.isParenthesizedTypeNode(node)) return convert(node.type)
    if (ts.isLiteralTypeNode(node)) return { const: JSON.parse(node.literal.getText(source).replace(/^'(.*)'$/, '"$1"')) }
    if (ts.isArrayTypeNode(node)) return { type: 'array', items: convert(node.elementType) }
    if (ts.isTupleTypeNode(node)) return { type: 'array', prefixItems: node.elements.map(convert), minItems: node.elements.length, maxItems: node.elements.length }
    if (ts.isUnionTypeNode(node)) return { anyOf: node.types.map(convert) }
    if (ts.isTypeLiteralNode(node)) return members(node.members)
    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText(source)
      if (name === 'Record') return { type: 'object', additionalProperties: convert(node.typeArguments![1]) }
      if (name === 'Partial') return convert(node.typeArguments![0])
      return ref(name)
    }
    throw new Error(`Unsupported decor schema type: ${node.getText(source)}`)
  }
  const define = (name: string): any => {
    if (definitions[name]) return definitions[name]
    const node = declarations.get(name)!
    if (ts.isTypeAliasDeclaration(node)) return definitions[name] = convert(node.type)
    const own = members(node.members)
    for (const clause of node.heritageClauses ?? []) for (const base of clause.types) { const schema = define(base.expression.getText(source)); Object.assign(own.properties, schema.properties); own.required.push(...schema.required) }
    return definitions[name] = own
  }
  for (const name of declarations.keys()) define(name)
  const positive = { type: 'number', exclusiveMinimum: 0 }, nonnegative = { type: 'number', minimum: 0 }
  for (const name of ['DecorBase', 'FurnitureBase', 'Cabinet', 'Panel', 'Recess', 'DoorFinish', 'Surface', 'Material', 'StylePreset']) definitions[name].properties.id = { type: 'string', minLength: 1 }
  for (const [name, keys] of Object.entries({ FurnitureBase: ['height'], Cabinet: ['width', 'depth'], Panel: ['thickness'], CabinetColumn: ['width'], CabinetCell: ['h'] })) for (const key of keys) definitions[name].properties[key] = positive
  for (const name of ['FurnitureBase', 'Cabinet']) definitions[name].properties.embed = nonnegative
  definitions.Cabinet.properties.plinth = nonnegative
  definitions.CabinetCell.properties.count = { type: 'integer', minimum: 0, maximum: 1000 }
  definitions.Material.properties.color = { type: 'string', pattern: '^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$' }
  const pbr = definitions.Material.properties.pbr
  for (const key of ['roughness', 'metalness', 'sheen']) pbr.properties[key] = { type: 'number', minimum: 0, maximum: 1 }
  for (const key of ['base', 'normal', 'rough']) pbr.properties.maps.properties[key] = { type: 'string', minLength: 1, pattern: '^(?![A-Za-z][A-Za-z0-9+.-]*:|[/\\\\]|\\s)[^\\r\\n]+$' }
  // Flatten the exclusive furniture branches: additionalProperties=false must see common fields.
  definitions.Furniture = { oneOf: definitions.Furniture.allOf[1].anyOf.map((branch: any) => ({
    ...branch, properties: { ...definitions.FurnitureBase.properties, ...branch.properties },
    required: [...definitions.FurnitureBase.required, ...branch.required],
  })) }
  definitions.ComponentPart = { oneOf: definitions.ComponentPart.allOf[1].anyOf.map((branch: any) => ({ ...branch, properties: { ...definitions.ComponentPartBase.properties, ...branch.properties }, required: [...definitions.ComponentPartBase.required, ...branch.required] })) }
  for (const name of ['DecorIssue']) delete definitions[name] // runtime diagnostics are not persisted
  for (const [name, keys] of Object.entries({ FurnitureBase: ['height', 'z'], Cabinet: ['z', 'plinth'], CabinetCell: ['h'], FaceSpan: ['z'] }))
    for (const key of keys) definitions[name].properties[key].description = '长度单位 mm（文件 v3）'
  return definitions
}
