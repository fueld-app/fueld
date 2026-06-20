import { test, expect, type Page } from '../fixtures/coverage';
import { loginViaUi, authHeaders } from '../helpers/auth';
import { createInquiryViaApi } from '../helpers/trading';

const API = 'http://localhost:3000';

interface InquirySupplier {
  companyId?: string;
  company?: { id?: string };
  email?: string | null;
}

// Verifies the Send Inquiry email preview renders inside the sandboxed iframe
// (srcdoc + sandbox="") after the bypassSecurityTrustHtml -> iframe change.
//
// Setup note: GET /orders/:id/inquiry/suppliers returns the port suppliers
// linked to the order's PLACE (not the suppliers attached to the order). The
// seeded E2E Port place has no linked suppliers, so we create a supplier
// company, give it a contact with an email, and link it as a port supplier to
// the order's place before opening the Send Inquiry modal.
test('send-inquiry preview renders in the sandboxed iframe', async ({ page }) => {
  test.setTimeout(150_000);

  await loginViaUi(page, {
    email: 'trader4@fueld.local',
    password: 'trader4password123',
  });

  const headers = await authHeaders(page);
  const inquiryId = await createInquiryViaApi(page);
  expect(inquiryId, 'inquiry created').toBeTruthy();

  // The Send Inquiry modal guard requires an ETA on the order; the helper creates
  // orders without one, so set ETA/ETD before opening the modal.
  const etaUpdateRes = await page.request.put(`${API}/orders/${inquiryId}`, {
    headers,
    data: { eta: '2026-07-15T10:00:00.000Z', etd: '2026-07-15T18:00:00.000Z' },
  });
  expect(etaUpdateRes.ok(), `eta update ok (${etaUpdateRes.status()})`).toBe(true);

  // Resolve the order's placeId (the seeded E2E Port).
  const orderRes = await page.request.get(`${API}/orders/${inquiryId}`, { headers });
  expect(orderRes.ok(), `order fetch ok (${orderRes.status()})`).toBe(true);
  const orderJson = (await orderRes.json()) as { success: boolean; data?: { placeId?: string } };
  const placeId = orderJson.data?.placeId;
  expect(placeId, 'order has a placeId').toBeTruthy();

  // Create a supplier company to link as a port supplier.
  const supplierRes = await page.request.post(`${API}/companies/local`, {
    headers,
    data: { name: `E2E Preview Supplier ${Date.now()}`, types: ['SUPPLIER'] },
  });
  expect(supplierRes.ok(), `supplier create ok (${supplierRes.status()})`).toBe(true);
  const supplierJson = (await supplierRes.json()) as { success: boolean; data?: { id?: string } };
  const companyId = supplierJson.data?.id;
  expect(companyId, 'supplier company id').toBeTruthy();

  // Give the supplier a contact with an email so the modal has an email destination.
  const contactRes = await page.request.post(`${API}/companies/local/${companyId}/contacts`, {
    headers,
    data: { name: 'E2E Preview Contact', email: 'e2e.supplier.preview@example.com', role: 'Sales' },
  });
  expect(contactRes.ok(), `contact add ok (${contactRes.status()})`).toBe(true);
  const contactJson = (await contactRes.json()) as { success: boolean; data?: { id?: string } };
  const contactId = contactJson.data?.id;
  expect(contactId, 'contact id').toBeTruthy();

  // Link the supplier (with its contact) as a port supplier for the order's place.
  const linkRes = await page.request.post(`${API}/lloyds/places/local/${placeId}/suppliers`, {
    headers,
    data: { companyId, contactId },
  });
  expect(linkRes.ok(), `port supplier link ok (${linkRes.status()})`).toBe(true);

  // The inquiry suppliers endpoint should now return our linked supplier.
  const supRes = await page.request.get(`${API}/orders/${inquiryId}/inquiry/suppliers`, { headers });
  expect(supRes.ok()).toBe(true);
  const supJson = (await supRes.json()) as { success: boolean; data?: InquirySupplier[] };
  const suppliers = supJson.data ?? [];
  expect(suppliers.length, 'inquiry should have at least one supplier').toBeGreaterThan(0);

  await page.goto(`/trading/inquiries/${inquiryId}`);
  await expect(page.getByRole('heading', { name: 'Inquiry Detail' })).toBeVisible({ timeout: 20_000 });

  // Open the Send Inquiry modal via the Actions menu.
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Send Inquiry to Suppliers' }).click();

  await expect(page.getByRole('dialog').getByText('Send Inquiry to Suppliers', { exact: true })).toBeVisible({ timeout: 15_000 });

  // The preview lives inside a collapsed <details>; expand it to reveal the iframe.
  await page.getByText('Preview message').click();

  // The preview renders in a sandboxed <iframe class="inquiry-email-canvas" srcdoc=... sandbox>.
  const iframe = page.locator('iframe.inquiry-email-canvas');
  await expect(iframe).toBeVisible({ timeout: 20_000 });

  // srcdoc must be a non-empty HTML document (the rendered email preview).
  const srcdoc = await iframe.evaluate((el) => (el as HTMLIFrameElement).getAttribute('srcdoc') ?? '');
  expect(srcdoc.length, 'preview iframe srcdoc should be non-empty').toBeGreaterThan(0);
  expect(srcdoc).toContain('<body');

  // The iframe must be sandboxed with no allow-scripts (active content can't run).
  const sandbox = await iframe.evaluate((el) => (el as HTMLIFrameElement).getAttribute('sandbox') ?? '');
  expect(sandbox, 'iframe must be sandboxed (no allow-scripts)').toBe('');

  // Confirm the rendered content inside the iframe is non-empty.
  const frame = page.frameLocator('iframe.inquiry-email-canvas');
  await expect(frame.locator('body')).not.toBeEmpty({ timeout: 15_000 });

  await page.screenshot({ path: 'test-results/send-inquiry-preview.png' });
});