<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useWorkspace, isTextFile } from './stores/workspace'
import { switchEditMode } from './utils/editorSwitch'
import {
  deviceIcon,
  deviceLabel,
  effectiveLayout,
  stableLayoutSize,
  isAndroidShell,
  CAN_SWITCH_DEVICE,
  type DeviceMode,
  type LayoutSize
} from './utils/device'
import { openFolderShortcut, saveCurrent } from './utils/shortcuts'
import { uiPrompt } from './composables/dialogs'
import { pushBack } from './composables/backstack'
import { hasEditingFocus, installSoftKeyboardFallback } from './composables/softKeyboard'
import { dropDir, treeDirAt } from './composables/treeDrop'
import { bridge } from './bridge'
import type { OpenTarget } from './bridge/types'
import TopBar from './components/TopBar.vue'
import FileTree from './components/FileTree.vue'
import Editor from './components/Editor.vue'
import LoadingHint from './components/LoadingHint.vue'
import OutlinePane from './components/OutlinePane.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import DialogHost from './components/DialogHost.vue'
import PathPickDialog from './components/PathPickDialog.vue'
import WorkspaceDialog from './components/WorkspaceDialog.vue'
import IconSvg from './components/IconSvg.vue'
import PaneResizer from './components/PaneResizer.vue'

/** 手机端三个页签对应的编辑器按需加载，减小首屏体积 */
const asyncPart = (loader: () => Promise<unknown>) =>
  defineAsyncComponent({ loader: loader as never, loadingComponent: LoadingHint, delay: 100 })
const RichEditor = asyncPart(() => import('./components/RichEditor.vue'))
const CodeEditor = asyncPart(() => import('./components/CodeEditor.vue'))
const FileViewer = asyncPart(() => import('./components/FileViewer.vue'))
const Preview = asyncPart(() => import('./components/Preview.vue'))

const ws = useWorkspace()
const showSettings = ref(false)
/**
 * 外壳判定用的「稳定视口尺寸」。
 *
 * 不能直接用 window.innerHeight：安卓软键盘弹出会把布局视口压矮，而平板外壳的判据里带高度
 * （< 500 就退回手机外壳），一压就触发 v-if / v-else 两套外壳互换 —— 平板外壳连同编辑器 DOM
 * 被卸载、焦点丢失、刚弹出的键盘又被系统收回去。规则见 utils/device.ts 的 stableLayoutSize。
 */
const layoutSize = ref<LayoutSize>({ w: window.innerWidth, h: window.innerHeight })
/** 手机端当前底部 tab（编辑模式；大纲不占模式，走底部弹窗） */
const mobileMode = ref<'tiptap' | 'codemirror' | 'preview'>('tiptap')
/** 手机端文件树抽屉 */
const drawerOpen = ref(false)

/* ---------- PC / 网页版：分栏拖拽（VSCode 同款） ----------
   宽度存进设置，重启后保持；双击分隔条恢复默认。手机外壳不渲染这些分隔条。 */
const sidebarW = ref(ws.settings.sidebarWidth)
const outlineW = ref(ws.settings.outlineWidth)
const splitRatio = ref(ws.settings.splitRatio)
const contentEl = ref<HTMLElement>()
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

watch(() => ws.settings.sidebarWidth, v => (sidebarW.value = v))
watch(() => ws.settings.outlineWidth, v => (outlineW.value = v))
watch(() => ws.settings.splitRatio, v => (splitRatio.value = v))

let sidebarStart = 0
function sidebarDragStart() {
  sidebarStart = sidebarW.value
}
function sidebarDragMove(dx: number) {
  sidebarW.value = clamp(sidebarStart + dx, 160, 520)
}
function sidebarDragEnd() {
  void ws.updateSetting('sidebarWidth', Math.round(sidebarW.value))
}
function sidebarReset() {
  sidebarW.value = 230
  void ws.updateSetting('sidebarWidth', 230)
}

let outlineStart = 0
function outlineDragStart() {
  outlineStart = outlineW.value
}
function outlineDragMove(dx: number) {
  // 分隔条在大纲左侧：向左拖（dx<0）＝大纲变宽
  outlineW.value = clamp(outlineStart - dx, 150, 460)
}
function outlineDragEnd() {
  void ws.updateSetting('outlineWidth', Math.round(outlineW.value))
}
function outlineReset() {
  outlineW.value = 220
  void ws.updateSetting('outlineWidth', 220)
}

let splitStart = 0
function splitDragStart() {
  splitStart = splitRatio.value
}
function splitDragMove(dx: number) {
  const total = (contentEl.value?.clientWidth || 900) - (ws.settings.outlineVisible ? outlineW.value : 0)
  if (total < 320) return
  splitRatio.value = clamp(splitStart + dx / total, 0.2, 0.85)
}
function splitDragEnd() {
  void ws.updateSetting('splitRatio', Number(splitRatio.value.toFixed(3)))
}
function splitReset() {
  splitRatio.value = 0.5
  void ws.updateSetting('splitRatio', 0.5)
}

/** 当前平台是否可用 VSCode（Monaco）模式：安卓壳会回退到 CodeMirror */
const monacoUsable = computed(() => ws.settings.enableMonaco && !isAndroidShell())

/** 分屏预览是否显示（拖拽条只在它出现时渲染） */
const previewVisible = computed(
  () =>
    ws.settings.splitView &&
    ws.hasFile &&
    isTextFile(ws.currentPath) &&
    ws.settings.editorMode !== 'preview'
)

/* ---------- 大纲底部弹窗（挂载态与展开态分离，做出/入场动画） ---------- */
const sheetMounted = ref(false)
const sheetOpen = ref(false)
const sheetEl = ref<HTMLElement>()
async function openSheet() {
  sheetMounted.value = true
  await nextTick()
  sheetOpen.value = true
}
function closeSheet() {
  sheetOpen.value = false
  if (sheetEl.value) sheetEl.value.style.transform = ''
  window.setTimeout(() => {
    if (!sheetOpen.value) sheetMounted.value = false
  }, 260)
}

/* 下滑拖拽关闭：跟手位移，超过阈值关闭，否则回弹 */
const dragging = ref(false)
let dragStartY: number | null = null
let dragDy = 0
function onSheetTouchStart(e: TouchEvent) {
  if (e.touches.length !== 1) return
  const t = e.touches[0]
  // 仅从顶部把手/标题区域开始拖拽，避免与大纲列表滚动冲突
  const head = (e.currentTarget as HTMLElement).querySelector('.sheet-grab')?.getBoundingClientRect()
  if (!head || t.clientY > head.bottom + 44) {
    dragStartY = null
    return
  }
  dragStartY = t.clientY
  dragDy = 0
  dragging.value = true
}
function onSheetTouchMove(e: TouchEvent) {
  if (dragStartY === null || !sheetEl.value) return
  dragDy = Math.max(0, e.touches[0].clientY - dragStartY)
  sheetEl.value.style.transform = `translateY(${dragDy}px)`
}
function onSheetTouchEnd() {
  if (dragStartY === null) return
  const shouldClose = dragDy > 90
  dragStartY = null
  dragging.value = false
  if (shouldClose) {
    if (sheetEl.value) sheetEl.value.style.transform = 'translateY(100%)'
    closeSheet()
  } else if (sheetEl.value) {
    sheetEl.value.style.transform = ''
  }
}

/**
 * 界面外壳由「编译版本 + 界面模式 + 可用空间」决定：
 * - PC 编译版本：永远 PC 界面（不会因为窗口变窄出现汉堡菜单/底部页签）
 * - 移动端编译版本：手机＝永远手机界面；平板＝有空间就用 PC 界面，空间不足自动转手机界面
 */
const isMobile = computed(
  () => effectiveLayout(ws.settings.deviceMode, layoutSize.value.w, layoutSize.value.h) === 'mobile'
)
const deviceText = computed(() => deviceLabel(ws.settings.deviceMode))
const deviceIco = computed(() => deviceIcon(ws.settings.deviceMode))

/* PC 快捷键：Ctrl/Cmd + S 保存、+ N 新建、+ O 打开文件夹（Monaco / CodeMirror 内部另有绑定） */
function onKeydown(e: KeyboardEvent) {
  if (e.altKey || (!e.ctrlKey && !e.metaKey)) return
  if (e.key === 'Escape') return
  const key = e.key.toLowerCase()
  if (key === 's') {
    e.preventDefault()
    void saveCurrent()
  } else if (key === 'n') {
    e.preventDefault()
    void newFileShortcut()
  } else if (key === 'o') {
    e.preventDefault()
    void openFolderShortcut()
  }
}

async function newFileShortcut() {
  const name = await uiPrompt({
    title: '新建文件',
    message: '输入文件名（相对工作区路径，以 .md 结尾）',
    defaultValue: `/untitled-${Date.now() % 10000}.md`
  })
  if (name) await ws.newFile(name)
}

/* 深/浅色同步到 html 根元素：body / 表单控件 / 滚动条颜色随主题 */
watch(
  () => ws.resolvedTheme,
  t => document.documentElement.classList.toggle('dark', t === 'dark'),
  { immediate: true }
)

/* 手机：在抽屉里选中文件后自动收起（含重复打开同一文件） */
watch(
  () => ws.openSeq,
  () => {
    drawerOpen.value = false
  }
)

/* 编辑器模式与手机 tab 联动（打开非文本文件自动切预览时同步高亮） */
watch(
  () => ws.settings.editorMode,
  m => {
    // 手机端不提供 Monaco，VSCode 模式在手机上等价于“源码”
    if (m === 'split') mobileMode.value = 'codemirror'
    else if (m !== mobileMode.value) mobileMode.value = m
  }
)

function onResize() {
  // 软键盘把视口压矮时不换外壳（正在编辑 = 落点已经拿到焦点，见 stableLayoutSize）
  layoutSize.value = stableLayoutSize(
    layoutSize.value,
    window.innerWidth,
    window.innerHeight,
    hasEditingFocus()
  )
}

/* ---------- 未保存草稿：关窗前确认 ---------- */
/** 桌面壳：把「有没有脏文件」同步给 Go，由 OnBeforeClose 弹原生确认框 */
watch(
  () => ws.dirtyCount,
  n => (bridge as any).setUnsaved?.(n > 0),
  { immediate: true }
)
/** 浏览器 / 网页版：用 beforeunload 让浏览器弹「离开此网站？」（Wails 里交给原生对话框） */
function onBeforeUnload(e: BeforeUnloadEvent) {
  if (bridge.platform === 'wails' || !ws.dirtyCount) return
  e.preventDefault()
  e.returnValue = ''
}

/** 拖进窗口的图片由编辑器自己接管（插入正文），其余后缀都当作"打开这个文件" */
const DROP_AS_IMAGE = /\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)$/i

/**
 * 落地一次「从外部打开」（启动参数 / 拖进窗口 / 第二个实例传参）。
 * 返回是否真的打开了东西：失败时返回 false，让启动流程继续走默认的 README 分支。
 */
async function applyOpenTarget(t: OpenTarget | null): Promise<boolean> {
  if (!t) return false
  if (t.error) {
    ws.notify(t.error)
    return false
  }
  // 工作区外的单个文件：只编辑这个文件，不把它的目录变成工作区
  if (t.external && t.absPath) {
    ws.externalPath = t.absPath
    await ws.openFile(t.absPath)
    ws.notifyOk(`已打开文件：${t.absPath.split('/').pop() || t.absPath}`)
    return true
  }
  if (t.rootChanged) {
    ws.externalPath = ''
    await ws.refreshTree()
    ws.notifyOk(`工作区已切换到 ${t.root}`)
  }
  if (!t.rel) return true // 拖进来的是文件夹：只换根目录，没有要打开的文件
  await ws.openFile(t.rel)
  return true
}

async function openExternalFile(path: string) {
  try {
    await applyOpenTarget(await bridge.openExternal(path))
  } catch (e) {
    ws.notify(`打开失败：${String((e as any)?.message ?? e).split('\n')[0]}`)
  }
}

/**
 * 拖外部文件经过窗口时高亮"会落进哪个目录"（Wails 只给 drop 事件，拖拽途中的反馈得自己听 dragover）。
 * 不在文件树上时 dropDir=null，等于不提示 —— 那种情况按老行为打开文件。
 */
function onDragOver(e: DragEvent) {
  if (!e.dataTransfer?.types?.includes('Files')) return
  dropDir.value = treeDirAt(e.clientX, e.clientY)
}
function clearDropDir() {
  dropDir.value = null
}
/** 拖出窗口（relatedTarget 为空）才清，窗口内部移动交给下一次 dragover 覆盖 */
function onDragLeave(e: DragEvent) {
  if (!e.relatedTarget) clearDropDir()
}

async function openDroppedFiles(paths: string[], x = -1, y = -1) {
  if (!paths.length) return
  // 停在文件树上＝复制进那个目录（和 VSCode 资源管理器一样），既不打开也不插入正文
  const dir = x >= 0 && y >= 0 ? treeDirAt(x, y) : null
  if (dir !== null) {
    try {
      const r = await bridge.copyInto(paths, dir)
      await ws.refreshTree()
      if (r.copied.length) ws.notifyOk(`已复制 ${r.copied.length} 项到 ${dir || '工作区根目录'}`)
      if (r.errors?.length) ws.notify(`复制失败：${r.errors.join('；')}`)
    } catch (e) {
      ws.notify(`复制失败：${String((e as any)?.message ?? e).split('\n')[0]}`)
    }
    return
  }
  const docs = paths.filter(p => !DROP_AS_IMAGE.test(p))
  if (!docs.length) return
  await openExternalFile(docs[0])
  if (docs.length > 1) ws.notify(`一次只能打开一个文件，已打开 ${docs[0].split(/[\\/]/).pop()}`)
}

onMounted(async () => {
  window.addEventListener('resize', onResize)
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('beforeunload', onBeforeUnload)
  // 安卓壳：聚焦可编辑面时显式请求软键盘（Chromium 自己没弹时的兜底，桌面/浏览器空转）。
  // 原生明确回报「没弹出来」时提示一次，把设备上的真实原因（焦点 / IME / 输入法连接）带出来
  installSoftKeyboardFallback((info) => ws.notify(`系统未弹出软键盘，请把这条信息截图反馈：${info}`))
  // 拖拽途中的高亮：dragover 只能自己听（Wails 只回调 drop）
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('drop', clearDropDir)
  mobileMode.value = ws.settings.editorMode === 'split' ? 'codemirror' : (ws.settings.editorMode as any)
  await ws.init()

  // 三个外部入口都要先接上：第二个实例推事件、文件拖进窗口、以及启动参数（拉一次）
  bridge.onOpenExternal(path => void openExternalFile(path))
  bridge.onFileDrop((paths, x, y) => void openDroppedFiles(paths, x, y))
  if (await applyOpenTarget(await bridge.takePendingOpen())) return // 命令行指定的文件优先于默认的 README

  // 文件树已由 ws.init() 加载，不再重复走一趟 IPC（启动更快）
  if (!ws.tree.length) {
    await ws.newFile('/README.md')
    await ws.writeFile('/README.md', WELCOME_MD)
    await ws.refreshTree()
  }
  await ws.openFile('/README.md')
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('beforeunload', onBeforeUnload)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', clearDropDir)
})

/** 切换编辑模式（校验与富文本语法风险提示统一走 switchEditMode） */
async function setMode(m: 'tiptap' | 'codemirror' | 'split' | 'preview') {
  const applied = await switchEditMode(m)
  if (!applied) return
  mobileMode.value = applied === 'split' ? 'codemirror' : applied
}

/** 界面模式只在移动端编译版本里可切换（PC 版编译期已固定为 PC 界面） */
function setDevice(mode: DeviceMode) {
  if (!CAN_SWITCH_DEVICE) return
  void ws.updateSetting('deviceMode', mode)
}

const WELCOME_MD = `# 欢迎使用 MoDown

跨平台 Markdown 编辑器：桌面（Windows / macOS / Linux / 鸿蒙 PC）、手机 WebApp、PWA 均可运行。

## 特性
- Tiptap 所见即所得富文本，支持常用标记语法即时渲染（代码块同样高亮，并带复制按钮）
- 富文本 / 源码 / VSCode / 预览 模式，切换入口在编辑器右下角；VSCode 即 Monaco，占据整个编辑区
- PC 快捷键：Ctrl+S 保存、Ctrl+N 新建、Ctrl+O 打开文件夹
- 版本：PC 版为 PC版；移动端版可选 手机版 / 平板版（平板版在空间足够时用 PC 界面）
- 文件树内联新建（同 VSCode），右键 / 长按支持打开 / 新建 / 重命名 / 删除
- 顶栏最左侧的图标按钮可展开 / 隐藏左侧文件树，写作时腾出横向空间
- 图片自动存入工作区 assets 文件夹，视频、音频等以链接引用
- 本地或网络文件预览：图片 / 视频 / 音频 / PDF / HTML / Office
- GitHub / VuePress / 阅读友好 等 Markdown 主题
- 导出：MD / HTML（右侧可折叠大纲）/ DOC / PDF（均含可被识别的书签大纲）
- 深浅色主题自动跟随系统
- 手机端：双指捏合可缩放编辑/预览区，双击复位

> 提示：「源码」切换到 CodeMirror 6；
> 设置中开启 VSCode（Monaco）后，可在大编辑区使用 java / python / go / ini / yaml / bash 等语言高亮。

\`\`\`js
// 代码高亮示例（右上角可一键复制）
function greet(name) {
  console.log("Hello, " + name)
}
greet("MoDown")
\`\`\`

\`\`\`python
def greet(name: str) -> None:
    print(f"Hello, {name}")

greet("MoDown")
\`\`\`

- [x] 书写你的想法
- [ ] 导出为 PDF
`
</script>

<template>
  <div class="app" :class="[ws.resolvedTheme, isMobile ? 'device-mobile' : 'device-pc']">
    <TopBar
      :mobile="isMobile"
      :device-label="deviceText"
      :device-icon="deviceIco"
      @open-settings="showSettings = true"
      @open-drawer="drawerOpen = !drawerOpen"
      @set-device="setDevice"
    />

    <!-- 桌面多栏：文件树 | 编辑区 | 分屏预览 | 大纲（与旧版布局一致） -->
    <main class="main" v-if="!isMobile">
      <!-- 文件树：顶栏最左侧的图标按钮可随时展开 / 隐藏（状态持久化）；宽度可拖拽 -->
      <aside class="sidebar" v-show="ws.settings.treeVisible" :style="{ width: sidebarW + 'px' }">
        <FileTree />
      </aside>
      <PaneResizer
        v-if="ws.settings.treeVisible"
        title="拖拽调整文件树宽度，双击恢复默认"
        @start="sidebarDragStart"
        @move="sidebarDragMove"
        @end="sidebarDragEnd"
        @reset="sidebarReset"
      />
      <div class="content" ref="contentEl">
        <div
          class="editor-pane"
          :style="previewVisible ? { flex: `0 0 ${splitRatio * 100}%` } : undefined"
        >
          <Editor />
        </div>
        <!-- 分屏预览：左侧编辑区（富文本/源码/VSCode）+ 右侧实时预览；预览模式本身不再重复开窗 -->
        <PaneResizer
          v-if="previewVisible"
          title="拖拽调整编辑 / 预览比例，双击恢复默认"
          @start="splitDragStart"
          @move="splitDragMove"
          @end="splitDragEnd"
          @reset="splitReset"
        />
        <div class="preview-pane" v-if="previewVisible">
          <Preview />
        </div>
        <PaneResizer
          v-if="ws.settings.outlineVisible"
          title="拖拽调整大纲宽度，双击恢复默认"
          @start="outlineDragStart"
          @move="outlineDragMove"
          @end="outlineDragEnd"
          @reset="outlineReset"
        />
        <div class="outline-pane" v-if="ws.settings.outlineVisible" :style="{ width: outlineW + 'px' }">
          <OutlinePane />
        </div>
      </div>
    </main>

    <!-- 手机：文件从顶栏汉堡进抽屉；底部仅 富文本/源码/预览/大纲 四个 tab -->
    <main class="main mobile" v-else>
      <aside class="drawer" :class="{ open: drawerOpen }" @click.self="drawerOpen = false">
        <div class="drawer-panel">
          <FileTree />
        </div>
      </aside>
      <section class="pane m-body">
        <RichEditor v-show="mobileMode === 'tiptap'" />
        <CodeEditor v-show="mobileMode === 'codemirror'" />
        <FileViewer v-show="mobileMode === 'preview'" />
      </section>
      <div class="m-tabs">
        <button :class="{ active: mobileMode === 'tiptap' }" @click="setMode('tiptap')">
          <IconSvg name="format" :size="16" /><span>富文本</span>
        </button>
        <button :class="{ active: mobileMode === 'codemirror' }" @click="setMode('codemirror')">
          <IconSvg name="source" :size="16" /><span>源码</span>
        </button>
        <button :class="{ active: mobileMode === 'preview' }" @click="setMode('preview')">
          <IconSvg name="eye" :size="16" /><span>预览</span>
        </button>
        <button :class="{ active: sheetMounted }" @click="sheetMounted ? closeSheet() : openSheet()">
          <IconSvg name="list" :size="16" /><span>大纲</span>
        </button>
      </div>

      <!-- 大纲底部弹窗：拖拽把手 + 跟手下滑关闭 + 回弹动画 -->
      <div class="sheet-mask" :class="{ open: sheetOpen }" v-if="sheetMounted" @click="closeSheet">
        <div
          class="sheet"
          ref="sheetEl"
          :class="{ dragging }"
          @click.stop
          @touchstart="onSheetTouchStart"
          @touchmove="onSheetTouchMove"
          @touchend="onSheetTouchEnd"
        >
          <div class="sheet-grab"></div>
          <div class="sheet-head">
            <span class="sheet-title">大纲</span>
            <button class="sheet-close" title="关闭" @click="closeSheet">
              <IconSvg name="x" :size="18" />
            </button>
          </div>
          <div class="sheet-body"><OutlinePane /></div>
        </div>
      </div>
    </main>

    <!-- 状态栏：文件名后跟随加载动画（打开文件 / 导出 / 预览渲染都不会卡住界面） -->
    <footer class="statusbar" v-if="!isMobile">
      <span class="sb-path">{{ ws.currentPath || '未打开文件' }}</span>
      <span v-if="ws.busy.kind || ws.rendering" class="sb-busy" :title="ws.busy.text || '渲染中'">
        <span class="spinner"></span>
        <span>{{ ws.busy.text || '渲染中' }}</span>
      </span>
      <span v-else-if="ws.dirty" class="sb-dirty">未保存更改</span>
      <span class="sb-spacer"></span>
      <!-- 编辑模式切换（原先悬浮在右下角，容易被 Monaco 浮层/状态栏遮住） -->
      <span class="sb-mode" v-if="ws.currentPath && isTextFile(ws.currentPath)">
        <button
          :class="{ active: ws.settings.editorMode === 'tiptap' }"
          @click="setMode('tiptap')"
          title="富文本（Tiptap 所见即所得）"
        >
          <IconSvg name="format" :size="13" />
        </button>
        <button
          :class="{ active: ws.settings.editorMode === 'codemirror' }"
          @click="setMode('codemirror')"
          title="源码（CodeMirror 6）"
        >
          <IconSvg name="source" :size="13" />
        </button>
        <button
          v-if="monacoUsable"
          :class="{ active: ws.settings.editorMode === 'split' }"
          @click="setMode('split')"
          title="VSCode（Monaco 网页版）"
        >
          <IconSvg name="monaco" :size="13" />
        </button>
        <button
          :class="{ active: ws.settings.editorMode === 'preview' }"
          @click="setMode('preview')"
          title="预览（图片/视频/音频/PDF/HTML/Office 等）"
        >
          <IconSvg name="eye" :size="13" />
        </button>
      </span>
      <span class="sb-meta">{{ deviceText }}</span>
      <span class="sb-meta" v-if="ws.stats.lines">{{ ws.stats.lines }} 行 · {{ ws.stats.words }} 词</span>
    </footer>

    <SettingsDialog v-if="showSettings" :mobile="isMobile" @close="showSettings = false" />
    <!-- 顺序有讲究：路径选择框在前、通用对话框在后，这样对话框里再弹出的
         输入框（如「新建文件夹」）会盖在选择框上面 -->
    <PathPickDialog />
    <WorkspaceDialog />
    <DialogHost />

    <div class="toast-error" v-if="ws.lastError" @click="ws.lastError = ''">
      {{ ws.lastError }}
    </div>
    <div class="toast-notice" v-if="ws.notice" @click="ws.notice = ''">
      {{ ws.notice }}
    </div>
    <div class="toast-success" v-if="ws.success" @click="ws.success = ''">
      <IconSvg name="check" :size="14" />{{ ws.success }}
    </div>
  </div>
</template>
