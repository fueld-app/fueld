/**
 * Invoice materialization (Phase 0).
 *
 * Before this existed, nothing in production ever inserted an `invoices` row:
 * the PDF carried a placeholder number, collections/aging were permanently
 * empty, and payment recompute updated zero rows. These tests defend the
 * invariants that keep that from silently regressing.
 */
import { describe, it, expect, beforeEach } from 'bun:test';

beforeEach(async () => {
  await truncateAll();
});
import { and, asc, eq, ne } from 'drizzle-orm';
import { db } from '../src/db';
import {
  invoices,
  orders,
  orderItems,
  customerPayments,
  invoiceNumberSequences,
} from '../src/db/schema';
import {
  allocateInvoiceNumber,
  computeInvoiceAmount,
  computeInvoiceDueDate,
  deriveInvoiceDisplayStatus,
  MixedCurrencyInvoiceError,
  deriveInvoiceStatus,
  ensureOrderInvoice,
  recomputeInvoiceAmountPaid,
  resolvePaymentInvoiceTarget,
  voidOrderInvoice,
  InvoiceAlreadyVoidError,
  InvoiceNotFoundError,
} from '../src/modules/orders/invoice.service';
import { seedBasics, truncateAll } from './helpers/db';
import { documentRevisions } from '../src/db/schema';
import { assertValidSchedule, InvalidScheduleError, listOrderPaymentSchedule, setOrderPaymentSchedule } from '../src/modules/orders/payment-schedule.service';
import { splitAmountByPercent } from '../src/modules/orders/invoice-amounts';
import { __documentTestUtils } from '../src/modules/documents/document.service';

type Basics = Awaited<ReturnType<typeof seedBasics>>;

async function createOrderWithItems(
  basics: Basics,
  overrides: Partial<typeof orders.$inferInsert> = {},
) {
  const { tenant, client, vessel, place } = basics;
  const [order] = await db
    .insert(orders)
    .values({
      tenantId: tenant.id,
      clientId: client.id,
      vesselId: vessel.id,
      placeId: place.id,
      orderNumber: `INV-TEST-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      currency: 'USD',
      status: 'DELIVERED',
      customerPaymentTermType: 'CREDIT',
      customerCreditDays: 21,
      eta: new Date('2026-09-20T10:00:00Z'),
      deliveredAt: new Date('2026-09-27T10:00:00Z'),
      ...overrides,
    })
    .returning();

  await db.insert(orderItems).values([
    {
      orderId: order!.id, productType: 'LSMGO', quantity: '402', unit: 'MT', sortOrder: 0,
      costPrice: '1702', salesPrice: '1705', costCurrency: 'USD', salesCurrency: 'USD',
    },
    {
      orderId: order!.id, productType: 'VLSFO', quantity: '100', unit: 'MT', sortOrder: 1,
      costPrice: '600', salesPrice: '610', costCurrency: 'USD', salesCurrency: 'USD',
    },
    // Legacy supplier credit-note placeholder: unpriced, must not be billed.
    {
      orderId: order!.id, productType: 'CREDIT_NOTE', quantity: '50', unit: 'MT', sortOrder: 2,
      costPrice: '-100', salesPrice: null, costCurrency: 'USD', salesCurrency: 'USD',
    },
    // Broker commission line: hidden from customer documents, must not be billed.
    {
      orderId: order!.id, productType: 'COMMISSION', quantity: '1', unit: 'MT', sortOrder: 3,
      hideOnDocuments: true, costPrice: '0', salesPrice: '9999', costCurrency: 'USD', salesCurrency: 'USD',
    },
  ]);

  return order!;
}

/** One tenant, one order. Returns `basics` so a test can add a second order. */
async function seedOrderWithItems(overrides: Partial<typeof orders.$inferInsert> = {}) {
  const basics = await seedBasics();
  return { ...basics, order: await createOrderWithItems(basics, overrides) };
}

describe('invoice due date', () => {
  it('anchors CREDIT on the delivery date plus credit days', () => {
    expect(computeInvoiceDueDate('2026-09-27T10:00:00Z', 'CREDIT', 21)).toBe('2026-10-18');
  });

  it('falls back to the issue date when nothing is dispatched', () => {
    expect(computeInvoiceDueDate(null, 'CREDIT', 30, new Date('2026-09-22T12:00:00Z'))).toBe('2026-10-22');
  });

  it('does not grant COD or PREPAY a credit term', () => {
    expect(computeInvoiceDueDate('2026-09-27T10:00:00Z', 'COD', null)).toBe('2026-09-27');
    expect(computeInvoiceDueDate('2026-09-27T10:00:00Z', 'PREPAY', 30)).toBe('2026-09-27');
  });
});

describe('invoice numbering', () => {
  it('allocates distinct, incrementing numbers under concurrency', async () => {
    const { tenant } = await seedBasics();

    const allocated = await Promise.all(Array.from({ length: 8 }, () => allocateInvoiceNumber(tenant.id)));
    expect(new Set(allocated).size).toBe(8);

    const seqs = allocated.map((n) => parseInt(n.split('-').pop()!, 10));
    expect(new Set(seqs).size).toBe(8);
    for (const n of allocated) expect(n).toMatch(/^INV-\d{4}-\d{4}$/);
  });
});

describe('issuance', () => {
  it('bills only customer-facing lines and stores the invoice facts once', async () => {
    const { order } = await seedOrderWithItems();

    expect(await computeInvoiceAmount(order.id)).toBe(((402 * 1705) + (100 * 610)).toFixed(2));

    const invoice = await ensureOrderInvoice(order.id);
    expect(invoice.status).toBe('SENT');
    expect(invoice.amount).toBe(((402 * 1705) + (100 * 610)).toFixed(2));
    expect(invoice.dueDate).toBe('2026-10-18');
    expect(invoice.amountPaid).toBe('0.00');
    expect(invoice.invoiceNumber).toMatch(/^INV-/);
  });

  it('is idempotent so regenerating a PDF cannot burn a number or move the due date', async () => {
    const { order } = await seedOrderWithItems();

    const first = await ensureOrderInvoice(order.id);
    await db.update(orders).set({ deliveredAt: new Date('2026-12-01T10:00:00Z') }).where(eq(orders.id, order.id));
    const second = await ensureOrderInvoice(order.id);

    expect(second.id).toBe(first.id);
    expect(second.invoiceNumber).toBe(first.invoiceNumber);
    expect(second.dueDate).toBe(first.dueDate);
    expect((await db.select().from(invoices).where(eq(invoices.orderId, order.id))).length).toBe(1);
  });

  it('refuses to issue a customer invoice for an internal transfer', async () => {
    const { order } = await seedOrderWithItems({ orderKind: 'INTERNAL_TRANSFER' });
    await expect(ensureOrderInvoice(order.id)).rejects.toThrow(/internal transfer/i);
  });
});

describe('void and reissue', () => {
  it('voids the old invoice, keeps it for audit, and issues a fresh number', async () => {
    const { tenant, order } = await seedOrderWithItems();
    const original = await ensureOrderInvoice(order.id);

    await db.insert(customerPayments).values({
      tenantId: tenant.id, customerId: order.clientId, orderId: order.id, invoiceId: original.id,
      amount: '1000.00', currency: 'USD', receivedAt: new Date(),
    });
    await recomputeInvoiceAmountPaid(original.id);

    const { voided, replacement } = await voidOrderInvoice(order.id);

    expect(voided.id).toBe(original.id);
    expect(voided.status).toBe('VOID');
    expect(replacement).not.toBeNull();
    expect(replacement!.id).not.toBe(original.id);
    expect(replacement!.invoiceNumber).not.toBe(original.invoiceNumber);
    expect(replacement!.status).toBe('PARTIALLY_PAID');
    // The customer was already told this due date; a reissue must not move it.
    expect(replacement!.dueDate).toBe(original.dueDate);

    // Both rows survive: the voided one for audit, the live one for the ledger.
    const all = await db.select().from(invoices).where(eq(invoices.orderId, order.id));
    expect(all.length).toBe(2);

    // The payment follows the replacement rather than stranding on the void.
    const [payment] = await db.select().from(customerPayments).where(eq(customerPayments.orderId, order.id));
    expect(payment!.invoiceId).toBe(replacement!.id);
    expect((await resolvePaymentInvoiceTarget(order.id))?.id).toBe(replacement!.id);
  });
});

describe('numbering robustness', () => {
  it('self-heals when the counter lags the table instead of failing to issue', async () => {
    const basics = await seedOrderWithItems();
    const { tenant, order } = basics;
    const first = await ensureOrderInvoice(order.id);

    // A counter that has drifted behind existing rows (restore, import, manual
    // psql) must not deadlock issuance — allocate a fresh number instead.
    await db.update(invoiceNumberSequences).set({ lastSeq: 0 }).where(eq(invoiceNumberSequences.tenantId, tenant.id));

    const secondOrder = await createOrderWithItems(basics);
    const second = await ensureOrderInvoice(secondOrder.id);

    expect(second.invoiceNumber).not.toBe(first.invoiceNumber);
    expect(second.orderId).toBe(secondOrder.id);
  });
});

describe('void without reissue', () => {
  it('leaves no live invoice, then re-issues on the next issuance', async () => {
    const { order } = await seedOrderWithItems();

    await ensureOrderInvoice(order.id);
    const { replacement } = await voidOrderInvoice(order.id, { reissue: false });
    expect(replacement).toBeNull();

    const live = await db.select().from(invoices)
      .where(and(eq(invoices.orderId, order.id), ne(invoices.status, 'VOID')));
    expect(live.length).toBe(0);

    // A later issuance must produce a fresh live invoice covering the order
    // again, not hand back the voided row.
    const reissued = await ensureOrderInvoice(order.id);
    expect(reissued.status).not.toBe('VOID');
    expect((await resolvePaymentInvoiceTarget(order.id))?.id).toBe(reissued.id);
  });

  it('does not strand money on a voided invoice when reissuing later', async () => {
    const { tenant, order } = await seedOrderWithItems();

    const original = await ensureOrderInvoice(order.id);
    await db.insert(customerPayments).values({
      tenantId: tenant.id, customerId: order.clientId, orderId: order.id, invoiceId: original.id,
      amount: '2500.00', currency: 'USD', receivedAt: new Date(),
    });
    await recomputeInvoiceAmountPaid(original.id);

    // Void first, reissue only later.
    await voidOrderInvoice(order.id, { reissue: false });
    const parked = await db.select().from(customerPayments).where(eq(customerPayments.orderId, order.id));
    expect(parked[0]!.invoiceId).toBeNull();

    // The next issuance must re-claim that money, not leave it on the void row.
    const reissued = await ensureOrderInvoice(order.id);
    expect(reissued.status).toBe('PARTIALLY_PAID');
    expect(reissued.amountPaid).toBe('2500.00');
    const reattached = await db.select().from(customerPayments).where(eq(customerPayments.orderId, order.id));
    expect(reattached[0]!.invoiceId).toBe(reissued.id);
  });

  it('reissues despite a lagging number counter and keeps the payment attached', async () => {
    const { tenant, order } = await seedOrderWithItems();
    const original = await ensureOrderInvoice(order.id);
    await db.insert(customerPayments).values({
      tenantId: tenant.id, customerId: order.clientId, orderId: order.id, invoiceId: original.id,
      amount: '500.00', currency: 'USD', receivedAt: new Date(),
    });
    await recomputeInvoiceAmountPaid(original.id);

    // Counter behind the table: the reissue must retry, not fail. A failure here
    // previously left the order with no live invoice at all.
    await db.update(invoiceNumberSequences).set({ lastSeq: 0 }).where(eq(invoiceNumberSequences.tenantId, tenant.id));

    const { voided, replacement } = await voidOrderInvoice(order.id);

    expect(voided.status).toBe('VOID');
    expect(replacement).not.toBeNull();
    expect(replacement!.invoiceNumber).not.toBe(original.invoiceNumber);
    // The money must end up on the live invoice, never on the voided one.
    expect(replacement!.amountPaid).toBe('500.00');
    const [payment] = await db.select().from(customerPayments).where(eq(customerPayments.orderId, order.id));
    expect(payment!.invoiceId).toBe(replacement!.id);
  });

  it('leaves the invoice live and settled when the reissue would be refused', async () => {
    const { tenant, order } = await seedOrderWithItems();
    const original = await ensureOrderInvoice(order.id);
    await db.insert(customerPayments).values({
      tenantId: tenant.id, customerId: order.clientId, orderId: order.id, invoiceId: original.id,
      amount: '250.00', currency: 'USD', receivedAt: new Date(),
    });
    await recomputeInvoiceAmountPaid(original.id);

    // Make the order uninvoiceable AFTER issuance, then attempt a correction.
    await db.update(orderItems)
      .set({ salesCurrency: 'EUR' })
      .where(and(eq(orderItems.orderId, order.id), eq(orderItems.productType, 'VLSFO')));

    await expect(voidOrderInvoice(order.id)).rejects.toThrow(MixedCurrencyInvoiceError);

    // Validation must precede the destructive write: no half-voided invoice.
    const live = await db.select().from(invoices)
      .where(and(eq(invoices.orderId, order.id), ne(invoices.status, 'VOID')));
    expect(live.length).toBe(1);
    expect(live[0]!.id).toBe(original.id);
    const [payment] = await db.select().from(customerPayments).where(eq(customerPayments.orderId, order.id));
    expect(payment!.invoiceId).toBe(original.id);
  });

  it('recovers payments stranded by a crashed issuance (idempotent path re-claims)', async () => {
    const { tenant, order } = await seedOrderWithItems();

    // Simulate: the invoice row was inserted, then the process died before the
    // payment claim ran, leaving money unallocated against a live invoice.
    const invoice = await ensureOrderInvoice(order.id);
    await db.insert(customerPayments).values({
      tenantId: tenant.id, customerId: order.clientId, orderId: order.id,
      invoiceId: null, amount: '750.00', currency: 'USD', receivedAt: new Date(),
    });

    // The early return must still re-claim, not just hand back the row.
    const again = await ensureOrderInvoice(order.id);
    expect(again.id).toBe(invoice.id);
    expect(again.amountPaid).toBe('750.00');
    const [payment] = await db.select().from(customerPayments).where(eq(customerPayments.orderId, order.id));
    expect(payment!.invoiceId).toBe(invoice.id);
  });

  it('rejects a void when nothing is live, distinguishing never-issued from already-void', async () => {
    const { order } = await seedOrderWithItems();

    await expect(voidOrderInvoice(order.id)).rejects.toBeInstanceOf(InvoiceNotFoundError);

    await ensureOrderInvoice(order.id);
    await voidOrderInvoice(order.id, { reissue: false });
    await expect(voidOrderInvoice(order.id, { reissue: false })).rejects.toBeInstanceOf(InvoiceAlreadyVoidError);
  });
});

describe('amount basis', () => {
  it('refuses to freeze a blended total for a mixed-currency order', async () => {
    const basics = await seedOrderWithItems();
    const { order } = basics;
    await db.update(orderItems)
      .set({ salesCurrency: 'EUR' })
      .where(and(eq(orderItems.orderId, order.id), eq(orderItems.productType, 'VLSFO')));

    // `invoices` has one scalar amount and no currency column, so this cannot be
    // expressed as a single number — refusing beats freezing nonsense.
    await expect(computeInvoiceAmount(order.id)).rejects.toThrow(MixedCurrencyInvoiceError);
  });
});

describe('settlement', () => {
  it('recomputes amountPaid only on the invoice the payment was stamped to', async () => {
    const basics = await seedOrderWithItems();
    const { tenant, order } = basics;
    const invoice = await ensureOrderInvoice(order.id);
    const total = Number(invoice.amount);

    // A second order's invoice stands in for "any other invoice" — the DB now
    // enforces one invoice per order, so cross-order isolation is the property
    // that matters here.
    const otherOrder = await createOrderWithItems(basics);
    const otherInvoice = await ensureOrderInvoice(otherOrder.id);

    await db.insert(customerPayments).values({
      tenantId: tenant.id, customerId: order.clientId, orderId: order.id, invoiceId: invoice.id,
      amount: '100000.00', currency: 'USD', receivedAt: new Date(),
    });
    await recomputeInvoiceAmountPaid(invoice.id);
    let [row] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
    expect(row!.amountPaid).toBe('100000.00');
    expect(row!.status).toBe('PARTIALLY_PAID');

    await db.insert(customerPayments).values({
      tenantId: tenant.id, customerId: order.clientId, orderId: order.id, invoiceId: invoice.id,
      amount: String(total - 100000), currency: 'USD', receivedAt: new Date(),
    });
    await recomputeInvoiceAmountPaid(invoice.id);

    [row] = await db.select().from(invoices).where(eq(invoices.id, invoice.id));
    const [untouched] = await db.select().from(invoices).where(eq(invoices.id, otherInvoice.id));
    expect(row!.status).toBe('PAID');
    expect(untouched!.amountPaid).toBe('0.00');
    expect(untouched!.status).toBe('SENT');
  });

  it('survives concurrent issuance of the same order with exactly one invoice', async () => {
    const { order } = await seedOrderWithItems();

    // The application-level check cannot stop two simultaneous issuances; the
    // per-order unique index must, and both callers must still come back with
    // the same invoice row rather than an error.
    const results = await Promise.all([
      ensureOrderInvoice(order.id),
      ensureOrderInvoice(order.id),
      ensureOrderInvoice(order.id),
    ]);

    const rows = await db.select().from(invoices).where(eq(invoices.orderId, order.id));
    expect(rows.length).toBe(1);
    for (const invoice of results) expect(invoice.id).toBe(rows[0]!.id);
  });

  it('claims payments recorded before the invoice existed', async () => {
    const { tenant, order } = await seedOrderWithItems();

    // A trader can take payment on delivery before issuing the PDF; that money
    // must not stay unallocated and get chased by collections.
    await db.insert(customerPayments).values({
      tenantId: tenant.id, customerId: order.clientId, orderId: order.id,
      invoiceId: null, amount: '50000.00', currency: 'USD', receivedAt: new Date(),
    });

    const invoice = await ensureOrderInvoice(order.id);
    expect(invoice.amountPaid).toBe('50000.00');
    expect(invoice.status).toBe('PARTIALLY_PAID');

    const [claimed] = await db.select().from(customerPayments).where(eq(customerPayments.orderId, order.id));
    expect(claimed!.invoiceId).toBe(invoice.id);
  });

  it('enforces exactly one invoice per order in the database', async () => {
    const { tenant, order } = await seedOrderWithItems();
    await ensureOrderInvoice(order.id);

    // Concurrent issuance would otherwise slip a second row past the
    // application-level check; the partial unique index is the real guarantee.
    const invoiceNumber = await allocateInvoiceNumber(tenant.id);
    let error: unknown = null;
    try {
      await db.insert(invoices).values({
        orderId: order.id,
        invoiceNumber,
        status: 'SENT',
        dueDate: '2026-11-01',
        amount: '1.00',
        amountPaid: '0',
      });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(Error);
    // Drizzle wraps the driver error; the Postgres cause carries the constraint.
    expect(String((error as Error).cause ?? error)).toMatch(/invoices_one_per_order|duplicate key/i);
  });
});

describe('stored status derivation', () => {
  it('treats VOID as terminal and never stores OVERDUE', () => {
    expect(deriveInvoiceStatus('VOID', '100', '100')).toBe('VOID');
    expect(deriveInvoiceStatus('SENT', '0', '0')).toBe('SENT');
    expect(deriveInvoiceStatus('SENT', '100', '100')).toBe('PAID');
    expect(deriveInvoiceStatus('SENT', '100', '99.998')).toBe('PAID');
    expect(deriveInvoiceStatus('SENT', '100', '10')).toBe('PARTIALLY_PAID');
  });
});

describe('display status derivation', () => {
  it('reports overdue only while money is still outstanding', () => {
    const unpaid = { status: 'SENT', amount: '100.00', amountPaid: '0.00' };
    expect(deriveInvoiceDisplayStatus(unpaid, 5)).toBe('OVERDUE');
    expect(deriveInvoiceDisplayStatus(unpaid, 0)).toBe('SENT');

    const settled = { status: 'SENT', amount: '100.00', amountPaid: '100.00' };
    expect(deriveInvoiceDisplayStatus(settled, 5)).toBe('PAID');
  });

  it('prefers the amounts over a stale stored status', () => {
    // A row adjusted outside the payment path still carries status 'SENT'.
    expect(deriveInvoiceDisplayStatus({ status: 'SENT', amount: '100.00', amountPaid: '100.00' }, 0)).toBe('PAID');
    expect(deriveInvoiceDisplayStatus({ status: 'SENT', amount: '100.00', amountPaid: '40.00' }, 0)).toBe('PARTIALLY_PAID');
  });

  it('keeps VOID and DRAFT terminal regardless of amounts or dates', () => {
    expect(deriveInvoiceDisplayStatus({ status: 'VOID', amount: '100.00', amountPaid: '0.00' }, 30)).toBe('VOID');
    expect(deriveInvoiceDisplayStatus({ status: 'VOID', amount: '100.00', amountPaid: '100.00' }, 30)).toBe('VOID');
    expect(deriveInvoiceDisplayStatus({ status: 'DRAFT', amount: '100.00', amountPaid: '0.00' }, 30)).toBe('DRAFT');
  });
});

describe('issued artifact immutability', () => {
  it('keeps serving the stored artifact after the lines change, and refuses only a fresh render', async () => {
    const basics = await seedOrderWithItems();
    const { order } = basics;
    const { generateOrderInvoicePdfBuffer } = await import('../src/modules/documents/document.service');
    const { InvoiceLinesChangedError } = await import('../src/modules/orders/invoice.service');

    // First render issues AND persists the artifact.
    const first = await generateOrderInvoicePdfBuffer(order.id);
    expect(first.revision.revisionNumber).toBe(1);

    // Now the trader edits the lines. The already-issued document must keep
    // serving unchanged — it is the artifact the customer holds.
    await db.update(orderItems).set({ salesPrice: '9999' }).where(eq(orderItems.orderId, order.id));
    const again = await generateOrderInvoicePdfBuffer(order.id);
    expect(again.revision.id).toBe(first.revision.id);
    expect(again.buffer.equals(first.buffer)).toBe(true);
    expect(again.invoiceNumber).toBe(first.invoiceNumber);

    // But a DIFFERENT order that was issued (row created) without ever being
    // rendered must refuse rather than print a self-contradicting document.
    const other = await createOrderWithItems(basics);
    await ensureOrderInvoice(other.id);
    await db.insert(customerPayments).values({
      tenantId: basics.tenant.id, customerId: other.clientId, orderId: other.id,
      invoiceId: null, amount: '1.00', currency: 'USD', receivedAt: new Date(),
    });
    await ensureOrderInvoice(other.id);
    await db.update(orderItems).set({ salesPrice: '7777' }).where(eq(orderItems.orderId, other.id));
    await expect(generateOrderInvoicePdfBuffer(other.id)).rejects.toBeInstanceOf(InvoiceLinesChangedError);

    await db.delete(documentRevisions).where(eq(documentRevisions.orderId, order.id));
  });
});

describe('frozen total invariant', () => {
  const lineItems = [
    { productType: 'VLSFO', description: null, quantity: '100', unit: 'MT', salesPrice: '600', salesCurrency: 'USD' },
  ];

  /**
   * Read the printed headline figure out of the built document.
   *
   * Target the "Total amount due to X" row specifically: its second column
   * carries the invoice total. Matching numbers generically would pick up the
   * per-line amount cells, which are a different figure.
   */
  function totalFrom(doc: unknown): number {
    let found: number | null = null;
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) { node.forEach(walk); return; }
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      const columns = record.columns as Array<{ text?: string }> | undefined;
      if (Array.isArray(columns) && columns.length === 2
        && typeof columns[0]?.text === 'string' && /total amount due/i.test(columns[0]!.text!)) {
        const amount = columns[1]?.text?.replace(/[^0-9.]/g, '');
        if (amount) found = Number(amount);
      }
      Object.values(record).forEach(walk);
    };
    walk(doc);
    expect(found).not.toBeNull();
    return found!;
  }

  const baseData = {
    orderNumber: 'ORD-1', clientName: 'Cust', clientCountry: null, clientAddress: null,
    customerContactName: null, customerContactRole: null, customerContactPhone: null,
    customerContactEmail: null, vesselName: 'Vessel', vesselImo: null, portName: 'Port',
    eta: null, etd: null, timezone: null, dateFormat: 'ISO' as const,
    costSalesDecimalPrecision: 2, currency: 'USD', fromName: null, fromEmail: null,
    fromPhone: null, paymentTerms: null, customerNote: null, purchaseOrderNumber: null,
    deliveredAt: null, termsAndConditions: null, placeRemark: null, companyName: 'OwnCo',
    companyAddress: null, companyPhone: null, companyEmail: null,
    companyRegistrationNumber: null, companyWebsite: null, companyLogoDataUrl: null,
    itemNotes: [], createdAt: new Date('2026-09-22T00:00:00Z'), verifyUrl: null,
    verifyLink: null, fraudPreventionText: null,
    bank: { bankName: 'B', accountName: null, accountNumber: null, iban: null, swift: null,
            currency: 'USD', branchAddress: null, sortCode: null, routingNumber: null,
            intermediaryBank: null },
    vatNumber: null, latePaymentInterest: null, docTitle: 'INVOICE', printMeta: null,
  };

  it('prints the frozen total rather than a fresh sum of the lines', () => {
    // Lines sum to 60,000; the invoice froze 42,000 (a price edited after
    // issuance). The document must show the invoiced figure, not the new one.
    const doc = __documentTestUtils.buildProformaDocument({
      ...baseData, items: lineItems, frozenTotal: '42000.00',
    });
    expect(totalFrom(doc)).toBe(42000);
  });

  it('prints the live line sum when no total is frozen (proforma)', () => {
    const doc = __documentTestUtils.buildProformaDocument({ ...baseData, items: lineItems });
    expect(totalFrom(doc)).toBe(60000);
  });
});

describe('payment schedule validation', () => {
  it('requires the tranches to total exactly 100%', () => {
    const base = { dueBasis: 'FROM_DELIVERY' as const, creditDays: 21 };

    expect(() => assertValidSchedule([
      { ...base, percent: 50 },
      { ...base, percent: 50 },
    ])).not.toThrow();

    // Under-billing leaves part of the deal unbilled; over-billing charges twice.
    expect(() => assertValidSchedule([{ ...base, percent: 50 }, { ...base, percent: 40 }]))
      .toThrow(InvalidScheduleError);
    expect(() => assertValidSchedule([{ ...base, percent: 60 }, { ...base, percent: 60 }]))
      .toThrow(InvalidScheduleError);
    expect(() => assertValidSchedule([])).toThrow(InvalidScheduleError);
  });

  it('requires a date on a fixed-date tranche and rejects negative credit days', () => {
    expect(() => assertValidSchedule([{ percent: 100, dueBasis: 'FIXED_DATE' }])).toThrow();
    expect(() => assertValidSchedule([{ percent: 100, dueBasis: 'FIXED_DATE', fixedDueDate: '2026-10-15' }])).not.toThrow();
    expect(() => assertValidSchedule([{ percent: 100, dueBasis: 'FROM_DELIVERY', creditDays: -5 }])).toThrow();
  });
});

describe('tranche amount rounding', () => {
  it('allocates the last tranche so the parts sum exactly to the total', () => {
    // Three equal thirds of 100.00 must not leave a cent unaccounted.
    const parts = [0, 1, 2].map((i) => splitAmountByPercent(100, [33.333, 33.333, 33.334], i));
    expect(parts.reduce((sum, p) => sum + Number(p), 0)).toBeCloseTo(100, 2);

    const halves = [0, 1].map((i) => splitAmountByPercent(684204, [50, 50], i));
    expect(halves).toEqual(['342102.00', '342102.00']);

    // An awkward total still reconciles.
    const odd = [0, 1, 2].map((i) => splitAmountByPercent(1000, [30, 30, 40], i));
    expect(odd.reduce((sum, p) => sum + Number(p), 0)).toBeCloseTo(1000, 2);
  });
});

describe('split payment terms (50/50 CIA + 21 dd)', () => {
  it('issues one invoice per tranche with its own share and due date', async () => {
    const basics = await seedOrderWithItems();
    const { order } = basics;

    await setOrderPaymentSchedule(order.id, [
      { label: 'Deposit', percent: 50, dueBasis: 'ON_ISSUE' },
      { label: 'Balance', percent: 50, dueBasis: 'FROM_DELIVERY', creditDays: 21 },
    ]);

    const first = await ensureOrderInvoice(order.id);
    const all = await db.select().from(invoices)
      .where(and(eq(invoices.orderId, order.id), ne(invoices.status, 'VOID')))
      .orderBy(asc(invoices.trancheSeq));

    expect(all.length).toBe(2);
    expect(all.map((i) => i.trancheSeq)).toEqual([1, 2]);
    expect(all.map((i) => i.trancheLabel)).toEqual(['Deposit', 'Balance']);

    // Shares must sum to the order total, never double or under bill.
    const orderTotal = Number(await computeInvoiceAmount(order.id));
    expect(all.reduce((sum, i) => sum + Number(i.amount), 0)).toBeCloseTo(orderTotal, 2);
    expect(Number(all[0]!.amount)).toBeCloseTo(orderTotal / 2, 2);

    // Each tranche carries a DISTINCT number and its own due date.
    expect(all[0]!.invoiceNumber).not.toBe(all[1]!.invoiceNumber);
    expect(all[0]!.dueDate <= all[1]!.dueDate).toBe(true);
    // The deposit is already payable; the balance follows delivery + 21 days.
    expect(all[1]!.dueDate > all[0]!.dueDate).toBe(true);

    void first;
  });

  it('refuses to change a schedule once a tranche has been issued', async () => {
    const { order } = await seedOrderWithItems();
    await setOrderPaymentSchedule(order.id, [
      { label: 'Deposit', percent: 50, dueBasis: 'ON_ISSUE' },
      { label: 'Balance', percent: 50, dueBasis: 'FROM_DELIVERY', creditDays: 21 },
    ]);
    await ensureOrderInvoice(order.id);

    await expect(setOrderPaymentSchedule(order.id, [
      { percent: 100, dueBasis: 'FROM_DELIVERY', creditDays: 30 },
    ])).rejects.toBeInstanceOf(InvalidScheduleError);
  });

  it('clearing the schedule restores the single-invoice behaviour', async () => {
    const { order } = await seedOrderWithItems();
    await setOrderPaymentSchedule(order.id, [
      { percent: 60, dueBasis: 'ON_ISSUE' },
      { percent: 40, dueBasis: 'FROM_DELIVERY', creditDays: 30 },
    ]);
    expect((await listOrderPaymentSchedule(order.id)).length).toBe(2);

    await setOrderPaymentSchedule(order.id, []);
    expect(await listOrderPaymentSchedule(order.id)).toEqual([]);

    await ensureOrderInvoice(order.id);
    const live = await db.select().from(invoices)
      .where(and(eq(invoices.orderId, order.id), ne(invoices.status, 'VOID')));
    expect(live.length).toBe(1);
    expect(live[0]!.trancheSeq).toBeNull();
  });
});
