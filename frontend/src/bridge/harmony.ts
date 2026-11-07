import type { PlatformBridge, TreeNode, WorkspaceState } from './types'
import { mockBridge } from './mock'
import { safeName, uniqueName } from '../utils/filePick'
import { onBackDepthChange } from '../composables/backstack'

/**
 * 鸿蒙 ArkWeb 原生壳（mobile/HarmonyOS）的桥。
 *
 * 壳在 entry/src/main/ets/pages/Index.ets 里用 javaScriptProxy 把 XmdBridge 挂成
 * `window.nativeHarmony`，约定见 entry/src/main/ets/bridge/XmdBridge.ets：
 * - `invoke(method, argsJson)` 同步，返回 `{ ok, data, error }` 信封，data 里再放一段 JSON 文本
 * - `invokeAsync(method, argsJson)` 异步（asyncMethodList 声明），H5 直接拿到 Promise，内容同样是信封
 * 两个方法都不存在 / 报错（旧壳、鸿蒙桥没接上）时整体回退 mock 桥，功能照常只是不落盘。
 *
 * 和安卓桥最大的差别：**本地工作区在这里是真实目录**（应用沙箱 files/workspace），
 * 不是安卓那边那棵 localStorage 内存树；而系统目录工作区鸿蒙给不了
 * （NEXT 的文件选择器只按「文件」授权，没有 SAF 那种目录级持久授权），
 * 所以 pickWorkspace 由原生返回一句中文说明，导出另存仍然能到手机任意位置。
 */

interface HarmonyNative {
  invoke(method: string, argsJson: string): string
  invokeAsync?(method: string, argsJson: string): Promise<string> | string
}

interface Envelope {
  ok?: boolean
  data?: string
  error?: string
}

/** 原生侧读出来的 data URL 缓存（预览 `<img>` 是同步取值，不能每次都读盘） */
const dataUrls = new Map<string, string>()

/** 探测结果缓存：成功就固定用原生实现；失败过一段时间再试一次 */
let cached: PlatformBridge | null = null
let probedAt = 0
let probeError = ''
const RETRY_MS = 4000

function unwrap(raw: string): unknown {
  const env = JSON.parse(raw) as Envelope
  if (!env || env.ok !== true) throw new Error(env?.error || '鸿蒙原生调用失败')
  return env.data ? (JSON.parse(env.data) as unknown) : null
}

function callSync(n: HarmonyNative, method: string, args?: Record<string, unknown>): unknown {
  return unwrap(n.invoke(method, JSON.stringify(args ?? {})))
}

async function callAsync(n: HarmonyNative, method: string, args?: Record<string, unknown>): Promise<unknown> {
  if (typeof n.invokeAsync !== 'function') throw new Error('当前鸿蒙 App 的原生桥太旧，请重新打包安装')
  const raw = await Promise.resolve(n.invokeAsync(method, JSON.stringify(args ?? {})))
  return unwrap(typeof raw === 'string' ? raw : String(raw))
}

/** 真的挂上了原生桥吗：拿一次工作区状态，比 typeof 判断可靠 */
function readNative(): HarmonyNative | null {
  const n = window.nativeHarmony as HarmonyNative | undefined
  if (!n || typeof n.invoke !== 'function') return null
  try {
    const env = JSON.parse(n.invoke('version', '{}')) as Envelope
    return env && env.ok === true ? n : null
  } catch (e) {
    probeError = e instanceof Error ? e.message : String(e)
    return null
  }
}

/** 把树拍平成路径集合（导入时用来挑不重名的目标） */
function pathsOf(nodes: TreeNode[], into: Set<string> = new Set()): Set<string> {
  for (const n of nodes || []) {
    into.add(n.path)
    if (n.children) pathsOf(n.children, into)
  }
  return into
}

function uniqueLike(known: Set<string>, wanted: string): string {
  if (!known.has(wanted)) return wanted
  const extMatch = /\.[^.]+$/.exec(wanted)
  const ext = extMatch ? extMatch[0] : ''
  const stem = ext ? wanted.slice(0, -ext.length) : wanted
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem}-${i}${ext}`
    if (!known.has(candidate)) return candidate
  }
  return `${stem}-${Date.now()}${ext}`
}

function dropCache(path: string): void {
  dataUrls.delete(path)
}

/** 系统目录工作区在鸿蒙上给不了，这句话由原生返回；桥回退时用这句兜底 */
const NO_SYSTEM_DIR = '鸿蒙版暂不支持选择系统目录：应用只能读写自己的本地工作区，导出可以另存到手机任意位置'

export function createHarmonyBridge(): PlatformBridge {
  const now = Date.now()
  if (cached) return cached
  // 原生对象在壳启动时才注入，冷启动有时序差：失败过就隔几秒再探一次
  if (probeError && now - probedAt < RETRY_MS) return { ...mockBridge, platform: 'harmony' }
  const probe = readNative()
  probedAt = now
  if (!probe) {
    if (!probeError) probeError = '未检测到 window.nativeHarmony'
    return { ...mockBridge, platform: 'harmony' }
  }
  // 非空别名：闭包里也要用，直接拿上面那个可空变量 TS 会不给收窄
  const native: HarmonyNative = probe

  const state = (): WorkspaceState => callSync(native, 'listWorkspaces') as WorkspaceState

  async function importInto(folder: string, imageOnly: boolean): Promise<string | null> {
    const picked = (await callAsync(native, 'pickDoc', { imageOnly })) as { uri: string; name: string } | null
    if (!picked || !picked.uri) return null // 用户取消
    const dir = folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const prefix = dir ? `/${dir}/` : '/'
    const known = pathsOf(await callSync(native, 'getTree') as TreeNode[])
    const name = uniqueName(safeName(picked.name || 'file'), n => known.has(prefix + n))
    const path = prefix + name
    await callAsync(native, 'copyTo', { uri: picked.uri, path })
    known.add(path)
    dropCache(path)
    return path
  }

  const harmonyBridge: PlatformBridge = {
    ...mockBridge,
    platform: 'harmony',
    supportsWorkspaces: true,

    // ---------------------------------------------------------------- 工作区

    async listWorkspaces() {
      return state()
    },

    async useWorkspace(id) {
      // 只有一个本地工作区：原生确认一下，没什么可切换的
      callSync(native, 'useWorkspace', { id })
    },

    async pickWorkspace() {
      // 让原生说原因（哪天 NEXT 开放目录级授权，只改壳就行）；现在恒抛错
      try {
        await callAsync(native, 'pickDirectory')
      } catch (e) {
        throw new Error(e instanceof Error && e.message ? e.message : NO_SYSTEM_DIR)
      }
      return null
    },

    async forgetWorkspace(id) {
      return callSync(native, 'removeWorkspace', { id }) as WorkspaceState
    },

    // ---------------------------------------------------------------- 文件树

    async getTree() {
      return callSync(native, 'getTree') as TreeNode[]
    },

    async readFile(path) {
      const res = callSync(native, 'readText', { path }) as { text?: string }
      return res?.text ?? ''
    },

    async writeFile(path, content) {
      callSync(native, 'writeText', { path, text: content })
      dropCache(path)
    },

    async createFile(path) {
      callSync(native, 'createFile', { path })
      dropCache(path)
    },

    async createDir(path) {
      callSync(native, 'createDir', { path })
    },

    async rename(from, to) {
      callSync(native, 'renameItem', { from, to })
      dropCache(from)
      dropCache(to)
    },

    async remove(path) {
      callSync(native, 'removeItem', { path })
      dropCache(path)
    },

    async openFolder() {
      return null // 「打开文件夹」= 工作区列表（WorkspaceDialog）
    },

    // ---------------------------------------------------------------- 导入 / 另存

    async importFile() {
      return await importInto('', false)
    },

    async importAsset(folder) {
      return await importInto(folder, false)
    },

    async importImage(name, dataUrl) {
      const rel = `/assets/${safeName(name)}`
      callSync(native, 'writeDataUrl', { path: rel, dataUrl })
      dropCache(rel)
      return rel
    },

    async importAssetRaw(name, dataUrl, folder) {
      const dir = (folder || 'assets').replace(/^\/+|\/+$/g, '')
      const rel = `/${dir}/${safeName(name)}`
      callSync(native, 'writeDataUrl', { path: rel, dataUrl })
      dropCache(rel)
      return rel
    },

    async saveAs(fileName, content) {
      const res = (await callAsync(native, 'saveAs', { fileName, content })) as { name?: string }
      // 取消返回空串：调用方据此提示，不能当成功
      return res?.name || ''
    },

    async exportPdfDirect(fileName, html) {
      // 鸿蒙走系统打印框架（ArkWeb 打印适配器）：没有可回传的路径，用户在打印界面选「保存为 PDF」
      const res = (await callAsync(native, 'exportPdf', { fileName, html })) as { printed?: boolean }
      return res?.printed ? 'print' : ''
    },

    async openUrl(url) {
      await callAsync(native, 'openUrl', { url })
    },

    // ---------------------------------------------------------------- 资源读取

    /** 工作区在应用沙箱里，WebView 加载不了 file://，同步取 data URL 用（原生有缓存，导出前清） */
    assetUrl(path) {
      const hit = dataUrls.get(path)
      if (hit) return hit
      try {
        const res = callSync(native, 'readDataUrl', { path }) as { dataUrl?: string }
        const url = res?.dataUrl || ''
        if (url) dataUrls.set(path, url)
        return url
      } catch (e) {
        console.warn('[harmony] 读不出工作区资源：', path, e)
        return ''
      }
    },

    async readAssetDataUrl(path) {
      const res = callSync(native, 'readDataUrl', { path }) as { dataUrl?: string }
      return res?.dataUrl || ''
    },

    // 设置项（localStorage）、外部打开/拖拽事件、待处理深链：仍用 mock 实现
  }

  // 返回键分层：把 H5 的浮层深度同步给原生，原生据此决定吃掉还是交给系统退出
  onBackDepthChange(depth => {
    try {
      callSync(native, 'setBackDepth', { depth })
    } catch {
      /* 桥太旧没有这个方法：忽略，返回键交给系统 */
    }
  })

  cached = harmonyBridge
  probeError = ''
  return harmonyBridge
}

/** 调试用：原生侧的 data URL 缓存要能手动清（改了图片却没重启应用时） */
export function clearHarmonyAssetCache(): void {
  dataUrls.clear()
}
