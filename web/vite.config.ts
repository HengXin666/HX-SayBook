import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/projects': {
        target: 'http://127.0.0.1:8200',
        changeOrigin: true,
      },
      '/chapters': {
        target: 'http://127.0.0.1:8200',
        changeOrigin: true,
      },
      '/roles': {
        target: 'http://127.0.0.1:8200',
        changeOrigin: true,
      },
      '/voices': {
        target: 'http://127.0.0.1:8200',
        changeOrigin: true,
      },
      '/lines': {
        target: 'http://127.0.0.1:8200',
        changeOrigin: true,
      },
      '/llm_providers': {
        target: 'http://127.0.0.1:8200',
        changeOrigin: true,
      },
      '/tts_providers': {
        target: 'http://127.0.0.1:8200',
        changeOrigin: true,
      },
      '/emotions': {
        target: 'http://127.0.0.1:8200',
        changeOrigin: true,
      },
      '/strengths': {
        target: 'http://127.0.0.1:8200',
        changeOrigin: true,
      },
      '/multi_emotion_voices': {
        target: 'http://127.0.0.1:8200',
        changeOrigin: true,
      },
      '/prompts': {
        target: 'http://127.0.0.1:8200',
        changeOrigin: true,
      },
      '/batch': {
        target: 'http://127.0.0.1:8200',
        changeOrigin: true,
      },
      '/static': {
        target: 'http://127.0.0.1:8200',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8200',
        ws: true,
      },
    },
  },
})
