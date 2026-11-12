<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { MarkdownImage } from '../utils/tiptapMarkdownImage'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import { useWorkspace } from '../stores/workspace'
import { bridge } from '../bridge'
import { switchEditMode } from '../utils/editorSwitch'
import { vPinch } from '../composables/pinchZoom'
import { CodeBlockHighlight } from '../utils/tiptapCodeHighlight'
import { TrailingParagraph } from '../utils/tiptapTrailingParagraph'
import { resolveAssetSrc } from '../utils/assetSrc'
import { richPositions, savePos } from '../utils/editorState'
import EditorToolbar from './EditorToolbar.vue'

const ws = useWorkspace()
const host = ref<HTMLElement>()
const editorRef = shallowRef<Editor | null>(null)
let suppress = false
/** 当前正文对应的文件路径（切换时用来保存/恢复光标与滚动） */
let statePath = ''

/**
 * 编辑器 ↔ store 的对应关系。
 * 手机端三个面板是 v-show 常驻的，切模式不会重新挂载；PC 端虽然会重挂，
 * 但同一文件在别处（源码编辑器 / 外部打开）被改过也要跟上新内容，
 * 所以记住「编辑器现在显示的是哪一份文本」，只有真的不一致才重载。
 * 只比内容、不比打开序号：另存为/换文件时正文往往一字不差，重载反而会丢掉光标与撤销记录。
 */
let boundText = ''

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i

/** 拖拽/粘贴文件：图片拷入 /assets 内嵌显示；视频/音频/其他拷入 /files 以链接插入 */
async function insertAssetFile(file: File) {
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = rej
    r.readAsDataURL(file)
  })
  const isImg = file.type.startsWith('image/') || IMAGE_RE.test(file.name)
  const rel = await bridge.importAssetRaw(file.name, dataUrl, isImg ? 'assets' : 'files')
  const e = editorRef.value
  if (!e) return
  if (isImg) {
    e.chain().focus().setImage({ src: rel, alt: file.name }).run()
  } else {
    e.chain().focus().insertContent({
      type: 'text',
      text: file.name,
      marks: [{ type: 'link', attrs: { href: rel, target: '_blank' } }]
    }).run()
  }
}

onMounted(() => {
  const editor = new Editor({
    element: host.value!,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
      MarkdownImage.configure({
        inline: false,
        allowBase64: false,
        // 只影响编辑区显示，保存时仍写回原始路径
        resolveSrc: src => resolveAssetSrc(src, ws.currentPath)
      }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer' } }),
      Placeholder.configure({ placeholder: '开始写作…' }),
      CodeBlockHighlight,
      TrailingParagraph,
      Markdown.configure({ html: false, breaks: false, linkify: true, transformPastedText: true })
    ],
    content: ws.content,
    editorProps: { attributes: { class: 'tiptap' } },
    onUpdate: ({ editor: e }) => {
      if (suppress) return
      // 记住这份内容是自己产出的：watcher 不能再拿它去 setContent，否则光标会跳回开头
      boundText = e.storage.markdown.getMarkdown()
      ws.setContent(boundText)
    }
  })
  editorRef.value = editor
  boundText = ws.content
  statePath = ws.currentPath

  const el = host.value!
  el.addEventListener('drop', onDrop)
  el.addEventListener('paste', onPaste)
  window.addEventListener('xmd-goto', onGoto as EventListener)
})

function onDrop(e: Event) {
  const de = e as DragEvent
  const f = de.dataTransfer?.files?.[0]
  if (f) {
    de.preventDefault()
    void insertAssetFile(f)
  }
}
function onPaste(e: Event) {
  const ce = e as ClipboardEvent
  const f = ce.clipboardData?.files?.[0]
  if (f) {
    ce.preventDefault()
    void insertAssetFile(f)
  }
}

/** 点击正文下方空白：把光标放到文档末尾（有图片/代码块时也能直接继续写） */
function onRichClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.closest('.tiptap')) return
  editorRef.value?.chain().focus('end').run()
}

/** 大纲点击 → 按标题文本滚动定位 */
function onGoto(ev: CustomEvent<{ text: string }>) {
  const editor = editorRef.value
  if (!editor) return
  const nodes = editor.view.dom.querySelectorAll('h1,h2,h3,h4,h5,h6')
  for (const n of Array.from(nodes)) {
    if (n.textContent?.trim() === ev.detail.text.trim()) {
      n.scrollIntoView({ behavior: 'smooth', block: 'start' })
      break
    }
  }
}

/**
 * store → 编辑器：换文件、或内容被别处（源码编辑器 / 外部打开 / 撤销）改动时重载。
 * 自己刚写回的那一份要跳过，否则每敲一个字都会 setContent，光标被甩回开头。
 */
function pullFromStore(force = false) {
  const editor = editorRef.value
  if (!editor) return
  if (!force && boundText === ws.content) return
  boundText = ws.content
  suppress = true
  editor.commands.setContent(ws.content)
  suppress = false
}

watch(() => [ws.currentPath, ws.content, ws.openSeq], () => pullFromStore())

/* 切文件：先记下旧文件的光标/滚动，正文拉取完成后再恢复新文件自己的位置 */
watch(
  () => ws.currentPath,
  () => {
    const ed = editorRef.value
    if (ed) {
      const scroller = ed.view.dom.closest('.rich-scroll') as HTMLElement | null
      savePos(richPositions, statePath, { pos: ed.state.selection.from, scroll: scroller?.scrollTop || 0 })
    }
    statePath = ws.currentPath
    void nextTick(() => {
      const cur = editorRef.value
      if (!cur) return
      const p = richPositions.get(ws.currentPath)
      if (!p) return
      const max = cur.state.doc.content.size
      cur.commands.setTextSelection(Math.max(0, Math.min(p.pos, max)))
      const scroller = cur.view.dom.closest('.rich-scroll') as HTMLElement | null
      if (scroller) scroller.scrollTop = p.scroll
    })
  }
)

/* ---- 富文本语法风险提示 ---- */
const riskDismissed = ref(false)
/** 换文件就重新提醒一次，别把上一个文件的「知道了」带到下一个文件 */
watch(() => ws.openSeq, () => (riskDismissed.value = false))
/** 打开文件时就地算好的风险项（ws.richRisks）：直接进富文本没有「切换」这一步，只能在这里提醒 */
const risks = computed(() => (riskDismissed.value ? [] : ws.richRisks))

function toSourceMode() {
  void switchEditMode(ws.settings.enableMonaco ? 'split' : 'codemirror')
}

onBeforeUnmount(() => {
  const ed = editorRef.value
  if (ed) {
    const scroller = ed.view.dom.closest('.rich-scroll') as HTMLElement | null
    savePos(richPositions, statePath, { pos: ed.state.selection.from, scroll: scroller?.scrollTop || 0 })
  }
  const el = host.value
  el?.removeEventListener('drop', onDrop)
  el?.removeEventListener('paste', onPaste)
  window.removeEventListener('xmd-goto', onGoto as EventListener)
  editorRef.value?.destroy()
  editorRef.value = null
})
</script>

<template>
  <div class="rich-host">
    <!-- 直接落在富文本模式时没有「切换」这一步可拦，这里先亮出来，别等用户敲了字才发现表格没了 -->
    <div v-if="risks.length" class="rich-risk">
      <span class="rich-risk-text">
        本文档含富文本无法完整保留的语法：{{ risks.join('、') }}。在这里编辑一次，这些内容就会被改写或丢失。
      </span>
      <div class="rich-risk-actions">
        <button class="viewer-bar-btn" @click="toSourceMode">改用源码模式</button>
        <button class="viewer-bar-btn" @click="riskDismissed = true">知道了</button>
      </div>
    </div>
    <EditorToolbar :editor="editorRef" />
    <!-- 主题只作用于正文滚动区，不套在 .rich-host 上：否则深浅色变量会污染工具栏按钮 -->
    <div
      ref="host"
      class="rich-scroll md-scope"
      :class="'md-theme-' + ws.settings.mdTheme"
      v-pinch
      @click="onRichClick"
    ></div>
  </div>
</template>
