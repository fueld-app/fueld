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

  // Wait for the authenticated app shell to render.
  // This avoids flakiness where follow-up navigation happens before auth state is applied.
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });
}

/**
 * Headers for cookie-authenticated e2e API calls. Access/refresh tokens live in
 * HttpOnly cookies (sent automatically by Playwright's `page.request` for the
 * same-site API), so only the CSRF token must be attached: read it from the
 * JS-readable fueld_csrf cookie and echo it back as X-CSRF-Token (the server
 * validates this against the fueld_csrf cookie it receives automatically).
 */
export async function authHeaders(page: Page): Promise<Record<string, string>> {
  const csrf = await page.evaluate(() => {
    const m = document.cookie.match(/(?:^|;\s*)fueld_csrf=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  });
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (csrf) headers['X-CSRF-Token'] = csrf;
  return headers;
}
