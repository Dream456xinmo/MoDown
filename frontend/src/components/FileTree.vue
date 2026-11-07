<script setup lang="ts">
import { onBeforeUnmount, provide, ref, type Ref } from 'vue'
import { useWorkspace } from '../stores/workspace'
import type { TreeNode } from '../bridge/types'
import { uiConfirm, uiPrompt } from '../composables/dialogs'
import { INLINE_STATE_KEY, INLINE_ACTIONS_KEY, type InlineCreate } from '../composables/treeCreate'
import { dropDir } from '../composables/treeDrop'
import {
  armMenuSuppression,
  classifyContextMenu,
  menuSuppressed,
  noteMenuClosed,
  noteMenuOpened,
  useLongPress
} from '../composables/longpress'
import IconSvg from './IconSvg.vue'
import TreeItem from './TreeItem.vue'
import InlineCreateInput from './InlineCreateInput.vue'

const ws = useWorkspace()
/** node=null 表示空白处（根级）长按/右键，仅提供新建 */
const menu = ref<{ x: number; y: number; node: TreeNode | null } | null>(null)

/* ---------- VSCode 风格内联新建 ---------- */
const inline = ref<InlineCreate | null>(null)
provide(INLINE_STATE_KEY, inline as Ref<InlineCreate | null>)
provide(INLINE_ACTIONS_KEY, {
  confirm: confirmInline,
  cancel: () => (inline.value = null)
})

function startInline(kind: 'file' | 'dir', parent: string) {
  menu.value = null
  inline.value = { kind, parent, value: kind === 'dir' ? '新建文件夹' : '未命名.md' }
}

function confirmInline() {
  const s = inline.value
  if (!s) return
  const name = s.value.trim().replace(/[/\\]+$/, '')
  inline.value = null
  if (!name) return
  const path = (s.parent ? s.parent + '/' : '/') + name
  if (s.kind === 'dir') void ws.newFolder(path)
  else void ws.newFile(path)
}

/** 文件所在目录（同级新建用） */
function dirname(node: TreeNode): string {
  if (node.isDir) return node.path
  return node.path.slice(0, node.path.lastIndexOf('/'))
}

/** 菜单尺寸估算：手机约 170x220，防止贴边溢出屏幕 */
function clampPos(x: number, y: number) {
  const w = 172
  const h = 218
  return {
    x: Math.max(6, Math.min(x, window.innerWidth - w - 6)),
    y: Math.max(6, Math.min(y, window.innerHeight - h - 6))
  }
}

function openMenu(node: TreeNode | null, x: number, y: number) {
  menu.value = { ...clampPos(x, y), node }
  noteMenuOpened()
  // 关掉菜单的那一下点击只是用来关闭它，不该顺手打开某个文件
  armMenuSuppression()
}

function onMenu(node: TreeNode, x: number, y: number, _source: 'touch' | 'mouse') {
  openMenu(node, x, y)
}

/**
 * 外部点击 / 滚动导致的关闭。
 * 长按抬手后浏览器还会补发一次 click（冒泡到 .file-tree），这一下会把刚弹出的菜单立即关掉；
 * longpress.ts 的抑制窗在 touchend 处重新计时（TAP_SUPPRESS_MS），这里再挡一道：
 * 抑制窗内的点击是同一次手势的尾巴，不算「点空白关闭菜单」。
 */
function close() {
  if (menuSuppressed()) return
  closeMenu()
}
/** 菜单项动作里的强制关闭 */
function closeMenu() {
  menu.value = null
  noteMenuClosed()
  armMenuSuppression()
}

/**
 * 桌面空白处右键：弹出根级新建菜单；行上的右键由 TreeItem 自己处理。
 * 触摸尾巴里的第一次 contextmenu 当长按处理（见 TreeItem 的同名处理），
 * 重复的、以及菜单刚关掉后晚到的尾巴一律 ignore。
 */
function onRootContext(e: MouseEvent) {
  const kind = classifyContextMenu(e)
  if (kind === 'ignore') return
  if (kind === 'mouse') e.preventDefault()
  else blankLp.claim()
  // 行上的 contextmenu 由 TreeItem 自己弹（事件还会冒泡到这里，且上面 kind 已变成 ignore）
  if ((e.target as HTMLElement).closest('.tree-row')) return
  openMenu(null, e.clientX, e.clientY)
}

/* 空白处长按 = 根级新建菜单（触屏）；计时/容差/触控记账统一走 useLongPress */
const blankLp = useLongPress((p) => {
  navigator.vibrate?.(15)
  openMenu(null, p.x, p.y)
})
function onRootTouchStart(e: TouchEvent) {
  const el = e.target as HTMLElement
  // 行 / 菜单 / 工具栏 / 遮罩都不算「空白处」：遮罩尤其重要——它盖满全屏，
  // 若把它算进来，在遮罩上按住 400ms 就会把根级菜单又弹一次
  if (el.closest('.tree-row') || el.closest('.ctx-menu') || el.closest('.tree-toolbar') || el.closest('.ctx-mask'))
    return
  if (e.touches.length !== 1) {
    blankLp.stop()
    return
  }
  const t = e.touches[0]
  blankLp.arm(t.clientX, t.clientY)
}
/** 手指移动超过容差才算滚动，轻微抖动不取消长按 */
function onRootTouchMove(e: TouchEvent) {
  const t = e.touches[0]
  if (t) blankLp.move(t.clientX, t.clientY)
}
/**
 * 抬手也要刷新触控时间：安卓的 contextmenu 经常迟于 touchend 到达。
 * 空白处长按成立时同样要吃掉落下来的 click（否则 `.file-tree` 的 click 会立刻关掉菜单）。
 */
function onRootTouchEnd(e: TouchEvent) {
  const fired = blankLp.didFire()
  blankLp.stop()
  if (fired) e.preventDefault()
}
onBeforeUnmount(() => blankLp.stop())

/* ---------- 刷新文件树 ----------
   系统目录是真实目录：别的 App 拍照、下载、同步盘改了文件后列表不会自己变，
   所以给一个手动刷新的入口（展开状态是 TreeItem 自己的，按 path 复用不会丢）。 */
const refreshing = ref(false)
async function doRefresh() {
  if (refreshing.value) return
  refreshing.value = true
  ws.lastError = ''
  try {
    await ws.refreshTree()
    // 失败时 refreshTree 已写 lastError，红色 toast 会自己出现，这里不再补提示
    if (!ws.lastError) ws.notifyOk('文件列表已刷新')
  } finally {
    refreshing.value = false
  }
}

async function doRename() {
  if (!menu.value?.node) return
  const { node } = menu.value
  closeMenu()
  const name = await uiPrompt({ title: '重命名', message: node.path, defaultValue: node.name })
  if (name && name !== node.name) await ws.renameNode(node, name)
}

async function doDelete() {
  if (!menu.value?.node) return
  const { node } = menu.value
  closeMenu()
  const ok = await uiConfirm({
    title: '删除',
    message: `确认删除 ${node.path}？${node.isDir ? '（包含其下所有内容）' : ''}此操作不可撤销。`,
    okText: '删除'
  })
  if (ok) await ws.removeNode(node)
}

async function doOpen() {
  closeMenu()
  await ws.openFolder()
}

function openNode(node: TreeNode | null) {
  if (node && !node.isDir) void ws.openFile(node.path)
  closeMenu()
}
/** 在节点所在目录（或根级）新建；node 为 null 表示空白处 */
function createAt(kind: 'file' | 'dir', node: TreeNode | null) {
  startInline(kind, node ? dirname(node) : '')
}
</script>

<template>
  <div
    class="file-tree"
    :class="{ 'drop-target': dropDir === '' }"
    @click="close"
    @contextmenu="onRootContext"
    @touchstart="onRootTouchStart"
    @touchmove="onRootTouchMove"
    @touchend="onRootTouchEnd"
    @touchcancel="onRootTouchEnd"
  >
    <div class="tree-toolbar">
      <button @click.stop="startInline('file', '')" title="新建文件"><IconSvg name="file-plus" :size="16" /></button>
      <button @click.stop="startInline('dir', '')" title="新建文件夹"><IconSvg name="folder-plus" :size="16" /></button>
      <button @click.stop="ws.importFile()" title="导入文件（保留原始后缀）"><IconSvg name="import" :size="16" /></button>
      <button @click.stop="doOpen" title="打开文件夹作为工作区"><IconSvg name="folder-open" :size="16" /></button>
      <button @click.stop="doRefresh" :disabled="refreshing" title="刷新文件树（别的 App 改了目录里的文件时用）">
        <IconSvg name="refresh" :size="16" :class="{ spinning: refreshing }" />
      </button>
    </div>

    <!-- 根级内联新建输入 -->
    <InlineCreateInput v-if="inline && inline.parent === ''" :depth="0" />

    <TreeItem v-for="n in ws.tree" :key="n.path" :node="n" @menu="onMenu" />

    <!-- 透明遮罩：点击菜单外任意处（含编辑器/其他面板）即关闭右键菜单 -->
    <div
      v-if="menu"
      class="ctx-mask"
      @click="close"
      @contextmenu.prevent="close"
      @wheel="close"
      @touchstart="closeMenu()"
    ></div>
    <div
      v-if="menu"
      class="ctx-menu"
      :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
      @click.stop
      @touchstart.stop
    >
      <div class="dd-item" v-if="menu.node && !menu.node.isDir" @click="openNode(menu.node)">打开</div>
      <div class="dd-item" @click="createAt('file', menu.node)">新建文件</div>
      <div class="dd-item" @click="createAt('dir', menu.node)">新建文件夹</div>
      <template v-if="menu.node">
        <div class="dd-item" @click="doRename">重命名</div>
        <div class="dd-item danger" @click="doDelete">删除</div>
      </template>
    </div>
  </div>
</template>
