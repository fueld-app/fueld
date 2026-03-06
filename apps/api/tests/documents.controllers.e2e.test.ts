import { beforeEach, afterEach, describe, expect, it, mock } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { bankAccounts, counterparties, documentRevisions, tenants } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';

// ── Mock acquireGraphTokenForUser so send-email tests can use the Graph path ──
let mockGraphToken: string | null = null;

const originalModule = await import('../src/modules/auth/microsoft-oauth.service');
mock.module('../src/modules/auth/microsoft-oauth.service', () => ({
  ...originalModule,
  acquireGraphTokenForUser: async () => mockGraphToken,
}));

// Import e2e helpers *after* mock is registered so the app picks it up
const { loginE2E, requestJson, requestRaw } = await import('./helpers/e2e');

async function seedDocumentReadyOrder() {
  const seeded = await seedAuthBasics();
  const db = await getDb();

  const [invoicingCompany] = await db
    .insert(counterparties)
    .values({
      tenantId: seeded.tenant.id,
      name: 'Fueld Trading Ltd',
      type: 'SUPPLIER',
      types: ['SUPPLIER'],
      country: 'Norway',
      isOwnCompany: true,
      headOfficeAddress: 'Main Street 2, Oslo',
      headOfficePhone: '+4799998888',
      headOfficeEmail: 'ops@fueld.com',
      vatNumber: 'VAT-123',
      companyRegistrationNumber: 'NO123456',
      fraudPreventionText: 'Verify bank details by phone.',
      latePaymentInterest: '2%',
    })
    .returning();

  const [supplier] = await db
    .insert(counterparties)
    .values({
      tenantId: seeded.tenant.id,
      name: 'Supplier Co',
      type: 'SUPPLIER',
      types: ['SUPPLIER'],
      country: 'Denmark',
    })
    .returning();

  const [bankAccount] = await db
    .insert(bankAccounts)
    .values({
      counterpartyId: invoicingCompany!.id,
      label: 'USD Main',
      bankName: 'DNB',
      accountName: 'Fueld Trading Ltd',
      accountNumber: '12345678',
      iban: 'NO9386011117947',
      swiftBic: 'DNBANOKKXXX',
      currency: 'USD',
      branchAddress: 'Oslo',
      intermediaryBank: 'Intermediary',
      isDefault: true,
    })
    .returning();

  const login = await loginE2E(seeded.user.email, seeded.password);
  const token = login.accessToken as string;

  const created = await requestJson('/orders', {
    method: 'POST',
    token,
    body: {
      clientId: seeded.client.id,
      vesselId: seeded.vessel.id,
      placeId: seeded.place.id,
      invoicingCompanyId: invoicingCompany!.id,
      supplierId: supplier!.id,
      bankAccountId: bankAccount!.id,
      customerPaymentTermType: 'CREDIT',
      customerCreditDays: 30,
      supplierPaymentTermType: 'CREDIT',
      supplierCreditDays: 15,
      termsAndConditions: 'This ${documentName} is issued by ${companyName}.',
    },
  });

  expect(created.status).toBe(200);
  expect(created.data?.success).toBe(true);

  const orderId = created.data?.data?.id as string;

  const saveItems = await requestJson(`/orders/${orderId}/items`, {
    method: 'PUT',
    token,
    body: {
      items: [
        {
          productType: 'VLSFO',
          quantity: '100',
          unit: 'MT',
          salesPrice: '500',
          description: 'ISO 8217',
        },
      ],
    },
  });

  expect(saveItems.status).toBe(200);
  expect(saveItems.data?.success).toBe(true);

  return { token, orderId, tenantId: seeded.tenant.id };
}

describe('documents + verify controller e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('serves all document PDF endpoints and includes revision headers', async () => {
    const { token, orderId } = await seedDocumentReadyOrder();

    const offer = await requestRaw(`/orders/${orderId}/offer/pdf`, { token });
    expect(offer.status).toBe(200);
    expect(offer.headers.get('content-type')).toContain('application/pdf');
    expect(offer.headers.get('content-disposition')).toContain('attachment; filename="Offer_');
    expect(offer.headers.get('x-document-revision')).toBeTruthy();
    expect(offer.headers.get('x-document-reference')).toBeTruthy();
    expect(offer.headers.get('x-document-fingerprint')).toBeTruthy();
    expect(offer.headers.get('x-document-verify-token')).toBeTruthy();

    const nomination = await requestRaw(`/orders/${orderId}/nomination/pdf`, { token });
    expect(nomination.status).toBe(200);
    expect(nomination.headers.get('content-type')).toContain('application/pdf');
    expect(nomination.headers.get('content-disposition')).toContain('attachment; filename="Nomination_');

    const proforma = await requestRaw(`/orders/${orderId}/proforma/pdf`, { token });
    expect(proforma.status).toBe(200);
    expect(proforma.headers.get('content-type')).toContain('application/pdf');
    expect(proforma.headers.get('content-disposition')).toContain('attachment; filename="Proforma_Invoice_');

    const invoice = await requestRaw(`/orders/${orderId}/invoice/pdf`, { token });
    expect(invoice.status).toBe(200);
    expect(invoice.headers.get('content-type')).toContain('application/pdf');
    expect(invoice.headers.get('content-disposition')).toContain('attachment; filename="Fueld_Invoice_');
  });

  it('maps document controller validation branches for missing order and prerequisites', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken as string;

    const missing = await requestRaw('/orders/ORDER-DOES-NOT-EXIST/offer/pdf', { token });
    expect(missing.status).toBe(404);
    expect((missing.data as any)?.success).toBe(false);
    expect(String((missing.data as any)?.message ?? '')).toContain('Order not found');

    const created = await requestJson('/orders', {
      method: 'POST',
      token,
      body: {
        clientId: seeded.client.id,
        vesselId: seeded.vessel.id,
        placeId: seeded.place.id,
      },
    });

    const orderId = created.data?.data?.id as string;

    const offerNoItems = await requestRaw(`/orders/${orderId}/offer/pdf`, { token });
    expect(offerNoItems.status).toBe(400);
    expect((offerNoItems.data as any)?.success).toBe(false);
    expect(String((offerNoItems.data as any)?.message ?? '')).toContain('Add at least one line item');

    const nominationNoItems = await requestRaw(`/orders/${orderId}/nomination/pdf`, { token });
    expect(nominationNoItems.status).toBe(400);
    expect((nominationNoItems.data as any)?.success).toBe(false);

    const proformaNoItems = await requestRaw(`/orders/${orderId}/proforma/pdf`, { token });
    expect(proformaNoItems.status).toBe(400);
    expect((proformaNoItems.data as any)?.success).toBe(false);

    const invoiceNoItems = await requestRaw(`/orders/${orderId}/invoice/pdf`, { token });
    expect(invoiceNoItems.status).toBe(400);
    expect((invoiceNoItems.data as any)?.success).toBe(false);

    const sendMissing = await requestJson('/orders/ORDER-DOES-NOT-EXIST/send-email', {
      method: 'POST',
      token,
      body: {
        documentType: 'INVOICE',
        recipientEmail: 'finance@example.com',
        subject: 'Test',
        htmlBody: '<p>test</p>',
      },
    });
    expect(sendMissing.status).toBe(404);
    expect(sendMissing.data?.success).toBe(false);
    expect(String(sendMissing.data?.message ?? '')).toContain('Order not found');
  });

  it('serves verify endpoints publicly and returns 404 for unknown token/order', async () => {
    const { orderId } = await seedDocumentReadyOrder();

    const offer = await requestRaw(`/verify/${orderId}/offer`);
    expect(offer.status).toBe(200);
    expect(offer.headers.get('content-type')).toContain('application/pdf');
    expect(offer.headers.get('content-disposition')).toContain('inline; filename="');
    expect(offer.headers.get('x-document-reference')).toBeTruthy();

    const proforma = await requestRaw(`/verify/${orderId}/proforma-invoice`);
    expect(proforma.status).toBe(200);
    expect(proforma.headers.get('content-type')).toContain('application/pdf');

    const invoice = await requestRaw(`/verify/${orderId}/invoice`);
    expect(invoice.status).toBe(200);
    expect(invoice.headers.get('content-type')).toContain('application/pdf');

    const missingOrder = await requestRaw('/verify/ORDER-DOES-NOT-EXIST/offer');
    expect(missingOrder.status).toBe(404);
    expect((missingOrder.data as any)?.success).toBe(false);

    const missingToken = await requestRaw('/verify/token/not-a-real-token');
    expect(missingToken.status).toBe(404);
    expect((missingToken.data as any)?.success).toBe(false);
  });

  it('sends invoice email successfully via /send-email', async () => {
    const { token, orderId } = await seedDocumentReadyOrder();
    mockGraphToken = 'graph-access-token';

    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response('', { status: 202 });
    }) as typeof fetch;

    try {
      const sent = await requestJson(`/orders/${orderId}/send-email`, {
        method: 'POST',
        token,
        body: {
          documentType: 'INVOICE',
          recipientEmail: 'finance@example.com',
          subject: 'Invoice Test',
          htmlBody: '<p>Invoice body</p>',
        },
      });

      expect(sent.status).toBe(200);
      expect(sent.data?.success).toBe(true);
      expect(String(sent.data?.message ?? '')).toContain('INVOICE');
      expect(String(sent.data?.message ?? '')).toContain('finance@example.com');

      expect(calls.length).toBe(1);
      expect(calls[0]?.url).toBe('https://graph.microsoft.com/v1.0/me/sendMail');

      const graphPayload = JSON.parse(String(calls[0]?.init?.body));
      expect(graphPayload.message.toRecipients[0].emailAddress.address).toBe('finance@example.com');
      expect(String(graphPayload.message.subject)).toBe('Invoice Test');
      expect(graphPayload.message.attachments?.length).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      mockGraphToken = null;
    }
  });

  it('sends offer email via /send-email with correct PDF attachment', async () => {
    const { token, orderId } = await seedDocumentReadyOrder();
    mockGraphToken = 'graph-offer-token';

    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response('', { status: 202 });
    }) as typeof fetch;

    try {
      const sent = await requestJson(`/orders/${orderId}/send-email`, {
        method: 'POST',
        token,
        body: {
          documentType: 'OFFER',
          recipientEmail: 'buyer@example.com',
          subject: 'Offer for MV TEST',
          htmlBody: '<p>Offer body</p>',
        },
      });

      expect(sent.status).toBe(200);
      expect(sent.data?.success).toBe(true);
      expect(String(sent.data?.message ?? '')).toContain('OFFER');
      expect(sent.data?.channel).toBe('GRAPH');
      expect(String(sent.data?.pdfFileName ?? '')).toContain('Offer_');

      const graphPayload = JSON.parse(String(calls[0]?.init?.body));
      expect(graphPayload.message.subject).toBe('Offer for MV TEST');
      expect(graphPayload.message.attachments[0].contentType).toBe('application/pdf');
    } finally {
      globalThis.fetch = originalFetch;
      mockGraphToken = null;
    }
  });

  it('sends nomination email via /send-email', async () => {
    const { token, orderId } = await seedDocumentReadyOrder();
    mockGraphToken = 'graph-nom-token';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response('', { status: 202 })) as typeof fetch;

    try {
      const sent = await requestJson(`/orders/${orderId}/send-email`, {
        method: 'POST',
        token,
        body: {
          documentType: 'NOMINATION',
          recipientEmail: 'supplier@example.com',
          subject: 'Nomination',
          htmlBody: '<p>Nomination body</p>',
        },
      });

      expect(sent.status).toBe(200);
      expect(sent.data?.success).toBe(true);
      expect(String(sent.data?.message ?? '')).toContain('NOMINATION');
      expect(String(sent.data?.pdfFileName ?? '')).toContain('Nomination_');
    } finally {
      globalThis.fetch = originalFetch;
      mockGraphToken = null;
    }
  });

  it('sends proforma email via /send-email', async () => {
    const { token, orderId } = await seedDocumentReadyOrder();
    mockGraphToken = 'graph-proforma-token';

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response('', { status: 202 })) as typeof fetch;

    try {
      const sent = await requestJson(`/orders/${orderId}/send-email`, {
        method: 'POST',
        token,
        body: {
          documentType: 'PROFORMA',
          recipientEmail: 'accounting@example.com',
          subject: 'Proforma Invoice',
          htmlBody: '<p>Proforma body</p>',
        },
      });

      expect(sent.status).toBe(200);
      expect(sent.data?.success).toBe(true);
      expect(String(sent.data?.message ?? '')).toContain('PROFORMA');
      expect(String(sent.data?.pdfFileName ?? '')).toContain('Proforma_Invoice_');
    } finally {
      globalThis.fetch = originalFetch;
      mockGraphToken = null;
    }
  });

  it('rejects send-email with invalid document type', async () => {
    const { token, orderId } = await seedDocumentReadyOrder();

    const res = await requestJson(`/orders/${orderId}/send-email`, {
      method: 'POST',
      token,
      body: {
        documentType: 'BOGUS_TYPE',
        recipientEmail: 'test@example.com',
        subject: 'Test',
        htmlBody: '<p>test</p>',
      },
    });

    // Elysia's typebox validation rejects unknown union values
    expect(res.status).not.toBe(200);
  });

  it('rejects send-email with CC containing invalid email', async () => {
    const { token, orderId } = await seedDocumentReadyOrder();

    const res = await requestJson(`/orders/${orderId}/send-email`, {
      method: 'POST',
      token,
      body: {
        documentType: 'INVOICE',
        recipientEmail: 'valid@example.com',
        ccEmails: ['not-an-email'],
        subject: 'Test',
        htmlBody: '<p>test</p>',
      },
    });

    // Should reject the invalid CC email via format: 'email' validation
    expect(res.status).not.toBe(200);
  });

  it('returns pre-filled email defaults via /email-defaults for INVOICE', async () => {
    const { token, orderId } = await seedDocumentReadyOrder();

    const res = await requestJson(`/orders/${orderId}/email-defaults`, {
      method: 'POST',
      token,
      body: { documentType: 'INVOICE' },
    });

    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(true);

    const d = res.data?.data;
    // Should return email metadata
    expect(typeof d?.subject).toBe('string');
    expect(typeof d?.htmlBody).toBe('string');
    expect(typeof d?.senderName).toBe('string');
    expect(typeof d?.senderEmail).toBe('string');
    expect(Array.isArray(d?.ccEmails)).toBe(true);

    // Subject should contain Invoice
    expect(String(d?.subject ?? '')).toContain('Invoice');

    // HTML body should contain vessel name and branding
    expect(String(d?.htmlBody ?? '')).toContain('Fueld');
    expect(String(d?.htmlBody ?? '')).toContain('Dear Customer');

    // CC should include sender email
    expect(d?.ccEmails?.length).toBeGreaterThanOrEqual(1);
  });

  it('returns pre-filled email defaults via /email-defaults for NOMINATION', async () => {
    const { token, orderId } = await seedDocumentReadyOrder();

    const res = await requestJson(`/orders/${orderId}/email-defaults`, {
      method: 'POST',
      token,
      body: { documentType: 'NOMINATION' },
    });

    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(true);
    expect(String(res.data?.data?.subject ?? '')).toContain('Nomination');
    expect(String(res.data?.data?.htmlBody ?? '')).toContain('Dear Supplier');
  });

  it('returns pre-filled email defaults via /email-defaults for OFFER', async () => {
    const { token, orderId } = await seedDocumentReadyOrder();

    const res = await requestJson(`/orders/${orderId}/email-defaults`, {
      method: 'POST',
      token,
      body: { documentType: 'OFFER' },
    });

    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(true);
    expect(String(res.data?.data?.subject ?? '')).toContain('Offer');
    expect(String(res.data?.data?.htmlBody ?? '')).toContain('Dear Customer');
  });

  it('returns pre-filled email defaults via /email-defaults for PROFORMA', async () => {
    const { token, orderId } = await seedDocumentReadyOrder();

    const res = await requestJson(`/orders/${orderId}/email-defaults`, {
      method: 'POST',
      token,
      body: { documentType: 'PROFORMA' },
    });

    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(true);
    expect(String(res.data?.data?.subject ?? '')).toContain('Proforma Invoice');
    expect(String(res.data?.data?.htmlBody ?? '')).toContain('Dear Customer');
  });

  it('returns 404 for /email-defaults on non-existent order', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken as string;

    const res = await requestJson('/orders/ORDER-DOES-NOT-EXIST/email-defaults', {
      method: 'POST',
      token,
      body: { documentType: 'INVOICE' },
    });

    expect(res.data?.success).toBe(false);
    expect(String(res.data?.message ?? '')).toContain('Order not found');
  });

  it('send-email validates missing prerequisites per document type', async () => {
    const seeded = await seedAuthBasics();
    const login = await loginE2E(seeded.user.email, seeded.password);
    const token = login.accessToken as string;

    // Create order with no invoicing company, no supplier, no bank account
    const created = await requestJson('/orders', {
      method: 'POST',
      token,
      body: {
        clientId: seeded.client.id,
        vesselId: seeded.vessel.id,
        placeId: seeded.place.id,
      },
    });
    const orderId = created.data?.data?.id as string;

    // Add items so we pass the "no items" check
    await requestJson(`/orders/${orderId}/items`, {
      method: 'PUT',
      token,
      body: {
        items: [{ productType: 'VLSFO', quantity: '100', unit: 'MT', salesPrice: '500' }],
      },
    });

    // OFFER requires invoicingCompanyId
    const offer = await requestJson(`/orders/${orderId}/send-email`, {
      method: 'POST',
      token,
      body: {
        documentType: 'OFFER',
        recipientEmail: 'test@example.com',
        subject: 'Test',
        htmlBody: '<p>test</p>',
      },
    });
    expect(offer.data?.success).toBe(false);
    expect(String(offer.data?.message ?? '')).toContain('invoicing company');

    // INVOICE requires bankAccountId
    const invoice = await requestJson(`/orders/${orderId}/send-email`, {
      method: 'POST',
      token,
      body: {
        documentType: 'INVOICE',
        recipientEmail: 'test@example.com',
        subject: 'Test',
        htmlBody: '<p>test</p>',
      },
    });
    expect(invoice.data?.success).toBe(false);
    expect(String(invoice.data?.message ?? '')).toContain('bank account');

    // PROFORMA requires bankAccountId
    const proforma = await requestJson(`/orders/${orderId}/send-email`, {
      method: 'POST',
      token,
      body: {
        documentType: 'PROFORMA',
        recipientEmail: 'test@example.com',
        subject: 'Test',
        htmlBody: '<p>test</p>',
      },
    });
    expect(proforma.data?.success).toBe(false);
    expect(String(proforma.data?.message ?? '')).toContain('bank account');
  });

  it('verifies token successfully and returns 410 when revision has expired', async () => {
    const { token, orderId, tenantId } = await seedDocumentReadyOrder();
    const db = await getDb();

    const offer = await requestRaw(`/orders/${orderId}/offer/pdf`, { token });
    expect(offer.status).toBe(200);
    const verifyToken = offer.headers.get('x-document-verify-token');
    expect(verifyToken).toBeTruthy();

    const proforma = await requestRaw(`/orders/${orderId}/proforma/pdf`, { token });
    expect(proforma.status).toBe(200);

    const invoice = await requestRaw(`/orders/${orderId}/invoice/pdf`, { token });
    expect(invoice.status).toBe(200);

    const tokenVerifyOk = await requestRaw(`/verify/token/${verifyToken}`);
    expect(tokenVerifyOk.status).toBe(200);
    expect(tokenVerifyOk.headers.get('content-type')).toContain('application/pdf');
    expect(tokenVerifyOk.headers.get('x-document-reference')).toBeTruthy();

    await db
      .update(tenants)
      .set({ settings: { documentVerificationLinkExpiryDays: 1 } })
      .where(eq(tenants.id, tenantId));

    await db
      .update(documentRevisions)
      .set({ issuedAt: new Date('2000-01-01T00:00:00.000Z') })
      .where(eq(documentRevisions.tenantId, tenantId));

    const expiredOffer = await requestRaw(`/verify/${orderId}/offer`);
    expect(expiredOffer.status).toBe(410);
    expect((expiredOffer.data as any)?.success).toBe(false);
    expect(String((expiredOffer.data as any)?.message ?? '')).toContain('expired');

    const expiredProforma = await requestRaw(`/verify/${orderId}/proforma-invoice`);
    expect(expiredProforma.status).toBe(410);
    expect((expiredProforma.data as any)?.success).toBe(false);
    expect(String((expiredProforma.data as any)?.message ?? '')).toContain('expired');

    const expiredInvoice = await requestRaw(`/verify/${orderId}/invoice`);
    expect(expiredInvoice.status).toBe(410);
    expect((expiredInvoice.data as any)?.success).toBe(false);
    expect(String((expiredInvoice.data as any)?.message ?? '')).toContain('expired');

    const expiredToken = await requestRaw(`/verify/token/${verifyToken}`);
    expect(expiredToken.status).toBe(410);
    expect((expiredToken.data as any)?.success).toBe(false);
    expect(String((expiredToken.data as any)?.message ?? '')).toContain('expired');

    const revisionByToken = await db
      .select()
      .from(documentRevisions)
      .where(and(eq(documentRevisions.verifyToken, String(verifyToken)), eq(documentRevisions.tenantId, tenantId)))
      .limit(1);
    expect(revisionByToken.length).toBe(1);
  });
});
