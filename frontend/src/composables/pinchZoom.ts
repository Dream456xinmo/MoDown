import type { Directive, DirectiveBinding } from 'vue'

/**
 * 双指捏合缩放手势指令 v-pinch：
 * - 两指开合 → 调整元素 CSS zoom（0.6–2.5x），单指滚动不受影响
 * - 双击 → 复位 1x
 * 触屏浏览器默认会把双指手势当成页面缩放，这里通过 touch-action 关闭页面缩放，
 * 把手势留给应用内部（桌面端无触屏事件，不产生任何影响）。
 */
const MIN = 0.6
const MAX = 2.5

function setup(el: HTMLElement) {
  if ((el as any).__pinchBound) return
  ;(el as any).__pinchBound = true
  el.style.touchAction = 'pan-x pan-y' // 禁用浏览器双指页面缩放，仅保留单指平移

  let startDist = 0
  let startZoom = 1
  let lastTap = 0

  const getZoom = () => parseFloat((el.style.zoom || '1').replace('%', '') || '1') || 1
  const setZoom = (z: number) => {
    el.style.zoom = String(Math.min(MAX, Math.max(MIN, Math.round(z * 100) / 100)))
  }
  const dist = (t: TouchList) =>
    Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)

  const onStart = (e: TouchEvent) => {
    if (e.touches.length === 2) {
      startDist = dist(e.touches)
      startZoom = getZoom()
    }
  }
  const onMove = (e: TouchEvent) => {
    if (e.touches.length === 2 && startDist > 4) {
      e.preventDefault()
      setZoom(startZoom * (dist(e.touches) / startDist))
    }
  }
  const onEnd = (e: TouchEvent) => {
    if (e.touches.length < 2) startDist = 0
    // 双击复位
    if (e.touches.length === 0 && e.changedTouches.length === 1) {
      const now = Date.now()
      if (now - lastTap < 320) {
        setZoom(1)
        navigator.vibrate?.(10)
      }
      lastTap = now
    }
  }

  el.addEventListener('touchstart', onStart, { passive: true })
  el.addEventListener('touchmove', onMove, { passive: false })
  el.addEventListener('touchend', onEnd, { passive: true })
  ;(el as any).__pinchCleanup = () => {
    el.removeEventListener('touchstart', onStart)
    el.removeEventListener('touchmove', onMove)
    el.removeEventListener('touchend', onEnd)
  }
}

export const vPinch: Directive<HTMLElement> = {
  mounted(el: HTMLElement, _b: DirectiveBinding) {
    setup(el)
  },
  unmounted(el: HTMLElement) {
    ;(el as any).__pinchCleanup?.()
  }
}
