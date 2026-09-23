import { describe, expect, it } from 'bun:test';
import {
  calculateOrderEconomics,
  calculateRevenueBase,
  calculateCostBase,
  calculateGrossProfitBase,
  calculateLineEconomics,
  getFinancingDays,
  getPaymentTermDays,
  getFinancingRateAnnual,
  DEFAULT_FINANCING_RATE_ANNUAL,
  DEFAULT_FINANCING_DAY_COUNT,
  type FinancingItemInput,
  type FinancingTermsInput,
} from '../src/modules/orders/order-financing';
import { getFxRate } from '../src/modules/prices/price.service';

// ═══════════════════════════════════════════════════════════════════════
//  Unit tests for order-financing (calculateOrderEconomics & helpers)
//
//  These verify the revenue, cost, profit, and financing calculations
//  that back the Dashboard KPI cards (Total Revenue YTD, Gross Profit
//  YTD, Net Profit YTD, Avg Deal Size).
// ═══════════════════════════════════════════════════════════════════════

describe('order-financing', () => {
  // ─── getPaymentTermDays ──────────────────────────────────────────

  describe('getPaymentTermDays', () => {
    it('returns 0 for non-CREDIT payment types', () => {
      expect(getPaymentTermDays('COD', 30)).toBe(0);
      expect(getPaymentTermDays('PREPAID', 10)).toBe(0);
      expect(getPaymentTermDays(null, 30)).toBe(0);
      expect(getPaymentTermDays(undefined, 30)).toBe(0);
    });

    it('returns credit days for CREDIT type', () => {
      expect(getPaymentTermDays('CREDIT', 30)).toBe(30);
      expect(getPaymentTermDays('CREDIT', 60)).toBe(60);
    });

    it('returns 0 for negative or null credit days', () => {
      expect(getPaymentTermDays('CREDIT', -5)).toBe(0);
      expect(getPaymentTermDays('CREDIT', null)).toBe(0);
      expect(getPaymentTermDays('CREDIT', undefined)).toBe(0);
    });
  });

  // ─── getFinancingDays ────────────────────────────────────────────

  describe('getFinancingDays', () => {
    it('returns customer days minus supplier days when positive', () => {
      expect(getFinancingDays({
        customerPaymentTermType: 'CREDIT',
        customerCreditDays: 30,
        supplierPaymentTermType: 'CREDIT',
        supplierCreditDays: 10,
      })).toBe(20);
    });

    // ── Split payment terms ──────────────────────────────────────────
    // A schedule collects the money in instalments, so each instalment is
    // financed for its OWN period. The excesses are summed, not averaged: a
    // weighted average floors to zero whenever the average gap is at or below
    // the supplier's days, silently discarding real cost.
    it('finances each tranche for its own period, weighted by share', () => {
      expect(getFinancingDays({
        supplierPaymentTermType: 'CREDIT',
        supplierCreditDays: 30,
        customerTranches: [
          { percent: 50, dueDays: 0 },   // cash in advance: nothing to finance
          { percent: 50, dueDays: 60 },  // 30 excess days on half the value
        ],
      })).toBe(15);
    });

    it('reduces to the single-term answer for one tranche at the credit days', () => {
      expect(getFinancingDays({
        customerPaymentTermType: 'CREDIT',
        customerCreditDays: 60,
        supplierPaymentTermType: 'CREDIT',
        supplierCreditDays: 30,
        customerTranches: [{ percent: 100, dueDays: 60 }],
      })).toBe(30);
    });

    it('ignores tranches a supplier credit already covers', () => {
      expect(getFinancingDays({
        supplierPaymentTermType: 'CREDIT',
        supplierCreditDays: 45,
        customerTranches: [
          { percent: 50, dueDays: 30 },
          { percent: 50, dueDays: 60 },
        ],
      })).toBe(7.5); // only the 60-day half has 15 excess days
    });

    it('finances nothing when every tranche is cash in advance', () => {
      expect(getFinancingDays({
        supplierPaymentTermType: 'CREDIT',
        supplierCreditDays: 30,
        customerTranches: [{ percent: 100, dueDays: 0 }],
      })).toBe(0);
    });

    it('returns 0 when supplier days exceed customer days', () => {
      expect(getFinancingDays({
        customerPaymentTermType: 'CREDIT',
        customerCreditDays: 10,
        supplierPaymentTermType: 'CREDIT',
        supplierCreditDays: 30,
      })).toBe(0);
    });

    it('returns full customer days when supplier is COD', () => {
      expect(getFinancingDays({
        customerPaymentTermType: 'CREDIT',
        customerCreditDays: 15,
        supplierPaymentTermType: 'COD',
      })).toBe(15);
    });

    it('returns 0 when both are COD', () => {
      expect(getFinancingDays({
        customerPaymentTermType: 'COD',
        supplierPaymentTermType: 'COD',
      })).toBe(0);
    });
  });

  // ─── getFinancingRateAnnual ──────────────────────────────────────

  describe('getFinancingRateAnnual', () => {
    it('returns default 8% when settings are empty', () => {
      expect(getFinancingRateAnnual(null)).toBe(DEFAULT_FINANCING_RATE_ANNUAL);
      expect(getFinancingRateAnnual(undefined)).toBe(DEFAULT_FINANCING_RATE_ANNUAL);
      expect(getFinancingRateAnnual({})).toBe(DEFAULT_FINANCING_RATE_ANNUAL);
    });

    it('returns custom rate from settings', () => {
      expect(getFinancingRateAnnual({ financingRateAnnual: 0.05 })).toBe(0.05);
    });

    it('rejects negative rates and falls back to default', () => {
      expect(getFinancingRateAnnual({ financingRateAnnual: -0.01 })).toBe(DEFAULT_FINANCING_RATE_ANNUAL);
    });
  });

  // ─── calculateRevenueBase ────────────────────────────────────────

  describe('calculateRevenueBase', () => {
    it('computes quantity × salesPrice for USD items', () => {
      const result = calculateRevenueBase({
        quantity: '100',
        salesPrice: '500',
        salesCurrency: 'USD',
      });
      expect(result).toBe(50_000);
    });

    it('handles numeric inputs', () => {
      expect(calculateRevenueBase({
        quantity: 100,
        salesPrice: 500,
        salesCurrency: 'USD',
      })).toBe(50_000);
    });

    it('applies unitConversionFactor', () => {
      const result = calculateRevenueBase({
        quantity: '100',
        salesPrice: '500',
        salesCurrency: 'USD',
        unitConversionFactor: '1.1',
      });
      expect(result).toBeCloseTo(55_000, 2);
    });

    it('defaults unitConversionFactor to 1 when missing', () => {
      expect(calculateRevenueBase({
        quantity: '10',
        salesPrice: '100',
        salesCurrency: 'USD',
        unitConversionFactor: null,
      })).toBe(1_000);
    });

    it('returns 0 for null/undefined quantity or price', () => {
      expect(calculateRevenueBase({ quantity: null, salesPrice: '500' })).toBe(0);
      expect(calculateRevenueBase({ quantity: '100', salesPrice: null })).toBe(0);
      expect(calculateRevenueBase({})).toBe(0);
    });
  });

  // ─── calculateCostBase ───────────────────────────────────────────

  describe('calculateCostBase', () => {
    it('computes quantity × costPrice for USD items', () => {
      expect(calculateCostBase({
        quantity: '100',
        costPrice: '450',
        costCurrency: 'USD',
      })).toBe(45_000);
    });

    it('returns 0 for missing values', () => {
      expect(calculateCostBase({ quantity: null, costPrice: '450' })).toBe(0);
      expect(calculateCostBase({ quantity: '100', costPrice: null })).toBe(0);
    });
  });

  // ─── calculateGrossProfitBase ────────────────────────────────────

  describe('calculateGrossProfitBase', () => {
    it('returns revenue minus cost', () => {
      const item: FinancingItemInput = {
        quantity: '100',
        salesPrice: '500',
        salesCurrency: 'USD',
        costPrice: '450',
        costCurrency: 'USD',
      };
      expect(calculateGrossProfitBase(item)).toBe(5_000);
    });

    it('returns negative when cost exceeds revenue', () => {
      const item: FinancingItemInput = {
        quantity: '100',
        salesPrice: '400',
        salesCurrency: 'USD',
        costPrice: '450',
        costCurrency: 'USD',
      };
      expect(calculateGrossProfitBase(item)).toBe(-5_000);
    });
  });

  // ─── calculateLineEconomics ──────────────────────────────────────

  describe('calculateLineEconomics', () => {
    it('calculates line-level financing cost', () => {
      const item: FinancingItemInput = {
        quantity: '100',
        costPrice: '450',
        costCurrency: 'USD',
        salesPrice: '500',
        salesCurrency: 'USD',
      };
      const rate = 0.08;
      const financingDays = 30;

      const line = calculateLineEconomics(item, rate, financingDays);

      expect(line.quantity).toBe(100);
      expect(line.costBase).toBe(45_000);
      expect(line.revenueBase).toBe(50_000);
      expect(line.grossProfit).toBe(5_000);
      // financingCost = 45000 * 0.08 * 30 / 365
      expect(line.financingCost).toBeCloseTo(295.89, 2);
      expect(line.netProfit).toBeCloseTo(5_000 - 295.89, 1);
    });

    it('returns 0 financing cost when financing days are 0', () => {
      const item: FinancingItemInput = {
        quantity: '10',
        costPrice: '100',
        costCurrency: 'USD',
        salesPrice: '110',
        salesCurrency: 'USD',
      };
      const line = calculateLineEconomics(item, 0.08, 0);

      expect(line.financingCost).toBe(0);
      expect(line.netProfit).toBe(line.grossProfit);
    });
  });

  // ─── calculateOrderEconomics ─────────────────────────────────────

  describe('calculateOrderEconomics', () => {
    it('aggregates single-item order correctly', () => {
      const terms: FinancingTermsInput = {
        customerPaymentTermType: 'COD',
        supplierPaymentTermType: 'COD',
      };
      const items: FinancingItemInput[] = [
        { quantity: '10', salesPrice: '100', salesCurrency: 'USD', costPrice: '80', costCurrency: 'USD' },
      ];

      const result = calculateOrderEconomics(terms, items, 0.08);

      expect(result.financingDays).toBe(0);
      expect(result.totalQuantity).toBe(10);
      expect(result.totalRevenueBase).toBe(1_000);
      expect(result.totalCostBase).toBe(800);
      expect(result.totalGrossProfit).toBe(200);
      expect(result.totalFinancingCost).toBe(0);
      expect(result.totalNetProfit).toBe(200);
    });

    it('aggregates multi-item order correctly', () => {
      const terms: FinancingTermsInput = {
        customerPaymentTermType: 'CREDIT',
        customerCreditDays: 30,
        supplierPaymentTermType: 'CREDIT',
        supplierCreditDays: 10,
      };
      const items: FinancingItemInput[] = [
        { quantity: '100', salesPrice: '500', salesCurrency: 'USD', costPrice: '450', costCurrency: 'USD' },
        { quantity: '50', salesPrice: '600', salesCurrency: 'USD', costPrice: '550', costCurrency: 'USD' },
      ];

      const result = calculateOrderEconomics(terms, items, 0.08);

      // financing days = 30 - 10 = 20
      expect(result.financingDays).toBe(20);

      // Item 1: revenue = 100*500 = 50000, cost = 100*450 = 45000
      // Item 2: revenue = 50*600 = 30000, cost = 50*550 = 27500
      expect(result.totalRevenueBase).toBe(80_000);
      expect(result.totalCostBase).toBe(72_500);
      expect(result.totalGrossProfit).toBe(7_500);
      expect(result.totalQuantity).toBe(150);

      // Financing cost = (45000 + 27500) * 0.08 * 20 / 365
      const expectedFinancing = 72_500 * 0.08 * 20 / 365;
      expect(result.totalFinancingCost).toBeCloseTo(expectedFinancing, 2);
      expect(result.totalNetProfit).toBeCloseTo(7_500 - expectedFinancing, 2);
    });

    it('returns zeroed totals for empty item list', () => {
      const result = calculateOrderEconomics(
        { customerPaymentTermType: 'COD', supplierPaymentTermType: 'COD' },
        [],
        0.08,
      );

      expect(result.totalQuantity).toBe(0);
      expect(result.totalRevenueBase).toBe(0);
      expect(result.totalCostBase).toBe(0);
      expect(result.totalGrossProfit).toBe(0);
      expect(result.totalFinancingCost).toBe(0);
      expect(result.totalNetProfit).toBe(0);
      expect(result.financingCostPerMt).toBeNull();
      expect(result.netMarginPct).toBeNull();
    });

    it('calculates financingCostPerMt and netMarginPct', () => {
      const terms: FinancingTermsInput = {
        customerPaymentTermType: 'CREDIT',
        customerCreditDays: 15,
        supplierPaymentTermType: 'COD',
      };
      const items: FinancingItemInput[] = [
        { quantity: '10', salesPrice: '100', salesCurrency: 'USD', costPrice: '80', costCurrency: 'USD' },
      ];

      const result = calculateOrderEconomics(terms, items, 0.08);

      // financingDays = 15 - 0 = 15
      expect(result.financingDays).toBe(15);

      // revenue = 1000, cost = 800, gross profit = 200
      // financing = 800 * 0.08 * 15 / 365 ≈ 2.63
      const financing = 800 * 0.08 * 15 / 365;
      expect(result.totalFinancingCost).toBeCloseTo(financing, 2);

      // financingCostPerMt = financing / 10
      expect(result.financingCostPerMt).toBeCloseTo(financing / 10, 4);

      // netMarginPct = (netProfit / revenue) * 100
      const netProfit = 200 - financing;
      expect(result.netMarginPct).toBeCloseTo((netProfit / 1000) * 100, 2);
    });

    it('handles string-typed numeric values from DB rows', () => {
      const terms: FinancingTermsInput = {
        customerPaymentTermType: 'COD',
        supplierPaymentTermType: 'COD',
      };
      // DB often returns decimal columns as strings
      const items: FinancingItemInput[] = [
        { quantity: '500.000', salesPrice: '650.50', salesCurrency: 'USD', costPrice: '600.25', costCurrency: 'USD' },
      ];

      const result = calculateOrderEconomics(terms, items, 0.08);

      expect(result.totalRevenueBase).toBeCloseTo(500 * 650.50, 2);
      expect(result.totalCostBase).toBeCloseTo(500 * 600.25, 2);
      expect(result.totalGrossProfit).toBeCloseTo(500 * (650.50 - 600.25), 2);
    });

    // ─── Revenue Calculation Correctness Scenarios ─────────────────

    describe('revenue scenarios matching dashboard display', () => {
      it('revenue for a typical VLSFO bunker order', () => {
        // Simulates a real order: 500 MT VLSFO at $650/MT
        const terms: FinancingTermsInput = {
          customerPaymentTermType: 'CREDIT',
          customerCreditDays: 30,
          supplierPaymentTermType: 'CREDIT',
          supplierCreditDays: 15,
        };
        const items: FinancingItemInput[] = [
          { quantity: '500', salesPrice: '650', salesCurrency: 'USD', costPrice: '620', costCurrency: 'USD' },
        ];

        const result = calculateOrderEconomics(terms, items, 0.08);

        expect(result.totalRevenueBase).toBe(325_000);
        expect(result.totalCostBase).toBe(310_000);
        expect(result.totalGrossProfit).toBe(15_000);
        // financing = 310000 * 0.08 * 15 / 365
        expect(result.totalFinancingCost).toBeCloseTo(1_019.18, 1);
        expect(result.totalNetProfit).toBeCloseTo(15_000 - 1_019.18, 0);
      });

      it('correctly computes avg deal size from multiple orders', () => {
        // The dashboard computes: Avg Deal Size = Total Revenue / Total Orders
        const terms: FinancingTermsInput = { customerPaymentTermType: 'COD', supplierPaymentTermType: 'COD' };

        const order1 = calculateOrderEconomics(terms, [
          { quantity: '100', salesPrice: '500', salesCurrency: 'USD', costPrice: '450', costCurrency: 'USD' },
        ], 0.08);

        const order2 = calculateOrderEconomics(terms, [
          { quantity: '200', salesPrice: '600', salesCurrency: 'USD', costPrice: '550', costCurrency: 'USD' },
        ], 0.08);

        const totalRevenue = order1.totalRevenueBase + order2.totalRevenueBase;
        const totalOrders = 2;
        const avgDealSize = totalRevenue / totalOrders;

        // order1 rev = 50000, order2 rev = 120000
        expect(totalRevenue).toBe(170_000);
        expect(avgDealSize).toBe(85_000);
      });
    });
  });
});

describe('calculateOrderEconomics — deal commissions (Mario/Riviera model)', () => {
  const terms: FinancingTermsInput = { customerPaymentTermType: 'COD', supplierPaymentTermType: 'COD' };

  it('TPC (per MT) and trader % of margin-after-TPC match the sheet formula', () => {
    // Mario: sell 1327.85, buy 1171.808, qty 371.232 MT, TPC 109.228 $/MT, trader 7% (SPOT)
    // TpcTot = 109.228 × 371.232 = 40548.55…
    // BrokTot = (1327.85 − 1171.808 − 109.228) × 7% × 371.232 = 46.814 × 0.07 × 371.232 = 1217.05…
    // Total Profit = (sell − buy − tpc − brok/MT) × MT = 46.814 × 0.93 × 371.232 = 16178.5…
    const items: FinancingItemInput[] = [
      { quantity: '371.232', salesPrice: '1327.85', salesCurrency: 'USD', costPrice: '1171.808', costCurrency: 'USD' },
    ];
    const result = calculateOrderEconomics(terms, items, 0.08, false, null, {
      tpcPerMt: '109.228',
      tpcCurrency: 'USD',
      traderCommissionPct: '7',
    });
    expect(result.totalTpc).toBeCloseTo(109.228 * 371.232, 2);
    const gross = (1327.85 - 1171.808) * 371.232;
    const marginAfterTpc = gross - 109.228 * 371.232;
    expect(result.totalGrossProfit).toBeCloseTo(gross, 2);
    expect(result.totalTraderCommission).toBeCloseTo(marginAfterTpc * 0.07, 2);
    expect(result.tradingProfit).toBeCloseTo(marginAfterTpc * 0.93, 2);
    // netProfit keeps the existing meaning (gross − financing; commissions
    // are NOT deducted there — existing views unchanged); financingDays = 0.
    expect(result.totalNetProfit).toBeCloseTo(result.totalGrossProfit, 2);
  });

  it('EUR TPC converts via FX and trader % only applies when margin after TPC is positive', () => {
    const items: FinancingItemInput[] = [
      { quantity: '100', salesPrice: '1200', salesCurrency: 'EUR', costPrice: '1000', costCurrency: 'EUR' },
    ];
    const result = calculateOrderEconomics(terms, items, 0.08, false, null, {
      tpcPerMt: '10',
      tpcCurrency: 'EUR',
      traderCommissionPct: '7',
    });
    const eurRate = getFxRate('EUR');
    // revenue = 100×1200×rate, cost = 100×1000×rate, tpc = 100×10×rate
    expect(result.totalTpc).toBeCloseTo(1000 * eurRate, 2);
    expect(result.totalTraderCommission).toBeCloseTo((120_000 - 100_000 - 1_000) * eurRate * 0.07, 2);

    // Negative margin after TPC → trader commission clamped to 0
    const loss = calculateOrderEconomics(terms, items, 0.08, false, null, {
      tpcPerMt: '250',
      tpcCurrency: 'EUR',
      traderCommissionPct: '7',
    });
    expect(loss.totalTraderCommission).toBe(0);
    expect(loss.tradingProfit).toBeLessThan(0);
  });

  it('no commissions configured → tradingProfit equals grossProfit', () => {
    const items: FinancingItemInput[] = [
      { quantity: '10', salesPrice: '100', salesCurrency: 'USD', costPrice: '80', costCurrency: 'USD' },
    ];
    const result = calculateOrderEconomics(terms, items, 0.08, false, null, undefined);
    expect(result.totalTpc).toBe(0);
    expect(result.totalTraderCommission).toBe(0);
    expect(result.tradingProfit).toBe(result.totalGrossProfit);
  });
});
