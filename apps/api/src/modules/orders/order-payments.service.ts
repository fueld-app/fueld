// ═══════════════════════════════════════════════════════════════════════
//  Order Payments Service — customer payment ledger for orders
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../../db';
import { customerPayments, orders, invoices } from '../../db/schema';

function mapPaymentRow(row: typeof customerPayments.$inferSelect) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    orderId: row.orderId,
    invoiceId: row.invoiceId,
    amount: String(row.amount),
    currency: row.currency,
    receivedAt: row.receivedAt.toISOString(),
    method: row.method ?? null,
    note: row.note ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listOrderPayments(orderId: string) {
  const rows = await db
    .select()
    .from(customerPayments)
    .where(eq(customerPayments.orderId, orderId))
    .orderBy(desc(customerPayments.receivedAt));

  return rows.map(mapPaymentRow);
}

async function updateInvoiceAmountPaid(orderId: string): Promise<void> {
  const [{ total }] = await db
    .select({
      total: sql<number>`COALESCE(SUM(${customerPayments.amount}), 0)::float`,
    })
    .from(customerPayments)
    .where(eq(customerPayments.orderId, orderId));

  await db
    .update(invoices)
    .set({ amountPaid: total.toFixed(2), updatedAt: new Date() })
    .where(eq(invoices.orderId, orderId));
}

export async function createOrderPayment(
  orderId: string,
  input: {
    amount: string;
    currency: string;
    receivedAt?: string | null;
    method?: string | null;
    note?: string | null;
    createdBy?: string | null;
  },
) {
  const [orderRow] = await db
    .select({ tenantId: orders.tenantId, clientId: orders.clientId })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!orderRow) return null;

  const [invoice] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(eq(invoices.orderId, orderId))
    .orderBy(desc(invoices.createdAt))
    .limit(1);

  const [created] = await db
    .insert(customerPayments)
    .values({
      tenantId: orderRow.tenantId,
      customerId: orderRow.clientId,
      orderId,
      invoiceId: invoice?.id ?? null,
      amount: input.amount,
      currency: input.currency || 'USD',
      receivedAt: input.receivedAt ? new Date(input.receivedAt) : new Date(),
      method: input.method ?? null,
      note: input.note ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning();

  if (invoice?.id) {
    await updateInvoiceAmountPaid(orderId);
  }

  return created ? mapPaymentRow(created) : null;
}
