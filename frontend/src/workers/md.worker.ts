/// <reference lib="webworker" />
/**
 * 渲染线程：承载 Markdown 解析/高亮 与 打开文件后的文本统计。
 * 主线程只负责 DOM，避免大文件打开或超大 Markdown 渲染时界面卡死。
 */
import { renderPreview } from '../utils/mdParse'
import { extractHeadings, type Heading } from '../utils/outline'

export interface TextStats {
  chars: number
  lines: number
  words: number
  headings: Heading[]
}

interface WorkerRequest {
  id: number
  type: 'render' | 'analyze'
  md?: string
  text?: string
  copy?: boolean
}

function analyze(text: string): TextStats {
  // 规范化：去 BOM / 统一换行，仅用于统计，不改变编辑器内容
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = normalized.length ? normalized.split('\n').length : 0
  const words = normalized ? normalized.split(/\s+/).filter(Boolean).length : 0
  return {
    chars: normalized.length,
    lines,
    words,
    headings: extractHeadings(normalized)
  }
}

const ctx = self as unknown as DedicatedWorkerGlobalScope

ctx.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, type } = e.data
  try {
    if (type === 'render') {
      ctx.postMessage({ id, ok: true, result: renderPreview(e.data.md || '', { copy: !!e.data.copy }) })
      return
    }
    ctx.postMessage({ id, ok: true, result: analyze(e.data.text || '') })
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: String((err as any)?.message ?? err) })
  }
}
