/**
 * 两个入口：改造清单卡里的「改造清单导出」按钮、文件菜单里的一项。没有改造记录时置灰，提示「还没有改造记录」。
 * 面板按需动态载入（jsPDF 和离屏 3D 只在点导出时才初始化）。
 */
import { DropdownMenu } from 'radix-ui'
import { FileDown } from 'lucide-react'
import { useStore } from '../store'
import { cn } from '@/lib/utils'
import { exportStrings } from './strings'

export function openExportPanel(preset?: { structure?: boolean; decor?: boolean }) {
  void import('./ExportPanel').then(m => m.openExport(preset))
}

/** 改造清单卡里的按钮 */
export function ExportButton({ className }: { className?: string }) {
  const lang = useStore(s => s.lang)
  const n = useStore(s => (s.base?.changes.length ?? 0) + (s.base?.decor ? 1 : 0))
  const t = exportStrings[lang]
  return (
    <button type="button" data-testid="export-changes" disabled={!n} onClick={() => openExportPanel()} title={n ? undefined : t.entryEmpty}
      className={cn('tile flex h-11 w-full items-center gap-2.5 rounded-[16px] pl-1.5 pr-3 text-left text-[13.5px] font-semibold text-ink-900 transition hover:bg-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50', className)}>
      <span className="grid size-8 place-items-center rounded-full bg-ink-900 text-white"><FileDown size={15} strokeWidth={2.4} /></span>
      <span className="flex-1">{t.entry}</span>
      {!n && <span className="text-[11.5px] font-medium text-ink-400">{t.entryEmpty}</span>}
      {!!n && <span className="text-[11.5px] font-medium text-ink-400">PDF</span>}
    </button>
  )
}

/** 文件菜单里的一项（className 沿用菜单项的样式） */
export function ExportMenuItem({ className }: { className?: string }) {
  const lang = useStore(s => s.lang)
  const n = useStore(s => (s.base?.changes.length ?? 0) + (s.base?.decor ? 1 : 0))
  const t = exportStrings[lang]
  return (
    <DropdownMenu.Item className={cn(className, 'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45')} data-testid="menu-export-changes" disabled={!n} onSelect={() => openExportPanel()}>
      <FileDown size={16} className="text-ink-500" />{t.entry}
      <span className="ml-auto text-[11px] font-medium text-ink-400">{n ? 'PDF' : t.entryEmpty}</span>
    </DropdownMenu.Item>
  )
}
