import { expect, it, vi } from 'vitest'
import { emptyPlan, parsePlanText, serializePlan } from './io.ts'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'

it('UI restores old autosave, writes v3, and restores new heights without drift',async()=>{
 const memory=new Map<string,string>(),key='floorplan-structure:autosave:v2'
 vi.stubGlobal('localStorage',{getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)})
 vi.useFakeTimers()
 const {readAutosave,startAutosave}=await import('../ui/actions.ts'),{useStore}=await import('../ui/store.ts'),saved=useStore.getState()
 let stop:undefined|(()=>void)
 try {
  const p=emptyPlan();p.walls=[{id:'w',a:[0,0],b:[3000,0],thickness:120,kind:'partition'}];memory.set(key,JSON.stringify({plan:p}));expect(readAutosave()!.plan.ceiling).toBe(2.8)
  useStore.setState({base:p});stop=startAutosave();useStore.setState({base:{...p,ceiling:3.15}});await vi.advanceTimersByTimeAsync(2000)
  expect(JSON.parse(memory.get(key)!).plan).toMatchObject({version:3,ceiling:3150});expect(readAutosave()!.plan.ceiling).toBe(3.15)
 }finally{stop?.();useStore.setState(saved,true);vi.useRealTimers();vi.unstubAllGlobals()}
})
it('local service saves v2/v3 via shared boundary and GET remains readable',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'floorplan-v3-')),file=join(directory,'plan.json'),p=emptyPlan()
 writeFileSync(file,JSON.stringify(p))
 const reserve=createServer();await new Promise<void>(r=>reserve.listen(0,'127.0.0.1',r));const port=(reserve.address() as {port:number}).port;await new Promise<void>(r=>reserve.close(()=>r()))
 const child=spawn(process.execPath,['scripts/serve.mjs',directory,String(port)],{stdio:['ignore','pipe','pipe']})
 let ready='',err='';child.stderr.on('data',c=>{err+=c})
 try {
  await new Promise<void>((res,rej)=>{const timer=setTimeout(()=>rej(Error('service timeout '+err)),3000);child.once('exit',code=>{clearTimeout(timer);rej(Error('service exit '+code+' '+err))});child.stdout.on('data',c=>{ready+=c;if(ready.includes('打开：')){clearTimeout(timer);res()}})})
  const url=`http://127.0.0.1:${port}`
  for(const body of [JSON.stringify({...p,ceiling:3.15}),serializePlan({...p,ceiling:2.95})]) {
    const result=await fetch(url+'/save?plan=plan.json',{method:'POST',headers:{'Content-Type':'application/json'},body});expect(result.status).toBe(200)
    const disk=JSON.parse(readFileSync(file,'utf8'));expect(disk.version).toBe(3);expect(disk.ceiling).toBeGreaterThan(2000)
    const loaded=parsePlanText(await (await fetch(url+'/plan.json')).text());expect(loaded.issues).toEqual([]);expect(loaded.plan.ceiling).toBe(disk.ceiling/1000)
  }
  expect((await fetch(url+'/save?plan=plan.json',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status).toBe(400)
 }finally {
  // Only terminate this test's own child handle; never match processes by name.
  if(child.exitCode===null){const exited=new Promise<void>(r=>child.once('exit',()=>r()));child.kill('SIGTERM');await exited}
  rmSync(directory,{recursive:true,force:true})
 }
},10000)
it('CLI stats and decor expose mm lengths, while areas remain m²',()=>{
 const directory=mkdtempSync(join(tmpdir(),'floorplan-cli-v3-')),file=join(directory,'plan.json')
 try {
  const p=emptyPlan();p.levels=[{id:'L1',name:'一层',elevation:0},{id:'L2',name:'二层',elevation:3.2}]
  writeFileSync(file,serializePlan(p));const result=spawnSync(process.execPath,['scripts/plan.ts','stats',file],{encoding:'utf8'})
  expect(result.status).toBe(0);expect(JSON.parse(result.stdout).byLevel[1].elevation).toBe(3200)
 }finally{rmSync(directory,{recursive:true,force:true})}
})
