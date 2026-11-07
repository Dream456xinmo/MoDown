/// <reference types="vite/client" />

/**
 * 编译期注入的目标平台（见 vite.config.ts）：
 * `npm run build` → 'pc'；`npm run build:mobile` → 'mobile'
 */
declare const __XMD_TARGET__: 'pc' | 'mobile'

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface Window {
  // Wails v2/v3 注入的 Go 绑定入口
  go?: any
  // Wails 运行时（事件订阅 EventsOn、拖拽 OnFileDrop、窗口控制等）
  runtime?: any
  // Capacitor 注入
  Capacitor?: any
  // 鸿蒙 ArkWeb 桥接（hionic / 自研插件将在此挂载）
  nativeHarmony?: any
}
