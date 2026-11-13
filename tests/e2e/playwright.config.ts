import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the production builds (run `pnpm build` first): the API, the realtime
 * server and the web app served by `vite preview`, which proxies /api and /rt like in development.
 */
const PORTS = { web: 4173, api: 3911, realtime: 3912 };

export default defineConfig({
  testDir: './specs',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  // Tests share one realtime server and its channels.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORTS.web}`,
    trace: 'off',
    // Headless machines have no GPU; WebGL runs in software.
    launchOptions: {
      args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node ../../apps/api/dist/index.mjs',
      env: {
        NODE_ENV: 'test',
        API_PORT: String(PORTS.api),
        LOG_LEVEL: 'warn',
        // A database of its own; the API applies migrations when it starts outside production.
        DATABASE_URL:
          process.env.E2E_DATABASE_URL ?? 'postgres://campus:campus@127.0.0.1:5432/campus_e2e',
        // Every test signs up new guests from the same address.
        RATE_LIMIT_SCALE: '10',
      },
      url: `http://127.0.0.1:${PORTS.api}/api/health`,
      reuseExistingServer: false,
    },
    {
      command: 'node ../../apps/realtime/dist/index.mjs',
      env: {
        NODE_ENV: 'test',
        REALTIME_PORT: String(PORTS.realtime),
        // Players join with the API's access tokens, like in production.
        DEV_GUEST_AUTH: 'off',
        AUTH_JWKS_URL: `http://127.0.0.1:${PORTS.api}/api/v1/auth/jwks`,
        // Small channels, so a test can fill one and see a second open.
        CHANNEL_SOFT_CAP: '3',
      },
      url: `http://127.0.0.1:${PORTS.realtime}/health`,
      reuseExistingServer: false,
    },
    {
      command: `pnpm --filter @campus/web exec vite preview --port ${PORTS.web} --strictPort`,
      env: { API_PORT: String(PORTS.api), REALTIME_PORT: String(PORTS.realtime) },
      url: `http://localhost:${PORTS.web}`,
      reuseExistingServer: false,
    },
  ],
});
