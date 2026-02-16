import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';

type PriceService = typeof import('../src/modules/prices/price.service');
let priceService: PriceService;

beforeAll(async () => {
  mock.module('../src/modules/activity/session-tracker', () => ({
    broadcastToAll: () => {},
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
  test('latest payload always includes fx rates object and price list', () => {
    const payload = priceService.getLatestPricePayload();
    expect(Array.isArray(payload.prices)).toBe(true);
    expect(payload.fxRates?.base).toBe('USD');
    expect(payload.fxRates?.rates?.USD).toBe(1);
  });

  test('getLatestPrices starts empty before polling', () => {
    const prices = priceService.getLatestPrices();
    expect(prices).toEqual([]);
  });

  test('getFxRate returns 1 for USD and unknown currencies by default', () => {
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
