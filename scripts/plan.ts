import { decorStatus, rehostDecor, decorItems } from '../src/core/decor/resolve.ts'
import { materialTakeoff } from '../src/core/decor/surfaces.ts'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { isEmptyPlan, loadError } from '../src/core/persistence.ts'
import { dirname, join } from 'node:path'
import { exportGlb } from '../src/core/glb.ts'
import { createRenderSession, listCameras, type RenderPass, type CameraRecord, type CameraSpec, type RenderView } from '../src/core/raster.ts'
import type { ModelState } from '../src/core/mesh.ts'
import { parsePlanText, serializePlan, agentUnits, lengthUnit, planFileValue } from '../src/core/io.ts'
import { applyChanges, validateReplay } from '../src/core/changes.ts'
import { planStats } from '../src/core/summary.ts'
import { validatePlan } from '../src/core/validate.ts'

const [command, input, output, ...flags] = process.argv.slice(2)
if (command === 'schema') {
  await import('../schema/generate.ts')
} else try {
  if (!['convert', 'validate', 'apply', 'stats', 'decor', 'export', 'render', 'cameras'].includes(command) || !input || ['convert', 'export', 'render'].includes(command) && !output) throw new Error('用法：先设置 $SKILL 为 Skill 根目录的绝对路径，$WORK 为用户工作目录的绝对路径；在 $WORK 执行，输入输出用全路径。\nSKILL="/绝对路径/see-your-home"\nWORK="/用户的/工作目录"\ncd "$WORK"\n' + [
    'schema', 'cameras "$WORK/方案.json" [--json] [--all] [--state original|renovated] [--level id]',
    'convert "$WORK/旧.json" "$WORK/新.json"', 'validate "$WORK/方案.json"', 'apply "$WORK/方案.json"', 'stats "$WORK/方案.json"', 'decor "$WORK/方案.json"',
    'export "$WORK/方案.json" "$WORK/输出.glb" [--state original|renovated] [--level id]',
    'render "$WORK/方案.json" "$WORK/输出目录" [--camera 预设|room:id|"$WORK/相机.json"（可重复）] [--cameras "$WORK/列表.json"] [--state original|renovated] [--views iso-sw,iso-ne,iso-se,iso-nw,top] [--level id] [--section mm] [--passes clay,depth,lines,seg,openings] [--size 2400x1600] [--transparent]',
    'render "$WORK/方案.json" "$WORK/输出目录" --camera "pos=2000,1450,1000;target=2000,1450,4000;fov=75"',
  ].map(line => 'node "$SKILL/scripts/plan-cli.mjs" ' + line).join('\n'))
  const { plan, report, issues } = parsePlanText(readFileSync(input === '-' ? 0 : input, 'utf8'))
  if (issues.some(i => i.code === 'parse' || i.code === 'schema') && command !== 'validate') throw new Error(issues.map(i => i.message).join('\n'))
  if (command === 'export' || command === 'render' || command === 'cameras') {
    if (issues.some(i => i.level === 'error')) throw new Error(issues.filter(i => i.level === 'error').map(i => i.message).join('\n'))
    let all = false, json = false
    const cameras: { camera: string | CameraSpec; record: Partial<CameraRecord> }[] = []
    const addCamera = (value: unknown) => {
      if (typeof value !== 'string' && (!value || typeof value !== 'object')) throw new Error('相机清单项须为机位字符串或相机对象')
      if (typeof value === 'string' && (value.startsWith('room:') || value.startsWith('pos=') || ['iso-sw','iso-ne','iso-se','iso-nw','top'].includes(value))) cameras.push({ camera: value, record: {} })
      else { const data = typeof value === 'string' ? JSON.parse(readFileSync(value, 'utf8')) : value; const record = data.camera ? { ...data.camera, level: data.level ?? data.camera.level } : data; if (record.unit !== undefined && record.unit !== 'mm') throw new Error('相机文件单位必须为 mm'); cameras.push({ camera: record, record }) }
    }
    let passes: RenderPass[] | undefined, state: ModelState = 'original', level: string | undefined, section: number | undefined, sizeSet = false, stateSet = false, transparentSet = false, views: RenderView[] = ['iso-sw', 'iso-ne', 'top'], width = 2400, height = 1600, transparent = false
    const args = command === 'cameras' ? [output, ...flags].filter((v): v is string => v !== undefined) : flags
    for (let i = 0; i < args.length; i++) {
      const flag = args[i]
      if (flag === '--state') { const v = args[++i]; if (v !== 'original' && v !== 'renovated') throw new Error('--state 必须为 original 或 renovated'); state = v; stateSet = true }
      else if (flag === '--json' && command === 'cameras') { json = true }
      else if (flag === '--all' && command === 'cameras') { all = true }
      else if (flag === '--transparent' && command === 'render') { transparent = true; transparentSet = true }
      else if (flag === '--level') { level = args[++i]; if (!level) throw new Error('--level 缺少楼层 id') }
      else if (flag === '--section' && command === 'render') { section = Number(args[++i]); if (!Number.isFinite(section) || section <= 0) throw new Error('--section 必须是正数 mm') }
      else if (flag === '--camera' && command === 'render') {
        const value = args[++i]; if (!value) throw new Error('--camera 缺少值')
        addCamera(value)
      }
      else if (flag === '--cameras' && command === 'render') {
        const file = args[++i]; if (!file) throw new Error('--cameras 缺少 JSON 列表文件')
        const values = JSON.parse(readFileSync(file, 'utf8')); if (!Array.isArray(values) || !values.length) throw new Error('--cameras 必须是非空 JSON 数组')
        values.forEach(addCamera)
      }
      else if (flag === '--passes' && command === 'render') { passes = args[++i]?.split(',') as RenderPass[]; if (!passes?.length) throw new Error('--passes 缺少通道清单') }
      else if (flag === '--views' && command === 'render') { const v = args[++i]?.split(','); if (!v?.length || v.some(x => !['iso-sw', 'iso-ne', 'iso-se', 'iso-nw', 'top'].includes(x))) throw new Error('--views 只支持 iso-sw,iso-ne,iso-se,iso-nw,top'); views = [...new Set(v)] as RenderView[] }
      else if (flag === '--size' && command === 'render') { const v = args[++i]; if (!/^\d+x\d+$/.test(v ?? '')) throw new Error('--size 格式为 宽x高'); sizeSet = true; [width, height] = v.split('x').map(Number) }
      else throw new Error(`未知参数：${flag}`)
    }
    if (command === 'cameras') {
      const choices = listCameras(plan, state, { all, level })
      process.stdout.write(json ? JSON.stringify(choices, null, 2) + '\n' : choices.map(c => `${c.id} [${c.level}] ${c.description}`).join('\n') + '\n')
    }
    else if (command === 'export') { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, exportGlb(plan, { state, level })); process.stdout.write(`GLB: ${output}\n`) }
    else {
      const session = createRenderSession(plan)
      const usedNames = new Set<string>()
      const selections = cameras.length ? cameras : views.map(camera => ({ camera, record: {} as Partial<CameraRecord> }))
      for (const [index, { camera, record }] of selections.entries()) {
        const view = typeof camera === 'string' ? camera : camera.id ?? `custom-${index + 1}`
        const bg = transparentSet ? transparent : record.transparent ?? transparent
        process.stderr.write(`渲染 ${index + 1}/${selections.length}：${view}\n`)
        const { files, camera: savedCamera } = session.renderKit({ state: stateSet ? state : record.state ?? state, camera, level: level ?? record.level, section: section ?? record.section,
          width: sizeSet ? width : record.width ?? width, height: sizeSet ? height : record.height ?? height, transparent: bg, passes: passes ?? record.passes })
        mkdirSync(output, { recursive: true })
        let stem = view.replace(/[^a-zA-Z0-9_-]/g, '_')
        if (usedNames.has(stem)) stem += `-${savedCamera.level ?? 'all'}-${index + 1}`.replace(/[^a-zA-Z0-9_-]/g, '_')
        while (usedNames.has(stem)) stem += '_'; usedNames.add(stem)
        const target = join(output, `${stem}-${bg ? 'transparent' : 'white'}.png`)
        for (const [name, bytes] of Object.entries(files)) { const file = name === 'clay.png' ? target : target.replace(/\.png$/, '.' + name); writeFileSync(file, bytes); process.stdout.write(`PNG: ${file}\n`) }
        const prefix = target.split(/[\\/]/).at(-1)!.replace(/\.png$/, '')
        for (const o of savedCamera.openingMasks) o.mask = `${prefix}.${o.mask}`
        writeFileSync(target.replace(/\.png$/, '.camera.json'), JSON.stringify(savedCamera, null, 2) + '\n')
      }
    }
  } else if (command === 'convert') {
    if (issues.some(i => i.level === 'error')) throw new Error(issues.map(i => i.message).join('\n'))
    if (output !== '-' && output !== '/dev/stdout' && existsSync(output) && isEmptyPlan(plan)) {
      const old = parsePlanText(readFileSync(output, 'utf8'))
      if (loadError(old.issues) || !isEmptyPlan(old.plan)) throw new Error('拒绝用空方案覆盖含有数据或无法读取的旧文件')
    }
    const text = serializePlan(plan)
    if (output === '/dev/stdout' || output === '-') process.stdout.write(text)
    else { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, text) }
    // Report uses stderr so /dev/stdout is a valid JSON stream.
    process.stderr.write(JSON.stringify({ ...report, approximations: report.approximations.map(agentUnits), warnings: report.warnings.map(agentUnits) }, null, 2) + '\n')
    if (issues.some(i => i.level === 'error')) process.exitCode = 1
  } else if (command === 'validate') {
    process.stdout.write(JSON.stringify({ valid: !issues.some(i => i.level === 'error'), issues: issues.map(i => ({ ...i, message: agentUnits(i.message) })) }, null, 2) + '\n')
    if (issues.some(i => i.level === 'error')) process.exitCode = 1
  } else if (command === 'apply') {
    if (issues.some(i => i.level === 'error')) throw new Error(issues.map(i => i.message).join('\n'))
    const replay = applyChanges(plan, plan.changes), after = validateReplay(replay, plan.changes, plan)
    process.stdout.write(JSON.stringify({ results: replay.results.map(r => ({ ...r, ...(r.error ? { error: agentUnits(r.error) } : {}), ...(r.warnings ? { warnings: r.warnings.map(agentUnits) } : {}) })), issues: after.map(i => ({ ...i, message: agentUnits(i.message) })) }, null, 2) + '\n')
    if (replay.results.some(r => !r.ok) || after.some(i => i.level === 'error')) process.exitCode = 1
  } else if (command === 'decor') {
    const after = plan.legacy?.__structureReplayFrame ? plan : applyChanges(plan, plan.changes.filter(c => c.status === 'confirmed')).plan, resolved = decorStatus(plan)
    const decor = planFileValue({ ...plan, decor: resolved.decor }).decor
    const items = new Map(decor ? decorItems(decor).map(i => [i.id, i]) : [])
    const storedItems = (list: typeof resolved.items) => list.map(i => ({ ...i, item: items.get(i.id), reasons: i.reasons.map(agentUnits) }))
    process.stdout.write(JSON.stringify({ ...resolved, decor, items: storedItems(resolved.items), placed: storedItems(resolved.placed),
      issues: resolved.issues.map(i => ({ ...i, text: agentUnits(i.text) })),
      rehosted: plan.decor ? planFileValue({ ...plan, decor: rehostDecor(plan, after, plan.decor) }).decor : undefined,
      materials: materialTakeoff({ ...after, decor: resolved.decor }) }, null, 2) + '\n')
    if (resolved.issues.some(i => i.level === 'error')) process.exitCode = 1
  } else { const stats = planStats(plan); stats.byLevel?.forEach(l => { l.elevation = lengthUnit(l.elevation) }); process.stdout.write(JSON.stringify(stats, null, 2) + '\n') }
} catch (error) {
  process.stderr.write(`错误：${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
