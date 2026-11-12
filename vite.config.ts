import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __CRUNCHCALL_VERSION__: JSON.stringify(pkg.version),
  },
  // Bind IPv4 so Electron's default http://127.0.0.1:5173 URL can load.
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
})
