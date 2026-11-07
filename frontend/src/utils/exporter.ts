import { bridge } from '../bridge'
import { useWorkspace } from '../stores/workspace'
import { isNativeShell } from './device'
import { renderMarkdown } from './mdWorker'
import { buildStandaloneHtml } from './standalone'
import { inlineLocalImages, normalizeMediaLinks } from './exportAssets'

/** 提取错误首行，用于轻提示 */
function errText(e: unknown): string {
  const s = String((e as any)?.message ?? e).split('\n')[0]
  return s.length > 90 ? s.slice(0, 90) + '…' : s
}

export interface ExportOpts {
  mdTheme: string
  /** HTML 导出附带右侧悬浮大纲（PDF 书签 / Word 导航窗格始终自动生成） */
  outline: boolean
  /** DOC 引擎：'html' 全平台 / 'pandoc' 仅桌面（原生 docx） */
  docEngine?: 'html' | 'pandoc'
  /** PDF 引擎：'browser' 无头浏览器直出（默认） / 'pandoc' 需 xelatex，仅桌面 */
  pdfEngine?: 'browser' | 'pandoc'
  pandocPath?: string
}

/** 导出结果：保存后的路径；''＝用户取消（调用方必须区分，不能报成功）；'print'＝已调起系统打印 */
export type ExportedPath = string

/**
 * 渲染正文 → 内联本地图片 → 组装独立 HTML。
 * HTML / DOC(html 引擎) / PDF(浏览器引擎) 三条路都从这里出，图片因而在三种产物里都不会丢。
 */
async function renderExportBody(
  title: string,
  content: string,
  opts: ExportOpts,
  o: { outline: boolean; tocMode: 'float' | 'none'; copy?: boolean }
): Promise<string> {
  const ws = useWorkspace()
  const body = await renderMarkdown(content, o.outline)
  const { html: bodyHtml, failed } = await inlineLocalImages(body, ws.currentPath)
  if (failed > 0) {
    ws.notify(`有 ${failed} 张图片没能内联（文件可能已被删除），导出结果里仍是原路径`)
  }
  return await buildStandaloneHtml(title, bodyHtml, content, {
    mdTheme: opts.mdTheme,
    tocMode: o.tocMode,
    copy: o.copy,
    // 主题只选基础风格，导出时按当前应用主题自动套深/浅色
    dark: ws.resolvedTheme === 'dark'
  })
}

export async function exportMarkdown(path: string, content: string): Promise<ExportedPath> {
  const name = path.split('/').pop() || 'document.md'
  return await bridge.saveAs(name, content, 'text/markdown;charset=utf-8')
}

export async function exportHtml(title: string, content: string, opts: ExportOpts): Promise<ExportedPath> {
  const html = await renderExportBody(title, content, opts, {
    outline: true,
    tocMode: opts.outline ? 'float' : 'none',
    copy: true
  })
  return await bridge.saveAs(`${safeName(title)}.html`, html, 'text/html;charset=utf-8')
}

/**
 * 导出 Word（大纲由 Word/WPS 导航窗格按标题样式识别，不放可见目录）：
 * - pandoc 引擎（桌面）：生成真正的 .docx（标准 Heading 样式）
 * - html 引擎（全平台）：Word 可直接打开的 HTML 封装 .doc（h1–h6 映射大纲级别）
 */
/** Word 可直接打开的 HTML 封装 .doc（全平台兜底，不需任何外部程序） */
async function exportDocAsHtml(title: string, content: string, opts: ExportOpts): Promise<ExportedPath> {
  const html = await renderExportBody(title, content, opts, { outline: false, tocMode: 'none' })
  const wrapped = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"></head><body>${html}</body></html>`
  return await bridge.saveAs(`${safeName(title)}.doc`, wrapped, 'application/msword')
}

export async function exportDoc(title: string, content: string, opts: ExportOpts): Promise<ExportedPath> {
  const ws = useWorkspace()
  if (opts.docEngine === 'pandoc') {
    try {
      // 返回 ''＝在「另存为」里取消：直接结束，不能再弹第二次保存框
      return await bridge.exportDocxPandoc(safeName(title), normalizeMediaLinks(content, ws.currentPath), opts.pandocPath || '')
    } catch (e) {
      // pandoc 路径无效 / 调用失败：回退 HTML 封装的 .doc，保证导出不中断
      ws.notify(`Pandoc 导出 docx 失败（${errText(e)}），已改用 HTML 封装的 .doc`)
    }
  }
  return exportDocAsHtml(title, content, opts)
}

/**
 * 导出 DOCX（真正的 Office Open XML）：
 * 目前没有内置的纯 JS docx 生成器，桌面端走 Pandoc（标准 Heading 样式，Word/WPS 导航窗格可用）；
 * Pandoc 不存在或非桌面平台时，回退 Word 兼容的 .doc，并明确提示用户可另存为 .docx。
 */
export async function exportDocx(title: string, content: string, opts: ExportOpts): Promise<ExportedPath> {
  const ws = useWorkspace()
  if (bridge.platform === 'wails') {
    try {
      return await bridge.exportDocxPandoc(
        safeName(title),
        normalizeMediaLinks(content, ws.currentPath),
        opts.pandocPath || ''
      )
    } catch (e) {
      ws.notify(`Pandoc 不可用（${errText(e)}），已改用 Word 兼容的 .doc；可在 Word/WPS 中「另存为 .docx」`)
    }
  } else {
    ws.notify('当前平台没有 DOCX 生成器，已改用 Word 兼容的 .doc；可在 Word/WPS 中「另存为 .docx」')
  }
  return exportDocAsHtml(title, content, opts)
}

/**
 * PDF 直接生成文件（非打印对话框），书签大纲可被其他软件识别：
 * - browser 引擎：无头 Edge/Chrome + --generate-pdf-document-outline
 * - pandoc 引擎（桌面设置开启）：需系统 xelatex；缺失时自动回退浏览器引擎
 * - 安卓：原生 WebView 打印管道生成 PDF 文件，再由系统文件管理器选手机存储目录（见 XmdFsPlugin.exportPdf）
 * - 纯浏览器里退化成系统打印（返回 'print'）
 */
export async function exportPdf(title: string, content: string, opts: ExportOpts): Promise<ExportedPath> {
  const ws = useWorkspace()
  if (bridge.platform === 'wails') {
    if (opts.pdfEngine === 'pandoc') {
      try {
        const saved = await bridge.exportPdfPandoc(safeName(title), normalizeMediaLinks(content, ws.currentPath), opts.pandocPath || '')
        if (saved || saved === '') return saved // pandoc 成功直出 / 用户取消
      } catch (e) {
        // 通常缺 xelatex（未装 TeX 发行版）：自动改用无头浏览器直出，导出仍可完成
        ws.notify(`Pandoc PDF 失败（${errText(e)}），已改用浏览器引擎直出`)
      }
    }
    const html = await renderExportBody(title, content, opts, { outline: false, tocMode: 'none' })
    return await bridge.exportPdfDirect(safeName(title), html)
  }
  if (isNativeShell()) {
    // 原生 WebView 里 window.print() 没有任何反应，必须交给壳：
    // 安卓用离屏 WebView 排版后调起系统打印预览，用户在打印界面选「保存为 PDF」并挑手机存储目录
    const html = await renderExportBody(title, content, opts, { outline: false, tocMode: 'none' })
    try {
      return await bridge.exportPdfDirect(safeName(title), html)
    } catch (e) {
      // 旧 APK / 鸿蒙壳没有这个原生能力：说清原因并给替代路径，别让提示假装成功
      throw new Error(`手机端无法调起 PDF 打印（${errText(e)}），可先「导出 HTML」再用浏览器打开打印为 PDF`)
    }
  }
  const html = await renderExportBody(title, content, opts, { outline: false, tocMode: 'none' })
  const iframe = document.createElement('iframe')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument
  if (!doc) return ''
  doc.open()
  doc.write(html)
  doc.close()
  await new Promise(r => setTimeout(r, 200))
  iframe.contentWindow?.focus()
  iframe.contentWindow?.print()
  setTimeout(() => iframe.remove(), 3000)
  return 'print'
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'document'
}
