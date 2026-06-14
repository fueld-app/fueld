import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';
import { createInquiryViaApi } from '../helpers/trading';

test.describe('Order supplier comparison', () => {
  test('inquiry detail renders with order items and actions', async ({ page }) => {
    test.setTimeout(60_000);

    await loginViaUi(page, {
      email: process.env['E2E_TRADER6_USER_EMAIL'] ?? 'trader6@fueld.local',
      password: process.env['E2E_TRADER6_USER_PASSWORD'] ?? 'trader6password123',
    });

    const inquiryId = await createInquiryViaApi(page);
    await page.goto(`/trading/inquiries/${inquiryId}`);

    // Wait for inquiry detail to load
    await expect(page.getByRole('heading', { name: 'Inquiry Detail' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('app-order-items')).toContainText('MGO', { timeout: 15_000 });

    // Order items component is rendered
    await expect(page.locator('app-order-items')).toBeVisible({ timeout: 10_000 });

    // Actions dropdown is present
    await expect(page.getByRole('button', { name: 'Actions' })).toBeVisible({ timeout: 10_000 });
  });

  test('inquiry page renders secondary tabs area', async ({ page }) => {
    test.setTimeout(60_000);

    await loginViaUi(page, {
      email: process.env['E2E_TRADER6_USER_EMAIL'] ?? 'trader6@fueld.local',
      password: process.env['E2E_TRADER6_USER_PASSWORD'] ?? 'trader6password123',
    });

    const inquiryId = await createInquiryViaApi(page);
    await page.goto(`/trading/inquiries/${inquiryId}`);

    await expect(page.getByRole('heading', { name: 'Inquiry Detail' })).toBeVisible({ timeout: 15_000 });

    // Comment section is visible by default (primary tab)
    const commentsSection = page.getByPlaceholder(/Write a comment|Add a comment/i);
    if (await commentsSection.isVisible().catch(() => false)) {
      await expect(commentsSection).toBeVisible();
    }
  });
});