import { describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import QRCode from 'qrcode';

const defaultTestDatabaseUrl = 'postgres://fueld:fueld@localhost:5432/fueld_test';
if (!process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
  process.env.TEST_DATABASE_URL = defaultTestDatabaseUrl;
}
if (!process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

const {
  __documentTestUtils,
  isDocumentRevisionVerificationExpired,
  getLatestDocumentRevisionByOrderId,
  getLatestDocumentRevisionByStream,
  getDocumentRevisionByVerifyToken,
  loadDocumentRevisionBuffer,
  generateInvoicePdfBuffer,
  generateOrderInvoicePdfBuffer,
  generateOfferPdfBuffer,
  generateNominationPdfBuffer,
  generateProformaInvoicePdfBuffer,
} = await import('../src/modules/documents/document.service');
const { db } = await import('../src/db');

function collectTextValues(node: unknown): string[] {
  const out: string[] = [];

  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      out.push(value);
      return;
    }
    if (!value || typeof value !== 'object') return;

    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') out.push(record.text);
    if (Array.isArray(record.text)) visit(record.text);

    for (const child of Object.values(record)) {
      if (child !== record.text) visit(child);
    }
  };

  visit(node);
  return out;
}

const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+Xn1cAAAAASUVORK5CYII=';
const tinyPngDataUrl = `data:image/png;base64,${tinyPngBase64}`;

const commonOfferInput = {
  orderNumber: 'ORD-001',
  clientName: 'Acme Marine',
  clientCountry: 'Denmark',
  clientAddress: 'Harbor Street 1, Copenhagen',
  customerContactName: 'Jane Doe',
  customerContactRole: 'Buyer',
  customerContactPhone: '+4526131217',
  customerContactEmail: 'jane@example.com',
  vesselName: 'Aurora',
  vesselImo: '1234567',
  portName: 'Rotterdam',
  eta: '2026-03-01T10:00:00.000Z',
  etd: '2026-03-01T14:00:00.000Z',
  timezone: 'UTC+2',
  fromName: 'John Trader',
  fromEmail: 'john@example.com',
  fromPhone: '+18005551234',
  paymentTerms: 'Credit 30 days',
  customerNote: 'Handle with care',
  termsAndConditions: 'Standard terms apply',
  placeRemark: 'Pilot required',
  companyName: 'Fueld Trading Ltd',
  companyAddress: 'Main Street 2, Oslo',
  companyPhone: '+4799998888',
  companyEmail: 'ops@fueld.com',
  companyRegistrationNumber: 'NO123456',
  vatNumber: 'VAT-123',
  companyWebsite: 'https://fueld.com',
  companyLogoDataUrl: null,
  itemNotes: [{ label: 'VLSFO', note: 'Low sulphur required' }],
  currency: 'USD',
  items: [
    {
      productType: 'VLSFO',
      description: 'ISO 8217',
      quantity: '100',
      quantityMin: null,
      quantityMax: null,
      unit: 'MT',
      salesPrice: '500',
    },
  ],
  createdAt: new Date('2026-03-01T00:00:00.000Z'),
  docTitle: 'OFFER',
  verifyUrl: null,
  printMeta: null,
};

describe('document.service formatting helpers', () => {
  it('resolves public API base URL from env precedence and fallbacks', () => {
    const originalVerify = process.env.VERIFY_BASE_URL;
    const originalPublic = process.env.PUBLIC_API_URL;
    const originalApi = process.env.API_URL;
    const originalApp = process.env.APP_URL;

    try {
      process.env.VERIFY_BASE_URL = 'https://verify.example.com///';
      process.env.PUBLIC_API_URL = 'https://public.example.com';
      process.env.API_URL = 'https://api.example.com';
      process.env.APP_URL = 'https://app.example.com';
      expect(__documentTestUtils.getPublicApiBaseUrl()).toBe('https://verify.example.com');

      delete process.env.VERIFY_BASE_URL;
      process.env.PUBLIC_API_URL = 'https://public.example.com///';
      expect(__documentTestUtils.getPublicApiBaseUrl()).toBe('https://public.example.com');

      delete process.env.PUBLIC_API_URL;
      process.env.API_URL = 'https://api.example.com///';
      expect(__documentTestUtils.getPublicApiBaseUrl()).toBe('https://api.example.com');

      delete process.env.API_URL;
      process.env.APP_URL = 'http://localhost:4200';
      expect(__documentTestUtils.getPublicApiBaseUrl()).toBe('http://localhost:3000');

      process.env.APP_URL = 'https://app.example.com';
      expect(__documentTestUtils.getPublicApiBaseUrl()).toBe('https://app.example.com/api');

      process.env.APP_URL = 'not a url';
      expect(__documentTestUtils.getPublicApiBaseUrl()).toBe('http://localhost:3000');
    } finally {
      process.env.VERIFY_BASE_URL = originalVerify;
      process.env.PUBLIC_API_URL = originalPublic;
      process.env.API_URL = originalApi;
      process.env.APP_URL = originalApp;
    }
  });

  it('parses timezone offsets and keeps date-only output stable across timezones', () => {
    expect(__documentTestUtils.parseTimezoneOffset('UTC')).toBe(0);
    expect(__documentTestUtils.parseTimezoneOffset('GMT')).toBe(0);
    expect(__documentTestUtils.parseTimezoneOffset('UTC+2')).toBe(120);
    expect(__documentTestUtils.parseTimezoneOffset('GMT-05:30')).toBe(-330);
    expect(__documentTestUtils.parseTimezoneOffset('Europe/Copenhagen')).toBeNull();

    expect(__documentTestUtils.formatDateTimeForDisplay('2026-03-01T10:00:00.000Z', 'UTC+2')).toBe('01-03-2026');
    expect(__documentTestUtils.formatDateTimeForDisplay('2026-04-11T12:00:00.000Z', 'Pacific/Fiji')).toBe('11-04-2026');
    expect(__documentTestUtils.formatDateTimeForDisplay('2026-03-01T10:00:00.000Z', null)).toBe('01-03-2026');
    expect(__documentTestUtils.formatDateTimeForDisplay(null, 'UTC+2')).toBeNull();
  });

  it('formats numbers and phone helpers across edge branches', () => {
    expect(__documentTestUtils.formatNumber(null)).toBe('—');
    expect(__documentTestUtils.formatNumber('abc')).toBe('—');
    expect(__documentTestUtils.formatNumber('1.2345', 3)).toBe('1.235');

    expect(__documentTestUtils.formatPhoneDisplay(null)).toBeNull();
    expect(__documentTestUtils.formatPhoneDisplay('+12')).toBe('+12');
    expect(__documentTestUtils.formatPhoneDisplay('+18005551234')).toBe('+1 80 05 55 12 34');
    expect(__documentTestUtils.formatPhoneDisplay('+4526131217')).toBe('+45 26 13 12 17');
    expect(__documentTestUtils.formatPhoneDisplay('+358401234567')).toBe('+358 40 12 34 56 7');
    expect(__documentTestUtils.phoneToTelUri('+45 26 13-12(17)')).toBe('tel:+4526131217');
  });

  it('builds phone/email text nodes with defaults and custom options', () => {
    const phoneNode = __documentTestUtils.phoneTextNode('Direct Phone:  ', '+4526131217');
    const emailNode = __documentTestUtils.emailTextNode('Direct Email:  ', 'ops@fueld.com', {
      fontSize: 9,
      margin: [0, 1, 0, 3],
    });

    const phoneText = collectTextValues(phoneNode).join(' | ');
    const emailText = collectTextValues(emailNode).join(' | ');

    expect(phoneText).toContain('Direct Phone:  ');
    expect(phoneText).toContain('+45 26 13 12 17');
    expect(emailText).toContain('Direct Email:  ');
    expect(emailText).toContain('ops@fueld.com');

    const emailRecord = emailNode as unknown as Record<string, unknown>;
    expect(emailRecord.fontSize).toBe(9);
    expect(emailRecord.margin).toEqual([0, 1, 0, 3]);
  });

  it('builds OFFER for-account-of text with vessel IMO and client name', () => {
    const text = __documentTestUtils.buildOfferForAccountOfText({
      title: 'OFFER',
      vesselName: 'Aurora',
      vesselImo: '1234567',
      clientName: 'Acme Trading',
      companyName: 'Ignored Here',
    });

    expect(text).toBe('Master and/or owner and/or charterers and/or MV Aurora (IMO: 1234567) and/or Acme Trading');
  });

  it('does not duplicate MV prefix when vessel name already starts with MV', () => {
    const text = __documentTestUtils.buildOfferForAccountOfText({
      title: 'CONFIRMATION',
      vesselName: 'MV Borealis',
      vesselImo: null,
      clientName: 'Client Co',
    });

    expect(text).toBe('Master and/or owner and/or charterers and/or MV Borealis and/or Client Co');
  });

  it('uses company name for NOMINATION for-account-of text', () => {
    const text = __documentTestUtils.buildOfferForAccountOfText({
      title: 'NOMINATION',
      vesselName: 'Aurora',
      companyName: 'Fueld Trading Ltd',
      clientName: 'Should Not Be Used',
    });

    expect(text).toBe('Fueld Trading Ltd');
  });

  it('falls back to default name for NOMINATION when company name is empty', () => {
    const text = __documentTestUtils.buildOfferForAccountOfText({
      title: 'NOMINATION',
      vesselName: 'Aurora',
      companyName: '   ',
    });

    expect(text).toBe('Invoicing company');
  });

  it('replaces company/document placeholders in terms text', () => {
    const text = __documentTestUtils.replaceCompanyNamePlaceholder(
      'This ${documentName} is issued by ${companyName}. Ref: ${offerOrConfirmation}.',
      'Fueld Trading Ltd',
      'Offer',
    );

    expect(text).toBe('This Offer is issued by Fueld Trading Ltd. Ref: Offer.');
  });

  it('formats customer payment terms for supported values', () => {
    expect(__documentTestUtils.formatCustomerPaymentTerms('CREDIT', 45)).toBe('Credit 45 days');
    expect(__documentTestUtils.formatCustomerPaymentTerms('COD', null)).toBe('Cash on Delivery');
    expect(__documentTestUtils.formatCustomerPaymentTerms('PREPAY', null)).toBe('Cash in advance');
    expect(__documentTestUtils.formatCustomerPaymentTerms('NET60', null)).toBe('NET60');
    expect(__documentTestUtils.formatCustomerPaymentTerms(null, null)).toBeNull();
  });

  it('computes due date from payment term rules', () => {
    const baseDate = new Date('2026-03-01T00:00:00.000Z');
    const deliveryDate = new Date('2026-03-05T00:00:00.000Z');

    expect(__documentTestUtils.computeDueDate(baseDate, 'CREDIT', 10, deliveryDate)).toBe('2026-03-15');
    expect(__documentTestUtils.computeDueDate(baseDate, 'COD', null, null)).toBe('2026-03-01');
    expect(__documentTestUtils.computeDueDate(baseDate, null, null, null)).toBe('2026-03-31');
  });

  it('builds notes section with all note variants', () => {
    const notes = __documentTestUtils.buildNotesSection({
      customerNote: 'Customer note',
      termsAndConditions: 'Terms text',
      placeRemark: 'Place remark',
      itemNotes: [{ label: 'MGO', note: 'Need sample before delivery' }],
    });

    const text = collectTextValues(notes).join(' | ');
    expect(text).toContain('Notes');
    expect(text).toContain('Customer note');
    expect(text).toContain('Place remark');
    expect(text).toContain('Terms:');
    expect(text).toContain('Terms text');
  });

  it('returns no notes section when all note inputs are empty', () => {
    const notes = __documentTestUtils.buildNotesSection({
      customerNote: null,
      termsAndConditions: null,
      placeRemark: null,
      itemNotes: [],
    });

    expect(notes).toHaveLength(0);
  });

  it('builds offer document with expected title and account text', () => {
    const doc = __documentTestUtils.buildOfferDocument({
      ...commonOfferInput,
      docTitle: 'CONFIRMATION',
    });

    const text = collectTextValues(doc).join(' | ');
    expect(text).toContain('we are pleased to confirm to you the following');
    expect(text).toContain('For account of:  ');
    expect(text).toContain('Master and/or owner and/or charterers and/or MV Aurora (IMO: 1234567) and/or Acme Marine');
    expect(text).toContain('Payment terms:  ');
    expect(text).toContain('Best regards');
  });

  it('builds offer document OFFER branch with quantity range and unit-price text', () => {
    const doc = __documentTestUtils.buildOfferDocument({
      ...commonOfferInput,
      docTitle: 'OFFER',
      items: [
        {
          productType: 'MGO',
          description: null,
          quantity: '0',
          quantityMin: '50',
          quantityMax: '75',
          unit: 'MT',
          salesPrice: '612.5',
        },
      ],
    });

    const text = collectTextValues(doc).join(' | ');
    expect(text).toContain('we are pleased to offer to you the following');
    expect(text).toContain('50 - 75');
    expect(text).toContain('USD/MT  612.50');
  });

  it('builds offer document nomination branch with verification block', () => {
    const doc = __documentTestUtils.buildOfferDocument({
      ...commonOfferInput,
      docTitle: 'NOMINATION',
      clientName: 'Supplier Co',
      companyName: 'Fueld Trading Ltd',
      verifyUrl: 'data:image/png;base64,abcd',
    });

    const text = collectTextValues(doc).join(' | ');
    expect(text).toContain('we are pleased to nominate to you the following');
    expect(text).toContain('Scan to verify');
    expect(text).toContain('Fueld Trading Ltd');
  });

  for (const docTitle of ['CONFIRMATION', 'NOMINATION'] as const) {
    it(`includes compact agent details before the account block on ${docTitle.toLowerCase()} documents`, () => {
      const doc = __documentTestUtils.buildOfferDocument({
        ...commonOfferInput,
        docTitle,
        agentName: 'Harbor Ops Agency',
        agentAddress: 'Pier 7\nRotterdam',
        agentContactName: 'Maja Hansen',
        agentContactRole: 'Port Agent',
        agentContactEmail: 'maja@harborops.example',
        agentContactPhone: '+4511223344',
      });

      const text = collectTextValues(doc).join(' | ');
      expect(text).toContain('Agent:  ');
      expect(text).toContain('Harbor Ops Agency');
      expect(text).toContain('Contact person:  ');
      expect(text).toContain('Maja Hansen');
      expect(text).toContain('Contact details:  ');
      expect(text).toContain('maja@harborops.example');
      expect(text).toContain('+45 11 22 33 44');
      expect(text).not.toContain('Pier 7');
      expect(text).not.toContain('Port Agent');
      expect(text.indexOf('Agent:  ')).toBeLessThan(text.indexOf('For account of:  '));
    });
  }

  it('builds invoice document with remittance and totals', () => {
    const doc = __documentTestUtils.buildInvoiceDocument({
      invoiceNumber: 'INV-0001',
      orderNumber: 'ORD-001',
      dueDate: '2026-03-20',
      clientName: 'Acme Marine',
      clientCountry: 'Denmark',
      vesselName: 'Aurora',
      vesselImo: '1234567',
      portName: 'Rotterdam',
      salesRepName: 'John Trader',
      paymentTerms: 'Credit 30 days',
      customerNote: null,
      itemNotes: [],
      items: [
        {
          productType: 'VLSFO',
          quantity: '100',
          unit: 'MT',
          salesPrice: '500',
          costPrice: '450',
        },
      ],
      totalAmount: '50000',
      bank: {
        bankName: 'DNB',
        accountName: 'Fueld Trading Ltd',
        accountNumber: '12345678',
        iban: 'NO9386011117947',
        swift: 'DNBANOKKXXX',
        currency: 'USD',
        branchAddress: 'Oslo',
        sortCode: null,
        routingNumber: null,
        intermediaryBank: 'Intermediary',
      },
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      companyName: 'Fueld Trading Ltd',
      vatNumber: 'VAT-123',
      companyRegistrationNumber: 'NO123456',
      fraudPreventionText: 'Verify bank details by phone.',
      latePaymentInterest: '2%',
      verifyUrl: 'data:image/png;base64,abcd',
      verifyLink: 'https://example.com/verify/abc',
      companyLogoDataUrl: null,
      companyAddress: 'Main Street 2, Oslo',
      companyPhone: '+4799998888',
      companyEmail: 'ops@fueld.com',
      printMeta: null,
    });

    const text = collectTextValues(doc).join(' | ');
    expect(text).toContain('INVOICE');
    expect(text).toContain('REMITTANCE INSTRUCTIONS');
    expect(text).toContain('Total amount due to Fueld Trading Ltd');
    expect(text).toContain('FRAUD PREVENTION');
    expect(text).toContain('Verify domain: example.com');

    const content = doc.content as unknown as Array<Record<string, unknown>>;
    const tableBlock = content.find((entry) => !!entry.table && !!entry.layout);
    expect(tableBlock).toBeTruthy();
    const layout = tableBlock!.layout as { hLineColor: (i: number) => string };
    expect(layout.hLineColor(2)).toBe('#e5e7eb');
  });

  it('builds invoice document without optional sections when values are missing', () => {
    const doc = __documentTestUtils.buildInvoiceDocument({
      invoiceNumber: 'INV-0002',
      orderNumber: null,
      dueDate: '2026-03-20',
      clientName: 'Acme Marine',
      clientCountry: null,
      vesselName: 'Aurora',
      vesselImo: null,
      portName: 'Rotterdam',
      salesRepName: null,
      paymentTerms: null,
      customerNote: null,
      itemNotes: [],
      items: [{ productType: 'MGO', quantity: '10', unit: 'MT', salesPrice: '700', costPrice: null }],
      totalAmount: null,
      bank: {
        bankName: 'DNB',
        accountName: null,
        accountNumber: null,
        iban: null,
        swift: null,
        currency: 'USD',
        branchAddress: null,
        sortCode: null,
        routingNumber: null,
        intermediaryBank: null,
      },
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      companyName: null,
      vatNumber: null,
      companyRegistrationNumber: null,
      fraudPreventionText: null,
      latePaymentInterest: null,
      verifyUrl: null,
      verifyLink: null,
      companyLogoDataUrl: null,
      companyAddress: null,
      companyPhone: null,
      companyEmail: null,
      printMeta: null,
    });

    const text = collectTextValues(doc).join(' | ');
    expect(text).toContain('Total amount due to Company');
    expect(text).not.toContain('FRAUD PREVENTION');
  });

  it('builds proforma document with remittance and transformed terms text', () => {
    const doc = __documentTestUtils.buildProformaDocument({
      orderNumber: 'ORD-001',
      clientName: 'Acme Marine',
      clientCountry: 'Denmark',
      clientAddress: 'Harbor Street 1, Copenhagen',
      customerContactName: 'Jane Doe',
      customerContactRole: 'Buyer',
      customerContactPhone: '+4526131217',
      customerContactEmail: 'jane@example.com',
      vesselName: 'Aurora',
      vesselImo: '1234567',
      portName: 'Rotterdam',
      eta: '2026-03-01T10:00:00.000Z',
      etd: '2026-03-01T14:00:00.000Z',
      timezone: 'UTC+2',
      currency: 'USD',
      fromName: 'John Trader',
      fromEmail: 'john@example.com',
      fromPhone: '+18005551234',
      paymentTerms: 'CASH_ON_DELIVERY',
      customerNote: 'Customer note',
      termsAndConditions: 'Terms text',
      companyName: 'Fueld Trading Ltd',
      companyAddress: 'Main Street 2, Oslo',
      companyPhone: '+4799998888',
      companyEmail: 'ops@fueld.com',
      companyRegistrationNumber: 'NO123456',
      companyWebsite: 'https://fueld.com',
      companyLogoDataUrl: null,
      itemNotes: [{ label: 'VLSFO', note: 'Low sulphur required' }],
      items: [
        {
          productType: 'VLSFO',
          description: 'ISO 8217',
          quantity: '100',
          unit: 'MT',
          salesPrice: '500',
        },
      ],
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      verifyUrl: 'data:image/png;base64,abcd',
      verifyLink: 'https://example.com/verify/abc',
      fraudPreventionText: 'Verify bank details by phone.',
      bank: {
        bankName: 'DNB',
        accountName: 'Fueld Trading Ltd',
        accountNumber: '12345678',
        iban: 'NO9386011117947',
        swift: 'DNBANOKKXXX',
        currency: 'USD',
        branchAddress: 'Oslo',
        sortCode: null,
        routingNumber: null,
        intermediaryBank: 'Intermediary',
      },
      vatNumber: 'VAT-123',
      latePaymentInterest: '2%',
      placeRemark: 'Pilot required',
      printMeta: null,
    });

    const text = collectTextValues(doc).join(' | ');
    expect(text).toContain('Payment terms:  ');
    expect(text).toContain('CASH ON DELIVERY');
    expect(text).toContain('REMITTANCE INSTRUCTIONS');
    expect(text).toContain('Total amount due to Fueld Trading Ltd');
    expect(text).toContain('USD/MT  500.00');
    expect(text).toContain('Verify domain: example.com');
  });

  it('builds proforma document with fallback company label in total when company missing', () => {
    const doc = __documentTestUtils.buildProformaDocument({
      orderNumber: null,
      clientName: 'Acme Marine',
      clientCountry: null,
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
      paymentTerms: null,
      customerNote: null,
      termsAndConditions: null,
      companyName: null,
      companyAddress: null,
      companyPhone: null,
      companyEmail: null,
      companyRegistrationNumber: null,
      companyWebsite: null,
      companyLogoDataUrl: null,
      itemNotes: [],
      items: [{ productType: 'MGO', description: null, quantity: '5', unit: 'MT', salesPrice: '700' }],
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      verifyUrl: null,
      verifyLink: null,
      fraudPreventionText: null,
      bank: null,
      vatNumber: null,
      latePaymentInterest: null,
      placeRemark: null,
      printMeta: null,
    });

    const text = collectTextValues(doc).join(' | ');
    expect(text).toContain('Total amount due to Company');
    expect(text).toContain('MGO');
  });

  it('builds proforma header/logo branch and skips account append when client name empty', () => {
    const doc = __documentTestUtils.buildProformaDocument({
      orderNumber: 'ORD-LOGO',
      clientName: '',
      clientCountry: null,
      clientAddress: null,
      customerContactName: null,
      customerContactRole: null,
      customerContactPhone: null,
      customerContactEmail: null,
      vesselName: 'MV Aurora',
      vesselImo: '1234567',
      portName: 'Rotterdam',
      eta: null,
      etd: null,
      timezone: null,
      currency: 'USD',
      fromName: null,
      fromEmail: null,
      fromPhone: null,
      paymentTerms: null,
      customerNote: null,
      termsAndConditions: null,
      companyName: 'Fueld Trading Ltd',
      companyAddress: null,
      companyPhone: null,
      companyEmail: null,
      companyRegistrationNumber: null,
      companyWebsite: null,
      companyLogoDataUrl: 'data:image/png;base64,abcd',
      itemNotes: [],
      items: [{ productType: 'MGO', description: null, quantity: '5', unit: 'MT', salesPrice: '700' }],
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      verifyUrl: null,
      verifyLink: null,
      fraudPreventionText: null,
      bank: null,
      vatNumber: null,
      latePaymentInterest: null,
      placeRemark: null,
      printMeta: null,
    });

    expect(typeof doc.header).toBe('function');
    const header = (doc.header as (currentPage: number, pageCount: number) => unknown)(1, 1);
    const text = collectTextValues(doc).join(' | ');
    const headerText = collectTextValues(header).join(' | ');

    expect(headerText).toContain('PROFORMA INVOICE');
    expect(text).toContain('Vessel:');
    expect(text).toContain('MV Aurora (IMO: 1234567)');
  });

  it('loads logo data URL helper across empty/unsupported/missing/valid branches', () => {
    expect(__documentTestUtils.tryLoadLogoDataUrl(null)).toBeNull();
    expect(__documentTestUtils.tryLoadLogoDataUrl('')).toBeNull();
    expect(__documentTestUtils.tryLoadLogoDataUrl('/uploads/logos/company.svg')).toBeNull();
    expect(__documentTestUtils.tryLoadLogoDataUrl('/uploads/logos/missing-logo.png')).toBeNull();

    const logosDirCandidates = [
      join(process.cwd(), 'uploads', 'logos'),
      join(process.cwd(), 'apps', 'api', 'uploads', 'logos'),
    ];
    const fileName = `coverage-logo-${Date.now()}.png`;
    const filePaths: string[] = [];

    for (const logosDir of logosDirCandidates) {
      const filePath = join(logosDir, fileName);
      mkdirSync(logosDir, { recursive: true });
      writeFileSync(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      filePaths.push(filePath);
    }

    try {
      const dataUrl = __documentTestUtils.tryLoadLogoDataUrl(`/uploads/logos/${fileName}`);
      expect(dataUrl).toBeTruthy();
      expect(String(dataUrl)).toContain('data:image/png;base64,');
    } finally {
      for (const filePath of filePaths) {
        rmSync(filePath, { force: true });
      }
    }
  });

  it('renders offer header/footer print metadata and page-specific header content', () => {
    const doc = __documentTestUtils.buildOfferDocument({
      ...commonOfferInput,
      companyLogoDataUrl: 'data:image/png;base64,abcd',
      printMeta: {
        issuedAt: new Date('2026-03-01T00:00:00.000Z'),
        revisionNumber: 3,
        verificationRef: 'OFF-20260301-R003',
        fingerprintShort: 'ABCDEF123456',
      },
    });

    expect(typeof doc.header).toBe('function');
    expect(typeof doc.footer).toBe('function');

    const firstHeader = (doc.header as (currentPage: number, pageCount: number) => unknown)(1, 2);
    const secondHeader = (doc.header as (currentPage: number, pageCount: number) => unknown)(2, 2);
    const footer = (doc.footer as (currentPage: number, pageCount: number) => unknown)(1, 2);

    const firstHeaderText = collectTextValues(firstHeader).join(' | ');
    const secondHeaderText = collectTextValues(secondHeader).join(' | ');
    const footerText = collectTextValues(footer).join(' | ');

    expect(firstHeaderText).toContain('Acme Marine');
    expect(secondHeaderText).not.toContain('Acme Marine');
    expect(footerText).toContain('Issued (UTC): 2026-03-01T00:00:00Z');
    expect(footerText).toContain('Revision: 3');
    expect(footerText).toContain('Ref: OFF-20260301-R003');
    expect(footerText).toContain('Fingerprint: ABCDEF123456');
  });

  it('executes offer table layout end-line branch', () => {
    const doc = __documentTestUtils.buildOfferDocument({
      ...commonOfferInput,
      items: [
        {
          productType: 'VLSFO',
          description: null,
          quantity: '100',
          quantityMin: null,
          quantityMax: null,
          unit: 'MT',
          salesPrice: '500',
        },
        {
          productType: 'MGO',
          description: null,
          quantity: '25',
          quantityMin: null,
          quantityMax: null,
          unit: 'MT',
          salesPrice: '700',
        },
      ],
    });

    const content = doc.content as unknown as Array<Record<string, unknown>>;
    const tableBlock = content.find((entry) => !!entry.table && !!entry.layout);
    expect(tableBlock).toBeTruthy();

    const layout = tableBlock!.layout as {
      hLineWidth: (i: number, node: { table: { body: unknown[] } }) => number;
    };
    const body = (tableBlock!.table as { body: unknown[] }).body;

    expect(layout.hLineWidth(0, { table: { body } })).toBe(1);
    expect(layout.hLineWidth(body.length, { table: { body } })).toBe(1);
    expect(layout.hLineWidth(body.length + 1, { table: { body } })).toBe(0);
  });

  it('executes offer client-country fallback in header block', () => {
    const doc = __documentTestUtils.buildOfferDocument({
      ...commonOfferInput,
      clientAddress: null,
      clientCountry: 'Norway',
    });

    expect(typeof doc.header).toBe('function');
    const header = (doc.header as (currentPage: number, pageCount: number) => unknown)(1, 1);
    const headerText = collectTextValues(header).join(' | ');

    expect(headerText).toContain('Norway');
  });

  it('renders proforma footer print metadata branch', () => {
    const doc = __documentTestUtils.buildProformaDocument({
      orderNumber: 'ORD-001',
      clientName: 'Acme Marine',
      clientCountry: 'Denmark',
      clientAddress: 'Harbor Street 1, Copenhagen',
      customerContactName: null,
      customerContactRole: null,
      customerContactPhone: null,
      customerContactEmail: null,
      vesselName: 'Aurora',
      vesselImo: '1234567',
      portName: 'Rotterdam',
      eta: null,
      etd: null,
      timezone: null,
      currency: 'USD',
      fromName: null,
      fromEmail: null,
      fromPhone: null,
      paymentTerms: null,
      customerNote: null,
      termsAndConditions: null,
      companyName: 'Fueld Trading Ltd',
      companyAddress: 'Main Street 2, Oslo',
      companyPhone: '+4799998888',
      companyEmail: 'ops@fueld.com',
      companyRegistrationNumber: 'NO123456',
      companyWebsite: 'https://fueld.com',
      companyLogoDataUrl: null,
      itemNotes: [],
      items: [
        { productType: 'MGO', description: null, quantity: '5', unit: 'MT', salesPrice: '700' },
        { productType: 'VLSFO', description: null, quantity: '7', unit: 'MT', salesPrice: '600' },
      ],
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      verifyUrl: null,
      verifyLink: null,
      fraudPreventionText: null,
      bank: null,
      vatNumber: 'VAT-123',
      latePaymentInterest: null,
      placeRemark: null,
      printMeta: {
        issuedAt: new Date('2026-03-02T00:00:00.000Z'),
        revisionNumber: 2,
        verificationRef: 'PFI-20260302-R002',
        fingerprintShort: 'FEDCBA654321',
      },
    });

    expect(typeof doc.footer).toBe('function');
    const footer = (doc.footer as (currentPage: number, pageCount: number) => unknown)(1, 1);
    const footerText = collectTextValues(footer).join(' | ');
    expect(footerText).toContain('Issued (UTC): 2026-03-02T00:00:00Z');
    expect(footerText).toContain('Ref: PFI-20260302-R002');
    expect(footerText).toContain('Fingerprint: FEDCBA654321');
  });

  it('executes proforma client-country fallback and table layout end-line branch', () => {
    const doc = __documentTestUtils.buildProformaDocument({
      orderNumber: 'ORD-COUNTRY',
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
      paymentTerms: null,
      customerNote: null,
      termsAndConditions: null,
      companyName: 'Fueld Trading Ltd',
      companyAddress: null,
      companyPhone: null,
      companyEmail: null,
      companyRegistrationNumber: null,
      companyWebsite: null,
      companyLogoDataUrl: null,
      itemNotes: [],
      items: [{ productType: 'MGO', description: null, quantity: '5', unit: 'MT', salesPrice: '700' }],
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      verifyUrl: null,
      verifyLink: null,
      fraudPreventionText: null,
      bank: null,
      vatNumber: null,
      latePaymentInterest: null,
      placeRemark: null,
      printMeta: null,
    });

    expect(typeof doc.header).toBe('function');
    const header = (doc.header as (currentPage: number, pageCount: number) => unknown)(1, 1);
    const headerText = collectTextValues(header).join(' | ');
    expect(headerText).toContain('Denmark');

    const content = doc.content as unknown as Array<Record<string, unknown>>;
    const tableBlock = content.find((entry) => !!entry.table && !!entry.layout);
    expect(tableBlock).toBeTruthy();

    const layout = tableBlock!.layout as {
      hLineWidth: (i: number, node: { table: { body: unknown[] } }) => number;
    };
    const body = (tableBlock!.table as { body: unknown[] }).body;

    expect(layout.hLineWidth(0, { table: { body } })).toBe(1);
    expect(layout.hLineWidth(body.length, { table: { body } })).toBe(1);
    expect(layout.hLineWidth(body.length + 1, { table: { body } })).toBe(0);
  });

  it('creates pdf buffer from minimal definition', async () => {
    const buffer = await __documentTestUtils.createPdfBuffer({
      content: [{ text: 'coverage probe' }],
      defaultStyle: { font: 'Roboto' },
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(100);
  });

  it('covers pure stream/path/date helper utilities', () => {
    expect(__documentTestUtils.sanitizePathSegment('tenant/acme #1')).toBe('tenant-acme--1');

    expect(__documentTestUtils.documentTypePrefix('OFFER')).toBe('OFF');
    expect(__documentTestUtils.documentTypePrefix('PROFORMA_INVOICE')).toBe('PFI');
    expect(__documentTestUtils.documentTypePrefix('INVOICE')).toBe('INV');
    expect(__documentTestUtils.documentTypePrefix('OTHER')).toBe('DOC');

    const issuedAt = new Date('2026-03-04T12:00:00.000Z');
    expect(__documentTestUtils.buildVerificationRef('INVOICE', issuedAt, 7)).toBe('INV-20260304-R007');

    expect(__documentTestUtils.resolveDocumentStreamTarget({ orderId: 'o-1', invoiceId: 'i-1' })).toBe('i-1');
    expect(__documentTestUtils.resolveDocumentStreamTarget({ orderId: 'o-1', invoiceId: null })).toBe('o-1');
    expect(__documentTestUtils.resolveDocumentStreamTarget({ orderId: null, invoiceId: null })).toBeNull();

    expect(__documentTestUtils.buildDocumentStreamKey('OFFER', 'o-1')).toContain('OFFER:o-1:');
    expect(__documentTestUtils.getRevisionAbsolutePath('documents/a/b.pdf')).toContain('/uploads/documents/a/b.pdf');

    expect(__documentTestUtils.toMs(undefined)).toBe(0);
    expect(__documentTestUtils.toMs(null)).toBe(0);
    const d1 = new Date('2026-03-01T00:00:00.000Z');
    const d2 = new Date('2026-03-05T00:00:00.000Z');
    expect(__documentTestUtils.toMs(d1)).toBe(d1.getTime());

    expect(__documentTestUtils.maxMs([
      null,
      d1,
      d2,
    ])).toBe(d2.getTime());

    expect(__documentTestUtils.maxItemUpdatedAtMs([
      { updatedAt: d1 },
      { updatedAt: new Date('2026-03-02T00:00:00.000Z') },
    ])).toBe(new Date('2026-03-02T00:00:00.000Z').getTime());
  });

  it('maps revision info and company registration helper branches', () => {
    const revision = {
      id: 'rev-1',
      tenantId: 'tenant-1',
      revisionNumber: 4,
      verificationRef: 'INV-20260304-R004',
      verifyToken: 'token-123',
      sha256Hex: 'a'.repeat(64),
      fingerprintShort: 'ABCDEF123456',
      issuedAt: new Date('2026-03-04T00:00:00.000Z'),
      filePath: 'documents/t/rev.pdf',
    };

    const mappedExisting = __documentTestUtils.mapRevisionInfo(revision as unknown as any, false);
    const mappedNew = __documentTestUtils.mapRevisionInfo(revision as unknown as any, true);

    expect(mappedExisting.id).toBe('rev-1');
    expect(mappedExisting.filePath).toBe('documents/t/rev.pdf');
    expect(mappedExisting.isNew).toBe(false);
    expect(mappedNew.isNew).toBe(true);

    expect(__documentTestUtils.getCompanyRegistrationNumber(null)).toBeNull();
    expect(__documentTestUtils.getCompanyRegistrationNumber('abc')).toBeNull();
    expect(__documentTestUtils.getCompanyRegistrationNumber({ companyRegistrationNumber: 1234 })).toBeNull();
    expect(__documentTestUtils.getCompanyRegistrationNumber({ companyRegistrationNumber: 'NO-999' })).toBe('NO-999');
  });

  it('returns null from logo helper when readFileSync throws', () => {
    const logosDirCandidates = [
      join(process.cwd(), 'uploads', 'logos'),
      join(process.cwd(), 'apps', 'api', 'uploads', 'logos'),
    ];
    const folderName = `coverage-logo-dir-${Date.now()}.png`;
    const dirPaths: string[] = [];

    for (const logosDir of logosDirCandidates) {
      const dirPath = join(logosDir, folderName);
      mkdirSync(dirPath, { recursive: true });
      dirPaths.push(dirPath);
    }

    try {
      const result = __documentTestUtils.tryLoadLogoDataUrl(`/uploads/logos/${folderName}`);
      expect(result).toBeNull();
    } finally {
      for (const dirPath of dirPaths) {
        rmSync(dirPath, { recursive: true, force: true });
      }
    }
  });

  it('covers revision verification expiry helper branches with mocked tenant settings', async () => {
    const mutableDb = db as unknown as { select: (...args: unknown[]) => unknown };
    const originalSelect = mutableDb.select;

    const settingsHolder: { value: unknown } = { value: undefined };
    mutableDb.select = () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ settings: { documentVerificationLinkExpiryDays: settingsHolder.value } }],
        }),
      }),
    });

    const baseRevision = {
      id: 'rev-exp-1',
      tenantId: 'tenant-1',
      revisionNumber: 1,
      verificationRef: 'INV-20260304-R001',
      verifyToken: 'token',
      sha256Hex: 'b'.repeat(64),
      fingerprintShort: '123456ABCDEF',
      issuedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      filePath: 'documents/t/r1.pdf',
      isNew: false,
    };

    try {
      settingsHolder.value = undefined;
      expect(await isDocumentRevisionVerificationExpired(baseRevision)).toBe(false);

      settingsHolder.value = 'not-a-number';
      expect(await isDocumentRevisionVerificationExpired(baseRevision)).toBe(false);

      settingsHolder.value = 3;
      expect(await isDocumentRevisionVerificationExpired(baseRevision)).toBe(true);

      settingsHolder.value = -4;
      expect(await isDocumentRevisionVerificationExpired(baseRevision)).toBe(false);
    } finally {
      mutableDb.select = originalSelect;
    }
  });

  it('covers revision lookup helpers with mocked select chains', async () => {
    const mutableDb = db as unknown as { select: (...args: unknown[]) => unknown };
    const originalSelect = mutableDb.select;

    const revisionRow = {
      id: 'rev-lookup-1',
      tenantId: 'tenant-lookup',
      revisionNumber: 9,
      verificationRef: 'INV-20260304-R009',
      verifyToken: 'verify-token-9',
      sha256Hex: 'c'.repeat(64),
      fingerprintShort: 'AAAABBBBCCCC',
      issuedAt: new Date('2026-03-04T00:00:00.000Z'),
      filePath: 'documents/tenant-lookup/rev9.pdf',
    };

    const rowsHolder: { value: unknown[] } = { value: [] };
    mutableDb.select = () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => rowsHolder.value,
          }),
          limit: async () => rowsHolder.value,
        }),
      }),
    });

    try {
      rowsHolder.value = [];
      expect(await getLatestDocumentRevisionByOrderId('ord-1', 'OFFER')).toBeNull();
      expect(await getLatestDocumentRevisionByStream({ documentType: 'INVOICE', orderId: 'ord-1' })).toBeNull();
      expect(await getDocumentRevisionByVerifyToken('missing')).toBeNull();

      rowsHolder.value = [revisionRow];

      const byOrder = await getLatestDocumentRevisionByOrderId('ord-1', 'OFFER');
      expect(byOrder?.id).toBe('rev-lookup-1');
      expect(byOrder?.isNew).toBe(false);

      const byStream = await getLatestDocumentRevisionByStream({
        documentType: 'INVOICE',
        orderId: 'ord-1',
      });
      expect(byStream?.verificationRef).toBe('INV-20260304-R009');

      const byToken = await getDocumentRevisionByVerifyToken('verify-token-9');
      expect(byToken?.tenantId).toBe('tenant-lookup');

      expect(await getLatestDocumentRevisionByStream({ documentType: 'OTHER' })).toBeNull();
    } finally {
      mutableDb.select = originalSelect;
    }
  });

  it('loads document revision buffer from disk and throws when missing', () => {
    const revision = {
      id: 'rev-file-1',
      tenantId: 'tenant-file',
      revisionNumber: 1,
      verificationRef: 'OFF-20260304-R001',
      verifyToken: 'token-file-1',
      sha256Hex: 'd'.repeat(64),
      fingerprintShort: 'DDDDEEEEFFFF',
      issuedAt: new Date('2026-03-04T00:00:00.000Z'),
      filePath: `documents/coverage/${Date.now()}-artifact.pdf`,
      isNew: false,
    };

    const absolutePath = join(process.cwd(), 'uploads', revision.filePath);
    mkdirSync(join(process.cwd(), 'uploads', 'documents', 'coverage'), { recursive: true });
    writeFileSync(absolutePath, Buffer.from('pdf-buffer-probe'));

    try {
      const loaded = loadDocumentRevisionBuffer(revision);
      expect(loaded.equals(Buffer.from('pdf-buffer-probe'))).toBe(true);
    } finally {
      rmSync(absolutePath, { force: true });
    }

    expect(() => loadDocumentRevisionBuffer(revision)).toThrow('Document artifact missing on disk');
  });

  it('covers fetchInvoiceData fallback/rethrow/not-found branches', async () => {
    const mutableDb = db as unknown as {
      query: { invoices: { findFirst: (...args: unknown[]) => Promise<unknown> } };
    };
    const originalFindFirst = mutableDb.query.invoices.findFirst;

    try {
      let invoiceCalls = 0;
      mutableDb.query.invoices.findFirst = async () => {
        invoiceCalls += 1;
        if (invoiceCalls === 1) throw new Error('column company_registration_number does not exist');
        return { id: 'inv-fallback-1', order: { id: 'ord-1' } };
      };

      const fallbackInvoice = await __documentTestUtils.fetchInvoiceData('inv-fallback-1');
      expect((fallbackInvoice as { id: string }).id).toBe('inv-fallback-1');
      expect(invoiceCalls).toBe(2);

      mutableDb.query.invoices.findFirst = async () => {
        throw new Error('database offline');
      };
      await expect(__documentTestUtils.fetchInvoiceData('inv-fallback-1')).rejects.toThrow('database offline');

      mutableDb.query.invoices.findFirst = async () => null;
      await expect(__documentTestUtils.fetchInvoiceData('inv-missing')).rejects.toThrow('Invoice inv-missing not found');
    } finally {
      mutableDb.query.invoices.findFirst = originalFindFirst;
    }
  });

  it('covers fetchOrderForInvoice fallback/rethrow/not-found branches', async () => {
    const mutableDb = db as unknown as {
      query: { orders: { findFirst: (...args: unknown[]) => Promise<unknown> } };
    };
    const originalFindFirst = mutableDb.query.orders.findFirst;

    try {
      let orderCalls = 0;
      mutableDb.query.orders.findFirst = async () => {
        orderCalls += 1;
        if (orderCalls === 1) throw new Error('missing company_registration_number on relation');
        return { id: 'ord-fallback-1', items: [] };
      };

      const fallbackOrder = await __documentTestUtils.fetchOrderForInvoice('ord-fallback-1');
      expect((fallbackOrder as { id: string }).id).toBe('ord-fallback-1');
      expect(orderCalls).toBe(2);

      mutableDb.query.orders.findFirst = async () => {
        throw new Error('permission denied');
      };
      await expect(__documentTestUtils.fetchOrderForInvoice('ord-fallback-1')).rejects.toThrow('permission denied');

      mutableDb.query.orders.findFirst = async () => null;
      await expect(__documentTestUtils.fetchOrderForInvoice('ord-missing')).rejects.toThrow('Order ord-missing not found');
    } finally {
      mutableDb.query.orders.findFirst = originalFindFirst;
    }
  });

  it('covers loadOrderBankDetails specific/default/global fallback branches', async () => {
    const mutableDb = db as unknown as { select: (...args: unknown[]) => unknown };
    const originalSelect = mutableDb.select;

    const responses: unknown[][] = [];
    mutableDb.select = () => ({
      from: () => ({
        where: () => ({
          limit: async () => responses.shift() ?? [],
        }),
      }),
    });

    try {
      responses.push([{
        bankName: 'Specific Bank',
        accountName: 'Specific Account',
        accountNumber: '123',
        iban: 'IBAN123',
        swiftBic: 'SWIFT123',
        currency: 'USD',
        branchAddress: 'Specific Branch',
        intermediaryBank: 'Specific Intermediary',
      }]);

      const specific = await __documentTestUtils.loadOrderBankDetails('ba-1', 'cp-1');
      expect(specific.bankName).toBe('Specific Bank');
      expect(specific.swift).toBe('SWIFT123');

      responses.push([], [{
        bankName: 'Default Bank',
        accountName: 'Default Account',
        accountNumber: '456',
        iban: 'IBAN456',
        swiftBic: 'SWIFT456',
        currency: 'EUR',
        branchAddress: 'Default Branch',
        intermediaryBank: 'Default Intermediary',
      }]);

      const companyDefault = await __documentTestUtils.loadOrderBankDetails('missing-bank', 'cp-2');
      expect(companyDefault.bankName).toBe('Default Bank');
      expect(companyDefault.currency).toBe('EUR');

      responses.push([], []);
      const unresolvedCompanyDefault = await __documentTestUtils.loadOrderBankDetails('missing-bank-2', 'cp-3');
      expect(unresolvedCompanyDefault.bankName).toBe('DNB Bank ASA');

      const globalDefault = await __documentTestUtils.loadOrderBankDetails(null, null);
      expect(globalDefault.bankName).toBe('DNB Bank ASA');
      expect(globalDefault.swift).toBe('DNBANOKKXXX');
    } finally {
      mutableDb.select = originalSelect;
    }
  });

  it('covers overwriteDocumentRevisionArtifact write and update path', async () => {
    const mutableDb = db as unknown as {
      update: (...args: unknown[]) => { set: (...args: unknown[]) => { where: (...args: unknown[]) => Promise<unknown> } };
    };
    const originalUpdate = mutableDb.update;

    let observedFileSize = 0;
    mutableDb.update = () => ({
      set: (payload: unknown) => {
        observedFileSize = (payload as { fileSize: number }).fileSize;
        return {
          where: async () => undefined,
        };
      },
    });

    const revision = {
      id: 'rev-overwrite-1',
      tenantId: 'tenant-overwrite',
      revisionNumber: 2,
      verificationRef: 'INV-20260304-R002',
      verifyToken: 'overwrite-token',
      sha256Hex: 'e'.repeat(64),
      fingerprintShort: 'EEEEFFFFGGGG',
      issuedAt: new Date('2026-03-04T00:00:00.000Z'),
      filePath: `documents/coverage/${Date.now()}-overwrite.pdf`,
      isNew: false,
    };
    const payload = Buffer.from('overwritten-pdf-content');
    const absolutePath = join(process.cwd(), 'uploads', revision.filePath);

    try {
      await __documentTestUtils.overwriteDocumentRevisionArtifact(revision, payload);
      const loaded = loadDocumentRevisionBuffer(revision);
      expect(loaded.equals(payload)).toBe(true);
      expect(observedFileSize).toBe(payload.length);
    } finally {
      mutableDb.update = originalUpdate;
      rmSync(absolutePath, { force: true });
    }
  });

  it('covers persistDocumentRevision core branches', async () => {
    const mutableDb = db as unknown as {
      select: (...args: unknown[]) => unknown;
      insert: (...args: unknown[]) => unknown;
    };
    const originalSelect = mutableDb.select;
    const originalInsert = mutableDb.insert;

    const selectResponses: unknown[][] = [];
    mutableDb.select = () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => selectResponses.shift() ?? [],
          }),
          limit: async () => selectResponses.shift() ?? [],
        }),
      }),
    });

    let shouldThrowOnInsert = false;
    let lastInsertedPayload: Record<string, unknown> | null = null;
    mutableDb.insert = () => ({
      values: (payload: Record<string, unknown>) => {
        lastInsertedPayload = payload;
        return {
          returning: async () => {
            if (shouldThrowOnInsert) throw new Error('insert conflict');
            return [{ id: 'rev-new-1', ...payload }];
          },
        };
      },
    });

    const commonParams = {
      tenantId: 'tenant-persist',
      orderId: 'ord-1',
      invoiceId: null,
      documentType: 'OFFER' as const,
      fileName: 'Offer_ORD-1.pdf',
      buffer: Buffer.from('persist-pdf-content'),
      generatedBy: 'user-1',
    };

    try {
      await expect(__documentTestUtils.persistDocumentRevision({
        ...commonParams,
        orderId: null,
      })).rejects.toThrow('Missing document stream target');

      const existingRow = {
        id: 'rev-existing-1',
        tenantId: 'tenant-persist',
        revisionNumber: 3,
        verificationRef: 'OFF-20260304-R003',
        verifyToken: 'token-existing',
        sha256Hex: 'f'.repeat(64),
        fingerprintShort: 'FFFF11112222',
        issuedAt: new Date('2026-03-04T00:00:00.000Z'),
        filePath: 'documents/tenant-persist/existing.pdf',
      };
      selectResponses.push([existingRow]);
      const existing = await __documentTestUtils.persistDocumentRevision(commonParams);
      expect(existing.id).toBe('rev-existing-1');
      expect(existing.isNew).toBe(false);

      shouldThrowOnInsert = false;
      selectResponses.push([], [{ revisionNumber: 2 }]);
      const inserted = await __documentTestUtils.persistDocumentRevision(commonParams);
      expect(inserted.id).toBe('rev-new-1');
      expect(inserted.revisionNumber).toBe(3);
      expect(inserted.isNew).toBe(true);
      expect(Number(lastInsertedPayload?.['fileSize'])).toBe(commonParams.buffer.length);

      const insertedPath = join(process.cwd(), 'uploads', inserted.filePath);
      rmSync(insertedPath, { force: true });

      shouldThrowOnInsert = true;
      const concurrentRow = {
        id: 'rev-concurrent-1',
        tenantId: 'tenant-persist',
        revisionNumber: 4,
        verificationRef: 'OFF-20260304-R004',
        verifyToken: 'token-concurrent',
        sha256Hex: 'f'.repeat(64),
        fingerprintShort: 'CONCURRENT12',
        issuedAt: new Date('2026-03-04T00:00:00.000Z'),
        filePath: 'documents/tenant-persist/concurrent.pdf',
      };
      selectResponses.push([], [{ revisionNumber: 3 }], [concurrentRow]);
      const concurrent = await __documentTestUtils.persistDocumentRevision(commonParams);
      expect(concurrent.id).toBe('rev-concurrent-1');
      expect(concurrent.isNew).toBe(false);

      shouldThrowOnInsert = true;
      selectResponses.push([], [{ revisionNumber: 4 }], []);
      await expect(__documentTestUtils.persistDocumentRevision(commonParams)).rejects.toThrow('Failed to persist document revision');
    } finally {
      mutableDb.select = originalSelect;
      mutableDb.insert = originalInsert;
    }
  });

  it('generates invoice PDF buffer through public API with mocked invoice query', async () => {
    const mutableDb = db as unknown as {
      query: { invoices: { findFirst: (...args: unknown[]) => Promise<unknown> } };
    };
    const originalFindFirst = mutableDb.query.invoices.findFirst;

    mutableDb.query.invoices.findFirst = async () => ({
      id: 'inv-public-1',
      invoiceNumber: 'INV-PUBLIC-1',
      dueDate: '2026-03-20',
      amount: '50000',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      order: {
        id: 'ord-public-1',
        orderNumber: 'ORD-PUBLIC-1',
        bankAccountId: null,
        invoicingCompanyId: null,
        client: { name: 'Acme Marine', country: 'Denmark' },
        vessel: { name: 'Aurora', imo: '1234567' },
        place: { name: 'Rotterdam' },
        salesRep: { name: 'John Trader' },
        customerPaymentTermType: 'CREDIT',
        customerCreditDays: 30,
        customerNote: null,
        items: [{
          productType: 'VLSFO',
          customerNote: null,
          deliveredQuantity: '100',
          quantity: '100',
          unit: 'MT',
          salesPrice: '500',
          costPrice: '450',
        }],
        invoicingCompany: {
          name: 'Fueld Trading Ltd',
          vatNumber: 'VAT-123',
          fraudPreventionText: null,
          latePaymentInterest: null,
          logoUrl: null,
          headOfficeAddress: null,
          headOfficePhone: null,
          headOfficeEmail: null,
        },
      },
    });

    try {
      const buffer = await generateInvoicePdfBuffer('inv-public-1');
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(100);
    } finally {
      mutableDb.query.invoices.findFirst = originalFindFirst;
    }
  });

  it('returns cached order invoice revision when source data is older', async () => {
    const mutableDb = db as unknown as {
      query: { orders: { findFirst: (...args: unknown[]) => Promise<unknown> } };
      select: (...args: unknown[]) => unknown;
    };
    const originalFindFirst = mutableDb.query.orders.findFirst;
    const originalSelect = mutableDb.select;

    const cachedRevision = {
      id: 'rev-cached-1',
      tenantId: 'tenant-cached',
      revisionNumber: 8,
      verificationRef: 'INV-20260304-R008',
      verifyToken: 'cached-token',
      sha256Hex: 'a'.repeat(64),
      fingerprintShort: 'CACHED123456',
      issuedAt: new Date('2026-03-10T00:00:00.000Z'),
      filePath: `documents/cache/${Date.now()}-cached-invoice.pdf`,
    };

    const cachedBuffer = Buffer.from('cached-invoice-buffer');
    const cachedAbsolutePath = join(process.cwd(), 'uploads', cachedRevision.filePath);
    mkdirSync(join(process.cwd(), 'uploads', 'documents', 'cache'), { recursive: true });
    writeFileSync(cachedAbsolutePath, cachedBuffer);

    mutableDb.query.orders.findFirst = async () => ({
      id: 'ord-cached-1',
      tenantId: 'tenant-cached',
      orderNumber: 'ORD-CACHED-1',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      deliveredAt: null,
      eta: new Date('2026-03-02T00:00:00.000Z'),
      customerPaymentTermType: 'CREDIT',
      customerCreditDays: 30,
      bankAccountId: null,
      invoicingCompanyId: null,
      customerNote: null,
      client: { name: 'Acme Marine', country: 'Denmark', updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      vessel: { name: 'Aurora', imo: '1234567', updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      place: { name: 'Rotterdam', updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      salesRep: { name: 'John Trader', updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      supplier: null,
      invoicingCompany: { updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      customerContact: { updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      supplierContact: { updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      items: [{ updatedAt: new Date('2026-03-01T00:00:00.000Z') }],
      invoices: [{
        id: 'inv-cached-1',
        invoiceNumber: 'INV-CACHED-1',
        amount: '50000',
        dueDate: '2026-03-20',
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      }],
    });

    mutableDb.select = () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => [cachedRevision],
          }),
          limit: async () => [cachedRevision],
        }),
      }),
    });

    try {
      const result = await generateOrderInvoicePdfBuffer('ord-cached-1');
      expect(result.invoiceNumber).toBe('INV-CACHED-1');
      expect(result.revision.id).toBe('rev-cached-1');
      expect(result.buffer.equals(cachedBuffer)).toBe(true);
      expect(result.fileName).toContain('Fueld_Invoice_INV-CACHED-1.pdf');
    } finally {
      mutableDb.query.orders.findFirst = originalFindFirst;
      mutableDb.select = originalSelect;
      rmSync(cachedAbsolutePath, { force: true });
    }
  });

  it('generates preview order invoice when no invoice exists and uses persisted existing revision artifact', async () => {
    const mutableDb = db as unknown as {
      query: { orders: { findFirst: (...args: unknown[]) => Promise<unknown> } };
      select: (...args: unknown[]) => unknown;
    };
    const originalFindFirst = mutableDb.query.orders.findFirst;
    const originalSelect = mutableDb.select;

    const persistedRevision = {
      id: 'rev-preview-1',
      tenantId: 'tenant-preview',
      revisionNumber: 1,
      verificationRef: 'INV-20260304-R001',
      verifyToken: 'preview-token',
      sha256Hex: 'b'.repeat(64),
      fingerprintShort: 'PREVIEW12345',
      issuedAt: new Date('2026-03-01T00:00:00.000Z'),
      filePath: `documents/preview/${Date.now()}-preview-invoice.pdf`,
    };

    const persistedBuffer = Buffer.from('preview-persisted-buffer');
    const persistedAbsolutePath = join(process.cwd(), 'uploads', persistedRevision.filePath);
    mkdirSync(join(process.cwd(), 'uploads', 'documents', 'preview'), { recursive: true });
    writeFileSync(persistedAbsolutePath, persistedBuffer);

    mutableDb.query.orders.findFirst = async () => ({
      id: 'ord-preview-1',
      tenantId: 'tenant-preview',
      orderNumber: 'ORD-PREVIEW-1',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      deliveredAt: null,
      eta: new Date('2026-03-05T00:00:00.000Z'),
      customerPaymentTermType: 'CREDIT',
      customerCreditDays: 10,
      bankAccountId: null,
      invoicingCompanyId: null,
      customerNote: null,
      client: {
        name: 'Acme Marine',
        country: 'Denmark',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      vessel: { name: 'Aurora', imo: '1234567', updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      place: { name: 'Rotterdam', updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      salesRep: { name: 'John Trader', updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      supplier: null,
      invoicingCompany: {
        name: 'Fueld Trading Ltd',
        vatNumber: 'VAT-123',
        fraudPreventionText: null,
        latePaymentInterest: null,
        logoUrl: null,
        headOfficeAddress: null,
        headOfficePhone: null,
        headOfficeEmail: null,
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      customerContact: { updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      supplierContact: { updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      items: [{
        productType: 'VLSFO',
        customerNote: null,
        deliveredQuantity: null,
        quantity: '100',
        unit: 'MT',
        salesPrice: '500',
        costPrice: '450',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      }],
      invoices: [],
    });

    const selectResponses: unknown[][] = [[], [persistedRevision]];
    mutableDb.select = () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => selectResponses.shift() ?? [],
          }),
          limit: async () => selectResponses.shift() ?? [],
        }),
      }),
    });

    try {
      const result = await generateOrderInvoicePdfBuffer('ord-preview-1');
      expect(result.invoiceNumber).toContain('PREVIEW-ORD-PREV');
      expect(result.fileName).toContain('Fueld_Invoice_PREVIEW-ORD-PREV');
      expect(result.revision.id).toBe('rev-preview-1');
      expect(result.buffer.equals(persistedBuffer)).toBe(true);
    } finally {
      mutableDb.query.orders.findFirst = originalFindFirst;
      mutableDb.select = originalSelect;
      rmSync(persistedAbsolutePath, { force: true });
    }
  });

  it('generates offer PDF through non-cached path and returns persisted existing revision artifact', async () => {
    const mutableDb = db as unknown as {
      query: { orders: { findFirst: (...args: unknown[]) => Promise<unknown> } };
      select: (...args: unknown[]) => unknown;
    };
    const originalFindFirst = mutableDb.query.orders.findFirst;
    const originalSelect = mutableDb.select;

    const persistedRevision = {
      id: 'rev-offer-1',
      tenantId: 'tenant-offer',
      revisionNumber: 2,
      verificationRef: 'OFF-20260304-R002',
      verifyToken: 'offer-token',
      sha256Hex: '1'.repeat(64),
      fingerprintShort: 'OFFERABC1234',
      issuedAt: new Date('2026-03-01T00:00:00.000Z'),
      filePath: `documents/offer/${Date.now()}-offer.pdf`,
    };
    const persistedBuffer = Buffer.from('offer-existing-buffer');
    const persistedAbsolutePath = join(process.cwd(), 'uploads', persistedRevision.filePath);
    mkdirSync(join(process.cwd(), 'uploads', 'documents', 'offer'), { recursive: true });
    writeFileSync(persistedAbsolutePath, persistedBuffer);

    mutableDb.query.orders.findFirst = async () => ({
      id: 'ord-offer-1',
      tenantId: 'tenant-offer',
      status: 'INQUIRY',
      orderNumber: 'ORD-OFFER-1',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      eta: new Date('2026-03-06T00:00:00.000Z'),
      etd: new Date('2026-03-06T06:00:00.000Z'),
      currency: 'USD',
      customerPaymentTermType: 'CREDIT',
      customerCreditDays: 15,
      customerNote: 'Offer note',
      termsAndConditions: 'Issued by ${companyName} (${offerOrConfirmation})',
      client: {
        name: 'Acme Marine',
        country: 'Denmark',
        headOfficeAddress: 'Harbor 1',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      vessel: { name: 'Aurora', imo: '1234567', updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      place: {
        name: 'Rotterdam',
        timezone: 'UTC+1',
        orderRemark: 'Pilot required',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      salesRep: {
        name: 'John Trader',
        email: 'john@example.com',
        phone: '+4526131217',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      supplier: null,
      customerContact: {
        name: 'Jane Doe',
        role: 'Buyer',
        phone: '+4526131217',
        email: 'jane@example.com',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      supplierContact: { updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      invoicingCompany: {
        name: 'Fueld Trading Ltd',
        customerTerms: 'Default terms for ${documentName}',
        headOfficeAddress: 'Main Street 1',
        headOfficePhone: '+4799998888',
        headOfficeEmail: 'ops@fueld.com',
        vatNumber: 'VAT-123',
        website: 'https://fueld.com',
        logoUrl: null,
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      items: [{
        productType: 'VLSFO',
        description: 'ISO 8217',
        quantity: '100',
        quantityMin: null,
        quantityMax: null,
        unit: 'MT',
        salesPrice: '500',
        customerNote: 'Offer item note',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      }],
      invoices: [],
    });

    const selectResponses: unknown[][] = [[], [persistedRevision]];
    mutableDb.select = () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => selectResponses.shift() ?? [],
          }),
          limit: async () => selectResponses.shift() ?? [],
        }),
      }),
    });

    try {
      const result = await generateOfferPdfBuffer('ord-offer-1');
      expect(result.revision.id).toBe('rev-offer-1');
      expect(result.fileName).toContain('Offer_ORD-OFFER-1.pdf');
      expect(result.buffer.equals(persistedBuffer)).toBe(true);
    } finally {
      mutableDb.query.orders.findFirst = originalFindFirst;
      mutableDb.select = originalSelect;
      rmSync(persistedAbsolutePath, { force: true });
    }
  });

  it('generates nomination PDF through non-cached path and returns persisted existing revision artifact', async () => {
    const mutableDb = db as unknown as {
      query: { orders: { findFirst: (...args: unknown[]) => Promise<unknown> } };
      select: (...args: unknown[]) => unknown;
    };
    const originalFindFirst = mutableDb.query.orders.findFirst;
    const originalSelect = mutableDb.select;

    const persistedRevision = {
      id: 'rev-nomination-1',
      tenantId: 'tenant-nomination',
      revisionNumber: 1,
      verificationRef: 'DOC-20260304-R001',
      verifyToken: 'nom-token',
      sha256Hex: '2'.repeat(64),
      fingerprintShort: 'NOMABC123456',
      issuedAt: new Date('2026-03-01T00:00:00.000Z'),
      filePath: `documents/nomination/${Date.now()}-nomination.pdf`,
    };
    const persistedBuffer = Buffer.from('nomination-existing-buffer');
    const persistedAbsolutePath = join(process.cwd(), 'uploads', persistedRevision.filePath);
    mkdirSync(join(process.cwd(), 'uploads', 'documents', 'nomination'), { recursive: true });
    writeFileSync(persistedAbsolutePath, persistedBuffer);

    mutableDb.query.orders.findFirst = async () => ({
      id: 'ord-nomination-1',
      tenantId: 'tenant-nomination',
      orderNumber: 'ORD-NOM-1',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      eta: new Date('2026-03-06T00:00:00.000Z'),
      etd: new Date('2026-03-06T06:00:00.000Z'),
      currency: 'USD',
      supplierPaymentTermType: 'CREDIT',
      supplierCreditDays: 10,
      supplier: {
        name: 'Supplier Co',
        country: 'Norway',
        headOfficeAddress: 'Supplier Street 1',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      supplierContact: {
        name: 'Supplier Contact',
        role: 'Sales',
        phone: '+4712345678',
        email: 'supplier@example.com',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      vessel: { name: 'Aurora', imo: '1234567', updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      place: { name: 'Rotterdam', timezone: 'UTC+1', updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      salesRep: {
        name: 'John Trader',
        email: 'john@example.com',
        phone: '+4526131217',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      client: { updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      customerContact: { updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      invoicingCompany: {
        name: 'Fueld Trading Ltd',
        supplierTerms: 'Supplier terms for ${documentName}',
        headOfficeAddress: 'Main Street 1',
        headOfficePhone: '+4799998888',
        headOfficeEmail: 'ops@fueld.com',
        vatNumber: 'VAT-123',
        website: 'https://fueld.com',
        logoUrl: null,
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      items: [{
        productType: 'MGO',
        description: 'DMA',
        quantity: '25',
        quantityMin: null,
        quantityMax: null,
        unit: 'MT',
        salesPrice: '700',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      }],
      invoices: [],
    });

    const selectResponses: unknown[][] = [[], [persistedRevision]];
    mutableDb.select = () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => selectResponses.shift() ?? [],
          }),
          limit: async () => selectResponses.shift() ?? [],
        }),
      }),
    });

    try {
      const result = await generateNominationPdfBuffer('ord-nomination-1');
      expect(result.revision.id).toBe('rev-nomination-1');
      expect(result.fileName).toContain('Nomination_ORD-NOM-1.pdf');
      expect(result.buffer.equals(persistedBuffer)).toBe(true);
    } finally {
      mutableDb.query.orders.findFirst = originalFindFirst;
      mutableDb.select = originalSelect;
      rmSync(persistedAbsolutePath, { force: true });
    }
  });

  it('generates proforma PDF through non-cached path and returns persisted existing revision artifact', async () => {
    const mutableDb = db as unknown as {
      query: { orders: { findFirst: (...args: unknown[]) => Promise<unknown> } };
      select: (...args: unknown[]) => unknown;
    };
    const originalFindFirst = mutableDb.query.orders.findFirst;
    const originalSelect = mutableDb.select;

    const persistedRevision = {
      id: 'rev-proforma-1',
      tenantId: 'tenant-proforma',
      revisionNumber: 5,
      verificationRef: 'PFI-20260304-R005',
      verifyToken: 'proforma-token',
      sha256Hex: '3'.repeat(64),
      fingerprintShort: 'PFIABC123456',
      issuedAt: new Date('2026-03-01T00:00:00.000Z'),
      filePath: `documents/proforma/${Date.now()}-proforma.pdf`,
    };
    const persistedBuffer = Buffer.from('proforma-existing-buffer');
    const persistedAbsolutePath = join(process.cwd(), 'uploads', persistedRevision.filePath);
    mkdirSync(join(process.cwd(), 'uploads', 'documents', 'proforma'), { recursive: true });
    writeFileSync(persistedAbsolutePath, persistedBuffer);

    mutableDb.query.orders.findFirst = async () => ({
      id: 'ord-proforma-1',
      tenantId: 'tenant-proforma',
      orderNumber: 'ORD-PRO-1',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      eta: new Date('2026-03-06T00:00:00.000Z'),
      etd: new Date('2026-03-06T06:00:00.000Z'),
      currency: 'USD',
      bankAccountId: null,
      invoicingCompanyId: 'cp-1',
      customerPaymentTermType: 'CREDIT',
      customerCreditDays: 20,
      customerNote: 'Proforma note',
      termsAndConditions: 'Net payment terms',
      client: {
        name: 'Acme Marine',
        country: 'Denmark',
        headOfficeAddress: 'Harbor 1',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      vessel: { name: 'Aurora', imo: '1234567', updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      place: {
        name: 'Rotterdam',
        timezone: 'UTC+1',
        orderRemark: 'Pilot required',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      salesRep: {
        name: 'John Trader',
        email: 'john@example.com',
        phone: '+4526131217',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      supplier: null,
      customerContact: {
        name: 'Jane Doe',
        role: 'Buyer',
        phone: '+4526131217',
        email: 'jane@example.com',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      supplierContact: { updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      invoicingCompany: {
        name: 'Fueld Trading Ltd',
        headOfficeAddress: 'Main Street 1',
        headOfficePhone: '+4799998888',
        headOfficeEmail: 'ops@fueld.com',
        vatNumber: 'VAT-123',
        website: 'https://fueld.com',
        fraudPreventionText: 'Verify account details by phone',
        latePaymentInterest: '2%',
        logoUrl: null,
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      items: [{
        productType: 'VLSFO',
        description: 'ISO 8217',
        quantity: '100',
        unit: 'MT',
        salesPrice: '500',
        customerNote: null,
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      }],
      invoices: [],
    });

    const selectResponses: unknown[][] = [[], [{
      bankName: 'DNB',
      accountName: 'Fueld Trading Ltd',
      accountNumber: '12345678',
      iban: 'NO9386011117947',
      swiftBic: 'DNBANOKKXXX',
      currency: 'USD',
      branchAddress: 'Oslo',
      intermediaryBank: 'Intermediary',
    }], [persistedRevision]];
    mutableDb.select = () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => selectResponses.shift() ?? [],
          }),
          limit: async () => selectResponses.shift() ?? [],
        }),
      }),
    });

    try {
      const result = await generateProformaInvoicePdfBuffer('ord-proforma-1');
      expect(result.revision.id).toBe('rev-proforma-1');
      expect(result.fileName).toContain('Proforma_Invoice_ORD-PRO-1.pdf');
      expect(result.buffer.equals(persistedBuffer)).toBe(true);
    } finally {
      mutableDb.query.orders.findFirst = originalFindFirst;
      mutableDb.select = originalSelect;
      rmSync(persistedAbsolutePath, { force: true });
    }
  });

  it('covers generateInvoicePdfBuffer QR catch and logo file branch', async () => {
    const mutableDb = db as unknown as {
      query: { invoices: { findFirst: (...args: unknown[]) => Promise<unknown> } };
    };
    const originalFindFirst = mutableDb.query.invoices.findFirst;
    const originalQr = QRCode.toDataURL;

    const logoRelativePath = `logos/${Date.now()}-invoice-logo.png`;
    const logoAbsolutePath = join(process.cwd(), 'uploads', logoRelativePath);
    mkdirSync(join(process.cwd(), 'uploads', 'logos'), { recursive: true });
    writeFileSync(logoAbsolutePath, Buffer.from(tinyPngBase64, 'base64'));

    mutableDb.query.invoices.findFirst = async () => ({
      id: 'inv-logo-1',
      invoiceNumber: 'INV-LOGO-1',
      dueDate: '2026-03-20',
      amount: '50000',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      order: {
        id: 'ord-logo-1',
        orderNumber: 'ORD-LOGO-1',
        bankAccountId: null,
        invoicingCompanyId: null,
        client: { name: 'Acme Marine', country: 'Denmark' },
        vessel: { name: 'Aurora', imo: '1234567' },
        place: { name: 'Rotterdam' },
        salesRep: { name: 'John Trader' },
        customerPaymentTermType: 'CREDIT',
        customerCreditDays: 30,
        customerNote: null,
        items: [{
          productType: 'VLSFO',
          customerNote: null,
          deliveredQuantity: '100',
          quantity: '100',
          unit: 'MT',
          salesPrice: '500',
          costPrice: '450',
        }],
        invoicingCompany: {
          name: 'Fueld Trading Ltd',
          vatNumber: 'VAT-123',
          fraudPreventionText: null,
          latePaymentInterest: null,
          logoUrl: logoRelativePath,
          headOfficeAddress: null,
          headOfficePhone: null,
          headOfficeEmail: null,
        },
      },
    });

    QRCode.toDataURL = (async () => {
      throw new Error('qr failed');
    }) as typeof QRCode.toDataURL;

    try {
      const buffer = await generateInvoicePdfBuffer('inv-logo-1');
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(100);
    } finally {
      mutableDb.query.invoices.findFirst = originalFindFirst;
      QRCode.toDataURL = originalQr;
      rmSync(logoAbsolutePath, { force: true });
    }
  });

  it('covers generateOrderInvoicePdfBuffer new-revision finalization and token-QR catch', async () => {
    const mutableDb = db as unknown as {
      query: { orders: { findFirst: (...args: unknown[]) => Promise<unknown> } };
      select: (...args: unknown[]) => unknown;
      insert: (...args: unknown[]) => unknown;
      update: (...args: unknown[]) => { set: (...args: unknown[]) => { where: (...args: unknown[]) => Promise<unknown> } };
    };
    const originalFindFirst = mutableDb.query.orders.findFirst;
    const originalSelect = mutableDb.select;
    const originalInsert = mutableDb.insert;
    const originalUpdate = mutableDb.update;
    const originalQr = QRCode.toDataURL;

    mutableDb.query.orders.findFirst = async () => ({
      id: 'ord-new-invoice-1',
      tenantId: 'tenant-new-invoice',
      orderNumber: 'ORD-NEW-INV-1',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      deliveredAt: null,
      eta: new Date('2026-03-05T00:00:00.000Z'),
      customerPaymentTermType: 'CREDIT',
      customerCreditDays: 10,
      bankAccountId: null,
      invoicingCompanyId: null,
      customerNote: null,
      client: { name: 'Acme Marine', country: 'Denmark', updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      vessel: { name: 'Aurora', imo: '1234567', updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      place: { name: 'Rotterdam', updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      salesRep: { name: 'John Trader', updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      supplier: null,
      invoicingCompany: {
        name: 'Fueld Trading Ltd',
        vatNumber: 'VAT-123',
        fraudPreventionText: null,
        latePaymentInterest: null,
        logoUrl: null,
        headOfficeAddress: null,
        headOfficePhone: null,
        headOfficeEmail: null,
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      customerContact: { updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      supplierContact: { updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      items: [{
        productType: 'VLSFO',
        customerNote: null,
        deliveredQuantity: null,
        quantity: '100',
        unit: 'MT',
        salesPrice: '500',
        costPrice: '450',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      }],
      invoices: [{
        id: 'inv-new-1',
        invoiceNumber: 'INV-NEW-1',
        amount: '50000',
        dueDate: '2026-03-20',
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      }],
    });

    const selectResponses: unknown[][] = [[], [], [{ revisionNumber: 0 }]];
    mutableDb.select = () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => selectResponses.shift() ?? [],
          }),
          limit: async () => selectResponses.shift() ?? [],
        }),
      }),
    });

    mutableDb.insert = () => ({
      values: (payload: Record<string, unknown>) => ({
        returning: async () => [{ id: 'rev-new-invoice-1', ...payload }],
      }),
    });

    mutableDb.update = () => ({
      set: () => ({ where: async () => undefined }),
    });

    let qrCalls = 0;
    QRCode.toDataURL = (async () => {
      qrCalls += 1;
      if (qrCalls === 1) return tinyPngDataUrl;
      throw new Error('token qr failed');
    }) as typeof QRCode.toDataURL;

    try {
      const result = await generateOrderInvoicePdfBuffer('ord-new-invoice-1');
      expect(result.revision.isNew).toBe(true);
      expect(result.revision.id).toBe('rev-new-invoice-1');
      expect(result.invoiceNumber).toBe('INV-NEW-1');
      expect(Buffer.isBuffer(result.buffer)).toBe(true);
      expect(qrCalls).toBe(2);

      const revisionAbsolutePath = join(process.cwd(), 'uploads', result.revision.filePath);
      rmSync(revisionAbsolutePath, { force: true });
    } finally {
      mutableDb.query.orders.findFirst = originalFindFirst;
      mutableDb.select = originalSelect;
      mutableDb.insert = originalInsert;
      mutableDb.update = originalUpdate;
      QRCode.toDataURL = originalQr;
    }
  });

  it('covers generateOfferPdfBuffer new-revision finalization path', async () => {
    const mutableDb = db as unknown as {
      query: { orders: { findFirst: (...args: unknown[]) => Promise<unknown> } };
      select: (...args: unknown[]) => unknown;
      insert: (...args: unknown[]) => unknown;
      update: (...args: unknown[]) => { set: (...args: unknown[]) => { where: (...args: unknown[]) => Promise<unknown> } };
    };
    const originalFindFirst = mutableDb.query.orders.findFirst;
    const originalSelect = mutableDb.select;
    const originalInsert = mutableDb.insert;
    const originalUpdate = mutableDb.update;

    mutableDb.query.orders.findFirst = async () => ({
      id: 'ord-offer-new-1',
      tenantId: 'tenant-offer-new',
      status: 'OFFER',
      orderNumber: 'ORD-OFFER-NEW-1',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      eta: new Date('2026-03-06T00:00:00.000Z'),
      etd: new Date('2026-03-06T06:00:00.000Z'),
      currency: 'USD',
      customerPaymentTermType: 'CREDIT',
      customerCreditDays: 15,
      customerNote: 'Offer note',
      termsAndConditions: 'Issued by ${companyName} (${offerOrConfirmation})',
      client: {
        name: 'Acme Marine',
        country: 'Denmark',
        headOfficeAddress: 'Harbor 1',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      vessel: { name: 'Aurora', imo: '1234567', updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      place: {
        name: 'Rotterdam',
        timezone: 'UTC+1',
        orderRemark: 'Pilot required',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      salesRep: {
        name: 'John Trader',
        email: 'john@example.com',
        phone: '+4526131217',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      supplier: null,
      customerContact: {
        name: 'Jane Doe',
        role: 'Buyer',
        phone: '+4526131217',
        email: 'jane@example.com',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      supplierContact: { updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      invoicingCompany: {
        name: 'Fueld Trading Ltd',
        customerTerms: 'Default terms for ${documentName}',
        headOfficeAddress: 'Main Street 1',
        headOfficePhone: '+4799998888',
        headOfficeEmail: 'ops@fueld.com',
        vatNumber: 'VAT-123',
        website: 'https://fueld.com',
        logoUrl: null,
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      items: [{
        productType: 'VLSFO',
        description: 'ISO 8217',
        quantity: '100',
        quantityMin: null,
        quantityMax: null,
        unit: 'MT',
        salesPrice: '500',
        customerNote: null,
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      }],
      invoices: [],
    });

    const selectResponses: unknown[][] = [[], [], [{ revisionNumber: 0 }]];
    mutableDb.select = () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => selectResponses.shift() ?? [],
          }),
          limit: async () => selectResponses.shift() ?? [],
        }),
      }),
    });

    mutableDb.insert = () => ({
      values: (payload: Record<string, unknown>) => ({
        returning: async () => [{ id: 'rev-offer-new-1', ...payload }],
      }),
    });

    mutableDb.update = () => ({
      set: () => ({ where: async () => undefined }),
    });

    try {
      const result = await generateOfferPdfBuffer('ord-offer-new-1');
      expect(result.revision.id).toBe('rev-offer-new-1');
      expect(result.revision.isNew).toBe(true);
      expect(result.fileName).toContain('Offer_ORD-OFFER-NEW-1.pdf');
      expect(Buffer.isBuffer(result.buffer)).toBe(true);

      const revisionAbsolutePath = join(process.cwd(), 'uploads', result.revision.filePath);
      rmSync(revisionAbsolutePath, { force: true });
    } finally {
      mutableDb.query.orders.findFirst = originalFindFirst;
      mutableDb.select = originalSelect;
      mutableDb.insert = originalInsert;
      mutableDb.update = originalUpdate;
    }
  });

  it('covers generateNominationPdfBuffer new-revision finalization path', async () => {
    const mutableDb = db as unknown as {
      query: { orders: { findFirst: (...args: unknown[]) => Promise<unknown> } };
      select: (...args: unknown[]) => unknown;
      insert: (...args: unknown[]) => unknown;
      update: (...args: unknown[]) => { set: (...args: unknown[]) => { where: (...args: unknown[]) => Promise<unknown> } };
    };
    const originalFindFirst = mutableDb.query.orders.findFirst;
    const originalSelect = mutableDb.select;
    const originalInsert = mutableDb.insert;
    const originalUpdate = mutableDb.update;

    mutableDb.query.orders.findFirst = async () => ({
      id: 'ord-nom-new-1',
      tenantId: 'tenant-nom-new',
      orderNumber: 'ORD-NOM-NEW-1',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      eta: new Date('2026-03-06T00:00:00.000Z'),
      etd: new Date('2026-03-06T06:00:00.000Z'),
      currency: 'USD',
      supplierPaymentTermType: 'CREDIT',
      supplierCreditDays: 10,
      supplier: {
        name: 'Supplier Co',
        country: 'Norway',
        headOfficeAddress: 'Supplier Street 1',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      supplierContact: {
        name: 'Supplier Contact',
        role: 'Sales',
        phone: '+4712345678',
        email: 'supplier@example.com',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      vessel: { name: 'Aurora', imo: '1234567', updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      place: { name: 'Rotterdam', timezone: 'UTC+1', updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      salesRep: {
        name: 'John Trader',
        email: 'john@example.com',
        phone: '+4526131217',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      client: { updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      customerContact: { updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      invoicingCompany: {
        name: 'Fueld Trading Ltd',
        supplierTerms: 'Supplier terms',
        headOfficeAddress: 'Main Street 1',
        headOfficePhone: '+4799998888',
        headOfficeEmail: 'ops@fueld.com',
        vatNumber: 'VAT-123',
        website: 'https://fueld.com',
        logoUrl: null,
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      items: [{
        productType: 'MGO',
        description: 'DMA',
        quantity: '25',
        quantityMin: null,
        quantityMax: null,
        unit: 'MT',
        salesPrice: '700',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      }],
      invoices: [],
    });

    const selectResponses: unknown[][] = [[], [], [{ revisionNumber: 0 }]];
    mutableDb.select = () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => selectResponses.shift() ?? [],
          }),
          limit: async () => selectResponses.shift() ?? [],
        }),
      }),
    });

    mutableDb.insert = () => ({
      values: (payload: Record<string, unknown>) => ({
        returning: async () => [{ id: 'rev-nom-new-1', ...payload }],
      }),
    });

    mutableDb.update = () => ({
      set: () => ({ where: async () => undefined }),
    });

    try {
      const result = await generateNominationPdfBuffer('ord-nom-new-1');
      expect(result.revision.id).toBe('rev-nom-new-1');
      expect(result.revision.isNew).toBe(true);
      expect(result.fileName).toContain('Nomination_ORD-NOM-NEW-1.pdf');
      expect(Buffer.isBuffer(result.buffer)).toBe(true);

      const revisionAbsolutePath = join(process.cwd(), 'uploads', result.revision.filePath);
      rmSync(revisionAbsolutePath, { force: true });
    } finally {
      mutableDb.query.orders.findFirst = originalFindFirst;
      mutableDb.select = originalSelect;
      mutableDb.insert = originalInsert;
      mutableDb.update = originalUpdate;
    }
  });

  it('covers generateProformaInvoicePdfBuffer new-revision finalization and token-QR catch', async () => {
    const mutableDb = db as unknown as {
      query: { orders: { findFirst: (...args: unknown[]) => Promise<unknown> } };
      select: (...args: unknown[]) => unknown;
      insert: (...args: unknown[]) => unknown;
      update: (...args: unknown[]) => { set: (...args: unknown[]) => { where: (...args: unknown[]) => Promise<unknown> } };
    };
    const originalFindFirst = mutableDb.query.orders.findFirst;
    const originalSelect = mutableDb.select;
    const originalInsert = mutableDb.insert;
    const originalUpdate = mutableDb.update;
    const originalQr = QRCode.toDataURL;

    mutableDb.query.orders.findFirst = async () => ({
      id: 'ord-pro-new-1',
      tenantId: 'tenant-pro-new',
      orderNumber: 'ORD-PRO-NEW-1',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      eta: new Date('2026-03-06T00:00:00.000Z'),
      etd: new Date('2026-03-06T06:00:00.000Z'),
      currency: 'USD',
      bankAccountId: null,
      invoicingCompanyId: null,
      customerPaymentTermType: 'CREDIT',
      customerCreditDays: 20,
      customerNote: 'Proforma note',
      termsAndConditions: 'Net payment terms',
      client: {
        name: 'Acme Marine',
        country: 'Denmark',
        headOfficeAddress: 'Harbor 1',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      vessel: { name: 'Aurora', imo: '1234567', updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      place: {
        name: 'Rotterdam',
        timezone: 'UTC+1',
        orderRemark: 'Pilot required',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      salesRep: {
        name: 'John Trader',
        email: 'john@example.com',
        phone: '+4526131217',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      supplier: null,
      customerContact: {
        name: 'Jane Doe',
        role: 'Buyer',
        phone: '+4526131217',
        email: 'jane@example.com',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      supplierContact: { updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      invoicingCompany: {
        name: 'Fueld Trading Ltd',
        headOfficeAddress: 'Main Street 1',
        headOfficePhone: '+4799998888',
        headOfficeEmail: 'ops@fueld.com',
        vatNumber: 'VAT-123',
        website: 'https://fueld.com',
        fraudPreventionText: 'Verify account details by phone',
        latePaymentInterest: '2%',
        logoUrl: null,
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      items: [{
        productType: 'VLSFO',
        description: 'ISO 8217',
        quantity: '100',
        unit: 'MT',
        salesPrice: '500',
        customerNote: null,
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      }],
      invoices: [],
    });

    const selectResponses: unknown[][] = [[], [], [{ revisionNumber: 0 }]];
    mutableDb.select = () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => selectResponses.shift() ?? [],
          }),
          limit: async () => selectResponses.shift() ?? [],
        }),
      }),
    });

    mutableDb.insert = () => ({
      values: (payload: Record<string, unknown>) => ({
        returning: async () => [{ id: 'rev-pro-new-1', ...payload }],
      }),
    });

    mutableDb.update = () => ({
      set: () => ({ where: async () => undefined }),
    });

    let qrCalls = 0;
    QRCode.toDataURL = (async () => {
      qrCalls += 1;
      if (qrCalls === 1) return tinyPngDataUrl;
      throw new Error('token qr failed');
    }) as typeof QRCode.toDataURL;

    try {
      const result = await generateProformaInvoicePdfBuffer('ord-pro-new-1');
      expect(result.revision.id).toBe('rev-pro-new-1');
      expect(result.revision.isNew).toBe(true);
      expect(result.fileName).toContain('Proforma_Invoice_ORD-PRO-NEW-1.pdf');
      expect(Buffer.isBuffer(result.buffer)).toBe(true);
      expect(qrCalls).toBe(2);

      const revisionAbsolutePath = join(process.cwd(), 'uploads', result.revision.filePath);
      rmSync(revisionAbsolutePath, { force: true });
    } finally {
      mutableDb.query.orders.findFirst = originalFindFirst;
      mutableDb.select = originalSelect;
      mutableDb.insert = originalInsert;
      mutableDb.update = originalUpdate;
      QRCode.toDataURL = originalQr;
    }
  });

  it('covers invoice footer optional address/contact/reg fields', () => {
    const doc = __documentTestUtils.buildInvoiceDocument({
      invoiceNumber: 'INV-FOOT-1',
      orderNumber: 'ORD-FOOT-1',
      dueDate: '2026-03-20',
      clientName: 'Acme Marine',
      clientCountry: 'Denmark',
      vesselName: 'Aurora',
      vesselImo: '1234567',
      portName: 'Rotterdam',
      salesRepName: 'John Trader',
      paymentTerms: 'Credit 30 days',
      customerNote: null,
      itemNotes: [],
      items: [{ productType: 'MGO', quantity: '10', unit: 'MT', salesPrice: '700', costPrice: null }],
      totalAmount: '7000',
      bank: {
        bankName: 'DNB',
        accountName: null,
        accountNumber: null,
        iban: null,
        swift: null,
        currency: 'USD',
        branchAddress: null,
        sortCode: null,
        routingNumber: null,
        intermediaryBank: null,
      },
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      companyName: 'Fueld Trading Ltd',
      vatNumber: 'VAT-123',
      companyRegistrationNumber: 'NO123456',
      fraudPreventionText: null,
      latePaymentInterest: null,
      verifyUrl: null,
      verifyLink: null,
      companyLogoDataUrl: null,
      companyAddress: 'Line 1, Oslo\nLine 2',
      companyPhone: '+4526131217',
      companyEmail: 'ops@fueld.com',
      printMeta: {
        issuedAt: new Date('2026-03-01T00:00:00.000Z'),
        revisionNumber: 1,
        verificationRef: 'INV-20260301-R001',
        fingerprintShort: 'ABCDEF123456',
      },
    });

    expect(typeof doc.footer).toBe('function');
    const footer = (doc.footer as (currentPage: number, pageCount: number) => unknown)(1, 1);
    const footerText = collectTextValues(footer).join(' | ');
    expect(footerText).toContain('Line 1');
    expect(footerText).toContain('Line 2');
    expect(footerText).toContain('Phone No : +45 26 13 12 17');
    expect(footerText).toContain('Email : ops@fueld.com');
    expect(footerText).toContain('Reg. No : NO123456');
  });

  it('covers generateInvoicePdfBuffer item-note mapping branch', async () => {
    const mutableDb = db as unknown as {
      query: { invoices: { findFirst: (...args: unknown[]) => Promise<unknown> } };
    };
    const originalFindFirst = mutableDb.query.invoices.findFirst;

    mutableDb.query.invoices.findFirst = async () => ({
      id: 'inv-itemnote-1',
      invoiceNumber: 'INV-ITEMNOTE-1',
      dueDate: '2026-03-20',
      amount: '50000',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      order: {
        id: 'ord-itemnote-1',
        orderNumber: 'ORD-ITEMNOTE-1',
        bankAccountId: null,
        invoicingCompanyId: null,
        client: { name: 'Acme Marine', country: 'Denmark' },
        vessel: { name: 'Aurora', imo: '1234567' },
        place: { name: 'Rotterdam' },
        salesRep: { name: 'John Trader' },
        customerPaymentTermType: 'CREDIT',
        customerCreditDays: 30,
        customerNote: null,
        items: [{
          productType: 'VLSFO',
          customerNote: 'Keep warm',
          deliveredQuantity: '100',
          quantity: '100',
          unit: 'MT',
          salesPrice: '500',
          costPrice: '450',
        }],
        invoicingCompany: {
          name: 'Fueld Trading Ltd',
          vatNumber: 'VAT-123',
          fraudPreventionText: null,
          latePaymentInterest: null,
          logoUrl: null,
          headOfficeAddress: null,
          headOfficePhone: null,
          headOfficeEmail: null,
        },
      },
    });

    try {
      const buffer = await generateInvoicePdfBuffer('inv-itemnote-1');
      expect(buffer.length).toBeGreaterThan(100);
    } finally {
      mutableDb.query.invoices.findFirst = originalFindFirst;
    }
  });

  it('covers generateOrderInvoicePdfBuffer logo-read and item-note mapping branches', async () => {
    const mutableDb = db as unknown as {
      query: { orders: { findFirst: (...args: unknown[]) => Promise<unknown> } };
      select: (...args: unknown[]) => unknown;
    };
    const originalFindFirst = mutableDb.query.orders.findFirst;
    const originalSelect = mutableDb.select;

    const logoRelativePath = `logos/${Date.now()}-order-invoice-logo.png`;
    const logoAbsolutePath = join(process.cwd(), 'uploads', logoRelativePath);
    mkdirSync(join(process.cwd(), 'uploads', 'logos'), { recursive: true });
    writeFileSync(logoAbsolutePath, Buffer.from(tinyPngBase64, 'base64'));

    const persistedRevision = {
      id: 'rev-order-invoice-itemnote-1',
      tenantId: 'tenant-order-itemnote',
      revisionNumber: 1,
      verificationRef: 'INV-20260304-R001',
      verifyToken: 'order-itemnote-token',
      sha256Hex: '9'.repeat(64),
      fingerprintShort: 'ORDERITEMNOTE',
      issuedAt: new Date('2026-03-01T00:00:00.000Z'),
      filePath: `documents/order-invoice/${Date.now()}-order-invoice.pdf`,
    };
    const persistedBuffer = Buffer.from('order-invoice-itemnote-buffer');
    const persistedAbsolutePath = join(process.cwd(), 'uploads', persistedRevision.filePath);
    mkdirSync(join(process.cwd(), 'uploads', 'documents', 'order-invoice'), { recursive: true });
    writeFileSync(persistedAbsolutePath, persistedBuffer);

    mutableDb.query.orders.findFirst = async () => ({
      id: 'ord-order-itemnote-1',
      tenantId: 'tenant-order-itemnote',
      orderNumber: 'ORD-ORDER-ITEMNOTE-1',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      deliveredAt: null,
      eta: new Date('2026-03-05T00:00:00.000Z'),
      customerPaymentTermType: 'CREDIT',
      customerCreditDays: 10,
      bankAccountId: null,
      invoicingCompanyId: null,
      customerNote: null,
      client: { name: 'Acme Marine', country: 'Denmark', updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      vessel: { name: 'Aurora', imo: '1234567', updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      place: { name: 'Rotterdam', updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      salesRep: { name: 'John Trader', updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      supplier: null,
      invoicingCompany: {
        name: 'Fueld Trading Ltd',
        vatNumber: 'VAT-123',
        fraudPreventionText: null,
        latePaymentInterest: null,
        logoUrl: logoRelativePath,
        headOfficeAddress: null,
        headOfficePhone: null,
        headOfficeEmail: null,
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      customerContact: { updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      supplierContact: { updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      items: [{
        productType: 'VLSFO',
        customerNote: 'Keep warm',
        deliveredQuantity: null,
        quantity: '100',
        unit: 'MT',
        salesPrice: '500',
        costPrice: '450',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      }],
      invoices: [],
    });

    const selectResponses: unknown[][] = [[], [persistedRevision]];
    mutableDb.select = () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => selectResponses.shift() ?? [] }),
          limit: async () => selectResponses.shift() ?? [],
        }),
      }),
    });

    try {
      const result = await generateOrderInvoicePdfBuffer('ord-order-itemnote-1');
      expect(result.revision.id).toBe('rev-order-invoice-itemnote-1');
      expect(result.buffer.equals(persistedBuffer)).toBe(true);
    } finally {
      mutableDb.query.orders.findFirst = originalFindFirst;
      mutableDb.select = originalSelect;
      rmSync(logoAbsolutePath, { force: true });
      rmSync(persistedAbsolutePath, { force: true });
    }
  });

  it('covers cached early-return branch for offer generation', async () => {
    const mutableDb = db as unknown as {
      query: { orders: { findFirst: (...args: unknown[]) => Promise<unknown> } };
      select: (...args: unknown[]) => unknown;
    };
    const originalFindFirst = mutableDb.query.orders.findFirst;
    const originalSelect = mutableDb.select;

    const cachedRevision = {
      id: 'rev-offer-cache-1',
      tenantId: 'tenant-offer-cache',
      revisionNumber: 9,
      verificationRef: 'OFF-20260304-R009',
      verifyToken: 'offer-cache-token',
      sha256Hex: 'a'.repeat(64),
      fingerprintShort: 'OFFERCACHE12',
      issuedAt: new Date('2026-03-10T00:00:00.000Z'),
      filePath: `documents/offer-cache/${Date.now()}-offer-cache.pdf`,
    };
    const cachedBuffer = Buffer.from('offer-cache-buffer');
    const cachedAbsolutePath = join(process.cwd(), 'uploads', cachedRevision.filePath);
    mkdirSync(join(process.cwd(), 'uploads', 'documents', 'offer-cache'), { recursive: true });
    writeFileSync(cachedAbsolutePath, cachedBuffer);

    mutableDb.query.orders.findFirst = async () => ({
      id: 'ord-offer-cache-1',
      tenantId: 'tenant-offer-cache',
      status: 'INQUIRY',
      orderNumber: 'ORD-OFFER-CACHE-1',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      eta: new Date('2026-03-01T00:00:00.000Z'),
      etd: null,
      currency: 'USD',
      customerPaymentTermType: 'CREDIT',
      customerCreditDays: 10,
      customerNote: null,
      termsAndConditions: null,
      client: { name: 'Acme', country: 'DK', headOfficeAddress: null, updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      vessel: { name: 'Aurora', imo: null, updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      place: { name: 'Rotterdam', timezone: null, orderRemark: null, updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      salesRep: { name: null, email: null, phone: null, updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      supplier: null,
      customerContact: { updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      supplierContact: { updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      invoicingCompany: { updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      items: [{ updatedAt: new Date('2026-03-01T00:00:00.000Z') }],
      invoices: [],
    });

    mutableDb.select = () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => [cachedRevision] }),
          limit: async () => [cachedRevision],
        }),
      }),
    });

    try {
      const result = await generateOfferPdfBuffer('ord-offer-cache-1');
      expect(result.revision.id).toBe('rev-offer-cache-1');
      expect(result.buffer.equals(cachedBuffer)).toBe(true);
    } finally {
      mutableDb.query.orders.findFirst = originalFindFirst;
      mutableDb.select = originalSelect;
      rmSync(cachedAbsolutePath, { force: true });
    }
  });

  it('covers cached early-return branch for nomination generation', async () => {
    const mutableDb = db as unknown as {
      query: { orders: { findFirst: (...args: unknown[]) => Promise<unknown> } };
      select: (...args: unknown[]) => unknown;
    };
    const originalFindFirst = mutableDb.query.orders.findFirst;
    const originalSelect = mutableDb.select;

    const cachedRevision = {
      id: 'rev-nom-cache-1',
      tenantId: 'tenant-nom-cache',
      revisionNumber: 3,
      verificationRef: 'DOC-20260304-R003',
      verifyToken: 'nom-cache-token',
      sha256Hex: 'b'.repeat(64),
      fingerprintShort: 'NOMCACHE1234',
      issuedAt: new Date('2026-03-10T00:00:00.000Z'),
      filePath: `documents/nom-cache/${Date.now()}-nom-cache.pdf`,
    };
    const cachedBuffer = Buffer.from('nom-cache-buffer');
    const cachedAbsolutePath = join(process.cwd(), 'uploads', cachedRevision.filePath);
    mkdirSync(join(process.cwd(), 'uploads', 'documents', 'nom-cache'), { recursive: true });
    writeFileSync(cachedAbsolutePath, cachedBuffer);

    mutableDb.query.orders.findFirst = async () => ({
      id: 'ord-nom-cache-1',
      tenantId: 'tenant-nom-cache',
      orderNumber: 'ORD-NOM-CACHE-1',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      eta: new Date('2026-03-01T00:00:00.000Z'),
      etd: null,
      currency: 'USD',
      supplierPaymentTermType: 'CREDIT',
      supplierCreditDays: 10,
      supplier: { updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      supplierContact: { updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      vessel: { updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      place: { updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      salesRep: { updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      client: { updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      customerContact: { updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      invoicingCompany: { updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      items: [{ updatedAt: new Date('2026-03-01T00:00:00.000Z') }],
      invoices: [],
    });

    mutableDb.select = () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => [cachedRevision] }),
          limit: async () => [cachedRevision],
        }),
      }),
    });

    try {
      const result = await generateNominationPdfBuffer('ord-nom-cache-1');
      expect(result.revision.id).toBe('rev-nom-cache-1');
      expect(result.buffer.equals(cachedBuffer)).toBe(true);
    } finally {
      mutableDb.query.orders.findFirst = originalFindFirst;
      mutableDb.select = originalSelect;
      rmSync(cachedAbsolutePath, { force: true });
    }
  });

  it('covers cached early-return branch for proforma generation', async () => {
    const mutableDb = db as unknown as {
      query: { orders: { findFirst: (...args: unknown[]) => Promise<unknown> } };
      select: (...args: unknown[]) => unknown;
    };
    const originalFindFirst = mutableDb.query.orders.findFirst;
    const originalSelect = mutableDb.select;

    const cachedRevision = {
      id: 'rev-pro-cache-1',
      tenantId: 'tenant-pro-cache',
      revisionNumber: 4,
      verificationRef: 'PFI-20260304-R004',
      verifyToken: 'pro-cache-token',
      sha256Hex: 'c'.repeat(64),
      fingerprintShort: 'PROCACHE12345',
      issuedAt: new Date('2026-03-10T00:00:00.000Z'),
      filePath: `documents/pro-cache/${Date.now()}-pro-cache.pdf`,
    };
    const cachedBuffer = Buffer.from('pro-cache-buffer');
    const cachedAbsolutePath = join(process.cwd(), 'uploads', cachedRevision.filePath);
    mkdirSync(join(process.cwd(), 'uploads', 'documents', 'pro-cache'), { recursive: true });
    writeFileSync(cachedAbsolutePath, cachedBuffer);

    mutableDb.query.orders.findFirst = async () => ({
      id: 'ord-pro-cache-1',
      tenantId: 'tenant-pro-cache',
      orderNumber: 'ORD-PRO-CACHE-1',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      eta: new Date('2026-03-01T00:00:00.000Z'),
      etd: null,
      currency: 'USD',
      bankAccountId: null,
      invoicingCompanyId: null,
      customerPaymentTermType: 'CREDIT',
      customerCreditDays: 20,
      customerNote: 'Pro note',
      termsAndConditions: 'Terms',
      client: { name: 'Acme', country: 'DK', headOfficeAddress: null, updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      vessel: { name: 'Aurora', imo: null, updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      place: { name: 'Rotterdam', timezone: null, orderRemark: null, updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      salesRep: { name: null, email: null, phone: null, updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      supplier: null,
      customerContact: { name: null, role: null, phone: null, email: null, updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      supplierContact: { updatedAt: new Date('2026-03-01T00:00:00.000Z') },
      invoicingCompany: {
        name: 'Fueld Trading Ltd',
        headOfficeAddress: null,
        headOfficePhone: null,
        headOfficeEmail: null,
        vatNumber: null,
        website: null,
        fraudPreventionText: null,
        latePaymentInterest: null,
        logoUrl: null,
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      },
      items: [{
        productType: 'VLSFO',
        description: null,
        quantity: '100',
        unit: 'MT',
        salesPrice: '500',
        customerNote: 'Keep warm',
        updatedAt: new Date('2026-03-01T00:00:00.000Z'),
      }],
      invoices: [],
    });

    const selectResponses: unknown[][] = [[cachedRevision]];
    mutableDb.select = () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => selectResponses.shift() ?? [] }),
          limit: async () => selectResponses.shift() ?? [],
        }),
      }),
    });

    try {
      const cached = await generateProformaInvoicePdfBuffer('ord-pro-cache-1');
      expect(cached.revision.id).toBe('rev-pro-cache-1');
      expect(cached.buffer.equals(cachedBuffer)).toBe(true);
    } finally {
      mutableDb.query.orders.findFirst = originalFindFirst;
      mutableDb.select = originalSelect;
      rmSync(cachedAbsolutePath, { force: true });
    }
  });

  it('covers proforma non-cached item-note mapping branch', async () => {
    const mutableDb = db as unknown as {
      query: { orders: { findFirst: (...args: unknown[]) => Promise<unknown> } };
      select: (...args: unknown[]) => unknown;
    };
    const originalFindFirst = mutableDb.query.orders.findFirst;
    const originalSelect = mutableDb.select;

    const persistedRevision = {
      id: 'rev-pro-itemnote-1',
      tenantId: 'tenant-pro-itemnote',
      revisionNumber: 1,
      verificationRef: 'PFI-20260304-R001',
      verifyToken: 'pro-itemnote-token',
      sha256Hex: 'd'.repeat(64),
      fingerprintShort: 'PROITEMNOTE1',
      issuedAt: new Date('2026-03-01T00:00:00.000Z'),
      filePath: `documents/pro-itemnote/${Date.now()}-pro-itemnote.pdf`,
    };
    const persistedBuffer = Buffer.from('pro-itemnote-buffer');
    const persistedAbsolutePath = join(process.cwd(), 'uploads', persistedRevision.filePath);
    mkdirSync(join(process.cwd(), 'uploads', 'documents', 'pro-itemnote'), { recursive: true });
    writeFileSync(persistedAbsolutePath, persistedBuffer);

    mutableDb.query.orders.findFirst = async () => ({
      id: 'ord-pro-itemnote-1',
      tenantId: 'tenant-pro-itemnote',
      orderNumber: 'ORD-PRO-ITEMNOTE-1',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      eta: new Date('2026-03-06T00:00:00.000Z'),
      etd: null,
      currency: 'USD',
      bankAccountId: null,
      invoicingCompanyId: null,
      customerPaymentTermType: 'CREDIT',
      customerCreditDays: 20,
      customerNote: 'General note',
      termsAndConditions: 'Terms',
      client: { name: 'Acme', country: 'DK', headOfficeAddress: null, updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      vessel: { name: 'Aurora', imo: null, updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      place: { name: 'Rotterdam', timezone: null, orderRemark: null, updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      salesRep: { name: null, email: null, phone: null, updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      supplier: null,
      customerContact: { name: null, role: null, phone: null, email: null, updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      supplierContact: { updatedAt: new Date('2026-03-04T00:00:00.000Z') },
      invoicingCompany: {
        name: 'Fueld Trading Ltd',
        headOfficeAddress: null,
        headOfficePhone: null,
        headOfficeEmail: null,
        vatNumber: null,
        website: null,
        fraudPreventionText: null,
        latePaymentInterest: null,
        logoUrl: null,
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      },
      items: [{
        productType: 'VLSFO',
        description: null,
        quantity: '100',
        unit: 'MT',
        salesPrice: '500',
        customerNote: 'Keep warm',
        updatedAt: new Date('2026-03-04T00:00:00.000Z'),
      }],
      invoices: [],
    });

    const selectResponses: unknown[][] = [[], [persistedRevision]];
    mutableDb.select = () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({ limit: async () => selectResponses.shift() ?? [] }),
          limit: async () => selectResponses.shift() ?? [],
        }),
      }),
    });

    try {
      const result = await generateProformaInvoicePdfBuffer('ord-pro-itemnote-1');
      expect(result.revision.id).toBe('rev-pro-itemnote-1');
      expect(result.buffer.equals(persistedBuffer)).toBe(true);
    } finally {
      mutableDb.query.orders.findFirst = originalFindFirst;
      mutableDb.select = originalSelect;
      rmSync(persistedAbsolutePath, { force: true });
    }
  });
});