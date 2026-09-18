import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    // 与 Nginx 的 /pdl-tiku/ 发布路径保持一致，资源、PWA 清单及路由均从此路径解析。
    base: mode === 'production' ? '/pdl-tiku/' : '/',
    plugins: [react()],
    build: { sourcemap: false },
    preview: {
      host: '127.0.0.1',
      proxy: { '/pdl-tiku/api': { target: env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3001', changeOrigin: true, rewrite: (path) => path.replace(/^\/pdl-tiku/, '') } },
    },
    server: {
      host: true,
      proxy: { '/api': { target: env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3001', changeOrigin: true } },
    },
  }
})
