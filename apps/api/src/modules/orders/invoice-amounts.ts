/**
 * Invoice arithmetic shared by issuance and the payment schedule.
 *
 * Kept in a leaf module so the schedule service and the invoice service can both
 * use it without importing each other.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import { orderItems } from '../../db/schema';
import { customerFacingItems } from '../documents/customer-facing-items';

type InvoiceAmountExecutor = typeof db;

/**
 * Due date for an invoice or tranche.
 *
 * CREDIT → delivery anchor + credit days (the trader's "delivery date + credit
 * days"); COD/PREPAY → payment is due on the anchor itself, not 30 days later.
 */
export function computeInvoiceDueDate(
  anchor: Date | string | null,
  paymentTermType: string | null,
  creditDays: number | null,
  issuedAt = new Date(),
): string {
  const parsedAnchor = anchor == null ? null : new Date(String(anchor));
  const anchorDay = parsedAnchor && !Number.isNaN(parsedAnchor.getTime())
    ? new Date(Date.UTC(parsedAnchor.getUTCFullYear(), parsedAnchor.getUTCMonth(), parsedAnchor.getUTCDate()))
    : null;
  const base = anchorDay ?? new Date(Date.UTC(issuedAt.getUTCFullYear(), issuedAt.getUTCMonth(), issuedAt.getUTCDate()));

  if (paymentTermType === 'COD' || paymentTermType === 'PREPAY') {
    return base.toISOString().split('T')[0]!;
  }

  const days = paymentTermType === 'CREDIT' ? (creditDays ?? 30) : 30;
  return new Date(base.getTime() + days * 86_400_000).toISOString().split('T')[0]!;
}

/**
 * Allocate a tranche's share of an order total.
 *
 * The LAST tranche absorbs rounding so the parts always sum exactly to the
 * total; three thirds of 100.00 would otherwise bill 99.99 or 100.02.
 */
export function splitAmountByPercent(total: number, percents: number[], index: number): string {
  const isLast = index === percents.length - 1;
  if (isLast) {
    const allocated = percents
      .slice(0, -1)
      .reduce((sum, percent) => sum + Math.round((total * percent) / 100 * 100) / 100, 0);
    return (Math.round(total * 100) / 100 - allocated).toFixed(2);
  }
  return (Math.round((total * percents[index]!) / 100 * 100) / 100).toFixed(2);
}

export async function computeInvoiceAmount(
  orderId: string,
  executor?: InvoiceAmountExecutor,
): Promise<string> {
  const dbc = executor ?? db;
  const items = await dbc
    .select({
      id: orderItems.id,
      productType: orderItems.productType,
      hideOnDocuments: orderItems.hideOnDocuments,
      salesPrice: orderItems.salesPrice,
      salesCurrency: orderItems.salesCurrency,
      deliveredQuantity: orderItems.deliveredQuantity,
      quantity: orderItems.quantity,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.sortOrder), asc(orderItems.createdAt));

  const billable = customerFacingItems(items);
  // `invoices` carries a single scalar amount with no currency column, so a
  // mixed-currency order cannot be expressed as one number. Refuse rather than
  // freeze a meaningless blended total that later gets compared against
  // single-currency payments.
  const currencies = new Set(
    billable.map((item) => (item.salesCurrency ?? '').toUpperCase()).filter(Boolean),
  );
  if (currencies.size > 1) {
    throw new MixedCurrencyInvoiceError([...currencies].sort());
  }

  // Sum the billable rows in the database as numeric: quantities are
  // numeric(14,6) and prices numeric(14,7), and routing those through float64
  // (or doing it in JS) can drift a cent on a large order. The same reasoning
  // already applies to recomputeInvoiceAmountPaid.
  const conditions = [eq(orderItems.orderId, orderId)];
  if (billable.length !== items.length) {
    // Some rows are excluded (hidden / credit-note placeholders), so the sum has
    // to run over exactly the billable ids rather than the whole order.
    conditions.push(inArray(orderItems.id, billable.map((item) => item.id)));
  }

  const [row] = await dbc
    .select({
      total: sql<string>`COALESCE(SUM(coalesce(${orderItems.deliveredQuantity}, ${orderItems.quantity})::numeric * coalesce(${orderItems.salesPrice}, 0)::numeric), 0)::numeric(14,2)::text`,
    })
    .from(orderItems)
    .where(and(...conditions));

  return row?.total ?? '0.00';
}

/** Callers must surface this to the user; it is a data problem, not an outage. */
export class MixedCurrencyInvoiceError extends Error {
  constructor(public readonly currencies: string[]) {
    super(`Cannot invoice an order with mixed line currencies (${currencies.join(', ')})`);
    this.name = 'MixedCurrencyInvoiceError';
  }
}
