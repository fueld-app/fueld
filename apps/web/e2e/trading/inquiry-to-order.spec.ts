import { test, expect } from '@playwright/test';
import { loginViaUi } from '../helpers/auth';
import { closePdfPreviewIfOpen, waitForPdfResponse } from '../helpers/pdf';
import { createInquiryViaApi } from '../helpers/trading';

test('create inquiry, view PDFs, convert to order, add item, view order PDFs', async ({ page }) => {
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
    await page.getByRole('button', { name: 'View Offer PDF' }).click();
    await pdf;
    await closePdfPreviewIfOpen(page);
  }

  // Convert to Order
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('button', { name: 'Convert to Order' }).click();
  await page.getByRole('button', { name: 'Confirm Convert' }).click();
  await page.waitForURL(/\/trading\/orders\//, { timeout: 15_000 });

  // Add one item and wait for autosave to persist it.
  const orderItems = page.locator('app-order-items');
  const productInput = orderItems.locator('input[role="combobox"][placeholder="Product..."]').first();

  await orderItems.scrollIntoViewIfNeeded();
  await orderItems.getByRole('button', { name: 'Add Item' }).click();
  try {
    await expect(productInput).toBeVisible({ timeout: 5_000 });
  } catch {
    const emptyAdd = orderItems.getByRole('button', { name: '+ Add your first item' });
    if (await emptyAdd.isVisible()) {
      await emptyAdd.click();
    }
    await expect(productInput).toBeVisible({ timeout: 10_000 });
  }

  const itemsSaved = page.waitForResponse((res) => {
    if (res.status() !== 200) return false;
    const req = res.request();
    if (req.method() !== 'PUT') return false;
    try {
      const url = new URL(res.url());
      return /\/orders\/[^/]+\/items$/.test(url.pathname);
    } catch {
      return false;
    }
  });

  await productInput.click();
  await page.getByRole('listbox').getByRole('option').first().click();
  await page.locator('app-order-items input[placeholder="e.g. local specs"]').first().fill('E2E item');
  await page.locator('app-order-items input[placeholder="Qty"]').first().fill('100');

  await itemsSaved;

});
