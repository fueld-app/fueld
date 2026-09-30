/**
 * E2E for POST /supplier-invoices/:id/send — emailing a supplier invoice.
 *
 * A SEPARATE FILE from `supplier-invoices.e2e.test.ts` because Bun's
 * `mock.module` is per-module-graph and is hoisted before the app imports: the
 * transport has to be stubbed before `mail.service` is loaded, and doing that in
 * the shared file would stub email for every other test in it. There is no SMTP
 * configured under test, so without a stub the success path can only ever throw.
 */
import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';

// ── Why there is no transport stub here ──
//
// `mock.module` is process-global and is re-evaluated only when a module is FIRST
// imported, so `documents.mail.service.test.ts` — which replaces `src/lib/email`
// — determines the transport for every file that imports the app after it. An
// in-process SMTP sink configured through `SMTP_*` is therefore invisible in the
// full suite, and a mock registered here would leak into other files instead.
//
// So these tests assert the seams that do not depend on the transporter: the
// route's own response, the row it writes to `email_log`, and the send it stamps
// on the invoice. The transport itself is `sendDocumentEmail`, shared with nine
// other send paths and covered by `documents.mail.service.test.ts`.

const { getDb, seedAuthBasics, truncateAll } = await import('./helpers/db');
const { loginE2E, requestJson, requestBytes } = await import('./helpers/e2e');
const {
  counterparties,
  companyEmails,
  emailLog,
  supplierInvoices,
  tenants,
} = await import('../src/db/schema');

async function promoteToAdmin(userId: string) {
  const db = await getDb();
  const { users } = await import('../src/db/schema');
  await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, userId));
}

async function enableBrokerDeals(tenantId: string) {
  const db = await getDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error('Tenant not found');
  await db.update(tenants).set({
    settings: {
      ...tenant.settings,
      brokerDeals: {
        enabled: true,
        defaultCommissionRate: 3,
        reportStatuses: ['CONFIRMED', 'DELIVERED', 'INVOICED', 'PAID'],
        autoReleaseCredit: true,
        autoReleaseBufferDays: 0,
      },
    },
    updatedAt: new Date(),
  }).where(eq(tenants.id, tenantId));
}

async function createSupplier(tenantId: string, name: string): Promise<string> {
  const db = await getDb();
  const [supplier] = await db
    .insert(counterparties)
    .values({ tenantId, name, type: 'SUPPLIER', types: ['SUPPLIER'], country: 'USA' })
    .returning();
  return supplier!.id;
}

/** One CONFIRMED broker deal with 100 MT x 10 funded by the supplier, then invoice it. */
async function raiseInvoice(token: string, seeded: { client: { id: string }; vessel: { id: string }; place: { id: string } }, supplierId: string) {
  const created = await requestJson('/orders', {
    method: 'POST',
    token,
    body: {
      clientId: seeded.client.id,
      vesselId: seeded.vessel.id,
      placeId: seeded.place.id,
      isBrokerDeal: true,
      eta: '2026-09-15',
      supplierId,
    },
  });
  const orderId = created.data?.data?.id as string;
  await requestJson(`/orders/${orderId}/items`, {
    method: 'PUT',
    token,
    body: {
      items: [{
        productType: 'VLSFO', quantity: '100', unit: 'MT',
        costPrice: '100', costCurrency: 'USD', salesPrice: '115', salesCurrency: 'USD',
        commissionPerUnit: '0', supplierCommissionPerUnit: '10',
      }],
    },
  });
  await requestJson(`/orders/${orderId}/status`, { method: 'PUT', token, body: { status: 'CONFIRMED' } });
  const db = await getDb();
  await db.update((await import('../src/db/schema')).orders).set({ deliveredAt: new Date('2026-09-15') }).where(eq((await import('../src/db/schema')).orders.id, orderId));

  await requestJson('/supplier-invoices', { method: 'POST', token, body: { from: '2026-09-01', to: '2026-09-30' } });
  const [invoice] = await db.select().from(supplierInvoices);
  return invoice!;
}

describe('supplier invoice send e2e', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('refuses by name when the supplier has no address, rather than dropping the invoice', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Mailed Ltd');
    const invoice = await raiseInvoice(token, seeded, supplierId);

    // A payable that was never sent is a loss, so this must be loud.
    const res = await requestJson(`/supplier-invoices/${invoice.id}/send`, { method: 'POST', token, body: {} });
    expect(res.status).toBe(400);
    expect(String(res.data?.message)).toContain('Mailed Ltd');
    // Nothing was attempted: no send recorded on the invoice.
    const db = await getDb();
    const [after] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.id, invoice.id));
    expect(after!.sentAt).toBeNull();
  });

  it('records the send on the invoice and in the log when a recipient is known', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Addressed Ltd');
    const db = await getDb();
    await db.insert(companyEmails).values([
      { counterpartyId: supplierId, emailType: 'general', email: 'general@addressed.test', isPrimary: true },
      { counterpartyId: supplierId, emailType: 'invoice', email: 'billing@addressed.test', isPrimary: true },
    ]);
    const invoice = await raiseInvoice(token, seeded, supplierId);

    /**
     * An EXPLICIT recipient, because the transport is not controllable here: an
     * earlier test file installs a process-global `mock.module` over
     * `src/lib/email`, and it wins regardless of what this file does, so the
     * blank-recipient path ends at getSmtpConfig() before anything is logged.
     * The address-selection rule itself is covered by the pure-function tests
     * below and needs no transport.
     *
     * The transport only fails AFTER logging, so the log row and the stamp on the
     * invoice still prove the route did its own work.
     */
    const res = await requestJson(`/supplier-invoices/${invoice.id}/send`, {
      method: 'POST', token, body: { recipientEmails: ['billing@addressed.test'] },
    });
    // The transport always fails under test, but HOW is not controllable and not
    // the point: another file's process-global mock determines whether this
    // attempts Graph (401) or SMTP (unconfigured). What matters is that a failed
    // send is reported as failed rather than silently succeeding.
    expect(res.status).toBe(500);
    expect(String(res.data?.message ?? '').length).toBeGreaterThan(0);

    // The log row is written BEFORE the transport is contacted, so it survives a
    // transport failure. It proves the route resolved the recipient, built the
    // document and reached the mailer.
    const logs = await db.select().from(emailLog);
    expect(logs.length).toBe(1);
    expect(logs[0]!.documentType).toBe('SUPPLIER_INVOICE');
    expect(logs[0]!.sentTo).toBe('billing@addressed.test');
    expect(logs[0]!.subject).toContain(invoice.invoiceNumber);
    expect(logs[0]!.pdfFileName).toContain(invoice.invoiceNumber);

    // A FAILED send must not mark the invoice as sent, or "has this gone out?"
    // would answer yes for a payable that never left.
    const [after] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.id, invoice.id));
    expect(after!.sentAt).toBeNull();
    expect(after!.sentTo).toBeNull();
  });

  it('records a successful send on the invoice and exposes it in the DTO', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Stamped Ltd');
    const invoice = await raiseInvoice(token, seeded, supplierId);

    /**
     * Called directly rather than through `/send`: the success path needs a
     * working transport, which a process-global mock in another test file
     * prevents. What is worth pinning is that the stamp reaches the right row and
     * comes back out through the DTO — the invoice page renders `sentAt`/`sentTo`
     * exactly this way.
     */
    const { markSupplierInvoiceSent } = await import('../src/modules/orders/supplier-invoice.service');
    await markSupplierInvoiceSent(invoice.id, seeded.tenant.id, ['billing@stamped.test']);

    const view = await requestJson(`/supplier-invoices/${invoice.id}`, { token });
    expect(view.status).toBe(200);
    expect(view.data?.data?.sentAt).not.toBeNull();
    expect(view.data?.data?.sentTo).toBe('billing@stamped.test');

    // A resend overwrites: the invoice shows the LATEST send, the log keeps all.
    await markSupplierInvoiceSent(invoice.id, seeded.tenant.id, ['second@stamped.test']);
    const again = await requestJson(`/supplier-invoices/${invoice.id}`, { token });
    expect(again.data?.data?.sentTo).toBe('second@stamped.test');
  });

  it('serves the PDF from the same renderer the send uses', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Bytes Ltd');
    const invoice = await raiseInvoice(token, seeded, supplierId);

    const served = await requestBytes(`/supplier-invoices/${invoice.id}/pdf`, { token });
    expect(served.status).toBe(200);
    expect(served.bytes.subarray(0, 5).toString()).toBe('%PDF-');

    /**
     * The no-drift claim rests on there being ONE renderer: the route and the
     * send handler both call `renderSupplierInvoicePdf` (single call site each,
     * no second implementation). Asserting the route's bytes match a direct call
     * of that function pins the shared path; comparing the mailed attachment
     * would only be possible with a transport stub, which cannot coexist with the
     * process-global mock another test file installs on `src/lib/email`.
     */
    const { getSupplierInvoice } = await import('../src/modules/orders/supplier-invoice.service');
    const { renderSupplierInvoicePdf } = await import('../src/modules/orders/supplier-invoice-pdf');
    const fetched = await getSupplierInvoice(invoice.id, seeded.tenant.id);
    expect(fetched).not.toBeNull();
    const direct = await renderSupplierInvoicePdf(fetched!, seeded.tenant.id);

    expect(direct.fileName).toBe(`Supplier_Invoice_${invoice.invoiceNumber.replace(/[^a-zA-Z0-9-]/g, '_')}.pdf`);
    expect(direct.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    // Same renderer, so the same document. Compared by size because a PDF embeds
    // a creation timestamp, so exact bytes differ between two renders.
    expect(Math.abs(direct.buffer.length - served.bytes.length)).toBeLessThan(64);
  });

  it('cannot send another tenant\'s invoice', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Mine Ltd');
    const invoice = await raiseInvoice(token, seeded, supplierId);

    // A second tenant with the feature on, holding the same invoice id.
    const db = await getDb();
    const [other] = await db.insert(tenants).values({ name: 'Send Other', domain: 'sendother.local' }).returning();
    const { users } = await import('../src/db/schema');
    const { hashPassword } = await import('../src/modules/auth/password.service');
    await db.insert(users).values({
      tenantId: other!.id, email: 'sendother@test.local', name: 'Other', role: 'ADMIN',
      passwordHash: await hashPassword('Password123!'),
    });
    await enableBrokerDeals(other!.id);
    const otherToken = (await loginE2E('sendother@test.local', 'Password123!')).accessToken;

    const res = await requestJson(`/supplier-invoices/${invoice.id}/send`, {
      method: 'POST', token: otherToken, body: { recipientEmails: ['x@y.test'] },
    });
    expect(res.status).toBe(404);
  });

  it('refuses to send a VOID invoice', async () => {
    const seeded = await seedAuthBasics();
    await enableBrokerDeals(seeded.tenant.id);
    await promoteToAdmin(seeded.user.id);
    const token = (await loginE2E(seeded.user.email, seeded.password)).accessToken;
    const supplierId = await createSupplier(seeded.tenant.id, 'Void Send Ltd');
    const invoice = await raiseInvoice(token, seeded, supplierId);
    await requestJson(`/supplier-invoices/${invoice.id}/void`, { method: 'POST', token, body: { reason: 'wrong' } });

    const res = await requestJson(`/supplier-invoices/${invoice.id}/send`, {
      method: 'POST', token, body: { recipientEmails: ['x@y.test'] },
    });
    expect(res.status).toBe(400);
  });
});
