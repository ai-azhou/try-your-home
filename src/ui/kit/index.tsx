/**
 * 自写的特色组件：玻璃卡、圆形工具按钮、药丸分段、热点、徽章、数字框、开关、滑块。
 * 视觉规格见 docs/design.md §2–§3。
 */
import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { Tooltip as RT } from 'radix-ui'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Certainty, WallKind } from '@/core/types'

/* ───────── Glass ───────── */
export const Glass = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { strong?: boolean }>(
  ({ strong, className, ...p }, ref) => <div ref={ref} className={cn(strong ? 'glass-strong' : 'glass', className)} {...p} />,
)

/* ───────── Tooltip ───────── */
export function Tip({ label, kbd, side = 'bottom', children }: { label: ReactNode; kbd?: string; side?: 'top' | 'bottom' | 'left' | 'right'; children: ReactNode }) {
  return (
    <RT.Root delayDuration={350}>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content side={side} sideOffset={8}
          className="z-[80] flex items-center gap-2 rounded-[10px] bg-ink-900/92 px-2.5 py-1.5 text-[12px] font-medium text-white shadow-[0_8px_20px_-8px_rgb(0_0_0/0.4)] backdrop-blur-md data-[state=delayed-open]:animate-[shimmer-in_160ms_var(--ease-out)]">
          {label}
          {kbd && <span className="num rounded-[5px] bg-white/14 px-1.5 py-px text-[10.5px] text-white/80">{kbd}</span>}
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  )
}
export const TipProvider = RT.Provider

/* ───────── RoundButton ───────── */
/**
 * glass = 单独浮在画布上的小钮（二级玻璃：同一套高光和发丝线，模糊小一半）；
 * tile = 卡片里面的按钮（实心白块，不再模糊，避免玻璃套玻璃）。
 */
type Tone = 'glass' | 'tile' | 'ink' | 'mint' | 'lemon' | 'lav' | 'coral' | 'plain'
const toneCls: Record<Tone, string> = {
  glass: 'glass-chip glass-hover text-ink-800',
  tile: 'tile text-ink-800 hover:bg-white',
  plain: 'bg-transparent text-ink-600 hover:bg-white/70 hover:text-ink-900',
  ink: 'bg-ink-900 text-white shadow-[0_8px_18px_-8px_rgb(15_17_21/0.55),inset_0_1px_0_rgb(255_255_255/0.12)]',
  mint: 'bg-mint-200 text-mint-900 shadow-[inset_0_1px_0_rgb(255_255_255/0.6),0_6px_14px_-8px_rgb(18_130_94/0.5)]',
  lemon: 'bg-lemon-200 text-lemon-800 shadow-[inset_0_1px_0_rgb(255_255_255/0.6),0_6px_14px_-8px_rgb(143_154_23/0.5)]',
  lav: 'bg-lav-200 text-lav-800 shadow-[inset_0_1px_0_rgb(255_255_255/0.6),0_6px_14px_-8px_rgb(111_85_226/0.5)]',
  coral: 'bg-coral-100 text-coral-700 shadow-[inset_0_1px_0_rgb(255_255_255/0.6),0_6px_14px_-8px_rgb(178_58_44/0.45)]',
}
const sizeCls = { sm: 'size-8', md: 'size-10', lg: 'size-12', xl: 'size-14' }

export const RoundButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: Tone; size?: keyof typeof sizeCls; badge?: ReactNode; badgeTone?: 'ink' | 'lemon' | 'coral' | 'lav'
}>(({ tone = 'glass', size = 'md', badge, badgeTone = 'ink', className, children, ...p }, ref) => (
  <button ref={ref} {...p}
    className={cn('relative grid shrink-0 place-items-center rounded-full transition-[background-color,box-shadow,transform,color] duration-150 ease-[var(--ease-out)] active:scale-[0.94] disabled:opacity-40', sizeCls[size], toneCls[tone], className)}>
    {children}
    {badge !== undefined && badge !== null && badge !== 0 && (
      <span className={cn('num absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10.5px] font-bold ring-2 ring-white',
        badgeTone === 'ink' && 'bg-ink-900 text-white', badgeTone === 'lemon' && 'bg-lemon-300 text-lemon-800',
        badgeTone === 'coral' && 'bg-coral-500 text-white', badgeTone === 'lav' && 'bg-lav-500 text-white')}>{badge}</span>
    )}
  </button>
))

/* ───────── Pill button ───────── */
export const Pill = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; size?: 'sm' | 'md' | 'lg' }>(
  ({ tone = 'glass', size = 'md', className, ...p }, ref) => (
    <button ref={ref} {...p}
      className={cn('inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-[background-color,box-shadow,transform,color,opacity] duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:opacity-40',
        size === 'sm' && 'h-8 px-3 text-[12.5px]', size === 'md' && 'h-10 px-4 text-[13.5px]', size === 'lg' && 'h-12 px-5 text-[15px]',
        toneCls[tone], className)} />
  ),
)

/* ───────── Segmented（药丸分段，选中薄荷） ───────── */
export function Segmented<T extends string>({ value, options, onChange, size = 'md', className, tone = 'mint' }: {
  value: T; options: { value: T; label: ReactNode; hint?: string; sep?: boolean; testId?: string }[]; onChange(v: T): void; size?: 'sm' | 'md'; className?: string; tone?: 'mint' | 'ink'
}) {
  const id = useId()
  return (
    <div role="tablist" className={cn('relative flex items-center gap-0.5 rounded-full p-1', className)}>
      {options.map(o => {
        const on = o.value === value
        return (
          <span key={o.value} className="contents">
          {/* 分隔线说「下一章」：原始 → 改造 → 对比 ‖ 装修（不另做阶段开关） */}
          {o.sep && <span aria-hidden className="mx-1.5 h-[18px] w-px shrink-0 bg-ink-900/12" />}
          <button role="tab" data-testid={o.testId} aria-selected={on} onClick={() => onChange(o.value)} title={o.hint}
            className={cn('relative z-0 flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-semibold transition-colors duration-200',
              size === 'md' ? 'h-9 px-4 text-[13.5px]' : 'h-7 px-3 text-[12px]',
              on ? (tone === 'mint' ? 'text-mint-900' : 'text-white') : 'text-ink-500 hover:text-ink-900')}>
            {on && (
              <motion.span layoutId={id} transition={{ type: 'spring', stiffness: 520, damping: 34 }}
                className={cn('absolute inset-0 -z-10 rounded-full', tone === 'mint'
                  ? 'bg-mint-200 shadow-[inset_0_1px_0_rgb(255_255_255/0.7),0_4px_12px_-6px_rgb(18_130_94/0.55)]'
                  : 'bg-ink-900 shadow-[0_4px_12px_-6px_rgb(0_0_0/0.5)]')} />
            )}
            {o.label}
          </button>
          </span>
        )
      })}
    </div>
  )
}

/* ───────── Hotspot（参考图 1：粉彩圆盘 + 白环 + 右下「+」角标） ───────── */
export function Hotspot({ tone, icon, plus = true, active, pulse, size = 40, onClick, label, className }: {
  tone: 'lemon' | 'lav' | 'mint' | 'white' | 'coral' | 'gray'; icon: ReactNode; plus?: boolean; active?: boolean; pulse?: boolean; size?: number
  onClick?(e: React.MouseEvent): void; label?: string; className?: string
}) {
  const fill = { lemon: 'bg-lemon-200 text-ink-900', lav: 'bg-lav-200 text-lav-800', mint: 'bg-mint-200 text-mint-900', white: 'bg-white text-ink-800', coral: 'bg-coral-100 text-coral-700', gray: 'bg-ink-150 text-ink-500' }[tone]
  const ring = { lemon: 'bg-lemon-300/40', lav: 'bg-lav-300/40', mint: 'bg-mint-300/40', white: 'bg-white/40', coral: 'bg-coral-300/40', gray: 'bg-ink-200/40' }[tone]
  return (
    <motion.button aria-label={label} onClick={onClick} onPointerDown={e => e.stopPropagation()}
      initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: active ? 1.12 : 1, opacity: 1 }} whileHover={{ scale: active ? 1.12 : 1.08 }}
      transition={{ type: 'spring', stiffness: 520, damping: 22 }}
      className={cn('relative grid place-items-center rounded-full', className)} style={{ width: size, height: size }}>
      {pulse && <span className={cn('pulse-ring absolute inset-0 rounded-full', ring)} />}
      {/* 白环 = 二级玻璃（glass-chip）；里面的粉彩盘是实心的，带一道顶部高光 */}
      <span className="glass-chip absolute inset-0 rounded-full p-[3px]">
        <span className={cn('grid size-full place-items-center rounded-full shadow-[inset_0_1px_0_rgb(255_255_255/0.75),inset_0_-1px_2px_rgb(0_0_0/0.06)]', fill, active && 'ring-2 ring-ink-900')}>{icon}</span>
      </span>
      {plus && (
        <span className="absolute -bottom-0.5 -right-0.5 grid size-[17px] place-items-center rounded-full bg-ink-400 text-white ring-2 ring-white/90">
          <Plus size={10} strokeWidth={3} />
        </span>
      )}
    </motion.button>
  )
}

/* ───────── 小徽章 ───────── */
export function Tag({ tone = 'gray', children, className, icon }: { tone?: 'gray' | 'mint' | 'lemon' | 'lav' | 'coral' | 'cobalt' | 'ink' | 'outline'; children: ReactNode; className?: string; icon?: ReactNode }) {
  const t = {
    gray: 'bg-ink-100 text-ink-600', mint: 'bg-mint-100 text-mint-700', lemon: 'bg-lemon-100 text-lemon-800', lav: 'bg-lav-100 text-lav-600',
    coral: 'bg-coral-100 text-coral-700', cobalt: 'bg-cobalt-100 text-cobalt-700', ink: 'bg-ink-900 text-white', outline: 'bg-white/60 text-ink-600 ring-1 ring-inset ring-ink-200',
  }[tone]
  return <span className={cn('inline-flex h-[22px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11.5px] font-semibold leading-none', t, className)}>{icon}{children}</span>
}

/* 看到 / 推断 / 不知道：看到 = 实心点；推断 = 半实心；不知道 = 空心虚线圈。柠檬色只给需要用户动手的两种。 */
export function CertaintyMark({ c, size = 10 }: { c: Certainty; size?: number }) {
  const r = size / 2
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      {c === 'seen' && <circle cx={r} cy={r} r={r - 1} fill="currentColor" />}
      {c === 'inferred' && <><circle cx={r} cy={r} r={r - 1} fill="none" stroke="currentColor" strokeWidth={1.4} /><path d={`M${r} 1A${r - 1} ${r - 1} 0 0 1 ${r} ${size - 1}Z`} fill="currentColor" /></>}
      {c === 'unknown' && <circle cx={r} cy={r} r={r - 1.2} fill="none" stroke="currentColor" strokeWidth={1.4} strokeDasharray="2 1.6" />}
    </svg>
  )
}
export function CertaintyBadge({ c, label, className }: { c: Certainty; label: string; className?: string }) {
  const tone = c === 'seen' ? 'bg-ink-100 text-ink-600' : c === 'inferred' ? 'bg-lemon-100 text-lemon-800' : 'bg-lemon-200 text-lemon-800'
  return <span className={cn('inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[11.5px] font-semibold', tone, className)}><CertaintyMark c={c} />{label}</span>
}

/* 墙类型色块：和 2D 画法一致（docs/design.md §5.2） */
export function WallSwatch({ kind, size = 18 }: { kind: WallKind; size?: number }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" className="shrink-0 overflow-visible">
      <defs>
        <pattern id={`h${id}`} width="3.2" height="3.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3.2" height="3.2" fill="#1d2127" /><rect width="1" height="3.2" fill="#5a616c" /></pattern>
        <pattern id={`d${id}`} width="3" height="3" patternUnits="userSpaceOnUse"><rect width="3" height="3" fill="#dfe2e7" /><circle cx="1.5" cy="1.5" r="0.6" fill="#9aa0a9" /></pattern>
      </defs>
      <rect x="1" y="5" width="16" height="8" rx="2.2"
        fill={kind === 'bearing' ? `url(#h${id})` : kind === 'exterior' ? '#3c424b' : kind === 'partition' ? '#adb3bc' : kind === 'glass' ? '#c7e6f8' : `url(#d${id})`}
        stroke={kind === 'glass' ? '#4fa3d8' : 'none'} strokeWidth={kind === 'glass' ? 0.9 : 0} />
      {kind === 'glass' && <line x1="2.5" y1="9" x2="15.5" y2="9" stroke="#4fa3d8" strokeWidth="1" />}
      {kind === 'half-glass' && <line x1="2.5" y1="9" x2="15.5" y2="9" stroke="#4fa3d8" strokeWidth="1.6" />}
    </svg>
  )
}

/* ───────── 数字框（Figma 式，S2a） ─────────
 * 点数字直接键盘输入，回车或失焦生效，Esc 还原；↑↓ 按步长调，⇧ ×10；按住标签左右拖动改值；
 * 超出范围时在框下提示一句并夹回。所有数字输入都用它（替换了 D1 的加减号步进器）。
 */
const decimals = (x: number) => { const s = String(x); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1 }
export interface NumberFieldMessages { max: string; min: string; nan: string; drag: string }
const NF_ZH: NumberFieldMessages = { max: '最大 {v}，已夹回', min: '最小 {v}，已夹回', nan: '要填数字', drag: '按住左右拖动改值' }
export function NumberField({ label, value, unit, step, min, max, digits = 0, onChange, disabled, testId, placeholder, msgs = NF_ZH, className }: {
  label?: ReactNode; value: number | null; unit?: string; step: number; min?: number; max?: number; digits?: number
  onChange?(v: number): void; disabled?: boolean; testId?: string; placeholder?: string; msgs?: NumberFieldMessages; className?: string
}) {
  const [text, setText] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const noteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const input = useRef<HTMLInputElement>(null)
  const drag = useRef<{ x: number; v: number; moved: boolean } | null>(null)
  const cancelled = useRef(false), justFocused = useRef(false)
  const places = Math.max(digits, decimals(step))
  const shown = value === null || !Number.isFinite(value) ? '' : value.toFixed(digits)
  const say = (s: string | null) => { clearTimeout(noteTimer.current); setNote(s); if (s) noteTimer.current = setTimeout(() => setNote(null), 2400) }
  useEffect(() => () => clearTimeout(noteTimer.current), [])
  const fmtV = (v: number) => `${+v.toFixed(places)}${unit ? ' ' + unit : ''}`
  /** 夹回范围并提交；返回提交的值 */
  const commit = (raw: number): number | null => {
    if (!Number.isFinite(raw)) { say(msgs.nan); return null }
    let v = +raw.toFixed(places)
    if (max !== undefined && v > max + 1e-9) { v = +max.toFixed(places); if (v > max) v = +(v - Math.pow(10, -places)).toFixed(places); say(msgs.max.replace('{v}', fmtV(max))) }
    else if (min !== undefined && v < min - 1e-9) { v = +min.toFixed(places); if (v < min) v = +(v + Math.pow(10, -places)).toFixed(places); say(msgs.min.replace('{v}', fmtV(min))) }
    if (value === null || Math.abs(v - value) > 1e-9) onChange?.(v)
    return v
  }
  // 允许全角数字、逗号千分位、中文负号
  const parse = (s: string) => { const t = s.replace(/[，,\s]/g, '').replace(/[－−]/g, '-').replace(/[０-９．]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)); return t === '' ? NaN : Number(t) }
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    justFocused.current = false
    if (e.key === 'Enter') { e.preventDefault(); if (text !== null) commit(parse(text)); setText(null); input.current?.blur() }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelled.current = true; setText(null); say(null); input.current?.blur() }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      const cur = text !== null && Number.isFinite(parse(text)) ? parse(text) : value ?? 0
      const v = commit(cur + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1))
      if (v !== null) setText(v.toFixed(digits))
    }
  }
  const onLabelDown = (e: React.PointerEvent) => {
    if (disabled || e.button !== 0) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, v: value ?? 0, moved: false }
  }
  const onLabelMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) < 3) return
    d.moved = true
    // 每 4px 一个步长，按住 ⇧ ×10
    commit(d.v + Math.round(dx / 4) * step * (e.shiftKey ? 10 : 1))
  }
  const onLabelUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (d && !d.moved) input.current?.focus()
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  }
  return (
    <div className={cn('min-w-0', className)}>
      {label !== undefined && (
        <div title={disabled ? undefined : msgs.drag} data-testid={testId && `${testId}-label`}
          onPointerDown={onLabelDown} onPointerMove={onLabelMove} onPointerUp={onLabelUp} onPointerCancel={onLabelUp}
          className={cn('mb-1.5 flex select-none items-center gap-1 px-1 text-[11.5px] font-semibold text-ink-500', !disabled && 'cursor-ew-resize hover:text-ink-800')}>
          {label}
        </div>
      )}
      <label className={cn('tile-sunken flex h-9 items-baseline gap-1 rounded-full px-3.5 pt-[7px] transition-shadow focus-within:bg-white focus-within:ring-2 focus-within:ring-mint-300', disabled && 'opacity-60', note && 'ring-2 ring-coral-300')}>
        <input ref={input} data-testid={testId} disabled={disabled} inputMode="decimal" spellCheck={false} autoComplete="off"
          value={text ?? shown} placeholder={placeholder}
          onFocus={e => { cancelled.current = false; justFocused.current = true; setText(shown); e.target.select() }}
          // 点进来时浏览器在 mouseup 上会把全选取消掉：吃掉这一次 mouseup，点一下就是「全选、直接打字替换」
          onMouseUp={e => { if (justFocused.current) { e.preventDefault(); justFocused.current = false } }}
          onChange={e => setText(e.target.value)}
          onBlur={() => { if (!cancelled.current && text !== null && text !== shown) commit(parse(text)); cancelled.current = false; setText(null) }}
          onKeyDown={onKey}
          className="num min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-ink-900 outline-none placeholder:font-medium placeholder:text-ink-300 disabled:cursor-not-allowed" />
        {unit && <span className="shrink-0 text-[11px] font-medium text-ink-400">{unit}</span>}
      </label>
      {note && <div role="status" data-testid={testId && `${testId}-note`} className="mt-1 truncate px-1.5 text-[11px] font-semibold text-coral-700">{note}</div>}
    </div>
  )
}

/* ───────── 开关（参考图 1/3 的 on 胶囊） ───────── */
export function Switch({ on, onChange, tone = 'mint', label }: { on: boolean; onChange?(v: boolean): void; tone?: 'mint' | 'ink'; label?: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange?.(!on)}
      className={cn('relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200',
        on ? (tone === 'mint' ? 'bg-mint-400' : 'bg-ink-900') : 'bg-ink-200')}>
      <motion.span layout transition={{ type: 'spring', stiffness: 700, damping: 32 }}
        className={cn('absolute top-[3px] size-5 rounded-full bg-white shadow-[0_2px_5px_rgb(0_0_0/0.18)]', on ? 'right-[3px]' : 'left-[3px]')} />
    </button>
  )
}

/* ───────── 滑块（参考图 3 的大胶囊滑块） ───────── */
export function Slider({ value, min = 0, max = 100, onChange, onCommit, icon, suffix = '%' }: { value: number; min?: number; max?: number; onChange?(v: number): void; /** 松手、方向键松开 */ onCommit?(): void; icon?: ReactNode; suffix?: string }) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="tile-sunken relative h-10 overflow-hidden rounded-full">
      <div className="absolute inset-y-1 left-1 rounded-full bg-mint-300 shadow-[inset_0_1px_0_rgb(255_255_255/0.6)]" style={{ width: `calc(${Math.max(pct, 12)}% - 8px)` }} />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-3.5">
        <span className="text-mint-900">{icon}</span>
        <span className="num text-[13px] font-semibold text-ink-700">{Math.round(value)}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={e => onChange?.(+e.target.value)} onPointerUp={() => onCommit?.()} onKeyUp={() => onCommit?.()} className="absolute inset-0 cursor-pointer opacity-0" aria-label="slider" />
    </div>
  )
}

/* 卡片里的分节标题 */
export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-0.5 pb-2">
      <span className="text-[12px] font-semibold tracking-[0.02em] text-ink-500">{children}</span>
      {right}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) { return <kbd className="kbd">{children}</kbd> }
