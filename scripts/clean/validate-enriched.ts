/**
 * Cross-check Seasearcher results against suffix-based country inference.
 * If the Seasearcher country doesn't match what the company name suffix
 * suggests, remove the Seasearcher data and use the inferred country instead.
 *
 * Usage: bun run scripts/clean/validate-enriched.ts
 */

import { file } from 'bun';
import * as path from 'path';

const DIR = import.meta.dir;
const ENRICHED_FILE = path.join(DIR, 'companies_enriched.csv');

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

// ── Country inference (same rules as infer-countries.ts) ─────────────

interface CountryRule {
  pattern: RegExp;
  country: string;
  code: string;
}

const SUFFIX_RULES: CountryRule[] = [
  // Nordic
  { pattern: /\bA\/S\b/i, country: 'Denmark', code: 'DNK' },
  { pattern: /\bApS\b/i, country: 'Denmark', code: 'DNK' },
  { pattern: /\bP\/F\b/i, country: 'Faroe Islands', code: 'FRO' },
  { pattern: /\bHF\b$/i, country: 'Iceland', code: 'ISL' },
  { pattern: /\bEhf\b/i, country: 'Iceland', code: 'ISL' },
  { pattern: /\bOyj\b/i, country: 'Finland', code: 'FIN' },
  { pattern: /\bAB\b/i, country: 'Sweden', code: 'SWE' },
  { pattern: /\bKS\b$/i, country: 'Norway', code: 'NOR' },
  { pattern: /\bANS\b$/i, country: 'Norway', code: 'NOR' },

  // Germanic
  { pattern: /\bGmbH\b/i, country: 'Germany', code: 'DEU' },
  { pattern: /\bSchifffahrt/i, country: 'Germany', code: 'DEU' },
  { pattern: /\bReederei\b/i, country: 'Germany', code: 'DEU' },

  // Benelux
  { pattern: /\bB\.V\.\b/i, country: 'Netherlands', code: 'NLD' },
  { pattern: /\bC\.V\.\b/i, country: 'Netherlands', code: 'NLD' },
  { pattern: /\bN\.V\.\b/i, country: 'Netherlands', code: 'NLD' },
  { pattern: /\bBVBA\b/i, country: 'Belgium', code: 'BEL' },

  // Southern Europe
  { pattern: /\bSLU\b/i, country: 'Spain', code: 'ESP' },
  { pattern: /\bS\.P\.A\.\b/i, country: 'Italy', code: 'ITA' },
  { pattern: /\bSpA\b/i, country: 'Italy', code: 'ITA' },
  { pattern: /\bS\.r\.l\.\b/i, country: 'Italy', code: 'ITA' },
  { pattern: /\bSASU\b/i, country: 'France', code: 'FRA' },
  { pattern: /\bSAM\b$/i, country: 'Monaco', code: 'MCO' },
  { pattern: /\bLda\b/i, country: 'Portugal', code: 'PRT' },

  // Turkish
  { pattern: /\bDenizcilik\b/i, country: 'Turkiye', code: 'TUR' },
  { pattern: /\bLtd\s+Sti\b/i, country: 'Turkiye', code: 'TUR' },

  // Eastern Europe / CIS
  { pattern: /\bOOO\b/i, country: 'Russia', code: 'RUS' },
  { pattern: /\bOAO\b/i, country: 'Russia', code: 'RUS' },
  { pattern: /\bPAO\b/i, country: 'Russia', code: 'RUS' },
  { pattern: /\bJSSC\b/i, country: 'Ukraine', code: 'UKR' },
  { pattern: /\bTOV\b/i, country: 'Ukraine', code: 'UKR' },
  { pattern: /\bOÜ\b/i, country: 'Estonia', code: 'EST' },

  // SE Asia
  { pattern: /\bSdn\s*Bhd\b/i, country: 'Malaysia', code: 'MYS' },

  // UAE / Middle East
  { pattern: /\bDMCC\b/i, country: 'United Arab Emirates', code: 'ARE' },
  { pattern: /\bFZE\b/i, country: 'United Arab Emirates', code: 'ARE' },
  { pattern: /\bFZC\b/i, country: 'United Arab Emirates', code: 'ARE' },
  { pattern: /\bFZ-LLC\b/i, country: 'United Arab Emirates', code: 'ARE' },
  { pattern: /\bS\.A\.O\.C\b/i, country: 'Oman', code: 'OMN' },

  // Other specific
  { pattern: /\bPvt\s+Ltd\b/i, country: 'India', code: 'IND' },
  { pattern: /\bLtda\b/i, country: 'Brazil', code: 'BRA' },
];

// Country mentions in name
const COUNTRY_MENTIONS: CountryRule[] = [
  { pattern: /\bSingapore\b/i, country: 'Republic of Singapore', code: 'SGP' },
  { pattern: /\(Singapore\)/i, country: 'Republic of Singapore', code: 'SGP' },
  { pattern: /\bPte\.?\s*Ltd\b/i, country: 'Republic of Singapore', code: 'SGP' },
  { pattern: /\bPTE\s/i, country: 'Republic of Singapore', code: 'SGP' },
  { pattern: /\bIndonesia\b/i, country: 'Indonesia', code: 'IDN' },
  { pattern: /\bNorwa?y?\b/i, country: 'Norway', code: 'NOR' },
  { pattern: /\bDenmark\b/i, country: 'Denmark', code: 'DNK' },
  { pattern: /\bSweden\b/i, country: 'Sweden', code: 'SWE' },
  { pattern: /\bFrance\b/i, country: 'France', code: 'FRA' },
  { pattern: /\bAustralia\b/i, country: 'Australia', code: 'AUS' },
  { pattern: /\(HK\)|Hong Kong/i, country: 'Hong Kong', code: 'HKG' },
  { pattern: /\bShanghai\b|Jiangsu|Nanjing|Zhejiang/i, country: 'China', code: 'CHN' },
  { pattern: /\bVietnam\b/i, country: 'Vietnam', code: 'VNM' },
  { pattern: /\bPanama\b/i, country: 'Panama', code: 'PAN' },
  { pattern: /\bBahamas\b/i, country: 'Bahamas', code: 'BHS' },
  { pattern: /\bMalaysia\b/i, country: 'Malaysia', code: 'MYS' },
  { pattern: /\bOman\b/i, country: 'Oman', code: 'OMN' },
  { pattern: /\bCanada\b|Ontario\b/i, country: 'Canada', code: 'CAN' },
];

// Country code equivalences (Seasearcher may use different names for same country)
const CODE_ALIASES: Record<string, string[]> = {
  'SGP': ['SGP'],
  'GRC': ['GRC'],
  'NOR': ['NOR'],
  'DNK': ['DNK'],
  'DEU': ['DEU'],
  'NLD': ['NLD'],
  'GBR': ['GBR'],
  'USA': ['USA'],
  'TUR': ['TUR'],
  'RUS': ['RUS'],
  'ITA': ['ITA'],
  'FRA': ['FRA'],
  'ESP': ['ESP'],
  'CHN': ['CHN'],
  'JPN': ['JPN'],
  'KOR': ['KOR'],
  'HKG': ['HKG'],
  'ARE': ['ARE'],
  'BEL': ['BEL'],
  'SWE': ['SWE'],
  'EST': ['EST'],
  'ISL': ['ISL'],
  'FIN': ['FIN'],
  'IND': ['IND'],
  'BRA': ['BRA'],
  'UKR': ['UKR'],
  'MYS': ['MYS'],
  'IDN': ['IDN'],
  'MCO': ['MCO'],
  'PRT': ['PRT'],
  'OMN': ['OMN'],
  'FRO': ['FRO'],
  'VNM': ['VNM'],
  'PAN': ['PAN'],
  'BHS': ['BHS'],
  'CAN': ['CAN'],
  'AUS': ['AUS'],
};

function inferCountryCode(name: string): string | null {
  // Check country mentions first (more specific)
  for (const rule of COUNTRY_MENTIONS) {
    if (rule.pattern.test(name)) return rule.code;
  }
  // Check suffix rules
  for (const rule of SUFFIX_RULES) {
    if (rule.pattern.test(name)) return rule.code;
  }
  return null;
}

function codesMatch(inferredCode: string, actualCode: string): boolean {
  return inferredCode === actualCode;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  const raw = await file(ENRICHED_FILE).text();
  const lines = raw.split('\n');
  const header = lines[0];

  interface Row { name: string; credit: string; ssId: string; country: string; code: string; }
  const rows: Row[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const f = parseCSVLine(line);
    rows.push({ name: f[0], credit: f[1], ssId: f[2], country: f[3], code: f[4] });
  }

  let mismatches = 0;
  let checked = 0;
  const changes: { name: string; ssCountry: string; ssCode: string; inferredCode: string }[] = [];

  for (const row of rows) {
    if (!row.ssId) continue; // skip inferred-only rows

    const inferred = inferCountryCode(row.name);
    if (!inferred) continue; // no suffix to check against
    checked++;

    if (!codesMatch(inferred, row.code)) {
      mismatches++;
      changes.push({
        name: row.name,
        ssCountry: row.country,
        ssCode: row.code,
        inferredCode: inferred,
      });
      // Clear the Seasearcher data — mark as needing review
      row.ssId = '';
      row.country = '';
      row.code = '';
    }
  }

  // Write updated CSV
  const outLines = [header];
  for (const row of rows) {
    outLines.push(`"${row.name.replace(/"/g, '""')}","${row.credit}","${row.ssId}","${row.country.replace(/"/g, '""')}","${row.code}"`);
  }
  await Bun.write(ENRICHED_FILE, outLines.join('\n'));

  console.log(`═══ Validation Results ═══`);
  console.log(`Rows with Seasearcher ID: ${rows.filter(r => r.ssId || changes.find(c => c.name === r.name)).length}`);
  console.log(`Checked against suffix rules: ${checked}`);
  console.log(`Mismatches found & cleared: ${mismatches}`);

  if (changes.length > 0) {
    console.log(`\n─── Mismatched entries (enriched data removed) ───`);
    for (const c of changes) {
      console.log(`  "${c.name}": Seasearcher=${c.ssCountry} (${c.ssCode}), Suffix=${c.inferredCode}`);
    }
  }
}

main();
