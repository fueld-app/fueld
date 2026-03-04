import { describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const defaultTestDatabaseUrl = 'postgres://fueld:fueld@localhost:5432/fueld_test';
if (!process.env.TEST_DATABASE_URL && !process.env.DATABASE_URL) {
  process.env.TEST_DATABASE_URL = defaultTestDatabaseUrl;
}
if (!process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

const { __documentTestUtils } = await import('../src/modules/documents/document.service');

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

  it('parses timezone offsets and formats date-time output', () => {
    expect(__documentTestUtils.parseTimezoneOffset('UTC')).toBe(0);
    expect(__documentTestUtils.parseTimezoneOffset('UTC+2')).toBe(120);
    expect(__documentTestUtils.parseTimezoneOffset('GMT-05:30')).toBe(-330);
    expect(__documentTestUtils.parseTimezoneOffset('Europe/Copenhagen')).toBeNull();

    expect(__documentTestUtils.formatDateTimeForDisplay('2026-03-01T10:00:00.000Z', 'UTC+2')).toBe('01-03-2026 12:00 UTC+2');
    expect(__documentTestUtils.formatDateTimeForDisplay('2026-03-01T10:00:00.000Z', null)).toBe('01-03-2026 10:00');
    expect(__documentTestUtils.formatDateTimeForDisplay(null, 'UTC+2')).toBeNull();
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
      items: [{ productType: 'MGO', description: null, quantity: '5', unit: 'MT', salesPrice: '700' }],
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
});