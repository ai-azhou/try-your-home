import { decorStats } from './decor/integration.ts'
import type { Plan } from './types.ts'
import { difference } from './decor/math.ts'
import { polygonArea, roomsBesideWall } from './geometry.ts'
import { wallFootprints } from './walls.ts'
import { unionPolygons } from './solids.ts'
import { hasLevelData, levelsOf, onLevel } from './levels.ts'
function areaValues(plan: Plan) {
  const excluded = plan.rooms.filter(r => r.counted === false)
  const footprints = wallFootprints(plan, w => {
    const sides = roomsBesideWall(plan, w.id), rooms = [...sides.positive, ...sides.negative]
    return !rooms.length || rooms.some(r => r.counted !== false)
  })
  const gross = unionPolygons([...footprints, ...plan.rooms.filter(r => r.counted !== false && r.poly.length >= 3).map(r => [r.poly])])
  // Keep the historic filled-hole convention, then explicitly subtract excluded rooms.
  const countedGross = difference(gross.map(rings => [rings[0]]), excluded.map(r => [r.poly]))
  return {
    netArea: plan.rooms.filter(r => r.counted !== false).reduce((sum, r) => sum + polygonArea(r.poly), 0),
    wallArea: wallFootprints(plan).reduce((sum, rings) => sum + polygonArea(rings[0]) - rings.slice(1).reduce((holes, ring) => holes + polygonArea(ring), 0), 0),
    grossArea: countedGross.reduce((sum, rings) => sum + polygonArea(rings[0]) - rings.slice(1).reduce((s, r) => s + polygonArea(r), 0), 0),
    excludedArea: excluded.reduce((sum, r) => sum + polygonArea(r.poly), 0),
  }
}
export function planStats(plan: Plan) {
  const roomAreas = plan.rooms.map(r => ({ id: r.id, name: r.name, area: Math.round(polygonArea(r.poly) / 1e5) / 10, counted: r.counted !== false }))
  const roundArea = (area: number) => Math.round(area / 1e5) / 10
  const extended = hasLevelData(plan), floors = levelsOf(plan).map(level => ({ level, view: onLevel(plan, level.id) }))
  const raw = extended ? floors.map(({ view }) => areaValues(view)) : [areaValues(plan)]
  const netArea = roundArea(raw.reduce((sum, s) => sum + s.netArea, 0)), grossArea = roundArea(raw.reduce((sum, s) => sum + s.grossArea, 0)), wallArea = roundArea(raw.reduce((sum, s) => sum + s.wallArea, 0))
  const counts = (p: Plan) => ({ columns: p.columns?.length ?? 0, shafts: p.shafts?.length ?? 0, stairs: p.stairs?.length ?? 0, voids: p.voids?.length ?? 0 })
  const excludedRooms = (p: Plan) => p.rooms.filter(r => r.counted === false).map(r => ({ id: r.id, name: r.name, area: roundArea(polygonArea(r.poly)) }))
  const byLevel = extended ? floors.map(({ level, view }, i) => ({ id: level.id, name: level.name, elevation: level.elevation,
    excludedRooms: excludedRooms(view), excludedArea: roundArea(raw[i].excludedArea), netArea: roundArea(raw[i].netArea), grossArea: roundArea(raw[i].grossArea), wallArea: roundArea(raw[i].wallArea),
    walls: view.walls.length, openings: view.openings.length, beams: view.beams.length, rooms: view.rooms.length, ...counts(view) })) : undefined
  return { ...(plan.decor ? { decor: decorStats(plan) } : {}), netArea, grossArea, wallArea, ...(plan.rooms.some(r => r.counted === false) || extended ? { excludedRooms: excludedRooms(plan), excludedArea: roundArea(raw.reduce((s, x) => s + x.excludedArea, 0)) } : {}), walls: plan.walls.length, doors: plan.openings.filter(o => ['door', 'sliding', 'doorway'].includes(o.kind)).length, windows: plan.openings.filter(o => ['window', 'floor-window', 'bay-window', 'open-balcony'].includes(o.kind)).length, openings: plan.openings.length, beams: plan.beams.length, rooms: plan.rooms.length, area: netArea, roomAreas, unansweredQuestions: plan.questions.filter(q => !q.answer?.trim()).length, pendingChanges: plan.changes.filter(c => c.status === 'pending').length, ...(byLevel ? { byLevel, ...counts(plan) } : {}) }
}
