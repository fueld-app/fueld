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

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  activityLogs,
  integrationCredentials,
  kantoxHedgeEntries,
  orders,
  tenants,
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

/** Which open hedge legs are past their value date and still unpaid.
 *
 *  Decision 1 of the 17/09 Kantox call: rolls for late payments are handled
 *  MANUALLY by Pierre on the Kantox platform — we send nothing and build no
 *  roll automation. Our only obligation is to surface the position so he has
 *  something to act on; Kantox does not auto-roll.
 *
 *  An entry is "late" when it is still open (sent, not closed/cancelled) and
 *  its value date has already passed. `todayIso` is injectable for tests. */
export function findLateHedgeEntries(
  entries: Array<{
    id: string;
    status: string;
    valueDate: string | null;
    amount: string | number;
    cancelledAmount: string | number;
  }>,
  todayIso: string,
): string[] {
  return entries
    .filter((e) => {
      if (e.status !== 'SENT' && e.status !== 'HEDGED') return false;
      if (!e.valueDate) return false;
      if (e.valueDate >= todayIso) return false; // value date today or later ≠ late
      const remaining = Number(e.amount) - Number(e.cancelledAmount);
      return Number.isFinite(remaining) && remaining > 0;
    })
    .map((e) => e.id);
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
// ═══════════════════════════════════════════════════════════════════════
//  Event hooks — tenant-isolated, fire-and-forget.
//
//  PRIME DIRECTIVE (Patrick, 17/09): this module serves ALL tenants. Every
//  hook (a) resolves THAT tenant's own settings, (b) no-ops immediately
//  when Kantox is not enabled (zero overhead for ChannelTX/Moxie/etc),
//  (c) NEVER throws into the deal-confirmation / payment path, (d) fails
//  per-tenant only. Sandbox creds live only on the staging tenant; prod
//  creds only on Riviera Marine.
// ═══════════════════════════════════════════════════════════════════════

import { logActivity } from '../activity/activity.service';

const USD = 'USD';

export interface KantoxOrderSnapshotItem {
  id: string;
  orderSupplierId: string | null;
  quantity: string | number | null;
  quantityMin: string | number | null;
  salesPrice: string | number | null;
  costPrice: string | number | null;
  salesCurrency: string | null;
  costCurrency: string | null;
}

export interface KantoxOrderSnapshot {
  tenantId: string;
  orderId: string;
  orderNumber: string | null;
  dueDate?: Date | string | null;
  deliveredAt?: Date | string | null;
  eta?: Date | string | null;
  customerPaymentTermType?: string | null;
  customerCreditDays?: number | null;
  /**
   * Split payment terms: the customer pays in instalments, so the sell-side
   * exposure does not all settle on one date. `dueDays` is the days from the
   * delivery/ETA anchor (same basis as `deriveValueDate`'s CREDIT branch) and
   * `percent` the share of the order total. When present, the SELL leg is split
   * into one entry per tranche, each carrying its own value date.
   */
  customerTranches?: Array<{ percent: number | null; dueDays: number | null }> | null;
  items: KantoxOrderSnapshotItem[];
}

export interface PlannedHedgeEntry {
  leg: string;                       // 'SO' | 'PO:1' | 'PO:2' …
  direction: 'SELL' | 'BUY';
  amount: string;
  amountBasis: string;
  valueDate?: string;                // undefined → dateless bucket (rare; cancels MUST repeat the original's date)
  entryRef: string;
}

export interface HedgePlan {
  entries: PlannedHedgeEntry[];
  skipped?: string;                  // set when the order is out of scope
}

/** Line-item exposure basis: minimum quantity (pre-invoice) — decision 17/09:
 *  ONE amount per deal, minimum quantity, no delta flow for now. Falls back
 *  to full quantity when quantity_min is unset. */
function itemBasisQty(item: KantoxOrderSnapshotItem): number {
  const min = Number(item.quantityMin ?? 0);
  if (Number.isFinite(min) && min > 0) return min;
  const full = Number(item.quantity ?? 0);
  return Number.isFinite(full) && full > 0 ? full : 0;
}

/**
 * Scope filter + two-leg entry plan (17/09 meeting decisions):
 *  - USD-only scope: non-USD orders and EUR/non-USD PO legs are excluded
 *  - negative-margin deals are skipped ENTIRELY (never send a net-BUY
 *    position — Kantox would auto-execute the opposite trade at maturity)
 *  - amounts are FULL exposure (hedge ratio is a Kantox platform rule)
 *  - one amount per leg: minimum pre-invoice quantity × price
 */
/**
 * Value date for one tranche, using the same anchor and rounding policy as the
 * order-level date: delivery (falling back to ETA, then 30 days out) plus the
 * tranche's own days, plus the tenant's payment buffer, then rounded.
 */
function trancheValueDate(
  snap: KantoxOrderSnapshot,
  settings: Pick<KantoxSettingsResolved, 'paymentDateBufferDays' | 'valueDateRounding'>,
  dueDays: number,
): string {
  const anchorRaw = snap.deliveredAt ?? snap.eta ?? null;
  const anchor = anchorRaw == null ? null : new Date(String(anchorRaw));
  const base = anchor && !Number.isNaN(anchor.getTime()) ? new Date(anchor) : new Date();
  if (!anchor || Number.isNaN(anchor.getTime())) base.setDate(base.getDate() + 30);
  base.setDate(base.getDate() + dueDays);
  return deriveValueDate({
    dueDate: base,
    bufferDays: settings.paymentDateBufferDays,
    rounding: settings.valueDateRounding,
  });
}

/**
 * Split a SELL amount across the order's tranches.
 *
 * Kantox keys an entry by its ref, so each tranche needs its OWN ref —
 * reusing one ref for several amounts would collide (the second push is skipped
 * as "already claimed", silently losing that tranche's hedge). Tranches whose
 * due date cannot be measured are dropped from the split and their share is
 * folded into the first measurable tranche, so the order's total hedged amount
 * is unchanged; the date used is then the earliest, which over-hedges the
 * timeline rather than under-hedging it.
 *
 * Returns null when the schedule cannot be used at all — the caller then keeps
 * the single order-level entry, exactly as before.
 */
export function splitSellLegByTranche(
  amount: number,
  tranches: Array<{ percent: number | null; dueDays: number | null }> | null | undefined,
): Array<{ refIndex: number; amount: number; dueDays: number }> | null {
  if (!tranches || tranches.length === 0) return null;
  const usable = tranches.filter((t) => t.percent != null && t.percent > 0);
  if (usable.length === 0) return null;
  if (usable.some((t) => t.dueDays == null)) return null; // unmeasurable: keep the order-level date

  const totalPercent = usable.reduce((sum, t) => sum + (t.percent ?? 0), 0);
  if (totalPercent <= 0) return null;

  const shares = usable.map((t) => ({
    dueDays: Math.max(0, Math.round(t.dueDays ?? 0)),
    amount: Math.round((amount * (t.percent ?? 0) / totalPercent) * 100) / 100,
  }));

  // The last tranche absorbs the rounding so the parts sum to the whole.
  const allocated = shares.slice(0, -1).reduce((sum, s) => sum + s.amount, 0);
  const last = shares[shares.length - 1]!;
  last.amount = Math.round((amount - allocated) * 100) / 100;

  // Drop zero-value splits (a share too small to survive rounding), then
  // re-index so refs stay contiguous.
  const kept = shares
    .filter((share) => share.amount > 0)
    .map((share, i) => ({ refIndex: i + 1, amount: share.amount, dueDays: share.dueDays }));
  return kept.length > 0 ? kept : null;
}

export function buildHedgePlan(
  snap: KantoxOrderSnapshot,
  settings: Pick<KantoxSettingsResolved, 'marginHedgePercent' | 'paymentDateBufferDays' | 'valueDateRounding' | 'hedgeCurrency' | 'hedgeCounterCurrency'>,
): HedgePlan {
  const valueDate = deriveValueDate({
    dueDate: snap.dueDate ?? null,
    deliveredAt: snap.deliveredAt ?? null,
    eta: snap.eta ?? null,
    customerPaymentTermType: snap.customerPaymentTermType ?? null,
    customerCreditDays: snap.customerCreditDays ?? null,
    bufferDays: settings.paymentDateBufferDays,
    rounding: settings.valueDateRounding,
  });

  // SO (sell) leg: USD sales exposure. Order is out of scope when its items
  // do not settle in USD (17/09: EUR deals excluded).
  let soAmount = 0;
  for (const item of snap.items) {
    if ((item.salesCurrency ?? '').toUpperCase() !== USD) continue;
    const qty = Number(item.quantityMin ?? item.quantity ?? 0);
    soAmount += qty * Number(item.salesPrice ?? 0);
  }
  soAmount = Math.round(soAmount * 100) / 100;
  if (soAmount <= 0) return { entries: [], skipped: 'no USD sell exposure' };

  // PO (buy) legs: group USD-cost items per supplier leg.
  const buyByLeg = new Map<string, number>();
  const legIndexOfSupplier = new Map<string, number>();
  const usdLegs = [...new Set(
    snap.items.map((i) => i.orderSupplierId).filter((v): v is string => !!v),
  )];
  usdLegs.forEach((legId, i) => legIndexOfSupplier.set(legId, i + 1));

  let totalBuy = 0;
  const poEntries: Array<{ leg: string; amount: number }> = [];
  for (const item of snap.items) {
    const legId = item.orderSupplierId;
    if (!legId) continue;
    if ((item.costCurrency ?? '').toUpperCase() !== USD) continue; // EUR PO → excluded
    const qty = Number(item.quantityMin ?? item.quantity ?? 0);
    const poAmount = qty * Number(item.costPrice ?? 0);
    if (poAmount <= 0) continue;
    const legKey = `PO:${legIndexOfSupplier.get(legId) ?? 1}`;
    buyByLeg.set(legKey, (buyByLeg.get(legKey) ?? 0) + poAmount);
    totalBuy += poAmount;
  }
  for (const [legKey, amount] of buyByLeg) {
    poEntries.push({ leg: legKey, amount: Math.round(amount * 100) / 100 });
  }
  // TODO(supplier-due-date): PO legs currently share the customer-anchored
  // valueDate. When a supplier leg pins an invoice due-date override
  // (order_suppliers.supplierDueDate), the PO value date should derive from
  // the effective supplier due date instead — needs per-leg HedgePlan entries
  // + an AMEND/re-push path when the override is set after CONFIRMED. See
  // effectiveSupplierDays() in orders/order-financing.ts.
  totalBuy = Math.round(totalBuy * 100) / 100;

  // Negative-margin deal → net BUY exposure → skip the whole deal
  // (17/09: never send a net-buy position — Kantox would auto-execute the
  // opposite trade at maturity).
  if (totalBuy > soAmount) {
    return { entries: [], skipped: 'negative margin (net BUY exposure) — skipped' };
  }

  const orderRef = snap.orderNumber ?? snap.orderId;

  // Split payment terms: the customer settles in instalments, so the sell-side
  // exposure is hedged per tranche, each to ITS own value date. The amounts still
  // sum to the order's full sell exposure.
  const sellSplits = splitSellLegByTranche(soAmount, snap.customerTranches);
  const sellEntries: PlannedHedgeEntry[] = sellSplits
    ? sellSplits.map((split) => ({
        leg: 'SO',
        direction: 'SELL' as const,
        amount: split.amount.toFixed(2),
        amountBasis: split.amount.toFixed(2),
        valueDate: trancheValueDate(snap, settings, split.dueDays),
        // A per-tranche ref: reusing the base SO ref for several amounts would
        // collide and the later pushes would be skipped as already claimed.
        entryRef: sellSplits.length === 1
          ? entryRef(orderNumberSafe(orderRef), 'SO', undefined, 'INITIAL', 0)
          : `${orderNumberSafe(orderRef)}#S${split.refIndex}`,
      }))
    : [{
        leg: 'SO',
        direction: 'SELL' as const,
        amount: soAmount.toFixed(2),
        amountBasis: soAmount.toFixed(2),
        valueDate,
        entryRef: entryRef(orderNumberSafe(orderRef), 'SO', undefined, 'INITIAL', 0),
      }];

  const entries: PlannedHedgeEntry[] = [
    ...sellEntries,
    ...poEntries.map((po, i) => ({
      leg: po.leg,
      direction: 'BUY' as const,
      amount: po.amount.toFixed(2),
      amountBasis: po.amount.toFixed(2),
      valueDate,
      entryRef: entryRef(orderNumberSafe(orderRef), 'PO', i + 1, 'INITIAL', 0),
    })),
  ];
  return { entries };
}

function orderNumberSafe(orderNumber: string | null): string {
  return orderNumber ?? 'order';
}

// ── push orchestration (insert-claim-CAS-send, never blocks the caller) ──

async function pushPlannedEntry(
  tenantId: string,
  resolved: KantoxSettingsResolved,
  planned: PlannedHedgeEntry,
  ctx: { orderId: string; orderItemId?: string | null; orderSupplierId?: string | null; kind: 'INITIAL' | 'CANCEL' | 'AMEND' | 'REISSUE'; notes: string; retryCount?: number },
): Promise<void> {
  // Claim: insert before send — the partial unique index fences double-pushes.
  let rowId: string;
  try {
    const [row] = await db
      .insert(kantoxHedgeEntries)
      .values({
        tenantId,
        orderId: ctx.orderId,
        orderItemId: ctx.orderItemId ?? null,
        orderSupplierId: ctx.orderSupplierId ?? null,
        leg: planned.leg,
        direction: planned.direction,
        amount: planned.amount,
        amountBasis: planned.amountBasis,
        currency: resolved.hedgeCurrency,
        counterCurrency: resolved.hedgeCounterCurrency,
        valueDate: planned.valueDate,
        entryRef: planned.entryRef,
        kind: ctx.kind,
        status: 'PENDING_SEND',
        notes: ctx.notes,
      })
      .returning({ id: kantoxHedgeEntries.id });
    rowId = row.id;
  } catch (err: any) {
    if (/duplicate key|unique/i.test(String(err?.message ?? err))) {
      console.error(`[Kantox] ${planned.entryRef} already claimed — skipping`);
      return;
    }
    throw err;
  }

  // CAS: PENDING_SEND → SENDING (atomic claim)
  const claimed = await db
    .update(kantoxHedgeEntries)
    .set({ status: 'SENDING', updatedAt: new Date() })
    .where(and(eq(kantoxHedgeEntries.id, rowId), eq(kantoxHedgeEntries.status, 'PENDING_SEND')))
    .returning({ id: kantoxHedgeEntries.id });
  if (claimed.length === 0) return;

  const client = makeClient(resolved);
  try {
    const entry = await client.submitEntry({
      companyRef: resolved.companyRef,
      entryRef: planned.entryRef,
      marketDirection: planned.direction === 'SELL' ? 'sell' : 'buy',
      currency: resolved.hedgeCurrency,
      counterCurrency: resolved.hedgeCounterCurrency,
      amount: planned.amount,
      valueDate: planned.valueDate,
      notes: ctx.notes,
    });
    await db
      .update(kantoxHedgeEntries)
      .set({
        status: 'SENT',
        kantoxEntryId: entry.reference,
        kantoxPositionRef: entry.positionRef,
        updatedAt: new Date(),
      })
      .where(eq(kantoxHedgeEntries.id, rowId));
  } catch (err: any) {
    // Duplicate ref = the entry already exists on Kantox (retry after a
    // timeout where we can't know) → it's effectively SENT — reconcile via
    // the sync loop, do NOT strand the row as FAILED.
    if (err instanceof KantoxDuplicateRefError) {
      await db
        .update(kantoxHedgeEntries)
        .set({ status: 'SENT', errorMessage: 'dedup hit — reconciling via GET entries', updatedAt: new Date() })
        .where(eq(kantoxHedgeEntries.id, rowId));
      return;
    }
    const isRateRejection = err instanceof KantoxRateRejectionError;
    await db
      .update(kantoxHedgeEntries)
      .set({
        status: 'FAILED',
        errorMessage: String(err?.message ?? err).slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(kantoxHedgeEntries.id, rowId));
    if (!isRateRejection) throw err; // rate rejections keep the ref reusable (verified live); others go to the retry loop
  }
}

/** Fire-and-forget hook — order reached CONFIRMED. Never throws. */
export async function onOrderConfirmedForKantox(order: {
  id: string; tenantId: string; orderNumber: string | null;
  dueDate?: Date | string | null; deliveredAt?: Date | string | null; eta?: Date | string | null;
  customerPaymentTermType?: string | null; customerCreditDays?: number | null;
  /** Split payment terms — see KantoxOrderSnapshot.customerTranches. */
  customerTranches?: Array<{ percent: number | null; dueDays: number | null }> | null;
}, items: KantoxOrderSnapshotItem[]): Promise<void> {
  try {
    // Read the tenant's own settings here — the caller is the order-status
    // path, which must not pay for a settings join on every status change.
    const [tenant] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, order.tenantId))
      .limit(1);
    const resolved = await resolveKantoxSettings(
      order.tenantId,
      (tenant?.settings ?? null) as TenantSettings | null,
    );
    if (!resolved) return; // tenant has no Kantox — fast no-op
    const snap: KantoxOrderSnapshot = { ...order, orderId: order.id, items };
    const plan = buildHedgePlan(snap, resolved);
    if (plan.skipped || plan.entries.length === 0) {
      console.log(`[Kantox] order ${order.orderNumber ?? order.id} not hedged: ${plan.skipped}`);
      return;
    }
    for (const planned of plan.entries) {
      await pushPlannedEntry(order.tenantId, resolved, planned, {
        orderId: order.id,
        kind: 'INITIAL',
        notes: `Fueld order ${order.orderNumber ?? order.id}`,
      });
    }
    await logActivity({
      userId: null, // system-initiated (order-status hook), not a user action
      tenantId: order.tenantId,
      action: 'KANTOX_PUSH',
      entityType: 'kantox_hedge_entry',
      entityId: order.id,
      metadata: { entryCount: plan.entries.length, orderNumber: order.orderNumber },
    });
  } catch (err) {
    console.error(`[Kantox] onOrderConfirmed failed for order ${order.id} (tenant ${order.tenantId}) — non-fatal:`, err);
  }
}

/** Fire-and-forget — order CANCELLED/LOST → negative entries for open legs. */
export async function onOrderCancelledForKantox(tenantId: string, orderId: string): Promise<void> {
  try {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const resolved = await resolveKantoxSettings(tenantId, (tenant?.settings as any) ?? null);
    if (!resolved) return;
    const rows = await listHedgesForOrder(tenantId, orderId);
    const client = makeClient(resolved);
    for (const row of rows) {
      if (row.status === 'CANCELLED' || row.status === 'CLOSED') continue;
      const remaining = Number(row.amount) - Number(row.cancelledAmount);
      if (remaining <= 0) continue;
      const planned: PlannedHedgeEntry = {
        leg: row.leg,
        direction: row.direction as 'BUY' | 'SELL',
        amount: (-remaining).toFixed(2),
        amountBasis: '0.00',
        valueDate: row.valueDate ?? undefined,
        entryRef: `${row.entryRef}C${row.retryCount + 1}`,
      };
      await pushLifecycleEntry(tenantId, resolved, planned, { orderId, kind: 'CANCEL', parentRowId: row.id, notes: `Fueld cancel ${row.entryRef}` });
    }
  } catch (err) {
    console.error(`[Kantox] onOrderCancelled failed for order ${orderId} — non-fatal:`, err);
  }
}

/** Fire-and-forget — USD customer payment received → close delta on the SO leg.
 *  Non-USD payments are ignored (they don't extinguish the USD exposure). */
export async function onCustomerPaymentForKantox(
  tenantId: string, orderId: string, paymentAmount: number, paymentCurrency: string,
): Promise<void> {
  try {
    if ((paymentCurrency ?? '').toUpperCase() !== USD) return; // non-USD payment ≠ USD exposure relief
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    const resolved = await resolveKantoxSettings(tenantId, (tenant?.settings as any) ?? null);
    if (!resolved) return;
    const rows = await listHedgesForOrder(tenantId, orderId);
    const sellRows = rows.filter((r) => r.direction === 'SELL' && (r.status === 'SENT' || r.status === 'HEDGED'));
    if (sellRows.length === 0) return; // nothing open (e.g. payment before push)
    const client = makeClient(resolved);
    for (const row of sellRows) {
      const delta = closeDeltaForPayment(Number(row.amount), Number(row.cancelledAmount), paymentAmount);
      if (delta === 0) continue;
      const planned: PlannedHedgeEntry = {
        leg: row.leg,
        direction: 'SELL',
        amount: delta.toFixed(2),
        amountBasis: '0.00',
        valueDate: row.valueDate ?? undefined,
        entryRef: `${row.entryRef}C${row.retryCount + 1}`,
      };
      await pushLifecycleEntry(tenantId, resolved, planned, { orderId, kind: 'CANCEL', parentRowId: row.id, notes: `Fueld payment close ${row.entryRef}` });
      const newCancelled = Number(row.cancelledAmount) + Math.abs(delta);
      const fullyClosed = newCancelled >= Number(row.amount);
      await db
        .update(kantoxHedgeEntries)
        .set({
          cancelledAmount: newCancelled.toFixed(2),
          ...(fullyClosed ? { status: 'CLOSED' as const } : {}),
          updatedAt: new Date(),
        })
        .where(eq(kantoxHedgeEntries.id, row.id));
    }
  } catch (err) {
    console.error(`[Kantox] onCustomerPayment failed for order ${orderId} — non-fatal:`, err);
  }
}

/** AMEND/CANCEL/REISSUE push — no INITIAL uniqueness fence, but same
 *  claim-CAS-send lifecycle. */
async function pushLifecycleEntry(
  tenantId: string,
  resolved: KantoxSettingsResolved,
  planned: PlannedHedgeEntry,
  ctx: { orderId: string; kind: 'CANCEL' | 'AMEND' | 'REISSUE'; parentRowId?: string; notes: string },
): Promise<void> {
  const [row] = await db
    .insert(kantoxHedgeEntries)
    .values({
      tenantId,
      orderId: ctx.orderId,
      leg: planned.leg,
      direction: planned.direction,
      amount: planned.amount,
      amountBasis: planned.amountBasis,
      currency: resolved.hedgeCurrency,
      counterCurrency: resolved.hedgeCounterCurrency,
      valueDate: planned.valueDate,
      entryRef: planned.entryRef,
      kind: ctx.kind,
      status: 'PENDING_SEND',
      notes: ctx.notes,
    })
    .returning({ id: kantoxHedgeEntries.id });
  try {
    const entry = await makeClient(resolved).submitEntry({
      companyRef: resolved.companyRef,
      entryRef: planned.entryRef,
      marketDirection: planned.direction === 'SELL' ? 'sell' : 'buy',
      currency: resolved.hedgeCurrency,
      counterCurrency: resolved.hedgeCounterCurrency,
      amount: planned.amount,
      valueDate: planned.valueDate,
      notes: ctx.notes,
    });
    await db
      .update(kantoxHedgeEntries)
      .set({ status: 'SENT', kantoxEntryId: entry.reference, kantoxPositionRef: entry.positionRef, updatedAt: new Date() })
      .where(eq(kantoxHedgeEntries.id, row.id));
    if (ctx.parentRowId) {
      await db
        .update(kantoxHedgeEntries)
        .set({ cancelledAmount: sql`${kantoxHedgeEntries.cancelledAmount} + ${Math.abs(Number(planned.amount))}`, updatedAt: new Date() })
        .where(eq(kantoxHedgeEntries.id, ctx.parentRowId));
    }
  } catch (err: any) {
    await db
      .update(kantoxHedgeEntries)
      .set({ status: 'FAILED', errorMessage: String(err?.message ?? err).slice(0, 500), updatedAt: new Date() })
      .where(eq(kantoxHedgeEntries.id, row.id));
    throw err;
  }
}

// ── sync loop (15 min): retries + status reconciliation ──────────────

const SYNC_INTERVAL_MS = 15 * 60 * 1000;
const MAX_RETRIES = 5;

/** Map Kantox entryStatus → our row status. Enums incomplete (meeting Q3) —
 *  mapping stays lenient; unknown values leave the row untouched. */
function mapKantoxStatus(entryStatus: string | null): 'SENT' | 'HEDGED' | null {
  if (!entryStatus) return null;
  const s = entryStatus.toLowerCase();
  if (s.includes('hedg') || s.includes('execut')) return 'HEDGED';
  return null; // 'in_position', 'accumulating', etc. stay SENT
}

async function syncTenant(tenantId: string, settings: TenantSettings | null): Promise<void> {
  const resolved = await resolveKantoxSettings(tenantId, settings);
  if (!resolved) return;
  const client = makeClient(resolved);

  // 1. Retry FAILED rows (max 5) and push stale PENDING_SEND rows (>5 min).
  const staleCutoff = new Date(Date.now() - 5 * 60 * 1000);
  const candidates = await db
    .select()
    .from(kantoxHedgeEntries)
    .where(eq(kantoxHedgeEntries.tenantId, tenantId));
  for (const row of candidates) {
    try {
      if (row.status === 'PENDING_SEND' && row.createdAt < staleCutoff) {
        const entry = await client.submitEntry({
          companyRef: resolved.companyRef,
          entryRef: row.entryRef,
          marketDirection: row.direction === 'SELL' ? 'sell' : 'buy',
          currency: row.currency,
          counterCurrency: row.counterCurrency,
          amount: row.amount,
          valueDate: row.valueDate ?? undefined,
          notes: row.notes ?? undefined,
        });
        await db.update(kantoxHedgeEntries)
          .set({ status: 'SENT', kantoxEntryId: entry.reference, kantoxPositionRef: entry.positionRef, updatedAt: new Date() })
          .where(eq(kantoxHedgeEntries.id, row.id));
      } else if (row.status === 'FAILED' && row.retryCount < MAX_RETRIES && row.entryRef && row.amount && row.direction && row.currency) {
        // Rejected-entry refs are reusable (verified live); dedup-safe because
        // KantoxDuplicateRefError in submit marks SENT instead of FAILED.
        const entry = await client.submitEntry({
          companyRef: resolved.companyRef,
          entryRef: row.entryRef,
          marketDirection: row.direction === 'SELL' ? 'sell' : 'buy',
          currency: row.currency,
          counterCurrency: row.counterCurrency,
          amount: row.amount,
          valueDate: row.valueDate ?? undefined,
          notes: row.notes ?? undefined,
        });
        await db.update(kantoxHedgeEntries)
          .set({ status: 'SENT', kantoxEntryId: entry.reference, kantoxPositionRef: entry.positionRef, errorMessage: null, updatedAt: new Date() })
          .where(eq(kantoxHedgeEntries.id, row.id));
      }
    } catch (err: any) {
      const bump = { retryCount: (row.retryCount ?? 0) + 1, errorMessage: String(err?.message ?? err).slice(0, 500), updatedAt: new Date() };
      if (row.retryCount + 1 >= MAX_RETRIES) await db.update(kantoxHedgeEntries).set({ ...bump, status: 'FAILED' }).where(eq(kantoxHedgeEntries.id, row.id));
      else if (row.status === 'PENDING_SEND') await db.update(kantoxHedgeEntries).set(bump).where(eq(kantoxHedgeEntries.id, row.id));
    }
  }

  // 2. Reconcile statuses from GET entries (per-entry hedgedRate etc).
  try {
    const remote = await client.listEntries();
    const byRef = new Map(remote.map((e) => [e.entryRef, e]));
    for (const row of candidates) {
      if (row.status !== 'SENT' && row.status !== 'HEDGED') continue;
      const remoteEntry = byRef.get(row.entryRef);
      if (!remoteEntry) continue;
      const mapped = mapKantoxStatus(remoteEntry.entryStatus);
      const updates: Record<string, unknown> = {};
      if (mapped && mapped !== row.status) updates.status = mapped;
      if (remoteEntry.hedgedRate != null && Number(row.hedgedRate ?? 0) !== remoteEntry.hedgedRate) updates.hedgedRate = String(remoteEntry.hedgedRate);
      if (remoteEntry.executionRate != null && Number(row.executionRate ?? 0) !== remoteEntry.executionRate) updates.executionRate = String(remoteEntry.executionRate);
      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        await db.update(kantoxHedgeEntries).set(updates).where(eq(kantoxHedgeEntries.id, row.id));
      }
    }
  } catch (err: any) {
    console.error(`[Kantox] status reconciliation failed for tenant ${tenantId}: ${err?.message ?? err}`);
  }

  // 3. Late-payment flag (decision 1): rolls are handled manually by Pierre on
  //    the Kantox platform, so our only job is to surface past-due open legs.
  //    Deduped on (entry, value date) and read only for entries still late
  //    today — an un-deduped flag would drown the activity feed every 15 min,
  //    while keying on the entry alone would go silent forever after Pierre
  //    rolls it once (the leg becomes late again against its new value date).
  try {
    const today = new Date().toISOString().slice(0, 10);
    const lateIds = findLateHedgeEntries(candidates, today);
    if (lateIds.length > 0) {
      const alreadyFlagged = await db
        .select({ entityId: activityLogs.entityId, metadata: activityLogs.metadata })
        .from(activityLogs)
        .where(
          and(
            eq(activityLogs.tenantId, tenantId),
            eq(activityLogs.action, 'KANTOX_LATE_PAYMENT'),
            inArray(activityLogs.entityId, lateIds),
          ),
        );
      const flagged = new Set(
        alreadyFlagged.map((r) => `${r.entityId}|${(r.metadata as { valueDate?: string } | null)?.valueDate ?? ''}`),
      );
      for (const id of lateIds) {
        const row = candidates.find((c) => c.id === id);
        if (flagged.has(`${id}|${row?.valueDate ?? ''}`)) continue;
        await logActivity({
          userId: null,
          tenantId,
          action: 'KANTOX_LATE_PAYMENT',
          entityType: 'kantox_hedge_entry',
          entityId: id,
          metadata: {
            entryRef: row?.entryRef ?? null,
            valueDate: row?.valueDate ?? null,
            orderId: row?.orderId ?? null,
            note: 'Value date passed with exposure still open — Pierre rolls manually on the Kantox platform',
          },
        });
      }
    }
  } catch (err: any) {
    console.error(`[Kantox] late-payment flag failed for tenant ${tenantId}: ${err?.message ?? err}`);
  }
}

/** Boot-time registration — call once from index.ts. Per-tenant try/catch:
 *  one tenant's Kantox outage never blocks the others (panel K-Missing). */
export function startKantoxSync(): void {
  const tick = async () => {
    try {
      const all = await db.select({ id: tenants.id, settings: tenants.settings }).from(tenants);
      for (const tenant of all) {
        const cfg = (tenant.settings as any)?.kantoxSettings;
        if (!cfg?.enabled) continue; // fast skip for non-Kantox tenants
        try {
          await syncTenant(tenant.id, tenant.settings as TenantSettings);
        } catch (err: any) {
          console.error(`[Kantox] sync failed for tenant ${tenant.id} — isolated: ${err?.message ?? err}`);
        }
      }
    } catch (err) {
      console.error('[Kantox] sync tick failed:', err);
    }
  };
  setInterval(tick, SYNC_INTERVAL_MS).unref();
  console.log('[Kantox] sync loop started (every 15 min)');
}

/** Enabled-tenant SQL helper for future use (admin listing). */
export async function listEnabledTenants(): Promise<string[]> {
  const rows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(sql`settings->'kantoxSettings'->>'enabled' = 'true'`);
  return rows.map((r) => r.id);
}

/** The API base URL is where we send the tenant's vaulted Kantox password, so
 *  it must not be freely pointable at an arbitrary host: a tenant ADMIN can
 *  never read the password back, but could otherwise redirect it to a server
 *  they control (and use our API as an SSRF pivot with credentials attached).
 *  Allowlist the two Kantox hosts; anything else is rejected, not silently
 *  accepted. */
export function isAllowedKantoxBaseUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return host === 'kantox.com' || host === 'kantox-preprod.com';
}

// ── admin settings (config UI) ────────────────────────────────────────

/** Non-secret config for the admin form. The API password is managed in
 *  Admin → Integrations and is NEVER returned here. `hasPassword` lets the
 *  form distinguish "not configured" from "configured but hidden". */
export interface KantoxSettingsView {
  enabled: boolean;
  apiBaseUrl: string;
  apiUser: string;
  companyRef: string;
  hedgeCurrency: string;
  hedgeCounterCurrency: string;
  marginHedgePercent: number;
  paymentDateBufferDays: number;
  dailyHedgeLimitUsd: number;
  valueDateRounding: NonNullable<TenantSettings['kantoxSettings']>['valueDateRounding'];
  hedgeCodPrepay: boolean;
  amountBasis: NonNullable<TenantSettings['kantoxSettings']>['amountBasis'];
  hasPassword: boolean;
}

export async function getKantoxSettingsView(tenantId: string): Promise<KantoxSettingsView> {
  const [tenant] = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const cfg = (tenant?.settings as TenantSettings | null)?.kantoxSettings ?? {};

  const [cred] = await db
    .select({ id: integrationCredentials.id })
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.tenantId, tenantId),
        eq(integrationCredentials.provider, 'kantox'),
        eq(integrationCredentials.key, 'apiPassword'),
      ),
    )
    .limit(1);

  return {
    enabled: cfg.enabled ?? false,
    apiBaseUrl: cfg.apiBaseUrl ?? DEFAULTS.apiBaseUrl,
    apiUser: cfg.apiUser ?? '',
    companyRef: cfg.companyRef ?? '',
    hedgeCurrency: cfg.hedgeCurrency ?? DEFAULTS.hedgeCurrency,
    hedgeCounterCurrency: cfg.hedgeCounterCurrency ?? DEFAULTS.hedgeCounterCurrency,
    marginHedgePercent: cfg.marginHedgePercent ?? DEFAULTS.marginHedgePercent,
    paymentDateBufferDays: cfg.paymentDateBufferDays ?? DEFAULTS.paymentDateBufferDays,
    dailyHedgeLimitUsd: cfg.dailyHedgeLimitUsd ?? DEFAULTS.dailyHedgeLimitUsd,
    valueDateRounding: cfg.valueDateRounding ?? DEFAULTS.valueDateRounding,
    hedgeCodPrepay: cfg.hedgeCodPrepay ?? DEFAULTS.hedgeCodPrepay,
    amountBasis: cfg.amountBasis ?? DEFAULTS.amountBasis,
    hasPassword: !!cred,
  };
}

/** Merge-write the non-secret Kantox config. Only the keys present in
 *  `input` are touched, so the form can save a single field without
 *  clobbering the rest. The password is deliberately NOT settable here —
 *  it lives in the encrypted credential vault (Admin → Integrations). */
export async function updateKantoxSettings(
  tenantId: string,
  input: Partial<KantoxSettingsView>,
): Promise<KantoxSettingsView> {
  const [tenant] = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant) throw new Error('Tenant not found');

  const settings = { ...((tenant.settings as TenantSettings | null) ?? {}) };
  const current = { ...(settings.kantoxSettings ?? {}) };

  if (input.enabled !== undefined) current.enabled = input.enabled;
  if (input.apiBaseUrl !== undefined) {
    const next = input.apiBaseUrl.trim() || DEFAULTS.apiBaseUrl;
    if (!isAllowedKantoxBaseUrl(next)) {
      throw new Error('API base URL must be an https URL on kantox.com or kantox-preprod.com');
    }
    current.apiBaseUrl = next;
  }
  if (input.apiUser !== undefined) current.apiUser = input.apiUser.trim();
  if (input.companyRef !== undefined) current.companyRef = input.companyRef.trim();
  if (input.hedgeCurrency !== undefined) current.hedgeCurrency = input.hedgeCurrency.trim().toUpperCase() || DEFAULTS.hedgeCurrency;
  if (input.hedgeCounterCurrency !== undefined) current.hedgeCounterCurrency = input.hedgeCounterCurrency.trim().toUpperCase() || DEFAULTS.hedgeCounterCurrency;
  if (input.marginHedgePercent !== undefined) current.marginHedgePercent = Math.min(100, Math.max(0, input.marginHedgePercent));
  if (input.paymentDateBufferDays !== undefined) current.paymentDateBufferDays = Math.max(0, Math.round(input.paymentDateBufferDays));
  if (input.dailyHedgeLimitUsd !== undefined) current.dailyHedgeLimitUsd = Math.max(0, input.dailyHedgeLimitUsd);
  if (input.valueDateRounding !== undefined) current.valueDateRounding = input.valueDateRounding;
  if (input.hedgeCodPrepay !== undefined) current.hedgeCodPrepay = input.hedgeCodPrepay;
  if (input.amountBasis !== undefined) current.amountBasis = input.amountBasis;

  settings.kantoxSettings = current;
  await db
    .update(tenants)
    .set({ settings, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));

  return getKantoxSettingsView(tenantId);
}
