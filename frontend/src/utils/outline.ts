export interface Heading {
  text: string
  level: number
  line: number
  slug: string
}

/** 从 Markdown 源文本提取 H1–H6 大纲，忽略代码围栏内的井号行 */
export function extractHeadings(md: string): Heading[] {
  const out: Heading[] = []
  let inFence = false
  const lines = md.split(/\r?\n/)
  lines.forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence
      return
    }
    if (inFence) return
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw)
    if (m) {
      out.push({
        level: m[1].length,
        text: m[2].trim(),
        line: i,
        slug: slugify(m[2].trim(), out.length)
      })
    }
  })
  return out
}

export interface ONode {
  h: Heading
  children: ONode[]
}

/** 由扁平标题列表（按出现顺序）构建大纲树 */
export function buildOutlineTree(headings: Heading[]): ONode[] {
  const roots: ONode[] = []
  const stack: ONode[] = []
  for (const h of headings) {
    const n: ONode = { h, children: [] }
    while (stack.length && stack[stack.length - 1].h.level >= h.level) stack.pop()
    if (stack.length) stack[stack.length - 1].children.push(n)
    else roots.push(n)
    stack.push(n)
  }
  return roots
}

/** 标题文本 → 锚点 id（Markdown 渲染与 HTML 预览共用同一套 slug 规则） */
export function slugify(text: string, index: number): string {
  const base = text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5- ]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 30)
  return `h-${index}-${base || 'heading'}`
}
