/**
 * Tiptap Image 的 Markdown 序列化补丁。
 *
 * tiptap-markdown 默认用 prosemirror-markdown 的 image 序列化，它把图片当行内节点写，
 * 不会 closeBlock。图片是块级节点时，后面的段落会被拼成 `![](x.png)正文`，
 * 重新打开就变成错误结构。这里补一个 closeBlock，保证块级图片后面有换行。
 */
import Image from '@tiptap/extension-image'

export const MarkdownImage = Image.extend({
  addStorage() {
    return {
      ...(this.parent?.() || {}),
      markdown: {
        serialize(state: any, node: any) {
          const alt = String(node.attrs.alt || '').replace(/]/g, '\\]')
          const title = node.attrs.title
            ? ` "${String(node.attrs.title).replace(/"/g, '\\"')}"`
            : ''
          state.write(`![${alt}](${String(node.attrs.src || '')}${title})`)
          // 块级图片：结束当前块，后续段落才会另起一行
          state.closeBlock(node)
        }
      }
    }
  }
})
