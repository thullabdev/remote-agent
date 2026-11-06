import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

/**
 * Copies public/ into the build output by reading and writing each file. Vite's own copy (Node's copyFileSync)
 * fails with EINVAL on some encrypted home directories (ecryptfs), so the copy avoids that call.
 */
function copyPublicDir(): Plugin {
  return {
    name: 'copy-public-dir',
    apply: 'build',
    closeBundle() {
      const from = fileURLToPath(new URL('./public', import.meta.url))
      const to = fileURLToPath(new URL('./dist/web-channel', import.meta.url))
      const copyTree = (source: string, target: string): void => {
        mkdirSync(target, { recursive: true })
        for (const entry of readdirSync(source, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            copyTree(join(source, entry.name), join(target, entry.name))
          } else {
            writeFileSync(join(target, entry.name), readFileSync(join(source, entry.name)))
          }
        }
      }
      copyTree(from, to)
    },
  }
}

const target = process.env.VITE_WEB_CHANNEL_TARGET ?? 'http://127.0.0.1:8787'
const devLogin = process.env.REMOTE_AGENT_WEB_DEV_LOGIN
const devToken = process.env.REMOTE_AGENT_WEB_DEV_TOKEN

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src/ui', import.meta.url)) },
  },
  plugins: [react(), tailwindcss(), copyPublicDir()],
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
    copyPublicDir: false,
  },
})
