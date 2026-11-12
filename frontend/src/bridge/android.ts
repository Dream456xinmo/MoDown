import type { PlatformBridge, TreeNode, WorkspaceInfo, WorkspaceState } from './types'
import { mockBridge } from './mock'
import { isTextPath } from '../utils/languages'
import { pickBrowserFile, safeName, fileToDataUrl, uniqueName } from '../utils/filePick'

/**
 * Android（Capacitor）桥：在 mock 桥之上叠一层「系统目录工作区」。
 *
 * 分工：
 * - **本地工作区**（默认，不可删）＝ App 内部目录，读写仍走 mock 桥（localStorage 虚拟文件树），
 *   没有行为变化，图片/附件等既有能力不受影响。
 * - **系统目录工作区**＝ 用户用系统文件管理器（SAF）选中的真实目录，文件树与读写全部交给
 *   原生插件 `XmdFs`（见 mobile/Android/.../XmdFsPlugin.java）。
 * - **导出 / 另存为**一律弹系统文件管理器选保存位置（两种工作区都一样）。
 *
 * 插件不存在（旧版 APK）时整体退回 mock，保证界面不会白屏。
 */

/** 原生插件暴露给 JS 的方法（参数统一用对象，与 Capacitor 的调用约定一致） */
interface XmdFsPlugin {
  listWorkspaces(): Promise<WorkspaceState>
  pickDirectory(): Promise<WorkspaceInfo | null | undefined>
  setActiveWorkspace(opts: { id: string }): Promise<WorkspaceState>
  removeWorkspace(opts: { id: string }): Promise<WorkspaceState>
  getTree(): Promise<{ nodes?: TreeNode[]; truncated?: boolean } | undefined>
  readText(opts: { path: string }): Promise<{ text?: string } | undefined>
  writeText(opts: { path: string; text: string }): Promise<void>
  writeDataUrl(opts: { path: string; dataUrl: string }): Promise<void>
  readDataUrl(opts: { path: string }): Promise<{ dataUrl?: string } | undefined>
  createFile(opts: { path: string }): Promise<void>
  createDir(opts: { path: string }): Promise<void>
  removeItem(opts: { path: string }): Promise<void>
  renameItem(opts: { from: string; to: string }): Promise<void>
  openDoc(opts: { path: string }): Promise<void>
  saveAs(opts: { fileName: string; content: string; mime: string }): Promise<{ name?: string; uri?: string } | undefined>
  /** HTML → PDF：原生 WebView 排版后调起系统打印预览（用户在界面里选「保存为 PDF」+ 存储目录） */
  exportPdf(opts: { fileName: string; html: string }): Promise<PdfResult | undefined>
  /** 用系统浏览器打开外链（WebView 里 window.open 不一定有响应） */
  openUrl(opts: { url: string }): Promise<void>
  /** 显式让系统弹出软键盘（Chromium 自己没弹时的兜底，键盘已显示时是空操作）；返回诊断回执 */
  showKeyboard(): Promise<Record<string, unknown>>
}

/**
 * 原生 PDF 导出结果。
 * printed ＝ 已调起系统打印预览（安卓公开 API 不让应用自己把 PDF 写进文件，
 * 用户在打印界面里选「保存为 PDF」并挑存储目录，所以没有可回传的路径）。
 */
interface PdfResult {
  printed?: boolean
}

/** 本地工作区（App 内部目录）的恒等记录 */
const LOCAL_WS: WorkspaceInfo = {
  id: 'local',
  kind: 'local',
  name: '本地工作区',
  removable: false,
  available: true
}

/**
 * 拿到原生插件代理。
 *
 * Capacitor 往 WebView 注入的 `native-bridge.js` 只提供 `Capacitor.nativePromise(pluginId, method, options)`
 * 与 `isNativePlatform()`；`registerPlugin()` / `Capacitor.Plugins.Xxx` 那套是 **@capacitor/core 这个 npm 包**
 * 才有的语法糖，本项目前端刻意没打包它。早先只认 `cap.registerPlugin`，于是原生插件明明已经
 * `registerPlugin(XmdFsPlugin.class)` 注册好，JS 侧却一直拿到 null，界面就报成「当前 App 里没有文件访问插件」。
 * 这里改成直接走注入运行时的 nativePromise，方法名与 Java 的 @PluginMethod 一一对应。
 */
function plugin(): XmdFsPlugin | null {
  const cap = (window as any).Capacitor
  if (!cap) return null
  if (typeof cap.nativePromise === 'function') {
    const call = (method: string, args?: Record<string, unknown>) => cap.nativePromise('XmdFs', method, args ?? {})
    return {
      listWorkspaces: () => call('listWorkspaces'),
      pickDirectory: () => call('pickDirectory'),
      setActiveWorkspace: opts => call('setActiveWorkspace', opts),
      removeWorkspace: opts => call('removeWorkspace', opts),
      getTree: () => call('getTree'),
      readText: opts => call('readText', opts),
      writeText: opts => call('writeText', opts),
      writeDataUrl: opts => call('writeDataUrl', opts),
      readDataUrl: opts => call('readDataUrl', opts),
      createFile: opts => call('createFile', opts),
      createDir: opts => call('createDir', opts),
      removeItem: opts => call('removeItem', opts),
      renameItem: opts => call('renameItem', opts),
      openDoc: opts => call('openDoc', opts),
      saveAs: opts => call('saveAs', opts),
      exportPdf: opts => call('exportPdf', opts),
      openUrl: opts => call('openUrl', opts),
      showKeyboard: () => call('showKeyboard')
    }
  }
  // 万一以后前端打包了 @capacitor/core，退回它生成的代理
  try {
    if (typeof cap.registerPlugin === 'function') return cap.registerPlugin('XmdFs') as XmdFsPlugin
    return (cap.Plugins && cap.Plugins.XmdFs) || null
  } catch {
    return null
  }
}

function collectPaths(nodes: TreeNode[], out: Set<string>) {
  for (const n of nodes) {
    out.add(n.path)
    if (n.children?.length) collectPaths(n.children, out)
  }
}

export function createAndroidBridge(): PlatformBridge {
  const native = plugin()

  /** 当前活动工作区（决定读写走原生还是 mock）；同步值，assetUrl 这类同步接口也要用 */
  let active: WorkspaceInfo = LOCAL_WS
  /** null＝还没探过；false＝本次探测失败（**不是**永久结论，隔几秒会重试） */
  let ready: boolean | null = null
  let probedAt = 0
  let probeError = ''
  /** 探测失败后的重试间隔：一次偶发的原生异常不该把系统目录功能判死 */
  const RETRY_MS = 4000
  /** 最近一次 getTree 得到的路径集合，用于导入时的重名让路 */
  let known = new Set<string>()
  /** 软键盘兜底是否已判定不可用（旧 APK 没有 showKeyboard），失败一次就不再打扰原生 */
  let kbFailed = false

  const isSystem = () => active.kind === 'system'

  function activeOf(state: WorkspaceState): WorkspaceInfo {
    return state.items.find(i => i.id === state.active) ?? LOCAL_WS
  }

  /**
   * 取原生插件：顺带同步一次活动工作区（插件把它存在 SharedPreferences 里，
   * 冷启动后重开系统目录也能接着用）。插件缺失/报错则返回 null，调用方退回 mock。
   */
  async function nativeReady(): Promise<XmdFsPlugin | null> {
    if (!native) return null
    // 上次失败不代表永远失败：授权弹窗被打断、目录临时不可读都可能抛错，隔几秒重试
    if (ready === false && Date.now() - probedAt < RETRY_MS) return null
    try {
      const state = await native.listWorkspaces()
      ready = true
      probeError = ''
      active = activeOf(state)
      return native
    } catch (e: any) {
      ready = false
      probedAt = Date.now()
      probeError = String(e?.message ?? e?.errorMessage ?? e ?? '')
      return null
    }
  }

  /**
   * 原生不可用时的报错。
   * 以前不管什么原因都说「没有文件访问插件」，真机上误导排查 —— 现在带上原生返回的真实原因。
   */
  function noPlugin(): Error {
    return new Error(
      probeError
        ? `文件访问插件不可用：${probeError}`
        : '当前 App 里没有文件访问插件，请更新到最新版本后再试'
    )
  }

  async function applyState(p: XmdFsPlugin): Promise<WorkspaceState> {
    const state = await p.listWorkspaces()
    active = activeOf(state)
    return state
  }

  /** 先探活再判断当前是不是系统目录（顺序写错会读到还没同步的 active） */
  async function isSystemNow(): Promise<boolean> {
    await nativeReady()
    return isSystem()
  }

  /** 系统目录工作区的路径 → 写入二进制资源 */
  async function writeAsset(path: string, dataUrl: string) {
    const p = await nativeReady()
    if (!p) throw new Error('系统目录当前不可写')
    await p.writeDataUrl({ path, dataUrl })
    known.add(path)
  }

  const androidBridge: PlatformBridge = {
    ...mockBridge,
    platform: 'capacitor-android',
    supportsWorkspaces: true,

    // ---------------------------------------------------------------- 工作区

    async listWorkspaces() {
      const p = await nativeReady()
      if (!p) return mockBridge.listWorkspaces!()
      return applyState(p)
    },

    /** 取消返回 null；没有原生插件＝无法浏览系统目录，抛错让对话框显示原因 */
    async pickWorkspace() {
      const p = await nativeReady()
      if (!p) throw noPlugin()
      const ws = await p.pickDirectory()
      // 原生在用户取消时 resolve 空对象，没有 id
      if (!ws || !ws.id) return null
      active = ws
      known = new Set()
      return ws
    },

    async useWorkspace(id) {
      const p = await nativeReady()
      if (!p) return mockBridge.useWorkspace!(id)
      await p.setActiveWorkspace({ id })
      known = new Set()
      await applyState(p)
    },

    async forgetWorkspace(id) {
      const p = await nativeReady()
      if (!p) return mockBridge.forgetWorkspace!(id)
      const state = await p.removeWorkspace({ id })
      active = activeOf(state)
      known = new Set()
      return state
    },

    /** 支持工作区列表后，应用内的「选文件夹」不再使用 */
    async openFolder() {
      return null
    },

    // ---------------------------------------------------------------- 文件读写

    async getTree() {
      const p = await nativeReady()
      if (!p || !isSystem()) return mockBridge.getTree()
      const res = await p.getTree()
      const nodes = res?.nodes ?? []
      known = new Set()
      collectPaths(nodes, known)
      return nodes
    },

    async readFile(path) {
      const p = await nativeReady()
      if (!p || !isSystem()) return mockBridge.readFile(path)
      const res = await p.readText({ path })
      return res?.text ?? ''
    },

    async writeFile(path, content) {
      const p = await nativeReady()
      if (!p || !isSystem()) return mockBridge.writeFile(path, content)
      await p.writeText({ path, text: content })
      known.add(path)
    },

    async createFile(path) {
      const p = await nativeReady()
      if (!p || !isSystem()) return mockBridge.createFile(path)
      await p.createFile({ path })
      known.add(path)
    },

    async createDir(path) {
      const p = await nativeReady()
      if (!p || !isSystem()) return mockBridge.createDir(path)
      await p.createDir({ path })
      known.add(path)
    },

    async rename(oldPath, newPath) {
      const p = await nativeReady()
      if (!p || !isSystem()) return mockBridge.rename(oldPath, newPath)
      await p.renameItem({ from: oldPath, to: newPath })
      known = new Set([...known].map(k => (k === oldPath || k.startsWith(oldPath + '/') ? newPath + k.slice(oldPath.length) : k)))
    },

    async remove(path) {
      const p = await nativeReady()
      if (!p || !isSystem()) return mockBridge.remove(path)
      await p.removeItem({ path })
      for (const k of [...known]) {
        if (k === path || k.startsWith(path + '/')) known.delete(k)
      }
    },

    // ---------------------------------------------------------------- 资源导入

    async importImage(name, dataUrl) {
      if (!(await isSystemNow())) return mockBridge.importImage(name, dataUrl)
      const rel = `/assets/${safeName(name)}`
      await writeAsset(rel, dataUrl)
      return rel
    },

    async importFile() {
      const p = await nativeReady()
      if (!p || !isSystem()) return mockBridge.importFile()
      const file = await pickBrowserFile('')
      if (!file) return null
      const name = uniqueName(safeName(file.name), n => known.has('/' + n))
      const path = '/' + name
      if (isTextPath(name)) await p.writeText({ path, text: await file.text() })
      else await p.writeDataUrl({ path, dataUrl: await fileToDataUrl(file) })
      known.add(path)
      return path
    },

    async importAsset(folder) {
      const p = await nativeReady()
      if (!p || !isSystem()) return mockBridge.importAsset(folder)
      const file = await pickBrowserFile(folder === 'assets' ? 'image/*' : '')
      if (!file) return null
      const rel = `/${folder}/${uniqueName(safeName(file.name), n => known.has(`/${folder}/` + n))}`
      await p.writeDataUrl({ path: rel, dataUrl: await fileToDataUrl(file) })
      known.add(rel)
      return rel
    },

    async importAssetRaw(name, dataUrl, folder) {
      if (!(await isSystemNow())) return mockBridge.importAssetRaw(name, dataUrl, folder)
      const rel = `/${folder}/${safeName(name)}`
      await writeAsset(rel, dataUrl)
      return rel
    },

    // ---------------------------------------------------------------- 导出 / 打开

    /** 导出：无论哪个工作区都弹系统文件管理器选保存位置；取消返回空串 */
    async saveAs(fileName, content, mime) {
      const p = await nativeReady()
      if (!p) return mockBridge.saveAs(fileName, content, mime)
      const res = await p.saveAs({ fileName, content, mime })
      return res?.name ? res.name : ''
    },

    /**
     * PDF：原生 WebView 排版后调起系统打印预览，用户在打印界面选「保存为 PDF」并挑手机存储目录。
     * 成功调起返回 'print'（没有可回传的路径），拿不到插件时抛错让界面说清原因。
     */
    async exportPdfDirect(fileName, html) {
      const p = await nativeReady()
      if (!p) throw new Error(`${noPlugin().message}；也可先「导出 HTML」再用浏览器打开后打印为 PDF`)
      const res = await p.exportPdf({ fileName, html })
      return res?.printed ? 'print' : ''
    },

    async openPath(path) {
      const p = await nativeReady()
      if (!p || !isSystem()) return mockBridge.openPath(path)
      await p.openDoc({ path })
    },

    /** 外链交给系统浏览器：WebView 里 window.open / <a target=_blank> 往往没有任何响应 */
    async openUrl(url) {
      const p = await nativeReady()
      if (!p) return mockBridge.openUrl(url)
      await p.openUrl({ url })
    },

    /**
     * 软键盘兜底：不探活、不等 readiness（聚焦那一刻必须尽快发出），失败一次就停用。
     * 旧 APK 没有这个方法 → 第一次调用即 reject → 之后不再打扰。
     * 回执原样返回给调用方（`softKeyboard.ts` 用它判断是不是真的没弹出来）。
     */
    ensureKeyboard() {
      if (!native || kbFailed) return
      return native.showKeyboard().catch(() => {
        kbFailed = true
        return undefined
      })
    },

    /**
     * 系统目录里的文件用 content:// 标识，WebView 不能直接当图片地址加载，
     * 因此这里返回空串；真正显示时由 utils/assetSrc.ts 再调用 readAssetDataUrl
     * 转成 data URL（预览、富文本、文件查看器共用这一条路径）。
     */
    assetUrl(path) {
      if (isSystem()) return ''
      return mockBridge.assetUrl(path)
    },

    async readAssetDataUrl(path) {
      const p = await nativeReady()
      if (!p || !isSystem()) return mockBridge.readAssetDataUrl(path)
      const res = await p.readDataUrl({ path })
      return res?.dataUrl ?? ''
    },

    // 手机上没有窗口拖拽 / 启动参数 / 第二实例，统一沿用 mock 的空实现
    async copyInto(paths, dir) {
      return mockBridge.copyInto(paths, dir)
    }
  }

  return androidBridge
}
