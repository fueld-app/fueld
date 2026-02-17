import { test, expect } from '@playwright/test';
import { loginViaUi } from '../helpers/auth';

const email = process.env['E2E_USER_EMAIL'] ?? 'e2e@fueld.local';
const password = process.env['E2E_USER_PASSWORD'] ?? 'password123';

test('orders list page loads', async ({ page }) => {
  await loginViaUi(page, { email, password });

  await page.goto('/trading/orders');
  await expect(page).toHaveURL(/\/trading\/orders/);
  await expect(page.getByRole('heading', { name: /Orders/i })).toBeVisible();
});
