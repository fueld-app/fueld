// ═══════════════════════════════════════════════════════════════════════
//  Kantox service — orchestration + pure business functions.
//
//  STATUS (2026-09-17): client + settings + pure functions are
//  production-ready (probed live). The event-hook wiring (order
//  CONFIRMED → push, payment → close) is deliberately gated behind
//  Kantox meeting answers — see docs/kantox-meeting-prep-2026-09-17.md:
//    Q0/Q0b  close semantics (late payment, post-execution cancel)
//    Q4      two-leg flow written confirm + edge cases
//    Q5/Q7   hedge percent + amount basis mechanics
//  Pure functions below are safe to build/test now — they only depend on
//  the confirmed contract (margin basis, value date, delta close).
// ═══════════════════════════════════════════════════════════════════════

import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import {
  integrationCredentials,
  kantoxHedgeEntries,
  orders,
  type TenantSettings,
} from '../../db/schema';
import {
  KantoxClient,
  KantoxDuplicateRefError,
  KantoxRateRejectionError,
  type KantoxEntry,
  type KantoxPosition,
} from './kantox.client';

// ── settings ──────────────────────────────────────────────────────────

export interface KantoxSettingsResolved {
  enabled: boolean;
  apiBaseUrl: string;
  apiUser: string;
  apiPassword: string;
  companyRef: string;
  hedgeCurrency: string;
  hedgeCounterCurrency: string;
  marginHedgePercent: number;
  paymentDateBufferDays: number;
  dailyHedgeLimitUsd: number;
  valueDateRounding: NonNullable<TenantSettings['kantoxSettings']>['valueDateRounding'];
  hedgeCodPrepay: boolean;
  amountBasis: NonNullable<TenantSettings['kantoxSettings']>['amountBasis'];
}

const DEFAULTS = {
  apiBaseUrl: 'https://kantox-preprod.com/api',
  hedgeCurrency: 'USD',
  hedgeCounterCurrency: 'EUR',
  marginHedgePercent: 100,         // 17/09 call: WE SEND FULL exposure — the hedge
                                   // ratio is a Kantox PLATFORM business rule that
                                   // Pierre configures (10%→100% ramp, no client
                                   // re-development needed when it changes).
  paymentDateBufferDays: 7,
  dailyHedgeLimitUsd: 200_000,
  valueDateRounding: 'WEEKLY_MONDAY' as const,
  hedgeCodPrepay: true,
  amountBasis: 'EXACT_AT_INVOICE' as const,
};

/** Non-secret config from tenant settings; password from integrationCredentials. */
export async function resolveKantoxSettings(
  tenantId: string,
  settings: TenantSettings | null,
): Promise<KantoxSettingsResolved | null> {
  const cfg = settings?.kantoxSettings;
  if (!cfg?.enabled || !cfg.apiUser || !cfg.companyRef) return null;

  const [cred] = await db
    .select()
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, 'kantox'),
        eq(integrationCredentials.key, 'apiPassword'),
      ),
    )
    .limit(1);
  if (!cred) return null;

  const { decrypt } = await import('../../lib/crypto');
  const apiPassword = decrypt(cred.encryptedValue, cred.iv, cred.authTag);

  return {
    enabled: true,
    apiBaseUrl: cfg.apiBaseUrl ?? DEFAULTS.apiBaseUrl,
    apiUser: cfg.apiUser,
    apiPassword,
    companyRef: cfg.companyRef ?? '',
    hedgeCurrency: cfg.hedgeCurrency ?? DEFAULTS.hedgeCurrency,
    hedgeCounterCurrency: cfg.hedgeCounterCurrency ?? DEFAULTS.hedgeCounterCurrency,
    marginHedgePercent: cfg.marginHedgePercent ?? DEFAULTS.marginHedgePercent,
    paymentDateBufferDays: cfg.paymentDateBufferDays ?? DEFAULTS.paymentDateBufferDays,
    dailyHedgeLimitUsd: cfg.dailyHedgeLimitUsd ?? DEFAULTS.dailyHedgeLimitUsd,
    valueDateRounding: cfg.valueDateRounding ?? DEFAULTS.valueDateRounding,
    hedgeCodPrepay: cfg.hedgeCodPrepay ?? DEFAULTS.hedgeCodPrepay,
    amountBasis: cfg.amountBasis ?? DEFAULTS.amountBasis,
  };
}

export function makeClient(resolved: KantoxSettingsResolved): KantoxClient {
  return new KantoxClient({
    apiBaseUrl: resolved.apiBaseUrl,
    apiUser: resolved.apiUser,
    apiPassword: resolved.apiPassword,
    companyRef: resolved.companyRef,
  });
}

// ── pure business functions (unit-tested) ─────────────────────────────

/** USD commercial margin for an order: sum of USD-sales item profits.
 *  Whole-oil margin — financing costs are NOT deducted (Pierre, 09/09 call).
 *  Mixed-currency orders: only USD-sales items count (v1). */
export function computeUsdMargin(
  items: Array<{ salesCurrency: string | null; profit: string | number | null }>,
): number {
  let sum = 0;
  for (const item of items) {
    if ((item.salesCurrency ?? '').toUpperCase() !== 'USD') continue;
    sum += Number(item.profit ?? 0);
  }
  return Math.round(sum * 100) / 100;
}

/** Hedge amount = exposure × marginHedgePercent, rounded to cents.
 *  DEFAULT IS 100%: per the 17/09 Kantox call we send the FULL exposure and
 *  the hedge ratio is applied by the Kantox platform business rules (Pierre
 *  configures the ramp there). The percent knob is kept only as a
 *  safety override — do not scale client-side by default. */
export function computeHedgeAmount(usdMargin: number, marginHedgePercent: number): number {
  if (!Number.isFinite(usdMargin) || !Number.isFinite(marginHedgePercent)) return 0;
  if (usdMargin <= 0 || marginHedgePercent <= 0) return 0;
  return Math.round(usdMargin * (marginHedgePercent / 100) * 100) / 100;
}

/** Expected customer payment date + buffer, rounded per tenant policy.
 *
 *  valueDate rules (verified live 2026-09-17):
 *   - dueDate wins when set
 *   - else CREDIT: (deliveredAt || eta) + creditDays
 *   - else COD/PREPAY: (deliveredAt || eta)
 *   - always + paymentDateBufferDays (Kantox does NOT auto-roll)
 *   - rounding: WEEKLY_MONDAY = round UP to next Monday (Fri-submission →
 *     Monday bucket; Kantox rolls weekend dates internally anyway).
 */
export function deriveValueDate(input: {
  dueDate?: Date | string | null;
  deliveredAt?: Date | string | null;
  eta?: Date | string | null;
  customerPaymentTermType?: string | null;
  customerCreditDays?: number | null;
  bufferDays: number;
  rounding?: 'NONE' | 'WEEKLY_MONDAY' | 'TWICE_MONTHLY' | 'MONTHLY';
}): string {
  const asDate = (v: unknown): Date | null => {
    if (v == null) return null;
    if (v instanceof Date) return v;
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? null : d;
  };
  let base = asDate(input.dueDate) ?? asDate(input.deliveredAt) ?? asDate(input.eta);
  if (!base) {
    // no delivery signal at all — push 30 days out so the entry is accepted
    base = new Date();
    base.setDate(base.getDate() + 30);
  }
  if (!input.dueDate && (input.customerPaymentTermType ?? '').toUpperCase() === 'CREDIT') {
    base = new Date(base);
    base.setDate(base.getDate() + (input.customerCreditDays ?? 0));
  }
  const d = new Date(base);
  d.setDate(d.getDate() + (input.bufferDays ?? 0));
  d.setUTCHours(12, 0, 0, 0);

  const rounding = input.rounding ?? 'WEEKLY_MONDAY';
  if (rounding === 'WEEKLY_MONDAY') {
    const dow = d.getUTCDay(); // 0 Sun … 6 Sat
    const toMonday = (8 - dow) % 7 || 7; // Sun→Mon(1), Mon→next Mon(7), Tue→Mon(6)…
    if (dow !== 1) d.setUTCDate(d.getUTCDate() + toMonday);
  } else if (rounding === 'TWICE_MONTHLY') {
    if (d.getUTCDate() <= 15) d.setUTCDate(15);
    else d.setUTCMonth(d.getUTCMonth() + 1, 1);
  } else if (rounding === 'MONTHLY') {
    d.setUTCMonth(d.getUTCMonth() + 1, 1);
  }
  return d.toISOString().slice(0, 10);
}

/** Close-delta math for a received payment against an open hedge entry.
 *  Negative entries (cancels) must NEVER exceed the open exposure
 *  (over-cancel creates a position in the opposite direction — verified
 *  live when we over-cancelled a probe entry and had to correct with a
 *  positive delta). */
export function closeDeltaForPayment(openAmount: number, cancelledSoFar: number, paymentAmount: number): number {
  const remaining = openAmount - cancelledSoFar;
  if (remaining <= 0 || paymentAmount <= 0) return 0;
  return -Math.min(remaining, paymentAmount);
}

/** entryRef scheme — suffix refs verified to net correctly in preprod
 *  (TEST-A + TEST-A#C1 → bucket netted 0.0). */
export function entryRef(
  orderNumber: string,
  leg: 'SO' | 'PO',
  poIndex: number | undefined,
  kind: 'INITIAL' | 'AMEND' | 'CANCEL' | 'REISSUE',
  seq: number,
): string {
  const base = leg === 'SO' ? `${orderNumber}#S` : `${orderNumber}#P${poIndex ?? 1}`;
  if (kind === 'INITIAL') return base;
  const tag = { AMEND: 'A', CANCEL: 'C', REISSUE: 'R' }[kind];
  return `${base}${tag}${seq}`;
}

// ── orchestration (skeleton — payload builders gated on meeting answers) ──

export async function buildClientForTenant(tenantId: string, settings: TenantSettings | null) {
  const resolved = await resolveKantoxSettings(tenantId, settings);
  if (!resolved) return null;
  return { resolved, client: makeClient(resolved) };
}

/** Open hedge rows for an order (for the order-card endpoint). */
export async function listHedgesForOrder(tenantId: string, orderId: string) {
  return db
    .select()
    .from(kantoxHedgeEntries)
    .where(and(eq(kantoxHedgeEntries.tenantId, tenantId), eq(kantoxHedgeEntries.orderId, orderId)));
}

export type { KantoxEntry, KantoxPosition };