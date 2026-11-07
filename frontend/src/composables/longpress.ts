/**
 * 长按（手机 / 平板）与右键（桌面）的统一判定：文件树的行与空白区共用一套。
 *
 * 安卓 WebView 的长按有**两条**路，必须都接住，只认一条就会在某些机器上彻底失灵：
 * 1) 我们自己的计时器 —— 阈值必须早于系统的长按（ViewConfiguration 默认 500ms），
 *    否则手势先被系统抢走；
 * 2) 系统长按派发的 `contextmenu` —— 系统认下长按时会给我们发 `touchcancel` 把计时器掐死，
 *    这时只剩 contextmenu 这一个信号，必须拿它当长按补弹自己的菜单。
 *
 * 早先的写法正好反了：把触摸之后 1.5s 内的 contextmenu **一律吃掉**（连 preventDefault 带
 * stopPropagation），于是计时器一旦被 touchcancel 掐死，菜单就永远不出现 ——
 * 手指抬起反而被当成单击，表现就是「长按没反应，结果点开了别的文件」。
 *
 * 同时又得防住另一个老毛病：菜单关掉之后 WebView 还能再补发一次晚到的 contextmenu，
 * 让菜单又冒出来。这里靠三条判据区分：
 * - `firedSeq === gestureSeq`：同一次手势只弹一次（计时器与 contextmenu 谁先到算谁）；
 * - `menuOpen`：菜单已经开着，重复信号直接忽略；
 * - `menuClosedAt`：刚关掉菜单的 600ms 内的 contextmenu 是上一个手势的尾巴，不认。
 *
 * 长按弹完菜单后，抬手派生出来的 click 也必须吃掉。抑制窗**不能**从「弹菜单那一刻」起算固定值
 * （长按越久越拦不住，抬手时早就过期了），而是在 `stop()`（touchend / touchcancel）时重新计时。
 */

/** 长按阈值：必须早于安卓系统长按（默认 500ms），留出余量防主线程延迟 */
const LONG_PRESS_MS = 400
/** 触摸尾巴容忍窗口：手指离开后这么久之内到的 contextmenu 都算触摸补发的（而不是鼠标右键） */
const TOUCH_TAIL_MS = 1500
/** 长按弹菜单后吃掉后续 click 的时长（touchend 时重新计时） */
const TAP_SUPPRESS_MS = 500
/** 菜单刚关掉后的保护窗：其中的 contextmenu 是上一个手势晚到的尾巴，别又弹一次 */
const MENU_TAIL_GUARD_MS = 600

let lastTouchAt = 0
let suppressUntil = 0
/** 触摸手势序号：每次 touchstart +1 */
let gestureSeq = 0
/** 已弹过菜单的手势序号（计时器与 contextmenu 谁先到算谁） */
let firedSeq = 0
/** 菜单当前是否开着 */
let menuOpen = false
let menuClosedAt = 0

/** 一次长按的手势状态（每个可长按元素各一个实例） */
export interface LongPress {
  /** touchstart：开始计时，pos 用第一根手指的触点 */
  arm(x: number, y: number): void
  /** touchmove：移出容差就放弃本次长按（滚动不算长按） */
  move(x: number, y: number): void
  /** touchend / touchcancel / 失焦：停表，刷新触控时间并续上 click 抑制窗 */
  stop(): void
  /** contextmenu 补弹（`classifyContextMenu` 返回 `'touch'`）时告诉本实例：这次手势已经弹过了 */
  claim(): void
  /**
   * 本次手势是否已经触发过长按（计时器或 contextmenu 补弹都算），用来吃掉随之而来的 click。
   * **只在这一手势还开着的时候有效**（arm 之后、stop 之前）—— 否则空白区那次长按会一直为真，
   * 之后点工具栏按钮（不 arm 的容器）时 click 会被一并吃掉。
   */
  didFire(): boolean
}

/**
 * @param fire 长按成立时的回调，参数是记下的触点坐标
 */
export function useLongPress(fire: (pos: { x: number; y: number }) => void, delay = LONG_PRESS_MS): LongPress {
  let timer = 0
  let mySeq = -1
  let pos = { x: 0, y: 0 }
  /** 本次手势是否已触发（arm 时清零） */
  let firedHere = false
  /** 本次手势是否还开着（arm / stop 维护） */
  let open = false

  function stopPress() {
    if (timer) {
      window.clearTimeout(timer)
      timer = 0
    }
    open = false
    lastTouchAt = Date.now()
    // 长按过的手势：从抬手这一刻重新计时，保证随之而来的 click 一定落在抑制窗内
    // （从「弹菜单那一刻」起算的固定值，长按久了就拦不住）
    if (firedHere) suppressUntil = Date.now() + TAP_SUPPRESS_MS
  }

  return {
    arm(x, y) {
      pos = { x, y }
      mySeq = ++gestureSeq
      firedHere = false
      open = true
      lastTouchAt = Date.now()
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = 0
        // 同一手势里 contextmenu 已经补弹过（或菜单正开着）→ 不重复弹
        if (firedHere || menuOpen || firedSeq === mySeq) return
        firedHere = true
        firedSeq = mySeq
        lastTouchAt = Date.now()
        suppressUntil = Date.now() + TAP_SUPPRESS_MS
        fire(pos)
      }, delay)
    },
    move(x, y) {
      if (Math.hypot(x - pos.x, y - pos.y) > 12) stopPress()
    },
    stop: stopPress,
    claim() {
      firedHere = true
    },
    didFire() {
      return open && firedHere
    }
  }
}

/** contextmenu 的处理方式 */
export type ContextMenuKind = 'mouse' | 'touch' | 'ignore'

/**
 * 判断一次 contextmenu 该怎么处理。
 * - `'mouse'`：桌面右键（或早就过了触摸窗口）→ 调用方按右键弹菜单，并自己 preventDefault；
 * - `'touch'`：触摸长按的替代信号（计时器被系统手势掐死时只剩它）→ 调用方按长按弹菜单；
 * - `'ignore'`：同一个手势的重复信号 / 菜单刚关掉后晚到的尾巴 → 什么都不做（已 preventDefault）。
 *
 * 触摸来的 contextmenu 一律 preventDefault（挡掉 WebView 自己的菜单），鼠标右键留给调用方。
 */
export function classifyContextMenu(e: MouseEvent): ContextMenuKind {
  if (Date.now() - lastTouchAt >= TOUCH_TAIL_MS) return 'mouse'
  e.preventDefault()
  if (menuOpen) return 'ignore'
  if (firedSeq === gestureSeq) return 'ignore'
  if (menuClosedAt && Date.now() - menuClosedAt < MENU_TAIL_GUARD_MS) return 'ignore'
  // 记成本手势已触发：计时器（若还活着）与重复的 contextmenu 都不再弹
  firedSeq = gestureSeq
  lastTouchAt = Date.now()
  suppressUntil = Date.now() + TAP_SUPPRESS_MS
  return 'touch'
}

/** 菜单弹出时通知判定模块（用来识别晚到的 contextmenu 尾巴） */
export function noteMenuOpened(): void {
  menuOpen = true
  menuClosedAt = 0
}

/** 菜单关闭时通知判定模块 */
export function noteMenuClosed(): void {
  if (menuOpen) menuClosedAt = Date.now()
  menuOpen = false
}

/** 弹完菜单后的短暂抑制窗（关菜单那一下不该被当成「点了某个文件」） */
export function armMenuSuppression(ms = 250): void {
  suppressUntil = Math.max(suppressUntil, Date.now() + ms)
}

/** 当前是否处于抑制窗内 */
export function menuSuppressed(): boolean {
  return Date.now() < suppressUntil
}
