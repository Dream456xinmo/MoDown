/**
 * HTML Emmet 子集（参考 /root/Desktop/New/docmgr 的实现）：
 * 让 Monaco 像 VS Code 的 Emmet 一样，输入缩写后回车直接展开。
 *
 * 支持：`!`（HTML5 骨架）、标签名、`.class`、`#id`、`>`（子级）、`+`（兄弟）、
 * `*n`（重复）、`{文本}`、`$`（序号）。
 *
 * 例：
 *   h1          -> <h1>光标</h1>
 *   br          -> <br />
 *   !           -> 完整 HTML5 骨架
 *   div.box     -> <div class="box">光标</div>
 *   ul>li.item*3 -> ul 里三个 li.item
 */

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
])

/** Emmet 里会自动补上的常用属性 */
const IMPLICIT: Record<string, string> = {
  a: ' href=""',
  img: ' src="" alt=""',
  input: ' type="text"',
  link: ' rel="stylesheet" href=""',
  script: ' src=""',
  form: ' action=""',
  iframe: ' src="" frameborder="0"',
  button: ' type="button"',
  video: ' src=""',
  audio: ' src=""',
  source: ' src="" type=""',
  textarea: ' name="" cols="30" rows="10"',
  select: ' name=""',
  option: ' value=""'
}

/** 只有标准标签（或带 Emmet 语法）才给建议，避免把普通英文单词误展开成标签 */
const KNOWN_TAGS = new Set([
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base', 'bdi',
  'bdo', 'blockquote', 'body', 'br', 'button', 'canvas', 'caption', 'cite', 'code',
  'col', 'colgroup', 'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog',
  'div', 'dl', 'dt', 'em', 'embed', 'fieldset', 'figcaption', 'figure', 'footer',
  'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr',
  'html', 'i', 'iframe', 'img', 'input', 'ins', 'kbd', 'label', 'legend', 'li',
  'link', 'main', 'map', 'mark', 'menu', 'meta', 'meter', 'nav', 'noscript',
  'object', 'ol', 'optgroup', 'option', 'output', 'p', 'picture', 'pre',
  'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'script', 'section', 'select',
  'slot', 'small', 'source', 'span', 'strong', 'style', 'sub', 'summary', 'sup',
  'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time',
  'title', 'tr', 'track', 'u', 'ul', 'var', 'video', 'wbr', 'svg'
])

const SKELETON = [
  '<!DOCTYPE html>',
  '<html lang="en">',
  '<head>',
  '\t<meta charset="UTF-8">',
  '\t<meta name="viewport" content="width=device-width, initial-scale=1.0">',
  '\t<title>${1:Document}</title>',
  '</head>',
  '<body>',
  '\t$0',
  '</body>',
  '</html>'
].join('\n')

interface EmmetNode {
  tag: string
  classes: string[]
  ids: string[]
  text: string
  children: EmmetNode[]
  repeat: number
}

/** Monaco 片段里 $ 与 \ 有特殊含义，用户文本需要转义 */
function escapeSnippet(s: string) {
  return s.replace(/[\\$]/g, '\\$&')
}

// 生成过程中用这个占位符标记光标位置，最后再换成 Monaco 的 $0，
// 这样用户输入的 $ 会先被安全转义，不会和片段语法冲突。
const CURSOR = '\u0000'

function applyRepeat(s: string, rep: number | null) {
  if (rep == null) return s
  return s.replace(/\$/g, String(rep))
}

/** 解析 Emmet 缩写；解析失败返回 null */
function parseAbbr(str: string): EmmetNode[] | null {
  let i = 0
  const isNameChar = (c: string) => /[A-Za-z0-9_$-]/.test(c)

  function parseElement(): EmmetNode | null {
    let tag = ''
    while (i < str.length && isNameChar(str[i])) tag += str[i++]
    const classes: string[] = []
    const ids: string[] = []
    let text = ''
    while (i < str.length) {
      const c = str[i]
      if (c === '.' || c === '#') {
        i++
        let v = ''
        while (i < str.length && isNameChar(str[i])) v += str[i++]
        if (!v) return null
        ;(c === '.' ? classes : ids).push(v)
      } else if (c === '{') {
        i++
        let v = ''
        while (i < str.length && str[i] !== '}') v += str[i++]
        if (str[i] !== '}') return null
        i++
        text = v
      } else {
        break
      }
    }
    if (!tag && !classes.length && !ids.length && !text) return null
    return { tag: tag || 'div', classes, ids, text, children: [], repeat: 1 }
  }

  function parseTerm(): EmmetNode | null {
    const el = parseElement()
    if (!el) return null
    if (str[i] === '*') {
      i++
      let n = ''
      while (i < str.length && /\d/.test(str[i])) n += str[i++]
      if (!n) return null
      el.repeat = Math.max(1, Math.min(parseInt(n, 10) || 1, 100))
    }
    return el
  }

  function parseChain(): EmmetNode | null {
    const head = parseTerm()
    if (!head) return null
    let cur = head
    while (i < str.length && str[i] === '>') {
      i++
      const child = parseTerm()
      if (!child) return null
      cur.children.push(child)
      cur = child
    }
    return head
  }

  function parseSiblings(): EmmetNode[] | null {
    const list = [parseChain()]
    if (!list[0]) return null
    while (i < str.length && str[i] === '+') {
      i++
      const n = parseChain()
      if (!n) return null
      list.push(n)
    }
    return list as EmmetNode[]
  }

  const roots = parseSiblings()
  if (!roots || i !== str.length) return null
  return roots
}

function attrsOf(node: EmmetNode) {
  let a = ''
  if (node.ids.length) a += ' id="' + node.ids[0] + '"'
  if (node.classes.length) a += ' class="' + node.classes.join(' ') + '"'
  a += IMPLICIT[node.tag] || ''
  return a
}

function renderOne(node: EmmetNode, depth: number, state: { cursor: boolean }, rep: number | null): string {
  const pad = '\t'.repeat(depth)
  const tag = node.tag
  const head = pad + '<' + tag + applyRepeat(attrsOf(node), rep)
  // 自闭合标签统一写成 <br />，符合用户对 HTML/XHTML 的直觉
  if (VOID.has(tag)) return head + ' />'
  const open = head + '>'

  if (!node.children.length) {
    let inner = node.text ? applyRepeat(node.text, rep) : ''
    if (!state.cursor) {
      state.cursor = true
      inner += CURSOR
    }
    return open + inner + '</' + tag + '>'
  }

  const inner = node.children
    .map(c => {
      // 子节点自己有重复次数时用子节点序号，否则沿用父级序号
      const childRep = c.repeat > 1 ? null : rep
      return renderNode(c, depth + 1, state, childRep)
    })
    .join('\n')
  return open + '\n' + inner + '\n' + pad + '</' + tag + '>'
}

function renderNode(node: EmmetNode, depth: number, state: { cursor: boolean }, rep: number | null): string {
  const count = node.repeat || 1
  const out: string[] = []
  for (let k = 0; k < count; k++) {
    out.push(renderOne(node, depth, state, count > 1 ? k + 1 : rep))
  }
  return out.join('\n')
}

/** 取出光标前的缩写；不合法时返回 null */
function abbreviationAt(model: any, position: any): { abbr: string; start: number } | null {
  const line = model.getLineContent(position.lineNumber)
  const before = line.slice(0, position.column - 1)

  // 光标在标签内部（本行最后一个 < 之后还没出现 >）时不展开
  if (before.lastIndexOf('<') > before.lastIndexOf('>')) return null
  // 注释里不展开
  if (before.lastIndexOf('<!--') > before.lastIndexOf('-->')) return null

  const isAbbrChar = (c: string) => /[A-Za-z0-9_.#>+*{}:!$-]/.test(c)
  let i = before.length
  let depth = 0 // 花括号内允许空格等任意字符，例如 p{hello world}
  while (i > 0) {
    const c = before[i - 1]
    if (c === '}') {
      depth++
      i--
      continue
    }
    if (c === '{') {
      depth = Math.max(0, depth - 1)
      i--
      continue
    }
    if (depth > 0 || isAbbrChar(c)) {
      i--
      continue
    }
    break
  }
  // 缩写必须从行首或空白之后开始
  if (i > 0 && !/\s/.test(before[i - 1])) return null

  const abbr = before.slice(i)
  return abbr ? { abbr, start: i } : null
}

/** 是否值得展开：! 或标准标签，或带 . # > + * {} 等 Emmet 语法 */
function shouldExpand(abbr: string, nodes: EmmetNode[]): boolean {
  if (abbr === '!') return true
  if (/[.#>+*{}]/.test(abbr)) return true
  return nodes.some(n => KNOWN_TAGS.has(n.tag))
}

/**
 * 直接展开光标前的 Emmet 缩写（给 Tab 键用，绕过候选列表的过滤）。
 * 返回 false 表示当前不是可展开的 Emmet 缩写，调用方应回退到普通 Tab 缩进。
 */
export function expandEmmetAtCursor(monaco: any, editor: any): boolean {
  const model = editor.getModel()
  const position = editor.getPosition()
  if (!model || !position) return false
  const found = abbreviationAt(model, position)
  if (!found) return false

  const { abbr, start } = found
  let insertText: string
  if (abbr === '!') {
    insertText = SKELETON
  } else {
    const nodes = parseAbbr(abbr)
    if (!nodes || !shouldExpand(abbr, nodes)) return false
    const state = { cursor: false }
    insertText = escapeSnippet(nodes.map(n => renderNode(n, 0, state, null)).join('\n')).replace(
      /\u0000/g,
      '$0'
    )
  }
  const range = new monaco.Range(position.lineNumber, start + 1, position.lineNumber, position.column)
  // 用 snippetController 直接替换：它负责 ${1}/$0 的占位符与 Tab 跳转
  const controller = editor.getContribution('snippetController2')
  if (controller && typeof controller.insert === 'function') {
    editor.executeEdits('emmet', [{ range, text: '', forceMoveMarkers: true }])
    controller.insert(insertText)
  } else {
    // 极端情况下没有 snippet 控制器：退化为纯文本插入（去掉占位符语法）
    const plain = insertText
      .replace(/\$\{\d+:([^}]*)\}/g, '$1')
      .replace(/\$\{\d+\}/g, '')
      .replace(/\$\d+/g, '')
    editor.executeEdits('emmet', [{ range, text: plain, forceMoveMarkers: true }])
  }
  return true
}

let installed = false

/** 注册 HTML Emmet 补全（只注册一次） */
export function registerEmmet(monaco: any) {
  if (installed) return
  installed = true

  const Kind = monaco.languages.CompletionItemKind
  const Snippet = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet

  monaco.languages.registerCompletionItemProvider('html', {
    triggerCharacters: ['!', '.', '#', '>', '+', '*', ':'],
    provideCompletionItems(model: any, position: any) {
      const found = abbreviationAt(model, position)
      if (!found) return { suggestions: [] }

      const { abbr, start } = found
      let insertText
      if (abbr === '!') {
        insertText = SKELETON
      } else {
        const nodes = parseAbbr(abbr)
        if (!nodes || !shouldExpand(abbr, nodes)) return { suggestions: [] }
        const state = { cursor: false }
        insertText = escapeSnippet(
          nodes.map(n => renderNode(n, 0, state, null)).join('\n')
        ).replace(/\u0000/g, '$0')
      }

      const range = new monaco.Range(
        position.lineNumber,
        start + 1,
        position.lineNumber,
        position.column
      )
      return {
        suggestions: [
          {
            label: abbr,
            kind: Kind.Snippet,
            detail: abbr === '!' ? 'HTML5 骨架' : 'Emmet 展开',
            documentation: abbr === '!' ? '生成 HTML5 基本骨架' : '按 Emmet 语法展开为 HTML',
            insertText,
            insertTextRules: Snippet,
            filterText: abbr,
            // 排在内置 HTML 补全之前，回车优先选中
            sortText: '0' + abbr,
            range
          }
        ]
      }
    }
  })
}
