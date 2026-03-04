import { test, expect } from '../fixtures/coverage';

test('2FA-enabled user is redirected to /login/2fa', async ({ page }) => {
  const email = process.env['E2E_2FA_USER_EMAIL'] ?? 'twofa@fueld.local';
  const password = process.env['E2E_2FA_USER_PASSWORD'] ?? 'twofapassword123';

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);

  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/login\/2fa$/);
  await expect(page.getByRole('heading', { name: 'Two-Factor Verification' })).toBeVisible();
  await expect(page.locator('#totp-code')).toBeVisible();
});

test('passkey login requires email', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Passkey' }).click();
  await expect(page.getByRole('alert')).toContainText('Please enter your email');
});
