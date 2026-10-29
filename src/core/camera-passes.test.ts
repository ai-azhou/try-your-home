import { expect, it } from 'vitest'
import { inflateSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { emptyPlan, parsePlanText } from './io.ts'
import { buildMesh } from './mesh.ts'
import { listCameras, resolveCamera, renderKit, renderPng, SEG_CLASSES, type CameraSpec } from './raster.ts'
import type { Plan } from './types.ts'
const rect = [[100,100],[3900,100],[3900,3900],[100,3900]] as [number,number][]
function room():Plan {return {...emptyPlan(),walls:[{id:'n',a:[0,0],b:[4000,0],kind:'partition',thickness:200},{id:'e',a:[4000,0],b:[4000,4000],kind:'partition',thickness:200},{id:'s',a:[4000,4000],b:[0,4000],kind:'partition',thickness:200},{id:'w',a:[0,4000],b:[0,0],kind:'partition',thickness:200}],rooms:[{id:'r',name:'试验房间',poly:rect}]}}
const cam:CameraSpec={projection:'perspective',pos:[2000,1450,1000],target:[2000,1450,4000],fov:75}
function decode(png:Uint8Array){const b=Buffer.from(png),chunks:Buffer[]=[];for(let i=8;i<b.length;){const n=b.readUInt32BE(i);if(b.toString('ascii',i+4,i+8)==='IDAT')chunks.push(b.subarray(i+8,i+8+n));i+=n+12}return {width:b.readUInt32BE(16),height:b.readUInt32BE(20),bits:b[24],type:b[25],data:inflateSync(Buffer.concat(chunks))}}
function rgba(png:Uint8Array){const d=decode(png),out=[];for(let y=0;y<d.height;y++)for(let x=0;x<d.width;x++)out.push([...d.data.subarray(y*(d.width*4+1)+1+x*4,y*(d.width*4+1)+1+x*4+4)]);return out}
const size={width:96,height:64}
it('cameras enumerate five presets and per-room wall directions, separated by floor',()=>{
 const p=room();p.levels=[{id:'L1',name:'一层',elevation:0},{id:'L2',name:'二层',elevation:3}];p.rooms.push({...p.rooms[0],id:'upper',level:'L2'});p.walls.push(...p.walls.map(w=>({...w,id:w.id+'2',level:'L2'})))
 const choices=listCameras(p, 'original', { all: true })
 for(const l of ['L1','L2'])expect(choices.filter(c=>c.level===l).slice(0,5).map(c=>c.id)).toEqual(['iso-sw','iso-ne','iso-se','iso-nw','top'])
 expect(choices.some(c=>c.id==='room:r:s')).toBe(true);expect(choices.find(c=>c.id==='room:upper')!.camera.pos[1]).toBe(4450)
 expect(buildMesh(p,{level:'L1'}).flatMap(g=>g.parts).every(p=>p.level==='L1')).toBe(true)
})
it('room camera stands inside, clear of door sweep, at 1450 mm with 75 degree fov',()=>{
 const p=room();p.openings=[{id:'d',wall:'n',offset:150,width:900,sill:0,head:2.1,kind:'door'}]
 const c=resolveCamera(p,{camera:'room:r'});expect(c.pos[1]).toBe(1450);expect(c.fov).toBe(75);expect(Math.hypot(c.pos[0]-150,c.pos[2])).toBeGreaterThan(1100)
})
it('inline mm camera equals explicit camera, rejects malformed/unknown inputs',()=>{
 expect(resolveCamera(room(),{camera:'pos=2000,1450,1000;target=2000,1450,4000;fov=75'})).toEqual(cam)
 for(const camera of ['room:missing','unknown','pos=1,2;target=1,2,3;fov=75'])expect(()=>resolveCamera(room(),{camera})).toThrow()
 expect(()=>resolveCamera(room(),{camera:{...cam,pos:[0,0,0],target:[0,0,0]}})).toThrow()
 expect(()=>renderPng(room(),{...size,level:'absent'})).toThrow()
})
it('camera sidecar reproduces clay, all presets and perspective including top cut',()=>{
 for(const camera of ['iso-sw','iso-ne','iso-se','iso-nw','top','room:r']) {
  const a=renderKit(room(),{...size,camera,transparent:true}),c=a.camera
  const b=renderKit(room(),{camera:c,width:c.width,height:c.height,state:c.state,level:c.level,section:c.section,transparent:c.transparent})
  expect(b.files['clay.png']).toEqual(a.files['clay.png'])
 }
})
it('linear 16-bit depth is camera z mm, inverse depth and encoded RGB agree',()=>{
 const k=renderKit(room(),{...size,camera:cam,passes:['depth']}),d=decode(k.files['depth16.png'])
 expect([d.bits,d.type]).toEqual([16,0]);expect(d.data.readUInt16BE(32*(96*2+1)+1+48*2)).toBe(2900)
 const raw=rgba(k.files['raw-depthmm.png']),inv=rgba(k.files['depth-inv.png']);let low=65535,high=0
 for(let y=0;y<64;y++)for(let x=0;x<96;x++){const i=y*96+x,n=d.data.readUInt16BE(y*193+1+x*2);expect(raw[i][0]*256+raw[i][1]).toBe(n);if(n){low=Math.min(low,n);high=Math.max(high,n)}}
 expect(high).toBeGreaterThan(low);expect(Math.max(...inv.map(p=>p[0]))).toBe(255);expect(Math.min(...inv.map(p=>p[0]))).toBe(0)
})
it('interior has ceiling; segmentation uses only exact ADE20K colors',()=>{
 const k=renderKit(room(),{...size,camera:cam,passes:['seg']}),colors=new Set(rgba(k.files['seg.png']).map(p=>p.slice(0,3).join(',')))
 for(const c of colors)expect(Object.values(SEG_CLASSES).map(v=>v.join(','))).toContain(c)
 expect(colors.has(SEG_CLASSES.ceiling.join(','))).toBe(true);expect(colors.has(SEG_CLASSES.floor.join(','))).toBe(true)
})
it('coplanar wall subdivision adds no line, while opening edges remain',()=>{
 const p=room(),camera:CameraSpec={...cam,fov:40},before=renderKit(p,{...size,camera,passes:['lines']})
 p.walls[2].b=[2000,4000];p.walls.push({id:'s2',a:[2000,4000],b:[0,4000],thickness:200,kind:'partition'})
 const after=renderKit(p,{...size,camera,passes:['lines']});expect(after.files['lines.png']).toEqual(before.files['lines.png'])
 const pixels=rgba(after.files['lines.png']);for(let y=10;y<54;y++)for(let x=20;x<76;x++)expect(pixels[y*96+x][0]).toBe(255)
 p.openings=[{id:'win',wall:'s',offset:200,width:1200,sill:.9,head:2.4,kind:'window'}]
 expect(renderKit(p,{...size,camera,passes:['lines']}).files['lines.png']).not.toEqual(after.files['lines.png'])
})
it('line inversions are pixel complements',()=>{
 const k=renderKit(room(),{...size,camera:cam,passes:['lines']}),a=rgba(k.files['lines.png']),b=rgba(k.files['lines-inv.png'])
 a.forEach((p,i)=>expect(p[0]+b[i][0]).toBe(255))
})
it('opening masks, visible bbox and mm metadata agree; occluded opening remains black',()=>{
 const p=room();p.openings=[{id:'front',wall:'s',offset:1200,width:1600,sill:.9,head:2.4,kind:'window'},{id:'behind',wall:'n',offset:1200,width:1000,sill:0,head:2.1,kind:'door'}]
 const k=renderKit(p,{...size,camera:cam,passes:['openings','seg']}),o=k.camera.openings.find(o=>o.id==='front')!
 expect(o).toMatchObject({width_mm:1600,sill_mm:900,head_mm:2400});expect(k.camera.openings.some(o=>o.id==='behind')).toBe(false)
 const mask=rgba(k.files[o.mask]),points=mask.flatMap((p,i)=>p[0]?[i]:[])
 expect(points.length).toBe(o.visible_px);expect(o.bbox_xyxy).toEqual([Math.min(...points.map(i=>i%96)),Math.min(...points.map(i=>Math.floor(i/96))),Math.max(...points.map(i=>i%96)),Math.max(...points.map(i=>Math.floor(i/96)))])
 expect(rgba(k.files['opening-002.png']).every(p=>p[0]===0)).toBe(true)
})
it('near-plane crossings render finite depth, explicit sections and state produce different images',()=>{
 const p=room();const k=renderKit(p,{...size,camera:{...cam,pos:[105,1450,1000],target:[3900,1450,3900]},passes:['depth']});expect(k.camera.depth.min_mm).toBeGreaterThan(0)
 p.changes=[{id:'c',op:'update',type:'wall',target:'s',data:{height:1},by:'agent',status:'confirmed'}]
 expect(renderPng(p,{...size,view:'iso-sw',state:'renovated'})).not.toEqual(renderPng(p,{...size,view:'iso-sw'}))
 expect(renderPng(p,{...size,camera:cam,section:1200})).not.toEqual(renderPng(p,{...size,camera:cam}))
})
it('room camera stands ≥ 600 mm from walls, keeps the frame centre clear and the ceiling to about a quarter',()=>{
 const p=room();p.walls.push({id:'x',a:[0,1000],b:[1500,1000],kind:'partition',thickness:120});p.openings=[{id:'w',wall:'e',offset:1500,width:1200,sill:.9,head:2.4,kind:'window'}]
 const c=resolveCamera(p,{camera:'room:r'}),at:[number,number]=[c.pos[0],c.pos[2]]
 for(const w of p.walls){const d=[w.b[0]-w.a[0],w.b[1]-w.a[1]],t=Math.max(0,Math.min(1,((at[0]-w.a[0])*d[0]+(at[1]-w.a[1])*d[1])/(d[0]**2+d[1]**2)));expect(Math.hypot(at[0]-w.a[0]-t*d[0],at[1]-w.a[1]-t*d[1])-w.thickness/2).toBeGreaterThanOrEqual(600)}
 const k=renderKit(p,{width:96,height:64,camera:'room:r',passes:['depth','seg']}),seg=rgba(k.files['seg.png']),d=decode(k.files['depth16.png'])
 expect(seg.filter(v=>v.slice(0,3).join()===SEG_CLASSES.ceiling.join()).length/seg.length).toBeLessThanOrEqual(.27)
 for(let y=16;y<48;y++)for(let x=29;x<67;x++)expect(d.data.readUInt16BE(y*(96*2+1)+1+x*2)).toBeGreaterThan(1500)
 expect(k.camera.openings.map(o=>o.id)).toContain('w');expect(c.description).toContain('画面里有')
})
it('glass is light and see-through, not a tinted slab',()=>{
 const p=room();p.walls.push({id:'g',a:[0,2000],b:[4000,2000],kind:'glass',thickness:80})
 const view:CameraSpec={projection:'perspective',pos:[2000,1450,600],target:[2000,1450,4000],fov:75}
 const glass=rgba(renderPng(p,{width:96,height:64,camera:view})),solid=rgba(renderPng({...p,walls:p.walls.map(w=>w.id==='g'?{...w,kind:'partition' as const}:w)},{width:96,height:64,camera:view}))
 const centre=glass[32*96+48]
 expect(Math.abs(centre[0]-centre[2])).toBeLessThan(12);expect(centre[0]).toBeGreaterThan(190)
 // The floor beyond the glass shows through: the glazed frame differs from the solid-wall frame below the horizon.
 expect(glass.slice(40*96,64*96).some((v,i)=>v.join()!==solid[40*96+i].join())).toBe(true)
})
