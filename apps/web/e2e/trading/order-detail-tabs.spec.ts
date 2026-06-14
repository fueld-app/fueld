import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';
import { createInquiryViaApi } from '../helpers/trading';

test.describe('Order detail page rendering', () => {
  test('inquiry detail page loads and shows core trading content', async ({ page }) => {
    test.setTimeout(60_000);

    await loginViaUi(page, {
      email: process.env['E2E_TRADER6_USER_EMAIL'] ?? 'trader6@fueld.local',
      password: process.env['E2E_TRADER6_USER_PASSWORD'] ?? 'trader6password123',
    });

    const inquiryId = await createInquiryViaApi(page);
    await page.goto(`/trading/inquiries/${inquiryId}`);

    // Core page renders
    await expect(page.getByRole('heading', { name: 'Inquiry Detail' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('app-order-items')).toContainText('MGO', { timeout: 15_000 });

    // Status badge renders with the inquiry status
    const statusBadge = page.locator('app-status-badge');
    await expect(statusBadge).toBeAttached({ timeout: 10_000 });

    // Actions button is available for inquiries
    await expect(page.getByRole('button', { name: 'Actions' })).toBeVisible({ timeout: 10_000 });
  });

  test('order detail page header renders with title and status', async ({ page }) => {
    test.setTimeout(90_000);

    await loginViaUi(page, {
      email: process.env['E2E_TRADER6_USER_EMAIL'] ?? 'trader6@fueld.local',
      password: process.env['E2E_TRADER6_USER_PASSWORD'] ?? 'trader6password123',
    });

    const inquiryId = await createInquiryViaApi(page);
    await page.goto(`/trading/inquiries/${inquiryId}`);

    // Convert to order first to see order detail
    await page.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Convert to Order' }).click();
    await page.getByRole('button', { name: 'Confirm Convert' }).click();
    await page.waitForURL(/\/trading\/orders\//, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Order Detail' })).toBeVisible({ timeout: 15_000 });

    // Order items still visible after conversion
    await expect(page.locator('app-order-items')).toContainText('MGO', { timeout: 15_000 });

    // Status badge visible
    await expect(page.locator('app-status-badge')).toBeAttached({ timeout: 10_000 });
  });
});