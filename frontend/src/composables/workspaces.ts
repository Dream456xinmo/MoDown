import { reactive } from 'vue'
import { bridge } from '../bridge'
import type { WorkspaceInfo, WorkspaceState } from '../bridge/types'

/**
 * 「工作区」对话框（安卓等支持多工作区的平台用）。
 *
 * 列表＝打开记录：本地工作区恒在、不可删；系统目录是用户用系统文件管理器选中的真实目录，
 * 可以逐条从记录里移除（只删记录，不动目录本身）。顶部一个「打开系统目录」按钮负责新增。
 */

/** 插件不可用时的兜底：只有本地工作区 */
const ONLY_LOCAL: WorkspaceState = {
  active: 'local',
  items: [{ id: 'local', kind: 'local', name: '本地工作区', removable: false, available: true }]
}

interface WorkspaceDialogState {
  /** 对话框是否可见 */
  active: boolean
  title: string
  message: string
  /** 正在与原生层交互（选目录 / 读记录），期间禁用按钮 */
  busy: boolean
  error: string
  state: WorkspaceState
}

export const workspaceDialogState = reactive<WorkspaceDialogState>({
  active: false,
  title: '打开文件夹',
  message: '',
  busy: false,
  error: '',
  state: ONLY_LOCAL
})

let finish: (picked: WorkspaceInfo | null) => void = () => {}

/** 重新拉一次打开记录 */
export async function reloadWorkspaces() {
  if (!bridge.listWorkspaces) return
  workspaceDialogState.busy = true
  workspaceDialogState.error = ''
  try {
    workspaceDialogState.state = await bridge.listWorkspaces()
  } catch (e: any) {
    workspaceDialogState.error = String(e?.message ?? e)
  } finally {
    workspaceDialogState.busy = false
  }
}

/** 打开对话框；选中某个工作区返回它，取消返回 null */
export function pickWorkspaceDialog(opts: { title?: string; message?: string } = {}): Promise<WorkspaceInfo | null> {
  return new Promise(resolve => {
    workspaceDialogState.title = opts.title ?? '打开文件夹'
    workspaceDialogState.message = opts.message ?? ''
    workspaceDialogState.error = ''
    workspaceDialogState.busy = false
    workspaceDialogState.active = true
    finish = picked => {
      workspaceDialogState.active = false
      resolve(picked)
    }
    void reloadWorkspaces()
  })
}

/** 结束对话框（picked 为 null 表示取消） */
export function workspaceDialogDone(picked: WorkspaceInfo | null) {
  const fn = finish
  finish = () => {}
  fn(picked)
}

/** 弹系统文件管理器选一个新目录；选到就直接以它为结果结束对话框 */
export async function pickSystemDir() {
  if (!bridge.pickWorkspace) return
  workspaceDialogState.busy = true
  workspaceDialogState.error = ''
  try {
    const ws = await bridge.pickWorkspace()
    if (ws) workspaceDialogDone(ws)
  } catch (e: any) {
    workspaceDialogState.error = String(e?.message ?? e)
  } finally {
    workspaceDialogState.busy = false
  }
}

/** 从记录里移除一个系统目录（本地工作区会被原生层拒绝） */
export async function forgetWorkspace(id: string) {
  if (!bridge.forgetWorkspace) return
  workspaceDialogState.busy = true
  workspaceDialogState.error = ''
  try {
    workspaceDialogState.state = await bridge.forgetWorkspace(id)
  } catch (e: any) {
    workspaceDialogState.error = String(e?.message ?? e)
  } finally {
    workspaceDialogState.busy = false
  }
}
