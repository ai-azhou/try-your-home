/**
 * 右上角的全局「导出」（D6 B8）：任何模式都能点。装修的人想不到去「改造」那组里找导出，所以搬到全局。
 * 里面三样：
 *  - 改造清单 PDF：「结构改造」「装修想法」两节分别勾选，点了打开原来的预览面板（ExportPanel）；
 *  - 方案 JSON（存档、换台电脑接着改、交给 Agent）；
 *  - 图片 PNG（当前 3D 视角）：装修态 平涂 / 白模，结构态 白模 / 结构色。在 2D 里点会先切到 3D 再导。
 * 名称规矩：不叫「给设计师」，口吻是「我的想法，可行性待专业确认」。
 */
import { useState } from 'react'
import { Popover } from 'radix-ui'
import { Check, Download, FileBraces, FileDown, ImageDown } from 'lucide-react'
import { useStore, useT } from '../store'
import { useDecor } from '../decor/dstore'
import { exportPlan, safeName } from '../actions'
import { Tip } from '../kit'
import { cn } from '@/lib/utils'
import { openExportPanel } from './entry'

/** 导出当前 3D 视角的 PNG（2 倍像素、不带界面）；ToolRail 的「导出图片」和这里共用 */
export function shoot3d(bg: 'white' | 'transparent', aspect: 'view' | '16:9' = 'view') {
  const s = useStore.getState(), D = useDecor.getState(), zh = s.lang === 'zh'
  const t = { iso: zh ? '斜视' : 'iso', top: zh ? '俯视' : 'top', eye: zh ? '平视' : 'eye' }
  const view = s.mode === 'decor' && D.probe ? (zh ? '对准' : 'aim') : t[s.cam]
  const look = s.mode === 'decor' ? (D.look3d === 'clay' ? (zh ? '装修白模' : 'decor-clay') : (zh ? '装修平涂' : 'decor-flat')) : s.style3d === 'clay' ? (zh ? '白模' : 'clay') : (zh ? '结构色' : 'structure')
  const name = `${safeName(s.base?.title ?? 'plan')}-${look}${s.mode === 'decor' && D.section3d ? (zh ? '-剖切' : '-section') : ''}-${view}${aspect === '16:9' ? '-16x9' : ''}.png`
  const fire = () => window.dispatchEvent(new CustomEvent('export-3d', { detail: { bg, aspect, glass: bg === 'transparent' ? D.exportGlass : 'clear', name, done: (ok: boolean, w: number, h: number) => { useStore.getState().showToast(ok ? (zh ? `已导出 ${name}` : `Exported ${name}`) : 'PNG ×'); (window as unknown as Record<string, unknown>).__lastShot = { ok, w, h, name } } } }))
  if (s.main !== '3d') { s.setMain('3d'); setTimeout(fire, 1400) } // 主画布换成 3D、相机落定后再拍
  else fire()
}

export function GlobalExport({ compact }: { compact?: boolean }) {
  const lang = useStore(s => s.lang), zh = lang === 'zh'
  const t = useT()
  const mode = useStore(s => s.mode)
  const nChanges = useStore(s => s.base?.changes.length ?? 0)
  const decor = useStore(s => s.base?.decor)
  const look = useDecor(s => s.look3d), style3d = useStore(s => s.style3d)
  const [open, setOpen] = useState(false)
  const [structure, setStructure] = useState(true)
  const [withDecor, setWithDecor] = useState(true)
  const nDecor = decor ? decor.furniture.length + decor.cabinets.length + decor.panels.length + decor.recesses.length + decor.surfaces.length : 0
  const canS = nChanges > 0, canD = !!decor
  const pickS = canS && structure, pickD = canD && withDecor
  const row = 'flex w-full items-center gap-3 rounded-[16px] px-2.5 py-2 text-left transition hover:bg-white/80 outline-none focus-visible:bg-white/80 disabled:cursor-not-allowed disabled:opacity-45'
  const disc = 'grid size-9 shrink-0 place-items-center rounded-full'
  const looks: { v: string; l: string; on: boolean; set(): void }[] = mode === 'decor'
    ? [{ v: 'flat', l: zh ? '平涂' : 'Flat colour', on: look !== 'clay', set: () => useDecor.getState().set({ look3d: 'flat' }) }, { v: 'clay', l: zh ? '白模' : 'Clay', on: look === 'clay', set: () => useDecor.getState().set({ look3d: 'clay' }) }]
    : [{ v: 'clay', l: zh ? '白模' : 'Clay', on: style3d === 'clay', set: () => useStore.getState().setStyle3d('clay') }, { v: 'struct', l: zh ? '结构色' : 'Structure', on: style3d !== 'clay', set: () => useStore.getState().setStyle3d('struct') }]

  const Check2 = ({ on, disabled, onClick, label, sub, testId }: { on: boolean; disabled?: boolean; onClick(): void; label: string; sub: string; testId: string }) => (
    <button type="button" role="checkbox" aria-checked={on} disabled={disabled} data-testid={testId} onClick={onClick}
      className="tile flex flex-1 items-center gap-2 rounded-[14px] px-2.5 py-2 text-left transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-45">
      <span className={cn('grid size-[18px] shrink-0 place-items-center rounded-[6px] transition', on ? 'bg-ink-900 text-white' : 'bg-white ring-1 ring-inset ring-ink-900/20')}>{on && <Check size={12} strokeWidth={3} />}</span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-semibold text-ink-900">{label}</span>
        <span className="block truncate text-[11px] font-medium text-ink-500">{sub}</span>
      </span>
    </button>
  )

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Tip label={zh ? '导出：改造清单 PDF、方案文件、图片' : 'Export: PDF, plan file, image'}>
        <Popover.Trigger asChild>
          <button data-testid="global-export" aria-label={zh ? '导出' : 'Export'}
            className={cn('glass glass-hover flex h-[46px] shrink-0 items-center gap-2 whitespace-nowrap rounded-full pl-1.5 pr-4 text-[13.5px] font-semibold text-ink-800 transition active:scale-[0.97] max-[1099px]:pr-1.5', open && 'bg-white', compact && 'h-[44px] pr-1.5')}>
            <span className="grid size-[34px] place-items-center rounded-full bg-ink-900 text-white"><Download size={16} strokeWidth={2.3} /></span>
            {/* 窄桌面（< 1100）顶栏挤，只留图标；aria-label 和悬停提示照样写「导出」（线上 bug B3） */}
            {!compact && <span className="max-[1099px]:hidden">{zh ? '导出' : 'Export'}</span>}
          </button>
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={10} data-testid="global-export-menu" className="glass-strong z-[70] w-[340px] max-w-[calc(100vw-24px)] rounded-[24px] bg-[rgb(250_250_252/0.95)] p-2.5 shadow-[0_24px_60px_-20px_rgb(30_28_60/0.35)] data-[state=open]:animate-[shimmer-in_180ms_var(--ease-out)]">
          <div className="px-2 pb-1.5 pt-1">
            <div className="text-[14px] font-semibold text-ink-900">{zh ? '导出' : 'Export'}</div>
            <div className="text-[11.5px] font-medium text-ink-500">{zh ? '都是我的想法，可行性待专业确认' : 'My ideas — feasibility to be confirmed by a professional'}</div>
          </div>

          {/* 改造清单 PDF：两节分别勾 */}
          <div className="tile-sunken mt-1 rounded-[18px] p-2">
            <div className="flex items-center gap-3 px-0.5 pb-2">
              <span className={cn(disc, 'bg-ink-900 text-white')}><FileDown size={16} strokeWidth={2.3} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold text-ink-900">{zh ? '改造清单 PDF' : 'Change list PDF'}</div>
                <div className="text-[11.5px] font-medium text-ink-500">{zh ? '图文对照，拿去和人当面聊' : 'Plan + notes, to talk it through'}</div>
              </div>
            </div>
            <div className="flex gap-1.5">
              <Check2 testId="gexp-structure" on={pickS} disabled={!canS} onClick={() => setStructure(!structure)} label={zh ? '结构改造' : 'Structure'} sub={canS ? (zh ? `${nChanges} 条` : `${nChanges} items`) : (zh ? '还没有改造记录' : 'No changes yet')} />
              <Check2 testId="gexp-decor" on={pickD} disabled={!canD} onClick={() => setWithDecor(!withDecor)} label={zh ? '装修想法' : 'Decor ideas'} sub={canD ? (zh ? `${nDecor} 项` : `${nDecor} items`) : (zh ? '还没开始装修' : 'Not started')} />
            </div>
            <button type="button" data-testid="gexp-pdf" disabled={!pickS && !pickD} onClick={() => { setOpen(false); openExportPanel({ structure: pickS, decor: pickD }) }}
              className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-full bg-ink-900 text-[13px] font-semibold text-white transition hover:bg-ink-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40">
              {zh ? '预览并导出 PDF' : 'Preview & export PDF'}
            </button>
          </div>

          <button type="button" data-testid="gexp-json" className={cn(row, 'mt-1')} onClick={() => { setOpen(false); exportPlan() }}>
            <span className={cn(disc, 'bg-white text-ink-700 ring-1 ring-inset ring-ink-900/8')}><FileBraces size={16} strokeWidth={2.2} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-ink-900">{zh ? '方案文件 JSON' : 'Plan file (JSON)'}</span>
              <span className="block text-[11.5px] font-medium text-ink-500">{zh ? '存档、换台电脑接着改、交给 Agent' : 'Archive, continue elsewhere, hand to an agent'}</span>
            </span>
            <span className="kbd">⌘S</span>
          </button>

          <div className={cn(row, 'cursor-default hover:bg-transparent')}>
            <span className={cn(disc, 'bg-white text-ink-700 ring-1 ring-inset ring-ink-900/8')}><ImageDown size={16} strokeWidth={2.2} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold text-ink-900">{zh ? '图片 PNG' : 'Image (PNG)'}</span>
              <span className="block text-[11.5px] font-medium text-ink-500">{t.shot.sub.replace('当前视角', '当前 3D 视角')}</span>
            </span>
          </div>
          <div className="flex gap-1.5 px-2.5 pb-1.5 pl-[58px]">
            {looks.map(l => (
              <button key={l.v} type="button" data-testid={`gexp-png-${l.v}`} onClick={() => { l.set(); setOpen(false); setTimeout(() => shoot3d('white'), 60) }}
                className="tile flex h-8 flex-1 items-center justify-center rounded-full text-[12.5px] font-semibold text-ink-700 transition hover:bg-white hover:text-ink-900">
                {l.l}{l.on && <span className="ml-1 text-[10.5px] font-medium text-ink-400">{zh ? '· 现在' : '· now'}</span>}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
