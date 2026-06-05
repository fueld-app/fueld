import { describe, expect, test } from 'bun:test';
import {
  CounterpartyType,
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
    });
  });

  test('ProductType has expected product constants', () => {
    verifyStringEnum(ProductType, {
      VLSFO: 'VLSFO',
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
    });
  });
});
