<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useWorkspace } from '../stores/workspace'
import { exportMarkdown, exportHtml, exportDoc, exportDocx, exportPdf } from '../utils/exporter'
import { saveCurrent } from '../utils/shortcuts'
import { uiPrompt } from '../composables/dialogs'
import { AVAILABLE_DEVICE_MODES, CAN_SWITCH_DEVICE, type DeviceMode } from '../utils/device'
import IconSvg from './IconSvg.vue'

const ws = useWorkspace()
const props = defineProps<{ mobile?: boolean; deviceLabel?: string; deviceIcon?: string }>()
const emit = defineEmits<{
  (e: 'open-settings'): void
  (e: 'open-drawer'): void
  (e: 'set-device', mode: DeviceMode): void
}>()

type ExportKind = 'md' | 'html' | 'doc' | 'docx' | 'pdf'
const EXPORT_NAME: Record<ExportKind, string> = { md: 'MD', html: 'HTML', doc: 'DOC', docx: 'DOCX', pdf: 'PDF' }
const EXPORT_EXT: Record<ExportKind, string> = { md: 'md', html: 'html', doc: 'doc', docx: 'docx', pdf: 'pdf' }

const exportOpen = ref(false)
const moreOpen = ref(false)
const devOpen = ref(false)
const exporting = ref<'' | ExportKind>('')
const tmp = ref<HTMLElement>()
const moreTmp = ref<HTMLElement>()
const devTmp = ref<HTMLElement>()

/* ---------- 桌面顶栏左侧按钮组的自动收缩（VSCode 标题栏的 More Actions 效果） ---------- */
/** 左侧按钮组容器（宽度即可用空间；放不下的按钮收进「…」） */
const tbLeft = ref<HTMLElement>()
/** 「…」溢出按钮 */
const ovTmp = ref<HTMLElement>()
/** 「…」菜单开关（与手机顶栏的 moreOpen 分开，两个外壳互斥渲染） */
const ovOpen = ref(false)
/** 左侧按钮组当前能完整显示的项数（索引 >= 它的收进「…」） */
const visibleCount = ref(99)
/** 是否发生收缩（收缩时才显示「…」） */
const overflowing = ref(false)
/** 导出按钮在 leftItems 中的固定下标（它带下拉面板，单独渲染；新增/调整按钮时要同步） */
const EXPORT_INDEX = 6

function onDocClick(e: MouseEvent) {
  if (tmp.value && !tmp.value.contains(e.target as Node)) exportOpen.value = false
  if (moreTmp.value && !moreTmp.value.contains(e.target as Node)) moreOpen.value = false
  if (devTmp.value && !devTmp.value.contains(e.target as Node)) devOpen.value = false
  if (ovTmp.value && !ovTmp.value.contains(e.target as Node)) ovOpen.value = false
}

const themeIcon = computed(() =>
  ws.settings.theme === 'auto' ? 'theme-auto' : ws.settings.theme === 'dark' ? 'moon' : 'sun'
)
const themeTip = computed(() =>
  `主题：${ws.settings.theme === 'auto' ? '跟随系统' : ws.settings.theme === 'dark' ? '深色' : '浅色'}（点击切换）`
)

/** 版本标识：PC 编译版本固定不可切换，移动端版本可选 手机版 / 平板版 */
const DEVICE_NAME: Record<DeviceMode, string> = { auto: '自适应版', pc: 'PC版', mobile: '手机版', tablet: '平板版' }
const deviceTip = computed(
  () => `版本：${DEVICE_NAME[ws.settings.deviceMode]}` + (CAN_SWITCH_DEVICE ? '（点击切换）' : '')
)
function pickDevice(mode: DeviceMode) {
  if (!CAN_SWITCH_DEVICE) return
  devOpen.value = false
  moreOpen.value = false
  void ws.updateSetting('deviceMode', mode)
}
/** 标识胶囊：仅移动端编译版本可点开切换面板 */
function toggleDev() {
  if (!CAN_SWITCH_DEVICE) return
  devOpen.value = !devOpen.value
}

async function onNew() {
  const name = await uiPrompt({
    title: '新建文件',
    message: '输入文件名（相对工作区路径，以 .md 结尾）',
    defaultValue: `/untitled-${Date.now() % 10000}.md`
  })
  if (name) await ws.newFile(name)
}
async function onSave() {
  await saveCurrent()
}

/**
 * 桌面顶栏左侧按钮的定义：正常渲染与「…」溢出菜单共用同一份数据，
 * 所以以后新增按钮只要在这里加一项，收缩菜单会自动包含它。
 */
type TBItem = {
  key: string
  icon?: string
  label: string
  tip: string
  /** 纯图标（不显示文字） */
  iconOnly?: boolean
  active?: boolean
  disabled?: boolean
  /** 有未保存更改（保存按钮后面加 *） */
  dirty?: boolean
  /** 带下拉面板的导出按钮，单独渲染 */
  export?: boolean
}
const leftItems = computed<TBItem[]>(() => [
  {
    key: 'tree',
    icon: 'panel-left',
    label: '文件树',
    iconOnly: true,
    tip: ws.settings.treeVisible ? '隐藏文件树' : '显示文件树',
    active: ws.settings.treeVisible
  },
  { key: 'new', icon: 'file-plus', label: '新建', tip: '新建 Markdown 文件' },
  { key: 'open', icon: 'folder-open', label: '打开文件夹', tip: '打开文件夹作为工作区' },
  { key: 'import', icon: 'import', label: '导入文件', tip: '导入文件到工作区（保留原始后缀，支持代码/配置/图片）' },
  {
    key: 'save',
    label: '保存',
    tip: '保存（Ctrl+S，未关联文件时先选保存位置）',
    disabled: !ws.hasFile && !ws.content,
    dirty: ws.dirty
  },
  {
    key: 'saveas',
    label: '另存为',
    tip: '另存为：选择保存位置与文件名（桌面 / 安卓都用系统文件选择器）',
    disabled: !ws.hasFile && !ws.content
  },
  { key: 'export', label: '导出', tip: '导出为 MD / HTML / DOC / DOCX / PDF', export: true, disabled: !!exporting }
])
/** 被收进「…」的项（顺序即菜单顺序） */
const overflowItems = computed(() => leftItems.value.slice(visibleCount.value))
const moreTip = computed(() => `更多操作（${overflowItems.value.length} 项）`)

function runItem(key: string) {
  if (key === 'tree') return void ws.updateSetting('treeVisible', !ws.settings.treeVisible)
  if (key === 'new') return void onNew()
  if (key === 'open') return void ws.openFolder()
  if (key === 'import') return void ws.importFile()
  if (key === 'save') return void onSave()
  if (key === 'saveas') return void ws.saveAs()
}
/** 溢出菜单项：先关菜单再执行 */
function runMenuItem(key: string) {
  ovOpen.value = false
  runItem(key)
}

/** 按钮间距（与 .topbar 的 gap 保持一致） */
const TB_GAP = 4
let ro: ResizeObserver | null = null
let measuring = false

/**
 * 按各项的自然宽度尽量多显示，放不下的收进「…」。
 * 未显示的项用 visibility 隐藏（脱离文档流但仍可测宽），因此可以反复精确测量。
 */
function relayout() {
  if (measuring) return // 改可见性会再次触发 ResizeObserver，直接忽略重入
  measuring = true
  try {
    const host = tbLeft.value
    if (!host) return
    const kids = Array.from(host.children).filter(
      el => !el.classList.contains('tb-more-wrap')
    ) as HTMLElement[]
    const avail = host.clientWidth
    // 首帧/未渲染完成时不做判断，避免把按钮误收进菜单
    if (!avail || kids.length !== leftItems.value.length) return

    const widths = kids.map(el => el.offsetWidth)
    const total = widths.reduce((a, b) => a + b, 0) + TB_GAP * (widths.length - 1)
    if (total <= avail) {
      visibleCount.value = widths.length
      overflowing.value = false
      ovOpen.value = false
      return
    }
    // 需要留出「…」的位置，再从头累加能放下的项
    let budget = avail - ((ovTmp.value?.offsetWidth || 30) + TB_GAP)
    let count = 0
    for (let i = 0; i < widths.length; i++) {
      const need = widths[i] + (count ? TB_GAP : 0)
      if (count > 0 && need > budget) break
      budget -= need
      count++
    }
    // 至少保留一项在「…」里，否则不必收缩
    visibleCount.value = Math.max(1, Math.min(count, widths.length - 1))
    overflowing.value = true
  } finally {
    measuring = false
  }
}

onMounted(() => {
  document.addEventListener('click', onDocClick)
  window.addEventListener('resize', relayout)
  if (tbLeft.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => relayout())
    ro.observe(tbLeft.value)
  }
  relayout()
})

onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('resize', relayout)
  document.removeEventListener('click', onDocClick)
})

/** 文案/状态变化会改变按钮宽度，需要重新分配（如「保存 *」、导出中）；DOM 更新后再量 */
watch(
  [() => ws.settings.treeVisible, () => ws.dirty, () => ws.hasFile, () => !!exporting],
  () => relayout(),
  { flush: 'post' }
)

/** 导出文件名：去掉原文件的后缀（README.html → README，再拼 .docx/.pdf），避免出现 a.html.docx */
const fileTitle = () => ws.fileTitle.replace(/\.[^./\\]+$/, '') || 'document'

/** 导出：显示“导出中”加载动画，并按返回值区分取消、打印、成功三种提示 */
async function doExport(kind: ExportKind) {
  if (exporting.value) return
  if (!ws.hasFile && !ws.content.trim()) {
    ws.notify('没有可导出的内容')
    return
  }
  const label = EXPORT_NAME[kind]
  const t = fileTitle()
  const opts = {
    mdTheme: ws.settings.mdTheme,
    outline: ws.settings.exportOutline,
    docEngine: ws.settings.docEngine,
    pdfEngine: ws.settings.pdfEngine,
    pandocPath: ws.settings.pandocPath
  }
  exportOpen.value = false
  moreOpen.value = false
  exporting.value = kind
  ws.beginBusy('export', `导出 ${label} 中`)
  try {
    // 返回值语义：''＝用户在保存位置对话框里取消；'print'＝已调起系统打印；其余为实际保存路径
    const saved =
      kind === 'md'
        ? await exportMarkdown(ws.currentPath, ws.content)
        : kind === 'html'
          ? await exportHtml(t, ws.content, opts)
          : kind === 'doc'
            ? await exportDoc(t, ws.content, opts)
            : kind === 'docx'
              ? await exportDocx(t, ws.content, opts)
              : await exportPdf(t, ws.content, opts)
    if (!saved) ws.notify(`已取消导出 ${label}`)
    else if (saved === 'print') ws.notify('已调起系统打印，请在打印界面选「保存为 PDF」并挑存储目录')
    else ws.notifyOk(`已导出 ${label}：${saved.split('/').pop() || `${t}.${EXPORT_EXT[kind]}`}`)
  } catch (e: any) {
    const msg = String(e?.message ?? e).split('\n')[0]
    ws.notifyFail(`导出 ${label} 失败：${msg.length > 90 ? msg.slice(0, 90) + '…' : msg}`)
  } finally {
    exporting.value = ''
    ws.endBusy()
  }
}

/** 手机“更多”菜单项：先收起再执行 */
function mact(fn: () => void | Promise<unknown>) {
  moreOpen.value = false
  void fn()
}
</script>

<template>
  <!-- 手机：汉堡（文件抽屉） + 标题 + 保存/主题/更多（三个点） -->
  <header class="topbar m-top" v-if="props.mobile">
    <button class="tb-ico" title="文件" @click="emit('open-drawer')">
      <IconSvg name="menu" :size="19" />
    </button>
    <span class="tb-title">
      {{ ws.fileTitle || 'MoDown' }}
      <span v-if="ws.busy.kind || ws.rendering" class="tb-busy" :title="ws.busy.text || '处理中'">
        <span class="spinner"></span>
      </span>
      <span v-else-if="ws.dirty" class="tb-dirty">*</span>
    </span>
    <!-- 界面模式标识：一眼区分这是手机页面还是平板页面 -->
    <button class="dev-badge" :title="deviceTip" @click.stop="toggleDev">
      <IconSvg :name="props.deviceIcon || 'smartphone'" :size="12" />
      <span>{{ props.deviceLabel || '手机' }}</span>
    </button>
    <!-- 手机：没有关联文件（新建的临时稿）也能保存，点了会先选保存位置 -->
    <button class="tb-ico" :title="ws.hasFile ? (ws.dirty ? '保存（有未保存更改）' : '保存') : '保存到指定位置'" @click="onSave">
      <IconSvg name="save" :size="18" />
      <span v-if="ws.dirty" class="tb-dot"></span>
    </button>
    <button class="tb-ico" :title="themeTip" @click="ws.cycleTheme()">
      <IconSvg :name="themeIcon" :size="18" />
    </button>
    <div class="more-wrap" ref="moreTmp">
      <button class="tb-ico" title="更多" @click.stop="moreOpen = !moreOpen">
        <IconSvg name="dots" :size="19" />
      </button>
      <div class="dd-panel m-menu" v-if="moreOpen" @click.stop>
        <div class="dd-item" @click="mact(onNew)"><IconSvg name="file-plus" :size="15" />新建文件</div>
        <div class="dd-item" @click="mact(() => ws.openFolder())"><IconSvg name="folder-open" :size="15" />打开文件夹</div>
        <div class="dd-item" @click="mact(() => ws.importFile())"><IconSvg name="import" :size="15" />导入文件</div>
        <div class="dd-item" @click="mact(() => ws.saveAs())">
          <IconSvg name="save" :size="15" />另存为…
        </div>
        <div class="dd-sep"></div>
        <div class="dd-item" @click="mact(() => doExport('md'))">
          <IconSvg name="export" :size="15" />导出 MD
          <span v-if="exporting === 'md'" class="spinner ml"></span>
        </div>
        <div class="dd-item" @click="mact(() => doExport('html'))">
          <IconSvg name="export" :size="15" />导出 HTML
          <span v-if="exporting === 'html'" class="spinner ml"></span>
        </div>
        <div class="dd-item" @click="mact(() => doExport('doc'))">
          <IconSvg name="export" :size="15" />导出 DOC
          <span v-if="exporting === 'doc'" class="spinner ml"></span>
        </div>
        <div class="dd-item" @click="mact(() => doExport('docx'))">
          <IconSvg name="export" :size="15" />导出 DOCX
          <span v-if="exporting === 'docx'" class="spinner ml"></span>
        </div>
        <div class="dd-item" @click="mact(() => doExport('pdf'))">
          <IconSvg name="export" :size="15" />导出 PDF
          <span v-if="exporting === 'pdf'" class="spinner ml"></span>
        </div>
        <div class="dd-sep" v-if="CAN_SWITCH_DEVICE"></div>
        <template v-if="CAN_SWITCH_DEVICE">
          <div class="dd-caption">版本</div>
          <div
            v-for="m in AVAILABLE_DEVICE_MODES"
            :key="m"
            class="dd-item"
            @click="pickDevice(m)"
          >
            <IconSvg :name="m === 'mobile' ? 'smartphone' : 'tablet'" :size="15" />
            {{ DEVICE_NAME[m] }}
            <IconSvg v-if="ws.settings.deviceMode === m" name="check" :size="14" class="ml ml-check" />
          </div>
        </template>
        <div class="dd-sep"></div>
        <div class="dd-item" @click="mact(() => emit('open-settings'))"><IconSvg name="settings" :size="15" />设置</div>
      </div>
    </div>
  </header>

  <!-- 桌面：一排按钮；窗口变窄（或按钮变多）时尾部按钮自动收进「…」溢出菜单 -->
  <header class="topbar" v-else>
    <div class="tb-left" ref="tbLeft">
      <!-- 普通按钮：文件树开关为纯图标，其余为图标 + 文字 -->
      <template v-for="(it, i) in leftItems" :key="it.key">
        <button
          v-if="!it.export"
          :class="{ active: it.active, 'tb-panel': it.iconOnly, 'tb-hidden': i >= visibleCount }"
          :title="it.tip"
          :disabled="it.disabled"
          @click="runItem(it.key)"
        >
          <IconSvg v-if="it.icon" :name="it.icon" :size="it.iconOnly ? 15 : 14" />
          <span v-if="!it.iconOnly">{{ it.label }}{{ it.dirty ? ' *' : '' }}</span>
        </button>
      </template>
      <!-- 导出：带下拉面板，刻意写在 v-for 之外，保证 ref 拿到单个元素 -->
      <div class="dropdown" ref="tmp" :class="{ 'tb-hidden': EXPORT_INDEX >= visibleCount }">
        <button @click.stop="exportOpen = !exportOpen" :disabled="!!exporting" title="导出为 MD / HTML / DOC / DOCX / PDF">
          <span v-if="exporting" class="spinner"></span>
          <span>{{ exporting ? `导出 ${EXPORT_NAME[exporting]} 中` : '导出' }}</span>
          <span v-if="!exporting">▾</span>
        </button>
        <div class="dd-panel" v-if="exportOpen">
          <div class="dd-item" @click="doExport('md')">导出 MD</div>
          <div class="dd-item" @click="doExport('html')">导出 HTML</div>
          <div class="dd-item" @click="doExport('doc')">导出 DOC</div>
          <div class="dd-item" @click="doExport('docx')">导出 DOCX</div>
          <div class="dd-item" @click="doExport('pdf')">导出 PDF</div>
        </div>
      </div>
      <!-- 放不下的按钮收在这里（与 VSCode 标题栏的 More Actions 一致） -->
      <div class="dropdown tb-more-wrap" ref="ovTmp" :class="{ 'tb-hidden': !overflowing }">
        <button class="tb-panel" :title="moreTip" @click.stop="ovOpen = !ovOpen">
          <IconSvg name="dots" :size="15" />
        </button>
        <div class="dd-panel ov-panel" v-if="ovOpen" @click.stop>
          <template v-for="it in overflowItems" :key="it.key">
            <template v-if="it.export">
              <div class="dd-caption">导出</div>
              <div class="dd-item" @click="doExport('md')"><IconSvg name="export" :size="14" />导出 MD</div>
              <div class="dd-item" @click="doExport('html')"><IconSvg name="export" :size="14" />导出 HTML</div>
              <div class="dd-item" @click="doExport('doc')"><IconSvg name="export" :size="14" />导出 DOC</div>
              <div class="dd-item" @click="doExport('docx')"><IconSvg name="export" :size="14" />导出 DOCX</div>
              <div class="dd-item" @click="doExport('pdf')"><IconSvg name="export" :size="14" />导出 PDF</div>
            </template>
            <div v-else class="dd-item" :class="{ 'is-disabled': it.disabled }" @click="runMenuItem(it.key)">
              <IconSvg v-if="it.icon" :name="it.icon" :size="14" />
              <span>{{ it.label }}{{ it.dirty ? ' *' : '' }}</span>
            </div>
          </template>
        </div>
      </div>
    </div>
    <button :class="{ active: ws.settings.splitView }" @click="ws.updateSetting('splitView', !ws.settings.splitView)"><span>分屏预览</span></button>
    <button :class="{ active: ws.settings.outlineVisible }" @click="ws.updateSetting('outlineVisible', !ws.settings.outlineVisible)"><span>大纲</span></button>
    <!-- 界面模式标识：PC 编译版本固定显示 PC（不可切换）；移动端版本才可点开切换 -->
    <div class="dropdown" ref="devTmp" v-if="CAN_SWITCH_DEVICE">
      <button class="dev-chip" :title="deviceTip" @click.stop="toggleDev">
        <IconSvg :name="props.deviceIcon || 'monitor'" :size="14" />
        <span>{{ props.deviceLabel || 'PC' }}</span>
      </button>
      <div class="dd-panel dev-panel" v-if="devOpen">
        <div class="dd-caption">版本</div>
        <div v-for="m in AVAILABLE_DEVICE_MODES" :key="m" class="dd-item" @click="pickDevice(m)">
          <IconSvg :name="m === 'mobile' ? 'smartphone' : 'tablet'" :size="14" />
          <span>{{ DEVICE_NAME[m] }}</span>
          <IconSvg v-if="ws.settings.deviceMode === m" name="check" :size="14" class="ml-check" />
        </div>
      </div>
    </div>
    <span v-else class="dev-chip" :title="deviceTip">
      <IconSvg :name="props.deviceIcon || 'monitor'" :size="14" />
      <span>{{ props.deviceLabel || 'PC' }}</span>
    </span>
    <button :title="themeTip" @click="ws.cycleTheme()"><IconSvg :name="themeIcon" :size="14" /></button>
    <button @click="emit('open-settings')"><span>设置</span></button>
    <slot />
  </header>
</template>

<style scoped>
/* 桌面顶栏：文件树开关 / 溢出按钮（纯图标，无文字），激活态表示对应面板正在显示 */
.tb-panel { padding: 3px 6px; }
/* ---------- 桌面顶栏左侧按钮组：空间不足时自动收缩（VSCode 标题栏 More Actions） ---------- */
.tb-left {
  display: flex; align-items: center; gap: 4px;
  flex: 1 1 auto; min-width: 0; position: relative;
}
.tb-left > * { flex: none; }
/* 被收进「…」的按钮：脱离文档流但仍可测量自然宽度（不能用 display:none，否则测不到宽度） */
.tb-hidden { position: absolute; visibility: hidden; pointer-events: none; }
/* 「…」溢出菜单 */
.ov-panel { min-width: 168px; }
.ov-panel .dd-item {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; font-size: 12.5px; white-space: nowrap;
}
.ov-panel .dd-item svg { color: var(--fg-dim); }
.ov-panel .dd-item.is-disabled { opacity: .45; pointer-events: none; }
/* 手机版顶栏：单行不换行，图标按钮大触控区，滚动时固定在顶部 */
.m-top {
  flex-wrap: nowrap; padding: 0 6px; height: calc(48px + env(safe-area-inset-top, 0px));
  padding-top: env(safe-area-inset-top, 0px);
  position: sticky; top: 0; z-index: 40;
}
.m-top .tb-ico {
  position: relative;
  display: flex; align-items: center; justify-content: center;
  width: 38px; height: 38px; border-radius: 10px; color: var(--fg);
  flex: none;
}
.m-top .tb-title {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 14px; font-weight: 600; text-align: center;
  display: flex; align-items: center; justify-content: center; gap: 5px;
}
.tb-busy { display: inline-flex; align-items: center; }
.tb-dirty { color: #d97706; }
.dark .tb-dirty { color: #fbbf24; }
/* 设备模式标识：小胶囊，一眼区分手机/PC 页面 */
.dev-badge {
  flex: none; display: inline-flex; align-items: center; gap: 3px;
  height: 24px; padding: 0 7px; margin-right: 2px;
  font-size: 11.5px; font-weight: 600; line-height: 1;
  color: var(--accent); border: 1px solid var(--border); border-radius: 999px;
  background: var(--bg-active);
}
.dev-chip {
  display: inline-flex; align-items: center; gap: 5px;
  color: var(--accent); font-weight: 600;
}
/* PC 编译版本：标识不可点击，与按钮尺寸对齐 */
span.dev-chip { padding: 3px 8px; cursor: default; font-size: 12px; }
.dev-panel { min-width: 150px; }
.dd-caption { padding: 6px 10px 2px; font-size: 11.5px; color: var(--fg-dim); }
.ml { margin-left: auto; }
.ml-check { margin-left: auto; color: var(--accent); }
.tb-dot {
  position: absolute; top: 7px; right: 7px;
  width: 7px; height: 7px; border-radius: 50%;
  background: #d97706; border: 1.5px solid var(--bg-side);
}
.dark .tb-dot { background: #fbbf24; }
.m-menu { right: 4px; left: auto; min-width: 170px; }
.m-menu .dd-item { display: flex; align-items: center; gap: 9px; padding: 9px 10px; font-size: 13.5px; }
.m-menu .dd-item svg { color: var(--fg-dim); }
.dd-sep { height: 1px; background: var(--border); margin: 4px 8px; }
</style>
