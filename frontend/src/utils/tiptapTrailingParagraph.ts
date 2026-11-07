/**
 * 保证文档末尾始终有一个空段落。
 *
 * 有图片 / 代码块 / 表格等块级节点时，如果它正好是文档最后一个节点，
 * ProseMirror 里“图片下方”没有可放置光标的文本位置，用户会感觉
 * 「点图片下面的空白处无法继续编辑」。这里在最后一次文档变更后补一个
 * 空段落，点下方就能直接接着写。
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const TrailingParagraph = Extension.create({
  name: 'trailingParagraph',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('xmdTrailingParagraph'),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some(tr => tr.docChanged)) return null
          const last = newState.doc.lastChild
          if (!last || last.type.name === 'paragraph') return null
          const paragraph = newState.schema.nodes.paragraph
          if (!paragraph) return null
          return newState.tr.insert(newState.doc.content.size, paragraph.create())
        }
      })
    ]
  }
})
