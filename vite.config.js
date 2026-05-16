import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), vueDevTools()],
  resolve: {
    alias: {
      // 路径别名：让源码内使用 @/xxx 代替 ../../ 这类相对路径
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 开发期把以 /api 开头的请求转发到后端，避免跨域 + 避免硬编码后端地址
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true, // 修改请求头 Host 为目标地址，匹配后端校验
      },
    },
  },
})
