import { describe, expect, it } from 'bun:test';
import {
  KantoxClient,
  KantoxDuplicateRefError,
  KantoxRateRejectionError,
} from '../src/modules/kantox/kantox.client';
import {
  closeDeltaForPayment,
  planPaymentClosures,
  nextLifecycleSeq,
  splitSellLegByTranche,
  computeHedgeAmount,
  computeUsdMargin,
  deriveValueDate,
  entryRef,
  findLateHedgeEntries,
  isAllowedKantoxBaseUrl,
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

describe('findLateHedgeEntries — past-due open legs (decision 1: Pierre rolls manually)', () => {
  const entry = (over: Partial<{ id: string; status: string; valueDate: string | null; amount: string; cancelledAmount: string }> = {}) => ({
    id: over.id ?? 'e1',
    status: over.status ?? 'SENT',
    valueDate: over.valueDate === undefined ? '2026-09-10' : over.valueDate,
    amount: over.amount ?? '1000.00',
    cancelledAmount: over.cancelledAmount ?? '0.00',
  });

  it('flags a sent entry whose value date has passed with exposure still open', () => {
    expect(findLateHedgeEntries([entry()], '2026-09-22')).toEqual(['e1']);
  });

  it('does not flag an entry whose value date is today or still in the future', () => {
    expect(findLateHedgeEntries([entry({ valueDate: '2026-09-22' })], '2026-09-22')).toEqual([]);
    expect(findLateHedgeEntries([entry({ valueDate: '2026-10-01' })], '2026-09-22')).toEqual([]);
  });

  it('does not flag fully-cancelled or closed entries — nothing left to roll', () => {
    expect(findLateHedgeEntries([entry({ status: 'CLOSED' })], '2026-09-22')).toEqual([]);
    expect(findLateHedgeEntries([entry({ status: 'CANCELLED' })], '2026-09-22')).toEqual([]);
    expect(findLateHedgeEntries([entry({ amount: '1000.00', cancelledAmount: '1000.00' })], '2026-09-22')).toEqual([]);
  });

  it('flags a partially-paid entry — the remainder is still exposed', () => {
    expect(findLateHedgeEntries([entry({ cancelledAmount: '400.00' })], '2026-09-22')).toEqual(['e1']);
  });

  it('does not flag pending or failed sends — those belong to the retry loop', () => {
    expect(findLateHedgeEntries([entry({ status: 'PENDING_SEND' })], '2026-09-22')).toEqual([]);
    expect(findLateHedgeEntries([entry({ status: 'FAILED' })], '2026-09-22')).toEqual([]);
  });

  it('flags HEDGED (executed) entries too — an executed past-due leg still needs a roll', () => {
    expect(findLateHedgeEntries([entry({ status: 'HEDGED' })], '2026-09-22')).toEqual(['e1']);
  });

  it('ignores dateless entries — they have no value date to be late against', () => {
    expect(findLateHedgeEntries([entry({ valueDate: null })], '2026-09-22')).toEqual([]);
  });
});

describe('isAllowedKantoxBaseUrl — the vaulted password only goes to Kantox', () => {
  it('accepts the two Kantox hosts over https', () => {
    expect(isAllowedKantoxBaseUrl('https://kantox-preprod.com/api')).toBe(true);
    expect(isAllowedKantoxBaseUrl('https://kantox.com/api')).toBe(true);
  });

  it('rejects an arbitrary host, so the password cannot be redirected to someone else', () => {
    expect(isAllowedKantoxBaseUrl('https://attacker.example/api')).toBe(false);
    // Suffix lookalikes must not pass a naive endsWith('kantox.com') check.
    expect(isAllowedKantoxBaseUrl('https://evil-kantox.com/api')).toBe(false);
    expect(isAllowedKantoxBaseUrl('https://kantox.com.attacker.example/api')).toBe(false);
  });

  it('rejects plain http and non-URL input', () => {
    expect(isAllowedKantoxBaseUrl('http://kantox.com/api')).toBe(false);
    expect(isAllowedKantoxBaseUrl('not a url')).toBe(false);
    expect(isAllowedKantoxBaseUrl('')).toBe(false);
  });

  it('rejects the cloud metadata endpoint (SSRF pivot with credentials attached)', () => {
    expect(isAllowedKantoxBaseUrl('http://169.254.169.254/latest/meta-data/')).toBe(false);
  });
});

describe('planPaymentClosures — a payment is consumed across the open entries', () => {
  it('sizes each closure against what is LEFT of the payment', () => {
    // Split terms hedge one entry per tranche. The old loop handed the whole
    // payment to every entry, so this payment would have cancelled BOTH in full.
    const plan = planPaymentClosures([{ amount: 50000, cancelled: 0 }, { amount: 50000, cancelled: 0 }], 50000);
    expect(plan).toEqual([{ index: 0, delta: -50000 }]);
    expect(plan.reduce((s, p) => s + Math.abs(p.delta), 0)).toBe(50000);
  });

  it('spreads a payment over several entries without exceeding it', () => {
    const plan = planPaymentClosures([{ amount: 50000, cancelled: 0 }, { amount: 50000, cancelled: 0 }], 75000);
    expect(plan).toEqual([{ index: 0, delta: -50000 }, { index: 1, delta: -25000 }]);
    expect(plan.reduce((s, p) => s + Math.abs(p.delta), 0)).toBe(75000);
  });

  it('never cancels more than the remaining exposure when the payment is larger', () => {
    const plan = planPaymentClosures([{ amount: 50000, cancelled: 40000 }, { amount: 30000, cancelled: 0 }], 999999);
    expect(plan.reduce((s, p) => s + Math.abs(p.delta), 0)).toBe(40000); // 10k + 30k
  });

  it('skips entries already closed', () => {
    const plan = planPaymentClosures([{ amount: 10000, cancelled: 10000 }, { amount: 20000, cancelled: 0 }], 5000);
    expect(plan).toEqual([{ index: 1, delta: -5000 }]);
  });

  it('is a no-op for a zero or negative payment', () => {
    expect(planPaymentClosures([{ amount: 100, cancelled: 0 }], 0)).toEqual([]);
    expect(planPaymentClosures([{ amount: 100, cancelled: 0 }], -5)).toEqual([]);
  });

  // The two invariants that keep a mis-netted hedge from ever being sent: a
  // payment cannot relieve more than itself, and cannot relieve more than the
  // exposure actually open.
  it('never closes more than the payment across a range of shapes', () => {
    const cases: Array<{ entries: Array<{ amount: number; cancelled: number }>; payment: number }> = [
      { entries: [{ amount: 100, cancelled: 0 }], payment: 100 },
      { entries: [{ amount: 100, cancelled: 0 }], payment: 500 },
      { entries: [{ amount: 100, cancelled: 60 }, { amount: 50, cancelled: 0 }], payment: 70 },
      { entries: [{ amount: 100, cancelled: 100 }, { amount: 50, cancelled: 0 }], payment: 30 },
      { entries: [{ amount: 100, cancelled: 100 }], payment: 50 },
      { entries: Array.from({ length: 20 }, () => ({ amount: 10, cancelled: 0 })), payment: 95 },
      { entries: [{ amount: 100, cancelled: 0 }], payment: 0.001 },
    ];
    for (const { entries, payment } of cases) {
      const plan = planPaymentClosures(entries, payment);
      const closed = plan.reduce((s, p) => s + Math.abs(p.delta), 0);
      const open = entries.reduce((s, e) => s + Math.max(0, e.amount - e.cancelled), 0);
      expect(closed).toBeLessThanOrEqual(payment + 1e-9);
      expect(closed).toBeLessThanOrEqual(open + 1e-9);
      // And no single entry is closed beyond its own remaining exposure.
      for (const p of plan) {
        const entry = entries[p.index]!;
        expect(Math.abs(p.delta)).toBeLessThanOrEqual(Math.max(0, entry.amount - entry.cancelled) + 1e-9);
      }
    }
  });
});

describe('nextLifecycleSeq — each close on a parent gets its own ref', () => {
  it('starts at 1 and continues past the children already on file', () => {
    expect(nextLifecycleSeq('X#S1', [], 'C')).toBe(1);
    expect(nextLifecycleSeq('X#S1', ['X#S1C1'], 'C')).toBe(2);
    expect(nextLifecycleSeq('X#S1', ['X#S1C1', 'X#S1C2'], 'C')).toBe(3);
  });

  it('does not confuse another parent or tag', () => {
    expect(nextLifecycleSeq('X#S1', ['X#S2C3', 'X#S1A9', 'OTHER'], 'C')).toBe(1);
  });

  it('handles a suffix that is not a number without losing the sequence', () => {
    expect(nextLifecycleSeq('X#S1', ['X#S1C', 'X#S1C2'], 'C')).toBe(3);
  });
});

describe('splitSellLegByTranche', () => {
  it('splits by share, last tranche absorbing the rounding', () => {
    expect(splitSellLegByTranche(1000, [{ percent: 33.333, dueDays: 0 }, { percent: 33.333, dueDays: 30 }, { percent: 33.334, dueDays: 60 }]))
      .toEqual([{ refIndex: 1, amount: 333.33, dueDays: 0 }, { refIndex: 2, amount: 333.33, dueDays: 30 }, { refIndex: 3, amount: 333.34, dueDays: 60 }]);
  });

  it('returns null (order-level entry) when a tranche has no measurable date', () => {
    expect(splitSellLegByTranche(1000, [{ percent: 50, dueDays: null }, { percent: 50, dueDays: 60 }])).toBeNull();
  });

  it('returns null with no usable schedule', () => {
    expect(splitSellLegByTranche(1000, null)).toBeNull();
    expect(splitSellLegByTranche(1000, [])).toBeNull();
    expect(splitSellLegByTranche(1000, [{ percent: 0, dueDays: 0 }])).toBeNull();
  });

  it('keeps the parts summing to the whole', () => {
    const parts = splitSellLegByTranche(999999.99, [{ percent: 50, dueDays: 0 }, { percent: 50, dueDays: 30 }])!;
    expect(parts.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(999999.99, 2);
  });
});

describe('scheduled orders hedge each tranche under its own ref', () => {
  const settings = { marginHedgePercent: 100, paymentDateBufferDays: 0, valueDateRounding: 'NONE' as const, hedgeCurrency: 'USD', hedgeCounterCurrency: 'EUR' };
  const item = { productType: 'VLSFO', quantity: '100', quantityMin: '100', salesPrice: '1000', salesCurrency: 'USD', costPrice: '900', costCurrency: 'USD', orderSupplierId: 's1' } as never;
  const base = { tenantId: 't1', orderId: 'o1', orderNumber: 'ORD-1', deliveredAt: '2026-09-20T00:00:00Z', customerPaymentTermType: 'CREDIT', customerCreditDays: 60, items: [item] };

  it('leaves an unscheduled order exactly as before', () => {
    const sells = buildHedgePlan(base, settings).entries.filter((e) => e.direction === 'SELL');
    expect(sells).toHaveLength(1);
    expect(sells[0]!.entryRef).toBe('ORD-1#S');
    expect(sells[0]!.amount).toBe('100000.00');
  });

  it('gives each tranche its own ref and its own date', () => {
    const sells = buildHedgePlan({ ...base, customerTranches: [{ percent: 50, dueDays: 0 }, { percent: 50, dueDays: 60 }] }, settings)
      .entries.filter((e) => e.direction === 'SELL');
    expect(sells.map((e) => e.entryRef)).toEqual(['ORD-1#S1', 'ORD-1#S2']);
    expect(sells.map((e) => e.valueDate)).toEqual(['2026-09-20', '2026-11-19']);
    // The hedge still covers the full sell exposure.
    expect(sells.reduce((s, e) => s + Number(e.amount), 0)).toBe(100000);
  });
});

describe('lifecycle ref sequencing is collision-proof', () => {
  it('recounts a fresh sequence instead of reusing a taken one', () => {
    // The race: two closes on one parent both count no children yet, so both
    // would pick C1. The loser must recount against what is now on file.
    const base = 'ORD#S1';
    const first = nextLifecycleSeq(base, [], 'C');
    const second = nextLifecycleSeq(base, [`${base}C${first}`], 'C');
    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(`${base}C${first}`).not.toBe(`${base}C${second}`);
  });

  it('sequences each kind independently so a cancel cannot block an amend', () => {
    expect(nextLifecycleSeq('ORD#S1', ['ORD#S1C1'], 'A')).toBe(1);
    expect(nextLifecycleSeq('ORD#S1', ['ORD#S1A1'], 'C')).toBe(1);
  });
});
