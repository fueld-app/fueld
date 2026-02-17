import { test, expect } from '@playwright/test';
import { loginViaUi } from '../helpers/auth';
import { selectSearchableDropdownOption } from '../helpers/dropdown';

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

  // Add a minimal item so the order isn't empty.
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

test('record a payment and order becomes paid', async ({ page }) => {
  await loginViaUi(page, {
    email: process.env['E2E_USER_EMAIL'] ?? 'e2e@fueld.local',
    password: process.env['E2E_USER_PASSWORD'] ?? 'password123',
  });

  await createOrderFromInquiry(page);

  await page.getByRole('button', { name: 'Add payment' }).click();

  const heading = page.getByRole('heading', { name: 'Record payment' });
  await expect(heading).toBeVisible();
  const modal = heading.locator('..').locator('..');

  await modal.locator('input[type="number"]').fill('1000');
  await modal.locator('input[placeholder="Wire, ACH, card"]').fill('Wire');
  await modal.locator('textarea').fill('E2E payment');

  const paymentPosted = page.waitForResponse((res) => {
    if (res.request().method() !== 'POST') return false;
    try {
      return /\/orders\/[^/]+\/payments$/.test(new URL(res.url()).pathname);
    } catch {
      return false;
    }
  });
  await modal.getByRole('button', { name: 'Record payment' }).click();
  const paymentRes = await paymentPosted;
  if (paymentRes.status() < 200 || paymentRes.status() >= 300) {
    const body = await paymentRes.text().catch(() => '');
    throw new Error(`Record payment failed: ${paymentRes.status()} ${paymentRes.statusText()}${body ? `\n${body}` : ''}`);
  }

  await expect(page.getByText('Payment recorded. Order marked as paid.')).toBeVisible();

  // Ensure Mark Paid action is no longer present.
  await page.getByRole('button', { name: 'Actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Mark Paid' })).toHaveCount(0);
});
