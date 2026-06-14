import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';

test.describe.configure({ mode: 'serial' });

async function expectStatusesForRoute(
  page: import('@playwright/test').Page,
  route: string,
  expectedStatuses: string,
): Promise<void> {
  const responsePromise = page.waitForResponse((res) => {
    if (res.request().method() !== 'GET') return false;
    try {
      const url = new URL(res.url());
      if (!url.pathname.endsWith('/orders')) return false;
      const params = new URLSearchParams(url.search);
      return params.get('statuses') === expectedStatuses;
    } catch {
      return false;
    }
  }, { timeout: 15_000 });

  await page.goto(route);
  await responsePromise;
}

test('order list routes show Active, Completed and Cancelled views', async ({ page }) => {
  await loginViaUi(page, {
    email: process.env['E2E_TRADER5_USER_EMAIL'] ?? 'trader5@fueld.local',
    password: process.env['E2E_TRADER5_USER_PASSWORD'] ?? 'trader5password123',
  });

  await page.goto('/trading/orders');
  await expect(page.getByRole('heading', { level: 1, name: 'Active Orders' })).toBeVisible();

  await page.goto('/trading/orders/completed');
  await expect(page.getByRole('heading', { level: 1, name: 'Completed Orders' })).toBeVisible();

  await page.goto('/trading/orders/cancelled');
  await expect(page.getByRole('heading', { level: 1, name: 'Cancelled Orders' })).toBeVisible();
});

test('order routes request expected backend statuses', async ({ page }) => {
  await loginViaUi(page, {
    email: process.env['E2E_TRADER5_USER_EMAIL'] ?? 'trader5@fueld.local',
    password: process.env['E2E_TRADER5_USER_PASSWORD'] ?? 'trader5password123',
  });

  await expectStatusesForRoute(page, '/trading/orders', 'CONFIRMED,INVOICED');
  await expectStatusesForRoute(page, '/trading/completed-orders', 'PAID');
  await expectStatusesForRoute(page, '/trading/cancelled-orders', 'CANCELLED');
  await expectStatusesForRoute(page, '/trading/inquiries', 'INQUIRY,OFFER');
});
