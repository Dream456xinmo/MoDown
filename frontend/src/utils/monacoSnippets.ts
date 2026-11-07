/**
 * Monaco 代码片段（VSCode 风格）：
 * - HTML：输入 `!` 生成 HTML5 骨架；输入 `:h1` / `:div` / `:table` 等插入标签，光标停在正文处
 * - Python / Go / C / C++ / Java / JS / TS：`:` 前缀触发常用模板
 *
 * 只在 Monaco 编辑器里生效（PC / 网页版、平板版）；安卓壳本来就禁用 Monaco。
 */

interface Snip {
  /** 触发名（不含冒号） */
  name: string
  /** 候选列表里显示的说明 */
  detail: string
  /** Monaco snippet 语法：${1:占位}、$0 最终光标 */
  body: string
}

type MonacoApi = any

const HTML5 = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>\${1:Document}</title>
</head>
<body>
  $0
</body>
</html>`

/** 常用 HTML 标签：`:h1` → <h1>光标</h1> */
const HTML: Snip[] = [
  { name: 'html5', detail: 'HTML5 文档骨架', body: HTML5 },
  { name: 'div', detail: '<div> 容器', body: '<div class="${1}">\n  $0\n</div>' },
  { name: 'span', detail: '<span> 行内容器', body: '<span>$0</span>' },
  { name: 'p', detail: '<p> 段落', body: '<p>$0</p>' },
  { name: 'br', detail: '<br /> 换行', body: '<br />$0' },
  { name: 'hr', detail: '<hr /> 分隔线', body: '<hr />$0' },
  { name: 'h1', detail: '<h1> 一级标题', body: '<h1>$0</h1>' },
  { name: 'h2', detail: '<h2> 二级标题', body: '<h2>$0</h2>' },
  { name: 'h3', detail: '<h3> 三级标题', body: '<h3>$0</h3>' },
  { name: 'h4', detail: '<h4> 四级标题', body: '<h4>$0</h4>' },
  { name: 'h5', detail: '<h5> 五级标题', body: '<h5>$0</h5>' },
  { name: 'h6', detail: '<h6> 六级标题', body: '<h6>$0</h6>' },
  { name: 'a', detail: '<a> 链接', body: '<a href="${1:https://}">$0</a>' },
  { name: 'img', detail: '<img> 图片', body: '<img src="${1:url}" alt="$0" />' },
  { name: 'ul', detail: '<ul> 无序列表', body: '<ul>\n  <li>$0</li>\n</ul>' },
  { name: 'ol', detail: '<ol> 有序列表', body: '<ol>\n  <li>$0</li>\n</ol>' },
  { name: 'li', detail: '<li> 列表项', body: '<li>$0</li>' },
  { name: 'table', detail: '<table> 表格', body: '<table>\n  <thead>\n    <tr><th>${1:列 1}</th><th>${2:列 2}</th></tr>\n  </thead>\n  <tbody>\n    <tr><td>$0</td><td></td></tr>\n  </tbody>\n</table>' },
  { name: 'form', detail: '<form> 表单', body: '<form action="${1}" method="${2:post}">\n  $0\n</form>' },
  { name: 'input', detail: '<input> 输入框', body: '<input type="${1:text}" name="${2:name}" placeholder="$0" />' },
  { name: 'button', detail: '<button> 按钮', body: '<button type="${1:button}">$0</button>' },
  { name: 'select', detail: '<select> 下拉框', body: '<select name="${1:name}">\n  <option value="${2}">$0</option>\n</select>' },
  { name: 'textarea', detail: '<textarea> 多行输入', body: '<textarea name="${1:name}" rows="${2:4}">$0</textarea>' },
  { name: 'label', detail: '<label> 表单标签', body: '<label for="${1}">$0</label>' },
  { name: 'script', detail: '<script> 脚本', body: '<script>\n  $0\n</script>' },
  { name: 'style', detail: '<style> 样式', body: '<style>\n  $0\n</style>' },
  { name: 'link', detail: '<link> 引入样式', body: '<link rel="stylesheet" href="${1:style.css}" />' },
  { name: 'meta', detail: '<meta> 元信息', body: '<meta name="${1:viewport}" content="$0" />' },
  { name: 'section', detail: '<section> 区块', body: '<section>\n  $0\n</section>' },
  { name: 'header', detail: '<header> 页头', body: '<header>\n  $0\n</header>' },
  { name: 'footer', detail: '<footer> 页脚', body: '<footer>\n  $0\n</footer>' },
  { name: 'nav', detail: '<nav> 导航', body: '<nav>\n  $0\n</nav>' },
  { name: 'main', detail: '<main> 主内容', body: '<main>\n  $0\n</main>' },
  { name: 'article', detail: '<article> 文章', body: '<article>\n  $0\n</article>' },
  { name: 'aside', detail: '<aside> 侧栏', body: '<aside>\n  $0\n</aside>' },
  { name: 'video', detail: '<video> 视频', body: '<video src="${1:url}" controls>\n  $0\n</video>' },
  { name: 'audio', detail: '<audio> 音频', body: '<audio src="${1:url}" controls>\n  $0\n</audio>' },
  { name: 'iframe', detail: '<iframe> 内嵌页面', body: '<iframe src="${1:url}" title="$0"></iframe>' },
  { name: 'canvas', detail: '<canvas> 画布', body: '<canvas id="${1:canvas}" width="${2:400}" height="${3:300}">$0</canvas>' },
  { name: 'picture', detail: '<picture> 响应式图片', body: '<picture>\n  <source srcset="${1:image.webp}" type="image/webp" />\n  <img src="${2:image.jpg}" alt="$0" />\n</picture>' },
  { name: 'details', detail: '<details> 折叠面板', body: '<details>\n  <summary>$0</summary>\n  <p></p>\n</details>' },
  { name: 'blockquote', detail: '<blockquote> 引用', body: '<blockquote>\n  $0\n</blockquote>' },
  { name: 'pre', detail: '<pre> 预格式文本', body: '<pre>$0</pre>' },
  { name: 'code', detail: '<code> 行内代码', body: '<code>$0</code>' },
  { name: 'template', detail: '<template> 模板', body: '<template>\n  $0\n</template>' }
]

const PYTHON: Snip[] = [
  { name: 'def', detail: '函数定义', body: 'def ${1:name}(${2:args}) -> ${3:None}:\n    $0' },
  { name: 'asyncdef', detail: '异步函数', body: 'async def ${1:name}(${2:args}) -> ${3:None}:\n    $0' },
  { name: 'class', detail: '类定义', body: 'class ${1:Name}:\n    def __init__(self${2:, args}) -> None:\n        $0' },
  { name: 'main', detail: '程序入口', body: "if __name__ == '__main__':\n    $0" },
  { name: 'for', detail: 'for 循环', body: 'for ${1:item} in ${2:items}:\n    $0' },
  { name: 'if', detail: 'if 条件', body: 'if ${1:condition}:\n    $0' },
  { name: 'try', detail: 'try / except', body: 'try:\n    $0\nexcept ${1:Exception} as e:\n    ${2:pass}' },
  { name: 'with', detail: 'with 上下文', body: 'with ${1:expr} as ${2:f}:\n    $0' },
  { name: 'lambda', detail: 'lambda 表达式', body: 'lambda ${1:args}: ${2:expr}' },
  { name: 'import', detail: 'import 模块', body: 'import ${1:module}' },
  { name: 'from', detail: 'from ... import', body: 'from ${1:module} import ${2:name}' },
  { name: 'print', detail: 'print 输出', body: 'print($0)' }
]

const GO: Snip[] = [
  { name: 'func', detail: '函数定义', body: 'func ${1:name}(${2:args}) ${3:error} {\n\t$0\n}' },
  { name: 'main', detail: 'main 函数', body: 'func main() {\n\t$0\n}' },
  { name: 'iferr', detail: '错误检查', body: 'if err != nil {\n\treturn ${1:err}\n}\n$0' },
  { name: 'for', detail: 'for 循环', body: 'for ${1:i} := 0; ${1:i} < ${2:n}; ${1:i}++ {\n\t$0\n}' },
  { name: 'range', detail: 'for range', body: 'for ${1:k}, ${2:v} := range ${3:items} {\n\t$0\n}' },
  { name: 'struct', detail: '结构体定义', body: 'type ${1:Name} struct {\n\t$0\n}' },
  { name: 'interface', detail: '接口定义', body: 'type ${1:Name} interface {\n\t$0\n}' },
  { name: 'type', detail: '类型别名', body: 'type ${1:Name} ${2:string}' },
  { name: 'switch', detail: 'switch 分支', body: 'switch ${1:value} {\ncase ${2:cond}:\n\t$0\ndefault:\n}' },
  { name: 'printf', detail: 'fmt.Printf', body: 'fmt.Printf("${1:%v}\\n", ${2:value})$0' }
]

const C: Snip[] = [
  { name: 'main', detail: 'main 函数', body: 'int main(int argc, char *argv[]) {\n    $0\n    return 0;\n}' },
  { name: 'include', detail: '#include 头文件', body: '#include <${1:stdio.h}>' },
  { name: 'for', detail: 'for 循环', body: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n    $0\n}' },
  { name: 'if', detail: 'if 条件', body: 'if (${1:condition}) {\n    $0\n}' },
  { name: 'struct', detail: 'struct 定义', body: 'struct ${1:Name} {\n    $0\n};' },
  { name: 'printf', detail: 'printf 输出', body: 'printf("${1:%d}\\n", ${2:value});$0' },
  { name: 'switch', detail: 'switch 分支', body: 'switch (${1:value}) {\ncase ${2:0}:\n    $0\n    break;\ndefault:\n    break;\n}' }
]

const JAVA: Snip[] = [
  { name: 'main', detail: 'main 方法', body: 'public static void main(String[] args) {\n    $0\n}' },
  { name: 'class', detail: '类定义', body: 'public class ${1:Name} {\n    $0\n}' },
  { name: 'for', detail: 'for 循环', body: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n    $0\n}' },
  { name: 'sout', detail: 'System.out.println', body: 'System.out.println($0);' },
  { name: 'try', detail: 'try / catch', body: 'try {\n    $0\n} catch (${1:Exception} e) {\n    e.printStackTrace();\n}' }
]

const JS: Snip[] = [
  { name: 'log', detail: 'console.log', body: 'console.log($0)' },
  { name: 'fn', detail: '函数定义', body: 'function ${1:name}(${2:args}) {\n  $0\n}' },
  { name: 'arrow', detail: '箭头函数', body: 'const ${1:name} = (${2:args}) => {\n  $0\n}' },
  { name: 'if', detail: 'if 条件', body: 'if (${1:condition}) {\n  $0\n}' },
  { name: 'for', detail: 'for...of 循环', body: 'for (const ${1:item} of ${2:items}) {\n  $0\n}' },
  { name: 'try', detail: 'try / catch', body: 'try {\n  $0\n} catch (e) {\n  console.error(e)\n}' },
  { name: 'promise', detail: 'async / await', body: 'async function ${1:name}(${2:args}) {\n  $0\n}' }
]

// HTML 交给 monacoEmmet（支持 !、h1、br、div.box、ul>li*3 等）；
// Java / Python / PHP 交给 monacoCompletions（关键字 + 函数 + 片段）。
// 这里只保留 Go / C / C++ / JS / TS 的 `:` 前缀片段，避免和上面重复。
const SNIPPETS: Record<string, Snip[]> = {
  go: GO,
  c: C,
  cpp: C,
  javascript: JS,
  typescript: JS
}

let installed = false

/** 安装一次即可（Monaco 是全局单例，重复注册会得到重复候选） */
export function installMonacoSnippets(monaco: MonacoApi) {
  if (installed) return
  installed = true

  for (const [lang, list] of Object.entries(SNIPPETS)) {
    monaco.languages.registerCompletionItemProvider(lang, {
      triggerCharacters: [':', '!'],
      provideCompletionItems(model: any, position: any) {
        const line = model.getLineContent(position.lineNumber)
        const before = line.slice(0, position.column - 1)
        // 既支持 `:h1`（显式片段前缀），也支持直接输入 `h1` / `br` / `def` / `func`
        // ——后者才是 VSCode 里最自然的用法。仍然只认「行首 / 空白之后」，避免把
        // URL、CSS 伪类、三元表达式里的冒号当成片段前缀。
        const m = /(^|\s)([:!]?[A-Za-z0-9_-]*)$/.exec(before)
        if (!m) return { suggestions: [] }

        const token = m[2]
        if (!token) return { suggestions: [] }

        const startColumn = position.column - token.length
        const range = {
          startLineNumber: position.lineNumber,
          startColumn,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        }

        // HTML 的 `!` → HTML5 骨架
        if (token === '!') {
          if (lang !== 'html') return { suggestions: [] }
          return {
            suggestions: [
              {
                label: '! HTML5 骨架',
                kind: monaco.languages.CompletionItemKind.Snippet,
                detail: '生成完整 HTML5 文档',
                documentation: HTML5,
                insertText: HTML5,
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range,
                filterText: '!',
                sortText: '0000'
              }
            ]
          }
        }

        // `:h1` 的冒号只是显式前缀，真正用来匹配片段名的是 h1
        const typed = (token.startsWith(':') ? token.slice(1) : token).toLowerCase()
        const suggestions = list
          .filter(s => !typed || s.name.startsWith(typed))
          .map((s, i) => ({
            // 候选里直接显示 h1 / br / def，和 VSCode 的片段列表一致
            label: s.name,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: s.detail,
            documentation: s.body,
            insertText: s.body,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            // 冒号不参与过滤：`:h1` 和 `h1` 都能命中
            filterText: typed || token,
            sortText: String(1000 + i)
          }))

        return { suggestions }
      }
    })
  }
}
