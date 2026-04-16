import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';
import { createInquiryViaApi } from '../helpers/trading';

async function createOrderFromInquiry(page: import('@playwright/test').Page): Promise<void> {
  const inquiryId = await createInquiryViaApi(page);
  await page.goto(`/trading/inquiries/${inquiryId}`);
  await expect(page.getByRole('button', { name: 'Actions' })).toBeVisible({ timeout: 15_000 });

  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Convert to Order' }).click();
  await page.getByRole('button', { name: 'Confirm Convert' }).click();
  await page.waitForURL(/\/trading\/orders\//, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Order Detail' })).toBeVisible();
}

test('delivered flow saves custom delivered quantities and marks the order delivered', async ({ page }) => {
  test.setTimeout(90_000);

  await loginViaUi(page, {
    email: process.env['E2E_TRADER3_USER_EMAIL'] ?? 'trader3@fueld.local',
    password: process.env['E2E_TRADER3_USER_PASSWORD'] ?? 'trader3password123',
  });

  await createOrderFromInquiry(page);

  const deliveredAtInput = page.locator('label').filter({ hasText: 'Delivered At' }).locator('..').locator('input');
  await expect(deliveredAtInput).toBeVisible();
  await expect(deliveredAtInput).toHaveAttribute('type', 'date');

  const deliveredDateSaveRequest = page.waitForRequest((request) => {
    if (request.method() !== 'PUT') return false;

    let pathname = '';
    try {
      pathname = new URL(request.url()).pathname;
    } catch {
      return false;
    }

    if (!/\/orders\/[^/]+$/.test(pathname)) return false;

    const payload = request.postDataJSON() as { deliveredAt?: string | null };
    return payload.deliveredAt === '2026-01-09T12:00:00.000Z';
  });

  await deliveredAtInput.fill('2026-01-09');
  await deliveredDateSaveRequest;
  await expect(deliveredAtInput).toHaveValue('2026-01-09');

  const orderItems = page.locator('app-order-items');
  await expect(orderItems).toContainText('MGO');

  const mobileDeliveredQtyInput = orderItems
    .locator('label')
    .filter({ hasText: 'Delivered Qty' })
    .locator('..')
    .locator('input')
    .first();
  const desktopDeliveredQtyInput = orderItems
    .locator('tbody tr')
    .first()
    .locator('input[step="0.001"][min="0"]')
    .nth(1);
  const deliveredQtyInput = await mobileDeliveredQtyInput.isVisible().catch(() => false)
    ? mobileDeliveredQtyInput
    : desktopDeliveredQtyInput;
  await expect(deliveredQtyInput).toBeVisible();
  await deliveredQtyInput.fill('330.146');

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

  const uploadResponse = page.waitForResponse((response) => {
    return response.request().method() === 'POST' && response.url().includes('/attachments');
  });

  await uploadButton.click();
  await uploadResponse;
  await expect(page.getByRole('button', { name: 'bdr.pdf' })).toBeVisible();

  const deliveredStatusRequest = page.waitForRequest((request) => {
    if (request.method() !== 'PUT') return false;

    let pathname = '';
    try {
      pathname = new URL(request.url()).pathname;
    } catch {
      return false;
    }

    if (!/\/orders\/[^/]+\/status$/.test(pathname)) return false;

    const payload = request.postDataJSON() as { status?: string };
    return payload.status === 'DELIVERED';
  });

  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Mark Delivered' }).click();
  await deliveredStatusRequest;
  await expect(page.getByText('DELIVERED', { exact: true })).toBeVisible({ timeout: 15_000 });
});