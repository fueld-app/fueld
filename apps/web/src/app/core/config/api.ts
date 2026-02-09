// ═══════════════════════════════════════════════════════════════════════
//  Runtime API Configuration
//  Auto-detects environment: localhost → dev, anything else → production
// ═══════════════════════════════════════════════════════════════════════

function getApiUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  if (window.location.hostname !== 'localhost') {
    return '/api';
  }
  return 'http://localhost:3000';
}

function getWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:3000/ws';
  if (window.location.hostname !== 'localhost') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }
  return 'ws://localhost:3000/ws';
}

/** Base URL for all API calls. Dev: http://localhost:3000, Prod: /api */
export const API = getApiUrl();

/** Alias for components using API_URL */
export const API_URL = API;

/** WebSocket endpoint. Dev: ws://localhost:3000/ws, Prod: wss://<host>/ws */
export const WS_BASE = getWsUrl();
export const WS_URL = WS_BASE;
