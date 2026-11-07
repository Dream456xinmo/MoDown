import { bridge } from '../bridge'
import { isAndroidShell } from '../utils/device'

/**
 * 安卓 WebView 的软键盘兜底。
 *
 * ⚠️ 这个文件的铁律：**永远不要抢在 Chromium 前面动手**。
 * 聚焦可编辑面时 Chromium 自己会向壳请求 IME（手机版一直靠它，从来没坏过），
 * 只有它**确实没弹**时补一刀才安全。早期版本在 `focusin` 里立刻调原生 `showKeyboard`
 * （内部 `requestFocusFromTouch` + `showSoftInput`），把 WebView 的 view 级焦点抢来抢去，
 * Chromium 随后自己那次输入会话就落空了 —— 结果连手机版都打不了字。
 *
 * 所以现在的顺序是「先等 → 先判断 → 最后才补」：
 * 1. 聚焦 / 轻点后等 `SETTLE_MS`，让 Chromium 走完它自己的聚焦与 IME 请求；
 * 2. 这时键盘已经上屏（`softKeyboardVisible()`：视口被压矮的量）→ 什么都不做；
 * 3. 仍不可见、焦点也还在可编辑面上 → 才叫原生补弹 `XmdFs.showKeyboard`，
 *    并把回执（`keyboard/ime/focus/windowFocus/softInputMode`）交给 `onFail` 提示一次，方便真机取证。
 *
 * 触发时机（都要求落点是可编辑面，界面其他部位不会误触）：
 * - `focusin`：焦点刚进到可编辑节点（平板外壳最常见的失败现场）；
 * - 轻点（位移 < 10px 且时长 < 500ms）**且焦点本来就在这块可编辑面里**：返回键收起键盘后
 *   焦点还留在编辑区、再点一下不会再发 `focusin` 的那种。首次点击**绝不**在这里手动 `focus()`：
 *   手动聚焦会消耗掉这次用户手势，Chromium 认定「不是用户意图」后连它自己那次请求都不发了。
 *
 * 与 `utils/device.ts` 的 `stableLayoutSize` 配合（两者互不替代）：
 * 那个负责「键盘压矮视口时别把外壳和编辑器 DOM 换掉」，这个负责「Chromium 真没弹时补一刀」。
 *
 * 仅 Android 原生壳生效（旧 APK 没有 `showKeyboard` → 失败一次即停用），桌面 / 浏览器 / 鸿蒙不受影响。
 */

/** 认定「轻点」的最大位移（px） */
const TAP_MAX_MOVE = 10
/** 认定「轻点」的最大时长（ms） */
const TAP_MAX_MS = 500
/** 两次补弹之间的最小间隔：避免连续事件把桥打爆 */
const MIN_GAP_MS = 300
/** 等 Chromium 自己试完的时长：太早插队会把它正常的输入会话打掉（见文件头） */
const SETTLE_MS = 260
/** 视口高度缩掉这么多就认作「键盘已经上屏」（手机键盘通常 250px 以上） */
const KEYBOARD_MIN_DROP = 100

/** 可编辑面：输入控件、contenteditable、三种编辑器的根/输入层 */
const EDITABLE_SELECTOR =
  'input, textarea, [contenteditable="true"], .ProseMirror, .cm-content, .native-edit-context, .inputarea'

function editableOf(el: Element | null): Element | null {
  if (!el) return null
  try {
    return el.closest(EDITABLE_SELECTOR)
  } catch {
    return null
  }
}

/** 当前焦点是否落在可编辑面上（软键盘只会为它压矮视口，见 stableLayoutSize） */
export function hasEditingFocus(): boolean {
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA'
}

/**
 * 「没有键盘时」的视口基准。
 * 键盘弹出压矮视口的那次变化**不更新**基准，收起 / 变大 / 换宽度（旋转、分屏）时才更新。
 */
let baseW = 0
let baseH = 0

function noteViewport() {
  const w = window.innerWidth
  const h = window.innerHeight
  if (!baseW || w !== baseW || h >= baseH) {
    baseW = w
    baseH = h
  }
}

/**
 * 软键盘是否已经上屏：看视口有没有被压矮（布局视口与可视视口取更小的那个，
 * 因为 manifest 的 `adjustResize` + viewport 的 `interactive-widget=resizes-content` 缩的是布局视口）。
 */
export function softKeyboardVisible(): boolean {
  if (!baseH) return false
  const vv = window.visualViewport
  const h = vv ? Math.min(vv.height, window.innerHeight) : window.innerHeight
  return baseH - h > KEYBOARD_MIN_DROP
}

/**
 * @param onFail 原生补弹后键盘仍不可见时的回报（只报一次），用于把设备上的真实原因带回来
 */
export function installSoftKeyboardFallback(onFail?: (info: string) => void): void {
  if (!isAndroidShell()) return
  const ask = bridge.ensureKeyboard
  if (typeof ask !== 'function') return

  noteViewport()
  window.addEventListener('resize', noteViewport)
  window.addEventListener('orientationchange', noteViewport)

  let lastAt = 0
  let timer = 0
  let reported = false

  /** 排一次「补弹」：键盘已经上屏就毫不打扰地退出（手机版绝大多数情况走这条） */
  function request() {
    if (timer || softKeyboardVisible()) return
    const now = Date.now()
    if (now - lastAt < MIN_GAP_MS) return
    lastAt = now
    timer = window.setTimeout(() => {
      timer = 0
      // 再取一次基准：键盘在这 260ms 里弹出来的话，压矮的那次不该被当成新基准
      noteViewport()
      if (softKeyboardVisible()) return
      // 焦点已经不在可编辑面上（轻点把焦点带走了、外壳被换掉了）：补弹也没有落点
      if (!hasEditingFocus()) return
      try {
        const r = ask()
        if (!r || typeof (r as Promise<unknown>).then !== 'function') return
        Promise.resolve(r)
          .then((res) => {
            const info = res as Record<string, unknown> | null
            // 前端视口判定 + 原生回执都说「没弹」才提示，避免误报打扰
            if (reported || !info || info.keyboard === true || softKeyboardVisible()) return
            reported = true
            onFail?.(
              `kbd=${info.keyboard} ime=${info.ime} focus=${info.focus} winFocus=${info.windowFocus}` +
                ` mode=${info.softInputMode}${info.reason ? ` reason=${info.reason}` : ''}`
            )
          })
          .catch(() => {
            // 兜底通道失败本身不该影响任何正常操作
          })
      } catch {
        // 同上
      }
    }, SETTLE_MS)
  }

  function onFocusIn(e: Event) {
    if (editableOf(e.target as Element)) request()
  }

  let touchAt = 0
  let touchX = 0
  let touchY = 0

  function onTouchStart(e: TouchEvent) {
    if (e.touches.length !== 1) {
      touchAt = 0
      return
    }
    touchAt = Date.now()
    touchX = e.touches[0].clientX
    touchY = e.touches[0].clientY
  }

  function onTouchEnd(e: TouchEvent) {
    const at = touchAt
    touchAt = 0
    if (!at || Date.now() - at > TAP_MAX_MS) return
    const t = e.changedTouches[0]
    if (!t) return
    if (Math.hypot(t.clientX - touchX, t.clientY - touchY) > TAP_MAX_MOVE) return
    const hit = editableOf(e.target as Element)
    // 点在文件树 / 顶栏 / 工具栏上：没有可编辑面，什么都不做
    if (!hit) return
    // 只管「焦点本来就在这块可编辑面里」的情况（返回键收起键盘后焦点还在编辑区、再点不弹）。
    // 首次点击 / 换到另一个编辑面一律交给 Chromium 自己的聚焦流程，我们连 focus 都不碰。
    const active = document.activeElement
    if (active !== hit && !hit.contains(active)) return
    request()
  }

  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true })
  document.addEventListener('touchend', onTouchEnd, { capture: true, passive: true })
}
