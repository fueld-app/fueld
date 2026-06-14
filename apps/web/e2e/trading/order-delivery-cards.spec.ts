import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';
import { createInquiryViaApi } from '../helpers/trading';

test.describe('Order delivery cards', () => {
  test('inquiry detail loads with order items and status', async ({ page }) => {
    test.setTimeout(60_000);

    await loginViaUi(page, {
      email: process.env['E2E_TRADER6_USER_EMAIL'] ?? 'trader6@fueld.local',
      password: process.env['E2E_TRADER6_USER_PASSWORD'] ?? 'trader6password123',
    });

    const inquiryId = await createInquiryViaApi(page);
    await page.goto(`/trading/inquiries/${inquiryId}`);

    await expect(page.getByRole('heading', { name: 'Inquiry Detail' })).toBeVisible({ timeout: 15_000 });

    // Status badge renders
    await expect(page.locator('app-status-badge')).toBeAttached({ timeout: 10_000 });

    // Order items grid renders
    await expect(page.locator('app-order-items')).toContainText('MGO', { timeout: 10_000 });
  });
});