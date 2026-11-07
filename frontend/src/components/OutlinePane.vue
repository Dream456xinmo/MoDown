<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWorkspace } from '../stores/workspace'
import { buildOutlineTree, type ONode } from '../utils/outline'
import IconSvg from './IconSvg.vue'
import OutlineNode from './OutlineNode.vue'

const ws = useWorkspace()

const roots = computed(() => buildOutlineTree(ws.headings))

/** 折叠集合：存被折叠节点的 slug */
const collapsed = ref<Set<string>>(new Set())
const allSlugs = computed(() => {
  const out: string[] = []
  const walk = (n: ONode) => {
    if (n.children.length) {
      out.push(n.h.slug)
      n.children.forEach(walk)
    }
  }
  roots.value.forEach(walk)
  return out
})
const allCollapsed = computed(
  () => allSlugs.value.length > 0 && allSlugs.value.every(s => collapsed.value.has(s))
)

function toggle(slug: string) {
  const next = new Set(collapsed.value)
  next.has(slug) ? next.delete(slug) : next.add(slug)
  collapsed.value = next
}

function toggleAll() {
  collapsed.value = allCollapsed.value ? new Set() : new Set(allSlugs.value)
}

function goto(n: ONode) {
  // slug 给渲染层锚点定位用，line 给源码/编辑器跳行用，text 是 HTML 预览里的文本兜底
  window.dispatchEvent(
    new CustomEvent('xmd-goto', { detail: { slug: n.h.slug, text: n.h.text, line: n.h.line } })
  )
}
</script>

<template>
  <div class="outline">
    <div class="outline-head">
      <span class="outline-title">大纲 (H1–H6)</span>
      <button
        v-if="allSlugs.length"
        class="outline-all-btn"
        :title="allCollapsed ? '展开全部' : '折叠全部'"
        @click="toggleAll"
      >
        <IconSvg :name="allCollapsed ? 'expand' : 'collapse'" :size="14" />
      </button>
    </div>
    <OutlineNode
      v-for="n in roots"
      :key="n.h.slug"
      :node="n"
      :depth="0"
      :collapsed="collapsed"
      @goto="goto"
      @toggle="toggle"
    />
    <p v-if="!ws.headings.length" style="font-size:12px;color:var(--fg-dim)">暂无标题</p>
  </div>
</template>
