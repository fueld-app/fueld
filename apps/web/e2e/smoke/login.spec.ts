import { test, expect } from '@playwright/test';
import { loginViaUi } from '../helpers/auth';

const email = process.env['E2E_USER_EMAIL'] ?? 'e2e@fueld.local';
const password = process.env['E2E_USER_PASSWORD'] ?? 'password123';

test('login redirects to dashboard', async ({ page }) => {
  await loginViaUi(page, { email, password });

  // Any authenticated route is fine; dashboard is the default.
  await expect(page).toHaveURL(/\/$|\/analytics|\/trading\//);
  await expect(page.getByText(/Dashboard|Analytics|Trading/i)).toBeVisible();
});
