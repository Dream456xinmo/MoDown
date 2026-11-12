<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useWorkspace } from '../stores/workspace'
import { renderMarkdown } from '../utils/mdWorker'
import { resolveImagesIn } from '../utils/assetSrc'
import { vPinch } from '../composables/pinchZoom'
import ImageViewer from './ImageViewer.vue'

const ws = useWorkspace()
const root = ref<HTMLElement>()
const html = ref('')
let renderSeq = 0

/** 图片查看器状态 */
const viewer = reactive({ open: false, src: '', alt: '' })

/** 渲染走 Worker 线程：大文档不阻塞界面 */
async function refresh() {
  const seq = ++renderSeq
  ws.setRendering(true)
  try {
    const out = await renderMarkdown(ws.content, true)
    if (seq === renderSeq) {
      html.value = out
      // v-html 写进去的 /assets/... 在手机（SAF / 鸿蒙沙箱）下不能直接用，
      // DOM 更新后统一换成 blob/data/raw 地址
      await nextTick()
      if (seq === renderSeq && root.value) await resolveImagesIn(root.value, ws.currentPath)
    }
  } finally {
    if (seq === renderSeq) ws.setRendering(false)
  }
}

function onGoto(e: CustomEvent<{ slug: string }>) {
  const el = root.value?.querySelector(`#${CSS.escape(e.detail.slug)}`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** 点击预览里的图片 → 打开查看器；否则交给代码复制按钮处理 */
function onPreviewClick(e: MouseEvent) {
  const img = (e.target as HTMLElement)?.closest?.('img') as HTMLImageElement | null
  if (img && root.value?.contains(img)) {
    e.preventDefault()
    e.stopPropagation()
    viewer.open = true
    viewer.src = img.currentSrc || img.src
    viewer.alt = img.alt || ''
    return
  }
  void onCopy(e)
}

/** 代码块复制按钮（事件委托，代码块由渲染线程输出） */
async function onCopy(e: MouseEvent) {
  const btn = (e.target as HTMLElement)?.closest?.('.code-copy') as HTMLElement | null
  if (!btn || !root.value?.contains(btn)) return
  e.preventDefault()
  e.stopPropagation()
  const text = btn.closest('.md-code-block')?.querySelector('pre')?.textContent || ''
  if (!text) return
  const ok = await writeClipboard(text)
  const prev = btn.textContent || '复制'
  btn.textContent = ok ? '已复制' : '复制失败'
  btn.classList.toggle('copied', ok)
  window.setTimeout(() => {
    btn.textContent = prev
    btn.classList.remove('copied')
  }, 1200)
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

onMounted(() => {
  void refresh()
  window.addEventListener('xmd-goto', onGoto as EventListener)
})
onBeforeUnmount(() => window.removeEventListener('xmd-goto', onGoto as EventListener))
watch(() => [ws.content, ws.currentPath], refresh)
</script>

<template>
  <div
    class="preview md-scope"
    :class="'md-theme-' + ws.settings.mdTheme"
    ref="root"
    v-pinch
    @click="onPreviewClick"
  >
    <div class="md-body" v-html="html"></div>
    <ImageViewer
      v-if="viewer.open"
      :src="viewer.src"
      :alt="viewer.alt"
      @close="viewer.open = false"
    />
  </div>
</template>

<style scoped>
.preview { padding: 18px 24px; overflow-y: auto; height: 100%; }
.preview :deep(.md-body img) { cursor: zoom-in; }
</style>
