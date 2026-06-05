// ═══════════════════════════════════════════════════════════════════════
//  Internal Transfers — service for INTERNAL_TRANSFER orders.
//
//  An internal transfer is one order with:
//    • orderKind = 'INTERNAL_TRANSFER'
//    • a 1:1 row in `order_transfers` describing source/destination companies
//      and warehouses, plus an optional plannedArrivalAt
//    • two rows in `order_transfer_sides` (SOURCE_SELL + DESTINATION_BUY),
//      each tracking its own commercial state (currency, payment terms, invoice).
//
//  Operationally the transfer follows the regular order lifecycle. Inventory
//  hooks in `orders.service.ts` consume `order_transfers` to drive source-side
//  outbound and destination-side inbound effects from one order.
// ═══════════════════════════════════════════════════════════════════════

import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import {
  bankAccounts,
  counterparties,
  orderTransferSides,
  orderTransfers,
  orders,
  orderNumberSequences,
  tenants,
  users,
  warehouses,
} from '../../db/schema';
import type {
  CreateInternalTransferDto,
  OrderTransferDto,
  OrderTransferSideDto,
  TransferSideKind,
  TransferSideStatus,
} from '@fueld/types';

async function getTenantId(): Promise<string> {
  const tenant = await db.query.tenants.findFirst();
  if (!tenant) throw new Error('No tenant found');
  return tenant.id;
}

// ── Helpers ────────────────────────────────────────────────────────

function nextOrderNumberFromSeq(seq: number, tenantSettings: { orderNumberPrefix?: string } | null): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const padded = String(seq).padStart(6, '0');
  const prefix = tenantSettings?.orderNumberPrefix?.trim() ?? '';
  return `${prefix}${yyyy}${mm}${dd}-${padded}`;
}

async function reserveOrderNumber(tenantId: string): Promise<string> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ lastSeq: orderNumberSequences.lastSeq })
      .from(orderNumberSequences)
      .where(eq(orderNumberSequences.tenantId, tenantId))
      .for('update')
      .limit(1);

    let nextSeq: number;
    if (existing) {
      nextSeq = existing.lastSeq + 1;
      await tx
        .update(orderNumberSequences)
        .set({ lastSeq: nextSeq, updatedAt: new Date() })
        .where(eq(orderNumberSequences.tenantId, tenantId));
    } else {
      nextSeq = 1;
      await tx.insert(orderNumberSequences).values({ tenantId, lastSeq: nextSeq });
    }

    const [tenant] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    return nextOrderNumberFromSeq(
      nextSeq,
      (tenant?.settings as { orderNumberPrefix?: string } | undefined) ?? null,
    );
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  CREATE INTERNAL TRANSFER
// ═══════════════════════════════════════════════════════════════════════

export async function createInternalTransfer(input: CreateInternalTransferDto, userId?: string | null) {
  const tenantId = await getTenantId();

  // Validate: source and destination must be own-companies, physical-ops enabled,
  // and the warehouses must belong to their respective companies and be inventory-enabled.
  const [src, dst] = await Promise.all([
    db.select({
      id: counterparties.id,
      isOwnCompany: counterparties.isOwnCompany,
      physicalOpsEnabled: counterparties.physicalOpsEnabled,
    }).from(counterparties).where(eq(counterparties.id, input.sourceCompanyId)).limit(1),
    db.select({
      id: counterparties.id,
      isOwnCompany: counterparties.isOwnCompany,
      physicalOpsEnabled: counterparties.physicalOpsEnabled,
    }).from(counterparties).where(eq(counterparties.id, input.destinationCompanyId)).limit(1),
  ]);
  const sourceCompany = src[0];
  const destinationCompany = dst[0];
  if (!sourceCompany || !destinationCompany) throw new Error('Source or destination company not found');
  if (!sourceCompany.isOwnCompany || !destinationCompany.isOwnCompany) {
    throw new Error('Internal transfers require both companies to be own-companies');
  }
  if (!sourceCompany.physicalOpsEnabled || !destinationCompany.physicalOpsEnabled) {
    throw new Error('Both companies must be physical-ops enabled');
  }
  if (sourceCompany.id === destinationCompany.id) {
    throw new Error('Source and destination companies must differ');
  }

  const [srcWh, dstWh] = await Promise.all([
    db.select().from(warehouses).where(eq(warehouses.id, input.sourceWarehouseId)).limit(1),
    db.select().from(warehouses).where(eq(warehouses.id, input.destinationWarehouseId)).limit(1),
  ]);
  const srcWarehouse = srcWh[0];
  const dstWarehouse = dstWh[0];
  if (!srcWarehouse || !dstWarehouse) throw new Error('Source or destination warehouse not found');
  if (srcWarehouse.ownerCompanyId !== sourceCompany.id) {
    throw new Error('Source warehouse must be owned by the source company');
  }
  if (dstWarehouse.ownerCompanyId !== destinationCompany.id) {
    throw new Error('Destination warehouse must be owned by the destination company');
  }
  if (!srcWarehouse.inventoryEnabled || !dstWarehouse.inventoryEnabled) {
    throw new Error('Both warehouses must be inventory-enabled');
  }
  if (srcWarehouse.id === dstWarehouse.id) {
    throw new Error('Source and destination warehouses must differ');
  }

  const orderNumber = await reserveOrderNumber(tenantId);

  return db.transaction(async (tx) => {
    // Create the order. Internal transfers reuse vessel/place semantics from the
    // existing model so order detail UIs keep working without special-casing.
    // We map clientId -> destination company and supplierId -> source company so
    // the standard rendering keeps producing useful labels until a transfer-aware
    // UI ships in step 13.
    const [order] = await tx
      .insert(orders)
      .values({
        tenantId,
        orderNumber,
        orderKind: 'INTERNAL_TRANSFER',
        clientId: input.destinationCompanyId,
        vesselId: input.vesselId,
        placeId: input.placeId,
        salesRepId: userId ?? null,
        invoicingCompanyId: input.sourceCompanyId,
        currency: 'USD',
        eta: input.eta ? new Date(input.eta) : null,
        etd: input.etd ? new Date(input.etd) : null,
        supplierId: input.sourceCompanyId,
      })
      .returning();

    await tx.insert(orderTransfers).values({
      orderId: order!.id,
      sourceCompanyId: input.sourceCompanyId,
      destinationCompanyId: input.destinationCompanyId,
      sourceWarehouseId: input.sourceWarehouseId,
      destinationWarehouseId: input.destinationWarehouseId,
      plannedArrivalAt: input.plannedArrivalAt ? new Date(input.plannedArrivalAt) : null,
    });

    await tx.insert(orderTransferSides).values([
      {
        orderId: order!.id,
        kind: 'SOURCE_SELL',
        status: 'DRAFT',
        companyId: input.sourceCompanyId,
        invoicingCompanyId: input.sourceCompanyId,
        currency: 'USD',
      },
      {
        orderId: order!.id,
        kind: 'DESTINATION_BUY',
        status: 'DRAFT',
        companyId: input.destinationCompanyId,
        invoicingCompanyId: input.destinationCompanyId,
        currency: 'USD',
      },
    ]);

    return order!;
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  GET TRANSFER (extension + sides)
// ═══════════════════════════════════════════════════════════════════════

export async function getOrderTransfer(orderId: string): Promise<OrderTransferDto | null> {
  const [row] = await db
    .select({
      orderId: orderTransfers.orderId,
      sourceCompanyId: orderTransfers.sourceCompanyId,
      destinationCompanyId: orderTransfers.destinationCompanyId,
      sourceWarehouseId: orderTransfers.sourceWarehouseId,
      destinationWarehouseId: orderTransfers.destinationWarehouseId,
      plannedArrivalAt: orderTransfers.plannedArrivalAt,
      createdAt: orderTransfers.createdAt,
      updatedAt: orderTransfers.updatedAt,
    })
    .from(orderTransfers)
    .where(eq(orderTransfers.orderId, orderId))
    .limit(1);
  if (!row) return null;

  // Names lookup.
  const [src] = await db.select({ name: counterparties.name }).from(counterparties).where(eq(counterparties.id, row.sourceCompanyId)).limit(1);
  const [dst] = await db.select({ name: counterparties.name }).from(counterparties).where(eq(counterparties.id, row.destinationCompanyId)).limit(1);
  const [srcWh] = await db.select({ name: warehouses.name }).from(warehouses).where(eq(warehouses.id, row.sourceWarehouseId)).limit(1);
  const [dstWh] = await db.select({ name: warehouses.name }).from(warehouses).where(eq(warehouses.id, row.destinationWarehouseId)).limit(1);

  return {
    orderId: row.orderId,
    sourceCompanyId: row.sourceCompanyId,
    sourceCompanyName: src?.name ?? '',
    destinationCompanyId: row.destinationCompanyId,
    destinationCompanyName: dst?.name ?? '',
    sourceWarehouseId: row.sourceWarehouseId,
    sourceWarehouseName: srcWh?.name ?? '',
    destinationWarehouseId: row.destinationWarehouseId,
    destinationWarehouseName: dstWh?.name ?? '',
    plannedArrivalAt: row.plannedArrivalAt ? row.plannedArrivalAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  TRANSFER SIDES
// ═══════════════════════════════════════════════════════════════════════

const transferSideSelect = {
  id: orderTransferSides.id,
  orderId: orderTransferSides.orderId,
  kind: orderTransferSides.kind,
  status: orderTransferSides.status,
  companyId: orderTransferSides.companyId,
  companyName: counterparties.name,
  invoicingCompanyId: orderTransferSides.invoicingCompanyId,
  bankAccountId: orderTransferSides.bankAccountId,
  paymentTermType: orderTransferSides.paymentTermType,
  creditDays: orderTransferSides.creditDays,
  currency: orderTransferSides.currency,
  invoiceId: orderTransferSides.invoiceId,
  finalizedAt: orderTransferSides.finalizedAt,
  finalizedBy: orderTransferSides.finalizedBy,
  note: orderTransferSides.note,
  createdAt: orderTransferSides.createdAt,
  updatedAt: orderTransferSides.updatedAt,
} as const;

export async function listTransferSides(orderId: string): Promise<OrderTransferSideDto[]> {
  const rows = await db
    .select(transferSideSelect)
    .from(orderTransferSides)
    .innerJoin(counterparties, eq(orderTransferSides.companyId, counterparties.id))
    .where(eq(orderTransferSides.orderId, orderId));

  // Lookup invoicing company names.
  const result: OrderTransferSideDto[] = [];
  for (const r of rows) {
    let invoicingCompanyName: string | null = null;
    if (r.invoicingCompanyId) {
      const [inv] = await db
        .select({ name: counterparties.name })
        .from(counterparties)
        .where(eq(counterparties.id, r.invoicingCompanyId))
        .limit(1);
      invoicingCompanyName = inv?.name ?? null;
    }
    let finalizedByName: string | null = null;
    if (r.finalizedBy) {
      const [u] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, r.finalizedBy))
        .limit(1);
      finalizedByName = u?.name ?? null;
    }
    result.push({
      id: r.id,
      orderId: r.orderId,
      kind: r.kind as TransferSideKind,
      status: r.status as TransferSideStatus,
      companyId: r.companyId,
      companyName: r.companyName ?? '',
      invoicingCompanyId: r.invoicingCompanyId,
      invoicingCompanyName,
      bankAccountId: r.bankAccountId,
      paymentTermType: r.paymentTermType as OrderTransferSideDto['paymentTermType'],
      creditDays: r.creditDays,
      currency: r.currency,
      invoiceId: r.invoiceId,
      finalizedAt: r.finalizedAt ? r.finalizedAt.toISOString() : null,
      finalizedByName,
      note: r.note,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    });
  }
  return result;
}

export async function updateTransferSide(
  sideId: string,
  input: {
    invoicingCompanyId?: string | null;
    bankAccountId?: string | null;
    paymentTermType?: 'CREDIT' | 'COD' | 'PREPAY' | null;
    creditDays?: number | null;
    currency?: string;
    note?: string | null;
  },
) {
  // Guard: a FINALIZED side is locked. Callers must reopen it first to edit.
  // The UI also disables fields when finalized, but the API must enforce this
  // independently to avoid a stale-tab edit slipping past.
  const [existing] = await db
    .select({ id: orderTransferSides.id, status: orderTransferSides.status })
    .from(orderTransferSides)
    .where(eq(orderTransferSides.id, sideId))
    .limit(1);
  if (!existing) return null;
  if (existing.status === 'FINALIZED') return existing;

  const setData: Record<string, unknown> = { updatedAt: new Date() };
  if (input.invoicingCompanyId !== undefined) setData.invoicingCompanyId = input.invoicingCompanyId;
  if (input.bankAccountId !== undefined) setData.bankAccountId = input.bankAccountId;
  if (input.paymentTermType !== undefined) setData.paymentTermType = input.paymentTermType;
  if (input.creditDays !== undefined) setData.creditDays = input.creditDays;
  if (input.currency !== undefined) setData.currency = input.currency;
  if (input.note !== undefined) setData.note = input.note;
  await db.update(orderTransferSides).set(setData).where(eq(orderTransferSides.id, sideId));
  const [side] = await db.select().from(orderTransferSides).where(eq(orderTransferSides.id, sideId)).limit(1);
  return side ?? null;
}

export async function finalizeTransferSide(sideId: string, userId: string) {
  // Side cannot be finalized without invoicing company + payment terms.
  const [side] = await db.select().from(orderTransferSides).where(eq(orderTransferSides.id, sideId)).limit(1);
  if (!side) throw new Error('Transfer side not found');
  if (!side.invoicingCompanyId) throw new Error('Invoicing company is required before finalizing');
  if (!side.paymentTermType) throw new Error('Payment terms are required before finalizing');

  const [updated] = await db
    .update(orderTransferSides)
    .set({
      status: 'FINALIZED',
      finalizedAt: new Date(),
      finalizedBy: userId,
      updatedAt: new Date(),
    })
    .where(eq(orderTransferSides.id, sideId))
    .returning();
  return updated ?? null;
}

export async function reopenTransferSide(sideId: string) {
  const [updated] = await db
    .update(orderTransferSides)
    .set({
      status: 'DRAFT',
      finalizedAt: null,
      finalizedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(orderTransferSides.id, sideId))
    .returning();
  return updated ?? null;
}
