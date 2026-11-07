import type { Heading } from './outline'
import { slugify } from './outline'

/**
 * HTML 文件预览的预处理与大纲提取。
 *
 * 为什么不能直接把原始 HTML 塞进 iframe：
 * 1. `srcdoc` 里文档基准 URL 是 `about:srcdoc`，点 `<a href="#锚点">` 会被当成
 *    **跨文档导航**（`about:srcdoc#锚点` 是新文档）→ iframe 变空白 = 「点大纲白屏」。
 *    所以这里改用 **Blob URL** 作为 iframe 地址：`blob:…#锚点` 是同文档片段导航，正常滚动。
 * 2. 缺 viewport meta 时移动端按 980px 宽渲染，整页缩成一小块。
 * 3. 相对链接（`./a.md`、`assets/x.png` 的页面链接）在 blob 基址下解析成 `blob:…/a.md`，
 *    点了同样白屏；沙箱里的 opaque origin 也读不到应用 localStorage，
 *    所以必须拦下来交给外层界面处理。
 */

/** 注入到预览文档里的脚本：锚点滚动、大纲跳转、链接拦截（全程无中文字面量，避免转码踩坑） */
const PREVIEW_SCRIPT = `<script>(function(){
var IN_VIEWER = true;
function byIdOrText(id, text){
  var el = null;
  try { el = document.getElementById(id); } catch (e) {}
  if (el) return el;
  if (!text) return null;
  var hs = document.querySelectorAll('h1,h2,h3,h4,h5,h6');
  for (var i = 0; i < hs.length; i++) {
    var t = (hs[i].textContent || '').trim();
    if (t === text) return hs[i];
    var kid = hs[i].getAttribute('id');
    if (kid && kid === id) return hs[i];
  }
  var all = document.querySelectorAll('[id]');
  for (var j = 0; j < all.length; j++) {
    if (all[j].id === id) return all[j];
  }
  return null;
}
function scrollToHeading(msg){
  var el = byIdOrText(String(msg.slug || ''), String(msg.text || ''));
  if (!el) { try { parent.postMessage({ __xmd: 1, type: 'xmd-goto-miss' }, '*'); } catch (e) {} return; }
  try { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { el.scrollIntoView(); }
}
window.addEventListener('message', function (ev) {
  var d = ev.data;
  if (d && d.__xmd === 1 && d.type === 'xmd-goto') scrollToHeading(d);
});
/* 给没有 id 的标题补一个：保证导出页 / 手写页的锚点都能定位 */
function ensureIds(){
  var hs = document.querySelectorAll('h1,h2,h3,h4,h5,h6');
  for (var i = 0; i < hs.length; i++) {
    var h = hs[i];
    if (!h.getAttribute('id')) {
      h.setAttribute('id', 'xmd-h-' + i);
      if (!h.getAttribute('data-xmd-index')) h.setAttribute('data-xmd-index', String(i));
    }
  }
}
document.addEventListener('click', function (e) {
  var a = e.target && e.target.closest ? e.target.closest('a') : null;
  if (!a) return;
  var href = a.getAttribute('href') || '';
  /* 纯锚点：自己滚动，绝不让文档导航（srcdoc / blob 下都可能变成跨文档跳转） */
  if (href.charAt(0) === '#') {
    e.preventDefault();
    var id = decodeURIComponent(href.slice(1));
    scrollToHeading({ slug: id, text: (a.textContent || '').trim() });
    return;
  }
  if (!href || href === 'javascript:void(0)' || /^javascript:/i.test(href)) { e.preventDefault(); return; }
  if (/^(https?:|mailto:|tel:)/i.test(href)) {
    /* 外链交给外壳用系统浏览器打开 */
    e.preventDefault();
    try { parent.postMessage({ __xmd: 1, type: 'xmd-link', href: a.href }, '*'); } catch (err) {}
    return;
  }
  /* 相对路径：blob 基址下必然 404，拦下来报告 */
  e.preventDefault();
  try { parent.postMessage({ __xmd: 1, type: 'xmd-blocked', href: href }, '*'); } catch (err) {}
}, true);
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function(){ ensureIds(); parent.postMessage({ __xmd: 1, type: 'xmd-ready' }, '*'); });
} else {
  ensureIds();
  parent.postMessage({ __xmd: 1, type: 'xmd-ready' }, '*');
}
})();</script>`

/** 是否 HTML 类文件（大纲要按标签抽、预览要按文档渲染） */
export function isHtmlPath(path: string): boolean {
  return /\.x?html?$/i.test(path || '')
}

/** 在 `</head>` 前（没有则插到最前）注入片段 */
function injectHead(html: string, snippet: string): string {
  const m = /<head[^>]*>/i.exec(html)
  if (m) {
    const at = m.index + m[0].length
    return html.slice(0, at) + snippet + html.slice(at)
  }
  const body = /<body[^>]*>/i.exec(html)
  if (body) return snippet + html.slice(0, body.index) + html.slice(body.index)
  return snippet + html
}

/**
 * 生成可安全放进 iframe 的预览 HTML。
 * @param raw 原始 HTML 文本
 * @param withOutline 是否注入「把大纲同步给外壳」的脚本（外壳据此显示可用的大纲）
 */
export function buildPreviewHtml(raw: string, withOutline: boolean): string {
  let html = raw
  // 1) viewport：缺了它手机上会按 980px 缩放渲染
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) {
    html = injectHead(html, '<meta name="viewport" content="width=device-width, initial-scale=1">')
  }
  // 2) 拦截脚本（必须在正文脚本之前跑，用捕获阶段监听点击）
  html = injectHead(html, PREVIEW_SCRIPT)
  if (withOutline) html = injectHead(html, OUTLINE_SCRIPT)
  return html
}

/** 把预览文档里的标题上报给外壳，让「大纲」面板对 HTML 文件也可用 */
const OUTLINE_SCRIPT = `<script>(function(){
function collect(){
  var hs = document.querySelectorAll('h1,h2,h3,h4,h5,h6');
  var out = [];
  for (var i = 0; i < hs.length; i++) {
    var h = hs[i];
    out.push({
      level: parseInt(h.tagName.slice(1), 10) || 1,
      text: (h.textContent || '').replace(/\\s+/g, ' ').trim(),
      line: i,
      slug: h.getAttribute('id') || ('xmd-h-' + i)
    });
  }
  return out;
}
function report(){
  try { parent.postMessage({ __xmd: 1, type: 'xmd-headings', items: collect() }, '*'); } catch (e) {}
}
window.__xmdReportOutline = report;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', report);
else report();
})();</script>`

/** 从 HTML 源码里抽大纲（不执行脚本，纯静态解析，用于 Worker 里的同步提取） */
export function extractHtmlHeadings(html: string): Heading[] {
  // 去掉 script / style / 注释，避免把 JS 里的字符串当成标题
  const clean = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style[\s\S]*?<\/style\s*>/gi, '')
  const re = /<h([1-6])([^>]*)>([\s\S]*?)<\/h\1\s*>/gi
  const out: Heading[] = []
  let m: RegExpExecArray | null
  let index = 0
  while ((m = re.exec(clean)) && index < 500) {
    const text = m[3]
      .replace(/<[^>]*>/g, '')
      .replace(/&[a-z]+;|&#\d+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!text) continue
    const idm = /\bid\s*=\s*("([^"]*)"|'([^']*)')/i.exec(m[2])
    const id = idm ? (idm[2] ?? idm[3] ?? '') : ''
    out.push({
      level: Number(m[1]) || 1,
      text,
      line: index,
      slug: id || slugify(text, index)
    })
    index++
  }
  return out
}
