/**
 * Infer country from company name patterns / legal suffixes.
 * Reads companies_not_found.csv, applies pattern matching,
 * merges inferred results into companies_enriched.csv.
 *
 * Usage: bun run scripts/clean/infer-countries.ts
 */

import { file } from 'bun';
import * as path from 'path';

const DIR = import.meta.dir;
const ENRICHED_FILE = path.join(DIR, 'companies_enriched.csv');
const NOT_FOUND_FILE = path.join(DIR, 'companies_not_found.csv');
const FINAL_NOT_FOUND = path.join(DIR, 'companies_still_unknown.csv');

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

// ── Country inference rules ──────────────────────────────────────────

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
  { pattern: /\b(AB|Handelsbolag)\b/i, country: 'Sweden', code: 'SWE' },
  { pattern: /\bAS\b$/i, country: 'Norway', code: 'NOR' },  // Norwegian AS at end
  { pattern: /\bKS\b$/i, country: 'Norway', code: 'NOR' },
  { pattern: /\bANS\b$/i, country: 'Norway', code: 'NOR' },

  // Germanic
  { pattern: /\bGmbH\b/i, country: 'Germany', code: 'DEU' },
  { pattern: /\bKG\b$/i, country: 'Germany', code: 'DEU' },
  { pattern: /\bSchifffahrt/i, country: 'Germany', code: 'DEU' },
  { pattern: /\bReederei\b/i, country: 'Germany', code: 'DEU' },
  { pattern: /\bA,?G\.?\b/, country: 'Germany/Switzerland', code: 'DEU' },

  // Benelux
  { pattern: /\bB\.?V\.?\b/, country: 'Netherlands', code: 'NLD' },
  { pattern: /\bC\.?V\.?\b/, country: 'Netherlands', code: 'NLD' },
  { pattern: /\bN\.?V\.?\b/, country: 'Netherlands', code: 'NLD' },
  { pattern: /\bBVBA\b/i, country: 'Belgium', code: 'BEL' },

  // Southern Europe
  { pattern: /\bS\.?L\.?\b$/, country: 'Spain', code: 'ESP' },
  { pattern: /\bSLU\b/i, country: 'Spain', code: 'ESP' },
  { pattern: /\bS\.?P\.?A\.?\b/i, country: 'Italy', code: 'ITA' },
  { pattern: /\bS\.?r\.?l\.?\b/i, country: 'Italy', code: 'ITA' },
  { pattern: /\bSAS\b$/i, country: 'France', code: 'FRA' },
  { pattern: /\bSASU\b/i, country: 'France', code: 'FRA' },
  { pattern: /\bSNC\b/i, country: 'France', code: 'FRA' },
  { pattern: /\bSAM\b$/i, country: 'Monaco', code: 'MCO' },
  { pattern: /\bLda\b/i, country: 'Portugal', code: 'PRT' },

  // Greek
  { pattern: /\bS\.?A\.?\b$/i, country: 'Greece', code: 'GRC' },  // SA at end — most likely Greek in shipping

  // Turkish
  { pattern: /\bDenizcilik\b/i, country: 'Turkiye', code: 'TUR' },
  { pattern: /\bLtd\s+Sti\b/i, country: 'Turkiye', code: 'TUR' },
  { pattern: /\bA,?S\b$/i, country: 'Turkiye', code: 'TUR' },  // Turkish A.S. — but ambiguous with Norwegian

  // Eastern Europe / CIS
  { pattern: /\bOOO\b/i, country: 'Russia', code: 'RUS' },
  { pattern: /\bOAO\b/i, country: 'Russia', code: 'RUS' },
  { pattern: /\bPAO\b/i, country: 'Russia', code: 'RUS' },
  { pattern: /\bJSSC\b/i, country: 'Ukraine', code: 'UKR' },
  { pattern: /\bTOV\b/i, country: 'Ukraine', code: 'UKR' },
  { pattern: /\bAO\b$/i, country: 'Russia', code: 'RUS' },
  { pattern: /\bOÜ\b/i, country: 'Estonia', code: 'EST' },
  { pattern: /\bSha\b$/i, country: 'Albania', code: 'ALB' },

  // SE Asia
  { pattern: /\bSdn\s*Bhd\b/i, country: 'Malaysia', code: 'MYS' },
  { pattern: /\bSDN\b/i, country: 'Malaysia', code: 'MYS' },
  { pattern: /\bPT\b\s+\w/i, country: 'Indonesia', code: 'IDN' },

  // UAE / Middle East
  { pattern: /\bDMCC\b/i, country: 'United Arab Emirates', code: 'ARE' },
  { pattern: /\bFZE\b/i, country: 'United Arab Emirates', code: 'ARE' },
  { pattern: /\bFZC\b/i, country: 'United Arab Emirates', code: 'ARE' },
  { pattern: /\bFZ-LLC\b/i, country: 'United Arab Emirates', code: 'ARE' },
  { pattern: /\bS\.?A\.?O\.?C\b/i, country: 'Oman', code: 'OMN' },

  // Americas
  { pattern: /\bLLC\b/i, country: 'United States', code: 'USA' },
  { pattern: /\bLtda\b/i, country: 'Brazil', code: 'BRA' },

  // Other
  { pattern: /\bPvt\s+Ltd\b/i, country: 'India', code: 'IND' },
  { pattern: /\bJSC\b/i, country: 'Russia', code: 'RUS' },
  { pattern: /\bPLC\b/i, country: 'United Kingdom', code: 'GBR' },
];

// Explicit country name mentions in the company name
const COUNTRY_MENTIONS: CountryRule[] = [
  { pattern: /\bSingapore\b/i, country: 'Republic of Singapore', code: 'SGP' },
  { pattern: /\bIndonesia\b/i, country: 'Indonesia', code: 'IDN' },
  { pattern: /\bIndia\b/i, country: 'India', code: 'IND' },
  { pattern: /\bNorwa?y?\b/i, country: 'Norway', code: 'NOR' },
  { pattern: /\bDenmark\b/i, country: 'Denmark', code: 'DNK' },
  { pattern: /\bSweden\b/i, country: 'Sweden', code: 'SWE' },
  { pattern: /\bFrance\b/i, country: 'France', code: 'FRA' },
  { pattern: /\bAustralia\b/i, country: 'Australia', code: 'AUS' },
  { pattern: /\bHK\b|Hong Kong/i, country: 'Hong Kong, S.A.R., China', code: 'HKG' },
  { pattern: /\bShanghai\b|Jiangsu|Nanjing|Zhejiang/i, country: 'China', code: 'CHN' },
  { pattern: /\bVietnam\b/i, country: 'Vietnam', code: 'VNM' },
  { pattern: /\bSamoa\b/i, country: 'Samoa', code: 'WSM' },
  { pattern: /\bPanama\b/i, country: 'Panama', code: 'PAN' },
  { pattern: /\bBahamas\b/i, country: 'Bahamas', code: 'BHS' },
  { pattern: /\bMalaysia\b/i, country: 'Malaysia', code: 'MYS' },
  { pattern: /\bCongo\b/i, country: 'Republic of the Congo', code: 'COG' },
  { pattern: /\bQatar\b/i, country: 'Qatar', code: 'QAT' },
  { pattern: /\bOman\b/i, country: 'Oman', code: 'OMN' },
  { pattern: /\bOntario\b|Canada\b/i, country: 'Canada', code: 'CAN' },
  { pattern: /\bPortugal\b/i, country: 'Portugal', code: 'PRT' },
  { pattern: /\bGuyane\b/i, country: 'French Guiana', code: 'GUF' },
  { pattern: /\bIceland\b|Islands?\s*(?:HF|Oil)\b/i, country: 'Iceland', code: 'ISL' },
];

// Known specific companies (manual overrides based on domain knowledge)
const KNOWN_COMPANIES: Record<string, { country: string; code: string }> = {
  'Shell International Trading and Shipping Company Ltd': { country: 'United Kingdom', code: 'GBR' },
  'BP SINGAPORE PTE LIMITED': { country: 'Republic of Singapore', code: 'SGP' },
  'Posco Daewoo Corporation': { country: 'Republic of Korea', code: 'KOR' },
  'SSANGYONG CEMENT': { country: 'Republic of Korea', code: 'KOR' },
  'HMM Company Limted': { country: 'Republic of Korea', code: 'KOR' },
  'Jxtg Nippon Oil Energy Corporation': { country: 'Japan', code: 'JPN' },
  'NITTSU SHOJI CO LTD': { country: 'Japan', code: 'JPN' },
  'TENSOU CO LTD AKA TENSOU': { country: 'Japan', code: 'JPN' },
  'Eihou Shoun Limited': { country: 'Japan', code: 'JPN' },
  'Hurtigruten Cruise AS': { country: 'Norway', code: 'NOR' },
  'Forsvaret - Forsvarsmateriell': { country: 'Norway', code: 'NOR' },
  'SVALBARD LUFTHAVN AS': { country: 'Norway', code: 'NOR' },
  'GLOMMEN BUNKERSERVICE AS': { country: 'Norway', code: 'NOR' },
  'Simon Møkster Shipping AS': { country: 'Norway', code: 'NOR' },
  'HØYERGRUPPEN AS': { country: 'Norway', code: 'NOR' },
  'BW Green Carriers AS': { country: 'Norway', code: 'NOR' },
  'BW Green Transport AS': { country: 'Norway', code: 'NOR' },
  'Gecoship AS': { country: 'Norway', code: 'NOR' },
  'Gulfmark Rederi AS': { country: 'Norway', code: 'NOR' },
  'Hoyerpool AS': { country: 'Norway', code: 'NOR' },
  'Saga Subsea AS': { country: 'Norway', code: 'NOR' },
  'SDK Chartering AS': { country: 'Norway', code: 'NOR' },
  'Thornico AS': { country: 'Denmark', code: 'DNK' },
  'Forsvaret og Forsvarsministeriets Styrelser': { country: 'Denmark', code: 'DNK' },
  'Equinor Refining Denmark AS': { country: 'Denmark', code: 'DNK' },
  'Equinor Metanol ANS': { country: 'Norway', code: 'NOR' },
  'Vattenfall Vindkraft': { country: 'Sweden', code: 'SWE' },
  'Marinekommando': { country: 'Germany', code: 'DEU' },
  'Bundesamt Fur Inffrastrukturur - Baiudbw': { country: 'Germany', code: 'DEU' },
  'Brazilian Navy Commission': { country: 'Brazil', code: 'BRA' },
  'Vietnam National Shipping Lines': { country: 'Vietnam', code: 'VNM' },
  'Borusan Lojistik AS': { country: 'Turkiye', code: 'TUR' },
  'Finnlines Oyj': { country: 'Finland', code: 'FIN' },
  'Eimskipafelag Islands Ehf': { country: 'Iceland', code: 'ISL' },
  'Festi HF': { country: 'Iceland', code: 'ISL' },
  'Samherji Hf': { country: 'Iceland', code: 'ISL' },
  'SAMSKIP HF': { country: 'Iceland', code: 'ISL' },
  'DOW CHEMICAL PACIFIC PTE': { country: 'Republic of Singapore', code: 'SGP' },
  'PETRO SUMMIT PTE LTD': { country: 'Republic of Singapore', code: 'SGP' },
  'MMA OFFSHORE ASIA PTE LTD': { country: 'Republic of Singapore', code: 'SGP' },
  'MMA OFFSHORE ASIA VESSEL': { country: 'Republic of Singapore', code: 'SGP' },
  'PTT Oil and Retail Business Public Company Limited': { country: 'Thailand', code: 'THA' },
  'Dead Sea Works Ltd, Supply': { country: 'Israel', code: 'ISR' },
  'Stanley Services Ltd Ssl': { country: 'Falkland Islands', code: 'FLK' },
  'COSCO Shipping (Singapore) Petroleum Pte, Ltd': { country: 'Republic of Singapore', code: 'SGP' },
  'Zim Integrated Marine Services Ltd': { country: 'Israel', code: 'ISR' },
  'CONGELADOS NORIBERICA SA': { country: 'Spain', code: 'ESP' },
  'PESQUERA AUGADOCE SL': { country: 'Spain', code: 'ESP' },
  'PESQUERA ECCE HOMO SL': { country: 'Spain', code: 'ESP' },
  'PESQUERA RAYMI SL': { country: 'Spain', code: 'ESP' },
  'Pesquera Raymi SL': { country: 'Spain', code: 'ESP' },
  'TALASA BARBANZA SL': { country: 'Spain', code: 'ESP' },
  'MORADIÑA SL': { country: 'Spain', code: 'ESP' },
  'Seapride Maritime SL': { country: 'Spain', code: 'ESP' },
  'J ronco y Cia Sl': { country: 'Spain', code: 'ESP' },
  'COOPERATIE VOOR DE': { country: 'Netherlands', code: 'NLD' },
  'Biron & CIE': { country: 'France', code: 'FRA' },
  'STANDARD MARINE TØNSBERG': { country: 'Norway', code: 'NOR' },
  'Stenship KS': { country: 'Norway', code: 'NOR' },
  // ── Round 2: remaining 102 manually identified ──
  'Afri-Bulk Navigation Pte Ltd': { country: 'Republic of Singapore', code: 'SGP' },
  'All Profit Ship Magement Co Ltd': { country: 'Hong Kong, S.A.R., China', code: 'HKG' },
  'Altair Shipping and Trading Corp': { country: 'Greece', code: 'GRC' },
  'Arab Shipbuilding and Repair Yard': { country: 'Bahrain', code: 'BHR' },
  'AS-MIRA PETROL VE KIMYA': { country: 'Turkiye', code: 'TUR' },
  'Atlantic Coal and Bulk': { country: 'United Kingdom', code: 'GBR' },
  'Bao-Trans Enterprises Limited': { country: 'Hong Kong, S.A.R., China', code: 'HKG' },
  'Bostomar Shipping Pte Ltd': { country: 'Republic of Singapore', code: 'SGP' },
  'Bunker Partner OÜ': { country: 'Estonia', code: 'EST' },
  'C&S ENERGY CO LTD': { country: 'Republic of Korea', code: 'KOR' },
  'Chemoil Monde-Export Mondex': { country: 'Republic of Singapore', code: 'SGP' },
  'Combined Mining and Shipping': { country: 'United Kingdom', code: 'GBR' },
  'Conex Petroleum Services Inc': { country: 'United States', code: 'USA' },
  "D'Amico Dry Designated Activity Company": { country: 'Ireland', code: 'IRL' },
  'DHT HOLDINGS INC C/O DHT': { country: 'Bermuda', code: 'BMU' },
  'DOF Subsea Asia Pacific Pte Ltd': { country: 'Republic of Singapore', code: 'SGP' },
  'E C B International General Trading': { country: 'United Arab Emirates', code: 'ARE' },
  'EMC GAS COPROPATION': { country: 'Republic of Korea', code: 'KOR' },
  'ENDEAVOUR BUNKER TRADING': { country: 'United Arab Emirates', code: 'ARE' },
  'FFS Refiners (Pty) Ltd': { country: 'South Africa', code: 'ZAF' },
  'Frederikshavn Maritime Uddan-': { country: 'Denmark', code: 'DNK' },
  'Future Oil & Grease Industry FZ': { country: 'United Arab Emirates', code: 'ARE' },
  'GEFO Gesellschaft Für Oeltransporte MBH': { country: 'Germany', code: 'DEU' },
  'Geostan Marine': { country: 'Georgia', code: 'GEO' },
  'Golar LNG Management Ltd': { country: 'Bermuda', code: 'BMU' },
  'HBC Asia Pte Ltd': { country: 'Republic of Singapore', code: 'SGP' },
  'Hoteles Dinamicos Sa Vidanta': { country: 'Mexico', code: 'MEX' },
  'Indigo Energy Partners': { country: 'United States', code: 'USA' },
  'Interex Megaline Co Ltd': { country: 'Hong Kong, S.A.R., China', code: 'HKG' },
  'Interrybflot Service Ltd': { country: 'Russia', code: 'RUS' },
  'Iolcos Hellenic Maritime Enterprices': { country: 'Greece', code: 'GRC' },
  'Kolkhorst Petroleum Company': { country: 'United States', code: 'USA' },
  'Kristian Gerhard Jebsens': { country: 'Norway', code: 'NOR' },
  'Lahham Livestock Meat Trading Company': { country: 'Jordan', code: 'JOR' },
  'Lazer Energy Company': { country: 'United States', code: 'USA' },
  'Leidos Holdings Inc': { country: 'United States', code: 'USA' },
  'Livanos NG Maritime Company': { country: 'Greece', code: 'GRC' },
  'Long Hung Trading and Service Co Ltd': { country: 'Vietnam', code: 'VNM' },
  'Martin Energy Services': { country: 'United States', code: 'USA' },
  'Meadway Shipping Trading Inc': { country: 'Greece', code: 'GRC' },
  'Mohan Mutra Exports': { country: 'India', code: 'IND' },
  'Navasota Oil Co Inc': { country: 'United States', code: 'USA' },
  'NL TRANS OIL LIMITED': { country: 'United Kingdom', code: 'GBR' },
  'Nutam Operations Pty Ltd': { country: 'South Africa', code: 'ZAF' },
  'Oceanways Shipping Limited': { country: 'Hong Kong, S.A.R., China', code: 'HKG' },
  'Oldstone Holding Ltd': { country: 'Marshall Islands', code: 'MHL' },
  'PF EFFO': { country: 'Faroe Islands', code: 'FRO' },
  'PIONEER NAVIGATION LTD C/O': { country: 'Bermuda', code: 'BMU' },
  'Platina Bulk Carriers Pts Ltd': { country: 'Republic of Singapore', code: 'SGP' },
  'PORTLINE CONTAINERS': { country: 'Portugal', code: 'PRT' },
  'Product Shipping and Trading': { country: 'Greece', code: 'GRC' },
  'Public Joint Stock Company "Murmansk Trawl Fleet"': { country: 'Russia', code: 'RUS' },
  'Ricochet Fuel Distributors': { country: 'United States', code: 'USA' },
  'Riviera Marine Agent Doubleight': { country: 'Japan', code: 'JPN' },
  'Rulexx Lubricants and Grease': { country: 'United Arab Emirates', code: 'ARE' },
  'SEA GLOBE MANAGEMENT AND': { country: 'Denmark', code: 'DNK' },
  'SeaWorld Management & Trading Inc': { country: 'Greece', code: 'GRC' },
  'Shreyas Shipping and Logistics': { country: 'India', code: 'IND' },
  'SHV Gas Supply & Risk': { country: 'Netherlands', code: 'NLD' },
  'SILK ROAD SHIPPING AND': { country: 'United Arab Emirates', code: 'ARE' },
  'Sims Group Global Trade Corp': { country: 'United States', code: 'USA' },
  'Sinotrans Agencies (S) Pte Ltd': { country: 'Republic of Singapore', code: 'SGP' },
  'Sonoco Partners Marketing &': { country: 'United States', code: 'USA' },
  'SSH Maritime Management of Pleasure Yachts': { country: 'United Arab Emirates', code: 'ARE' },
  'Stainless Tankers Inc c/o WOMAR Logistics Pte Ltd': { country: 'Republic of Singapore', code: 'SGP' },
  'Star Tankers Inc Trust Company': { country: 'Liberia', code: 'LBR' },
  'STATE TRADING ORGANISATION': { country: 'Maldives', code: 'MDV' },
  'Subsea7 ingapore Contracting Pte Ltd': { country: 'Republic of Singapore', code: 'SGP' },
  'Swire Pacific Offshore Operations Pte Ltd': { country: 'Republic of Singapore', code: 'SGP' },
  'Synergy Marine Commercial': { country: 'Republic of Singapore', code: 'SGP' },
  'Teekay LNG Partners LP': { country: 'Bermuda', code: 'BMU' },
  'Teekay Navion Offshore Loading Pte Ltd': { country: 'Republic of Singapore', code: 'SGP' },
  'Texas Fueling Services Inc': { country: 'United States', code: 'USA' },
  'The Ocean Technology Group Limited': { country: 'United Kingdom', code: 'GBR' },
  'THE PHILODRILL CORPORATION': { country: 'Philippines', code: 'PHL' },
  'The Sol Group': { country: 'Barbados', code: 'BRB' },
  'Trade Ocean Shipping Services Pty Ltd': { country: 'Australia', code: 'AUS' },
  'Tropic Oil Tropic Fleet Services': { country: 'United States', code: 'USA' },
  'TS GLOBAL PROCUREMENT': { country: 'Republic of Singapore', code: 'SGP' },
  'UNION FENOSA GAS S A': { country: 'Spain', code: 'ESP' },
  'V SHIPS LEISURE SAM V SHIPS': { country: 'Monaco', code: 'MCO' },
  'Varamar Shipping DMMCC': { country: 'United Arab Emirates', code: 'ARE' },
  'VQSV Shipping Limited c/o Axion Energy Corporation': { country: 'Hong Kong, S.A.R., China', code: 'HKG' },
  'Whitener Enterprises Inc': { country: 'United States', code: 'USA' },
  'WL Shipping Ltd': { country: 'United Kingdom', code: 'GBR' },
  'Agunsa Europa S,A,': { country: 'Spain', code: 'ESP' },
  'Capital World Maritime Ltd,': { country: 'Hong Kong, S.A.R., China', code: 'HKG' },
  'ENEL GLOBAL TRADING S,P,A,': { country: 'Italy', code: 'ITA' },
  'ENEL PRODUZIONE S,P,A,': { country: 'Italy', code: 'ITA' },
  'GTS GLOBAL TRADING PTE,': { country: 'Republic of Singapore', code: 'SGP' },
  'Jiangshu Shagang Group Co, Ltd': { country: 'China', code: 'CHN' },
  'Mitsui OSK Kinkai Ltd, aka Shosen': { country: 'Japan', code: 'JPN' },
  'P & P SHIPPING CO, (HELLAS) S,': { country: 'Greece', code: 'GRC' },
  'P,T, CHANDRA ASRI': { country: 'Indonesia', code: 'IDN' },
  'Pasternak, Baum & Co,, Inc': { country: 'United States', code: 'USA' },
  'Petroles Reiter Inc, AKA Reiter': { country: 'Canada', code: 'CAN' },
  'PT, STYRINDO MONO': { country: 'Indonesia', code: 'IDN' },
  'SHL Offshore Contractors B,V,': { country: 'Netherlands', code: 'NLD' },
  'ST Logistics Pte, Ltd,': { country: 'Republic of Singapore', code: 'SGP' },
  'Trinity House Harwich Depot, The': { country: 'United Kingdom', code: 'GBR' },
  'United Feeder Services L,P,': { country: 'Denmark', code: 'DNK' },
  'Zheijang Changchang Shipping Co, Ltd': { country: 'China', code: 'CHN' },
};

function inferCountry(name: string): { country: string; code: string; source: string } | null {
  // 1. Check known companies first
  if (KNOWN_COMPANIES[name]) {
    return { ...KNOWN_COMPANIES[name], source: 'known' };
  }

  // 2. Check explicit country mentions
  for (const rule of COUNTRY_MENTIONS) {
    if (rule.pattern.test(name)) {
      return { country: rule.country, code: rule.code, source: 'country-mention' };
    }
  }

  // 3. Check legal suffix patterns
  for (const rule of SUFFIX_RULES) {
    if (rule.pattern.test(name)) {
      return { country: rule.country, code: rule.code, source: 'suffix' };
    }
  }

  return null;
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
  // Read existing enriched
  const enrichedRaw = await file(ENRICHED_FILE).text();
  const enrichedLines = enrichedRaw.split('\n');
  const enrichedHeader = enrichedLines[0];
  const existingEnriched = enrichedLines.slice(1).filter(l => l.trim());

  // Read not-found
  const notFoundRaw = await file(NOT_FOUND_FILE).text();
  const notFoundLines = notFoundRaw.split('\n');

  const inferred: string[] = [];
  const unknown: { name: string; credit: number }[] = [];
  const bySource: Record<string, number> = {};

  for (let i = 1; i < notFoundLines.length; i++) {
    const line = notFoundLines[i].trim();
    if (!line) continue;
    const fields = parseCSVLine(line);
    const name = fields[0];
    const credit = parseFloat(fields[1]) || 0;

    const result = inferCountry(name);
    if (result) {
      bySource[result.source] = (bySource[result.source] || 0) + 1;
      inferred.push(
        `"${name.replace(/"/g, '""')}",${credit},"","${result.country}","${result.code}"`
      );
    } else {
      unknown.push({ name, credit });
    }
  }

  // Merge inferred into enriched
  const allEnriched = [...existingEnriched, ...inferred];
  await Bun.write(ENRICHED_FILE, [enrichedHeader, ...allEnriched].join('\n'));

  // Write truly unknown
  const unkHeader = 'company_name,credit';
  const unkLines = unknown.map(r => `"${r.name.replace(/"/g, '""')}",${r.credit}`);
  await Bun.write(FINAL_NOT_FOUND, [unkHeader, ...unkLines].join('\n'));

  console.log('═══ Country Inference from Legal Suffixes ═══');
  console.log(`Total not-found input: ${notFoundLines.length - 1}`);
  console.log(`Inferred country: ${inferred.length}`);
  for (const [src, count] of Object.entries(bySource)) {
    console.log(`  - ${src}: ${count}`);
  }
  console.log(`Still unknown: ${unknown.length}`);
  console.log(`\nTotal enriched (with Seasearcher + inferred): ${allEnriched.length}`);
  console.log(`\nUnknown companies saved to: companies_still_unknown.csv`);

  if (unknown.length > 0) {
    console.log('\n─── Remaining unknown companies ───');
    for (const u of unknown) {
      console.log(`  ${u.name}  (${u.credit.toLocaleString()})`);
    }
  }
}

main();
