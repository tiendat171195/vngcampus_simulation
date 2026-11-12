import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', '');

  return {
    plugins: [react()],
    envDir: '../..',
    server: {
      port: 5174,
      proxy: {
        '/api': { target: `http://localhost:${env.API_PORT ?? 3001}`, changeOrigin: true },
      },
    },
  };
});
