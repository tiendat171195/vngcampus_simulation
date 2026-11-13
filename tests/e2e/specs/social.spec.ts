import { expect, test } from '@playwright/test';
import { enterAs, enterFromSplash, remotes } from './helpers';

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
  // Four browsers rendering WebGL in software take a while to step in.
  test.slow();
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

test('a new avatar is saved and seen by others straight away', async ({ browser }) => {
  const dresser = await enterAs(browser, 'Thay Áo', {}, '&spawn=poi.checkpoint.atrium');
  const watcher = await enterAs(browser, 'Ngắm Áo', {}, '&spawn=poi.checkpoint.atrium');
  const avatarOf = async (name: string) =>
    (await remotes(watcher.page)).find((remote) => remote.name === name)?.avatar;
  await expect.poll(() => avatarOf('Thay Áo')).toBe('');

  await dresser.page.getByRole('button', { name: 'Avatar' }).click();
  const editor = dresser.page.getByTestId('avatar-editor');
  const row = (label: string) => editor.locator('.avatar-row', { hasText: label });
  await row('Tóc').getByRole('button', { name: 'Đuôi ngựa', exact: true }).click();
  await row('Áo').getByRole('button', { name: 'Áo khoác', exact: true }).click();
  await row('Phụ kiện').getByRole('button', { name: 'Tai nghe', exact: true }).click();
  await editor.getByRole('button', { name: 'Lưu' }).click();
  await expect(editor).toHaveCount(0);

  await expect
    .poll(() => avatarOf('Thay Áo'))
    .toMatch(/^v1\.b\d\.s\d\.h6-\w\.t3-\w\.p\w-\w\.f\w-\w\.a5$/);
  // Saved to the account: it is still there after a reload.
  const saved = await avatarOf('Thay Áo');
  await dresser.page.reload();
  await enterFromSplash(dresser.page);
  await expect.poll(() => avatarOf('Thay Áo')).toBe(saved);
  await dresser.context.close();
  await watcher.context.close();
});
