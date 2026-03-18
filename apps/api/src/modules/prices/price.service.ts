// ═══════════════════════════════════════════════════════════════════════
//  Commodity Price Service — Live commodity prices
//
//  • Brent Crude Oil (BZ=F) — Yahoo Finance WebSocket (protobuf)
//    with REST API for initial data
//  • London Gas Oil (ICE Gasoil) — Investing.com page scrape (60s poll)
//
//  Broadcasts to all connected clients via session-tracker.
// ═══════════════════════════════════════════════════════════════════════

import { broadcastToAll } from '../activity/session-tracker';
import { getCurrencySettings } from '../admin/settings.service';
import { createHash } from 'node:crypto';
import * as protobuf from 'protobufjs';

// ─── Types ───────────────────────────────────────────────────────────

export interface CommodityPrice {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  currency: string;
  updatedAt: string;
}

export interface PricesPayload {
  prices: CommodityPrice[];
  fxRates?: FxRates;
}

export interface PriceSnapshotPayload {
  version: string;
  pricesByTicker: Record<string, CommodityPrice>;
  fxRates?: FxRates;
}

export interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace';
  path: string;
  value?: unknown;
}

export interface PricePatchPayload {
  baseVersion: string;
  version: string;
  operations: JsonPatchOperation[];
}

export interface FxRates {
  base: string;
  rates: Record<string, number>;
  changes: Record<string, { change: number; changePercent: number }>;
  updatedAt: string | null;
}

// ─── Config ──────────────────────────────────────────────────────────

const GASOIL_POLL_INTERVAL_MS = 60_000; // 60 seconds
const FX_POLL_INTERVAL_MS = 5 * 60_000; // 5 minutes
const BRENT_STALE_MS = 2 * 60_000;     // 2 minutes — if WS is silent this long, poll REST
const FX_BASE = 'USD';

// Dynamic FX ticker maps — rebuilt from tenant currency settings
let FX_TICKERS: Record<string, string> = {};
let FX_WS_TICKERS: string[] = [];
let FX_TICKER_TO_CURRENCY: Record<string, string> = {};

function buildFxTickerMaps(currencies: string[]): void {
  FX_TICKERS = {};
  for (const c of currencies) {
    const code = c.toUpperCase();
    if (code === FX_BASE) continue; // skip base currency
    FX_TICKERS[code] = `${code}${FX_BASE}=X`;
  }
  FX_WS_TICKERS = Object.values(FX_TICKERS);
  FX_TICKER_TO_CURRENCY = Object.fromEntries(
    Object.entries(FX_TICKERS).map(([currency, ticker]) => [ticker, currency]),
  );
}

async function loadCurrencyConfig(): Promise<void> {
  try {
    const { currencies } = await getCurrencySettings();
    buildFxTickerMaps(currencies);
    console.log(`[Prices] Loaded ${Object.keys(FX_TICKERS).length} FX currencies: ${Object.keys(FX_TICKERS).join(', ')}`);
  } catch (err: any) {
    console.warn('[Prices] Failed to load currency settings, using defaults:', err.message);
    buildFxTickerMaps(['EUR', 'DKK', 'AED']);
  }
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ─── State ───────────────────────────────────────────────────────────

let brentPrice: CommodityPrice | null = null;
let gasoilPrice: CommodityPrice | null = null;
let gasoilTimer: ReturnType<typeof setInterval> | null = null;
let fxTimer: ReturnType<typeof setInterval> | null = null;
let fxRates: FxRates = {
  base: FX_BASE,
  rates: { [FX_BASE]: 1 },
  changes: {},
  updatedAt: null,
};

// Yahoo WS state
let yahooWs: WebSocket | null = null;
let PricingData: protobuf.Type | null = null;
let yahooReconnectTimer: ReturnType<typeof setTimeout> | null = null;
let brentStaleTimer: ReturnType<typeof setInterval> | null = null;
let lastBroadcastSnapshot: PriceSnapshotPayload | null = null;

function buildSnapshotVersion(data: {
  pricesByTicker: Record<string, CommodityPrice>;
  fxRates?: FxRates;
}): string {
  const priceFingerprint = Object.entries(data.pricesByTicker)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([ticker, price]) => `${ticker}:${price.price}:${price.change}:${price.changePercent}:${price.currency}:${price.updatedAt}`)
    .join('|');
  const fxRatesFingerprint = Object.entries(data.fxRates?.rates ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, rate]) => `${currency}:${rate}`)
    .join('|');
  const fxChangesFingerprint = Object.entries(data.fxRates?.changes ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, change]) => `${currency}:${change.change}:${change.changePercent}`)
    .join('|');

  const fingerprint = [
    priceFingerprint,
    data.fxRates?.base ?? '',
    fxRatesFingerprint,
    fxChangesFingerprint,
    data.fxRates?.updatedAt ?? '',
  ].join('||');

  return createHash('sha256').update(fingerprint).digest('base64url').slice(0, 16);
}

function buildPriceSnapshotPayload(): PriceSnapshotPayload {
  const pricesByTicker = Object.fromEntries(
    getLatestPrices().map((price) => [price.ticker, price]),
  );

  const snapshotCore = {
    pricesByTicker,
    fxRates,
  };

  return {
    version: buildSnapshotVersion(snapshotCore),
    ...snapshotCore,
  };
}

function buildPricePatchPayload(
  previous: PriceSnapshotPayload,
  next: PriceSnapshotPayload,
): PricePatchPayload | null {
  const operations: JsonPatchOperation[] = [
    { op: 'replace', path: '/version', value: next.version },
  ];

  for (const ticker of Object.keys(previous.pricesByTicker)) {
    if (!next.pricesByTicker[ticker]) {
      operations.push({ op: 'remove', path: `/pricesByTicker/${escapeJsonPointer(ticker)}` });
    }
  }

  for (const [ticker, price] of Object.entries(next.pricesByTicker)) {
    const prev = previous.pricesByTicker[ticker];
    if (!prev || !isSameCommodityPrice(prev, price)) {
      operations.push({
        op: prev ? 'replace' : 'add',
        path: `/pricesByTicker/${escapeJsonPointer(ticker)}`,
        value: price,
      });
    }
  }

  const prevFx = previous.fxRates;
  const nextFx = next.fxRates;
  if (prevFx && !nextFx) {
    operations.push({ op: 'remove', path: '/fxRates' });
  } else if (nextFx) {
    if (!prevFx) {
      operations.push({ op: 'add', path: '/fxRates', value: nextFx });
    } else {
      if (prevFx.base !== nextFx.base) {
        operations.push({ op: 'replace', path: '/fxRates/base', value: nextFx.base });
      }

      for (const currency of Object.keys(prevFx.rates)) {
        if (!(currency in nextFx.rates)) {
          operations.push({ op: 'remove', path: `/fxRates/rates/${escapeJsonPointer(currency)}` });
        }
      }

      for (const [currency, rate] of Object.entries(nextFx.rates)) {
        if (!(currency in prevFx.rates)) {
          operations.push({ op: 'add', path: `/fxRates/rates/${escapeJsonPointer(currency)}`, value: rate });
        } else if (prevFx.rates[currency] !== rate) {
          operations.push({ op: 'replace', path: `/fxRates/rates/${escapeJsonPointer(currency)}`, value: rate });
        }
      }

      for (const currency of Object.keys(prevFx.changes)) {
        if (!(currency in nextFx.changes)) {
          operations.push({ op: 'remove', path: `/fxRates/changes/${escapeJsonPointer(currency)}` });
        }
      }

      for (const [currency, change] of Object.entries(nextFx.changes)) {
        const prevChange = prevFx.changes[currency];
        if (!prevChange) {
          operations.push({ op: 'add', path: `/fxRates/changes/${escapeJsonPointer(currency)}`, value: change });
        } else if (
          prevChange.change !== change.change
          || prevChange.changePercent !== change.changePercent
        ) {
          operations.push({ op: 'replace', path: `/fxRates/changes/${escapeJsonPointer(currency)}`, value: change });
        }
      }

      if (prevFx.updatedAt !== nextFx.updatedAt) {
        operations.push({ op: 'replace', path: '/fxRates/updatedAt', value: nextFx.updatedAt });
      }
    }
  }

  if (operations.length === 1) {
    return null;
  }

  return {
    baseVersion: previous.version,
    version: next.version,
    operations,
  };
}

function escapeJsonPointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

function isSameCommodityPrice(
  current: CommodityPrice | null,
  next: Omit<CommodityPrice, 'updatedAt'>,
): boolean {
  if (!current) return false;
  return current.ticker === next.ticker
    && current.name === next.name
    && current.price === next.price
    && current.change === next.change
    && current.changePercent === next.changePercent
    && current.currency === next.currency;
}

function updateCommodityPrice(
  current: CommodityPrice | null,
  next: Omit<CommodityPrice, 'updatedAt'>,
): CommodityPrice | null {
  if (isSameCommodityPrice(current, next)) {
    return current;
  }

  return {
    ...next,
    updatedAt: new Date().toISOString(),
  };
}

function isSameFxRates(current: FxRates, next: Omit<FxRates, 'updatedAt'>): boolean {
  if (current.base !== next.base) return false;

  const currentRateEntries = Object.entries(current.rates).sort(([a], [b]) => a.localeCompare(b));
  const nextRateEntries = Object.entries(next.rates).sort(([a], [b]) => a.localeCompare(b));
  if (currentRateEntries.length !== nextRateEntries.length) return false;
  for (let index = 0; index < currentRateEntries.length; index++) {
    const currentEntry = currentRateEntries[index];
    const nextEntry = nextRateEntries[index];
    if (!currentEntry || !nextEntry) return false;
    if (currentEntry[0] !== nextEntry[0] || currentEntry[1] !== nextEntry[1]) return false;
  }

  const currentChangeEntries = Object.entries(current.changes).sort(([a], [b]) => a.localeCompare(b));
  const nextChangeEntries = Object.entries(next.changes).sort(([a], [b]) => a.localeCompare(b));
  if (currentChangeEntries.length !== nextChangeEntries.length) return false;
  for (let index = 0; index < currentChangeEntries.length; index++) {
    const currentEntry = currentChangeEntries[index];
    const nextEntry = nextChangeEntries[index];
    if (!currentEntry || !nextEntry) return false;
    if (currentEntry[0] !== nextEntry[0]) return false;
    if (currentEntry[1].change !== nextEntry[1].change || currentEntry[1].changePercent !== nextEntry[1].changePercent) {
      return false;
    }
  }

  return true;
}

function updateFxRates(next: Omit<FxRates, 'updatedAt'>): boolean {
  if (isSameFxRates(fxRates, next)) {
    return false;
  }

  fxRates = {
    ...next,
    updatedAt: new Date().toISOString(),
  };

  return true;
}

// ─── Yahoo Finance WebSocket (Brent Oil) ─────────────────────────────

const YAHOO_PROTO_FALLBACK = `syntax = "proto3";

package yahoo.finance;

message PricingData {
  string id = 1;
  float price = 2;
  sint64 time = 3;
  string currency = 4;
  string exchange = 5;
  int32 quoteType = 6;
  int32 marketHours = 7;
  float changePercent = 8;
  sint64 dayVolume = 9;
  float dayHigh = 10;
  float dayLow = 11;
  float change = 12;
  string shortName = 13;
  sint64 expireDate = 14;
  float openPrice = 15;
  float previousClose = 16;
  string strikePrice = 17;
  string underlyingSymbol = 18;
  sint64 openInterest = 19;
  string optionsType = 20;
  sint64 miniOption = 21;
  sint64 lastSize = 22;
  float bid = 23;
  float bidSize = 24;
  float ask = 25;
  float askSize = 26;
  sint64 priceHint = 27;
  sint64 vol_24hr = 28;
  sint64 volAllCurrencies = 29;
  string fromCurrency = 30;
  string lastMarket = 31;
  double circulatingSupply = 32;
  double marketcap = 33;
}
`;

async function initYahooWs(): Promise<void> {
  try {
    const root = protobuf.parse(YAHOO_PROTO_FALLBACK).root;
    PricingData = root.lookupType('yahoo.finance.PricingData');
    console.log('[Prices] Protobuf schema loaded');

    // Fetch initial Brent price via REST API
    await fetchBrentRest();

    // Then connect to WebSocket for real-time updates
    connectYahooWs();

    // Periodically check if WS went silent and fetch via REST as fallback
    if (brentStaleTimer) clearInterval(brentStaleTimer);
    brentStaleTimer = setInterval(async () => {
      if (!brentPrice?.updatedAt) return;
      const age = Date.now() - new Date(brentPrice.updatedAt).getTime();
      if (age > BRENT_STALE_MS) {
        console.log(`[Prices] Brent data stale (${Math.round(age / 1000)}s), fetching via REST`);
        await fetchBrentRest();
      }
    }, GASOIL_POLL_INTERVAL_MS);
  } catch (err: any) {
    console.error('[Prices] Failed to load protobuf schema:', err.message);
    // Fall back to REST polling
    console.log('[Prices] Falling back to REST polling for Brent');
    await fetchBrentRest();
    setInterval(fetchBrentRest, GASOIL_POLL_INTERVAL_MS);
  }
}

function connectYahooWs(): void {
  if (yahooReconnectTimer) {
    clearTimeout(yahooReconnectTimer);
    yahooReconnectTimer = null;
  }

  console.log('[Prices] Connecting to Yahoo Finance WebSocket…');
  yahooWs = new WebSocket('wss://streamer.finance.yahoo.com/');

  yahooWs.onopen = () => {
    console.log('[Prices] Yahoo WebSocket connected');
    const subscribeTickers = ['BZ=F', ...FX_WS_TICKERS];
    yahooWs!.send(JSON.stringify({ subscribe: subscribeTickers }));
    console.log(`[Prices] Subscribed to ${subscribeTickers.join(', ')}`);
  };

  yahooWs.onmessage = (event) => {
    if (!PricingData) return;

    try {
      // Yahoo sends base64-encoded protobuf
      const raw = typeof event.data === 'string' ? event.data : String(event.data);
      const buffer = Buffer.from(raw, 'base64');
      const message = PricingData.decode(new Uint8Array(buffer));
      const obj: any = PricingData.toObject(message, {
        longs: String,
        enums: String,
        bytes: String,
      });

      if (obj.id === 'BZ=F' && obj.price) {
        const price = obj.price;
        const changePercent = obj.changePercent ?? 0;
        const change = obj.change ?? (obj.previousClose ? price - obj.previousClose : 0);

        const nextBrentPrice = updateCommodityPrice(brentPrice, {
          ticker: 'BZ=F',
          name: 'Brent Oil',
          price: round2(price),
          change: round2(change),
          changePercent: round2(changePercent),
          currency: obj.currency || 'USD',
        });

        if (nextBrentPrice === brentPrice) return;
        brentPrice = nextBrentPrice;

        broadcast();
      } else if (obj.id && obj.price && FX_TICKER_TO_CURRENCY[obj.id]) {
        const currency = FX_TICKER_TO_CURRENCY[obj.id];
        const fxPrice = obj.price;
        const fxPrevClose = obj.previousClose;
        const fxChange = obj.change ?? (fxPrevClose ? fxPrice - fxPrevClose : 0);
        const fxChangePct = obj.changePercent ?? (fxPrevClose ? ((fxPrice - fxPrevClose) / fxPrevClose) * 100 : 0);

        const didUpdateFx = updateFxRates({
          base: FX_BASE,
          rates: {
            ...fxRates.rates,
            [currency]: round2(fxPrice),
          },
          changes: {
            ...fxRates.changes,
            [currency]: { change: round2(fxChange), changePercent: round2(fxChangePct) },
          },
        });
        if (!didUpdateFx) return;
        broadcast();
      }
    } catch (err: any) {
      console.warn('[Prices] Yahoo WS decode error:', err.message);
    }
  };

  yahooWs.onclose = () => {
    console.log('[Prices] Yahoo WebSocket disconnected, reconnecting in 5s…');
    yahooReconnectTimer = setTimeout(connectYahooWs, 5000);
  };

  yahooWs.onerror = (err) => {
    console.warn('[Prices] Yahoo WebSocket error:', err);
  };
}

async function fetchBrentRest(): Promise<void> {
  try {
    const price = await fetchYahooChart('BZ=F', 'Brent Oil');
    if (price) {
      const nextBrentPrice = updateCommodityPrice(brentPrice, {
        ticker: price.ticker,
        name: price.name,
        price: price.price,
        change: price.change,
        changePercent: price.changePercent,
        currency: price.currency,
      });
      if (nextBrentPrice === brentPrice) return;
      brentPrice = nextBrentPrice;
      broadcast();
    }
  } catch (err: any) {
    console.warn('[Prices] Failed to fetch Brent REST:', err.message);
  }
}

// ─── Investing.com (London Gas Oil) ──────────────────────────────────

async function fetchGasOil(): Promise<void> {
  try {
    const res = await fetch(
      'https://www.investing.com/commodities/london-gas-oil',
      {
        headers: {
          'User-Agent': UA,
          Accept: 'text/html,application/xhtml+xml',
        },
      },
    );
    if (!res.ok) {
      console.warn(`[Prices] Investing.com Gas Oil HTTP ${res.status}`);
      await fetchGasOilYahoo();
      return;
    }

    const html = await res.text();

    const priceMatch = html.match(
      /data-test="instrument-price-last"[^>]*>([\d,.]+)/,
    );
    const prevMatch = html.match(
      /Prev\.\s*Close[\s\S]*?>([\d,.]+)/,
    );

    if (!priceMatch) {
      console.warn('[Prices] Investing.com Gas Oil: price not found in HTML');
      await fetchGasOilYahoo();
      return;
    }

    const price = parseFloat(priceMatch[1].replace(/,/g, ''));
    const previousClose = prevMatch
      ? parseFloat(prevMatch[1].replace(/,/g, ''))
      : price;
    const change = price - previousClose;
    const changePercent =
      previousClose !== 0 ? (change / previousClose) * 100 : 0;

    const nextGasoilPrice = updateCommodityPrice(gasoilPrice, {
      ticker: 'LGO',
      name: 'Gasoil',
      price: round2(price),
      change: round2(change),
      changePercent: round2(changePercent),
      currency: 'USD',
    });

    if (nextGasoilPrice === gasoilPrice) {
      return;
    }

    gasoilPrice = nextGasoilPrice;

    broadcast();
  } catch (err: any) {
    console.warn('[Prices] Failed to fetch Gas Oil:', err.message);
    await fetchGasOilYahoo();
  }
}

async function fetchGasOilYahoo(): Promise<void> {
  const price = await fetchYahooChart('LGOc1', 'Gasoil');
  if (price) {
    const nextGasoilPrice = updateCommodityPrice(gasoilPrice, {
      ticker: 'LGO',
      name: price.name,
      price: price.price,
      change: price.change,
      changePercent: price.changePercent,
      currency: price.currency,
    });
    if (nextGasoilPrice === gasoilPrice) return;
    gasoilPrice = nextGasoilPrice;
    broadcast();
  }
}

// ─── FX Rates (Yahoo REST) ───────────────────────────────────────────

async function fetchFxRates(): Promise<void> {
  const nextRates: Record<string, number> = { [FX_BASE]: 1 };
  const nextChanges: Record<string, { change: number; changePercent: number }> = {};
  let updated = false;

  await Promise.all(
    Object.entries(FX_TICKERS).map(async ([currency, ticker]) => {
      const data = await fetchYahooChart(ticker, `${currency}/${FX_BASE}`);
      if (data?.price) {
        nextRates[currency] = data.price;
        nextChanges[currency] = { change: round2(data.change), changePercent: round2(data.changePercent) };
        updated = true;
      }
    }),
  );

  if (updated) {
    const didUpdateFx = updateFxRates({
      base: FX_BASE,
      rates: nextRates,
      changes: { ...fxRates.changes, ...nextChanges },
    });
    if (!didUpdateFx) return;
    broadcast();
  }
}

async function fetchYahooChart(ticker: string, name: string): Promise<CommodityPrice | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1d`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) {
      console.warn(`[Prices] Yahoo ${ticker} REST HTTP ${res.status}`);
      return null;
    }

    const json: any = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta) return null;

    const price = meta.regularMarketPrice ?? 0;
    const previousClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
    const change = price - previousClose;
    const changePercent = previousClose !== 0 ? (change / previousClose) * 100 : 0;

    return {
      ticker,
      name,
      price: round2(price),
      change: round2(change),
      changePercent: round2(changePercent),
      currency: meta.currency ?? 'USD',
      updatedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    console.warn(`[Prices] Yahoo ${ticker} REST failed:`, err.message);
    return null;
  }
}

// ─── Broadcast ───────────────────────────────────────────────────────

function broadcast(): void {
  const snapshot = buildPriceSnapshotPayload();
  if (Object.keys(snapshot.pricesByTicker).length === 0 && !snapshot.fxRates) return;

  if (!lastBroadcastSnapshot) {
    lastBroadcastSnapshot = snapshot;
    broadcastToAll({ type: 'prices:snapshot', data: snapshot });
    return;
  }

  const patch = buildPricePatchPayload(lastBroadcastSnapshot, snapshot);
  if (!patch) return;

  lastBroadcastSnapshot = snapshot;
  broadcastToAll({ type: 'prices:patch', data: patch });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Start price feeds: Yahoo WS for Brent, polling for Gas Oil.
 * Called once on server startup.
 */
export async function startPricePolling(): Promise<void> {
  if (gasoilTimer) return;

  console.log('[Prices] Starting commodity price feeds');

  // Load currency config from tenant settings
  await loadCurrencyConfig();

  // Brent Oil: Yahoo Finance WebSocket + REST initial
  initYahooWs();

  // Gas Oil: Investing.com scrape on interval
  fetchGasOil();
  gasoilTimer = setInterval(fetchGasOil, GASOIL_POLL_INTERVAL_MS);

  // FX rates: Yahoo WebSocket streaming with REST fallback
  fetchFxRates();
  fxTimer = setInterval(fetchFxRates, FX_POLL_INTERVAL_MS);
}

/**
 * Get the latest cached prices.
 */
export function getLatestPrices(): CommodityPrice[] {
  const prices: CommodityPrice[] = [];
  if (brentPrice) prices.push(brentPrice);
  if (gasoilPrice) prices.push(gasoilPrice);
  return prices;
}

export function getLatestPricePayload(): PricesPayload {
  return {
    prices: getLatestPrices(),
    fxRates,
  };
}

export function getLatestPriceSnapshot(): PriceSnapshotPayload {
  return buildPriceSnapshotPayload();
}

export function getFxRate(currency: string): number {
  const code = currency.toUpperCase();
  if (code === FX_BASE) return 1;
  return fxRates.rates[code] ?? 1;
}

/**
 * Reload currency configuration from tenant settings, then
 * reconnect the Yahoo WS and re-fetch FX rates so new
 * currencies are picked up immediately.
 */
export async function reloadCurrencies(): Promise<void> {
  await loadCurrencyConfig();

  // Reconnect WS with new tickers
  if (yahooWs) {
    yahooWs.onclose = null; // prevent auto-reconnect loop
    yahooWs.close();
    yahooWs = null;
  }
  connectYahooWs();

  // Immediately fetch REST rates for new currencies
  await fetchFxRates();
}

export function __resetPriceStateForTests(): void {
  brentPrice = null;
  gasoilPrice = null;
  fxRates = {
    base: FX_BASE,
    rates: { [FX_BASE]: 1 },
    changes: {},
    updatedAt: null,
  };
  lastBroadcastSnapshot = null;
}

export function __applyBrentPriceForTests(next: Omit<CommodityPrice, 'updatedAt'>): void {
  const updatedPrice = updateCommodityPrice(brentPrice, next);
  if (updatedPrice === brentPrice) return;
  brentPrice = updatedPrice;
  broadcast();
}

export function __applyFxRatesForTests(next: Omit<FxRates, 'updatedAt'>): void {
  if (!updateFxRates(next)) return;
  broadcast();
}
