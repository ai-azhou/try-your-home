/**
 * 装修态的右侧卡（一次一张，选中什么出现什么；设计规范 §3.2、§6、§7）：
 * 风格卡 / 这套房的装修 / 家具库 / 地面、墙面、家具、柜子（含柜体编辑的这一格）、造型、挖洞检查器 / 没地方挂了。
 * 结构和结构检查器同一套：头像盘 + 标题 + 小字 → 标签行 → 事实卡（第二行）→ 小图 → 字段 → 材料行 → 吸底操作行。
 */
import { useMemo, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, Check, ChevronRight, Columns3, Inbox, Lock, PaintRoller, Palette, Plus, RotateCw, ScanEye, Search, Sofa, Sparkles, Unlink, Wallpaper, X, Trash } from 'lucide-react'
import type { Plan, Vec2 } from '@/core/types'
import type { Cabinet, CabinetCell, Decor, FaceRef, Furniture, Material, MaterialCategory, Panel, Recess, StylePreset } from '@/core/decor/types'
import { checkEmbed } from '@/core/decor/embed'
import { faceExtent } from '@/core/decor/faces'
import { layoutCabinet } from '@/core/decor/cabinets'
import { effectiveWallHeight, polygonArea, roomsBesideWall } from '@/core/geometry'
import { useStore } from '../store'
import { Pill as KPill, RoundButton, Switch, Tag, Tip } from '../kit'
import { Actions, Field, Header, MiniSeg, Num, Visual } from '../panels/Inspector'
import { cn } from '@/lib/utils'
import { useDecor, type DSel } from './dstore'
import { elevRoomAt, itemRoom, openElevAt, openCabinetAt, dirWord, allStyles, commitDecor, decorIssues, faceFinish, faceLabel, faceRoom, findItem, floorFinish, matOf, materialUses, removeItem, roleMat, selKey, styleOf, useDecorPlan, WALL_ZH, type DecorIssues } from './model'
import { FURN_CATS, FURN_LIB, SymbolPreview, furnTones } from './furniture'
import { takeOutFurniture } from './actions'
import { furniturePose } from '@/core/decor/furniture'
import { ackItem, applyStyle, moveOrphan, nearestFaces, paintFace, paintFloor, patchCabinet, patchFurniture, patchPanel, patchRecess, resetFace, resetFloor, rotateFurniture, setEmbed } from './actions'
import { elevationModel } from './elev-model'
import { ElevDefs, ElevDrawing } from './ElevDrawing'
import { goAddOpening } from './Chrome'

const SAND = 'bg-sand-100 text-sand-700'
const MAT_ROWS = 5
const close = () => useDecor.getState().select(null)
/** 交给 Agent：装修构件带 core decorHandoff 的完整 ref（白话位置 + FaceRef + 数据 + 事实），不再只把名字和 id 填进那句话 */
const openAgentWith = (text: string, ids: string[] = []) => { const s = useStore.getState(); useDecor.getState().set({ agentRefs: ids }); s.setAgentText(text); s.openAgent(true) }
export const openAgentDecor = (ids: string[]) => openAgentWith('', ids)

export function decorCardKey(s: { styleCard: boolean; tool: string; sel: DSel | null; canvas: { k: string } }) {
  if (s.styleCard) return 'style'
  if (s.tool === 'furniture' && !s.sel) return 'lib'
  if (s.sel?.k === 'cell') return `cabinet:${s.sel.id}`
  if (s.sel) return selKey(s.sel)
  return 'overview'
}

export function DecorCard() {
  const dp = useDecorPlan()
  const styleCard = useDecor(s => s.styleCard), tool = useDecor(s => s.tool), sel = useDecor(s => s.sel)
  const issues = useMemo(() => dp?.decor ? decorIssues(dp.plan, dp.base) : null, [dp])
  if (!dp) return null
  if (!dp.decor || styleCard) return <StyleCard />
  const { plan, decor } = dp
  if (tool === 'furniture' && !sel) return <FurnitureLib decor={decor} />
  if (!sel) return <Overview plan={plan} base={dp.base} decor={decor} issues={issues} />
  if (sel.k === 'floor') return <FloorCard plan={plan} decor={decor} id={sel.id} />
  if (sel.k === 'face') return <FaceCard plan={plan} decor={decor} face={sel.face} />
  const f = findItem(decor, sel.id)
  if (!f) return <Overview plan={plan} base={dp.base} decor={decor} issues={issues} />
  if (issues?.orphans.some(i => i.id === sel.id)) return <OrphanCard plan={plan} base={dp.base} decor={decor} id={sel.id} issues={issues} />
  if (f.k === 'furniture') return <FurnitureCard plan={plan} decor={decor} f={f.it as Furniture} />
  if (f.k === 'cabinet') return <CabinetCard plan={plan} base={dp.base} decor={decor} c={f.it as Cabinet} issues={issues} cell={sel.k === 'cell' ? sel : null} />
  if (f.k === 'panel') return <PanelCard plan={plan} decor={decor} p={f.it as Panel} />
  return <RecessCard plan={plan} base={dp.base} decor={decor} r={f.it as Recess} issues={issues} />
}

/* ───────── 材料板：地面打底 62%，墙漆、木、石叠在右边，布是圆角胶囊，金属一个小圆片 ───────── */
export function Board({ st, decor, w = 152, h = 92 }: { st: StylePreset; decor?: Decor; w?: number; h?: number }) {
  const ids = st.board ?? []
  const m = (i: number) => matOf(decor, ids[i])
  const s = w / 152
  const sh = 'drop-shadow(0 1.5px 2px rgb(96 70 40 / 0.18))'
  const piece = (x: number, y: number, ww: number, hh: number, r: number, mm: Material, key: string) => (
    <g key={key} style={{ filter: sh }}><rect x={x * s} y={y * s} width={ww * s} height={hh * s} rx={r * s} fill={mm.color} />
      {mm.texture?.kind === 'planks' && <path d={`M${x * s} ${(y + hh / 3) * s}H${(x + ww) * s}M${x * s} ${(y + 2 * hh / 3) * s}H${(x + ww) * s}M${(x + ww * 0.4) * s} ${y * s}V${(y + hh / 3) * s}M${(x + ww * 0.7) * s} ${(y + hh / 3) * s}V${(y + 2 * hh / 3) * s}`} stroke="#000" strokeOpacity={0.08} strokeWidth={0.8} />}
      {mm.texture?.kind === 'tiles' && <path d={`M${(x + ww / 2) * s} ${y * s}V${(y + hh) * s}M${x * s} ${(y + hh / 2) * s}H${(x + ww) * s}`} stroke="#fff" strokeOpacity={0.6} strokeWidth={1} />}
      {mm.texture?.kind === 'herringbone' && <path d={`M${x * s} ${(y + 20) * s}L${(x + 20) * s} ${y * s}M${x * s} ${(y + 50) * s}L${(x + 50) * s} ${y * s}M${(x + 20) * s} ${(y + hh) * s}L${(x + ww) * s} ${(y + 20) * s}`} stroke="#000" strokeOpacity={0.1} strokeWidth={0.8} />}
      {mm.texture?.kind === 'veins' && <path d={`M${(x + 4) * s} ${(y + hh * 0.7) * s}Q${(x + ww / 2) * s} ${(y + hh * 0.3) * s} ${(x + ww) * s} ${(y + hh * 0.5) * s}`} stroke="#000" strokeOpacity={0.08} strokeWidth={0.9} fill="none" />}
    </g>
  )
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block shrink-0 overflow-visible">
      <rect width={w} height={h} rx={14 * s} fill="#f4f1ec" />
      <clipPath id={`cl${st.id}${w}`}><rect width={w} height={h} rx={14 * s} /></clipPath>
      <g clipPath={`url(#cl${st.id}${w})`}>
        {piece(0, 0, 94, 92, 0, m(0), 'f')}
        {piece(82, 6, 70, 52, 9, m(1), 'w')}
        {piece(70, 50, 52, 46, 8, m(2), 'a')}
        {piece(112, 48, 46, 50, 8, m(3), 's')}
        {piece(10, 58, 50, 24, 12, m(4), 'c')}
        <g style={{ filter: sh }}><circle cx={44 * s} cy={22 * s} r={9 * s} fill={m(5).color} /></g>
      </g>
    </svg>
  )
}

/* ───────── 风格卡（样张 02） ───────── */
function StyleCard() {
  const dp = useDecorPlan()
  const decor = dp?.decor
  const preview = useDecor(s => s.preview), keep = useDecor(s => s.keepOverrides)
  const [picked, setPicked] = useState<string | null>(null)
  const styles = allStyles(decor)
  const target = picked ?? preview ?? decor?.style ?? 'cream'
  const overrides = decor?.surfaces.filter(s => s.by === 'user') ?? []
  const names = overrides.map(s => 'face' in s.target ? (decor && faceNick(decor, s.target.face)) ?? faceLabel(dp!.plan, s.target.face).room + '墙' : 'floor' in s.target ? dp!.plan.rooms.find(r => r.id === (s.target as { floor: string }).floor)?.name + '地面' : '').filter(Boolean)
  const panelsOwn = decor?.panels.length ?? 0
  const D = useDecor.getState()
  return (
    <>
      <Header icon={<Palette size={18} strokeWidth={2.2} />} iconCls="bg-ink-900 text-white" title="整体风格" sub="悬停看效果，点一下选中，再按应用" onClose={() => { D.set({ styleCard: false, preview: null }) }} />
      <div className="grid grid-cols-2 gap-2" onMouseLeave={() => D.set({ preview: picked })}>
        {styles.map(st => {
          const cur = decor?.style === st.id, on = target === st.id && (picked === st.id || preview === st.id) && !cur
          return (
            <button key={st.id} data-testid={`style-${st.id}`} onMouseEnter={() => D.set({ preview: st.id === decor?.style ? null : st.id })}
              onClick={() => { setPicked(st.id); D.set({ preview: st.id === decor?.style ? null : st.id }) }} onDoubleClick={() => applyStyle(st.id, keep)}
              className={cn('tile flex flex-col gap-1.5 rounded-[20px] p-1.5 pb-2.5 text-left transition', on && 'bg-white/85 ring-2 ring-inset ring-mint-400 shadow-[0_14px_28px_-16px_rgb(48_44_104/0.45)]')}>
              <Board st={st} decor={decor} w={152} h={84} />
              <div className="flex items-center justify-between gap-1 px-1.5">
                <span className="text-[15px] font-semibold text-ink-900">{st.name}</span>
                {cur && <Tag tone="ink">当前</Tag>}
                {on && <Tag tone="mint">预览中</Tag>}
                {st.by === 'agent' && <Tag tone="lav">Agent 配的</Tag>}
              </div>
              <span className="truncate px-1.5 text-[11px] font-medium text-ink-500">{st.blurb}</span>
            </button>
          )
        })}
      </div>
      <button onClick={() => openAgentWith('按我说的感觉配一套装修风格：')} className="tile flex items-center gap-3 rounded-[18px] p-3 text-left">
        <span className="grid size-9 place-items-center rounded-full bg-lav-200 text-lav-800"><Sparkles size={15} strokeWidth={2.4} /></span>
        <span className="min-w-0 flex-1"><span className="block text-[13.5px] font-semibold text-ink-900">说一句想要的感觉，让 Agent 配一套</span><span className="block truncate text-[11.5px] text-ink-500">「暖一点，别太素，猫会抓沙发」</span></span>
        <ChevronRight size={16} className="text-ink-400" />
      </button>
      {/* 「保留…」和「应用」吸底（D4 样张差距：跟着卡片一起滚走了） */}
      <div className="sticky -bottom-5 z-10 -mx-4 -mb-5 mt-auto flex flex-col gap-2.5 rounded-b-[30px] bg-[linear-gradient(to_top,rgb(251_251_253/0.97)_70%,rgb(251_251_253/0))] px-4 pb-5 pt-5" data-testid="style-footer">
        {decor && (overrides.length + panelsOwn) > 0 && (
          <label className="flex items-center justify-between gap-3 px-1 text-[12px] font-semibold text-ink-600">
            <span className="min-w-0 truncate">保留我单独改过的 {overrides.length + panelsOwn} 处（{[...(decor.panels.map(p => (p.name ?? '造型').replace('背景墙', '墙'))), ...names].slice(0, 3).join('、')}）</span>
            <Switch on={keep} onChange={v => D.set({ keepOverrides: v })} label="保留单独改过的" />
          </label>
        )}
        <KPill tone="ink" size="lg" data-testid="style-apply" disabled={!!decor && target === decor.style} onClick={() => { applyStyle(target, keep); setPicked(null) }}>
          {decor && target === decor.style ? `正在用「${styleOf(target, decor).name}」` : `应用「${styleOf(target, decor).name}」`}<span className="num rounded-[6px] bg-white/14 px-1.5 py-0.5 text-[10.5px] text-white/70">↵</span>
        </KPill>
      </div>
    </>
  )
}

/* ───────── 这套房的装修（样张 01） ───────── */
function Overview({ plan, base, decor, issues }: { plan: Plan; base: Plan; decor: Decor; issues: DecorIssues | null }) {
  const st = styleOf(decor.style, decor)
  const D = useDecor.getState()
  const n = decor.furniture.length + decor.cabinets.length + decor.panels.length + decor.recesses.length + decor.surfaces.length
  const orphans = [...new Set(issues?.orphans.map(i => i.id) ?? [])]
  const prot = [...new Set(issues?.protected.map(i => i.id) ?? [])]
  const uses = materialUses(plan, decor).filter(u => u.area > 0.05 || u.overridden || u.where.length || u.count)
  const kindOf = (id: string) => (findItem(decor, id)?.k ?? 'cabinet') as 'cabinet'
  // Agent 待确认的结构提议（D6 B5）：装修按现在（已确认）的结构算；点了切到改造态并选中那条提议
  const pending = base.changes.filter(c => c.status === 'pending')
  const goProposal = () => {
    const c = pending[0]
    if (!c) return
    const d = c.data as { id?: string; wall?: string } | undefined
    const ref = c.type === 'opening' && c.op === 'add' && d?.wall ? { type: 'wall' as const, id: d.wall } : c.target ? { type: c.type, id: c.target } : d?.id ? { type: c.type, id: d.id } : null
    const st0 = useStore.getState()
    st0.setMode('renovation')
    if (ref) st0.select(ref)
  }
  // 卡片总高不超过下一步条（设计规范 §7）：材料默认只列前几行，其余收进「还有 N 种」
  const [allMats, setAllMats] = useState(false)
  // 「要你看一下」每多一行，材料少列一行，卡片总高不变（不压到下一步条）
  const matRows = Math.max(2, MAT_ROWS - Math.max(0, orphans.length + prot.length + (pending.length ? 1 : 0) - 2))
  return (
    <>
      <Header icon={<Sofa size={18} strokeWidth={2.2} />} iconCls="bg-ink-900 text-white" title={<>这套房的装修 <span className="num font-normal text-ink-400">{n}</span></>} sub="风格给默认，单独改过的会标出来" onClose={() => useStore.getState().setMode('renovation')} />
      <div className="tile flex items-center gap-3 rounded-[20px] p-2.5 pr-3">
        <Board st={st} decor={decor} w={92} h={60} />
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] font-semibold text-ink-500">整体风格</div>
          <div className="text-[16px] font-semibold text-ink-900">{st.name}</div>
          <div className="truncate text-[11.5px] text-ink-500">{st.blurb}</div>
        </div>
        <KPill tone="tile" size="sm" data-testid="change-style" onClick={() => D.set({ styleCard: true })}>换风格<ChevronRight size={14} /></KPill>
      </div>
      {(orphans.length + prot.length + (pending.length ? 1 : 0)) > 0 && (
        <div>
          <div className="flex items-center justify-between px-0.5 pb-2"><span className="text-[12px] font-semibold text-ink-500">要你看一下</span><span className="num text-[12px] text-ink-400">{orphans.length + prot.length + (pending.length ? 1 : 0)}</span></div>
          <div className="flex flex-col gap-1.5">
            {pending.length > 0 && <Row testId="look-proposals" disc={<span className="grid size-10 place-items-center rounded-full bg-lav-200 text-lav-800"><Sparkles size={16} strokeWidth={2.3} /></span>}
              title={`有 ${pending.length} 条结构提议还没确认，装修按现在的结构算`} sub="点一下去改造里看这条提议" onClick={goProposal} />}
            {orphans.map(id => {
              const it = findItem(decor, id)!, face = 'place' in it.it && 'face' in it.it.place ? it.it.place.face : null
              const w = face ? base.walls.find(x => x.id === face.wall) : undefined
              return <Row key={id} testId={`look-${id}`} disc={<span className="grid size-10 place-items-center rounded-full bg-lemon-200 text-ink-900"><Unlink size={16} strokeWidth={2.3} /></span>}
                title={`${w?.name ?? '那面墙'}拆掉了，墙上的${it.it.name ?? '装修'}没地方挂`} sub="改造里拆的 · 挪到别的墙，或者删掉" onClick={() => D.select({ k: kindOf(id), id })} />
            })}
            {prot.map(id => {
              const it = findItem(decor, id)!
              const f = 'place' in it.it && 'face' in it.it.place ? it.it.place.face : 'host' in it.it && 'face' in it.it.host ? it.it.host.face : null
              const w = f ? plan.walls.find(x => x.id === f.wall) : undefined
              const depth = 'embed' in it.it ? it.it.embed : 'depth' in it.it ? it.it.depth : ''
              return <Row key={id} testId={`look-${id}`} disc={<span className="grid size-10 place-items-center rounded-full bg-ink-900 text-white"><Lock size={15} strokeWidth={2.4} /></span>}
                title={`${it.it.name ?? '嵌入'}挖进${f ? faceLabel(plan, f).dir : ''}${w ? WALL_ZH[w.kind] : '墙'} ${depth} mm`} sub={`${w ? WALL_ZH[w.kind] : ''}，能不能挖要专业人员现场确认`}
                onClick={() => { if (w && 'place' in it.it && 'face' in it.it.place) openElevAt(it.it.place.face, { item: id }); D.select({ k: it.k as 'cabinet', id }) }} />
            })}
          </div>
        </div>
      )}
      <div>
        <div className="flex items-center justify-between px-0.5 pb-2"><span className="text-[12px] font-semibold text-ink-500">用到的材料</span><span className="num text-[12px] text-ink-400">{uses.length}</span></div>
        <div className="flex flex-col gap-1.5" data-testid="material-uses">
          {(allMats ? uses : uses.slice(0, matRows)).map(u => (
            <div key={u.m.id} className="tile flex items-center gap-3 rounded-[16px] p-2 pr-3">
              <Swatch m={u.m} size={30} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold text-ink-900">{u.m.name}</div>
                <div className="truncate text-[11.5px] text-ink-500">{u.m.texture?.size ? `${u.m.texture.size[0]} × ${u.m.texture.size[1]} · ` : ''}{u.count ? `${u.count} 组柜子` : u.where.join('、')}</div>
              </div>
              {u.overridden ? <Tag tone="outline">单独改</Tag> : u.area > 0.05 ? <span className="num text-[13px] font-semibold text-ink-700">{u.area.toFixed(1)}㎡</span> : null}
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between px-1 pt-2 text-[11px] text-ink-400">
          <span>面积约数 · 粗估，只用来对量级</span>
          {uses.length > matRows && <button data-testid="material-more" onClick={() => setAllMats(v => !v)} className="font-semibold text-ink-600 hover:text-ink-900">{allMats ? '收起' : `还有 ${uses.length - matRows} 种 ›`}</button>}
        </div>
      </div>
    </>
  )
}
function Row({ disc, title, sub, onClick, testId }: { disc: ReactNode; title: string; sub: string; onClick(): void; testId?: string }) {
  return (
    <button onClick={onClick} data-testid={testId} className="tile flex items-center gap-3 rounded-[18px] p-2.5 pr-2 text-left">
      {disc}
      <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold leading-snug text-ink-900">{title}</span><span className="block truncate text-[11.5px] text-ink-500">{sub}</span></span>
      <ChevronRight size={16} className="shrink-0 text-ink-300" />
    </button>
  )
}
export function Swatch({ m, size = 28, ring }: { m: Material; size?: number; ring?: boolean }) {
  return (
    <span className={cn('relative block shrink-0 overflow-hidden rounded-[30%] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06),0_1px_2px_rgb(96_70_40/0.18)]', ring && 'ring-2 ring-mint-400 ring-offset-2 ring-offset-white')} style={{ width: size, height: size, background: m.color }}>
      {m.texture?.kind === 'planks' && <span className="absolute inset-0" style={{ backgroundImage: 'repeating-linear-gradient(0deg, transparent 0 32%, rgb(0 0 0 / 0.07) 32% 34%)' }} />}
      {m.texture?.kind === 'tiles' && <span className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(90deg, transparent 48%, rgb(255 255 255 / .6) 48% 52%, transparent 52%), linear-gradient(0deg, transparent 48%, rgb(255 255 255 / .6) 48% 52%, transparent 52%)' }} />}
      {(m.texture?.kind === 'speckle' || m.texture?.kind === 'veins') && <span className="absolute inset-0" style={{ background: 'radial-gradient(60% 40% at 40% 35%, rgb(255 255 255 / .35), transparent 70%)' }} />}
    </span>
  )
}

/* ───────── 材料选择：分类胶囊 + 色块网格 + 自定义 ───────── */
const FACE_CATS: [string, MaterialCategory[]][] = [['乳胶漆', ['paint']], ['艺术涂料', ['texture-paint', 'microcement']], ['墙纸', ['wallpaper']], ['木饰面', ['veneer']], ['瓷砖', ['tile', 'stone']]]
const FLOOR_CATS: [string, MaterialCategory[]][] = [['木地板', ['wood-floor']], ['瓷砖', ['tile']], ['微水泥', ['microcement']], ['石材', ['stone']]]
const FRONT_CATS: [string, MaterialCategory[]][] = [['柜门', ['laminate']], ['木饰面', ['veneer']], ['乳胶漆', ['paint']], ['石材', ['stone']]]
function MaterialPicker({ decor, cats, value, onPick, testId }: { decor: Decor; cats: [string, MaterialCategory[]][]; value: string; onPick(id: string): void; testId?: string }) {
  const cur = matOf(decor, value)
  const [cat, setCat] = useState(() => Math.max(0, cats.findIndex(c => c[1].includes(cur.category))))
  const list = decor.materials.filter(m => cats[cat][1].includes(m.category))
  const custom = () => {
    const inp = document.createElement('input')
    inp.type = 'color'; inp.value = cur.color
    inp.onchange = () => {
      const id = `custom-${inp.value.slice(1)}`
      commitDecor(d => { if (!d.materials.some(m => m.id === id)) d.materials.push({ id, name: `自定义 ${inp.value}`, category: cats[cat][1][0], color: inp.value }) })
      onPick(id)
    }
    inp.click()
  }
  return (
    <div className="flex flex-col gap-2.5" data-testid={testId}>
      <div className="flex flex-wrap gap-1.5">
        {cats.map(([l], i) => <button key={l} data-testid={`mcat-${l}`} onClick={() => setCat(i)} className={cn('h-7 rounded-full px-3 text-[12px] font-semibold transition', i === cat ? 'bg-ink-900 text-white' : 'tile text-ink-500 hover:text-ink-800')}>{l}</button>)}
      </div>
      <div className="tile grid grid-cols-5 gap-x-1 gap-y-2 rounded-[18px] px-2 pb-2 pt-2.5">
        {list.map(m => (
          <button key={m.id} data-testid={`mat-${m.id}`} onClick={() => onPick(m.id)} className="flex flex-col items-center gap-1.5">
            <span className={cn('rounded-[13px] p-[2px]', m.id === value && 'shadow-[0_0_0_2px_var(--color-mint-400)]')}><Swatch m={m} size={38} /></span>
            <span className={cn('w-full truncate text-center text-[10.5px] font-semibold', m.id === value ? 'text-mint-900' : 'text-ink-500')}>{m.name.replace('乳胶漆', '').replace('肌理', '').replace('地板', '')}</span>
          </button>
        ))}
        <button onClick={custom} className="flex flex-col items-center gap-1.5">
          <span className="grid size-[42px] place-items-center rounded-[13px] text-ink-400 shadow-[inset_0_0_0_1.2px_var(--color-ink-200)]"><Plus size={18} strokeWidth={2.2} /></span>
          <span className="text-[10.5px] font-semibold text-ink-500">自定义</span>
        </button>
      </div>
    </div>
  )
}
function MatRow({ m, note, right }: { m: Material; note: string; right?: ReactNode }) {
  return (
    <div className="tile flex items-center gap-3 rounded-[18px] p-2.5 pr-2">
      <Swatch m={m} size={34} />
      <div className="min-w-0 flex-1"><div className="truncate text-[14px] font-semibold text-ink-900">{m.name}</div><div className="truncate text-[11.5px] text-ink-500">{note}</div></div>
      {right}
    </div>
  )
}

/* ───────── 地面检查器 ───────── */
function FloorCard({ plan, decor, id }: { plan: Plan; decor: Decor; id: string }) {
  const r = plan.rooms.find(x => x.id === id)
  if (!r) return null
  const f = floorFinish(plan, decor, r)
  const area = polygonArea(r.poly) / 1e6
  return (
    <>
      <Header icon={<PaintRoller size={18} strokeWidth={2.2} />} iconCls={SAND} title={`${r.name} · 地面`} sub={<span className="num">约 {area.toFixed(1)} ㎡ · 粗估</span>} onClose={close} />
      <MatRow m={f.material} note={f.overridden ? `单独改过 · 风格默认是${f.styleMaterial.name}` : '跟风格'} right={f.overridden ? <KPill tone="plain" size="sm" onClick={() => resetFloor(id)}>回到默认</KPill> : undefined} />
      <MaterialPicker decor={decor} cats={FLOOR_CATS} value={f.material.id} onPick={m => paintFloor(id, m)} testId="floor-picker" />
      <p className="px-1 text-[11.5px] leading-relaxed text-ink-400">不同地面材料相接的门洞，以后会自动铺门槛石（风格的「门槛石」角色）。</p>
    </>
  )
}

/* ───────── 墙面检查器（样张 05） ───────── */
function FaceCard({ plan, decor, face }: { plan: Plan; decor: Decor; face: FaceRef }) {
  const w = plan.walls.find(x => x.id === face.wall)
  const scope = useDecor(s => s.paintScope)
  const [h, setH] = useState(1.2)
  const [span, setSpan] = useState<[number, number] | null>(null)
  const base = useStore(s => s.base)!
  const m = useMemo(() => elevationModel(plan, base, decor, face), [plan, base, decor, face.wall, face.side])
  // 一面墙跨两间房时（D6 A3）：卡片按「从哪间房看」写——立面里看的是哪段就写哪间，平面上点在哪段就写哪间
  const dCanvas = useDecor(s => s.canvas), dSel = useDecor(s => s.sel)
  const roomId = dCanvas.k === 'elev' && dCanvas.face.wall === face.wall && dCanvas.face.side === face.side ? dCanvas.room
    : dSel?.k === 'face' && dSel.s != null ? elevRoomAt(plan, face, { s: dSel.s }) : undefined
  if (!w) return null
  const lbl0 = faceLabel(plan, face), other: FaceRef = { wall: face.wall, side: (-face.side) as 1 | -1 }
  const room = (roomId && plan.rooms.find(r => r.id === roomId)) || faceRoom(plan, face)
  const lbl = { ...lbl0, room: room?.name ?? lbl0.room }
  const otherRoom = faceRoom(plan, other), fin = faceFinish(plan, decor, face), ofin = faceFinish(plan, decor, other)
  let ext: [number, number] = [0, 0]
  try { ext = faceExtent(plan, face) } catch { /* */ }
  const H = effectiveWallHeight(plan, w), L = ext[1] - ext[0]
  const segs = m && room ? m.segments.filter(x => x.room.id === room.id) : []
  const segL = segs.length && new Set(m!.segments.map(x => x.room.id)).size > 1 ? Math.max(...segs.map(x => x.u[1])) - Math.min(...segs.map(x => x.u[0])) : L
  const holes = plan.openings.filter(o => o.wall === w.id).reduce((a, o) => a + o.width / 1000 * (Math.min(o.head, H) - o.sill), 0)
  const area = Math.max(0, L / 1000 * H - holes)
  const pick = (id: string) => scope === 'whole' ? paintFace(face, id) : scope === 'height' ? paintFace(face, id, { z: [0, h] }) : paintFace(face, id, { s: span ?? [ext[0], (ext[0] + ext[1]) / 2] })
  const D = useDecor.getState()
  return (
    <>
      <Header icon={<PaintRoller size={18} strokeWidth={2.2} />} iconCls={SAND} title={room ? `${lbl.room} · ${faceNick(decor, face, plan, room.id) ?? lbl.dir + '墙'}面` : `${w.name ?? w.id} · 室外那一面`} sub={`${w.name ?? w.id}朝${room ? lbl.room : '室外'}的一面${otherRoom ? ` · 另一面在${otherRoom.name}` : ''}`} onClose={close} />
      {m && <Visual label="立面"><div className="absolute right-3 top-2 text-[10.5px] font-semibold text-ink-400">{lbl.look}</div><MiniElev plan={plan} decor={decor} face={face} room={room?.id} /><div className="num pb-1 text-center text-[11px] font-medium text-ink-500">{(segL / 1000).toFixed(2)} × {H.toFixed(2)} m{holes > 0 ? ' · 门洞扣掉' : ''}</div></Visual>}
      <MatRow m={fin.material} note={fin.overridden ? `单独改过 · 风格默认是${fin.styleMaterial.name.replace('乳胶漆', '')}` : '跟风格'} right={fin.overridden ? <KPill tone="plain" size="sm" onClick={() => resetFace(face)} data-testid="face-reset">回到默认</KPill> : undefined} />
      <MaterialPicker decor={decor} cats={FACE_CATS} value={fin.material.id} onPick={pick} testId="face-picker" />
      <div>
        <div className="flex items-center justify-between px-1 pb-2"><span className="text-[12px] font-semibold text-ink-500">刷到哪</span><span className="num text-[11.5px] text-ink-500">约 {area.toFixed(1)} ㎡{holes > 0 ? ' · 已扣门洞' : ''}</span></div>
        <MiniSeg value={scope} options={[{ v: 'whole', l: '整面' }, { v: 'span', l: '选一段' }, { v: 'height', l: '到某个高度' }]} onChange={v => D.set({ paintScope: v })} />
        {scope === 'height' && <div className="mt-2"><Num label="刷到离地" value={h} unit="m" step={0.05} min={0.1} max={H} digits={2} onChange={setH} /></div>}
        {scope === 'span' && <div className="mt-2 grid grid-cols-2 gap-2"><Num label="从（沿墙）" value={span?.[0] ?? ext[0]} unit="mm" step={50} min={ext[0]} max={ext[1]} onChange={v => setSpan([v, span?.[1] ?? (ext[0] + ext[1]) / 2])} /><Num label="到" value={span?.[1] ?? (ext[0] + ext[1]) / 2} unit="mm" step={50} min={ext[0]} max={ext[1]} onChange={v => setSpan([span?.[0] ?? ext[0], v])} /></div>}
      </div>
      {otherRoom && (
        <div className="tile flex items-center gap-3 rounded-[18px] p-2.5 pr-2">
          <Swatch m={ofin.material} size={30} />
          <div className="min-w-0 flex-1"><div className="text-[13px] font-semibold text-ink-900">另一面 · {otherRoom.name}一侧</div><div className="truncate text-[11.5px] text-ink-500">{ofin.material.name} · {ofin.overridden ? '单独改过' : '跟风格'}</div></div>
          <KPill tone="plain" size="sm" onClick={() => D.select({ k: 'face', face: other })}>切过去<ChevronRight size={14} /></KPill>
        </div>
      )}
      <div className="sticky -bottom-5 z-10 -mx-4 -mb-5 mt-auto flex items-center gap-2 rounded-b-[30px] bg-[linear-gradient(to_top,rgb(251_251_253/0.96)_58%,rgb(251_251_253/0))] px-4 pb-5 pt-4">
        <KPill tone="tile" size="lg" className="flex-1" data-testid="open-elevation" onClick={() => { const ds = useDecor.getState().sel; openElevAt(face, { s: ds?.k === 'face' ? ds.s : undefined }) }}><ScanEye size={17} />进立面做造型</KPill>
        <Tip label="交给 Agent" kbd="A" side="top"><RoundButton size="lg" tone="ink" onClick={() => openAgentWith(`${lbl.title}（墙 ${w.id}，FaceRef {"wall":"${w.id}","side":${face.side}}）：`, fin.surface ? [fin.surface.id] : [])} aria-label="交给 Agent"><Sparkles size={18} className="text-lav-300" /></RoundButton></Tip>
      </div>
    </>
  )
}
/** 墙面的俗名：床靠着 = 床头墙，有电视造型 = 电视墙 */
function faceNick(decor: Decor, face: FaceRef, plan?: Plan, roomId?: string) {
  const on = (f?: FaceRef) => !!f && f.wall === face.wall && f.side === face.side
  // 一面墙跨两间房：床、电视墙要在这间房那一段上才叫「床头墙 / 电视墙」
  const here = (id: string) => !plan || !roomId || (itemRoom(plan, decor, id) ?? roomId) === roomId
  if (decor.furniture.some(f => f.type.startsWith('bed') && on(f.against?.face) && here(f.id))) return '床头墙'
  if (decor.panels.some(p => on(p.span?.face) && here(p.id) && decor.recesses.some(r => 'panel' in r.host && r.host.panel === p.id))) return '电视墙'
  return null
}
/** 小立面：真比例，两端剖到的墙按类型着色，门洞扣掉，靠墙的家具淡显帮你认墙 */
function MiniElev({ plan, decor, face, cabEdit, room }: { plan: Plan; decor: Decor; face: FaceRef; cabEdit?: string; room?: string }) {
  const base = useStore(s => s.base)!
  const m = useMemo(() => elevationModel(plan, base, decor, face), [plan, base, decor, face.wall, face.side])
  if (!m) return null
  const W = 316, Hh = 112
  // 墙面跨几间房时只画这间房那一段（D6 A3）
  const seg = room && new Set(m.segments.map(x => x.room.id)).size > 1 ? m.segments.filter(x => x.room.id === room) : []
  const U: [number, number] = seg.length ? [Math.min(...seg.map(x => x.u[0])), Math.max(...seg.map(x => x.u[1]))] : m.u
  const wMm = U[1] - U[0] + 600, hMm = m.H * 1000 + 300
  const k = Math.min((W - 30) / wMm, (Hh - 10) / hMm)
  const F = { k, tx: W / 2 - (U[0] + U[1]) / 2 * k, ty: Hh / 2 + m.H * 1000 / 2 * k }
  const w = m.ax.wall, d = [(w.b[0] - w.a[0]) * face.side, (w.b[1] - w.a[1]) * face.side] as Vec2
  const L0 = X0(U[0]) , R0 = X0(U[1])
  function X0(u: number) { return F.tx + u * F.k }
  return <svg width="100%" viewBox={`0 0 ${W} ${Hh}`} className="block"><ElevDefs id={`mini${face.wall}`} /><ElevDrawing id={`mini${face.wall}`} F={F} m={m} plan={plan} decor={decor} styleId={decor.style} sel={null} mini cabEdit={cabEdit} />
    <text x={L0 - 18} y={Hh / 2} fontSize={10.5} fontWeight={600} fill="#8e949d" textAnchor="middle">{dirWord(plan, [-d[0], -d[1]])}</text>
    <text x={R0 + 18} y={Hh / 2} fontSize={10.5} fontWeight={600} fill="#8e949d" textAnchor="middle">{dirWord(plan, d)}</text></svg>
}

/* ───────── 家具库 ───────── */
function FurnitureLib({ decor }: { decor: Decor }) {
  const cat = useDecor(s => s.furnCat), placing = useDecor(s => s.placing)
  const [q, setQ] = useState('')
  const tones = furnTones(decor)
  const list = FURN_LIB.filter(e => q ? e.name.includes(q) || e.type.includes(q) : e.category === cat)
  const D = useDecor.getState()
  return (
    <>
      <Header icon={<Sofa size={18} strokeWidth={2.2} />} iconCls={SAND} title="家具库" sub="点一件，再在平面上点一下放下" onClose={() => D.setTool('select')} />
      <label className="tile-sunken flex h-9 items-center gap-2 rounded-full px-3.5"><Search size={14} className="text-ink-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="搜：沙发、冰箱…" className="min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none placeholder:text-ink-300" /></label>
      {!q && <div className="flex flex-wrap gap-1.5">{FURN_CATS.map(c => <button key={c} onClick={() => D.set({ furnCat: c })} className={cn('h-7 rounded-full px-3 text-[12px] font-semibold', c === cat ? 'bg-ink-900 text-white' : 'tile text-ink-500')}>{c}</button>)}</div>}
      <div className="grid grid-cols-3 gap-2">
        {list.map(e => (
          <button key={e.type} data-testid={`furn-${e.type}`} onClick={() => D.set({ placing: e.type, tool: 'furniture' })}
            className={cn('tile flex flex-col items-center gap-1 rounded-[16px] px-1 pb-2 pt-2 transition', placing === e.type && 'bg-white ring-2 ring-inset ring-mint-400')}>
            <span className="grid h-[52px] w-full place-items-center rounded-[11px] bg-white"><SymbolPreview e={e} tones={tones} size={70} /></span>
            <span className="text-[12px] font-semibold text-ink-900">{e.name}</span>
            <span className="num text-[10.5px] text-ink-400">{e.size[0]} × {e.size[1]}</span>
          </button>
        ))}
      </div>
      <p className="px-1 text-[11.5px] text-ink-400">常见尺寸，放下后可改</p>
    </>
  )
}

/* ───────── 家具检查器 ───────── */
function FurnitureCard({ plan, decor, f }: { plan: Plan; decor: Decor; f: Furniture }) {
  const e = FURN_LIB.find(x => x.type === f.type)
  const ag = f.against && faceLabel(plan, f.against.face)
  return (
    <>
      <Header icon={<Sofa size={18} strokeWidth={2.2} />} iconCls={SAND} title={f.name ?? e?.name ?? f.type} sub={<><span>{e?.category ?? '家具'}</span><span className="text-ink-300">·</span><span className="num">{f.id}</span></>} onClose={close} />
      <div className="flex flex-wrap gap-1.5">
        <Tag tone="outline" className="bg-sand-50 text-sand-700 ring-sand-100">{f.by === 'agent' ? 'Agent 提议' : '你加的'}</Tag>
        {ag && <Tag tone="gray">贴着{ag.room}{ag.dir}墙</Tag>}
      </div>
      {f.in && <HostRow plan={plan} decor={decor} f={f} />}
      {!f.in && f.at && (
        <div className="grid grid-cols-2 gap-2.5" data-testid="furn-xy">
          <Num label="位置 x" value={Math.round(f.at[0])} unit="mm" step={10} min={-100000} max={100000} onChange={v => patchFurniture(f.id, { at: [v, f.at![1]], against: undefined }, `fx-${f.id}`)} />
          <Num label="位置 y" value={Math.round(f.at[1])} unit="mm" step={10} min={-100000} max={100000} onChange={v => patchFurniture(f.id, { at: [f.at![0], v], against: undefined }, `fy-${f.id}`)} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        <Num label="宽" value={f.size[0]} unit="mm" step={10} min={100} max={6000} onChange={v => patchFurniture(f.id, { size: [v, f.size[1]] }, `fw-${f.id}`)} testId="furn-w" />
        <Num label="深" value={f.size[1]} unit="mm" step={10} min={20} max={6000} onChange={v => patchFurniture(f.id, { size: [f.size[0], v] }, `fd-${f.id}`)} />
        <Num label="高" value={f.height} unit="m" step={0.01} min={0.01} max={3} digits={2} onChange={v => patchFurniture(f.id, { height: v }, `fh-${f.id}`)} />
        {!f.in && <Num label="转角" value={f.rot ?? 0} unit="°" step={15} min={-360} max={360} onChange={v => patchFurniture(f.id, { rot: v, against: undefined }, `fr-${f.id}`)} />}
      </div>
      <p className="px-1 text-[11.5px] leading-relaxed text-ink-400">{e ? `常见尺寸 ${e.size[0]} × ${e.size[1]}，可以改成你家的实际尺寸。` : '不认识的家具画成通用盒子。'}拖的时候会显示到墙和别的家具的净距。</p>
      <Actions onAgent={() => openAgentDecor([f.id])} onRemove={() => removeItem(f.id)} extra={<Tip label="转 90°" kbd="R" side="top"><RoundButton tone="tile" size="md" onClick={() => rotateFurniture(f.id)} aria-label="转 90°"><RotateCw size={16} /></RoundButton></Tip>} />
    </>
  )
}

/** 放在宿主里的家电：不给 x / y（位置只跟宿主走），说清「在哪里」+「拿出来」 */
function HostRow({ plan, decor, f }: { plan: Plan; decor: Decor; f: Furniture }) {
  const ref = f.in!
  const cell = /^(.*):cell:(\d+):(\d+)$/.exec(ref)
  const host = findItem(decor, cell ? cell[1] : ref)
  const hostName = host ? `${host.it.name ?? ({ cabinet: '柜子', panel: '造型', recess: '洞', furniture: '家具' } as const)[host.k]}${cell ? ` 第 ${+cell[2] + 1} 列` : ''}` : '原来的位置'
  const parent = host?.k === 'recess' && 'panel' in (host.it as Recess).host ? decor.panels.find(p => p.id === ((host.it as Recess).host as { panel: string }).panel) : undefined
  let missing = !host
  try { missing ||= furniturePose(plan, f).missing } catch { missing = true }
  return (
    <div className="tile flex items-center gap-3 rounded-[18px] p-2.5 pr-2" data-testid="furn-host">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sand-100 text-sand-700"><Inbox size={15} strokeWidth={2.3} /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-semibold text-ink-900">在{hostName}里</div>
        <div className="truncate text-[11.5px] text-ink-500">{missing ? '宿主不在了，画在最后的位置' : `位置跟着${parent?.name ?? hostName}走，挪宿主它就跟着挪`}</div>
      </div>
      <KPill tone="plain" size="sm" data-testid="furn-takeout" onClick={() => takeOutFurniture(f.id)}>拿出来</KPill>
    </div>
  )
}

/* ───────── 事实卡（受保护墙上的嵌入，只陈述客观事实，不拦） ───────── */
function FactCard({ plan, base, decor, id, wallId, issues }: { plan: Plan; base: Plan; decor: Decor; id: string; wallId: string; issues: DecorIssues | null }) {
  const it = findItem(decor, id)
  const fact = issues?.byId.get(id)?.find(i => i.code === 'protected')
  if (!it || !fact) return null
  const w = plan.walls.find(x => x.id === wallId) ?? base.walls.find(x => x.id === wallId)
  const cert = w?.evidence?.certainty ?? 'unknown'
  const label = w ? WALL_ZH[w.kind] : '受保护的墙'
  const head = cert === 'seen' ? `这面在方案里是${label}（读图看到）` : cert === 'inferred' ? `读图推断是${label}，没确认` : `这面在方案里标为${label}（读图把握程度未知）`
  const acked = !!it.it.ack
  if (acked) return (
    <div className="tile flex items-center gap-2.5 rounded-[16px] px-3 py-2" data-testid="fact-card-acked">
      <span className="grid size-6 place-items-center rounded-full bg-ink-900 text-white"><Lock size={11} strokeWidth={2.8} /></span>
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink-800">{head} · 要专业确认</span>
      <Check size={14} className="text-mint-700" />
    </div>
  )
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="tile rounded-[20px] p-3.5" data-testid="fact-card">
      <div className="flex gap-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink-900 text-white"><Lock size={13} strokeWidth={2.6} /></span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold leading-snug text-ink-900">{head}</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600">在{label}上挖槽、嵌入能不能做、能挖多深，要专业人员到现场确认。这里只画效果，会记进改造清单的「需要专业确认」。</p>
          {cert !== 'seen' && <button className="mt-1 text-[12px] font-semibold text-lemon-800 underline decoration-dotted" onClick={() => { const s = useStore.getState(); s.setMode('original'); s.select({ type: 'wall', id: wallId }) }}>去核对这面墙</button>}
          <div className="mt-2.5 flex items-center gap-2"><KPill tone="tile" size="sm" data-testid="fact-ack" onClick={() => ackItem(id)}>知道了</KPill><span className="text-[11.5px] text-ink-400">不影响继续画</span></div>
        </div>
      </div>
    </motion.div>
  )
}

/** 挖到墙厚：就在输入框下面说清楚（数据没改，保留上一次的值）+「去改造开洞」（沿用改造态门窗工具的跳转） */
function ThroughHint({ id }: { id: string }) {
  const hint = useDecor(s => s.throughHint)
  if (!hint || hint.id !== id) return null
  return (
    <motion.div initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} className="rounded-[16px] bg-lemon-50 px-3 py-2.5 ring-1 ring-inset ring-lemon-200" data-testid="through-hint" data-tried={hint.tried}>
      <div className="text-[13px] font-semibold leading-snug text-lemon-800">{hint.other ?? `挖到 ${hint.thickness} 就穿了，那是开洞，属于结构改造`}</div>
      <div className="mt-0.5 text-[11.5px] text-ink-500"><span className="num">输了 {hint.tried}</span>，数据没改，还是上一次的值</div>
      {!hint.other && <KPill tone="ink" size="sm" className="mt-2" onClick={() => goAddOpening(hint)} data-testid="go-opening">去改造开洞<ArrowRight size={14} /></KPill>}
    </motion.div>
  )
}

/* ───────── 俯视局部：墙厚 / 挖进 / 剩 / 柜深，横竖同一比例尺（讲清「挖一部分但不挖透」） ───────── */
export function TopView({ t, depth, deep, width, kind, through }: { t: number; depth: number; deep: number; width: number; kind: string; through?: boolean }) {
  const W = 316, Hh = 132, bandX = 56
  const k = Math.min(140 / Math.max(width, 300), 92 / (t + Math.max(deep - depth, 0) + 30))
  const cx = 196, wy = 18
  const wallFill = kind === 'bearing' ? '#1f232a' : kind === 'exterior' ? '#3c424b' : '#adb3bc'
  const x0 = cx - width / 2 * k, x1 = cx + width / 2 * k
  const faceY = wy + t * k, backY = faceY - depth * k, frontY = backY + deep * k
  const left = through ? 0 : Math.max(0, t - depth)
  const pill = (x: number, y: number, text: string, ink = false) => { const w = textWidth(text) + 16; return <g><rect x={x - w} y={y - 9} width={w} height={18} rx={9} fill={ink ? '#16191e' : '#fff'} stroke={ink ? 'none' : 'rgb(22 27 36 / .1)'} /><text x={x - w / 2} y={y + 3.8} fontSize={11} fontWeight={650} fill={ink ? '#fff' : '#3b4048'} textAnchor="middle" className="num">{text}</text></g> }
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${Hh}`} className="block" data-testid="top-view" data-wall={t} data-depth={depth} data-left={left}>
      <rect x={bandX} y={wy} width={W - bandX - 24} height={t * k} fill={wallFill} />
      {deep > 0 && <><rect x={x0} y={backY} width={x1 - x0} height={deep * k} fill="#ebe3d5" stroke="#545a63" strokeWidth={1} /><path d={`M${x0} ${backY}L${x1} ${frontY}M${x1} ${backY}L${x0} ${frontY}`} stroke="#b3b8c0" strokeWidth={0.8} /></>}
      {deep === 0 && depth > 0 && <rect x={x0} y={backY} width={x1 - x0} height={depth * k} fill="#e2dccf" stroke="#545a63" strokeWidth={1} />}
      <path d={`M${bandX} ${faceY}H${W - 24}`} stroke="#16191e" strokeWidth={1} strokeDasharray="3 2.4" />
      <text x={8} y={wy + t * k / 2 + 4} fontSize={10.5} fontWeight={600} fill="#8e949d">{kind === 'exterior' ? '室外' : '另一侧'}</text>
      <text x={8} y={faceY + 44} fontSize={10.5} fontWeight={600} fill="#8e949d">室内</text>
      <text x={x0 - 6} y={faceY + 14} fontSize={10} fontWeight={600} fill="#6c727c" textAnchor="end">原墙面</text>
      {pill(x0 - 6, wy + Math.max(9, (t - depth) * k / 2), through ? '穿了' : `剩 ${left}`)}
      {depth > 0 && pill(x0 - 6, backY + depth * k / 2, `挖进 ${depth}`, true)}
      <g transform={`translate(${W - 10} ${wy + t * k / 2}) rotate(-90)`}><text y={4} fontSize={10.5} fontWeight={650} fill="#3b4048" textAnchor="middle" className="num">墙厚 {t}</text></g>
      {deep > 0 && deep !== depth && <g><path d={`M${x1 + 12} ${backY}V${frontY}M${x1 + 8} ${backY}H${x1 + 16}M${x1 + 8} ${frontY}H${x1 + 16}`} stroke="#8e949d" strokeWidth={1} /><g transform={`translate(${x1 + 24} ${(Math.max(faceY, backY) + frontY) / 2}) rotate(-90)`}><text y={4} fontSize={10.5} fontWeight={650} fill="#3b4048" textAnchor="middle" className="num">柜深 {deep}</text></g></g>}
      <path d={`M${x0} ${Hh - 12}H${x1}M${x0} ${Hh - 16}V${Hh - 8}M${x1} ${Hh - 16}V${Hh - 8}`} stroke="#8e949d" strokeWidth={1} />
      <rect x={cx - 26} y={Hh - 21} width={52} height={18} rx={9} fill="#fff" stroke="rgb(22 27 36 / .08)" /><text x={cx} y={Hh - 8.4} fontSize={11} fontWeight={650} fill="#3b4048" textAnchor="middle" className="num">宽 {Math.round(width)}</text>
    </svg>
  )
}
const textWidth = (s: string) => [...s].reduce((a, c) => a + (/[\u4e00-\u9fff]/.test(c) ? 11 : 6.8), 0)

/* ───────── 柜子检查器（样张 03）/ 柜体编辑（样张 04） ───────── */
const FAMILY_ZH = { tall: '高柜', base: '地柜', wall: '吊柜' }
const CELL_TYPES: [CabinetCell['type'], string][] = [['door', '单开门'], ['doors', '对开门'], ['drawers', '抽屉'], ['open', '开放格'], ['void', '挖洞'], ['appliance', '家电位']]
function CellIcon({ t }: { t: CabinetCell['type'] }) {
  const s = { stroke: 'currentColor', strokeWidth: 1.6, fill: 'none' }
  return (
    <svg width="30" height="22" viewBox="0 0 30 22">
      <rect x={8} y={2} width={14} height={18} rx={2} {...s} />
      {t === 'door' && <path d="M19 9V13" {...s} />}
      {t === 'doors' && <path d="M15 2V20M13 9V13M17 9V13" {...s} />}
      {t === 'drawers' && <path d="M8 8H22M8 14H22M13 5H17M13 11H17M13 17H17" {...s} />}
      {t === 'open' && <path d="M8 11H22" {...s} />}
      {t === 'void' && <rect x={11} y={5} width={8} height={12} rx={1} {...s} />}
      {t === 'appliance' && <circle cx={15} cy={11} r={4} {...s} />}
    </svg>
  )
}
function CabinetCard({ plan, base, decor, c, issues, cell }: { plan: Plan; base: Plan; decor: Decor; c: Cabinet; issues: DecorIssues | null; cell: { col: number; row: number } | null }) {
  const canvas = useDecor(s => s.canvas)
  const face = 'face' in c.place ? c.place.face : null
  const w = face ? plan.walls.find(x => x.id === face.wall) : undefined
  const lbl = face ? faceLabel(plan, face) : null
  const prot = !!issues?.byId.get(c.id)?.some(i => i.code === 'protected')
  const editing = canvas.k === 'cabinet' && canvas.id === c.id
  const L = layoutCabinet(c)
  const D = useDecor.getState()
  const front = matOf(decor, c.materials.front), carcass = matOf(decor, c.materials.carcass)
  const sub = <><span>{FAMILY_ZH[c.family]}</span><span className="text-ink-300">·</span><span>{c.embed ? `嵌在${lbl?.dir ?? ''}${w ? WALL_ZH[w.kind] : ''}里` : face ? `靠${lbl?.dir ?? ''}${w ? WALL_ZH[w.kind] : '墙'}` : '独立摆放'}</span>{editing && <><span className="text-ink-300">·</span><span>{L.columns.length} 列</span></>}<span className="text-ink-300">·</span><span className="num">{c.id}</span></>
  return (
    <>
      <Header icon={<Columns3 size={18} strokeWidth={2.2} />} iconCls={SAND} title={c.name ?? FAMILY_ZH[c.family]} sub={sub} onClose={() => editing ? D.openElevation(canvas.face) : close()} />
      {!editing && (
        <div className="flex flex-wrap gap-1.5">
          {prot && w && <Tag tone="ink" icon={<Lock size={10} strokeWidth={3} />}>{WALL_ZH[w.kind]}</Tag>}
          {!!c.embed && <Tag tone="gray">嵌进墙 {c.embed} mm</Tag>}
          <Tag tone="outline" className="bg-sand-50 text-sand-700">{c.by === 'agent' ? 'Agent 提议' : '你加的'}</Tag>
        </div>
      )}
      {!editing && w && <FactCard plan={plan} base={base} decor={decor} id={c.id} wallId={w.id} issues={issues} />}
      {editing ? <CabinetEditBody plan={plan} decor={decor} c={c} cell={cell} /> : (
        <>
          {w && !!c.embed && <Visual label="俯视局部"><div className="absolute right-3 top-2 text-[10.5px] font-semibold text-ink-400">挖进墙里多深</div><TopView t={w.thickness} depth={c.embed} deep={c.depth} width={c.width} kind={w.kind} /></Visual>}
          <div className="grid grid-cols-2 gap-2.5">
            <Num label="宽" value={c.width} unit="mm" step={10} min={200} max={8000} onChange={v => patchCabinet(c.id, x => { const f = v / x.width; x.columns = x.columns.map((col, i) => i === x.columns.length - 1 ? { ...col, width: undefined } : { ...col, width: Math.round((col.width ?? 0) * f) }); x.width = v }, `cw-${c.id}`)} testId="cab-width" />
            <Num label="高" value={c.z[1] - c.z[0]} unit="m" step={0.01} min={0.2} max={3.2} digits={2} onChange={v => patchCabinet(c.id, x => { x.z = [x.z[0], +(x.z[0] + v).toFixed(3)]; x.columns = x.columns.map(col => ({ ...col, cells: col.cells.map((cl, i) => i === col.cells.length - 1 ? { ...cl, h: undefined } : cl) })) }, `ch-${c.id}`)} />
            <Num label="柜深" value={c.depth} unit="mm" step={10} min={100} max={1200} onChange={v => patchCabinet(c.id, x => { x.depth = v }, `cd-${c.id}`)} testId="cab-depth" />
            <Num label="嵌进墙里" value={c.embed ?? 0} unit="mm" step={10} min={0} max={w ? w.thickness + 200 : 0} disabled={!face} onChange={v => setEmbed('cabinet', c.id, v)} testId="cab-embed" />
          </div>
          <ThroughHint id={c.id} />
          <MatRow m={front} note={c.materials.front === roleMat(styleOf(decor.style, decor), 'cabinet.front', decor).id ? '跟风格 · 柜身同色' : '单独改过'} right={face && <KPill tone="plain" size="sm" data-testid="edit-cells" onClick={() => openCabinetAt(c.id, face)}>编辑分格<ChevronRight size={14} /></KPill>} />
        </>
      )}
      {editing && (
        <div className="grid grid-cols-2 gap-2">
          <MatRow m={carcass} note="柜身 · 台面" />
          <MatRow m={front} note="门板" />
        </div>
      )}
      <Actions onAgent={() => openAgentDecor([c.id])} onRemove={() => removeItem(c.id)} />
    </>
  )
}
function CabinetEditBody({ plan, decor, c, cell }: { plan: Plan; decor: Decor; c: Cabinet; cell: { col: number; row: number } | null }) {
  const L = layoutCabinet(c)
  const D = useDecor.getState()
  const cur = cell ? L.cells.find(x => x.column === cell.col && x.row === cell.row) : null
  const setCell = (fn: (x: CabinetCell) => void) => cell && patchCabinet(c.id, cc => { const x = cc.columns[cell.col]?.cells[cell.row]; if (x) fn(x) })
  const rowName = (r: number, n: number) => n === 1 ? '整列' : r === 0 ? '下面' : r === n - 1 ? '上面' : '中间'
  return (
    <>
      <Visual label="平面"><div className="absolute right-3 top-2 text-[10.5px] font-semibold text-ink-400">剖切 1.1 m 往下看</div><CabPlanMini c={c} decor={decor} sel={cell?.col} /></Visual>
      <div>
        <div className="flex items-center justify-between px-1 pb-2"><span className="text-[12px] font-semibold text-ink-500">分列</span><span className="text-[11.5px] text-ink-400">拖立面上的竖线也能改</span></div>
        <div className="flex gap-1.5">
          {L.columns.map((col, i) => <button key={i} data-testid={`col-${i}`} onClick={() => D.select({ k: 'cell', id: c.id, col: i, row: 0 })} style={{ flex: col.width }} className={cn('num h-8 min-w-0 rounded-[10px] text-[12.5px] font-semibold', cell?.col === i ? 'bg-mint-100 text-mint-900 ring-[1.5px] ring-inset ring-mint-400' : 'tile text-ink-700')}>{Math.round(col.width)}</button>)}
          <button onClick={() => patchCabinet(c.id, cc => { const n = cc.columns.length + 1, w = Math.round(cc.width / n); cc.columns = [...cc.columns.map(col => ({ ...col, width: w })), { cells: [{ type: 'door' }] }] })} className="grid size-8 shrink-0 place-items-center rounded-[10px] text-ink-500 shadow-[inset_0_0_0_1px_var(--color-ink-200)]" aria-label="加一列"><Plus size={15} strokeWidth={2.4} /></button>
        </div>
      </div>
      {cur ? (
        <>
          <div className="flex items-center justify-between px-1"><span className="text-[12px] font-semibold text-ink-500">这一格：第 {cur.column + 1} 列 · {rowName(cur.row, c.columns[cur.column].cells.length)}</span><span className="num text-[11.5px] text-ink-400">{cur.z[0].toFixed(2)}–{cur.z[1].toFixed(2)} m</span></div>
          <div className="grid grid-cols-3 gap-1.5">
            {CELL_TYPES.map(([t, l]) => (
              <button key={t} data-testid={`cell-${t}`} onClick={() => setCell(x => { x.type = t; if (t === 'void') x.void = x.void ?? { depth: 'through' }; if (t === 'appliance') x.appliance = x.appliance ?? { type: 'oven' }; if (t === 'drawers') x.count = x.count ?? 2 })}
                className={cn('flex h-[62px] flex-col items-center justify-center gap-1 rounded-[14px] text-[11.5px] font-semibold', cur.type === t ? 'bg-mint-100 text-mint-900 ring-[1.5px] ring-inset ring-mint-400' : 'tile text-ink-600')}>
                <CellIcon t={t} />{l}
              </button>
            ))}
          </div>
          {cur.type === 'void' && (
            <div className="tile flex flex-col gap-2.5 rounded-[18px] p-3">
              <div className="flex items-center justify-between"><span className="text-[12.5px] font-semibold text-ink-600">挖多深</span>
                <div className="w-[176px]"><MiniSeg value={cur.cell.void?.depth === 'through' || !cur.cell.void ? 'through' : 'back'} options={[{ v: 'through', l: '挖穿柜体' }, { v: 'back', l: '留背板' }]} onChange={v => setCell(x => { x.void = { ...(x.void ?? {}), depth: v === 'through' ? 'through' : Math.max(50, c.depth - 18) } })} /></div>
              </div>
              <div className="flex items-center justify-between"><span className="text-[12.5px] font-semibold text-ink-600">洞里加台面</span>
                <span className="flex items-center gap-2"><span className="num text-[12px] font-semibold text-ink-500">{cur.cell.void?.top ? `高 ${cur.cell.void.top.z.toFixed(2)} · 出柜 ${cur.cell.void.top.overhang ?? 0}` : '无'}</span>
                  <Switch on={!!cur.cell.void?.top} onChange={on => setCell(x => { x.void = { depth: x.void?.depth ?? 'through', ...(on ? { top: { z: 0.73, overhang: 200 } } : {}) } })} label="洞里加台面" /></span>
              </div>
              {cur.cell.void?.top && <div className="grid grid-cols-2 gap-2"><Num label="台面高" value={cur.cell.void.top.z} unit="m" step={0.01} min={cur.z[0] + 0.05} max={cur.z[1]} digits={2} onChange={v => setCell(x => { x.void!.top!.z = v })} /><Num label="出柜" value={cur.cell.void.top.overhang ?? 0} unit="mm" step={10} min={0} max={800} onChange={v => setCell(x => { x.void!.top!.overhang = v })} /></div>}
            </div>
          )}
          {cur.type === 'appliance' && (
            <div className="tile flex flex-col gap-2 rounded-[18px] p-3">
              <span className="text-[12.5px] font-semibold text-ink-600">放什么（常见尺寸画虚线外形，可改）</span>
              <div className="flex flex-wrap gap-1.5">{([['fridge', '冰箱'], ['washer', '洗衣机'], ['dryer', '烘干机'], ['oven', '烤箱'], ['steamer', '蒸箱'], ['dishwasher', '洗碗机'], ['microwave', '微波炉']] as const).map(([t, l]) => <button key={t} onClick={() => setCell(x => { x.appliance = { type: t } })} className={cn('h-7 rounded-full px-2.5 text-[12px] font-semibold', cur.cell.appliance?.type === t ? 'bg-ink-900 text-white' : 'tile text-ink-600')}>{l}</button>)}</div>
            </div>
          )}
          {(cur.type === 'drawers' || cur.type === 'open') && <Num label={cur.type === 'drawers' ? '抽屉个数' : '层板数'} value={cur.cell.count ?? (cur.type === 'drawers' ? 3 : 0)} step={1} min={cur.type === 'drawers' ? 1 : 0} max={8} onChange={v => setCell(x => { x.count = v })} />}
        </>
      ) : <div className="tile-sunken rounded-[16px] p-3.5 text-[12.5px] text-ink-500">点立面上的一格，换它的类型：门、抽屉、开放格、挖洞、家电位。</div>}
    </>
  )
}
function CabPlanMini({ c, decor, sel }: { c: Cabinet; decor: Decor; sel?: number }) {
  const L = layoutCabinet(c)
  const W = 316, k = Math.min((W - 50) / c.width, 60 / c.depth), x0 = 14, y0 = 22
  const front = matOf(decor, c.materials.front).color
  return (
    <svg width="100%" viewBox={`0 0 ${W} 110`} className="block">
      <rect x={0} y={y0 - 12} width={W} height={12} fill="#3c424b" />
      {L.columns.map((col, i) => {
        const cl = L.cells.find(x => x.column === i && x.z[0] <= 1.1 && x.z[1] > 1.1)
        const x = x0 + col.u[0] * k, w = col.width * k, h = c.depth * k
        const hollow = cl?.type === 'void' || cl?.type === 'open', top = cl?.cell.void?.top
        return (
          <g key={i}>
            {hollow ? <rect x={x} y={y0} width={w} height={h} fill="rgb(22 25 30 / .03)" stroke={sel === i ? '#2dbf8c' : '#8e949d'} strokeWidth={sel === i ? 1.8 : 1} strokeDasharray="5 4" /> : <><rect x={x} y={y0} width={w} height={h} fill={front} fillOpacity={0.5} stroke={sel === i ? '#2dbf8c' : '#545a63'} strokeWidth={sel === i ? 1.8 : 1} /><path d={`M${x} ${y0}L${x + w} ${y0 + h}M${x + w} ${y0}L${x} ${y0 + h}`} stroke="#b3b8c0" strokeWidth={0.7} /></>}
            {top && <><rect x={x} y={y0} width={w} height={(c.depth + (top.overhang ?? 0)) * k} fill="#d4f6e7" fillOpacity={0.5} stroke="#2dbf8c" strokeWidth={1.2} /><text x={x + w / 2} y={y0 + (c.depth + (top.overhang ?? 0)) * k + 13} fontSize={10.5} fontWeight={650} fill="#12825e" textAnchor="middle">书桌台面 出柜 {top.overhang ?? 0}</text></>}
          </g>
        )
      })}
      <path d={`M${x0 + c.width * k + 10} ${y0}V${y0 + c.depth * k}`} stroke="#8e949d" strokeWidth={1} />
      <text x={x0 + c.width * k + 14} y={y0 + c.depth * k / 2 + 4} fontSize={10.5} fontWeight={650} fill="#3b4048" className="num">{c.depth}</text>
    </svg>
  )
}

/* ───────── 造型检查器 ───────── */
function PanelCard({ plan, decor, p }: { plan: Plan; decor: Decor; p: Panel }) {
  const face = p.span?.face
  const w = face ? plan.walls.find(x => x.id === face.wall) : undefined
  const lbl = face ? faceLabel(plan, face) : null
  const holes = decor.recesses.filter(r => 'panel' in r.host && r.host.panel === p.id)
  const typeZh = { feature: '背景墙板', wainscot: '护墙板', slats: '格栅', skirting: '踢脚线', arch: '拱形门套' }[p.type]
  const sp = p.span
  return (
    <>
      <Header icon={<Wallpaper size={18} strokeWidth={2.2} />} iconCls={SAND} title={p.name ?? typeZh} sub={<><span>{typeZh}</span><span className="text-ink-300">·</span><span>贴在{lbl?.title ?? ''}</span><span className="text-ink-300">·</span><span className="num">{p.id}</span></>} onClose={close} />
      {sp && <div className="grid grid-cols-2 gap-2.5">
        <Num label="宽" value={sp.s[1] - sp.s[0]} unit="mm" step={10} min={100} max={20000} onChange={v => patchPanel(p.id, x => { x.span = { ...x.span!, s: [x.span!.s[0], x.span!.s[0] + v] } }, `pw-${p.id}`)} testId="panel-w" />
        <Num label="高" value={sp.z[1] - sp.z[0]} unit="m" step={0.01} min={0.05} max={w ? effectiveWallHeight(plan, w) : 3} digits={2} onChange={v => patchPanel(p.id, x => { x.span = { ...x.span!, z: [x.span!.z[0], +(x.span!.z[0] + v).toFixed(3)] } }, `ph-${p.id}`)} />
        <Num label="出墙厚度（含龙骨）" value={p.thickness} unit="mm" step={5} min={5} max={400} onChange={v => patchPanel(p.id, x => { x.thickness = v }, `pt-${p.id}`)} className="col-span-2" />
      </div>}
      <p className="-mt-1 px-1 text-[11.5px] text-ink-400">常见 20–200 mm（常见值）。</p>
      <div className="flex items-center justify-between px-1"><span className="text-[12px] font-semibold text-ink-500">分缝</span>
        <MiniSeg value={p.grooves?.dir ?? 'none'} options={[{ v: 'v', l: '竖缝' }, { v: 'h', l: '横缝' }, { v: 'none', l: '无' }]} onChange={v => patchPanel(p.id, x => { x.grooves = v === 'none' ? undefined : { dir: v as 'v' | 'h', spacing: v === 'v' ? 600 : 400, width: 3 } })} />
      </div>
      <MatRow m={matOf(decor, p.material)} note={p.material === styleOf(decor.style, decor).roles['wall.accent'] ? '跟风格的点缀墙' : '单独改过'} />
      <MaterialPicker decor={decor} cats={FACE_CATS} value={p.material} onPick={m => patchPanel(p.id, x => { x.material = m })} />
      {holes.length > 0 && <div className="flex flex-col gap-1.5">{holes.map(h => <Row key={h.id} disc={<span className="grid size-10 place-items-center rounded-full bg-sand-100 text-sand-700"><Inbox size={16} /></span>} title={h.name ?? '挖洞'} sub={`${Math.round((h.rect.u?.[1] ?? 0) - (h.rect.u?.[0] ?? 0))} × ${(h.rect.z[1] - h.rect.z[0]).toFixed(2)} · ${h.depth === 'through' ? '挖穿' : `挖进 ${h.depth}`}`} onClick={() => useDecor.getState().select({ k: 'recess', id: h.id })} />)}</div>}
      <Actions onAgent={() => openAgentDecor([p.id])} onRemove={() => removeItem(p.id)} />
    </>
  )
}

/* ───────── 挖洞 / 壁龛检查器 ───────── */
function RecessCard({ plan, base, decor, r, issues }: { plan: Plan; base: Plan; decor: Decor; r: Recess; issues: DecorIssues | null }) {
  const onWall = 'face' in r.host
  const face = onWall ? (r.host as { face: FaceRef }).face : null
  const w = face ? plan.walls.find(x => x.id === face.wall) : undefined
  const panel = 'panel' in r.host ? decor.panels.find(x => x.id === (r.host as { panel: string }).panel) : undefined
  const cab = 'cabinet' in r.host ? decor.cabinets.find(x => x.id === (r.host as { cabinet: string }).cabinet) : undefined
  const hostT = panel?.thickness ?? cab?.depth ?? w?.thickness ?? 0
  const where = panel ? `${panel.name ?? '造型'}（造型，厚 ${panel.thickness}）` : cab ? `${cab.name ?? '柜子'}（柜深 ${cab.depth}）` : w ? `${w.name ?? w.id}（${WALL_ZH[w.kind]} ${w.thickness}）` : '—'
  const depthN = r.depth === 'through' ? hostT : r.depth
  const errs = (issues?.byId.get(r.id) ?? []).filter(i => i.level === 'error')
  const otherSide = face && w ? decor.recesses.filter(x => x.id !== r.id && 'face' in x.host && x.host.face.wall === w.id && x.host.face.side !== face.side) : []
  return (
    <>
      <Header icon={<Inbox size={18} strokeWidth={2.2} />} iconCls={SAND} title={r.name ?? (r.kind === 'niche' ? '壁龛' : '挖洞')} sub={<><span>挖在：{where}</span></>} onClose={close} />
      {w && face && <FactCard plan={plan} base={base} decor={decor} id={r.id} wallId={w.id} issues={issues} />}
      {errs.map(e => <div key={e.code} className="rounded-[16px] bg-lemon-50 px-3 py-2 text-[12.5px] font-semibold text-lemon-800 ring-1 ring-inset ring-lemon-200">{e.text}</div>)}
      <Visual label="俯视局部"><div className="absolute right-3 top-2 text-[10.5px] font-semibold text-ink-400">{onWall ? '挖进墙里多深' : '挖进造型多深'}</div><TopView t={hostT} depth={depthN} deep={0} width={(r.rect.s ? r.rect.s[1] - r.rect.s[0] : (r.rect.u?.[1] ?? 0) - (r.rect.u?.[0] ?? 0))} kind={panel ? 'partition' : w?.kind ?? 'partition'} through={r.depth === 'through'} /></Visual>
      <div className="grid grid-cols-2 gap-2.5">
        <Num label="离地" value={r.rect.z[0]} unit="m" step={0.01} min={0} max={3} digits={2} onChange={v => patchRecess(r.id, x => { const h = x.rect.z[1] - x.rect.z[0]; x.rect = { ...x.rect, z: [v, +(v + h).toFixed(3)] } }, `rz-${r.id}`)} />
        <Num label="高" value={r.rect.z[1] - r.rect.z[0]} unit="m" step={0.01} min={0.05} max={3} digits={2} onChange={v => patchRecess(r.id, x => { x.rect = { ...x.rect, z: [x.rect.z[0], +(x.rect.z[0] + v).toFixed(3)] } }, `rh-${r.id}`)} />
        {onWall ? <div className="col-span-2 flex flex-col gap-2"><Num label="挖进墙里" value={depthN} unit="mm" step={10} min={10} max={(w?.thickness ?? 0) + 200} onChange={v => setEmbed('recess', r.id, v)} testId="recess-depth" /><ThroughHint id={r.id} /></div>
          : <div className="col-span-2 flex items-center justify-between gap-2"><MiniSeg value={r.depth === 'through' ? 'through' : 'keep'} options={[{ v: 'through', l: '挖穿（露出墙面）' }, { v: 'keep', l: `留一层` }]} onChange={v => patchRecess(r.id, x => { x.depth = v === 'through' ? 'through' : Math.max(10, Math.round(hostT * 0.66)) })} />
            {r.depth !== 'through' && <Num value={r.depth} unit="mm" step={10} min={10} max={hostT + 100} onChange={v => { if (v > hostT) { useStore.getState().showToast(`${panel ? '造型' : '柜子'}只有 ${hostT} 厚；要再往里就是挖进墙了，按墙的规则重新判断`); return } patchRecess(r.id, x => { x.depth = v }, `rd-${r.id}`) }} testId="hole-depth" className="w-[110px]" />}</div>}
      </div>
      {otherSide.length > 0 && <p className="px-1 text-[11.5px] text-ink-500">这面墙另一侧也挖了 {otherSide.map(x => x.depth).join('、')} mm，两边加起来不能到墙厚。</p>}
      <Actions onAgent={() => openAgentDecor([r.id])} onRemove={() => removeItem(r.id)} />
    </>
  )
}

/* ───────── 没地方挂了：问题卡（和读图问题卡同一个样子） ───────── */
function OrphanCard({ plan, base, decor, id, issues }: { plan: Plan; base: Plan; decor: Decor; id: string; issues: DecorIssues }) {
  const it = findItem(decor, id)!
  const face = 'place' in it.it && 'face' in it.it.place ? it.it.place.face : 'span' in it.it && it.it.span ? it.it.span.face : null
  const w = face ? base.walls.find(x => x.id === face.wall) : undefined
  const nearest = nearestFaces(plan, decor, id)
  const iss = issues.byId.get(id)?.find(i => i.code === 'host-missing' || i.code === 'host-cut')
  return (
    <>
      <Header icon={<Unlink size={18} strokeWidth={2.3} />} iconCls="bg-lemon-200 text-ink-900" title="没地方挂了" sub={<span>{it.it.name ?? '装修'} · <span className="num">{id}</span></span>} onClose={close} />
      <div className="tile rounded-[20px] p-3.5" data-testid="orphan-card">
        <p className="text-[14px] font-semibold leading-snug text-ink-900">{w ? `${w.name ?? w.id}在改造里拆掉了，墙上的${it.it.name ?? '装修'}没地方挂` : iss?.text}</p>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-500">数据原样留着，画在原来的位置（柠檬虚线）。你选一个处理办法：</p>
        <div className="mt-3 flex flex-col gap-1.5">
          {nearest.slice(0, 2).map((n, i) => {
            const l = faceLabel(plan, n.face)
            return <KPill key={i} tone={i === 0 ? 'ink' : 'tile'} size="md" className="justify-start" data-testid={i === 0 ? 'orphan-move' : undefined} onClick={() => moveOrphan(id, n.face, n.s)}>挪到{l.room}{l.dir}墙{i === 0 ? '（最近）' : ''}<ArrowRight size={14} className="ml-auto" /></KPill>
          })}
          <KPill tone="tile" size="md" className="justify-start" onClick={close} data-testid="orphan-keep">先留着</KPill>
          <KPill tone="coral" size="md" className="justify-start" onClick={() => removeItem(id)} data-testid="orphan-delete"><Trash size={14} />删掉</KPill>
        </div>
      </div>
      <p className="px-1 text-[11.5px] text-ink-400">撤销改造（改造清单里撤回拆墙）以后，它会自动挂回去。</p>
    </>
  )
}

export { X as CloseIcon, roomsBesideWall, checkEmbed }
export type { Vec2 }
