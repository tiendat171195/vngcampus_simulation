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

  await dresser.page.getByRole('button', { name: 'Hồ sơ' }).click();
  await dresser.page.getByRole('button', { name: 'Đổi avatar' }).click();
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

test('a first visit asks for a look, then teaches walking, looking and waving', async ({
  browser,
}) => {
  const newcomer = await enterAs(browser, 'Người Mới', {}, '', true);
  const { page } = newcomer;
  const editor = page.getByTestId('avatar-editor');
  await expect(editor).toContainText('Chọn ngoại hình của bạn');
  await editor
    .locator('.avatar-row', { hasText: 'Tóc' })
    .getByRole('button', { name: 'Bob', exact: true })
    .click();
  await editor.getByRole('button', { name: 'Lưu' }).click();

  const tutorial = page.getByTestId('tutorial');
  await expect(tutorial).toContainText('Đi lại');
  await page.locator('.input-layer').click({ position: { x: 600, y: 300 } });
  await page.keyboard.down('KeyW');
  await expect(tutorial).toContainText('Nhìn quanh', { timeout: 30_000 });
  await page.keyboard.up('KeyW');
  const layer = page.locator('.input-layer');
  const box = await layer.boundingBox();
  if (!box) throw new Error('no input layer');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 300, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(tutorial).toContainText('Chào mọi người');
  await page.keyboard.press('Digit1');
  await expect(tutorial).toContainText('Xong rồi');
  await expect(tutorial).toHaveCount(0, { timeout: 10_000 });

  // Not again on the next visit.
  await page.reload();
  await enterFromSplash(page);
  await page.waitForTimeout(1000);
  await expect(page.getByTestId('avatar-editor')).toHaveCount(0);
  await expect(page.getByTestId('tutorial')).toHaveCount(0);
  await newcomer.context.close();
});

test('profiles: department, title and staying off the online list; cards for colleagues', async ({
  browser,
}) => {
  const me = await enterAs(browser, 'Có Phòng Ban', {}, '&spawn=poi.checkpoint.koi');
  const colleague = await enterAs(browser, 'Đồng Nghiệp Tò Mò', {}, '&spawn=poi.checkpoint.koi');

  await me.page.getByRole('button', { name: 'Hồ sơ' }).click();
  const panel = me.page.getByRole('region', { name: 'Hồ sơ' });
  await panel.getByLabel('Chức danh (không bắt buộc)').fill('Kỹ sư thử nghiệm');
  await panel.getByLabel('Ẩn tôi khỏi danh sách online').check();
  await panel.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await expect(panel.getByRole('status')).toHaveText('Đã lưu.');

  // Off the online list, but the card still opens from the people list of someone nearby…
  await colleague.page.getByRole('button', { name: 'Mọi người' }).click();
  await colleague.page.getByLabel('Tìm theo tên').fill('co phong ban');
  await expect(colleague.page.getByTestId('people-list')).toContainText('Không tìm thấy ai.');
  await panel.getByLabel('Ẩn tôi khỏi danh sách online').uncheck();
  await panel.getByRole('button', { name: 'Lưu hồ sơ' }).click();
  await colleague.page.getByLabel('Tìm theo tên').fill('co phong ba');
  const row = colleague.page.getByTestId('people-list').locator('li', { hasText: 'Có Phòng Ban' });
  await row.getByRole('button', { name: 'Hồ sơ' }).click();
  const card = colleague.page.getByTestId('profile-card');
  await expect(card).toContainText('Kỹ sư thử nghiệm');
  await expect(card).toContainText('Khách');

  // A guest can make a recovery code and use it in another browser.
  await panel.getByRole('button', { name: 'Tạo mã khôi phục' }).click();
  const code = (await panel.getByTestId('recovery-code').textContent()) ?? '';
  const elsewhere = await browser.newContext();
  const other = await elsewhere.newPage();
  await other.goto('/?debug');
  await other.getByRole('button', { name: 'Đã có tài khoản khách? Dùng mã khôi phục' }).click();
  await other.getByLabel('Mã khôi phục').fill(code);
  await other.getByRole('button', { name: 'Vào lại tài khoản khách' }).click();
  await expect(other.locator('.splash-name-input').first()).toHaveValue('Có Phòng Ban');
  await elsewhere.close();
  await me.context.close();
  await colleague.context.close();
});
