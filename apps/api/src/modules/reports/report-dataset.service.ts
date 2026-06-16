// ═══════════════════════════════════════════════════════════════════════
//  Report Dataset — fetch scoped order/item data for reports
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, gte, lte, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../../db';
import { orders, orderItems, users, teams, counterparties, vessels, tenants } from '../../db/schema';
import type { TenantSettings } from '../../db/schema';
import { getFinancingRateAnnual } from '../orders/order-financing';
import { normalizeReportSettings, normalizeReportFilters } from './report-utils.service';
import type { ReportFiltersDto } from '@fueld/types';
import type { ReportAccessContext, ScopedDataset, StoredReportSettings, ScopedOrderRow, ScopedItemRow } from './report.types';

export async function getTenantSettingsRow(tenantId: string) {
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { id: true, name: true, settings: true },
  });
  if (!tenant) throw new Error('Tenant not found');
  return tenant;
}

export async function updateTenantReportSettings(
  tenantId: string,
  updater: (current: StoredReportSettings) => StoredReportSettings,
): Promise<StoredReportSettings> {
  const tenant = await getTenantSettingsRow(tenantId);
  const currentSettings = (tenant.settings ?? {}) as TenantSettings;
  const nextReportSettings = updater(normalizeReportSettings(currentSettings.reportsSettings));
  const nextSettings: TenantSettings = { ...currentSettings, reportsSettings: nextReportSettings };

  await db.update(tenants).set({ settings: nextSettings as any, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
  return nextReportSettings;
}

export async function buildEconomicsByOrder(dataset: ScopedDataset) {
  const { calculateOrderEconomics } = await import('../orders/order-financing');
  const revenueEligibleStatuses = new Set(['OFFER', 'CONFIRMED', 'DELIVERED', 'INVOICED', 'PAID']);
  const orderEconomics = new Map<string, any>();

  for (const order of dataset.orderRows) {
    if (!revenueEligibleStatuses.has(order.status)) continue;
    const economics = calculateOrderEconomics(
      {
        customerPaymentTermType: order.customerPaymentTermType,
        customerCreditDays: order.customerCreditDays,
        supplierPaymentTermType: order.supplierPaymentTermType,
        supplierCreditDays: order.supplierCreditDays,
      },
      dataset.itemsByOrder.get(order.orderId) ?? [],
      dataset.financingRateAnnual,
    );
    orderEconomics.set(order.orderId, economics);
  }

  return orderEconomics;
}

export async function fetchScopedDataset(
  tenantId: string,
  context: ReportAccessContext,
  filters: ReportFiltersDto,
): Promise<ScopedDataset> {
  const { calculateOrderEconomics } = await import('../orders/order-financing');
  const filtersApplied = normalizeReportFilters(filters, context);
  const conditions = [eq(orders.tenantId, tenantId), isNotNull(orders.salesRepId)];
  if (filtersApplied.from) conditions.push(gte(orders.createdAt, new Date(`${filtersApplied.from}T00:00:00`)));
  if (filtersApplied.to) conditions.push(lte(orders.createdAt, new Date(`${filtersApplied.to}T23:59:59`)));
  if (context.userIds) conditions.push(inArray(orders.salesRepId, context.userIds));
  if (filtersApplied.traderId) conditions.push(eq(orders.salesRepId, filtersApplied.traderId));
  if (filtersApplied.customerId) conditions.push(eq(orders.clientId, filtersApplied.customerId));

  const orderRows = await db
    .select({
      orderId: orders.id,
      traderId: orders.salesRepId,
      traderName: users.name,
      traderEmail: users.email,
      teamId: users.primaryTeamId,
      teamName: teams.name,
      clientId: counterparties.id,
      clientName: counterparties.name,
      vesselId: vessels.id,
      vesselName: vessels.name,
      status: orders.status,
      createdAt: orders.createdAt,
      closedAt: orders.closedAt,
      customerPaymentTermType: orders.customerPaymentTermType,
      customerCreditDays: orders.customerCreditDays,
      supplierPaymentTermType: orders.supplierPaymentTermType,
      supplierCreditDays: orders.supplierCreditDays,
    })
    .from(orders)
    .innerJoin(users, eq(orders.salesRepId, users.id))
    .leftJoin(teams, eq(users.primaryTeamId, teams.id))
    .innerJoin(counterparties, eq(orders.clientId, counterparties.id))
    .innerJoin(vessels, eq(orders.vesselId, vessels.id))
    .where(and(...conditions));

  const teamFilteredOrderRows = filtersApplied.teamId
    ? orderRows.filter((row) => row.teamId === filtersApplied.teamId)
    : orderRows;

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { settings: true },
  });
  const financingRateAnnual = getFinancingRateAnnual((tenant?.settings ?? {}) as TenantSettings);

  if (teamFilteredOrderRows.length === 0) {
    return { filtersApplied, orderRows: [], itemRows: [], itemsByOrder: new Map(), financingRateAnnual };
  }

  const itemRows = await db
    .select({
      orderId: orderItems.orderId,
      productType: orderItems.productType,
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
    .where(
      and(
        inArray(orderItems.orderId, teamFilteredOrderRows.map((row) => row.orderId)),
        ...(filtersApplied.productType ? [eq(orderItems.productType, filtersApplied.productType as any)] : []),
      ),
    );

  const itemsByOrder = new Map<string, ScopedItemRow[]>();
  for (const item of itemRows) {
    const current = itemsByOrder.get(item.orderId) ?? [];
    current.push(item as ScopedItemRow);
    itemsByOrder.set(item.orderId, current);
  }

  const filteredOrderRows = filtersApplied.productType
    ? teamFilteredOrderRows.filter((row) => itemsByOrder.has(row.orderId))
    : teamFilteredOrderRows;

  return {
    filtersApplied,
    orderRows: filteredOrderRows as ScopedOrderRow[],
    itemRows: itemRows as ScopedItemRow[],
    itemsByOrder,
    financingRateAnnual,
  };
}
