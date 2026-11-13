import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', '');

  return {
    plugins: [react()],
    // Served at /admin/ on the game's host, so it shares the session cookie (docs/08 §8).
    base: '/admin/',
    envDir: '../..',
    server: {
      port: 5174,
      proxy: {
        '/api': { target: `http://localhost:${env.API_PORT ?? 3001}`, changeOrigin: true },
        // Live head counts for the dashboard (`/rt/channels`), as in the game.
        '/rt': {
          target: `http://localhost:${env.REALTIME_PORT ?? 2567}`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/rt/, ''),
        },
      },
    },
  };
});
