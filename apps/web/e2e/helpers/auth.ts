import { expect, type Page } from '@playwright/test';

export async function loginViaUi(page: Page, params: { email: string; password: string }): Promise<void> {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  await page.locator('#email').fill(params.email);
  await page.locator('#password').fill(params.password);

  const alert = page.getByRole('alert');
  const loginResponsePromise = page
    .waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().includes('/auth/login'),
      { timeout: 15_000 },
    )
    .catch(() => null);

  await page.getByRole('button', { name: 'Sign in' }).click();

  // Either we navigate away from /login, or the UI shows an error alert.
  const navPromise = page.waitForURL(
    (url) => {
      const path = url.pathname;
      return path === '/login/2fa' || path === '/account/security' || !path.startsWith('/login');
    },
    { timeout: 15_000, waitUntil: 'domcontentloaded' },
  );

  const outcome = await Promise.race([
    navPromise.then(() => 'nav' as const),
    alert.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'alert' as const),
  ]);

  if (outcome === 'alert') {
    const message = (await alert.textContent())?.trim() || 'Login failed (unknown error).';
    const resp = await loginResponsePromise;

    if (resp) {
      const status = resp.status();
      const body = await resp.text().catch(() => '');
      throw new Error(`Login failed: ${message} (POST /auth/login → ${status})${body ? `\n${body}` : ''}`);
    }

    throw new Error(`Login failed: ${message} (no /auth/login response; is the API reachable?)`);
  }

  if (page.url().includes('/login/2fa')) {
    throw new Error('Login requires 2FA; seed a non-2FA user for Playwright or extend the test to handle 2FA.');
  }

  // Assert we actually left the login page (guards against silent failures).
  await expect(page).not.toHaveURL(/\/login(\?.*)?$/);
}
