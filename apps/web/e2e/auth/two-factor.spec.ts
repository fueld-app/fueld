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

test('passkey login no longer requires email — calls API without email for discoverable flow', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  // Intercept the passkey auth-options call to verify it sends no email
  const authOptionsPromise = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/auth/passkeys/auth-options'),
  );

  // Click Passkey without entering an email — should NOT show the old email error
  await page.getByRole('button', { name: 'Passkey' }).click();

  // The old-style "Please enter your email" alert should NOT appear
  const alert = page.getByRole('alert');
  const alertCount = await alert.count();
  if (alertCount > 0) {
    const alertText = await alert.textContent();
    expect(alertText).not.toContain('Please enter your email');
  }

  // The API call should have been made without an email in the body
  const authOptionsResp = await authOptionsPromise;
  const requestBody = JSON.parse(authOptionsResp.request().postData() || '{}');
  expect(requestBody).not.toHaveProperty('email');

  // A WebAuthn-related error should appear (no virtual authenticator in headless mode),
  // confirming the browser actually attempted the WebAuthn flow
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 5_000 });
  const finalAlertText = await page.getByRole('alert').textContent();
  expect(finalAlertText).not.toContain('Please enter your email');
});

test('passkey login with email still narrows the request', async ({ page }) => {
  const email = process.env['E2E_2FA_USER_EMAIL'] ?? 'twofa@fueld.local';

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  // Fill in an email
  await page.locator('#email').fill(email);

  // Intercept the passkey auth-options call to verify email is sent
  const authOptionsPromise = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/auth/passkeys/auth-options'),
  );

  await page.getByRole('button', { name: 'Passkey' }).click();

  const authOptionsResp = await authOptionsPromise;
  const requestBody = JSON.parse(authOptionsResp.request().postData() || '{}');
  expect(requestBody).toMatchObject({ email });
});