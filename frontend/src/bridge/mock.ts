import type { PlatformBridge, TreeNode, WorkspaceInfo, WorkspaceState } from './types'
import { isTextPath } from '../utils/languages'
import { isNativeShell } from '../utils/device'
import { pickSaveLocation } from '../composables/pickers'
import { pickBrowserFile, safeName, fileToDataUrl, uniqueName } from '../utils/filePick'
import * as fsa from './fsAccess'

const FS_KEY = 'modown:mock:fs'
const IMG_KEY = 'modown:mock:images'
const SET_KEY = 'modown:mock:settings'
/** 打开记录（只记系统目录；本地工作区是隐式恒存在的第一项） */
const WS_KEY = 'modown:mock:workspaces'

/** 本地工作区（localStorage 虚拟文件树）的固定 id，与安卓原生层一致 */
const LOCAL_ID = 'local'
const LOCAL_NAME = '本地工作区'

/** assetUrl 生成的 blob URL 缓存 */
let blobUrls: Record<string, string> | null = null

const seedFiles: Record<string, string> = {
  '/README.md': `# 欢迎使用 MoDown

这是一款**本地优先**的跨平台 Markdown 编辑器。

## 快速上手

- 左侧文件树选择或新建文件
- 中间为编辑区：默认 Tiptap 富文本，可切换 CodeMirror 6 源码模式
- 右侧可开启分屏预览与大纲栏（支持展开/折叠）
- 预览与导出的 Markdown 主题可在设置中切换

### 三级标题示例

#### 四级
##### 五级
###### 六级

> 当前为浏览器 Mock 桥（数据存 localStorage），接入 Wails / Capacitor / ArkWeb 后自动切换。

\`\`\`js
// 代码围栏内不应被大纲识别
// ## 这是一行注释
\`\`\`
`,
  '/notes/todo.md': `# 项目待办

## Phase 1 前端骨架

- [x] Vue3 + Vite + TS
- [x] PlatformBridge 抽象
- [x] 编辑器 / 预览 / 大纲 / 文件树
- [ ] 图片导入交互

## Phase 2 桌面壳

- [ ] Wails 初始化
- [ ] WebView2 检测
`
}

function loadFs(): Record<string, string> {
  const raw = localStorage.getItem(FS_KEY)
  if (raw) {
    try { return JSON.parse(raw) as Record<string, string> } catch { /* fallthrough */ }
  }
  localStorage.setItem(FS_KEY, JSON.stringify(seedFiles))
  return { ...seedFiles }
}

function persist(fs: Record<string, string>) {
  localStorage.setItem(FS_KEY, JSON.stringify(fs))
}

function loadImgs(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(IMG_KEY) || '{}') as Record<string, string>
  } catch {
    return {}
  }
}

/** 字符串按 UTF-8 转 base64（分块避免超长参数把栈撑爆） */
function toBase64(text: string) {
  const bytes = new TextEncoder().encode(text)
  const CH = 0x8000
  let bin = ''
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)))
  }
  return btoa(bin)
}

/** 二进制资源（图片 / 导入的非文本文件）以 dataURL 存 localStorage */
function saveImg(path: string, dataUrl: string) {
  const imgs = loadImgs()
  imgs[path] = dataUrl
  localStorage.setItem(IMG_KEY, JSON.stringify(imgs))
}

function buildTree(files: Record<string, string>): TreeNode[] {
  const root: TreeNode = { name: '', path: '/', isDir: true, children: [] }
  const dirIndex = new Map<string, TreeNode>()
  dirIndex.set('/', root)

  const paths = Object.keys(files).sort()
  for (const p of paths) {
    const parts = p.split('/').filter(Boolean)
    let parent = root
    let acc = ''
    for (let i = 0; i < parts.length; i++) {
      acc += '/' + parts[i]
      const isFile = i === parts.length - 1
      let node = dirIndex.get(acc)
      if (!node) {
        node = {
          name: parts[i],
          path: acc,
          isDir: !isFile,
          children: isFile ? undefined : []
        }
        parent.children = parent.children || []
        parent.children.push(node)
        if (!isFile) dirIndex.set(acc, node)
      }
      parent = node
    }
  }
  return root.children || []
}

// ---------------------------------------------------------------- 工作区（本地 / 系统目录）

interface WsRecord {
  id: string
  name: string
}

function readWsRecords(): WsRecord[] {
  try {
    const list = JSON.parse(localStorage.getItem(WS_KEY) || '[]') as WsRecord[]
    return Array.isArray(list) ? list.filter(r => r && r.id && r.name) : []
  } catch {
    return []
  }
}

function writeWsRecords(list: WsRecord[]) {
  localStorage.setItem(WS_KEY, JSON.stringify(list))
}

function readActiveId(): string {
  return localStorage.getItem(WS_KEY + ':active') || LOCAL_ID
}

function writeActiveId(id: string) {
  try {
    localStorage.setItem(WS_KEY + ':active', id)
  } catch {
    // 存储被占满时不阻塞：本次会话仍能按内存里的 activeId 走
  }
}

/** 当前活动工作区：local＝localStorage 虚拟树；其余＝用户选的真实目录句柄 */
let activeId = readActiveId()
/** 最近一次文件树里的路径，导入时用来让开重名 */
let knownPaths = new Set<string>()

function localItem(): WorkspaceInfo {
  return { id: LOCAL_ID, kind: 'local', name: LOCAL_NAME, removable: false, available: true }
}

/** 逐条确认记录还能不能访问（句柄丢失／用户撤了权限＝失效，界面据此提示移除） */
async function buildState(): Promise<WorkspaceState> {
  const items: WorkspaceInfo[] = [localItem()]
  for (const rec of readWsRecords()) {
    // 这里不能用 ask：列表渲染不在用户手势里，只能查不能请求
    const { perm } = await fsa.acquireHandle(rec.id)
    items.push({
      id: rec.id,
      kind: 'system',
      name: rec.name,
      uri: rec.name,
      removable: true,
      available: perm !== 'none'
    })
  }
  return { active: activeId, items }
}

/**
 * 取当前活动的系统目录句柄。
 * 返回 null＝用本地工作区；抛错＝记录里的目录已经访问不了（调用方会提示用户重选）。
 */
async function systemDir(): Promise<fsa.DirHandle | null> {
  if (activeId === LOCAL_ID) return null
  const { handle, perm } = await fsa.acquireHandle(activeId)
  if (handle) return handle
  throw new Error(
    perm === 'prompt'
      ? '需要在「打开文件夹」里重新点一次该目录以确认访问权限'
      : '该目录的访问授权已失效，请在「打开文件夹」里重新选择，或改回本地工作区'
  )
}

/** 浏览器 / Phase1 开发用 Mock 桥：localStorage 持久化 */
export const mockBridge: PlatformBridge = {
  platform: 'browser',
  supportsWorkspaces: true,

  async getTree() {
    const dir = await systemDir()
    if (!dir) return buildTree(loadFs())
    const nodes = await fsa.treeOf(dir)
    knownPaths = new Set()
    const collect = (list: TreeNode[]) => {
      for (const n of list) {
        knownPaths.add(n.path)
        if (n.children?.length) collect(n.children)
      }
    }
    collect(nodes)
    return nodes
  },

  async listWorkspaces() {
    activeId = readActiveId()
    return buildState()
  },

  async pickWorkspace() {
    const picked = await fsa.pickDirectory()
    if (!picked) return null // 用户取消
    const list = readWsRecords().filter(r => r.id !== picked.id)
    list.unshift({ id: picked.id, name: picked.name })
    writeWsRecords(list)
    await fsa.keepHandle(picked.id, picked.handle)
    activeId = picked.id
    writeActiveId(picked.id)
    knownPaths = new Set()
    return { id: picked.id, kind: 'system', name: picked.name, uri: picked.name, removable: true, available: true }
  },

  async useWorkspace(id) {
    if (id !== LOCAL_ID) {
      if (!readWsRecords().some(r => r.id === id)) throw new Error('打开记录里没有这个工作区')
      // 这里在用户点选的手势链路里，可以真正弹浏览器的授权确认
      const { handle, perm } = await fsa.acquireHandle(id, true)
      if (!handle) {
        throw new Error(
          perm === 'prompt' ? '没有获得该目录的访问权限，请重新选择目录' : '该目录已不可访问，请重新「打开系统目录」'
        )
      }
    }
    activeId = id
    writeActiveId(id)
    knownPaths = new Set()
  },

  async forgetWorkspace(id) {
    if (id === LOCAL_ID) throw new Error(`${LOCAL_NAME} 是默认工作区，不能移除`)
    writeWsRecords(readWsRecords().filter(r => r.id !== id))
    await fsa.dropHandle(id)
    if (activeId === id) {
      // 移除的是当前工作区：回落到本地工作区，免得界面停在选不中的目录上
      activeId = LOCAL_ID
      writeActiveId(LOCAL_ID)
    }
    const st = await buildState()
    return st
  },

  /** 桌面用系统对话框、手机用工作区列表对话框，这里都不需要返回路径 */
  async openFolder() {
    return null
  },

  async readFile(path) {
    const dir = await systemDir()
    if (dir) return fsa.readText(dir, path)
    const fs = loadFs()
    if (!(path in fs)) throw new Error(`文件不存在: ${path}`)
    return fs[path]
  },

  async writeFile(path, content) {
    const dir = await systemDir()
    if (dir) {
      await fsa.writeText(dir, path, content)
      knownPaths.add(path)
      return
    }
    const fs = loadFs()
    fs[path] = content
    persist(fs)
  },

  async createFile(path) {
    const dir = await systemDir()
    if (dir) {
      await fsa.createFileAt(dir, path)
      knownPaths.add(path)
      return
    }
    const fs = loadFs()
    fs[path] = fs[path] ?? ''
    persist(fs)
  },

  async createDir(path) {
    const dir = await systemDir()
    if (dir) {
      await fsa.createDirAt(dir, path)
      knownPaths.add(path)
      return
    }
    // Mock 中以占位文件模拟空目录
    const fs = loadFs()
    fs[`${path}/.keep`] = ''
    persist(fs)
  },

  async rename(oldPath, newPath) {
    const dir = await systemDir()
    if (dir) {
      await fsa.renameAt(dir, oldPath, newPath)
      knownPaths = new Set(
        [...knownPaths].map(k => (k === oldPath || k.startsWith(oldPath + '/') ? newPath + k.slice(oldPath.length) : k))
      )
      return
    }
    const fs = loadFs()
    const moved: Record<string, string> = {}
    for (const k of Object.keys(fs)) {
      if (k === oldPath) moved[newPath] = fs[k]
      else if (k.startsWith(oldPath + '/')) moved[newPath + k.slice(oldPath.length)] = fs[k]
      else moved[k] = fs[k]
    }
    persist(moved)
  },

  async remove(path) {
    const dir = await systemDir()
    if (dir) {
      await fsa.removeAt(dir, path)
      for (const k of [...knownPaths]) {
        if (k === path || k.startsWith(path + '/')) knownPaths.delete(k)
      }
      return
    }
    const fs = loadFs()
    for (const k of Object.keys(fs)) {
      if (k === path || k.startsWith(path + '/')) delete fs[k]
    }
    persist(fs)
  },

  async importImage(name, dataUrl) {
    const rel = `/assets/${safeName(name)}`
    const dir = await systemDir()
    if (dir) {
      await fsa.writeDataUrl(dir, rel, dataUrl)
      knownPaths.add(rel)
      return rel
    }
    const imgs = loadImgs()
    imgs[rel] = dataUrl
    localStorage.setItem(IMG_KEY, JSON.stringify(imgs))
    return rel
  },

  async importFile() {
    // 不限制类型：ini/yaml/java/python/go/bat/markdown/html/css/js 等都能导入，且保留原始后缀
    const file = await pickBrowserFile('')
    if (!file) return null
    const safe = safeName(file.name)
    const extMatch = /\.[^.]+$/.exec(safe)
    const ext = extMatch ? extMatch[0] : ''
    const stem = ext ? safe.slice(0, -ext.length) : safe
    const dir = await systemDir()
    if (dir) {
      const path = '/' + uniqueName(safe, n => knownPaths.has('/' + n))
      if (isTextPath(safe)) await fsa.writeText(dir, path, await file.text())
      else await fsa.writeDataUrl(dir, path, await fileToDataUrl(file))
      knownPaths.add(path)
      return path
    }
    let path = '/' + safe
    const fs = loadFs()
    if (path in fs || loadImgs()[path]) path = `/${stem}-${Date.now() % 100000}${ext}`
    if (isTextPath(safe)) {
      fs[path] = await file.text()
    } else {
      // 图片 / PDF 等二进制：按 dataURL 存进资源表，树里占位，可走预览模式打开
      fs[path] = ''
      saveImg(path, await fileToDataUrl(file))
    }
    persist(fs)
    return path
  },

  async importAsset(folder) {
    const accept = folder === 'assets' ? 'image/*' : ''
    const file = await pickBrowserFile(accept)
    if (!file) return null
    const safe = safeName(file.name)
    const dir = await systemDir()
    if (dir) {
      const rel = `/${folder}/${uniqueName(safe, n => knownPaths.has(`/${folder}/${n}`))}`
      await fsa.writeDataUrl(dir, rel, await fileToDataUrl(file))
      knownPaths.add(rel)
      return rel
    }
    const rel = `/${folder}/${safe}`
    if (folder === 'assets' || file.size < 3 * 1024 * 1024) {
      // 图片与小文件：转 dataURL 存 localStorage（Mock 模式限制）
      saveImg(rel, await fileToDataUrl(file))
    } else {
      console.warn(`[mock] 大文件「${safe}」未在浏览器 Mock 模式持久化，仅返回链接路径`)
    }
    return rel
  },

  async importAssetRaw(name, dataUrl, folder) {
    const rel = `/${folder}/${safeName(name)}`
    const dir = await systemDir()
    if (dir) {
      await fsa.writeDataUrl(dir, rel, dataUrl)
      knownPaths.add(rel)
      return rel
    }
    const imgs = loadImgs()
    imgs[rel] = dataUrl
    localStorage.setItem(IMG_KEY, JSON.stringify(imgs))
    return rel
  },

  async exportPdfDirect() {
    throw new Error('当前平台不支持 PDF 直出')
  },

  async exportPdfPandoc() {
    throw new Error('当前平台不支持 pandoc 导出')
  },

  async exportDocxPandoc() {
    throw new Error('当前平台不支持 pandoc 导出')
  },

  async openPath(path) {
    const dir = await systemDir()
    if (dir) {
      const url = await fsa.urlOf(dir, path)
      if (url) {
        window.open(url, '_blank')
        return
      }
      throw new Error('该文件不在当前系统目录工作区里')
    }
    const url = this.assetUrl(path)
    if (url) window.open(url, '_blank')
    else throw new Error('Mock 模式无此文件内容，无法打开')
  },

  /** 浏览器环境：新开一个标签页。被拦截（弹窗设置）时给出可操作的提示 */
  async openUrl(url) {
    const win = window.open(url, '_blank', 'noopener')
    if (!win) throw new Error('浏览器拦截了新窗口，请复制链接手动打开')
  },

  /**
   * 本地工作区：dataURL / blob URL 可直接用。
   * 系统目录工作区要异步取文件，这里给不出地址（图片预览不显示，导出时由 readAssetDataUrl 内联）。
   */
  assetUrl(path) {
    const imgs = loadImgs()
    if (typeof imgs[path] === 'string' && imgs[path]) return imgs[path] as string
    if (activeId !== LOCAL_ID) return ''
    // 文本类：转 blob URL（缓存避免重复创建）
    const text = loadFs()[path]
    if (text !== undefined) {
      const cache = (blobUrls ||= {})
      if (cache[path]) return cache[path]
      const url = URL.createObjectURL(new Blob([text]))
      cache[path] = url
      return url
    }
    return ''
  },

  /**
   * 另存为：
   * - 原生 App（Capacitor / 鸿蒙 WebView）：没有系统对话框、`<a download>` 也常被拦截
   *   → 弹「选择保存位置」，文件写进 App 工作区，可在文件树里直接打开
   * - 普通浏览器：走下载，返回下载用的文件名
   * 返回 ''＝用户取消。
   */
  async saveAs(fileName, content, mime) {
    if (isNativeShell()) {
      const target = await pickSaveLocation(fileName, {
        title: '选择保存位置',
        message: `将保存为 ${fileName}（存入 App 工作区，可在文件树中打开）`
      })
      if (!target) return ''
      const fs = loadFs()
      const textual = isTextPath(target) || /^text\//.test(mime) || mime === 'application/json'
      if (textual) {
        fs[target] = content
      } else {
        // 二进制（PDF / DOCX 等）以 dataURL 存，预览模式能直接看
        fs[target] = ''
        saveImg(target, content.startsWith('data:') ? content : `data:${mime};base64,${toBase64(content)}`)
      }
      persist(fs)
      return target
    }
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
    return fileName
  },

  // 浏览器 Mock 没有启动参数、没有窗口拖拽事件，也不存在"工作区外的文件"，一律空实现
  async openExternal() {
    return null
  },

  async takePendingOpen() {
    return null
  },

  onOpenExternal() {},

  onFileDrop() {},

  async copyInto(paths, dir) {
    // 浏览器/手机壳拿不到系统绝对路径，复制不了；返回原因让上层提示
    return {
      copied: [],
      errors: paths.length ? [`当前运行环境无法把外部文件复制到 ${dir || '工作区根目录'}`] : []
    }
  },

  async readAssetDataUrl(path) {
    const dir = await systemDir()
    if (dir) return fsa.dataUrlOf(dir, path)
    // 图片在 Mock 里本来就以 dataURL 存资源表；取不到就返回空串，导出时保持原链接
    const v = loadImgs()[path]
    return typeof v === 'string' && v.startsWith('data:') ? v : ''
  },

  async getSetting(key) {
    const s = JSON.parse(localStorage.getItem(SET_KEY) || '{}')
    return key in s ? s[key] : null
  },

  async setSetting(key, value) {
    const s = JSON.parse(localStorage.getItem(SET_KEY) || '{}')
    s[key] = value
    localStorage.setItem(SET_KEY, JSON.stringify(s))
  }
}
