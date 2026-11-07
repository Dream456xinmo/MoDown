<script setup lang="ts">
/**
 * 预览页图片查看器：滚轮缩放、拖拽平移、双击复位、Esc 关闭。
 * 只用于预览（Markdown 渲染结果），不会修改文档。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{ src: string; alt?: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const scale = ref(1)
const x = ref(0)
const y = ref(0)
let dragging = false
let startX = 0
let startY = 0
let originX = 0
let originY = 0

function zoom(factor: number) {
  scale.value = Math.min(8, Math.max(0.2, scale.value * factor))
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
  if (e.button !== 0) return
  dragging = true
  startX = e.clientX
  startY = e.clientY
  originX = x.value
  originY = y.value
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
}
function onPointerMove(e: PointerEvent) {
  if (!dragging) return
  x.value = originX + e.clientX - startX
  y.value = originY + e.clientY - startY
}
function onPointerUp() {
  dragging = false
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
}
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
