<script setup lang="ts">
/**
 * 预览页图片查看器：滚轮/按钮缩放、拖拽平移、双指捏合缩放、双击复位、Esc 关闭。
 * 只用于预览（Markdown 渲染结果），不会修改文档。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{ src: string; alt?: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const scale = ref(1)
const x = ref(0)
const y = ref(0)
/** 拖动 / 捏合期间关掉 CSS 过渡，避免手指跟手时出现延迟 */
const interacting = ref(false)

const pointers = new Map<number, { x: number; y: number }>()
let dragging = false
let startX = 0
let startY = 0
let originX = 0
let originY = 0
let moved = false
let lastTap = 0

/** 双指捏合起始状态 */
let pinchDist = 0
let pinchScale = 1
let pinchX = 0
let pinchY = 0
let pinchMidX = 0
let pinchMidY = 0

const clampScale = (v: number) => Math.min(8, Math.max(0.2, v))

function zoom(factor: number) {
  scale.value = clampScale(scale.value * factor)
}
function reset() {
  scale.value = 1
  x.value = 0
  y.value = 0
}
function onWheel(e: WheelEvent) {
  e.preventDefault()
  zoom(e.deltaY < 0 ? 1.15 : 0.87)
}
function onPointerDown(e: PointerEvent) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  const stage = e.currentTarget as HTMLElement
  stage.setPointerCapture?.(e.pointerId)
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
  moved = false
  interacting.value = true

  if (pointers.size === 1) {
    dragging = true
    startX = e.clientX
    startY = e.clientY
    originX = x.value
    originY = y.value
    return
  }

  if (pointers.size === 2) {
    dragging = false
    const [a, b] = [...pointers.values()]
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y) || 1
    pinchScale = scale.value
    pinchX = x.value
    pinchY = y.value
    pinchMidX = (a.x + b.x) / 2
    pinchMidY = (a.y + b.y) / 2
  }
}
function onPointerMove(e: PointerEvent) {
  if (!pointers.has(e.pointerId)) return
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

  if (pointers.size === 1 && dragging) {
    const dx = e.clientX - startX
    const dy = e.clientY - startY
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true
    x.value = originX + dx
    y.value = originY + dy
    return
  }

  if (pointers.size >= 2) {
    const [a, b] = [...pointers.values()]
    const dist = Math.hypot(a.x - b.x, a.y - b.y)
    if (pinchDist <= 0) return
    const midX = (a.x + b.x) / 2
    const midY = (a.y + b.y) / 2
    const next = clampScale(pinchScale * (dist / pinchDist))
    const ratio = next / pinchScale
    // 以双指中点为锚点缩放：图片中心等于视口中心
    const cx = window.innerWidth / 2
    const cy = window.innerHeight / 2
    scale.value = next
    x.value = midX - cx - (pinchMidX - cx - pinchX) * ratio
    y.value = midY - cy - (pinchMidY - cy - pinchY) * ratio
    moved = true
  }
}
function onPointerUp(e: PointerEvent) {
  pointers.delete(e.pointerId)

  if (pointers.size === 0) {
    interacting.value = false
    dragging = false
    // 触摸双击复位（桌面仍由 @dblclick 处理）
    if (!moved && e.pointerType === 'touch') {
      const now = Date.now()
      if (now - lastTap < 320) {
        reset()
        lastTap = 0
      } else {
        lastTap = now
      }
    } else {
      lastTap = 0
    }
    return
  }

  // 双指松开一指：无缝接着用剩下那根手指拖动
  if (pointers.size === 1) {
    const p = [...pointers.values()][0]
    dragging = true
    startX = p.x
    startY = p.y
    originX = x.value
    originY = y.value
    moved = false
  } else {
    dragging = false
  }
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="img-viewer-mask" @click="emit('close')">
      <div
        class="img-viewer-stage"
        :class="{ interacting }"
        @click.stop
        @wheel.prevent="onWheel"
        @dblclick="reset"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <img
          :src="props.src"
          :alt="props.alt || ''"
          :style="{ transform: `translate(${x}px, ${y}px) scale(${scale})` }"
          draggable="false"
        />
      </div>
      <div class="img-viewer-bar" @click.stop>
        <button title="缩小" @click="zoom(0.87)">−</button>
        <span>{{ Math.round(scale * 100) }}%</span>
        <button title="放大" @click="zoom(1.15)">+</button>
        <button @click="reset">1:1</button>
        <button @click="emit('close')">关闭</button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.img-viewer-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: zoom-out;
  user-select: none;
}
.img-viewer-stage {
  max-width: 94vw;
  max-height: 90vh;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  touch-action: none;
}
.img-viewer-stage:active { cursor: grabbing; }
.img-viewer-stage img {
  max-width: 94vw;
  max-height: 88vh;
  transform-origin: center center;
  transition: transform 0.08s ease-out;
  border-radius: 4px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.45);
  user-select: none;
  -webkit-user-drag: none;
  will-change: transform;
}
/* 手指操作期间不要过渡，否则拖动/捏合会“追不上手” */
.img-viewer-stage.interacting img { transition: none; }
.img-viewer-bar {
  position: fixed;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 10px;
  background: rgba(35, 36, 40, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #e6e8ea;
  font-size: 12px;
}
.img-viewer-bar button {
  min-width: 30px;
  height: 26px;
  padding: 0 8px;
  border-radius: 6px;
  color: #e6e8ea;
  background: rgba(255, 255, 255, 0.08);
}
.img-viewer-bar button:hover { background: rgba(255, 255, 255, 0.18); }
.img-viewer-bar span { min-width: 48px; text-align: center; }
</style>
