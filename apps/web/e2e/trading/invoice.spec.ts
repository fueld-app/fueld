import { test, expect } from '@playwright/test';
import { loginViaUi } from '../helpers/auth';
import { selectSearchableDropdownOption } from '../helpers/dropdown';
import { closePdfPreviewIfOpen, waitForPdfResponse } from '../helpers/pdf';

const CLIENT_NAME = process.env['E2E_CLIENT_NAME'] ?? 'E2E Client Co';
const VESSEL_NAME = process.env['E2E_VESSEL_NAME'] ?? 'E2E Vessel';
const PLACE_NAME = process.env['E2E_PLACE_NAME'] ?? 'E2E Port';

async function createOrderFromInquiry(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/trading/inquiries?new=1');

  const modal = page.getByRole('dialog');
  await expect(modal.getByRole('heading', { name: 'New Inquiry' })).toBeVisible();

  await selectSearchableDropdownOption(page, modal, 'Client', CLIENT_NAME);
  await selectSearchableDropdownOption(page, modal, 'Vessel', VESSEL_NAME);
  await selectSearchableDropdownOption(page, modal, 'Port', PLACE_NAME);

  await modal.getByRole('button', { name: 'Create Inquiry' }).click();
  await page.waitForURL(/\/trading\/inquiries\//, { timeout: 15_000 });

  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('button', { name: 'Convert to Order' }).click();
  await page.waitForURL(/\/trading\/orders\//, { timeout: 15_000 });

  // Add a minimal item so downstream documents have line items.
  await page.getByRole('button', { name: 'Add Item' }).click();
  const itemsSaved = page.waitForResponse((res) => {
    if (res.status() !== 200) return false;
    if (res.request().method() !== 'PUT') return false;
    try {
      const url = new URL(res.url());
      return /\/orders\/[^/]+\/items$/.test(url.pathname);
    } catch {
      return false;
    }
  });

  const productInput = page.locator('app-order-items').getByRole('combobox').first();
  await productInput.click();
  await page.getByRole('listbox').getByRole('option').first().click();
  await page.locator('app-order-items input[placeholder="Qty"]').first().fill('100');

  await itemsSaved;
}

test('mark delivered via BDR upload and generate invoice PDF', async ({ page }) => {
  await loginViaUi(page, {
    email: process.env['E2E_USER_EMAIL'] ?? 'e2e@fueld.local',
    password: process.env['E2E_USER_PASSWORD'] ?? 'password123',
  });

  await createOrderFromInquiry(page);

  // Upload a BDR (PDF) to mark the order as delivered.
  const attachmentsHeading = page.getByRole('heading', { name: 'Attachments' });
  const attachmentsCard = attachmentsHeading.locator('..').locator('..');
  await attachmentsCard.locator('select').first().selectOption({ value: 'BDR' });

  const pdfBuffer = Buffer.from('%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
  await attachmentsCard.getByRole('button', { name: 'Choose File' }).setInputFiles({
    name: 'bdr.pdf',
    mimeType: 'application/pdf',
    buffer: pdfBuffer,
  });

  const uploadButton = attachmentsCard.getByRole('button', { name: 'Upload' });
  await expect(uploadButton).toBeEnabled();

  page.once('dialog', async (dialog) => {
    if (dialog.type() === 'confirm' && dialog.message().includes('BDR uploaded. Mark order as delivered?')) {
      await dialog.accept();
    } else {
      await dialog.dismiss();
    }
  });

  const uploaded = page.waitForResponse((res) =>
    res.request().method() === 'POST' && res.url().includes('/attachments'),
  );
  await uploadButton.click();
  const uploadedRes = await uploaded;
  if (uploadedRes.status() < 200 || uploadedRes.status() >= 300) {
    const body = await uploadedRes.text().catch(() => '');
    throw new Error(`Attachment upload failed: ${uploadedRes.status()} ${uploadedRes.statusText()}${body ? `\n${body}` : ''}`);
  }

  // Generate Invoice (only available once delivered/invoiced/paid).
  await page.getByRole('button', { name: 'Actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Generate Invoice' })).toBeVisible();

  const pdf = waitForPdfResponse(page, '/invoice/pdf');
  await page.getByRole('menuitem', { name: 'Generate Invoice' }).click();
  await pdf;
  await closePdfPreviewIfOpen(page);
});
