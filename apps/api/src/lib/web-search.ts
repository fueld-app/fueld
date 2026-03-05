// ═══════════════════════════════════════════════════════════════════════
//  Web Search — SearXNG client for search-augmented generation
//
//  Queries a self-hosted SearXNG instance and returns clean results
//  that can be injected into LLM prompt context.
//
//  Environment variables:
//    SEARXNG_URL  — default: http://127.0.0.1:8888
// ═══════════════════════════════════════════════════════════════════════

// ─── Types ───────────────────────────────────────────────────────────

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface SearxngResult {
  title?: string;
  url?: string;
  content?: string;
}

interface SearxngResponse {
  results?: SearxngResult[];
}

// ─── Client ──────────────────────────────────────────────────────────

function getBaseUrl(): string {
  return (process.env['SEARXNG_URL'] ?? 'http://127.0.0.1:8888').replace(/\/+$/, '');
}

/**
 * Check if SearXNG is reachable.
 */
export async function isSearchHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${getBaseUrl()}/healthz`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Run a web search query via SearXNG.
 * Returns up to `limit` results (default 5).
 */
export async function webSearch(
  query: string,
  options?: { limit?: number; categories?: string },
): Promise<SearchResult[]> {
  const limit = options?.limit ?? 5;
  const categories = options?.categories ?? 'general';

  const params = new URLSearchParams({
    q: query,
    format: 'json',
    categories,
    language: 'en',
    safesearch: '0',
  });

  const res = await fetch(`${getBaseUrl()}/search?${params}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`SearXNG search failed (${res.status})`);
  }

  const data = (await res.json()) as SearxngResponse;

  return (data.results ?? [])
    .filter((r): r is Required<Pick<SearxngResult, 'title' | 'url'>> & SearxngResult =>
      Boolean(r.title && r.url),
    )
    .slice(0, limit)
    .map((r) => ({
      title: r.title!,
      url: r.url!,
      snippet: (r.content ?? '').slice(0, 500),
    }));
}

/**
 * Format search results into a text block suitable for LLM context injection.
 */
export function formatSearchContext(results: SearchResult[]): string {
  if (!results.length) return '';

  const lines = results.map(
    (r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet}`,
  );

  return `## Web Search Results (retrieved ${new Date().toISOString().slice(0, 10)})\n\n${lines.join('\n\n')}`;
}
