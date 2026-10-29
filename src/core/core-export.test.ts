import { test } from 'vitest'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
const validator = createRequire(import.meta.url)('gltf-validator')
import { buildMesh, solidMesh, modelPlan } from './mesh.ts'
import { exportGlb, meshToGlb } from './glb.ts'
import { renderPng, renderRgba } from './raster.ts'
import { emptyPlan, parsePlanText } from './io.ts'
import type { Plan, Vec2 } from './types.ts'
const example = parsePlanText(readFileSync(new URL('../../fixtures/example-v2.json', import.meta.url), 'utf8')).plan
const rect = (x=0,y=0,w=4000,h=4000):Vec2[] => [[x,y],[x+w,y],[x+w,y+h],[x,y+h]]
const gltf = (bytes:Uint8Array) => JSON.parse(Buffer.from(bytes).subarray(20,20+new DataView(bytes.buffer,bytes.byteOffset).getUint32(12,true)).toString())
const count = (groups:ReturnType<typeof buildMesh>) => groups.reduce((n,g)=>n+g.parts.reduce((n,p)=>n+p.positions.length/9,0),0)
async function valid(bytes:Uint8Array) { const result=await validator.validateBytes(bytes); assert.equal(result.issues.numErrors,0,JSON.stringify(result.issues)); return result }
test('example GLB: validator, triangle count, metres/Y-up, one material+mesh per kind, component IDs',async()=>{
 const mesh=buildMesh(example), bytes=exportGlb(example), doc=gltf(bytes)
 await valid(bytes)
 assert.equal(doc.meshes.length,mesh.length);assert.equal(doc.materials.length,mesh.length)
 assert.equal(doc.meshes.reduce((n:number,m:any)=>n+m.primitives.reduce((s:number,p:any)=>s+doc.accessors[p.attributes.POSITION].count/3,0),0),count(mesh))
 for(const w of example.walls) assert(doc.nodes.some((n:any)=>n.name===w.id))
 assert(mesh.flatMap(g=>g.parts).flatMap(p=>p.positions).every(Number.isFinite))
 assert.equal(doc.asset.extras.upAxis,'Y')
})
test('polygon hole: cap area 12m², outward winding, no covered hole, 32 triangles', async()=>{
 const p=solidMesh({kind:'slab',ids:['hole'],z0:0,z1:1,polygons:[[rect(),rect(1000,1000,2000,2000)]]})
 assert.equal(p.positions.length/9,32)
 let area=0, volume=0
 for(let t=0;t<p.positions.length;t+=9){
  const [ax,ay,az,bx,by,bz,cx,cy,cz]=p.positions.slice(t,t+9)
  volume+=(ax*(by*cz-bz*cy)-ay*(bx*cz-bz*cx)+az*(bx*cy-by*cx))/6
  if(p.normals[t+1]>.99){area+=Math.abs((bx-ax)*(cz-az)-(bz-az)*(cx-ax))/2;const x=(ax+bx+cx)/3,z=(az+bz+cz)/3;assert(!(x>1&&x<3&&z>1&&z<3))}
 }
 assert(Math.abs(area-12)<1e-6);assert(Math.abs(volume-12)<1e-6)
 await valid(meshToGlb([{kind:'slab',parts:[p]}]))
})
test('duplex slabs, stairs, columns and shafts keep absolute elevations and floor holes',async()=>{
 const p:Plan={...emptyPlan(),levels:[{id:'L1',name:'lower',elevation:0},{id:'L2',name:'upper',elevation:3.2}],
 walls:[{id:'w1',a:[0,0],b:[4000,0],thickness:200,kind:'partition'},{id:'w2',level:'L2',a:[0,0],b:[4000,0],thickness:200,kind:'partition'}],
 rooms:[{id:'r1',name:'lower',poly:rect()},{id:'r2',level:'L2',name:'upper',poly:rect()}],
 columns:[{id:'c',level:'L2',center:[3000,3000],shape:'rect',size:[300,400],kind:'bearing'}],shafts:[{id:'s',poly:rect(3000,2000,400,400),kind:'pipe'}],
 voids:[{id:'v',level:'L2',poly:rect(1000,1000,1000,1000)}],stairs:[{id:'st',level:'L1',to:'L2',poly:rect(0,1000,3000,1000),path:[[0,1500],[3000,1500]],width:1000,kind:'straight',steps:16}]}
 const m=buildMesh(p), parts=m.flatMap(g=>g.parts)
 assert.equal(Math.min(...parts.filter(x=>x.kind==='wall'&&x.ids.includes('w2')).flatMap(x=>x.positions.filter((_,i)=>i%3===1))),3.2)
 assert.equal(m.find(g=>g.kind==='stair')!.parts.length,16)
 assert(m.find(g=>g.kind==='slab'));assert(m.find(g=>g.kind==='shaft'));assert(m.find(g=>g.kind==='column'))
 await valid(exportGlb(p))
 assert(renderPng(p,{width:120,height:100}).length>100)
})
test('arc wall tessellation increases triangles and preserves curved coordinates',async()=>{
 const p:Plan={...emptyPlan(),walls:[{id:'curve',a:[0,0],b:[4000,0],thickness:150,kind:'partition'}]}
 const straight=count(buildMesh(p)); p.walls[0].bulge=900
 const m=buildMesh(p);assert(count(m)>straight);assert(m[0].parts.some(x=>x.positions.some((v,i)=>i%3===2&&v>.5)))
 await valid(exportGlb(p))
})
test('original/renovated: confirmed only, input immutable, failed replay throws',()=>{
 const p=structuredClone(example);p.changes=[{id:'ch',op:'update',type:'wall',target:p.walls[0].id,data:{height:3.4},by:'user',status:'confirmed'}]
 const before=JSON.stringify(p);assert.notDeepEqual(exportGlb(p),exportGlb(p,{state:'renovated'}));assert.equal(JSON.stringify(p),before)
 p.changes[0].status='pending';assert.deepEqual(exportGlb(p),exportGlb(p,{state:'renovated'}))
 p.changes[0].status='confirmed';p.changes[0].target='missing';assert.throws(()=>modelPlan(p,'renovated'),/重放失败/)
})
test('all views deterministic PNG hashes, valid scanlines and transparent coverage',()=>{
 for(const view of ['iso-sw','iso-ne','top'] as const){
  const options={view,width:160,height:120,transparent:true}, a=renderPng(example,options), b=renderPng(example,options)
  const hash=(x:Uint8Array)=>createHash('sha256').update(x).digest('hex');assert.equal(hash(a),hash(b))
  const rgba=renderRgba(example,options).rgba;const alpha=Array.from(rgba).filter((_,i)=>i%4===3);assert(alpha.includes(0));assert(alpha.includes(255));assert(alpha.some(x=>x>0&&x<255))
  const raw=Buffer.from(a), chunks:Buffer[]=[];for(let i=8;i<raw.length;){const length=raw.readUInt32BE(i);if(raw.toString('ascii',i+4,i+8)==='IDAT')chunks.push(raw.subarray(i+8,i+8+length));i+=length+12}
  assert.equal(inflateSync(Buffer.concat(chunks)).length,(160*4+1)*120)
  const white=renderRgba(example,{...options,transparent:false}).rgba;assert(Array.from(white).filter((_,i)=>i%4===3).every(a=>a===255))
 }
})
test('top cut creates caps at 1.2m and preserves open door gaps',()=>{
 const parts=buildMesh(example,{cutHeight:1.2}).flatMap(g=>g.parts)
 assert.equal(Math.max(...parts.flatMap(p=>p.positions.filter((_,i)=>i%3===1))),1.2)
 assert(parts.some(p=>p.kind==='wall'&&p.normals.some((v,i)=>i%3===1&&v===1)))
})
test('invalid render options and empty plan are explicit errors',async()=>{
 assert.throws(()=>renderPng(example,{width:0}),/尺寸/);assert.throws(()=>renderPng(emptyPlan()),/没有/)
 await valid(exportGlb(emptyPlan()))
})
