/**
 * Retry Seasearcher lookup for all not-found companies using simplified names.
 * - Fixes commas → periods in legal suffixes
 * - Strips legal suffixes to broaden search (e.g. "AET Tankers Pte Ltd" → "AET Tankers")
 * - Merges new finds into companies_enriched.csv
 * - Writes updated companies_not_found.csv
 *
 * Usage: bun run scripts/clean/retry-comma-companies.ts
 * Requires: LLI_USERNAME + LLI_PASSWORD env vars
 */

import { file } from 'bun';
import * as path from 'path';

const DIR = import.meta.dir;
const ENRICHED_FILE = path.join(DIR, 'companies_enriched.csv');
const NOT_FOUND_FILE = path.join(DIR, 'companies_not_found.csv');

const LLI_BASE = 'https://api.lloydslistintelligence.com/v1';
const SEASEARCHER_BASE = 'https://www.seasearcher.com/api';

// ── CSV helpers ───────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { fields.push(current); current = ''; }
      else current += ch;
    }
  }
  fields.push(current);
  return fields;
}

// ── Fix commas → periods ─────────────────────────────────────────────

function fixLegalSuffixCommas(name: string): string {
  let fixed = name.replace(/\b([A-Z]),([A-Z]),([A-Z]),/g, '$1.$2.$3.');
  fixed = fixed.replace(/\b([A-Z]),([A-Z]),/g, '$1.$2.');
  fixed = fixed.replace(/\bCo,,/g, 'Co.,');
  fixed = fixed.replace(/\b(Inc|Ltd|Co|Corp|Pte|SA|AS),(\s|$)/g, '$1.$2');
  fixed = fixed.replace(/\b(Inc|Ltd|Co|Corp|Pte|SA|AS),(?=\))/g, '$1.');
  fixed = fixed.replace(/\b([A-Z]),\s*$/g, '$1.');
  fixed = fixed.replace(/\bPTE,\s+LTD,/gi, 'PTE. LTD.');
  fixed = fixed.replace(/\bPTE,\s+LTD\b/gi, 'PTE. LTD');
  return fixed;
}

/**
 * Strip legal suffixes to create a simpler search term.
 */
function simplifyName(name: string): string {
  // First fix commas
  let s = fixLegalSuffixCommas(name);
  // Strip legal suffixes
  s = s.replace(/\b(Ltd\.?|Limited|Inc\.?|Corp\.?|Corporation|S\.?A\.?|B\.?V\.?|C\.?V\.?|N\.?V\.?|GmbH|AG|AS|A\/S|Aps|ApS|OOO|OÜ|Pty\.?|Pte\.?|SASU|Sàrl|Sarl|S\.?P\.?A\.?|S\.?r\.?l\.?|L\.?T\.?D\.?|Wll|KG|mbH|Co\.?|LLC|Llc|AB|d\.?o\.?o\.?|JSC|PJSC|bv|nv|sa|plc|PLC)\b/gi, '');
  // Strip country names at the end
  s = s.replace(/\b(Bahamas|Panama|Singapore|Hong Kong|Bermuda|Liberia|Marshall Islands|Cyprus|Malta|Greece)\s*$/i, '');
  // Clean up parenthetical content at the end
  s = s.replace(/\s*\([^)]*\)\s*$/, '');
  // Clean up punctuation & extra spaces
  s = s.replace(/[(),.&]/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

// ── Seasearcher API ──────────────────────────────────────────────────

interface SeasearcherResult {
  id: string;
  companyName: string;
  location: string;
  countryCode: string;
  headOfficeAddress: { country: string } | null;
}

let tokenCache: { token: string; fetchedAt: number } | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && Date.now() - tokenCache.fetchedAt < 23 * 60 * 60 * 1000) {
    return tokenCache.token;
  }
  const username = process.env['LLI_USERNAME'];
  const password = process.env['LLI_PASSWORD'];
  if (!username || !password) throw new Error('Set LLI_USERNAME and LLI_PASSWORD env vars');

  const res = await fetch(`${LLI_BASE}/tokenprovider`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`Token request failed: ${res.status}`);
  const body = (await res.json()) as { Message: string; Payload: string };
  if (body.Message !== 'Success') throw new Error(`Token invalid: ${body.Message}`);
  tokenCache = { token: body.Payload, fetchedAt: Date.now() };
  return body.Payload;
}

async function searchCompany(name: string): Promise<SeasearcherResult | null> {
  const token = await getToken();
  const queryObj = { SearchPhrase: name, SearchFields: { companyName: 1, companyImo: 1 }, PageSize: 5 };
  const url = `${SEASEARCHER_BASE}/company/query?query=${encodeURIComponent(JSON.stringify(queryObj))}`;

  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    tokenCache = null;
    const freshToken = await getToken();
    res = await fetch(url, { headers: { Authorization: `Bearer ${freshToken}` } });
  }
  if (!res.ok) return null;
  const data = (await res.json()) as { results: SeasearcherResult[] };
  return findBestMatch(name, data.results);
}

function findBestMatch(query: string, results: SeasearcherResult[]): SeasearcherResult | null {
  if (!results?.length) return null;
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  const nQuery = normalize(query);

  for (const r of results) { if (normalize(r.companyName) === nQuery) return r; }
  for (const r of results) {
    const n = normalize(r.companyName);
    if (n.includes(nQuery) || nQuery.includes(n)) return r;
  }
  const qWords = nQuery.split(' ').filter(w => w.length > 1);
  let best: SeasearcherResult | null = null, bestScore = 0;
  for (const r of results) {
    const nWords = new Set(normalize(r.companyName).split(' '));
    const score = qWords.filter(w => nWords.has(w)).length / qWords.length;
    if (score > bestScore && score >= 0.7) { bestScore = score; best = r; }
  }
  return best;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  // 1. Read existing enriched companies
  const enrichedRaw = await file(ENRICHED_FILE).text();
  const enrichedLines = enrichedRaw.split('\n');
  const enrichedHeader = enrichedLines[0];
  const existingEnriched = enrichedLines.slice(1).filter(l => l.trim());

  // 2. Read not-found companies
  const notFoundRaw = await file(NOT_FOUND_FILE).text();
  const notFoundLines = notFoundRaw.split('\n');
  const notFoundRows: { name: string; credit: number }[] = [];
  for (let i = 1; i < notFoundLines.length; i++) {
    const line = notFoundLines[i].trim();
    if (!line) continue;
    const fields = parseCSVLine(line);
    notFoundRows.push({ name: fields[0], credit: parseFloat(fields[1]) || 0 });
  }

  // 3. Try all not-found companies with simplified names
  console.log(`Total not-found: ${notFoundRows.length}`);
  console.log(`Retrying all with simplified search names…\n`);

  // Auth
  await getToken();
  console.log('✓ Authenticated\n');

  const newlyFound: string[] = [];
  const stillNotFound: typeof notFoundRows = [];

  for (let i = 0; i < notFoundRows.length; i++) {
    const row = notFoundRows[i];
    const simplified = simplifyName(row.name);

    if ((i + 1) % 20 === 0 || i === notFoundRows.length - 1) {
      process.stdout.write(`\r  Retrying… ${i + 1}/${notFoundRows.length} (${newlyFound.length} new finds)`);
    }

    // Only retry if simplified name is different and meaningful
    if (simplified.length >= 3 && simplified.toLowerCase() !== row.name.toLowerCase()) {
      try {
        const match = await searchCompany(simplified);
        if (match) {
          const country = match.location || match.headOfficeAddress?.country || '';
          const cc = match.countryCode || '';
          newlyFound.push(
            `"${row.name.replace(/"/g, '""')}",${row.credit},"${match.id}","${country.replace(/"/g, '""')}","${cc}"`
          );
          await sleep(100);
          continue;
        }
      } catch {}
      await sleep(100);
    }

    stillNotFound.push(row);
  }
  console.log('');

  // 4. Merge: append new finds to enriched
  const allEnriched = [...existingEnriched, ...newlyFound];
  await Bun.write(ENRICHED_FILE, [enrichedHeader, ...allEnriched].join('\n'));

  // 5. Write updated not-found
  const nfHeader = 'company_name,credit';
  const nfLines = stillNotFound.map(r => `"${r.name.replace(/"/g, '""')}",${r.credit}`);
  await Bun.write(NOT_FOUND_FILE, [nfHeader, ...nfLines].join('\n'));

  console.log(`\n✓ ${newlyFound.length} new companies found (total enriched: ${allEnriched.length})`);
  console.log(`✗ ${stillNotFound.length} still not found`);
}

main().then(() => process.exit(0));
