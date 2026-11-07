/**
 * PC 桌面快捷键动作（Ctrl/Cmd + S / N / O 等），供富文本、源码、Monaco 与全局键盘统一调用
 */
import { useWorkspace } from '../stores/workspace'

function errText(e: unknown): string {
  const s = String((e as any)?.message ?? e).split('\n')[0]
  return s.length > 90 ? s.slice(0, 90) + '…' : s
}

/** Ctrl/Cmd + S：保存当前文件（无关联文件时让用户选保存位置） */
export async function saveCurrent(): Promise<void> {
  const ws = useWorkspace()
  if (ws.settings.editorMode === 'preview') {
    ws.notify('预览模式不可编辑，切换回编辑模式后再保存')
    return
  }
  ws.beginBusy('save', '保存中')
  try {
    // 原本没有关联文件时，ws.save() 会先让用户选保存位置；
    // 取消或选位置成功的提示都由 save() 给出，这里不再重复。
    const hadPath = !!ws.currentPath
    const saved = await ws.save()
    if (!saved || !hadPath) return
    ws.notifyOk(`已保存 ${ws.fileTitle}`)
  } catch (e) {
    ws.notifyFail(`保存失败：${errText(e)}`)
  } finally {
    ws.endBusy()
  }
}

/** Ctrl/Cmd + O：打开文件夹 */
export async function openFolderShortcut(): Promise<void> {
  const ws = useWorkspace()
  try {
    await ws.openFolder()
  } catch (e) {
    ws.notifyFail(`打开文件夹失败：${errText(e)}`)
  }
}
