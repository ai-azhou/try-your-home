/**
 * 楼层切换（S2a）：只有多层方案才出现，不占新面板——桌面在左上标题块里（方案名 / 模式 / 面积下面一行），
 * 手机在画布左上角（指北针旁边）。点当前层的「⋯」改名称、标高、层高；「其他层淡显」「3D 只看这一层」也在这里。
 */
import { Popover } from 'radix-ui'
import { Plus, Settings2, Trash } from 'lucide-react'
import { levelsOf } from '@/core/levels'
import { useStore, useT } from '../store'
import { NumberField, Pill, Switch } from '../kit'
import { addLevel, removeLevel, updateLevel } from '../actions'
import { curLevelId, isMultiLevel } from '../levels-ui'
import { useIsMobile } from '../layout'
import { cn } from '@/lib/utils'

export function LevelSwitch({ className }: { className?: string }) {
  const t = useT(), L = t.s2a.level
  const base = useStore(s => s.base), level = useStore(s => s.level), layers = useStore(s => s.layers), solo = useStore(s => s.solo3d), mode = useStore(s => s.mode)
  const mobile = useIsMobile()
  if (!base || !isMultiLevel(base)) return null
  const levels = levelsOf(base), cur = curLevelId(base, level), lv = levels.find(l => l.id === cur)!
  const i = levels.indexOf(lv)
  const { setLevel, setSolo3d } = useStore.getState()
  const ro = mode !== 'original'
  return (
    <div data-float data-level-switch className={cn('pointer-events-auto flex items-center gap-1 rounded-full p-1', mobile ? 'glass' : 'glass-chip', className)}>
      {[...levels].reverse().map(l => (
        <button key={l.id} data-testid={`level-${l.id}`} aria-pressed={l.id === cur} onClick={() => setLevel(l.id)}
          className={cn('h-7 min-w-9 rounded-full px-2.5 text-[12px] font-semibold transition', l.id === cur ? 'bg-ink-900 text-white shadow-[0_4px_10px_-6px_rgb(0_0_0/0.5)]' : 'text-ink-600 hover:bg-white/80 hover:text-ink-900')}>
          {l.name}
        </button>
      ))}
      <Popover.Root>
        <Popover.Trigger asChild>
          <button data-testid="level-edit" aria-label={L.edit} className="grid size-7 place-items-center rounded-full text-ink-500 transition hover:bg-white/80 hover:text-ink-900"><Settings2 size={14} strokeWidth={2.3} /></button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content side="bottom" align="start" sideOffset={10} className="glass-strong z-[70] w-[280px] rounded-[22px] p-3 data-[state=open]:animate-[shimmer-in_180ms_var(--ease-out)]">
            <div className="flex items-center justify-between px-1">
              <span className="text-[14px] font-semibold text-ink-900">{L.title} · {lv.name}</span>
              {ro && <span className="text-[11px] font-medium text-ink-400">{L.onlyOriginal}</span>}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <div className="col-span-2">
                <div className="mb-1.5 px-1 text-[11.5px] font-semibold text-ink-500">{L.name}</div>
                <input value={lv.name} disabled={ro} data-testid="level-name" onChange={e => updateLevel(lv.id, { name: e.target.value })}
                  className="tile-sunken h-9 w-full rounded-full px-3.5 text-[13.5px] font-semibold text-ink-900 outline-none focus:ring-2 focus:ring-mint-300" />
              </div>
              <NumberField msgs={t.s2a.num} label={L.elevation} testId="level-elevation" value={lv.elevation} unit="m" step={0.05} digits={2}
                min={i ? +(levels[i - 1].elevation + 0.5).toFixed(2) : 0} max={i ? (levels[i + 1] ? +(levels[i + 1].elevation - 0.5).toFixed(2) : 200) : 0}
                disabled={ro || i === 0} onChange={v => updateLevel(lv.id, { elevation: v })} />
              <NumberField msgs={t.s2a.num} label={L.ceiling} testId="level-ceiling" value={lv.ceiling ?? base.ceiling} unit="m" step={0.05} digits={2} min={2} max={8}
                disabled={ro} onChange={v => updateLevel(lv.id, { ceiling: v })} />
            </div>
            <div className="mt-3 flex flex-col gap-0.5">
              <label className="flex h-10 items-center justify-between rounded-[12px] px-1.5 text-[13px] font-medium text-ink-800">{L.others}<Switch on={layers.otherLevels} onChange={() => useStore.getState().toggleLayer('otherLevels')} label={L.others} /></label>
              <label className="flex h-10 items-center justify-between rounded-[12px] px-1.5 text-[13px] font-medium text-ink-800">{L.solo}<Switch on={solo} onChange={v => setSolo3d(v)} label={L.solo} /></label>
            </div>
            <div className="mt-2 flex gap-2">
              <Pill tone="tile" size="sm" disabled={ro} onClick={addLevel} data-testid="level-add"><Plus size={14} />{L.add}</Pill>
              {i > 0 && <Pill tone="plain" size="sm" disabled={ro} onClick={() => removeLevel(lv.id)} className="text-coral-700"><Trash size={13} />{L.remove}</Pill>}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  )
}
