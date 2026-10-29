/** Only for the synthetic example drawn from this geometry, never for inferred real-world plans.
 * node scripts/o7-example-evidence.ts <examples/two-bed/plan.json> <assets/example/plan.json>
 * stdout records every box for a reproducible overlay review.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { beamFootprint, columnFootprint, openingFootprint, openingSpan, wallFootprint } from '../src/core/geometry.ts'
import { parsePlanText, serializePlan } from '../src/core/io.ts'
import type { Box, Vec2 } from '../src/core/types.ts'

const [input, copy] = process.argv.slice(2)
if (!input || !copy) throw new Error('需要主示例和随包示例的 plan.json 全路径')
const { plan, issues } = parsePlanText(readFileSync(input, 'utf8'))
if (issues.some(i => i.level === 'error')) throw new Error(JSON.stringify(issues))
const u = plan.underlay
if (!u || u.rotation || u.flipX || u.flipY || u.mmPerPx !== 10 || u.origin[0] !== 120 || u.origin[1] !== 120) throw new Error('此脚本只核准了虚构示例的 10 mm/px、origin=[120,120] 变换')
const records: { id: string; pixelBox: Box }[] = []
function attach(e: { id: string; evidence?: { certainty: string; pixelBox?: Box } }, points: Vec2[]) {
  if (e.evidence?.certainty !== 'seen') return
  const xs = points.map(p => p[0] / u!.mmPerPx + u!.origin[0]), ys = points.map(p => p[1] / (u!.mmPerPxY ?? u!.mmPerPx) + u!.origin[1])
  const box: Box = [Math.floor(Math.min(...xs)), Math.floor(Math.min(...ys)), Math.ceil(Math.max(...xs)), Math.ceil(Math.max(...ys))]
  if (box[0] >= box[2] || box[1] >= box[3] || box[0] < 0 || box[1] < 0 || box[2] > 1200 || box[3] > 1120) throw new Error(`图外或退化框：${e.id}`)
  e.evidence.pixelBox = box
  records.push({ id: e.id, pixelBox: box })
}
for (const w of plan.walls) attach(w, wallFootprint(w))
for (const o of plan.openings) {
  const points = openingFootprint(plan, o)
  if (o.kind === 'door' && o.swing) {
    // Include the drawn door leaf/swing, not just the gap in the host wall.
    const s = openingSpan(plan, o), hinge = o.swing.hinge === 'start' ? s.a : s.b, other = o.swing.hinge === 'start' ? s.b : s.a
    if (s.wall.bulge || Math.abs(s.dir[0] * s.dir[1]) > 1e-9) throw new Error('示例平开门须在轴对齐直墙上')
    points.push(hinge, other, [hinge[0] + s.normal[0] * o.swing.side * o.width, hinge[1] + s.normal[1] * o.swing.side * o.width])
  }
  attach(o, points)
}
for (const b of plan.beams) attach(b, beamFootprint(b))
for (const r of plan.rooms) attach(r, r.poly)
for (const c of plan.columns ?? []) attach(c, columnFootprint(c))
for (const e of [...(plan.shafts ?? []), ...(plan.stairs ?? [])]) attach(e, e.poly)
const text = serializePlan(plan)
writeFileSync(input, text); writeFileSync(copy, text)
console.log(JSON.stringify(records, null, 2))
