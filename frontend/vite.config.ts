import { defineConfig } from 'vite';

// Fully static build for GitHub Pages (https://<user>.github.io/<repo>/).
// base './' keeps all JS/CSS/asset URLs relative, so the site works under any sub-path.
// Telemetry goes directly to Supabase (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).
export default defineConfig({
  base: './',
  server: {
    host: true, // reachable from other devices in the LAN (phone testing)
    port: 5173,
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: true,
  },
});
