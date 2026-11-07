import { ref } from 'vue'

/**
 * 拖外部文件到文件树上的落点（VSCode 资源管理器语义）：
 * null＝没停在文件树上（按"打开文件"处理）；''＝工作区根目录；'/notes'＝某个文件夹。
 */
export type DropDir = string | null

/**
 * 拖动过程中将要落进的目录。单例状态：App.vue 在 dragover 里写，TreeItem/FileTree 读来做高亮。
 * （Wails 只给了 drop 事件，拖拽途中的反馈得自己听 dragover，见 App.vue 的 onDragOver）
 */
export const dropDir = ref<DropDir>(null)

/**
 * 命中测试：屏幕坐标 → 要复制进哪个目录。
 * x/y 为视口 CSS 像素（Wails 拖拽事件给的就是 MouseEvent.x/y，能直接喂给 elementFromPoint）。
 */
export function treeDirAt(x: number, y: number): DropDir {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  if (!el?.closest('.file-tree')) return null // 不在文件树里 → 按"打开"处理
  const row = el.closest('.tree-row') as HTMLElement | null
  const path = row?.dataset.path || ''
  if (!path) return '' // 树里的空白处 → 根目录
  if (row!.dataset.dir === '1') return path
  const i = path.lastIndexOf('/')
  return i > 0 ? path.slice(0, i) : '' // 停在文件上 → 它所在的目录
}
