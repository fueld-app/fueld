import { isCommissionableLine } from '@fueld/types';
import type { TenantSettings } from '../../db/schema';
import { toFiniteNumber } from '../../lib/numbers';
import { getFxRate } from '../prices/price.service';

export const DEFAULT_FINANCING_RATE_ANNUAL = 0.08;
export const DEFAULT_FINANCING_DAY_COUNT = 365;

export interface FinancingTermsInput {
  customerPaymentTermType?: string | null;
  customerCreditDays?: number | null;
  supplierPaymentTermType?: string | null;
  supplierCreditDays?: number | null;
  /** Pre-computed effective supplier days from a due-date override (order-financing
   *  callers pass this when the primary supplier leg pins an invoice due date). */
  supplierEffectiveDays?: number | null;
  /**
   * Split payment terms: the order's tranches, as { percent, dueDays } where
   * dueDays is the days from the same anchor the single-term calculation uses
   * (delivery/issue) until that tranche falls due. When present, customer days
   * are computed per tranche instead of from `customerCreditDays`, because the
   * money is collected in instalments and each instalment is financed for its
   * own period.
   */
  customerTranches?: Array<{ percent: number | null; dueDays: number | null }> | null;
}

export interface FinancingItemInput {
  quantity?: string | number | null;
  deliveredQuantity?: string | number | null;
  /** Line type — decides whether a broker deal earns commission on this line. */
  productType?: string | null;
  costPrice?: string | number | null;
  costCurrency?: string | null;
  costConversionFactor?: string | number | null;
  salesPrice?: string | number | null;
  salesCurrency?: string | null;
  unitConversionFactor?: string | number | null;
  // Broker deal — per-line commission rate (falls back to the order-level rate).
  commissionPerUnit?: string | number | null;
}

export interface LineEconomics {
  quantity: number;
  costBase: number;
  revenueBase: number;
  grossProfit: number;
  financingCost: number;
  netProfit: number;
}

export interface DealCommissionInput {
  /** Third-party commission rate per MT (in tpcCurrency). */
  tpcPerMt?: number | string | null;
  tpcCurrency?: string | null;
  /** Trader's own commission, % of (gross − TPC). */
  traderCommissionPct?: number | string | null;
}

export interface OrderEconomics {
  financingRateAnnual: number;
  dayCountConvention: number;
  financingDays: number;
  totalQuantity: number;
  totalCostBase: number;
  totalRevenueBase: number;
  totalGrossProfit: number;
  totalFinancingCost: number;
  financingCostPerMt: number | null;
  totalNetProfit: number;
  netMarginPct: number | null;
  // ── Deal commissions (Mario/Riviera model, applied after gross, before financing) ──
  // TPC total = per-MT rate × MT converted to USD.
  totalTpc: number;
  // Trader commission = traderPct × (gross − TPC), matching the Annexe formula.
  totalTraderCommission: number;
  // Mario's "Total Profit": gross − TPC − trader commission (no financing term).
  tradingProfit: number;
  lineEconomics: LineEconomics[];
}

/** Numeric parse for financing maths. Returns a number (never null) because
 *  every caller here feeds arithmetic; absent/unparsable input is 0.
 *
 *  Delegates the parsing rules to `toFiniteNumber` so this module and the
 *  broker commission report cannot drift apart again — they previously
 *  disagreed on the same columns and produced different money for one deal. */
function parseNumber(value: string | number | null | undefined): number {
  return toFiniteNumber(value) ?? 0;
}

function normalizedCurrency(currency: string | null | undefined): string {
  const code = currency?.trim().toUpperCase();
  return code || 'USD';
}

function getEffectiveQuantity(item: FinancingItemInput): number {
  if (item.deliveredQuantity !== null && item.deliveredQuantity !== undefined) {
    return parseNumber(item.deliveredQuantity);
  }
  return parseNumber(item.quantity);
}

export function getFinancingRateAnnual(settings?: TenantSettings | null): number {
  const value = settings?.financingRateAnnual;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return DEFAULT_FINANCING_RATE_ANNUAL;
}

export function getPaymentTermDays(type?: string | null, creditDays?: number | null): number {
  if (type !== 'CREDIT') return 0;
  return Math.max(0, Math.round(parseNumber(creditDays)));
}

/**
 * Supplier-invoice due-date override (Riviera Marine, 2026-09): some suppliers
 * grant credit from INVOICE RECEIPT rather than delivery, and the system never
 * knows when the supplier invoice was sent. When the trader pins the exact due
 * date printed on the supplier's invoice, financing days derive from it.
 *
 * Returns the effective supplier day count implied by the override, or null
 * when there is no override (caller falls back to credit days). Non-CREDIT
 * terms never produce an effective override.
 */
export function effectiveSupplierDays(input: {
  supplierDueDate?: string | null;
  deliveredAt?: Date | string | null;
  eta?: Date | string | null;
  supplierPaymentTermType?: string | null;
}): number | null {
  if (!input.supplierDueDate) return null;
  if ((input.supplierPaymentTermType ?? '').toUpperCase() !== 'CREDIT') return null;
  const anchor = asDay(input.deliveredAt) ?? asDay(input.eta);
  if (!anchor) return null;
  const due = asDay(input.supplierDueDate);
  if (!due) return null;
  const days = Math.round((due.getTime() - anchor.getTime()) / 86_400_000);
  return Number.isFinite(days) ? days : null;
}

function asDay(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return null;
  // Use the date portion only (anchor/due dates are day-granular concepts)
  const day = trimmed.slice(0, 10);
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Financing days for the customer side.
 *
 * A single payment term is one number of days. Split payment terms collect the
 * money in instalments, so exposure is the share-weighted excess over each
 * tranche's OWN period: a 50% cash-in-advance tranche is not financed at all
 * while the 50% at 60 days is financed for the full excess.
 *
 * The tranche excesses are SUMMED, not averaged. A weighted AVERAGE of the days
 * silently discards real cost whenever the average gap falls at or below the
 * supplier's own days — e.g. 50% CIA + 50% at 60d against a 30-day supplier
 * gives an average of 15 excess days (floored to 0) where the true figure is
 * 0.5 x 30 = 15 days of exposure on half the value. Summing weighted excesses
 * keeps that cost visible.
 *
 * Reducing to one tranche of 100% at the order's credit days reproduces the
 * single-term answer exactly.
 */
export function getFinancingDays(input: FinancingTermsInput): number {
  const supplierDays = input.supplierEffectiveDays != null
    ? Math.max(0, Math.round(input.supplierEffectiveDays))
    : getPaymentTermDays(input.supplierPaymentTermType, input.supplierCreditDays);

  const supplied = input.customerTranches ?? [];
  const tranches = supplied.filter((t) => t.percent != null && t.percent > 0);
  const totalPercent = tranches.reduce((sum, t) => sum + (t.percent ?? 0), 0);
  // Two ways a tranche can be unusable, and both must fall through to the
  // order's own terms rather than being guessed at:
  //  - due days UNKNOWABLE (a fixed date with no delivery/ETA anchor to measure
  //    it from). Treating that as due immediately reads as cash in advance and
  //    silently UNDERSTATES the carrying cost — the direction that flatters
  //    profit.
  //  - a share that could not be read. Dropping it would shrink the
  //    denominator and inflate every surviving tranche's weight.
  // Falling back is conservative and never a fabricated figure.
  const allKnowable = supplied.length > 0
    && tranches.length === supplied.length
    && tranches.every((t) => t.dueDays != null);
  if (tranches.length > 0 && totalPercent > 0 && allKnowable) {
    // Weighted excess, normalised by the shares actually present so a schedule
    // that does not total exactly 100 does not distort the figure.
    const weightedExcess = tranches.reduce((sum, t) => {
      const days = Math.max(0, Math.round(t.dueDays ?? 0));
      const excess = Math.max(days - supplierDays, 0);
      return sum + ((t.percent ?? 0) / totalPercent) * excess;
    }, 0);
    return Math.round(weightedExcess * 100) / 100;
  }

  const customerDays = getPaymentTermDays(input.customerPaymentTermType, input.customerCreditDays);
  return Math.max(customerDays - supplierDays, 0);
}

export function calculateCostBase(item: FinancingItemInput): number {
  const quantity = getEffectiveQuantity(item);
  const costPrice = parseNumber(item.costPrice);
  const costConversionFactor = parseNumber(item.costConversionFactor) || 1;
  const costRate = getFxRate(normalizedCurrency(item.costCurrency));
  return quantity * costConversionFactor * costPrice * costRate;
}

export function calculateRevenueBase(item: FinancingItemInput): number {
  const quantity = getEffectiveQuantity(item);
  const salesPrice = parseNumber(item.salesPrice);
  const conversionFactor = parseNumber(item.unitConversionFactor) || 1;
  const salesRate = getFxRate(normalizedCurrency(item.salesCurrency));
  return quantity * salesPrice * conversionFactor * salesRate;
}

export function calculateGrossProfitBase(item: FinancingItemInput): number {
  return calculateRevenueBase(item) - calculateCostBase(item);
}

export function calculateLineEconomics(
  item: FinancingItemInput,
  financingRateAnnual: number,
  financingDays: number,
  isBrokerDeal = false,
  orderCommissionPerMt: number | null = null,
  /** Tenant's configured default commission rate — the third tier, matching
   *  the broker commission report. Omitted by callers that have no settings
   *  loaded, in which case the chain simply ends at the order level. */
  defaultCommissionRate: number | null = null,
): LineEconomics {
  const quantity = getEffectiveQuantity(item);
  const costBase = calculateCostBase(item);
  const revenueBase = calculateRevenueBase(item);

  // Broker deals earn commission, not a sales−cost margin. Profit = commission
  // (per-line commissionPerUnit, falling back to the order-level commissionPerMt),
  // and broker deals carry no financing cost. costBase/revenueBase are still
  // computed so the "Value" column can show the pass-through deal value.
  if (isBrokerDeal) {
    // Fees/services earn no commission — the same rule the commission report
    // applies, so the profit column and the report cannot disagree. A barging
    // fee is a lump sum stored with quantity 1; commissioning it added a flat
    // rate to the deal's profit and overstated the tonnage it was based on.
    if (!isCommissionableLine(item.productType)) {
      return {
        quantity: 0,
        costBase,
        revenueBase,
        grossProfit: 0,
        financingCost: 0,
        netProfit: 0,
      };
    }
    // Per-line rate → order-level rate, resolved through the shared
    // lib/numbers.toFiniteNumber with `??`, so a deliberate 0 wins instead of
    // falling through. The report previously used `??` while this used `||`,
    // and both now share one primitive and one zero semantics.
    //
    // KNOWN GAP (tier parity, tracked): the report has a THIRD tier — the
    // tenant's defaultCommissionRate — which this function does not resolve,
    // because its five call sites do not all have tenant settings in scope and
    // making it async cascades through orders/dashboard services. So a broker
    // deal with neither a per-line nor an order-level rate invoices
    // defaultRate × qty in the report while the profit column shows 0.
    // Currently unreachable: every broker deal in production carries an
    // order-level rate (0 of 197 are unrated), so behaviour matches today.
    // Closing it needs the tenant default plumbed in — see `defaultCommissionRate`
    // on calculateLineEconomics, which already accepts it.
    //
    // Note the UI cannot store a per-line 0 (its `+$event || null` turns one
    // into null), so a stored 0 is intentional.
    const rate = toFiniteNumber(item.commissionPerUnit)
      ?? toFiniteNumber(orderCommissionPerMt)
      ?? toFiniteNumber(defaultCommissionRate)
      ?? 0;
    const currency = normalizedCurrency(item.salesCurrency ?? item.costCurrency);
    const commissionBase = quantity * rate * getFxRate(currency);
    return {
      quantity,
      costBase,
      revenueBase,
      grossProfit: commissionBase,
      financingCost: 0,
      netProfit: commissionBase,
    };
  }

  const grossProfit = revenueBase - costBase;
  const financingCost = costBase * financingRateAnnual * financingDays / DEFAULT_FINANCING_DAY_COUNT;

  return {
    quantity,
    costBase,
    revenueBase,
    grossProfit,
    financingCost,
    netProfit: grossProfit - financingCost,
  };
}

export function calculateOrderEconomics(
  terms: FinancingTermsInput,
  items: FinancingItemInput[],
  financingRateAnnual: number,
  isBrokerDeal = false,
  commissionPerMt: number | string | null = null,
  dealCommissions?: DealCommissionInput,
): OrderEconomics {
  const financingDays = getFinancingDays(terms);
  const orderCommissionPerMt = parseNumber(commissionPerMt) || 0;
  const lineEconomics = items.map((item) =>
    calculateLineEconomics(item, financingRateAnnual, financingDays, isBrokerDeal, orderCommissionPerMt),
  );

  const totals = lineEconomics.reduce(
    (sum, line) => ({
      totalQuantity: sum.totalQuantity + line.quantity,
      totalCostBase: sum.totalCostBase + line.costBase,
      totalRevenueBase: sum.totalRevenueBase + line.revenueBase,
      totalGrossProfit: sum.totalGrossProfit + line.grossProfit,
      totalFinancingCost: sum.totalFinancingCost + line.financingCost,
      totalNetProfit: sum.totalNetProfit + line.netProfit,
    }),
    {
      totalQuantity: 0,
      totalCostBase: 0,
      totalRevenueBase: 0,
      totalGrossProfit: 0,
      totalFinancingCost: 0,
      totalNetProfit: 0,
    },
  );

  // Deal commissions (Mario's model): TPC is a per-MT rate in its own
  // currency; trader commission is a % of margin after TPC (Annexe formula:
  // (sell − buy − tpc) × pct). Both deducted before financing so
  // tradingProfit matches the sheet's Total Profit.
  const tpcPerMt = parseNumber(dealCommissions?.tpcPerMt);
  const tpcRate = getFxRate(normalizedCurrency(dealCommissions?.tpcCurrency));
  const totalTpc = totals.totalQuantity * tpcPerMt * tpcRate;
  const traderPct = parseNumber(dealCommissions?.traderCommissionPct) / 100;
  const totalTraderCommission = Math.max(0, totals.totalGrossProfit - totalTpc) * traderPct;
  const tradingProfit = totals.totalGrossProfit - totalTpc - totalTraderCommission;

  return {
    totalTpc,
    totalTraderCommission,
    tradingProfit,
    financingRateAnnual,
    dayCountConvention: DEFAULT_FINANCING_DAY_COUNT,
    financingDays,
    totalQuantity: totals.totalQuantity,
    totalCostBase: totals.totalCostBase,
    totalRevenueBase: totals.totalRevenueBase,
    totalGrossProfit: totals.totalGrossProfit,
    totalFinancingCost: totals.totalFinancingCost,
    financingCostPerMt: totals.totalQuantity > 0 ? totals.totalFinancingCost / totals.totalQuantity : null,
    totalNetProfit: totals.totalNetProfit,
    // Margin % is meaningless for broker deals (profit is commission, not a
    // spread over pass-through revenue).
    netMarginPct: isBrokerDeal ? null : (totals.totalRevenueBase > 0 ? (totals.totalNetProfit / totals.totalRevenueBase) * 100 : null),
    lineEconomics,
  };
}