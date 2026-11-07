<script setup lang="ts">
import { computed, defineAsyncComponent } from 'vue'
import { useWorkspace } from '../stores/workspace'
import { isAndroidShell } from '../utils/device'
import LoadingHint from './LoadingHint.vue'

/**
 * 编辑区容器：模式由 settings.editorMode 决定。
 * tiptap 富文本 | codemirror 源码 | split VSCode(Monaco) | preview 文件预览
 * VSCode 即 Monaco 本身，占据整个编辑区（不再与富文本左右分屏）。
 * 各编辑器按需异步加载，首屏只加载真正用到的那个，包体积更小。
 */
const asyncEditor = (loader: () => Promise<unknown>) =>
  defineAsyncComponent({ loader: loader as never, loadingComponent: LoadingHint, delay: 100 })

const RichEditor = asyncEditor(() => import('./RichEditor.vue'))
const CodeEditor = asyncEditor(() => import('./CodeEditor.vue'))
const MonacoEditor = asyncEditor(() => import('./MonacoEditor.vue'))
const FileViewer = asyncEditor(() => import('./FileViewer.vue'))

const ws = useWorkspace()

/**
 * 安卓原生壳上禁用 Monaco（VSCode 模式）：
 * Monaco 的输入替身是 1px 隐藏元素，安卓 WebView 聚焦后不弹软键盘，
 * 所以这里回退到 CodeMirror 6。
 */
const mode = computed(() => {
  const m = ws.settings.editorMode
  if (m !== 'split') return m
  // 安卓壳：Monaco 在这里调不出输入法，回退到 CodeMirror（等价手机外壳的「源码」）
  if (isAndroidShell()) return 'codemirror' as const
  // 用户自己关掉了 Monaco：split 回到历史语义（富文本）
  if (!ws.settings.enableMonaco) return 'tiptap' as const
  return m
})

</script>

<template>
  <div class="editor-wrap">
    <RichEditor v-if="mode === 'tiptap'" />
    <CodeEditor v-else-if="mode === 'codemirror'" />
    <MonacoEditor v-else-if="mode === 'split'" />
    <FileViewer v-else />
  </div>
</template>
