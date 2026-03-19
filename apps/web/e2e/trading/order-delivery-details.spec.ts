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

test('delivered at uses a date-only input and autosaves without time entry', async ({ page }) => {
  test.setTimeout(90_000);

  await loginViaUi(page, {
    email: process.env['E2E_TRADER3_USER_EMAIL'] ?? 'trader3@fueld.local',
    password: process.env['E2E_TRADER3_USER_PASSWORD'] ?? 'trader3password123',
  });

  await createOrderFromInquiry(page);

  const deliveredAtInput = page.locator('label').filter({ hasText: 'Delivered At' }).locator('..').locator('input');
  await expect(deliveredAtInput).toBeVisible();
  await expect(deliveredAtInput).toHaveAttribute('type', 'date');

  const saveRequest = page.waitForRequest((request) => {
    if (request.method() !== 'PUT') return false;

    let pathname = '';
    try {
      pathname = new URL(request.url()).pathname;
    } catch {
      return false;
    }

    if (!/\/orders\/[^/]+$/.test(pathname)) return false;

    const payload = request.postDataJSON() as { deliveredAt?: string | null };
    return payload.deliveredAt === '2026-01-09T12:00:00.000Z';
  });

  await deliveredAtInput.fill('2026-01-09');
  await saveRequest;
  await expect(deliveredAtInput).toHaveValue('2026-01-09');
});