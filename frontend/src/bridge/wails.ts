import type { CopyResult, OpenTarget, PlatformBridge, TreeNode } from './types'

/** 与 desktop/openfile.go 的 OpenExternalEvent 保持一致 */
const OPEN_EXTERNAL_EVENT = 'xmd:open-external'

/**
 * Wails 桥（v2 / v3 通用签名约定）：
 * Go 端需在 main.App 上暴露同名方法（PascalCase）：
 *   GetTree / OpenFolder / ReadFile / WriteFile / CreateFile / CreateDir /
 *   Rename / Remove / ImportImage / SaveAs / GetSetting / SetSetting /
 *   ReadAssetDataURL / OpenExternal / TakePendingOpen / CopyInto
 */
function app() {
  const a = window.go?.main?.App
  if (!a) throw new Error('Wails 绑定未注入 (window.go.main.App)')
  return a
}

export const wailsBridge: PlatformBridge = {
  platform: 'wails',
  // 桌面直接用系统目录选择框切工作区，没有「打开记录列表」这套交互
  supportsWorkspaces: false,

  async getTree() {
    return (await app().GetTree()) as TreeNode[]
  },
  async openFolder() {
    return (await app().OpenFolder()) as string | null
  },
  async readFile(path) {
    return app().ReadFile(path) as Promise<string>
  },
  async writeFile(path, content) {
    await app().WriteFile(path, content)
  },
  async createFile(path) {
    await app().CreateFile(path)
  },
  async createDir(path) {
    await app().CreateDir(path)
  },
  async rename(oldPath, newPath) {
    await app().Rename(oldPath, newPath)
  },
  async remove(path) {
    await app().Remove(path)
  },
  async importImage(name, dataUrl) {
    return app().ImportImage(name, dataUrl) as Promise<string>
  },
  async importFile() {
    const p = await app().ImportFile()
    return (p || null) as string | null
  },
  async copyInto(paths, dir) {
    // Go 侧按"复制、重名让路"处理；返回 { copied, errors }
    const r = (await app().CopyInto(paths, dir)) as CopyResult | null
    return { copied: r?.copied || [], errors: r?.errors || [] }
  },
  async importAsset(folder) {
    const p = await app().ImportAsset(folder)
    return (p || null) as string | null
  },
  async importAssetRaw(name, dataUrl, folder) {
    return app().ImportAssetRaw(name, dataUrl, folder) as Promise<string>
  },
  async saveAs(fileName, content, mime) {
    // Go 端弹窗并写文件：返回 ''＝用户取消或关闭了对话框
    const path = (await app().SaveAs(fileName, content, mime)) as string
    return path || ''
  },
  async exportPdfDirect(fileName, html) {
    return app().ExportPdfDirect(fileName, html) as Promise<string>
  },
  async exportPdfPandoc(fileName, markdown, pandocPath) {
    return app().ExportPdfPandoc(fileName, markdown, pandocPath) as Promise<string>
  },
  async exportDocxPandoc(fileName, markdown, pandocPath) {
    return app().ExportDocxPandoc(fileName, markdown, pandocPath) as Promise<string>
  },
  async openPath(path) {
    await app().OpenPath(path)
  },
  async openUrl(url) {
    // 桌面用 Wails 运行时开系统浏览器；没有 runtime（异常环境）时退回 window.open
    if (window.runtime?.BrowserOpenURL) {
      window.runtime.BrowserOpenURL(url)
      return
    }
    window.open(url, '_blank', 'noopener')
  },
  assetUrl(path) {
    return '/raw' + path
  },
  async getSetting(key) {
    return (await app().GetSetting(key)) as string | null
  },
  async setSetting(key, value) {
    await app().SetSetting(key, value)
  },
  async setUnsaved(unsaved) {
    await app().SetUnsaved(unsaved)
  },
  async getSettings() {
    return (await app().GetSettings()) as Record<string, string>
  },
  async pickFile(title) {
    return ((await app().PickFile(title)) as string) || null
  },
  async pickPandoc() {
    return ((await app().PickPandoc()) as string) || null
  },
  async validatePandoc(path) {
    return (await app().ValidatePandoc(path)) as string
  },
  async openInVSCode(path) {
    await app().OpenInVSCode(path)
  },
  async readFileEnc(path, encoding) {
    return (await app().ReadFileEnc(path, encoding)) as { content: string; encoding: string }
  },
  async writeFileEnc(path, content, encoding) {
    await app().WriteFileEnc(path, content, encoding)
  },
  async readFileExternal(path) {
    return (await app().ReadFileAbs(path)) as string
  },
  async writeFileExternal(path, content) {
    await app().WriteFileAbs(path, content)
  },
  async adoptExternalFile(path) {
    await app().AdoptExternalFile(path)
  },

  async openExternal(path) {
    return (await app().OpenExternal(path)) as OpenTarget | null
  },

  async takePendingOpen() {
    return (await app().TakePendingOpen()) as OpenTarget | null
  },

  onOpenExternal(handler) {
    // Go 侧 EventsEmit('xmd:open-external', 绝对路径)
    window.runtime?.EventsOn?.(OPEN_EXTERNAL_EVENT, (path: string) => handler(path))
  },

  onFileDrop(handler) {
    // useDropTarget=false：整个窗口接收拖拽；Wails 传的是文件绝对路径 + 落下时的坐标
    // （Wails 的 desktop 运行时代码直接用 MouseEvent.x/y，所以是视口 CSS 像素，能喂给 elementFromPoint）
    window.runtime?.OnFileDrop?.(
      (x: number, y: number, paths: string[]) => handler(paths || [], x || 0, y || 0),
      false
    )
  },

  async readAssetDataUrl(path) {
    return ((await app().ReadAssetDataURL(path)) as string) || ''
  }
}
