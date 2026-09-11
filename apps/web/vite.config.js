import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 4042,
    // In development the dashboard runs on Vite's port and the API on the
    // server's. Proxying keeps the app's fetch calls origin-relative, so the
    // same code works when the built files are served from :4041.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4041',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
