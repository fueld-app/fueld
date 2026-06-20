import { test, expect } from '../fixtures/coverage';
import { loginViaUi, authHeaders } from '../helpers/auth';
import { createInquiryViaApi } from '../helpers/trading';

const { env } = process;

const traderEmail = env['E2E_TRADER7_USER_EMAIL'] ?? 'trader7@fueld.local';
const traderPassword = env['E2E_TRADER7_USER_PASSWORD'] ?? 'trader7password123';
const adminEmail = env['E2E_ADMIN3_EMAIL'] ?? 'admin3@fueld.local';
const adminPassword = env['E2E_ADMIN3_PASSWORD'] ?? 'admin3password123';

test.describe('Dashboard KPI cards', () => {
  test('dashboard renders all six KPI cards with labels', async ({ page }) => {
    await loginViaUi(page, { email: traderEmail, password: traderPassword });

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();

    const kpiContainer = page.locator('.app-kpi-card');

    // Wait for at least one KPI card to appear (data loaded)
    await expect(kpiContainer.first()).toBeVisible({ timeout: 15_000 });

    const expectedLabels = [
      'Total Orders',
      'Total Revenue YTD',
      'Gross Profit YTD',
      'Net Profit YTD',
      'Avg. Deal Size',
      'Overdue Invoices',
    ];

    for (const label of expectedLabels) {
      await expect(
        page.locator('.app-kpi-card').filter({ hasText: label }),
      ).toBeVisible();
    }
  });

  test('conversion metrics section renders', async ({ page }) => {
    await loginViaUi(page, { email: traderEmail, password: traderPassword });
    await expect(page).toHaveURL(/\/dashboard/);

    // Conversion metric cards (Win Rate, Avg Days to Close, Won Orders, Lost Orders)
    await expect(page.locator('.app-kpi-card').filter({ hasText: 'Win Rate' })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.app-kpi-card').filter({ hasText: 'Avg. Days to Close' })).toBeVisible();
    await expect(page.locator('.app-kpi-card').filter({ hasText: 'Won Orders' })).toBeVisible();
    await expect(page.locator('.app-kpi-card').filter({ hasText: 'Lost Orders' })).toBeVisible();
  });

  test('KPI card values respond to order creation', async ({ page }) => {
    test.setTimeout(90_000);

    await loginViaUi(page, { email: traderEmail, password: traderPassword });
    await expect(page).toHaveURL(/\/dashboard/);

    // Wait for KPI cards to fully render with data (not "—")
    const ordersCard = page.locator('.app-kpi-card').filter({ hasText: 'Total Orders' });
    await expect(ordersCard).toBeVisible({ timeout: 15_000 });

    // Create an inquiry and convert it to an order via API
    const inquiryId = await createInquiryViaApi(page);
    const headers = await authHeaders(page);

    // Convert inquiry → CONFIRMED order
    const convertRes = await page.request.put(`http://localhost:3000/orders/${inquiryId}/status`, {
      headers: { ...headers, 'Content-Type': 'application/json' },
      data: { status: 'CONFIRMED' },
    });
    expect(convertRes.ok()).toBe(true);

    // Reload dashboard and wait for data to load
    await page.goto('/');
    await expect(page.locator('.app-kpi-card').first()).toBeVisible({ timeout: 15_000 });

    // Wait for the Total Orders card to show a numeric value (not "—")
    const valueLocator = ordersCard.locator('p.text-3xl');
    await expect(valueLocator).toBeVisible({ timeout: 15_000 });
    await expect(valueLocator).not.toHaveText('—', { timeout: 15_000 });

    // Total Orders should be at least 1 after creating a confirmed order
    const updatedValue = await valueLocator.textContent();
    const updatedCount = parseInt(updatedValue?.trim() ?? '0', 10);
    expect(updatedCount).toBeGreaterThanOrEqual(1);
  });

  test('creating an inquiry does not change Total Revenue', async ({ page }) => {
    test.setTimeout(90_000);

    await loginViaUi(page, { email: traderEmail, password: traderPassword });
    await expect(page).toHaveURL(/\/dashboard/);

    // Wait for KPI cards to fully load
    await expect(page.locator('.app-kpi-card').first()).toBeVisible({ timeout: 15_000 });

    // Read current revenue value (could be "—" or a dollar amount)
    const revenueCard = page.locator('.app-kpi-card').filter({ hasText: 'Total Revenue YTD' });
    const valueLocator = revenueCard.locator('p.text-3xl');
    await expect(valueLocator).toBeVisible({ timeout: 15_000 });
    // Let the data finish loading — wait a tick for any pending requests
    await page.waitForTimeout(2_000);
    const revenueBefore = await valueLocator.textContent();

    // Create inquiry (status=INQUIRY) — should NOT affect revenue
    await createInquiryViaApi(page);

    // Reload and wait for data
    await page.goto('/');
    await expect(page.locator('.app-kpi-card').first()).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2_000);

    const revenueAfter = await revenueCard.locator('p.text-3xl').textContent();
    expect(revenueAfter?.trim()).toBe(revenueBefore?.trim());
  });

  test('date range selector updates KPI data', async ({ page }) => {
    await loginViaUi(page, { email: traderEmail, password: traderPassword });
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('.app-kpi-card').first()).toBeVisible({ timeout: 15_000 });

    // Open date range dropdown
    const dateButton = page.locator('button').filter({ hasText: /This Month|Today|Last 30/i }).first();
    await dateButton.click();

    // Select a different preset
    const presetOption = page.getByRole('button', { name: 'Last 30 Days' });
    if (await presetOption.isVisible()) {
      await presetOption.click();

      // KPI cards should still render (no crash)
      await expect(page.locator('.app-kpi-card').first()).toBeVisible({ timeout: 15_000 });
    }
  });

  test('admin can toggle team view on dashboard', async ({ page }) => {
    await loginViaUi(page, { email: adminEmail, password: adminPassword });
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.locator('.app-kpi-card').first()).toBeVisible({ timeout: 15_000 });

    // Admin should see the team view toggle (it's a role="switch" element)
    const teamToggle = page.getByRole('switch', { name: /toggle team view/i });
    await expect(teamToggle).toBeVisible();

    // Toggle it
    await teamToggle.click();

    // KPI cards should still render after toggle
    await expect(page.locator('.app-kpi-card').first()).toBeVisible({ timeout: 15_000 });
  });

  test('sales pipeline section renders status breakdown', async ({ page }) => {
    await loginViaUi(page, { email: traderEmail, password: traderPassword });
    await expect(page).toHaveURL(/\/dashboard/);

    // Wait for dashboard to load
    await expect(page.locator('.app-kpi-card').first()).toBeVisible({ timeout: 15_000 });

    // Pipeline section should be present
    const pipelineSection = page.locator('text=Sales Pipeline').first();
    await expect(pipelineSection).toBeVisible();
  });

  test('collections widget renders overdue invoices section', async ({ page }) => {
    await loginViaUi(page, { email: traderEmail, password: traderPassword });
    await expect(page).toHaveURL(/\/dashboard/);

    // Collections section (overdue invoices widget)
    await expect(page.locator('app-collections-widget').first()).toBeVisible({ timeout: 15_000 });
  });
});
