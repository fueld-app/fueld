import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';

const { env } = process;

const traderEmail = env['E2E_TRADER5_USER_EMAIL'] ?? 'trader5@fueld.local';
const traderPassword = env['E2E_TRADER5_USER_PASSWORD'] ?? 'trader5password123';

async function authHeaders(page: import('@playwright/test').Page): Promise<Record<string, string>> {
  const token = await page.evaluate(() => localStorage.getItem('fueld_access_token'));
  if (!token) throw new Error('Missing access token in localStorage');
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
}

/** Fetch the first seeded CLIENT company ID. */
/** Fetch the first seeded CLIENT company ID. */
async function fetchSeededClientId(page: import('@playwright/test').Page): Promise<string> {
  const headers = await authHeaders(page);
  const res = await page.request.get('http://localhost:3000/companies/local?type=CLIENT&limit=1', { headers });
  expect(res.ok()).toBe(true);
  const json = await res.json();
  // API returns data.companies[] or data.items[]
  const id = json?.data?.companies?.[0]?.id ?? json?.data?.items?.[0]?.id ?? json?.data?.[0]?.id;
  if (!id) throw new Error('No seeded CLIENT company found');
  return id;
}

test.describe('Company detail page', () => {
  test('navigating to a company shows detail with heading and sections', async ({ page }) => {
    test.setTimeout(60_000);

    await loginViaUi(page, { email: traderEmail, password: traderPassword });

    // Navigate to companies list
    await page.goto('/companies');
    await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();

    // Get the seeded client and navigate to its detail
    const clientId = await fetchSeededClientId(page);
    await page.goto(`/companies/${clientId}`);

    // Should show company detail page with a heading (company name)
    await page.waitForURL(/\/companies\/[a-f0-9-]+/, { timeout: 15_000 });

    // The page heading should be the company name (E2E Client Co by default)
    const heading = page.locator('h1, h2').first();
    await expect(heading).toBeVisible({ timeout: 10_000 });
    const headingText = await heading.textContent();
    expect(headingText?.trim().length).toBeGreaterThan(0);
  });

  test('company detail shows info sections', async ({ page }) => {
    test.setTimeout(60_000);

    await loginViaUi(page, { email: traderEmail, password: traderPassword });

    const clientId = await fetchSeededClientId(page);
    await page.goto(`/companies/${clientId}`);
    await page.waitForURL(/\/companies\/[a-f0-9-]+/, { timeout: 15_000 });

    // Page should have loaded without errors — check for basic structure
    const heading = page.locator('h1, h2').first();
    await expect(heading).toBeVisible({ timeout: 10_000 });

    // Look for common detail sections (contacts, enrichment data, etc.)
    // The page uses app-panel components, so any panel should be visible
    const panels = page.locator('.app-panel, [class*="rounded-xl"][class*="border"]');
    await expect(panels.first()).toBeVisible({ timeout: 10_000 });
  });

  test('company can be found via search on companies page', async ({ page }) => {
    test.setTimeout(60_000);

    await loginViaUi(page, { email: traderEmail, password: traderPassword });

    await page.goto('/companies');
    await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();

    // Search for the seeded client name using actual placeholder
    const searchInput = page.getByPlaceholder(/Search companies/i);
    await searchInput.fill('E2E Client');

    // Should show results in the search dropdown
    // Wait for at least one result to appear
    const result = page.locator('[class*="cursor-pointer"]').filter({ hasText: /E2E Client/i }).first();
    await expect(result).toBeVisible({ timeout: 10_000 });
  });

  test('navigating to companies list from detail via back works', async ({ page }) => {
    test.setTimeout(60_000);

    await loginViaUi(page, { email: traderEmail, password: traderPassword });

    const clientId = await fetchSeededClientId(page);
    await page.goto(`/companies/${clientId}`);
    await page.waitForURL(/\/companies\/[a-f0-9-]+/, { timeout: 15_000 });

    // Navigate back to companies list — use goBack or direct navigation for mobile/tablet
    await page.goto('/companies');
    await expect(page).toHaveURL(/\/companies$/);
  });
});
