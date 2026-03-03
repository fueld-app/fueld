import { beforeEach, describe, expect, it } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { bankAccounts, counterparties, documentRevisions, tenants } from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';
import { loginE2E, requestJson, requestRaw } from './helpers/e2e';

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

    const sendMissing = await requestJson('/orders/ORDER-DOES-NOT-EXIST/invoice/send', {
      method: 'POST',
      token,
      body: {
        accessToken: 'token',
        recipientEmail: 'finance@example.com',
      },
    });
    expect(sendMissing.status).toBe(200);
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

  it('sends invoice email successfully via /invoice/send', async () => {
    const { token, orderId } = await seedDocumentReadyOrder();

    const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init?: RequestInit }> = [];

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response('', { status: 202 });
    }) as typeof fetch;

    try {
      const sent = await requestJson(`/orders/${orderId}/invoice/send`, {
        method: 'POST',
        token,
        body: {
          accessToken: 'graph-access-token',
          recipientEmail: 'finance@example.com',
        },
      });

      expect(sent.status).toBe(200);
      expect(sent.data?.success).toBe(true);
      expect(String(sent.data?.message ?? '')).toContain('Invoice');
      expect(String(sent.data?.message ?? '')).toContain('finance@example.com');

      expect(calls.length).toBe(1);
      expect(calls[0]?.url).toBe('https://graph.microsoft.com/v1.0/me/sendMail');

      const graphPayload = JSON.parse(String(calls[0]?.init?.body));
      expect(graphPayload.message.toRecipients[0].emailAddress.address).toBe('finance@example.com');
      expect(String(graphPayload.message.subject)).toContain('Invoice');
      expect(graphPayload.message.attachments?.length).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
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
