import { expect, type Page, test } from '@playwright/test';
import { enterAs } from './helpers';
import { resetE2eOperations } from './mission-data';

const ADMIN = 'http://localhost:4174';

/** Signs in on the game with the e2e administrator's company account; the admin shares the session. */
async function signInAsAdmin(page: Page) {
  await page.goto('/api/v1/auth/oidc/oidc/start?return=%2F&consent=1');
  await page.fill('#email', 'e2e.admin@vng.com.vn');
  await page.fill('#name', 'Quản Trị E2E');
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForURL(/localhost:4173\/$/);
}

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
