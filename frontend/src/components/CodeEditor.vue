<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorView, keymap } from '@codemirror/view'
import { Compartment, EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { basicSetup } from 'codemirror'
import { useWorkspace } from '../stores/workspace'
import { codemirrorLangFor, langFromPath } from '../utils/languages'
import { saveCurrent } from '../utils/shortcuts'
import { cmPositions, savePos } from '../utils/editorState'
import { vPinch } from '../composables/pinchZoom'

const ws = useWorkspace()
const host = ref<HTMLElement>()
let view: EditorView | null = null
let suppress = false
/** 当前 CodeMirror 状态对应的文件路径（切换时用来保存光标/滚动） */
let statePath = ''

/**
 * 编辑器当前对应「哪一份内容」（与富文本编辑器同一套约定）。
 * 手机端源码面板是 v-show 常驻、切过去不重新挂载，所以只能靠它区分
 * 「是我自己打的字」还是「别处改了内容」：前者不重载（否则光标被甩），后者必须重载。
 * 只比内容、不比打开序号：换文件/另存为时正文常常一字不差，重载反而丢掉光标与撤销记录。
 */
let boundText = ''

const updateListener = EditorView.updateListener.of(u => {
  if (!u.docChanged || suppress) return
  boundText = u.state.doc.toString()
  ws.setContent(boundText)
})

const saveKeymap = keymap.of([
  {
    key: 'Mod-s',
    preventDefault: true,
    run: () => {
      void saveCurrent()
      return true
    }
  }
])

/** 语言扩展按需加载（Markdown / JS / TS / HTML / CSS），未支持的语言退化为纯文本 */
const langCompartment = new Compartment()

async function applyLanguage() {
  if (!view) return
  const ext = (await codemirrorLangFor(langFromPath(ws.currentPath))) as never
  view.dispatch({ effects: langCompartment.reconfigure(ext ? [ext] : []) })
}

async function handleImageFiles(files: FileList, target: EditorView) {
  for (const file of Array.from(files)) {
    if (!file.type.startsWith('image/')) continue
    const dataUrl = await new Promise<string>((res, rej) => {
      const r = new FileReader()
      r.onload = () => res(String(r.result))
      r.onerror = rej
      r.readAsDataURL(file)
    })
    const rel = await ws.importImage(file.name, dataUrl)
    const pos = target.state.selection.main.head
    target.dispatch({
      changes: { from: pos, insert: `\n![${file.name}](${rel})\n` }
    })
  }
}

const domHandlers = EditorView.domEventHandlers({
  drop(event, v) {
    const files = event.dataTransfer?.files
    if (files?.length && files[0].type.startsWith('image/')) {
      event.preventDefault()
      void handleImageFiles(files, v)
      return true
    }
    return false
  },
  paste(event, v) {
    const files = event.clipboardData?.files
    if (files?.length && files[0].type.startsWith('image/')) {
      event.preventDefault()
      void handleImageFiles(files, v)
      return true
    }
    return false
  }
})

const cmTheme = EditorView.theme({
  '&': { backgroundColor: 'transparent' },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid var(--border)' }
})

/* 深色模式：basicSetup 自带浅色主题（当前行浅灰条、浅色语法高亮），
   切换为 oneDark 深色主题；cmTheme 排在其后保持背景跟随应用变量 */
const themeCompartment = new Compartment()
const darkThemeExt = () =>
  ws.resolvedTheme === 'dark' ? [oneDark] : []

onMounted(() => {
  view = new EditorView({
    state: EditorState.create({
      doc: ws.content,
      extensions: [
        basicSetup,
        saveKeymap,
        langCompartment.of([]),
        updateListener,
        domHandlers,
        themeCompartment.of(darkThemeExt()),
        cmTheme,
        EditorView.lineWrapping
      ]
    }),
    parent: host.value!
  })
  void applyLanguage()
  boundText = ws.content
  statePath = ws.currentPath
  window.addEventListener('xmd-goto', onGoto as EventListener)
})

/** 大纲点击 → 跳转行 */
function onGoto(e: CustomEvent<{ slug: string; line: number }>) {
  if (!view) return
  const line = Math.min(e.detail.line + 1, view.state.doc.lines)
  const pos = view.state.doc.line(line).from
  view.dispatch({
    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    selection: { anchor: pos }
  })
}

/** store → 编辑器：换文件、或内容被别处（富文本 / 外部打开 / 撤销）改动时整体替换 */
function pullFromStore() {
  if (!view || suppress) return
  if (boundText === ws.content) return
  boundText = ws.content
  suppress = true
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: ws.content }
  })
  suppress = false
}

watch(() => [ws.currentPath, ws.content, ws.openSeq], pullFromStore)

watch(
  () => ws.currentPath,
  () => {
    // 切走前记下当前文件的光标与滚动；切回来时恢复
    if (view) savePos(cmPositions, statePath, { pos: view.state.selection.main.head, scroll: view.scrollDOM.scrollTop })
    statePath = ws.currentPath
    void applyLanguage()
    requestAnimationFrame(() => {
      if (!view) return
      const p = cmPositions.get(ws.currentPath)
      if (!p) return
      view.dispatch({ selection: { anchor: Math.min(p.pos, view.state.doc.length) } })
      view.scrollDOM.scrollTop = p.scroll
    })
  }
)

/* 主题切换 → 动态重配深色/浅色扩展 */
watch(
  () => ws.resolvedTheme,
  () => {
    view?.dispatch({ effects: themeCompartment.reconfigure(darkThemeExt()) })
  }
)

onBeforeUnmount(() => {
  if (view) savePos(cmPositions, statePath, { pos: view.state.selection.main.head, scroll: view.scrollDOM.scrollTop })
  window.removeEventListener('xmd-goto', onGoto as EventListener)
  view?.destroy()
})
</script>

<template>
  <div class="cm-host" ref="host" v-pinch></div>
</template>
