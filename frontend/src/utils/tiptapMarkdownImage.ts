/**
 * Tiptap Image 的 Markdown 序列化补丁。
 *
 * tiptap-markdown 默认用 prosemirror-markdown 的 image 序列化，它把图片当行内节点写，
 * 不会 closeBlock。图片是块级节点时，后面的段落会被拼成 `![](x.png)正文`，
 * 重新打开就变成错误结构。这里补一个 closeBlock，保证块级图片后面有换行。
 */
import Image, { type ImageOptions } from '@tiptap/extension-image'

interface MoImageOptions extends ImageOptions {
  /** 把 Markdown 里的相对路径解析成 WebView 能加载的地址（不写回文档） */
  resolveSrc?: ((src: string) => Promise<string>) | null
}

export const MarkdownImage = Image.extend<MoImageOptions>({
  addOptions() {
    return {
      ...(this.parent?.() as ImageOptions),
      resolveSrc: null
    }
  },

  /**
   * 图片节点用自定义 NodeView：文档里始终保存原始的 `/assets/x.png`，
   * 屏幕上显示的是解析后的 blob/data/raw 地址。
   * 这样安卓 SAF 的 content:// 图片也能显示，同时保存 Markdown 不会把 data URL 写进正文。
   */
  addNodeView() {
    const resolveSrc = this.options.resolveSrc
    return ({ node }) => {
      const img = document.createElement('img')
      img.className = 'xmd-rich-image'
      img.draggable = true
      let currentSrc = ''

      const apply = (n: any) => {
        const src = String(n.attrs.src || '')
        img.alt = String(n.attrs.alt || '')
        if (n.attrs.title) img.title = String(n.attrs.title)
        else img.removeAttribute('title')
        if (src === currentSrc) return
        currentSrc = src
        img.removeAttribute('src')
        if (!src) return
        if (!resolveSrc) {
          img.src = src
          return
        }
        void resolveSrc(src)
          .then(url => {
            if (currentSrc === src && url) img.src = url
          })
          .catch(() => {
            if (currentSrc === src) img.src = src
          })
      }

      apply(node)
      return {
        dom: img,
        update: (updated: any) => {
          if (updated.type !== node.type) return false
          apply(updated)
          return true
        }
      }
    }
  },

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
