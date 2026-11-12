import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript source, so they are compiled into the bundle. Everything
  // from npm stays external and must be listed in this app's own dependencies.
  deps: { alwaysBundle: [/^@campus\//] },
});
