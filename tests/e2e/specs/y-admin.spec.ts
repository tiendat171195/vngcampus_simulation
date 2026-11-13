import { expect, test } from '@playwright/test';
import { ADMIN, enterAs, signInAsAdmin } from './helpers';
import { resetE2eOperations } from './mission-data';

test('an editor builds a mission on screen, places it on the map and publishes it', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await signInAsAdmin(page);

  // A day far ahead, different on every run: the e2e database outlives a run.
  const day = new Date(Date.UTC(2031, 0, 1) + (Date.now() % 3000) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  await page.goto(`${ADMIN}/missions/new?date=${day}`);
  const editor = page.getByTestId('mission-editor');
  await editor.getByLabel('Tên nhiệm vụ').fill('Hẹn ở Atrium');
  await editor.getByLabel('Mô tả').fill('Ghé Atrium một lần.');

  // Swap the default gate for the Atrium, chosen on the map.
  const visit = page.getByTestId('objective-o1');
  await visit.getByRole('button', { name: 'Bỏ địa điểm' }).click();
  await visit.getByLabel('Tiêu đề hiện cho người chơi').fill('Ghé Atrium');
  await visit.getByRole('button', { name: 'Chọn trên bản đồ' }).click();
  const map = visit.getByRole('button', { name: 'Bản đồ: bấm để chọn địa điểm' });
  const box = await map.boundingBox();
  if (!box) throw new Error('no map');
  let found = false;
  for (let fx = 0.3; fx <= 0.75 && !found; fx += 0.03)
    for (let fy = 0.3; fy <= 0.75 && !found; fy += 0.03) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
      if ((await page.locator('.map-floors .muted').textContent())?.includes('Atrium')) {
        await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
        found = true;
      }
    }
  expect(found).toBe(true);
  await expect(visit).toContainText('Atrium ×');

  await expect(page.getByTestId('checks')).toContainText('Sẵn sàng xuất bản.');
  await page.getByRole('button', { name: 'Lưu nháp' }).click();
  await page.waitForURL(/\/missions\/[0-9a-f-]{36}$/);
  await page.getByRole('button', { name: 'Xuất bản' }).click();
  await expect(page.getByRole('status')).toHaveText('Đã xuất bản.');
  await expect(editor.locator('.tag').first()).toHaveText('Đã lên lịch');

  // Kept as a template, which starts the next mission with everything filled in.
  const name = `Mẫu Atrium ${day}`;
  page.once('dialog', (dialog) => void dialog.accept(name));
  await page.getByRole('button', { name: 'Lưu làm mẫu' }).click();
  await expect(page.getByRole('status')).toHaveText(`Đã lưu thành mẫu "${name}".`);
  await page.goto(`${ADMIN}/templates`);
  const row = page.getByTestId('templates').getByRole('row', { name: new RegExp(name) });
  await row.getByRole('button', { name: 'Dùng mẫu' }).click();
  await page.waitForURL(/\/missions\/new\?template=/);
  await expect(editor.getByLabel('Tên nhiệm vụ')).toHaveValue('Hẹn ở Atrium');
  await expect(page.getByTestId('objective-o1')).toContainText('Atrium ×');

  // The template goes again, so runs do not pile them up.
  await page.goto(`${ADMIN}/templates`);
  page.once('dialog', (dialog) => void dialog.accept());
  await row.getByRole('button', { name: 'Xoá' }).click();
  await expect(row).toBeHidden();

  // The mission sits on the calendar on its day.
  await page.goto(`${ADMIN}/missions`);
  await expect(page.getByTestId('missions')).toBeVisible();
  await context.close();
});

test('a mute from the admin stops chat in the game within seconds', async ({ browser }) => {
  // A name of its own on every run: the e2e database keeps earlier players.
  const name = `Nói Nhiều ${Date.now() % 100_000}`;
  const player = await enterAs(browser, name);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await context.newPage();
  await signInAsAdmin(admin);
  await admin.goto(`${ADMIN}/users`);
  await admin.getByLabel('Tìm theo tên hoặc email').fill(name);
  await admin.getByRole('button', { name: 'Tìm' }).click();
  await admin.getByTestId('users').getByRole('link', { name }).click();
  await admin.getByLabel('Lý do').fill('Gửi tin rác');
  await admin.getByRole('button', { name: 'Áp dụng' }).click();
  await expect(admin.getByRole('status')).toHaveText('Đã cấm chat.');

  // Within a refresh of the realtime server (5 s), chat is refused with the reason.
  await player.page.waitForTimeout(6000);
  await player.page.keyboard.press('Enter');
  await player.page.keyboard.type('xin chào');
  await player.page.keyboard.press('Enter');
  await expect(player.page.locator('.notice-toast, .notice')).toContainText('tạm khoá chat', {
    timeout: 10_000,
  });
  await context.close();
  await player.context.close();
});

test('announcements, the chat switch and maintenance reach the game within seconds', async ({
  browser,
}) => {
  await resetE2eOperations();
  const player = await enterAs(browser, `Người Nghe ${Date.now() % 100_000}`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await context.newPage();
  admin.on('dialog', (dialog) => void dialog.accept());
  const ok = admin.locator('p.ok');
  try {
    await signInAsAdmin(admin);

    // A box everyone sees once, sent now.
    await admin.goto(`${ADMIN}/announcements`);
    const text = `Tiệc trà chiều nay ở Atrium (${Date.now() % 100_000})`;
    await admin.getByLabel('Mức').selectOption('popup');
    await admin.getByLabel('Nội dung').fill(text);
    await admin.getByRole('button', { name: 'Phát ngay' }).click();
    await expect(ok).toContainText('Đã phát');
    const card = player.page.getByTestId('announce-card');
    await expect(card).toContainText(text, { timeout: 12_000 });
    await card.getByRole('button', { name: 'Đã hiểu' }).click();
    await expect(card).toBeHidden();

    // Chat off for everyone, then on again.
    await admin.goto(`${ADMIN}/settings`);
    await admin.getByRole('button', { name: 'Tắt chat' }).click();
    await expect(ok).toHaveText('Đã tắt chat.');
    await expect(player.page.locator('.chat-open')).toContainText('Chat đang tắt', {
      timeout: 12_000,
    });
    await player.page.keyboard.press('Enter');
    const field = player.page.getByLabel('Tin nhắn');
    await expect(field).toHaveAttribute('placeholder', 'Chat đang tạm tắt trên toàn campus');
    await expect(field).toBeDisabled();
    await admin.getByRole('button', { name: 'Bật lại chat' }).click();
    await expect(ok).toHaveText('Đã bật lại chat.');
    await expect(field).toBeEnabled({ timeout: 12_000 });

    // Maintenance: the people inside are told, newcomers are turned away with the message.
    await admin.getByLabel('Lời nhắn bảo trì').fill('Bảo trì E2E, quay lại sau ít phút.');
    await admin.getByRole('button', { name: 'Bật bảo trì' }).click();
    await expect(ok).toHaveText('Đã bật bảo trì.');
    await expect(player.page.locator('.announce-maintenance')).toContainText('Bảo trì E2E', {
      timeout: 12_000,
    });
    const late = await enterAs(browser, 'Đến Muộn', {}, '', false, false);
    await expect(late.page.locator('.connection-banner')).toContainText('Bảo trì E2E', {
      timeout: 12_000,
    });
    await late.context.close();
    await admin.getByRole('button', { name: 'Tắt bảo trì' }).click();
    await expect(ok).toHaveText('Đã tắt bảo trì.');
    await expect(player.page.locator('.announce-maintenance')).toBeHidden({ timeout: 12_000 });
  } finally {
    await resetE2eOperations();
    await context.close();
    await player.context.close();
  }
});

test('a report from the game reaches the queue with the chat, and a decision mutes in seconds', async ({
  browser,
}) => {
  const suffix = Date.now() % 100_000;
  const rude = await enterAs(browser, `Nói Bậy ${suffix}`, {}, '&spawn=poi.checkpoint.atrium');
  const witness = await enterAs(
    browser,
    `Người Thấy ${suffix}`,
    {},
    '&spawn=poi.checkpoint.atrium',
  );
  await rude.page.keyboard.press('Enter');
  await rude.page.getByLabel('Tin nhắn').fill(`ê mấy người kia ${suffix}`);
  await rude.page.getByLabel('Tin nhắn').press('Enter');
  await expect(witness.page.locator('.chat-lines')).toContainText(`ê mấy người kia ${suffix}`);

  // Reported from the chat line, with a reason and a note.
  await witness.page.keyboard.press('Enter');
  await witness.page.getByRole('button', { name: `Báo cáo Nói Bậy ${suffix}` }).click();
  const dialog = witness.page.getByTestId('report-dialog');
  await dialog.getByLabel('Quấy rối, xúc phạm').check();
  await dialog.getByLabel('Ghi chú cho kiểm duyệt viên (không bắt buộc)').fill('Nói tục ở sảnh');
  await dialog.getByRole('button', { name: 'Gửi báo cáo' }).click();
  await expect(witness.page.locator('.notice-toast, .notice')).toContainText('Đã gửi báo cáo');

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const admin = await context.newPage();
  await signInAsAdmin(admin);
  // The dashboard sees people in the campus and the waiting report.
  await admin.goto(`${ADMIN}/`);
  await expect(admin.getByTestId('online-now').locator('b')).toHaveText(/^[1-9]\d*$/);
  await expect(admin.getByTestId('alerts')).toContainText('báo cáo vi phạm chờ xử lý');

  await admin.goto(`${ADMIN}/reports`);
  const report = admin.getByTestId('report').filter({ hasText: `Nói Bậy ${suffix}` });
  await expect(report).toContainText('Nói tục ở sảnh');
  await expect(report.locator('.transcript')).toContainText(`ê mấy người kia ${suffix}`);
  await report.getByLabel('Lý do quyết định').fill('Lời lẽ khiếm nhã');
  await report.getByRole('button', { name: 'Cấm chat 1 giờ' }).click();
  await expect(admin.getByRole('status')).toContainText(`đã đóng 1 báo cáo về Nói Bậy ${suffix}`);

  // Within a refresh of the realtime server (5 s), the person cannot chat any more.
  await rude.page.waitForTimeout(6000);
  await rude.page.keyboard.press('Enter');
  await rude.page.getByLabel('Tin nhắn').fill('alo');
  await rude.page.getByLabel('Tin nhắn').press('Enter');
  await expect(rude.page.locator('.notice-toast, .notice')).toContainText('tạm khoá chat', {
    timeout: 10_000,
  });
  await context.close();
  for (const player of [rude, witness]) await player.context.close();
});
