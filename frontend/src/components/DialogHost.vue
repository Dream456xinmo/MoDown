<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { dialogState, dialogAccept, dialogCancel } from '../composables/dialogs'
import IconSvg from './IconSvg.vue'

const input = ref<HTMLInputElement>()
watch(
  () => dialogState.open,
  async o => {
    if (o && dialogState.kind === 'prompt') {
      await nextTick()
      input.value?.focus()
      input.value?.select()
    }
  }
)

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    dialogCancel()
  } else if (e.key === 'Enter') {
    e.preventDefault()
    dialogAccept()
  }
}
</script>

<template>
  <div class="dialog-mask" v-if="dialogState.open" @click="dialogCancel">
    <div class="dialog app-dialog" @click.stop @keydown="onKey">
      <div class="app-dialog-head">
        <span class="app-dialog-title">{{ dialogState.title }}</span>
        <button class="app-dialog-x" @click="dialogCancel"><IconSvg name="x" :size="14" /></button>
      </div>
      <p v-if="dialogState.message" class="app-dialog-msg">{{ dialogState.message }}</p>
      <input
        v-if="dialogState.kind === 'prompt'"
        ref="input"
        v-model="dialogState.value"
        :placeholder="dialogState.placeholder"
        style="width:100%"
      />
      <div class="footer">
        <button @click="dialogCancel">{{ dialogState.cancelText || '取消' }}</button>
        <button class="primary" @click="dialogAccept">{{ dialogState.okText || '确定' }}</button>
      </div>
    </div>
  </div>
</template>
