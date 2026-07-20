import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // 127.0.0.1, not localhost: Node resolves localhost to ::1 first while uvicorn
  // binds IPv4 by default, which surfaces as ECONNREFUSED through the proxy.
  const target = env.VITE_API_TARGET ?? 'http://127.0.0.1:8000'

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, 'src') },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target, changeOrigin: false },
        '/ws': { target: target.replace(/^http/, 'ws'), ws: true, changeOrigin: false },
      },
    },
    build: {
      // main.py mounts Path("static") relative to cwd, and `just dev` cds to backend/
      outDir: path.resolve(import.meta.dirname, '../backend/static'),
      emptyOutDir: true,
      sourcemap: true,
    },
  }
})
