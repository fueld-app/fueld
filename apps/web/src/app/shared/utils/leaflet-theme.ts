/**
 * Leaflet tile-layer theming helpers.
 *
 * Light theme uses CARTO Voyager; dark theme uses CARTO Dark Matter. Components
 * call {@link swapLeafletTileLayer} from a `ThemeService.resolved()` effect to
 * re-theme the base tiles when the app theme changes.
 */

export const LEAFLET_TILE_LIGHT =
  'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
export const LEAFLET_TILE_DARK =
  'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png';

export function leafletTileUrl(theme: 'light' | 'dark'): string {
  return theme === 'dark' ? LEAFLET_TILE_DARK : LEAFLET_TILE_LIGHT;
}

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
  const layer = L.tileLayer(url, options);
  layer.addTo(map);
  // Keep the tile layer beneath markers/overlays (Leaflet panes: tilePane = 200).
  layer.bringToBack?.();
  return layer;
}