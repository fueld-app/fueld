import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';

test('limited user can access trading but is blocked from credit and admin routes', async ({ page }) => {
  await loginViaUi(page, {
    email: process.env['E2E_LIMITED_USER_EMAIL'] ?? 'limited@fueld.local',
    password: process.env['E2E_LIMITED_USER_PASSWORD'] ?? 'limitedpassword123',
  });

  await page.goto('/trading/orders');
  await expect(page).toHaveURL(/\/trading\/orders$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Active Orders' })).toBeVisible();

  await page.goto('/credit/suppliers');
  await expect(page).toHaveURL(/\/dashboard/);

  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
});
