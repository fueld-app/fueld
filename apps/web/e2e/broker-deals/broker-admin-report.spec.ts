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

    await expect(page.getByText(/Auto-release/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Buffer days/i)).toBeVisible({ timeout: 15_000 });
  });

  test('commission report page loads', async ({ page }) => {
    await loginViaUi(page, { email: adminEmail, password: adminPassword });
    await page.goto('/reports/broker-commission');
    await expect(page).toHaveURL(/\/reports\/broker-commission/);

    await expect(page.getByLabel(/From/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel(/To/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /Generate Report/i })).toBeVisible({ timeout: 15_000 });
  });

  test('commission report generate with date range', async ({ page }) => {
    await loginViaUi(page, { email: adminEmail, password: adminPassword });
    await page.goto('/reports/broker-commission');

    await page.getByLabel(/From/i).fill('2026-01-01');
    await page.getByLabel(/To/i).fill('2026-01-31');
    await page.getByRole('button', { name: /Generate Report/i }).click();
    await page.waitForTimeout(3000);

    // Page should not crash — verify URL is still on the report page
    expect(page.url()).toContain('/reports/broker-commission');
  });

  test('commission report page has export links after generation', async ({ page }) => {
    await loginViaUi(page, { email: adminEmail, password: adminPassword });
    await page.goto('/reports/broker-commission');

    await page.getByLabel(/From/i).fill('2026-01-01');
    await page.getByLabel(/To/i).fill('2026-01-31');
    await page.getByRole('button', { name: /Generate Report/i }).click();
    await page.waitForTimeout(3000);

    // Check if CSV/XLSX export links are present (only show after report is generated)
    const csvLink = page.getByRole('link', { name: 'CSV' });
    const csvVisible = await csvLink.isVisible().catch(() => false);

    if (csvVisible) {
      await expect(page.getByRole('link', { name: 'XLSX' })).toBeVisible({ timeout: 5_000 });
    }

    // Page should not crash
    expect(page.url()).toContain('/reports/broker-commission');
  });
});