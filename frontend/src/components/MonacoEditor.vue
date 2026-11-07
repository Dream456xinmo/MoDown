<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useWorkspace } from '../stores/workspace'
import { langFromPath, monacoLangId } from '../utils/languages'
import { installMonacoSnippets } from '../utils/monacoSnippets'
import { expandEmmetAtCursor, registerEmmet } from '../utils/monacoEmmet'
import { registerBasicCompletions } from '../utils/monacoCompletions'
import { saveCurrent } from '../utils/shortcuts'
import IconSvg from './IconSvg.vue'

/**
 * VSCode 网页版编辑器（完整 Monaco）。
 *
 * 直接引入 `monaco-editor` 的完整入口（esm/vs/index.js = editor.main + 全部
 * contrib + 全部语言定义），再补上 ts/json/css/html 语言服务，行为/外观与
 * VSCode 网页版一致；Emmet、Java/Python/PHP 补全作为「扩展」注册。
 *
 * 顶部只保留：查找 / 替换 / 小地图 / 编码切换。底部不再有额外的状态栏。
 */
import * as monaco from 'monaco-editor'
import 'monaco-editor/esm/vs/language/json/monaco.contribution'
import 'monaco-editor/esm/vs/language/css/monaco.contribution'
import 'monaco-editor/esm/vs/language/html/monaco.contribution'
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker.js?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker.js?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker.js?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker.js?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker.js?worker'

const ws = useWorkspace()
const host = ref<HTMLElement>()
const editor = shallowRef<monaco.editor.IStandaloneCodeEditor | null>(null)
let applying = false
let modelPath = ''

/** 外观设置（设置页控制；工具条不再放字号/换行按钮） */
const fontSize = ref(ws.settings.editorFontSize)
const wordWrap = ref(ws.settings.editorWordWrap)
const minimap = ref(ws.settings.editorMinimap)

/** 切到富文本/源码再切回来时恢复滚动/光标位置（model 由 Monaco 按 URI 复用） */
const viewStateCache = new Map<string, monaco.editor.ICodeEditorViewState | null>()

// 各家语言服务在 Web Worker 里跑；全部本地打包，零 CDN。
if (!(self as any).MonacoEnvironment) {
  ;(self as any).MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === 'json') return new JsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
      if (label === 'typescript' || label === 'javascript') return new TsWorker()
      return new EditorWorker()
    }
  }
}

function modelKey(path: string) {
  return path || '__untitled__'
}

function getModel(path: string): monaco.editor.ITextModel {
  const key = modelKey(path)
  const uri = monaco.Uri.parse('inmemory://xmd/' + encodeURIComponent(key))
  // 以 Monaco 自己的 ModelService 为准：切换编辑器会卸载/重建组件，
  // 若只靠模块级 Map 缓存，重建时可能重复 createModel，报
  // "Cannot add model because it already exists"。
  let model = monaco.editor.getModel(uri)
  if (!model) {
    try {
      model = monaco.editor.createModel(ws.content, monacoLangId(langFromPath(path)), uri)
    } catch {
      // 并发挂载时另一个实例刚创建完：直接复用
      model = monaco.editor.getModel(uri)
    }
  }
  if (!model) throw new Error('无法创建编辑器 model')
  return model
}

/** 按当前文件类型切换高亮语言（完整版 Monaco 已内置全部语言定义） */
function applyLanguage() {
  const model = editor.value?.getModel()
  if (model) monaco.editor.setModelLanguage(model, monacoLangId(langFromPath(ws.currentPath)))
}

/** 切文件：保存旧文件的滚动/光标，换 model，再恢复新文件自己的滚动/光标 */
function switchModel() {
  const ed = editor.value
  if (!ed) return
  const path = ws.currentPath
  if (path === modelPath) return
  if (modelPath) viewStateCache.set(modelPath, ed.saveViewState())

  const model = getModel(path)
  // 该文件被别处（富文本 / 源码模式）改过：同步过来。只有真正不一致才 setValue，避免清掉撤销栈。
  if (model.getValue() !== ws.content) {
    applying = true
    model.setValue(ws.content)
    applying = false
  }
  ed.setModel(model)
  modelPath = path
  const state = viewStateCache.get(path)
  if (state) ed.restoreViewState(state)
  applyLanguage()
}

/* ---------- 工具条动作 ---------- */
function toggleMinimap() {
  void ws.updateSetting('editorMinimap', !minimap.value)
}
/** 调用 Monaco 内置命令（查找 / 替换） */
function runAction(id: string) {
  editor.value?.getAction(id)?.run()
}
/** 编码切换：交给 store 重新读取当前文件 */
function onEncodingChange(e: Event) {
  void ws.changeEncoding((e.target as HTMLSelectElement).value)
}

watch(
  () => ws.settings.editorFontSize,
  v => {
    fontSize.value = v
    editor.value?.updateOptions({ fontSize: v })
  }
)
watch(
  () => ws.settings.editorWordWrap,
  v => {
    wordWrap.value = v
    editor.value?.updateOptions({ wordWrap: v ? 'on' : 'off' })
  }
)
watch(
  () => ws.settings.editorMinimap,
  v => {
    minimap.value = v
    editor.value?.updateOptions({ minimap: { enabled: v } })
  }
)

onMounted(() => {
  if (!host.value) return

  try {
    // Emmet / 补充补全作为「扩展」注册（和 VSCode 装扩展同一层）
    installMonacoSnippets(monaco)
    registerEmmet(monaco)
    registerBasicCompletions(monaco)

    const initialModel = getModel(ws.currentPath)
    if (initialModel.getValue() !== ws.content) initialModel.setValue(ws.content)

    editor.value = monaco.editor.create(host.value, {
      model: initialModel,
      theme: ws.resolvedTheme === 'dark' ? 'vs-dark' : 'vs',
      automaticLayout: true,
      // ---- 以下按 VSCode 网页版的默认值 ----
      fontFamily: "'Droid Sans Mono', 'monospace', monospace, 'Droid Sans Fallback'",
      fontSize: fontSize.value,
      lineHeight: 0,
      fontLigatures: false,
      tabSize: 4,
      detectIndentation: true,
      minimap: { enabled: minimap.value, showSlider: 'mouseover', renderCharacters: false, maxColumn: 120, scale: 1 },
      wordWrap: wordWrap.value ? 'on' : 'off',
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      // 和 VSCode 默认一致：光标只闪、不做滑动动画，避免移动时“跳”的感觉
      cursorBlinking: 'blink',
      cursorSmoothCaretAnimation: 'off',
      cursorStyle: 'line',
      cursorWidth: 2,
      renderWhitespace: 'selection',
      renderLineHighlight: 'all',
      renderControlCharacters: false,
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true, highlightActiveIndentation: true },
      stickyScroll: { enabled: true },
      folding: true,
      showFoldingControls: 'mouseover',
      links: true,
      colorDecorators: true,
      lightbulb: { enabled: 'onCode' as any },
      codeLens: true,
      inlayHints: { enabled: 'on' },
      formatOnPaste: true,
      formatOnType: true,
      suggest: { showWords: true, showSnippets: true, preview: true, shareSuggestSelections: true },
      quickSuggestions: { other: true, comments: false, strings: false },
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnEnter: 'on',
      parameterHints: { enabled: true },
      hover: { enabled: 'on', delay: 300 },
      multiCursorModifier: 'alt',
      mouseWheelZoom: true,
      overviewRulerLanes: 3,
      lineNumbersMinChars: 3,
      padding: { top: 0, bottom: 0 }
    })
    modelPath = ws.currentPath

    // Emmet：HTML 里按 Tab 直接展开缩写（h1 / br / div.box / ul>li*3），
    // 不是缩写时回退为普通 Tab（插入缩进）。
    editor.value.addCommand(monaco.KeyCode.Tab, () => {
      if (langFromPath(ws.currentPath) === 'html' && expandEmmetAtCursor(monaco, editor.value)) return
      editor.value?.trigger('keyboard', 'type', { text: '\t' })
    })

    // VSCode 网页版快捷键：Ctrl+Shift+P 命令面板（F1 也保留）
    editor.value.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP,
      () => editor.value?.trigger('keyboard', 'editor.action.quickCommand', null)
    )

    // Ctrl/Cmd + S 直接保存
    editor.value.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveCurrent())

    editor.value.onDidChangeModelContent(() => {
      if (applying) return
      const v = editor.value!.getValue()
      if (v !== ws.content) ws.setContent(v)
    })
  } catch (e: any) {
    console.error(e)
    ws.notifyFail(`VSCode 编辑器初始化失败：${String(e?.message ?? e)}`)
  }
})

/**
 * store → 编辑器：内容变了（富文本 / CodeMirror / 外部打开 / 撤销）就同步到**当前 model**。
 * 只改当前文件，别的文件的 model 保留自己的撤销栈。
 */
watch(
  () => [ws.content, ws.openSeq],
  () => {
    const ed = editor.value
    if (!ed) return
    const model = ed.getModel()
    if (!model || model.getValue() === ws.content) return
    applying = true
    model.setValue(ws.content)
    applying = false
  }
)

watch(
  () => ws.resolvedTheme,
  t => monaco.editor.setTheme(t === 'dark' ? 'vs-dark' : 'vs')
)

watch(() => ws.currentPath, () => switchModel())

onBeforeUnmount(() => {
  if (editor.value) {
    if (modelPath) viewStateCache.set(modelPath, editor.value.saveViewState())
    editor.value.dispose()
    editor.value = null
  }
})
</script>

<template>
  <div class="monaco-host">
    <!-- 顶部只保留：查找 / 替换 / 小地图 / 编码切换 -->
    <div class="mono-bar">
      <button title="查找（Ctrl+F）" @click="runAction('actions.find')">
        <IconSvg name="search" :size="13" /><span>查找</span>
      </button>
      <button title="替换（Ctrl+H）" @click="runAction('editor.action.startFindReplaceAction')">替换</button>
      <button :class="{ active: minimap }" title="小地图" @click="toggleMinimap">小地图</button>
      <span class="mono-sep"></span>
      <label class="mono-enc" title="文本编码（切换会重新读取文件）">
        <span>编码</span>
        <select :value="ws.encoding" :disabled="!ws.currentPath" @change="onEncodingChange">
          <option value="auto">自动（{{ ws.detectedEncoding.toUpperCase() }}）</option>
          <option value="utf-8">UTF-8</option>
          <option value="gbk">GBK</option>
          <option value="gb18030">GB18030</option>
          <option value="big5">Big5</option>
          <option value="utf-16le">UTF-16 LE</option>
          <option value="utf-16be">UTF-16 BE</option>
          <option value="latin1">ISO-8859-1</option>
        </select>
      </label>
    </div>

    <div class="mono-editor-wrap">
      <div v-if="!editor" class="monaco-loading">正在加载 VSCode 编辑器…</div>
      <div ref="host" class="monaco-editor"></div>
    </div>
  </div>
</template>

<style scoped>
/* 绝对定位填满 .editor-wrap：flex 百分比高度在 WebKit 下不稳定 */
.monaco-host {
  position: absolute;
  inset: 0;
  /* 建立独立层叠上下文：Monaco 内部浮层（z-index 很高）不会盖住
     Editor.vue 右下角的「富文本/源码/VSCode/预览」切换器（z-index: 50） */
  z-index: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.mono-editor-wrap {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  overflow: hidden;
}
.mono-editor-wrap .monaco-editor { flex: 1; min-width: 0; }

/* 极简工具条：查找 / 替换 / 小地图 / 编码 */
.mono-bar {
  position: relative;
  z-index: 2;
  flex: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 6px;
  min-height: 32px;
  padding: 3px 8px;
  background: var(--bg-side);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.mono-bar > button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 5px;
  font-size: 11.5px;
  color: var(--fg-dim);
  white-space: nowrap;
  flex: none;
}
.mono-bar > button:hover { background: var(--bg-hover); color: var(--fg); }
.mono-bar > button.active { color: var(--accent); background: var(--bg-active); }
.mono-bar > button svg { flex: none; }
.mono-sep { width: 1px; height: 14px; background: var(--border); margin: 0 2px; flex: none; }

/* 编码切换 */
.mono-enc {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--fg-dim);
  white-space: nowrap;
}
.mono-enc select {
  height: 24px;
  max-width: 190px;
  padding: 2px 24px 2px 7px;
  font-size: 11.5px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background-color: var(--bg);
  color: var(--fg);
}
</style>
