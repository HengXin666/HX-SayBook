import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      // 所有 API 请求统一走 /api 前缀，转发到后端时去掉 /api
      '/api': {
        target: 'http://127.0.0.1:8200',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/ws': {
        target: 'ws://127.0.0.1:8200',
        ws: true,
      },
    },
  },
})
