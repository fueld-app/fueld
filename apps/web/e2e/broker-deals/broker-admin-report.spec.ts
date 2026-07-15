import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';

/**
 * Playwright UI E2E tests for admin settings, commission report, and credit line UI.
 *
 * Covers:
 * - Admin settings page shows broker deal config options
 * - Commission report page: date range, generate button, export links
 * - Credit line UI (smoke test)
 *
 * NOTE: Broker deals must be enabled in the test DB tenant settings before running.
 */

const adminEmail = process.env['E2E_USER_EMAIL'] ?? 'e2e@fueld.local';
const adminPassword = process.env['E2E_USER_PASSWORD'] ?? 'password123';

test.describe('broker deal admin + report UI', () => {
  test('admin settings page loads with broker deals config', async ({ page }) => {
    await loginViaUi(page, { email: adminEmail, password: adminPassword });
    await page.goto('/admin/settings/broker-deals');
    await expect(page).toHaveURL(/\/admin\/settings\/broker-deals/);

    await expect(page.getByRole('heading', { name: /Broker Deals/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Enable Broker Deals/i)).toBeVisible({ timeout: 15_000 });
  });

  test('admin settings shows commission rate field', async ({ page }) => {
    await loginViaUi(page, { email: adminEmail, password: adminPassword });
    await page.goto('/admin/settings/broker-deals');

    await expect(page.getByRole('heading', { name: /Broker Deals/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Default Commission Rate/i)).toBeVisible({ timeout: 15_000 });
  });

  test('admin settings shows report statuses field', async ({ page }) => {
    await loginViaUi(page, { email: adminEmail, password: adminPassword });
    await page.goto('/admin/settings/broker-deals');

    await expect(page.getByText(/Report Statuses/i)).toBeVisible({ timeout: 15_000 });
  });

  test('admin settings shows credit auto-release settings', async ({ page }) => {
    await loginViaUi(page, { email: adminEmail, password: adminPassword });
    await page.goto('/admin/settings/broker-deals');

    await expect(page.getByText(/Credit Auto-Release/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Buffer days/i)).toBeVisible({ timeout: 15_000 });
  });

  test('commission report page loads', async ({ page }) => {
    await loginViaUi(page, { email: adminEmail, password: adminPassword });
    await page.goto('/reports/broker-commission');
    await expect(page).toHaveURL(/\/reports\/broker-commission/);

    await expect(page.locator('input[type="date"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('input[type="date"]').nth(1)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Generate Report/i })).toBeVisible({ timeout: 15_000 });
  });

  test('commission report generate with date range', async ({ page }) => {
    await loginViaUi(page, { email: adminEmail, password: adminPassword });
    await page.goto('/reports/broker-commission');

    await page.locator('input[type="date"]').first().fill('2026-01-01');
    await page.locator('input[type="date"]').nth(1).fill('2026-01-31');
    await page.getByRole('button', { name: /Generate Report/i }).click();
    await page.waitForTimeout(3000);

    // Page should not crash — verify URL is still on the report page
    expect(page.url()).toContain('/reports/broker-commission');
  });

  test('commission report page has export links after generation', async ({ page }) => {
    await loginViaUi(page, { email: adminEmail, password: adminPassword });
    await page.goto('/reports/broker-commission');

    await page.locator('input[type="date"]').first().fill('2026-01-01');
    await page.locator('input[type="date"]').nth(1).fill('2026-01-31');
    await page.getByRole('button', { name: /Generate Report/i }).click();
    await page.waitForTimeout(3000);

    // Assert CSV and XLSX export links are present after report generation
    await expect(page.getByRole('link', { name: 'CSV' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: 'XLSX' })).toBeVisible({ timeout: 10_000 });
  });

  test('credit line creation form shows broker credit line option', async ({ page }) => {
    await loginViaUi(page, { email: adminEmail, password: adminPassword });
    // Force BrokerDealService to load
    await page.goto('/trading/broker-deals');
    await page.waitForTimeout(3000);

    // Navigate to credit suppliers page
    await page.goto('/credit/suppliers');
    await page.waitForTimeout(2000);

    // The page should load — verify we're on the credit suppliers page
    // Look for a heading or content related to credit lines
    const pageContent = await page.textContent('body');
    expect(pageContent).toBeTruthy();

    // Assert the create button exists and click it
    const createBtn = page.getByRole('button', { name: /Add|Create|New Credit Line/i }).first();
    await expect(createBtn).toBeVisible({ timeout: 10_000 });
    await createBtn.click();
    await page.waitForTimeout(1000);

    // When broker deals are enabled, a "Broker Credit Line" option should appear
    await expect(page.getByText(/Broker Credit/i).first()).toBeVisible({ timeout: 10_000 });
  });
});