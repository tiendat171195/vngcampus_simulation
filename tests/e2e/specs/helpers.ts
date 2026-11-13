import type { Browser, BrowserContextOptions, Page } from '@playwright/test';

export interface Remote {
  name: string;
  status: number;
  anim: number;
  emote: number;
  emoteSeq: number;
  seated: boolean;
  x: number;
  y: number;
  z: number;
}

let counter = 0;

/** Opens the game as a named guest, skipping the splash button, and waits until it is in a channel. */
export async function enterAs(
  browser: Browser,
  name: string,
  options: BrowserContextOptions = {},
  id?: string,
  /** Extra query parameters, starting with `&`. */
  query = '',
) {
  const context = await browser.newContext(options);
  const guestId = id ?? `e2e-${Date.now().toString(36)}-${(counter++).toString(36)}`;
  await context.addInitScript(
    ([guestId, name]) =>
      window.localStorage.setItem('campus.guest.v1', JSON.stringify({ id: guestId, name })),
    [guestId, name] as const,
  );
  const page = await context.newPage();
  await page.goto(`/?enter&debug${query}`);
  await page.getByTestId('channel-badge').waitFor();
  return { context, page, guestId };
}

export const remotes = (page: Page) =>
  page.evaluate(() => (window as unknown as { campus: { remotes(): Remote[] } }).campus.remotes());

export const ownPosition = async (page: Page) => {
  const info = page.getByTestId('player-info');
  return {
    x: Number(await info.getAttribute('data-x')),
    z: Number(await info.getAttribute('data-z')),
  };
};
