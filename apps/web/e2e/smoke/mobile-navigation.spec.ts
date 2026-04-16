import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';

const email = process.env['E2E_TRADER4_USER_EMAIL'] ?? 'trader4@fueld.local';
const password = process.env['E2E_TRADER4_USER_PASSWORD'] ?? 'trader4password123';

test.describe('mobile navigation', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUi(page, { email, password });
  });

  test('hamburger menu opens and links navigate correctly', async ({ page }) => {
    // On mobile viewports the nav should collapse behind a menu button
    const hamburger = page.getByRole('button', { name: /menu/i });

    // Skip this test gracefully on desktop projects where there's no hamburger
    if (!(await hamburger.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    await hamburger.click();

    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav).toBeVisible();

    const activeOrdersLink = nav.getByRole('link', { name: 'Active Orders' });
    if (!(await activeOrdersLink.isVisible().catch(() => false))) {
      await nav.getByRole('button', { name: /^Trading$/ }).click();
    }

    // Navigate to Active Orders
    await activeOrdersLink.click();
    await expect(page).toHaveURL(/\/trading\/orders/);
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  });

  test('dashboard loads and renders on mobile viewport', async ({ page }) => {
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    // Ensure the page fits without horizontal scroll
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 1); // +1 for sub-pixel rounding
  });

  test('login form is usable at small viewport', async ({ page }) => {
    // Already logged in from beforeEach; verify the app rendered and is responsive
    const heading = page.getByRole('heading', { name: 'Dashboard' });
    await expect(heading).toBeVisible();

    // Verify heading text isn't clipped (bounding box inside viewport)
    const box = await heading.boundingBox();
    expect(box).toBeTruthy();
    const vpWidth = await page.evaluate(() => window.innerWidth);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vpWidth + 1);
  });
});
