/**
 * 底图找不到时给轻提示，不静默（PM 实测：真实方案的底图是相对路径，文件不在时画布上什么都没有）。
 * - 服务模式：相对路径去取，404 / 解码失败 → 提示；
 * - 浏览器直接打开的方案：相对路径根本取不到（不知道它在哪）→ 同样提示。
 * 「重新导入」只换图片本身，保留原来的比例、原点、镜像（那些是定过比例的结果）。
 */
import { useEffect } from 'react'
import { useStore } from './store'
import { dicts } from './i18n'
import { underlayHref } from './geom'

const shownFor = new Set<string>()

export function useUnderlayCheck() {
  const src = useStore(s => s.base?.underlay?.src)
  const served = useStore(s => s.source.kind === 'served')
  const missing = useStore(s => s.underlayMissing)
  const notice = useStore(s => s.notice)

  useEffect(() => {
    if (!src) { useStore.setState({ underlayMissing: null }); return }
    const href = underlayHref(src, served)
    if (!href) { useStore.setState({ underlayMissing: /^(data:|blob:)/.test(src) ? null : src }); return }
    let alive = true
    const img = new Image()
    img.onload = () => { if (alive) useStore.setState({ underlayMissing: null }) }
    img.onerror = () => { if (alive) useStore.setState({ underlayMissing: src }) }
    img.src = href
    return () => { alive = false }
  }, [src, served])

  // 已经有别的提示（比如「已转换旧格式方案」）时排在它后面，关掉那条再出
  useEffect(() => {
    if (!missing || notice || shownFor.has(missing)) return
    shownFor.add(missing)
    const t = dicts[useStore.getState().lang]
    // 粘贴的方案（网页 Chat 流程）：底图只是个文件名，说清是哪张图；导入走 relinkUnderlay，保留 Chat 估的比例和原点
    const pasted = useStore.getState().source.kind === 'paste'
    const name = missing.split(/[?#]/)[0].split(/[\\/]/).pop() || missing
    useStore.getState().setNotice({
      text: pasted ? t.chat.underlayRef.replace('{name}', name) : t.underlayMissing,
      actions: [
        { label: pasted ? t.act.importImage : t.reimport, primary: true, run: () => { useStore.getState().setNotice(null); relinkUnderlay() } },
        { label: t.act.dismiss, run: () => useStore.getState().setNotice(null) },
      ],
    })
  }, [missing, notice])
}

/** 选一张图换掉找不到的底图：只换 src，比例 / 原点 / 镜像不动 */
export function relinkUnderlay() {
  const input = document.createElement('input')
  input.type = 'file'; input.accept = 'image/*'; input.style.display = 'none'
  input.onchange = () => {
    const f = input.files?.[0]
    input.remove()
    if (!f) return
    const r = new FileReader()
    r.onload = () => {
      const s = useStore.getState()
      if (!s.base?.underlay) return
      s.setUnderlay({ src: String(r.result), visible: true }, { history: true })
      useStore.setState(x => ({ underlayMissing: null, layers: { ...x.layers, underlay: true }, underlayNames: { ...x.underlayNames, main: f.name } }))
      s.showToast(dicts[s.lang].imageImported)
    }
    r.readAsDataURL(f)
  }
  document.body.appendChild(input)
  input.click()
}
