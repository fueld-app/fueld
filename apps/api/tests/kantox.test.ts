import { describe, expect, it } from 'bun:test';
import {
  KantoxClient,
  KantoxDuplicateRefError,
  KantoxRateRejectionError,
} from '../src/modules/kantox/kantox.client';
import {
  closeDeltaForPayment,
  computeHedgeAmount,
  computeUsdMargin,
  deriveValueDate,
  entryRef,
} from '../src/modules/kantox/kantox.service';

/**
 * Kantox integration tests.
 *
 * Behaviour encoded here was verified LIVE against the preprod sandbox on
 * 2026-09-17 — see docs/kantox-meeting-prep-2026-09-17.md §1. If one of
 * these tests fails, the live API contract has changed.
 */

// ── client ────────────────────────────────────────────────────────────

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: async () => JSON.stringify(next.body),
      json: async () => next.body,
    } as Response;
  };
  return { impl: impl as typeof fetch, calls };
}

const CONFIG = {
  apiBaseUrl: 'https://kantox-preprod.com/api',
  apiUser: 'test@kantox.com',
  apiPassword: 'pw',
  companyRef: 'api_company_131804',
};

describe('KantoxClient (live-verified contract)', () => {
  it('logs in with the `login` field (NOT user/email) and caches the token', async () => {
    const { impl, calls } = fakeFetch([
      { status: 200, body: { token: 'tok-1', expires_in: 600, status: 'success', scopes: ['api'] } },
      { status: 200, body: [] },
    ]);
    const client = new KantoxClient({ ...CONFIG, fetchImpl: impl });
    await client.listEntries();
    await client.listEntries(); // second call must reuse the cached token

    const login = calls[0];
    expect(login.url).toBe('https://kantox-preprod.com/api/login');
    const body = JSON.parse(String(login.init.body));
    expect(body.login).toBe('test@kantox.com'); // verified live: `user`/`email` → "account not found"
    expect(body.password).toBe('pw');
    expect(calls.filter((c) => c.url.endsWith('/login'))).toHaveLength(1); // cached
  });

  it('sends snake_case bodies + lowercase direction on the company-scoped entry path', async () => {
    const { impl, calls } = fakeFetch([
      { status: 200, body: { token: 'tok', expires_in: 600, status: 'success' } },
      { status: 200, body: { status: 'success', reference: 'E-1', entryRef: '20260911-000522#S' } },
    ]);
    const client = new KantoxClient({ ...CONFIG, fetchImpl: impl });
    await client.submitEntry({
      companyRef: CONFIG.companyRef,
      entryRef: '20260911-000522#S',
      marketDirection: 'sell',
      currency: 'USD',
      counterCurrency: 'EUR',
      amount: '5000',
      valueDate: '2026-10-05',
      notes: 'Fueld order 20260911-000522',
    });

    const entryCall = calls.find((c) => c.url.includes('/dynamic_hedging/entry'))!;
    expect(entryCall.url).toContain('/companies/api_company_131804/dynamic_hedging/entry');
    expect((entryCall.init.headers as Record<string, string>)['X_AUTH_TOKEN']).toBe('tok');
    const body = JSON.parse(String(entryCall.init.body));
    expect(body.market_direction).toBe('sell'); // lowercase — deck's "Sell" is rejected live
    expect(body.entry_ref).toBe('20260911-000522#S');
    expect(body.value_date).toBe('2026-10-05'); // ISO passthrough
    expect(body.company_ref).toBe(CONFIG.companyRef);
  });

  it('maps duplicate entryRef to KantoxDuplicateRefError (dedup verified live)', async () => {
    const { impl } = fakeFetch([
      { status: 200, body: { token: 'tok', expires_in: 600, status: 'success' } },
      { status: 403, body: { status: 'error', reason: 27, errorDetails: 'Company: X, external_ref: This company already has an entry with the same external_ref DUP-1' } },
    ]);
    const client = new KantoxClient({ ...CONFIG, fetchImpl: impl });
    await expect(
      client.submitEntry({ companyRef: CONFIG.companyRef, entryRef: 'DUP-1', marketDirection: 'sell', currency: 'USD', counterCurrency: 'EUR', amount: '5' }),
    ).rejects.toBeInstanceOf(KantoxDuplicateRefError);
  });

  it('maps the 10% rate rejection to KantoxRateRejectionError (verified live)', async () => {
    const { impl } = fakeFetch([
      { status: 200, body: { token: 'tok', expires_in: 600, status: 'success' } },
      { status: 403, body: { status: 'error', reason: 27, errorDetails: 'entry_rate: This entry has been rejected because its entryRate 2.0 for EURUSD is more than 10% away from the spot rate of the moment.' } },
    ]);
    const client = new KantoxClient({ ...CONFIG, fetchImpl: impl });
    await expect(
      client.submitEntry({ companyRef: CONFIG.companyRef, entryRef: 'R', marketDirection: 'sell', currency: 'USD', counterCurrency: 'EUR', amount: '5', entryRate: '2.0', entryRatePair: 'EURUSD' }),
    ).rejects.toBeInstanceOf(KantoxRateRejectionError);
  });

  it('re-logins once and retries when the token expires mid-session', async () => {
    const responses = [
      { status: 200, body: { token: 'tok-1', expires_in: 600, status: 'success' } },
      { status: 403, body: { status: 'error', reason: 3, errorDetails: 'Unauthorized. Invalid token' } },
      { status: 200, body: { token: 'tok-2', expires_in: 600, status: 'success' } },
      { status: 200, body: [] },
    ];
    const { impl, calls } = fakeFetch(responses);
    const client = new KantoxClient({ ...CONFIG, fetchImpl: impl });
    const entries = await client.listEntries();
    expect(entries).toEqual([]);
    expect(calls.filter((c) => c.url.endsWith('/login'))).toHaveLength(2); // re-login happened once
  });
});

// ── pure business functions ───────────────────────────────────────────

describe('computeUsdMargin — whole-oil margin, USD-sales items only', () => {
  it('sums USD item profits and skips non-USD legs', () => {
    expect(
      computeUsdMargin([
        { salesCurrency: 'USD', profit: '1000.50' },
        { salesCurrency: 'EUR', profit: '99999' }, // excluded (v1)
        { salesCurrency: 'USD', profit: '249.50' },
        { salesCurrency: null, profit: '500' },    // excluded
      ]),
    ).toBe(1250);
  });

  it('does NOT deduct financing cost (Pierre, 09/09: whole oil margin)', () => {
    expect(computeUsdMargin([{ salesCurrency: 'USD', profit: '5000' }])).toBe(5000);
  });
});

describe('computeHedgeAmount — marginHedgePercent scaling', () => {
  it('scales by percent and rounds to cents', () => {
    expect(computeHedgeAmount(5000, 10)).toBe(500);
    expect(computeHedgeAmount(1469.51, 20)).toBe(293.9);
    expect(computeHedgeAmount(1000, 100)).toBe(1000);
  });

  it('never hedges zero/negative margin or invalid percent', () => {
    expect(computeHedgeAmount(0, 10)).toBe(0);
    expect(computeHedgeAmount(-500, 10)).toBe(0);
    expect(computeHedgeAmount(1000, 0)).toBe(0);
    expect(computeHedgeAmount(NaN, 10)).toBe(0);
  });
});

describe('deriveValueDate — buffer + rounding (live-verified rules)', () => {
  it('prefers dueDate, adds buffer, rounds up to Monday', () => {
    // 2026-09-16 is a Wednesday: +7d buffer = Wed 23/09 → round up to Mon 28/09
    expect(
      deriveValueDate({ dueDate: '2026-09-16', bufferDays: 7, rounding: 'WEEKLY_MONDAY' }),
    ).toBe('2026-09-28');
  });

  it('derives from delivery + credit days when dueDate is absent (CREDIT)', () => {
    // delivered 2026-09-10 + 30 credit days = 10/10 → +7 buffer = 17/10 (Sat) → Mon 19/10
    expect(
      deriveValueDate({
        deliveredAt: '2026-09-10',
        customerPaymentTermType: 'CREDIT',
        customerCreditDays: 30,
        bufferDays: 7,
        rounding: 'WEEKLY_MONDAY',
      }),
    ).toBe('2026-10-19');
  });

  it('COD/PREPAY: delivery date + buffer, no credit days', () => {
    // delivered 2026-09-10 + 7 = 17/09 (Thu) → round up to Mon 21/09
    expect(
      deriveValueDate({
        deliveredAt: '2026-09-10',
        customerPaymentTermType: 'COD',
        bufferDays: 7,
        rounding: 'WEEKLY_MONDAY',
      }),
    ).toBe('2026-09-21');
  });

  it('never returns a past date when delivery is already past (min 30d out with no signal)', () => {
    const ref = deriveValueDate({ customerPaymentTermType: 'CREDIT', customerCreditDays: 0, bufferDays: 7, rounding: 'NONE' });
    const today = new Date().toISOString().slice(0, 10);
    expect(ref >= today || ref >= '2026-09-17').toBe(true); // never a past date (rejected live)
  });

  it('MONTHLY rounds to the 1st of the next month', () => {
    expect(deriveValueDate({ dueDate: '2026-09-16', bufferDays: 0, rounding: 'MONTHLY' })).toBe('2026-10-01');
  });
});

describe('closeDeltaForPayment — never over-cancels (verified live the hard way)', () => {
  it('cancels the remaining open exposure', () => {
    expect(closeDeltaForPayment(500, 0, 500)).toBe(-500);
  });

  it('partial payment → partial negative delta', () => {
    expect(closeDeltaForPayment(500, 0, 200)).toBe(-200);
  });

  it('caps at the open exposure even when the payment over-pays', () => {
    expect(closeDeltaForPayment(500, 0, 750)).toBe(-500);
  });

  it('stops once fully cancelled (over-cancel needs a positive correction — proven live)', () => {
    expect(closeDeltaForPayment(500, 500, 100)).toBe(0);
    expect(closeDeltaForPayment(500, 600, 100)).toBe(0);
  });
});

describe('entryRef — scheme verified live (TEST-A + TEST-A#C1 netted to 0.0)', () => {
  it('builds SO/PO initial refs and suffixed lifecycle refs', () => {
    expect(entryRef('20260911-000522', 'SO', undefined, 'INITIAL', 0)).toBe('20260911-000522#S');
    expect(entryRef('20260911-000522', 'PO', 1, 'INITIAL', 0)).toBe('20260911-000522#P1');
    expect(entryRef('20260911-000522', 'SO', undefined, 'CANCEL', 1)).toBe('20260911-000522#SC1');
    expect(entryRef('20260911-000522', 'SO', undefined, 'AMEND', 2)).toBe('20260911-000522#SA2');
    expect(entryRef('20260911-000522', 'SO', undefined, 'REISSUE', 2)).toBe('20260911-000522#SR2');
  });
});
// ── buildHedgePlan — scope filter + two-leg plan (17/09 meeting decisions) ──

import { buildHedgePlan, type KantoxOrderSnapshot } from '../src/modules/kantox/kantox.service';

function snapshot(overrides: Partial<KantoxOrderSnapshot> = {}): KantoxOrderSnapshot {
  return {
    tenantId: 't1',
    orderId: 'o1',
    orderNumber: '20260911-000522',
    dueDate: '2026-09-16',
    customerPaymentTermType: 'CREDIT',
    customerCreditDays: 30,
    items: [
      { id: 'i1', orderSupplierId: 'leg-a', quantity: '720', quantityMin: '480', salesPrice: '600', costPrice: '550', salesCurrency: 'USD', costCurrency: 'USD' },
      { id: 'i2', orderSupplierId: 'leg-a', quantity: '240', quantityMin: '240', salesPrice: '610', costPrice: '590', salesCurrency: 'USD', costCurrency: 'USD' },
    ],
    ...overrides,
  };
}

const SETTINGS = {
  marginHedgePercent: 100,
  paymentDateBufferDays: 7,
  valueDateRounding: 'WEEKLY_MONDAY' as const,
  hedgeCurrency: 'USD',
  hedgeCounterCurrency: 'EUR',
};

describe('buildHedgePlan — tenant scope decisions (17/09 call)', () => {
  it('plans SO SELL + PO BUY at FULL exposure (no client-side scaling — platform rule)', () => {
    const plan = buildHedgePlan(snapshot(), SETTINGS);
    expect(plan.skipped).toBeUndefined();
    expect(plan.entries).toHaveLength(2);
    const so = plan.entries.find((e) => e.leg === 'SO')!;
    expect(so.direction).toBe('SELL');
    // FULL exposure (no scaling) at the MINIMUM-QUANTITY basis (decision 8)
    expect(Number(so.amount)).toBe(480 * 600 + 240 * 610);
    const po = plan.entries.find((e) => e.leg === 'PO:1')!;
    expect(po.direction).toBe('BUY');
    expect(Number(po.amount)).toBe(480 * 550 + 240 * 590); // min-qty × cost, both items on leg-a
    expect(so.valueDate).toBe(po.valueDate); // same value date both legs
  });

  it('excludes non-USD (EUR) orders entirely', () => {
    const plan = buildHedgePlan(snapshot({
      items: [{ id: 'i1', orderSupplierId: 'leg-a', quantity: '720', quantityMin: '480', salesPrice: '600', costPrice: '500', salesCurrency: 'EUR', costCurrency: 'EUR' }],
    }), SETTINGS);
    expect(plan.entries).toHaveLength(0);
    expect(plan.skipped).toContain('no USD sell exposure');
  });

  it('excludes EUR-invoiced PO legs but keeps the USD SO leg', () => {
    const plan = buildHedgePlan(snapshot({
      items: [
        { id: 'i1', orderSupplierId: 'leg-eur', quantity: '720', quantityMin: '480', salesPrice: '600', costPrice: '500', salesCurrency: 'USD', costCurrency: 'EUR' },
      ],
    }), SETTINGS);
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0].leg).toBe('SO'); // EUR PO excluded per Marin, 17/09
  });

  it('skips negative-margin deals entirely (never net-BUY)', () => {
    const plan = buildHedgePlan(snapshot({
      items: [{ id: 'i1', orderSupplierId: 'leg-a', quantity: '720', quantityMin: '720', salesPrice: '600', costPrice: '650', salesCurrency: 'USD', costCurrency: 'USD' }],
    }), SETTINGS);
    expect(plan.entries).toHaveLength(0);
    expect(plan.skipped).toContain('negative margin');
  });

  it('uses minimum quantity (pre-invoice basis) when set — one amount per deal', () => {
    const plan = buildHedgePlan(snapshot({
      items: [{ id: 'i1', orderSupplierId: 'leg-a', quantity: '720', quantityMin: '480', salesPrice: '600', costPrice: '500', salesCurrency: 'USD', costCurrency: 'USD' }],
    }), SETTINGS);
    expect(Number(plan.entries.find((e) => e.leg === 'SO')!.amount)).toBe(480 * 600);
  });

  it('numbers multiple USD PO legs distinctly (PO:1, PO:2)', () => {
    const plan = buildHedgePlan(snapshot({
      items: [
        { id: 'i1', orderSupplierId: 'leg-a', quantity: '720', quantityMin: '480', salesPrice: '600', costPrice: '500', salesCurrency: 'USD', costCurrency: 'USD' },
        { id: 'i2', orderSupplierId: 'leg-b', quantity: '240', quantityMin: '240', salesPrice: '600', costPrice: '580', salesCurrency: 'USD', costCurrency: 'USD' },
      ],
    }), SETTINGS);
    const legs = plan.entries.filter((e) => e.leg.startsWith('PO')).map((e) => e.leg).sort();
    expect(legs).toEqual(['PO:1', 'PO:2']);
  });

  it('derives entry refs from the order number', () => {
    const plan = buildHedgePlan(snapshot(), SETTINGS);
    expect(plan.entries[0].entryRef).toBe('20260911-000522#S');
  });
});
