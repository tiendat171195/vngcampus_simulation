import { expect, test } from '@playwright/test';
import { enterAs, remotes } from './helpers';

const ANIM_SIT = 5;
const ANIM_EMOTE = 6;
const WAVE = 1;

test('others see a wave and see someone sit down on a seat', async ({ browser }) => {
  const actor = await enterAs(browser, 'Diễn', {}, undefined, '&spawn=poi.seat.koi_01');
  const audience = await enterAs(browser, 'Xem', {}, undefined, '&spawn=poi.checkpoint.koi');
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
  const speaker = await enterAs(
    browser,
    'Người Nói',
    {},
    undefined,
    '&spawn=poi.checkpoint.atrium',
  );
  const neighbour = await enterAs(
    browser,
    'Hàng Xóm',
    {},
    undefined,
    '&spawn=poi.checkpoint.atrium',
  );
  const stranger = await enterAs(browser, 'Ở Xa', {}, undefined, '&spawn=poi.checkpoint.riverside');

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
