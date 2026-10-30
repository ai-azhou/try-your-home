/**
 * 选中什么才出现什么：墙 / 门窗 / 房间 / 梁 / 已拆除的构件 / 多选。
 * 原始模式下改属性 = 纠正读图（直接改 base）；改造模式 = 记一条改造；对比模式只读。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AppWindow, BrickWall, ChevronRight, Columns2, DoorOpen, Lock, Rows2, Sparkles, Square, Undo2, X, Trash, TriangleAlert, Check, Scissors, Ruler } from 'lucide-react'
import type { Beam, Change, Column, Opening, OpeningKind, Plan, Room, Shaft, Stair, Void, Wall, WallKind } from '@/core/types'
import { DEFAULTS, PROTECTED_KINDS } from '@/core/types'
import { arcParams, bulgeFromAngle, bulgeFromRadius, clamp, effectiveWallHeight, projectToWall, roomsBesideWall, pointInPolygon, wallLength } from '@/core/geometry'
import { levelCeiling, levelOf, levelsOf } from '@/core/levels'
import { useStore, useT, useView, type Confirm } from '../store'
import { CertaintyBadge, NumberField, Pill, RoundButton, SectionLabel, Switch, Tag, WallSwatch, Tip } from '../kit'
import { RoomSection, WallElevation } from './Diagrams'
import { openingsOn, len2, spanOf } from '../geom'
import { elementLabel, findEl, roomArea, type Ref } from '../model'
import { patchEl as patch, removeRefs, removeWallRange, splitSelectedWall } from '../actions'
import { fmt } from '../i18n'
import { cn } from '@/lib/utils'
import { ExtraIcon } from '../kit/extra-icons'

const WALL_KINDS: WallKind[] = ['exterior', 'bearing', 'partition', 'glass', 'half', 'half-glass']
const OPEN_KINDS: OpeningKind[] = ['door', 'sliding', 'doorway', 'window', 'floor-window', 'bay-window', 'open-balcony']

export function openingIcon(k: OpeningKind, size = 18) {
  if (k === 'door' || k === 'doorway') return <DoorOpen size={size} strokeWidth={2.1} />
  if (k === 'sliding') return <Columns2 size={size} strokeWidth={2.1} />
  return <AppWindow size={size} strokeWidth={2.1} />
}

/* ───────── 卡片骨架 ───────── */
export function Header({ icon, iconCls, title, sub, onClose, badge }: { icon: ReactNode; iconCls: string; title: ReactNode; sub: ReactNode; onClose(): void; badge?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className={cn('relative grid size-11 shrink-0 place-items-center rounded-full shadow-[inset_0_1px_0_rgb(255_255_255/0.5)]', iconCls)}>
        {icon}
        {badge}
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="truncate text-[17px] font-semibold leading-snug tracking-[-0.01em] text-ink-900">{title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 truncate text-[12px] font-medium text-ink-400">{sub}</div>
      </div>
      <RoundButton size="sm" tone="plain" onClick={onClose} aria-label="close" className="-mr-1 -mt-0.5"><X size={16} /></RoundButton>
    </div>
  )
}

export function Field({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="mb-1.5 px-1 text-[11.5px] font-semibold text-ink-500">{label}</div>
      {children}
    </div>
  )
}
/** 数字框：Figma 式（kit NumberField），提示文案跟界面语言 */
export function Num(p: Omit<Parameters<typeof NumberField>[0], 'msgs'>) {
  const t = useT()
  return <NumberField msgs={t.s2a.num} {...p} />
}
function ReadValue({ v, unit, note }: { v: string; unit: string; note?: string }) {
  return (
    <div className="flex h-9 items-baseline gap-1 rounded-full px-3 pt-[7px]">
      <span className="num text-[14px] font-semibold text-ink-900">{v}</span>
      <span className="text-[11px] font-medium text-ink-400">{unit}</span>
      {note && <span className="ml-auto truncate text-[11px] font-medium text-ink-400">{note}</span>}
    </div>
  )
}
export function Visual({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="tile relative overflow-hidden rounded-[18px] px-2 pb-1 pt-6">
      <span className="absolute left-3 top-2 text-[10.5px] font-bold uppercase tracking-[0.08em] text-ink-400">{label}</span>
      {children}
    </div>
  )
}
function Evidence({ el, extra }: { el: { evidence?: Wall['evidence'] }; extra?: ReactNode }) {
  const t = useT()
  const ev = el.evidence
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ev && <CertaintyBadge c={ev.certainty} label={t.certainty[ev.certainty]} />}
      {extra}
      {ev?.basis && <span className="min-w-0 basis-full truncate px-1 pt-0.5 text-[12px] text-ink-500">「{ev.basis}」{ev.confirmed && <span className="text-mint-700"> · {fmt(t.confirmedBy, { who: ev.confirmed.by })}</span>}</span>}
    </div>
  )
}

export function Actions({ onAgent, removeLabel, onRemove, disabledRemove, extra }: { onAgent(): void; removeLabel?: string; onRemove?(): void; disabledRemove?: boolean; extra?: ReactNode }) {
  const t = useT()
  const confirm = useStore(s => s.confirm)
  return (
    // 二次确认放进吸底的操作区里：滚动时不会被操作行盖住，主按钮旁边就是确认
    <div className="sticky -bottom-5 z-10 -mx-4 -mb-5 mt-auto flex flex-col gap-2 rounded-b-[30px] bg-[linear-gradient(to_top,rgb(251_251_253/0.96)_58%,rgb(251_251_253/0))] px-4 pb-5 pt-4 max-md:rounded-none max-md:pb-[max(20px,env(safe-area-inset-bottom))]">
    <AnimatePresence>{confirm && <ConfirmCard confirm={confirm} />}</AnimatePresence>
    <div className="flex items-center gap-2">
      <Pill tone="ink" size="md" onClick={onAgent} className="flex-1 pl-1.5" data-testid="inspector-agent">
        <span className="grid size-7 place-items-center rounded-full bg-lav-300 text-lav-800"><Sparkles size={14} strokeWidth={2.4} /></span>
        {t.act.agent}
        <span className="num ml-1 rounded-[6px] bg-white/14 px-1.5 py-0.5 text-[10.5px] text-white/70 max-md:hidden">A</span>
      </Pill>
      {extra}
      {onRemove && (
        <Tip label={removeLabel ?? t.act.remove} kbd="⌫" side="top">
          <Pill tone="coral" size="md" onClick={onRemove} disabled={disabledRemove} className="px-3.5" data-testid="inspector-remove"><Trash size={15} strokeWidth={2.3} />{removeLabel}</Pill>
        </Tip>
      )}
    </div>
    </div>
  )
}

/* 原始模式删管道井：轻确认（墨色，不是珊瑚——这不是拆，是纠正读图） */
/** 三种二次确认挑一种：管道井、受保护的墙、拆墙后合并房间 */
export function ConfirmCard({ confirm }: { confirm: Confirm }) {
  if (confirm.kind === 'shaft') return <ShaftConfirm onConfirm={confirm.yes} onCancel={confirm.no} />
  if (confirm.kind === 'merge') return <MergeConfirm confirm={confirm} />
  return <ProtectConfirm text={confirm.text} onConfirm={confirm.yes} onCancel={confirm.no} />
}

/* 改造态手动拆墙后：墙占的地方怎么算——合成一间，或者两间都留着、算给其中一侧（线上 bug B4；Agent 按手册自己写 update / remove room） */
export function MergeConfirm({ confirm }: { confirm: Confirm }) {
  const lang = useStore(s => s.lang), t = useT()
  const canMerge = !!confirm.canMerge
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden" data-testid="merge-confirm">
      <div className="tile rounded-[18px] p-3.5">
        <div className="text-[13.5px] font-semibold text-ink-900">{t.footprint.title}</div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600">{confirm.text}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {canMerge && <Pill tone="ink" size="sm" onClick={confirm.yes} data-testid="confirm-yes">{lang === 'zh' ? '合成一间' : 'Merge'}</Pill>}
          {confirm.choices?.map(c => <Pill key={c.testId} tone="tile" size="sm" onClick={c.run} data-testid={c.testId} className="max-w-full truncate">{c.label}</Pill>)}
          <Pill tone="plain" size="sm" onClick={confirm.no} data-testid="confirm-no">{t.footprint.leave}</Pill>
        </div>
      </div>
    </motion.div>
  )
}

export function ShaftConfirm({ onConfirm, onCancel }: { onConfirm(): void; onCancel(): void }) {
  const lang = useStore(s => s.lang)
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden" data-testid="shaft-confirm">
      <div className="tile rounded-[18px] p-3.5">
        <div className="text-[13.5px] font-semibold text-ink-900">{lang === 'zh' ? '这是在纠正读图吗？' : 'Correcting the drawing?'}</div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-600">{lang === 'zh' ? '管道井、烟道拆不了。图上读错了、画错了才删；想改造请到改造里看。' : 'Shafts can’t be removed. Delete only if the drawing was read wrong.'}</p>
        <div className="mt-3 flex gap-2">
          <Pill tone="ink" size="sm" onClick={onConfirm} data-testid="confirm-yes">{lang === 'zh' ? '是，删掉' : 'Yes, delete'}</Pill>
          <Pill tone="plain" size="sm" onClick={onCancel} data-testid="confirm-no">{lang === 'zh' ? '不删' : 'Keep'}</Pill>
        </div>
      </div>
    </motion.div>
  )
}

/* 受保护墙的二次确认（参考图 2 的「锁」语义） */
export function ProtectConfirm({ text, onConfirm, onCancel }: { text?: string; onConfirm(): void; onCancel(): void }) {
  const t = useT(), lang = useStore(s => s.lang), column = useStore(s => s.sel.length === 1 && s.sel[0].type === 'column')
  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
      <div className="hatch-coral rounded-[18px] bg-coral-50 p-3.5 ring-1 ring-inset ring-coral-200">
        <div className="flex items-center gap-2 text-[13.5px] font-semibold text-coral-700"><TriangleAlert size={16} />{column ? (lang === 'zh' ? '这是承重柱' : 'Load-bearing column') : lang === 'zh' ? '涉及承重墙 / 外墙 / 承重情况不确定的墙' : 'Load-bearing / exterior / unknown load-bearing status wall'}</div>
        {text && <p className="mt-1.5 text-[12.5px] font-semibold leading-relaxed text-coral-700" data-testid="confirm-touches">{text}</p>}
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-700">{t.protectedNote}</p>
        <div className="mt-3 flex gap-2">
          <Pill tone="coral" size="sm" onClick={onConfirm} className="bg-coral-500 text-white hover:bg-coral-700" data-testid="confirm-yes">{lang === 'zh' ? '我确认，记下这条改造' : 'Confirm & record'}</Pill>
          <Pill tone="plain" size="sm" onClick={onCancel} data-testid="confirm-no">{lang === 'zh' ? '先不改' : 'Cancel'}</Pill>
        </div>
      </div>
    </motion.div>
  )
}

/* Agent 的待确认提议 */
function ProposalCallout({ c }: { c: Change }) {
  const t = useT()
  const { confirmChange, revertChange } = useStore.getState()
  return (
    <div className="hatch-lav rounded-[18px] bg-lav-50 p-3.5 ring-1 ring-inset ring-lav-200">
      <div className="flex items-center gap-2">
        <span className="grid size-6 place-items-center rounded-full bg-lav-300 text-lav-800"><Sparkles size={12} strokeWidth={2.6} /></span>
        <span className="text-[12.5px] font-semibold text-lav-800">{t.changes.byAgent}</span>
        <Tag tone="ink" icon={<Lock size={10} strokeWidth={3} />} className="ml-auto">{t.changes.pending}</Tag>
      </div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-700">{c.note}</p>
      <div className="mt-3 flex gap-2">
        <Pill tone="ink" size="sm" onClick={() => confirmChange(c.id)}><Check size={14} strokeWidth={2.6} />{t.act.confirm}</Pill>
        <Pill tone="plain" size="sm" onClick={() => revertChange(c.id)}><Undo2 size={14} />{t.act.revert}</Pill>
      </div>
    </div>
  )
}

/* ───────── 各类构件 ───────── */
function WallBody({ plan, w }: { plan: Plan; w: Wall }) {
  const t = useT()
  const mode = useStore(s => s.mode), base = useStore(s => s.base)!
  const { select, openAgent } = useStore.getState()
  const removeEl = (r: Ref) => removeRefs([r])
  const view = useView()!
  const ref: Ref = { type: 'wall', id: w.id }
  const prot = PROTECTED_KINDS.includes(w.kind)
  const ro = mode === 'compare'
  const H = effectiveWallHeight(plan, w)
  const sides = roomsBesideWall(plan, w.id)
  const ops = openingsOn(plan, w.id)
  const pending = base.changes.filter(c => view.results.find(r => r.id === c.id)?.needsConfirm && ((c.data as { wall?: string } | undefined)?.wall === w.id || c.target === w.id))
  const isHalf = w.kind === 'half' || w.kind === 'half-glass'
  const arc = arcParams(w), chord = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1])
  const measuring = useStore(s => s.measure?.from === w.id)
  // 弧墙三种输入：矢高（正 = 朝法向 n 鼓）、圆心角（同号）、半径（保持当前的鼓向和优 / 劣弧）
  const setBulge = (b: number) => patch(ref, { bulge: Math.abs(b) < 0.5 ? 0 : Math.round(b * 10) / 10 })
  const setAngle = (a: number) => { try { setBulge(Math.abs(a) < 0.05 ? 0 : bulgeFromAngle(chord, a)) } catch (e) { useStore.getState().showToast(e instanceof Error ? e.message : String(e)) } }
  const setRadius = (r: number) => { try { setBulge(Math.sign(w.bulge || 1) * bulgeFromRadius(chord, r, !!arc && Math.abs(arc.angle) > 180)) } catch (e) { useStore.getState().showToast(e instanceof Error ? e.message : String(e)) } }
  const tagDiff = view.diff?.added.has(w.id) ? <Tag tone="cobalt">{t.addedTag}</Tag> : view.diff?.modified.has(w.id) ? <Tag tone="cobalt">{t.modifiedTag}</Tag> : null
  return (
    <>
      <Header
        icon={<BrickWall size={19} strokeWidth={2.1} />}
        iconCls={prot ? 'bg-ink-900 text-white' : w.kind === 'glass' || w.kind === 'half-glass' ? 'bg-[#d6ecfa] text-[#23739f]' : 'bg-ink-150 text-ink-700'}
        badge={prot ? <span className="absolute -bottom-0.5 -right-0.5 grid size-[18px] place-items-center rounded-full bg-white text-ink-900 ring-2 ring-white/80 shadow"><Lock size={10} strokeWidth={3} /></span> : null}
        title={w.name ?? t.wall[w.kind]}
        sub={<><span>{t.wall[w.kind]}</span><span className="text-ink-300">·</span><span className="num">{w.id}</span></>}
        onClose={() => select(null)} />
      <Evidence el={w} extra={<>{prot && <Tag tone="ink" icon={<Lock size={10} strokeWidth={3} />}>{t.protected}</Tag>}{tagDiff}</>} />
      {pending.map(c => <ProposalCallout key={c.id} c={c} />)}
      <Visual label={t.prop.elevation}><WallElevation plan={plan} wall={w} proposals={pending.filter(c => c.op === 'add' && c.type === 'opening').map(c => c.data as unknown as Opening)} /></Visual>

      <div>
        <SectionLabel>{t.prop.kind}</SectionLabel>
        <div className="grid grid-cols-3 gap-1.5">
          {WALL_KINDS.map(k => (
            <button key={k} disabled={ro} onClick={() => patch(ref, { kind: k, thickness: DEFAULTS.thickness[k] === DEFAULTS.thickness[w.kind] ? w.thickness : w.thickness })}
              className={cn('flex h-10 items-center gap-1.5 rounded-[14px] px-2.5 text-[12.5px] font-semibold transition',
                w.kind === k ? 'bg-mint-100 text-mint-900 ring-[1.5px] ring-inset ring-mint-400' : 'tile text-ink-700 hover:bg-white', ro && w.kind !== k && 'opacity-50')}>
              <WallSwatch kind={k} />
              <span className="truncate">{t.wallShort[k]}</span>
              {PROTECTED_KINDS.includes(k) && <Lock size={10} strokeWidth={2.6} className="ml-auto shrink-0 text-ink-400" />}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <Num label={t.prop.thickness} testId="thickness" value={w.thickness} unit="mm" step={10} min={40} max={600} onChange={v => patch(ref, { thickness: v })} disabled={ro} />
        <Field label={t.prop.length}><ReadValue v={(wallLength(w) / 1000).toFixed(2)} unit="m" note={arc ? fmt(t.s2a.arc.chord, { v: (chord / 1000).toFixed(2) }) : undefined} /></Field>
        {isHalf
          ? <Num label={t.prop.lowHeight} value={w.lowHeight ?? DEFAULTS.lowHeight} unit="m" step={0.05} digits={2} min={0.3} max={H} onChange={v => patch(ref, { lowHeight: v })} disabled={ro} />
          : <Field label={t.prop.height}><ReadValue v={H.toFixed(2)} unit="m" note={w.height === undefined ? (useStore.getState().lang === 'zh' ? '跟随层高' : 'auto') : undefined} /></Field>}
        <Field label={t.prop.beside}>
          <div className="flex h-9 items-center gap-1 truncate px-1 text-[12.5px] font-medium text-ink-700">
            <span className="truncate">{sides.negative.map(r => r.name).join('、') || '—'}</span>
            <span className="text-ink-300">|</span>
            <span className="truncate">{sides.positive.map(r => r.name).join('、') || (useStore.getState().lang === 'zh' ? '室外' : 'outside')}</span>
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-3 gap-2" data-testid="arc-fields">
        <Num label={t.s2a.arc.sagitta} testId="arc-sagitta" value={Math.round(w.bulge ?? 0)} unit="mm" step={50} min={-Math.round(chord * 5)} max={Math.round(chord * 5)} onChange={setBulge} disabled={ro} />
        <Num label={t.s2a.arc.angle} testId="arc-angle" value={arc ? +arc.angle.toFixed(1) : 0} unit="°" step={5} digits={0} min={-340} max={340} onChange={setAngle} disabled={ro} />
        <Num label={t.s2a.arc.radius} testId="arc-radius" value={arc ? Math.round(arc.radius) : null} placeholder={t.s2a.arc.straight} unit="mm" step={100} min={Math.ceil(chord / 2)} max={Math.round(chord * 200)} onChange={setRadius} disabled={ro} />
      </div>

      {ops.length > 0 && (
        <div>
          <SectionLabel right={<span className="num text-[11.5px] font-semibold text-ink-400">{ops.length}</span>}>{t.prop.openingsOnWall}</SectionLabel>
          <div className="tile divide-y divide-ink-900/5 overflow-hidden rounded-[16px]">
            {ops.map(o => (
              <button key={o.id} onClick={() => select({ type: 'opening', id: o.id })} className="flex h-11 w-full items-center gap-2.5 px-3 text-left transition hover:bg-white">
                <span className="grid size-7 place-items-center rounded-full bg-ink-100 text-ink-600">{openingIcon(o.kind, 14)}</span>
                <span className="flex-1 truncate text-[13px] font-medium text-ink-800">{o.name ?? t.opening[o.kind]}</span>
                <span className="num text-[12px] font-semibold text-ink-500">{o.width}</span>
                <ChevronRight size={14} className="text-ink-300" />
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === 'renovation' && <RemoveRange key={w.id} w={w} ops={ops} />}

      <Actions onAgent={() => openAgent(true)}
        removeLabel={mode === 'renovation' ? t.act.remove : undefined}
        onRemove={mode === 'compare' ? undefined : () => removeEl(ref)}
        extra={<>
          <Tip label={t.s2a.measure.tip} side="top"><RoundButton tone={measuring ? 'ink' : 'tile'} size="md" aria-label={t.s2a.measure.btn} aria-pressed={measuring} data-testid="inspector-measure" onClick={() => useStore.getState().setMeasure(measuring ? null : { from: w.id, to: null })}><Ruler size={16} strokeWidth={2.2} /></RoundButton></Tip>
          {mode === 'original' ? <Tip label={useStore.getState().lang === 'zh' ? '在此处分段（最近点选的位置）' : 'Split here (last click)'} side="top"><RoundButton tone="tile" size="md" aria-label={t.act.split} data-testid="inspector-split" onClick={() => splitSelectedWall(w.id)}><Scissors size={16} strokeWidth={2.2} /></RoundButton></Tip> : null}
        </>} />
    </>
  )
}


/** 改造态只拆墙的一段：输入范围（从 a 端量），画布上标出来。范围里的门窗不能留在拆掉的墙上：要么一起拆，要么收缩范围避开 */
function RemoveRange({ w, ops }: { w: Wall; ops: Opening[] }) {
  const t = useT().rangeRemove, len = Math.round(wallLength(w))
  const point = useStore(s => s.selPoint)
  const [open, setOpen] = useState(false)
  const [range, setRange] = useState<[number, number]>(() => {
    const c = point ? projectToWall(w, point).s : len / 2, half = Math.min(450, len / 2), from = Math.round(clamp(c - half, 0, len - half * 2) / 10) * 10
    return [from, Math.min(len, from + half * 2)]
  })
  const [from, to] = range
  useEffect(() => { useStore.setState({ removeRange: open ? { wall: w.id, from, to } : null }) }, [open, w.id, from, to])
  useEffect(() => () => useStore.setState({ removeRange: null }), [])
  // 卡片在面板最下面，会被吸底的操作行盖住：展开时滚到中间
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) card.current?.scrollIntoView({ block: 'center' }) }, [open])
  if (!open) return <Pill tone="tile" size="sm" onClick={() => setOpen(true)} className="self-start" data-testid="range-open"><Scissors size={13} />{t.open}</Pill>
  const covered = ops.filter(o => o.offset < to && o.offset + o.width > from)
  // 范围里最长的一段没有门窗的
  const free = () => {
    let best: [number, number] | null = null, at = from
    for (const o of [...covered].sort((a, b) => a.offset - b.offset)) { if (o.offset > at && (!best || o.offset - at > best[1] - best[0])) best = [at, o.offset]; at = Math.max(at, o.offset + o.width) }
    if (to > at && (!best || to - at > best[1] - best[0])) best = [at, to]
    return best && best[1] - best[0] >= 100 ? best : null
  }
  const gap = free()
  return (
    <div ref={card} className="tile flex flex-col gap-2.5 rounded-[16px] p-3" data-testid="range-card">
      <div className="text-[12.5px] font-semibold text-ink-800">{t.title}</div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label={t.from} value={from} unit="mm" step={10} min={0} max={to - 10} testId="range-from" onChange={v => setRange([Math.round(v), to])} />
        <NumberField label={t.to} value={to} unit="mm" step={10} min={from + 10} max={len} testId="range-to" onChange={v => setRange([from, Math.round(v)])} />
      </div>
      <div className="text-[11.5px] leading-snug text-ink-500">{fmt(t.hint, { n: to - from, len })}</div>
      {covered.length > 0 && <div className="text-[12px] font-semibold leading-snug text-coral-700" data-testid="range-covered">{fmt(t.covered, { names: covered.map(o => o.name ?? o.id).join('、') })}</div>}
      <div className="flex flex-wrap gap-1.5">
        <Pill tone="coral" size="sm" onClick={() => removeWallRange(w.id, from, to)} data-testid="range-remove">{covered.length ? t.removeWith : t.remove}</Pill>
        {covered.length > 0 && gap && <Pill tone="tile" size="sm" onClick={() => setRange(gap)} data-testid="range-avoid">{t.avoid}</Pill>}
        <Pill tone="plain" size="sm" onClick={() => setOpen(false)}>{t.cancel}</Pill>
      </div>
    </div>
  )
}

function OpeningBody({ plan, o }: { plan: Plan; o: Opening }) {
  const t = useT()
  const mode = useStore(s => s.mode), lang = useStore(s => s.lang)
  const { select, openAgent } = useStore.getState()
  const removeEl = (r: Ref) => removeRefs([r])
  const view = useView()!
  const ref: Ref = { type: 'opening', id: o.id }
  const ro = mode === 'compare'
  const host = plan.walls.find(w => w.id === o.wall)
  const span = spanOf(plan, o)
  // 开向用门所在位置两侧的房间名说（「开向 次卧」比「朝法向」好懂）
  const toward = (side: 1 | -1) => {
    if (!span) return side === 1 ? t.sideIn : t.sideOut
    const d = span.wall.thickness / 2 + 120
    const p: [number, number] = [span.center[0] + span.normal[0] * d * side, span.center[1] + span.normal[1] * d * side]
    return plan.rooms.find(r => pointInPolygon(p, r.poly))?.name ?? (lang === 'zh' ? '室外' : 'outside')
  }
  const tagDiff = view.diff?.added.has(o.id) ? <Tag tone="cobalt">{t.addedTag}</Tag> : view.diff?.modified.has(o.id) ? <Tag tone="cobalt">{t.modifiedTag}</Tag> : null
  return (
    <>
      <Header icon={openingIcon(o.kind)} iconCls="bg-white text-ink-800 ring-1 ring-inset ring-ink-900/6"
        title={o.name ?? t.opening[o.kind]}
        sub={<><span>{t.opening[o.kind]}</span><span className="text-ink-300">·</span><span className="num">{o.id}</span>{o.entry && <><span className="text-ink-300">·</span><span>{lang === 'zh' ? '入户' : 'Entry'}</span></>}</>}
        onClose={() => select(null)} />
      <Evidence el={o} extra={tagDiff} />
      {host && <Visual label={t.prop.elevation}><WallElevation plan={plan} wall={host} highlight={o.id} /></Visual>}
      <div>
        <SectionLabel>{t.prop.kind}</SectionLabel>
        <div className="flex flex-wrap gap-1.5">
          {OPEN_KINDS.map(k => (
            <button key={k} disabled={ro} onClick={() => { const d = DEFAULTS.opening[k]; patch(ref, { kind: k, sill: d.sill, head: d.head, ...(k === 'door' && !o.swing ? { swing: { hinge: 'start', side: 1 } } : {}) }) }}
              className={cn('h-8 rounded-full px-3 text-[12.5px] font-semibold transition', o.kind === k ? 'bg-mint-100 text-mint-900 ring-[1.5px] ring-inset ring-mint-400' : 'tile text-ink-600 hover:bg-white hover:text-ink-900', ro && o.kind !== k && 'opacity-50')}>
              {t.opening[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Num label={t.prop.width} testId="o-width" value={o.width} unit="mm" step={50} min={300} max={host ? Math.floor(wallLength(host)) : 6000} onChange={v => patch(ref, { width: v })} disabled={ro} />
        <Num label={t.prop.sill} testId="sill" value={o.sill} unit="m" step={0.05} digits={2} min={0} max={+(o.head - 0.1).toFixed(2)} onChange={v => patch(ref, { sill: v })} disabled={ro || o.kind === 'door' || o.kind === 'doorway' || o.kind === 'sliding'} />
        <Num label={t.prop.head} testId="head" value={o.head} unit="m" step={0.05} digits={2} min={+(o.sill + 0.1).toFixed(2)} max={host ? +effectiveWallHeight(plan, host).toFixed(2) : 3} onChange={v => patch(ref, { head: v })} disabled={ro} />
        <Num label={t.prop.fromA} testId="offset" value={o.offset} unit="mm" step={50} min={0} max={host ? Math.floor(wallLength(host) - o.width) : 0} onChange={v => patch(ref, { offset: v })} disabled={ro} />
      </div>
      {(o.kind === 'window' || o.kind === 'floor-window' || o.kind === 'bay-window' || o.kind === 'sliding') && (
        <Field label={t.panes}>
          <MiniSeg value={String(Math.min(4, Math.max(1, o.panes?.length ?? (o.kind === 'sliding' ? 2 : 1))))} disabled={ro}
            options={['1', '2', '3', '4'].map(n => ({ v: n, l: fmt(t.paneN, { n }) }))}
            onChange={v => patch(ref, { panes: Array.from({ length: +v }, () => ({ width: 1 / +v, kind: o.kind === 'sliding' ? 'sliding' as const : +v > 1 ? 'casement' as const : 'fixed' as const })) })} />
        </Field>
      )}
      {host?.bulge && o.kind !== 'doorway' && o.kind !== 'open-balcony' && (
        // 弧墙上的门窗（D6 B9）：只陈述事实，不拦
        <div data-testid="arc-opening-note" className="tile-sunken rounded-[14px] px-3 py-2 text-[12px] font-medium leading-snug text-ink-500">
          {lang === 'zh' ? '弧形的玻璃、门一般要定制，可行性待专业确认' : 'Curved glass and doors are usually made to order; check feasibility with a professional'}
        </div>
      )}
      {o.kind === 'door' && o.swing && (
        <div className="grid grid-cols-2 gap-2.5">
          <Field label={t.prop.hinge}>
            <MiniSeg value={o.swing.hinge} disabled={ro} options={[{ v: 'start', l: t.hingeStart }, { v: 'end', l: t.hingeEnd }]} onChange={v => patch(ref, { swing: { ...o.swing!, hinge: v } })} />
          </Field>
          <Field label={t.prop.swing}>
            <MiniSeg value={String(o.swing.side)} disabled={ro} options={[{ v: '1', l: toward(1) }, { v: '-1', l: toward(-1) }]} onChange={v => patch(ref, { swing: { ...o.swing!, side: +v as 1 | -1 } })} />
          </Field>
        </div>
      )}
      {host && (
        <button onClick={() => select({ type: 'wall', id: host.id })} className="tile flex h-11 w-full items-center gap-2.5 rounded-[16px] px-3 text-left transition hover:bg-white">
          <WallSwatch kind={host.kind} />
          <span className="text-[12px] font-semibold text-ink-500">{t.prop.onWall}</span>
          <span className="flex-1 truncate text-[13px] font-medium text-ink-800">{host.name ?? t.wall[host.kind]}</span>
          <span className="num text-[12px] font-semibold text-ink-500">{t.prop.fromA} {(o.offset / 1000).toFixed(2)} m</span>
          <ChevronRight size={14} className="text-ink-300" />
        </button>
      )}
      <Actions onAgent={() => openAgent(true)} onRemove={ro ? undefined : () => removeEl(ref)} removeLabel={mode === 'renovation' ? (lang === 'zh' ? '封掉' : 'Fill') : undefined} />
    </>
  )
}

export function MiniSeg<T extends string>({ value, options, onChange, disabled }: { value: T; options: { v: T; l: string }[]; onChange(v: T): void; disabled?: boolean }) {
  return (
    <div className="tile-sunken flex h-9 rounded-full p-0.5">
      {options.map(o => (
        <button key={o.v} disabled={disabled} onClick={() => onChange(o.v)}
          className={cn('flex-1 truncate rounded-full px-2 text-[12px] font-semibold transition', value === o.v ? 'bg-white text-ink-900 shadow-[0_1px_3px_rgb(0_0_0/0.12)]' : 'text-ink-500 hover:text-ink-800')}>{o.l}</button>
      ))}
    </div>
  )
}

function RoomBody({ plan, r }: { plan: Plan; r: Room }) {
  const t = useT()
  const mode = useStore(s => s.mode), lang = useStore(s => s.lang)
  const { select, openAgent } = useStore.getState()
  const view = useView()!
  const ref: Ref = { type: 'room', id: r.id }
  const ro = mode === 'compare'
  const area = roomArea(r)
  const before = view.diff?.modified.has(r.id) ? view.base.rooms.find(x => x.id === r.id) : undefined
  return (
    <>
      <Header icon={<Square size={18} strokeWidth={2.2} />} iconCls="bg-mint-200 text-mint-900" title={r.name}
        sub={<><span>{r.use ?? t.el.room}</span><span className="text-ink-300">·</span><span className="num">{r.id}</span></>} onClose={() => select(null)} />
      <Evidence el={r} extra={before ? <Tag tone="cobalt">{lang === 'zh' ? `原「${before.name}」` : `was “${before.name}”`}</Tag> : null} />
      <div className="tile flex items-end justify-between rounded-[18px] px-4 pb-3 pt-3">
        <div>
          <div className="text-[11.5px] font-semibold text-ink-500">{t.prop.area}</div>
          <div className="mt-0.5 flex items-baseline gap-1"><span className="num text-[34px] font-semibold leading-none tracking-[-0.03em] text-ink-900">{area.toFixed(1)}</span><span className="text-[14px] font-semibold text-ink-400">{t.sqm}</span></div>
        </div>
        <label className="flex items-center gap-2 pb-0.5 text-[12px] font-semibold text-ink-500">{t.prop.counted}<Switch on={r.counted !== false} onChange={v => !ro && patch(ref, { counted: v })} /></label>
      </div>
      <Field label={t.name}>
        <input value={r.name} disabled={ro} onChange={e => patch(ref, { name: e.target.value })} data-testid="room-name"
          className="tile-sunken h-9 w-full rounded-full px-3.5 text-[13.5px] font-semibold text-ink-900 outline-none focus:ring-2 focus:ring-mint-300" />
      </Field>
      <Visual label={t.prop.section}><RoomSection plan={plan} room={r} /></Visual>
      <div className="grid grid-cols-2 gap-2.5">
        <Num label={t.prop.ceiling} testId="ceiling" value={r.ceiling ?? levelCeiling(plan, levelOf(plan, r).id)} unit="m" step={0.05} digits={2} min={2} max={6} onChange={v => patch(ref, { ceiling: v })} disabled={ro} />
        {/* 地面高差：正 = 抬高（飘窗台），负 = 降板（卫生间、阳台台阶） */}
        <Num label={t.prop.floorOffset} testId="floor-offset" value={r.floorOffset ?? 0} unit="m" step={0.01} digits={2} min={-0.6} max={1.2} onChange={v => patch(ref, { floorOffset: v })} disabled={ro} />
      </div>
      <Actions onAgent={() => openAgent(true)} />
    </>
  )
}

function BeamBody({ plan, b }: { plan: Plan; b: Beam }) {
  const t = useT()
  const mode = useStore(s => s.mode)
  const { select, openAgent } = useStore.getState()
  const removeEl = (r: Ref) => removeRefs([r])
  const ref: Ref = { type: 'beam', id: b.id }
  const ro = mode === 'compare'
  const room = plan.rooms.find(r => pointInPolygon([(b.a[0] + b.b[0]) / 2, (b.a[1] + b.b[1]) / 2], r.poly))
  return (
    <>
      <Header icon={<Rows2 size={18} strokeWidth={2.2} />} iconCls="bg-ink-150 text-ink-700" title={b.name ?? t.el.beam}
        sub={<><span>{t.el.beam}</span><span className="text-ink-300">·</span><span className="num">{b.id}</span></>} onClose={() => select(null)} />
      <Evidence el={b} />
      {room && <Visual label={t.prop.section}><RoomSection plan={plan} room={room} highlight={b.id} /></Visual>}
      <div className="grid grid-cols-2 gap-2.5">
        <Num label={t.prop.bottom} value={b.bottom} unit="m" step={0.05} digits={2} min={1.8} max={4} onChange={v => patch(ref, { bottom: v })} disabled={ro} />
        <Num label={t.prop.beamWidth} value={b.width} unit="mm" step={10} min={100} max={800} onChange={v => patch(ref, { width: v })} disabled={ro} />
        <Field label={t.prop.length}><ReadValue v={(len2(b.a, b.b) / 1000).toFixed(2)} unit="m" /></Field>
      </div>
      <Actions onAgent={() => openAgent(true)} onRemove={ro ? undefined : () => removeEl(ref)} />
    </>
  )
}

function GhostBody({ base, target: r }: { base: Plan; target: Ref }) {
  const t = useT(), lang = useStore(s => s.lang)
  const { select, revertChange } = useStore.getState()
  const el = findEl(base, r) as Wall | Opening | undefined
  const c = base.changes.find(c => c.op === 'remove' && c.target === r.id)
    ?? (r.type === 'opening' ? base.changes.find(c => c.op === 'remove' && c.type === 'wall' && c.target === (el as Opening)?.wall) : undefined)
  if (!el) return null
  return (
    <>
      <Header icon={r.type === 'wall' ? <BrickWall size={19} /> : openingIcon((el as Opening).kind)} iconCls="bg-coral-100 text-coral-700"
        title={elementLabel(base, r, lang)} sub={<><Tag tone="coral">{t.removedTag}</Tag><span className="num">{r.id}</span></>} onClose={() => select(null)} />
      {r.type === 'wall' && <Visual label={t.prop.elevation}><WallElevation plan={base} wall={el as Wall} /></Visual>}
      <p className="px-1 text-[12.5px] leading-relaxed text-ink-600">{t.ghostNote}</p>
      {c && (
        <div className="tile flex items-center gap-3 rounded-[16px] p-3">
          <span className="grid size-8 place-items-center rounded-full bg-coral-100 text-coral-700"><Trash size={14} /></span>
          <span className="flex-1 text-[13px] font-medium leading-snug text-ink-800">{c.note ?? t.changes.removed}</span>
          <Pill size="sm" tone="tile" onClick={() => revertChange(c.id)}><Undo2 size={14} />{t.act.revert}</Pill>
        </div>
      )}
    </>
  )
}

function MultiBody({ plan, sel }: { plan: Plan; sel: Ref[] }) {
  const t = useT(), lang = useStore(s => s.lang)
  const { select, openAgent } = useStore.getState()
  return (
    <>
      <Header icon={<span className="num text-[15px] font-bold">{sel.length}</span>} iconCls="bg-ink-900 text-white"
        title={lang === 'zh' ? `已选 ${sel.length} 个构件` : `${sel.length} selected`} sub={t.agent.addMore} onClose={() => select(null)} />
      <div className="flex flex-wrap gap-1.5">
        {sel.map(r => (
          <button key={r.id} onClick={() => select(r, true)} className="tile group flex h-8 items-center gap-1.5 rounded-full pl-2.5 pr-2 text-[12.5px] font-semibold text-ink-700">
            {elementLabel(plan, r, lang)}<span className="num text-[11px] text-ink-400">{r.id}</span><X size={12} className="text-ink-300 group-hover:text-ink-700" />
          </button>
        ))}
      </div>
      <Actions onAgent={() => openAgent(true)} />
    </>
  )
}

/* ───────── 柱 / 管道井 / 楼梯 / 挑空（S2a） ───────── */
/** 轴对齐矩形的外包框；不是矩形返回 null（Agent 写的任意多边形只读显示尺寸） */
function rectOf(poly: [number, number][]): [number, number, number, number] | null {
  if (poly.length !== 4) return null
  const xs = [...new Set(poly.map(p => Math.round(p[0] * 10) / 10))], ys = [...new Set(poly.map(p => Math.round(p[1] * 10) / 10))]
  if (xs.length !== 2 || ys.length !== 2) return null
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}
const rectPoly = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
function levelSub(plan: Plan, el: { level?: string }, lang: string) {
  if (levelsOf(plan).length < 2) return null
  return <><span className="text-ink-300">·</span><span>{levelOf(plan, el).name}</span></>
}
function extraRemove(mode: string, ref: Ref) {
  return mode === 'compare' ? undefined : () => removeRefs([ref])
}

function ColumnBody({ plan, c }: { plan: Plan; c: Column }) {
  const t = useT(), mode = useStore(s => s.mode), lang = useStore(s => s.lang)
  const { select, openAgent } = useStore.getState()
  const ref: Ref = { type: 'column', id: c.id }, ro = mode === 'compare', X = t.s2a.column
  const prot = c.kind === 'bearing'
  return (
    <>
      <Header icon={<ExtraIcon type="column" size={19} />} iconCls={prot ? 'bg-ink-900 text-white' : 'bg-ink-150 text-ink-700'}
        badge={prot ? <span className="absolute -bottom-0.5 -right-0.5 grid size-[18px] place-items-center rounded-full bg-white text-ink-900 ring-2 ring-white/80 shadow"><Lock size={10} strokeWidth={3} /></span> : null}
        title={c.name ?? (prot ? X.bearing : X.decorative)} sub={<><span>{t.el.column}</span><span className="text-ink-300">·</span><span className="num">{c.id}</span>{levelSub(plan, c, lang)}</>} onClose={() => select(null)} />
      <Evidence el={c} extra={prot ? <Tag tone="ink" icon={<Lock size={10} strokeWidth={3} />}>{t.protected}</Tag> : null} />
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={X.shape}><MiniSeg value={c.shape} disabled={ro} options={[{ v: 'rect', l: X.rect }, { v: 'round', l: X.round }]} onChange={v => patch(ref, v === 'round' ? { shape: v, size: [c.size[0], c.size[0]] } : { shape: v })} /></Field>
        <Field label={X.kind}><MiniSeg value={c.kind} disabled={ro} options={[{ v: 'bearing', l: X.bearing }, { v: 'decorative', l: X.decorative }]} onChange={v => patch(ref, { kind: v })} /></Field>
        {c.shape === 'round'
          ? <Num label={X.diameter} testId="col-d" value={c.size[0]} unit="mm" step={10} min={80} max={2000} onChange={v => patch(ref, { size: [v, v] })} disabled={ro} />
          : <>
              <Num label={X.width} testId="col-w" value={c.size[0]} unit="mm" step={10} min={50} max={3000} onChange={v => patch(ref, { size: [v, c.size[1]] })} disabled={ro} />
              <Num label={X.depth} testId="col-h" value={c.size[1]} unit="mm" step={10} min={50} max={3000} onChange={v => patch(ref, { size: [c.size[0], v] })} disabled={ro} />
            </>}
        {c.shape === 'rect' && <Num label={X.rotation} value={c.rotation ?? 0} unit="°" step={5} min={-180} max={180} onChange={v => patch(ref, { rotation: v })} disabled={ro} />}
      </div>
      <Actions onAgent={() => openAgent(true)} removeLabel={mode === 'renovation' ? t.act.remove : undefined} onRemove={extraRemove(mode, ref)} />
    </>
  )
}

function ShaftBody({ plan, sh }: { plan: Plan; sh: Shaft }) {
  const t = useT(), mode = useStore(s => s.mode), lang = useStore(s => s.lang)
  const { select, openAgent } = useStore.getState()
  const ref: Ref = { type: 'shaft', id: sh.id }, ro = mode === 'compare', X = t.s2a.shaft
  const r = rectOf(sh.poly)
  return (
    <>
      <Header icon={<ExtraIcon type="shaft" size={19} />} iconCls="bg-ink-900 text-white"
        badge={<span className="absolute -bottom-0.5 -right-0.5 grid size-[18px] place-items-center rounded-full bg-white text-ink-900 ring-2 ring-white/80 shadow"><Lock size={10} strokeWidth={3} /></span>}
        title={sh.name ?? X[sh.kind]} sub={<><span>{t.el.shaft}</span><span className="text-ink-300">·</span><span className="num">{sh.id}</span>{levelSub(plan, sh, lang)}</>} onClose={() => select(null)} />
      <Evidence el={sh} />
      <div data-testid="shaft-note" className="flex gap-2.5 rounded-[18px] bg-ink-900/[0.04] p-3 ring-1 ring-inset ring-ink-900/8">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink-900 text-white"><Lock size={13} strokeWidth={2.6} /></span>
        <p className="text-[12.5px] leading-relaxed text-ink-700">{X.note}</p>
      </div>
      <Field label={X.kind}><MiniSeg value={sh.kind} disabled={ro} options={(['flue', 'pipe', 'vent', 'other'] as const).map(k => ({ v: k, l: X[k] }))} onChange={v => patch(ref, { kind: v })} /></Field>
      {r && (
        <div className="grid grid-cols-2 gap-2.5">
          <Num label={t.s2a.column.width} value={Math.round(r[2] - r[0])} unit="mm" step={10} min={100} max={5000} onChange={v => patch(ref, { poly: rectPoly(r[0], r[1], r[0] + v, r[3]) })} disabled={ro} />
          <Num label={t.s2a.column.depth} value={Math.round(r[3] - r[1])} unit="mm" step={10} min={100} max={5000} onChange={v => patch(ref, { poly: rectPoly(r[0], r[1], r[2], r[1] + v) })} disabled={ro} />
        </div>
      )}
      {/* 改造态的「拆除」照样给，按下由 core 拦下并说明原因（比藏起按钮更清楚为什么不行） */}
      <Actions onAgent={() => openAgent(true)} removeLabel={mode === 'renovation' ? t.act.remove : undefined} onRemove={extraRemove(mode, ref)} />
    </>
  )
}

/** 直跑楼梯：从 path[0] 沿 path 方向，长 L、宽 W 的矩形 */
function straightStair(st: Stair): { start: [number, number]; dir: [number, number]; L: number } | null {
  if (st.path.length !== 2) return null
  const [a, b] = st.path, L = Math.hypot(b[0] - a[0], b[1] - a[1])
  return L > 0 ? { start: a, dir: [(b[0] - a[0]) / L, (b[1] - a[1]) / L], L } : null
}
function stairGeom(start: [number, number], dir: [number, number], L: number, W: number) {
  const n: [number, number] = [-dir[1], dir[0]], h = W / 2
  const end: [number, number] = [start[0] + dir[0] * L, start[1] + dir[1] * L]
  const poly: [number, number][] = [[start[0] + n[0] * h, start[1] + n[1] * h], [end[0] + n[0] * h, end[1] + n[1] * h], [end[0] - n[0] * h, end[1] - n[1] * h], [start[0] - n[0] * h, start[1] - n[1] * h]].map(p => [Math.round(p[0]), Math.round(p[1])])
  return { poly, path: [start, end] as [number, number][], width: W }
}

function StairBody({ plan, st }: { plan: Plan; st: Stair }) {
  const t = useT(), mode = useStore(s => s.mode), lang = useStore(s => s.lang)
  const { select, openAgent } = useStore.getState()
  const ref: Ref = { type: 'stair', id: st.id }, ro = mode === 'compare', X = t.s2a.stair
  const levels = levelsOf(plan), from = levels.find(l => l.id === st.level), above = levels.filter(l => from && l.elevation > from.elevation)
  const to = levels.find(l => l.id === st.to), rise = from && to ? (to.elevation - from.elevation) * 1000 : 0
  const autoSteps = Math.max(1, Math.ceil(rise / 170)), steps = st.steps ?? autoSteps
  const g = straightStair(st)
  return (
    <>
      <Header icon={<ExtraIcon type="stair" size={19} />} iconCls="bg-ink-150 text-ink-700"
        title={st.name ?? t.el.stair} sub={<><span>{from?.name ?? st.level} → {to?.name ?? st.to}</span><span className="text-ink-300">·</span><span className="num">{st.id}</span></>} onClose={() => select(null)} />
      <Evidence el={st} />
      {above.length > 0 && <Field label={X.to}><MiniSeg value={st.to} disabled={ro} options={above.map(l => ({ v: l.id, l: l.name }))} onChange={v => patch(ref, { to: v })} /></Field>}
      <div className="grid grid-cols-2 gap-2.5">
        {g ? <>
          <Num label={t.prop.length} testId="stair-len" value={Math.round(g.L)} unit="mm" step={50} min={600} max={12000} onChange={v => patch(ref, stairGeom(g.start, g.dir, v, st.width))} disabled={ro} />
          <Num label={X.width} testId="stair-w" value={st.width} unit="mm" step={50} min={500} max={3000} onChange={v => patch(ref, stairGeom(g.start, g.dir, g.L, v))} disabled={ro} />
        </> : <Num label={X.width} value={st.width} unit="mm" step={50} min={500} max={3000} onChange={v => patch(ref, { width: v })} disabled={ro} />}
        <Num label={X.steps} testId="stair-steps" value={steps} placeholder={X.auto} step={1} min={2} max={60} onChange={v => patch(ref, { steps: Math.round(v) })} disabled={ro} />
        <Field label={X.kind}><ReadValue v={X[st.kind]} unit="" note={rise ? fmt(X.rise, { h: Math.round(rise / steps) }) : undefined} /></Field>
      </div>
      <Actions onAgent={() => openAgent(true)} removeLabel={mode === 'renovation' ? t.act.remove : undefined} onRemove={extraRemove(mode, ref)} />
    </>
  )
}

function VoidBody({ plan, v }: { plan: Plan; v: Void }) {
  const t = useT(), mode = useStore(s => s.mode), lang = useStore(s => s.lang)
  const { select, openAgent } = useStore.getState()
  const ref: Ref = { type: 'void', id: v.id }, ro = mode === 'compare'
  const r = rectOf(v.poly)
  return (
    <>
      <Header icon={<ExtraIcon type="void" size={19} />} iconCls="bg-white text-ink-800 ring-1 ring-inset ring-ink-900/6"
        title={v.name ?? t.el.void} sub={<><span>{t.el.void}</span><span className="text-ink-300">·</span><span className="num">{v.id}</span>{levelSub(plan, v, lang)}</>} onClose={() => select(null)} />
      <Evidence el={v} />
      <p className="px-1 text-[12.5px] leading-relaxed text-ink-600">{t.s2a.void.note}</p>
      {r && (
        <div className="grid grid-cols-2 gap-2.5">
          <Num label={t.s2a.column.width} value={Math.round(r[2] - r[0])} unit="mm" step={50} min={300} max={20000} onChange={x => patch(ref, { poly: rectPoly(r[0], r[1], r[0] + x, r[3]) })} disabled={ro} />
          <Num label={t.s2a.column.depth} value={Math.round(r[3] - r[1])} unit="mm" step={50} min={300} max={20000} onChange={x => patch(ref, { poly: rectPoly(r[0], r[1], r[2], r[1] + x) })} disabled={ro} />
        </div>
      )}
      <Actions onAgent={() => openAgent(true)} removeLabel={mode === 'renovation' ? t.act.remove : undefined} onRemove={extraRemove(mode, ref)} />
    </>
  )
}

export function InspectorBody() {
  const view = useView()
  const sel = useStore(s => s.sel)
  if (!view || !sel.length) return null
  const { plan, base } = view
  if (sel.length > 1) return <MultiBody plan={plan} sel={sel} />
  const r = sel[0]
  const el = findEl(plan, r)
  if (!el) return findEl(base, r) ? <GhostBody base={base} target={r} /> : null
  if (r.type === 'wall') return <WallBody plan={plan} w={el as Wall} />
  if (r.type === 'opening') return <OpeningBody plan={plan} o={el as Opening} />
  if (r.type === 'room') return <RoomBody plan={plan} r={el as Room} />
  if (r.type === 'column') return <ColumnBody plan={plan} c={el as Column} />
  if (r.type === 'shaft') return <ShaftBody plan={plan} sh={el as Shaft} />
  if (r.type === 'stair') return <StairBody plan={plan} st={el as Stair} />
  if (r.type === 'void') return <VoidBody plan={plan} v={el as Void} />
  return <BeamBody plan={plan} b={el as Beam} />
}
