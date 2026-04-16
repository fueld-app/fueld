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

  const qtyInput = page.locator('app-order-items input[placeholder="Qty"]:visible').first();
  await expect(qtyInput).toBeVisible();
  await qtyInput.fill('100');
  await qtyInput.blur();

  await expect(qtyInput).toHaveValue('100');

  await qtyInput.fill('100.5');
  await qtyInput.blur();

  await expect(qtyInput).toHaveValue('100.5');
});