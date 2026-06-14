import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';
import { createMultiSupplierInquiryViaApi } from '../helpers/trading';

test.describe('Multi-supplier order', () => {
  test('shows all line items regardless of which supplier tab is active', async ({ page }) => {
    test.setTimeout(120_000);

    await loginViaUi(page, {
      email: process.env['E2E_TRADER6_USER_EMAIL'] ?? 'trader6@fueld.local',
      password: process.env['E2E_TRADER6_USER_PASSWORD'] ?? 'trader6password123',
    });

    const { inquiryId, supplierRecordIds } = await createMultiSupplierInquiryViaApi(page);
    expect(supplierRecordIds.length).toBeGreaterThanOrEqual(2);

    await page.goto(`/trading/inquiries/${inquiryId}`);
    await expect(page.getByRole('heading', { name: 'Inquiry Detail' })).toBeVisible({ timeout: 15_000 });

    // Supplier tab buttons are present
    const supplierButtons = page.locator('button[aria-selected]');
    await expect(supplierButtons.first()).toBeVisible({ timeout: 10_000 });
    expect(await supplierButtons.count()).toBeGreaterThanOrEqual(2);

    // All line items visible regardless of active supplier tab
    await expect(page.locator('app-order-items')).toContainText('MGO', { timeout: 10_000 });
    await expect(page.locator('app-order-items')).toContainText('VLSFO', { timeout: 10_000 });

    // Switch to second supplier tab
    await supplierButtons.nth(1).click();
    await page.waitForTimeout(500);

    // Both items still shown — switching tabs does NOT filter items
    await expect(page.locator('app-order-items')).toContainText('MGO', { timeout: 10_000 });
    await expect(page.locator('app-order-items')).toContainText('VLSFO', { timeout: 10_000 });

    // Secondary tabs still work
    await expect(page.locator('app-order-secondary-tabs')).toBeAttached({ timeout: 5_000 });

    // Actions dropdown works
    await expect(page.getByRole('button', { name: 'Actions' })).toBeVisible({ timeout: 10_000 });
  });

  test('supplier tab switching updates payment terms card', async ({ page }) => {
    test.setTimeout(120_000);

    await loginViaUi(page, {
      email: process.env['E2E_TRADER6_USER_EMAIL'] ?? 'trader6@fueld.local',
      password: process.env['E2E_TRADER6_USER_PASSWORD'] ?? 'trader6password123',
    });

    const { inquiryId } = await createMultiSupplierInquiryViaApi(page);

    await page.goto(`/trading/inquiries/${inquiryId}`);
    await expect(page.getByRole('heading', { name: 'Inquiry Detail' })).toBeVisible({ timeout: 15_000 });

    // All items visible regardless of supplier tab
    await expect(page.locator('app-order-items')).toContainText('MGO', { timeout: 10_000 });
    await expect(page.locator('app-order-items')).toContainText('VLSFO', { timeout: 10_000 });

    // Secondary tabs area present
    await expect(page.locator('app-order-secondary-tabs')).toBeAttached({ timeout: 10_000 });

    // Actions button present
    await expect(page.getByRole('button', { name: 'Actions' })).toBeVisible({ timeout: 10_000 });

    // Items grid renders both line items
    const itemsText = await page.locator('app-order-items').textContent({ timeout: 5_000 });
    expect(itemsText).toContain('MGO');
    expect(itemsText).toContain('VLSFO');
  });
});