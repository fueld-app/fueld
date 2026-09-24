import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { seedBasics, truncateAll, getDb } from './helpers/db';
import { tenants } from '../src/db/schema';

/**
 * The tenant's configured date format (Admin → Settings → General) must reach
 * the due date on invoice documents, and must be per-tenant.
 *
 * Two real defects are guarded here:
 *
 *  1. The due date was rendered RAW (`invoice.dueDate` / `data.dueDate`, i.e.
 *     "2026-10-01") in both the invoice and proforma builders, so the setting
 *     changed every date on the page EXCEPT the one the customer actually asked
 *     about. A tenant on EUROPEAN still received an ISO due date.
 *
 *  2. `getDateFormatSettings()` read `tenants.limit(1)` — the first row, not the
 *     caller's. With more than one tenant on an instance, every tenant rendered
 *     in (and a save rewrote) whichever tenant sorted first.
 */

const defaultTestDatabaseUrl = 'postgres://fueld:fueld@localhost:5432/fueld_test';
if (!process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
  process.env.TEST_DATABASE_URL = defaultTestDatabaseUrl;
}
if (!process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

const { __documentTestUtils } = await import('../src/modules/documents/document.service');
const { getDateFormatSettings, updateDateFormatSettings } = await import(
  '../src/modules/admin/settings.service'
);

/** Every string in a pdfmake content tree, joined — the document's text. */
function collectTextValues(node: unknown): string[] {
  const out: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === 'string') { out.push(value); return; }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    for (const child of Object.values(value as Record<string, unknown>)) visit(child);
  };
  visit(node);
  return out;
}

/**
 * The full text of a built document, as the customer would read it.
 *
 * The page header/footer are FUNCTIONS in pdfmake, so the tree walk alone
 * misses them — and the document date lives in the header, which is exactly
 * where one of the defects was.
 */
function documentText(doc: unknown): string {
  const parts = collectTextValues(doc);
  const d = doc as { header?: unknown; footer?: unknown };
  for (const slot of [d.header, d.footer]) {
    if (typeof slot === 'function') {
      parts.push(...collectTextValues((slot as (p: number, c: number) => unknown)(1, 1)));
    } else if (slot) {
      parts.push(...collectTextValues(slot));
    }
  }
  return parts.join(' | ');
}

function proformaData(overrides: Record<string, unknown> = {}) {
  return {
    orderNumber: 'ORD-1',
    clientName: 'Acme Marine',
    clientCountry: 'Denmark',
    clientAddress: null,
    customerContactName: null,
    customerContactRole: null,
    customerContactPhone: null,
    customerContactEmail: null,
    vesselName: 'Aurora',
    vesselImo: null,
    portName: 'Rotterdam',
    eta: null,
    etd: null,
    timezone: null,
    currency: 'USD',
    fromName: null,
    fromEmail: null,
    fromPhone: null,
    paymentTerms: 'Credit 21 days',
    dueDate: '2026-10-01',
    customerNote: null,
    termsAndConditions: null,
    companyName: 'Moxie Fuels',
    companyAddress: null,
    companyPhone: null,
    companyEmail: null,
    companyWebsite: null,
    companyLogoDataUrl: null,
    itemNotes: [],
    items: [
      { productType: 'VLSFO', description: null, quantity: '100', unit: 'MT', salesPrice: '600', salesCurrency: 'USD' },
    ],
    createdAt: new Date('2026-09-10T00:00:00.000Z'),
    // dateFormat deliberately omitted per-test
    ...overrides,
  } as Parameters<typeof __documentTestUtils.buildProformaDocument>[0];
}

function invoiceData(overrides: Record<string, unknown> = {}) {
  return {
    invoiceNumber: 'INV-1',
    orderNumber: 'ORD-1',
    dueDate: '2026-10-01',
    clientName: 'Acme Marine',
    clientCountry: 'Denmark',
    vesselName: 'Aurora',
    vesselImo: null,
    portName: 'Rotterdam',
    salesRepName: null,
    paymentTerms: 'Credit 21 days',
    customerNote: null,
    itemNotes: [],
    items: [{ productType: 'VLSFO', quantity: '100', unit: 'MT', salesPrice: '600', costPrice: null }],
    totalAmount: null,
    bank: {
      bankName: 'DNB', accountName: null, accountNumber: null, iban: null,
      swift: null, currency: 'USD', branchAddress: null, sortCode: null,
      routingNumber: null, intermediaryBank: null,
    },
    createdAt: new Date('2026-09-10T00:00:00.000Z'),
    companyName: 'Moxie Fuels',
    vatNumber: null,
    companyRegistrationNumber: null,
    fraudPreventionText: null,
    latePaymentInterest: null,
    companyLogoDataUrl: null,
    companyAddress: null,
    companyPhone: null,
    companyEmail: null,
    printMeta: null,
    ...overrides,
  } as Parameters<typeof __documentTestUtils.buildInvoiceDocument>[0];
}

describe('tenant date format reaches document dates', () => {
  it('proforma due date follows the configured format, not ISO', () => {
    // The reported symptom: "Due date: 2026-10-01" on a Danish customer's
    // invoice. Under EUROPEAN it must read 01/10/2026.
    const iso = documentText(__documentTestUtils.buildProformaDocument(proformaData({ dateFormat: 'ISO' })));
    const eu = documentText(__documentTestUtils.buildProformaDocument(proformaData({ dateFormat: 'EUROPEAN' })));
    const us = documentText(__documentTestUtils.buildProformaDocument(proformaData({ dateFormat: 'AMERICAN' })));

    expect(iso).toContain('2026-10-01');
    expect(eu).toContain('01/10/2026');
    expect(us).toContain('10/01/2026');
    // The whole point: the ISO form must be GONE under a non-ISO setting.
    expect(eu).not.toContain('2026-10-01');
    expect(us).not.toContain('2026-10-01');
  });

  it('invoice due date follows the configured format, not ISO', () => {
    const eu = documentText(__documentTestUtils.buildInvoiceDocument(invoiceData({ dateFormat: 'EUROPEAN' })));
    const us = documentText(__documentTestUtils.buildInvoiceDocument(invoiceData({ dateFormat: 'AMERICAN' })));
    expect(eu).toContain('01/10/2026');
    expect(us).toContain('10/01/2026');
    expect(eu).not.toContain('2026-10-01');
  });

  it('the document date follows the configured format too', () => {
    // Created 2026-09-10. It was hardcoded DD-MM-YYYY before, so a EUROPEAN
    // tenant saw "10-09-2026" and an AMERICAN tenant saw the same.
    const eu = documentText(__documentTestUtils.buildProformaDocument(proformaData({ dateFormat: 'EUROPEAN' })));
    const us = documentText(__documentTestUtils.buildProformaDocument(proformaData({ dateFormat: 'AMERICAN' })));
    expect(eu).toContain('10/09/2026');
    expect(us).toContain('09/10/2026');
  });
});

describe('date format is stored per tenant', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('reads and writes the CALLER tenant, not the first tenant', async () => {
    // Insert a decoy tenant FIRST: a `tenants.limit(1)` regression resolves to
    // it, so the assertions below fail rather than silently passing.
    const { tenant } = await seedBasics();
    const db = await getDb();
    const [decoy] = await db
      .insert(tenants)
      .values({ name: 'Aardvark Shipping', domain: 'aardvark.test', settings: { dateFormat: 'AMERICAN' } })
      .returning();

    expect((await getDateFormatSettings(tenant.id)).dateFormat).toBe('ISO');
    expect((await getDateFormatSettings(decoy!.id)).dateFormat).toBe('AMERICAN');

    await updateDateFormatSettings(tenant.id, { dateFormat: 'EUROPEAN' });

    // The caller's tenant changed…
    expect((await getDateFormatSettings(tenant.id)).dateFormat).toBe('EUROPEAN');
    // …and the decoy did NOT.
    expect((await getDateFormatSettings(decoy!.id)).dateFormat).toBe('AMERICAN');

    const [decoyRow] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, decoy!.id));
    expect((decoyRow!.settings as { dateFormat?: string }).dateFormat).toBe('AMERICAN');
  });
});
