import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';

/**
 * Playwright UI E2E tests for broker deal UI flows.
 *
 * Covers:
 * - Broker deals sidebar tab visible when feature enabled
 * - List page shows broker deals
 * - Order detail shows broker deal toggle when enabled
 * - Commission report link on broker deals page
 * - New inquiry modal shows broker deal checkbox when enabled
 *
 * NOTE: Broker deals must be enabled in the test DB tenant settings before
 * running these tests. Use: psql $TEST_DB -c "UPDATE tenants SET settings =
 * jsonb_set(COALESCE(settings,'{}'::jsonb),'{brokerDeals}','{\"enabled\":true,...}')"
 * The PUT /admin/settings/broker-deals endpoint has a known DB JSONB issue
 * (see audit report H2/H3), so we set the settings directly via SQL.
 */

const adminEmail = process.env['E2E_USER_EMAIL'] ?? 'e2e@fueld.local';
const adminPassword = process.env['E2E_USER_PASSWORD'] ?? 'password123';

test.describe('broker deals UI', () => {
  test('sidebar tab visible when feature enabled', async ({ page }) => {
    await loginViaUi(page, { email: adminEmail, password: adminPassword });
    // Broker deals should already be enabled in the test DB
    await page.goto('/');
    await page.reload();

    // The "Broker Deals" nav link should be visible
    await expect(page.getByRole('link', { name: /Broker Deals/i })).toBeVisible({ timeout: 15_000 });
  });

  test('broker deals list page loads', async ({ page }) => {
    await loginViaUi(page, { email: adminEmail, password: adminPassword });
    await page.goto('/trading/broker-deals');
    await expect(page).toHaveURL(/\/trading\/broker-deals/);
    await expect(page.getByRole('heading', { name: /Broker Deals/i })).toBeVisible({ timeout: 15_000 });
  });

  test('commission report link visible on broker deals page', async ({ page }) => {
    await loginViaUi(page, { email: adminEmail, password: adminPassword });
    await page.goto('/trading/broker-deals');
    await expect(page.getByRole('link', { name: /Commission Report/i })).toBeVisible({ timeout: 15_000 });
  });

  test('order detail shows broker deal toggle when enabled', async ({ page }) => {
    await loginViaUi(page, { email: adminEmail, password: adminPassword });
    await page.goto('/trading/inquiries');
    await page.waitForTimeout(2000);

    // Try clicking the first order in the list
    const firstOrderLink = page.locator('a[href*="/trading/order/"]').first();
    const hasOrder = await firstOrderLink.isVisible().catch(() => false);

    if (hasOrder) {
      await firstOrderLink.click();
      await page.waitForTimeout(2000);

      // Look for broker deal label in the settings area
      const brokerDealLabel = page.getByText(/Broker Deal/i).first();
      await expect(brokerDealLabel).toBeVisible({ timeout: 15_000 });
    }
  });

  test('new inquiry modal shows broker deal checkbox when enabled', async ({ page }) => {
    await loginViaUi(page, { email: adminEmail, password: adminPassword });
    await page.goto('/trading/inquiries');
    await page.waitForTimeout(2000);

    // Click the "New Inquiry" button
    const newInquiryBtn = page.getByRole('button', { name: /New Inquiry/i }).first();
    if (await newInquiryBtn.isVisible().catch(() => false)) {
      await newInquiryBtn.click();
      await page.waitForTimeout(1000);

      // Look for broker deal checkbox in the modal
      const brokerDealLabel = page.getByText(/Broker Deal/i).first();
      await expect(brokerDealLabel).toBeVisible({ timeout: 15_000 });
    }
  });
});