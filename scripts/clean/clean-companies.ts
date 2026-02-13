/**
 * Clean & enrich company credit list
 *
 * Phase 1: Parse messy CSV → clean company_name + credit (number)
 * Phase 2: Look up each company on Seasearcher → add country + seasearcher_id
 *
 * Usage:
 *   bun run scripts/clean/clean-companies.ts                  # full run
 *   bun run scripts/clean/clean-companies.ts --clean-only     # phase 1 only
 *
 * Credentials: reads LLI creds from DB (same as the app), or falls back
 * to LLI_USERNAME / LLI_PASSWORD env vars.
 */

import { file } from 'bun';
import * as path from 'path';
import { getLLICredentialsFromDB } from '../../apps/api/src/modules/admin/integrations.service';

// ── Config ────────────────────────────────────────────────────────────

const INPUT_FILE = path.join(import.meta.dir, 'Liste (1).csv');
const CLEAN_OUTPUT = path.join(import.meta.dir, 'companies_clean.csv');
const ENRICHED_OUTPUT = path.join(import.meta.dir, 'companies_enriched.csv');
const NOT_FOUND_OUTPUT = path.join(import.meta.dir, 'companies_not_found.csv');

const LLI_BASE = 'https://api.lloydslistintelligence.com/v1';
const SEASEARCHER_BASE = 'https://www.seasearcher.com/api';

// ── Types ─────────────────────────────────────────────────────────────

interface CleanRow {
  company_name: string;
  credit: number;
}

interface EnrichedRow extends CleanRow {
  seasearcher_id: string;
  country: string;
  country_code: string;
}

interface SeasearcherResult {
  id: string;
  companyName: string;
  companyImo: string;
  location: string;
  countryCode: string;
  yearFormed: number | null;
  boFleetSize: number;
  coFleetSize: number;
  tmFleetSize: number;
  tpFleetSize: number;
  isSanctioned: boolean;
  headOfficeAddress: {
    streetLine1: string;
    city: string;
    country: string;
  } | null;
}

// ── CSV Parsing ───────────────────────────────────────────────────────

/**
 * Minimal RFC 4180 CSV line parser that handles quoted fields with commas.
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Extract clean company name from the messy "Details" field.
 * The trailing number is a raw credit amount merged into the name column.
 * We cross-reference with the credit value to strip it reliably.
 */
function extractCompanyName(details: string, creditStr: string): string {
  let cleaned = details.trim();

  // Try to strip trailing number that matches the credit value
  const creditNum = parseCredit(creditStr);
  if (creditNum > 0) {
    // Check if details ends with the raw credit number (preceded by any whitespace)
    const trailingMatch = cleaned.match(/\s+(\d+)\s*$/);
    if (trailingMatch) {
      const trailingNum = parseInt(trailingMatch[1], 10);
      if (trailingNum === creditNum) {
        cleaned = cleaned.slice(0, trailingMatch.index).trim();
      }
    }
  }

  // Fix commas that should be periods in legal suffixes
  // e.g. "S,A," → "S.A.", "C,V," → "C.V.", "Inc," → "Inc."
  cleaned = fixLegalSuffixCommas(cleaned);

  return cleaned || details.trim();
}

/**
 * Fix commas used in place of periods in legal suffixes.
 * Patterns: single-letter abbreviations like S,A, → S.A.  B,V, → B.V.
 * Also trailing Inc, → Inc.  Ltd, → Ltd.  Co, → Co.
 */
function fixLegalSuffixCommas(name: string): string {
  // Fix patterns like "S,A," "B,V," "S,P,A," "C,V," "L,T,D," etc
  // where single capital letters are separated by commas
  let fixed = name.replace(/\b([A-Z]),([A-Z]),([A-Z]),/g, '$1.$2.$3.');
  fixed = fixed.replace(/\b([A-Z]),([A-Z]),/g, '$1.$2.');
  // Fix trailing comma on common suffixes: Inc, → Inc.  Ltd, → Ltd.  Co, → Co.  Pte, → Pte.
  fixed = fixed.replace(/\b(Inc|Ltd|Co|Corp|Pte|SA|AS),(\s|$)/g, '$1.$2');
  // Fix standalone trailing comma on single letter: "COMPANY S," → "COMPANY S."
  fixed = fixed.replace(/\b([A-Z]),\s*$/g, '$1.');
  return fixed;
}

/**
 * Simplify a company name for retry search by removing legal suffixes.
 */
function simplifyForSearch(name: string): string {
  return name
    .replace(/\b(Ltd\.?|Limited|Inc\.?|Corp\.?|Corporation|S\.?A\.?|B\.?V\.?|C\.?V\.?|N\.?V\.?|GmbH|AG|AS|A\/S|Aps|ApS|OOO|Pty|Pte\.?|SASU|Sàrl|Sarl|S\.?P\.?A\.?|L\.?T\.?D\.?|Wll|KG|mbH|Co\.?|LLC|Llc)\b/gi, '')
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse credit string to number.
 * Handles: "$5,000,000.00", "5000000", empty string
 */
function parseCredit(credit: string): number {
  if (!credit || !credit.trim()) return 0;
  const cleaned = credit.replace(/[$,]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

// ── Phase 1: Clean CSV ────────────────────────────────────────────────

async function cleanCSV(): Promise<CleanRow[]> {
  console.log('═══ Phase 1: Cleaning CSV ═══');
  const raw = await file(INPUT_FILE).text();
  const lines = raw.split('\n');

  // Skip header
  const rows: CleanRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseCSVLine(line);
    if (fields.length < 2) continue;

    const company_name = extractCompanyName(fields[0], fields[1]);
    const credit = parseCredit(fields[1]);

    // Skip rows with empty company name
    if (!company_name) continue;

    rows.push({ company_name, credit });
  }

  // Write clean CSV
  const header = 'company_name,credit';
  const csvLines = rows.map(
    (r) => `"${r.company_name.replace(/"/g, '""')}",${r.credit}`,
  );
  await Bun.write(CLEAN_OUTPUT, [header, ...csvLines].join('\n'));

  console.log(`  ✓ ${rows.length} companies parsed`);
  console.log(`  ✓ Saved to ${path.basename(CLEAN_OUTPUT)}`);
  return rows;
}

// ── Phase 2: Seasearcher Lookup ───────────────────────────────────────

let tokenCache: { token: string; fetchedAt: number } | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && Date.now() - tokenCache.fetchedAt < 23 * 60 * 60 * 1000) {
    return tokenCache.token;
  }

  // Try DB credentials first, then env vars
  let username: string | undefined;
  let password: string | undefined;

  try {
    const dbCreds = await getLLICredentialsFromDB();
    if (dbCreds) {
      username = dbCreds.username;
      password = dbCreds.password;
      console.log('  Using LLI credentials from database');
    }
  } catch {
    // DB not available, fall through to env vars
  }

  if (!username || !password) {
    username = process.env['LLI_USERNAME'];
    password = process.env['LLI_PASSWORD'];
  }

  if (!username || !password) {
    throw new Error('LLI credentials not found. Set LLI_USERNAME/LLI_PASSWORD env vars or configure in Admin → Integrations.');
  }

  const res = await fetch(`${LLI_BASE}/tokenprovider`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status} ${res.statusText}`);
  }

  const body = (await res.json()) as { Message: string; Payload: string };
  if (body.Message !== 'Success' || !body.Payload) {
    throw new Error(`Token response invalid: ${JSON.stringify(body)}`);
  }

  tokenCache = { token: body.Payload, fetchedAt: Date.now() };
  return body.Payload;
}

async function searchCompany(name: string): Promise<SeasearcherResult | null> {
  const token = await getToken();

  const queryObj = {
    SearchPhrase: name,
    SearchFields: { companyName: 1, companyImo: 1 },
    PageSize: 5,
  };

  const url = `${SEASEARCHER_BASE}/company/query?query=${encodeURIComponent(JSON.stringify(queryObj))}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    // Force token refresh
    tokenCache = null;
    const freshToken = await getToken();
    const retry = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${freshToken}` },
    });
    if (!retry.ok) return null;
    const data = (await retry.json()) as { results: SeasearcherResult[] };
    return findBestMatch(name, data.results);
  }

  if (!res.ok) return null;

  const data = (await res.json()) as { results: SeasearcherResult[] };
  return findBestMatch(name, data.results);
}

/**
 * Find the best matching company from search results.
 * Uses normalized string comparison — exact match first, then closest.
 */
function findBestMatch(query: string, results: SeasearcherResult[]): SeasearcherResult | null {
  if (!results?.length) return null;

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const nQuery = normalize(query);

  // 1. Exact normalized match
  for (const r of results) {
    if (normalize(r.companyName) === nQuery) return r;
  }

  // 2. One contains the other (for abbreviated names)
  for (const r of results) {
    const nName = normalize(r.companyName);
    if (nName.includes(nQuery) || nQuery.includes(nName)) return r;
  }

  // 3. Check word overlap — require at least 70% of query words to appear
  const queryWords = nQuery.split(' ').filter((w) => w.length > 1);
  let bestScore = 0;
  let bestResult: SeasearcherResult | null = null;

  for (const r of results) {
    const nName = normalize(r.companyName);
    const nameWords = new Set(nName.split(' '));
    const matchCount = queryWords.filter((w) => nameWords.has(w)).length;
    const score = matchCount / queryWords.length;
    if (score > bestScore && score >= 0.7) {
      bestScore = score;
      bestResult = r;
    }
  }

  return bestResult;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function enrichWithSeasearcher(rows: CleanRow[]): Promise<void> {
  console.log('\n═══ Phase 2: Seasearcher Lookup ═══');

  // Test auth first
  try {
    await getToken();
    console.log('  ✓ Authenticated with Seasearcher');
  } catch (err: any) {
    console.error(`  ✗ Auth failed: ${err.message}`);
    console.log('  Set LLI_USERNAME and LLI_PASSWORD env vars.');
    return;
  }

  const found: EnrichedRow[] = [];
  const stillSearching: CleanRow[] = [];
  let progress = 0;

  // ── Pass 1: exact name search ──
  console.log('  Pass 1: searching exact names…');
  for (const row of rows) {
    progress++;
    if (progress % 50 === 0 || progress === rows.length) {
      process.stdout.write(
        `\r  Pass 1: ${progress}/${rows.length} (${found.length} found, ${stillSearching.length} not found)`,
      );
    }

    try {
      const match = await searchCompany(row.company_name);
      if (match) {
        found.push({
          ...row,
          seasearcher_id: match.id,
          country: match.location || match.headOfficeAddress?.country || '',
          country_code: match.countryCode || '',
        });
      } else {
        stillSearching.push(row);
      }
    } catch (err) {
      stillSearching.push(row);
    }

    await sleep(100);
  }
  console.log('');

  // ── Pass 2: retry with simplified names (strip legal suffixes) ──
  if (stillSearching.length > 0) {
    console.log(`  Pass 2: retrying ${stillSearching.length} companies with simplified names…`);
    const notFound: CleanRow[] = [];
    let retryProgress = 0;

    for (const row of stillSearching) {
      retryProgress++;
      if (retryProgress % 50 === 0 || retryProgress === stillSearching.length) {
        process.stdout.write(
          `\r  Pass 2: ${retryProgress}/${stillSearching.length} (${found.length} total found)`,
        );
      }

      const simplified = simplifyForSearch(row.company_name);
      // Only retry if the simplified name is meaningfully different
      if (simplified !== row.company_name && simplified.length >= 3) {
        try {
          const match = await searchCompany(simplified);
          if (match) {
            found.push({
              ...row,
              seasearcher_id: match.id,
              country: match.location || match.headOfficeAddress?.country || '',
              country_code: match.countryCode || '',
            });
            continue;
          }
        } catch {}
        await sleep(100);
      }

      notFound.push(row);
    }
    console.log('');

    // Write not-found CSV
    const notFoundHeader = 'company_name,credit';
    const notFoundLines = notFound.map(
      (r) => `"${r.company_name.replace(/"/g, '""')}",${r.credit}`,
    );
    await Bun.write(NOT_FOUND_OUTPUT, [notFoundHeader, ...notFoundLines].join('\n'));
    console.log(`  ✗ ${notFound.length} companies not found → ${path.basename(NOT_FOUND_OUTPUT)}`);
  }

  // Write enriched CSV
  const enrichedHeader = 'company_name,credit,seasearcher_id,country,country_code';
  const enrichedLines = found.map(
    (r) =>
      `"${r.company_name.replace(/"/g, '""')}",${r.credit},"${r.seasearcher_id}","${r.country.replace(/"/g, '""')}","${r.country_code}"`,
  );
  await Bun.write(ENRICHED_OUTPUT, [enrichedHeader, ...enrichedLines].join('\n'));
  console.log(`  ✓ ${found.length} companies found on Seasearcher → ${path.basename(ENRICHED_OUTPUT)}`);
}

// ── Main ──────────────────────────────────────────────────────────────

const cleanOnly = process.argv.includes('--clean-only');

const rows = await cleanCSV();

if (!cleanOnly) {
  await enrichWithSeasearcher(rows);
}

console.log('\nDone!');
