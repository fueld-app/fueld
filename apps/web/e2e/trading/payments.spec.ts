import { test, expect } from '@playwright/test';
import { loginViaUi } from '../helpers/auth';
import { createInquiryViaApi } from '../helpers/trading';

async function createOrderFromInquiry(page: import('@playwright/test').Page): Promise<void> {
  const inquiryId = await createInquiryViaApi(page);
  await page.goto(`/trading/inquiries/${inquiryId}`);
  await expect(page.getByRole('button', { name: 'Actions' })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Convert to Order' }).click();
  await page.getByRole('button', { name: 'Confirm Convert' }).click();
  await page.waitForURL(/\/trading\/orders\//, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Order Detail' })).toBeVisible();
}

test('record a payment and order becomes paid', async ({ page }) => {
  test.setTimeout(90_000);

  await loginViaUi(page, {
    email: process.env['E2E_TRADER3_USER_EMAIL'] ?? 'trader3@fueld.local',
    password: process.env['E2E_TRADER3_USER_PASSWORD'] ?? 'trader3password123',
  });

  await createOrderFromInquiry(page);

  await page.getByRole('button', { name: 'Add payment' }).click();

  const heading = page.getByRole('heading', { name: 'Record payment' });
  await expect(heading).toBeVisible();
  const modal = heading.locator('..').locator('..');

  await modal.locator('input[type="number"]').fill('1000');
  await modal.locator('input[placeholder="Wire, ACH, card"]').fill('Wire');
  await modal.locator('textarea').fill('E2E payment');

  const paymentPosted = page.waitForResponse((res) => {
    if (res.request().method() !== 'POST') return false;
    try {
      return /\/orders\/[^/]+\/payments$/.test(new URL(res.url()).pathname);
    } catch {
      return false;
    }
  });
  await modal.getByRole('button', { name: 'Record payment' }).click();
  const paymentRes = await paymentPosted;
  if (paymentRes.status() < 200 || paymentRes.status() >= 300) {
    const body = await paymentRes.text().catch(() => '');
    throw new Error(`Record payment failed: ${paymentRes.status()} ${paymentRes.statusText()}${body ? `\n${body}` : ''}`);
  }

  await expect(page.getByText('Payment recorded. Order marked as paid.')).toBeVisible();

  // Ensure Mark Paid action is no longer present.
  await page.getByRole('button', { name: 'Actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Mark Paid' })).toHaveCount(0);
});
