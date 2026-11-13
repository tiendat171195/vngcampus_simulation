import { expect, test } from '@playwright/test';
import { enterAs, remotes } from './helpers';

const ANIM_SIT = 5;
const ANIM_EMOTE = 6;
const WAVE = 1;

test('others see a wave and see someone sit down on a seat', async ({ browser }) => {
  const actor = await enterAs(browser, 'Diễn', {}, '&spawn=poi.seat.koi_01');
  const audience = await enterAs(browser, 'Xem', {}, '&spawn=poi.checkpoint.koi');
  await expect
    .poll(async () => (await remotes(audience.page)).map((r) => r.name))
    .toEqual(['Diễn']);

  await actor.page.keyboard.press('Digit1');
  await expect.poll(async () => (await remotes(audience.page))[0]?.emote).toBe(WAVE);
  await expect.poll(async () => (await remotes(audience.page))[0]?.anim).toBe(ANIM_EMOTE);

  // Standing on the seat: the prompt offers it, E takes it.
  await expect(actor.page.locator('.action-prompt')).toContainText('Ngồi xuống');
  await actor.page.keyboard.press('KeyE');
  await expect.poll(async () => (await remotes(audience.page))[0]?.seated).toBe(true);
  await expect.poll(async () => (await remotes(audience.page))[0]?.anim).toBe(ANIM_SIT);
  await expect(actor.page.locator('.action-prompt')).toHaveCount(0);

  // Walking off stands the actor up and frees the seat.
  await actor.page.keyboard.down('KeyS');
  await actor.page.waitForTimeout(1500);
  await actor.page.keyboard.up('KeyS');
  await expect.poll(async () => (await remotes(audience.page))[0]?.seated).toBe(false);

  await actor.context.close();
  await audience.context.close();
});

test('nearby chat reaches people close by, filtered, and nobody far away', async ({ browser }) => {
  const speaker = await enterAs(browser, 'Người Nói', {}, '&spawn=poi.checkpoint.atrium');
  const neighbour = await enterAs(browser, 'Hàng Xóm', {}, '&spawn=poi.checkpoint.atrium');
  const stranger = await enterAs(browser, 'Ở Xa', {}, '&spawn=poi.checkpoint.riverside');

  await speaker.page.keyboard.press('Enter');
  const field = speaker.page.getByLabel('Tin nhắn');
  await expect(field).toBeFocused();
  await field.fill('đm, trưa nay ăn gì?');
  await field.press('Enter');

  await expect(neighbour.page.locator('.chat-lines')).toContainText(
    'Người Nói: **, trưa nay ăn gì?',
  );
  await expect(speaker.page.locator('.chat-lines li[data-mine="true"]')).toContainText(
    'trưa nay ăn gì?',
  );
  await neighbour.page.waitForTimeout(1000);
  await expect(stranger.page.locator('.chat-lines')).toHaveCount(0);

  // Typing must not have moved the speaker: WASD letters went into the field, not the game.
  await speaker.page.keyboard.press('Enter');
  await speaker.page.getByLabel('Tin nhắn').fill('wasd wasd');
  await speaker.page.getByLabel('Tin nhắn').press('Enter');
  await expect(neighbour.page.locator('.chat-lines')).toContainText('wasd wasd');

  for (const player of [speaker, neighbour, stranger]) await player.context.close();
});

test('finding a colleague in another channel and joining them', async ({ browser }) => {
  // The e2e server closes a channel to new arrivals at three people.
  const first = await enterAs(browser, 'Đồng Nghiệp');
  const others = [await enterAs(browser, 'Hai'), await enterAs(browser, 'Ba')];
  const late = await enterAs(browser, 'Đến Muộn');
  await expect(late.page.getByTestId('channel-badge')).toContainText('Campus 2');

  await late.page.getByRole('button', { name: 'Mọi người' }).click();
  await late.page.getByLabel('Tìm theo tên').fill('dong nghiep');
  const row = late.page.getByTestId('people-list').locator('li', { hasText: 'Đồng Nghiệp' });
  await expect(row).toContainText('Campus 1');
  await row.getByRole('button', { name: 'Tới kênh này' }).click();

  await expect(late.page.getByTestId('channel-badge')).toContainText('Campus 1 · 4 người');
  await expect(first.page.getByTestId('channel-badge')).toContainText('4 người');

  for (const player of [first, ...others, late]) await player.context.close();
});
