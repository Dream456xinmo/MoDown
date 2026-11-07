import type { CapacitorConfig } from '@capacitor/cli'

/**
 * MoDown Android 壳配置。
 * webDir 指向 mobile/www：由 `npm run build:web` 从 ../frontend 以 mobile 模式构建产出，
 * 不覆盖 PC 的 frontend/dist（两份产物互不影响）。
 */
const config: CapacitorConfig = {
  appId: 'com.modown.app',
  appName: 'MoDown',
  webDir: 'www',
  backgroundColor: '#ffffff',
  android: {
    allowBackup: true,
    appendedArguments: [],
    gradleVersion: undefined
  },
  server: {
    // Capacitor 用 https scheme 加载本地资源，避免 WebView 的 mixed-content 限制
    androidScheme: 'https'
  }
}

export default config
