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
  costPrice?: string | number | null;
  costCurrency?: string | null;
  salesPrice?: string | number | null;
  salesCurrency?: string | null;
  unitConversionFactor?: string | number | null;
}

export interface LineEconomics {
  quantity: number;
  costBase: number;
  revenueBase: number;
  grossProfit: number;
  financingCost: number;
  netProfit: number;
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
  const quantity = parseNumber(item.quantity);
  const costPrice = parseNumber(item.costPrice);
  const costRate = getFxRate(normalizedCurrency(item.costCurrency));
  return quantity * costPrice * costRate;
}

export function calculateRevenueBase(item: FinancingItemInput): number {
  const quantity = parseNumber(item.quantity);
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
): LineEconomics {
  const quantity = parseNumber(item.quantity);
  const costBase = calculateCostBase(item);
  const revenueBase = calculateRevenueBase(item);
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
): OrderEconomics {
  const financingDays = getFinancingDays(terms);
  const lineEconomics = items.map((item) => calculateLineEconomics(item, financingRateAnnual, financingDays));

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

  return {
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
    netMarginPct: totals.totalRevenueBase > 0 ? (totals.totalNetProfit / totals.totalRevenueBase) * 100 : null,
    lineEconomics,
  };
}