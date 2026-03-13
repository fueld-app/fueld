import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';

const email = process.env['E2E_TRADER5_USER_EMAIL'] ?? 'trader5@fueld.local';
const password = process.env['E2E_TRADER5_USER_PASSWORD'] ?? 'trader5password123';

test.describe('responsive layout', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUi(page, { email, password });
  });

  test('orders list page renders without horizontal overflow', async ({ page }) => {
    await page.goto('/trading/orders');
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test('inquiries list page renders without horizontal overflow', async ({ page }) => {
    await page.goto('/trading/inquiries');
    await expect(page.getByRole('heading', { name: 'Inquiries' })).toBeVisible();

    const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });

  test('login page is accessible at all viewports', async ({ page, context }) => {
    // Open a fresh page (not logged in) to test the login form
    const freshPage = await context.newPage();
    await freshPage.goto('/login');
    await expect(freshPage.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

    // Verify form fields are visible and not offscreen
    const emailInput = freshPage.locator('#email');
    const passwordInput = freshPage.locator('#password');
    const signInBtn = freshPage.getByRole('button', { name: 'Sign in' });

    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();
    await expect(signInBtn).toBeVisible();

    // All should be within the viewport
    const vpWidth = await freshPage.evaluate(() => window.innerWidth);
    for (const el of [emailInput, passwordInput, signInBtn]) {
      const box = await el.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(vpWidth + 2);
    }

    await freshPage.close();
  });
});
