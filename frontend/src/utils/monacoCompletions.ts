/**
 * Monaco 补充补全（参考 /root/Desktop/New/docmgr 的实现）。
 *
 * Monaco 自带的语言服务只覆盖 js/ts、css、html、json；Java / Python / PHP
 * 官方没有实现，这里补上「关键字 + 常用函数/变量 + 代码片段」，
 * 再叠加 Monaco 自带的按文档词汇补全。
 */

interface LanguageSpec {
  keywords: string[]
  functions?: string[]
  variables?: string[]
  snippets: { label: string; detail: string; insertText: string }[]
}

const JAVA: LanguageSpec = {
  keywords: [
    'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class',
    'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally',
    'float', 'for', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long',
    'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static',
    'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try',
    'void', 'volatile', 'while', 'true', 'false', 'null', 'String', 'Integer', 'List', 'Map'
  ],
  snippets: [
    { label: 'psvm', detail: 'main 方法', insertText: 'public static void main(String[] args) {\n\t${0}\n}' },
    { label: 'sout', detail: '打印一行', insertText: 'System.out.println(${0});' },
    { label: 'class', detail: '类定义', insertText: 'public class ${1} {\n\t${0}\n}' },
    { label: 'fori', detail: 'for 循环', insertText: 'for (int i = 0; i < ${1}; i++) {\n\t${0}\n}' },
    { label: 'foreach', detail: '增强 for', insertText: 'for (${1} ${2} : ${3}) {\n\t${0}\n}' },
    { label: 'tryc', detail: 'try/catch', insertText: 'try {\n\t${0}\n} catch (Exception e) {\n\te.printStackTrace();\n}' },
    { label: 'if', detail: 'if 语句', insertText: 'if (${1}) {\n\t${0}\n}' },
    { label: 'while', detail: 'while 循环', insertText: 'while (${1}) {\n\t${0}\n}' }
  ]
}

const PYTHON: LanguageSpec = {
  keywords: [
    'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
    'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
    'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while',
    'with', 'yield', 'None', 'True', 'False'
  ],
  functions: [
    'print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict', 'set', 'tuple',
    'enumerate', 'zip', 'sorted', 'sum', 'min', 'max', 'abs', 'round', 'open', 'input',
    'type', 'isinstance', 'map', 'filter', 'any', 'all', 'repr', 'format', 'id'
  ],
  variables: ['self'],
  snippets: [
    { label: 'def', detail: '函数定义', insertText: 'def ${1:name}(${2}):\n\t${0}' },
    { label: 'class', detail: '类定义', insertText: 'class ${1:Name}:\n\tdef __init__(self):\n\t\t${0}' },
    { label: 'ifmain', detail: '程序入口', insertText: 'if __name__ == "__main__":\n\t${0}' },
    { label: 'if', detail: 'if 语句', insertText: 'if ${1}:\n\t${0}' },
    { label: 'forin', detail: 'for 循环', insertText: 'for ${1} in ${2}:\n\t${0}' },
    { label: 'while', detail: 'while 循环', insertText: 'while ${1}:\n\t${0}' },
    { label: 'try', detail: 'try/except', insertText: 'try:\n\t${0}\nexcept Exception as e:\n\tprint(e)' },
    { label: 'with', detail: 'with 语句', insertText: 'with open(${1}) as f:\n\t${0}' }
  ]
}

const PHP: LanguageSpec = {
  keywords: [
    'abstract', 'and', 'array', 'as', 'break', 'callable', 'case', 'catch', 'class', 'clone',
    'const', 'continue', 'declare', 'default', 'die', 'do', 'echo', 'else', 'elseif', 'empty',
    'enum', 'extends', 'final', 'finally', 'fn', 'for', 'foreach', 'function', 'global',
    'goto', 'if', 'implements', 'include', 'include_once', 'instanceof', 'insteadof',
    'interface', 'isset', 'list', 'match', 'namespace', 'new', 'or', 'print', 'private',
    'protected', 'public', 'readonly', 'require', 'require_once', 'return', 'static',
    'switch', 'throw', 'trait', 'try', 'unset', 'use', 'var', 'while', 'xor', 'yield',
    'true', 'false', 'null', 'void', 'int', 'float', 'string', 'bool', 'mixed', 'object'
  ],
  functions: [
    'strlen', 'strpos', 'stripos', 'str_replace', 'substr', 'strtolower', 'strtoupper',
    'trim', 'ltrim', 'rtrim', 'explode', 'implode', 'sprintf', 'printf', 'str_repeat',
    'str_contains', 'str_starts_with', 'str_ends_with', 'ucfirst', 'ucwords', 'nl2br',
    'htmlspecialchars', 'strip_tags', 'number_format', 'md5', 'sha1', 'hash',
    'base64_encode', 'base64_decode', 'urlencode', 'urldecode', 'addslashes',
    'preg_match', 'preg_match_all', 'preg_replace', 'preg_split', 'preg_quote',
    'count', 'in_array', 'array_map', 'array_filter', 'array_reduce', 'array_merge',
    'array_keys', 'array_values', 'array_push', 'array_pop', 'array_shift', 'array_unshift',
    'array_slice', 'array_search', 'array_key_exists', 'array_column', 'array_unique',
    'array_flip', 'array_sum', 'array_diff', 'array_intersect', 'array_reverse', 'range',
    'sort', 'rsort', 'usort', 'asort', 'ksort', 'compact', 'extract',
    'file_get_contents', 'file_put_contents', 'file_exists', 'is_file', 'is_dir', 'mkdir',
    'unlink', 'fopen', 'fwrite', 'fread', 'fclose', 'fgets', 'glob', 'scandir', 'rename',
    'copy', 'filesize', 'basename', 'dirname', 'pathinfo', 'realpath', 'move_uploaded_file',
    'date', 'time', 'strtotime', 'mktime', 'microtime',
    'abs', 'ceil', 'floor', 'round', 'rand', 'mt_rand', 'max', 'min', 'pow', 'sqrt',
    'intval', 'floatval', 'strval', 'is_null', 'is_array', 'is_string', 'is_int',
    'is_numeric', 'is_object', 'is_callable', 'gettype', 'settype',
    'print_r', 'var_dump', 'var_export', 'error_log', 'debug_backtrace',
    'json_encode', 'json_decode', 'serialize', 'unserialize',
    'header', 'setcookie', 'session_start', 'session_destroy', 'ob_start', 'ob_get_clean',
    'mysqli_connect', 'mysqli_query', 'mysqli_fetch_assoc', 'mysqli_fetch_array',
    'mysqli_num_rows', 'mysqli_close',
    'define', 'defined', 'constant', 'class_exists', 'function_exists', 'method_exists'
  ],
  variables: [
    '$GLOBALS', '$_SERVER', '$_GET', '$_POST', '$_FILES', '$_COOKIE', '$_SESSION',
    '$_REQUEST', '$_ENV', '$this'
  ],
  snippets: [
    { label: 'php', detail: 'PHP 开始标签', insertText: '<?php\n\n${0}' },
    { label: 'echo', detail: '输出', insertText: 'echo ${1};' },
    { label: 'func', detail: '函数定义', insertText: 'function ${1:name}(${2}) {\n\t${0}\n}' },
    { label: 'class', detail: '类定义', insertText: 'class ${1:Name} {\n\tpublic function __construct() {\n\t\t${0}\n\t}\n}' },
    { label: 'pfunc', detail: 'public 方法', insertText: 'public function ${1:name}(${2}) {\n\t${0}\n}' },
    { label: 'if', detail: 'if 语句', insertText: 'if (${1}) {\n\t${0}\n}' },
    { label: 'ifelse', detail: 'if / else', insertText: 'if (${1}) {\n\t${2}\n} else {\n\t${0}\n}' },
    { label: 'foreach', detail: 'foreach 循环', insertText: 'foreach (${1:$arr} as ${2:$key} => ${3:$value}) {\n\t${0}\n}' },
    { label: 'for', detail: 'for 循环', insertText: 'for (${1:$i = 0}; ${2:$i < 10}; ${3:$i++}) {\n\t${0}\n}' },
    { label: 'while', detail: 'while 循环', insertText: 'while (${1}) {\n\t${0}\n}' },
    { label: 'try', detail: 'try / catch', insertText: 'try {\n\t${0}\n} catch (\\Throwable $e) {\n\terror_log($e->getMessage());\n}' },
    { label: 'pre', detail: '调试打印数组', insertText: "echo '<pre>';\nprint_r(${1});\necho '</pre>';" },
    { label: 'req', detail: '读取 POST 参数', insertText: '${1:$v} = ${2:$_POST}["${3:key}"] ?? ${4:null};' }
  ]
}

const SPECS: Record<string, LanguageSpec> = {
  java: JAVA,
  python: PYTHON,
  php: PHP
}

let installed = false

/** 注册 Java / Python / PHP 的补全（只注册一次） */
export function registerBasicCompletions(monaco: any) {
  if (installed) return
  installed = true

  const Kind = monaco.languages.CompletionItemKind
  const Snippet = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet

  function provider(spec: LanguageSpec) {
    return {
      provideCompletionItems(model: any, position: any) {
        const word = model.getWordUntilPosition(position)
        // PHP 变量以 $ 开头，而 Monaco 的词边界不含 $：
        // 把紧挨着的 $ 也纳入替换范围，否则会出现 $$_POST 这种重复，且前缀匹配也会失配。
        let startColumn = word.startColumn
        if (startColumn > 1) {
          const prev = model.getValueInRange(
            new monaco.Range(position.lineNumber, startColumn - 1, position.lineNumber, startColumn)
          )
          if (prev === '$') startColumn -= 1
        }
        const range = new monaco.Range(
          position.lineNumber,
          startColumn,
          position.lineNumber,
          word.endColumn
        )
        const list: any[] = []
        for (const s of spec.snippets) {
          list.push({
            label: s.label,
            kind: Kind.Snippet,
            detail: s.detail,
            insertText: s.insertText,
            insertTextRules: Snippet,
            range
          })
        }
        // 函数自动带括号，光标落在括号内
        for (const f of spec.functions || []) {
          list.push({
            label: f,
            kind: Kind.Function,
            detail: '函数',
            insertText: `${f}($0)`,
            insertTextRules: Snippet,
            range
          })
        }
        for (const v of spec.variables || []) {
          list.push({ label: v, kind: Kind.Variable, insertText: v, range })
        }
        for (const k of spec.keywords) {
          list.push({ label: k, kind: Kind.Keyword, insertText: k, range })
        }
        return { suggestions: list }
      }
    }
  }

  for (const [lang, spec] of Object.entries(SPECS)) {
    monaco.languages.registerCompletionItemProvider(lang, provider(spec))
  }
}
