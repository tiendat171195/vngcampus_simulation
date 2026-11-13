import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// The browser only ever talks to one origin: `/api` is the REST API and `/rt` is the realtime
// server (docs/07-backend-data.md §1). In development Vite plays the reverse proxy.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', '');
  const apiTarget = `http://localhost:${env.API_PORT ?? 3001}`;
  const realtimeTarget = `http://localhost:${env.REALTIME_PORT ?? 2567}`;

  return {
    plugins: [react()],
    envDir: '../..',
    // Sizes are enforced by scripts/check-budget.mjs against the documented budget instead.
    build: { chunkSizeWarningLimit: 1600 },
    server: {
      port: 5173,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/rt': {
          target: realtimeTarget,
          changeOrigin: true,
          ws: true,
          rewrite: (path) => path.replace(/^\/rt/, ''),
        },
      },
    },
  };
});
