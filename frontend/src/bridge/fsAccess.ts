import type { TreeNode } from './types'

/**
 * 浏览器（Chromium / Electron 同源）的「真实目录工作区」实现，走 File System Access API。
 *
 * 用途：没有原生插件的环境（网页预览、鸿蒙壳）也能让「打开文件夹 → 打开系统目录」
 * 选中一个**真实目录**并直接读写它，语义与安卓的 SAF 目录一致：
 * 路径都是「工作区相对路径」（`/notes/a.md`），目录句柄负责落地。
 *
 * 目录句柄不能 JSON 序列化，所以记录分两处存：
 * - 名字与顺序：localStorage（见 mock.ts 的工作区记录）
 * - 句柄本体：IndexedDB（本文件的 `keepHandle` / `acquireHandle`）
 */

/** 与安卓插件同款的防爆保护：SAF / 目录遍历都可能遇到超大目录 */
const MAX_NODES = 3000
const MAX_DEPTH = 12

/** 目录句柄：这里用 any 兼容各版本 TS 的 DOM 类型（File System Access 的类型定义不齐全） */
export type DirHandle = any
type Dir = DirHandle
type FileHandle = any

/** 浏览器是否支持选目录（Firefox / Safari 不支持，UI 会给出提示） */
export function fsAccessSupported(): boolean {
  return typeof (window as any).showDirectoryPicker === 'function'
}

// ------------------------------------------------------------------ 句柄持久化

const DB_NAME = 'xmd-fs-access'
const STORE = 'dirs'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 不可用'))
  })
}

async function idbSet(key: string, value: unknown) {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb()
  const out = await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
  db.close()
  return out
}

async function idbDel(key: string) {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

/** 句柄内存缓存：每次用它读写前都会确认权限 */
const cache = new Map<string, Dir>()

export async function keepHandle(id: string, handle: Dir) {
  cache.set(id, handle)
  try {
    await idbSet(id, handle)
  } catch {
    // 存不下（隐私模式等）也只是重启后需要重新选目录，本次会话仍可用
  }
}

/**
 * 取句柄并确认授权状态。
 * Chrome 在页面重载后会把之前的授权降级成 `'prompt'`，此时**只能在用户手势里**
 * 调 `requestPermission`，所以 `ask` 必须由调用方按场景传（列表／刷树＝false，点选＝true）。
 */
export async function acquireHandle(
  id: string,
  ask = false
): Promise<{ handle: Dir | null; perm: 'granted' | 'prompt' | 'none' }> {
  let h = cache.get(id)
  if (!h) {
    try {
      h = await idbGet<Dir>(id)
    } catch {
      h = undefined
    }
    if (!h) return { handle: null, perm: 'none' }
    cache.set(id, h)
  }
  let perm: 'granted' | 'prompt' | 'none' = 'granted'
  try {
    perm = ((await h.queryPermission?.({ mode: 'readwrite' })) ?? 'granted') as any
  } catch {
    return { handle: null, perm: 'none' }
  }
  if (perm !== 'granted' && ask) {
    try {
      perm = ((await h.requestPermission?.({ mode: 'readwrite' })) ?? perm) as any
    } catch {
      perm = 'none'
    }
  }
  return { handle: perm === 'granted' ? h : null, perm }
}

export async function dropHandle(id: string) {
  cache.delete(id)
  try {
    await idbDel(id)
  } catch {
    // 忽略
  }
}

/**
 * 弹系统目录选择器。必须在用户手势里调用（对话框按钮的 click 链路满足）。
 * 返回 null＝用户取消；不支持该 API 时抛错，由调用方显示在对话框里。
 */
export async function pickDirectory(): Promise<{ id: string; name: string; handle: Dir } | null> {
  if (!fsAccessSupported()) throw new Error('当前浏览器不支持选择系统目录，请改用桌面版或安卓 App')
  let handle: Dir
  try {
    handle = await (window as any).showDirectoryPicker({ mode: 'readwrite', id: 'xmd-workspace' })
  } catch (e: any) {
    if (e?.name === 'AbortError') return null // 用户取消
    // 浏览器在嵌入式 WebView / 非用户手势下会拒绝弹选择器，给一句能看懂的话
    if (e?.name === 'SecurityError' || /user gesture/i.test(String(e?.message ?? ''))) {
      throw new Error('当前环境不允许弹出目录选择器，请在系统浏览器或安卓 App 里使用')
    }
    throw new Error(`打开系统目录失败：${e?.message ?? e}`)
  }
  try {
    const granted = await handle.requestPermission?.({ mode: 'readwrite' })
    if (granted && granted !== 'granted') throw new Error('未授予读写权限')
  } catch (e: any) {
    throw new Error(`没有获得该目录的读写权限：${e?.message ?? e}`)
  }
  // 同一目录可能选多次，用句柄自身标识去重（拿不到就退回名字）
  const tag = String(handle.__xmdId ?? '') || `${handle.name}:${handle.kind}`
  handle.__xmdId = tag
  return { id: 'sys:' + tag, name: handle.name || '系统目录', handle }
}

// ------------------------------------------------------------------ 路径解析

function segments(path: string) {
  return String(path ?? '').split('/').filter(Boolean)
}

function parentPathOf(path: string) {
  const s = segments(path)
  s.pop()
  return '/' + s.join('/')
}

function baseOf(path: string) {
  const s = segments(path)
  return s[s.length - 1] ?? ''
}

/** 逐级取父目录句柄（不创建）；父目录不存在返回 null */
async function parentDir(root: Dir, path: string, create = false): Promise<Dir | null> {
  let dir = root
  for (const seg of segments(parentPathOf(path))) {
    try {
      dir = await dir.getDirectoryHandle(seg, { create })
    } catch {
      return null
    }
  }
  return dir
}

async function getChild(root: Dir, path: string): Promise<{ handle: Dir | FileHandle; isDir: boolean } | null> {
  const parent = await parentDir(root, path)
  if (!parent) return null
  const name = baseOf(path)
  try {
    const d = await parent.getDirectoryHandle(name)
    return { handle: d, isDir: true }
  } catch {
    /* 不是目录，再当文件试 */
  }
  try {
    const f = await parent.getFileHandle(name)
    return { handle: f, isDir: false }
  } catch {
    return null
  }
}

// ------------------------------------------------------------------ 文件树

export async function treeOf(root: Dir): Promise<TreeNode[]> {
  const budget = { left: MAX_NODES }
  return walk(root, '', 1, budget)
}

async function walk(dir: Dir, parentPath: string, depth: number, budget: { left: number }): Promise<TreeNode[]> {
  if (depth > MAX_DEPTH || budget.left <= 0) return []
  const nodes: TreeNode[] = []
  const dirs: TreeNode[] = []
  const files: TreeNode[] = []
  // entries() 是异步迭代器（部分实现同时提供 values()）
  const it: AsyncIterable<[string, any]> = (dir as any).entries?.() ?? (dir as any).values?.() ?? []
  for await (const [, h] of it) {
    if (budget.left-- <= 0) break
    const name = String(h?.name ?? '')
    if (!name) continue
    const path = `${parentPath}/${name}`
    if (h.kind === 'directory') {
      dirs.push({ name, path, isDir: true, children: await walk(h, path, depth + 1, budget) })
    } else {
      files.push({ name, path, isDir: false })
    }
  }
  const byName = (a: TreeNode, b: TreeNode) => a.name.localeCompare(b.name, 'zh-Hans')
  dirs.sort(byName)
  files.sort(byName)
  nodes.push(...dirs, ...files)
  return nodes
}

// ------------------------------------------------------------------ 读写

export async function readText(root: Dir, path: string): Promise<string> {
  const hit = await getChild(root, path)
  if (!hit || hit.isDir) throw new Error(`文件不存在：${path}`)
  const file = await (hit.handle as FileHandle).getFile()
  return await file.text()
}

/** dataURL → ArrayBuffer（写入二进制资源时用） */
function dataUrlToBuffer(dataUrl: string): ArrayBuffer {
  const comma = dataUrl.indexOf(',')
  const head = comma < 0 ? '' : dataUrl.slice(0, comma)
  const body = comma < 0 ? dataUrl : dataUrl.slice(comma + 1)
  if (/;base64/i.test(head)) {
    const bin = atob(body)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes.buffer
  }
  return new TextEncoder().encode(decodeURIComponent(body)).buffer
}

export async function writeData(root: Dir, path: string, data: ArrayBuffer | string) {
  const parent = await parentDir(root, path, true)
  if (!parent) throw new Error(`目录不可用：${parentPathOf(path)}`)
  const fh = await parent.getFileHandle(baseOf(path), { create: true })
  const writable = await (fh as any).createWritable()
  await writable.write(data as any)
  await writable.close()
}

export const writeText = (root: Dir, path: string, text: string) => writeData(root, path, text)

export async function writeDataUrl(root: Dir, path: string, dataUrl: string) {
  await writeData(root, path, dataUrlToBuffer(dataUrl))
}

export async function createFileAt(root: Dir, path: string) {
  const hit = await getChild(root, path)
  if (hit) return
  await writeText(root, path, '')
}

export async function createDirAt(root: Dir, path: string) {
  let dir = root
  for (const seg of segments(path)) dir = await dir.getDirectoryHandle(seg, { create: true })
}

export async function removeAt(root: Dir, path: string) {
  const hit = await getChild(root, path)
  if (!hit) return
  const parent = await parentDir(root, path)
  if (!parent) throw new Error(`目录不可用：${parentPathOf(path)}`)
  await parent.removeEntry(baseOf(path), { recursive: hit.isDir })
}

/** 目录整体搬移：先递归复制到新位置，再删旧的（API 没有 move） */
export async function renameAt(root: Dir, oldPath: string, newPath: string) {
  const hit = await getChild(root, oldPath)
  if (!hit) throw new Error(`不存在：${oldPath}`)
  if (hit.isDir) {
    await createDirAt(root, newPath)
    await copyDir(hit.handle, root, newPath, { left: MAX_NODES })
  } else {
    const file = await (hit.handle as FileHandle).getFile()
    await writeData(root, newPath, await file.arrayBuffer())
  }
  await removeAt(root, oldPath)
}

async function copyDir(srcDir: Dir, dstRoot: Dir, dstBase: string, budget: { left: number }) {
  const it: AsyncIterable<any> = srcDir.values?.() ?? []
  for await (const h of it) {
    if (budget.left-- <= 0) return
    const path = `${dstBase}/${String(h.name ?? '')}`
    if (h.kind === 'directory') {
      await createDirAt(dstRoot, path)
      await copyDir(h, dstRoot, path, budget)
    } else {
      const file = await h.getFile()
      await writeData(dstRoot, path, await file.arrayBuffer())
    }
  }
}

export async function exists(root: Dir, path: string) {
  return !!(await getChild(root, path))
}

// ------------------------------------------------------------------ 资源 URL

const blobUrls = new Map<string, string>()

/** 图片 / PDF 等可直接给 WebView 用的地址（blob URL，按路径缓存） */
export async function urlOf(root: Dir, path: string): Promise<string> {
  const key = `${(root as any).__xmdId ?? ''}|${path}`
  const hit = blobUrls.get(key)
  if (hit) return hit
  const found = await getChild(root, path)
  if (!found || found.isDir) return ''
  const file = await (found.handle as FileHandle).getFile()
  const url = URL.createObjectURL(file)
  blobUrls.set(key, url)
  return url
}

export async function dataUrlOf(root: Dir, path: string): Promise<string> {
  const found = await getChild(root, path)
  if (!found || found.isDir) return ''
  const file = await (found.handle as FileHandle).getFile()
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}
