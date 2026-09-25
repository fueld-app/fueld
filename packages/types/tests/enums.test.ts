import { describe, expect, test } from 'bun:test';
import {
  CounterpartyType,
  isCommissionableLine,
  InvoiceStatus,
  OrderAttachmentType,
  OrderStatus,
  PaymentTerms,
  PaymentTermType,
  ProductType,
  Role,
} from '../src/enums';

type StringEnum = Record<string, string>;

function verifyStringEnum(enumObject: StringEnum, expectedEntries: Record<string, string>) {
  expect(Object.keys(enumObject).sort()).toEqual(Object.keys(expectedEntries).sort());
  expect(Object.values(enumObject).sort()).toEqual(Object.values(expectedEntries).sort());

  for (const [key, value] of Object.entries(expectedEntries)) {
    expect(enumObject[key]).toBe(value);
  }

  const hasNumericLikeKeys = Object.keys(enumObject).some((key) => /^\d+$/.test(key));
  expect(hasNumericLikeKeys).toBe(false);

  expect(new Set(Object.values(enumObject)).size).toBe(Object.values(enumObject).length);
}

describe('enums', () => {
  test('OrderStatus has full lifecycle values', () => {
    verifyStringEnum(OrderStatus, {
      Inquiry: 'INQUIRY',
      Offer: 'OFFER',
      Confirmed: 'CONFIRMED',
      Delivered: 'DELIVERED',
      Invoiced: 'INVOICED',
      Paid: 'PAID',
      Cancelled: 'CANCELLED',
      Lost: 'LOST',
    });
  });

  test('ProductType has expected product constants', () => {
    verifyStringEnum(ProductType, {
      VLSFO: 'VLSFO',
      ULSFO: 'ULSFO',
      LSMGO: 'LSMGO',
      MGO: 'MGO',
      LUBE: 'LUBE',
      IFO380CST: 'IFO380CST',
      IFO180CST: 'IFO180CST',
      IFO120CST: 'IFO120CST',
      IFO30CST: 'IFO30CST',
      IFO: 'IFO',
      MDO: 'MDO',
      LSIFO: 'LSIFO',
      ITEM: 'ITEM',
      COMMISSION: 'COMMISSION',
      HIRE: 'HIRE',
      PAYMENT: 'PAYMENT',
      CREDIT_NOTE: 'CREDIT_NOTE',
      CUTTERSTOCK: 'CUTTERSTOCK',
      PYGAS: 'PYGAS',
      BARGING_FEE: 'BARGING_FEE',
    });
  });

  test('PaymentTerms has expected values', () => {
    verifyStringEnum(PaymentTerms, {
      CashAdvance: 'CASH_ADVANCE',
      OnReceipt: 'ON_RECEIPT',
      Credit30: 'CREDIT_30',
    });
  });

  test('PaymentTermType has expected values', () => {
    verifyStringEnum(PaymentTermType, {
      Credit: 'CREDIT',
      CashOnDelivery: 'COD',
      Prepayment: 'PREPAY',
    });
  });

  test('OrderAttachmentType has expected values', () => {
    verifyStringEnum(OrderAttachmentType, {
      Bdr: 'BDR',
      Other: 'OTHER',
    });
  });

  test('CounterpartyType has expected values', () => {
    verifyStringEnum(CounterpartyType, {
      Supplier: 'SUPPLIER',
      Client: 'CLIENT',
      Barge: 'BARGE',
      Broker: 'BROKER',
      Agent: 'AGENT',
    });
  });

  test('InvoiceStatus has expected values', () => {
    verifyStringEnum(InvoiceStatus, {
      Draft: 'DRAFT',
      Sent: 'SENT',
      Overdue: 'OVERDUE',
      PartiallyPaid: 'PARTIALLY_PAID',
      Paid: 'PAID',
      Void: 'VOID',
    });
  });

  test('Role has expected user role values', () => {
    verifyStringEnum(Role, {
      Admin: 'ADMIN',
      Trader: 'TRADER',
      Finance: 'FINANCE',
      Teamlead: 'TEAMLEAD',
      CreditManager: 'CREDITMANAGER',
      OperationsManager: 'OPERATIONSMANAGER',
      Light: 'LIGHT',
    });
  });
});

describe('isCommissionableLine', () => {
  test('excludes every fee/service line type', () => {
    // A broker earns $/MT on the product, not on the charges around it. Each of
    // these is stored as its own line with the charge as a lump sum, so a
    // per-MT rate would bill a flat fee as though it were product tonnage.
    for (const type of ['BARGING_FEE', 'COMMISSION', 'HIRE', 'PAYMENT', 'CREDIT_NOTE', 'ITEM']) {
      expect(isCommissionableLine(type)).toBe(false);
    }
  });

  test('keeps fuel products commissionable, including custom blends', () => {
    // Deny-list semantics: a product type added later (Moxie trades B30/B100)
    // must not silently drop out of the commission report.
    for (const type of ['VLSFO', 'LSMGO', 'LFO', 'MGO', 'LUBE', 'B30', 'B100', 'PYGAS']) {
      expect(isCommissionableLine(type)).toBe(true);
    }
  });

  test('is case- and whitespace-insensitive', () => {
    expect(isCommissionableLine(' barging_fee ')).toBe(false);
    expect(isCommissionableLine('Vlsfo')).toBe(true);
  });

  test('treats an absent type as commissionable rather than zeroing the total', () => {
    // productType is NOT NULL in the schema, so an absent value means a caller
    // failed to map the column. Failing open keeps their whole commission total
    // from silently becoming 0.
    expect(isCommissionableLine(null)).toBe(true);
    expect(isCommissionableLine(undefined)).toBe(true);
    expect(isCommissionableLine('')).toBe(true);
  });
});
