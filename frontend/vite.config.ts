import { defineConfig } from 'vite';

// Dev: Vite on :5173 proxies /api to FastAPI on :8000.
// Prod: `npm run build` -> dist/, which FastAPI serves directly (single origin).
export default defineConfig({
  base: './',
  server: {
    host: true, // reachable from other devices in the LAN (phone testing)
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: true,
  },
});
