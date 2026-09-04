import type { TenantSettings } from '../../db/schema';
import { getFxRate } from '../prices/price.service';

export const DEFAULT_FINANCING_RATE_ANNUAL = 0.08;
export const DEFAULT_FINANCING_DAY_COUNT = 365;

export interface FinancingTermsInput {
  customerPaymentTermType?: string | null;
  customerCreditDays?: number | null;
  supplierPaymentTermType?: string | null;
  supplierCreditDays?: number | null;
}

export interface FinancingItemInput {
  quantity?: string | number | null;
  deliveredQuantity?: string | number | null;
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

function parseNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
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

export function getFinancingDays(input: FinancingTermsInput): number {
  const customerDays = getPaymentTermDays(input.customerPaymentTermType, input.customerCreditDays);
  const supplierDays = getPaymentTermDays(input.supplierPaymentTermType, input.supplierCreditDays);
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
): LineEconomics {
  const quantity = getEffectiveQuantity(item);
  const costBase = calculateCostBase(item);
  const revenueBase = calculateRevenueBase(item);

  // Broker deals earn commission, not a sales−cost margin. Profit = commission
  // (per-line commissionPerUnit, falling back to the order-level commissionPerMt),
  // and broker deals carry no financing cost. costBase/revenueBase are still
  // computed so the "Value" column can show the pass-through deal value.
  if (isBrokerDeal) {
    const rate = parseNumber(item.commissionPerUnit) || orderCommissionPerMt || 0;
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
  const lineEconomics = items.map((item) => calculateLineEconomics(item, financingRateAnnual, financingDays, isBrokerDeal, orderCommissionPerMt));

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