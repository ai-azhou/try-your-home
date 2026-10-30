/**
 * 连接方案文件（File System Access，Chrome / Edge）：记住用户选的文件句柄，Agent 改了文件这里跟着变，⌘S 写回。
 * 网页拿不到文件路径，只能记句柄：存在 IndexedDB，刷新后还在。Safari、Firefox 没有这个接口，退回一次性读取。
 */
export interface PlanFileHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
  queryPermission(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>
}
declare global {
  interface Window { showOpenFilePicker?(o?: { types?: { description?: string; accept: Record<string, string[]> }[] }): Promise<PlanFileHandle[]> }
  interface DataTransferItem { getAsFileSystemHandle?(): Promise<PlanFileHandle | { kind: 'directory' } | null> }
}
export const canLink = () => typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function'
/** 文件有没有变：修改时间 + 大小 */
export const stampOf = (f: File) => `${f.lastModified}-${f.size}`

const DB = 'try-your-home-link', STORE = 'handles', KEY = 'plan'
const open = () => new Promise<IDBDatabase>((ok, no) => {
  const q = indexedDB.open(DB, 1)
  q.onupgradeneeded = () => q.result.createObjectStore(STORE)
  q.onsuccess = () => ok(q.result); q.onerror = () => no(q.error)
})
const run = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>) => {
  const db = await open()
  try {
    return await new Promise<T>((ok, no) => { const r = f(db.transaction(STORE, mode).objectStore(STORE)); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error) })
  } finally { db.close() }
}
// 存不下（隐私模式等）只影响刷新后恢复，这次打开还连着
export const rememberHandle = (h: PlanFileHandle) => run('readwrite', s => s.put(h, KEY)).catch(() => undefined)
export const recallHandle = () => run<PlanFileHandle | undefined>('readonly', s => s.get(KEY)).then(h => h ?? null).catch(() => null)
export const forgetHandle = () => run('readwrite', s => s.delete(KEY)).catch(() => undefined)
