import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

test('header New Inquiry button opens the inquiry modal on the inquiries page', async ({ page }) => {
  await loginViaUi(page, {
    email: env['E2E_TRADER4_USER_EMAIL'] ?? 'trader4@fueld.local',
    password: env['E2E_TRADER4_USER_PASSWORD'] ?? 'trader4password123',
  });

  await page.goto('/trading/inquiries');
  await expect(page.getByRole('heading', { name: 'Inquiries' })).toBeVisible();

  const headerButton = page.getByRole('button', { name: 'New Inquiry' }).first();
  await expect(headerButton).toBeVisible();
  await headerButton.click();

  await expect(page.getByRole('heading', { name: 'New Inquiry' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Search clients...' })).toBeVisible();
});