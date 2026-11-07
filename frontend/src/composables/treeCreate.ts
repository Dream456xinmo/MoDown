/** VSCode 风格文件树内联新建状态 */
export interface InlineCreate {
  kind: 'file' | 'dir'
  /** 目标父目录（'' = 工作区根） */
  parent: string
  value: string
}

export const INLINE_STATE_KEY = 'inlineCreate'
export const INLINE_ACTIONS_KEY = 'inlineCreateActions'
