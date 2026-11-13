import { defineConfig } from 'tsdown';

export default defineConfig({
  // `migrate` is the production deploy step that applies migrations (docs/09 §4).
  entry: ['src/index.ts', 'src/migrate.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript source, so they are compiled into the bundle. Everything
  // from npm stays external and must be listed in this app's own dependencies.
  deps: { alwaysBundle: [/^@campus\//] },
  // The bundle cannot find @campus/db's SQL files on its own; ship them next to it.
  copy: [{ from: '../../packages/db/drizzle', to: 'dist' }],
});
