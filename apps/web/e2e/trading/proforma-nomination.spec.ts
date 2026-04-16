import { test, expect } from '../fixtures/coverage';
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

test('order actions gate proforma and nomination when prerequisites are missing', async ({ page }) => {
  test.setTimeout(90_000);

  await loginViaUi(page, {
    email: process.env['E2E_TRADER2_USER_EMAIL'] ?? 'trader2@fueld.local',
    password: process.env['E2E_TRADER2_USER_PASSWORD'] ?? 'trader2password123',
  });

  await createOrderFromInquiry(page);

  await page.getByRole('button', { name: 'Actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'View Proforma Invoice' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'View Nomination' })).toBeVisible();
});
