/**
 * 新构件的小图标：和 2D 画法一一对应（柱实心、管道井斜线、楼梯踏步 +「上」箭头、挑空打叉），
 * 用在「更多结构」菜单、检查器标题和楼层切换里。lucide 里没有现成合适的，自己画，描边粗细跟 lucide 2.1 一致。
 */
import type { ElementType } from '@/core/types'

export function ExtraIcon({ type, size = 18 }: { type: Extract<ElementType, 'column' | 'shaft' | 'stair' | 'void'> | 'level'; size?: number }) {
  const sw = 2.1
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {type === 'column' && <><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" /><path d="M4 4h4M16 4h4M4 20h4M16 20h4" opacity=".45" /></>}
      {type === 'shaft' && <><rect x="5" y="5" width="14" height="14" rx="2" /><path d="M5 12 12 5M5 19 19 5M12 19l7-7" /></>}
      {type === 'stair' && <><rect x="6" y="3.5" width="12" height="17" rx="1.5" /><path d="M6 8h12M6 12h12M6 16h12" opacity=".55" /><path d="M12 18V6m-2.6 2.6L12 6l2.6 2.6" /></>}
      {type === 'void' && <><rect x="4.5" y="4.5" width="15" height="15" rx="2" strokeDasharray="3 2.2" /><path d="M8 8l8 8M16 8l-8 8" /></>}
      {type === 'level' && <><path d="M12 3 21 8 12 13 3 8Z" /><path d="M3 12.5 12 17.5 21 12.5" /><path d="M3 17 12 22 21 17" opacity=".5" /></>}
    </svg>
  )
}
