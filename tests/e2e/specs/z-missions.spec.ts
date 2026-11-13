import { expect, type Page, test } from '@playwright/test';
import { enterAs, enterFromSplash } from './helpers';
import { archiveE2eMission, E2E_TITLE, publishE2eMission } from './mission-data';

// Runs last (file name): the mission it publishes would otherwise greet the other tests.
let missionId = '';
test.beforeAll(async () => {
  missionId = await publishE2eMission();
});
test.afterAll(async () => {
  if (missionId) await archiveE2eMission(missionId);
});

interface Entity {
  id: string;
  kind: string;
}

/** The banner greets every arrival; the realtime server picks a new mission up within 15 s. */
async function startMission(page: Page) {
  const banner = page.getByTestId('mission-banner');
  await expect(banner).toContainText(E2E_TITLE, { timeout: 30_000 });
  await banner.getByRole('button', { name: 'Bắt đầu' }).click();
}

const count = (page: Page, objective: string) => page.getByTestId(`objective-${objective}`);
const entities = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { campus: { entities(): Entity[] } }).campus.entities(),
  );

/** Leaves and comes back somewhere else: progress must still be there. */
async function comeBackAt(page: Page, spot: string) {
  await page.goto(`/?debug&spawn=${spot}`);
  await enterFromSplash(page);
  await startMission(page);
}

async function playThrough(page: Page) {
  // Two items of their own, picked up one visit at a time.
  const items = (await entities(page)).filter((entity) => entity.kind === 'item');
  expect(items).toHaveLength(2);
  for (const [i, item] of items.entries()) {
    await comeBackAt(page, item.id.split(':')[1] ?? '');
    await expect(count(page, 'o2')).toHaveText('✓');
    await expect(page.locator('.action-prompt')).toContainText('Nhặt ly cà phê');
    await page.keyboard.press('KeyE');
    await expect(count(page, 'o3')).toHaveText(i === 0 ? '1/2' : '✓');
  }
  // The question at the lobby kiosk.
  await comeBackAt(page, 'poi.kiosk.lobby');
  await expect(page.locator('.action-prompt')).toContainText('Trả lời câu hỏi');
  await page.keyboard.press('KeyE');
  const quiz = page.getByTestId('quiz');
  await quiz.getByRole('button', { name: 'Đúng' }).click();
  const done = page.getByTestId('mission-complete');
  await expect(done).toContainText('+40 điểm · +20 KN');
  await done.getByRole('button', { name: 'Tuyệt!' }).click();
}

test('two colleagues play a mission from start to end, leaving and coming back on the way', async ({
  browser,
}) => {
  test.slow();
  const an = await enterAs(browser, 'Nhiệm Vụ An');
  const binh = await enterAs(browser, 'Nhiệm Vụ Bình');
  for (const player of [an, binh]) {
    await startMission(player.page);
    // Everyone appears at the gate: the check-in counts at once.
    await expect(count(player.page, 'o1')).toHaveText('✓');
  }
  // A wave towards each other.
  await an.page.keyboard.press('Digit1');
  await expect(count(an.page, 'o2')).toHaveText('✓');
  await binh.page.waitForTimeout(2500);
  await binh.page.keyboard.press('Digit1');
  await expect(count(binh.page, 'o2')).toHaveText('✓');

  await playThrough(an.page);
  await playThrough(binh.page);

  // Back once more: the mission shows as done, with nothing left to pick up.
  await an.page.reload();
  await enterFromSplash(an.page);
  await expect(an.page.getByTestId('mission-tracker')).toContainText('✓ Đã xong nhiệm vụ', {
    timeout: 20_000,
  });
  expect(await entities(an.page)).toEqual([]);
  await an.context.close();
  await binh.context.close();
});
