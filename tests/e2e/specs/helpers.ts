import type { Browser, BrowserContextOptions, Page } from '@playwright/test';

export interface Remote {
  name: string;
  tag: string;
  avatar: string;
  status: number;
  anim: number;
  emote: number;
  emoteSeq: number;
  seated: boolean;
  x: number;
  y: number;
  z: number;
}

/**
 * Opens the game in a fresh browser (so a new guest account), agrees to the privacy notice,
 * steps in and waits until it is in a channel.
 */
export async function enterAs(
  browser: Browser,
  name: string,
  options: BrowserContextOptions = {},
  /** Extra query parameters, starting with `&`. */
  query = '',
  /** Go through the first-visit steps (avatar choice, tutorial) instead of skipping them. */
  firstVisit = false,
) {
  const context = await browser.newContext(options);
  await context.addInitScript(
    ([name, skip]) => {
      window.localStorage.setItem('campus.name.v1', name);
      if (skip) {
        window.localStorage.setItem('campus.firstrun.v1', 'done');
        window.localStorage.setItem('campus.tutorial.v1', 'done');
      }
    },
    [name, !firstVisit] as const,
  );
  const page = await context.newPage();
  await page.goto(`/?debug${query}`);
  await enterFromSplash(page);
  return { context, page };
}

/** On the splash screen: agrees to the privacy notice if asked, then steps in. */
export async function enterFromSplash(page: Page) {
  await page.locator('.splash[data-phase="ready"]').waitFor();
  await page.locator('.splash-card:not([data-account="checking"])').waitFor();
  const consent = page.locator('.splash-consent-box');
  if (await consent.isVisible()) await consent.check();
  await page.getByRole('button', { name: 'Vào campus' }).click();
  await page.getByTestId('channel-badge').waitFor();
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
