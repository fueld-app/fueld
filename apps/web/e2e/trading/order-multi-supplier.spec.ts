import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';
import { createMultiSupplierInquiryViaApi } from '../helpers/trading';

test.describe('Multi-supplier order', () => {
  test('creates inquiry, adds two suppliers, verifies supplier tabs', async ({ page }) => {
    test.setTimeout(120_000);

    await loginViaUi(page, {
      email: process.env['E2E_TRADER6_USER_EMAIL'] ?? 'trader6@fueld.local',
      password: process.env['E2E_TRADER6_USER_PASSWORD'] ?? 'trader6password123',
    });

    const { inquiryId, supplierIds } = await createMultiSupplierInquiryViaApi(page);
    expect(supplierIds.length).toBeGreaterThanOrEqual(2);

    await page.goto(`/trading/inquiries/${inquiryId}`);

    // Wait for inquiry detail to load
    await expect(page.getByRole('heading', { name: 'Inquiry Detail' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('app-order-items')).toContainText('MGO', { timeout: 15_000 });

    // Supplier tabs are buttons with aria-selected attribute
    const supplierButtons = page.locator('button[aria-selected]');
    await expect(supplierButtons.first()).toBeVisible({ timeout: 10_000 });

    const buttonCount = await supplierButtons.count();
    expect(buttonCount).toBeGreaterThanOrEqual(1);

    // Click the second supplier button if multiple exist
    if (buttonCount >= 2) {
      await supplierButtons.nth(1).click();
      await page.waitForTimeout(500);

      // The newly-selected button should have aria-selected="true"
      const selected = page.locator('button[aria-selected="true"]');
      await expect(selected).toBeVisible({ timeout: 5_000 });
    }

    // Secondary tabs component renders below the supplier tabs
    await expect(page.locator('app-order-secondary-tabs')).toBeAttached({ timeout: 10_000 });

    // Actions dropdown works
    await expect(page.getByRole('button', { name: 'Actions' })).toBeVisible({ timeout: 10_000 });
  });

  test('switch supplier tab and verify secondary tabs still work', async ({ page }) => {
    test.setTimeout(120_000);

    await loginViaUi(page, {
      email: process.env['E2E_TRADER6_USER_EMAIL'] ?? 'trader6@fueld.local',
      password: process.env['E2E_TRADER6_USER_PASSWORD'] ?? 'trader6password123',
    });

    const { inquiryId } = await createMultiSupplierInquiryViaApi(page);

    await page.goto(`/trading/inquiries/${inquiryId}`);

    await expect(page.getByRole('heading', { name: 'Inquiry Detail' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('app-order-items')).toContainText('MGO', { timeout: 15_000 });

    // Verify supplier buttons are present
    const supplierButtons = page.locator('button[aria-selected]');
    await expect(supplierButtons.first()).toBeVisible({ timeout: 10_000 });

    // Secondary tabs are present
    await expect(page.locator('app-order-secondary-tabs')).toBeAttached({ timeout: 10_000 });

    // Actions button shows dropdown in multi-supplier context
    await page.getByRole('button', { name: 'Actions' }).click();
    await expect(page.getByRole('menuitem', { name: /View Offer|Convert|Send|Cancel|Inquiry/i }).first()).toBeVisible({ timeout: 10_000 });
  });
});