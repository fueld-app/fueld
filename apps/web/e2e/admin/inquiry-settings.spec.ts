import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';

const adminEmail = process.env['E2E_ADMIN2_EMAIL'] ?? 'admin2@fueld.local';
const adminPassword = process.env['E2E_ADMIN2_PASSWORD'] ?? 'admin2password123';

async function adminHeaders(page: import('@playwright/test').Page): Promise<Record<string, string>> {
  const accessToken = await page.evaluate(() => localStorage.getItem('fueld_access_token'));
  if (!accessToken) {
    throw new Error('Missing access token in browser localStorage.');
  }

  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
}

test('admin inquiry settings persist through reloads', async ({ page }) => {
  test.setTimeout(90_000);

  await loginViaUi(page, { email: adminEmail, password: adminPassword });

  const headers = await adminHeaders(page);
  const resetResponse = await page.request.put('http://localhost:3000/admin/settings/inquiry', {
    headers,
    data: {
      supplierResponseUrlEnabled: true,
      autoMarkNoReplyAfterHours: 168,
    },
  });
  expect(resetResponse.ok()).toBe(true);

  await page.goto('/admin/settings');
  await expect(page.getByRole('heading', { name: 'General Settings' })).toBeVisible();

  const inquiryCard = page.locator('div.app-panel').filter({
    has: page.getByRole('heading', { name: 'Supplier Inquiry Settings' }),
  }).first();
  await expect(inquiryCard).toBeVisible();

  const toggleRows = inquiryCard.locator('div.flex.items-center.justify-between.gap-4');
  const responseToggle = toggleRows.nth(0).getByRole('button');
  const noReplyToggle = toggleRows.nth(1).getByRole('button');

  await expect(responseToggle).toHaveClass(/bg-sky-500/);
  await expect(noReplyToggle).toHaveClass(/bg-sky-500/);

  await responseToggle.click();
  await expect(inquiryCard).toContainText('Supplier response links disabled.');
  await expect(responseToggle).toHaveClass(/bg-gray-200/);

  await noReplyToggle.click();
  await expect(inquiryCard).toContainText('Automatic no-reply handling disabled.');
  await expect(noReplyToggle).toHaveClass(/bg-gray-200/);
  await expect(inquiryCard.locator('input[type="number"]')).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'General Settings' })).toBeVisible();
  await expect(responseToggle).toHaveClass(/bg-gray-200/);
  await expect(noReplyToggle).toHaveClass(/bg-gray-200/);
  await expect(inquiryCard.locator('input[type="number"]')).toHaveCount(0);

  await noReplyToggle.click();
  await expect(inquiryCard).toContainText('Automatic no-reply handling enabled.');
  await expect(noReplyToggle).toHaveClass(/bg-sky-500/);

  const hoursInput = inquiryCard.locator('input[type="number"]').first();
  await expect(hoursInput).toBeVisible();
  await hoursInput.fill('24');
  await inquiryCard.getByRole('button', { name: 'Save no-reply timing' }).click();
  await expect(inquiryCard).toContainText('No-reply timing updated.');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'General Settings' })).toBeVisible();
  await expect(responseToggle).toHaveClass(/bg-gray-200/);
  await expect(noReplyToggle).toHaveClass(/bg-sky-500/);
  await expect(hoursInput).toHaveValue('24');

  const verifyResponse = await page.request.get('http://localhost:3000/admin/settings/inquiry', { headers });
  expect(verifyResponse.ok()).toBe(true);
  const verifyJson = await verifyResponse.json() as {
    success: boolean;
    data?: { supplierResponseUrlEnabled?: boolean; autoMarkNoReplyAfterHours?: number | null };
  };
  expect(verifyJson.success).toBe(true);
  expect(verifyJson.data?.supplierResponseUrlEnabled).toBe(false);
  expect(verifyJson.data?.autoMarkNoReplyAfterHours).toBe(24);
});