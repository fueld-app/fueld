import { test, expect } from '@playwright/test';
import { loginViaUi } from '../helpers/auth';
import { closePdfPreviewIfOpen, waitForPdfResponse } from '../helpers/pdf';
import { createInquiryViaApi } from '../helpers/trading';

test('create inquiry, view offer PDF, convert to order, and verify order page', async ({ page }) => {
  test.setTimeout(90_000);

  await loginViaUi(page, {
    email: process.env['E2E_TRADER4_USER_EMAIL'] ?? 'trader4@fueld.local',
    password: process.env['E2E_TRADER4_USER_PASSWORD'] ?? 'trader4password123',
  });

  const inquiryId = await createInquiryViaApi(page);
  await page.goto(`/trading/inquiries/${inquiryId}`);
  await expect(page.getByRole('button', { name: 'Actions' })).toBeVisible();

  // View Offer PDF (Inquiry page actions)
  {
    const pdf = waitForPdfResponse(page, '/offer/pdf');
    await page.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'View Offer PDF' }).click();
    await pdf;
    await closePdfPreviewIfOpen(page);
  }

  // Convert to Order
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Convert to Order' }).click();
  await page.getByRole('button', { name: 'Confirm Convert' }).click();
  await page.waitForURL(/\/trading\/orders\//, { timeout: 15_000 });

  // The inquiry is seeded with a valid line item via API helper.
  await expect(page.locator('app-order-items tbody tr').first()).toBeVisible();

});
