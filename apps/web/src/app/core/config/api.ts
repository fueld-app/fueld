// ═══════════════════════════════════════════════════════════════════════
//  Runtime API Configuration
//  Auto-detects environment: localhost → dev, anything else → production
// ═══════════════════════════════════════════════════════════════════════

function getApiUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  // In both dev (via proxy) and prod (via nginx), use relative /api
  // The dev proxy (proxy.conf.json) forwards /api → http://localhost:3000
  if (window.location.hostname !== 'localhost') {
    return '/api';
  }
  return '/api'; // Dev: Angular proxy handles forwarding
}

function getWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:3000/ws';
  // Dev: Angular proxy handles /ws → ws://localhost:3000
  // Prod: nginx proxies /ws to backend
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

function getBrowserOrigin(): string {
  if (typeof window === 'undefined') return 'http://localhost:4200';
  return window.location.origin;
}

export function toAbsoluteUrl(url: string, origin = getBrowserOrigin()): string {
  const value = url.trim();
  if (!value) return value;
  return new URL(value, origin).toString();
}

/** Base URL for all API calls. Dev: http://localhost:3000, Prod: /api */
export const API = getApiUrl();

/** Alias for components using API_URL */
export const API_URL = API;

/** WebSocket endpoint. Dev: ws://localhost:3000/ws, Prod: wss://<host>/ws */
export const WS_BASE = getWsUrl();
export const WS_URL = WS_BASE;
