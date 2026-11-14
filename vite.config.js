import { defineConfig } from 'vite'

// Dev: the Python server (npm run serve) answers /api on :5191; Vite serves the app on :5190.
export default defineConfig({
  server: { proxy: { '/api': 'http://127.0.0.1:5191' } },
  build: { outDir: 'dist', chunkSizeWarningLimit: 1500 },
})
