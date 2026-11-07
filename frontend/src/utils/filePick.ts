/**
 * 浏览器 / WebView 里的文件选择与文件名处理。
 * Capacitor 的 WebView 实现了 onShowFileChooser，所以 <input type="file"> 在安卓真机上也能用，
 * mock 桥与 android 桥共用这里的实现。
 */

/** 用隐藏 file input 模拟原生文件选择；用户取消返回 null */
export function pickBrowserFile(accept: string): Promise<File | null> {
  return new Promise(res => {
    const input = document.createElement('input')
    input.type = 'file'
    if (accept) input.accept = accept
    input.style.display = 'none'
    input.onchange = () => res(input.files?.[0] ?? null)
    // 取消选择无统一事件：窗口重新聚焦时未选到文件则视为取消
    const onFocus = () => {
      setTimeout(() => {
        if (!input.files?.length) res(null)
      }, 400)
      window.removeEventListener('focus', onFocus)
    }
    window.addEventListener('focus', onFocus)
    document.body.appendChild(input)
    input.click()
    setTimeout(() => input.remove(), 30000)
  })
}

/** 去掉各平台文件系统都不接受的字符 */
export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_')
}

/** File → data URL（二进制资源落盘用） */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(r.error || new Error('读取文件失败'))
    r.readAsDataURL(file)
  })
}

/**
 * 同名时让路：`a.md` → `a-1.md`、`a-2.md`。
 * exists 由调用方提供（各平台的「已存在」判断方式不同）。
 */
export function uniqueName(name: string, exists: (candidate: string) => boolean): string {
  if (!exists(name)) return name
  const extMatch = /\.[^.]+$/.exec(name)
  const ext = extMatch ? extMatch[0] : ''
  const stem = ext ? name.slice(0, -ext.length) : name
  for (let i = 1; i < 1000; i++) {
    const candidate = `${stem}-${i}${ext}`
    if (!exists(candidate)) return candidate
  }
  return `${stem}-${Date.now() % 100000}${ext}`
}
