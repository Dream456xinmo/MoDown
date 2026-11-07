<script setup lang="ts">
/**
 * PC / 网页版的分栏拖拽条（VSCode 同款）：
 * 只负责手势与视觉反馈，宽度的上下限和持久化由父组件（App.vue）处理。
 */
const props = defineProps<{ title?: string }>()
const emit = defineEmits<{
  (e: 'start'): void
  (e: 'move', dx: number): void
  (e: 'end'): void
  (e: 'reset'): void
}>()

let startX = 0
let dragging = false

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return
  dragging = true
  startX = e.clientX
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  document.body.classList.add('pane-resizing')
  emit('start')
  e.preventDefault()
}

function onPointerMove(e: PointerEvent) {
  if (!dragging) return
  emit('move', e.clientX - startX)
}

function onPointerUp(e: PointerEvent) {
  if (!dragging) return
  dragging = false
  ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  document.body.classList.remove('pane-resizing')
  emit('end')
}

/** 双击恢复默认宽度（默认值由父组件决定） */
function onDblClick() {
  emit('reset')
}
</script>

<template>
  <div
    class="pane-resizer"
    role="separator"
    aria-orientation="vertical"
    :title="props.title || '拖拽调整宽度，双击恢复默认'"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @dblclick="onDblClick"
  ></div>
</template>

<style scoped>
.pane-resizer {
  flex: none;
  width: 5px;
  margin: 0 -2px;
  position: relative;
  z-index: 6;
  cursor: col-resize;
  touch-action: none;
}
.pane-resizer::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 1px;
  background: transparent;
  transition: background 0.12s ease;
}
.pane-resizer:hover::after,
.pane-resizer:active::after {
  background: var(--accent);
}
</style>
