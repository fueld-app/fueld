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
}

test('upload OTHER attachment and preview/download', async ({ page }) => {
  await loginViaUi(page, {
    email: process.env['E2E_USER_EMAIL'] ?? 'e2e@fueld.local',
    password: process.env['E2E_USER_PASSWORD'] ?? 'password123',
  });

  await createOrderFromInquiry(page);

  const attachmentsHeading = page.getByRole('heading', { name: 'Attachments' });
  const attachmentsCard = attachmentsHeading.locator('..').locator('..');

  // Ensure we're on OTHER.
  await attachmentsCard.locator('select').first().selectOption({ value: 'OTHER' });

  const fileName = 'other-attachment.pdf';
  const pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');

  await attachmentsCard.getByRole('button', { name: 'Choose File' }).setInputFiles({
    name: fileName,
    mimeType: 'application/pdf',
    buffer: pdfBuffer,
  });

  const uploadButton = attachmentsCard.getByRole('button', { name: 'Upload' });
  await expect(uploadButton).toBeEnabled();

  const uploadResPromise = page.waitForResponse((res) =>
    res.request().method() === 'POST' && res.url().includes('/attachments'),
  );
  await uploadButton.click();
  const uploadRes = await uploadResPromise;
  expect(uploadRes.status()).toBeGreaterThanOrEqual(200);
  expect(uploadRes.status()).toBeLessThan(300);

  // New attachment should appear; click to preview.
  await expect(page.getByRole('button', { name: fileName })).toBeVisible();

  const pdf = waitForPdfResponse(page, '/uploads/');
  await page.getByRole('button', { name: fileName }).click();
  await pdf;

  // Assert modal shows Download and has a blob URL.
  const modal = page.locator('app-pdf-preview-modal');
  await expect(modal.getByRole('link', { name: 'Download' })).toBeVisible();
  await expect(modal.getByRole('link', { name: 'Download' })).toHaveAttribute('href', /blob:/);
  await expect(modal.getByRole('link', { name: 'Download' })).toHaveAttribute('download', /\.pdf$/);

  await closePdfPreviewIfOpen(page);
});
