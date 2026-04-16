import { test, expect } from '../fixtures/coverage';
import { loginViaUi } from '../helpers/auth';
import { closePdfPreviewIfOpen, waitForPdfResponse } from '../helpers/pdf';
import { createInquiryViaApi } from '../helpers/trading';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

test('create inquiry, view offer PDF, convert to order, and verify order page', async ({ page }) => {
  test.setTimeout(90_000);

  await loginViaUi(page, {
    email: env['E2E_TRADER4_USER_EMAIL'] ?? 'trader4@fueld.local',
    password: env['E2E_TRADER4_USER_PASSWORD'] ?? 'trader4password123',
  });

  const inquiryId = await createInquiryViaApi(page);
  await page.goto(`/trading/inquiries/${inquiryId}`);
  await expect(page.getByRole('button', { name: 'Actions' })).toBeVisible();

  const menuButton = page.getByRole('button', { name: /open menu|close menu/i });
  if (!(await menuButton.isVisible().catch(() => false))) {
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const inquiriesNavLink = nav.getByRole('link', { name: /^Inquiries$/ });
    const activeOrdersNavLink = nav.getByRole('link', { name: /^Active Orders$/ });

    if (!(await inquiriesNavLink.isVisible().catch(() => false))) {
      await nav.getByRole('button', { name: /^Trading$/ }).click();
    }

    await expect(inquiriesNavLink).toBeVisible();
    await expect(inquiriesNavLink).toHaveClass(/bg-sidebar-active/);
    await expect(activeOrdersNavLink).not.toHaveClass(/bg-sidebar-active/);
  }

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
  await expect(page.locator('app-order-items')).toContainText('MGO');

});

test('cancel inquiry shows all configured reasons and sends selected reason', async ({ page }) => {
  test.setTimeout(90_000);

  await loginViaUi(page, {
    email: env['E2E_TRADER4_USER_EMAIL'] ?? 'trader4@fueld.local',
    password: env['E2E_TRADER4_USER_PASSWORD'] ?? 'trader4password123',
  });

  const configuredReasons = [
    'Price not competitive',
    'Customer cancelled request',
    'No supplier availability',
  ];

  await page.route('**/admin/settings/my-inquiry-cancel-reasons', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { reasons: configuredReasons } }),
    });
  });

  let capturedLossReason = '';
  await page.route('**/orders/*/status', async (route) => {
    const payload = route.request().postDataJSON() as { status?: string; lossReason?: string };
    if (payload.status === 'CANCELLED') {
      capturedLossReason = payload.lossReason ?? '';
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { status: 'CANCELLED' } }),
      });
      return;
    }
    await route.continue();
  });

  const inquiryId = await createInquiryViaApi(page);
  const cancelReasonsLoaded = page.waitForResponse(
    (response) => response.url().includes('/admin/settings/my-inquiry-cancel-reasons')
      && response.request().method() === 'GET',
  );
  await page.goto(`/trading/inquiries/${inquiryId}`);
  await cancelReasonsLoaded;

  await expect(page.getByRole('heading', { name: 'Inquiry Detail' })).toBeVisible();
  await expect(page.locator('app-status-badge').getByText('INQUIRY', { exact: true })).toBeVisible();
  await expect(page.locator('app-order-items')).toContainText('MGO');

  const actionsButton = page.getByRole('button', { name: 'Actions' });
  const cancelInquiryMenuItem = page.getByRole('menuitem', { name: 'Cancel Inquiry' });

  await expect(actionsButton).toBeVisible();
  await actionsButton.click();
  await expect(cancelInquiryMenuItem).toBeVisible();
  await cancelInquiryMenuItem.click();

  await expect(page.getByRole('heading', { level: 3, name: 'Cancel inquiry' })).toBeVisible();

  const reasonSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'No supplier availability' }) }).first();
  await expect(reasonSelect).toBeVisible();

  await expect(reasonSelect.locator('option')).toHaveText(configuredReasons);
  await reasonSelect.selectOption('No supplier availability');

  await page.getByRole('button', { name: 'Confirm Cancel' }).click();

  await page.waitForURL(/\/trading\/cancelled-orders\//, { timeout: 15_000 });
  expect(capturedLossReason).toBe('No supplier availability');
});
