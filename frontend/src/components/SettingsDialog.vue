<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { DEFAULT_SETTINGS, useWorkspace, type Settings } from '../stores/workspace'
import { bridge } from '../bridge'
import { AVAILABLE_DEVICE_MODES, CAN_SWITCH_DEVICE, type DeviceMode } from '../utils/device'
import { switchEditMode } from '../utils/editorSwitch'
import IconSvg from './IconSvg.vue'

const ws = useWorkspace()
const props = defineProps<{ mobile?: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

function setDevice(v: string) {
  void ws.updateSetting('deviceMode', v as DeviceMode)
}

const mdThemes = [
  { value: 'default', label: '默认（跟随应用）' },
  { value: 'github', label: 'GitHub' },
  { value: 'vuepress', label: 'VuePress' },
  { value: 'vue', label: 'Vue 文档风' },
  { value: 'readable', label: '阅读友好（衬线）' }
] as const

const editorModes = [
  { value: 'tiptap', label: 'Tiptap 富文本（所见即所得）' },
  { value: 'codemirror', label: 'CodeMirror 6 源码' },
  { value: 'preview', label: '预览（图片/视频/PDF 等）' }
] as const

/** pandoc / PDF 直出仅桌面系统（Windows / macOS / Linux）支持 */
const isDesktop = bridge.platform === 'wails'

/** PC：左侧导航；手机：不分页，所有设置依次列出 */
type SectionId = 'ui' | 'editor' | 'export' | 'about'
const active = ref<SectionId>('ui')
const sections: { id: SectionId; label: string; icon: string; keywords: string }[] = [
  {
    id: 'ui',
    label: '界面与布局',
    icon: 'panel-left',
    keywords: '界面 布局 主题 分屏 大纲 颜色 版本 宽度 拖拽 行号'
  },
  {
    id: 'editor',
    label: '编辑器',
    icon: 'format',
    keywords: '编辑器 字体 字号 换行 小地图 markdown 片段 vscode monaco 补全'
  },
  {
    id: 'export',
    label: '导出',
    icon: 'export',
    keywords: '导出 doc docx pdf pandoc html 大纲 路径 引擎'
  },
  {
    id: 'about',
    label: '关于',
    icon: 'file-md',
    keywords: '关于 版本 快捷键 重置 恢复 默认 取消 应用'
  }
]
/** IDEA 风格的设置搜索：按分区名 + 关键词过滤左侧导航 */
const query = ref('')
const queryInput = ref<HTMLInputElement>()
/** 点搜索框任意位置都聚焦到输入（含点击放大镜图标 / 内边距时） */
function focusSearch() {
  queryInput.value?.focus()
}
const visibleSections = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return sections
  return sections.filter(s => (s.label + ' ' + s.keywords).toLowerCase().includes(q))
})
const show = (id: SectionId) => props.mobile || active.value === id
watch(visibleSections, list => {
  if (!props.mobile && list.length && !list.some(s => s.id === active.value)) {
    active.value = list[0].id
  }
})

/** 打开设置时的快照：点「取消」要能原样回滚（IDEA 的 Cancel 语义） */
const snapshot = { ...ws.settings } as Settings

async function cancel() {
  for (const key of Object.keys(snapshot) as (keyof Settings)[]) {
    if (ws.settings[key] !== snapshot[key]) {
      await ws.updateSetting(key as any, snapshot[key] as any)
    }
  }
  emit('close')
}

function apply() {
  ws.notifyOk('设置已应用')
}

function confirm() {
  apply()
  emit('close')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    void cancel()
  }
}
onMounted(async () => {
  window.addEventListener('keydown', onKey)
  if (isDesktop && ws.settings.pandocPath) {
    try {
      pandocStatus.value = (await bridge.validatePandoc?.(ws.settings.pandocPath)) || ''
    } catch {
      pandocStatus.value = ''
    }
  }
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

/** Pandoc 版本提示（验证通过后显示，如 "pandoc 3.1.11"） */
const pandocStatus = ref('')

/** 选择 Pandoc 可执行文件（桌面端原生文件框 + 后端验证） */
async function pickPandoc() {
  try {
    const p = await bridge.pickPandoc?.()
    if (!p) return
    const ver = (await bridge.validatePandoc?.(p)) || ''
    await ws.updateSetting('pandocPath', p)
    pandocStatus.value = ver
    ws.notifyOk(`Pandoc 已验证${ver ? '：' + ver : ''}`)
  } catch (e: any) {
    ws.notifyFail(`不是有效的 Pandoc：${String(e?.message ?? e)}`)
  }
}

/** 手动输入路径：先验证，不是 Pandoc 就恢复原值，不保存无效路径 */
async function onPandocChange(e: Event) {
  const el = e.target as HTMLInputElement
  const v = el.value.trim()
  if (!v) {
    pandocStatus.value = ''
    await ws.updateSetting('pandocPath', '')
    return
  }
  try {
    const ver = (await bridge.validatePandoc?.(v)) || '已验证'
    await ws.updateSetting('pandocPath', v)
    pandocStatus.value = ver
    ws.notifyOk(`Pandoc 已验证：${ver}`)
  } catch (err: any) {
    el.value = ws.settings.pandocPath
    pandocStatus.value = ''
    ws.notifyFail(`不是有效的 Pandoc：${String(err?.message ?? err)}`)
  }
}

/** 恢复默认布局（文件树 / 大纲 / 分屏比例） */
function resetLayout() {
  void ws.updateSetting('sidebarWidth', 230)
  void ws.updateSetting('outlineWidth', 220)
  void ws.updateSetting('splitRatio', 0.5)
}

/** 恢复所有设置默认值（界面模式是编译期固定的，不重置） */
async function resetAll() {
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (key === 'deviceMode') continue
    await ws.updateSetting(key as any, DEFAULT_SETTINGS[key] as any)
  }
}

const appVersion = '0.1.0'
</script>

<template>
  <!-- 手机：全屏页面；桌面：居中弹窗。
       点击遮罩不关闭（避免误触丢掉刚改的设置），只能点右上角关闭 / 底部「完成」 -->
  <div class="dialog-mask settings-mask" :class="{ full: props.mobile }">
    <div class="dialog settings" :class="{ full: props.mobile }" @click.stop>
      <div class="set-head">
        <button v-if="props.mobile" class="set-back" title="返回" @click="cancel">
          <IconSvg name="back" :size="18" />
        </button>
        <h3>设置</h3>
        <button v-if="!props.mobile" class="set-back" title="关闭" @click="cancel">
          <IconSvg name="x" :size="15" />
        </button>
      </div>

      <div class="settings-layout" :class="{ mobile: props.mobile }">
        <!-- PC：左侧分区导航（IDEA Preferences 结构：搜索 + 分类树 + 底部按钮） -->
        <nav v-if="!props.mobile" class="settings-nav">
          <label class="settings-search" @click="focusSearch">
            <IconSvg name="search" :size="13" />
            <input ref="queryInput" v-model="query" placeholder="搜索设置" spellcheck="false" />
          </label>
          <button
            v-for="s in visibleSections"
            :key="s.id"
            :class="{ active: active === s.id }"
            @click="active = s.id"
          >
            <IconSvg :name="s.icon" :size="15" />
            <span>{{ s.label }}</span>
          </button>
          <div v-if="!visibleSections.length" class="settings-empty">没有匹配的设置</div>
        </nav>

        <div class="settings-content">
          <!-- ---------------- 界面与布局 ---------------- -->
          <section v-if="show('ui')" class="set-section">
            <h4 class="dialog-sub">界面</h4>
            <div class="row" v-if="CAN_SWITCH_DEVICE">
              <span>版本</span>
              <select :value="ws.settings.deviceMode" @change="setDevice(($event.target as HTMLSelectElement).value)">
                <option v-for="m in AVAILABLE_DEVICE_MODES" :key="m" :value="m">
                  {{ m === 'mobile' ? '手机版' : '平板版' }}
                </option>
              </select>
            </div>
            <div class="row" v-else>
              <span>版本</span>
              <span class="ro-value">PC版</span>
            </div>
            <div class="row">
              <span>分屏模式（左编辑 / 右预览）</span>
              <input
                type="checkbox"
                :checked="ws.settings.splitView"
                @change="ws.updateSetting('splitView', ($event.target as HTMLInputElement).checked)"
              />
            </div>
            <div class="row">
              <span>显示大纲栏</span>
              <input
                type="checkbox"
                :checked="ws.settings.outlineVisible"
                @change="ws.updateSetting('outlineVisible', ($event.target as HTMLInputElement).checked)"
              />
            </div>
            <div class="row">
              <span>颜色主题</span>
              <select
                :value="ws.settings.theme"
                @change="ws.updateSetting('theme', ($event.target as HTMLSelectElement).value as any)"
              >
                <option value="auto">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </div>

            <h4 class="dialog-sub">布局</h4>
            <p class="dialog-hint">
              文件树、编辑区 / 预览、大纲栏之间的分隔条都可以拖拽调整宽度；双击分隔条恢复默认。
              宽度会自动记住。
            </p>
            <div class="row layout-reset">
              <span>恢复默认布局</span>
              <button class="ghost-btn" @click="resetLayout">恢复</button>
            </div>
          </section>

          <!-- ---------------- 编辑器 ---------------- -->
          <section v-if="show('editor')" class="set-section">
            <h4 class="dialog-sub">编辑器</h4>
            <div class="row">
              <span>默认编辑器</span>
              <select
                :value="ws.settings.editorMode"
                @change="void switchEditMode(($event.target as HTMLSelectElement).value as any)"
              >
                <option v-for="m in editorModes" :key="m.value" :value="m.value">{{ m.label }}</option>
                <option value="split" :disabled="!ws.settings.enableMonaco">VSCode（Monaco 占据整个编辑区）</option>
              </select>
            </div>
            <div class="row">
              <span>启用 VSCode 编辑器（Monaco，支持 java/python/go/ini/yaml/bash 等语言高亮）</span>
              <input
                type="checkbox"
                :checked="ws.settings.enableMonaco"
                @change="ws.updateSetting('enableMonaco', ($event.target as HTMLInputElement).checked)"
              />
            </div>
            <div class="row">
              <span>VSCode 字号</span>
              <input
                type="number"
                min="10"
                max="24"
                style="width: 90px"
                :value="ws.settings.editorFontSize"
                @change="ws.updateSetting('editorFontSize', Math.max(10, Math.min(24, Number(($event.target as HTMLInputElement).value) || 14)))"
              />
            </div>
            <div class="row">
              <span>VSCode 自动换行</span>
              <input
                type="checkbox"
                :checked="ws.settings.editorWordWrap"
                @change="ws.updateSetting('editorWordWrap', ($event.target as HTMLInputElement).checked)"
              />
            </div>
            <div class="row">
              <span>VSCode 小地图</span>
              <input
                type="checkbox"
                :checked="ws.settings.editorMinimap"
                @change="ws.updateSetting('editorMinimap', ($event.target as HTMLInputElement).checked)"
              />
            </div>
            <div class="row">
              <span>Markdown 主题</span>
              <select
                :value="ws.settings.mdTheme"
                @change="ws.updateSetting('mdTheme', ($event.target as HTMLSelectElement).value as any)"
              >
                <option v-for="t in mdThemes" :key="t.value" :value="t.value">{{ t.label }}</option>
              </select>
            </div>

            <p class="dialog-hint">
              VSCode 编辑器里输入 <code>!</code> 生成 HTML5 骨架；直接输入 <code>h1</code>、
              <code>br</code>、<code>div</code>（或带冒号的 <code>:h1</code>）会弹出 HTML 片段，
              <code>def</code> / <code>func</code> / <code>class</code> 等对应 Python / Go / C / Java 模板。
              选中后自动补全，光标停在正文位置。
            </p>
            <p class="dialog-hint">
              切换文件时会保留未保存的正文、光标和滚动位置，文件树上有橙色圆点标记未保存的草稿。
            </p>
          </section>

          <!-- ---------------- 导出 ---------------- -->
          <section v-if="show('export')" class="set-section">
            <h4 class="dialog-sub">导出</h4>
            <div class="row">
              <span>HTML 导出附带右侧可折叠大纲</span>
              <input
                type="checkbox"
                :checked="ws.settings.exportOutline"
                @change="ws.updateSetting('exportOutline', ($event.target as HTMLInputElement).checked)"
              />
            </div>
            <div class="row">
              <span>DOC 导出引擎</span>
              <select
                :value="ws.settings.docEngine"
                @change="ws.updateSetting('docEngine', ($event.target as HTMLSelectElement).value as any)"
              >
                <option value="html">HTML 封装（全平台）</option>
                <option value="pandoc" :disabled="!isDesktop">Pandoc 原生 docx（仅桌面）</option>
              </select>
            </div>
            <div class="row">
              <span>PDF 导出引擎</span>
              <select
                :value="ws.settings.pdfEngine"
                @change="ws.updateSetting('pdfEngine', ($event.target as HTMLSelectElement).value as any)"
              >
                <option value="browser">无头浏览器直出（默认）</option>
                <option value="pandoc" :disabled="!isDesktop">Pandoc（xelatex，仅桌面）</option>
              </select>
            </div>
            <div class="row" v-if="isDesktop">
              <span>Pandoc 路径</span>
              <div class="path-field">
                <input
                  type="text"
                  placeholder="留空自动从 PATH 查找"
                  :value="ws.settings.pandocPath"
                  @change="onPandocChange"
                />
                <button class="ghost-btn" title="选择并验证 pandoc 可执行文件" @click="pickPandoc">
                  浏览…
                </button>
              </div>
            </div>
            <p v-if="pandocStatus" class="pandoc-ok">
              <IconSvg name="check" :size="12" /> 已检测到：{{ pandocStatus }}
            </p>
            <p class="dialog-hint">
              <strong>DOCX</strong>：目前没有内置的纯 JS 生成器，桌面端优先调用 Pandoc 生成真正的
              .docx；Pandoc 不可用时自动回退 Word 兼容的 .doc（可在 Word/WPS 里另存为 .docx）。
            </p>
            <p class="dialog-hint" v-if="isDesktop">
              PDF 直接生成文件（非打印）；书签大纲由引擎自动写入，可被阅读器识别；
              Word/WPS 打开 DOC 后可在导航窗格查看大纲。Pandoc 不可用时会自动改用默认引擎导出并提示。
            </p>
            <p class="dialog-hint" v-else>
              手机 / 网页版没有 Pandoc：PDF 走系统打印或浏览器打印，DOC/DOCX 使用 Word 兼容的 HTML 封装。
            </p>
          </section>

          <!-- ---------------- 关于 ---------------- -->
          <section v-if="show('about')" class="set-section">
            <h4 class="dialog-sub">关于</h4>
            <div class="about-card">
              <div class="about-name">MoDown</div>
              <div class="about-desc">本地优先的跨平台 Markdown 编辑器</div>
              <div class="about-meta">
                <span>版本 {{ appVersion }}</span>
                <span>·</span>
                <span>{{ isDesktop ? '桌面版（Wails）' : bridge.platform === 'capacitor-android' ? 'Android 版' : bridge.platform === 'harmony' ? 'HarmonyOS 版' : '网页版' }}</span>
              </div>
            </div>

            <h4 class="dialog-sub">快捷键</h4>
            <div class="kbd-list">
              <div><kbd>Ctrl</kbd> + <kbd>S</kbd><span>保存</span></div>
              <div><kbd>Ctrl</kbd> + <kbd>N</kbd><span>新建文件</span></div>
              <div><kbd>Ctrl</kbd> + <kbd>O</kbd><span>打开文件夹</span></div>
            </div>

            <p class="dialog-hint">
              文档、主题和布局都存在本机；不会上传任何内容。切换工作区后，草稿会随旧工作区一起失效。
              「取消」会撤销本次打开设置后做的所有修改。
            </p>
          </section>
        </div>
      </div>

      <!-- IDEA 风格：按钮固定在弹窗底部，不跟随右侧内容滚动 -->
      <div class="footer" v-if="!props.mobile">
        <button class="footer-link" @click="resetAll">恢复默认设置</button>
        <span class="footer-spacer"></span>
        <button @click="cancel">取消</button>
        <button @click="apply">应用</button>
        <button class="active" @click="confirm">确定</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 标题栏 + 右上角关闭按钮固定：内容滚动时始终可见。
   负外边距与内边距等量抵消，视觉位置与改动前完全一致 */
.set-head {
  display: flex; align-items: center; gap: 10px;
  position: sticky; z-index: 3; top: -18px;
  margin: -18px 0 0;
  padding: 18px 0 8px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}
.set-head h3 { margin: 0; flex: 1; }
.set-back {
  display: flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: 9px; color: var(--fg-dim);
}
.set-back:hover { color: var(--fg); background: var(--bg-hover); }

/* 手机全屏 */
.settings-mask.full { background: var(--bg); align-items: stretch; justify-content: stretch; }
.dialog.full.settings {
  width: 100%; max-width: none; height: 100%;
  border-radius: 0; border: none;
  overflow-y: auto; -webkit-overflow-scrolling: touch;
  padding: calc(10px + env(safe-area-inset-top)) 18px calc(30px + env(safe-area-inset-bottom));
  animation: page-in .18s ease;
}
@keyframes page-in { from { transform: translateX(28px); opacity: .5; } }
/* 手机全屏页同样固定标题栏：抵消页面顶部内边距（含状态栏安全区） */
.dialog.full.settings .set-head {
  top: calc(-10px - env(safe-area-inset-top, 0px));
  margin: calc(-10px - env(safe-area-inset-top, 0px)) 0 0;
  padding: calc(10px + env(safe-area-inset-top, 0px)) 0 10px;
}
.dialog.full .row { padding: 14px 0; border-bottom: 1px solid var(--border); }
.dialog.full .row span { font-size: 14.5px; max-width: 62%; }
.dialog.full select, .dialog.full input[type='text'] { font-size: 14px; padding: 8px 10px; max-width: 190px; }
.dialog.full input[type='checkbox'] { width: 20px; height: 20px; }
.dialog.full .dialog-sub { margin-top: 22px; font-size: 13px; }

/* ---------- PC：Preferences 两栏布局 ---------- */
@media (min-width: 701px) {
  .dialog.settings {
    width: min(880px, 94vw);
    /* 固定高度：切换左侧分区时窗口不再忽高忽低（内容在右侧内部滚动）。
       留出标题栏 / 状态栏空间，避免底部按钮被顶出屏幕。 */
    height: min(680px, calc(100vh - 80px));
    max-height: calc(100vh - 80px);
    padding: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    /* IDEA 风格：内容区纯白、边框更细、圆角更小 */
    border-radius: 8px;
  }
  .dialog.settings .set-head {
    position: static;
    margin: 0;
    padding: 14px 20px 10px;
    background: var(--bg-side);
  }
  .set-head h3 { font-size: 15px; font-weight: 600; }
  .settings-layout {
    display: flex;
    flex: 1;
    min-height: 0;
  }
  .settings-nav {
    width: 196px;
    flex: none;
    padding: 8px;
    border-right: 1px solid var(--border);
    background: var(--bg-side);
    display: flex;
    flex-direction: column;
    gap: 1px;
    overflow-y: auto;
  }
  /* IDEA 顶部的设置搜索框 */
  .settings-search {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 2px 4px 8px;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg-dim);
  }
  .settings-search:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--bg-active);
  }
  .settings-search input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    box-shadow: none;
    background: transparent;
    font-size: 12.5px;
    color: var(--fg);
  }
  .settings-search input:focus { outline: none; box-shadow: none; }
  .settings-nav button {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    padding: 7px 10px;
    border-radius: 5px;
    font-size: 13px;
    color: var(--fg-dim);
    text-align: left;
  }
  .settings-nav button:hover { background: var(--bg-hover); color: var(--fg); }
  .settings-nav button.active { background: var(--bg-active); color: var(--accent); font-weight: 600; }
  .settings-empty { padding: 10px; font-size: 12px; color: var(--fg-dim); }
  .settings-content {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding: 6px 22px 18px;
  }
  .settings-content .dialog-sub:first-child { margin-top: 8px; }
  .dialog.settings .row { padding: 9px 0; }
  .dialog.settings .row > span:first-child { padding-top: 0; line-height: 1.45; }
  .layout-reset { border-top: 1px dashed var(--border); margin-top: 8px; }
  .footer {
    position: relative;
    z-index: 10;
    flex: none;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 20px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg-side);
  }
  .footer button { padding: 6px 18px; }
  .footer .active { background: var(--accent); color: #fff; }
  .footer .active:hover { filter: brightness(1.08); }
  .footer-link {
    color: var(--fg-dim);
    border-color: transparent;
    background: transparent;
    padding: 6px 4px;
  }
  .footer-link:hover { color: var(--accent); background: transparent; }
  .footer-spacer { flex: 1; }
}

/* 设置项复选框：默认 17px 偏小，统一放大到 20px */
.dialog.settings input[type='checkbox'] {
  width: 20px;
  height: 20px;
  accent-color: var(--accent);
  flex: none;
}

/* ---------- 小分辨率：窄屏把左侧导航改为横向标签，内容占满 ---------- */
@media (max-width: 700px) {
  .dialog.settings:not(.full) {
    width: 100vw;
    height: 100vh;
    max-height: 100vh;
    border-radius: 0;
    border: none;
    padding: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .dialog.settings:not(.full) .set-head {
    position: static;
    margin: 0;
    padding: 8px 14px 6px;
  }
  .settings-layout {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .settings-nav {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 2px;
    flex: none;
    width: auto;
    padding: 6px;
    border-right: none;
    border-bottom: 1px solid var(--border);
    background: var(--bg-side);
    overflow-x: auto;
    overflow-y: hidden;
  }
  .settings-search {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 140px;
    margin: 0 6px 0 0;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: var(--fg-dim);
  }
  .settings-search input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    font-size: 12.5px;
    color: var(--fg);
  }
  .settings-nav button {
    display: flex;
    align-items: center;
    gap: 6px;
    width: auto;
    padding: 6px 9px;
    border-radius: 5px;
    font-size: 12.5px;
    color: var(--fg-dim);
    white-space: nowrap;
  }
  .settings-nav button:hover { background: var(--bg-hover); color: var(--fg); }
  .settings-nav button.active { background: var(--bg-active); color: var(--accent); font-weight: 600; }
  .settings-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 6px 14px 12px;
  }
  .footer {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 8px 14px 10px;
    border-top: 1px solid var(--border);
    background: var(--bg-side);
  }
  .footer .active { background: var(--accent); color: #fff; }
  .footer-link { color: var(--fg-dim); border-color: transparent; background: transparent; }
  .footer-spacer { flex: 1; }
}

/* 低高度屏幕：压缩标题/行距/底部按钮，避免内容被裁 */
@media (max-height: 640px) {
  .dialog.settings:not(.full) {
    height: calc(100vh - 12px);
    max-height: calc(100vh - 12px);
  }
  .dialog.settings .set-head { padding: 8px 14px 6px; }
  .dialog.settings .row { padding: 5px 0; }
  .dialog.settings .dialog-sub { margin-top: 10px; }
  .footer { padding: 6px 14px 8px; }
  .footer button { padding: 4px 12px; }
}

/* Pandoc 路径：输入框 + 原生文件选择（窄窗口自动换行） */
.path-field {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
}
.path-field input { width: 240px; max-width: 46vw; }
.pandoc-ok {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 2px 0 6px;
  font-size: 12px;
  color: #16a34a;
}

/* 手机：所有分区顺序展开 */
.settings-layout.mobile { display: block; }

/* 只读值（如 PC版），按正常取值显示 */
.ro-value { font-size: 13px; color: var(--fg); }

/* 小号次要按钮 */
.ghost-btn {
  padding: 4px 14px;
  font-size: 12.5px;
  color: var(--accent);
  border: 1px solid var(--border);
  border-radius: 7px;
  background: transparent;
}
.ghost-btn:hover { background: var(--bg-hover); }

/* 关于 */
.about-card {
  margin: 8px 0 4px;
  padding: 16px 18px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-side);
}
.about-name { font-size: 17px; font-weight: 700; color: var(--accent); }
.about-desc { margin-top: 4px; font-size: 12.5px; color: var(--fg-dim); }
.about-meta { margin-top: 8px; font-size: 12px; color: var(--fg-dim); display: flex; gap: 6px; }
.kbd-list { display: grid; gap: 6px; margin: 6px 0 4px; }
.kbd-list > div { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--fg-dim); }
.kbd-list span { margin-left: 6px; }
kbd {
  font-family: inherit;
  font-size: 11px;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-bottom-width: 2px;
  border-radius: 5px;
  background: var(--bg);
  color: var(--fg);
}

/* 搜索框：焦点边框/光圈画在外层 label 上；内部 input 完全透明，
   否则全局 input:focus 会给它画一个自己的矩形底/蓝框，圆角看起来被切掉。 */
.settings-search { overflow: hidden; cursor: text; }
.settings-search input,
.settings-search input:hover,
.settings-search input:focus,
.settings-search input:focus-visible {
  border: none !important;
  background: transparent !important;
  box-shadow: none !important;
  outline: none !important;
  border-radius: 0 !important;
  padding: 0 !important;
  height: 18px;
}
</style>
