/**
 * 富文本模式的「内容安全」检测。
 *
 * 富文本是「Markdown 解析 → 文档模型 → 再序列化」的往返，模型里没有的语法不会被还原：
 * 表格、脚注、任务列表、原始 HTML 标签、YAML 头部，都会在第一次敲字时被改写或整块丢掉。
 * 直接丢数据比「不能用」更糟，所以切进富文本前先粗判一下，让用户选择改用源码模式。
 *
 * 这里只做保守的文本级判断：先剥掉代码围栏与行内代码，免得把示例代码里的 `|`、`<div>` 当成风险。
 */

/** 去掉代码块与行内代码，只留「会被富文本改写」的正文 */
function stripCode(md: string): string {
  const out: string[] = []
  let fence = ''
  for (const line of md.split('\n')) {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (m) {
      const marker = m[1][0]
      if (!fence) {
        fence = marker
        out.push('')
        continue
      }
      if (fence === marker) {
        fence = ''
        out.push('')
        continue
      }
    }
    out.push(fence ? '' : line)
  }
  return out.join('\n').replace(/`[^`\n]*`/g, '')
}

/**
 * 返回会被富文本改动/丢弃的语法名（空数组＝安全）。
 * 顺序按「丢了最心疼」排：表格 → 脚注 → 任务列表 → 原始 HTML → YAML 头部。
 */
export function richModeRisks(md: string): string[] {
  const text = (md || '').trim()
  if (!text) return []
  const body = stripCode(md)
  const risks: string[] = []

  // 表格：分隔行（| --- | :-: |）最可靠，其次是有两列以上竖线的行
  if (/^\s*\|?[\s:]*-{2,}[\s:]*(\|[\s:]*-{2,}[\s:]*)+\|?\s*$/m.test(body) || /^\s*\S.*\|.*\|\s*$/m.test(body)) {
    risks.push('表格')
  }
  // 脚注
  if (/\[\^[^\]\n]+\]/.test(body)) risks.push('脚注')
  // 任务列表
  if (/^\s*[-*+]\s+\[[ xX]\]\s+/m.test(body)) risks.push('任务列表')
  // 原始 HTML 标签（富文本按 html:false 解析，标签会变成普通文字或被吃掉）
  if (/<\/?[a-z][a-z0-9-]*(\s[^>]*)?>/i.test(body)) risks.push('原始 HTML')
  // YAML 头部
  if (/^\s*---\s*\n[\s\S]{0,800}?\n---\s*(\n|$)/.test(md)) risks.push('YAML 头部')

  return risks
}
