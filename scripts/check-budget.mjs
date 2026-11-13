// Checks the size of the built web app against the download budget of docs/03-world-and-assets.md §6.
// Run after `pnpm build`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const dist = fileURLToPath(new URL('../apps/web/dist/', import.meta.url));
const assets = join(dist, 'assets');

/** gzip level 9 approximates what a CDN serves; brotli would be smaller still. */
const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

const BUDGET = {
  /** What paints the splash screen: the entry chunk named in index.html. */
  entry: 120 * 1024,
  /** All JavaScript needed before the player can walk (docs: JS ≤ 600 KB). */
  game: 600 * 1024,
};
/** Developer-only pages, loaded on demand, are not part of the budget. */
const isDevOnly = (name) => /^MapDebugPage/.test(name);

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const entryName = /<script[^>]+src="\/assets\/([^"]+\.js)"/.exec(html)?.[1];
if (!entryName) throw new Error('No entry script found in dist/index.html');

const files = readdirSync(assets).filter((name) => name.endsWith('.js'));
const sizes = files
  .map((name) => ({ name, gzip: gz(join(assets, name)) }))
  .sort((a, b) => b.gzip - a.gzip);
const entry = sizes.find((file) => file.name === entryName)?.gzip ?? 0;
const game = sizes
  .filter((file) => !isDevOnly(file.name))
  .reduce((sum, file) => sum + file.gzip, 0);

for (const file of sizes) {
  console.log(
    `${kb(file.gzip).padStart(8)}  ${file.name}${isDevOnly(file.name) ? '  (dev only)' : ''}`,
  );
}

const checks = [
  ['entry chunk (splash)', entry, BUDGET.entry],
  ['JavaScript before walking', game, BUDGET.game],
];
let failed = false;
for (const [label, size, limit] of checks) {
  const ok = size <= limit;
  failed ||= !ok;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}: ${kb(size)} gzip (budget ${kb(limit)})`);
}
process.exit(failed ? 1 : 0);
