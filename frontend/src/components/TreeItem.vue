<script setup lang="ts">
import { ref, computed, inject, watch, onBeforeUnmount, onMounted, type Ref } from 'vue'
import { useWorkspace } from '../stores/workspace'
import type { TreeNode } from '../bridge/types'
import { INLINE_STATE_KEY, type InlineCreate } from '../composables/treeCreate'
import { dropDir } from '../composables/treeDrop'
import { classifyContextMenu, menuSuppressed, useLongPress } from '../composables/longpress'
import IconSvg from './IconSvg.vue'
import InlineCreateInput from './InlineCreateInput.vue'

defineOptions({ name: 'TreeItem' })
const props = defineProps<{ node: TreeNode; depth?: number }>()
const emit = defineEmits<{
  (e: 'menu', node: TreeNode, x: number, y: number, source: 'touch' | 'mouse'): void
}>()

const ws = useWorkspace()
const expanded = ref(false)

/* 内联新建目标为本目录时自动展开 */
const inline = inject<Ref<InlineCreate | null> | null>(INLINE_STATE_KEY, null)
watch(
  () => inline?.value?.parent,
  p => {
    if (p !== null && p !== undefined && p === props.node.path && props.node.isDir) expanded.value = true
  },
  { immediate: true }
)

function toggle() {
  if (props.node.isDir) {
    expanded.value = !expanded.value
  } else {
    ws.openFile(props.node.path)
  }
}

/* 按扩展名选择文件图标与颜色 */
const fileIcon = computed(() => {
  const ext = props.node.name.split('.').pop()?.toLowerCase() || ''
  if (['md', 'markdown'].includes(ext)) return { icon: 'file-md', color: 'var(--accent)' }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext))
    return { icon: 'file-image', color: '#16a34a' }
  if (['js', 'ts', 'mts', 'jsx', 'tsx', 'vue', 'go', 'py', 'rs', 'java', 'c', 'cpp', 'h', 'css', 'scss', 'less', 'html', 'json', 'yaml', 'yml', 'toml', 'sh', 'ps1', 'bat'].includes(ext))
    return { icon: 'file-code', color: '#0891b2' }
  if (ext === 'pdf') return { icon: 'file-pdf', color: '#dc2626' }
  return { icon: 'file', color: 'var(--fg-dim)' }
})

/* ---------- 长按（手机 / 平板）/ 右键（桌面） ----------
   计时、抖动容差、手势尾巴的抑制全部交给 composables/longpress.ts，与空白处长按共用一套判定 */
const lp = useLongPress((p) => {
  navigator.vibrate?.(15)
  emit('menu', props.node, p.x, p.y, 'touch')
})

function onTouchStart(e: TouchEvent) {
  if (e.touches.length !== 1) {
    lp.stop()
    return
  }
  const t = e.touches[0]
  lp.arm(t.clientX, t.clientY)
}
function onTouchMove(e: TouchEvent) {
  const t = e.touches[0]
  if (t) lp.move(t.clientX, t.clientY)
}
/** 长按抬手：吃掉随后派生的 click，否则冒泡到 .file-tree 会立刻把菜单关掉 */
function onTouchEnd(e: TouchEvent) {
  const fired = lp.didFire()
  lp.stop()
  if (fired) e.preventDefault()
}
function cancelPress() {
  lp.stop()
}
/** 长按后的 click、以及关掉菜单的那一下，都不触发打开/折叠 */
function onTap() {
  if (menuSuppressed()) return
  toggle()
}
/**
 * 桌面右键 + 安卓长按的 contextmenu 兜底。
 * 触摸尾巴里的第一次 contextmenu 当长按处理（系统的长按会 touchcancel 掉我们的计时器，
 * 这时它是唯一的信号）；重复的、以及菜单刚关掉后晚到的尾巴一律 ignore。
 */
function onContext(e: MouseEvent) {
  const kind = classifyContextMenu(e)
  if (kind === 'ignore') return
  if (kind === 'mouse') e.preventDefault()
  else lp.claim()
  emit('menu', props.node, e.clientX, e.clientY, kind === 'touch' ? 'touch' : 'mouse')
}

/** 窗口失焦时残留的手势不该继续算长按 */
function disarm() {
  lp.stop()
}
onMounted(() => window.addEventListener('blur', disarm))
onBeforeUnmount(() => window.removeEventListener('blur', disarm))
</script>

<template>
  <div class="tree-node">
    <div
      class="tree-row"
      :class="{
        active: !node.isDir && node.path === ws.currentPath,
        'drop-target': node.isDir && dropDir === node.path
      }"
      :data-path="node.path"
      :data-dir="node.isDir ? '1' : '0'"
      :style="{ paddingLeft: (depth || 0) * 14 + 8 + 'px' }"
      @click="onTap"
      @contextmenu="onContext"
      @touchstart="onTouchStart"
      @touchend="onTouchEnd"
      @touchmove="onTouchMove"
      @touchcancel="cancelPress"
    >
      <!-- 展开/缩放 chevron（仅目录占位，保证对齐） -->
      <span class="twisty" :class="{ open: node.isDir && expanded }">
        <IconSvg v-if="node.isDir" :name="expanded ? 'chevron-down' : 'chevron-right'" :size="13" />
      </span>
      <IconSvg
        :name="node.isDir ? (expanded ? 'folder-open' : 'folder') : fileIcon.icon"
        :size="15"
        :color="node.isDir ? '#d9a441' : fileIcon.color"
        class="node-icon"
      />
      <span class="label">{{ node.name }}</span>
      <!-- 每个文件单独打点：切走后未保存的改动仍然保留，也和 VSCode 一样一眼能看见 -->
      <span
        v-if="!node.isDir && ws.isDirtyPath(node.path)"
        class="dirty-dot"
        :title="node.path === ws.currentPath ? '未保存更改' : '有未保存的草稿'"
      ></span>
    </div>
    <template v-if="node.isDir && expanded">
      <TreeItem
        v-for="c in node.children"
        :key="c.path"
        :node="c"
        :depth="(depth || 0) + 1"
        @menu="(n, x, y, s) => emit('menu', n, x, y, s)"
      />
      <!-- 目录内联新建输入 -->
      <InlineCreateInput v-if="inline && inline.parent === node.path" :depth="(depth || 0) + 1" />
    </template>
  </div>
</template>
