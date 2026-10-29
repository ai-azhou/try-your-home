/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import path from 'node:path'
import { bundleInventory } from './scripts/bundle-inventory.ts'

// 产物是 dist/index.html 一个文件：双击即可离线打开，不发任何网络请求。
export default defineConfig({
  base: './',
  plugins: [bundleInventory(), react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      // jsPDF 的可选依赖，见 src/lib/empty-module.ts
      html2canvas: path.resolve(import.meta.dirname, 'src/lib/empty-module.ts'),
      dompurify: path.resolve(import.meta.dirname, 'src/lib/empty-module.ts'),
      canvg: path.resolve(import.meta.dirname, 'src/lib/empty-module.ts'),
    },
  },
  build: { assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 4000 },
  // 无头 Chrome 的配置目录在 .shots/ 里，不忽略会无限热重载
  server: { watch: { ignored: ['**/.shots/**', '**/docs/**'] } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
