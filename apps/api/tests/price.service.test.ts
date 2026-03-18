import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';

type PriceService = typeof import('../src/modules/prices/price.service');
let priceService: PriceService;
const broadcastToAll = mock(() => {});

beforeAll(async () => {
  mock.module('../src/modules/activity/session-tracker', () => ({
    broadcastToAll,
  }));

  mock.module('../src/modules/admin/settings.service', () => ({
    getCurrencySettings: async () => ({
      baseCurrency: 'USD',
      currencies: ['USD', 'EUR', 'DKK'],
    }),
  }));

  priceService = await import('../src/modules/prices/price.service');
});

afterAll(() => {
  mock.restore();
});

describe('price.service basics', () => {
  test('deduplicates identical Brent price updates', () => {
    priceService.__resetPriceStateForTests();
    broadcastToAll.mockClear();

    priceService.__applyBrentPriceForTests({
      ticker: 'BZ=F',
      name: 'Brent Oil',
      price: 104.16,
      change: 4.77,
      changePercent: 4.8,
      currency: 'USD',
    });

    priceService.__applyBrentPriceForTests({
      ticker: 'BZ=F',
      name: 'Brent Oil',
      price: 104.16,
      change: 4.77,
      changePercent: 4.8,
      currency: 'USD',
    });

    expect(broadcastToAll).toHaveBeenCalledTimes(1);
  });

  test('deduplicates identical FX updates', () => {
    priceService.__resetPriceStateForTests();
    broadcastToAll.mockClear();

    const payload = {
      base: 'USD',
      rates: { USD: 1, EUR: 0.96 },
      changes: { EUR: { change: -0.01, changePercent: -1.03 } },
    };

    priceService.__applyFxRatesForTests(payload);
    priceService.__applyFxRatesForTests(payload);

    expect(broadcastToAll).toHaveBeenCalledTimes(1);
  });

  test('latest payload always includes fx rates object and price list', () => {
    priceService.__resetPriceStateForTests();
    const payload = priceService.getLatestPricePayload();
    expect(Array.isArray(payload.prices)).toBe(true);
    expect(payload.fxRates?.base).toBe('USD');
    expect(payload.fxRates?.rates?.USD).toBe(1);
  });

  test('getLatestPrices starts empty before polling', () => {
    priceService.__resetPriceStateForTests();
    const prices = priceService.getLatestPrices();
    expect(prices).toEqual([]);
  });

  test('getFxRate returns 1 for USD and unknown currencies by default', () => {
    priceService.__resetPriceStateForTests();
    expect(priceService.getFxRate('USD')).toBe(1);
    expect(priceService.getFxRate('usd')).toBe(1);
    expect(priceService.getFxRate('ZZZ')).toBe(1);
  });

  test('reloadCurrencies keeps service operable', async () => {
    await priceService.reloadCurrencies();

    const payload = priceService.getLatestPricePayload();
    expect(payload.fxRates?.base).toBe('USD');
    expect(priceService.getFxRate('EUR')).toBeGreaterThan(0);
  });
});
