/**
 * 装修态的外壳：左上标题（平面 / 立面 / 柜体编辑 / 选风格）、工具提示条和类型胶囊、底部「下一步」的装修规则。
 * 位置、字号和结构态完全一样（design.md §3），只换内容。
 */
import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { ArrowRight, ChevronLeft, ChevronRight, Lock, MousePointerClick, Palette, Sofa, Sparkles, Unlink, ScanEye, PaintRoller, Columns3, FileDown } from 'lucide-react'
import type { Plan, Room, Vec2 } from '@/core/types'
import type { FaceRef } from '@/core/decor/types'
import { faceAxis, faceExtent } from '@/core/decor/faces'
import { effectiveWallHeight, labelPoint, pointInPolygon, roomsBesideWall, wallNormal } from '@/core/geometry'
import { cabinetFootprint } from '@/core/decor/cabinets'
import { useStore } from '../store'
import { dicts, fmt } from '../i18n'
import { pendingCount } from '@/core/decor/resolve'
import { Glass, Pill, Tip } from '../kit'
import { cn } from '@/lib/utils'
import { bottomSlot, useIsNarrow } from '../layout'
import { useDecor } from './dstore'
import { faceLabel, faceRoom, pendingItems, selOfItem, styleOf, useDecorIssues, useDecorPlan, WALL_ZH, matOf } from './model'
import { elevSegmentRooms, elevationModel } from './elev-model'
import { FURN_CATS } from './furniture'
import { openExportPanel } from '../export/entry'

const Dot = () => <span className="size-[3px] shrink-0 rounded-full bg-ink-300" />

/** 一间房的墙面，按绕房间一圈的顺序（立面里 ‹ › 走到相邻的墙） */
export function roomFaces(plan: Plan, room: Room): FaceRef[] {
  const c = labelPoint(room.poly)
  const out: { face: FaceRef; ang: number }[] = []
  for (const w of plan.walls) {
    if (w.bulge) continue
    const s = roomsBesideWall(plan, w.id)
    for (const [side, list] of [[1, s.positive], [-1, s.negative]] as const) {
      if (!list.some(r => r.id === room.id)) continue
      try {
        const ext = faceExtent(plan, { wall: w.id, side })
        if (ext[1] - ext[0] < 200) continue
        const m = faceAxis(plan, { wall: w.id, side }).at((ext[0] + ext[1]) / 2)
        out.push({ face: { wall: w.id, side }, ang: Math.atan2(m[1] - c[1], m[0] - c[0]) })
      } catch { /* 跳过 */ }
    }
  }
  return out.sort((a, b) => a.ang - b.ang).map(x => x.face)
}
export function stepFace(plan: Plan, face: FaceRef, dir: 1 | -1, roomId?: string): FaceRef | null {
  // ‹ › 绕「当前这间房」走（D6 A3）：一面墙跨两间房时，从书房进来就绕书房，不跳回客厅
  const r = (roomId && plan.rooms.find(x => x.id === roomId)) || faceRoom(plan, face)
  if (!r) return null
  const list = roomFaces(plan, r)
  const i = list.findIndex(f => f.wall === face.wall && f.side === face.side)
  if (i < 0 || list.length < 2) return null
  return list[(i + dir + list.length) % list.length]
}

export function DecorTitle() {
  const dp = useDecorPlan()
  const canvas = useDecor(s => s.canvas), styleCard = useDecor(s => s.styleCard), preview = useDecor(s => s.preview)
  const issues = useDecorIssues()
  if (!dp) return null
  const { plan, decor } = dp
  const nPending = pendingCount(decor), agentT = dicts[useStore.getState().lang].decorAgent
  let l1: ReactNode = plan.title, l2: ReactNode = '装修方案', meta: ReactNode = null, nav: ReactNode = null
  if (canvas.k !== 'plan') {
    const face = canvas.face, w = plan.walls.find(x => x.id === face.wall)
    const lbl = faceLabel(plan, face)
    let ext: [number, number] = [0, 0]
    try { ext = faceExtent(plan, face) } catch { /* */ }
    const H = w ? effectiveWallHeight(plan, w) : 2.8
    const prot = w && (w.kind === 'exterior' || w.kind === 'bearing')
    if (canvas.k === 'cabinet') {
      const c = decor?.cabinets.find(x => x.id === canvas.id)
      // 柜子在哪间房：取柜子平面足迹的中心
      let room = lbl.room
      try { if (c) { const fp = cabinetFootprint(plan, c), cx: Vec2 = [fp.reduce((a, p) => a + p[0], 0) / 4, fp.reduce((a, p) => a + p[1], 0) / 4]; room = plan.rooms.find(r => pointInPolygon(cx, r.poly))?.name ?? room } } catch { /* */ }
      const short = c?.name && room && c.name.startsWith(room) ? c.name.slice(room.length) : c?.name
      l1 = `${room ? room + ' · ' : ''}${short ?? '柜子'}`; l2 = '柜体编辑'
      meta = c && <><span className="num">{(c.width / 1000).toFixed(2)} × {(c.z[1] - c.z[0]).toFixed(2)} m · 深 {c.depth}</span><Dot /><span>{lbl.dir}{w ? WALL_ZH[w.kind] : ''}</span><Dot /><span>{lbl.look}</span></>
    } else {
      // 立面按房间分段（D6 A3）：标题写这间房；这面墙还连着别的房间时，标题旁给一个切过去的小胶囊
      const room = (canvas.room && plan.rooms.find(r => r.id === canvas.room)) || faceRoom(plan, face)
      l1 = room ? `${room.name} · ${lbl.dir}墙` : lbl.title; l2 = '墙面立面'
      const go = (d: 1 | -1) => { const f = stepFace(plan, face, d, room?.id); if (f) useDecor.getState().openElevation(f, room?.id) }
      const others = elevSegmentRooms(dp.plan, dp.base, dp.decor, face).filter(r => r.id !== room?.id)
      // 宽度写这间房这一段（不是整条共线墙）
      const seg = room ? elevationModel(dp.plan, dp.base, dp.decor, face)?.segments.filter(sg => sg.room.id === room.id) : null
      if (seg?.length && others.length) ext = [Math.min(...seg.map(x => x.u[0])), Math.max(...seg.map(x => x.u[1]))]
      nav = (
        <span className="pointer-events-auto ml-3 flex translate-y-[3px] gap-1.5">
          <Tip label="上一面墙" kbd="[" side="bottom"><button data-testid="elev-prev" onClick={() => go(-1)} className="glass-chip glass-hover grid size-[30px] place-items-center rounded-full text-ink-600 active:scale-90"><ChevronLeft size={16} strokeWidth={2.4} /></button></Tip>
          <Tip label="下一面墙" kbd="]" side="bottom"><button data-testid="elev-next" onClick={() => go(1)} className="glass-chip glass-hover grid size-[30px] place-items-center rounded-full text-ink-600 active:scale-90"><ChevronRight size={16} strokeWidth={2.4} /></button></Tip>
          {others.map(r => (
            <Tip key={r.id} label={`切到从${r.name}看这面墙`} side="bottom">
              <button data-testid={`elev-also-${r.id}`} onClick={() => useDecor.getState().openElevation(face, r.id)}
                className="glass-chip glass-hover ml-1.5 flex h-[30px] items-center gap-0.5 rounded-full pl-3 pr-2 text-[12.5px] font-semibold tracking-normal text-ink-600 active:scale-95">
                <span className="font-medium text-ink-400">这面墙还连着</span>&nbsp;{r.name}<ChevronRight size={14} strokeWidth={2.4} />
              </button>
            </Tip>
          ))}
        </span>
      )
      meta = <>{w && <span className={cn('flex items-center gap-1', prot && 'font-semibold text-ink-800')}>{prot && <Lock size={12} strokeWidth={2.6} />}{WALL_ZH[w.kind]} <span className="num">{w.thickness}</span></span>}<Dot /><span className="num">{((ext[1] - ext[0]) / 1000).toFixed(2)} × {H.toFixed(2)} m</span><Dot /><span>{room ? `从${room.name}看 · ` : ''}{lbl.look}</span></>
    }
  } else if (styleCard || preview) {
    const st = styleOf(preview ?? decor?.style, decor)
    l2 = <>选风格{preview && <span className="ml-2.5 font-light text-ink-300">预览 · {st.name}</span>}</>
    const n = (decor?.surfaces.filter(s => s.by === 'user').length ?? 0) + (decor?.panels.length ?? 0)
    meta = <><span>{st.blurb}</span>{n > 0 && <><Dot /><span>单独改过的 {n} 处不变</span></>}</>
  } else if (decor) {
    const st = styleOf(decor.style, decor)
    const orphans = new Set(issues?.orphans.map(i => i.id) ?? []).size
    meta = <><span>{st.name}</span><Dot /><span>家具 <span className="num">{decor.furniture.length}</span> · 柜子 <span className="num">{decor.cabinets.length}</span></span>{orphans > 0 && <><Dot /><span className="font-semibold text-lemon-800">{orphans} 项没地方挂</span></>}{nPending > 0 && <><Dot /><span className="font-semibold text-lav-600" data-testid="decor-title-pending">{fmt(agentT.meta, { n: nPending })}</span></>}</>
  } else meta = <span>还没选风格</span>
  return (
    <motion.div key={canvas.k} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
      data-float data-title-block className="pointer-events-none absolute left-7 top-[96px] z-20 select-none" data-testid="decor-title">
      <div className="text-[30px] font-light leading-[1.12] tracking-[-0.01em] text-ink-700">{l1}</div>
      <div className="flex items-center text-[30px] font-semibold leading-[1.12] tracking-[-0.015em] text-ink-900">{l2}{nav}</div>
      <div className="mt-2.5 flex items-center gap-2 text-[12.5px] font-medium text-ink-500">{meta}</div>
    </motion.div>
  )
}

/* ───────── 工具提示条 + 类型胶囊（和门窗工具同一个做法） ───────── */
const HINT: Record<string, string> = {
  material: '点地面、墙边就刷上当前材料 · ⌥ 点吸取',
  furniture: '从右边家具库点一件，再在平面上点放下',
  cabinet: '悬停墙面，沿墙拖出柜子的宽度',
  elevpick: '点一面墙，进它的立面',
  panel: '在墙上拖一个框，画出造型的范围',
  cut: '框在哪就挖在哪：框在板或柜子上是挖洞，框在空墙上是壁龛',
}
export function DecorToolHint() {
  const tool = useDecor(s => s.tool), canvas = useDecor(s => s.canvas), fam = useDecor(s => s.cabFamily), pk = useDecor(s => s.panelKind), brush = useDecor(s => s.brush), placing = useDecor(s => s.placing)
  const decor = useStore(s => s.base?.decor)
  if (tool === 'select') return null
  const pills = (opts: [string, string][], v: string, on: (x: string) => void) => (
    <div className="glass pointer-events-auto flex gap-1 rounded-full p-1">
      {opts.map(([k, l]) => <button key={k} data-testid={`dtype-${k}`} onClick={() => on(k)} className={cn('h-7 shrink-0 rounded-full px-2.5 text-[12px] font-semibold transition', v === k ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-white')}>{l}</button>)}
    </div>
  )
  const m = matOf(decor, brush)
  return (
    <motion.div key={tool} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="pointer-events-none absolute left-1/2 top-[86px] z-30 flex -translate-x-1/2 flex-col items-center gap-2">
      <div className="flex items-center gap-2 whitespace-nowrap rounded-full bg-ink-900/90 py-1.5 pl-3 pr-1.5 text-[12px] font-medium text-white shadow-lg backdrop-blur-md">
        <span>{tool === 'furniture' && placing ? '在平面上点一下放下' : HINT[tool]}</span>
        <span className="num rounded-full bg-white/14 px-2 py-0.5 text-[10.5px] text-white/80">Esc</span>
      </div>
      {tool === 'cabinet' && pills([['tall', '高柜'], ['base', '地柜'], ['wall', '吊柜']], fam, x => useDecor.getState().set({ cabFamily: x as never }))}
      {tool === 'panel' && pills([['feature', '背景墙板'], ['wainscot', '护墙板'], ['slats', '格栅'], ['skirting', '踢脚线']], pk, x => useDecor.getState().set({ panelKind: x as never }))}
      {tool === 'material' && (
        <div className="glass pointer-events-auto flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-[12.5px] font-semibold text-ink-800" data-testid="brush-chip">
          <span className="size-6 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)]" style={{ background: m.color }} />{m.name}
        </div>
      )}
      {canvas.k === 'plan' && tool === 'furniture' && null}
    </motion.div>
  )
}
export const FURN_CAT_LIST = FURN_CATS

/* ───────── 下一步条（装修态，按优先级取第一条；设计规范 §3.3） ───────── */
export function DecorNext() {
  const narrow = useIsNarrow(), shift = useStore(s => s.pipShift)
  const dp = useDecorPlan()
  const sel = useDecor(s => s.sel), tool = useDecor(s => s.tool), canvas = useDecor(s => s.canvas), preview = useDecor(s => s.preview), styleCard = useDecor(s => s.styleCard), visited = useDecor(s => s.elevVisited), hint = useDecor(s => s.throughHint)
  const agentOpen = useStore(s => s.agentOpen)
  const issues = useDecorIssues()
  if (!dp || agentOpen) return null
  if (tool !== 'select' && !sel && !hint) return null
  const decor = dp.decor
  let tone: 'ink' | 'lemon' | 'mint' | 'lav' = 'ink', icon: ReactNode = <MousePointerClick size={15} strokeWidth={2.4} />, lead = '', cta = '', act = () => {}
  const proposals = pendingItems(decor), agentT = dicts[useStore.getState().lang].decorAgent
  const selPending = !!sel && 'id' in sel && proposals.some(x => x.it.id === sel.id)
  const orphanIds = [...new Set(issues?.orphans.map(i => i.id) ?? [])]
  if (hint) {
    tone = 'lemon'; icon = <Lock size={14} strokeWidth={2.6} />
    lead = hint.other ?? `挖到 ${hint.thickness} 就穿了，那是开洞，属于结构改造`; cta = hint.other ? '' : '去改造开洞'
    act = () => goAddOpening(hint)
  } else if (preview) {
    icon = <Palette size={15} strokeWidth={2.4} />
    lead = `正在预览，Esc 回到「${styleOf(decor?.style, decor).name}」`
  } else if (selPending) {
    tone = 'lav'; icon = <Sparkles size={15} strokeWidth={2.4} />
    lead = agentT.barSel
  } else if (sel) {
    lead = sel.k === 'door' ? (canvas.k === 'plan' ? '样子要改就交给 Agent · 双击进立面看门板 · ⌫ 删除' : '样子要改就交给 Agent · ⌫ 删除')
      : sel.k === 'panel' && decor?.panels.find(p => p.id === sel.id)?.type === 'arch' ? '跟着门洞走，拱的形状要改就交给 Agent · ⌫ 删除'
      : canvas.k === 'cabinet' ? '点格子换类型，拖竖线改列宽 · Esc 回到整面墙'
      : sel.k === 'face' ? (canvas.k === 'plan' ? '点色块直接换 · 双击这面墙进立面' : '拖框画造型，用「挖」在墙上挖壁龛')
      : sel.k === 'floor' ? '点色块直接换这间房的地面'
      : sel.k === 'furniture' ? (canvas.k === 'plan' ? '拖动或方向键换位置（⇧ 大步）· 按住 ⌥ 悬停量净距 · R 转 90° · ⌫ 删除' : '拖动换位置，←→ 沿墙挪、↑↓ 调离地高度（⇧ 大步）· R 转 90° · ⌫ 删除')
      : sel.k === 'cabinet' ? (canvas.k === 'plan' ? '双击进柜体编辑 · 按住 ⌥ 悬停量净距 · ⌫ 删除' : '拖四边改尺寸，拖进墙里就是嵌入 · ←→ 沿墙挪、↑↓ 调离地高度（⇧ 大步）· ⌫ 删除')
      : canvas.k === 'plan' ? '拖四边改尺寸 · ⌫ 删除' : '拖四边改尺寸 · ←→ 沿墙挪、↑↓ 调离地高度（⇧ 大步）· ⌫ 删除'
  } else if (!decor || styleCard) {
    tone = 'mint'; icon = <Palette size={15} strokeWidth={2.4} />
    lead = '先选一个整体风格，之后每块地、每面墙都能单独改'
  } else if (orphanIds.length) {
    tone = 'lemon'; icon = <Unlink size={15} strokeWidth={2.4} />
    const it = decor.cabinets.find(c => c.id === orphanIds[0])
    const wall = it && 'face' in it.place ? dp.base.walls.find(w => w.id === (it.place as { face: FaceRef }).face.wall) : undefined
    lead = wall ? `拆掉${wall.name ?? wall.id}后，${orphanIds.length} 项装修没地方挂了` : `${orphanIds.length} 项装修没地方挂了`
    cta = '去处理'; act = () => { const k = decor.cabinets.some(c => c.id === orphanIds[0]) ? 'cabinet' : decor.panels.some(c => c.id === orphanIds[0]) ? 'panel' : decor.recesses.some(c => c.id === orphanIds[0]) ? 'recess' : 'furniture'; useDecor.getState().select({ k, id: orphanIds[0] } as never) }
  } else if (proposals.length) {
    tone = 'lav'; icon = <Sparkles size={15} strokeWidth={2.4} />
    lead = fmt(agentT.bar, { n: proposals.length }); cta = agentT.barCta
    act = () => useDecor.getState().select(selOfItem(proposals[0]))
  } else if (!decor.furniture.length) {
    icon = <Sofa size={15} strokeWidth={2.4} />
    lead = '从家具库拖几件进来，看看放不放得下'; cta = '打开家具库'; act = () => useDecor.getState().setTool('furniture')
  } else if (!visited) {
    icon = <ScanEye size={15} strokeWidth={2.4} />
    lead = '双击一面墙，做背景墙、嵌墙柜'
  } else {
    tone = 'mint'; icon = <FileDown size={15} strokeWidth={2.4} />
    const n = decor.furniture.length + decor.cabinets.length + decor.panels.length + decor.recesses.length + decor.surfaces.length + (decor.doors?.length ?? 0)
    lead = `${styleOf(decor.style, decor).name} · ${n} 项装修`; cta = '改造清单导出'
    act = () => openExportPanel()
  }
  const disc = { lemon: 'bg-lemon-200 text-ink-900', mint: 'bg-mint-200 text-mint-900', lav: 'bg-lav-200 text-lav-800', ink: 'bg-ink-900 text-white' }[tone]
  return (
    <motion.div key={lead} initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 30 }}
      className={cn('absolute bottom-5 z-30', narrow ? 'flex justify-center' : 'left-1/2 -translate-x-1/2')} style={narrow ? bottomSlot(shift) : undefined}>
      <Glass data-testid="next-step" className="flex h-[52px] min-w-0 max-w-full items-center gap-3 rounded-full pl-1.5 pr-1.5">
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-full shadow-[inset_0_1px_0_rgb(255_255_255/0.6)]', disc)}>{icon}</span>
        <span className={cn('min-w-0 truncate whitespace-nowrap text-[13.5px] font-semibold text-ink-800', !cta && 'pr-4')} title={lead}>{lead}</span>
        {cta && <Pill tone="ink" size="md" onClick={act} className="h-10 shrink-0 gap-1.5 pl-4 pr-3.5" data-testid="next-cta">{cta}<ArrowRight size={15} strokeWidth={2.4} /></Pill>}
      </Glass>
    </motion.div>
  )
}

/** 挖到墙厚：转去改造态，选中那面墙，开门窗工具（门洞），提示放在哪 */
export function goAddOpening(h: { wall: string; s: number; width: number }) {
  const s = useStore.getState()
  useDecor.getState().set({ throughHint: null })
  s.setMode('renovation')
  s.select({ type: 'wall', id: h.wall })
  s.setOpeningKind('doorway')
  s.setTool('opening')
  s.showToast(`在这面墙上 ${Math.round(h.s)}–${Math.round(h.s + h.width)} mm 处点一下，加一个洞口`)
}

export const toolIcons = { PaintRoller, Sofa, Columns3, ScanEye }
export const faceNormalInto = (plan: Plan, f: FaceRef): Vec2 => { const w = plan.walls.find(x => x.id === f.wall)!; const n = wallNormal(w); return [n[0] * f.side, n[1] * f.side] }
