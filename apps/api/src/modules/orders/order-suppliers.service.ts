// ═══════════════════════════════════════════════════════════════════════
//  Order Suppliers Service — multi-supplier CRUD for orders
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, asc, desc, sql } from 'drizzle-orm';
import { db } from '../../db';
import { orderSuppliers, orderItems, counterparties, companyContacts } from '../../db/schema';
import { getCounterpartyById, getCompanyContactById, normalizeOptionalTimestamp } from './order-utils.service';

async function listOrderSuppliers(orderId: string) {
  const rows = await db
    .select()
    .from(orderSuppliers)
    .where(eq(orderSuppliers.orderId, orderId))
    .orderBy(asc(orderSuppliers.sortOrder), asc(orderSuppliers.createdAt));

  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      orderId: row.orderId,
      companyId: row.companyId,
      contactId: row.contactId ?? null,
      paymentTermType: row.paymentTermType ?? null,
      creditDays: row.creditDays ?? null,
      note: row.note ?? null,
      sortOrder: row.sortOrder,
      isPrimary: row.isPrimary,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      company: await getCounterpartyById(row.companyId),
      contact: await getCompanyContactById(row.contactId),
    })),
  );
}

async function syncLegacyOrderFieldsFromPrimary(orderId: string) {
  const suppliers = await db
    .select()
    .from(orderSuppliers)
    .where(eq(orderSuppliers.orderId, orderId))
    .orderBy(
      desc(orderSuppliers.isPrimary),
      asc(orderSuppliers.sortOrder),
      asc(orderSuppliers.createdAt),
    );

  const primary = suppliers.find((s) => s.isPrimary) ?? suppliers[0] ?? null;
  const deliveredAtValues = suppliers
    .map((s) => s.deliveredAt?.getTime() ?? 0)
    .filter((v) => v > 0);
  const latestDeliveredAt =
    deliveredAtValues.length > 0
      ? new Date(Math.max(...deliveredAtValues))
      : null;

  await db
    .update(orders)
    .set({
      supplierId: primary?.companyId ?? null,
      supplierContactId: primary?.contactId ?? null,
      supplierPaymentTermType: primary?.paymentTermType ?? null,
      supplierCreditDays: primary?.creditDays ?? null,
      supplierNote: primary?.note ?? null,
      deliveredAt: latestDeliveredAt,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId));
}

import { orders } from '../../db/schema';

async function normalizePrimarySupplier(
  orderId: string,
  primarySupplierId?: string | null,
) {
  const suppliers = await db
    .select({ id: orderSuppliers.id, isPrimary: orderSuppliers.isPrimary })
    .from(orderSuppliers)
    .where(eq(orderSuppliers.orderId, orderId))
    .orderBy(asc(orderSuppliers.sortOrder), asc(orderSuppliers.createdAt));

  if (!suppliers.length) {
    await syncLegacyOrderFieldsFromPrimary(orderId);
    return;
  }

  const targetId =
    primarySupplierId ??
    suppliers.find((s) => s.isPrimary)?.id ??
    suppliers[0]!.id;

  await db
    .update(orderSuppliers)
    .set({ isPrimary: false, updatedAt: new Date() })
    .where(
      and(
        eq(orderSuppliers.orderId, orderId),
        eq(orderSuppliers.isPrimary, true),
      ),
    );

  await db
    .update(orderSuppliers)
    .set({ isPrimary: true, updatedAt: new Date() })
    .where(eq(orderSuppliers.id, targetId));

  await syncLegacyOrderFieldsFromPrimary(orderId);
}

async function ensureUniqueOrderSupplierCompany(
  orderId: string,
  companyId: string,
  excludeSupplierRecordId?: string,
) {
  const existing = await db
    .select({ id: orderSuppliers.id })
    .from(orderSuppliers)
    .where(
      and(
        eq(orderSuppliers.orderId, orderId),
        eq(orderSuppliers.companyId, companyId),
      ),
    );

  if (existing.some((s) => s.id !== excludeSupplierRecordId)) {
    throw new Error('This supplier is already added to the order');
  }
}

async function syncPrimaryOrderSupplierFromLegacy(order: {
  id: string;
  supplierId: string | null;
  supplierContactId: string | null;
  supplierPaymentTermType: 'CREDIT' | 'COD' | 'PREPAY' | null;
  supplierCreditDays: number | null;
  supplierNote: string | null;
  deliveredAt: Date | null;
}) {
  const [primarySupplier] = await db
    .select()
    .from(orderSuppliers)
    .where(
      and(eq(orderSuppliers.orderId, order.id), eq(orderSuppliers.isPrimary, true)),
    )
    .orderBy(asc(orderSuppliers.sortOrder), asc(orderSuppliers.createdAt))
    .limit(1);

  if (!order.supplierId) {
    if (primarySupplier) {
      await db
        .update(orderItems)
        .set({ orderSupplierId: null, updatedAt: new Date() })
        .where(eq(orderItems.orderSupplierId, primarySupplier.id));

      await db
        .delete(orderSuppliers)
        .where(eq(orderSuppliers.id, primarySupplier.id));
    }
    return;
  }

  const payload = {
    companyId: order.supplierId,
    contactId: order.supplierContactId ?? null,
    paymentTermType: order.supplierPaymentTermType ?? null,
    creditDays: order.supplierCreditDays ?? null,
    note: order.supplierNote ?? null,
    deliveredAt: normalizeOptionalTimestamp(order.deliveredAt),
    updatedAt: new Date(),
  };

  if (primarySupplier) {
    await db
      .update(orderSuppliers)
      .set(payload)
      .where(eq(orderSuppliers.id, primarySupplier.id));
    return;
  }

  await db.insert(orderSuppliers).values({
    orderId: order.id,
    companyId: payload.companyId,
    contactId: payload.contactId,
    paymentTermType: payload.paymentTermType,
    creditDays: payload.creditDays,
    note: payload.note,
    deliveredAt: payload.deliveredAt,
    sortOrder: 0,
    isPrimary: true,
  });
}

export async function getOrderSuppliers(orderId: string) {
  return listOrderSuppliers(orderId);
}

export async function addOrderSupplier(
  orderId: string,
  input: {
    companyId: string;
    contactId?: string | null;
    paymentTermType?: 'CREDIT' | 'COD' | 'PREPAY' | null;
    creditDays?: number | null;
    note?: string | null;
    deliveredAt?: string | null;
    isPrimary?: boolean;
  },
) {
  const existing = await db
    .select({ id: orderSuppliers.id, sortOrder: orderSuppliers.sortOrder })
    .from(orderSuppliers)
    .where(eq(orderSuppliers.orderId, orderId))
    .orderBy(desc(orderSuppliers.sortOrder));

  await ensureUniqueOrderSupplierCompany(orderId, input.companyId);

  const [created] = await db
    .insert(orderSuppliers)
    .values({
      orderId,
      companyId: input.companyId,
      contactId: input.contactId ?? null,
      paymentTermType: input.paymentTermType ?? null,
      creditDays: input.creditDays ?? null,
      note: input.note ?? null,
      deliveredAt: normalizeOptionalTimestamp(input.deliveredAt),
      sortOrder: (existing[0]?.sortOrder ?? -1) + 1,
      isPrimary: existing.length === 0 || input.isPrimary === true,
    })
    .returning();

  await normalizePrimarySupplier(
    orderId,
    created.isPrimary ? created.id : null,
  );
  return (
    (await listOrderSuppliers(orderId)).find(
      (s) => s.id === created.id,
    ) ?? null
  );
}

export async function updateOrderSupplierRecord(
  orderId: string,
  supplierRecordId: string,
  input: {
    companyId?: string;
    contactId?: string | null;
    paymentTermType?: 'CREDIT' | 'COD' | 'PREPAY' | null;
    creditDays?: number | null;
    note?: string | null;
    deliveredAt?: string | null;
    sortOrder?: number;
    isPrimary?: boolean;
  },
) {
  const [existing] = await db
    .select()
    .from(orderSuppliers)
    .where(
      and(
        eq(orderSuppliers.id, supplierRecordId),
        eq(orderSuppliers.orderId, orderId),
      ),
    )
    .limit(1);

  if (!existing) return null;

  if (input.companyId !== undefined) {
    await ensureUniqueOrderSupplierCompany(
      orderId,
      input.companyId,
      supplierRecordId,
    );
  }

  const setData: Record<string, unknown> = { updatedAt: new Date() };
  if (input.companyId !== undefined) setData.companyId = input.companyId;
  if (input.contactId !== undefined) setData.contactId = input.contactId;
  if (input.paymentTermType !== undefined)
    setData.paymentTermType = input.paymentTermType;
  if (input.creditDays !== undefined) setData.creditDays = input.creditDays;
  if (input.note !== undefined) setData.note = input.note;
  if (input.deliveredAt !== undefined)
    setData.deliveredAt = normalizeOptionalTimestamp(input.deliveredAt);
  if (input.sortOrder !== undefined) setData.sortOrder = input.sortOrder;
  if (input.isPrimary !== undefined) setData.isPrimary = input.isPrimary;

  await db
    .update(orderSuppliers)
    .set(setData)
    .where(eq(orderSuppliers.id, supplierRecordId));

  await normalizePrimarySupplier(
    orderId,
    input.isPrimary ? supplierRecordId : null,
  );
  return (
    (await listOrderSuppliers(orderId)).find(
      (s) => s.id === supplierRecordId,
    ) ?? null
  );
}

export async function deleteOrderSupplierRecord(
  orderId: string,
  supplierRecordId: string,
) {
  const [usage] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orderItems)
    .where(
      and(
        eq(orderItems.orderId, orderId),
        eq(orderItems.orderSupplierId, supplierRecordId),
      ),
    );

  if ((usage?.count ?? 0) > 0) {
    throw new Error('Reassign line items before removing this supplier');
  }

  const [deleted] = await db
    .delete(orderSuppliers)
    .where(
      and(
        eq(orderSuppliers.id, supplierRecordId),
        eq(orderSuppliers.orderId, orderId),
      ),
    )
    .returning({ id: orderSuppliers.id, isPrimary: orderSuppliers.isPrimary });

  if (!deleted) return null;

  await normalizePrimarySupplier(orderId, null);
  return deleted;
}

export {
  syncPrimaryOrderSupplierFromLegacy,
  listOrderSuppliers,
  deriveOrderDeliveredAtIso,
};

import { orders as ordersTable } from '../../db/schema';

function deriveOrderDeliveredAtIso(
  orderDeliveredAt: Date | null,
  suppliers: Array<{ deliveredAt: string | null }>,
): string | null {
  const candidateMs = [
    orderDeliveredAt?.getTime() ?? 0,
    ...suppliers
      .map((s) => (s.deliveredAt ? Date.parse(s.deliveredAt) : 0))
      .filter((v) => Number.isFinite(v) && v > 0),
  ];

  const latestMs = Math.max(...candidateMs);
  return latestMs > 0 ? new Date(latestMs).toISOString() : null;
}
