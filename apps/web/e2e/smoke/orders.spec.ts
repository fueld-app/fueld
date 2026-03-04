import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';

const email = process.env['E2E_TRADER5_USER_EMAIL'] ?? 'trader5@fueld.local';
const password = process.env['E2E_TRADER5_USER_PASSWORD'] ?? 'trader5password123';

test('orders list page loads', async ({ page }) => {
  await loginViaUi(page, { email, password });

  await page.goto('/trading/orders');
  await expect(page).toHaveURL(/\/trading\/orders/);
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
});
