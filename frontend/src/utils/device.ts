/**
 * 界面模式（编译期固定，运行期不可切换）
 *
 * 编译目标由 Vite 的 `--mode` 决定，编译进产物后无法更改：
 * - 默认（`npm run build`）→ PC 版：界面永久固定为 PC，不提供任何模式切换入口
 * - `npm run build:mobile` → 移动端版：界面模式可选「手机 / 平板」
 *   （平板＝空间足够时用 PC 外壳，空间不足自动退回手机外壳）
 *
 * 也就是说：编译出来是 PC 版就永远是 PC 版，窗口拖窄也不会变成手机界面。
 */
export type DeviceMode = 'auto' | 'pc' | 'mobile' | 'tablet'
export type DeviceLayout = 'pc' | 'mobile'
export type AppTarget = 'pc' | 'mobile'

/** 判定为窄屏（平板退回手机外壳）的阈值 */
export const NARROW_WIDTH = 900
export const NARROW_HEIGHT = 500

/** 编译期注入的目标平台（见 vite.config.ts 的 define） */
export const APP_TARGET: AppTarget = __XMD_TARGET__ === 'mobile' ? 'mobile' : 'pc'
/** 是否移动端编译版本（只有它能选手机/平板） */
export const IS_MOBILE_BUILD = APP_TARGET === 'mobile'
/** 本编译版本是否允许用户切换界面模式 */
export const CAN_SWITCH_DEVICE = IS_MOBILE_BUILD

/** 本编译版本允许出现的界面模式 */
export const AVAILABLE_DEVICE_MODES: DeviceMode[] = IS_MOBILE_BUILD ? ['mobile', 'tablet'] : ['pc']
/** 本编译版本的默认界面模式 */
export const DEFAULT_DEVICE_MODE: DeviceMode = IS_MOBILE_BUILD ? 'mobile' : 'pc'

export function isDeviceMode(v: unknown): v is DeviceMode {
  return v === 'auto' || v === 'pc' || v === 'mobile' || v === 'tablet'
}

/**
 * 把任意值（含旧版本存储里的 auto/pc）收敛到本编译版本允许的模式：
 * PC 版一律 pc；移动端版只认 tablet，其余（含 auto/pc）都当 mobile。
 */
export function normalizeDeviceMode(v: unknown): DeviceMode {
  if (!IS_MOBILE_BUILD) return 'pc'
  return v === 'tablet' ? 'tablet' : 'mobile'
}

/** 由设备模式 + 窗口尺寸得出真正生效的外壳 */
export function effectiveLayout(mode: DeviceMode, w: number, h: number): DeviceLayout {
  // PC 版：永远是 PC 外壳，与窗口尺寸无关
  if (!IS_MOBILE_BUILD) return 'pc'
  if (mode === 'mobile') return 'mobile'
  // 平板：只要有空间就用 PC 外壳
  return w < NARROW_WIDTH || h < NARROW_HEIGHT ? 'mobile' : 'pc'
}

/** 判定外壳用的视口尺寸 */
export interface LayoutSize {
  w: number
  h: number
}

/**
 * 外壳判定专用的「稳定视口尺寸」——**软键盘挤压视口不算换尺寸**。
 *
 * 为什么不能直接用 `window.innerWidth/innerHeight`：
 * 安卓软键盘弹出时（manifest 的 `adjustResize`、以及 viewport 的 `interactive-widget=resizes-content`），
 * 布局视口会被压矮。而 `effectiveLayout` 的判据里带高度（`h < NARROW_HEIGHT` 就退回手机外壳），
 * 于是平板横屏 1280×800 一弹键盘高度掉到 500 以下 → `isMobile` 翻真 → App.vue 里 `v-if / v-else`
 * 的两套外壳互换，**整块平板外壳连同编辑器 DOM 一起被卸载** → 焦点随之消失 → Chromium 立刻把
 * 刚弹出的键盘收回去 → 松手后视口复原又切回平板外壳，再点一次又是同样的循环。
 * 表现就是「平板模式下点编辑区键盘不出来 / 一闪就没」，而手机模式（`mode === 'mobile'`）尺寸怎么变
 * 都不换外壳，所以只有平板模式中招。
 *
 * 键盘只压高度、不动宽度，而且压下来那一刻落点上的可编辑面已经拿到焦点，所以：
 * - 宽度变了 → 真的换尺寸（旋转 / 分屏 / 桌面拖窗口），跟随；
 * - 高度变小但宽度没变、且正在编辑 → 是键盘，忽略；
 * - 其余（变大、不在编辑）→ 跟随。
 */
export function stableLayoutSize(prev: LayoutSize, w: number, h: number, editing: boolean): LayoutSize {
  if (w !== prev.w) return { w, h }
  if (h > prev.h) return { w, h }
  if (h < prev.h && !editing) return { w, h }
  return prev
}

export function deviceLabel(mode: DeviceMode): string {
  if (mode === 'pc') return 'PC版'
  if (mode === 'tablet') return '平板版'
  return '手机版'
}

export function deviceIcon(mode: DeviceMode): string {
  if (mode === 'pc') return 'monitor'
  if (mode === 'tablet') return 'tablet'
  return 'smartphone'
}

/** PC 外壳下才启用的桌面快捷键 */
export function isDesktopShortcut(e: KeyboardEvent): boolean {
  return e.ctrlKey || e.metaKey
}

/**
 * 是否跑在原生 App 容器里（Capacitor / 鸿蒙 ArkWeb）。
 * 这类 WebView 没有系统「另存为 / 打开文件夹」对话框，`<a download>` 也常常无效，
 * 保存/导出要改成在应用工作区内选位置。
 */
export function isNativeShell(): boolean {
  const w = window as any
  return !!(w.Capacitor?.isNativePlatform?.() || w.nativeHarmony)
}

/**
 * 是否跑在 Android 原生壳（Capacitor + 系统 WebView）。
 *
 * 与 `isNativeShell()` 的区别：鸿蒙 ArkWeb 不算。安卓 WebView 有已知硬伤，需要单独降级处理：
 * - Monaco（VSCode 模式）聚焦后调不出软键盘 → `Editor.vue` 在安卓上回退 CodeMirror；
 * - 收起键盘后焦点仍在编辑区、再点不重新弹 → `composables/softKeyboard.ts` 走原生 `showKeyboard` 兜底。
 */
export function isAndroidShell(): boolean {
  const w = window as any
  if (!w.Capacitor?.isNativePlatform?.()) return false
  return /Android/i.test(navigator.userAgent)
}
