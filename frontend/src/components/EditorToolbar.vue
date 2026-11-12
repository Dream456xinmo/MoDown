<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Editor } from '@tiptap/core'
import IconSvg from './IconSvg.vue'
import { uiPrompt } from '../composables/dialogs'
import { bridge } from '../bridge'
import { useWorkspace } from '../stores/workspace'

const props = defineProps<{ editor: Editor | null }>()
const ws = useWorkspace()

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?|#.*)?$/i

/** 按路径/URL 判断类型：图片以内嵌图插入，其他资源以链接插入 */
function insertAssetPath(p: string) {
  const e = props.editor
  if (!e) return
  const name = decodeURIComponent(p.split('/').pop() || p)
  if (IMAGE_RE.test(p)) {
    e.chain().focus().setImage({ src: p, alt: name }).run()
  } else {
    e.chain().focus().insertContent({
      type: 'text',
      text: name,
      marks: [{ type: 'link', attrs: { href: p, target: '_blank' } }]
    }).run()
  }
}

async function importMedia(folder: 'assets' | 'files') {
  try {
    const p = await bridge.importAsset(folder)
    if (p) insertAssetPath(p)
  } catch (err: any) {
    // 手机上文件选择器 / SAF 写入失败时不能只写 console，用户会以为按钮没反应
    ws.notifyFail(`导入${folder === 'assets' ? '图片' : '附件'}失败：${String(err?.message ?? err)}`)
  }
}

async function insertWebMedia() {
  const url = await uiPrompt({
    title: '插入网络媒体',
    message: '图片 / 视频 / 音频 / 网页的 URL 或本地绝对路径',
    defaultValue: 'https://'
  })
  const v = url?.trim()
  if (v && /^(https?:\/\/|file:\/|\/|[a-z]:[\\/])/i.test(v)) insertAssetPath(v)
}

async function toggleLink() {
  const e = props.editor
  if (!e) return
  if (e.isActive('link')) {
    e.chain().focus().extendMarkRange('link').unsetLink().run()
    return
  }
  const url = await uiPrompt({
    title: '插入链接',
    message: '输入 URL（http:// 或 https:// 开头）',
    defaultValue: 'https://'
  })
  if (url && /^(https?:\/\/|mailto:)/i.test(url.trim())) {
    e.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
  }
}

const act = (name: string, opts?: Record<string, unknown>) => !!props.editor?.isActive(name, opts)
const chain = () => props.editor?.chain().focus()

/**
 * 编辑器事务（选区 / 内容变化）后刷新按钮高亮态：
 * tick 自增让下面的 groups 重新计算（computed 本身不依赖 editor 内部状态）
 */
const tick = ref(0)
watch(
  () => props.editor,
  e => {
    if (e) e.on('transaction', () => (tick.value++))
  },
  { immediate: true }
)

/** 工具按钮；分组是折叠的最小单位 */
type Tool = {
  key: string
  /** 折叠菜单/提示用的短名 */
  label: string
  /** 鼠标悬停提示（含快捷键） */
  title: string
  icon?: string
  /** 文字按钮（如 H1–H6） */
  text?: string
  active?: boolean
  disabled?: boolean
  run: () => void | Promise<void>
}
type ToolGroup = { caption: string; tools: Tool[] }

const groups = computed<ToolGroup[]>(() => {
  void tick.value // 依赖事务计数
  const e = props.editor
  return [
    {
      caption: '撤销重做',
      tools: [
        { key: 'undo', label: '撤销', title: '撤销 (Ctrl+Z)', icon: 'undo', disabled: !e?.can().undo(), run: () => void chain()?.undo().run() },
        { key: 'redo', label: '重做', title: '重做 (Ctrl+Y)', icon: 'redo', disabled: !e?.can().redo(), run: () => void chain()?.redo().run() }
      ]
    },
    {
      caption: '标题',
      tools: ([1, 2, 3, 4, 5, 6] as const).map(lv => ({
        key: 'h' + lv,
        label: `标题 ${lv}`,
        title: `标题 ${lv}`,
        text: 'H' + lv,
        active: act('heading', { level: lv }),
        run: () => void chain()?.toggleHeading({ level: lv }).run()
      }))
    },
    {
      caption: '行内格式',
      tools: [
        { key: 'bold', label: '加粗', title: '加粗 (Ctrl+B)', icon: 'bold', active: act('bold'), run: () => void chain()?.toggleBold().run() },
        { key: 'italic', label: '斜体', title: '斜体 (Ctrl+I)', icon: 'italic', active: act('italic'), run: () => void chain()?.toggleItalic().run() },
        { key: 'strike', label: '删除线', title: '删除线', icon: 'strike', active: act('strike'), run: () => void chain()?.toggleStrike().run() },
        { key: 'code', label: '行内代码', title: '行内代码', icon: 'inline-code', active: act('code'), run: () => void chain()?.toggleCode().run() }
      ]
    },
    {
      caption: '块级元素',
      tools: [
        { key: 'bulletList', label: '无序列表', title: '无序列表', icon: 'list-ul', active: act('bulletList'), run: () => void chain()?.toggleBulletList().run() },
        { key: 'orderedList', label: '有序列表', title: '有序列表', icon: 'list-ol', active: act('orderedList'), run: () => void chain()?.toggleOrderedList().run() },
        { key: 'blockquote', label: '引用', title: '引用', icon: 'quote', active: act('blockquote'), run: () => void chain()?.toggleBlockquote().run() },
        { key: 'codeBlock', label: '代码块', title: '代码块', icon: 'code-block', active: act('codeBlock'), run: () => void chain()?.toggleCodeBlock().run() },
        { key: 'hr', label: '分隔线', title: '分隔线', icon: 'minus', run: () => void chain()?.setHorizontalRule().run() }
      ]
    },
    {
      caption: '链接',
      tools: [
        { key: 'link', label: '链接', title: '链接', icon: 'link', active: act('link'), run: toggleLink },
        {
          key: 'unlink',
          label: '移除链接',
          title: '移除链接',
          icon: 'unlink',
          disabled: !act('link'),
          run: () => void chain()?.extendMarkRange('link').unsetLink().run()
        }
      ]
    },
    {
      caption: '插入资源',
      tools: [
        { key: 'image', label: '插入图片', title: '导入本地图片（自动存入工作区 assets 文件夹）', icon: 'image', run: () => importMedia('assets') },
        { key: 'attach', label: '附加文件', title: '附加文件（视频/音频/其他，以链接插入并存入 files 文件夹）', icon: 'attach', run: () => importMedia('files') },
        { key: 'cloud', label: '网络媒体', title: '插入网络媒体（图片/视频/音频 URL）', icon: 'cloud', run: insertWebMedia }
      ]
    }
  ]
})

/* ---------- 宽度不足时按组折叠，尾部「更多」按钮可展开全部 ---------- */
const bar = ref<HTMLElement>()
/** 当前可完整显示的组数（索引 >= 它的组收进折叠区） */
const visibleCount = ref(99)
/** 是否发生折叠（折叠时才显示「更多」） */
const overflowing = ref(false)
/** 展开态：所有按钮换行全部显示 */
const expanded = ref(false)
/** 测量态：临时把全部组摆出来量自然宽度 */
const measuringAll = ref(false)
/** 各组自然宽度缓存（含组前的分隔符），测一次即可，字体变化时作废 */
let widthsCache: number[] = []
/** 组间距（与 .fmt-bar 的 gap 一致） */
const BAR_GAP = 3
/**
 * 折叠时给「更多」按钮预留的宽度（含间距）。
 * 实际按钮约 56px + 间距 3px；之前预留 78 会在 320dp 宽的手机上
 * 凭空吃掉 20px，导致“明明还能放下 H1–H6，却只显示撤销/重做”。
 */
const TOGGLE_RESERVE = 64

/** 某组当前是否收起 */
const isCollapsed = (gi: number) => !expanded.value && !measuringAll.value && gi >= visibleCount.value

/** 收起来组里的按钮数（用于提示「还有 N 个」） */
const hiddenTools = computed(() =>
  expanded.value ? 0 : groups.value.slice(visibleCount.value).reduce((n, g) => n + g.tools.length, 0)
)

let ro: ResizeObserver | null = null
let running = false
let again = false
/** 上一次计算用的可用宽度；对不上说明尺寸还在变，需要再补一轮 */
let measuredWidth = 0
/** 窗口尺寸变化时的重排回调（命名一下，卸载时才能摘掉同一个引用） */
const onWindowResize = () => void relayout()

/**
 * 重排工具栏：
 * 1) 缓存各组自然宽度（需要一次「全部摆出来」的布局）；
 * 2) 按可用宽度（预留「更多」按钮）算出能放下的组数；
 * 3) 再用真实溢出量 scrollWidth 逐步收缩兜底 —— 字体、亚像素、按钮实际宽度
 *    任何一处估算偏乐观，都不会把按钮顶出可视区。
 */
async function relayout() {
  if (running) {
    again = true // 测量期间又收到尺寸变化，跑完这轮再补一次
    return
  }
  running = true
  try {
    let passes = 0
    do {
      again = false
      const host = bar.value
      const n = groups.value.length
      if (!host || !n || !host.clientWidth) continue
      if (expanded.value) {
        // 展开态是「换行全显」布局，不按宽度裁切；但 overflowing 必须保留 ——
        // 它同时是「展开/收起」按钮的显示条件，清掉就等于把唯一的收起入口删了
        visibleCount.value = n
        continue
      }
      if (widthsCache.length !== n) {
        measuringAll.value = true
        visibleCount.value = n
        overflowing.value = false
        await nextTick()
        widthsCache = Array.from(host.querySelectorAll<HTMLElement>('.fmt-group')).map(el => el.offsetWidth)
        measuringAll.value = false
        if (widthsCache.some(w => !w)) {
          widthsCache = [] // 还没布局好，下轮重测
          continue
        }
      }
      const total = widthsCache.reduce((a, b) => a + b, 0) + BAR_GAP * (n - 1)
      let count = n
      if (total + TOGGLE_RESERVE > host.clientWidth) {
        let budget = host.clientWidth - TOGGLE_RESERVE
        count = 0
        for (const w of widthsCache) {
          const need = w + (count ? BAR_GAP : 0)
          if (count > 0 && need > budget) break
          budget -= need
          count++
        }
        count = Math.max(1, Math.min(count, n - 1))
      }
      visibleCount.value = count
      overflowing.value = count < n
      for (let guard = 0; guard < n; guard++) {
        await nextTick()
        if (host.scrollWidth <= host.clientWidth + 1 || visibleCount.value <= 1) break
        overflowing.value = true
        visibleCount.value -= 1
      }
      // 拖拽窗口时可能在两次测量之间尺寸又变了，尺寸对不上就再补一轮（最多 6 轮）
      if (host.clientWidth !== measuredWidth) again = true
      measuredWidth = host.clientWidth
    } while (again && ++passes < 6)
  } finally {
    running = false
  }
}

onMounted(() => {
  window.addEventListener('resize', onWindowResize)
  if (bar.value && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => void relayout())
    ro.observe(bar.value)
  }
  void relayout()
  // 字体/图标加载完成后按钮宽度会变，作废缓存再量一次
  document.fonts?.ready
    ?.then(() => {
      widthsCache = []
      return relayout()
    })
    .catch(() => {})
})
onBeforeUnmount(() => {
  ro?.disconnect()
  window.removeEventListener('resize', onWindowResize)
})

/** 展开/收起会改变整行布局，DOM 更新后要重新测量 */
watch(expanded, () => void relayout())
</script>

<template>
  <div class="fmt-toolbar" :class="{ expanded }">
    <div class="fmt-bar" ref="bar">
      <div
        v-for="(g, gi) in groups"
        :key="g.caption"
        class="fmt-group"
        :class="{ 'fmt-hidden': isCollapsed(gi) }"
      >
        <span v-if="gi" class="fmt-sep"></span>
        <button
          v-for="t in g.tools"
          :key="t.key"
          :class="{ active: t.active, 'fmt-text-btn': !!t.text }"
          :title="t.title"
          :disabled="t.disabled"
          @click="t.run()"
        >
          <IconSvg v-if="t.icon" :name="t.icon" :size="15" />
          <span v-else>{{ t.text }}</span>
        </button>
      </div>
      <!-- 放不下的组收在这里，点一下换成两行全部显示；展开后同一按钮变成「收起」 -->
      <button
        v-if="overflowing || expanded"
        class="fmt-toggle"
        :title="expanded ? '收起工具栏' : `展开工具栏（还有 ${hiddenTools} 个按钮）`"
        @click="expanded = !expanded"
      >
        <span>{{ expanded ? '收起' : '更多' }}</span>
        <IconSvg name="chevron-down" :size="13" :class="{ up: expanded }" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.fmt-text-btn { font-weight: 600; }
.fmt-toggle {
  flex: 0 0 auto;
  gap: 2px;
  min-width: 56px;
  color: var(--fg-dim);
  font-size: 12px;
}
/* IconSvg 根元素自带 .appicon 类，这里用它定位到按钮内的图标 */
.fmt-toggle .appicon.up { transform: rotate(180deg); }
</style>
