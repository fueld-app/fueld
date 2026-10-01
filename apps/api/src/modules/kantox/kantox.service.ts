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

import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  activityLogs,
  integrationCredentials,
  kantoxHedgeEntries,
  orders,
  tenants,
  type TenantSettings,
} from '../../db/schema';
import { getPreciseFxRate } from '../prices/price.service';
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
  rounding?: NonNullable<TenantSettings['kantoxSettings']>['valueDateRounding'];
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
  } else if (rounding === 'MONTH_END') {
    // Pierre's choice (01/10/2026): "round up Value Dates to the last opening
    // date of the month" — one settlement a month, at month end. Note this is
    // NOT the existing MONTHLY mode below, which jumps to the FIRST of the NEXT
    // month.
    //
    // "Last OPENING date" implies business days, but only the CALENDAR month end
    // is knowable here: this function is pure and has no holiday calendar, so a
    // public holiday on the last day would be missed. That coincides with
    // Pierre's own example (Oct 2026 → 30/10, a Friday) and is recorded as an
    // accepted limitation rather than silently pretending to be calendar-aware.
    d.setUTCMonth(d.getUTCMonth() + 1, 0);
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
 *  (TEST-A + TEST-A#C1 → bucket netted 0.0).
 *
 *  Used for the INITIAL (unscheduled) and PO legs. Lifecycle closes do NOT go
 *  through here: they are sequenced per parent from the children already on file
 *  (see nextLifecycleSeq), because two closes on one parent must not both pick
 *  the same suffix. The AMEND and REISSUE branches are retained for the planned
 *  amend/re-push path; nothing calls them today. */
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
    .where(and(eq(kantoxHedgeEntries.tenantId, tenantId), eq(kantoxHedgeEntries.orderId, orderId)))
    // Insertion order: a payment is consumed across the open entries oldest
    // first, so which tranche it closes must be deterministic rather than
    // whatever the planner returns.
    .orderBy(asc(kantoxHedgeEntries.createdAt), asc(kantoxHedgeEntries.id));
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
  /** Booking rate at deal creation, sent as `entry_rate`/`entry_rate_pair`.
   *  Kantox compares it against spot at reception for pricing-risk analytics
   *  (asked 09/09, re-confirmed 29/09: "very useful to receive for Analytics
   *  later if you are able to send it"). Only INITIAL pushes carry it — a
   *  lifecycle close has no "booking rate", and the original entry already
   *  supplied one. NOTE the semantic we are accepting: we push at CONFIRMED, so
   *  this is the rate at confirmation, not at a separate "deal creation" step.
   *  A typed per-order rate would only earn its keep if the booked rate actually
   *  diverges (see docs/kantox-emails-2026-09-30.md). */
  entryRate?: number;
  entryRatePair?: string;
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

  // Largest-remainder allocation: give every tranche its floor in cents, then
  // hand the leftover cents to the shares with the biggest fractional part.
  //
  // The previous "last tranche absorbs the rounding" approach could OVER-hedge:
  // each of the first n-1 shares rounded up by up to half a cent, and if the last
  // share was smaller than that accumulated overshoot it went negative and was
  // dropped by the `> 0` filter — leaving the kept parts summing to MORE than the
  // input (10 tranches of $0.05 summed to $0.09). Largest-remainder keeps the sum
  // exact for every input, which is the property the caller relies on.
  const totalCents = Math.round(amount * 100);
  const exact = usable.map((t) => (totalCents * (t.percent ?? 0)) / totalPercent);
  const floors = exact.map((value) => Math.floor(value));
  let leftover = totalCents - floors.reduce((sum, value) => sum + value, 0);
  // Distribute leftover cents to the largest fractional parts (stable order).
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  for (const { index } of order) {
    if (leftover <= 0) break;
    floors[index] = (floors[index] ?? 0) + 1;
    leftover -= 1;
  }

  const kept = usable
    .map((t, index) => ({
      dueDays: Math.max(0, Math.round(t.dueDays ?? 0)),
      amount: (floors[index] ?? 0) / 100,
    }))
    .filter((share) => share.amount > 0)
    .map((share, i) => ({ refIndex: i + 1, amount: share.amount, dueDays: share.dueDays }));
  return kept.length > 0 ? kept : null;
}

export function buildHedgePlan(
  snap: KantoxOrderSnapshot,
  settings: Pick<KantoxSettingsResolved, 'marginHedgePercent' | 'paymentDateBufferDays' | 'valueDateRounding' | 'hedgeCurrency' | 'hedgeCounterCurrency'>
    // Injected rather than read from the FX module here, so this stays a pure
    // function (like deriveValueDate) and can be tested without a live feed.
    & { bookingRate?: number },
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

  // Booking rate for `entry_rate`, supplied by the caller (see the settings
  // param). The feed reports USD-per-unit — base USD — so the EUR figure IS the
  // EURUSD quote Kantox itself reports (verified live: our 564/565 entries came
  // back `rate: 1.1461` beside `hedgedRate: 1.1449`). Omitted, never guessed,
  // when the caller has no real rate to give.
  const bookingRate = settings.bookingRate;
  const entryRate = bookingRate != null && Number.isFinite(bookingRate) && bookingRate > 0 ? bookingRate : undefined;
  const entryRatePair = entryRate != null ? `${(settings.hedgeCounterCurrency ?? '').toUpperCase()}${USD}` : undefined;

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
        // A per-tranche ref, ALWAYS suffixed when a schedule is present. Reusing
        // the base ref for several amounts would collide (later pushes skipped as
        // already claimed), and reusing it for a single-tranche schedule would
        // let a re-CONFIRM claim the same ref as a pre-schedule hedge with a
        // different payload. The bare `#S` is reserved for orders with no
        // schedule, so unscheduled behaviour is unchanged.
        entryRef: `${orderNumberSafe(orderRef)}#S${split.refIndex}`,
        ...(entryRate != null ? { entryRate, entryRatePair } : {}),
      }))
    : [{
        leg: 'SO',
        direction: 'SELL' as const,
        amount: soAmount.toFixed(2),
        amountBasis: soAmount.toFixed(2),
        valueDate,
        entryRef: entryRef(orderNumberSafe(orderRef), 'SO', undefined, 'INITIAL', 0),
        ...(entryRate != null ? { entryRate, entryRatePair } : {}),
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
      ...(entryRate != null ? { entryRate, entryRatePair } : {}),
    })),
  ];
  return { entries };
}

function orderNumberSafe(orderNumber: string | null): string {
  return orderNumber ?? 'order';
}

/**
 * Mark an entry SENT and advance its parent's cancelled total.
 *
 * Both halves must happen together and only once, wherever the child reaches
 * SENT — including when the SYNC LOOP is what finally pushes it after a failure.
 * Splitting them (child set by the pusher, parent bumped by whoever remembers to)
 * is what let a payment read as still-open locally after Kantox had closed it.
 * The bump is guarded on the child's own status transition, so a retry cannot
 * double-count.
 */
async function markSent(
  rowId: string,
  patch: { kantoxEntryId?: string | null; kantoxPositionRef?: string | null; errorMessage?: string | null },
): Promise<void> {
  const transitioned = await db
    .update(kantoxHedgeEntries)
    .set({ status: 'SENT', updatedAt: new Date(), ...patch })
    // Only from a state that has NOT yet been counted: PENDING_SEND (first send)
    // or FAILED (retry). Guarding merely on `<> SENT` would let a HEDGED row be
    // downgraded to SENT and re-advance its parent — the "exactly once" invariant
    // must hold from the states the callers can actually present, not by trusting
    // them to.
    .where(and(
      eq(kantoxHedgeEntries.id, rowId),
      inArray(kantoxHedgeEntries.status, ['PENDING_SEND', 'FAILED']),
    ))
    .returning({ parentEntryId: kantoxHedgeEntries.parentEntryId, amount: kantoxHedgeEntries.amount });
  const child = transitioned[0];
  if (!child?.parentEntryId) return;
  // Clamp at the parent's own amount. Two payments recorded at once both read the
  // same snapshot, so both can plan a close against one entry; without a ceiling
  // the local cancelled total could exceed what was ever hedged, and the NEXT
  // payment would then size its close off inflated figures. Kantox-side protection
  // is separate (refs + reconciliation); this keeps the books from lying.
  await db
    .update(kantoxHedgeEntries)
    .set({
      cancelledAmount: sql`least(${kantoxHedgeEntries.amount}, ${kantoxHedgeEntries.cancelledAmount} + ${Math.abs(Number(child.amount))})`,
      updatedAt: new Date(),
    })
    .where(eq(kantoxHedgeEntries.id, child.parentEntryId));
}

// ── push orchestration (insert-claim-CAS-send, never blocks the caller) ──

async function pushPlannedEntry(
  tenantId: string,
  resolved: KantoxSettingsResolved,
  planned: PlannedHedgeEntry,
  ctx: { orderId: string; orderItemId?: string | null; orderSupplierId?: string | null; kind: 'INITIAL' | 'CANCEL' | 'AMEND' | 'REISSUE'; notes: string; retryCount?: number },
  // `false` means the ref was already claimed and NOTHING was sent. Callers must
  // not count that as a push: the whole reason this matters is that a silently
  // skipped entry (every tranche after the first, before the index was widened)
  // left exposure unhedged with only a console line to show for it.
): Promise<boolean> {
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
        // Persist the booking rate so a retry re-sends the rate captured at the
        // original push, not whatever the feed says 15 minutes later — the whole
        // point of `entry_rate` is the rate the deal was booked at.
        ...(planned.entryRate != null
          ? { entryRate: String(planned.entryRate), entryRatePair: planned.entryRatePair }
          : {}),
      })
      .returning({ id: kantoxHedgeEntries.id });
    rowId = row.id;
  } catch (err: any) {
    if (/duplicate key|unique/i.test(String(err?.message ?? err))) {
      console.error(`[Kantox] ${planned.entryRef} already claimed — skipping`);
      return false;
    }
    throw err;
  }

  // CAS: PENDING_SEND → SENDING (atomic claim)
  const claimed = await db
    .update(kantoxHedgeEntries)
    .set({ status: 'SENDING', updatedAt: new Date() })
    .where(and(eq(kantoxHedgeEntries.id, rowId), eq(kantoxHedgeEntries.status, 'PENDING_SEND')))
    .returning({ id: kantoxHedgeEntries.id });
  // Lost the CAS: another runner claimed this row, so THIS call sent nothing.
  if (claimed.length === 0) return false;

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
      ...(planned.entryRate != null
        ? { entryRate: String(planned.entryRate), entryRatePair: planned.entryRatePair }
        : {}),
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
      // The ref exists on Kantox, so the exposure is covered — count it.
      return true;
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
  return true;
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
    // The booking rate is captured HERE, at push time, and from the live feed:
    // it is the rate the exposure is actually being hedged at. A typed
    // per-order rate would only be needed if the booked rate genuinely diverged.
    // getPreciseFxRate, NOT getFxRate: the latter returns the display-rounded
    // figure (round2), which reports EURUSD as 1.14 against a real 1.1370 — a
    // ~0.44% error on a ~1.14 pair, which would swamp the very rate-vs-spot
    // comparison Kantox asked for. It returns undefined when nothing is loaded,
    // so an unknown rate is omitted rather than sent as a parity claim.
    const counterCode = (resolved.hedgeCounterCurrency ?? '').toUpperCase();
    const bookingRate = counterCode && counterCode !== USD ? getPreciseFxRate(counterCode) : undefined;
    const plan = buildHedgePlan(snap, { ...resolved, bookingRate });
    if (plan.skipped || plan.entries.length === 0) {
      console.log(`[Kantox] order ${order.orderNumber ?? order.id} not hedged: ${plan.skipped}`);
      return;
    }
    let sent = 0;
    const skipped: string[] = [];
    for (const planned of plan.entries) {
      const pushed = await pushPlannedEntry(order.tenantId, resolved, planned, {
        orderId: order.id,
        kind: 'INITIAL',
        notes: `Fueld order ${order.orderNumber ?? order.id}`,
      });
      if (pushed) sent += 1;
      else skipped.push(planned.entryRef);
    }
    await logActivity({
      userId: null, // system-initiated (order-status hook), not a user action
      tenantId: order.tenantId,
      action: 'KANTOX_PUSH',
      entityType: 'kantox_hedge_entry',
      entityId: order.id,
      // Record what was actually SUBMITTED, not what was planned: an entry whose
      // ref was already claimed was not sent, and a log that says otherwise
      // hides unhedged exposure.
      metadata: {
        entryCount: sent,
        plannedCount: plan.entries.length,
        ...(skipped.length > 0 ? { skippedRefs: skipped } : {}),
        orderNumber: order.orderNumber,
      },
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
    for (const row of rows) {
      if (row.status === 'CANCELLED' || row.status === 'CLOSED') continue;
      // A FAILED entry may never have reached Kantox, so cancelling it would send
      // a negative for exposure that was never opened — a naked opposite position.
      // It cannot be told apart from "landed but the response was lost" without
      // asking Kantox, and the sync loop now reconciles duplicate refs instead of
      // stranding them, so a genuinely-live failed entry is resolved there.
      // Leaving it alone is the conservative choice: an un-cancelled hedge is a
      // position Pierre can close by hand, a naked short is a new trade.
      if (row.status === 'FAILED') continue;
      const remaining = Number(row.amount) - Number(row.cancelledAmount);
      if (remaining <= 0) continue;
      const planned: PlannedHedgeEntry = {
        leg: row.leg,
        direction: row.direction as 'BUY' | 'SELL',
        amount: (-remaining).toFixed(2),
        amountBasis: '0.00',
        valueDate: row.valueDate ?? undefined,
        entryRef: `${row.entryRef}C${nextLifecycleSeq(row.entryRef, rows.map((r) => r.entryRef), 'C')}`,
      };
      await pushLifecycleEntry(tenantId, resolved, planned, { orderId, kind: 'CANCEL', parentRowId: row.id, notes: `Fueld cancel ${row.entryRef}`, baseRef: row.entryRef });
    }
  } catch (err) {
    console.error(`[Kantox] onOrderCancelled failed for order ${orderId} — non-fatal:`, err);
  }
}

/**
 * Sequence number for the NEXT lifecycle (cancel/amend) entry on a parent row.
 *
 * Derived from how many such children already exist, NOT from the parent's
 * `retryCount`: that only advances when the parent's own send fails, so two
 * partial payments against one open leg both produced `...C1`. Kantox rejects a
 * repeated ref even with a different payload, and the lifecycle push swallows
 * the failure — so the second payment would silently close nothing.
 */
export function nextLifecycleSeq(entryRef: string, existingRefs: string[], tag: 'C' | 'A' | 'R'): number {
  const prefix = `${entryRef}${tag}`;
  let highest = 0;
  for (const ref of existingRefs) {
    if (!ref.startsWith(prefix)) continue;
    const n = Number.parseInt(ref.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > highest) highest = n;
  }
  return highest + 1;
}

/**
 * Consume a payment across the order's open sell entries, oldest first.
 *
 * This is the part `closeDeltaForPayment` cannot do alone: that function sizes
 * ONE closure, while the order may hold several sell entries (split payment
 * terms hedge one per tranche). Handing the full payment to each entry
 * over-cancels — a 50k payment against two 50k entries would extinguish 100k of
 * exposure, and an over-cancel creates a position in the opposite direction.
 * Returns the entries to close, in order, with the amount for each.
 */
export function planPaymentClosures(
  entries: Array<{ amount: number; cancelled: number }>,
  paymentAmount: number,
): Array<{ index: number; delta: number }> {
  // Only a POSITIVE receipt relieves exposure. A zero or negative amount is not
  // a payment (it is a correction or a refund), and treating its magnitude as a
  // receipt would close a hedge that is still open.
  if (!(paymentAmount > 0)) return [];
  let unapplied = paymentAmount;
  const plan: Array<{ index: number; delta: number }> = [];
  for (let index = 0; index < entries.length && unapplied > 0; index++) {
    const entry = entries[index]!;
    const delta = closeDeltaForPayment(entry.amount, entry.cancelled, unapplied);
    if (delta === 0) continue;
    unapplied -= Math.abs(delta);
    plan.push({ index, delta });
  }
  return plan;
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
    // 'closed' has TWO meanings on this table — settled-by-payment (this path)
    // and executed-at-Kantox (the sync reconciler) — and both correctly mean
    // "send no further delta". A close is a NEGATIVE entry: it does not settle
    // the hedge, it opens an opposite one. Once Kantox has executed the hedge
    // there is nothing left to net against, so a close sent here would be a
    // naked new position. This is why the reconciler mapping `closed` protects
    // the money: before it, an executed-but-unpaid hedge stayed SENT and a later
    // customer payment would fire exactly that close.
    // (Same guard, same reason as onOrderCancelledForKantox below.)
    const sellRows = rows.filter((r) => r.direction === 'SELL' && (r.status === 'SENT' || r.status === 'HEDGED'));
    if (sellRows.length === 0) return; // nothing open (e.g. payment before push)
    // A payment must be CONSUMED across the order's open sell entries, not
    // applied in full to each: a split-terms order hedges one entry per tranche,
    // and passing the whole payment to every entry would over-cancel (a 50k
    // payment against two 50k entries would extinguish 100k of exposure — the
    // over-cancel that creates an opposite position). Oldest entry first, which
    // matches the order the exposure was hedged in.
    // Pass the amount UNCHANGED: the helper decides what counts as a receipt. An
    // abs() here would hand a refund to the helper as a positive receipt and
    // defeat its own guard.
    // Derive each entry's already-closed amount from its OWN lifecycle children
    // rather than trusting the parent's cached `cancelledAmount`. That cache is
    // advanced when a child reaches SENT, and a child whose send landed at Kantox
    // but whose response was lost stays FAILED until the (15-minute) sync tick —
    // so in that window the cache understates what is already closed, and a
    // further payment would plan a close against phantom exposure. Counting the
    // children on file is the same figure without the lag.
    const closedBySeq = new Map<string, number>();
    for (const child of rows) {
      if (!child.parentEntryId) continue;
      if (child.status !== 'SENT' && child.status !== 'HEDGED') continue;
      closedBySeq.set(child.parentEntryId, (closedBySeq.get(child.parentEntryId) ?? 0) + Math.abs(Number(child.amount)));
    }
    const plan = planPaymentClosures(
      sellRows.map((row) => ({
        amount: Number(row.amount),
        cancelled: closedBySeq.get(row.id) ?? 0,
      })),
      paymentAmount,
    );
    // Every ref on file, so each close gets its own sequence rather than
    // colliding with a previous payment's cancel.
    const existingRefs = rows.map((r) => r.entryRef);
    for (const { index: planIndex, delta } of plan) {
      const row = sellRows[planIndex]!;
      const planned: PlannedHedgeEntry = {
        leg: row.leg,
        direction: 'SELL',
        amount: delta.toFixed(2),
        amountBasis: '0.00',
        valueDate: row.valueDate ?? undefined,
        entryRef: `${row.entryRef}C${nextLifecycleSeq(row.entryRef, existingRefs, 'C')}`,
      };
      // Record the ref we just used, so a second close in this same pass does
      // not pick the same sequence.
      existingRefs.push(planned.entryRef);
      await pushLifecycleEntry(tenantId, resolved, planned, { orderId, kind: 'CANCEL', parentRowId: row.id, notes: `Fueld payment close ${row.entryRef}`, baseRef: row.entryRef });
      // `cancelledAmount` is advanced by markSent when the child reaches SENT —
      // bumping it here as well would double-count. This only closes the parent
      // once the child's own amount has carried it to fully closed.
      const newCancelled = Number(row.cancelledAmount) + Math.abs(delta);
      if (newCancelled >= Number(row.amount)) {
        await db
          .update(kantoxHedgeEntries)
          .set({ status: 'CLOSED' as const, updatedAt: new Date() })
          .where(and(eq(kantoxHedgeEntries.id, row.id), ne(kantoxHedgeEntries.status, 'CLOSED')));
      }
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
  ctx: { orderId: string; kind: 'CANCEL' | 'AMEND' | 'REISSUE'; parentRowId?: string; notes: string; baseRef?: string },
): Promise<void> {
  // A lifecycle ref is derived by counting the children already on file, which is
  // a snapshot — two closes racing on one parent can pick the same sequence, and
  // the unique index now rejects the loser at insert. Losing the race must not
  // silently drop a real close, so retry once with a freshly counted sequence.
  // (The insert is the only thing retried; the parent bump happens on SENT.)
  let insertRef = planned.entryRef;
  let inserted: { id: string } | undefined;
  for (let attempt = 0; attempt < 2 && !inserted; attempt++) {
    try {
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
          entryRef: insertRef,
          kind: ctx.kind,
          status: 'PENDING_SEND',
          notes: ctx.notes,
          parentEntryId: ctx.parentRowId ?? null,
        })
        .returning({ id: kantoxHedgeEntries.id });
      inserted = row;
    } catch (err: any) {
      if (!/duplicate key|unique/i.test(String(err?.message ?? err))) throw err;
      if (attempt > 0) throw err; // second collision is not a race — surface it
      // Someone else took this ref: recount against what is now on file.
      const rows = await db
        .select({ entryRef: kantoxHedgeEntries.entryRef })
        .from(kantoxHedgeEntries)
        .where(and(eq(kantoxHedgeEntries.tenantId, tenantId), eq(kantoxHedgeEntries.orderId, ctx.orderId)));
      // The base ref is the parent's own ref; the caller knows it, so no
      // re-parsing of the suffixed ref is needed.
      const baseRef = ctx.baseRef ?? planned.entryRef;
      const tag = ctx.kind === 'CANCEL' ? 'C' : ctx.kind === 'AMEND' ? 'A' : 'R';
      insertRef = `${baseRef}${tag}${nextLifecycleSeq(baseRef, rows.map((r) => r.entryRef), tag)}`;
    }
  }
  if (!inserted) throw new Error(`[Kantox] could not claim a lifecycle ref for ${planned.entryRef}`);
  const row = inserted;

  try {
    const entry = await makeClient(resolved).submitEntry({
      companyRef: resolved.companyRef,
      entryRef: insertRef,
      marketDirection: planned.direction === 'SELL' ? 'sell' : 'buy',
      currency: resolved.hedgeCurrency,
      counterCurrency: resolved.hedgeCounterCurrency,
      amount: planned.amount,
      valueDate: planned.valueDate,
      notes: ctx.notes,
    });
    await markSent(row.id, { kantoxEntryId: entry.reference, kantoxPositionRef: entry.positionRef });
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

/** Map a Kantox entry → our row status. Unknown values leave the row
 *  untouched, so a new Kantox status can never downgrade a row we already
 *  settled.
 *
 *  Confirmed by Clément 29/09/2026 (`docs/kantox-emails-2026-09-30.md`, Q4):
 *  `in_position` = still monitoring the conditional order (TP/SL set),
 *  `pending` = Pierre must execute manually on the platform, and an entry shows
 *  `closed` **only once the order has executed**. So `closed` is terminal —
 *  nothing is left for Pierre to do on it.
 *
 *  Missing this mapping was not cosmetic. `findLateHedgeEntries()` treats any
 *  open row past its value date as late, so an entry Kantox had already closed
 *  kept raising false late-payment flags to Pierre once its value date passed.
 *  Worse for money: an executed-but-unpaid hedge stayed SENT, and
 *  `onCustomerPaymentForKantox` then treated the later customer payment as a
 *  delta to close — sending a NEGATIVE entry, which opens an opposite position
 *  rather than settling anything. CLOSED is what makes that path skip it.
 *
 *  `closed` is matched by EQUALITY, not `includes`: a false positive here
 *  silences a real late-payment flag, so a future status like `not_closed` or
 *  `pending_closure` must never read as terminal.
 *
 *  EVERY `closed` ENTRY IS EXECUTED — there is no "cancelled close". Confirmed
 *  by Clément 01/10/2026 (`docs/kantox-emails-2026-10-01.md`): "An entry cannot
 *  be Closed without being executed. It can be cancelled before being executed.
 *  If it has been executed (closed) status the only way to cancel it is to send
 *  a new entry with inverted sign/amount." Cancellation is therefore something
 *  WE SEND (the `…C{n}` close entries), never a status Kantox reports.
 *
 *  An earlier cut of this function read a reasonless `closed` as CANCELLED, on
 *  the theory that `executionReason` distinguishes the two. That inference is
 *  unsound: a null reason on a closed entry does not mean cancelled, it means
 *  only that the field is absent — and treating it as CANCELLED would suppress
 *  BOTH the late-payment flag and the payment close on a hedge that really did
 *  execute. `executionReason` is still read, for nothing more than a warning. */
export function mapKantoxStatus(
  entryStatus: string | null,
  executionReason?: string | null,
): 'HEDGED' | 'CLOSED' | 'CANCELLED' | null {
  if (!entryStatus) return null;
  const s = entryStatus.trim().toLowerCase();
  if (s === 'closed') {
    // Kantox guarantees an executed entry is closed, so CLOSED is correct
    // regardless. Warn anyway: if a reasonless closed entry ever appears it
    // contradicts the observed data (every live executed entry carries a
    // reason) and is worth looking at before trusting it further.
    if (!executionReason) {
      console.warn('[Kantox] closed entry carries no executionReason — treating as CLOSED (per Kantox: closed implies executed)');
    }
    return 'CLOSED';
  }
  // 'cancelled' is not a documented Kantox status, but map it defensively: our
  // own model has the state, and if Kantox ever did report it we want it, not a
  // silently-open row.
  if (s === 'cancelled' || s === 'canceled') return 'CANCELLED';
  // Legacy guesses from before the enum was known, kept as a belt-and-braces
  // terminal mapping. 'execut' also matches `unexecuted` / `execution_failed`,
  // neither of which is terminal — so this is a genuine hazard, not a safe
  // fallback. No live status matches it today (the observed enum is
  // closed/in_order/in_position/accumulating), so it is dead weight that can
  // misfire; remove it once a few weeks pass with no hit.
  if (s.includes('hedg') || s.includes('execut')) return 'HEDGED';
  return null; // 'in_position', 'in_order', 'accumulating', 'pending' stay open
}

/** The local row fields the reconciler reads. A subset of the row so this stays
 *  testable without a database. */
export interface ReconcilableHedgeRow {
  status: string;
  hedgedRate: string | number | null;
  executionRate: string | number | null;
  /** ISO 'YYYY-MM-DD' as stored; Kantox returns 'DD/MM/YYYY'. */
  valueDate: string | null;
}

/** Kantox responses date as DD/MM/YYYY ('02/11/2026'); we store ISO
 *  ('YYYY-MM-DD'). Returns null rather than a guess for anything unparseable —
 *  a wrong date here moves a late-payment flag. */
function toIsoDate(remote: string | null): string | null {
  if (!remote) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(remote.trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Both rate columns are `numeric(14, 8)`, but Kantox returns up to 9 decimals
 *  (`hedgedRate: 1.144906585`). The stored value is therefore always the ROUNDED
 *  one (`1.14490659`), so a plain `stored !== remote` can never converge — it
 *  re-wrote `hedged_rate` and `updated_at` on every one of the 15-minute ticks,
 *  for every row that has a rate. Compare at the column's own precision instead:
 *  a difference below the last representable digit is not a change (verified:
 *  the rounding error is at most 5e-9, so 1e-8 clears it), and a genuine change
 *  at that precision (a roll to a new rate) still writes. */
const RATE_EPSILON = 1e-8;

function rateChanged(stored: string | number | null, remote: number | null): boolean {
  if (remote == null) return false;
  // No stored value at all is always a change — comparing it as 0 would silently
  // drop a genuine remote rate that happens to round below 1e-8.
  if (stored == null) return true;
  return Math.abs(Number(stored) - remote) >= RATE_EPSILON;
}

/** The only fields the reconciler ever writes. Typed against the table so a
 *  mistyped column is a compile error rather than a silently dropped update. */
export type ReconcileUpdate = Partial<
  Pick<typeof kantoxHedgeEntries.$inferInsert, 'status' | 'hedgedRate' | 'executionRate' | 'valueDate' | 'updatedAt'>
>;

/**
 * What (if anything) to write for one row from its Kantox entry.
 *
 * Rules, each with a reason:
 *  - Status moves only to a status we recognise, and only when it differs.
 *    Unknown statuses return null, so a new Kantox value can never downgrade a
 *    row we already settled (a terminal row is also never re-read — callers
 *    skip anything that is not SENT/HEDGED).
 *  - Rate writes are change-only, at the column's precision, so a reconcile
 *    that finds nothing new does not churn `updated_at` every 15 minutes.
 *  - `executionRate` must additionally be POSITIVE to be written. Kantox returns
 *    0.0 on entries executed by client request (`executionReason`
 *    `execution_requested_by_client`) while every take-profit execution carries
 *    a real rate — see docs/kantox-emails-2026-09-30.md Q5. 0.0 means "not
 *    populated on this execution path", not "executed at zero", so it must not
 *    overwrite a real rate. Latent, not observed: the 0.0 rows on file have no
 *    real rate to lose yet, but the take-profit rows would.
 */
export function reconcileUpdates(
  row: ReconcilableHedgeRow,
  remote: Pick<KantoxEntry, 'entryStatus' | 'hedgedRate' | 'executionRate' | 'executionReason' | 'valueDate'>,
): ReconcileUpdate {
  const updates: ReconcileUpdate = {};
  const mapped = mapKantoxStatus(remote.entryStatus, remote.executionReason);
  if (mapped && mapped !== row.status) updates.status = mapped;
  // A ROLL keeps the same entryRef and changes only the value date (Clément,
  // 01/10/2026: "An entry that is rolled keep the same entryRef, the only
  // difference is the new VD"). Without this the stored date goes stale after a
  // roll and the late-payment flag keys off a date Kantox no longer uses.
  // Only written when the stored value is actually different, and only from a
  // parseable remote date — a malformed one must not blank a good local date.
  const remoteDate = toIsoDate(remote.valueDate);
  if (remoteDate && remoteDate !== row.valueDate) updates.valueDate = remoteDate;
  // The RAW remote value is written, and Postgres rounds it to the column's 8
  // decimals. Deliberately NOT `Number.prototype.toFixed(8)`: on a double,
  // 1.144906585.toFixed(8) is "1.14490658" (the stored double is a hair below
  // the decimal), whereas Postgres rounds the decimal string to "…659". Verified
  // against the real column — toFixed would store an off-by-one-in-the-8th digit
  // rate for no benefit. Convergence does not depend on which is written, because
  // `rateChanged` compares at the column's precision either way.
  if (rateChanged(row.hedgedRate, remote.hedgedRate)) updates.hedgedRate = String(remote.hedgedRate);
  if (remote.executionRate != null && remote.executionRate > 0 && rateChanged(row.executionRate, remote.executionRate)) {
    updates.executionRate = String(remote.executionRate);
  }
  return updates;
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
          // Re-send the rate stored at the original push. A retry must not
          // silently swap in the current feed rate — Kantox compares entry_rate
          // against spot, and the stored value is the booking rate.
          ...(row.entryRate != null
            ? { entryRate: String(row.entryRate), entryRatePair: row.entryRatePair ?? `${row.counterCurrency}${row.currency}` }
            : {}),
        });
        await markSent(row.id, { kantoxEntryId: entry.reference, kantoxPositionRef: entry.positionRef });
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
          // Re-send the rate stored at the original push. A retry must not
          // silently swap in the current feed rate — Kantox compares entry_rate
          // against spot, and the stored value is the booking rate.
          ...(row.entryRate != null
            ? { entryRate: String(row.entryRate), entryRatePair: row.entryRatePair ?? `${row.counterCurrency}${row.currency}` }
            : {}),
        });
        await markSent(row.id, { kantoxEntryId: entry.reference, kantoxPositionRef: entry.positionRef, errorMessage: null });
      }
    } catch (err: any) {
      // A duplicate ref means Kantox ALREADY holds this entry — the send landed
      // and only the response was lost. Treat it exactly as pushPlannedEntry does:
      // mark SENT (which advances the parent) rather than burning retries to
      // FAILED. This matters more than it used to: closes now get a FRESH ref per
      // attempt, so a stranded child would leave the parent reading open while
      // Kantox had closed it, and the next payment would then over-cancel.
      if (err instanceof KantoxDuplicateRefError) {
        await markSent(row.id, { errorMessage: 'dedup hit — reconciling via GET entries' });
        continue;
      }
      const bump = { retryCount: (row.retryCount ?? 0) + 1, errorMessage: String(err?.message ?? err).slice(0, 500), updatedAt: new Date() };
      // A SENDING row is one whose push claimed it and then the process died, or
      // whose response was lost with a non-duplicate error. NOTHING else in the
      // system ever re-pushes it: the retry branch above only admits FAILED, and
      // markSent only admits PENDING_SEND/FAILED. Before this, such a row was
      // stranded forever and its parent's exposure never recovered. There is no
      // retryCount bump here (the row was never counted as a failed attempt) —
      // the attempt count advances only when the push itself fails.
      if (row.status === 'SENDING') {
        await db
          .update(kantoxHedgeEntries)
          .set({ status: 'PENDING_SEND', updatedAt: new Date() })
          .where(and(eq(kantoxHedgeEntries.id, row.id), eq(kantoxHedgeEntries.status, 'SENDING')));
        continue;
      }
      if (row.retryCount + 1 >= MAX_RETRIES) await db.update(kantoxHedgeEntries).set({ ...bump, status: 'FAILED' }).where(eq(kantoxHedgeEntries.id, row.id));
      else if (row.status === 'PENDING_SEND') await db.update(kantoxHedgeEntries).set(bump).where(eq(kantoxHedgeEntries.id, row.id));
    }
  }

  // 2. Reconcile statuses from GET entries (per-entry hedgedRate etc).
  //    `candidates` is re-read after this step, because step 3 decides lateness
  //    from the row statuses and step 2 is what moves them to CLOSED. Using the
  //    pre-step-2 snapshot leaves exactly one tick (15 minutes) in which a hedge
  //    Kantox has already executed is still read as open and flagged late to
  //    Pierre — the very false flag this reconcile exists to stop.
  try {
    const remote = await client.listEntries();
    const byRef = new Map(remote.map((e) => [e.entryRef, e]));
    for (const row of candidates) {
      if (row.status !== 'SENT' && row.status !== 'HEDGED') continue;
      const remoteEntry = byRef.get(row.entryRef);
      if (!remoteEntry) continue;
      const updates = reconcileUpdates(row, remoteEntry);
      if (Object.keys(updates).length > 0) {
        await db
          .update(kantoxHedgeEntries)
          .set({ ...updates, updatedAt: new Date() })
          .where(eq(kantoxHedgeEntries.id, row.id));
      }
    }

    // 2b. Remote entries with no local row. Nothing in this service INSERTS a
    //     row for a Kantox entry it did not push, so an entry created on the
    //     platform — a manual roll by Pierre, or a push that never landed and
    //     was never retried — is invisible to Fueld: no leg on the order card,
    //     no payment planning, no late flag. That silence is the one hedge
    //     failure mode with no alert anywhere.
    //     Deliberately an ALERT, not an auto-insert: the local row needs the
    //     deal context (order, leg, basis) that only the original push knows,
    //     and inventing it would feed the payment planner rows it cannot place.
    //     `entityId` is a uuid column, so the ref rides in metadata.
    const localRefs = new Set(candidates.map((r) => r.entryRef));
    const unmatched = remote.filter((e) => !localRefs.has(e.entryRef));
    if (unmatched.length > 0) {
      // Same dedup shape as the late flag, but its OWN action: keying on
      // (ref, value date) stops this repeating every 15 minutes forever, and
      // sharing the late-payment action would collide with that dedup.
      const refs = unmatched.map((e) => e.entryRef);
      // `inArray` over a SQL expression, NOT `= ANY(${refs})`: drizzle does not
      // bind a JS array into a `sql` placeholder (it passes the array through as
      // one parameter, producing a malformed `ANY(($3))`), so the array form
      // silently never matched. Verified against real SQL.
      const alreadyFlagged = await db
        .select({ metadata: activityLogs.metadata })
        .from(activityLogs)
        .where(
          and(
            eq(activityLogs.tenantId, tenantId),
            eq(activityLogs.action, 'KANTOX_UNMATCHED_ENTRY'),
            inArray(sql`${activityLogs.metadata}->>'entryRef'`, refs),
          ),
        );
      const flagged = new Set(
        alreadyFlagged.map((r) => {
          const m = r.metadata as { entryRef?: string; valueDate?: string } | null;
          return `${m?.entryRef ?? ''}|${m?.valueDate ?? ''}`;
        }),
      );
      for (const entry of unmatched) {
        if (flagged.has(`${entry.entryRef}|${entry.valueDate ?? ''}`)) continue;
        await logActivity({
          userId: null,
          tenantId,
          action: 'KANTOX_UNMATCHED_ENTRY',
          entityType: 'kantox_hedge_entry',
          entityId: null, // uuid column — the ref is not a uuid
          metadata: {
            entryRef: entry.entryRef,
            valueDate: entry.valueDate,
            amount: entry.amount,
            currency: entry.currency,
            entryStatus: entry.entryStatus,
            positionRef: entry.positionRef,
            note: 'Kantox holds this entry but Fueld has no matching row — a platform-side roll, or a push that never landed',
          },
        });
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
    // Post-reconcile statuses, not the snapshot taken before step 2.
    const current = await db
      .select({
        id: kantoxHedgeEntries.id,
        status: kantoxHedgeEntries.status,
        valueDate: kantoxHedgeEntries.valueDate,
        amount: kantoxHedgeEntries.amount,
        cancelledAmount: kantoxHedgeEntries.cancelledAmount,
      })
      .from(kantoxHedgeEntries)
      .where(eq(kantoxHedgeEntries.tenantId, tenantId));
    const lateIds = findLateHedgeEntries(current, today);
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
        const row = current.find((c) => c.id === id);
        if (flagged.has(`${id}|${row?.valueDate ?? ''}`)) continue;
        const [detail] = await db
          .select({ entryRef: kantoxHedgeEntries.entryRef, orderId: kantoxHedgeEntries.orderId })
          .from(kantoxHedgeEntries)
          .where(eq(kantoxHedgeEntries.id, id))
          .limit(1);
        await logActivity({
          userId: null,
          tenantId,
          action: 'KANTOX_LATE_PAYMENT',
          entityType: 'kantox_hedge_entry',
          entityId: id,
          metadata: {
            entryRef: detail?.entryRef ?? null,
            valueDate: row?.valueDate ?? null,
            orderId: detail?.orderId ?? null,
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
