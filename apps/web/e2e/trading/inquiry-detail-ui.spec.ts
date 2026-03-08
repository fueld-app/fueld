import { test, expect, type Page } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';
import { createInquiryViaApi } from '../helpers/trading';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const adminEmail = env['E2E_ADMIN2_EMAIL'] ?? 'admin2@fueld.local';
const adminPassword = env['E2E_ADMIN2_PASSWORD'] ?? 'admin2password123';

async function authHeaders(page: Page): Promise<Record<string, string>> {
  const accessToken = await page.evaluate(() => localStorage.getItem('fueld_access_token'));
  if (!accessToken) {
    throw new Error('Missing access token in browser localStorage.');
  }

  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
}

test('inquiry actions keep terminal actions at the bottom', async ({ page }) => {
  test.setTimeout(90_000);

  await loginViaUi(page, {
    email: env['E2E_TRADER4_USER_EMAIL'] ?? 'trader4@fueld.local',
    password: env['E2E_TRADER4_USER_PASSWORD'] ?? 'trader4password123',
  });

  const inquiryId = await createInquiryViaApi(page);
  await page.goto(`/trading/inquiries/${inquiryId}`);

  await page.getByRole('button', { name: 'Actions' }).click();
  const menuItems = page.getByRole('menuitem');
  await expect(menuItems.first()).toBeVisible();

  await expect(menuItems).toHaveText([
    'View Offer PDF',
    'View Proforma Invoice',
    'Send Inquiry to Suppliers',
    'Send Offer',
    'Send Proforma Invoice',
    'Convert to Order',
    'Cancel Inquiry',
  ]);

  await expect(menuItems.nth(5)).toHaveText('Convert to Order');
  await expect(menuItems.nth(6)).toHaveText('Cancel Inquiry');
});

test('inquiry detail renders resolved customer and supplier terms without placeholders', async ({ page }) => {
  test.setTimeout(90_000);

  await loginViaUi(page, {
    email: adminEmail,
    password: adminPassword,
  });

  const headers = await authHeaders(page);
  const inquiryId = await createInquiryViaApi(page);

  const orderRes = await page.request.get(`http://localhost:3000/orders/${inquiryId}`, { headers });
  expect(orderRes.ok()).toBe(true);
  const orderJson = await orderRes.json() as {
    success: boolean;
    data?: { invoicingCompanyId?: string | null; invoicingCompany?: { name?: string | null } | null };
  };
  expect(orderJson.success).toBe(true);

  const invoicingCompanyId = orderJson.data?.invoicingCompanyId;
  const invoicingCompanyName = orderJson.data?.invoicingCompany?.name ?? 'E2E Own Company';
  expect(invoicingCompanyId).toBeTruthy();

  const updateTermsRes = await page.request.put(`http://localhost:3000/admin/settings/own-companies/${invoicingCompanyId}/terms`, {
    headers,
    data: {
      customerTerms: 'E2E customer terms for ${companyName} on ${documentName} with ${paymentTerms}',
      supplierTerms: 'E2E supplier terms for {{companyName}} on {{documentName}} with {{paymentTerms}}',
    },
  });
  expect(updateTermsRes.ok()).toBe(true);
  const updateTermsJson = await updateTermsRes.json() as { success: boolean };
  expect(updateTermsJson.success).toBe(true);

  await page.goto(`/trading/inquiries/${inquiryId}`);
  await expect(page.getByRole('heading', { name: 'Inquiry Detail' })).toBeVisible();

  const notesAndTerms = page.locator('[notesAndTerms]').first();
  await expect(notesAndTerms).toContainText(`E2E customer terms for ${invoicingCompanyName}`);
  await expect(notesAndTerms).toContainText(`E2E supplier terms for ${invoicingCompanyName}`);
  await expect(notesAndTerms).toContainText('Offer');

  await expect(notesAndTerms).not.toContainText('${companyName}');
  await expect(notesAndTerms).not.toContainText('${documentName}');
  await expect(notesAndTerms).not.toContainText('${paymentTerms}');
  await expect(notesAndTerms).not.toContainText('{{companyName}}');
  await expect(notesAndTerms).not.toContainText('{{documentName}}');
  await expect(notesAndTerms).not.toContainText('{{paymentTerms}}');
});