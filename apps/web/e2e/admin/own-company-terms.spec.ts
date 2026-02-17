import { test, expect } from '@playwright/test';
import { loginViaUi } from '../helpers/auth';

const adminEmail = process.env['E2E_ADMIN2_EMAIL'] ?? 'admin2@fueld.local';
const adminPassword = process.env['E2E_ADMIN2_PASSWORD'] ?? 'admin2password123';
const ownCompanyName = process.env['E2E_OWN_COMPANY_NAME'] ?? 'E2E Own Company';

test('admin can edit own-company customer/supplier terms', async ({ page }) => {
  await loginViaUi(page, { email: adminEmail, password: adminPassword });

  await page.goto('/admin/our-companies');
  await expect(page.getByRole('heading', { name: 'Our Companies' })).toBeVisible();

  // Expand the company panel (expands "Bank Accounts" section which contains Terms editor).
  const companyCard = page
    .getByRole('link', { name: ownCompanyName })
    .locator('xpath=ancestor::div[contains(@class, "rounded-xl")]')
    .first();
  await expect(companyCard).toBeVisible();
  await companyCard.getByRole('button', { name: 'Bank Accounts' }).first().click();

  // Terms editor is inside the expanded section.
  await expect(page.getByText('Customer & Supplier Terms')).toBeVisible();

  const customerBox = page.locator('label:has-text("Customer terms")').locator('..').locator('textarea');
  const supplierBox = page.locator('label:has-text("Supplier terms")').locator('..').locator('textarea');

  await customerBox.fill('Customer terms for ${companyName} (E2E)');
  await supplierBox.fill('Supplier terms for ${companyName} (E2E)');

  await page.getByRole('button', { name: 'Save terms' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
});
