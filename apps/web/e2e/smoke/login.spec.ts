import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';

const email = process.env['E2E_TRADER4_USER_EMAIL'] ?? 'trader4@fueld.local';
const password = process.env['E2E_TRADER4_USER_PASSWORD'] ?? 'trader4password123';

test('login redirects to dashboard', async ({ page }) => {
  await loginViaUi(page, { email, password });

  // Dashboard is the default route after login (the app redirects / -> /dashboard).
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});
