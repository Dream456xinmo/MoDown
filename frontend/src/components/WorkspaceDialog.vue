<script setup lang="ts">
import { computed } from 'vue'
import { bridge } from '../bridge'
import {
  workspaceDialogState as st,
  workspaceDialogDone,
  pickSystemDir,
  forgetWorkspace
} from '../composables/workspaces'
import { uiConfirm } from '../composables/dialogs'
import type { WorkspaceInfo } from '../bridge/types'
import IconSvg from './IconSvg.vue'

/**
 * 工作区对话框（安卓等支持多工作区的平台）。
 * 列表＝打开记录：本地工作区恒在、不可删；系统目录可逐条移除（只删记录）。
 */
const canPick = computed(() => !!bridge.supportsWorkspaces && !!bridge.pickWorkspace)

async function choose(item: WorkspaceInfo) {
  if (st.busy) return
  // 授权失效的系统目录不能切过去，改为引导用户清理记录
  if (item.kind === 'system' && item.available === false) {
    const ok = await uiConfirm({
      title: '目录不可用',
      message: `「${item.name}」的访问授权已失效，或目录已被移动/删除。是否把它从打开记录中移除？`,
      okText: '移除记录'
    })
    if (ok) await forgetWorkspace(item.id)
    return
  }
  workspaceDialogDone(item)
}

async function removeItem(item: WorkspaceInfo, ev: Event) {
  ev.stopPropagation()
  if (st.busy || !item.removable) return
  const ok = await uiConfirm({
    title: '移除记录',
    message: `把「${item.name}」从打开记录中移除？（只删记录，不会删除目录和里面的文件）`,
    okText: '移除'
  })
  if (ok) await forgetWorkspace(item.id)
}
</script>

<template>
  <div v-if="st.active" class="dialog-mask" @click="workspaceDialogDone(null)">
    <div class="dialog app-dialog ws-dialog" @click.stop>
      <div class="app-dialog-head">
        <span class="app-dialog-title">{{ st.title }}</span>
        <button class="app-dialog-x" @click="workspaceDialogDone(null)"><IconSvg name="x" :size="14" /></button>
      </div>
      <p class="app-dialog-msg">
        {{ st.message || '选择一个工作区；「打开系统目录」会用系统文件管理器浏览设备上的目录。' }}
      </p>

      <div class="ws-list">
        <div
          v-for="item in st.state.items"
          :key="item.id"
          class="ws-item"
          :class="{
            on: item.id === st.state.active,
            dead: item.kind === 'system' && item.available === false
          }"
          :title="item.uri || item.name"
          @click="choose(item)"
        >
          <IconSvg :name="item.kind === 'local' ? 'folder' : 'folder-open'" :size="16" />
          <span class="ws-name">{{ item.name }}</span>
          <span v-if="item.kind === 'local'" class="ws-tag">默认</span>
          <span v-else-if="item.available === false" class="ws-tag bad">失效</span>
          <button
            v-if="item.removable"
            class="ws-del"
            title="从打开记录中移除"
            :disabled="st.busy"
            @click="removeItem(item, $event)"
          >
            <IconSvg name="x" :size="12" />
          </button>
        </div>
      </div>

      <p v-if="st.error" class="ws-err">{{ st.error }}</p>

      <div class="footer">
        <button @click="workspaceDialogDone(null)">取消</button>
        <button class="primary" :disabled="st.busy || !canPick" @click="pickSystemDir">打开系统目录</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ws-dialog {
  width: min(440px, 92vw);
}
.ws-list {
  max-height: 46vh;
  min-height: 96px;
  overflow-y: auto;
  border: 1px solid var(--border, #ddd);
  border-radius: 6px;
  padding: 4px;
}
.ws-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
}
.ws-item:hover {
  background: var(--bg-hover, rgba(128, 128, 128, 0.14));
}
.ws-item.on {
  background: var(--bg-active, rgba(128, 128, 128, 0.2));
  font-weight: 600;
}
.ws-item.dead {
  opacity: 0.55;
}
.ws-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ws-tag {
  flex: none;
  font-size: 11px;
  font-weight: 400;
  padding: 1px 6px;
  border-radius: 8px;
  color: var(--fg-dim);
  border: 1px solid var(--border, #ddd);
}
.ws-tag.bad {
  color: #d9534f;
  border-color: #d9534f;
}
.ws-del {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  color: var(--fg-dim);
}
.ws-del:hover {
  color: var(--fg);
}
.ws-err {
  margin: 8px 0 0;
  font-size: 12px;
  color: #d9534f;
  word-break: break-all;
}
</style>
