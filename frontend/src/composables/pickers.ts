import { reactive } from 'vue'

/**
 * 工作区内的路径选择对话框（对应系统「打开文件夹 / 另存为」）：
 * 手机端与浏览器里没有原生目录/保存对话框，用这套对话框让用户选位置。
 */
export type PathPickMode = 'folder' | 'save'

interface PathPickState {
  active: boolean
  mode: PathPickMode
  title: string
  message: string
  /** save 模式的默认文件名 */
  fileName: string
  /** 确认后的回调（由组件触发 pathPickDone） */
  finish: (path: string | null) => void
}

const state = reactive<PathPickState>({
  active: false,
  mode: 'folder',
  title: '',
  message: '',
  fileName: '',
  finish: () => {}
})

export const pathPickState = state

/** 在工作区内选择一个文件夹作为工作区；取消返回 null，根目录返回 '/' */
export function pickFolder(opts: { title?: string; message?: string } = {}): Promise<string | null> {
  return new Promise(resolve => {
    state.active = true
    state.mode = 'folder'
    state.title = opts.title ?? '打开文件夹'
    state.message = opts.message ?? '选择工作区内的一个文件夹；进入后点「打开」即可把它作为当前工作区'
    state.fileName = ''
    state.finish = path => {
      state.active = false
      resolve(path)
    }
  })
}

/** 选择保存位置并确认文件名，返回工作区内的相对路径；取消返回 null */
export function pickSaveLocation(
  defaultName: string,
  opts: { title?: string; message?: string } = {}
): Promise<string | null> {
  return new Promise(resolve => {
    state.active = true
    state.mode = 'save'
    state.title = opts.title ?? '选择保存位置'
    state.message = opts.message ?? '文件保存在 App 工作区内，可在文件树中直接打开'
    state.fileName = defaultName
    state.finish = path => {
      state.active = false
      resolve(path)
    }
  })
}

/** 对话框点「确定 / 取消」时调用；null 表示取消 */
export function pathPickDone(path: string | null) {
  const finish = state.finish
  state.finish = () => {}
  finish(path)
}
