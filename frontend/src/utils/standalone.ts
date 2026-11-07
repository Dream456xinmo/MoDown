/**
 * 导出用的独立 HTML 封装（内联主题样式 + 可选悬浮大纲 + 代码块复制脚本）
 */
import { buildOutlineTree, extractHeadings, type ONode } from './outline'

const EXPORT_BASE_CSS = `
  :root { --fg:#24292f; --fg-dim:#57606a; --border:#d8dce1; --accent:#4f46e5; --code-bg:#f3f4f6; --bg-active:#e0e7ff; }
  .dark { --fg:#e6e8ea; --fg-dim:#9aa0a8; --border:#3c3e44; --accent:#818cf8; --code-bg:#2c2e33; --bg-active:#2d3550; }
  body { margin: 2rem auto; max-width: 72ch; padding: 0 1rem; color: var(--fg); background: #fff; }
  body.dark { background: #1e1f23; color: var(--fg); }
  @page { margin: 18mm 15mm; }
  @media print { body { margin: 0; } a { color: inherit; text-decoration: none; } }
  /* 代码块：整块共用一条外边框，顶部语言栏只画分隔线 */
  .md-code-block { position: relative; margin: .9em 0; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .md-code-head {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    min-height: 28px; padding: 4px 10px; font-size: 11.5px; color: var(--fg-dim);
    background: #f6f8fa; border: none; border-bottom: 1px solid var(--border);
    border-radius: 0;
  }
  .dark .md-code-head { background: #161b22; border-bottom-color: #30363d; color: #8b949e; }
  .md-code-lang { font-family: "Cascadia Code", Consolas, monospace; user-select: none; }
  .md-code-block > pre { margin: 0 !important; border-radius: 0 !important; }
  .md-code-head .code-copy {
    padding: 1px 8px; font-size: 11.5px;
    color: var(--fg-dim); background: rgba(255,255,255,.86);
    border: 1px solid var(--border); border-radius: 6px;
    cursor: pointer; opacity: .85;
  }
  .md-code-head .code-copy:hover, .md-code-head .code-copy:focus { opacity: 1; }
  .dark .md-code-head .code-copy { background: rgba(255,255,255,.06); color: #8b949e; border-color: #30363d; }
  .code-copy.copied { color: #16a34a; border-color: #16a34a; }
  @media print { .code-copy { display: none !important; } }
  /* 右侧悬浮大纲：可展开/收缩，锚点跳转；打印时隐藏（PDF 书签由引擎生成） */
  .xmd-toc { position: fixed; right: 16px; top: 52px; z-index: 99; font-size: 13px; max-width: 280px; }
  .xmd-toc-toggle { cursor: pointer; border: 1px solid var(--border); background: #fff; color: var(--fg);
    border-radius: 8px; padding: 4px 10px; font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
  .xmd-toc-panel { margin-top: 6px; border: 1px solid var(--border); border-radius: 10px; background: #fff;
    box-shadow: 0 6px 24px rgba(0,0,0,.12); padding: 10px 12px; max-height: calc(100vh - 110px); overflow: auto; }
  .xmd-toc.collapsed .xmd-toc-panel { display: none; }
  .xmd-toc details { margin: 2px 0 2px 10px; }
  .xmd-toc summary { cursor: pointer; list-style: none; }
  .xmd-toc summary::-webkit-details-marker { display: none; }
  .xmd-toc summary::before { content: '▸'; display: inline-block; width: 12px; color: var(--fg-dim); transition: transform .15s; }
  .xmd-toc details[open] > summary::before { transform: rotate(90deg); }
  .xmd-toc a { color: var(--accent); text-decoration: none; }
  .xmd-toc a:hover { text-decoration: underline; }
  @media print { .xmd-toc { display: none; } }
`

/** 导出 HTML 中的代码复制脚本（无外部依赖，失败静默） */
const COPY_SCRIPT = `
<script>
(function () {
  function copyText(text, btn) {
    var done = function () { btn.textContent = '已复制'; btn.classList.add('copied'); setTimeout(function () { btn.textContent = '复制'; btn.classList.remove('copied') }, 1200) };
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, fallback); return }
    fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done() } catch (e) {}
      document.body.removeChild(ta);
    }
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    while (t && t !== document.body && !(t.classList && t.classList.contains('code-copy'))) t = t.parentNode;
    if (!t || t === document.body) return;
    var block = t.closest ? t.closest('.md-code-block') : null;
    var pre = block && block.querySelector('pre');
    if (pre) copyText(pre.innerText, t);
  });
})();
</script>`

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 右侧悬浮大纲：嵌套 details 树，每级可独立展开/收缩 */
function buildTocHtml(mdText: string): string {
  const roots = buildOutlineTree(extractHeadings(mdText))
  if (!roots.length) return ''
  const render = (nodes: ONode[]): string =>
    nodes
      .map(n => {
        const link = `<a href="#${n.h.slug}">${escapeHtml(n.h.text)}</a>`
        return n.children.length
          ? `<details open><summary>${link}</summary>${render(n.children)}</details>`
          : `<details style="pointer-events:auto"><summary style="cursor:default">${link}</summary></details>`
      })
      .join('\n')
  return `<nav class="xmd-toc" id="xmdToc">
  <button class="xmd-toc-toggle" onclick="document.getElementById('xmdToc').classList.toggle('collapsed')">☰ 大纲</button>
  <div class="xmd-toc-panel">${render(roots)}</div>
</nav>`
}

export interface StandaloneOptions {
  mdTheme?: string
  /** 'none' 无目录（PDF/DOC 由引擎书签/样式原生支持大纲）；'float' 右侧悬浮可折叠大纲 */
  tocMode?: 'none' | 'float'
  /** 是否输出代码块复制按钮与脚本 */
  copy?: boolean
  /** 导出时的深浅色：跟随应用主题，主题只选基础风格，深色自动切换 */
  dark?: boolean
}

/**
 * 生成独立完整 HTML（导出用）：正文 HTML 由渲染线程产出，这里只做封装。
 */
export async function buildStandaloneHtml(
  title: string,
  bodyHtml: string,
  mdText: string,
  opts: StandaloneOptions = {}
): Promise<string> {
  const mdTheme = opts.mdTheme || 'default'
  let themeCss = ''
  try {
    const mod = await import('../styles/md-themes.css?inline')
    themeCss = (mod.default || '').toString()
  } catch {
    /* 构建环境拿不到内联 CSS 时退化为浏览器默认样式 */
  }
  const toc = opts.tocMode === 'float' ? buildTocHtml(mdText) : ''
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<style>${EXPORT_BASE_CSS}</style>
<style>${themeCss}</style>
</head>
<body class="${opts.dark ? 'dark' : ''}">
<div class="md-scope md-theme-${escapeHtml(mdTheme)}" style="padding:0">
  ${toc}
  <div class="md-body">
${bodyHtml}
  </div>
</div>
${opts.copy ? COPY_SCRIPT : ''}
</body>
</html>`
}
