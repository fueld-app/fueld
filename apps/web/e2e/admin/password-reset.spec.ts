import { test, expect } from '@playwright/test';
import { loginViaUi } from '../helpers/auth';

const adminEmail = process.env['E2E_USER_EMAIL'] ?? 'e2e@fueld.local';
const adminPassword = process.env['E2E_USER_PASSWORD'] ?? 'password123';

const targetEmail = process.env['E2E_RESET_USER_EMAIL'] ?? 'resetme@fueld.local';
const newPassword = process.env['E2E_RESET_USER_NEW_PASSWORD'] ?? 'Newpass123!';

test('admin can generate and use password reset link', async ({ page }) => {
  // 1) Login as admin
  await loginViaUi(page, { email: adminEmail, password: adminPassword });

  // 2) Go to Admin → Users
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();

  // 3) Find the target user row
  const row = page.getByRole('row', { name: new RegExp(targetEmail, 'i') });
  await expect(row).toBeVisible();

  // 4) Open Actions → Reset password
  const actionsButton = row.getByRole('button', { name: 'Actions' });
  await actionsButton.scrollIntoViewIfNeeded();
  await expect(actionsButton).toBeVisible();
  await actionsButton.click();

  const resetPasswordButton = page.getByRole('button', { name: /^Reset password$|^Sending…$/ }).first();
  await expect(resetPasswordButton).toBeVisible();
  await resetPasswordButton.click();

  // 5) Read the generated reset link from the banner card
  const banner = page.locator('div').filter({ hasText: 'Password reset link' }).first();
  const linkInput = banner.locator('input[readonly]');
  await expect(linkInput).toBeVisible();

  const resetLink = await linkInput.inputValue();
  expect(resetLink).toContain('/reset-password');
  expect(resetLink).toContain('token=');

  // 6) Use the reset link to set a new password
  // The API may return an absolute URL using the tenant's domain (e.g. test.local),
  // but locally Playwright serves the web app on the configured baseURL (typically localhost).
  // Rewrite the host to the Playwright baseURL so navigation works in local dev.
  const baseURL = test.info().project.use.baseURL;
  let resetHref = resetLink;
  try {
    const parsed = new URL(resetLink);
    if (baseURL) {
      const base = new URL(baseURL);
      parsed.protocol = base.protocol;
      parsed.host = base.host;
      resetHref = parsed.toString();
    }
  } catch {
    // Relative URL (already compatible with baseURL)
  }

  await page.goto(resetHref);
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await page.locator('#password').fill(newPassword);
  await page.locator('#confirmPassword').fill(newPassword);
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByText('Password updated. You can now sign in with your new password.')).toBeVisible();

  // 7) Login as the target user with the new password
  await page.goto('/login');
  await loginViaUi(page, { email: targetEmail, password: newPassword });
  // We just need to prove we're authenticated (sidebar link exists).
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
});
