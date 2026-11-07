<script setup lang="ts">
/* 内联 SVG 图标集（Lucide 风格描边路径，继承 currentColor） */
import { computed } from 'vue'

const props = defineProps<{
  name: string
  size?: number | string
  color?: string
}>()

const px = computed(() => props.size || 16)
</script>

<template>
  <svg
    class="appicon"
    :style="{ width: px + 'px', height: px + 'px', color: color }"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <!-- 方向 -->
    <template v-if="name === 'chevron-right'"><path d="m9 18 6-6-6-6" /></template>
    <template v-else-if="name === 'chevron-down'"><path d="m6 9 6 6 6-6" /></template>
    <template v-else-if="name === 'chevron-left'"><path d="m15 18-6-6 6-6" /></template>
    <template v-else-if="name === 'expand'"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3" /></template>
    <template v-else-if="name === 'collapse'"><path d="M15 3h3a2 2 0 0 1 2 2v3m-8 13v-3a2 2 0 0 0-2-2H4m16 5v-3a2 2 0 0 0-2-2h-3M3 8V5a2 2 0 0 1 2-2h3" /></template>

    <!-- 导航：汉堡 / 三个点 / 返回 / 搜索 -->
    <template v-else-if="name === 'menu'"><path d="M3 6h18M3 12h18M3 18h18" /></template>
    <template v-else-if="name === 'dots'"><circle cx="12" cy="5" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="19" r="1.4" fill="currentColor" /></template>
    <template v-else-if="name === 'back'"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></template>
    <template v-else-if="name === 'search'"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></template>
    <!-- 侧栏 / 文件树：矩形 + 左侧分栏（表示左侧面板，非文件夹，避免与「文件夹」图标混淆） -->
    <template v-else-if="name === 'panel-left'"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9.5 4v16" /></template>
    <template v-else-if="name === 'save'"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" /><path d="M17 21v-8H7v8" /><path d="M7 3v5h8" /></template>
    <template v-else-if="name === 'export'"><path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" /></template>
    <template v-else-if="name === 'settings'"><path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h10M18 18h2" /><circle cx="16" cy="6" r="2" /><circle cx="8" cy="12" r="2" /><circle cx="16" cy="18" r="2" /></template>

    <!-- 文件夹 -->
    <template v-else-if="name === 'folder'"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></template>
    <template v-else-if="name === 'folder-open'"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" /></template>

    <!-- 文件类型 -->
    <template v-else-if="name === 'file'"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /></template>
    <template v-else-if="name === 'file-md'">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M7.5 17v-4.5L10 15l2.5-2.5V17" /><path d="M17 12.5V17m0 0 1.5-1.7M17 17l-1.5-1.7" />
    </template>
    <template v-else-if="name === 'file-image'"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><circle cx="10" cy="13" r="1.6" /><path d="m8.5 17.5 2.5-3 2.8 3.4" /></template>
    <template v-else-if="name === 'file-code'"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="m10 12-2 3 2 3m4-6 2 3-2 3" /></template>
    <template v-else-if="name === 'file-pdf'"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M8.5 16.5c1-3 1.5-5.5 1-6.5-.8-1.8 2-1.8 2 .5 0 1.5-1 3-2.5 4.5" /><path d="M12.5 15c1-2 2-4.5 2-5.5 0-1.5 2-1.5 2 0 0 1.5-.5 3.5-1 5.5" /></template>

    <!-- 模式切换 / 工具 -->
    <template v-else-if="name === 'format'"><path d="M20 4H9" /><path d="M14 20H9" /><path d="M15 4a5 5 0 0 0 0 16" /></template>
    <template v-else-if="name === 'source'"><path d="m10 12.5-3 3.5 3 3.5m4-14 3 3.5-3 3.5" /><path d="m16 6-4 14" /></template>
    <template v-else-if="name === 'palette'">
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2Z" />
    </template>
    <template v-else-if="name === 'heading'"><path d="M6 12h12M6 18v-6M18 18v-6M6 6v6M18 6v6" /></template>

    <!-- 通用 -->
    <template v-else-if="name === 'x'"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></template>
    <template v-else-if="name === 'sun'">
      <circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
    </template>
    <template v-else-if="name === 'moon'"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></template>
    <template v-else-if="name === 'theme-auto'">
      <circle cx="12" cy="12" r="9" /><path d="M12 3v18a9 9 0 0 0 0-18Z" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'import'"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 21h16" /></template>
    <template v-else-if="name === 'file-plus'"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M12 12v6M9 15h6" /></template>
    <template v-else-if="name === 'folder-plus'"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /><path d="M12 10v6M9 13h6" /></template>

    <!-- 富文本工具栏 -->
    <template v-else-if="name === 'undo'"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" /></template>
    <template v-else-if="name === 'redo'"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" /></template>
    <template v-else-if="name === 'bold'"><path d="M14 12a4 4 0 0 0 0-8H6v8" /><path d="M15 20a4 4 0 0 0 0-8H6v8Z" /></template>
    <template v-else-if="name === 'italic'"><path d="M19 4h-9M14 20H5M15 4 9 20" /></template>
    <template v-else-if="name === 'strike'"><path d="M16 4H9a3 3 0 0 0-2.83 4" /><path d="M14 12a4 4 0 0 1 0 8H6" /><path d="M4 12h16" /></template>
    <template v-else-if="name === 'inline-code'"><path d="m16 18 6-6-6-6" /><path d="m8 6-6 6 6 6" /></template>
    <template v-else-if="name === 'code-block'"><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" /><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" /></template>
    <template v-else-if="name === 'list-ul'"><path d="M10 6h11M10 12h11M10 18h11" stroke-width="1.6" /><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" stroke-width="3" /></template>
    <template v-else-if="name === 'list-ol'"><path d="M10 6h11M10 12h11M10 18h11" stroke-width="1.6" /><path d="M4 6h1v4M4 14h2l-2 2h2" /></template>
    <template v-else-if="name === 'quote'"><path d="M10 11H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6a3 3 0 0 1-3 3" /><path d="M19 11h-4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6a3 3 0 0 1-3 3" /></template>
    <template v-else-if="name === 'link'"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></template>
    <template v-else-if="name === 'unlink'"><path d="M15 7l2-2a5 5 0 0 1 7 7l-1.5 1.5M9 17l-2 2a5 5 0 0 1-7-7L1.5 11.5" /><path d="m2 2 20 20" /></template>
    <template v-else-if="name === 'image'"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></template>
    <template v-else-if="name === 'minus'"><path d="M5 12h14" /></template>
    <template v-else-if="name === 'attach'"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></template>
    <template v-else-if="name === 'cloud'"><path d="M17.5 19a4.5 4.5 0 1 0 0-9h-1.17A7 7 0 1 0 4 15.3" /><path d="M12 13v6" /><path d="m9 16 3 3 3-3" /></template>
    <template v-else-if="name === 'eye'"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></template>
    <template v-else-if="name === 'monaco'"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 8.5h18" /><path d="m6.5 12-1.6 1.8L6.5 15.6" /><path d="M11 15.6l2-1.8-2-1.8" /></template>
    <template v-else-if="name === 'list'"><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></template>
    <template v-else-if="name === 'external'"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></template>

    <!-- 设备模式标识 -->
    <template v-else-if="name === 'monitor'"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" /></template>
    <template v-else-if="name === 'smartphone'"><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M11 18h2" /></template>
    <template v-else-if="name === 'tablet'"><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M11 18h2" /></template>
    <template v-else-if="name === 'auto-device'"><rect x="2" y="4" width="13" height="10" rx="1.6" /><path d="M6 18h5" /><path d="M8.5 14v4" /><rect x="17" y="10" width="5" height="11" rx="1.4" /></template>
    <template v-else-if="name === 'copy'"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></template>
    <template v-else-if="name === 'check'"><path d="m4 12 5.5 5.5L20 6.5" /></template>
    <template v-else-if="name === 'refresh'"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 4v5h-5" /></template>
  </svg>
</template>

<style scoped>
.appicon { flex: none; display: inline-block; vertical-align: -0.15em; }
</style>
