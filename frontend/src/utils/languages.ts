/**
 * 语言识别与高亮加载
 *
 * - 由文件路径推断语言（Monaco / CodeMirror 共用同一套 id）
 * - Monaco 的语言定义按需动态导入（每种语言一个极小的 register 分片），避免首屏体积膨胀
 */
export type LangId = string

/** 扩展名 → 语言 id（Monaco 语言 id 为主） */
const EXT_LANG: Record<string, LangId> = {
  md: 'markdown', markdown: 'markdown', mdx: 'mdx',
  txt: 'plaintext', text: 'plaintext', log: 'plaintext', csv: 'plaintext', tsv: 'plaintext',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  json: 'json', jsonc: 'json', json5: 'json',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html', svg: 'xml', xml: 'xml', xsl: 'xml', plist: 'xml',
  css: 'css', scss: 'scss', sass: 'scss', less: 'less',
  py: 'python', pyw: 'python', java: 'java', go: 'go', rs: 'rust', rb: 'ruby', php: 'php',
  c: 'cpp', h: 'cpp', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', cs: 'csharp',
  kt: 'kotlin', kts: 'kotlin', swift: 'swift', scala: 'scala', dart: 'dart', lua: 'lua',
  pl: 'perl', pm: 'perl', r: 'r', m: 'objective-c', mm: 'objective-c',
  sh: 'shell', bash: 'shell', zsh: 'shell', ksh: 'shell', ps1: 'powershell', psm1: 'powershell',
  bat: 'bat', cmd: 'bat',
  ini: 'ini', cfg: 'ini', conf: 'ini', properties: 'ini', editorconfig: 'ini', env: 'ini', toml: 'ini',
  yml: 'yaml', yaml: 'yaml',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  clj: 'clojure', ex: 'elixir', exs: 'elixir', hs: 'fsharp', fs: 'fsharp', vb: 'vb',
  proto: 'protobuf', dockerfile: 'dockerfile', tcl: 'tcl', vim: 'plaintext', gitignore: 'plaintext',
  hcl: 'hcl', tf: 'hcl', pug: 'pug', twig: 'twig', liquid: 'liquid', handlebars: 'handlebars', hbs: 'handlebars'
}

/** 无扩展名的特殊文件名 */
const NAME_LANG: Record<string, LangId> = {
  dockerfile: 'dockerfile',
  makefile: 'plaintext',
  '.gitignore': 'plaintext',
  '.npmrc': 'ini',
  '.editorconfig': 'ini',
  '.env': 'ini',
  '.bashrc': 'shell',
  '.zshrc': 'shell',
  '.profile': 'shell'
}

/** 可作为文本编辑/读取的扩展名，其余类型走“预览”模式 */
export const TEXT_EXT_RE =
  /\.(md|markdown|mdx|txt|text|log|csv|tsv|json|jsonc|json5|ya?ml|toml|ini|cfg|conf|properties|env|html?|xml|xsl|svg|plist|js|mjs|cjs|jsx|ts|mts|cts|tsx|css|scss|sass|less|vue|svelte|py|pyw|java|go|rs|rb|php|c|h|cpp|cc|cxx|hpp|hh|cs|kt|kts|swift|scala|dart|lua|pl|pm|r|sh|bash|zsh|ksh|ps1|psm1|bat|cmd|sql|graphql|gql|proto|hcl|tf|clj|ex|exs|fs|vb|tcl|pug|twig|liquid|handlebars|hbs|vim)$/i

/** 无扩展名但属于文本的文件 */
const TEXT_NAMES = /^(dockerfile|makefile|\.gitignore|\.gitattributes|\.npmrc|\.editorconfig|\.env|\.bashrc|\.zshrc|\.profile|license|readme)$/i

/** 该路径是否可用文本编辑器打开（空路径视为可编辑） */
export function isTextPath(path: string): boolean {
  if (!path) return true
  const name = path.split('/').pop() || ''
  if (TEXT_NAMES.test(name)) return true
  return TEXT_EXT_RE.test(name)
}

export function isMarkdownPath(path: string): boolean {
  const name = path.split('/').pop() || ''
  return /\.(md|markdown|mdx)$/i.test(name)
}

export function langFromPath(path: string): LangId {
  const name = (path.split('/').pop() || '').toLowerCase()
  if (NAME_LANG[name]) return NAME_LANG[name]
  const dot = name.lastIndexOf('.')
  if (dot < 0) return 'plaintext'
  return EXT_LANG[name.slice(dot + 1)] || 'plaintext'
}

/** 人类可读的语言名（用于状态栏/提示） */
export function langDisplayName(lang: LangId): string {
  const names: Record<string, string> = {
    plaintext: '纯文本',
    markdown: 'Markdown',
    mdx: 'MDX',
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    json: 'JSON',
    html: 'HTML',
    xml: 'XML',
    css: 'CSS',
    scss: 'SCSS',
    less: 'Less',
    python: 'Python',
    java: 'Java',
    go: 'Go',
    rust: 'Rust',
    ruby: 'Ruby',
    php: 'PHP',
    cpp: 'C/C++',
    csharp: 'C#',
    kotlin: 'Kotlin',
    swift: 'Swift',
    scala: 'Scala',
    dart: 'Dart',
    lua: 'Lua',
    perl: 'Perl',
    r: 'R',
    shell: 'Shell',
    powershell: 'PowerShell',
    bat: 'Batch',
    ini: 'INI/TOML',
    yaml: 'YAML',
    sql: 'SQL',
    graphql: 'GraphQL',
    dockerfile: 'Dockerfile',
    clojure: 'Clojure',
    elixir: 'Elixir',
    fsharp: 'F#',
    vb: 'VB',
    protobuf: 'Protobuf',
    hcl: 'HCL',
    pug: 'Pug',
    twig: 'Twig',
    liquid: 'Liquid',
    handlebars: 'Handlebars',
    'objective-c': 'Objective-C'
  }
  return names[lang] || lang
}

/** 语言 id → Monaco 语言定义注册分片（懒加载，未列出的语言用 plaintext） */
const MONACO_DEFS: Record<string, () => Promise<unknown>> = {
  java: () => import('monaco-editor/esm/vs/languages/definitions/java/register.js'),
  python: () => import('monaco-editor/esm/vs/languages/definitions/python/register.js'),
  go: () => import('monaco-editor/esm/vs/languages/definitions/go/register.js'),
  ini: () => import('monaco-editor/esm/vs/languages/definitions/ini/register.js'),
  yaml: () => import('monaco-editor/esm/vs/languages/definitions/yaml/register.js'),
  shell: () => import('monaco-editor/esm/vs/languages/definitions/shell/register.js'),
  javascript: () => import('monaco-editor/esm/vs/languages/definitions/javascript/register.js'),
  typescript: () => import('monaco-editor/esm/vs/languages/definitions/typescript/register.js'),
  css: () => import('monaco-editor/esm/vs/languages/definitions/css/register.js'),
  scss: () => import('monaco-editor/esm/vs/languages/definitions/scss/register.js'),
  less: () => import('monaco-editor/esm/vs/languages/definitions/less/register.js'),
  html: () => import('monaco-editor/esm/vs/languages/definitions/html/register.js'),
  xml: () => import('monaco-editor/esm/vs/languages/definitions/xml/register.js'),
  sql: () => import('monaco-editor/esm/vs/languages/definitions/sql/register.js'),
  rust: () => import('monaco-editor/esm/vs/languages/definitions/rust/register.js'),
  ruby: () => import('monaco-editor/esm/vs/languages/definitions/ruby/register.js'),
  php: () => import('monaco-editor/esm/vs/languages/definitions/php/register.js'),
  cpp: () => import('monaco-editor/esm/vs/languages/definitions/cpp/register.js'),
  csharp: () => import('monaco-editor/esm/vs/languages/definitions/csharp/register.js'),
  kotlin: () => import('monaco-editor/esm/vs/languages/definitions/kotlin/register.js'),
  swift: () => import('monaco-editor/esm/vs/languages/definitions/swift/register.js'),
  scala: () => import('monaco-editor/esm/vs/languages/definitions/scala/register.js'),
  dart: () => import('monaco-editor/esm/vs/languages/definitions/dart/register.js'),
  lua: () => import('monaco-editor/esm/vs/languages/definitions/lua/register.js'),
  perl: () => import('monaco-editor/esm/vs/languages/definitions/perl/register.js'),
  r: () => import('monaco-editor/esm/vs/languages/definitions/r/register.js'),
  powershell: () => import('monaco-editor/esm/vs/languages/definitions/powershell/register.js'),
  bat: () => import('monaco-editor/esm/vs/languages/definitions/bat/register.js'),
  dockerfile: () => import('monaco-editor/esm/vs/languages/definitions/dockerfile/register.js'),
  clojure: () => import('monaco-editor/esm/vs/languages/definitions/clojure/register.js'),
  elixir: () => import('monaco-editor/esm/vs/languages/definitions/elixir/register.js'),
  fsharp: () => import('monaco-editor/esm/vs/languages/definitions/fsharp/register.js'),
  vb: () => import('monaco-editor/esm/vs/languages/definitions/vb/register.js'),
  protobuf: () => import('monaco-editor/esm/vs/languages/definitions/protobuf/register.js'),
  hcl: () => import('monaco-editor/esm/vs/languages/definitions/hcl/register.js'),
  pug: () => import('monaco-editor/esm/vs/languages/definitions/pug/register.js'),
  twig: () => import('monaco-editor/esm/vs/languages/definitions/twig/register.js'),
  liquid: () => import('monaco-editor/esm/vs/languages/definitions/liquid/register.js'),
  handlebars: () => import('monaco-editor/esm/vs/languages/definitions/handlebars/register.js'),
  graphql: () => import('monaco-editor/esm/vs/languages/definitions/graphql/register.js'),
  'objective-c': () => import('monaco-editor/esm/vs/languages/definitions/objective-c/register.js'),
  markdown: () => import('monaco-editor/esm/vs/languages/definitions/markdown/register.js'),
  mdx: () => import('monaco-editor/esm/vs/languages/definitions/mdx/register.js'),
  tcl: () => import('monaco-editor/esm/vs/languages/definitions/tcl/register.js')
}

/**
 * 语言 id → Monaco 语言服务（editor.api 只带编辑器核心，这几类必须显式注册才有
 * 完整的高亮/括号配对/注释切换/智能提示，等价于 VSCode 网页版对 html css js ts json 的支持）
 */
const MONACO_SERVICES: Record<string, () => Promise<unknown>> = {
  javascript: () => import('monaco-editor/esm/vs/language/typescript/monaco.contribution.js'),
  typescript: () => import('monaco-editor/esm/vs/language/typescript/monaco.contribution.js'),
  json: () => import('monaco-editor/esm/vs/language/json/monaco.contribution.js'),
  css: () => import('monaco-editor/esm/vs/language/css/monaco.contribution.js'),
  scss: () => import('monaco-editor/esm/vs/language/css/monaco.contribution.js'),
  less: () => import('monaco-editor/esm/vs/language/css/monaco.contribution.js'),
  html: () => import('monaco-editor/esm/vs/language/html/monaco.contribution.js')
}

/** 语言 id → 加载结果（同一语言只加载一次，失败也不重复尝试） */
const monacoLoading = new Map<string, Promise<void>>()

/** Monaco 中真正可用的语言 id（未知语言回退 plaintext） */
export function monacoLangId(lang: LangId): string {
  return lang === 'plaintext' ? 'plaintext' : lang
}

/**
 * 按需加载 Monaco 语言：html/css/js/ts/json 走语言服务，其余（java/python/go/ini/yaml/bat/
 * markdown/xml/sql/shell/powershell…）走 monarch 基础分片；服务加载失败会退回 monarch，
 * 保证至少有色。
 */
export function ensureMonacoLanguage(lang: LangId): Promise<void> {
  const cached = monacoLoading.get(lang)
  if (cached) return cached
  const task = (async () => {
    // 注意：Monaco 0.57 把「语言 id 注册」（languages/definitions/**/register.js）
    // 和「语言服务」（languages/features/**）拆开了，服务模块本身不再调用 registerLanguage。
    // 以前这里 service 成功后直接 return，导致 javascript/html/css 等模型一直停在
    // plaintext（高亮/补全都失效）。所以两者都要加载，不能二选一。
    const service = MONACO_SERVICES[lang]
    if (service) {
      try {
        await service()
      } catch {
        /* 语言服务不可用（如 worker 被宿主拦截）→ 至少保留 monarch 着色 */
      }
    }
    const def = MONACO_DEFS[lang]
    if (def) {
      try {
        await def()
      } catch {
        /* 未内置的语言保持 plaintext，不影响编辑 */
      }
    }
  })()
  monacoLoading.set(lang, task)
  return task
}

/** CodeMirror：可用的语言扩展（懒加载，缺少的包自动忽略） */
export async function codemirrorLangFor(lang: LangId): Promise<unknown | null> {
  try {
    switch (lang) {
      case 'markdown':
      case 'mdx': {
        const m = await import('@codemirror/lang-markdown')
        return m.markdown()
      }
      case 'html':
      case 'xml':
      case 'vue': {
        const m = await import('@codemirror/lang-html')
        return m.html()
      }
      case 'css':
      case 'scss':
      case 'less': {
        const m = await import('@codemirror/lang-css')
        return m.css()
      }
      case 'javascript':
      case 'typescript': {
        const m = await import('@codemirror/lang-javascript')
        return m.javascript({ typescript: lang === 'typescript', jsx: true })
      }
      default:
        return null
    }
  } catch {
    return null
  }
}
