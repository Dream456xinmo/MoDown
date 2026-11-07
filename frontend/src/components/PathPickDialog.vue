<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useWorkspace } from '../stores/workspace'
import { pathPickState, pathPickDone } from '../composables/pickers'
import { uiPrompt } from '../composables/dialogs'
import type { TreeNode } from '../bridge/types'
import IconSvg from './IconSvg.vue'

/**
 * 工作区内路径选择对话框：
 * folder 模式＝选一个文件夹作为工作区（手机版「打开文件夹」）
 * save  模式＝选目录 + 文件名（手机版「保存 / 导出」的保存位置）
 */
const ws = useWorkspace()
/** 正在浏览的目录（'' 表示工作区根） */
const dir = ref('')
const fileName = ref('')

watch(
  () => pathPickState.active,
  open => {
    if (open) {
      dir.value = ''
      fileName.value = pathPickState.fileName
    }
  }
)

function findDir(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (!n.isDir) continue
    if (n.path === path) return n
    const hit = n.children ? findDir(n.children, path) : null
    if (hit) return hit
  }
  return null
}

/** 当前目录下的子文件夹（新建文件夹用的 .keep 占位不显示） */
const folders = computed(() => {
  const list = dir.value ? findDir(ws.tree, dir.value)?.children || [] : ws.tree
  return list.filter(n => n.isDir && !n.path.endsWith('/.keep'))
})

/** 面包屑：工作区根 / a / b */
const crumbs = computed(() => {
  const out: { path: string; label: string }[] = [{ path: '', label: '工作区根目录' }]
  const parts = dir.value.split('/').filter(Boolean)
  let acc = ''
  for (const p of parts) {
    acc += `/${p}`
    out.push({ path: acc, label: p })
  }
  return out
})

function up() {
  const i = dir.value.lastIndexOf('/')
  dir.value = i <= 0 ? '' : dir.value.slice(0, i)
}

async function newFolder() {
  const raw = await uiPrompt({
    title: '新建文件夹',
    message: '在当前目录下新建文件夹',
    defaultValue: '新文件夹'
  })
  if (!raw) return
  const name = String(raw).replace(/[\\/:*?"<>|]/g, '_').trim()
  if (!name) return
  await ws.newFolder(`${dir.value}/${name}`)
}

function confirm() {
  if (pathPickState.mode === 'folder') {
    // 空目录 = 整个工作区
    pathPickDone(dir.value || '/')
    return
  }
  const name = fileName.value.replace(/[\\/:*?"<>|]/g, '_').trim()
  if (!name) return
  pathPickDone(`${dir.value}/${name}`)
}

const okText = computed(() => (pathPickState.mode === 'folder' ? '打开' : '保存'))
</script>

<template>
  <div class="dialog-mask" v-if="pathPickState.active" @click="pathPickDone(null)">
    <div class="dialog app-dialog path-pick" @click.stop>
      <div class="app-dialog-head">
        <span class="app-dialog-title">{{ pathPickState.title }}</span>
        <button class="app-dialog-x" @click="pathPickDone(null)"><IconSvg name="x" :size="14" /></button>
      </div>
      <p v-if="pathPickState.message" class="app-dialog-msg">{{ pathPickState.message }}</p>

      <div class="pp-bar">
        <button class="pp-nav" :disabled="!dir" title="返回上级" @click="up">
          <IconSvg name="chevron-left" :size="15" />
        </button>
        <span class="pp-path" :title="dir || '/'">{{ dir || '/' }}</span>
        <button class="pp-new" title="新建文件夹" @click="newFolder">
          <IconSvg name="folder-plus" :size="15" />
        </button>
      </div>

      <div class="pp-list">
        <div
          v-for="c in crumbs"
          :key="c.path"
          class="pp-crumb"
          :class="{ on: c.path === dir }"
          @click="dir = c.path"
        >
          <IconSvg name="folder" :size="14" />
          <span>{{ c.label }}</span>
        </div>
        <div v-if="!folders.length" class="pp-empty">（这个目录里没有子文件夹）</div>
        <div v-for="f in folders" :key="f.path" class="pp-item" @click="dir = f.path">
          <IconSvg name="folder-open" :size="15" />
          <span>{{ f.name }}</span>
        </div>
      </div>

      <input
        v-if="pathPickState.mode === 'save'"
        v-model="fileName"
        class="pp-name"
        placeholder="文件名"
        @keyup.enter="confirm"
      />

      <div class="footer">
        <button @click="pathPickDone(null)">取消</button>
        <button class="primary" @click="confirm">{{ okText }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.path-pick {
  width: min(420px, 92vw);
}
.pp-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.pp-nav,
.pp-new {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
}
.pp-nav:disabled {
  opacity: 0.4;
}
.pp-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  opacity: 0.8;
}
.pp-list {
  max-height: 40vh;
  min-height: 90px;
  overflow-y: auto;
  border: 1px solid var(--border, #ddd);
  border-radius: 6px;
  padding: 4px;
  margin-bottom: 8px;
}
.pp-crumb,
.pp-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}
.pp-crumb {
  opacity: 0.7;
}
.pp-crumb.on {
  opacity: 1;
  font-weight: 600;
}
.pp-item:hover,
.pp-crumb:hover {
  background: var(--hover, rgba(128, 128, 128, 0.14));
}
.pp-empty {
  padding: 10px 8px;
  font-size: 12px;
  opacity: 0.6;
}
.pp-name {
  width: 100%;
  margin-bottom: 8px;
}
</style>
