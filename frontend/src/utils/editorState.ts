/**
 * 编辑器「切换文件再切回来」时的光标 / 滚动位置缓存。
 * 放在模块级：组件因切换编辑模式被卸载重建时，记录仍在。
 * （Monaco 的滚动/光标由它自己的 saveViewState 处理，不在这里。）
 */
export interface EditorPos {
  /** 光标位置（CodeMirror 用绝对偏移，富文本用 ProseMirror 的 selection.from） */
  pos: number
  /** 滚动容器的 scrollTop */
  scroll: number
}

export const cmPositions = new Map<string, EditorPos>()
export const richPositions = new Map<string, EditorPos>()

/** 路径变化时取旧值（没有则 undefined），并写入新值 */
export function takePos(map: Map<string, EditorPos>, path: string): EditorPos | undefined {
  return path ? map.get(path) : undefined
}

export function savePos(map: Map<string, EditorPos>, path: string, pos: EditorPos) {
  if (path) map.set(path, pos)
}
