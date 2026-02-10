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
}

// ─── Config ──────────────────────────────────────────────────────────

const GASOIL_POLL_INTERVAL_MS = 60_000; // 60 seconds

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ─── State ───────────────────────────────────────────────────────────

let brentPrice: CommodityPrice | null = null;
let gasoilPrice: CommodityPrice | null = null;
let gasoilTimer: ReturnType<typeof setInterval> | null = null;

// Yahoo WS state
let yahooWs: WebSocket | null = null;
let PricingData: protobuf.Type | null = null;
let yahooReconnectTimer: ReturnType<typeof setTimeout> | null = null;

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
    yahooWs!.send(JSON.stringify({ subscribe: ['BZ=F'] }));
    console.log('[Prices] Subscribed to BZ=F');
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

        brentPrice = {
          ticker: 'BZ=F',
          name: 'Brent Oil',
          price: round2(price),
          change: round2(change),
          changePercent: round2(changePercent),
          currency: obj.currency || 'USD',
          updatedAt: new Date().toISOString(),
        };

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
      brentPrice = price;
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

    gasoilPrice = {
      ticker: 'LGO',
      name: 'Gasoil',
      price: round2(price),
      change: round2(change),
      changePercent: round2(changePercent),
      currency: 'USD',
      updatedAt: new Date().toISOString(),
    };

    broadcast();
  } catch (err: any) {
    console.warn('[Prices] Failed to fetch Gas Oil:', err.message);
    await fetchGasOilYahoo();
  }
}

async function fetchGasOilYahoo(): Promise<void> {
  const price = await fetchYahooChart('LGOc1', 'Gasoil');
  if (price) {
    price.ticker = 'LGO';
    gasoilPrice = price;
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
  const prices = getLatestPrices();
  if (prices.length > 0) {
    broadcastToAll({ type: 'prices', data: { prices } });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Start price feeds: Yahoo WS for Brent, polling for Gas Oil.
 * Called once on server startup.
 */
export function startPricePolling(): void {
  if (gasoilTimer) return;

  console.log('[Prices] Starting commodity price feeds');

  // Brent Oil: Yahoo Finance WebSocket + REST initial
  initYahooWs();

  // Gas Oil: Investing.com scrape on interval
  fetchGasOil();
  gasoilTimer = setInterval(fetchGasOil, GASOIL_POLL_INTERVAL_MS);
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
