import { defineStore } from 'pinia'
import { bridge } from '../bridge'
import type { TreeNode, WorkspaceInfo } from '../bridge/types'
import type { Heading } from '../utils/outline'
import { extractHtmlHeadings, isHtmlPath } from '../utils/htmlPreview'
import { richModeRisks } from '../utils/markdownSafety'
import { analyzeText } from '../utils/mdWorker'
import { isTextPath, langFromPath, type LangId } from '../utils/languages'
import { DEFAULT_DEVICE_MODE, normalizeDeviceMode, type DeviceMode } from '../utils/device'
import { pickFolder } from '../composables/pickers'
import { pickWorkspaceDialog } from '../composables/workspaces'
import { uiConfirm } from '../composables/dialogs'

export interface Settings {
  /** 桌面端：左编辑右预览分屏 */
  splitView: boolean
  /** 桌面端：右侧大纲栏 */
  outlineVisible: boolean
  /** 桌面端：左侧文件树（可一键隐藏，编辑时腾出横向空间） */
  treeVisible: boolean
  /** auto = 跟随系统深/浅色 */
  theme: 'auto' | 'light' | 'dark'
  /** 编辑器模式：富文本 / 源码 / VSCode（split 为历史 id）/ 预览 */
  editorMode: 'tiptap' | 'codemirror' | 'split' | 'preview'
  /** 开启 VSCode 同款 Monaco 编辑器：代码文件默认用它打开，可在设置里关掉 */
  enableMonaco: boolean
  /** 当前工作区视图根（手机/浏览器无原生目录对话框时，用应用内选择器切换；'/'＝整个工作区） */
  workspaceRoot: string
  /** Markdown 渲染主题 */
  /** Markdown 主题只保留几种基础风格；深/浅色由应用主题自动适配 */
  mdTheme: 'default' | 'github' | 'vuepress' | 'vue' | 'readable'
  /** DOC 导出引擎：html（Word 兼容 HTML，全平台）/ pandoc（原生 docx，仅桌面） */
  docEngine: 'html' | 'pandoc'
  /** PDF 导出引擎：browser（无头浏览器直出+书签，默认）/ pandoc（需 xelatex，仅桌面） */
  pdfEngine: 'browser' | 'pandoc'
  /** pandoc 可执行文件或其所在目录路径；空 = 从 PATH 查找 */
  pandocPath: string
  /** HTML 导出附带右侧悬浮可折叠大纲（PDF 书签、Word 导航窗格始终自动生成） */
  exportOutline: boolean
  /**
   * 界面模式（编译期固定，运行期不可切换）：
   * PC 版恒为 pc；移动端版可选 mobile（手机）/ tablet（平板，有空间时用 PC 界面）
   */
  deviceMode: DeviceMode
  /** PC 端左侧文件树宽度（px），可拖拽调整 */
  sidebarWidth: number
  /** PC 端右侧大纲宽度（px），可拖拽调整 */
  outlineWidth: number
  /** PC 端分屏时编辑区占比（0.2–0.85），可拖拽调整 */
  splitRatio: number
  /** VSCode 编辑器字号（10–24） */
  editorFontSize: number
  /** VSCode 编辑器自动换行 */
  editorWordWrap: boolean
  /** VSCode 编辑器小地图 */
  editorMinimap: boolean
}

/** 每个文件的内存草稿：切走再切回时保留未保存的正文（VSCode hot exit 的轻量版） */
export interface DraftState {
  content: string
  dirty: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  splitView: true,
  outlineVisible: true,
  treeVisible: true,
  theme: 'auto',
  editorMode: 'tiptap',
  enableMonaco: true,
  workspaceRoot: '/',
  mdTheme: 'default',
  docEngine: 'html',
  pdfEngine: 'browser',
  pandocPath: '',
  exportOutline: true,
  deviceMode: DEFAULT_DEVICE_MODE,
  sidebarWidth: 230,
  outlineWidth: 220,
  splitRatio: 0.5,
  editorFontSize: 14,
  editorWordWrap: true,
  editorMinimap: true
}

/** 设置项里按数字处理、需要夹到合法区间的键 */
const NUMERIC_SETTINGS: Record<string, [number, number]> = {
  sidebarWidth: [160, 520],
  outlineWidth: [150, 460],
  splitRatio: [0.2, 0.85],
  editorFontSize: [10, 24]
}

/** 该路径是否可用编辑器打开（空路径视为可） */
export function isTextFile(path: string): boolean {
  return isTextPath(path)
}

/** 是否绝对路径（兼容 Windows 的 C:\ / C:/） */
export function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)
}

/** 模块级：init 只跑一次（main.ts 与 App.vue 都会 await 它） */
let initPromise: Promise<void> | null = null

/** 后台任务状态：驱动窗口左下角的加载动画 */
export interface BusyState {
  kind: '' | 'open' | 'export' | 'save'
  text: string
}

let analyzeTimer: number | undefined
let analyzeSeq = 0

export const useWorkspace = defineStore('workspace', {
  state: () => ({
    tree: [] as TreeNode[],
    currentPath: '' as string,
    /** 单文件模式：工作区外打开的文件绝对路径（空＝普通工作区文件） */
    externalPath: '' as string,
    /** 当前文件编码：auto＝自动检测，其余为指定编码 */
    encoding: 'auto' as string,
    /** 自动检测 / 实际读到的编码（工具条上显示） */
    detectedEncoding: 'utf-8' as string,
    /** 每个文件手动选择的编码（切走再切回保留） */
    encodingMap: {} as Record<string, string>,
    /** 每个文件自动检测到的编码 */
    detectedMap: {} as Record<string, string>,
    /** 当前活动工作区 id（移动端用；'local'＝App 内部默认工作区） */
    activeWorkspace: 'local' as string,
    /** 是否已向宿主同步过活动工作区（安卓冷启动要恢复上次选的目录） */
    wsSynced: false,
    /** 每次成功打开文件自增（重复打开同一文件也能感知） */
    openSeq: 0,
    /** 打开令牌：连续点击多个文件时，只有最后一次的结果会写入界面 */
    openToken: 0,
    content: '' as string,
    dirty: false,
    lastError: '',
    /** 非阻塞提示（如导出引擎自动回退），数秒后自动消失 */
    notice: '',
    /** 成功类提示（绿色），与 notice 互斥显示 */
    success: '',
    systemDark: false,
    /** 打开文件 / 导出等后台任务的加载状态（左下角动画） */
    busy: { kind: '', text: '' } as BusyState,
    /** 预览渲染中（渲染线程占用数） */
    rendering: 0,
    /** 当前文件的大纲标题（由渲染线程计算，避免主线程遍历长文档） */
    headings: [] as Heading[],
    /**
     * 富文本模式无法完整保留的 Markdown 语法（表格 / 脚注 / 原始 HTML …）。
     * 打开文件时算一次：富文本靠它挂警示条，模式切换靠它决定是否要用户确认。
     */
    richRisks: [] as string[],
    /** 当前文件的文本统计 */
    stats: { chars: 0, lines: 0, words: 0 } as { chars: number; lines: number; words: number },
    settings: { ...DEFAULT_SETTINGS } as Settings,
    /** 各文件的内存草稿（只存有改动的；切文件时先存入、打开时优先恢复） */
    drafts: {} as Record<string, DraftState>
  }),

  getters: {
    /** 实际生效的配色（auto 时取系统设置） */
    resolvedTheme(s): 'light' | 'dark' {
      if (s.settings.theme === 'auto') return s.systemDark ? 'dark' : 'light'
      return s.settings.theme
    },
    fileTitle(s): string {
      return s.currentPath.split('/').pop() || ''
    },
    hasFile(s): boolean {
      return !!s.currentPath
    },
    /** 当前文件语言（决定 VSCode / 源码模式的高亮） */
    language(s): LangId {
      return langFromPath(s.currentPath)
    },
    /** 是否有后台任务在执行（打开/导出等） */
    working(s): boolean {
      return !!s.busy.kind || s.rendering > 0
    },
    /** 有未保存改动的文件数（文件树打点 / 退出提示用） */
    dirtyCount(s): number {
      return Object.values(s.drafts).filter(d => d.dirty).length
    },
    /** 指定文件是否有未保存改动（文件树对每个文件单独打点，不只是当前文件） */
    isDirtyPath(s): (path: string) => boolean {
      return (path: string) => !!s.drafts[path]?.dirty
    }
  },

  actions: {
    init() {
      // main.ts 与 App.vue 都会 await 它：只真正跑一次，避免启动时设置/文件树各读两遍
      if (initPromise) return initPromise
      initPromise = this.doInit()
      return initPromise
    },

    async doInit() {
      const boolKeys = [
        'splitView',
        'outlineVisible',
        'treeVisible',
        'exportOutline',
        'enableMonaco',
        'editorWordWrap',
        'editorMinimap'
      ]
      // 桌面端一次 IPC 取全部设置；浏览器 / 旧桥没有这个方法时回退逐项读取
      let bulk: Record<string, string> | null = null
      try {
        bulk = (await bridge.getSettings?.()) || null
      } catch {
        bulk = null
      }
      for (const k of Object.keys(DEFAULT_SETTINGS)) {
        const v = bulk ? (bulk[k] ?? null) : await bridge.getSetting(k)
        // 桌面 GetSetting 对从未保存过的 key 返回空串（不是 null）：
        // 必须当成「没有设置」跳过，否则首次启动会把默认值覆盖成空/ false。
        if (v === null || v === '') continue
        // 界面模式编译期固定：历史存储里的 auto/pc 等一律收敛到本版本允许的值
        if (k === 'deviceMode') {
          this.settings.deviceMode = normalizeDeviceMode(v)
          continue
        }
        // 旧的「深色主题」条目合并成基础主题：深/浅色统一跟随应用主题
        if (k === 'mdTheme') {
          const allowed = ['default', 'github', 'vuepress', 'vue', 'readable']
          const migrate: Record<string, string> = {
            'github-dark': 'github',
            'vue-dark': 'vue',
            'one-dark': 'vuepress'
          }
          const next = allowed.includes(v) ? v : migrate[v] || 'default'
          this.settings.mdTheme = next as Settings['mdTheme']
          continue
        }
        const range = NUMERIC_SETTINGS[k]
        if (range) {
          const n = Number(v)
          if (!Number.isFinite(n)) continue
          const clamped = Math.min(range[1], Math.max(range[0], n))
          ;(this.settings as any)[k] = k === 'splitRatio' ? clamped : Math.round(clamped)
          continue
        }
        ;(this.settings as any)[k] = boolKeys.includes(k) ? v === 'true' : v
      }
      // 监听系统深浅色（auto 模式跟随）
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      this.systemDark = mq.matches
      mq.addEventListener('change', e => (this.systemDark = e.matches))
      await this.refreshTree()
    },

    /** 跟随系统 → 浅色 → 深色 → 跟随系统 */
    cycleTheme() {
      const order: Settings['theme'][] = ['auto', 'light', 'dark']
      const next = order[(order.indexOf(this.settings.theme) + 1) % order.length]
      void this.updateSetting('theme', next)
    },

    async refreshTree() {
      try {
        await this.syncWorkspace()
        this.tree = this.clipRoot(await bridge.getTree())
      } catch (e: any) {
        this.lastError = String(e?.message ?? e)
      }
    },

    /**
     * 向宿主问一次「当前活动工作区」（安卓冷启动会恢复上次选的目录）。
     * 只问一次，之后由 activateWorkspace 维护，免得每次刷树都多一趟跨端调用。
     */
    async syncWorkspace() {
      if (!bridge.supportsWorkspaces || this.wsSynced) return
      this.wsSynced = true
      try {
        const st = await bridge.listWorkspaces?.()
        if (st) this.activeWorkspace = st.active
      } catch {
        // 问不到就沿用本地记录，不挡刷树
      }
    },

    /** 按「工作区视图根」取子树；根为 '/' 或目录已被删除时回退整棵树 */
    clipRoot(nodes: TreeNode[]): TreeNode[] {
      const root = this.settings.workspaceRoot
      if (!root || root === '/') return nodes
      const find = (list: TreeNode[]): TreeNode[] | null => {
        for (const n of list) {
          if (!n.isDir) continue
          if (n.path === root) return n.children || []
          const hit = n.children ? find(n.children) : null
          if (hit) return hit
        }
        return null
      }
      return find(nodes) ?? nodes
    },

    /**
     * 打开文件夹：
     * - 桌面（Wails）：系统目录选择框，后端把根切到新目录
     * - 移动端（安卓 / 鸿蒙 / 浏览器预览）：统一弹「工作区列表」对话框——
     *   列表＝打开记录（本地工作区恒在、不可删），底部「打开系统目录」按钮
     *   在安卓上拉起 SAF 系统文件管理器，在浏览器上用 File System Access API
     */
    async openFolder() {
      if (bridge.platform === 'wails') {
        const p = (await bridge.openFolder()) || ''
        if (!p) return // 取消或关窗
        // 切工作区前先结束单文件模式，避免把外部文件的内容写进新工作区
        if (this.externalPath) this.closeDocument()
        this.externalPath = ''
        if (this.settings.workspaceRoot !== '/') await this.updateSetting('workspaceRoot', '/')
        await this.refreshTree()
        this.notifyOk(`已打开工作区：${p}`)
        return
      }

      if (bridge.supportsWorkspaces) {
        // 先同步一次记录（冷启动会恢复上次的工作区），用于判断用户是不是选了当前这个
        await this.syncWorkspace()
        const ws = await pickWorkspaceDialog({
          title: '打开文件夹',
          message: '列表是打开过的目录；「打开系统目录」会调用系统文件管理器浏览设备目录。'
        })
        if (!ws) return // 取消
        await this.activateWorkspace(ws)
        return
      }

      // 兜底：宿主既没有系统对话框也不支持工作区记录时，在应用内选一个目录当根
      const picked = await pickFolder({
        title: '打开文件夹',
        message: '手机/网页容器无法浏览系统目录，请在 App 工作区内选择（选择「工作区根目录」可返回全部）'
      })
      if (picked === null) return
      await this.updateSetting('workspaceRoot', picked)
      await this.refreshTree()
      this.notifyOk(picked === '/' ? '已返回整个工作区' : `已打开文件夹：${picked}`)
    },

    /**
     * 切换工作区（移动端）。
     * 文件路径都是「工作区相对路径」，换了工作区后旧路径不再指向同一个文件，
     * 所以切换成功时先把当前文档关掉，避免把 A 目录的内容写进 B 目录。
     */
    async activateWorkspace(ws: WorkspaceInfo) {
      if (ws.id === this.activeWorkspace) {
        await this.refreshTree()
        this.notifyOk(`当前已是「${ws.name}」`)
        return
      }
      if (!bridge.useWorkspace) {
        this.notifyFail('当前平台不支持切换工作区')
        return
      }
      try {
        await bridge.useWorkspace(ws.id)
      } catch (e: any) {
        // 切不过去（比如目录授权失效）就维持原状，别让界面停在半个状态
        this.notifyFail(`切换工作区失败：${String(e?.message ?? e)}`)
        return
      }
      this.wsSynced = true
      this.activeWorkspace = ws.id
      this.drafts = {}
      this.encodingMap = {}
      this.detectedMap = {}
      this.externalPath = ''
      this.currentPath = ''
      this.content = ''
      this.headings = []
      this.richRisks = []
      this.stats = { chars: 0, lines: 0, words: 0 }
      this.dirty = false
      this.openSeq++
      if (this.settings.workspaceRoot !== '/') await this.updateSetting('workspaceRoot', '/')
      await this.refreshTree()
      this.notifyOk(`已打开工作区：${ws.name}`)
    },

    /**
     * 切走当前文件前，把正文与脏标记存进草稿。
     * 切回来时 openFile 会优先用草稿，未保存的改动不会因为点了一下别的文件就消失。
     */
    stashCurrent() {
      if (!this.currentPath) return
      this.drafts[this.currentPath] = { content: this.content, dirty: this.dirty }
    },

    /** 关闭当前文档（切工作区 / 退出单文件模式时用） */
    closeDocument() {
      this.currentPath = ''
      this.content = ''
      this.headings = []
      this.richRisks = []
      this.stats = { chars: 0, lines: 0, words: 0 }
      this.dirty = false
      this.encoding = 'auto'
      this.detectedEncoding = 'utf-8'
      this.openSeq++
    },

    /**
     * 打开文件：文本类型进编辑器；可预览类型（图片/视频/PDF/Office 等）进预览模式
     * 读取与文本分析（行数/字数/大纲）都在独立线程中进行，界面不会卡住
     */
    async openFile(path: string) {
      const token = ++this.openToken
      if (path !== this.currentPath) this.stashCurrent()
      // 单文件模式：只有路径正好是外部文件时才保持；点文件树会退回普通工作区文件
      const isExternal = !!path && path === this.externalPath
      if (!isExternal) this.externalPath = ''
      if (path !== this.currentPath) {
        this.encoding = this.encodingMap[path] || 'auto'
        this.detectedEncoding = this.detectedMap[path] || 'utf-8'
      }
      if (path && !isTextPath(path)) {
        this.currentPath = path
        this.content = ''
        this.headings = []
        this.richRisks = []
        this.stats = { chars: 0, lines: 0, words: 0 }
        this.dirty = false
        this.encoding = 'auto'
        this.detectedEncoding = 'utf-8'
        void this.updateSetting('editorMode', 'preview')
        this.openSeq++
        return
      }
      this.beginBusy('open', '打开中')
      try {
        // 有未保存草稿时用它恢复；否则从磁盘读（外部改动仍以磁盘为准）
        const draft = this.drafts[path]
        let text: string
        let detected = this.detectedEncoding
        if (draft?.dirty) {
          text = draft.content
        } else if (bridge.readFileEnc) {
          // 桌面端：按选择的编码读取（auto 时探测 UTF-8/GBK/GB18030/Big5/UTF-16）
          const r = await bridge.readFileEnc(path, this.encoding)
          text = r.content
          detected = r.encoding
        } else if (isExternal && bridge.readFileExternal) {
          text = await bridge.readFileExternal(path)
        } else {
          text = await bridge.readFile(path)
        }
        const res = await analyzeText(text) // 渲染线程：规范化 + 统计 + 大纲
        if (token !== this.openToken) return
        this.content = text
        // HTML 的大纲按 <h1>~<h6> 抽：Markdown 的 `#` 语法在 HTML 源码里只会抽出 CSS 选择器这类噪音
        this.headings = isHtmlPath(path) ? extractHtmlHeadings(text) : res.headings
        this.richRisks = isHtmlPath(path) ? [] : richModeRisks(text)
        this.stats = { chars: res.chars, lines: res.lines, words: res.words }
        this.currentPath = path
        this.openSeq++
        this.detectedEncoding = detected
        this.detectedMap[path] = detected
        this.dirty = !!draft?.dirty
        // 非 Markdown 文本自动切到代码编辑模式，Markdown 切回富文本
        const mode = this.settings.editorMode
        if (!/\.(md|markdown|mdx)$/i.test(path)) {
          if (mode === 'tiptap' || mode === 'preview') {
            void this.updateSetting('editorMode', this.settings.enableMonaco ? 'split' : 'codemirror')
          }
        } else if (mode === 'preview') {
          void this.updateSetting('editorMode', 'tiptap')
        }
      } catch (e: any) {
        this.lastError = String(e?.message ?? e)
      } finally {
        if (token === this.openToken) this.endBusy()
      }
    },

    setContent(text: string) {
      this.content = text
      this.dirty = true
      if (this.currentPath) this.drafts[this.currentPath] = { content: text, dirty: true }
      this.scheduleAnalyze()
    },

    /**
     * 切换文本编码：按新编码重新读取当前文件。
     * 有未保存修改时先确认（切换会丢弃草稿）。
     */
    async changeEncoding(enc: string) {
      if (!this.currentPath) {
        this.encoding = enc
        return
      }
      if (enc === this.encoding) return
      if (this.dirty) {
        const ok = await uiConfirm({
          title: '切换文本编码',
          message: '切换编码会重新读取文件，当前未保存的修改将丢失。是否继续？',
          okText: '继续'
        })
        if (!ok) return
      }
      const path = this.currentPath
      const prev = this.encoding
      this.encoding = enc
      this.encodingMap[path] = enc
      if (!bridge.readFileEnc) {
        this.encoding = prev
        this.encodingMap[path] = prev
        this.notify('当前平台不支持切换编码')
        return
      }
      this.beginBusy('open', '读取中')
      try {
        const r = await bridge.readFileEnc(path, enc)
        this.content = r.content
        this.detectedEncoding = r.encoding
        this.detectedMap[path] = r.encoding
        this.dirty = false
        delete this.drafts[path]
        this.openSeq++
        const res = await analyzeText(r.content)
        this.headings = isHtmlPath(path) ? extractHtmlHeadings(r.content) : res.headings
        this.richRisks = isHtmlPath(path) ? [] : richModeRisks(r.content)
        this.stats = { chars: res.chars, lines: res.lines, words: res.words }
        this.notifyOk(`已按 ${(enc === 'auto' ? r.encoding : enc).toUpperCase()} 重新读取`)
      } catch (e: any) {
        this.encoding = prev
        this.encodingMap[path] = prev
        this.notifyFail(`切换编码失败：${String(e?.message ?? e)}`)
      } finally {
        this.endBusy()
      }
    },

    /** 更新大纲/统计（防抖后交给渲染线程计算） */
    scheduleAnalyze() {
      if (analyzeTimer) window.clearTimeout(analyzeTimer)
      analyzeTimer = window.setTimeout(() => void this.runAnalyze(), 200)
    },

    async runAnalyze() {
      const seq = ++analyzeSeq
      const text = this.content
      const res = await analyzeText(text)
      if (seq !== analyzeSeq) return
      this.headings = isHtmlPath(this.currentPath) ? extractHtmlHeadings(text) : res.headings
      this.stats = { chars: res.chars, lines: res.lines, words: res.words }
    },

    /** 开始一个后台任务（左下角出现加载动画） */
    beginBusy(kind: BusyState['kind'], text: string) {
      this.busy = { kind, text }
    },

    endBusy() {
      this.busy = { kind: '', text: '' }
    },

    /** 预览渲染状态（渲染线程异步渲染时也显示加载动画） */
    setRendering(on: boolean) {
      this.rendering = Math.max(0, this.rendering + (on ? 1 : -1))
    },

    /** 写入任意路径（App 初始化用，bridge 已提供） */
    async writeFile(path: string, content: string) {
      await bridge.writeFile(path, content)
      await this.refreshTree()
    },

    /** 顶部提示条，点击可关；6 秒后自动收起 */
    notify(msg: string) {
      this.success = ''
      this.notice = msg
      window.setTimeout(() => {
        if (this.notice === msg) this.notice = ''
      }, 6000)
    },

    /** 操作成功提示（绿色） */
    notifyOk(msg: string) {
      this.notice = ''
      this.success = msg
      window.setTimeout(() => {
        if (this.success === msg) this.success = ''
      }, 3000)
    },

    /** 操作失败提示（红色，需手动关闭，避免重要错误被忽略） */
    notifyFail(msg: string) {
      this.success = ''
      this.lastError = msg
    },

    /**
     * 保存当前文档；没有关联文件时让用户选保存位置。
     * 返回保存后的路径（''＝用户取消，取消提示已在这里给出）。
     */
    async save(): Promise<string> {
      if (this.settings.editorMode === 'preview') return ''
      if (!this.currentPath) {
        // 没有关联文件的文档（手机端新建、临时稿）→ 让用户选保存位置
        const path = await this.saveAsAt(`untitled-${Date.now() % 100000}.md`)
        if (!path) {
          this.notify('已取消保存')
          return ''
        }
        // 桌面「另存为」返回的是绝对路径，不能当工作区相对路径用
        if (isAbsolutePath(path)) {
          this.currentPath = path
          this.externalPath = path
          void bridge.adoptExternalFile?.(path)
        }
        this.dirty = false
        delete this.drafts[path]
        this.notifyOk(`已保存：${path.split('/').pop()}`)
        return path
      }
      const enc = this.encoding === 'auto' ? this.detectedEncoding : this.encoding
      if (bridge.writeFileEnc) {
        await bridge.writeFileEnc(this.currentPath, this.content, enc)
      } else if (this.externalPath && this.currentPath === this.externalPath && bridge.writeFileExternal) {
        await bridge.writeFileExternal(this.currentPath, this.content)
      } else {
        await bridge.writeFile(this.currentPath, this.content)
      }
      this.detectedEncoding = enc
      this.detectedMap[this.currentPath] = enc
      this.dirty = false
      delete this.drafts[this.currentPath]
      if (!this.externalPath) await this.refreshTree()
      return this.currentPath
    },

    /**
     * 另存为：桌面弹系统「另存为」对话框，手机/浏览器在工作区内选保存位置。
     * 返回保存后的路径；用户取消返回 ''（调用方据此提示，别当成成功）。
     */
    async saveAsAt(defaultName: string, content?: string, mime = 'text/markdown;charset=utf-8'): Promise<string> {
      const path = await bridge.saveAs(defaultName, content ?? this.content, mime)
      if (path) await this.refreshTree()
      return path
    },

    /**
     * 另存为：让用户选保存位置与文件名（桌面弹系统对话框，手机/浏览器在工作区内选目录）。
     * 返回保存后的路径；''＝用户取消（取消提示已在这里给出）。
     */
    async saveAs(defaultName?: string): Promise<string> {
      if (this.settings.editorMode === 'preview') {
        this.notify('预览模式下不能另存为')
        return ''
      }
      const name = defaultName || this.fileTitle || `untitled-${Date.now() % 100000}.md`
      const path = await this.saveAsAt(name)
      if (!path) {
        this.notify('已取消另存为')
        return ''
      }
      // 保存在工作区内（相对路径）时，当前文档改到新路径继续编辑；
      // 桌面「另存为」到工作区外返回的是绝对路径，不能当相对路径用
      if (this.currentPath) delete this.drafts[this.currentPath]
      delete this.drafts[path]
      if (isAbsolutePath(path)) {
        this.currentPath = path
        this.externalPath = path
        void bridge.adoptExternalFile?.(path)
        this.openSeq++
      } else {
        this.externalPath = ''
      }
      // 另存为内容是按 UTF-8 写出的，后续按 UTF-8 保存
      this.encoding = 'utf-8'
      this.detectedEncoding = 'utf-8'
      this.encodingMap[path] = 'utf-8'
      this.detectedMap[path] = 'utf-8'
      this.dirty = false
      this.notifyOk(`已另存为：${path.split('/').pop()}`)
      return path
    },

    async newFile(name: string) {
      const path = name.startsWith('/') ? name : `/${name}`
      await bridge.createFile(path)
      await this.refreshTree()
      await this.openFile(path)
    },

    async newFolder(name: string) {
      const path = name.startsWith('/') ? name : `/${name}`
      await bridge.createDir(path)
      await this.refreshTree()
    },

    async removeNode(node: TreeNode) {
      await bridge.remove(node.path)
      for (const p of Object.keys(this.drafts)) {
        if (p === node.path || p.startsWith(node.path + '/')) delete this.drafts[p]
      }
      for (const p of Object.keys(this.encodingMap)) {
        if (p === node.path || p.startsWith(node.path + '/')) {
          delete this.encodingMap[p]
          delete this.detectedMap[p]
        }
      }
      if (this.currentPath === node.path || this.currentPath.startsWith(node.path + '/')) {
        this.currentPath = ''
        this.content = ''
        this.headings = []
        this.richRisks = []
        this.stats = { chars: 0, lines: 0, words: 0 }
        this.dirty = false
        // 三个编辑器都常驻在界面里，序号不动它们不知道该把正文清空
        this.openSeq++
      }
      await this.refreshTree()
    },

    async renameNode(node: TreeNode, newName: string) {
      const parentDir = node.path.slice(0, node.path.lastIndexOf('/'))
      const newPath = `${parentDir}/${newName}`
      await bridge.rename(node.path, newPath)
      if (this.drafts[node.path]) {
        this.drafts[newPath] = this.drafts[node.path]
        delete this.drafts[node.path]
      }
      if (this.encodingMap[node.path]) {
        this.encodingMap[newPath] = this.encodingMap[node.path]
        delete this.encodingMap[node.path]
      }
      if (this.detectedMap[node.path]) {
        this.detectedMap[newPath] = this.detectedMap[node.path]
        delete this.detectedMap[node.path]
      }
      if (this.currentPath === node.path) this.currentPath = newPath
      await this.refreshTree()
    },

    async updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
      this.settings[key] = value
      await bridge.setSetting(key, String(value))
    },

    /** 把 dataUrl 图片导入资源目录，返回插入文本用的相对路径 */
    async importImage(name: string, dataUrl: string): Promise<string> {
      return bridge.importImage(name, dataUrl)
    },

    /** 选择外部文件（Markdown / 代码 / 配置 / 图片）导入到工作区并打开，保留原始后缀 */
    async importFile() {
      const path = await bridge.importFile()
      if (!path) return
      await this.refreshTree()
      await this.openFile(path)
    }
  }
})
