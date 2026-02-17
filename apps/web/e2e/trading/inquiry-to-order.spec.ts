import { test, expect } from '@playwright/test';
import { loginViaUi } from '../helpers/auth';
import { selectSearchableDropdownOption } from '../helpers/dropdown';
import { closePdfPreviewIfOpen, waitForPdfResponse } from '../helpers/pdf';

const CLIENT_NAME = process.env['E2E_CLIENT_NAME'] ?? 'E2E Client Co';
const VESSEL_NAME = process.env['E2E_VESSEL_NAME'] ?? 'E2E Vessel';
const PLACE_NAME = process.env['E2E_PLACE_NAME'] ?? 'E2E Port';

test('create inquiry, view PDFs, convert to order, add item, view order PDFs', async ({ page }) => {
  await loginViaUi(page, {
    email: process.env['E2E_USER_EMAIL'] ?? 'e2e@fueld.local',
    password: process.env['E2E_USER_PASSWORD'] ?? 'password123',
  });

  await page.goto('/trading/inquiries?new=1');

  const modal = page.getByRole('dialog');
  await expect(modal.getByRole('heading', { name: 'New Inquiry' })).toBeVisible();

  await selectSearchableDropdownOption(page, modal, 'Client', CLIENT_NAME);
  await selectSearchableDropdownOption(page, modal, 'Vessel', VESSEL_NAME);
  await selectSearchableDropdownOption(page, modal, 'Port', PLACE_NAME);

  await modal.getByRole('button', { name: 'Create Inquiry' }).click();

  await page.waitForURL(/\/trading\/inquiries\//, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Actions' })).toBeVisible();

  // View Offer PDF (Inquiry page actions)
  {
    const pdf = waitForPdfResponse(page, '/offer/pdf');
    await page.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('button', { name: 'View Offer PDF' }).click();
    await pdf;
    await closePdfPreviewIfOpen(page);
  }

  // View Proforma PDF (Inquiry page actions)
  {
    const pdf = waitForPdfResponse(page, '/proforma/pdf');
    await page.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('button', { name: 'View Proforma Invoice' }).click();
    await pdf;
    await closePdfPreviewIfOpen(page);
  }

  // Convert to Order
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('button', { name: 'Convert to Order' }).click();
  await page.waitForURL(/\/trading\/orders\//, { timeout: 15_000 });

  // Add one item and wait for autosave to persist it.
  await page.getByRole('button', { name: 'Add Item' }).click();

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

  // Pick first product option for the new row.
  const productInput = page.locator('app-order-items').getByRole('combobox').first();
  await productInput.click();
  await page.getByRole('listbox').getByRole('option').first().click();

  await page.locator('app-order-items input[placeholder="e.g. local specs"]').first().fill('E2E item');
  await page.locator('app-order-items input[placeholder="Qty"]').first().fill('100');

  await itemsSaved;

  // Order detail PDFs (header actions)
  {
    const pdf = waitForPdfResponse(page, '/offer/pdf');
    await page.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'View Confirmation' }).click();
    await pdf;
    await closePdfPreviewIfOpen(page);
  }

  {
    const pdf = waitForPdfResponse(page, '/proforma/pdf');
    await page.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'View Nomination' }).click();
    await pdf;
    await closePdfPreviewIfOpen(page);
  }
});
