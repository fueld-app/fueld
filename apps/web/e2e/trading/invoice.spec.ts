import { test, expect } from '@playwright/test';
import { loginViaUi } from '../helpers/auth';
import { createInquiryViaApi } from '../helpers/trading';

async function createOrderFromInquiry(page: import('@playwright/test').Page): Promise<void> {
  const inquiryId = await createInquiryViaApi(page);
  await page.goto(`/trading/inquiries/${inquiryId}`);
  await expect(page.getByRole('button', { name: 'Actions' })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('button', { name: 'Convert to Order' }).click();
  await page.getByRole('button', { name: 'Confirm Convert' }).click();
  await page.waitForURL(/\/trading\/orders\//, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Order Detail' })).toBeVisible();
}

test('mark delivered via BDR upload and generate invoice PDF', async ({ page }) => {
  test.setTimeout(90_000);

  await loginViaUi(page, {
    email: process.env['E2E_TRADER2_USER_EMAIL'] ?? 'trader2@fueld.local',
    password: process.env['E2E_TRADER2_USER_PASSWORD'] ?? 'trader2password123',
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

  await expect(page.getByRole('button', { name: 'bdr.pdf' })).toBeVisible();
});
