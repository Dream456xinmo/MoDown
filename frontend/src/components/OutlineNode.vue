<script setup lang="ts">
import { computed } from 'vue'
import IconSvg from './IconSvg.vue'
import type { ONode } from '../utils/outline'

const props = defineProps<{
  node: ONode
  depth: number
  collapsed: Set<string>
}>()
const emit = defineEmits<{
  (e: 'goto', node: ONode): void
  (e: 'toggle', slug: string): void
}>()

const hasKids = computed(() => props.node.children.length > 0)
const isOpen = computed(() => !props.collapsed.has(props.node.h.slug))

/** 点击整行＝跳到该标题。父标题同样可跳，且收起状态下顺带展开子级 */
function onRow() {
  if (hasKids.value && !isOpen.value) emit('toggle', props.node.h.slug)
  emit('goto', props.node)
}

/** 箭头是独立热区：只展开/收起，不跳转 */
function onTwisty(e: MouseEvent) {
  e.stopPropagation()
  emit('toggle', props.node.h.slug)
}
</script>

<template>
  <div class="ol-node" :style="{ paddingLeft: depth * 12 + 'px' }">
    <div class="ol-row" :title="`${node.h.text}（点击跳转）`" @click="onRow">
      <button
        v-if="hasKids"
        class="ol-twisty ol-twisty-btn"
        :title="isOpen ? '收起子标题' : '展开子标题'"
        @click="onTwisty"
      >
        <IconSvg :name="isOpen ? 'chevron-down' : 'chevron-right'" :size="13" color="var(--fg-dim)" />
      </button>
      <span v-else class="ol-twisty"></span>
      <span class="ol-badge">H{{ node.h.level }}</span>
      <span class="ol-text">{{ node.h.text }}</span>
    </div>
    <template v-if="hasKids && isOpen">
      <OutlineNode
        v-for="c in node.children"
        :key="c.h.slug"
        :node="c"
        :depth="depth + 1"
        :collapsed="collapsed"
        @goto="emit('goto', $event)"
        @toggle="emit('toggle', $event)"
      />
    </template>
  </div>
</template>
