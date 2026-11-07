import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// base './' 保证产物可被 Wails / Capacitor / ArkWeb 以本地路径加载
// mode 决定编译目标（编译期固定，运行期不可切换）：
//   默认 build                  → PC 版，界面固定 PC
//   build --mode mobile         → 移动端版，界面可选 手机 / 平板
export default defineConfig(({ mode }) => ({
  plugins: [vue()],
  base: './',
  define: {
    __XMD_TARGET__: JSON.stringify(mode === 'mobile' ? 'mobile' : 'pc')
  },
  resolve: {
    // monaco 0.57 的 package exports 限制了深层路径，直接别名到 esm 目录
    alias: {
      'monaco-editor/esm/vs': fileURLToPath(new URL('./node_modules/monaco-editor/esm/vs', import.meta.url))
    }
  },
  // 渲染线程使用 ES Module Worker，可与主线程共享 Vite 的模块处理
  worker: {
    format: 'es'
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    // 体积优化：esbuild 压缩 + 关闭 sourcemap / 体积报告，减小打包产物与 Wails 内嵌资源
    minify: 'esbuild',
    cssMinify: 'esbuild',
    sourcemap: false,
    reportCompressedSize: false,
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        /**
         * 只把框架层（vue/pinia）单独成块，其余依赖完全交给 Rollup 自动分包。
         *
         * 刻意不给 monaco-editor / @codemirror / @tiptap 指定 chunk：
         * 一旦把它们强制归入同一个 chunk，这些库内部通过 dynamic import 懒加载的
         * 语言定义（VSCode 40+ 种、CodeMirror 各语言包）会被全部合并进来，
         * 导致「打开 VSCode 编辑器」一次性下载约 2.9MB、打开源码编辑器约 616KB。
         * 自动分包后每种语言各自成为独立小分片，只在切换到对应文件类型时才加载。
         */
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/vue/') || id.includes('@vue') || id.includes('pinia')) return 'vue'
          return undefined
        }
      }
    }
  },
  server: {
    port: 5173
  }
}))
