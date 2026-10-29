/**
 * 流程：buildDoc（数据）→ 逐页画到画布（renderSheet）→ jsPDF 只用 addImage 拼成多页 A4 横版。
 * 不用 doc.html()（它会去加载额外的库）。3D 截图用一个离屏 renderer，全部画完就释放。
 */
import { jsPDF } from 'jspdf'
import type { Plan } from '@/core/types'
import { SnapshotRenderer } from '@/three/snapshot'
import { buildDoc, fileName, type ExportDoc, type ExportOptions } from './model'
import { makeRenderCtx, renderSheet, type RenderedSheet } from './pages'
import type { Lang } from '../i18n'

export interface Rendered { doc: ExportDoc; sheets: RenderedSheet[] }

const tick = () => new Promise<void>(r => setTimeout(r, 0))

export async function fontsReady() {
  try {
    await Promise.all(['400 16px "Manrope Variable"', '600 16px "Manrope Variable"', '750 16px "Manrope Variable"'].map(f => document.fonts.load(f)))
    await document.fonts.ready
  } catch { /* 系统字体兜底 */ }
}

/** 画全部页面；onPage(i, n) 报进度；signal 可中途停 */
export async function renderAll(base: Plan, opts: ExportOptions, lang: Lang, live: Plan | null, onPage?: (i: number, n: number) => void, signal?: { cancelled: boolean }): Promise<Rendered> {
  await fontsReady()
  const doc = buildDoc(base, opts, lang)
  const need3d = opts.threeD
  let snap: SnapshotRenderer | null = null
  if (need3d) { try { snap = new SnapshotRenderer() } catch { snap = null } }
  const rc = makeRenderCtx(doc, snap, live)
  const sheets: RenderedSheet[] = []
  try {
    for (const [i, sh] of doc.sheets.entries()) {
      if (signal?.cancelled) break
      onPage?.(i + 1, doc.sheets.length)
      await tick()
      sheets.push(await renderSheet(rc, sh, i))
    }
  } finally { snap?.dispose() }
  return { doc, sheets }
}

/** 拼 PDF：每页一张整页图（PNG，打印不糊） */
export async function toPdf(r: Rendered, onPage?: (i: number, n: number) => void): Promise<Blob> {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
  pdf.setProperties({ title: `${r.doc.base.title} · ${r.doc.t.docName}`, subject: r.doc.t.coverKicker, creator: '改改你的家' })
  for (const [i, s] of r.sheets.entries()) {
    onPage?.(i + 1, r.sheets.length)
    await tick()
    if (i) pdf.addPage('a4', 'landscape')
    pdf.addImage(s.canvas, 'PNG', 0, 0, 297, 210, undefined, 'FAST')
  }
  return pdf.output('blob')
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
export { fileName }
