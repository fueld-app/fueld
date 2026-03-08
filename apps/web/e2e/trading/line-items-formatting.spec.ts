import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';
import { createInquiryViaApi } from '../helpers/trading';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

test('line item totals omit trailing zero decimals but keep meaningful decimals', async ({ page }) => {
  test.setTimeout(90_000);

  await loginViaUi(page, {
    email: env['E2E_TRADER4_USER_EMAIL'] ?? 'trader4@fueld.local',
    password: env['E2E_TRADER4_USER_PASSWORD'] ?? 'trader4password123',
  });

  const inquiryId = await createInquiryViaApi(page);
  await page.goto(`/trading/inquiries/${inquiryId}`);

  const totalsFooter = page.locator('app-order-items tfoot').first();
  await expect(totalsFooter).toBeVisible();
  await expect(totalsFooter).toContainText('100');
  await expect(totalsFooter).not.toContainText('100.000');

  const firstRow = page.locator('app-order-items tbody tr').first();
  const qtyInput = firstRow.locator('input[type="number"]').first();
  await expect(qtyInput).toBeVisible();
  await qtyInput.fill('100.5');
  await qtyInput.blur();

  await expect(qtyInput).toHaveValue('100.5');
  await expect(totalsFooter).toContainText('100.5');
  await expect(totalsFooter).not.toContainText('100.500');
});