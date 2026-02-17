import { test, expect } from '@playwright/test';
import { loginViaUi } from '../helpers/auth';

const email = process.env['E2E_USER_EMAIL'] ?? 'e2e@fueld.local';
const password = process.env['E2E_USER_PASSWORD'] ?? 'password123';

test('login redirects to dashboard', async ({ page }) => {
  await loginViaUi(page, { email, password });

  // Dashboard is the default route after login.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});
