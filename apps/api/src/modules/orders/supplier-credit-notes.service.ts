/**
 * Supplier credit notes (Phase 2 of credit-note support, panel-reviewed).
 *
 * Domain: money BACK from a supplier on an order supplier leg. Amounts are
 * stored POSITIVE (direction implicit in the record type). Status lifecycle:
 *   EXPECTED  → promised/expected, never counts toward margin
 *   RECEIVED  → confirmed received; counts toward net-after-credits;
 *               amount is immutable from here (cancel + reissue instead)
 *   CANCELLED → issued in error; void, never deleted (audit)
 *
 * Currency: stored in the credit's own currency. When it differs from the
 * order currency the UI captures a manual FX snapshot (fxRate +
 * amountInOrderCurrency). Margin math uses the snapshot when present,
 * otherwise falls back to the tenant FX table (same as deal commissions).
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import {
  counterparties,
  orderItems,
  orderSuppliers,
  orders,
  supplierCreditNotes,
  type TenantSettings,
} from '../../db/schema';
import type {
  CreateSupplierCreditNoteDto,
  SupplierCreditNoteDto,
  UpdateSupplierCreditNoteDto,
} from '@fueld/types';
import { getFxRate } from '../prices/price.service';

const STATUSES = ['EXPECTED', 'RECEIVED', 'CANCELLED'] as const;
const REASONS = ['PRICE_CORRECTION', 'QUANTITY_SHORTAGE', 'QUALITY_CLAIM', 'REBATE', 'OTHER'] as const;

type CreditRow = typeof supplierCreditNotes.$inferSelect;

function toDto(row: CreditRow, supplierName?: string | null): SupplierCreditNoteDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    orderSupplierId: row.orderSupplierId,
    orderId: row.orderId,
    supplierId: row.supplierId,
    supplierName: supplierName ?? null,
    orderLineId: row.orderLineId ?? null,
    supplierReference: row.supplierReference ?? null,
    amount: row.amount,
    currency: row.currency,
    fxRate: row.fxRate ?? null,
    amountInOrderCurrency: row.amountInOrderCurrency ?? null,
    creditDate: row.creditDate.toISOString(),
    receivedAt: row.receivedAt?.toISOString() ?? null,
    status: row.status,
    reason: row.reason,
    note: row.note ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Effective value in order currency: manual snapshot wins, else FX table. */
export function creditValueInOrderCurrency(
  row: Pick<CreditRow, 'amount' | 'currency' | 'amountInOrderCurrency'>,
  orderCurrency: string,
): number {
  if (row.amountInOrderCurrency != null) return Number(row.amountInOrderCurrency);
  if (row.currency.toUpperCase() === orderCurrency.toUpperCase()) return Number(row.amount);
  return Number(row.amount) * getFxRate(row.currency.toUpperCase());
}

export class SupplierCreditNoteError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function listSupplierCreditNotes(orderId: string): Promise<SupplierCreditNoteDto[]> {
  const rows = await db
    .select({ cn: supplierCreditNotes, supplierName: counterparties.name })
    .from(supplierCreditNotes)
    .leftJoin(counterparties, eq(supplierCreditNotes.supplierId, counterparties.id))
    .where(eq(supplierCreditNotes.orderId, orderId));
  return rows.map((r) => toDto(r.cn, r.supplierName));
}

export async function createSupplierCreditNote(
  orderId: string,
  tenantId: string,
  orderCurrency: string,
  userId: string,
  input: CreateSupplierCreditNoteDto,
): Promise<SupplierCreditNoteDto> {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new SupplierCreditNoteError('Credit amount must be a positive number');
  }
  if (input.status && !STATUSES.includes(input.status as (typeof STATUSES)[number])) {
    throw new SupplierCreditNoteError('Invalid status');
  }

  // Leg must belong to this order; derive supplier from it.
  const leg = await db
    .select({ id: orderSuppliers.id, companyId: orderSuppliers.companyId })
    .from(orderSuppliers)
    .where(and(eq(orderSuppliers.id, input.orderSupplierId), eq(orderSuppliers.orderId, orderId)))
    .limit(1);
  if (!leg[0]) {
    throw new SupplierCreditNoteError('Supplier leg not found on this order', 404);
  }

  // Optional line allocation must also belong to this order.
  if (input.orderLineId) {
    const line = await db
      .select({ id: orderItems.id })
      .from(orderItems)
      .where(and(eq(orderItems.id, input.orderLineId), eq(orderItems.orderId, orderId)))
      .limit(1);
    if (!line[0]) {
      throw new SupplierCreditNoteError('Order line not found on this order', 404);
    }
  }

  const currency = (input.currency ?? orderCurrency).toUpperCase();
  const status = input.status ?? 'EXPECTED';
  const [row] = await db
    .insert(supplierCreditNotes)
    .values({
      tenantId,
      orderSupplierId: input.orderSupplierId,
      orderId,
      supplierId: leg[0].companyId,
      orderLineId: input.orderLineId ?? null,
      supplierReference: input.supplierReference?.trim() || null,
      amount: amount.toFixed(2),
      currency,
      fxRate: input.fxRate ?? null,
      amountInOrderCurrency: input.amountInOrderCurrency ?? null,
      creditDate: input.creditDate ? new Date(input.creditDate) : new Date(),
      status,
      receivedAt: status === 'RECEIVED' ? new Date() : null,
      reason: input.reason ?? 'OTHER',
      note: input.note ?? null,
      createdBy: userId,
    })
    .returning();
  return toDto(row!);
}

export async function updateSupplierCreditNote(
  orderId: string,
  creditId: string,
  input: UpdateSupplierCreditNoteDto,
): Promise<SupplierCreditNoteDto> {
  const [row] = await db
    .select()
    .from(supplierCreditNotes)
    .where(and(eq(supplierCreditNotes.id, creditId), eq(supplierCreditNotes.orderId, orderId)))
    .limit(1);
  if (!row) throw new SupplierCreditNoteError('Credit note not found', 404);

  if (input.status && !STATUSES.includes(input.status)) {
    throw new SupplierCreditNoteError('Invalid status');
  }
  if (input.reason && !REASONS.includes(input.reason)) {
    throw new SupplierCreditNoteError('Invalid reason');
  }

  // Amount immutability once RECEIVED (panel: cancel + reissue, don't edit).
  const amountChanging =
    input.amount != null && Number(input.amount) !== Number(row.amount);
  if (row.status === 'RECEIVED' && (amountChanging || input.currency)) {
    throw new SupplierCreditNoteError(
      'Received credit notes are amount-immutable — cancel this credit and reissue instead',
    );
  }
  if (input.amount != null && (!Number.isFinite(Number(input.amount)) || Number(input.amount) <= 0)) {
    throw new SupplierCreditNoteError('Credit amount must be a positive number');
  }

  // CANCELLED is terminal — nothing may change on a cancelled credit.
  if (row.status === 'CANCELLED') {
    throw new SupplierCreditNoteError('Cancelled credit notes cannot be modified');
  }

  const patch: Partial<CreditRow> = { updatedAt: new Date() };
  if (input.supplierReference !== undefined) patch.supplierReference = input.supplierReference?.trim() || null;
  if (input.amount != null) patch.amount = Number(input.amount).toFixed(2);
  if (input.currency !== undefined) patch.currency = input.currency?.toUpperCase() ?? row.currency;
  if (input.fxRate !== undefined) patch.fxRate = input.fxRate ?? null;
  if (input.amountInOrderCurrency !== undefined) patch.amountInOrderCurrency = input.amountInOrderCurrency ?? null;
  if (input.creditDate) patch.creditDate = new Date(input.creditDate);
  if (input.reason) patch.reason = input.reason;
  if (input.note !== undefined) patch.note = input.note ?? null;
  if (input.status && input.status !== row.status) {
    patch.status = input.status;
    if (input.status === 'RECEIVED') patch.receivedAt = new Date();
    if (input.status === 'CANCELLED') patch.receivedAt = null;
    // RECEIVED → EXPECTED (un-receive): clear the received stamp
    if (row.status === 'RECEIVED' && input.status === 'EXPECTED') patch.receivedAt = null;
  }

  const [updated] = await db
    .update(supplierCreditNotes)
    .set(patch)
    .where(eq(supplierCreditNotes.id, creditId))
    .returning();
  return toDto(updated!);
}

/**
 * Sum received (and expected separately) supplier credit values in the order
 * currency. Only RECEIVED credits count toward net-after-credits (panel rule:
 * expected credits are informational, never inflate margin).
 */
export async function summarizeSupplierCredits(
  orderId: string,
  orderCurrency: string,
): Promise<{ received: number; expected: number }> {
  const rows = await db
    .select({
      status: supplierCreditNotes.status,
      amount: supplierCreditNotes.amount,
      currency: supplierCreditNotes.currency,
      amountInOrderCurrency: supplierCreditNotes.amountInOrderCurrency,
    })
    .from(supplierCreditNotes)
    .where(eq(supplierCreditNotes.orderId, orderId));

  let received = 0;
  let expected = 0;
  for (const row of rows) {
    const value = creditValueInOrderCurrency(row, orderCurrency);
    if (row.status === 'RECEIVED') received += value;
    else if (row.status === 'EXPECTED') expected += value;
  }
  return { received, expected };
}