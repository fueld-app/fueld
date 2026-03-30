// ═══════════════════════════════════════════════════════════════════════
//  Credit Service — CRUD for supplier & customer credit lines
//  Both sides (counterparties and own companies) are many-to-many.
//  Used amount is calculated from open orders automatically.
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, sql, inArray, asc, desc } from 'drizzle-orm';
import { db } from '../../db';
import {
  creditLines,
  counterparties,
  orders,
  orderSuppliers,
  orderItems,
  creditLineCompanies,
  creditLineCounterparties,
} from '../../db/schema';
import type { CreditLineDto, CreditLineType } from '@fueld/types';

// Active statuses that count towards "used" credit
const SUPPLIER_ACTIVE_STATUSES = ['CONFIRMED', 'DELIVERED', 'INVOICED'] as const;
const CUSTOMER_ACTIVE_STATUSES = ['INQUIRY', 'OFFER', 'CONFIRMED', 'DELIVERED', 'INVOICED'] as const;

// ═══════════════════════════════════════════════════════════════════════
//  CALCULATE USED AMOUNT (supports multiple counterparty IDs)
//
//  Supplier credit → sum of costPrice × quantity for order items where
//                     supplierId IN counterpartyIds AND status is active
//  Customer credit → sum of salesPrice × quantity for order items where
//                     order.clientId IN counterpartyIds AND status is active
// ═══════════════════════════════════════════════════════════════════════

async function calcUsedAmountForSupplier(counterpartyIds: string[]): Promise<string> {
  if (!counterpartyIds.length) return '0';
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${orderItems.costPrice}::numeric * ${orderItems.quantity}::numeric), 0)::text`,
    })
    .from(orderItems)
    .innerJoin(orderSuppliers, eq(orderItems.orderSupplierId, orderSuppliers.id))
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(
      and(
        inArray(orderSuppliers.companyId, counterpartyIds),
        eq(orderSuppliers.paymentTermType, 'CREDIT'),
        inArray(orders.status, [...SUPPLIER_ACTIVE_STATUSES]),
      ),
    );
  return row?.total ?? '0';
}

async function calcUsedAmountForCustomer(counterpartyIds: string[]): Promise<string> {
  if (!counterpartyIds.length) return '0';
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${orderItems.salesPrice}::numeric * ${orderItems.quantity}::numeric), 0)::text`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orderItems.orderId, orders.id))
    .where(
      and(
        inArray(orders.clientId, counterpartyIds),
        eq(orders.customerPaymentTermType, 'CREDIT'),
        inArray(orders.status, [...CUSTOMER_ACTIVE_STATUSES]),
      ),
    );
  return row?.total ?? '0';
}

// ═══════════════════════════════════════════════════════════════════════
//  CALCULATE PERFORMANCE (avg days to pay — customer only)
//  Averages across all counterparty companies on the credit line.
// ═══════════════════════════════════════════════════════════════════════

async function calcPerformanceDays(counterpartyIds: string[]): Promise<number | null> {
  if (!counterpartyIds.length) return null;
  const [row] = await db
    .select({
      avgDays: sql<number | null>`
        round(avg(extract(epoch from (${orders.closedAt} - ${orders.createdAt})) / 86400))::int
      `,
    })
    .from(orders)
    .where(
      and(
        inArray(orders.clientId, counterpartyIds),
        eq(orders.status, 'PAID'),
      ),
    );
  return row?.avgDays ?? null;
}

// ═══════════════════════════════════════════════════════════════════════
//  FETCH SIDES OF A CREDIT LINE
// ═══════════════════════════════════════════════════════════════════════

async function fetchCreditLineSides(creditLineId: string) {
  const [cpRows, ownRows] = await Promise.all([
    db
      .select({ id: counterparties.id, name: counterparties.name })
      .from(creditLineCounterparties)
      .innerJoin(counterparties, eq(creditLineCounterparties.counterpartyId, counterparties.id))
      .where(eq(creditLineCounterparties.creditLineId, creditLineId)),
    db
      .select({ id: counterparties.id, name: counterparties.name })
      .from(creditLineCompanies)
      .innerJoin(counterparties, eq(creditLineCompanies.counterpartyId, counterparties.id))
      .where(eq(creditLineCompanies.creditLineId, creditLineId)),
  ]);
  return {
    counterpartyIds: cpRows.map((r) => r.id),
    counterpartyNames: cpRows.map((r) => r.name),
    ownCompanyIds: ownRows.map((r) => r.id),
    ownCompanyNames: ownRows.map((r) => r.name),
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  ENRICH A RAW CREDIT LINE ROW → CreditLineDto
// ═══════════════════════════════════════════════════════════════════════

interface RawCreditLine {
  id: string;
  tenantId: string;
  type: string;
  creditAmount: string;
  currency: string;
  expires: string | null;
  periodDays: number;
  fromDelivery: boolean;
  qualified: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

async function enrichCreditLine(row: RawCreditLine): Promise<CreditLineDto> {
  const sides = await fetchCreditLineSides(row.id);

  const usedAmount =
    row.type === 'SUPPLIER'
      ? await calcUsedAmountForSupplier(sides.counterpartyIds)
      : await calcUsedAmountForCustomer(sides.counterpartyIds);

  const creditNum = parseFloat(row.creditAmount) || 0;
  const usedNum = parseFloat(usedAmount) || 0;
  const available = Math.max(creditNum - usedNum, 0);

  const performanceDays =
    row.type === 'CUSTOMER' ? await calcPerformanceDays(sides.counterpartyIds) : null;

  return {
    id: row.id,
    tenantId: row.tenantId,
    type: row.type as CreditLineType,
    counterpartyIds: sides.counterpartyIds,
    counterpartyNames: sides.counterpartyNames,
    ownCompanyIds: sides.ownCompanyIds,
    ownCompanyNames: sides.ownCompanyNames,
    creditAmount: row.creditAmount,
    currency: row.currency,
    usedAmount: usedNum.toFixed(2),
    availableAmount: available.toFixed(2),
    expires: row.expires,
    periodDays: row.periodDays,
    fromDelivery: row.fromDelivery,
    qualified: row.qualified,
    performanceDays,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  LIST CREDIT LINES (paginated, filtered by type)
// ═══════════════════════════════════════════════════════════════════════

export async function listCreditLines(query?: {
  type?: CreditLineType;
  counterpartyId?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}) {
  const conditions = [];
  if (query?.type) conditions.push(eq(creditLines.type, query.type));
  if (query?.counterpartyId) {
    conditions.push(eq(creditLineCounterparties.counterpartyId, query.counterpartyId));
  }

  const where = conditions.length === 1 ? conditions[0] : conditions.length > 1 ? and(...conditions) : undefined;

  const limit = query?.limit ?? 25;
  const page = query?.page ?? 1;
  const offset = (page - 1) * limit;

  // Sortable columns
  const sortMap: Record<string, any> = {
    updatedAt: creditLines.updatedAt,
    expires: creditLines.expires,
    periodDays: creditLines.periodDays,
    creditAmount: creditLines.creditAmount,
    createdAt: creditLines.createdAt,
  };
  const sortCol = sortMap[query?.sortBy ?? ''] ?? creditLines.updatedAt;
  const defaultDir = query?.sortBy ? 'asc' : 'desc';
  const sortFn = (query?.sortDir ?? defaultDir) === 'desc' ? desc : asc;

  const listQueryBase = db
    .select({
      id: creditLines.id,
      tenantId: creditLines.tenantId,
      type: creditLines.type,
      creditAmount: creditLines.creditAmount,
      currency: creditLines.currency,
      expires: creditLines.expires,
      periodDays: creditLines.periodDays,
      fromDelivery: creditLines.fromDelivery,
      qualified: creditLines.qualified,
      notes: creditLines.notes,
      createdAt: creditLines.createdAt,
      updatedAt: creditLines.updatedAt,
    })
    .from(creditLines);

  const countQueryBase = db
    .select({ count: sql<number>`count(distinct ${creditLines.id})::int` })
    .from(creditLines);

  const listQuery = query?.counterpartyId
    ? listQueryBase.innerJoin(
      creditLineCounterparties,
      eq(creditLineCounterparties.creditLineId, creditLines.id),
    )
    : listQueryBase;

  const countQuery = query?.counterpartyId
    ? countQueryBase.innerJoin(
      creditLineCounterparties,
      eq(creditLineCounterparties.creditLineId, creditLines.id),
    )
    : countQueryBase;

  const [rows, countResult] = await Promise.all([
    listQuery
      .where(where)
      .limit(limit)
      .offset(offset)
      .orderBy(sortFn(sortCol)),
    countQuery.where(where),
  ]);

  const items = await Promise.all(rows.map((r) => enrichCreditLine(r)));

  return { items, total: countResult[0]?.count ?? 0 };
}

// ═══════════════════════════════════════════════════════════════════════
//  GET SINGLE CREDIT LINE
// ═══════════════════════════════════════════════════════════════════════

export async function getCreditLineById(id: string): Promise<CreditLineDto | null> {
  const [row] = await db
    .select({
      id: creditLines.id,
      tenantId: creditLines.tenantId,
      type: creditLines.type,
      creditAmount: creditLines.creditAmount,
      currency: creditLines.currency,
      expires: creditLines.expires,
      periodDays: creditLines.periodDays,
      fromDelivery: creditLines.fromDelivery,
      qualified: creditLines.qualified,
      notes: creditLines.notes,
      createdAt: creditLines.createdAt,
      updatedAt: creditLines.updatedAt,
    })
    .from(creditLines)
    .where(eq(creditLines.id, id))
    .limit(1);

  if (!row) return null;
  return enrichCreditLine(row);
}

// ═══════════════════════════════════════════════════════════════════════
//  CREATE CREDIT LINE
// ═══════════════════════════════════════════════════════════════════════

export async function createCreditLine(data: {
  counterpartyIds: string[];
  type: CreditLineType;
  creditAmount: string;
  currency: string;
  expires?: string;
  periodDays: number;
  fromDelivery?: boolean;
  qualified?: boolean;
  notes?: string;
  ownCompanyIds?: string[];
}) {
  const tenantRow = await db.query.tenants.findFirst();
  if (!tenantRow) throw new Error('No tenant found');

  const [created] = await db
    .insert(creditLines)
    .values({
      tenantId: tenantRow.id,
      type: data.type,
      creditAmount: data.creditAmount,
      currency: data.currency,
      expires: data.expires ?? null,
      periodDays: data.periodDays,
      fromDelivery: data.fromDelivery ?? false,
      qualified: data.qualified ?? false,
      notes: data.notes ?? null,
    })
    .returning();

  // Link counterparties (suppliers or customers)
  if (data.counterpartyIds.length > 0) {
    await db.insert(creditLineCounterparties).values(
      data.counterpartyIds.map((cid) => ({
        creditLineId: created.id,
        counterpartyId: cid,
      })),
    );
  }

  // Link own companies
  if (data.ownCompanyIds?.length) {
    await db.insert(creditLineCompanies).values(
      data.ownCompanyIds.map((cid) => ({
        creditLineId: created.id,
        counterpartyId: cid,
      })),
    );
  }

  return getCreditLineById(created.id);
}

// ═══════════════════════════════════════════════════════════════════════
//  UPDATE CREDIT LINE
// ═══════════════════════════════════════════════════════════════════════

export async function updateCreditLine(
  id: string,
  data: {
    creditAmount?: string;
    currency?: string;
    expires?: string | null;
    periodDays?: number;
    fromDelivery?: boolean;
    qualified?: boolean;
    notes?: string | null;
    counterpartyIds?: string[];
    ownCompanyIds?: string[];
  },
) {
  const setFields: Record<string, unknown> = { updatedAt: new Date() };
  if (data.creditAmount !== undefined) setFields['creditAmount'] = data.creditAmount;
  if (data.currency !== undefined) setFields['currency'] = data.currency;
  if (data.expires !== undefined) setFields['expires'] = data.expires;
  if (data.periodDays !== undefined) setFields['periodDays'] = data.periodDays;
  if (data.fromDelivery !== undefined) setFields['fromDelivery'] = data.fromDelivery;
  if (data.qualified !== undefined) setFields['qualified'] = data.qualified;
  if (data.notes !== undefined) setFields['notes'] = data.notes;

  const [updated] = await db
    .update(creditLines)
    .set(setFields)
    .where(eq(creditLines.id, id))
    .returning();

  if (!updated) return null;

  // Update counterparties
  if (data.counterpartyIds !== undefined) {
    await db.delete(creditLineCounterparties).where(eq(creditLineCounterparties.creditLineId, id));
    if (data.counterpartyIds.length > 0) {
      await db.insert(creditLineCounterparties).values(
        data.counterpartyIds.map((cid) => ({
          creditLineId: id,
          counterpartyId: cid,
        })),
      );
    }
  }

  // Update own companies
  if (data.ownCompanyIds !== undefined) {
    await db.delete(creditLineCompanies).where(eq(creditLineCompanies.creditLineId, id));
    if (data.ownCompanyIds.length > 0) {
      await db.insert(creditLineCompanies).values(
        data.ownCompanyIds.map((cid) => ({
          creditLineId: id,
          counterpartyId: cid,
        })),
      );
    }
  }

  return getCreditLineById(updated.id);
}

// ═══════════════════════════════════════════════════════════════════════
//  DELETE CREDIT LINE
// ═══════════════════════════════════════════════════════════════════════

export async function deleteCreditLine(id: string) {
  const [deleted] = await db
    .delete(creditLines)
    .where(eq(creditLines.id, id))
    .returning({ id: creditLines.id });
  return deleted ?? null;
}
