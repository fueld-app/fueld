import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { counterparties, invoices, orderItems, orders, places, tenants, vessels } from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';

type RegisterModule = typeof import('../src/modules/reports/invoice-register.service');
type InvoiceModule = typeof import('../src/modules/orders/invoice.service');

let register: RegisterModule;
let invoiceSvc: InvoiceModule;

beforeAll(async () => {
  register = await import('../src/modules/reports/invoice-register.service');
  invoiceSvc = await import('../src/modules/orders/invoice.service');
});

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  const db = await getDb();
  await db.update(tenants).set({ settings: {} });
});

async function seedTenantOnly() {
  const db = await getDb();
  const [tenant] = await db.insert(tenants).values({ name: 'Register Test', domain: `reg-${Date.now()}.test` }).returning();
  return tenant!.id;
}

/** An invoiceable order in an EXISTING tenant (seedBasics gives only one). */
async function seedInvoiceableIn(tenantId: string, orderNumber: string, price = '500', qty = '10') {
  const db = await getDb();
  // orders.client_id / vessel_id / place_id are NOT NULL, so each tenant needs
  // its own rows — reusing another tenant's would make the register's join pick
  // up foreign names and quietly defeat the scoping assertion.
  const [client] = await db.insert(counterparties)
    .values({ tenantId, name: `Client ${orderNumber}`, type: 'CLIENT', types: ['CLIENT'], country: 'USA' })
    .returning();
  // imo is globally unique, so it must vary per seeded order.
  const [vessel] = await db.insert(vessels)
    .values({ name: `Vessel ${orderNumber}`, imo: String(9_000_000 + (Date.now() % 900_000)) })
    .returning();
  const [place] = await db.insert(places)
    .values({ name: `Place ${orderNumber}`, country: 'USA', countryIso: 'USA', area: 'A', placeType: 'POR', lat: 1, long: 1, unlocode: 'US TST' })
    .returning();

  const [order] = await db
    .insert(orders)
    .values({
      tenantId, orderNumber, currency: 'USD', status: 'DELIVERED',
      clientId: client!.id, vesselId: vessel!.id, placeId: place!.id,
      customerPaymentTermType: 'CREDIT', customerCreditDays: 21,
      eta: new Date('2026-09-20T10:00:00Z'), deliveredAt: new Date('2026-09-27T10:00:00Z'),
    })
    .returning();
  await db.insert(orderItems).values({
    orderId: order!.id, productType: 'LSMGO', quantity: qty, unit: 'MT',
    sortOrder: 0, salesPrice: price, salesCurrency: 'USD',
  });
  return order!.id;
}

/** A DELIVERED order with one priced line, so it can issue a real invoice. */
async function seedInvoiceable(orderNumber: string, price = '500', qty = '10') {
  const db = await getDb();
  const basics = await seedBasics();
  const [order] = await db
    .insert(orders)
    .values({
      tenantId: basics.tenant.id,
      clientId: basics.client.id,
      vesselId: basics.vessel.id,
      placeId: basics.place.id,
      orderNumber,
      currency: 'USD',
      status: 'DELIVERED',
      customerPaymentTermType: 'CREDIT',
      customerCreditDays: 21,
      eta: new Date('2026-09-20T10:00:00Z'),
      deliveredAt: new Date('2026-09-27T10:00:00Z'),
    })
    .returning();
  await db.insert(orderItems).values({
    orderId: order!.id, productType: 'LSMGO', quantity: qty, unit: 'MT',
    sortOrder: 0, salesPrice: price, salesCurrency: 'USD',
  });
  return { tenantId: basics.tenant.id, orderId: order!.id };
}

describe('invoice register', () => {
  test('lists issued invoices with their order reference, and excludes drafts', async () => {
    const { tenantId, orderId } = await seedInvoiceable('REG-1');
    const issued = await invoiceSvc.ensureOrderInvoice(orderId);

    const result = await register.getInvoiceRegister(tenantId);
    const row = result.rows.find((r) => r.invoiceId === issued.id);
    expect(row).toBeDefined();
    // The whole point of the page: the invoice AND the order it belongs to, so
    // "which order is this bill for?" is answerable from the row.
    expect(row!.orderNumber).toBe('REG-1');
    expect(row!.amount).toBe('5000.00');
    expect(row!.status).not.toBe('DRAFT');
  });

  test('a VOID invoice owes NOTHING, however much it was issued for', async () => {
    // Regression: the register reported a voided invoice's frozen amount as
    // outstanding (368,400.47 on a cancelled document), which is exactly how a
    // cancelled invoice gets chased.
    const { tenantId, orderId } = await seedInvoiceable('REG-2', '5000', '10');
    const issued = await invoiceSvc.ensureOrderInvoice(orderId);
    expect(issued.amount).toBe('50000.00');

    await invoiceSvc.voidOrderInvoice(orderId, { reissue: false });

    const result = await register.getInvoiceRegister(tenantId);
    const row = result.rows.find((r) => r.invoiceId === issued.id);
    expect(row).toBeDefined();
    expect(row!.status).toBe('VOID');
    expect(row!.outstandingAmount).toBe('0.00');
    // And the voided row must not be counted as collectible money.
    expect(result.totals.totalOutstanding).toBe('0.00');
    expect(result.totals.voided).toBe(1);
  });

  test('a settled invoice still appears — the reason this page exists', async () => {
    // The ageing report shows only what is still owed, so a paid invoice has no
    // home there. It must be findable here by the number it was issued under.
    const { tenantId, orderId } = await seedInvoiceable('REG-3');
    const issued = await invoiceSvc.ensureOrderInvoice(orderId);
    const db = await getDb();
    await db.update(invoices).set({ amountPaid: issued.amount }).where(eq(invoices.id, issued.id));

    const result = await register.getInvoiceRegister(tenantId);
    const row = result.rows.find((r) => r.invoiceId === issued.id);
    expect(row).toBeDefined();
    expect(row!.status).toBe('PAID');
    expect(row!.outstandingAmount).toBe('0.00');
    expect(result.totals.totalPaid).toBe('5000.00');
  });

  test('filters: status, period, client and free text', async () => {
    const db = await getDb();
    const tenantId = await seedTenantOnly();
    const first = await seedInvoiceableIn(tenantId, 'REG-4A');
    const second = await seedInvoiceableIn(tenantId, 'REG-4B');
    const invA = await invoiceSvc.ensureOrderInvoice(first);
    await invoiceSvc.ensureOrderInvoice(second);
    await invoiceSvc.voidOrderInvoice(second, { reissue: false });
    void db;

    const all = await register.getInvoiceRegister(tenantId);
    expect(all.rows.length).toBe(2);

    const openOnly = await register.getInvoiceRegister(tenantId, { status: 'OPEN' });
    expect(openOnly.rows.map((r) => r.invoiceId)).toEqual([invA.id]);

    const voidOnly = await register.getInvoiceRegister(tenantId, { status: 'VOID' });
    expect(voidOnly.rows.length).toBe(1);

    const byText = await register.getInvoiceRegister(tenantId, { q: 'REG-4A' });
    expect(byText.rows.length).toBe(1);
    expect(byText.rows[0]!.invoiceId).toBe(invA.id);

    const byNumber = await register.getInvoiceRegister(tenantId, { q: invA.invoiceNumber });
    expect(byNumber.rows.length).toBe(1);
  });

  test('the export carries the register rows, header first', async () => {
    const { tenantId, orderId } = await seedInvoiceable('REG-5');
    await invoiceSvc.ensureOrderInvoice(orderId);

    const rows = await register.exportInvoiceRegisterRows(tenantId);
    expect(rows.length).toBe(1);
    expect(register.INVOICE_REGISTER_HEADERS.length).toBe(rows[0]!.length);
    expect(String(rows[0]![1])).toBe('REG-5');
    // No null anywhere: an undefined cell writes a blank column into the sheet.
    expect(rows[0]!.every((cell) => cell !== null && cell !== undefined)).toBe(true);
  });

  test('is tenant-scoped: another tenant\'s invoices never appear', async () => {
    // `seedBasics()` hardcodes domain 'test.local', so a second call would
    // collide rather than give a second tenant — create them directly.
    const db = await getDb();
    const [mine] = await db.insert(tenants).values({ name: 'Mine', domain: 'mine.test' }).returning();
    const [theirs] = await db.insert(tenants).values({ name: 'Theirs', domain: 'theirs.test' }).returning();

    const myOrder = await seedInvoiceableIn(mine!.id, 'REG-6');
    const theirOrder = await seedInvoiceableIn(theirs!.id, 'REG-7');
    await invoiceSvc.ensureOrderInvoice(myOrder);
    await invoiceSvc.ensureOrderInvoice(theirOrder);

    const result = await register.getInvoiceRegister(mine!.id);
    const orderNumbers = result.rows.map((r) => r.orderNumber);
    expect(orderNumbers).toContain('REG-6');
    expect(orderNumbers).not.toContain('REG-7');
  });
});
