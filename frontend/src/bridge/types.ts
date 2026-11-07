export interface TreeNode {
  name: string
  path: string
  isDir: boolean
  children?: TreeNode[]
}

export type PlatformName = 'wails' | 'capacitor-android' | 'harmony' | 'browser'

/** 一次「从外部打开」该怎样落地（对应 Go 侧 OpenTarget） */
export interface OpenTarget {
  /** 工作区内相对路径（/notes/a.md）；空串＝只换了工作区根目录，没有具体文件 */
  rel: string
  /** 打开后的工作区根目录（绝对路径） */
  root: string
  /** 是否切换了工作区根，前端据此刷新文件树并提示 */
  rootChanged: boolean
  /** 是否打开的是工作区外的单个文件（不切换工作区根，只编辑这一个文件） */
  external?: boolean
  /** 单文件模式下的绝对路径（斜杠分隔） */
  absPath?: string
  /** 失败原因（文件不存在等），非空时前端只提示 */
  error: string
}

/** 把外部文件复制进工作区目录的结果（对应 Go 侧 CopyResult） */
export interface CopyResult {
  /** 实际落地的工作区相对路径（/notes/a.md） */
  copied: string[]
  /** 逐个文件失败的原因，单项失败不影响其余 */
  errors: string[]
}

/**
 * 一个工作区。
 * 只有 Android 这类平台才有「本地目录」与「系统目录」两种：本地目录是 App 内部的默认工作区，
 * 系统目录是用户用系统文件管理器（SAF）选中的真实目录。
 */
export interface WorkspaceInfo {
  /** `local` 或系统目录的标识（sys:content://…） */
  id: string
  kind: 'local' | 'system'
  /** 展示名；系统目录＝目录名 */
  name: string
  /** 系统目录的 SAF tree uri（kind==='system' 时有值） */
  uri?: string
  /** 能否从记录里删除：本地工作区恒为 false */
  removable: boolean
  /** 授权是否仍然有效（被系统回收、目录被删时 false） */
  available?: boolean
}

/** 工作区记录列表 + 当前活动项 */
export interface WorkspaceState {
  active: string
  items: WorkspaceInfo[]
}

/**
 * 统一平台桥接接口：
 * 桌面(Wails)、Android(Capacitor)、鸿蒙(ArkWeb)、浏览器 Mock 各自实现。
 * 前端业务代码只依赖此接口。
 */
export interface PlatformBridge {
  readonly platform: PlatformName

  /** 获取当前工作目录的文件树 */
  getTree(): Promise<TreeNode[]>
  /** 选择/打开文件夹作为工作区根，返回路径（用户取消返回 null） */
  openFolder(): Promise<string | null>

  /**
   * 是否支持「工作区列表」这套交互（Android / 浏览器 / 鸿蒙为 true，桌面 Wails 为 false）。
   * 为 true 时「打开文件夹」不走应用内路径选择器，而是列出打开记录
   * （本地工作区恒在、不可删）+ 一个「打开系统目录」按钮（弹系统文件管理器）。
   */
  readonly supportsWorkspaces: boolean
  /** 工作区记录列表（含恒存在的本地工作区）。支持工作区的平台必须实现 */
  listWorkspaces?(): Promise<WorkspaceState>
  /**
   * 弹系统文件管理器选一个目录作为新工作区。
   * 用户取消返回 null；**该环境根本无法浏览系统目录时抛错**（错误文案直接显示在对话框里）。
   */
  pickWorkspace?(): Promise<WorkspaceInfo | null>
  /** 切换活动工作区（后续所有文件读写都落在这个工作区） */
  useWorkspace?(id: string): Promise<void>
  /** 把某个系统目录从打开记录里移除（本地工作区不可移除）；返回移除后的工作区状态 */
  forgetWorkspace?(id: string): Promise<WorkspaceState>

  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  createFile(path: string): Promise<void>
  createDir(path: string): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
  remove(path: string): Promise<void>

  /** 导入图片：保存到资源目录，返回可引用的相对路径 */
  importImage(name: string, dataUrl: string): Promise<string>

  /** 导入文件（Markdown / 代码 / 配置 / 图片等，保留原始后缀）到工作区，返回相对路径（取消返回 null） */
  importFile(): Promise<string | null>

  /** 原生选择资源文件并拷入工作区：folder='assets'（图片）/'files'（视频/音频/附件），取消返回 null */
  importAsset(folder: 'assets' | 'files'): Promise<string | null>

  /** dataURL 写入资源文件（拖拽/粘贴场景），返回相对路径 */
  importAssetRaw(name: string, dataUrl: string, folder: 'assets' | 'files'): Promise<string>

  /**
   * 另存为（导出 MD/HTML/DOC 等产物）：桌面弹系统「另存为」对话框；
   * 安卓弹系统文件管理器（SAF）选设备上的目录；浏览器退化为下载。
   * 返回实际保存路径；**用户取消返回空串**（调用方据此提示，不能当成成功）。
   */
  saveAs(fileName: string, content: string, mime: string): Promise<string>

  /**
   * HTML → PDF：
   * - 桌面：无头浏览器直接生成 PDF 文件（含书签大纲），用户先在保存框里挑目录；
   * - 安卓：WebView 排版后**调起系统打印预览**，由用户在打印界面选「保存为 PDF」并挑手机存储目录
   *   （安卓公开 API 禁止应用自己驱动 PrintDocumentAdapter 写文件，两个结果回调的构造器都是包内私有的）。
   * 返回值：保存路径 / `'print'`（已交给系统打印界面）/ **空串＝用户取消**；平台不支持时抛错。
   */
  exportPdfDirect(fileName: string, html: string): Promise<string>

  /** 桌面端：pandoc 直接把 Markdown 转 PDF（需 xelatex），返回保存路径（不支持的平台抛错） */
  exportPdfPandoc(fileName: string, markdown: string, pandocPath: string): Promise<string>

  /** 桌面端：调用 pandoc 导出原生 docx（Word 导航窗格识别大纲），返回保存路径（不支持的平台抛错） */
  exportDocxPandoc(fileName: string, markdown: string, pandocPath: string): Promise<string>

  /** 桌面端：用系统默认应用打开工作区文件（Office/PDF 等无法内嵌预览时） */
  openPath(path: string): Promise<void>

  /** 用系统浏览器打开**网址**（HTML 预览里的外链；WebView 里 window.open 常常没有响应）。无能力时前端自行 window.open */
  openUrl(url: string): Promise<void>

  /**
   * 原生壳专用：显式请求系统弹出软键盘（兜底）。
   * 安卓 WebView 在两种情况下不会自己弹 IME（聚焦了可编辑面却不弹、返回键收起键盘后焦点还在
   * 编辑区里再点不弹），只能由原生 InputMethodManager 补一刀；键盘已显示时是空操作。
   *
   * 返回值是原生回执（`shown` / `ime` / `focus` / `windowFocus` / `keyboard` / `softInputMode`），
   * 只用于把「键盘还是不弹」的真实原因带出来给用户看；桌面 / 浏览器不实现这个方法
   * （前端据此判断有没有兜底可用）。
   */
  ensureKeyboard?(): Promise<unknown> | void

  /** 把工作区相对路径映射为可在 WebView/浏览器加载的 URL（Mock 平台可能返回空串） */
  assetUrl(path: string): string

  /**
   * 打开工作区以外的文件/目录（`MoDown.exe test.md`、拖进窗口、第二个实例传参共用）。
   * 文件在工作区外时把工作区根切到它所在目录 —— 就地编辑原文件，不做复制。
   */
  openExternal(path: string): Promise<OpenTarget | null>

  /** 取走启动参数里的待打开项（前端挂载后调用一次）。返回 null＝没有待打开项 */
  takePendingOpen(): Promise<OpenTarget | null>

  /** 订阅「让已有窗口打开某个文件」（第二个实例带参启动）；非桌面平台为空实现 */
  onOpenExternal(handler: (path: string) => void): void

  /**
   * 订阅「文件被拖进窗口」；非桌面平台为空实现。
   * x/y 是落下时的视口 CSS 像素（可直接喂给 document.elementFromPoint），
   * 前端据此判断是打开文件还是复制进文件树里的某个目录。
   */
  onFileDrop(handler: (paths: string[], x: number, y: number) => void): void

  /**
   * 把系统里的文件/目录复制进工作区的某个目录（拖到文件树上的行为）。
   * dir 为工作区相对路径，''＝根目录；重名自动让路，不覆盖已有文件。
   */
  copyInto(paths: string[], dir: string): Promise<CopyResult>

  /** 把图片读成 data URL（导出时内联用）；读不到返回空串 */
  readAssetDataUrl(path: string): Promise<string>

  /** 设置持久化 */
  getSetting(key: string): Promise<string | null>
  setSetting(key: string, value: string): Promise<void>

  /** 桌面壳：同步「是否有未保存草稿」，关窗时由原生层决定是否弹确认框 */
  setUnsaved?(unsaved: boolean): Promise<void>

  /** 一次性读取全部设置（桌面端启动优化；没有实现时回退逐项 getSetting） */
  getSettings?(): Promise<Record<string, string> | null>

  /** 弹原生文件选择框（选择 Pandoc 可执行文件等），取消返回 null */
  pickFile?(title: string): Promise<string | null>
  /** 选择并验证 Pandoc 可执行文件（不是 Pandoc 时 reject），取消返回 null */
  pickPandoc?(): Promise<string | null>
  /** 验证 Pandoc 路径，返回版本首行；无效时 reject */
  validatePandoc?(path: string): Promise<string>
  /** 用本机安装的 VS Code 打开文件（仅桌面端） */
  openInVSCode?(path: string): Promise<void>

  /** 按指定编码读取文本（桌面端），返回 UTF-8 内容和实际编码 */
  readFileEnc?(path: string, encoding: string): Promise<{ content: string; encoding: string }>
  /** 按指定编码写回文本（桌面端） */
  writeFileEnc?(path: string, content: string, encoding: string): Promise<void>

  /** 单文件模式：读写工作区外的绝对路径（仅桌面端） */
  readFileExternal?(path: string): Promise<string>
  writeFileExternal?(path: string, content: string): Promise<void>
  /** 另存为到工作区外之后，把新路径接管为当前单文件 */
  adoptExternalFile?(path: string): Promise<void>
}
