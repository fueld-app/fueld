import { test, expect } from '@playwright/test';
import { loginViaUi } from '../helpers/auth';

test('trader cannot access credit routes', async ({ page }) => {
  await loginViaUi(page, {
    email: process.env['E2E_TRADER_USER_EMAIL'] ?? 'trader@fueld.local',
    password: process.env['E2E_TRADER_USER_PASSWORD'] ?? 'traderpassword123',
  });

  await page.goto('/credit/suppliers');
  await expect(page).toHaveURL(/\/$/);
});

test('credit manager can access credit routes', async ({ page }) => {
  await loginViaUi(page, {
    email: process.env['E2E_CREDIT_USER_EMAIL'] ?? 'credit@fueld.local',
    password: process.env['E2E_CREDIT_USER_PASSWORD'] ?? 'creditpassword123',
  });

  await page.goto('/credit/suppliers');
  await expect(page).toHaveURL(/\/credit\/suppliers$/);
  await expect(page.getByRole('heading', { name: 'Supplier Credit' })).toBeVisible();

  await page.goto('/credit/customers');
  await expect(page).toHaveURL(/\/credit\/customers$/);
  await expect(page.getByRole('heading', { name: 'Customer Credit' })).toBeVisible();
});
