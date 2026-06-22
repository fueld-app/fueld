import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';

test('trader cannot access credit routes', async ({ page }) => {
  await loginViaUi(page, {
    email: process.env['E2E_TRADER6_USER_EMAIL'] ?? 'trader6@fueld.local',
    password: process.env['E2E_TRADER6_USER_PASSWORD'] ?? 'trader6password123',
  });

  await page.goto('/credit/suppliers');
  // The credit guard kicks unauthorized traders out of /credit/*. The redirect
  // may chain (root → role dashboard), so assert the URL leaves /credit rather
  // than asserting a specific intermediate destination, which races across
  // browsers (firefox resolves the full chain before the assertion polls).
  await expect(page).not.toHaveURL(/\/credit/);
});

test('credit manager can access credit routes', async ({ page }) => {
  await loginViaUi(page, {
    email: process.env['E2E_CREDIT_USER_EMAIL'] ?? 'credit@fueld.local',
    password: process.env['E2E_CREDIT_USER_PASSWORD'] ?? 'creditpassword123',
  });

  await page.goto('/credit/suppliers');
  await expect(page).toHaveURL(/\/credit\/suppliers$/);
  await expect(page.getByRole('heading', { name: 'Supplier Credit' })).toBeVisible();

  await page.goto('/credit/customers');
  await expect(page).toHaveURL(/\/credit\/customers$/);
  await expect(page.getByRole('heading', { name: 'Customer Credit' })).toBeVisible();
});
