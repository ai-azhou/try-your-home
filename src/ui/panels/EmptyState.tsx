/**
 * 空状态：一句话说清要什么（拖户型图或方案文件），两个入口，三步流程，再给一个示例方案的退路。
 * 拖拽悬停时整块变薄荷描边。
 */
import { motion } from 'motion/react'
import { ArrowRight, ClipboardPaste, FileBraces, ImageUp } from 'lucide-react'
import { useStore, useT } from '../store'
import { Glass, Pill } from '../kit'
import { newPlan, openDemo, pickFile } from '../actions'
import { openPaste } from '../chat'
import { useIsMobile } from '../layout'
import { cn } from '@/lib/utils'

export function EmptyState() {
  const t = useT()
  const drag = useStore(s => s.dragOver)

  const mobile = useIsMobile()
  const pick = (kind: 'image' | 'plan') => pickFile(kind === 'image' ? 'image/*' : '.json,application/json')
  const ease = [0.2, 0.8, 0.2, 1] as const
  return (
    <div className="absolute inset-0 z-20 grid place-items-center overflow-y-auto px-4 pb-8 pt-24">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }}
        className="relative w-full max-w-[760px]">
        <Glass className={cn('relative rounded-[40px] p-3 transition-shadow duration-300', drag && 'shadow-[0_0_0_3px_var(--color-mint-400),var(--shadow-lift)]')}>
          <div className={cn('relative overflow-hidden rounded-[30px] border-2 border-dashed px-6 pb-7 pt-10 transition-colors duration-300 md:px-12 md:pb-10 md:pt-14',
            drag ? 'border-mint-400 bg-mint-50/70' : 'border-ink-900/10 bg-white/20')}>
            <div className="relative text-center">
              <div className={cn('font-light leading-[1.08] tracking-[-0.02em] text-ink-700', mobile ? 'text-[34px]' : 'text-[46px]')}>{drag ? t.empty.drop : t.empty.title1}</div>
              {!drag && <div className={cn('font-semibold leading-[1.08] tracking-[-0.025em] text-ink-900', mobile ? 'text-[34px]' : 'text-[46px]')}>{t.empty.title2}</div>}
              <p className="mx-auto mt-4 max-w-[440px] text-[14px] leading-relaxed text-ink-500">{t.empty.sub}</p>
            </div>
            <div className="relative mt-8 grid gap-3 md:grid-cols-2">
              <Entry tone="mint" icon={<ImageUp size={21} strokeWidth={2.1} />} title={t.empty.image} sub={t.empty.imageSub} onClick={() => pick('image')} />
              <Entry tone="lav" icon={<FileBraces size={21} strokeWidth={2.1} />} title={t.empty.plan} sub={t.empty.planSub} onClick={() => pick('plan')} />
              {/* 没有 Agent、用网页 Chat 读图的人：Chat 回复的方案整段粘进来（T2） */}
              <Entry tone="lav" compact icon={<ClipboardPaste size={19} strokeWidth={2.1} />} title={t.chat.paste} sub={t.chat.pasteSub} onClick={openPaste} testId="empty-paste" className="md:col-span-2" />
            </div>
            <div className="relative mt-7 flex flex-wrap items-center justify-center gap-x-2 gap-y-2">
              {t.empty.steps.map((s, i) => (
                <div key={s} className="flex items-center gap-2">
                  <span className="num grid size-6 place-items-center rounded-full bg-ink-900 text-[11px] font-bold text-white">{i + 1}</span>
                  <span className="text-[12.5px] font-semibold text-ink-600">{s}</span>
                  {i < 2 && <span className="mx-1 h-px w-6 bg-ink-900/15 max-md:hidden" />}
                </div>
              ))}
            </div>
          </div>
        </Glass>
        <div className="mt-5 flex items-center justify-center gap-3 text-[13px] text-ink-500">
          {t.empty.or}
          <Pill tone="glass" size="md" onClick={openDemo} data-testid="open-demo">{t.empty.demo}<ArrowRight size={14} /></Pill>
          <button onClick={newPlan} className="text-[12.5px] font-semibold text-ink-500 underline-offset-4 hover:text-ink-800 hover:underline">{t.act.newPlan}</button>
        </div>
      </motion.div>
    </div>
  )
}

function Entry({ tone, icon, title, sub, onClick, compact, testId, className }: { tone: 'mint' | 'lav'; icon: React.ReactNode; title: string; sub: string; onClick(): void; compact?: boolean; testId?: string; className?: string }) {
  return (
    <button onClick={onClick} data-testid={testId} className={cn('tile group flex items-center gap-4 rounded-[24px] p-4 text-left transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[var(--shadow-float)]', compact && 'py-3', className)}>
      <span className={cn('grid shrink-0 place-items-center rounded-full shadow-[inset_0_1px_0_rgb(255_255_255/0.6)]', compact ? 'size-10' : 'size-12', tone === 'mint' ? 'bg-mint-200 text-mint-900' : 'bg-lav-200 text-lav-800')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-ink-900">{title}</span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-500">{sub}</span>
      </span>
      <ArrowRight size={17} className="shrink-0 text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-ink-700" />
    </button>
  )
}
