/**
 * E2E tests for:
 * 1. GET /orders/:id/email-log — email history endpoint
 * 2. EMAIL_SENT activity logging on send-email and inquiry/send
 * 3. POST /orders/:id/inquiry/send — inquiry e2e (sending, supplier_inquiries tracking,
 *    WhatsApp group notification on first inquiry)
 * 4. GET /orders/:id/inquiry/sent — inquiry sent listing
 * 5. PATCH /orders/:id/inquiry/sent/:inquiryId — internal trader reply capture
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';
import {
  bankAccounts,
  companyEmails,
  counterparties,
  emailLog,
  emailRules,
  orderSuppliers,
  orders,
  places,
  portSuppliers,
  supplierInquiryItemQuotes,
  supplierInquiries,
  tenants,
} from '../src/db/schema';
import { getDb, seedAuthBasics, truncateAll } from './helpers/db';

// ── Mock Graph token so send-email uses Graph channel ──
let mockGraphToken: string | null = null;

const originalModule = await import('../src/modules/auth/microsoft-oauth.service');
mock.module('../src/modules/auth/microsoft-oauth.service', () => ({
  ...originalModule,
  acquireGraphTokenForUser: async () => mockGraphToken,
}));

// ── Mock WhatsApp group message to capture calls ──
let whatsappGroupCalls: Array<{ userId: string; groupJid: string; text: string }> = [];

mock.module('../src/modules/whatsapp/whatsapp.service', () => ({
  sendWhatsAppGroupMessage: async (userId: string, groupJid: string, text: string) => {
    whatsappGroupCalls.push({ userId, groupJid, text });
    return { success: true, message: 'sent' };
  },
  sendWhatsAppMessage: async () => ({ success: true, message: 'sent' }),
  startWhatsAppSession: async () => ({ status: 'disconnected' }),
  getWhatsAppStatus: async () => ({ connected: false, status: 'disconnected' }),
  disconnectWhatsApp: async () => {},
  listWhatsAppGroups: async () => [],
  reconnectStoredSessions: async () => {},
}));

// ── Mock logActivity to capture calls synchronously (fire-and-forget can't be reliably tested in shared DB) ──
let logActivityCalls: Array<Record<string, any>> = [];
const originalActivityModule = await import('../src/modules/activity/activity.service');
mock.module('../src/modules/activity/activity.service', () => ({
  ...originalActivityModule,
  logActivity: async (params: Record<string, any>) => {
    logActivityCalls.push(params);
  },
}));

const { loginE2E, requestJson, requestRaw } = await import('./helpers/e2e');

// ── Shared seed: order with all prerequisites ──────────────────────
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

  const [supplier2] = await db
    .insert(counterparties)
    .values({
      tenantId: seeded.tenant.id,
      name: 'Supplier Two',
      type: 'SUPPLIER',
      types: ['SUPPLIER'],
      country: 'Sweden',
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
    },
  });

  expect(created.status).toBe(200);
  const orderId = created.data?.data?.id as string;

  const saveItems = await requestJson(`/orders/${orderId}/items`, {
    method: 'PUT',
    token,
    body: {
      items: [
        { productType: 'VLSFO', quantity: '100', unit: 'MT', salesPrice: '500', description: 'ISO 8217' },
        { productType: 'LSMGO', quantity: '50', unit: 'MT', salesPrice: '600', description: 'Low sulphur' },
      ],
    },
  });
  expect(saveItems.status).toBe(200);

  return {
    token,
    orderId,
    tenantId: seeded.tenant.id,
    userId: seeded.user.id,
    place: seeded.place,
    client: seeded.client,
    vessel: seeded.vessel,
    supplier: supplier!,
    supplier2: supplier2!,
    invoicingCompany: invoicingCompany!,
  };
}

// ── Helper: stub fetch for Microsoft Graph ──────────────────────────
function stubGraphFetch() {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response('', { status: 202 });
  }) as typeof fetch;

  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

describe('email tracking, inquiry send & WhatsApp group notifications', () => {
  beforeEach(async () => {
    await truncateAll();
    mockGraphToken = null;
    whatsappGroupCalls = [];
    logActivityCalls = [];
  });

  // ════════════════════════════════════════════════════════════════════
  //  1. GET /orders/:id/email-log
  // ════════════════════════════════════════════════════════════════════

  describe('GET /orders/:id/email-log', () => {
    it('returns empty array when no emails have been sent', async () => {
      const { token, orderId } = await seedDocumentReadyOrder();

      const res = await requestJson(`/orders/${orderId}/email-log`, { token });
      expect(res.status).toBe(200);
      expect(res.data?.success).toBe(true);
      expect(res.data?.data).toEqual([]);
    });

    it('returns 404 for non-existent order', async () => {
      const seeded = await seedAuthBasics();
      const login = await loginE2E(seeded.user.email, seeded.password);

      const res = await requestJson('/orders/NON-EXISTENT-ID/email-log', {
        token: login.accessToken as string,
      });
      expect(res.data?.success).toBe(false);
      expect(String(res.data?.message ?? '')).toContain('not found');
    });

    it('returns email log entries after sending documents', async () => {
      const { token, orderId, userId } = await seedDocumentReadyOrder();
      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        // Send an invoice
        const sent1 = await requestJson(`/orders/${orderId}/send-email`, {
          method: 'POST',
          token,
          body: {
            documentType: 'INVOICE',
            recipientEmail: 'client@example.com',
            subject: 'Invoice #001',
            htmlBody: '<p>Invoice</p>',
          },
        });
        expect(sent1.status).toBe(200);
        expect(sent1.data?.success).toBe(true);

        // Send an offer
        const sent2 = await requestJson(`/orders/${orderId}/send-email`, {
          method: 'POST',
          token,
          body: {
            documentType: 'OFFER',
            recipientEmail: 'buyer@example.com',
            ccEmails: ['cc1@example.com'],
            subject: 'Offer for bunker',
            htmlBody: '<p>Offer</p>',
          },
        });
        expect(sent2.status).toBe(200);

        // Fetch email log
        const logRes = await requestJson(`/orders/${orderId}/email-log`, { token });
        expect(logRes.status).toBe(200);
        expect(logRes.data?.success).toBe(true);

        const logs = logRes.data?.data as any[];
        expect(logs.length).toBe(2);

        // Most recent first (desc order)
        expect(logs[0].documentType).toBe('OFFER');
        expect(logs[0].sentTo).toBe('buyer@example.com');
        expect(logs[0].ccEmails).toContain('cc1@example.com');
        expect(logs[0].subject).toBe('Offer for bunker');
        expect(logs[0].channel).toBe('GRAPH');
        expect(logs[0].status).toBe('SENT');
        expect(logs[0].sentByName).toBeTruthy();
        expect(logs[0].createdAt).toBeTruthy();

        expect(logs[1].documentType).toBe('INVOICE');
        expect(logs[1].sentTo).toBe('client@example.com');
        expect(logs[1].subject).toBe('Invoice #001');
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });

    it('includes PDF filename in email log entries', async () => {
      const { token, orderId } = await seedDocumentReadyOrder();
      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        await requestJson(`/orders/${orderId}/send-email`, {
          method: 'POST',
          token,
          body: {
            documentType: 'INVOICE',
            recipientEmail: 'client@example.com',
            subject: 'Invoice with PDF',
            htmlBody: '<p>Invoice</p>',
          },
        });

        const logRes = await requestJson(`/orders/${orderId}/email-log`, { token });
        const logs = logRes.data?.data as any[];
        expect(logs.length).toBe(1);
        expect(logs[0].pdfFileName).toBeTruthy();
        expect(String(logs[0].pdfFileName)).toContain('Invoice_');
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════
  //  2. EMAIL_SENT activity logging
  // ════════════════════════════════════════════════════════════════════

  describe('EMAIL_SENT activity logging', () => {
    it('logs EMAIL_SENT activity when sending a document email', async () => {
      const { token, orderId } = await seedDocumentReadyOrder();
      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        const res = await requestJson(`/orders/${orderId}/send-email`, {
          method: 'POST',
          token,
          body: {
            documentType: 'INVOICE',
            recipientEmail: 'finance@example.com',
            subject: 'Invoice email',
            htmlBody: '<p>body</p>',
          },
        });
        expect(res.status).toBe(200);

        // logActivity is mocked and captured synchronously
        const emailCalls = logActivityCalls.filter(c => c.action === 'EMAIL_SENT');
        expect(emailCalls.length).toBeGreaterThanOrEqual(1);

        const call = emailCalls[0]!;
        expect(call.entityType).toBe('order');
        expect(call.entityId).toBe(orderId);
        expect(call.metadata?.documentType).toBe('INVOICE');
        expect(call.metadata?.recipientEmail).toBe('finance@example.com');
        expect(call.metadata?.subject).toBe('Invoice email');
        expect(call.metadata?.channel).toBeTruthy();
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });

    it('passes tenantId to logActivity', async () => {
      const { token, orderId, tenantId } = await seedDocumentReadyOrder();
      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        await requestJson(`/orders/${orderId}/send-email`, {
          method: 'POST',
          token,
          body: {
            documentType: 'OFFER',
            recipientEmail: 'buyer@example.com',
            subject: 'Offer email',
            htmlBody: '<p>offer</p>',
          },
        });

        const emailCalls = logActivityCalls.filter(c => c.action === 'EMAIL_SENT');
        expect(emailCalls.length).toBeGreaterThanOrEqual(1);
        expect(emailCalls[0]!.tenantId).toBe(tenantId);
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });

    it('logs EMAIL_SENT for inquiry batch send with recipients in metadata', async () => {
      const { token, orderId, supplier, supplier2 } = await seedDocumentReadyOrder();
      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier.id, supplierName: 'Supplier Co', email: 'sup1@example.com' },
              { supplierId: supplier2.id, supplierName: 'Supplier Two', email: 'sup2@example.com' },
            ],
            subject: 'RFQ for bunkers',
            htmlBody: '<p>inquiry</p>',
          },
        });

        const emailCalls = logActivityCalls.filter(c => c.action === 'EMAIL_SENT');
        expect(emailCalls.length).toBeGreaterThanOrEqual(1);

        const inquiryCall = emailCalls.find(c => c.metadata?.documentType === 'INQUIRY');
        expect(inquiryCall).toBeTruthy();

        expect(inquiryCall!.metadata.documentType).toBe('INQUIRY');
        expect(inquiryCall!.metadata.count).toBe(2);
        expect(String(inquiryCall!.metadata.recipients)).toContain('Supplier Co');
        expect(String(inquiryCall!.metadata.recipients)).toContain('Supplier Two');
        expect(inquiryCall!.metadata.subject).toBe('RFQ for bunkers');
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════
  //  3. POST /orders/:id/inquiry/send — Inquiry sending
  // ════════════════════════════════════════════════════════════════════

  describe('POST /orders/:id/inquiry/send', () => {
    it('sends inquiry to multiple suppliers and returns results', async () => {
      const { token, orderId, supplier, supplier2 } = await seedDocumentReadyOrder();
      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        const res = await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier.id, supplierName: 'Supplier Co', email: 'sup1@example.com' },
              { supplierId: supplier2.id, supplierName: 'Supplier Two', email: 'sup2@example.com' },
            ],
            subject: 'Bunker inquiry',
            htmlBody: '<p>Please quote</p>',
          },
        });

        expect(res.status).toBe(200);
        expect(res.data?.success).toBe(true);
        expect(String(res.data?.message)).toContain('2/2');

        const results = res.data?.data as any[];
        expect(results.length).toBe(2);
        expect(results[0].success).toBe(true);
        expect(results[1].success).toBe(true);

        // Verify Graph was called twice (one per supplier)
        expect(stub.calls.length).toBe(2);
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });

    it('returns 404 for non-existent order', async () => {
      const seeded = await seedAuthBasics();
      const login = await loginE2E(seeded.user.email, seeded.password);

      const res = await requestJson('/orders/BAD-ORDER-ID/inquiry/send', {
        method: 'POST',
        token: login.accessToken as string,
        body: {
          suppliers: [{ supplierId: 'x', supplierName: 'X', email: 'x@example.com' }],
          subject: 'test',
          htmlBody: '<p>test</p>',
        },
      });
      expect(res.data?.success).toBe(false);
      expect(String(res.data?.message ?? '')).toContain('not found');
    });

    it('returns 400 when order has no items', async () => {
      const seeded = await seedAuthBasics();
      const db = await getDb();

      const [invoicingCompany] = await db
        .insert(counterparties)
        .values({ tenantId: seeded.tenant.id, name: 'Own Co', type: 'SUPPLIER', types: ['SUPPLIER'], isOwnCompany: true })
        .returning();

      const login = await loginE2E(seeded.user.email, seeded.password);
      const token = login.accessToken as string;

      // Create order without items
      const created = await requestJson('/orders', {
        method: 'POST',
        token,
        body: {
          clientId: seeded.client.id,
          vesselId: seeded.vessel.id,
          placeId: seeded.place.id,
          invoicingCompanyId: invoicingCompany!.id,
        },
      });
      const orderId = created.data?.data?.id;

      const res = await requestJson(`/orders/${orderId}/inquiry/send`, {
        method: 'POST',
        token,
        body: {
          suppliers: [{ supplierId: 'x', supplierName: 'X', email: 'x@example.com' }],
          subject: 'test',
          htmlBody: '<p>test</p>',
        },
      });

      expect(res.status).toBe(400);
      expect(res.data?.success).toBe(false);
      expect(String(res.data?.message ?? '')).toContain('line item');
    });

    it('records supplier inquiries in the database', async () => {
      const { token, orderId, supplier } = await seedDocumentReadyOrder();
      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier.id, supplierName: 'Supplier Co', email: 'supplier@example.com' },
            ],
            subject: 'RFQ',
            htmlBody: '<p>inquiry</p>',
          },
        });

        const db = await getDb();
        const rows = await db
          .select()
          .from(supplierInquiries)
          .where(eq(supplierInquiries.orderId, orderId));

        expect(rows.length).toBe(1);
        expect(rows[0]!.supplierId).toBe(supplier.id);
        expect(rows[0]!.email).toBe('supplier@example.com');
        expect(rows[0]!.subject).toBe('RFQ');
        expect(rows[0]!.status).toBe('SENT');
        expect(rows[0]!.sentAt).toBeTruthy();
        expect(rows[0]!.quoteTokenHash).toBeTruthy();
        expect(rows[0]!.quoteTokenExpiresAt).toBeTruthy();
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });

    it('stores a response deadline when provided', async () => {
      const { token, orderId, supplier } = await seedDocumentReadyOrder();
      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier.id, supplierName: 'Supplier Co', email: 'supplier@example.com' },
            ],
            subject: 'RFQ',
            htmlBody: '<p>inquiry</p>',
            responseDeadlineAt: '2026-03-12T10:00:00.000Z',
          },
        });

        const db = await getDb();
        const rows = await db
          .select()
          .from(supplierInquiries)
          .where(eq(supplierInquiries.orderId, orderId));

        expect(rows[0]!.responseDeadlineAt?.toISOString()).toBe('2026-03-12T10:00:00.000Z');
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });

    it('allows supplier quote submission through the public token link', async () => {
      const { token, orderId, supplier } = await seedDocumentReadyOrder();
      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        const sendRes = await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier.id, supplierName: 'Supplier Co', email: 'supplier@example.com' },
            ],
            subject: 'RFQ for ${name}',
            htmlBody: '<p>Good day ${name},</p><p>Submit here: ${quoteFormUrl}</p>',
          },
        });

        expect(sendRes.status).toBe(200);
        expect(stub.calls.length).toBe(1);

        const graphPayload = JSON.parse(String(stub.calls[0]!.init?.body ?? '{}')) as any;
        const htmlBody = String(graphPayload.message?.body?.content ?? '');
        const tokenMatch = htmlBody.match(/supplier-quote\/([a-f0-9]{48})/i);
        expect(tokenMatch).toBeTruthy();
        const publicToken = tokenMatch?.[1] ?? '';

        const publicGet = await requestJson(`/supplier-inquiries/${publicToken}`);
        expect(publicGet.status).toBe(200);
        expect(publicGet.data?.success).toBe(true);
        expect(publicGet.data?.data?.items?.length).toBe(2);

        const publicPost = await requestJson(`/supplier-inquiries/${publicToken}/quote`, {
          method: 'POST',
          body: {
            canDeliver: true,
            items: publicGet.data.data.items.map((item: any, index: number) => ({
              orderItemId: item.orderItemId,
              price: index === 0 ? '450.50' : '610.00',
            })),
          },
        });

        expect(publicPost.status).toBe(200);
        expect(publicPost.data?.success).toBe(true);

        const db = await getDb();
        const inquiryRows = await db
          .select()
          .from(supplierInquiries)
          .where(eq(supplierInquiries.orderId, orderId));
        expect(inquiryRows.length).toBe(1);
        expect(inquiryRows[0]!.status).toBe('QUOTED');
        expect(inquiryRows[0]!.respondedAt).toBeTruthy();
        expect(inquiryRows[0]!.quotedAt).toBeTruthy();
        expect(inquiryRows[0]!.canDeliver).toBe(true);

        const quoteRows = await db
          .select()
          .from(supplierInquiryItemQuotes)
          .where(eq(supplierInquiryItemQuotes.supplierInquiryId, inquiryRows[0]!.id));
        expect(quoteRows.length).toBe(2);
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });

    it('accepts partial quotes with qualifiers and notes', async () => {
      const { token, orderId, supplier } = await seedDocumentReadyOrder();
      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier.id, supplierName: 'Supplier Co', email: 'supplier@example.com' },
            ],
            subject: 'RFQ for ${name}',
            htmlBody: '<p>Good day ${name},</p><p>Submit here: ${quoteFormUrl}</p>',
          },
        });

        const graphPayload = JSON.parse(String(stub.calls[0]!.init?.body ?? '{}')) as any;
        const htmlBody = String(graphPayload.message?.body?.content ?? '');
        const tokenMatch = htmlBody.match(/supplier-quote\/([a-f0-9]{48})/i);
        const publicToken = tokenMatch?.[1] ?? '';

        const publicGet = await requestJson(`/supplier-inquiries/${publicToken}`);
        expect(publicGet.status).toBe(200);

        const publicPost = await requestJson(`/supplier-inquiries/${publicToken}/quote`, {
          method: 'POST',
          body: {
            canDeliver: true,
            quoteValidUntil: '2026-03-10T12:00:00.000Z',
            deliveryWindow: '12 Mar AM barge',
            supplierPaymentTerms: 'Net 30 days',
            supplierComment: 'Subject to terminal slot confirmation',
            items: publicGet.data.data.items.map((item: any, index: number) => ({
              orderItemId: item.orderItemId,
              price: index === 0 ? '450.50' : null,
              note: index === 1 ? 'Not available ex-pipe' : null,
            })),
          },
        });

        expect(publicPost.status).toBe(200);
        expect(publicPost.data?.success).toBe(true);

        const sentRes = await requestJson(`/orders/${orderId}/inquiry/sent`, { token });
        const inquiry = (sentRes.data?.data as any[])[0];
        expect(inquiry.quoteLineCount).toBe(1);
        expect(inquiry.deliveryWindow).toBe('12 Mar AM barge');
        expect(inquiry.supplierPaymentTerms).toBe('Net 30 days');
        expect(inquiry.supplierComment).toBe('Subject to terminal slot confirmation');
        expect(inquiry.quoteValidUntil).toBe('2026-03-10T12:00:00.000Z');
        expect(inquiry.items[1].price).toBeNull();
        expect(inquiry.items[1].note).toBe('Not available ex-pipe');
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });

    it('sends one automatic reminder before the response deadline', async () => {
      const { token, orderId, supplier } = await seedDocumentReadyOrder();
      const { processPendingInquiryReminders } = await import('../src/modules/documents/supplier-inquiry.service');
      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier.id, supplierName: 'Supplier Co', email: 'supplier@example.com' },
            ],
            subject: 'Reminder RFQ',
            htmlBody: '<p>body</p>',
            responseDeadlineAt: new Date(Date.now() + (2 * 3_600_000)).toISOString(),
          },
        });

        const db = await getDb();
        const [inquiry] = await db
          .select()
          .from(supplierInquiries)
          .where(eq(supplierInquiries.orderId, orderId));

        await db
          .update(supplierInquiries)
          .set({ sentAt: new Date(Date.now() - (2 * 3_600_000)) })
          .where(eq(supplierInquiries.id, inquiry!.id));

        const sentCount = await processPendingInquiryReminders();
        expect(sentCount).toBe(1);
        expect(stub.calls).toHaveLength(2);

        const refreshed = await db
          .select()
          .from(supplierInquiries)
          .where(eq(supplierInquiries.id, inquiry!.id));
        expect(refreshed[0]!.reminderSentAt).toBeTruthy();
        expect(refreshed[0]!.reminderCount).toBe(1);

        const logs = await db
          .select()
          .from(emailLog)
          .where(eq(emailLog.orderId, orderId));
        expect(logs.map((row) => row.subject)).toContain('Reminder: Reminder RFQ');
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });

    it('omits supplier response links when disabled in inquiry settings', async () => {
      const { token, orderId, supplier, tenantId } = await seedDocumentReadyOrder();
      const db = await getDb();
      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      await db
        .update(tenants)
        .set({
          settings: {
            inquirySettings: {
              supplierResponseUrlEnabled: false,
              autoMarkNoReplyAfterHours: 168,
            },
          },
        })
        .where(eq(tenants.id, tenantId));

      try {
        const defaultsRes = await requestJson(`/orders/${orderId}/inquiry/defaults`, {
          method: 'POST',
          token,
          body: {},
        });

        expect(defaultsRes.status).toBe(200);
        expect(String(defaultsRes.data?.data?.htmlBody ?? '')).not.toContain('Submit quote online');
        expect(String(defaultsRes.data?.data?.htmlBody ?? '')).not.toContain('${quoteFormUrl}');

        await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier.id, supplierName: 'Supplier Co', email: 'supplier@example.com' },
            ],
            subject: 'RFQ for ${name}',
            htmlBody: '<p>Submit here: ${quoteFormUrl}</p>',
          },
        });

        expect(stub.calls.length).toBe(1);
        const graphPayload = JSON.parse(String(stub.calls[0]!.init?.body ?? '{}')) as any;
        const htmlBody = String(graphPayload.message?.body?.content ?? '');
        expect(htmlBody).not.toContain('supplier-quote/');
        expect(htmlBody).not.toContain('${quoteFormUrl}');

        const rows = await db
          .select()
          .from(supplierInquiries)
          .where(eq(supplierInquiries.orderId, orderId));
        expect(rows).toHaveLength(1);
        expect(rows[0]!.quoteTokenHash).toBeNull();
        expect(rows[0]!.quoteTokenExpiresAt).toBeNull();
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });

    it('upserts supplier inquiry on re-send (updates existing)', async () => {
      const { token, orderId, supplier } = await seedDocumentReadyOrder();
      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        // First send
        await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier.id, supplierName: 'Supplier Co', email: 'first@example.com' },
            ],
            subject: 'First RFQ',
            htmlBody: '<p>inquiry 1</p>',
          },
        });

        // Second send — should upsert
        await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier.id, supplierName: 'Supplier Co', email: 'updated@example.com' },
            ],
            subject: 'Updated RFQ',
            htmlBody: '<p>inquiry 2</p>',
          },
        });

        const db = await getDb();
        const rows = await db
          .select()
          .from(supplierInquiries)
          .where(eq(supplierInquiries.orderId, orderId));

        // Should still have just 1 row (upserted)
        expect(rows.length).toBe(1);
        expect(rows[0]!.email).toBe('updated@example.com');
        expect(rows[0]!.subject).toBe('Updated RFQ');
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });

    it('logs inquiry emails to email_log table', async () => {
      const { token, orderId, supplier, supplier2 } = await seedDocumentReadyOrder();
      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier.id, supplierName: 'Supplier Co', email: 'sup1@example.com' },
              { supplierId: supplier2.id, supplierName: 'Supplier Two', email: 'sup2@example.com' },
            ],
            subject: 'Inquiry Subject',
            htmlBody: '<p>body</p>',
          },
        });

        const db = await getDb();
        const logs = await db
          .select()
          .from(emailLog)
          .where(eq(emailLog.orderId, orderId));

        // Each supplier gets its own email log entry
        expect(logs.length).toBe(2);

        const types = logs.map(l => l.documentType);
        expect(types.every(t => t === 'INQUIRY')).toBe(true);

        const recipients = logs.map(l => l.sentTo).sort();
        expect(recipients).toEqual(['sup1@example.com', 'sup2@example.com']);
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });

    it('sends additional recipients as separate emails and keeps supplier tracking supplier-only', async () => {
      const { token, orderId, supplier, tenantId, invoicingCompany } = await seedDocumentReadyOrder();
      const db = await getDb();

      await db.insert(emailRules).values({
        tenantId,
        ownCompanyId: invoicingCompany.id,
        documentType: 'INQUIRY',
        ruleType: 'BCC',
        email: 'audit@example.com',
        label: 'Audit',
      });

      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier.id, supplierName: 'Supplier Co', email: 'sup1@example.com' },
            ],
            recipientEmails: ['manual@example.com', 'watcher@example.com'],
            subject: 'Inquiry Subject',
            htmlBody: '<p>body</p>',
          },
        });

        const logs = await db
          .select()
          .from(emailLog)
          .where(eq(emailLog.orderId, orderId));

        const inquiries = await db
          .select()
          .from(supplierInquiries)
          .where(eq(supplierInquiries.orderId, orderId));

        expect(logs.length).toBe(3);
        expect(logs.map((log) => log.sentTo).sort()).toEqual([
          'manual@example.com',
          'sup1@example.com',
          'watcher@example.com',
        ]);
        expect(logs.every((log) => ((log.bccEmails ?? []) as string[]).includes('audit@example.com'))).toBe(true);
        expect(logs.some((log) => ((log.bccEmails ?? []) as string[]).includes('manual@example.com'))).toBe(false);
        expect(logs.some((log) => ((log.bccEmails ?? []) as string[]).includes('watcher@example.com'))).toBe(false);

        expect(inquiries.length).toBe(1);
        expect(inquiries[0]!.supplierId).toBe(supplier.id);
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════
  //  4. WhatsApp group notification on first inquiry
  // ════════════════════════════════════════════════════════════════════

  describe('WhatsApp group notification', () => {
    it('sends WhatsApp group message on first inquiry when configured', async () => {
      const { token, orderId, tenantId, supplier } = await seedDocumentReadyOrder();
      const db = await getDb();

      // Configure WhatsApp group JID in tenant settings
      await db
        .update(tenants)
        .set({
          settings: {
            whatsappEnabled: true,
            whatsappDefaultGroupJid: '120363001234567890@g.us',
          },
        })
        .where(eq(tenants.id, tenantId));

      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier.id, supplierName: 'Supplier Co', email: 'sup@example.com' },
            ],
            subject: 'First inquiry',
            htmlBody: '<p>inquiry</p>',
          },
        });

        // Wait briefly for async WhatsApp call
        await new Promise(r => setTimeout(r, 200));

        expect(whatsappGroupCalls.length).toBe(1);
        const call = whatsappGroupCalls[0]!;
        expect(call.groupJid).toBe('120363001234567890@g.us');
        expect(call.text).toContain('Inquiry Sent');
        expect(call.text).toContain('Supplier Co');
        expect(call.text).toContain('VLSFO');
        expect(call.text).toContain('LSMGO');
        expect(call.text).toContain('Test Vessel');
        expect(call.text).toContain('Test Port');
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });

    it('does NOT send WhatsApp group message on second inquiry batch', async () => {
      const { token, orderId, tenantId, supplier, supplier2 } = await seedDocumentReadyOrder();
      const db = await getDb();

      await db
        .update(tenants)
        .set({
          settings: {
            whatsappEnabled: true,
            whatsappDefaultGroupJid: '120363001234567890@g.us',
          },
        })
        .where(eq(tenants.id, tenantId));

      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        // First batch
        await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier.id, supplierName: 'Supplier Co', email: 'sup1@example.com' },
            ],
            subject: 'First inquiry',
            htmlBody: '<p>inquiry</p>',
          },
        });

        await new Promise(r => setTimeout(r, 200));
        expect(whatsappGroupCalls.length).toBe(1);

        // Reset
        whatsappGroupCalls = [];

        // Second batch to different supplier
        await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier2.id, supplierName: 'Supplier Two', email: 'sup2@example.com' },
            ],
            subject: 'Follow-up inquiry',
            htmlBody: '<p>inquiry 2</p>',
          },
        });

        await new Promise(r => setTimeout(r, 200));

        // Should NOT have sent another WA group message
        expect(whatsappGroupCalls.length).toBe(0);
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });

    it('does NOT send WhatsApp when group JID is not configured', async () => {
      const { token, orderId, supplier } = await seedDocumentReadyOrder();
      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        // No WA settings configured — default tenant settings
        await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier.id, supplierName: 'Supplier Co', email: 'sup@example.com' },
            ],
            subject: 'No WA inquiry',
            htmlBody: '<p>inquiry</p>',
          },
        });

        await new Promise(r => setTimeout(r, 200));
        expect(whatsappGroupCalls.length).toBe(0);
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });

    it('does NOT send WhatsApp when whatsappEnabled is false', async () => {
      const { token, orderId, tenantId, supplier } = await seedDocumentReadyOrder();
      const db = await getDb();

      await db
        .update(tenants)
        .set({
          settings: {
            whatsappEnabled: false,
            whatsappDefaultGroupJid: '120363001234567890@g.us',
          },
        })
        .where(eq(tenants.id, tenantId));

      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier.id, supplierName: 'Supplier Co', email: 'sup@example.com' },
            ],
            subject: 'Disabled WA',
            htmlBody: '<p>inquiry</p>',
          },
        });

        await new Promise(r => setTimeout(r, 200));
        expect(whatsappGroupCalls.length).toBe(0);
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });

    it('does NOT send WhatsApp when first inquiry group sharing is disabled', async () => {
      const { token, orderId, tenantId, supplier } = await seedDocumentReadyOrder();
      const db = await getDb();

      await db
        .update(tenants)
        .set({
          settings: {
            whatsappEnabled: true,
            whatsappDefaultGroupJid: '120363001234567890@g.us',
            whatsappFirstInquiryGroupNotificationEnabled: false,
          },
        })
        .where(eq(tenants.id, tenantId));

      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier.id, supplierName: 'Supplier Co', email: 'sup@example.com' },
            ],
            subject: 'Disabled first inquiry WA',
            htmlBody: '<p>inquiry</p>',
          },
        });

        await new Promise(r => setTimeout(r, 200));
        expect(whatsappGroupCalls.length).toBe(0);
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });

    it('WhatsApp message includes product details with quantities', async () => {
      const { token, orderId, tenantId, supplier } = await seedDocumentReadyOrder();
      const db = await getDb();

      await db
        .update(tenants)
        .set({
          settings: {
            whatsappEnabled: true,
            whatsappDefaultGroupJid: '120363001234567890@g.us',
          },
        })
        .where(eq(tenants.id, tenantId));

      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier.id, supplierName: 'Supplier Co', email: 'sup@example.com' },
            ],
            subject: 'Products inquiry',
            htmlBody: '<p>inquiry</p>',
          },
        });

        await new Promise(r => setTimeout(r, 200));
        expect(whatsappGroupCalls.length).toBe(1);

        const text = whatsappGroupCalls[0]!.text;
        // Should contain product lines with quantities
        expect(text).toContain('100');
        expect(text).toContain('MT');
        expect(text).toContain('VLSFO');
        expect(text).toContain('50');
        expect(text).toContain('LSMGO');
        // Should contain "Suppliers (1)" count
        expect(text).toContain('Suppliers (1)');
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════
  //  5. GET /orders/:id/inquiry/sent
  // ════════════════════════════════════════════════════════════════════

  describe('GET /orders/:id/inquiry/sent', () => {
    it('returns empty array when no inquiries sent', async () => {
      const { token, orderId } = await seedDocumentReadyOrder();

      const res = await requestJson(`/orders/${orderId}/inquiry/sent`, { token });
      expect(res.status).toBe(200);
      expect(res.data?.success).toBe(true);
      expect(res.data?.data).toEqual([]);
    });

    it('returns sent inquiries with supplier names', async () => {
      const { token, orderId, supplier, supplier2 } = await seedDocumentReadyOrder();
      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier.id, supplierName: 'Supplier Co', email: 'sup1@example.com' },
              { supplierId: supplier2.id, supplierName: 'Supplier Two', email: 'sup2@example.com' },
            ],
            subject: 'Inquiry sub',
            htmlBody: '<p>body</p>',
          },
        });

        const res = await requestJson(`/orders/${orderId}/inquiry/sent`, { token });
        expect(res.status).toBe(200);
        expect(res.data?.success).toBe(true);

        const data = res.data?.data as any[];
        expect(data.length).toBe(2);

        // Check supplier names from join
        const names = data.map((d: any) => d.supplierName).sort();
        expect(names).toEqual(['Supplier Co', 'Supplier Two']);

        // Check fields
        expect(data[0].supplierId).toBeTruthy();
        expect(data[0].email).toBeTruthy();
        expect(data[0].subject).toBe('Inquiry sub');
        expect(data[0].status).toBe('SENT');
        expect(data[0].sentAt).toBeTruthy();
        expect(data[0].responseHours).toBeNull();
        expect(data[0].items).toHaveLength(2);
        expect(data[0].items[0]?.orderItemId).toBeTruthy();
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });

    it('auto-marks stale sent inquiries as no reply', async () => {
      const { token, orderId, supplier, tenantId } = await seedDocumentReadyOrder();
      const db = await getDb();
      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      await db
        .update(tenants)
        .set({
          settings: {
            inquirySettings: {
              supplierResponseUrlEnabled: true,
              autoMarkNoReplyAfterHours: 1,
            },
          },
        })
        .where(eq(tenants.id, tenantId));

      try {
        await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier.id, supplierName: 'Supplier Co', email: 'supplier@example.com' },
            ],
            subject: 'Inquiry sub',
            htmlBody: '<p>body</p>',
          },
        });

        await db
          .update(supplierInquiries)
          .set({
            sentAt: new Date(Date.now() - (2 * 3_600_000)),
            updatedAt: new Date(Date.now() - (2 * 3_600_000)),
          })
          .where(eq(supplierInquiries.orderId, orderId));

        const res = await requestJson(`/orders/${orderId}/inquiry/sent`, { token });
        expect(res.status).toBe(200);
        expect(res.data?.success).toBe(true);
        expect(res.data?.data?.[0]?.status).toBe('NO_REPLY');

        const rows = await db
          .select()
          .from(supplierInquiries)
          .where(eq(supplierInquiries.orderId, orderId));
        expect(rows[0]!.status).toBe('NO_REPLY');
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });

    it('returns 404 for non-existent order', async () => {
      const seeded = await seedAuthBasics();
      const login = await loginE2E(seeded.user.email, seeded.password);

      const res = await requestJson('/orders/NONEXISTENT/inquiry/sent', {
        token: login.accessToken as string,
      });
      expect(res.data?.success).toBe(false);
    });
  });

  describe('GET /orders/:id/inquiry/suppliers', () => {
    it('returns supplier performance stats for overall and place-specific deliveries', async () => {
      const { token, orderId, tenantId, userId, supplier, supplier2, place, client, vessel } = await seedDocumentReadyOrder();
      const db = await getDb();

      const [otherPlace] = await db
        .insert(places)
        .values({
          name: 'Other Port',
          country: 'Singapore',
          countryIso: 'SGP',
        })
        .returning();

      await db.insert(companyEmails).values({
        counterpartyId: supplier.id,
        emailType: 'inquiry',
        email: 'supplier@example.com',
        isPrimary: true,
        addedById: userId,
        addedByName: 'Test User',
      });

      await db.insert(portSuppliers).values({
        placeId: place.id,
        companyId: supplier.id,
        products: ['VLSFO', 'LSMGO'],
        addedById: userId,
        addedByName: 'Test User',
      });

      const historicalOrders = await db.insert(orders).values([
        {
          tenantId,
          clientId: client.id,
          vesselId: vessel.id,
          placeId: place.id,
          supplierId: supplier.id,
          status: 'DELIVERED',
          currency: 'USD',
          deliveredAt: new Date('2026-02-20T10:00:00.000Z'),
        },
        {
          tenantId,
          clientId: client.id,
          vesselId: vessel.id,
          placeId: otherPlace!.id,
          supplierId: supplier.id,
          status: 'PAID',
          currency: 'USD',
          deliveredAt: new Date('2026-01-15T10:00:00.000Z'),
        },
        {
          tenantId,
          clientId: client.id,
          vesselId: vessel.id,
          placeId: place.id,
          supplierId: supplier.id,
          status: 'INVOICED',
          currency: 'USD',
          deliveredAt: new Date('2026-03-10T15:30:00.000Z'),
        },
      ]).returning();

      await db.insert(orderSuppliers).values([
        {
          orderId: historicalOrders[0]!.id,
          companyId: supplier.id,
          sortOrder: 0,
          isPrimary: true,
          deliveredAt: new Date('2026-02-20T10:00:00.000Z'),
        },
        {
          orderId: historicalOrders[1]!.id,
          companyId: supplier.id,
          sortOrder: 0,
          isPrimary: true,
          deliveredAt: new Date('2026-01-15T10:00:00.000Z'),
        },
        {
          orderId: historicalOrders[2]!.id,
          companyId: supplier.id,
          sortOrder: 0,
          isPrimary: true,
          deliveredAt: new Date('2026-03-10T15:30:00.000Z'),
        },
        {
          orderId: historicalOrders[2]!.id,
          companyId: supplier2.id,
          sortOrder: 1,
          isPrimary: false,
          deliveredAt: new Date('2026-03-10T12:00:00.000Z'),
        },
      ]);

      await db.insert(supplierInquiries).values([
        {
          orderId: historicalOrders[0]!.id,
          supplierId: supplier.id,
          email: 'supplier@example.com',
          subject: 'Quoted before',
          status: 'QUOTED',
          sentByUserId: userId,
          sentAt: new Date('2026-02-01T10:00:00.000Z'),
          respondedAt: new Date('2026-02-01T16:00:00.000Z'),
          quotedAt: new Date('2026-02-01T16:00:00.000Z'),
          canDeliver: true,
        },
        {
          orderId: historicalOrders[1]!.id,
          supplierId: supplier.id,
          email: 'supplier@example.com',
          subject: 'No reply before',
          status: 'NO_REPLY',
          sentByUserId: userId,
          sentAt: new Date('2026-02-05T10:00:00.000Z'),
          canDeliver: null,
        },
      ]);

      const res = await requestJson(`/orders/${orderId}/inquiry/suppliers`, { token });

      expect(res.status).toBe(200);
      expect(res.data?.success).toBe(true);

      const rows = res.data?.data as Array<Record<string, any>>;
      expect(rows.length).toBe(1);
      expect(rows[0]?.supplierId).toBe(supplier.id);
      expect(rows[0]?.performance).toEqual({
        deliveredCountOverall: 3,
        deliveredCountAtPlace: 2,
        lastDeliveredAtOverall: '2026-03-10T15:30:00.000Z',
        lastDeliveredAtPlace: '2026-03-10T15:30:00.000Z',
        sentCount: 2,
        quotedCount: 1,
        declinedCount: 0,
        noReplyCount: 1,
        respondedCount: 1,
        deliverableCount: 1,
        nonDeliverableCount: 0,
        averageResponseHours: 6,
        totalResponseHours: 6,
      });
    });
  });

  describe('PATCH /orders/:id/inquiry/sent/:inquiryId', () => {
    it('allows traders to record a quoted supplier response with per-line prices', async () => {
      const { token, orderId, supplier } = await seedDocumentReadyOrder();
      mockGraphToken = 'graph-token';
      const stub = stubGraphFetch();

      try {
        await requestJson(`/orders/${orderId}/inquiry/send`, {
          method: 'POST',
          token,
          body: {
            suppliers: [
              { supplierId: supplier.id, supplierName: 'Supplier Co', email: 'supplier@example.com' },
            ],
            subject: 'RFQ',
            htmlBody: '<p>inquiry</p>',
          },
        });

        const sentRes = await requestJson(`/orders/${orderId}/inquiry/sent`, { token });
        const inquiry = (sentRes.data?.data as any[])[0];
        expect(inquiry).toBeTruthy();

        const patchRes = await requestJson(`/orders/${orderId}/inquiry/sent/${inquiry.id}`, {
          method: 'PATCH',
          token,
          body: {
            status: 'QUOTED',
            respondedAt: '2026-03-01T12:00:00.000Z',
            declineReason: null,
            items: inquiry.items.map((item: any, index: number) => ({
              orderItemId: item.orderItemId,
              price: index === 0 ? '455.00' : '612.50',
            })),
          },
        });

        expect(patchRes.status).toBe(200);
        expect(patchRes.data?.success).toBe(true);

        const db = await getDb();
        const rows = await db.select().from(supplierInquiries).where(eq(supplierInquiries.id, inquiry.id));
        expect(rows[0]!.status).toBe('QUOTED');
        expect(rows[0]!.respondedAt?.toISOString()).toBe('2026-03-01T12:00:00.000Z');
        expect(rows[0]!.quotedAt?.toISOString()).toBe('2026-03-01T12:00:00.000Z');
        expect(rows[0]!.canDeliver).toBe(true);

        const quoteRows = await db
          .select()
          .from(supplierInquiryItemQuotes)
          .where(eq(supplierInquiryItemQuotes.supplierInquiryId, inquiry.id));
        expect(quoteRows).toHaveLength(2);
      } finally {
        stub.restore();
        mockGraphToken = null;
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════
  //  6. POST /orders/:id/inquiry/defaults
  // ════════════════════════════════════════════════════════════════════

  describe('POST /orders/:id/inquiry/defaults', () => {
    it('returns pre-filled inquiry email defaults', async () => {
      const { token, orderId } = await seedDocumentReadyOrder();

      const res = await requestJson(`/orders/${orderId}/inquiry/defaults`, {
        method: 'POST',
        token,
      });

      expect(res.status).toBe(200);
      expect(res.data?.success).toBe(true);

      const d = res.data?.data;
      expect(typeof d?.subject).toBe('string');
      expect(typeof d?.htmlBody).toBe('string');
      expect(typeof d?.senderName).toBe('string');
      expect(typeof d?.senderEmail).toBe('string');
      expect(typeof d?.responseDeadlineAt).toBe('string');

      // Subject should reference the vessel or port
      const subject = String(d?.subject ?? '');
      expect(subject.length).toBeGreaterThan(0);

      // Body should contain the greeting
      const body = String(d?.htmlBody ?? '');
      expect(body).toContain('Good day');
    });

    it('keeps delivery dates in the default inquiry body and omits reply timing when deadline is disabled', async () => {
      const { token, orderId } = await seedDocumentReadyOrder();
      const db = await getDb();

      await db
        .update(orders)
        .set({
          eta: new Date('2026-04-15T12:00:00.000Z'),
          etd: new Date('2026-04-16T12:00:00.000Z'),
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId));

      const [tenant] = await db
        .select({ id: tenants.id, settings: tenants.settings })
        .from(tenants)
        .limit(1);

      await db
        .update(tenants)
        .set({
          settings: {
            ...((tenant?.settings as Record<string, unknown> | null) ?? {}),
            inquirySettings: {
              ...((((tenant?.settings as Record<string, any> | null) ?? {}).inquirySettings as Record<string, unknown> | undefined) ?? {}),
              defaultResponseDeadlineHours: null,
            },
          },
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, tenant!.id));

      const res = await requestJson(`/orders/${orderId}/inquiry/defaults`, {
        method: 'POST',
        token,
      });

      expect(res.status).toBe(200);
      expect(res.data?.success).toBe(true);
      expect(res.data?.data?.responseDeadlineAt).toBeNull();

      const body = String(res.data?.data?.htmlBody ?? '');
      expect(body).toContain('Delivery:');
      expect(body).toContain('15 Apr 2026 to 16 Apr 2026');
      expect(body).not.toContain('Reply within:');
    });

    it('returns 404 for non-existent order', async () => {
      const seeded = await seedAuthBasics();
      const login = await loginE2E(seeded.user.email, seeded.password);

      const res = await requestJson('/orders/NONEXISTENT/inquiry/defaults', {
        method: 'POST',
        token: login.accessToken as string,
      });
      expect(res.data?.success).toBe(false);
    });
  });
});
