// ═══════════════════════════════════════════════════════════════════════
//  TankerTrackers Sanctioned Vessel List Client
//
//  Fetches and parses the sanctioned vessels report from TankerTrackers.
//  Returns a normalised list of { imo, name } records.
// ═══════════════════════════════════════════════════════════════════════

const SANCTIONED_URL = 'https://tankertrackers.com/report/sanctioned';

export interface SanctionedVessel {
  imo: string | null;
  name: string;
  rawRow: Record<string, unknown>;
}

/**
 * Fetch the TankerTrackers sanctioned vessels page and extract the vessel list.
 *
 * The page typically contains a table or JSON payload with vessel data.
 * We attempt multiple parsing strategies:
 *   1. Look for embedded JSON data (e.g. __NEXT_DATA__ or similar payloads)
 *   2. Parse an HTML table as fallback
 */
export async function fetchSanctionedVessels(): Promise<SanctionedVessel[]> {
  const res = await fetch(SANCTIONED_URL, {
    headers: {
      'User-Agent': 'Fueld-SanctionCheck/1.0',
      Accept: 'text/html,application/xhtml+xml,application/json',
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    throw new Error(`TankerTrackers responded with HTTP ${res.status}`);
  }

  const html = await res.text();
  return parseVesselsFromHtml(html);
}

// ── Parsing helpers ────────────────────────────────────────────────

function parseVesselsFromHtml(html: string): SanctionedVessel[] {
  // Strategy 1: look for JSON embedded in a <script> tag (common with Next.js / SPA pages)
  const jsonMatch = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (jsonMatch?.[1]) {
    try {
      const nextData = JSON.parse(jsonMatch[1]);
      const vessels = extractVesselsFromJson(nextData);
      if (vessels.length) return vessels;
    } catch { /* fall through */ }
  }

  // Strategy 2: look for any large JSON array embedded in <script> tags
  const scriptBlocks = html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) ?? [];
  for (const block of scriptBlocks) {
    const content = block.replace(/<\/?script[^>]*>/g, '').trim();
    // Look for array patterns that might contain vessel data
    const arrayMatch = content.match(/\[[\s\S]*?"imo"[\s\S]*?\]/);
    if (arrayMatch) {
      try {
        const arr = JSON.parse(arrayMatch[0]);
        if (Array.isArray(arr) && arr.length) {
          return arr.map(normaliseVessel).filter((v): v is SanctionedVessel => v !== null);
        }
      } catch { /* continue */ }
    }
  }

  // Strategy 3: parse HTML table rows
  return parseHtmlTable(html);
}

function extractVesselsFromJson(data: unknown): SanctionedVessel[] {
  if (!data || typeof data !== 'object') return [];

  // Recursively search for arrays that look like vessel lists
  const results: SanctionedVessel[] = [];

  function walk(obj: unknown): void {
    if (Array.isArray(obj)) {
      // Check if this array contains vessel-like objects
      const sample = obj[0];
      if (sample && typeof sample === 'object' && ('imo' in sample || 'IMO' in sample || 'vessel' in sample || 'name' in sample)) {
        for (const item of obj) {
          const v = normaliseVessel(item);
          if (v) results.push(v);
        }
        return;
      }
      for (const item of obj) walk(item);
    } else if (obj && typeof obj === 'object') {
      for (const val of Object.values(obj)) walk(val);
    }
  }

  walk(data);
  return results;
}

function normaliseVessel(raw: unknown): SanctionedVessel | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const name = String(r['name'] ?? r['Name'] ?? r['vessel'] ?? r['Vessel'] ?? r['vessel_name'] ?? r['vesselName'] ?? '').trim();
  if (!name) return null;

  const imoRaw = r['imo'] ?? r['IMO'] ?? r['imoNumber'] ?? r['imo_number'] ?? null;
  const imo = imoRaw ? String(imoRaw).replace(/\D/g, '').trim() || null : null;

  return { imo, name, rawRow: r };
}

function parseHtmlTable(html: string): SanctionedVessel[] {
  const results: SanctionedVessel[] = [];

  // Find table headers to determine column indices
  const theadMatch = html.match(/<thead[\s\S]*?<\/thead>/i);
  if (!theadMatch) return results;

  const headers: string[] = [];
  const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/gi;
  let thMatch: RegExpExecArray | null;
  while ((thMatch = thRegex.exec(theadMatch[0])) !== null) {
    headers.push(stripHtml(thMatch[1]).toLowerCase().trim());
  }

  const nameIdx = headers.findIndex((h) => h.includes('name') || h.includes('vessel'));
  const imoIdx = headers.findIndex((h) => h.includes('imo'));

  if (nameIdx === -1) return results;

  // Extract table body rows
  const tbodyMatch = html.match(/<tbody[\s\S]*?<\/tbody>/i);
  if (!tbodyMatch) return results;

  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRegex.exec(tbodyMatch[0])) !== null) {
    const cells: string[] = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch: RegExpExecArray | null;
    while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
      cells.push(stripHtml(tdMatch[1]).trim());
    }

    const name = cells[nameIdx]?.trim();
    if (!name) continue;

    const imoRaw = imoIdx >= 0 ? cells[imoIdx]?.replace(/\D/g, '').trim() || null : null;
    const rawRow: Record<string, unknown> = {};
    headers.forEach((h, i) => { rawRow[h] = cells[i] ?? null; });

    results.push({ imo: imoRaw, name, rawRow });
  }

  return results;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
}
