/**
 * Tiptap 代码块语法高亮（基于 highlight.js 语法树生成 ProseMirror 装饰，不修改文档内容）
 *
 * 与 lowlight 方案相比不引入额外依赖：只借用已内置的 highlight.js，
 * 高亮仅以 CSS class 的形式附加在文本上，因此复制/导出 Markdown 仍是纯代码文本。
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import hljs from 'highlight.js/lib/common'

/** 超过该代码量不再高亮，避免超大代码块拖慢输入 */
const MAX_HIGHLIGHT_CHARS = 120000

interface TokenRange {
  from: number
  to: number
  cls: string
}

/** 递归遍历 highlight.js 语法树，收集带作用域的文本区间（区间天然嵌套、不交叉） */
function collect(node: unknown, offset: number, out: TokenRange[]): number {
  if (typeof node === 'string') return offset + node.length
  const n = node as { scope?: string; children?: unknown[] }
  const start = offset
  let cur = offset
  for (const child of n.children || []) cur = collect(child, cur, out)
  const end = cur
  if (n.scope && end > start) {
    out.push({ from: start, to: end, cls: 'hljs-' + String(n.scope).split('.')[0] })
  }
  return end
}

function buildDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  let budget = MAX_HIGHLIGHT_CHARS
  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true
    const lang = String(node.attrs.language || '').trim()
    // 每个代码块右上角显示语言标签（没有围栏信息时显示 text）
    decos.push(
      Decoration.widget(
        pos + 1,
        () => {
          const el = document.createElement('span')
          el.className = 'code-lang-label'
          el.textContent = lang || 'text'
          return el
        },
        { side: -1 }
      )
    )
    if (!lang || !hljs.getLanguage(lang)) return false
    const code = node.textContent
    if (!code || budget <= 0) return false
    budget -= code.length
    let root: unknown
    try {
      const res: any = hljs.highlight(code, { language: lang, ignoreIllegals: true })
      root = res?._emitter?.rootNode
    } catch {
      return false
    }
    if (!root) return false
    const ranges: TokenRange[] = []
    collect(root, 0, ranges)
    // 外层区间优先，保证嵌套装饰按 from 升序、to 降序排列
    ranges.sort((a, b) => a.from - b.from || b.to - a.to)
    const base = pos + 1
    for (const r of ranges) {
      const from = base + r.from
      const to = base + r.to
      if (to <= from || to > base + code.length) continue
      decos.push(Decoration.inline(from, to, { class: r.cls }))
    }
    return false
  })
  return DecorationSet.create(doc, decos)
}

const highlightKey = new PluginKey<DecorationSet>('xmdCodeHighlight')

export const CodeBlockHighlight = Extension.create({
  name: 'codeBlockHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: highlightKey,
        state: {
          init: (_cfg, { doc }) => buildDecorations(doc),
          apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc) : old)
        },
        props: {
          decorations: state => highlightKey.getState(state)
        }
      })
    ]
  }
})
