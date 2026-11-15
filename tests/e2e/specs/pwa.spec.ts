import { expect, test } from '@playwright/test';

test('the game installs as an app and keeps its files for the next visit', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? '';
    return (await fetch(href)).json();
  });
  expect(manifest).toMatchObject({ name: 'VNG Campus Online', start_url: '/' });
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(
    expect.arrayContaining(['192x192', '512x512']),
  );

  // Once the worker is in charge, hashed files come from its cache — and nothing else does.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.locator('.splash[data-phase="ready"]').waitFor();
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const paths: string[] = [];
    for (const name of names)
      for (const request of await (await caches.open(name)).keys())
        paths.push(new URL(request.url).pathname);
    return paths;
  });
  expect(cached.some((path) => /^\/assets\/index-.+\.js$/.test(path))).toBe(true);
  expect(cached.filter((path) => path.startsWith('/api') || path.startsWith('/rt'))).toEqual([]);

  // Without a network the page still opens (and then says it cannot reach the server).
  await context.setOffline(true);
  await page.reload();
  await expect(page).toHaveTitle('VNG Campus Online');
  await expect(page.locator('.splash')).toBeVisible();
  await context.close();
});
