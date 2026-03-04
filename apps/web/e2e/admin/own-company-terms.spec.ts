import { test, expect } from '../fixtures/coverage';
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
  await companyCard.getByRole('button', { name: /Show Details|Hide Details/i }).first().click();

  // Terms editor is inside the expanded section.
  const termsSection = page
    .locator('div.mt-6.border-t.border-gray-200.pt-5')
    .filter({ hasText: 'Terms, VAT & Invoicing' })
    .first();
  await expect(termsSection).toBeVisible();

  const customerBox = termsSection.locator('textarea').nth(0);
  const supplierBox = termsSection.locator('textarea').nth(1);

  await customerBox.fill(`Customer terms for ${ownCompanyName} (E2E)`);
  await supplierBox.fill(`Supplier terms for ${ownCompanyName} (E2E)`);

  await termsSection.getByRole('button', { name: 'Save terms' }).click();
  await expect(page.getByText('Saved')).toBeVisible();
});
