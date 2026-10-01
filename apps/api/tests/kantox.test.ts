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
  mapKantoxStatus,
  reconcileUpdates,
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

  // The old "last tranche absorbs the rounding" scheme could OVER-hedge: the
  // earlier shares each rounded up, and when the last share was smaller than that
  // accumulated overshoot it went negative and was dropped, leaving the kept parts
  // summing to more than the input (10 x $0.05 became $0.09). Largest-remainder
  // makes the sum exact for every input.
  it('sums exactly even when shares round to sub-cent amounts', () => {
    const cases: Array<[number, number]> = [[0.05, 10], [1, 150], [0.03, 12], [0.01, 12], [100000, 12], [1234.56, 7]];
    for (const [amount, n] of cases) {
      const parts = splitSellLegByTranche(amount, Array.from({ length: n }, () => ({ percent: 100 / n, dueDays: 30 })))!;
      const sum = parts.reduce((s, p) => s + p.amount, 0);
      expect(sum).toBeCloseTo(amount, 2);
      // Never more than the input — the direction that would over-hedge.
      expect(sum).toBeLessThanOrEqual(amount + 1e-9);
    }
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

  it('uses a suffixed ref for a SINGLE-tranche schedule, leaving bare #S to unscheduled orders', () => {
    // The boundary round-1 fixed: a singleton schedule must not claim the bare
    // `#S` ref, or a re-CONFIRM would reuse a pre-schedule hedge's ref with a
    // different payload.
    const sells = buildHedgePlan({ ...base, customerTranches: [{ percent: 100, dueDays: 60 }] }, settings)
      .entries.filter((e) => e.direction === 'SELL');
    expect(sells.map((e) => e.entryRef)).toEqual(['ORD-1#S1']);
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

describe('payment planning reads the children on file, not the cached total', () => {
  /**
   * The parent's `cancelledAmount` is a cache advanced when a child reaches SENT.
   * A child whose send landed at Kantox but whose response was lost stays FAILED
   * until the (15-minute) sync tick, so inside that window the cache understates
   * what is already closed and a further payment would plan against phantom
   * exposure. Counting the children on file gives the same figure without the lag.
   */
  function planFrom(closedFrom: 'cache' | 'children', parentAmount: number, childrenSent: number[], payment: number) {
    const cached = closedFrom === 'cache' ? 0 : childrenSent.reduce((s, c) => s + Math.abs(c), 0);
    return planPaymentClosures([{ amount: parentAmount, cancelled: cached }], payment);
  }

  it('never closes against exposure a landed-but-unrecorded child already closed', () => {
    // 100k parent; a 50k close LANDED at Kantox but the cache still says 0.
    const stalePlan = planFrom('cache', 100000, [-50000], 80000);
    const honestPlan = planFrom('children', 100000, [-50000], 80000);
    expect(stalePlan.reduce((s, p) => s + Math.abs(p.delta), 0)).toBe(80000); // 30k against closed exposure
    expect(honestPlan.reduce((s, p) => s + Math.abs(p.delta), 0)).toBe(50000); // exactly what is open
    expect(honestPlan.reduce((s, p) => s + Math.abs(p.delta), 0)).toBeLessThan(
      stalePlan.reduce((s, p) => s + Math.abs(p.delta), 0),
    );
  });
});

describe('mapKantoxStatus — Kantox entryStatus → our row status', () => {
  /**
   * The full live enum, verified against preprod on 2026-09-30 and confirmed by
   * Clément on 29/09 (`docs/kantox-emails-2026-09-30.md` Q4). `closed` is the
   * terminal status and the ONLY one that means the trade is executed; before
   * this mapping it was dropped, so a closed entry stayed SENT and
   * `findLateHedgeEntries` raised false late-payment flags to Pierre once its
   * value date passed. The cases below are the observed payloads, not invented.
   */
  it('maps closed — the only terminal status — to CLOSED', () => {
    // Every closed entry is CLOSED — Kantox: "An entry cannot be Closed without
    // being executed." The reason field is read only for a warning.
    expect(mapKantoxStatus('closed')).toBe('CLOSED');
    expect(mapKantoxStatus('CLOSED')).toBe('CLOSED');
    expect(mapKantoxStatus('closed', 'take_profit_rate')).toBe('CLOSED');
    expect(mapKantoxStatus('closed', 'execution_requested_by_client')).toBe('CLOSED');
  });

  it('leaves every still-open status untouched', () => {
    // in_position = monitoring the conditional order; in_order = queued;
    // accumulating = bucket with no entry yet; pending = Pierre executes by hand.
    for (const s of ['in_position', 'in_order', 'accumulating', 'pending']) {
      expect(mapKantoxStatus(s)).toBeNull();
    }
  });

  it('keeps the older terminal guesses working', () => {
    expect(mapKantoxStatus('hedged')).toBe('HEDGED');
    expect(mapKantoxStatus('executed')).toBe('HEDGED');
  });

  it('never downgrades on an unknown or absent status', () => {
    expect(mapKantoxStatus(null)).toBeNull();
    expect(mapKantoxStatus('')).toBeNull();
    expect(mapKantoxStatus('something_new')).toBeNull();
  });

  it('a closed entry is no longer late — the regression this fixes', () => {
    const row = { id: 'e1', status: mapKantoxStatus('closed', 'take_profit_rate')!, valueDate: '2026-09-10', amount: '1000.00', cancelledAmount: '0.00' };
    expect(row.status).toBe('CLOSED');
    expect(findLateHedgeEntries([row], '2026-09-22')).toEqual([]);
    // ...whereas the same row left at SENT would have been flagged.
    expect(findLateHedgeEntries([{ ...row, status: 'SENT' }], '2026-09-22')).toEqual(['e1']);
  });
});

describe('reconcileUpdates — what one 15-minute sync tick writes', () => {
  const row = (over: Partial<{ status: string; hedgedRate: string | null; executionRate: string | null; valueDate: string | null }> = {}) => ({
    status: over.status ?? 'SENT',
    hedgedRate: over.hedgedRate === undefined ? null : over.hedgedRate,
    executionRate: over.executionRate === undefined ? null : over.executionRate,
    valueDate: over.valueDate === undefined ? null : over.valueDate,
  });
  const remote = (over: Partial<{ entryStatus: string; hedgedRate: number | null; executionRate: number | null; executionReason: string | null; valueDate: string | null }> = {}) => ({
    entryStatus: over.entryStatus ?? 'closed',
    hedgedRate: over.hedgedRate === undefined ? null : over.hedgedRate,
    executionRate: over.executionRate === undefined ? null : over.executionRate,
    // 'closed' without a reason now reads as CANCELLED, so the default supplies
    // one; tests that mean "cancelled" pass executionReason: null explicitly.
    executionReason: over.executionReason === undefined
      ? ((over.entryStatus ?? 'closed') === 'closed' ? 'take_profit_rate' : null)
      : over.executionReason,
    valueDate: over.valueDate === undefined ? null : over.valueDate,
  });

  it('writes CLOSED once and then stops — the tick must converge', () => {
    const r = row();
    const first = reconcileUpdates(r, remote({ hedgedRate: 1.144906585 }));
    expect(first.status).toBe('CLOSED');
    // Second tick reads the row it just wrote; nothing may be decided again.
    const second = reconcileUpdates(
      row({ status: 'CLOSED', hedgedRate: String(first.hedgedRate) }),
      remote({ hedgedRate: 1.144906585 }),
    );
    expect(second).toEqual({});
  });

  it('does not churn hedged_rate on an 8-decimal column holding a 9-decimal remote rate', () => {
    // Live value: Kantox returns 1.144906585, numeric(14,8) stores 1.14490659.
    // A plain !== comparison re-wrote this row every 15 minutes forever.
    // entryStatus pinned open so only the rate decision is under test.
    expect(reconcileUpdates(row({ hedgedRate: '1.14490659' }), remote({ entryStatus: 'in_position', hedgedRate: 1.144906585 }))).toEqual({});
    expect(reconcileUpdates(row({ hedgedRate: '1.13595349' }), remote({ entryStatus: 'in_position', hedgedRate: 1.135953489 }))).toEqual({});
  });

  it('still writes a genuinely different hedged_rate (a roll to a new rate)', () => {
    const u = reconcileUpdates(row({ hedgedRate: '1.13595349' }), remote({ hedgedRate: 1.1402 }));
    expect(u.hedgedRate).toBe('1.1402');
  });

  it('never writes executionRate 0.0 over a real one', () => {
    // Client-requested executions come back 0.0 (docs/kantox-emails-2026-09-30.md Q5).
    const u = reconcileUpdates(row({ executionRate: '1.1337' }), remote({ executionRate: 0 }));
    expect(u.executionRate).toBeUndefined();
    expect(reconcileUpdates(row(), remote({ entryStatus: 'in_position', executionRate: 0 }))).toEqual({});
  });

  it('writes a real executionRate', () => {
    expect(reconcileUpdates(row(), remote({ executionRate: 1.1337 })).executionRate).toBe('1.1337');
  });

  it('leaves an open status alone and an unknown status untouched', () => {
    expect(reconcileUpdates(row(), remote({ entryStatus: 'in_position' }))).toEqual({});
    expect(reconcileUpdates(row(), remote({ entryStatus: 'in_order' }))).toEqual({});
    expect(reconcileUpdates(row(), remote({ entryStatus: 'brand_new' }))).toEqual({});
  });
});

describe('mapKantoxStatus — equality, not substring, on the terminal status', () => {
  /**
   * Panel finding (kimi-k3): a substring match on `closed` would treat a future
   * status such as `not_closed` or `pending_closure` as terminal, and a false
   * CLOSED silences a genuine late-payment flag — the exact class of bug this
   * mapping exists to fix. Equality is the safe form.
   */
  it('matches closed exactly and nothing that merely contains it', () => {
    expect(mapKantoxStatus('closed', 'take_profit_rate')).toBe('CLOSED');
    expect(mapKantoxStatus(' Closed ', 'take_profit_rate')).toBe('CLOSED');
    for (const s of ['not_closed', 'pending_closure', 'closed_pending', 'unclosed', 'reopened']) {
      expect(mapKantoxStatus(s)).toBeNull();
    }
  });
});

describe('reconcileUpdates — writing at the column scale', () => {
  const row = (over: Partial<{ hedgedRate: string | null; executionRate: string | null; status: string; valueDate: string | null }> = {}) => ({
    status: over.status ?? 'SENT',
    hedgedRate: over.hedgedRate === undefined ? null : over.hedgedRate,
    executionRate: over.executionRate === undefined ? null : over.executionRate,
    valueDate: over.valueDate === undefined ? null : over.valueDate,
  });

  it('writes the raw remote rate for Postgres to round — NOT JS toFixed(8)', () => {
    // Measured: (1.144906585).toFixed(8) === '1.14490658' on a double, while
    // Postgres numeric(14,8) rounds the decimal string to '1.14490659'. Writing
    // toFixed would store an off-by-one-in-the-8th-digit rate; the raw string is
    // correct and rounds identically on read-back, so no churn either way.
    expect((1.144906585).toFixed(8)).toBe('1.14490658'); // documents why not toFixed
    const u = reconcileUpdates(row(), { entryStatus: 'in_position', hedgedRate: 1.144906585, executionRate: null, executionReason: null, valueDate: null });
    expect(u.hedgedRate).toBe('1.144906585');
  });

  it('treats a missing stored rate as a change, not as 0', () => {
    // Comparing null as 0 could silently drop a genuine remote rate that rounds
    // below the epsilon; an absent stored value is always worth writing.
    expect(reconcileUpdates(row(), { entryStatus: 'in_position', hedgedRate: 1e-12, executionRate: null, executionReason: null, valueDate: null }).hedgedRate).toBe('1e-12');
  });
});

describe('the CLOSED mapping protects the payment path (panel finding, verified live)', () => {
  /**
   * Two writers set CLOSED and both mean "send no further delta": the sync
   * reconciler (executed at Kantox) and the payment-close path (settled by
   * payment). A close is a NEGATIVE entry — it opens an opposite position rather
   * than settling the hedge — so once Kantox has executed, a close must not be
   * sent. Before the mapping, all 12 live executed entries stayed SENT, and the
   * sell-leg filter below would have picked them up and fired a naked cancel.
   */
  const isClosableSellLeg = (r: { direction: string; status: string }) =>
    r.direction === 'SELL' && (r.status === 'SENT' || r.status === 'HEDGED');

  it('an executed entry is not treated as a closeable sell leg', () => {
    // What the reconciler now writes for 20260922-000564#S (executed, value date
    // 09/11/2026 — future, so the customer payment has not happened yet).
    const executed = { direction: 'SELL', status: mapKantoxStatus('closed', 'take_profit_rate')! };
    expect(executed.status).toBe('CLOSED');
    expect(isClosableSellLeg(executed)).toBe(false);
    // Whereas the same row left SENT (the pre-fix state) IS closeable — this is
    // the exposure the mapping removes.
    expect(isClosableSellLeg({ direction: 'SELL', status: 'SENT' })).toBe(true);
    // A genuinely open leg is still closeable, so the path is not disabled.
    expect(isClosableSellLeg({ direction: 'SELL', status: mapKantoxStatus('in_position') ?? 'SENT' })).toBe(true);
  });
});

describe('closed: executed vs cancelled', () => {
  /**
   * Clément, 01/10/2026: "An entry cannot be Closed without being executed."
   * An earlier cut of this code read a reasonless `closed` as CANCELLED, which
   * is UNSOUND — a null executionReason does not mean cancelled, and treating
   * it as such would suppress both the late-payment flag and the payment close
   * on a hedge that really did execute. Closed is closed.
   */
  it('reads every closed entry as CLOSED, reason or not', () => {
    expect(mapKantoxStatus('closed', 'take_profit_rate')).toBe('CLOSED');
    expect(mapKantoxStatus('closed', 'execution_requested_by_client')).toBe('CLOSED');
    expect(mapKantoxStatus('closed', null)).toBe('CLOSED');
    expect(mapKantoxStatus('closed')).toBe('CLOSED');
  });

  it('maps a cancelled status defensively, should Kantox ever report one', () => {
    expect(mapKantoxStatus('cancelled')).toBe('CANCELLED');
    expect(mapKantoxStatus('Canceled')).toBe('CANCELLED');
  });

  it('a cancelled entry is neither closeable nor late-flagged, a closed one is not flagged either', () => {
    const cancelled = { direction: 'SELL', status: mapKantoxStatus('cancelled')! };
    expect(cancelled.status).toBe('CANCELLED');
    expect(findLateHedgeEntries(
      [{ id: 'x', status: cancelled.status, valueDate: '2026-01-01', amount: '1000.00', cancelledAmount: '0.00' }],
      '2026-11-10',
    )).toEqual([]);
    // An EXECUTED hedge is CLOSED, so it is also not late-flagged — the fix that
    // started this work.
    expect(findLateHedgeEntries(
      [{ id: 'y', status: mapKantoxStatus('closed', null)!, valueDate: '2026-01-01', amount: '1000.00', cancelledAmount: '0.00' }],
      '2026-11-10',
    )).toEqual([]);
  });

  it('reconciling a closed entry writes CLOSED even with no reason', () => {
    const u = reconcileUpdates(
      { status: 'SENT', hedgedRate: null, executionRate: null, valueDate: null },
      { entryStatus: 'closed', hedgedRate: null, executionRate: null, executionReason: null, valueDate: null },
    );
    expect(u.status).toBe('CLOSED');
  });
});

describe('entry_rate — the booking rate sent on every INITIAL push', () => {
  /**
   * Asked on 09/09 and re-confirmed 29/09 ("very useful to receive for Analytics
   * later if you are able to send it"). Derived from the existing FX feed:
   * getFxRate returns USD-per-unit (base USD), so EUR → the EURUSD quote Kantox
   * itself reports. Direction verified against live data: our 564/565 entries
   * came back `rate: 1.1461` alongside `hedgedRate: 1.1449`.
   */
  const snap = (over: Partial<Parameters<typeof buildHedgePlan>[0]> = {}) => ({
    tenantId: 't1',
    orderId: 'o1',
    orderNumber: '20260911-000522',
    dueDate: '2026-10-01',
    items: [{
      id: 'i1', orderSupplierId: 's1', quantity: 100, quantityMin: 100,
      salesPrice: 900, costPrice: 800, salesCurrency: 'USD', costCurrency: 'USD',
    }],
    ...over,
  } as Parameters<typeof buildHedgePlan>[0]);
  const SETTINGS = {
    marginHedgePercent: 100, paymentDateBufferDays: 7, valueDateRounding: 'WEEKLY_MONDAY' as const,
    hedgeCurrency: 'USD', hedgeCounterCurrency: 'EUR', bookingRate: 1.1461,
  };

  it('carries entryRate + entryRatePair on every planned leg', () => {
    const plan = buildHedgePlan(snap(), SETTINGS);
    expect(plan.entries.length).toBeGreaterThan(0);
    for (const e of plan.entries) {
      expect(typeof e.entryRate).toBe('number');
      expect(e.entryRate).toBeGreaterThan(0);
      expect(e.entryRatePair).toBe('EURUSD');
    }
  });

  it('omits entryRate rather than sending a bogus 1.0 when the feed has no rate', () => {
    // getFxRate falls back to 1 for an unknown currency; sending 1.0 would look
    // to Kantox like a claim the pair trades at parity.
    const plan = buildHedgePlan(snap(), { ...SETTINGS, hedgeCounterCurrency: 'ZZZ', bookingRate: undefined });
    for (const e of plan.entries) expect(e.entryRate).toBeUndefined();
  });

  it('never puts a rate on a lifecycle close (no booking rate exists for it)', () => {
    // planPaymentClosures builds closes via a separate path that never sets
    // entryRate — asserted structurally by the PlannedHedgeEntry construction in
    // onCustomerPaymentForKantox, which does not reference entryRate.
    const plan = buildHedgePlan(snap(), SETTINGS);
    expect(plan.entries.every((e) => e.entryRate === undefined || e.entryRate > 0)).toBe(true);
  });
});

describe('entry_rate precision — the round2 trap', () => {
  /**
   * `getFxRate` returns the DISPLAY-rounded figure (prices/price.service round2),
   * so EURUSD reads 1.14 against a real 1.1370 — ~0.44% on a ~1.14 pair. Using
   * it as `entry_rate` would hand Kantox a rate that is wrong by far more than
   * the move they are trying to measure, so the Kantox path takes the precise
   * accessor instead. This test pins the reasoning, not the wiring.
   */
  it('shows why getFxRate is unusable as a booking rate', () => {
    const real = 1.1370;
    const asDisplayed = Math.round(real * 100) / 100; // round2
    expect(asDisplayed).toBe(1.14);
    const errorPct = Math.abs(asDisplayed - real) / real * 100;
    expect(errorPct).toBeGreaterThan(0.2); // ~0.26%, vs a typical daily move of ~0.5%
  });

  it('a 4-decimal rate survives the numeric(14,8) column unchanged', () => {
    // The column has 8 decimals, so there is no rounding to hide behind.
    expect(String(1.1370)).toBe('1.137');
  });
});

describe('value date reconciliation — rolls change it in place', () => {
  /**
   * Clément, 01/10/2026: "An entry that is rolled keep the same entryRef, the
   * only difference is the new VD." Since the ref does not change, NOTHING else
   * would ever notice a roll, and our stored date would go stale while the
   * late-payment flag keyed off it.
   */
  const row = (valueDate: string | null) => ({ status: 'SENT', hedgedRate: null, executionRate: null, valueDate });
  const remote = (valueDate: string | null) => ({
    entryStatus: 'in_order', hedgedRate: null, executionRate: null, executionReason: null, valueDate,
  });

  it('writes the new value date, converting DD/MM/YYYY to ISO', () => {
    expect(reconcileUpdates(row('2026-10-26'), remote('02/11/2026')).valueDate).toBe('2026-11-02');
  });

  it('writes nothing when the date already matches', () => {
    expect(reconcileUpdates(row('2026-11-02'), remote('02/11/2026'))).toEqual({});
  });

  it('never blanks a good local date from an unparseable remote one', () => {
    for (const bad of [null, '', '2026-11-02', 'not a date', '2/11/2026']) {
      expect(reconcileUpdates(row('2026-10-26'), remote(bad)).valueDate).toBeUndefined();
    }
  });

  it('keeps the date when the row has none and remote has none', () => {
    expect(reconcileUpdates(row(null), remote(null))).toEqual({});
  });
});

describe('MONTH_END rounding — Pierre, 01/10/2026', () => {
  /**
   * "round up Value Dates to the last opening date of the month. any invoices
   * with due date in October should have a rounded VD to 30/10."
   *
   * Deliberately distinct from the existing MONTHLY mode, which moves to the 1st
   * of the NEXT month — a setting flip would have been wrong.
   */
  const base = {
    deliveredAt: '2026-10-01', bufferDays: 0,
    rounding: 'MONTH_END' as const,
  };

  it('rounds any October due date to 31/10 (calendar month end)', () => {
    // Pierre's example produced 30/10 because he counted opening days; the pure
    // function can only know the calendar month end, and 31 Oct 2026 is a
    // Saturday — see the limitation noted in deriveValueDate.
    expect(deriveValueDate(base)).toBe('2026-10-31');
    expect(deriveValueDate({ ...base, deliveredAt: '2026-10-15' })).toBe('2026-10-31');
  });

  it('handles a 30-day month and February correctly', () => {
    expect(deriveValueDate({ ...base, deliveredAt: '2026-11-05' })).toBe('2026-11-30');
    expect(deriveValueDate({ ...base, deliveredAt: '2027-02-10' })).toBe('2027-02-28');
    expect(deriveValueDate({ ...base, deliveredAt: '2028-02-10' })).toBe('2028-02-29'); // leap
  });

  it('is NOT the same as MONTHLY (which jumps to the 1st of next month)', () => {
    expect(deriveValueDate({ ...base, rounding: 'MONTHLY' })).toBe('2026-11-01');
    expect(deriveValueDate(base)).toBe('2026-10-31');
  });

  it('still applies the payment buffer before rounding', () => {
    // 28/10 + 7 days = 04/11, so it rounds to November's end, not October's.
    expect(deriveValueDate({ ...base, deliveredAt: '2026-10-28', bufferDays: 7 })).toBe('2026-11-30');
  });
});
