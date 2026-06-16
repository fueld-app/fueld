// ═══════════════════════════════════════════════════════════════════════
//  Order Utils — shared helpers for counterparty/contact lookups,
//  preferred company/bank resolution, activity metadata builders
// ═══════════════════════════════════════════════════════════════════════

import { eq, and, asc, desc, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  counterparties,
  companyContacts,
  bankAccounts,
  vessels,
  places,
  users,
  tenants,
  orderNumberSequences,
} from '../../db/schema';
import type { TenantSettings } from '../../db/schema';
import { getFinancingRateAnnual } from './order-financing';
import type {
  OrderActivityValueResolver,
  OrderActivityChange,
  OrderUpdateActivityMetadata,
} from './order.types';

// ─── Tenant Financing ────────────────────────────────────────────

export async function getTenantFinancingRateByIds(
  tenantIds: string[],
): Promise<Map<string, number>> {
  if (!tenantIds.length) return new Map();

  const rows = await db
    .select({ id: tenants.id, settings: tenants.settings })
    .from(tenants)
    .where(inArray(tenants.id, tenantIds));

  return new Map(
    rows.map((row) => [
      row.id,
      getFinancingRateAnnual((row.settings ?? {}) as TenantSettings),
    ]),
  );
}

// ─── Counterparty legacy select (backward compat for missing column errors) ──

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

// ─── Helper: Get Counterparty By ID ──────────────────────────────

export async function getCounterpartyById(
  counterpartyId: string | null | undefined,
) {
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

    return legacyRow
      ? { ...legacyRow, companyRegistrationNumber: null }
      : null;
  }
}

// ─── Helper: Get Company Contact By ID ───────────────────────────

export async function getCompanyContactById(
  contactId: string | null | undefined,
) {
  if (!contactId) return null;

  const [row] = await db
    .select()
    .from(companyContacts)
    .where(eq(companyContacts.id, contactId))
    .limit(1);

  return row
    ? {
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }
    : null;
}

// ─── Resolve Preferred Invoicing Company ─────────────────────────

export async function getPreferredOwnCompanyId(
  tenantId: string,
  requestedCompanyId?: string | null,
  supplierId?: string | null,
): Promise<string | null> {
  const normalizedCompanyId = requestedCompanyId?.trim() ?? '';
  if (normalizedCompanyId) {
    const [requestedCompany] = await db
      .select({ id: counterparties.id })
      .from(counterparties)
      .where(
        and(
          eq(counterparties.id, normalizedCompanyId),
          eq(counterparties.tenantId, tenantId),
          eq(counterparties.isOwnCompany, true),
        ),
      )
      .limit(1);

    if (requestedCompany?.id) return requestedCompany.id;
  }

  const normalizedSupplierId = supplierId?.trim() ?? '';
  if (normalizedSupplierId) {
    const [supplier] = await db
      .select({
        preferredInvoicingCompanyId:
          counterparties.preferredInvoicingCompanyId,
      })
      .from(counterparties)
      .where(
        and(
          eq(counterparties.id, normalizedSupplierId),
          eq(counterparties.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (supplier?.preferredInvoicingCompanyId) {
      const [preferredCompany] = await db
        .select({ id: counterparties.id })
        .from(counterparties)
        .where(
          and(
            eq(
              counterparties.id,
              supplier.preferredInvoicingCompanyId,
            ),
            eq(counterparties.tenantId, tenantId),
            eq(counterparties.isOwnCompany, true),
          ),
        )
        .limit(1);

      if (preferredCompany?.id) return preferredCompany.id;
    }
  }

  const [fallbackCompany] = await db
    .select({ id: counterparties.id })
    .from(counterparties)
    .where(
      and(
        eq(counterparties.tenantId, tenantId),
        eq(counterparties.isOwnCompany, true),
      ),
    )
    .orderBy(asc(counterparties.name), asc(counterparties.id))
    .limit(1);

  return fallbackCompany?.id ?? null;
}

// ─── Resolve Preferred Bank Account ──────────────────────────────

export async function getPreferredBankAccountId(
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
      .where(
        and(
          eq(bankAccounts.id, normalizedBankAccountId),
          eq(bankAccounts.counterpartyId, invoicingCompanyId),
        ),
      )
      .limit(1);

    if (requestedBankAccount?.id) return requestedBankAccount.id;
  }

  const normalizedCurrency = (currency ?? '').trim().toUpperCase();
  const companyBankAccounts = await db
    .select({
      id: bankAccounts.id,
      currency: bankAccounts.currency,
      isDefault: bankAccounts.isDefault,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.counterpartyId, invoicingCompanyId))
    .orderBy(
      desc(bankAccounts.isDefault),
      asc(bankAccounts.label),
      asc(bankAccounts.id),
    );

  if (companyBankAccounts.length === 0) return null;

  if (normalizedCurrency) {
    const currencyMatches = companyBankAccounts.filter(
      (account) =>
        (account.currency ?? '').trim().toUpperCase() === normalizedCurrency,
    );
    if (currencyMatches.length > 0) {
      return (
        currencyMatches.find((account) => account.isDefault)?.id ??
        currencyMatches[0]?.id ??
        null
      );
    }
  }

  return (
    companyBankAccounts.find((account) => account.isDefault)?.id ??
    companyBankAccounts[0]?.id ??
    null
  );
}

// ─── Order Number Generation ─────────────────────────────────────

function normalizeOrderNumberTemplate(template: string): string {
  const trimmed = template.trim();
  if (!trimmed) return '{YYYY}{MM}{DD}-{SEQ:6}';

  const hasSeqToken = /\{SEQ(?::\d+)?\}/.test(trimmed);
  if (hasSeqToken) return trimmed;

  return `${trimmed}-{SEQ:6}`;
}

export async function generateOrderNumber(tenantId: string): Promise<string> {
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

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
  });
  const settings = (tenant?.settings ?? {}) as TenantSettings;
  const prefix = settings.orderNumberPrefix ?? '';
  const template = normalizeOrderNumberTemplate(
    settings.orderNumberTemplate ?? '{YYYY}{MM}{DD}-{SEQ:6}',
  );

  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');

  let result = template
    .replace('{PREFIX}', prefix)
    .replace('{YYYY}', yyyy)
    .replace('{MM}', mm)
    .replace('{DD}', dd);

  result = result.replace(/\{SEQ:(\d+)\}/g, (_match, digits) => {
    return String(seqNum).padStart(parseInt(digits, 10), '0');
  });

  result = result.replace('{SEQ}', String(seqNum).padStart(6, '0'));

  return result;
}

// ─── Activity Metadata Helpers ───────────────────────────────────

import { inArray } from 'drizzle-orm';

const ORDER_UPDATE_ACTIVITY_FIELDS: Array<{
  key: string;
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

function normalizeOrderActivityValue(
  value: unknown,
): string | number | boolean | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return String(value);
}

function areOrderActivityValuesEqual(
  left: unknown,
  right: unknown,
): boolean {
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
      return (
        (await getCounterpartyById(String(normalized)))?.name ??
        String(normalized)
      );
    case 'contact':
      return (
        (await getCompanyContactById(String(normalized)))?.name ??
        String(normalized)
      );
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
        .select({
          label: bankAccounts.label,
          currency: bankAccounts.currency,
        })
        .from(bankAccounts)
        .where(eq(bankAccounts.id, String(normalized)))
        .limit(1);
      if (!row) return String(normalized);
      return row.currency
        ? `${row.label} (${row.currency})`
        : row.label;
    }
    default:
      return normalized;
  }
}

export async function buildOrderUpdateActivityMetadata(
  previousOrder: Record<string, unknown>,
  nextOrder: Record<string, unknown>,
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
    ? { action: 'update_order_fields', changes }
    : null;
}

// ─── Timestamp Normalization ─────────────────────────────────────

export function normalizeOptionalTimestamp(
  value: string | Date | null | undefined,
): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
