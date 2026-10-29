import { buildMesh, CLAY_COLORS, GLASS_KINDS, GLASS_OPACITY, type MeshGroup, type MeshOptions } from './mesh.ts'
import type { Plan } from './types.ts'

/** glTF uses linear material factors; the tool's palette is authored in sRGB. */
const linearColor = (hex: string) => [1, 3, 5].map(i => { const s = parseInt(hex.slice(i, i + 2), 16) / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4 })
export function meshToGlb(groups: MeshGroup[]): Uint8Array {
  const chunks: Uint8Array[] = [], bufferViews: object[] = [], accessors: object[] = [], meshes: object[] = [], materials: object[] = [], nodes: any[] = [], sceneNodes: number[] = []
  let byteLength = 0
  const attribute = (values: number[], bounds: boolean) => {
    const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer)
    values.forEach((x, i) => view.setFloat32(i * 4, x, true))
    const bufferView = bufferViews.length
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target: 34962 })
    chunks.push(bytes); byteLength += bytes.length
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
    values.forEach((x, i) => { const v = Math.fround(x); min[i % 3] = Math.min(min[i % 3], v); max[i % 3] = Math.max(max[i % 3], v) })
    accessors.push({ bufferView, componentType: 5126, count: values.length / 3, type: 'VEC3', ...(bounds ? { min, max } : {}) })
    return accessors.length - 1
  }
  for (const group of groups.filter(g => g.parts.some(p => p.positions.length))) {
    const index = meshes.length, ids = [...new Set(group.parts.flatMap(p => p.ids))]
    const glass = GLASS_KINDS.has(group.kind)
    materials.push({ name: group.kind, pbrMetallicRoughness: { baseColorFactor: [...linearColor(CLAY_COLORS[group.kind]), glass ? GLASS_OPACITY : 1], metallicFactor: 0, roughnessFactor: glass ? .15 : .92 }, ...(glass ? { alphaMode: 'BLEND', doubleSided: true } : { doubleSided: false }) })
    // One mesh per kind. IDs remain on primitives and named metadata nodes; no duplicate geometry.
    const primitives = group.parts.filter(p => p.positions.length).map(p => ({ attributes: { POSITION: attribute(p.positions, true), NORMAL: attribute(p.normals, false) }, material: index, mode: 4, extras: { ids: p.ids, level: p.level } }))
    meshes.push({ name: group.kind, primitives })
    const nodeIndex = nodes.length
    nodes.push({ name: ids.join(', ') || group.kind, mesh: index, extras: { kind: group.kind, ids }, children: [] })
    for (const id of ids) { nodes[nodeIndex].children.push(nodes.length); nodes.push({ name: id, extras: { kind: group.kind, primitives: primitives.flatMap((p, i) => p.extras.ids.includes(id) ? [i] : []) } }) }
    if (!ids.length) delete nodes[nodeIndex].children
    sceneNodes.push(nodeIndex)
  }
  const json = { asset: { version: '2.0', generator: 'floorplan-structure core', extras: { units: 'metres', upAxis: 'Y' } }, scene: 0, scenes: [sceneNodes.length ? { nodes: sceneNodes } : {}], ...(meshes.length ? { nodes, meshes, materials, accessors, bufferViews, buffers: [{ byteLength }] } : {}) }
  const raw = new TextEncoder().encode(JSON.stringify(json)), jsonLength = Math.ceil(raw.length / 4) * 4, binLength = Math.ceil(byteLength / 4) * 4
  const out = new Uint8Array(12 + 8 + jsonLength + (binLength ? 8 + binLength : 0)), header = new DataView(out.buffer)
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, out.length, true)
  header.setUint32(12, jsonLength, true); header.setUint32(16, 0x4e4f534a, true)
  out.fill(32, 20, 20 + jsonLength); out.set(raw, 20)
  if (binLength) {
    const start = 20 + jsonLength
    header.setUint32(start, binLength, true); header.setUint32(start + 4, 0x004e4942, true)
    let offset = start + 8; for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length }
  }
  return out
}
export function exportGlb(plan: Plan, options: MeshOptions = {}): Uint8Array { return meshToGlb(buildMesh(plan, options)) }
