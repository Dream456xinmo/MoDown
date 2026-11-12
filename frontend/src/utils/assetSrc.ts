/**
 * 把 Markdown / 文件树里的相对资源路径解析成 WebView 能直接加载的地址。
 *
 * 各平台差异：
 * - 桌面 Wails：`assetUrl()` 返回 `/raw/...`，由 Go AssetServer 直接读工作区；
 * - 浏览器 / 安卓本地工作区：返回 blob URL 或 data URL；
 * - 鸿蒙：沙箱文件不能直接给 file://，返回 data URL；
 * - 安卓系统目录（SAF）：content:// 不能当 <img src>，`assetUrl()` 为空，
 *   这里再异步读成 data URL。
 *
 * 结果按路径缓存：预览每次重新渲染都会重新查图片，不缓存的话大图会被反复读盘。
 */
import { bridge } from '../bridge'

const cache = new Map<string, Promise<string>>()

/** 外部地址（http / data / blob / file / content / //）保持原样 */
function isExternal(src: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)
}

/** 相对路径 → 工作区绝对路径（`/dir/a.md` + `./img.png` → `/dir/img.png`） */
export function normalizeAssetPath(src: string, currentPath = ''): string {
  if (!src) return ''
  if (isExternal(src)) return src
  let p = src
  try {
    p = decodeURIComponent(p)
  } catch {
    /* 保持原样 */
  }
  if (p.startsWith('/')) return p
  const base = currentPath.includes('/') ? currentPath.slice(0, currentPath.lastIndexOf('/')) : ''
  const out: string[] = []
  for (const seg of `${base}/${p}`.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') out.pop()
    else out.push(seg)
  }
  return '/' + out.join('/')
}

/** 解析单张图片地址；失败时回退原 src，至少不阻断渲染 */
export function resolveAssetSrc(src: string, currentPath = ''): Promise<string> {
  const path = normalizeAssetPath(src, currentPath)
  if (!path) return Promise.resolve(src)
  if (isExternal(path)) return Promise.resolve(path)
  const hit = cache.get(path)
  if (hit) return hit
  const task = (async () => {
    try {
      const direct = bridge.assetUrl(path)
      if (direct) return direct
      const data = await bridge.readAssetDataUrl(path)
      return data || src
    } catch {
      return src
    }
  })()
  cache.set(path, task)
  return task
}

/** 工作区切换后清缓存：同一个 `/assets/x.png` 在不同目录里可能是两张图 */
export function clearAssetSrcCache() {
  cache.clear()
}

/** 预览 v-html 渲染完成后，把里面所有相对图片 src 换成可加载地址 */
export async function resolveImagesIn(root: ParentNode, currentPath: string): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'))
  await Promise.all(
    imgs.map(async img => {
      const src = img.getAttribute('src') || ''
      if (!src || /^(?:data:|blob:|https?:|file:|\/\/)/i.test(src)) return
      const resolved = await resolveAssetSrc(src, currentPath)
      if (resolved && img.getAttribute('src') === src) img.src = resolved
    })
  )
}
