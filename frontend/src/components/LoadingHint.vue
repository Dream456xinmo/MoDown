<script setup lang="ts">
/** 编辑器/预览模块异步加载时的占位提示（避免切换模式时出现空白） */
defineProps<{ text?: string }>()
</script>

<template>
  <div class="loading-hint">
    <span class="spinner"></span>
    <span>{{ text || '正在加载编辑器…' }}</span>
  </div>
</template>

<style scoped>
.loading-hint {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  color: var(--fg-dim);
  font-size: 13px;
}
</style>
