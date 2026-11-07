<script setup lang="ts">
import { inject, nextTick, onMounted, ref, type Ref } from 'vue'
import IconSvg from './IconSvg.vue'
import { INLINE_STATE_KEY, INLINE_ACTIONS_KEY, type InlineCreate } from '../composables/treeCreate'

const props = defineProps<{ depth?: number }>()

const state = inject<Ref<InlineCreate | null>>(INLINE_STATE_KEY)!
const actions = inject<{ confirm: () => void; cancel: () => void }>(INLINE_ACTIONS_KEY)!

const input = ref<HTMLInputElement>()
onMounted(async () => {
  await nextTick()
  input.value?.focus()
  input.value?.select()
})

/** 阻止冒泡，避免触发外层文件树 click 关闭菜单等逻辑 */
function stop(e: Event) {
  e.stopPropagation()
}
</script>

<template>
  <div class="tree-row" :style="{ paddingLeft: (props.depth || 0) * 14 + 8 + 'px' }" @click.stop>
    <span class="twisty"></span>
    <IconSvg
      :name="state?.kind === 'dir' ? 'folder-plus' : 'file-plus'"
      :size="15"
      :color="state?.kind === 'dir' ? '#d9a441' : 'var(--accent)'"
      class="node-icon"
    />
    <input
      ref="input"
      class="inline-input"
      :value="state?.value"
      @input="state && (state.value = ($event.target as HTMLInputElement).value)"
      @keydown.enter.prevent="actions.confirm()"
      @keydown.esc.prevent="actions.cancel()"
      @blur="actions.cancel()"
      @contextmenu.stop.prevent
    />
  </div>
</template>
