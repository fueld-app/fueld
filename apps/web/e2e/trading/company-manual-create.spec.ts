import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';

test('create company manually from companies page', async ({ page }) => {
  test.setTimeout(90_000);

  await loginViaUi(page, {
    email: process.env['E2E_TRADER4_USER_EMAIL'] ?? 'trader4@fueld.local',
    password: process.env['E2E_TRADER4_USER_PASSWORD'] ?? 'trader4password123',
  });

  await page.goto('/companies');
  await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();

  const companyName = `PW Manual Company ${Date.now()}`;
  const searchInput = page.getByPlaceholder('Search companies to import or create (min. 2 characters)…');
  await searchInput.fill(companyName);

  await page.getByRole('button', { name: `Create "${companyName}" manually` }).click();
  await expect(page.getByRole('heading', { name: 'Create Company' })).toBeVisible();

  await page.getByLabel('Client').uncheck();
  await page.getByLabel('Supplier').check();

  await page.getByRole('button', { name: 'Create Company' }).click();

  await page.waitForURL(/\/companies\/[a-f0-9-]+/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: companyName })).toBeVisible();
});
