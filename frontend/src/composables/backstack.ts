/**
 * 「返回栈」：让 Android 返回键（以及以后的鸿蒙返回键）按手机用户的预期逐层回退，
 * 而不是一下退出 App。
 *
 * 用法：某个界面元素打开时 `const off = pushBack(() => { close(); return true })`，
 * 关闭时 `off()`。原生返回键调 `runBack()`，从栈顶往下问「你能吃掉这次返回吗」。
 *
 * 优先级由入栈顺序决定（后打开的先关），所以基础层（切回编辑页/关抽屉）在挂载时入栈，
 * 对话框、菜单在自己打开时入栈。
 */

type BackHandler = () => boolean

const stack: BackHandler[] = []

/** 浮层深度监听者（鸿蒙原生壳用它决定系统返回键是被我们吃掉还是退出应用） */
let depthListener: ((depth: number) => void) | null = null

/** 注册/注销深度监听；注册时立刻回灌一次当前值 */
export function onBackDepthChange(cb: ((depth: number) => void) | null): void {
  depthListener = cb
  cb?.(stack.length)
}

function notifyDepth(): void {
  depthListener?.(stack.length)
}

/** 入栈一个返回处理器，返回撤销函数 */
export function pushBack(handler: BackHandler): () => void {
  stack.push(handler)
  notifyDepth()
  return () => {
    const i = stack.lastIndexOf(handler)
    if (i >= 0) stack.splice(i, 1)
    notifyDepth()
  }
}

/** 处理一次「返回」：有人接住返回 true */
export function runBack(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    try {
      if (stack[i]()) return true
    } catch {
      // 处理器出错就跳过，别让返回键把 App 卡死
    }
  }
  return false
}

/** 当前栈深（调试 / 判断「再按一次退出」用） */
export function backDepth(): number {
  return stack.length
}

/**
 * 把返回入口挂到 window 上：安卓壳在 `onBackPressed` 里调
 * `window.__xmdHandleBack()`，返回 false 时才走系统默认（退出）。
 */
export function installBackHook(): void {
  if (typeof window === 'undefined') return
  ;(window as Window & { __xmdHandleBack?: () => boolean }).__xmdHandleBack = () => runBack()
}
