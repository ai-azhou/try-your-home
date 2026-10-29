import { expect, it } from 'vitest'
import { emptyPlan, parsePlanText, serializePlan, METRE_PATHS, agentUnits } from './io.ts'
import { agentHandoff } from './handoff.ts'

it('v2 → v3 → memory → v3 preserves all declared height paths, changes, pixels and ratios', () => {
  const p: any = emptyPlan()
  // Build every schema path independently; IO must preserve even incomplete edit data for diagnostics.
  for (const path of METRE_PATHS) {
    const keys = path.split('.'); let v = p
    keys.forEach((k, i) => { const key = k === '*' ? '0' : k; if (i === keys.length - 1) v[key] = 0.29; else v = v[key] ??= keys[i + 1] === '*' || keys[i + 1] === '2' ? [] : {} })
  }
  p.decor.cabinets[0].columns[0].cells[0].appliance.size[0] = 600
  p.decor.cabinets[0].columns[0].cells[0].appliance.size[1] = 600
  p.changes = ['wall','opening','beam','room'].map((type,i)=>({id:`c${i}`,op:'update',type,target:'x',data:{height:1.23,lowHeight:0.29,sill:0.9,head:2.1,bottom:2.5,ceiling:2.8,floorOffset:-0.05},by:'agent',status:'pending'}))
  p.underlay = {src:'input.png',mmPerPx:10,origin:[120,120],opacity:50,visible:true}
  p.legacy = {ceiling:2.8, height:0.29}
  const before = structuredClone(p), wire=JSON.parse(serializePlan(p))
  for(const path of METRE_PATHS) expect(path.split('.').reduce((v,k)=>v[k==='*'?'0':k],wire),path).toBe(290)
  expect(wire.changes[0].data.height).toBe(1230);expect(wire.changes[1].data.head).toBe(2100)
  expect(wire.changes[2].data.bottom).toBe(2500);expect(wire.changes[3].data.floorOffset).toBe(-50)
  expect(wire.underlay).toEqual(p.underlay);expect(wire.legacy).toEqual(p.legacy);expect(p).toEqual(before)
  // Serialization preserves all declared units, but an incomplete document is rejected at the file boundary.
  const parsed=parsePlanText(JSON.stringify(wire))
  expect(parsed.issues.some(i => i.code === 'schema')).toBe(true)
  const valid=emptyPlan(); valid.walls=[{id:'w',a:[0,0],b:[3000,0],kind:'partition',thickness:120,height:2.9}]
  expect(parsePlanText(serializePlan(valid)).plan).toEqual(valid)
})
it('questions and diagnostics convert explicit length prose without converting areas or existing mm',()=>{
 const p=emptyPlan();p.questions=[{id:'q',category:'original',text:'窗台 0.9 m，面积 12 m²，宽 900 mm',options:['高 2.1米'],answer:'降板 -0.05 m'}]
 const q=JSON.parse(serializePlan(p)).questions[0]
 expect(q.text).toBe('窗台 900 mm，面积 12 m²，宽 900 mm');expect(q.options).toEqual(['高 2100 mm']);expect(q.answer).toBe('降板 -50 mm')
 expect(agentUnits('2.8 m / 2 m²')).toBe('2800 mm / 2 m²')
 expect(agentUnits('0.8–0.9 m；−0.05米；0.8-0.9 m')).toBe('800–900 mm；-50 mm；800-900 mm')
})
it('unsupported versions fail explicitly and v2 autosave payloads upgrade',()=>{
 const p=emptyPlan();expect(parsePlanText(JSON.stringify({...p,version:99})).issues[0].code).toBe('parse')
 const old={plan:p};const got=parsePlanText(JSON.stringify(old.plan));expect(got.plan.ceiling).toBe(2.8);expect(JSON.parse(serializePlan(got.plan)).ceiling).toBe(2800)
})
it('structural handoff uses file millimetres',()=>{
 const p=emptyPlan();p.walls=[{id:'w',a:[0,0],b:[3000,0],thickness:120,kind:'partition',height:2.9}]
 expect(agentHandoff(p,[{type:'wall',id:'w'}],'看高度',{mode:'original'})).toContain('高 2900')
})
