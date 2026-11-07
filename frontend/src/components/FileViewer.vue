<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useWorkspace } from '../stores/workspace'
import { bridge } from '../bridge'
import { buildPreviewHtml } from '../utils/htmlPreview'
import Preview from './Preview.vue'
import IconSvg from './IconSvg.vue'

/**
 * 通用文件预览：
 * - 图片 / 视频 / 音频：直接用浏览器原生播放器（轻量，无第三方库）
 * - PDF / HTML：内嵌渲染
 * - Office 等：在线查看 API 仅在公网地址可用时尝试，否则回退到“系统默认应用 / 浏览器打开”
 */
const ws = useWorkspace()
const isDesktop = bridge.platform === 'wails'

const ext = computed(() => {
  const m = /\.([^.]+)$/.exec(ws.currentPath)
  return m ? m[1].toLowerCase() : ''
})
const url = computed(() => (ws.currentPath ? bridge.assetUrl(ws.currentPath) : ''))

type Kind = 'md' | 'image' | 'video' | 'audio' | 'pdf' | 'html' | 'office' | 'other'
const kind = computed<Kind>(() => {
  const e = ext.value
  if (!e || ['md', 'markdown', 'txt'].includes(e)) return 'md'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'].includes(e)) return 'image'
  if (['mp4', 'webm', 'ogg', 'ogv', 'mov', 'm4v'].includes(e)) return 'video'
  if (['mp3', 'wav', 'flac', 'm4a', 'aac', 'opus'].includes(e)) return 'audio'
  if (e === 'pdf') return 'pdf'
  if (['html', 'htm'].includes(e)) return 'html'
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(e)) return 'office'
  return 'other'
})

/** 打开方式：桌面用系统默认应用，浏览器平台用新标签页打开 */
const openLabel = computed(() => (isDesktop ? '用系统默认应用打开' : '用浏览器打开'))
const openIcon = computed(() => (isDesktop ? 'external' : 'eye'))

/* HTML 源码内嵌渲染 */
const htmlText = ref('')
/* 媒体 / 内嵌框加载失败 → 显示回退面板 */
const failed = ref(false)
const useOnline = ref(false)

/**
 * HTML 预览用 **Blob URL** 而不是 srcdoc：
 * srcdoc 文档的基准地址是 `about:srcdoc`，点页面里的 `<a href="#锚点">`（导出页的目录就是这个）
 * 会被当成一次跨文档导航，iframe 直接变空白 —— 手机上表现为「点大纲白屏」。
 */
const htmlSrc = ref('')
const previewFrame = ref<HTMLIFrameElement | null>(null)

watch(
  () => [ws.currentPath, kind.value],
  async () => {
    htmlText.value = ''
    failed.value = false
    useOnline.value = false
    if (htmlSrc.value) {
      URL.revokeObjectURL(htmlSrc.value)
      htmlSrc.value = ''
    }
    if (kind.value === 'html') {
      try {
        htmlText.value = await bridge.readFile(ws.currentPath)
        htmlSrc.value = toPreviewUrl(htmlText.value)
      } catch (e: any) {
        ws.notifyFail(String(e?.message ?? e))
      }
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  if (htmlSrc.value) URL.revokeObjectURL(htmlSrc.value)
})

/** 原始 HTML → 可安全内嵌的预览文档地址 */
function toPreviewUrl(raw: string): string {
  const doc = buildPreviewHtml(raw, true)
  return URL.createObjectURL(new Blob([doc], { type: 'text/html;charset=utf-8' }))
}

/* ---- 外壳 ↔ 预览文档 的双向通信 ---- */

/** 大纲点击：Markdown 走 Preview，HTML 走 iframe 内的注入脚本 */
function onGoto(e: Event) {
  if (kind.value !== 'html') return
  const detail = (e as CustomEvent).detail as { slug?: string; text?: string } | undefined
  const win = previewFrame.value?.contentWindow
  if (!win) return
  try {
    win.postMessage({ __xmd: 1, type: 'xmd-goto', slug: detail?.slug ?? '', text: detail?.text ?? '' }, '*')
  } catch {
    /* iframe 还没准备好，忽略这次跳转 */
  }
}

/** 预览文档里的链接：外链交给系统浏览器，相对路径明确提示（不然点了就是白屏） */
function onPreviewMessage(ev: MessageEvent) {
  const d = ev.data as { __xmd?: number; type?: string; href?: string } | undefined
  if (!d || d.__xmd !== 1) return
  if (d.type === 'xmd-link' && d.href) {
    // 这是**网址**，不是工作区路径：交给外壳的系统浏览器（openExternal 是「打开工作区外的文件」，用错会报「打不开」）
    bridge.openUrl(d.href).catch((e: any) => ws.notifyFail(String(e?.message ?? e)))
    return
  }
  if (d.type === 'xmd-blocked') {
    ws.notifyFail(`预览里不能跳到「${d.href ?? ''}」，请在应用里打开该文件`)
  }
}

window.addEventListener('xmd-goto', onGoto)
window.addEventListener('message', onPreviewMessage)
onBeforeUnmount(() => {
  window.removeEventListener('xmd-goto', onGoto)
  window.removeEventListener('message', onPreviewMessage)
})

/** 在线查看 API：仅对公网可访问的 http(s) 资源有效 */
const canOnline = computed(() => kind.value === 'office' && /^https?:/i.test(url.value))
const onlineViewer = computed(() =>
  canOnline.value ? 'https://view.officeapps.live.com/op/embed.aspx?src=' + encodeURIComponent(url.value) : ''
)
/** 内嵌框地址：在线服务可用时优先，否则用原始地址（PDF 直接由内核渲染） */
const frameSrc = computed(() => {
  if (kind.value === 'office') return useOnline.value && onlineViewer.value ? onlineViewer.value : ''
  return url.value
})

async function openWithSystem() {
  try {
    await bridge.openPath(ws.currentPath)
  } catch (e: any) {
    ws.notifyFail(String(e?.message ?? e))
  }
}
</script>

<template>
  <div class="file-viewer">
    <div v-if="!ws.currentPath" class="viewer-empty">
      <IconSvg name="eye" :size="28" />
      <p>从左侧文件树选择文件即可预览<br />支持图片 / 视频 / 音频 / PDF / HTML / Office 等</p>
    </div>

    <Preview v-else-if="kind === 'md'" />

    <template v-else>
      <!-- 顶部工具条：始终提供“用默认方式打开”，在线 API 不可用也不会卡住 -->
      <div class="viewer-bar">
        <span class="viewer-bar-name" :title="ws.currentPath">{{ ws.fileTitle }}</span>
        <button class="viewer-bar-btn" @click="openWithSystem">
          <IconSvg :name="openIcon" :size="13" /><span>{{ openLabel }}</span>
        </button>
        <button v-if="canOnline" class="viewer-bar-btn" :class="{ active: useOnline }" @click="useOnline = !useOnline">
          <IconSvg name="eye" :size="13" /><span>{{ useOnline ? '关闭在线预览' : '在线预览' }}</span>
        </button>
        <button v-if="failed" class="viewer-bar-btn" @click="failed = false">
          <IconSvg name="refresh" :size="13" /><span>重试内嵌预览</span>
        </button>
      </div>

      <div class="viewer-body">
        <!-- 图片：原生 img -->
        <div v-if="kind === 'image'" class="viewer-center">
          <img :src="url" :alt="ws.fileTitle" @error="failed = true" />
        </div>

        <!-- 视频：原生 video（轻量播放器） -->
        <div v-else-if="kind === 'video'" class="viewer-center">
          <video
            :src="url"
            controls
            playsinline
            preload="metadata"
            controlslist="nodownload"
            @error="failed = true"
          ></video>
        </div>

        <!-- 音频：原生 audio -->
        <div v-else-if="kind === 'audio'" class="viewer-center">
          <IconSvg name="attach" :size="30" />
          <p class="viewer-name">{{ ws.fileTitle }}</p>
          <audio :src="url" controls preload="metadata" @error="failed = true"></audio>
        </div>

        <!-- PDF：内核原生渲染 -->
        <iframe
          v-else-if="kind === 'pdf' && !failed && url"
          class="viewer-frame"
          :src="url"
          title="PDF 预览"
          @error="failed = true"
        ></iframe>

        <!-- HTML：沙箱内嵌 -->
        <iframe
          v-else-if="kind === 'html' && !failed && htmlSrc"
          ref="previewFrame"
          class="viewer-frame"
          sandbox="allow-scripts allow-popups allow-modals"
          :src="htmlSrc"
          title="HTML 预览"
          @load="failed = false"
          @error="failed = true"
        ></iframe>

        <!-- HTML 读不到内容（空文件 / 读失败）时的兜底，避免出现空白面板 -->
        <div v-else-if="kind === 'html'" class="viewer-mixed">
          <IconSvg name="eye" :size="26" />
          <p class="viewer-name">{{ ws.fileTitle }}</p>
          <p class="viewer-tip">无法内嵌显示该 HTML 的内容，可以「{{ openLabel }}」。</p>
          <div class="viewer-actions">
            <button class="viewer-bar-btn" @click="openWithSystem">
              <IconSvg :name="openIcon" :size="13" /><span>{{ openLabel }}</span>
            </button>
          </div>
        </div>

        <!-- Office 在线预览（仅在地址为公网 URL 且用户主动开启时） -->
        <iframe
          v-else-if="kind === 'office' && useOnline && frameSrc && !failed"
          class="viewer-frame"
          :src="frameSrc"
          title="在线预览"
        ></iframe>

        <!-- 无法内嵌：说明 + 默认打开方式 -->
        <div v-else class="viewer-center viewer-card">
          <IconSvg name="file" :size="30" />
          <p class="viewer-name">{{ ws.fileTitle }}</p>
          <p class="viewer-hint" v-if="kind === 'office'">
            本地 Office 文档无法在应用内直接渲染。<br />
            在线查看 API 需要文件位于公网可访问地址；此处已回退为
            {{ isDesktop ? '系统默认应用' : '浏览器' }}打开，不会阻塞操作。
          </p>
          <p class="viewer-hint" v-else-if="failed">文件加载失败（内容缺失或格式不支持）。</p>
          <p class="viewer-hint" v-else>此文件类型暂不支持内嵌预览。</p>
          <button class="viewer-btn" @click="openWithSystem">
            <IconSvg :name="openIcon" :size="14" /><span>{{ openLabel }}</span>
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.file-viewer { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.viewer-bar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 6px 10px; border-bottom: 1px solid var(--border); background: var(--bg-side);
}
.viewer-bar-name {
  font-size: 12.5px; font-weight: 600; color: var(--fg-dim);
  max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.viewer-bar-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 9px; font-size: 12.5px; border: 1px solid var(--border);
  border-radius: 7px; background: var(--bg); color: var(--fg);
}
.viewer-bar-btn.active { color: var(--accent); border-color: var(--accent); }
.viewer-body { flex: 1; min-height: 0; display: flex; }
.viewer-body > * { flex: 1; min-height: 0; }
.viewer-body video, .viewer-body audio, .viewer-body img { max-width: 100%; }
</style>
