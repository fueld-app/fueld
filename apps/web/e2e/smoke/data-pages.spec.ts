/**
 * Smoke tests for data pages that have zero E2E coverage:
 * Vessels, Places, and Analytics.
 */
import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';

const { env } = process;

const traderEmail = env['E2E_TRADER6_USER_EMAIL'] ?? 'trader6@fueld.local';
const traderPassword = env['E2E_TRADER6_USER_PASSWORD'] ?? 'trader6password123';

test.describe('Vessels page', () => {
  test('vessels list page loads and shows search', async ({ page }) => {
    await loginViaUi(page, { email: traderEmail, password: traderPassword });

    await page.goto('/vessels');
    await expect(page.getByRole('heading', { name: 'Vessels' })).toBeVisible({ timeout: 15_000 });

    // Search input should be present
    const search = page.getByPlaceholder(/search vessels/i);
    await expect(search).toBeVisible();
  });

  test('vessel search shows results for seeded vessel', async ({ page }) => {
    test.setTimeout(60_000);

    await loginViaUi(page, { email: traderEmail, password: traderPassword });

    await page.goto('/vessels');
    await expect(page.getByRole('heading', { name: 'Vessels' })).toBeVisible({ timeout: 15_000 });

    const search = page.getByPlaceholder(/search vessels/i);
    await search.fill('E2E Vessel');

    // Wait for results to appear (either in typeahead or a table)
    const result = page.locator('[class*="cursor-pointer"], table tbody tr').filter({ hasText: /E2E Vessel/i }).first();
    await expect(result).toBeVisible({ timeout: 10_000 });
  });

  test('vessel detail page loads for seeded vessel', async ({ page }) => {
    test.setTimeout(60_000);

    await loginViaUi(page, { email: traderEmail, password: traderPassword });

    // Find the seeded vessel via API
    const token = await page.evaluate(() => localStorage.getItem('fueld_access_token'));
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    const res = await page.request.get('http://localhost:3000/vessels/local?limit=1', { headers });
    expect(res.ok()).toBe(true);
    const json = await res.json();
    const vesselId = json?.data?.items?.[0]?.id ?? json?.data?.[0]?.id;

    if (vesselId) {
      await page.goto(`/vessels/${vesselId}`);
      await page.waitForURL(/\/vessels\/[a-f0-9-]+/, { timeout: 15_000 });

      // Should show vessel name
      const heading = page.locator('h1, h2').first();
      await expect(heading).toBeVisible({ timeout: 10_000 });
    }
  });
});

test.describe('Places page', () => {
  test('places list page loads and shows search', async ({ page }) => {
    await loginViaUi(page, { email: traderEmail, password: traderPassword });

    await page.goto('/places');
    await expect(page.getByRole('heading', { name: 'Places' })).toBeVisible({ timeout: 15_000 });

    // Search input should be present
    const search = page.getByPlaceholder(/search places/i);
    await expect(search).toBeVisible();
  });

  test('place search shows results for seeded port', async ({ page }) => {
    test.setTimeout(60_000);

    await loginViaUi(page, { email: traderEmail, password: traderPassword });

    await page.goto('/places');
    await expect(page.getByRole('heading', { name: 'Places' })).toBeVisible({ timeout: 15_000 });

    const search = page.getByPlaceholder(/search places/i);
    await search.fill('E2E Port');

    // Wait for results
    const result = page.locator('[class*="cursor-pointer"], table tbody tr').filter({ hasText: /E2E Port/i }).first();
    await expect(result).toBeVisible({ timeout: 10_000 });
  });

  test('place detail page loads for seeded place', async ({ page }) => {
    test.setTimeout(60_000);

    await loginViaUi(page, { email: traderEmail, password: traderPassword });

    // Find the seeded place via API
    const token = await page.evaluate(() => localStorage.getItem('fueld_access_token'));
    const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    const res = await page.request.get('http://localhost:3000/lloyds/places/local?limit=1', { headers });
    expect(res.ok()).toBe(true);
    const json = await res.json();
    const placeId = json?.data?.items?.[0]?.id ?? json?.data?.[0]?.id;

    if (placeId) {
      await page.goto(`/places/${placeId}`);
      await page.waitForURL(/\/places\/[a-f0-9-]+/, { timeout: 15_000 });

      const heading = page.locator('h1, h2').first();
      await expect(heading).toBeVisible({ timeout: 10_000 });
    }
  });
});

test.describe('Analytics page', () => {
  test('analytics page loads with heading', async ({ page }) => {
    await loginViaUi(page, { email: traderEmail, password: traderPassword });

    await page.goto('/analytics');
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/analytics/);
  });

  test('analytics page shows chart sections', async ({ page }) => {
    await loginViaUi(page, { email: traderEmail, password: traderPassword });

    await page.goto('/analytics');
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible({ timeout: 15_000 });

    // Should show chart sections (Sales Funnel, Loss Analysis, etc.)
    // Even if empty, the card containers should render
    const panels = page.locator('.app-panel, [class*="rounded-xl"][class*="border"], [class*="rounded-lg"][class*="border"]');
    await expect(panels.first()).toBeVisible({ timeout: 10_000 });
  });
});
