import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

const target = process.env.VITE_WEB_CHANNEL_TARGET ?? 'http://127.0.0.1:8787'
const devLogin = process.env.REMOTE_AGENT_WEB_DEV_LOGIN
const devToken = process.env.REMOTE_AGENT_WEB_DEV_TOKEN

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src/ui', import.meta.url)) },
  },
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', request => {
            if (devLogin !== undefined && devLogin !== '') {
              request.setHeader('Tailscale-User-Login', devLogin)
            }
            if (devToken !== undefined && devToken !== '') {
              request.setHeader('Authorization', `Bearer ${devToken}`)
            }
          })
        },
      },
      '/ws': {
        target,
        ws: true,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReqWs', request => {
            if (devLogin !== undefined && devLogin !== '') {
              request.setHeader('Tailscale-User-Login', devLogin)
            }
            if (devToken !== undefined && devToken !== '') {
              request.setHeader('Authorization', `Bearer ${devToken}`)
            }
          })
        },
      },
    },
  },
  build: {
    outDir: 'dist/web-channel',
    emptyOutDir: true,
  },
})
