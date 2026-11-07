import { uiConfirm } from '../composables/dialogs'
import { isTextFile, useWorkspace } from '../stores/workspace'
import { richModeRisks } from './markdownSafety'

/**
 * 编辑模式切换的统一入口（PC 的编辑区容器与手机底部模式条共用）。
 *
 * 之前两处各自直接把 settings.editorMode 改掉，导致：
 * 1. 手机 / PC 换到源码或富文本时，靠「组件重挂」同步内容，逻辑分散；
 * 2. 含表格等富文本不支持语法的内容被静默改写。
 * 现在把校验、风险提示和实际写入收在这一个函数里。
 */
export type EditMode = 'tiptap' | 'codemirror' | 'split' | 'preview'

/**
 * 已经选过「仍用富文本」的那个文件。
 * 全局只记一次会被用光：换一个含表格的文件进来就静默改写了，所以按当前路径记。
 */
let riskAcceptedPath = ''

/**
 * 切到目标模式。
 * @returns 真正生效的模式；返回 null 表示被拒绝（文件类型不支持编辑）
 */
export async function switchEditMode(want: EditMode): Promise<EditMode | null> {
  const ws = useWorkspace()
  if (want !== 'preview' && !isTextFile(ws.currentPath)) {
    ws.notify('该文件类型只能预览，不能编辑')
    return null
  }
  let target = want
  if (target === 'tiptap' && riskAcceptedPath !== ws.currentPath) {
    const risks = richModeRisks(ws.content)
    if (risks.length) {
      const keepRich = await uiConfirm({
        title: '富文本会改动内容',
        message:
          `这份文档里有富文本模式无法完整保留的语法：${risks.join('、')}。\n` +
          '进入富文本后只要编辑过，这些内容就会被改写或整块丢失（表格、脚注等不会还原）。\n' +
          '建议改用「源码」模式编辑这份文件。',
        okText: '仍用富文本编辑',
        cancelText: '改用源码模式'
      })
      // 取消（含 Esc / 关闭）＝走安全的源码模式
      if (!keepRich) target = ws.settings.enableMonaco ? 'split' : 'codemirror'
      else riskAcceptedPath = ws.currentPath
    }
  }
  await ws.updateSetting('editorMode', target)
  return target
}
