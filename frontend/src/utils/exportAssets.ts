import { bridge } from '../bridge'

/**
 * 导出时的图片内联：
 * 导出的 HTML / DOC / PDF 一旦离开本程序，正文里的 `/assets/xxx.png` 就没人再解析了 ——
 * 桌面端靠 AssetServer 中间件映射工作区目录才显示得出来，所以必须把图片塞成 data URL。
 */

/** 只处理"本地资源"引用；data:、blob:、http(s):、协议相对、锚点一律原样保留 */
function isLocalRef(src: string): boolean {
  return !!src && !/^(data:|blob:|https?:|\/\/|mailto:|tel:|#)/i.test(src)
}

/**
 * 把 markdown 里的相对路径解析成工作区路径：
 * `/assets/a.png` 原样返回；`a.png`、`./a.png`、`../img/a.png` 按当前文件所在目录解析。
 */
export function toWorkspacePath(src: string, currentPath: string): string {
  const s = src.trim()
  if (!s) return ''
  if (s.startsWith('/')) return s // 已是工作区根路径
  if (/^[a-zA-Z]:[\\/]/.test(s)) return s // Windows 绝对路径

  const dir = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/')) : ''
  const out: string[] = []
  for (const seg of `${dir}/${s}`.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return `/${out.join('/')}`
}

/**
 * 把 markdown 里的图片/链接相对路径改写成工作区根路径（`/dir/x.png`）。
 * 只给 pandoc 引擎用：pandoc 拿到的是临时目录里的 md，而 work 目录是 workspace 根，
 * Go 侧只会把 `](/` 开头的改写成绝对路径，相对路径（`./a.png`）它认不出来。
 */
export function normalizeMediaLinks(content: string, currentPath: string): string {
  return content.replace(/(!?\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g, (m, pre: string, src: string, post: string) => {
    if (!isLocalRef(src) || src.startsWith('/')) return m
    const p = toWorkspacePath(src, currentPath)
    return p ? `${pre}${p}${post}` : m
  })
}

export interface InlineResult {
  html: string
  /** 读不到的图片数量（文件被删、路径写错），调用方可以据此提示用户 */
  failed: number
}

/** 把渲染结果里的本地图片换成 data URL；读不到的保持原样并计数 */
export async function inlineLocalImages(html: string, currentPath: string): Promise<InlineResult> {
  if (!html.includes('<img')) return { html, failed: 0 }

  // 用 DOM 解析而不是正则替换：md 里图片属性顺序、单双引号都不固定
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const imgs = Array.from(doc.querySelectorAll('img'))
  if (!imgs.length) return { html, failed: 0 }

  const cache = new Map<string, string>()
  let failed = 0
  await Promise.all(
    imgs.map(async (img) => {
      const raw = img.getAttribute('src') || ''
      if (!isLocalRef(raw)) return
      const path = toWorkspacePath(raw, currentPath)
      let data = cache.get(path)
      if (data === undefined) {
        try {
          data = await bridge.readAssetDataUrl(path)
        } catch {
          data = ''
        }
        cache.set(path, data)
      }
      if (data) img.setAttribute('src', data)
      else failed++
    })
  )
  return { html: doc.body ? doc.body.innerHTML : html, failed }
}
