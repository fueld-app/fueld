// ═══════════════════════════════════════════════════════════════════════
//  Order CRUD Service — list, get, create, update, delete orders
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, desc, asc, sql, ilike, inArray, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../../db';
import {
  orders,
  orderItems,
  counterparties,
  vessels,
  places,
  users,
  creditLines,
  creditLineCounterparties,
  priceReferences,
} from '../../db/schema';
import type { Order } from '../../db/schema';
import { logActivity } from '../activity/activity.service';
import { calculateGrossProfitBase, calculateOrderEconomics, getFinancingRateAnnual } from './order-financing';
import { getFxRate } from '../prices/price.service';
import {
  getTenantFinancingRateByIds,
  getCounterpartyById,
  getCompanyContactById,
  getPreferredOwnCompanyId,
  getPreferredBankAccountId,
  generateOrderNumber,
  buildOrderUpdateActivityMetadata,
  normalizeOptionalTimestamp,
} from './order-utils.service';
import type {
  ListOrdersQuery,
  CreateOrderInput,
  UpdateOrderInput,
  SaveItemInput,
} from './order.types';

// Lazy-import to avoid circular deps
async function listOrderSuppliers(orderId: string) {
  const { getOrderSuppliers } = await import('./order-suppliers.service');
  return getOrderSuppliers(orderId);
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
  const { addOrderSupplier, updateOrderSupplierRecord, deleteOrderSupplierRecord } = await import('./order-suppliers.service');

  const orderSuppliersTable = (await import('../../db/schema')).orderSuppliers;
  const { eq: eqFn, and: andFn, asc: ascFn } = await import('drizzle-orm');

  const [primarySupplier] = await db
    .select()
    .from(orderSuppliersTable)
    .where(andFn(eqFn(orderSuppliersTable.orderId, order.id), eqFn(orderSuppliersTable.isPrimary, true)))
    .orderBy(ascFn(orderSuppliersTable.sortOrder), ascFn(orderSuppliersTable.createdAt))
    .limit(1);

  if (!order.supplierId) {
    if (primarySupplier) {
      await db
        .update(orderItems)
        .set({ orderSupplierId: null, updatedAt: new Date() })
        .where(eq(orderItems.orderSupplierId, primarySupplier.id));
      await db.delete(orderSuppliersTable).where(eq(orderSuppliersTable.id, primarySupplier.id));
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
    await db.update(orderSuppliersTable).set(payload).where(eqFn(orderSuppliersTable.id, primarySupplier.id));
    return;
  }

  await db.insert(orderSuppliersTable).values({
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

// ─── List Orders ──────────────────────────────────────────────────

export async function listOrders(query?: ListOrdersQuery) {
  const conditions: any[] = [];

  if (query?.statuses?.length) {
    conditions.push(inArray(orders.status, query.statuses as any));
  }
  if (query?.salesRepId) {
    conditions.push(eq(orders.salesRepId, query.salesRepId));
  }
  if (query?.brokerId) {
    conditions.push(eq(orders.brokerId, query.brokerId));
  }
  if (query?.search) {
    const searchTerm = `%${query.search}%`;
    conditions.push(
      sql`(
        ${orders.orderNumber} ILIKE ${searchTerm}
        OR EXISTS (SELECT 1 FROM counterparties c WHERE c.id = ${orders.clientId} AND c.name ILIKE ${searchTerm})
        OR EXISTS (SELECT 1 FROM vessels v WHERE v.id = ${orders.vesselId} AND v.name ILIKE ${searchTerm})
        OR EXISTS (SELECT 1 FROM places p WHERE p.id = ${orders.placeId} AND p.name ILIKE ${searchTerm})
      )`,
    );
  }

  const where = conditions.length
    ? conditions.length === 1 ? conditions[0] : and(...conditions)
    : undefined;

  const limit = query?.limit ?? 25;
  const page = query?.page ?? 1;
  const offset = (page - 1) * limit;

  const invoicingCompany = alias(counterparties, 'invoicing_company');

  const sortMap: Record<string, any> = {
    orderNumber: orders.orderNumber,
    client: counterparties.name,
    vessel: vessels.name,
    port: places.name,
    status: orders.status,
    responsible: users.name,
    eta: orders.eta,
    dueDate: orders.dueDate,
    invoicingCompany: invoicingCompany.name,
    createdAt: orders.createdAt,
  };
  const sortCol = sortMap[query?.sortBy ?? ''] ?? orders.createdAt;
  const defaultDir = query?.sortBy ? 'asc' : 'desc';
  const sortFn = (query?.sortDir ?? defaultDir) === 'desc' ? desc : asc;

  const [rows, countResult] = await Promise.all([
    db
      .select({
        id: orders.id,
        tenantId: orders.tenantId,
        orderNumber: orders.orderNumber,
        status: orders.status,
        clientName: counterparties.name,
        vesselName: vessels.name,
        placeName: places.name,
        salesRepName: users.name,
        invoicingCompanyName: invoicingCompany.name,
        customerPaymentTermType: orders.customerPaymentTermType,
        customerCreditDays: orders.customerCreditDays,
        supplierPaymentTermType: orders.supplierPaymentTermType,
        supplierCreditDays: orders.supplierCreditDays,
        eta: orders.eta,
        dueDate: orders.dueDate,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
      })
      .from(orders)
      .innerJoin(counterparties, eq(orders.clientId, counterparties.id))
      .innerJoin(vessels, eq(orders.vesselId, vessels.id))
      .innerJoin(places, eq(orders.placeId, places.id))
      .leftJoin(users, eq(orders.salesRepId, users.id))
      .leftJoin(invoicingCompany, eq(orders.invoicingCompanyId, invoicingCompany.id))
      .where(where)
      .orderBy(sortFn(sortCol))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(orders).where(where),
  ]);

  // Compute economics per row
  const orderIds = rows.map((r) => r.id);
  let itemAggs: Record<string, any> = {};

  if (orderIds.length > 0) {
    const [itemRows, financingRateByTenant] = await Promise.all([
      db
        .select({
          orderId: orderItems.orderId,
          quantity: orderItems.quantity,
          deliveredQuantity: orderItems.deliveredQuantity,
          costPrice: orderItems.costPrice,
          costCurrency: orderItems.costCurrency,
          costConversionFactor: orderItems.costConversionFactor,
          salesPrice: orderItems.salesPrice,
          salesCurrency: orderItems.salesCurrency,
          unitConversionFactor: orderItems.unitConversionFactor,
        })
        .from(orderItems)
        .where(inArray(orderItems.orderId, orderIds)),
      getTenantFinancingRateByIds(Array.from(new Set(rows.map((r) => r.tenantId)))),
    ]);

    const itemsByOrder = new Map<string, typeof itemRows>();
    for (const item of itemRows) {
      const current = itemsByOrder.get(item.orderId) ?? [];
      current.push(item);
      itemsByOrder.set(item.orderId, current);
    }

    for (const row of rows) {
      const orderItemList = itemsByOrder.get(row.id) ?? [];
      const economics = calculateOrderEconomics(
        {
          customerPaymentTermType: row.customerPaymentTermType,
          customerCreditDays: row.customerCreditDays,
          supplierPaymentTermType: row.supplierPaymentTermType,
          supplierCreditDays: row.supplierCreditDays,
        },
        orderItemList,
        financingRateByTenant.get(row.tenantId) ?? getFinancingRateAnnual(),
      );

      let displayCurrency = 'USD';
      if (orderItemList.length > 0) {
        const first = (orderItemList[0]!.costCurrency ?? 'USD').toUpperCase();
        const allSame = orderItemList.every(
          (item) =>
            (item.costCurrency ?? 'USD').toUpperCase() === first &&
            (item.salesCurrency ?? 'USD').toUpperCase() === first,
        );
        if (allSame) displayCurrency = first;
      }

      let fxDiv = 1;
      if (displayCurrency !== 'USD') {
        const rate = getFxRate(displayCurrency);
        if (rate > 0) fxDiv = rate;
      }

      itemAggs[row.id] = {
        totalValue: economics.totalRevenueBase / fxDiv,
        totalProfit: economics.totalGrossProfit / fxDiv,
        totalFinancingCost: economics.totalFinancingCost / fxDiv,
        totalNetProfit: economics.totalNetProfit / fxDiv,
        netMarginPct: economics.netMarginPct,
        displayCurrency,
      };
    }
  }

  const items = rows.map((r) => ({
    id: r.id,
    orderNumber: r.orderNumber,
    status: r.status,
    clientName: r.clientName,
    vesselName: r.vesselName,
    placeName: r.placeName,
    salesRepName: r.salesRepName,
    invoicingCompanyName: r.invoicingCompanyName,
    eta: r.eta?.toISOString() ?? null,
    dueDate: r.dueDate ?? r.eta?.toISOString() ?? null,
    totalValue: itemAggs[r.id]?.totalValue ?? 0,
    totalProfit: itemAggs[r.id]?.totalProfit ?? 0,
    totalFinancingCost: itemAggs[r.id]?.totalFinancingCost ?? 0,
    totalNetProfit: itemAggs[r.id]?.totalNetProfit ?? 0,
    netMarginPct: itemAggs[r.id]?.netMarginPct ?? null,
    displayCurrency: itemAggs[r.id]?.displayCurrency ?? 'USD',
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return { items, total: countResult[0]?.count ?? 0 };
}

// ─── Resolve Order ID ─────────────────────────────────────────────

export async function resolveOrderId(idOrNumber: string): Promise<string | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrNumber);
  if (isUuid) return idOrNumber;

  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.orderNumber, idOrNumber))
    .limit(1);
  return row?.id ?? null;
}

// ─── Get Order By ID ──────────────────────────────────────────────

export async function getOrderById(idOrNumber: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrNumber);
  const condition = isUuid ? eq(orders.id, idOrNumber) : eq(orders.orderNumber, idOrNumber);

  const [row] = await db.select().from(orders).where(condition).limit(1);
  if (!row) return null;

  const [client, supplier, vessel, place, salesRep, invoicingCompany, items, customerContact, supplierContact, broker, brokerContact, agent, agentContact, tenant, orderSupplierRows] =
    await Promise.all([
      getCounterpartyById(row.clientId),
      getCounterpartyById(row.supplierId),
      db.select().from(vessels).where(eq(vessels.id, row.vesselId)).limit(1).then((r) => r[0] ?? null),
      db.select().from(places).where(eq(places.id, row.placeId)).limit(1).then((r) => r[0] ?? null),
      row.salesRepId
        ? db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, row.salesRepId)).limit(1).then((r) => r[0] ?? null)
        : Promise.resolve(null),
      row.invoicingCompanyId ? getCounterpartyById(row.invoicingCompanyId) : Promise.resolve(null),
      db.select().from(orderItems).where(eq(orderItems.orderId, row.id)),
      row.customerContactId ? getCompanyContactById(row.customerContactId) : Promise.resolve(null),
      row.supplierContactId ? getCompanyContactById(row.supplierContactId) : Promise.resolve(null),
      row.brokerId ? getCounterpartyById(row.brokerId) : Promise.resolve(null),
      row.brokerContactId ? getCompanyContactById(row.brokerContactId) : Promise.resolve(null),
      row.agentId ? getCounterpartyById(row.agentId) : Promise.resolve(null),
      row.agentContactId ? getCompanyContactById(row.agentContactId) : Promise.resolve(null),
      db.query.tenants.findFirst({
        where: eq((await import('../../db/schema')).tenants.id, row.tenantId),
        columns: { settings: true },
      }),
      listOrderSuppliers(row.id),
    ]);

  const financingRateAnnual = getFinancingRateAnnual((tenant?.settings ?? {}) as any);
  const orderEconomics = calculateOrderEconomics(
    {
      customerPaymentTermType: row.customerPaymentTermType,
      customerCreditDays: row.customerCreditDays,
      supplierPaymentTermType: row.supplierPaymentTermType,
      supplierCreditDays: row.supplierCreditDays,
    },
    items,
    financingRateAnnual,
  );

  const refIds = new Set<string>();
  for (const i of items) {
    if (i.costReferenceId) refIds.add(i.costReferenceId);
    if (i.salesReferenceId) refIds.add(i.salesReferenceId);
  }
  const refNameMap = new Map<string, string>();
  if (refIds.size > 0) {
    const refs = await db
      .select({ id: priceReferences.id, name: priceReferences.name })
      .from(priceReferences)
      .where(inArray(priceReferences.id, Array.from(refIds)));
    for (const r of refs) refNameMap.set(r.id, r.name);
  }

  const deliveredAtIso = deriveOrderDeliveredAtIso(row.deliveredAt ?? null, orderSupplierRows);

  return {
    ...row,
    orderNumber: row.orderNumber,
    eta: row.eta?.toISOString() ?? null,
    etd: row.etd?.toISOString() ?? null,
    deliveredAt: deliveredAtIso,
    closedAt: row.closedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    customerPaymentTermType: row.customerPaymentTermType ?? null,
    customerCreditDays: row.customerCreditDays ?? null,
    customerNote: row.customerNote ?? null,
    purchaseOrderNumber: row.purchaseOrderNumber ?? null,
    customerContactId: row.customerContactId ?? null,
    supplierId: row.supplierId ?? null,
    supplierPaymentTermType: row.supplierPaymentTermType ?? null,
    supplierCreditDays: row.supplierCreditDays ?? null,
    supplierNote: row.supplierNote ?? null,
    supplierContactId: row.supplierContactId ?? null,
    brokerId: row.brokerId ?? null,
    brokerContactId: row.brokerContactId ?? null,
    brokerGetsAll: row.brokerGetsAll ?? false,
    agentId: row.agentId ?? null,
    agentContactId: row.agentContactId ?? null,
    termsAndConditions: row.termsAndConditions ?? null,
    financingRateAnnual,
    financingDayCountConvention: orderEconomics.dayCountConvention,
    financingDays: orderEconomics.financingDays,
    totalFinancingCost: orderEconomics.totalFinancingCost.toFixed(4),
    financingCostPerMt: orderEconomics.financingCostPerMt != null ? orderEconomics.financingCostPerMt.toFixed(4) : null,
    totalNetProfit: orderEconomics.totalNetProfit.toFixed(4),
    netMarginPct: orderEconomics.netMarginPct != null ? orderEconomics.netMarginPct.toFixed(4) : null,
    client, supplier, vessel, place, salesRep, invoicingCompany,
    customerContact, supplierContact, broker, brokerContact, agent, agentContact,
    orderSuppliers: orderSupplierRows,
    items: items.map((i, index) => ({
      id: i.id,
      orderId: i.orderId,
      orderSupplierId: i.orderSupplierId ?? null,
      productType: i.productType,
      quantity: i.quantity,
      quantityMin: i.quantityMin,
      quantityMax: i.quantityMax,
      unit: i.unit,
      costUnit: i.costUnit ?? i.unit,
      salesUnit: i.salesUnit ?? i.unit,
      costConversionFactor: i.costConversionFactor ?? '1',
      unitConversionFactor: i.unitConversionFactor ?? '1',
      description: i.description ?? null,
      costPrice: i.costPrice,
      costCurrency: i.costCurrency,
      salesPrice: i.salesPrice,
      salesCurrency: i.salesCurrency,
      profit: i.profit,
      financingCost: orderEconomics.lineEconomics[index]?.financingCost.toFixed(4) ?? null,
      netProfit: orderEconomics.lineEconomics[index]?.netProfit.toFixed(4) ?? null,
      paymentTerms: i.paymentTerms,
      customerNote: i.customerNote,
      deliveredQuantity: i.deliveredQuantity,
      costPricingModel: i.costPricingModel ?? 'FIXED',
      costReferenceId: i.costReferenceId ?? null,
      costPlattsEntryId: i.costPlattsEntryId ?? null,
      costReferenceName: i.costReferenceId ? (refNameMap.get(i.costReferenceId) ?? null) : null,
      costPremium: i.costPremium ?? null,
      costBarging: i.costBarging ?? null,
      costBargingUnit: i.costBargingUnit ?? null,
      costCreditDays: i.costCreditDays ?? null,
      costPriceFinalized: i.costPriceFinalized ?? false,
      salesPricingModel: i.salesPricingModel ?? 'FIXED',
      salesReferenceId: i.salesReferenceId ?? null,
      salesPlattsEntryId: i.salesPlattsEntryId ?? null,
      salesReferenceName: i.salesReferenceId ? (refNameMap.get(i.salesReferenceId) ?? null) : null,
      salesPremium: i.salesPremium ?? null,
      salesBarging: i.salesBarging ?? null,
      salesBargingUnit: i.salesBargingUnit ?? null,
      salesCreditDays: i.salesCreditDays ?? null,
      salesPriceFinalized: i.salesPriceFinalized ?? false,
      inventorySkuId: i.inventorySkuId ?? null,
      warehouseId: i.warehouseId ?? null,
      plannedInventoryAt: i.plannedInventoryAt ? i.plannedInventoryAt.toISOString() : null,
    })),
  };
}

function deriveOrderDeliveredAtIso(
  orderDeliveredAt: Date | null,
  suppliers: Array<{ deliveredAt: string | null }>,
): string | null {
  const candidateMs = [
    orderDeliveredAt?.getTime() ?? 0,
    ...suppliers.map((s) => s.deliveredAt ? Date.parse(s.deliveredAt) : 0).filter((v) => Number.isFinite(v) && v > 0),
  ];
  const latestMs = Math.max(...candidateMs);
  return latestMs > 0 ? new Date(latestMs).toISOString() : null;
}

// ─── Create Order ─────────────────────────────────────────────────

export async function createOrder(input: CreateOrderInput) {
  const orderNumber = await generateOrderNumber(input.tenantId);
  const currency = input.currency ?? 'USD';
  const invoicingCompanyId = await getPreferredOwnCompanyId(input.tenantId, input.invoicingCompanyId ?? null, input.supplierId ?? null);
  const bankAccountId = await getPreferredBankAccountId(invoicingCompanyId, currency, input.bankAccountId ?? null);

  let placeRemark = input.placeRemark ?? null;
  if (placeRemark === null) {
    const [placeRow] = await db
      .select({ orderRemark: places.orderRemark })
      .from(places)
      .where(eq(places.id, input.placeId))
      .limit(1);
    placeRemark = placeRow?.orderRemark ?? null;
  }

  let customerPaymentTermType = input.customerPaymentTermType ?? null;
  let customerCreditDays = input.customerCreditDays ?? null;
  if (customerPaymentTermType === null) {
    const creditLineRows = await db
      .select({ periodDays: creditLines.periodDays })
      .from(creditLines)
      .innerJoin(creditLineCounterparties, eq(creditLineCounterparties.creditLineId, creditLines.id))
      .where(and(eq(creditLines.type, 'CUSTOMER'), eq(creditLineCounterparties.counterpartyId, input.clientId)));
    if (creditLineRows.length > 0) {
      customerPaymentTermType = 'CREDIT';
      customerCreditDays = Math.max(...creditLineRows.map((r) => r.periodDays));
    }
  }

  const values: typeof orders.$inferInsert = {
    tenantId: input.tenantId,
    orderNumber,
    clientId: input.clientId,
    vesselId: input.vesselId,
    placeId: input.placeId,
    salesRepId: input.salesRepId ?? null,
    invoicingCompanyId,
    bankAccountId,
    currency,
    eta: input.eta ? new Date(input.eta) : null,
    etd: input.etd ? new Date(input.etd) : null,
    customerPaymentTermType,
    customerCreditDays,
    customerNote: input.customerNote ?? null,
    purchaseOrderNumber: input.purchaseOrderNumber ?? null,
    customerContactId: input.customerContactId ?? null,
    supplierId: input.supplierId ?? null,
    supplierPaymentTermType: input.supplierPaymentTermType ?? null,
    supplierCreditDays: input.supplierCreditDays ?? null,
    supplierNote: input.supplierNote ?? null,
    supplierContactId: input.supplierContactId ?? null,
    termsAndConditions: input.termsAndConditions ?? null,
    brokerId: input.brokerId ?? null,
    brokerContactId: input.brokerContactId ?? null,
    brokerGetsAll: input.brokerGetsAll ?? false,
    agentId: input.agentId ?? null,
    agentContactId: input.agentContactId ?? null,
    categoryKey: input.categoryKey ?? null,
    placeRemark,
  };

  const [created] = await db.insert(orders).values(values).returning();
  await syncPrimaryOrderSupplierFromLegacy(created);
  return created;
}

// ─── Update Order ─────────────────────────────────────────────────

export async function updateOrder(id: string, input: UpdateOrderInput, activityUserId?: string | null) {
  const setData: Record<string, unknown> = { updatedAt: new Date() };

  const [currentOrder] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (!currentOrder) return null;

  const nextCurrency = input.currency ?? currentOrder.currency;
  const requestedInvoicingCompanyId = input.invoicingCompanyId !== undefined ? input.invoicingCompanyId : currentOrder.invoicingCompanyId;
  const resolvedInvoicingCompanyId = await getPreferredOwnCompanyId(
    currentOrder.tenantId,
    requestedInvoicingCompanyId,
    input.supplierId !== undefined ? input.supplierId : currentOrder.supplierId,
  );
  const shouldRecomputeBankAccount = input.invoicingCompanyId !== undefined || input.bankAccountId !== undefined || input.currency !== undefined;
  const requestedBankAccountId = shouldRecomputeBankAccount
    ? (input.bankAccountId !== undefined ? input.bankAccountId : currentOrder.bankAccountId)
    : currentOrder.bankAccountId;
  const resolvedBankAccountId = shouldRecomputeBankAccount
    ? await getPreferredBankAccountId(resolvedInvoicingCompanyId, nextCurrency, requestedBankAccountId)
    : currentOrder.bankAccountId;

  if (input.clientId !== undefined) setData.clientId = input.clientId;
  if (input.vesselId !== undefined) setData.vesselId = input.vesselId;
  if (input.placeId !== undefined) setData.placeId = input.placeId;
  if (input.salesRepId !== undefined) setData.salesRepId = input.salesRepId;
  if (input.invoicingCompanyId !== undefined) setData.invoicingCompanyId = resolvedInvoicingCompanyId;
  if (shouldRecomputeBankAccount) setData.bankAccountId = resolvedBankAccountId;
  if (input.currency !== undefined) setData.currency = input.currency;
  if (input.status !== undefined) setData.status = input.status;
  if (input.eta !== undefined) setData.eta = input.eta ? new Date(input.eta) : null;
  if (input.etd !== undefined) setData.etd = input.etd ? new Date(input.etd) : null;
  if (input.deliveredAt !== undefined) setData.deliveredAt = input.deliveredAt ? new Date(input.deliveredAt) : null;
  if (input.customerPaymentTermType !== undefined) setData.customerPaymentTermType = input.customerPaymentTermType;
  if (input.customerCreditDays !== undefined) setData.customerCreditDays = input.customerCreditDays;
  if (input.customerNote !== undefined) setData.customerNote = input.customerNote;
  if (input.purchaseOrderNumber !== undefined) setData.purchaseOrderNumber = input.purchaseOrderNumber;
  if (input.customerContactId !== undefined) setData.customerContactId = input.customerContactId;
  if (input.supplierId !== undefined) setData.supplierId = input.supplierId;
  if (input.supplierPaymentTermType !== undefined) setData.supplierPaymentTermType = input.supplierPaymentTermType;
  if (input.supplierCreditDays !== undefined) setData.supplierCreditDays = input.supplierCreditDays;
  if (input.supplierNote !== undefined) setData.supplierNote = input.supplierNote;
  if (input.supplierContactId !== undefined) setData.supplierContactId = input.supplierContactId;
  if (input.termsAndConditions !== undefined) setData.termsAndConditions = input.termsAndConditions;
  if (input.placeRemark !== undefined) setData.placeRemark = input.placeRemark;
  if (input.lossReason !== undefined) setData.lossReason = input.lossReason;
  if (input.brokerId !== undefined) setData.brokerId = input.brokerId;
  if (input.brokerContactId !== undefined) setData.brokerContactId = input.brokerContactId;
  if (input.brokerGetsAll !== undefined) setData.brokerGetsAll = input.brokerGetsAll;
  if (input.agentId !== undefined) setData.agentId = input.agentId;
  if (input.agentContactId !== undefined) setData.agentContactId = input.agentContactId;
  if (input.categoryKey !== undefined) setData.categoryKey = input.categoryKey;

  if (input.status === 'CANCELLED' || input.status === 'PAID') {
    setData.closedAt = new Date();
  }

  const [updated] = await db.update(orders).set(setData).where(eq(orders.id, id)).returning();

  if (updated) {
    await syncPrimaryOrderSupplierFromLegacy(updated);

    if (activityUserId) {
      const metadata = await buildOrderUpdateActivityMetadata(currentOrder as any, updated as any);
      if (metadata) {
        await logActivity({ userId: activityUserId, action: 'UPDATE', entityType: 'order', entityId: id, metadata });
      }
    }
  }

  return updated ?? null;
}

// ─── Delete Order ─────────────────────────────────────────────────

export async function deleteOrder(id: string) {
  const [deleted] = await db.delete(orders).where(eq(orders.id, id)).returning({ id: orders.id });
  return deleted ?? null;
}
