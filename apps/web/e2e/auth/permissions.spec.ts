import { test, expect } from '@playwright/test';
import { loginViaUi } from '../helpers/auth';

test('trader cannot access admin routes', async ({ page }) => {
  await loginViaUi(page, {
    email: process.env['E2E_LIMITED_USER_EMAIL'] ?? 'limited@fueld.local',
    password: process.env['E2E_LIMITED_USER_PASSWORD'] ?? 'limitedpassword123',
  });

  await page.goto('/admin/users');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: /dashboard/i })).toBeVisible();
});
