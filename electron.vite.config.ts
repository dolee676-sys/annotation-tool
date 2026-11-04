import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const CSP =
  "default-src 'self' file:; script-src 'self' file:; style-src 'self' 'unsafe-inline' file:; img-src 'self' data: file:; font-src 'self' data: file:; connect-src 'self' ws: http: https:"

// Only inject CSP for the packaged renderer. In dev, Vite needs an inline
// refresh preamble that would otherwise be blocked.
const injectCsp = (): Plugin => ({
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml(html) {
    return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
  }
})

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react(), injectCsp()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    }
  }
})
