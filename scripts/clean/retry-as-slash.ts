/**
 * Re-search companies ending with "AS" using "A/S" on Seasearcher.
 * If we get a match, update the enriched CSV.
 */

import { file } from 'bun';
import * as path from 'path';

const ENRICHED_FILE = path.join(import.meta.dir, 'companies_enriched.csv');
const LLI_BASE = 'https://api.lloydslistintelligence.com/v1';
const SEASEARCHER_BASE = 'https://www.seasearcher.com/api';

interface SeasearcherResult {
  id: string;
  companyName: string;
  companyImo: string;
  location: string;
  countryCode: string;
}

let tokenCache: { token: string; fetchedAt: number } | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && Date.now() - tokenCache.fetchedAt < 23 * 60 * 60 * 1000) {
    return tokenCache.token;
  }

  const username = process.env['LLI_USERNAME'];
  const password = process.env['LLI_PASSWORD'];
  if (!username || !password) throw new Error('Set LLI_USERNAME/LLI_PASSWORD');

  const res = await fetch(`${LLI_BASE}/tokenprovider`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`Token failed: ${res.status}`);

  const body = (await res.json()) as { Message: string; Payload: string };
  if (body.Message !== 'Success') throw new Error('Token invalid');

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
    tokenCache = null;
    const freshToken = await getToken();
    const retry = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${freshToken}` } });
    if (!retry.ok) return null;
    const data = (await retry.json()) as { results: SeasearcherResult[] };
    return findBestMatch(name, data.results);
  }

  if (!res.ok) return null;
  const data = (await res.json()) as { results: SeasearcherResult[] };
  return findBestMatch(name, data.results);
}

function findBestMatch(query: string, results: SeasearcherResult[]): SeasearcherResult | null {
  if (!results?.length) return null;

  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();

  const nQuery = normalize(query);

  // 1. Exact normalized match
  for (const r of results) {
    if (normalize(r.companyName) === nQuery) return r;
  }

  // 2. One contains the other
  for (const r of results) {
    const nName = normalize(r.companyName);
    if (nName.includes(nQuery) || nQuery.includes(nName)) return r;
  }

  // 3. Word overlap >= 70%
  const queryWords = nQuery.split(' ').filter(w => w.length > 1);
  let bestScore = 0;
  let bestResult: SeasearcherResult | null = null;
  for (const r of results) {
    const nName = normalize(r.companyName);
    const nameWords = new Set(nName.split(' '));
    const matchCount = queryWords.filter(w => nameWords.has(w)).length;
    const score = matchCount / queryWords.length;
    if (score > bestScore && score >= 0.7) {
      bestScore = score;
      bestResult = r;
    }
  }
  return bestResult;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── CSV helpers ──

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

function quoteField(f: string | null | undefined): string {
  return `"${(f ?? '').replace(/"/g, '""')}"`;
}

// Country code → country name mapping (from Seasearcher results)
const CODE_TO_COUNTRY: Record<string, string> = {
  DNK: 'Denmark',
  NOR: 'Norway',
  SWE: 'Sweden',
  FIN: 'Finland',
  DEU: 'Germany',
  GBR: 'United Kingdom',
  NLD: 'Netherlands',
  GRC: 'Greece',
  ITA: 'Italy',
  ESP: 'Spain',
  FRA: 'France',
  TUR: 'Turkiye',
  SGP: 'Republic of Singapore',
  HKG: 'Hong Kong, S.A.R., China',
  CHN: "People's Republic of China",
  USA: 'United States of America',
  JPN: 'Japan',
  KOR: 'Republic of Korea',
  ARE: 'United Arab Emirates',
  CHE: 'Switzerland',
  BEL: 'Belgium',
  CYP: 'Cyprus',
  PAN: 'Panama',
  LBR: 'Liberia',
  MHL: 'Marshall Islands',
  BMU: 'Bermuda',
  BHS: 'Bahamas',
  RUS: 'Russian Federation',
  IND: 'India',
  BRA: 'Brazil',
  MYS: 'Malaysia',
  IDN: 'Indonesia',
  AUS: 'Australia',
  CAN: 'Canada',
  OMN: 'Oman',
  ISR: 'Israel',
  BLZ: 'Belize',
  BGR: 'Bulgaria',
  HRV: 'Croatia',
  POL: 'Poland',
  DZA: 'Algeria',
};

async function main() {
  // Load env
  const envFile = await file(path.join(import.meta.dir, '../../apps/api/.env')).text();
  for (const line of envFile.split('\n')) {
    const m = line.match(/^(\w+)=(.*)$/);
    if (m) process.env[m[1]] = m[2];
  }

  // Load enriched CSV
  const content = await file(ENRICHED_FILE).text();
  const lines = content.trim().split('\n');
  const header = lines[0];
  const rows = lines.slice(1).map(l => parseCSVLine(l));

  // Find companies ending with " AS"
  const asCompanies: { index: number; row: string[]; altName: string }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const name = rows[i][0].trim();
    if (/\bAS$/.test(name)) {
      // Create A/S variant
      const altName = name.replace(/\bAS$/, 'A/S');
      asCompanies.push({ index: i, row: rows[i], altName });
    }
  }

  console.log(`Found ${asCompanies.length} companies ending with "AS"`);
  console.log('Searching Seasearcher with "A/S" ending...\n');

  let updated = 0;
  let improved = 0;
  let notFound = 0;

  for (let j = 0; j < asCompanies.length; j++) {
    const { index, row, altName } = asCompanies[j];
    const originalName = row[0];
    const existingSS = row[2];
    const existingCountry = row[3];

    process.stdout.write(`  [${j + 1}/${asCompanies.length}] "${altName}" ... `);

    const result = await searchCompany(altName);

    if (result) {
      const countryName = CODE_TO_COUNTRY[result.countryCode] || result.location || result.countryCode || '';

      // Check if this is a better result
      const isBetter = !existingSS || // had no SS match before
        (result.id !== existingSS); // different match (potentially better)

      if (isBetter) {
        // Update the row: change name to A/S version, update SS data
        rows[index][0] = altName; // Use A/S in name
        rows[index][2] = result.id;
        rows[index][3] = countryName;
        rows[index][4] = result.countryCode;

        if (!existingSS) {
          console.log(`NEW MATCH → ${result.companyName} (${result.id}) [${result.countryCode}]`);
          updated++;
        } else {
          console.log(`IMPROVED → ${result.companyName} (${result.id}) [${result.countryCode}] (was: ss=${existingSS}, ${existingCountry})`);
          improved++;
        }
      } else {
        console.log(`same match (${result.id}), renaming to A/S`);
        rows[index][0] = altName; // Still rename to A/S
      }
    } else {
      console.log('not found');
      notFound++;
    }

    // Rate limit
    if (j % 10 === 9) await sleep(500);
  }

  // Write back
  const output = [header, ...rows.map(r => r.map(quoteField).join(','))].join('\n') + '\n';
  await Bun.write(ENRICHED_FILE, output);

  console.log(`\n═══ Summary ═══`);
  console.log(`  New matches: ${updated}`);
  console.log(`  Improved matches: ${improved}`);
  console.log(`  Not found with A/S: ${notFound}`);
  console.log(`  Total rows: ${rows.length}`);
}

main().catch(console.error);
