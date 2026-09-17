/**
 * Leaflet tile-layer theming helpers.
 *
 * Preferred: CARTO Voyager (light) / Dark Matter (dark). Since mid-2026 CARTO
 * requires a free API key for raster basemaps (https://carto.com/basemaps/apikey)
 * — requests without a key get an "API KEY REQUIRED" watermark. The key is
 * passed as ?key=… on the tile URL.
 *
 * Key resolution order:
 *   1. localStorage["cartoApiKey"] (handy for local dev overrides)
 *   2. window.__FUELD_CARTO_KEY (injectable at runtime if ever needed)
 *   3. DEFAULT_CARTO_API_KEY constant below
 * If no key is configured, falls back to keyless OpenStreetMap tiles; the dark
 * theme then uses an inverted-tile CSS filter (see styles.css .map-osm-dark).
 */

const CARTO_LIGHT_URL =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const CARTO_DARK_URL =
  'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png';
const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

// Free key from https://carto.com/basemaps/apikey — fair-use limits apply.
const DEFAULT_CARTO_API_KEY = 'cb1_3obk_1_ccb4db208610b2ae07dd4504';

export function getCartoApiKey(): string {
  try {
    const fromStorage =
      typeof localStorage !== 'undefined' ? localStorage.getItem('cartoApiKey') : null;
    if (fromStorage) return fromStorage;
  } catch {
    // localStorage unavailable (SSR/privacy mode) — fall through
  }
  const injected = (globalThis as Record<string, unknown>)['__FUELD_CARTO_KEY'];
  if (typeof injected === 'string' && injected) return injected;
  return DEFAULT_CARTO_API_KEY;
}

export function leafletTileUrl(theme: 'light' | 'dark'): string {
  const key = getCartoApiKey();
  if (key) {
    const base = theme === 'dark' ? CARTO_DARK_URL : CARTO_LIGHT_URL;
    return `${base}?key=${encodeURIComponent(key)}`;
  }
  return OSM_TILE_URL;
}

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/**
 * Replace the base tile layer on a Leaflet map with the theme-appropriate one.
 * Returns the new tile layer (or the existing one if the URL already matches).
 *
 * @param L        Leaflet namespace (window.L or the imported module)
 * @param map      Leaflet map instance
 * @param current  Current base tile layer (may be null/undefined)
 * @param dark     Whether the dark theme is active
 * @param options  Tile-layer options (subdomains, maxZoom, attribution, …)
 */
export function swapLeafletTileLayer(
  L: any,
  map: any,
  current: any,
  theme: 'light' | 'dark',
  options: Record<string, unknown> = { maxZoom: 18, subdomains: 'abcd' },
): any {
  if (!L || !map) return current;
  const url = leafletTileUrl(theme);
  // Avoid a needless swap if the current layer already uses the target URL.
  if (current?._url === url) return current;
  if (current) {
    try {
      map.removeLayer(current);
    } catch {
      // ignore — stale layer ref
    }
  }
  // When falling back to OSM tiles (no CARTO key), fix up the attribution and
  // flag the container so styles.css can invert tiles for the dark theme.
  const opts =
    url === OSM_TILE_URL
      ? { ...options, attribution: OSM_ATTRIBUTION }
      : options;
  const layer = L.tileLayer(url, opts);
  layer.addTo(map);
  try {
    const container: HTMLElement = map.getContainer();
    container.classList.toggle('map-osm-dark', url === OSM_TILE_URL && theme === 'dark');
  } catch {
    // ignore — container classing is cosmetic
  }
  // Keep the tile layer beneath markers/overlays (Leaflet panes: tilePane = 200).
  layer.bringToBack?.();
  return layer;
}