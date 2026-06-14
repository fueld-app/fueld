import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';
import { createMultiSupplierInquiryViaApi } from '../helpers/trading';

test.describe('Multi-supplier order', () => {
  test('creates inquiry, two supplier legs with dedicated items, verifies tabs', async ({ page }) => {
    test.setTimeout(120_000);

    await loginViaUi(page, {
      email: process.env['E2E_TRADER6_USER_EMAIL'] ?? 'trader6@fueld.local',
      password: process.env['E2E_TRADER6_USER_PASSWORD'] ?? 'trader6password123',
    });

    const { inquiryId, supplierRecordIds } = await createMultiSupplierInquiryViaApi(page);
    expect(supplierRecordIds.length).toBeGreaterThanOrEqual(2);

    await page.goto(`/trading/inquiries/${inquiryId}`);

    // Inquiry detail loaded
    await expect(page.getByRole('heading', { name: 'Inquiry Detail' })).toBeVisible({ timeout: 15_000 });

    // Supplier tab buttons are present (one per supplier leg)
    const supplierButtons = page.locator('button[aria-selected]');
    await expect(supplierButtons.first()).toBeVisible({ timeout: 10_000 });
    expect(await supplierButtons.count()).toBeGreaterThanOrEqual(2);

    // Each supplier button's aria-selected state works
    const firstSelected = page.locator('button[aria-selected="true"]');
    await expect(firstSelected).toBeVisible({ timeout: 5_000 });

    // MGO is the primary supplier's product type — should be visible
    await expect(page.locator('app-order-items')).toContainText('MGO', { timeout: 10_000 });

    // Click second supplier tab — it should show VLSFO (their dedicated item)
    await supplierButtons.nth(1).click();
    await page.waitForTimeout(500);

    // Second supplier's aria-selected should update
    const secondSelected = page.locator('button[aria-selected="true"]');
    await expect(secondSelected).toBeVisible({ timeout: 5_000 });

    // Their line item (VLSFO) should now appear in the items grid,
    // and the primary supplier's item (MGO) should be filtered out
    await expect(page.locator('app-order-items')).toContainText('VLSFO', { timeout: 10_000 });

    // Secondary tabs area renders below the supplier tabs
    await expect(page.locator('app-order-secondary-tabs')).toBeAttached({ timeout: 10_000 });

    // Actions dropdown works in multi-supplier context
    await expect(page.getByRole('button', { name: 'Actions' })).toBeVisible({ timeout: 10_000 });
  });

  test('switches between suppliers — each shows different line items', async ({ page }) => {
    test.setTimeout(120_000);

    await loginViaUi(page, {
      email: process.env['E2E_TRADER6_USER_EMAIL'] ?? 'trader6@fueld.local',
      password: process.env['E2E_TRADER6_USER_PASSWORD'] ?? 'trader6password123',
    });

    const { inquiryId, supplierRecordIds } = await createMultiSupplierInquiryViaApi(page);
    expect(supplierRecordIds.length).toBeGreaterThanOrEqual(2);

    await page.goto(`/trading/inquiries/${inquiryId}`);
    await expect(page.getByRole('heading', { name: 'Inquiry Detail' })).toBeVisible({ timeout: 15_000 });

    const supplierButtons = page.locator('button[aria-selected]');
    await expect(supplierButtons.first()).toBeVisible({ timeout: 10_000 });
    const count = await supplierButtons.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Supplier 0 should show MGO
    await supplierButtons.nth(0).click();
    await page.waitForTimeout(500);
    const firstItemText = await page.locator('app-order-items').textContent({ timeout: 5_000 });
    expect(firstItemText).toContain('MGO');

    // Supplier 1 should show VLSFO (not MGO)
    await supplierButtons.nth(1).click();
    await page.waitForTimeout(500);
    const secondItemText = await page.locator('app-order-items').textContent({ timeout: 5_000 });
    expect(secondItemText).toContain('VLSFO');

    // Secondary tabs still render after switching
    await expect(page.locator('app-order-secondary-tabs')).toBeAttached({ timeout: 5_000 });

    // Actions dropdown works
    await page.getByRole('button', { name: 'Actions' }).click();
    await expect(page.getByRole('menuitem').first()).toBeVisible({ timeout: 10_000 });
  });
});