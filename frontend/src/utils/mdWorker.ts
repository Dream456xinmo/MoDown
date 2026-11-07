/**
 * 渲染线程客户端
 *
 * Markdown 解析 + 代码高亮（markdown-it / highlight.js）与打开文件后的文本统计
 * 全部放到 Web Worker 中执行，主线程只做 DOM 更新，因此：
 *  1. 打开大文件 / 渲染长文档时界面不会卡住（左下角加载动画仍能转动）；
 *  2. markdown-it / highlight.js 只在 worker 分片中出现，首屏主包更小。
 *
 * Worker 不可用（老内核 / 被 CSP 限制）时自动降级：
 *  - 渲染：动态导入本地解析器在主线程执行；
 *  - 统计：主线程轻量计算。
 */
import { extractHeadings, type Heading } from './outline'

export interface TextStats {
  chars: number
  lines: number
  words: number
  headings: Heading[]
}

interface Pending {
  ok: (value: any) => void
  fail: (err: Error) => void
  timer: number
}

const REQUEST_TIMEOUT = 15000

let worker: Worker | null = null
let workerBroken = false
let seq = 0
const pending = new Map<number, Pending>()

function ensureWorker(): Worker | null {
  if (worker) return worker
  if (workerBroken) return null
  try {
    const w = new Worker(new URL('../workers/md.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; result?: any; error?: string }>) => {
      const item = pending.get(e.data.id)
      if (!item) return
      pending.delete(e.data.id)
      window.clearTimeout(item.timer)
      if (e.data.ok) item.ok(e.data.result)
      else item.fail(new Error(e.data.error || 'worker 执行失败'))
    }
    w.onerror = () => {
      workerBroken = true
      worker = null
      try {
        w.terminate()
      } catch {
        /* ignore */
      }
      flushPending(new Error('渲染线程不可用'))
    }
    worker = w
    return w
  } catch {
    workerBroken = true
    return null
  }
}

function flushPending(err: Error) {
  pending.forEach(item => {
    window.clearTimeout(item.timer)
    item.fail(err)
  })
  pending.clear()
}

function request<T>(payload: Record<string, unknown>): Promise<T> {
  const w = ensureWorker()
  if (!w) return Promise.reject(new Error('渲染线程不可用'))
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id)
      reject(new Error('渲染线程响应超时'))
    }, REQUEST_TIMEOUT)
    pending.set(id, { ok: resolve, fail: reject, timer })
    w.postMessage({ id, ...payload })
  })
}

/**
 * 主线程降级渲染：纯文本安全转义。
 * 刻意不引入 markdown-it（否则会在主包中重复打包一份解析器，几百 KB），
 * 渲染线程不可用时至少能完整、安全地看到原文。
 */
function plainFallback(md: string): string {
  const esc = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<pre class="md-fallback">${esc}</pre>`
}

/**
 * 渲染 Markdown 为 HTML（异步，走渲染线程）
 * @param copy 代码块输出复制按钮
 */
export async function renderMarkdown(md: string, copy = false): Promise<string> {
  if (!md) return ''
  try {
    return await request<string>({ type: 'render', md, copy })
  } catch (e) {
    if (!workerBroken) console.warn('[xmd] 渲染线程异常，降级为纯文本：', e)
    return plainFallback(md)
  }
}

/** 打开文件后的文本统计 + 大纲（异步，走渲染线程） */
export async function analyzeText(text: string): Promise<TextStats> {
  try {
    return await request<TextStats>({ type: 'analyze', text })
  } catch {
    const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
    return {
      chars: normalized.length,
      lines: normalized.length ? normalized.split('\n').length : 0,
      words: normalized ? normalized.split(/\s+/).filter(Boolean).length : 0,
      headings: extractHeadings(normalized)
    }
  }
}
