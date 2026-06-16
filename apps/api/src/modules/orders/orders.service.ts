// ═══════════════════════════════════════════════════════════════════════
//  Orders Service — CRUD for orders (inquiries + confirmed orders)
//
//  An "inquiry" is simply an order with status INQUIRY or OFFER.
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, desc, asc, sql, ilike, inArray, or, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../../db';
import {
  orders,
  orderSuppliers,
  orderItems,
  orderAttachments,
  counterparties,
  bankAccounts,
  vessels,
  places,
  users,
  orderNumberSequences,
  tenants,
  customerPayments,
  invoices,
  companyContacts,
  priceReferences,
  creditLines,
  creditLineCounterparties,
} from '../../db/schema';
import type { Order, TenantSettings } from '../../db/schema';
import { logActivity } from '../activity/activity.service';
import { sendTemplatedGroupMessage } from '../whatsapp/whatsapp.service';
import {
  calculateGrossProfitBase,
  calculateOrderEconomics,
  getFinancingRateAnnual,
} from './order-financing';
import { getFxRate } from '../prices/price.service';

// ─── Types ──────────────────────────────────────────────────────────

interface ListOrdersQuery {
  search?: string;
  statuses?: string[];     // filter by status(es), e.g. ['INQUIRY','OFFER'] for inquiries
  salesRepId?: string;
  brokerId?: string;       // filter by broker company
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

interface CreateOrderInput {
  tenantId: string;
  clientId: string;
  vesselId: string;
  placeId: string;
  salesRepId?: string | null;
  invoicingCompanyId?: string | null;
  bankAccountId?: string | null;
  currency?: string;
  eta?: string | null;
  etd?: string | null;
  customerPaymentTermType?: 'CREDIT' | 'COD' | 'PREPAY' | null;
  customerCreditDays?: number | null;
  customerNote?: string | null;
  purchaseOrderNumber?: string | null;
  customerContactId?: string | null;
  supplierId?: string | null;
  supplierPaymentTermType?: 'CREDIT' | 'COD' | 'PREPAY' | null;
  supplierCreditDays?: number | null;
  supplierNote?: string | null;
  supplierContactId?: string | null;
  termsAndConditions?: string | null;
  placeRemark?: string | null;
  brokerId?: string | null;
  brokerContactId?: string | null;
  brokerGetsAll?: boolean;
  agentId?: string | null;
  agentContactId?: string | null;
  categoryKey?: string | null;
}

interface UpdateOrderInput {
  clientId?: string;
  vesselId?: string;
  placeId?: string;
  salesRepId?: string | null;
  invoicingCompanyId?: string | null;
  bankAccountId?: string | null;
  currency?: string;
  status?: string;
  eta?: string | null;
  etd?: string | null;
  deliveredAt?: string | null;
  customerPaymentTermType?: 'CREDIT' | 'COD' | 'PREPAY' | null;
  customerCreditDays?: number | null;
  customerNote?: string | null;
  purchaseOrderNumber?: string | null;
  customerContactId?: string | null;
  supplierId?: string | null;
  supplierPaymentTermType?: 'CREDIT' | 'COD' | 'PREPAY' | null;
  supplierCreditDays?: number | null;
  supplierNote?: string | null;
  supplierContactId?: string | null;
  termsAndConditions?: string | null;
  placeRemark?: string | null;
  lossReason?: string | null;
  brokerId?: string | null;
  brokerContactId?: string | null;
  brokerGetsAll?: boolean;
  agentId?: string | null;
  agentContactId?: string | null;
  categoryKey?: string | null;
}

interface SaveItemInput {
  id?: string;
  orderSupplierId?: string | null;
  productType: string;
  quantity: string;
  quantityMin?: string | null;
  quantityMax?: string | null;
  unit?: string;
  costUnit?: string;
  salesUnit?: string;
  costConversionFactor?: string | null;
  unitConversionFactor?: string | null;
  description?: string | null;
  costPrice?: string | null;
  costCurrency?: string | null;
  salesPrice?: string | null;
  salesCurrency?: string | null;
  paymentTerms?: string | null;
  customerNote?: string | null;
  deliveredQuantity?: string | null;
  // Formula pricing (cost side)
  costPricingModel?: string | null;
  costReferenceId?: string | null;
  costPlattsEntryId?: string | null;
  costPremium?: string | null;
  costBarging?: string | null;
  costBargingUnit?: string | null;
  costCreditDays?: number | null;
  costPriceFinalized?: boolean | null;
  // Formula pricing (sell side)
  salesPricingModel?: string | null;
  salesReferenceId?: string | null;
  salesPlattsEntryId?: string | null;
  salesPremium?: string | null;
  salesBarging?: string | null;
  salesBargingUnit?: string | null;
  salesCreditDays?: number | null;
  salesPriceFinalized?: boolean | null;
  // Tax
  taxRate?: string | null;
  // Inventory linkage (optional)
  inventorySkuId?: string | null;
  warehouseId?: string | null;
  plannedInventoryAt?: string | null;
}

interface FinalizeItemPriceInput {
  side: 'cost' | 'sales';
  finalPrice: string;
}

async function getTenantFinancingRateByIds(tenantIds: string[]): Promise<Map<string, number>> {
  if (!tenantIds.length) return new Map();

  const rows = await db
    .select({ id: tenants.id, settings: tenants.settings })
    .from(tenants)
    .where(inArray(tenants.id, tenantIds));

  return new Map(
    rows.map((row) => [row.id, getFinancingRateAnnual((row.settings ?? {}) as TenantSettings)]),
  );
}

function isMissingCompanyRegistrationNumberColumnError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('company_registration_number');
}

const counterpartyLegacySelect = {
  id: counterparties.id,
  tenantId: counterparties.tenantId,
  name: counterparties.name,
  type: counterparties.type,
  types: counterparties.types,
  creditLimit: counterparties.creditLimit,
  creditUsed: counterparties.creditUsed,
  country: counterparties.country,
  isOwnCompany: counterparties.isOwnCompany,
  seasearcherId: counterparties.seasearcherId,
  companyImo: counterparties.companyImo,
  countryIso: counterparties.countryIso,
  yearFormed: counterparties.yearFormed,
  companyRoles: counterparties.companyRoles,
  fleetSize: counterparties.fleetSize,
  headOfficeAddress: counterparties.headOfficeAddress,
  headOfficePhone: counterparties.headOfficePhone,
  headOfficeEmail: counterparties.headOfficeEmail,
  website: counterparties.website,
  isSanctioned: counterparties.isSanctioned,
  lastSynced: counterparties.lastSynced,
  manualOverrides: counterparties.manualOverrides,
  responsibleUserId: counterparties.responsibleUserId,
  logoUrl: counterparties.logoUrl,
  brandColor: counterparties.brandColor,
  vatNumber: counterparties.vatNumber,
  fraudPreventionText: counterparties.fraudPreventionText,
  customerTerms: counterparties.customerTerms,
  supplierTerms: counterparties.supplierTerms,
  specialCustomerTerms: counterparties.specialCustomerTerms,
  latePaymentInterest: counterparties.latePaymentInterest,
  createdAt: counterparties.createdAt,
  updatedAt: counterparties.updatedAt,
};

async function getCounterpartyById(counterpartyId: string | null | undefined) {
  if (!counterpartyId) return null;

  try {
    const [row] = await db
      .select()
      .from(counterparties)
      .where(eq(counterparties.id, counterpartyId))
      .limit(1);
    return row ?? null;
  } catch (err) {
    if (!isMissingCompanyRegistrationNumberColumnError(err)) throw err;

    const [legacyRow] = await db
      .select(counterpartyLegacySelect)
      .from(counterparties)
      .where(eq(counterparties.id, counterpartyId))
      .limit(1);

    return legacyRow ? { ...legacyRow, companyRegistrationNumber: null } : null;
  }
}

async function getCompanyContactById(contactId: string | null | undefined) {
  if (!contactId) return null;

  const [row] = await db
    .select()
    .from(companyContacts)
    .where(eq(companyContacts.id, contactId))
    .limit(1);

  return row
    ? { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
    : null;
}

async function getPreferredOwnCompanyId(
  tenantId: string,
  requestedCompanyId?: string | null,
  supplierId?: string | null,
): Promise<string | null> {
  const normalizedCompanyId = requestedCompanyId?.trim() ?? '';
  if (normalizedCompanyId) {
    const [requestedCompany] = await db
      .select({ id: counterparties.id })
      .from(counterparties)
      .where(and(
        eq(counterparties.id, normalizedCompanyId),
        eq(counterparties.tenantId, tenantId),
        eq(counterparties.isOwnCompany, true),
      ))
      .limit(1);

    if (requestedCompany?.id) return requestedCompany.id;
  }

  // If a supplier is specified and has a preferred invoicing company, use that
  const normalizedSupplierId = supplierId?.trim() ?? '';
  if (normalizedSupplierId) {
    const [supplier] = await db
      .select({ preferredInvoicingCompanyId: counterparties.preferredInvoicingCompanyId })
      .from(counterparties)
      .where(and(
        eq(counterparties.id, normalizedSupplierId),
        eq(counterparties.tenantId, tenantId),
      ))
      .limit(1);

    if (supplier?.preferredInvoicingCompanyId) {
      const [preferredCompany] = await db
        .select({ id: counterparties.id })
        .from(counterparties)
        .where(and(
          eq(counterparties.id, supplier.preferredInvoicingCompanyId),
          eq(counterparties.tenantId, tenantId),
          eq(counterparties.isOwnCompany, true),
        ))
        .limit(1);

      if (preferredCompany?.id) return preferredCompany.id;
    }
  }

  const [fallbackCompany] = await db
    .select({ id: counterparties.id })
    .from(counterparties)
    .where(and(eq(counterparties.tenantId, tenantId), eq(counterparties.isOwnCompany, true)))
    .orderBy(asc(counterparties.name), asc(counterparties.id))
    .limit(1);

  return fallbackCompany?.id ?? null;
}

async function getPreferredBankAccountId(
  invoicingCompanyId: string | null,
  currency: string | null | undefined,
  requestedBankAccountId?: string | null,
): Promise<string | null> {
  if (!invoicingCompanyId) return null;

  const normalizedBankAccountId = requestedBankAccountId?.trim() ?? '';
  if (normalizedBankAccountId) {
    const [requestedBankAccount] = await db
      .select({ id: bankAccounts.id })
      .from(bankAccounts)
      .where(and(
        eq(bankAccounts.id, normalizedBankAccountId),
        eq(bankAccounts.counterpartyId, invoicingCompanyId),
      ))
      .limit(1);

    if (requestedBankAccount?.id) return requestedBankAccount.id;
  }

  const normalizedCurrency = (currency ?? '').trim().toUpperCase();
  const companyBankAccounts = await db
    .select({ id: bankAccounts.id, currency: bankAccounts.currency, isDefault: bankAccounts.isDefault })
    .from(bankAccounts)
    .where(eq(bankAccounts.counterpartyId, invoicingCompanyId))
    .orderBy(desc(bankAccounts.isDefault), asc(bankAccounts.label), asc(bankAccounts.id));

  if (companyBankAccounts.length === 0) return null;

  if (normalizedCurrency) {
    const currencyMatches = companyBankAccounts.filter((account) => (account.currency ?? '').trim().toUpperCase() === normalizedCurrency);
    if (currencyMatches.length > 0) {
      return currencyMatches.find((account) => account.isDefault)?.id ?? currencyMatches[0]?.id ?? null;
    }
  }

  return companyBankAccounts.find((account) => account.isDefault)?.id ?? companyBankAccounts[0]?.id ?? null;
}

type OrderActivityValueResolver =
  | 'counterparty'
  | 'contact'
  | 'vessel'
  | 'place'
  | 'user'
  | 'bankAccount';

interface OrderActivityChange {
  field: string;
  from: string | number | boolean | null;
  to: string | number | boolean | null;
}

interface OrderUpdateActivityMetadata {
  action: 'update_order_fields';
  changes: OrderActivityChange[];
}

const ORDER_UPDATE_ACTIVITY_FIELDS: Array<{
  key: keyof Order;
  resolver?: OrderActivityValueResolver;
}> = [
  { key: 'clientId', resolver: 'counterparty' },
  { key: 'vesselId', resolver: 'vessel' },
  { key: 'placeId', resolver: 'place' },
  { key: 'salesRepId', resolver: 'user' },
  { key: 'status' },
  { key: 'invoicingCompanyId', resolver: 'counterparty' },
  { key: 'bankAccountId', resolver: 'bankAccount' },
  { key: 'currency' },
  { key: 'eta' },
  { key: 'etd' },
  { key: 'customerPaymentTermType' },
  { key: 'customerCreditDays' },
  { key: 'customerNote' },
  { key: 'customerContactId', resolver: 'contact' },
  { key: 'supplierId', resolver: 'counterparty' },
  { key: 'supplierPaymentTermType' },
  { key: 'supplierCreditDays' },
  { key: 'supplierNote' },
  { key: 'supplierContactId', resolver: 'contact' },
  { key: 'brokerId', resolver: 'counterparty' },
  { key: 'brokerContactId', resolver: 'contact' },
  { key: 'brokerGetsAll' },
  { key: 'agentId', resolver: 'counterparty' },
  { key: 'agentContactId', resolver: 'contact' },
  { key: 'termsAndConditions' },
  { key: 'placeRemark' },
  { key: 'lossReason' },
  { key: 'deliveredAt' },
];

function normalizeOrderActivityValue(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
}

function areOrderActivityValuesEqual(left: unknown, right: unknown): boolean {
  return normalizeOrderActivityValue(left) === normalizeOrderActivityValue(right);
}

async function resolveOrderActivityValue(
  resolver: OrderActivityValueResolver | undefined,
  value: unknown,
): Promise<string | number | boolean | null> {
  const normalized = normalizeOrderActivityValue(value);
  if (normalized == null || !resolver) return normalized;

  switch (resolver) {
    case 'counterparty':
      return (await getCounterpartyById(String(normalized)))?.name ?? String(normalized);
    case 'contact':
      return (await getCompanyContactById(String(normalized)))?.name ?? String(normalized);
    case 'vessel': {
      const [row] = await db
        .select({ name: vessels.name })
        .from(vessels)
        .where(eq(vessels.id, String(normalized)))
        .limit(1);
      return row?.name ?? String(normalized);
    }
    case 'place': {
      const [row] = await db
        .select({ name: places.name })
        .from(places)
        .where(eq(places.id, String(normalized)))
        .limit(1);
      return row?.name ?? String(normalized);
    }
    case 'user': {
      const [row] = await db
        .select({ name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, String(normalized)))
        .limit(1);
      return row?.name ?? row?.email ?? String(normalized);
    }
    case 'bankAccount': {
      const [row] = await db
        .select({ label: bankAccounts.label, currency: bankAccounts.currency })
        .from(bankAccounts)
        .where(eq(bankAccounts.id, String(normalized)))
        .limit(1);
      if (!row) return String(normalized);
      return row.currency ? `${row.label} (${row.currency})` : row.label;
    }
    default:
      return normalized;
  }
}

async function buildOrderUpdateActivityMetadata(
  previousOrder: Order,
  nextOrder: Order,
): Promise<OrderUpdateActivityMetadata | null> {
  const changes: OrderActivityChange[] = [];

  for (const field of ORDER_UPDATE_ACTIVITY_FIELDS) {
    const previousValue = previousOrder[field.key];
    const nextValue = nextOrder[field.key];
    if (areOrderActivityValuesEqual(previousValue, nextValue)) continue;

    changes.push({
      field: String(field.key),
      from: await resolveOrderActivityValue(field.resolver, previousValue),
      to: await resolveOrderActivityValue(field.resolver, nextValue),
    });
  }

  return changes.length > 0
    ? {
        action: 'update_order_fields',
        changes,
      }
    : null;
}

function normalizeOptionalTimestamp(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function listOrderSuppliers(orderId: string) {
  const rows = await db
    .select()
    .from(orderSuppliers)
    .where(eq(orderSuppliers.orderId, orderId))
    .orderBy(asc(orderSuppliers.sortOrder), asc(orderSuppliers.createdAt));

  return Promise.all(rows.map(async (row) => ({
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
  })));
}

function deriveOrderDeliveredAtIso(
  orderDeliveredAt: Date | null,
  suppliers: Array<{ deliveredAt: string | null }>,
): string | null {
  const candidateMs = [
    orderDeliveredAt?.getTime() ?? 0,
    ...suppliers
      .map((supplier) => supplier.deliveredAt ? Date.parse(supplier.deliveredAt) : 0)
      .filter((value) => Number.isFinite(value) && value > 0),
  ];

  const latestMs = Math.max(...candidateMs);
  return latestMs > 0 ? new Date(latestMs).toISOString() : null;
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
    .where(and(eq(orderSuppliers.orderId, order.id), eq(orderSuppliers.isPrimary, true)))
    .orderBy(asc(orderSuppliers.sortOrder), asc(orderSuppliers.createdAt))
    .limit(1);

  if (!order.supplierId) {
    if (primarySupplier) {
      await db
        .update(orderItems)
        .set({ orderSupplierId: null, updatedAt: new Date() })
        .where(eq(orderItems.orderSupplierId, primarySupplier.id));

      await db.delete(orderSuppliers).where(eq(orderSuppliers.id, primarySupplier.id));
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

async function syncLegacyOrderFieldsFromPrimary(orderId: string) {
  const suppliers = await db
    .select()
    .from(orderSuppliers)
    .where(eq(orderSuppliers.orderId, orderId))
    .orderBy(desc(orderSuppliers.isPrimary), asc(orderSuppliers.sortOrder), asc(orderSuppliers.createdAt));

  const primary = suppliers.find((supplier) => supplier.isPrimary) ?? suppliers[0] ?? null;
  const deliveredAtValues = suppliers
    .map((supplier) => supplier.deliveredAt?.getTime() ?? 0)
    .filter((value) => value > 0);
  const latestDeliveredAt = deliveredAtValues.length > 0 ? new Date(Math.max(...deliveredAtValues)) : null;

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

async function normalizePrimarySupplier(orderId: string, primarySupplierId?: string | null) {
  const suppliers = await db
    .select({ id: orderSuppliers.id, isPrimary: orderSuppliers.isPrimary })
    .from(orderSuppliers)
    .where(eq(orderSuppliers.orderId, orderId))
    .orderBy(asc(orderSuppliers.sortOrder), asc(orderSuppliers.createdAt));

  if (!suppliers.length) {
    await syncLegacyOrderFieldsFromPrimary(orderId);
    return;
  }

  const targetId = primarySupplierId ?? suppliers.find((supplier) => supplier.isPrimary)?.id ?? suppliers[0]!.id;

  await db
    .update(orderSuppliers)
    .set({
      isPrimary: false,
      updatedAt: new Date(),
    })
    .where(and(eq(orderSuppliers.orderId, orderId), eq(orderSuppliers.isPrimary, true)));

  await db
    .update(orderSuppliers)
    .set({
      isPrimary: true,
      updatedAt: new Date(),
    })
    .where(eq(orderSuppliers.id, targetId));

  await syncLegacyOrderFieldsFromPrimary(orderId);
}

async function ensureUniqueOrderSupplierCompany(orderId: string, companyId: string, excludeSupplierRecordId?: string) {
  const existing = await db
    .select({ id: orderSuppliers.id })
    .from(orderSuppliers)
    .where(and(eq(orderSuppliers.orderId, orderId), eq(orderSuppliers.companyId, companyId)));

  if (existing.some((supplier) => supplier.id !== excludeSupplierRecordId)) {
    throw new Error('This supplier is already added to the order');
  }
}

export async function addOrderSupplier(orderId: string, input: {
  companyId: string;
  contactId?: string | null;
  paymentTermType?: 'CREDIT' | 'COD' | 'PREPAY' | null;
  creditDays?: number | null;
  note?: string | null;
  deliveredAt?: string | null;
  isPrimary?: boolean;
}) {
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

  await normalizePrimarySupplier(orderId, created.isPrimary ? created.id : null);
  return (await listOrderSuppliers(orderId)).find((supplier) => supplier.id === created.id) ?? null;
}

export async function updateOrderSupplierRecord(orderId: string, supplierRecordId: string, input: {
  companyId?: string;
  contactId?: string | null;
  paymentTermType?: 'CREDIT' | 'COD' | 'PREPAY' | null;
  creditDays?: number | null;
  note?: string | null;
  deliveredAt?: string | null;
  sortOrder?: number;
  isPrimary?: boolean;
}) {
  const [existing] = await db
    .select()
    .from(orderSuppliers)
    .where(and(eq(orderSuppliers.id, supplierRecordId), eq(orderSuppliers.orderId, orderId)))
    .limit(1);

  if (!existing) return null;

  if (input.companyId !== undefined) {
    await ensureUniqueOrderSupplierCompany(orderId, input.companyId, supplierRecordId);
  }

  const setData: Record<string, unknown> = { updatedAt: new Date() };
  if (input.companyId !== undefined) setData.companyId = input.companyId;
  if (input.contactId !== undefined) setData.contactId = input.contactId;
  if (input.paymentTermType !== undefined) setData.paymentTermType = input.paymentTermType;
  if (input.creditDays !== undefined) setData.creditDays = input.creditDays;
  if (input.note !== undefined) setData.note = input.note;
  if (input.deliveredAt !== undefined) setData.deliveredAt = normalizeOptionalTimestamp(input.deliveredAt);
  if (input.sortOrder !== undefined) setData.sortOrder = input.sortOrder;
  if (input.isPrimary !== undefined) setData.isPrimary = input.isPrimary;

  await db
    .update(orderSuppliers)
    .set(setData)
    .where(eq(orderSuppliers.id, supplierRecordId));

  await normalizePrimarySupplier(orderId, input.isPrimary ? supplierRecordId : null);
  return (await listOrderSuppliers(orderId)).find((supplier) => supplier.id === supplierRecordId) ?? null;
}

export async function deleteOrderSupplierRecord(orderId: string, supplierRecordId: string) {
  const [usage] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(orderItems)
    .where(and(eq(orderItems.orderId, orderId), eq(orderItems.orderSupplierId, supplierRecordId)));

  if ((usage?.count ?? 0) > 0) {
    throw new Error('Reassign line items before removing this supplier');
  }

  const [deleted] = await db
    .delete(orderSuppliers)
    .where(and(eq(orderSuppliers.id, supplierRecordId), eq(orderSuppliers.orderId, orderId)))
    .returning({ id: orderSuppliers.id, isPrimary: orderSuppliers.isPrimary });

  if (!deleted) return null;

  await normalizePrimarySupplier(orderId, null);
  return deleted;
}

export async function getOrderSuppliers(orderId: string) {
  return listOrderSuppliers(orderId);
}

function normalizeOrderNumberTemplate(template: string): string {
  const trimmed = template.trim();
  if (!trimmed) return '{YYYY}{MM}{DD}-{SEQ:6}';

  const hasSeqToken = /\{SEQ(?::\d+)?\}/.test(trimmed);
  if (hasSeqToken) return trimmed;

  return `${trimmed}-{SEQ:6}`;
}

// ─── Generate next order number ───────────────────────────────────────

async function generateOrderNumber(tenantId: string): Promise<string> {
  // Atomically increment the sequence counter
  const [seq] = await db
    .insert(orderNumberSequences)
    .values({ tenantId, lastSeq: 1 })
    .onConflictDoUpdate({
      target: orderNumberSequences.tenantId,
      set: {
        lastSeq: sql`${orderNumberSequences.lastSeq} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning({ lastSeq: orderNumberSequences.lastSeq });

  const seqNum = seq.lastSeq;

  // Fetch tenant settings for template customisation
  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  });
  const settings = (tenant?.settings ?? {}) as TenantSettings;
  const prefix = settings.orderNumberPrefix ?? '';
  const template = normalizeOrderNumberTemplate(
    settings.orderNumberTemplate ?? '{YYYY}{MM}{DD}-{SEQ:6}',
  );

  // Use UTC/GMT date
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');

  // Replace template tokens
  let result = template
    .replace('{PREFIX}', prefix)
    .replace('{YYYY}', yyyy)
    .replace('{MM}', mm)
    .replace('{DD}', dd);

  // Replace {SEQ:N} with zero-padded sequence
  result = result.replace(/\{SEQ:(\d+)\}/g, (_match, digits) => {
    return String(seqNum).padStart(parseInt(digits, 10), '0');
  });

  // Fallback: replace {SEQ} without padding spec → pad to 6
  result = result.replace('{SEQ}', String(seqNum).padStart(6, '0'));

  return result;
}
// ─── List Orders (paginated, filterable) ────────────────────────────

export async function listOrders(query?: ListOrdersQuery) {
  const conditions = [];

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
    // Search by client name, vessel name, port name, or order number
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
    ? conditions.length === 1
      ? conditions[0]
      : and(...conditions)
    : undefined;

  const limit = query?.limit ?? 25;
  const page = query?.page ?? 1;
  const offset = (page - 1) * limit;

  const invoicingCompany = alias(counterparties, 'invoicing_company');

  // Sortable columns
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

  // For each row, compute total value & profit from order items
  const orderIds = rows.map((r) => r.id);
  let itemAggs: Record<string, {
    totalValue: number;
    totalProfit: number;
    totalFinancingCost: number;
    totalNetProfit: number;
    netMarginPct: number | null;
    displayCurrency: string;
  }> = {};

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
      getTenantFinancingRateByIds(Array.from(new Set(rows.map((row) => row.tenantId)))),
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

      // Determine display currency: uniform across all items → that currency, else USD
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

      // When display currency is not USD, convert totals from USD to that currency
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

// ─── Resolve order ID (UUID or order number → UUID) ────────────────

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

// ─── Get Order By ID or Order Number (with all relations + items) ──────

export async function getOrderById(idOrNumber: string) {
  // Try UUID first, otherwise look up by order number
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrNumber);
  const condition = isUuid
    ? eq(orders.id, idOrNumber)
    : eq(orders.orderNumber, idOrNumber);

  const [row] = await db
    .select()
    .from(orders)
    .where(condition)
    .limit(1);

  if (!row) return null;

  // Fetch relations in parallel
  const [client, supplier, vessel, place, salesRep, invoicingCompany, items, customerContact, supplierContact, broker, brokerContact, agent, agentContact, tenant, orderSupplierRows] =
    await Promise.all([
      getCounterpartyById(row.clientId),
      getCounterpartyById(row.supplierId),
      db
        .select()
        .from(vessels)
        .where(eq(vessels.id, row.vesselId))
        .limit(1)
        .then((r) => r[0] ?? null),
      db
        .select()
        .from(places)
        .where(eq(places.id, row.placeId))
        .limit(1)
        .then((r) => r[0] ?? null),
      row.salesRepId
        ? db
            .select({ id: users.id, name: users.name, email: users.email })
            .from(users)
            .where(eq(users.id, row.salesRepId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
      row.invoicingCompanyId
        ? getCounterpartyById(row.invoicingCompanyId)
        : Promise.resolve(null),
      db.select().from(orderItems).where(eq(orderItems.orderId, row.id)),
      row.customerContactId
        ? db
            .select()
            .from(companyContacts)
            .where(eq(companyContacts.id, row.customerContactId))
            .limit(1)
            .then((r) => r[0] ? { ...r[0], createdAt: r[0].createdAt.toISOString(), updatedAt: r[0].updatedAt.toISOString() } : null)
        : Promise.resolve(null),
      row.supplierContactId
        ? db
            .select()
            .from(companyContacts)
            .where(eq(companyContacts.id, row.supplierContactId))
            .limit(1)
            .then((r) => r[0] ? { ...r[0], createdAt: r[0].createdAt.toISOString(), updatedAt: r[0].updatedAt.toISOString() } : null)
        : Promise.resolve(null),
      row.brokerId
        ? getCounterpartyById(row.brokerId)
        : Promise.resolve(null),
      row.brokerContactId
        ? db
            .select()
            .from(companyContacts)
            .where(eq(companyContacts.id, row.brokerContactId))
            .limit(1)
            .then((r) => r[0] ? { ...r[0], createdAt: r[0].createdAt.toISOString(), updatedAt: r[0].updatedAt.toISOString() } : null)
        : Promise.resolve(null),
      row.agentId
        ? getCounterpartyById(row.agentId)
        : Promise.resolve(null),
      row.agentContactId
        ? db
            .select()
            .from(companyContacts)
            .where(eq(companyContacts.id, row.agentContactId))
            .limit(1)
            .then((r) => r[0] ? { ...r[0], createdAt: r[0].createdAt.toISOString(), updatedAt: r[0].updatedAt.toISOString() } : null)
        : Promise.resolve(null),
      db.query.tenants.findFirst({
        where: eq(tenants.id, row.tenantId),
        columns: { settings: true },
      }),
      listOrderSuppliers(row.id),
    ]);

  const financingRateAnnual = getFinancingRateAnnual((tenant?.settings ?? {}) as TenantSettings);
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

  // Resolve price reference names for formula-priced items
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
    client,
    supplier,
    vessel,
    place,
    salesRep,
    invoicingCompany,
    customerContact,
    supplierContact,
    broker,
    brokerContact,
    agent,
    agentContact,
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
      financingCost: orderEconomics.lineEconomics[index] ? orderEconomics.lineEconomics[index]!.financingCost.toFixed(4) : null,
      netProfit: orderEconomics.lineEconomics[index] ? orderEconomics.lineEconomics[index]!.netProfit.toFixed(4) : null,
      paymentTerms: i.paymentTerms,
      customerNote: i.customerNote,
      deliveredQuantity: i.deliveredQuantity,
      // Formula pricing (cost side)
      costPricingModel: i.costPricingModel ?? 'FIXED',
      costReferenceId: i.costReferenceId ?? null,
      costPlattsEntryId: i.costPlattsEntryId ?? null,
      costReferenceName: i.costReferenceId ? (refNameMap.get(i.costReferenceId) ?? null) : null,
      costPremium: i.costPremium ?? null,
      costBarging: i.costBarging ?? null,
      costBargingUnit: i.costBargingUnit ?? null,
      costCreditDays: i.costCreditDays ?? null,
      costPriceFinalized: i.costPriceFinalized ?? false,
      // Formula pricing (sell side)
      salesPricingModel: i.salesPricingModel ?? 'FIXED',
      salesReferenceId: i.salesReferenceId ?? null,
      salesPlattsEntryId: i.salesPlattsEntryId ?? null,
      salesReferenceName: i.salesReferenceId ? (refNameMap.get(i.salesReferenceId) ?? null) : null,
      salesPremium: i.salesPremium ?? null,
      salesBarging: i.salesBarging ?? null,
      salesBargingUnit: i.salesBargingUnit ?? null,
      salesCreditDays: i.salesCreditDays ?? null,
      salesPriceFinalized: i.salesPriceFinalized ?? false,
      // Inventory linkage (read-side; the order-detail UI uses these to render
      // pickers and run the availability check while editing).
      inventorySkuId: i.inventorySkuId ?? null,
      warehouseId: i.warehouseId ?? null,
      plannedInventoryAt: i.plannedInventoryAt ? i.plannedInventoryAt.toISOString() : null,
    })),
  };
}

// ─── Create Order ───────────────────────────────────────────────────

export async function createOrder(input: CreateOrderInput) {
  // Generate the external order number
  const orderNumber = await generateOrderNumber(input.tenantId);
  const currency = input.currency ?? 'USD';
  const invoicingCompanyId = await getPreferredOwnCompanyId(input.tenantId, input.invoicingCompanyId ?? null, input.supplierId ?? null);
  const bankAccountId = await getPreferredBankAccountId(invoicingCompanyId, currency, input.bankAccountId ?? null);

  // Seed placeRemark from the place's default if not explicitly provided
  let placeRemark = input.placeRemark ?? null;
  if (placeRemark === null) {
    const [placeRow] = await db
      .select({ orderRemark: places.orderRemark })
      .from(places)
      .where(eq(places.id, input.placeId))
      .limit(1);
    placeRemark = placeRow?.orderRemark ?? null;
  }

  // Auto-default payment terms to CREDIT if client has active credit lines
  let customerPaymentTermType = input.customerPaymentTermType ?? null;
  let customerCreditDays = input.customerCreditDays ?? null;
  if (customerPaymentTermType === null) {
    const creditLineRows = await db
      .select({ periodDays: creditLines.periodDays })
      .from(creditLines)
      .innerJoin(
        creditLineCounterparties,
        eq(creditLineCounterparties.creditLineId, creditLines.id),
      )
      .where(
        and(
          eq(creditLines.type, 'CUSTOMER'),
          eq(creditLineCounterparties.counterpartyId, input.clientId),
        ),
      );
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

  const [created] = await db
    .insert(orders)
    .values(values)
    .returning();

  await syncPrimaryOrderSupplierFromLegacy(created);

  return created;
}

// ─── Update Order ───────────────────────────────────────────────────

export async function updateOrder(id: string, input: UpdateOrderInput, activityUserId?: string | null) {
  const setData: Record<string, unknown> = { updatedAt: new Date() };

  const [currentOrder] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);

  if (!currentOrder) return null;

  const nextCurrency = input.currency ?? currentOrder.currency;
  const requestedInvoicingCompanyId = input.invoicingCompanyId !== undefined
    ? input.invoicingCompanyId
    : currentOrder.invoicingCompanyId;
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
  if (input.customerPaymentTermType !== undefined) {
    setData.customerPaymentTermType = input.customerPaymentTermType;
  }
  if (input.customerCreditDays !== undefined) {
    setData.customerCreditDays = input.customerCreditDays;
  }
  if (input.customerNote !== undefined) setData.customerNote = input.customerNote;
  if (input.purchaseOrderNumber !== undefined) setData.purchaseOrderNumber = input.purchaseOrderNumber;
  if (input.customerContactId !== undefined) setData.customerContactId = input.customerContactId;
  if (input.supplierId !== undefined) setData.supplierId = input.supplierId;
  if (input.supplierPaymentTermType !== undefined) {
    setData.supplierPaymentTermType = input.supplierPaymentTermType;
  }
  if (input.supplierCreditDays !== undefined) {
    setData.supplierCreditDays = input.supplierCreditDays;
  }
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

  // Auto-set closedAt when status moves to CANCELLED or PAID
  if (input.status === 'CANCELLED' || input.status === 'PAID') {
    setData.closedAt = new Date();
  }

  const [updated] = await db
    .update(orders)
    .set(setData)
    .where(eq(orders.id, id))
    .returning();

  if (updated) {
    await syncPrimaryOrderSupplierFromLegacy(updated);

    if (activityUserId) {
      const metadata = await buildOrderUpdateActivityMetadata(currentOrder, updated);
      if (metadata) {
        await logActivity({
          userId: activityUserId,
          action: 'UPDATE',
          entityType: 'order',
          entityId: id,
          metadata,
        });
      }
    }
  }

  return updated ?? null;
}

// ─── Delete Order ───────────────────────────────────────────────────

export async function deleteOrder(id: string) {
  // orderItems are cascade-deleted (ON DELETE CASCADE)
  const [deleted] = await db
    .delete(orders)
    .where(eq(orders.id, id))
    .returning({ id: orders.id });

  return deleted ?? null;
}

// ─── Save Order Items (upsert strategy) ─────────────────────────────
// Replaces all items for an order: delete existing, insert new batch.

export async function saveOrderItems(orderId: string, items: SaveItemInput[]) {
  // Look up order currency for defaults
  const [orderRow] = await db
    .select({ currency: orders.currency })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  const orderCurrency = orderRow?.currency ?? 'USD';
  const supplierRows = await db
    .select({ id: orderSuppliers.id })
    .from(orderSuppliers)
    .where(eq(orderSuppliers.orderId, orderId));
  const supplierIds = new Set(supplierRows.map((row) => row.id));
  const defaultOrderSupplierId = supplierRows.length === 1 ? supplierRows[0]!.id : null;

  // Insert new items with profit calculation (base currency)
  const values = items.map((item) => {
    const orderSupplierId = item.orderSupplierId ?? defaultOrderSupplierId;
    if (orderSupplierId && !supplierIds.has(orderSupplierId)) {
      throw new Error('Order item supplier must belong to the same order');
    }
    if (!orderSupplierId && supplierRows.length > 1) {
      throw new Error('Each order item must specify a supplier when an order has multiple suppliers');
    }

    const costCurrency = (item.costCurrency ?? orderCurrency).toUpperCase();
    const salesCurrency = (item.salesCurrency ?? orderCurrency).toUpperCase();
    const profit = calculateGrossProfitBase({
      quantity: item.quantity,
      costPrice: item.costPrice,
      costCurrency,
      costConversionFactor: item.costConversionFactor,
      salesPrice: item.salesPrice,
      salesCurrency,
      unitConversionFactor: item.unitConversionFactor,
    });

    // Compute tax amount if taxRate is provided
    let taxAmount: string | null = null;
    if (item.taxRate != null && item.salesPrice != null) {
      const rate = parseFloat(item.taxRate);
      const price = parseFloat(item.salesPrice);
      const qty = parseFloat(item.quantity);
      if (Number.isFinite(rate) && Number.isFinite(price) && Number.isFinite(qty)) {
        taxAmount = (price * qty * rate).toFixed(2);
      }
    }

    return {
      orderId,
      orderSupplierId: orderSupplierId ?? null,
      productType: item.productType as any,
      quantity: item.quantity,
      quantityMin: item.quantityMin ?? null,
      quantityMax: item.quantityMax ?? null,
      unit: item.unit ?? 'MT',
      costUnit: item.costUnit ?? item.unit ?? 'MT',
      salesUnit: item.salesUnit ?? item.unit ?? 'MT',
      costConversionFactor: item.costConversionFactor ?? '1',
      unitConversionFactor: item.unitConversionFactor ?? '1',
      description: item.description ?? null,
      costPrice: item.costPrice ?? null,
      costCurrency,
      salesPrice: item.salesPrice ?? null,
      salesCurrency,
      profit: profit.toFixed(4),
      paymentTerms: item.paymentTerms as any ?? null,
      customerNote: item.customerNote ?? null,
      deliveredQuantity: item.deliveredQuantity ?? null,
      // Formula pricing (cost side)
      costPricingModel: (item.costPricingModel as any) ?? 'FIXED',
      costReferenceId: item.costReferenceId ?? null,
      costPlattsEntryId: item.costPlattsEntryId ?? null,
      costPremium: item.costPremium ?? null,
      costBarging: item.costBarging ?? null,
      costBargingUnit: item.costBargingUnit ?? null,
      costCreditDays: item.costCreditDays ?? null,
      costPriceFinalized: item.costPriceFinalized ?? false,
      // Formula pricing (sell side)
      salesPricingModel: (item.salesPricingModel as any) ?? 'FIXED',
      salesReferenceId: item.salesReferenceId ?? null,
      salesPlattsEntryId: item.salesPlattsEntryId ?? null,
      salesPremium: item.salesPremium ?? null,
      salesBarging: item.salesBarging ?? null,
      salesBargingUnit: item.salesBargingUnit ?? null,
      salesCreditDays: item.salesCreditDays ?? null,
      salesPriceFinalized: item.salesPriceFinalized ?? false,
      // Tax
      taxRate: item.taxRate ?? null,
      taxAmount,
      // Inventory linkage
      inventorySkuId: item.inventorySkuId ?? null,
      warehouseId: item.warehouseId ?? null,
      plannedInventoryAt: item.plannedInventoryAt ? new Date(item.plannedInventoryAt) : null,
    };
  });

  return db.transaction(async (tx) => {
    // Drop reservations for items that no longer exist on the order before
    // delete-cascade kicks in; this keeps inventory release atomic with item save.
    await tx
      .delete(orderItems)
      .where(eq(orderItems.orderId, orderId));

    if (values.length === 0) return [];

    return tx.insert(orderItems).values(values).returning();
  });
}

// ─── Finalize Formula Price ────────────────────────────────────────
// Sets the resolved price on a formula-priced order item once the reference
// price is known (e.g. Aramco posted price published after delivery).

export async function finalizeItemPrice(
  orderId: string,
  itemId: string,
  input: FinalizeItemPriceInput,
) {
  const [item] = await db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.id, itemId), eq(orderItems.orderId, orderId)))
    .limit(1);

  if (!item) throw new Error('Order item not found');

  const setData: Record<string, unknown> = { updatedAt: new Date() };

  if (input.side === 'cost') {
    if (item.costPricingModel !== 'FORMULA') throw new Error('Cost pricing model is not FORMULA');
    setData.costPrice = input.finalPrice;
    setData.costPriceFinalized = true;
  } else {
    if (item.salesPricingModel !== 'FORMULA') throw new Error('Sales pricing model is not FORMULA');
    setData.salesPrice = input.finalPrice;
    setData.salesPriceFinalized = true;
  }

  // Recalculate profit if both sides have a price now
  const costPrice = input.side === 'cost' ? input.finalPrice : item.costPrice;
  const salesPrice = input.side === 'sales' ? input.finalPrice : item.salesPrice;

  if (costPrice && salesPrice) {
    const profit = calculateGrossProfitBase({
      quantity: item.quantity,
      costPrice,
      costCurrency: item.costCurrency,
      costConversionFactor: item.costConversionFactor,
      salesPrice,
      salesCurrency: item.salesCurrency,
      unitConversionFactor: item.unitConversionFactor,
    });
    setData.profit = profit.toFixed(4);
  }

  const [updated] = await db
    .update(orderItems)
    .set(setData)
    .where(eq(orderItems.id, itemId))
    .returning();

  return updated;
}

// ─── Order Attachments ─────────────────────────────────────────────

export async function listOrderAttachments(orderId: string) {
  const rows = await db
    .select()
    .from(orderAttachments)
    .where(and(eq(orderAttachments.orderId, orderId), isNull(orderAttachments.deletedAt)));

  return rows.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    type: row.type,
    fileName: row.fileName,
    filePath: row.filePath,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function createOrderAttachment(input: {
  orderId: string;
  type: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  fileSize: number;
  uploadedBy?: string | null;
}) {
  const [created] = await db
    .insert(orderAttachments)
    .values({
      orderId: input.orderId,
      type: input.type as any,
      fileName: input.fileName,
      filePath: input.filePath,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      uploadedBy: input.uploadedBy ?? null,
    })
    .returning();

  return created ?? null;
}

export async function deleteOrderAttachment(attachmentId: string, orderId: string): Promise<void> {
  const result = await db
    .update(orderAttachments)
    .set({ deletedAt: new Date() })
    .where(and(eq(orderAttachments.id, attachmentId), eq(orderAttachments.orderId, orderId)))
    .returning({ id: orderAttachments.id });

  if (!result.length) throw new Error('Attachment not found');
}

// ─── Customer Payments (ledger) ───────────────────────────────────

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
    .select({ total: sql<number>`COALESCE(SUM(${customerPayments.amount}), 0)::float` })
    .from(customerPayments)
    .where(eq(customerPayments.orderId, orderId));

  await db
    .update(invoices)
    .set({ amountPaid: total.toFixed(2), updatedAt: new Date() })
    .where(eq(invoices.orderId, orderId));
}

export async function createOrderPayment(orderId: string, input: {
  amount: string;
  currency: string;
  receivedAt?: string | null;
  method?: string | null;
  note?: string | null;
  createdBy?: string | null;
}) {
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

// ─── Update Order Status ────────────────────────────────────────────

export async function updateOrderStatus(
  id: string,
  newStatus: string,
  userId?: string,
  lossReason?: string,
) {
  const setData: Record<string, unknown> = {
    status: newStatus,
    updatedAt: new Date(),
  };

  if (lossReason !== undefined) setData.lossReason = lossReason;

  if (newStatus === 'CANCELLED' || newStatus === 'PAID') {
    setData.closedAt = new Date();
  }

  // Capture pre-update status to know what transition we are doing.
  const [previous] = await db
    .select({ status: orders.status, orderKind: orders.orderKind })
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);

  // Validate delivery documentation requirements before marking delivered
  if (newStatus === 'DELIVERED') {
    const { getDeliveryDocumentationSettings } = await import('../admin/settings.service');
    const docSettings = await getDeliveryDocumentationSettings();
    if (docSettings.requireDeliveryDocumentation) {
      const requiredTypes = docSettings.deliveryDocumentationTypes;
      const deliveryDocs = await db
        .select({ type: orderAttachments.type })
        .from(orderAttachments)
        .where(
          and(
            eq(orderAttachments.orderId, id),
            isNull(orderAttachments.deletedAt),
          ),
        );
      const hasRequiredDoc = deliveryDocs.some((doc) =>
        requiredTypes.includes((doc.type ?? '').toUpperCase()),
      );
      if (!hasRequiredDoc) {
        throw new Error(
          `Missing required delivery documentation. Required types: ${requiredTypes.join(', ')}`,
        );
      }
    }
  }

  const [updated] = await db
    .update(orders)
    .set(setData)
    .where(eq(orders.id, id))
    .returning();

  if (updated && previous) {
    try {
      await applyInventoryEffectsForStatusChange({
        orderId: id,
        fromStatus: previous.status,
        toStatus: newStatus,
        userId: userId ?? null,
      });
    } catch (err) {
      console.error('[orders] Inventory effect failed on status change:', err);
      // Inventory failures must not silently revert the status change, but they
      // do warrant a log entry — the operations view will surface the mismatch.
    }
  }

  if (updated && userId) {
    await logActivity({
      userId,
      action: 'STATUS_CHANGE',
      entityType: 'order',
      entityId: id,
      metadata: { newStatus, lossReason },
    });
  }

  // WhatsApp group notifications for status changes
  if (updated) {
    const eventType = newStatus === 'CONFIRMED' ? 'order_confirmed'
      : newStatus === 'DELIVERED' ? 'order_delivered'
      : null;

    if (eventType) {
      const [orderDetails] = await db
        .select({
          orderNumber: orders.orderNumber,
          tenantId: orders.tenantId,
          vesselName: vessels.name,
          placeName: places.name,
          customerName: counterparties.name,
          purchaseOrderNumber: orders.purchaseOrderNumber,
          customerNote: orders.customerNote,
        })
        .from(orders)
        .leftJoin(vessels, eq(orders.vesselId, vessels.id))
        .leftJoin(places, eq(orders.placeId, places.id))
        .leftJoin(counterparties, eq(orders.clientId, counterparties.id))
        .where(eq(orders.id, id))
        .limit(1);

      if (orderDetails) {
        sendTemplatedGroupMessage(orderDetails.tenantId, eventType, {
          orderNumber: orderDetails.orderNumber ?? id.slice(0, 8),
          vesselName: orderDetails.vesselName ?? 'Unknown Vessel',
          portName: orderDetails.placeName ?? 'Unknown Port',
          customerName: orderDetails.customerName ?? 'Unknown Customer',
          status: newStatus,
          poNumber: orderDetails.purchaseOrderNumber ?? '',
          notes: orderDetails.customerNote ?? '',
        }).catch((err) => {
          console.error(`[orders] WhatsApp ${eventType} notification failed:`, err);
        });
      }
    }
  }

  return updated ?? null;
}

// ─── Inventory hook ────────────────────────────────────────────────
// Applied on each transition. The full set of rules:
//   * → CONFIRMED: create outbound reservations for tracked external sell lines;
//                  for INTERNAL_TRANSFER orders, create both source-out reservation
//                  and destination-side replenishment plan.
//   * → DELIVERED: convert reservations into movements; for transfer orders also
//                  realize the inbound movement at the destination warehouse.
//   * → CANCELLED: release reservations and cancel any plan we created.
async function applyInventoryEffectsForStatusChange(args: {
  orderId: string;
  fromStatus: string;
  toStatus: string;
  userId: string | null;
}) {
  const { orderId, toStatus, userId } = args;
  // Lazy-import to avoid a circular dependency between orders and inventory
  // services at module load time.
  const inv = await import('../inventory/inventory.service');
  const { orderTransfers } = await import('../../db/schema');

  const [order] = await db
    .select({
      id: orders.id,
      tenantId: orders.tenantId,
      orderKind: orders.orderKind,
      eta: orders.eta,
      etd: orders.etd,
      deliveredAt: orders.deliveredAt,
    })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  if (!order) return;

  const items = await db
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      quantity: orderItems.quantity,
      unit: orderItems.unit,
      inventorySkuId: orderItems.inventorySkuId,
      warehouseId: orderItems.warehouseId,
      plannedInventoryAt: orderItems.plannedInventoryAt,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  // Resolve transfer extension when relevant.
  const [transfer] = order.orderKind === 'INTERNAL_TRANSFER'
    ? await db
        .select()
        .from(orderTransfers)
        .where(eq(orderTransfers.orderId, orderId))
        .limit(1)
    : [];

  // Helper: pick the timestamp for the inventory event.
  const eventTime = (item: { plannedInventoryAt: Date | null }, fallback: Date | null): Date => {
    if (item.plannedInventoryAt) return item.plannedInventoryAt;
    if (fallback) return fallback;
    return new Date();
  };

  if (toStatus === 'CONFIRMED') {
    for (const item of items) {
      if (!item.inventorySkuId || !item.warehouseId) continue;

      const qty = Number(item.quantity);
      if (!Number.isFinite(qty) || qty <= 0) continue;

      // External order: outbound reservation at the chosen warehouse.
      if (order.orderKind === 'EXTERNAL') {
        await inv.upsertReservation({
          warehouseId: item.warehouseId,
          skuId: item.inventorySkuId,
          quantity: qty,
          unit: item.unit,
          reservedFor: eventTime(item, order.eta ?? order.etd ?? null),
          orderId,
          orderItemId: item.id,
          direction: 'OUTBOUND',
        });
      } else if (order.orderKind === 'INTERNAL_TRANSFER' && transfer) {
        // Source: outbound transfer reservation.
        await inv.upsertReservation({
          warehouseId: transfer.sourceWarehouseId,
          skuId: item.inventorySkuId,
          quantity: qty,
          unit: item.unit,
          reservedFor: eventTime(item, order.etd ?? order.eta ?? null),
          orderId,
          orderItemId: item.id,
          direction: 'TRANSFER_OUT',
        });
        // Destination: register a LINKED replenishment plan so future stock
        // becomes visible to operations and feeds availability.
        await inv.createReplenishmentPlan({
          warehouseId: transfer.destinationWarehouseId,
          skuId: item.inventorySkuId,
          quantity: qty.toFixed(3),
          unit: item.unit,
          expectedAt: (transfer.plannedArrivalAt ?? order.eta ?? eventTime(item, null)).toISOString(),
          orderId,
        }, userId);
      }
    }
  }

  if (toStatus === 'DELIVERED') {
    for (const item of items) {
      if (!item.inventorySkuId || !item.warehouseId) continue;
      const qty = Number(item.quantity);
      if (!Number.isFinite(qty) || qty <= 0) continue;

      const occurredAt = order.deliveredAt ?? eventTime(item, new Date());

      if (order.orderKind === 'EXTERNAL') {
        // Decrement stock at the warehouse (outbound delivery) and release reservation.
        await inv.recordMovement({
          warehouseId: item.warehouseId,
          skuId: item.inventorySkuId,
          quantity: -qty,
          unit: item.unit,
          movementType: 'OUTBOUND_DELIVERY',
          occurredAt,
          orderId,
          orderItemId: item.id,
          createdBy: userId,
        });
        await inv.releaseReservationByOrderItem(item.id);
      } else if (order.orderKind === 'INTERNAL_TRANSFER' && transfer) {
        // Source: decrement.
        await inv.recordMovement({
          warehouseId: transfer.sourceWarehouseId,
          skuId: item.inventorySkuId,
          quantity: -qty,
          unit: item.unit,
          movementType: 'TRANSFER_OUT',
          occurredAt,
          orderId,
          orderItemId: item.id,
          createdBy: userId,
        });
        // Destination: increment immediately at the same delivered time.
        await inv.recordMovement({
          warehouseId: transfer.destinationWarehouseId,
          skuId: item.inventorySkuId,
          quantity: qty,
          unit: item.unit,
          movementType: 'TRANSFER_IN',
          occurredAt,
          orderId,
          orderItemId: item.id,
          createdBy: userId,
        });
        await inv.releaseReservationByOrderItem(item.id);
      }
    }
  }

  if (toStatus === 'CANCELLED') {
    await inv.releaseReservationsByOrder(orderId);
    // Cancel any LINKED replenishment plans we created for this order.
    const { inventoryReplenishmentPlans: plans } = await import('../../db/schema');
    await db
      .update(plans)
      .set({ status: 'CANCELLED', updatedAt: new Date() })
      .where(eq(plans.orderId, orderId));
  }
}

// ─── Get Activity for an Order ──────────────────────────────────────

export async function getOrderActivity(orderId: string) {
  const { activityLogs, users: usersTable } = await import('../../db/schema');
  const { desc, eq, and } = await import('drizzle-orm');

  const logs = await db
    .select({
      id: activityLogs.id,
      userId: activityLogs.userId,
      userName: usersTable.name,
      action: activityLogs.action,
      entityType: activityLogs.entityType,
      entityId: activityLogs.entityId,
      entityName: activityLogs.entityName,
      metadata: activityLogs.metadata,
      createdAt: activityLogs.createdAt,
    })
    .from(activityLogs)
    .leftJoin(usersTable, eq(activityLogs.userId, usersTable.id))
    .where(
      and(
        eq(activityLogs.entityType, 'order'),
        eq(activityLogs.entityId, orderId),
      ),
    )
    .orderBy(desc(activityLogs.createdAt))
    .limit(50);

  return logs.map((l) => ({
    id: l.id,
    userId: l.userId,
    userName: l.userName,
    action: l.action,
    entityType: l.entityType,
    entityId: l.entityId,
    entityName: l.entityName,
    metadata: l.metadata,
    createdAt: l.createdAt.toISOString(),
  }));
}
