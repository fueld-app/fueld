import { type APIResponse } from '@playwright/test';
import { test, expect } from '../fixtures/coverage';
import { loginViaUi, authHeaders } from '../helpers/auth';
import { createInquiryViaApi } from '../helpers/trading';

function expectPdfSignature(body: Buffer): void {
  expect(body.subarray(0, 4).toString()).toBe('%PDF');
}

function getRequiredHeader(response: APIResponse, name: string): string {
  const value = response.headers()[name.toLowerCase()];
  if (!value) throw new Error(`Expected response header ${name} to be present.`);
  return value;
}

async function ensureBankAccountForOrder(
  page: import('@playwright/test').Page,
  headers: Record<string, string>,
  orderId: string,
): Promise<void> {
  const ownCompaniesRes = await page.request.get('http://localhost:3000/companies/own', { headers });
  if (!ownCompaniesRes.ok()) {
    throw new Error(`Failed to fetch own companies: ${ownCompaniesRes.status()} ${ownCompaniesRes.statusText()}`);
  }
  const ownCompaniesJson = await ownCompaniesRes.json() as { success: boolean; data?: Array<{ id: string }> };
  const companyId = ownCompaniesJson.data?.[0]?.id;
  if (!companyId) throw new Error('No own company available for bank-account setup.');

  const listRes = await page.request.get(`http://localhost:3000/admin/settings/companies/${companyId}/bank-accounts`, { headers });
  if (!listRes.ok()) {
    throw new Error(`Failed to list bank accounts: ${listRes.status()} ${listRes.statusText()}`);
  }
  const listJson = await listRes.json() as { success: boolean; data?: Array<{ id: string }> };
  let bankAccountId = listJson.data?.[0]?.id;

  if (!bankAccountId) {
    const createRes = await page.request.post(`http://localhost:3000/admin/settings/companies/${companyId}/bank-accounts`, {
      headers,
      data: {
        label: 'E2E Default USD',
        bankName: 'E2E Bank',
        accountName: 'E2E Account',
        accountNumber: '123456789',
        iban: 'NO9386011117947',
        swiftBic: 'DNBANOKKXXX',
        currency: 'USD',
        isDefault: true,
      },
    });
    if (!createRes.ok()) {
      throw new Error(`Failed to create bank account: ${createRes.status()} ${createRes.statusText()}`);
    }
    const createJson = await createRes.json() as { success: boolean; data?: { id?: string } };
    bankAccountId = createJson.data?.id;
  }

  if (!bankAccountId) throw new Error('Unable to resolve bank account for order update.');

  const orderUpdateRes = await page.request.put(`http://localhost:3000/orders/${orderId}`, {
    headers,
    data: {
      invoicingCompanyId: companyId,
      bankAccountId,
    },
  });
  if (!orderUpdateRes.ok()) {
    throw new Error(`Failed to update order with bank account: ${orderUpdateRes.status()} ${orderUpdateRes.statusText()}`);
  }
}

test('offer verification endpoints expose immutable revision by token', async ({ page }) => {
  test.setTimeout(90_000);

  await loginViaUi(page, {
    email: process.env['E2E_USER_EMAIL'] ?? 'e2e@fueld.local',
    password: process.env['E2E_USER_PASSWORD'] ?? 'password123',
  });

  const orderId = await createInquiryViaApi(page);
  const headers = await authHeaders(page);
  await ensureBankAccountForOrder(page, headers, orderId);

  const authenticatedOffer = await page.request.get(`http://localhost:3000/orders/${orderId}/offer/pdf`, {
    headers,
  });

  expect(authenticatedOffer.ok()).toBeTruthy();
  expect(authenticatedOffer.headers()['content-type']).toContain('application/pdf');
  expectPdfSignature(await authenticatedOffer.body());

  const verifyToken = getRequiredHeader(authenticatedOffer, 'X-Document-Verify-Token');
  const verificationRef = getRequiredHeader(authenticatedOffer, 'X-Document-Reference');
  const revision = getRequiredHeader(authenticatedOffer, 'X-Document-Revision');

  const publicByOrder = await page.request.get(`http://localhost:3000/verify/${orderId}/offer`);
  expect(publicByOrder.ok()).toBeTruthy();
  expect(publicByOrder.headers()['content-type']).toContain('application/pdf');
  expectPdfSignature(await publicByOrder.body());
  expect(publicByOrder.headers()['x-document-reference']).toBe(verificationRef);
  expect(publicByOrder.headers()['x-document-revision']).toBe(revision);

  const publicByToken = await page.request.get(`http://localhost:3000/verify/token/${verifyToken}`);
  expect(publicByToken.ok()).toBeTruthy();
  expect(publicByToken.headers()['content-type']).toContain('application/pdf');
  expectPdfSignature(await publicByToken.body());
  expect(publicByToken.headers()['x-document-reference']).toBe(verificationRef);
  expect(publicByToken.headers()['x-document-revision']).toBe(revision);

  const invalidToken = await page.request.get('http://localhost:3000/verify/token/invalid-token-e2e');
  expect(invalidToken.status()).toBe(404);
  await expect(invalidToken.json()).resolves.toMatchObject({
    success: false,
    message: 'Document not found',
  });
});

test('invoice and proforma verification endpoints expose immutable revisions by token', async ({ page }) => {
  test.setTimeout(90_000);

  await loginViaUi(page, {
    email: process.env['E2E_USER_EMAIL'] ?? 'e2e@fueld.local',
    password: process.env['E2E_USER_PASSWORD'] ?? 'password123',
  });

  const orderId = await createInquiryViaApi(page);
  const headers = await authHeaders(page);
  await ensureBankAccountForOrder(page, headers, orderId);

  const authenticatedInvoice = await page.request.get(`http://localhost:3000/orders/${orderId}/invoice/pdf`, {
    headers,
  });
  expect(authenticatedInvoice.ok()).toBeTruthy();
  expect(authenticatedInvoice.headers()['content-type']).toContain('application/pdf');
  expectPdfSignature(await authenticatedInvoice.body());

  const invoiceToken = getRequiredHeader(authenticatedInvoice, 'X-Document-Verify-Token');
  const invoiceReference = getRequiredHeader(authenticatedInvoice, 'X-Document-Reference');
  const invoiceRevision = getRequiredHeader(authenticatedInvoice, 'X-Document-Revision');

  const invoiceByOrder = await page.request.get(`http://localhost:3000/verify/${orderId}/invoice`);
  expect(invoiceByOrder.ok()).toBeTruthy();
  expect(invoiceByOrder.headers()['content-type']).toContain('application/pdf');
  expectPdfSignature(await invoiceByOrder.body());
  expect(invoiceByOrder.headers()['x-document-reference']).toBe(invoiceReference);
  expect(invoiceByOrder.headers()['x-document-revision']).toBe(invoiceRevision);

  const invoiceByToken = await page.request.get(`http://localhost:3000/verify/token/${invoiceToken}`);
  expect(invoiceByToken.ok()).toBeTruthy();
  expect(invoiceByToken.headers()['content-type']).toContain('application/pdf');
  expectPdfSignature(await invoiceByToken.body());
  expect(invoiceByToken.headers()['x-document-reference']).toBe(invoiceReference);
  expect(invoiceByToken.headers()['x-document-revision']).toBe(invoiceRevision);

  const authenticatedProforma = await page.request.get(`http://localhost:3000/orders/${orderId}/proforma/pdf`, {
    headers,
  });
  expect(authenticatedProforma.ok()).toBeTruthy();
  expect(authenticatedProforma.headers()['content-type']).toContain('application/pdf');
  expectPdfSignature(await authenticatedProforma.body());

  const proformaToken = getRequiredHeader(authenticatedProforma, 'X-Document-Verify-Token');
  const proformaReference = getRequiredHeader(authenticatedProforma, 'X-Document-Reference');
  const proformaRevision = getRequiredHeader(authenticatedProforma, 'X-Document-Revision');

  const proformaByOrder = await page.request.get(`http://localhost:3000/verify/${orderId}/proforma-invoice`);
  expect(proformaByOrder.ok()).toBeTruthy();
  expect(proformaByOrder.headers()['content-type']).toContain('application/pdf');
  expectPdfSignature(await proformaByOrder.body());
  expect(proformaByOrder.headers()['x-document-reference']).toBe(proformaReference);
  expect(proformaByOrder.headers()['x-document-revision']).toBe(proformaRevision);

  const proformaByToken = await page.request.get(`http://localhost:3000/verify/token/${proformaToken}`);
  expect(proformaByToken.ok()).toBeTruthy();
  expect(proformaByToken.headers()['content-type']).toContain('application/pdf');
  expectPdfSignature(await proformaByToken.body());
  expect(proformaByToken.headers()['x-document-reference']).toBe(proformaReference);
  expect(proformaByToken.headers()['x-document-revision']).toBe(proformaRevision);
});
