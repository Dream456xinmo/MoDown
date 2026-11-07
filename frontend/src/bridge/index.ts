import type { PlatformBridge } from './types'
import { createAndroidBridge } from './android'
import { createHarmonyBridge } from './harmony'
import { mockBridge } from './mock'
import { wailsBridge } from './wails'

/**
 * Capacitor Android 桥：系统目录工作区（SAF）与导出另存走原生插件 XmdFs，
 * 本地工作区与其余能力沿用 mock；插件缺失（旧包）时自动整体回退到 mock。
 */
const capacitorBridge: PlatformBridge = createAndroidBridge()

/**
 * 鸿蒙 ArkWeb 桥（壳工程 mobile/HarmonyOS）：本地工作区是应用沙箱里的真实目录，
 * 文件树/读写/导入/另存/打印 PDF/外链都走 window.nativeHarmony；
 * 系统目录工作区鸿蒙给不了（NEXT 只按文件授权），由原生返回一句中文说明。
 * 原生对象缺失或接口太旧时整体回退 mock，界面照常可用。
 */
const harmonyBridge: PlatformBridge = createHarmonyBridge()

function detect(): PlatformBridge {
  if (window.go?.main?.App) return wailsBridge
  if (window.Capacitor?.isNativePlatform?.()) return capacitorBridge
  if (window.nativeHarmony) return harmonyBridge
  return mockBridge
}

export const bridge: PlatformBridge = detect()
export type { PlatformBridge, TreeNode } from './types'
