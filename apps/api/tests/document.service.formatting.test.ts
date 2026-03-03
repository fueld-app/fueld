import { describe, expect, it } from 'bun:test';
import { __documentTestUtils } from '../src/modules/documents/document.service';

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
} as const;

describe('document.service formatting helpers', () => {
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
  });
});