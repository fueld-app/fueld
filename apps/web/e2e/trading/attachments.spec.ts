import { test, expect } from '@playwright/test';
import { loginViaUi } from '../helpers/auth';
import { closePdfPreviewIfOpen, waitForPdfResponse } from '../helpers/pdf';
import { createInquiryViaApi } from '../helpers/trading';

async function createOrderFromInquiry(page: import('@playwright/test').Page): Promise<void> {
  const inquiryId = await createInquiryViaApi(page);
  await page.goto(`/trading/inquiries/${inquiryId}`);
  await expect(page.getByRole('button', { name: 'Actions' })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('button', { name: 'Convert to Order' }).click();
  await page.getByRole('button', { name: 'Confirm Convert' }).click();
  await page.waitForURL(/\/trading\/orders\//, { timeout: 15_000 });
}

test('upload OTHER attachment and preview/download', async ({ page }) => {
  test.setTimeout(90_000);

  await loginViaUi(page, {
    email: process.env['E2E_TRADER7_USER_EMAIL'] ?? 'trader7@fueld.local',
    password: process.env['E2E_TRADER7_USER_PASSWORD'] ?? 'trader7password123',
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
