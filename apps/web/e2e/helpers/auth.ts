import { expect, type Page } from '@playwright/test';

export async function loginViaUi(page: Page, params: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  await page.locator('#email').fill(params.email);
  await page.locator('#password').fill(params.password);

  await page.getByRole('button', { name: 'Sign in' }).click();

  // Wait until we're out of /login (or land on /login/2fa).
  await page.waitForURL(/\/(login\/2fa|$|analytics|trading)/, { timeout: 15_000 });

  if (page.url().includes('/login/2fa')) {
    throw new Error('Login requires 2FA; seed a non-2FA user for Playwright or extend the test to handle 2FA.');
  }

  // Assert we actually left the login page (guards against clicking too early).
  await expect(page).not.toHaveURL(/\/login(\?.*)?$/);
}
