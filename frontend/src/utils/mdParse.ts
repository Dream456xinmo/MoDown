/**
 * Markdown 解析与高亮（只在渲染线程 / Worker 中使用，避免占用主线程）
 *
 * 主线程通过 `utils/mdWorker.ts` 异步调用；单独抽出的原因见该文件说明。
 */
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/common'
import { extractHeadings } from './outline'

export interface RenderOptions {
  /** 代码块右上角输出复制按钮（应用内预览 / HTML 导出用） */
  copy?: boolean
}

const mdParser = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  highlight(code: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
      } catch {
        /* fallthrough */
      }
    }
    return hljs.highlightAuto(code).value
  }
})

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 代码块围栏上的语言标识（```bash → bash；没写就是 text） */
function fenceLang(token: any): string {
  const info = String(token?.info || '').trim()
  return info.split(/\s+/)[0] || 'text'
}

/** 代码块外层容器 + 顶部语言标签 + 可选复制按钮（点击由前端事件委托处理） */
function withCodeHead(html: string, copy: boolean, lang: string): string {
  const button = copy
    ? '<button class="code-copy" type="button" title="复制代码" aria-label="复制代码">复制</button>'
    : ''
  return `<div class="md-code-block"><div class="md-code-head"><span class="md-code-lang">${escapeHtml(
    lang
  )}</span>${button}</div>${html}</div>`
}

const defaultFence = mdParser.renderer.rules.fence!
mdParser.renderer.rules.fence = (tokens, idx, options, env, self) =>
  withCodeHead(
    defaultFence(tokens, idx, options, env, self),
    !!(env as RenderOptions)?.copy,
    fenceLang(tokens[idx])
  )

const defaultCodeBlock = mdParser.renderer.rules.code_block
if (defaultCodeBlock) {
  mdParser.renderer.rules.code_block = (tokens, idx, options, env, self) =>
    withCodeHead(defaultCodeBlock(tokens, idx, options, env, self), !!(env as RenderOptions)?.copy, 'text')
}

/** 渲染正文 HTML，并按出现顺序给标题挂上大纲锚点 id */
export function renderPreview(mdText: string, opts: RenderOptions = {}): string {
  const headings = extractHeadings(mdText)
  let idx = 0
  const env: RenderOptions = { copy: !!opts.copy }
  const html = mdParser.render(mdText, env)
  return html.replace(/<h([1-6])>/g, (_m, l) => {
    const h = headings[idx++]
    return `<h${l} id="${h ? h.slug : 'h-x'}">`
  })
}
