import { devices, expect, test } from '@playwright/test';
import { enterAs, ownPosition, remotes } from './helpers';

test('a desktop and a phone player see each other and each other moving', async ({ browser }) => {
  const desktop = await enterAs(browser, 'An', { viewport: { width: 1100, height: 640 } });
  const phone = await enterAs(browser, 'Bình', { ...devices['Pixel 7'] });

  await expect(desktop.page.getByTestId('channel-badge')).toContainText('2 người');
  await expect(phone.page.getByTestId('channel-badge')).toContainText('2 người');
  await expect.poll(async () => (await remotes(phone.page)).map((r) => r.name)).toEqual(['An']);

  const start = (await remotes(phone.page))[0];
  const own = await ownPosition(desktop.page);
  expect(start?.z).toBeCloseTo(own.z, 0);

  // An walks towards the building for two seconds.
  await desktop.page.keyboard.down('KeyW');
  await desktop.page.waitForTimeout(2000);
  await desktop.page.keyboard.up('KeyW');

  await expect
    .poll(async () => (await remotes(phone.page))[0]?.z ?? 0)
    .toBeGreaterThan((start?.z ?? 0) + 1.5);
  await expect
    .poll(async () => {
      const seen = (await remotes(phone.page))[0];
      const actual = await ownPosition(desktop.page);
      return Math.abs((seen?.z ?? 0) - actual.z);
    })
    .toBeLessThan(0.2);

  await desktop.context.close();
  await phone.context.close();
});

test('the same person opening a second tab closes the first one', async ({ browser }) => {
  const first = await enterAs(browser, 'Hai Tab');
  const second = await first.context.newPage();
  await second.goto('/?enter&debug');
  await second.getByTestId('channel-badge').waitFor();

  const banner = first.page.locator('.connection-banner[data-status="replaced"]');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('tab hoặc thiết bị khác');
  await first.context.close();
});

test('a player who loses the network for five seconds comes back on their own', async ({
  browser,
}) => {
  const watcher = await enterAs(browser, 'Người Xem');
  const traveller = await enterAs(browser, 'Mất Mạng');
  await expect(watcher.page.getByTestId('channel-badge')).toContainText('2 người');
  await traveller.page.waitForTimeout(1500);

  await traveller.context.setOffline(true);
  await expect(
    traveller.page.locator('.connection-banner[data-status="reconnecting"]'),
  ).toBeVisible();
  // While they are away, the others see them as disconnected but still there.
  await expect.poll(async () => (await remotes(watcher.page))[0]?.status).toBe(2);
  await traveller.page.waitForTimeout(5000);
  await traveller.context.setOffline(false);

  await expect(traveller.page.getByTestId('channel-badge')).toBeVisible();
  await expect(traveller.page.locator('.connection-banner')).toHaveCount(0);
  await expect.poll(async () => (await remotes(watcher.page))[0]?.status).toBe(0);
  await watcher.context.close();
  await traveller.context.close();
});

test('leaving the page frees the seat at once', async ({ browser }) => {
  const stayer = await enterAs(browser, 'Ở Lại');
  const leaver = await enterAs(browser, 'Ra Về');
  await expect(stayer.page.getByTestId('channel-badge')).toContainText('2 người');
  await leaver.page.close({ runBeforeUnload: true });
  await expect(stayer.page.getByTestId('channel-badge')).toContainText('1 người');
  await stayer.context.close();
  await leaver.context.close();
});
