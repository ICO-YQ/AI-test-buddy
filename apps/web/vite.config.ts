import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite 配置。
 * 开发期通过 server.proxy 把 /api 与 /v1 代理到后端（默认 :3001），
 * 前端自身默认监听 5173（占用时自动 +1）。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 使用 URL API，避免依赖 @types/node
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: false,
    proxy: {
      // 注意：必须带尾斜杠。否则 SPA 路由 `/api-keys` 会被 `/api` 前缀误捕获并代理到后端。
      '/api/': { target: 'http://localhost:3001', changeOrigin: true },
      '/v1/': { target: 'http://localhost:3001', changeOrigin: true },
      // 后端健康检查（便于用浏览器/联调脚本快速确认后端在线）
      '/health': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
});
