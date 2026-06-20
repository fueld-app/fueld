import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';

const { env } = process;

// A seeded, non-2FA user (loginViaUi rejects users that require 2FA).
const traderEmail = env['E2E_TRADER5_USER_EMAIL'] ?? 'trader5@fueld.local';
const traderPassword = env['E2E_TRADER5_USER_PASSWORD'] ?? 'trader5password123';

/**
 * Wait for the post-login redirect to settle. After login the app lands on the
 * '' route, whose DashboardRedirectComponent navigates (replaceUrl) to the
 * role dashboard (e.g. /dashboard). Waiting for the URL to leave "/" avoids
 * racing an in-page fetch with that navigation.
 */
async function waitForDashboardRedirect(page: import('@playwright/test').Page): Promise<void> {
  await page
    .waitForURL((url) => url.pathname !== '/' && !url.pathname.startsWith('/login'), { timeout: 5000 })
    .catch(() => {});
}

test.describe('Cookie-based auth + CSRF', () => {
  test('login sets HttpOnly access/refresh cookies + a JS-readable CSRF cookie', async ({ page }) => {
    await loginViaUi(page, { email: traderEmail, password: traderPassword });

    const cookies = await page.context().cookies();
    const access = cookies.find((c) => c.name === 'fueld_access');
    const refresh = cookies.find((c) => c.name === 'fueld_refresh');
    const csrf = cookies.find((c) => c.name === 'fueld_csrf');

    // Access token: HttpOnly (not readable by JS), SameSite=Lax, scoped to /.
    expect(access, 'fueld_access cookie should be set').toBeDefined();
    expect(access?.httpOnly).toBe(true);
    expect(access?.sameSite).toBe('Lax');
    expect(access?.path).toBe('/');

    // Refresh token: HttpOnly + path-scoped to the refresh endpoint.
    expect(refresh, 'fueld_refresh cookie should be set').toBeDefined();
    expect(refresh?.httpOnly).toBe(true);
    expect(refresh?.path).toBe('/api/auth/refresh');

    // CSRF token: NOT HttpOnly (JS must read it to send X-CSRF-Token), scoped to /.
    expect(csrf, 'fueld_csrf cookie should be set').toBeDefined();
    expect(csrf?.httpOnly).toBe(false);
    expect(csrf?.path).toBe('/');
  });

  test('refresh with an empty body + cookie + CSRF token → 200 (rotates tokens)', async ({ page }) => {
    // Regression test for the cookie migration: the browser sends an empty body
    // and relies on the fueld_refresh cookie. If /auth/refresh still required
    // body.refreshToken, this would 422 and the test would fail.
    //
    // Uses an in-page fetch (credentials: 'include') so the browser sends the
    // HttpOnly cookies and handles the rotated Set-Cookie natively — avoiding a
    // Playwright cookie-jar race that `page.request` hits on cookie-rotating 200s.
    await loginViaUi(page, { email: traderEmail, password: traderPassword });
    await waitForDashboardRedirect(page);

    const result = await page.evaluate(async () => {
      const m = document.cookie.match(/(?:^|;\s*)fueld_csrf=([^;]+)/);
      const csrf = m ? decodeURIComponent(m[1]) : '';
      const r = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        credentials: 'include',
        body: '{}',
      });
      return { status: r.status, ok: r.ok, body: await r.json().catch(() => null) };
    });

    expect(result.ok, `refresh failed: HTTP ${result.status}`).toBe(true);
    expect(result.body?.success).toBe(true);
  });

  test('refresh with an empty body + cookie but NO CSRF token → 403', async ({ page }) => {
    await loginViaUi(page, { email: traderEmail, password: traderPassword });
    await waitForDashboardRedirect(page);

    const result = await page.evaluate(async () => {
      const r = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: '{}',
      });
      return r.status;
    });

    expect(result).toBe(403);
  });
});