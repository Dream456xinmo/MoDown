import { reactive } from 'vue'

/** 应用自建弹窗（替代浏览器原生 prompt/confirm/alert） */
export interface DialogSpec {
  title: string
  message?: string
  defaultValue?: string
  placeholder?: string
  okText?: string
  cancelText?: string
}

interface DialogState extends DialogSpec {
  open: boolean
  kind: 'prompt' | 'confirm'
  value: string
}

export const dialogState = reactive<DialogState>({
  open: false,
  kind: 'prompt',
  title: '',
  message: '',
  value: '',
  defaultValue: '',
  placeholder: '',
  okText: '确定',
  cancelText: '取消'
})

let resolveCur: ((v: string | null | boolean) => void) | null = null

function show(spec: DialogSpec, kind: 'prompt' | 'confirm'): Promise<string | null | boolean> {
  // 若上一个弹窗未关闭，先以取消解决，避免悬挂的 Promise
  resolveCur?.(null)
  Object.assign(dialogState, spec, { kind, open: true, value: spec.defaultValue ?? '' })
  return new Promise(res => (resolveCur = res))
}

export async function uiPrompt(spec: DialogSpec): Promise<string | null> {
  return (await show(spec, 'prompt')) as string | null
}

export async function uiConfirm(spec: DialogSpec): Promise<boolean> {
  return (await show(spec, 'confirm')) === true
}

/** 确认：prompt 返回输入值（空串视为取消），confirm 返回 true */
export function dialogAccept() {
  if (!resolveCur) return
  const isPrompt = dialogState.kind === 'prompt'
  const v = isPrompt ? (dialogState.value.trim() ? dialogState.value : null) : true
  resolveCur(v)
  resolveCur = null
  dialogState.open = false
}

export function dialogCancel() {
  resolveCur?.(null)
  resolveCur = null
  dialogState.open = false
}
