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

test('payment form requires amount before submitting', async ({ page }) => {
  test.setTimeout(90_000);

  await loginViaUi(page, {
    email: process.env['E2E_TRADER3_USER_EMAIL'] ?? 'trader3@fueld.local',
    password: process.env['E2E_TRADER3_USER_PASSWORD'] ?? 'trader3password123',
  });

  await createOrderFromInquiry(page);

  let paymentPostCount = 0;
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    try {
      const path = new URL(request.url()).pathname;
      if (/\/orders\/[^/]+\/payments$/.test(path)) paymentPostCount += 1;
    } catch {
      // ignore invalid URLs
    }
  });

  await page.getByRole('button', { name: 'Add payment' }).click();
  await expect(page.getByRole('heading', { name: 'Record payment' })).toBeVisible();

  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Amount is required.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Record payment' })).toBeVisible();
  await expect.poll(() => paymentPostCount).toBe(0);
});
