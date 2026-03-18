import { spawnSync } from 'node:child_process';
import { basename } from 'node:path';

export const PLATTS_PARSER_VERSION = '2026-03-18i';

export interface ParsedPlattsEntry {
  rawText: string;
  company?: string;
  counterparty?: string;
  action?: string;
  price?: string;
  quantity?: string;
  timestampText?: string;
  marketRegion?: string;
  marketBasis?: string;
  metadata?: Record<string, unknown>;
}

export interface ParsedPlattsSection {
  type: 'TRADES' | 'BIDS' | 'OFFERS' | 'WITHDRAWALS' | 'COMMENTARY' | 'OTHER';
  heading: string;
  entries: ParsedPlattsEntry[];
}

export interface ParsedPlattsReport {
  title: string;
  publicationDate: string;
  commentary: string[];
  sections: ParsedPlattsSection[];
}

interface ParsedMetadata {
  title: string;
  publicationDate: string;
}

interface AssessmentSectionConfig {
  headingPattern: RegExp;
  basisHeaders: string[];
}

interface AssessmentParseResult {
  section: ParsedPlattsSection;
  nextIndex: number;
}

interface MultiSectionParseResult {
  sections: ParsedPlattsSection[];
  nextIndex: number;
}

const MONTHS = new Map([
  ['january', 0],
  ['february', 1],
  ['march', 2],
  ['april', 3],
  ['may', 4],
  ['june', 5],
  ['july', 6],
  ['august', 7],
  ['september', 8],
  ['october', 9],
  ['november', 10],
  ['december', 11],
]);

const MOC_HEADER_REGEX = /^(?:PLATTS\s+[A-Z0-9&.'()\/-]+(?:\s+[A-Z0-9&.'()\/-]+)*\s+)?MOC\s+(TRADES|BIDS|OFFERS|WITHDRAWALS)\s+ON\s+CLOSE$/i;
const SIMPLE_HEADER_REGEX = /^(Trades|Bids|Offers|Withdrawals)(?::\s*(?:None|No .*|None\.)?)?\.?$/i;
const COMBINED_HEADER_REGEX = /^(Bids, Offers, Trades|Offers, Trades|Bids, Offers)$/i;
const COMMENTARY_HEADER_REGEX = /^(Platts.*?(?:Daily Market Analysis|Rationale|Rationales|Rationale & Exclusions|Daily Commentary)|Market Commentary|This assessment commentary applies)/i;
const EMBEDDED_COMMENTARY_HEADER_REGEX = /((?:Platts\s+[A-Z0-9&.'()\/-]+(?:\s+[A-Z0-9&.'()\/-]+){0,10}\s+(?:Daily Market Analysis|Daily Commentary|Daily Rationales?|Daily Rationale(?:s)? & Exclusions|Rationale(?:s)? & Exclusions)|West Africa Daily Refined Products Commentary))/gi;
const LEADING_NAPHTHA_WINDOW_LINE_REGEX = /^(PLATTS NAPHTHA NWE CRG [^:]+:)\s+(.+)$/i;
const STATUS_LINE_REGEX = /^(?:[\u2022\u2023\u25AA\u25CF\u25E6\u2043\u00B7\u0084\-]\s*)?NO\s+(TRADES|BIDS|OFFERS|WITHDRAWALS)\s+REPORTED\.?$/i;
const DIRECT_ACTION_LINE_REGEX = /^(?!\d{1,2}-\d{1,2}:)(?!PLATTS\b)[A-Z0-9&.'()\/-]+(?:\s+[A-Z0-9&.'()\/-]+){0,6}\s+(NO LONGER BIDS|NO LONGER OFFERS|BIDS|OFFERS|SELLS|BUYS)\b/i;
const MOC_CONTEXT_LINE_REGEX = /^(?:CIF|FOB)\s+BASIS\b/i;
const LEADING_MARKET_BASIS_REGEX = /^((?:CIF|FOB)\s+BASIS\s+.+?)\s+(PLATTS\b.*)$/i;
const ASSESSMENT_TABLE_SECTION_CONFIGS: AssessmentSectionConfig[] = [
  {
    headingPattern: /^Mediterranean cargoes\b/i,
    basisHeaders: ['FOB Med (Italy)', 'CIF Med (Genova/Lavera)', 'MOPL Diff'],
  },
  {
    headingPattern: /^Med cargoes\b/i,
    basisHeaders: ['FOB Med', 'CIF Med'],
  },
  {
    headingPattern: /^Northwest Europe cargoes\b/i,
    basisHeaders: ['FOB NWE', 'CIF NWE/Basis ARA', 'MOPL Diff'],
  },
  {
    headingPattern: /^Northwest Europe barges\b/i,
    basisHeaders: ['FOB Rotterdam', 'FOB FARAG', 'MOPL Diff'],
  },
  {
    headingPattern: /^West Africa cargoes\b/i,
    basisHeaders: ['FOB NWE', 'CIF WAF'],
  },
];
const GROUPED_SINGLE_BASIS_HEADING_REGEX = /^Euro-denominated assessments 16:30 London$/i;
const QUOTE_FIRST_SECTION_HEADING_REGEX = /^Marine Fuel \(PGA page 30\)$/i;
const WEEKLY_BITUMEN_HEADING_REGEX = /^European weekly bitumen,/i;
const WEEKLY_BASE_OILS_HEADING_REGEX = /^European weekly base oils,/i;
const JET_INDEX_HEADING_REGEX = /^Jet Index \(PGA page 115\)$/i;
const AFRICA_PRODUCTS_HEADING_REGEX = /^Africa products \(\$\/mt\)$/i;
const FEEDSTOCKS_HEADING_REGEX = /^European feedstocks and blendstocks$/i;
const CALENDAR_MONTH_AVERAGES_HEADING_REGEX = /^Calendar month averages for /i;
const FOREIGN_EXCHANGE_HEADING_REGEX = /^Foreign exchange rates \(PGA page 1151\)$/i;
const CARBON_CREDITS_HEADING_REGEX = /^Carbon credits \(PGA page 496\)$/i;
const RENEWABLE_FUELS_HEADING_REGEX = /^Renewable fuels \(PGA pages 1414, 483 and 2414\)$/i;
const CARBON_INTENSITY_HEADING_REGEX = /^Carbon Intensity \(PGA page 4207\)$/i;
const ASIA_PRODUCTS_HEADING_REGEX = /^Asia products$/i;
const GASOLINE_COMPONENTS_HEADING_REGEX = /^Gasoline components \(PBF page 2010\)$/i;
const SINGAPORE_SWAPS_HEADING_REGEX = /^Singapore swaps \(PPA page 2654\)$/i;
const MIDDLE_EAST_HEADING_REGEX = /^Middle East \(PGA page 2004\)$/i;
const JAPAN_HEADING_REGEX = /^Japan \(PGA page 2006\)$/i;
const US_PRODUCTS_HEADING_REGEX = /^US Products: [A-Za-z]+ \d{1,2}, \d{4}$/i;
const RUSSIAN_NETBACKS_HEADING_REGEX = /^Russian domestic refined products netbacks$/i;
const DELIVERY_BASIS_HEADING_REGEX = /^Delivery basis$/i;
const DIESEL_BARGES_HEADING_REGEX = /^Diesel barges$/i;
const LSFO_BARGES_HEADING_REGEX = /^LSFO barges$/i;
const NAPHTHA_WINDOW_CONTEXT_REGEX = /^PLATTS NAPHTHA NWE CRG [^:]+:$/i;
const MARINE_FUEL_DERIVATIVES_HEADING_REGEX = /^Marine Fuel 0\.5% Derivatives,/i;
const PLATTS_ICE_HEADING_REGEX = /^Platts ICE 16:30 London assessments/i;
const ICE_SETTLEMENTS_HEADING_REGEX = /^ICE gasoil settlements \(PGA page 702\)$/i;
const NYMEX_FUTURES_HEADING_REGEX = /^NYMEX futures \(16:30 London time\)$/i;
const EURO_FINANCIAL_DERIVATIVES_HEADING_REGEX = /^European financial derivatives:/i;
const STRUCTURED_SECTION_BOUNDARY_REGEX = /^(?:Euro-denominated assessments 16:30 London|Marine Fuel \(PGA page 30\)|Platts ICE 16:30 London assessments|ICE gasoil settlements|NYMEX futures|Marine Fuel 0.5% Derivatives|GB pence per liter assessments|European financial derivatives|Jet Index \(PGA page 115\)|Africa products \(\$\/mt\)|European feedstocks and blendstocks|Calendar month averages for |Foreign exchange rates \(PGA page 1151\)|Carbon credits \(PGA page 496\)|Renewable fuels \(PGA pages 1414, 483 and 2414\)|Carbon Intensity \(PGA page 4207\)|Asia products|Gasoline components \(PBF page 2010\)|Singapore swaps \(PPA page 2654\)|Middle East \(PGA page 2004\)|Japan \(PGA page 2006\)|US Products:|Russian domestic refined products netbacks|Delivery basis|Diesel barges|LSFO barges)/i;

function getPdftotextInstallHint(): string {
  switch (process.platform) {
    case 'darwin':
      return 'Install it with `brew install poppler`.';
    case 'linux':
      return 'Install it with `sudo apt-get install poppler-utils`.';
    default:
      return 'Install Poppler and ensure `pdftotext` is available in your PATH.';
  }
}

function normalizeLine(rawLine: string): string {
  return rawLine
    .replace(/[\u0084\u2022\u2023\u25AA\u25CF\u25E6\u2043\u00B7]/g, ' ')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u00A0\t]+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitEmbeddedLine(line: string): string[] {
  const normalized = normalizeLine(line);
  if (!normalized) return [];

  const expanded = normalized
    .replace(LEADING_NAPHTHA_WINDOW_LINE_REGEX, '$1\n$2')
    .replace(/\s+(PLATTS\s+[A-Z0-9&.'()\/-]+(?:\s+[A-Z0-9&.'()\/-]+)*\s+MOC\s+(?:TRADES|BIDS|OFFERS|WITHDRAWALS)\s+ON\s+CLOSE)/gi, '\n$1')
    .replace(/\s+(PLATTS NAPHTHA NWE CRG [^:]+:)/gi, '\n$1')
    .replace(/\s+(?=Platts European Marketscan(?:\s+Volume\s+\d+\s*\/\s*Issue\s+\d+\s*\/)?\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4})/g, '\n')
    .replace(/\s+(?=GB pence per liter assessments 16:30 London Market Commentary)/gi, '\n')
    .replace(/\s+(?=Euro cents per liter assessments 16:30 London)/gi, '\n')
    .replace(/\s+(?=\(continued on page \d+\))/gi, '\n')
    .replace(/\s+(?=Platts is part of S&P Global Energy\.?)/gi, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .replace(EMBEDDED_COMMENTARY_HEADER_REGEX, '\n$1')
    .replace(/\s+(This assessment commentary applies to the following)/gi, '\n$1');

  return expanded
    .split('\n')
    .map((part) => normalizeLine(part))
    .filter((part) => part.length > 0);
}

function combineWrappedLines(lines: string[]): string[] {
  const combined: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    let line = lines[index]!;

    while (index + 1 < lines.length) {
      const joined = normalizeLine(`${line} ${lines[index + 1]}`);
      if (
        (line.startsWith('Platts ') && line.endsWith(',') && /^(Trades|Bids|Offers|Withdrawals|Bids, Offers, Trades|Offers, Trades|Bids, Offers)$/i.test(lines[index + 1]!)) ||
        (line.endsWith(',') && COMBINED_HEADER_REGEX.test(lines[index + 1]!)) ||
        (isSectionHeader(joined) && !isSectionHeader(line)) ||
        (COMMENTARY_HEADER_REGEX.test(joined) && !COMMENTARY_HEADER_REGEX.test(line))
      ) {
        line = joined;
        index += 1;
        continue;
      }
      if (NAPHTHA_WINDOW_CONTEXT_REGEX.test(lines[index + 1]!)) {
        break;
      }
      break;
    }

    combined.push(line);
  }

  return combined;
}

function isDecorativeLine(line: string): boolean {
  if (!line) return true;
  if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line)) return true;
  if (/^©\s*\d{4}\s+by\s+S&P Global/i.test(line)) return true;
  if (/^\d{1,2}$/.test(line)) return true;
  if (/^www\.spglobal\.com\/energy/i.test(line)) return true;
  if (/^Contact Client Services:/i.test(line)) return true;
  if (/^Explore Forward Curves/i.test(line)) return true;
  if (/^Platts is part of S&P Global Energy\.?$/i.test(line)) return true;
  if (/^(Unlock|Global Energy|Scan, then|search for|Trading|learn more\.)$/i.test(line)) return true;
  if (/^Platts European Marketscan\s+[A-Z][a-z]+ \d{1,2}, \d{4}$/i.test(line)) return true;
  if (/^Platts European Marketscan Volume \d+ \/ Issue \d+ \/ [A-Za-z]+ \d{1,2}, \d{4} European products \(\$\/mt\) Code Mid Change/i.test(line)) return true;
  if (/^GB pence per liter assessments 16:30 London Market Commentary /i.test(line)) return true;
  return false;
}

function isSectionHeader(line: string): boolean {
  return MOC_HEADER_REGEX.test(line) || SIMPLE_HEADER_REGEX.test(line) || COMBINED_HEADER_REGEX.test(line);
}

function getAssessmentSectionConfig(line: string): AssessmentSectionConfig | undefined {
  return ASSESSMENT_TABLE_SECTION_CONFIGS.find((config) => config.headingPattern.test(line));
}

function isStructuredSectionBoundary(line: string): boolean {
  return STRUCTURED_SECTION_BOUNDARY_REGEX.test(line);
}

function sectionTypeFromHeading(heading: string): ParsedPlattsSection['type'] {
  if (/TRADES/i.test(heading)) return 'TRADES';
  if (/BIDS/i.test(heading)) return 'BIDS';
  if (/OFFERS/i.test(heading)) return 'OFFERS';
  if (/WITHDRAWALS/i.test(heading)) return 'WITHDRAWALS';
  return 'OTHER';
}

function parseMonthDate(raw: string): string | null {
  const match = raw.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i);
  if (!match) return null;
  const month = MONTHS.get(match[1]!.toLowerCase());
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month == null || !Number.isInteger(day) || !Number.isInteger(year)) return null;
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

function parseDateFromFilename(fileName: string): string | null {
  const match = fileName.match(/(\d{4})(\d{2})(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function inferMarketRegion(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const upper = text.toUpperCase();
  if (upper.includes('NWE')) return 'NWE';
  if (upper.includes('NSEA') || upper.includes('NORTH SEA')) return 'NSEA';
  if (upper.includes('MED')) return 'MED';
  if (upper.includes('EU FO')) return 'EU_FO';
  if (upper.includes('MIDDIST')) return 'MIDDIST';
  return undefined;
}

function extractMetadata(text: string, sourceFileName: string): ParsedMetadata {
  const normalizedLines = text
    .split('\n')
    .map(normalizeLine)
    .filter((line) => line.length > 0);

  const title = normalizedLines.find((line) => /^Platts /i.test(line)) ?? 'Platts Report';

  for (const line of normalizedLines.slice(0, 20)) {
    const publicationDate = parseMonthDate(line);
    if (publicationDate) {
      return { title, publicationDate };
    }
  }

  return {
    title,
    publicationDate: parseDateFromFilename(sourceFileName) ?? new Date().toISOString().slice(0, 10),
  };
}

function stitchCommentary(lines: string[]): string[] {
  const stitched: string[] = [];
  let buffer = '';

  for (const line of lines) {
    if (!buffer) {
      buffer = line;
      continue;
    }

    if (buffer.endsWith('-')) {
      buffer = `${buffer.slice(0, -1)}${line}`;
      continue;
    }

    if (!/[.:!?]$/.test(buffer)) {
      buffer = `${buffer} ${line}`;
      continue;
    }

    stitched.push(buffer);
    buffer = line;
  }

  if (buffer) stitched.push(buffer);
  return stitched;
}

function sanitizeCommentaryLine(line: string): string | null {
  let normalized = normalizeLine(line);
  if (!normalized) return null;
  const commentaryHeadingMatch = normalized.match(/Platts .*?(?:Daily Market Analysis|Daily Commentary|Daily Rationales?|Daily Rationale(?:s)? & Exclusions|Rationale(?:s)? & Exclusions)|West Africa Daily Refined Products Commentary|Platts Russian Refined Products Daily Commentary/i);
  if (commentaryHeadingMatch && (commentaryHeadingMatch.index ?? 0) > 0) {
    normalized = normalized.slice(commentaryHeadingMatch.index).trim();
  }

  normalized = normalizeLine(
    normalized
      .replace(/\(continued on page \d+\)/gi, ' ')
      .replace(/Platts European Marketscan\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}/gi, ' ')
      .replace(/Platts is part of S&P Global Energy\.?/gi, ' ')
      .replace(/and eWindow Data\s+"Platts Global Services"\s+to/gi, ' '),
  );
  if (!normalized) return null;

  if (/^Platts European Marketscan Volume \d+ \/ Issue \d+ \/ [A-Za-z]+ \d{1,2}, \d{4} European products \(\$\/mt\)/i.test(normalized)) {
    return null;
  }
  if (/^(?:Euro cents per liter assessments 16:30 London|GB pence per liter assessments 16:30 London)$/i.test(normalized)) {
    return null;
  }
  if (/^Market Commentary /i.test(normalized)) {
    normalized = normalizeLine(normalized.replace(/^Market Commentary /i, ''));
  }
  if (/^GB pence per liter assessments 16:30 London Market Commentary /i.test(normalized)) {
    normalized = normalizeLine(normalized.replace(/^GB pence per liter assessments 16:30 London Market Commentary /i, ''));
  }
  if (/^[A-Z][A-Za-z0-9%/().,'\- ]+<\w+> assessment rationale:$/i.test(normalized)) {
    return null;
  }
  if (/^(BFOE|CFD|Johan Sverdrup FOB North Sea).*assessment rationale:$/i.test(normalized)) {
    return null;
  }
  if (/^Platts European Marketscan [A-Za-z]+ \d{1,2}, \d{4} [A-Z].* assessment rationale:$/i.test(normalized)) {
    return null;
  }
  if (/^.*(?:following )?market data codes:/i.test(normalized)) {
    const embeddedHeadingMatch = normalized.match(/Platts .*?(?:Daily Market Analysis|Daily Commentary)|West Africa Daily Refined Products Commentary|Platts Russian Refined Products Daily Commentary/i);
    return embeddedHeadingMatch ? normalized.slice(embeddedHeadingMatch.index ?? 0).trim() : null;
  }
  if (/^(?:Platts .*?Bids, Offers, Trades(?:\s*<[^>]+>)?|Platts .*?Bids, Offers, Trades|Platts .*?Bids, Offers, Trades .*|Platts .*?Bids, Offers, Trades .*|Platts .*?Bids, Offers, Trades)$/i.test(normalized)) {
    return null;
  }
  if (/^(Deals Summary|Bids \(PGA page \d+\)|Offers \(PGA page \d+\)|Trades \(PGA page \d+\)|Withdrawals)$/i.test(normalized)) {
    return null;
  }
  if (/^(Description SAF FOB Straits|Assessment Butane DAP Lagos|Assessment Name 2026 netback\/netforward formula)/i.test(normalized)) {
    return null;
  }
  if (/^Exclusions: None(?:\s+Platts.*?)?$/i.test(normalized)) {
    return null;
  }
  if (/^(?:Code|Mid|Change|Code Mid Change(?: Code Mid Change)*)$/i.test(normalized)) {
    return null;
  }
  if (/^(?:No\s+(?:bids|offers|trades)\s+reported|No bids reported|No offers reported|No trades reported)$/i.test(normalized)) {
    return null;
  }

  return normalized;
}

function finalizeCommentary(lines: string[]): string[] {
  return stitchCommentary(
    lines
      .map((line) => sanitizeCommentaryLine(line))
      .filter((line): line is string => Boolean(line)),
  )
    .map((line) => sanitizeCommentaryLine(line))
    .filter((line): line is string => Boolean(line));
}

function consolidateSections(sections: ParsedPlattsSection[]): ParsedPlattsSection[] {
  const consolidated = new Map<string, ParsedPlattsSection>();

  for (const section of sections) {
    const key = `${section.type}::${section.heading}`;
    const existing = consolidated.get(key);
    if (!existing) {
      consolidated.set(key, {
        ...section,
        entries: [...section.entries],
      });
      continue;
    }

    existing.entries.push(...section.entries);
  }

  return Array.from(consolidated.values());
}

function cleanupEntityName(raw: string | undefined): string | undefined {
  const cleaned = raw
    ?.replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /^NO$/i.test(cleaned) || /^PLATTS$/i.test(cleaned) || /^REPORTED$/i.test(cleaned)) return undefined;
  return cleaned;
}

function normalizeBasisHeader(header: string): string {
  return header.replace(/\*+$/g, '').trim();
}

function isMocContextLine(line: string): boolean {
  return MOC_CONTEXT_LINE_REGEX.test(line);
}

function shouldStartNewMocEntry(line: string, previous?: ParsedPlattsEntry): boolean {
  if (!previous) return true;
  if (STATUS_LINE_REGEX.test(line)) return true;
  if (isMocContextLine(line)) return false;
  if (/^PLATTS\b/i.test(line)) return true;
  return DIRECT_ACTION_LINE_REGEX.test(line);
}

function extractPrice(rawText: string): string | undefined {
  const match = rawText.match(/\$\s*(-?[\d,.]+(?:\/[A-Za-z]+)?)/i);
  return match ? `$${match[1]}`.replace(/\s+/g, '') : undefined;
}

function extractQuantity(rawText: string): string | undefined {
  const match = rawText.match(/FOR\s+([\d,.]+\s*[A-Z]{1,6})\b/i);
  return match ? match[1]!.replace(/\s+/g, '') : undefined;
}

function extractCounterparty(rawText: string, action: string | undefined): string | undefined {
  if (!action) return undefined;
  if (action === 'SELLS') {
    return cleanupEntityName(rawText.match(/SELLS TO\s+([A-Z0-9&.'()\-/ ]+?)(?:\*|\s+AT\b|\s+FOR\b|\s*\()/i)?.[1]);
  }
  if (action === 'BUYS') {
    return cleanupEntityName(rawText.match(/BUYS FROM\s+([A-Z0-9&.'()\-/ ]+?)(?:\*|\s+AT\b|\s+FOR\b|\s*\()/i)?.[1]);
  }
  return undefined;
}

function extractAction(rawText: string): string | undefined {
  const match = rawText.match(/\b(NO LONGER BIDS|NO LONGER OFFERS|BIDS|OFFERS|SELLS|BUYS)\b/i);
  return match ? match[1]!.toUpperCase() : undefined;
}

function extractCompany(rawText: string, action: string | undefined): string | undefined {
  if (!action) return undefined;
  if (STATUS_LINE_REGEX.test(rawText)) return undefined;

  const regex = new RegExp(`^(.+?)\\s+${action.replace(/ /g, '\\s+')}\\b`, 'i');
  const leadingMatch = cleanupEntityName(rawText.match(regex)?.[1]);
  if (leadingMatch && !/(?:^|\s)(PLATTS|CIF BASIS|FOB BASIS)\b/i.test(leadingMatch)) {
    return leadingMatch;
  }

  const fallbackRegex = new RegExp(`(?:^|:\\s+)([A-Z0-9&.'()\\-/ ]+?)\\s+${action.replace(/ /g, '\\s+')}\\b`, 'gi');
  let fallbackCompany: string | undefined;
  let match: RegExpExecArray | null = fallbackRegex.exec(rawText);
  while (match) {
    fallbackCompany = cleanupEntityName(match[1]);
    match = fallbackRegex.exec(rawText);
  }

  return fallbackCompany;
}

function extractTimestamp(rawText: string): string | undefined {
  const match = rawText.match(/\((\d{2}:\d{2}:\d{2})\)/);
  return match?.[1];
}

function extractMarketDataDetails(rawText: string): ParsedPlattsEntry {
  const normalizedRawText = normalizeLine(rawText);
  const entry: ParsedPlattsEntry = { rawText: normalizedRawText };

  const statusMatch = normalizedRawText.match(/^No\s+(offers|bids|trades)\s+reported$/i);
  if (statusMatch) {
    entry.action = `NO ${statusMatch[1]!.toUpperCase()} REPORTED`;
    entry.metadata = {
      rowKind: 'market-data',
      statusText: normalizedRawText,
      marketContext: null,
    };
    return entry;
  }

  const soldMatch = normalizedRawText.match(/^(PLATTS .*?:\s*(?:[^:]+:\s*)*)([A-Z0-9*]+)\s+sold to\s+([A-Z0-9*]+)\s+([\d.]+kt:\s*kt)\s+(\$-?[\d.]+\/mt)\s+(\d{2}:\d{2}:\d{2})$/i);
  if (soldMatch) {
    const marketContext = normalizeLine(soldMatch[1]!.replace(/:\s*$/, ''));
    entry.company = cleanupEntityName(soldMatch[2]) ?? undefined;
    entry.counterparty = cleanupEntityName(soldMatch[3]) ?? undefined;
    entry.action = 'SOLD';
    entry.quantity = normalizeLine(soldMatch[4]!);
    entry.price = soldMatch[5]!;
    entry.timestampText = soldMatch[6]!;
    entry.metadata = {
      rowKind: 'market-data',
      marketContext,
      statusText: null,
    };
    return entry;
  }

  const orderMatch = normalizedRawText.match(/^(PLATTS .*?:\s*(?:[^:]+:\s*)*)([A-Z0-9*]+)\s+(no longer bids|no longer offers|bids|offers)\s+([\d-]+kt:)?\s*(\$-?[\d.]+\/mt)$/i);
  if (orderMatch) {
    const marketContext = normalizeLine(orderMatch[1]!.replace(/:\s*$/, ''));
    entry.company = cleanupEntityName(orderMatch[2]) ?? undefined;
    entry.action = orderMatch[3]!.toUpperCase();
    entry.quantity = orderMatch[4] ? normalizeLine(orderMatch[4]) : undefined;
    entry.price = orderMatch[5]!;
    entry.metadata = {
      rowKind: 'market-data',
      marketContext,
      statusText: null,
    };
    return entry;
  }

  entry.metadata = {
    rowKind: 'market-data',
    statusText: null,
    marketContext: null,
  };
  return entry;
}

function extractNaphthaWindowDetails(context: string, rawText: string): ParsedPlattsEntry {
  const normalizedRawText = normalizeLine(rawText);
  const entry: ParsedPlattsEntry = {
    rawText: normalizedRawText,
    marketBasis: 'Naphtha CIF NWE Cargo',
  };

  const match = normalizedRawText.match(/^(\d{1,2}-\d{1,2}):\s+([A-Z]+\s+\d{1,2}(?:-[A-Z]+\s+\d{1,2}|-\d{1,2})):\s+([A-Z0-9&.'()\/-]+)\s+(NO LONGER BIDS|NO LONGER OFFERS|BIDS|OFFERS)\s+AT\s+(.+?)\s+(\$-?[\d.]+)\s+FOR\s+([\d.]+MT)(?:;\s*(.*))?$/i);
  if (!match) {
    entry.metadata = {
      rowKind: 'market-data',
      marketContext: context,
      statusText: null,
    };
    return entry;
  }

  entry.timestampText = match[1]!;
  entry.company = cleanupEntityName(match[3]) ?? undefined;
  entry.action = match[4]!.toUpperCase();
  entry.price = match[6]!;
  entry.quantity = match[7]!;
  entry.metadata = {
    rowKind: 'market-data',
    marketContext: normalizeLine(`${context} ${match[2]}`),
    deliveryWindow: match[2]!,
    instrumentText: match[5]!,
    termsText: match[8] ? normalizeLine(match[8]) : null,
    statusText: null,
  };

  return entry;
}

function spawnOutputToString(output: string | Buffer | null | undefined): string {
  if (typeof output === 'string') return output;
  if (!output) return '';
  return Buffer.from(output).toString('utf8');
}

function isAssessmentCodeLine(line: string): boolean {
  return /^(?=[A-Z0-9]{6,8}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{6,8}(?:\s+[-\d.,–+]+.*)?$/i.test(line);
}

function isAssessmentValueLine(line: string): boolean {
  return /^[-\d.,]+(?:–[-\d.,]+)?(?:\s+[+-][-\d.,]+)?$/.test(line);
}

function isTableNumericToken(line: string): boolean {
  return /^(?:NANA|[+-]?[-\d.,]+(?:–[-\d.,]+)?(?:\s+[+-]?(?:NANA|[-\d.,]+))?)$/.test(line);
}

function isAssessmentNoteLine(line: string): boolean {
  return /^\*{1,3}/.test(line) || /^\(see page \d+\)/i.test(line);
}

function isAssessmentProductLine(line: string): boolean {
  if (!line) return false;
  if (isAssessmentCodeLine(line) || isAssessmentValueLine(line)) return false;
  if (isAssessmentNoteLine(line)) return false;
  if (/^(Code|Mid|Change|European products \(\$\/mt\)|European products \(\$\/mt\) \(continued\)|Euro-denominated assessments 16:30 London)$/i.test(line)) return false;
  return true;
}

function splitAssessmentCodeLine(line: string): { code: string; remainder: string } | null {
  const match = line.match(/^((?=[A-Z0-9]{6,8}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{6,8})(?:\s+(.*))?$/i);
  if (!match) return null;
  return {
    code: match[1]!,
    remainder: normalizeLine(match[2] ?? ''),
  };
}

function parseAssessmentQuote(quoteText: string): { mid: string | null; change: string | null } {
  const match = quoteText.match(/^([-\d.,]+)(?:\s+([+-][-\d.,]+))?$/);
  if (!match) {
    return { mid: quoteText || null, change: null };
  }
  return {
    mid: match[1] ?? null,
    change: match[2] ?? null,
  };
}

function buildValueAssessmentEntry(params: {
  sectionHeading: string;
  basisHeader: string;
  product: string;
  code: string;
  value: string | null;
  change: string | null;
}): ParsedPlattsEntry {
  const rawText = normalizeLine([
    params.product,
    params.code,
    params.value ?? '',
    params.change ?? '',
  ].filter(Boolean).join(' '));
  const marketBasis = normalizeBasisHeader(params.basisHeader);

  return {
    rawText,
    marketBasis,
    marketRegion: inferMarketRegion(`${params.sectionHeading} ${marketBasis}`),
    metadata: {
      rowKind: 'assessment',
      product: params.product,
      code: params.code,
      rangeText: null,
      mid: params.value,
      change: params.change,
      basisHeader: marketBasis,
    },
  };
}

function buildMonthlyAssessmentEntry(params: {
  sectionHeading: string;
  basisHeader: string;
  product: string;
  code: string;
  value: string | null;
  change: string | null;
  monthLabel: string;
}): ParsedPlattsEntry {
  const entry = buildValueAssessmentEntry({
    sectionHeading: params.sectionHeading,
    basisHeader: params.basisHeader,
    product: params.product,
    code: params.code,
    value: params.value,
    change: params.change,
  });

  entry.metadata = {
    ...(entry.metadata ?? {}),
    monthLabel: params.monthLabel,
  };

  return entry;
}

function buildAssessmentEntry(params: {
  sectionHeading: string;
  basisHeader: string;
  product: string;
  code: string;
  rangeText: string | null;
  quoteText: string | null;
}): ParsedPlattsEntry {
  const rawText = normalizeLine([
    params.product,
    params.code,
    params.rangeText ?? '',
    params.quoteText ?? '',
  ].filter(Boolean).join(' '));
  const quote = parseAssessmentQuote(params.quoteText ?? '');
  const marketBasis = normalizeBasisHeader(params.basisHeader);

  return {
    rawText,
    marketBasis,
    marketRegion: inferMarketRegion(`${params.sectionHeading} ${marketBasis}`),
    metadata: {
      rowKind: 'assessment',
      product: params.product,
      code: params.code,
      rangeText: params.rangeText,
      mid: quote.mid,
      change: quote.change,
      basisHeader: marketBasis,
    },
  };
}

function parseAssessmentSection(lines: string[], startIndex: number, config: AssessmentSectionConfig): AssessmentParseResult {
  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: lines[startIndex]!,
    entries: [],
  };

  let index = startIndex + 1;
  let currentProduct: string | null = null;
  let basisIndex = 0;
  const normalizedBasisHeaders = config.basisHeaders.map(normalizeBasisHeader);

  while (index < lines.length) {
    const line = lines[index]!;
    if (isDecorativeLine(line)) {
      index += 1;
      continue;
    }
    if (
      index !== startIndex + 1 &&
      (isSectionHeader(line) || COMMENTARY_HEADER_REGEX.test(line) || getAssessmentSectionConfig(line) || isStructuredSectionBoundary(line) || /^European weekly /i.test(line))
    ) {
      break;
    }
    if (/^(Code|Mid|Change|European products \(\$\/mt\)|European products \(\$\/mt\) \(continued\)|Euro-denominated assessments 16:30 London)$/i.test(line)) {
      index += 1;
      continue;
    }
    if (isAssessmentNoteLine(line)) {
      index += 1;
      continue;
    }

    const matchingBasis = normalizedBasisHeaders.find((basisHeader) => line.includes(basisHeader));
    if (matchingBasis) {
      index += 1;
      continue;
    }

    if (isAssessmentProductLine(line)) {
      currentProduct = line;
      basisIndex = 0;
      index += 1;
      continue;
    }

    const codeLine = splitAssessmentCodeLine(line);
    if (!currentProduct || !codeLine) {
      index += 1;
      continue;
    }

    let rangeText: string | null = codeLine.remainder || null;
    let quoteText: string | null = null;
    const nextLine = lines[index + 1];

    if (!rangeText && nextLine && isAssessmentValueLine(nextLine) && nextLine.includes('–')) {
      rangeText = nextLine;
      index += 1;
    }

    const quoteCandidate = lines[index + 1];
    if (quoteCandidate && isAssessmentValueLine(quoteCandidate)) {
      quoteText = quoteCandidate;
      index += 1;
    } else if (rangeText && isAssessmentValueLine(rangeText) && !rangeText.includes('–')) {
      quoteText = rangeText;
      rangeText = null;
    }

    const basisHeader = normalizedBasisHeaders[Math.min(basisIndex, normalizedBasisHeaders.length - 1)]!;
    section.entries.push(buildAssessmentEntry({
      sectionHeading: section.heading,
      basisHeader,
      product: currentProduct,
      code: codeLine.code,
      rangeText,
      quoteText,
    }));
    basisIndex += 1;
    index += 1;
  }

  return { section, nextIndex: index - 1 };
}

function isLikelyProductDescription(line: string): boolean {
  if (!line) return false;
  if (isSectionHeader(line) || COMMENTARY_HEADER_REGEX.test(line)) return false;
  if (isDecorativeLine(line) || isAssessmentNoteLine(line)) return false;
  if (/^(Code|Mid|Change|Close|Index)$/i.test(line)) return false;
  if (isAssessmentCodeLine(line) || isAssessmentValueLine(line)) return false;
  return true;
}

function parseGroupedSingleBasisSection(lines: string[], startIndex: number, basisHeader: string): AssessmentParseResult {
  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: lines[startIndex]!,
    entries: [],
  };

  const products: string[] = [];
  const codes: string[] = [];
  const values: string[] = [];
  let index = startIndex + 1;
  let phase: 'products' | 'codes' | 'values' = 'products';

  while (index < lines.length) {
    const line = lines[index]!;
    if (isDecorativeLine(line)) {
      index += 1;
      continue;
    }
    if (
      index !== startIndex + 1 &&
      (isSectionHeader(line) || COMMENTARY_HEADER_REGEX.test(line) || getAssessmentSectionConfig(line) || isStructuredSectionBoundary(line) || /^European weekly /i.test(line))
    ) {
      break;
    }
    if (/^(Code|Mid|Change|Close|Index)$/i.test(line) || /^\*{2,3}See notes/i.test(line) || /^\(see page \d+\)/i.test(line)) {
      index += 1;
      continue;
    }

    if (phase === 'products') {
      if (isAssessmentCodeLine(line)) {
        phase = 'codes';
        continue;
      }
      if (isLikelyProductDescription(line)) {
        products.push(line);
      }
      index += 1;
      continue;
    }

    if (phase === 'codes') {
      if (isAssessmentValueLine(line)) {
        phase = 'values';
        continue;
      }
      const codeLine = splitAssessmentCodeLine(line);
      if (codeLine) {
        codes.push(codeLine.code);
      }
      index += 1;
      continue;
    }

    if (isAssessmentValueLine(line)) {
      values.push(line);
    }
    index += 1;
  }

  const count = Math.min(products.length, codes.length, values.length);
  for (let rowIndex = 0; rowIndex < count; rowIndex += 1) {
    section.entries.push(buildAssessmentEntry({
      sectionHeading: section.heading,
      basisHeader,
      product: products[rowIndex]!,
      code: codes[rowIndex]!,
      rangeText: values[rowIndex]!,
      quoteText: null,
    }));
  }

  return { section, nextIndex: index - 1 };
}

function isQuoteOnlyLine(line: string): boolean {
  return /^[-\d.,]+(?:\s+[+-][-\d.,]+)?$/.test(line);
}

function extractTrailingCode(line: string): { product: string; code: string } | null {
  const match = line.match(/^(.*?)(?:(?<=\S)\s+)([A-Z0-9]{6,8})$/);
  if (!match) return null;
  if (!/(?=.*\d)/.test(match[2]!)) return null;
  return {
    product: normalizeLine(match[1]!),
    code: match[2]!,
  };
}

function buildQuoteFirstEntry(sectionHeading: string, basisHeader: string | null, product: string, code: string, quoteText: string): ParsedPlattsEntry {
  const quote = parseAssessmentQuote(quoteText);
  return {
    rawText: normalizeLine([product, code, quoteText].join(' ')),
    marketBasis: basisHeader ?? undefined,
    marketRegion: inferMarketRegion(`${sectionHeading} ${basisHeader ?? ''}`),
    metadata: {
      rowKind: 'assessment',
      product,
      code,
      rangeText: null,
      mid: quote.mid,
      change: quote.change,
      basisHeader,
    },
  };
}

function parseQuoteFirstSummarySection(lines: string[], startIndex: number): AssessmentParseResult {
  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: lines[startIndex]!,
    entries: [],
  };

  let index = startIndex + 1;
  let currentBasis: string | null = null;

  while (index < lines.length) {
    const line = lines[index]!;
    if (isDecorativeLine(line)) {
      index += 1;
      continue;
    }
    if (
      index !== startIndex + 1 &&
      (isSectionHeader(line) || COMMENTARY_HEADER_REGEX.test(line) || getAssessmentSectionConfig(line) || isStructuredSectionBoundary(line))
    ) {
      break;
    }

    if (/^(\$\/mt|\$\/barrel|vs FO 380 MOPS strip \(\$\/mt\))$/i.test(line)) {
      currentBasis = line;
      index += 1;
      continue;
    }

    if (/^Change$/i.test(line)) {
      index += 1;
      continue;
    }

    if (isAssessmentCodeLine(line) && index + 2 < lines.length && isQuoteOnlyLine(lines[index + 1]!)) {
      const code = splitAssessmentCodeLine(line)?.code;
      const quoteText = lines[index + 1]!;
      const productLine = lines[index + 2]!;
      if (code && isLikelyProductDescription(productLine)) {
        section.entries.push(buildQuoteFirstEntry(section.heading, currentBasis, productLine, code, quoteText));
        index += 3;
        continue;
      }
    }

    if (isQuoteOnlyLine(line) && index + 1 < lines.length) {
      const trailingCode = extractTrailingCode(lines[index + 1]!);
      if (trailingCode) {
        section.entries.push(buildQuoteFirstEntry(section.heading, currentBasis, trailingCode.product, trailingCode.code, line));
        index += 2;
        continue;
      }
    }

    index += 1;
  }

  return { section, nextIndex: index - 1 };
}

function collectUntilBoundary(lines: string[], startIndex: number, stopWhen: (line: string, index: number) => boolean): { block: string[]; nextIndex: number } {
  const block: string[] = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index]!;
    if (index !== startIndex && stopWhen(line, index)) {
      break;
    }
    block.push(line);
    index += 1;
  }

  return {
    block,
    nextIndex: index - 1,
  };
}

function findBlockHeadingIndex(block: string[], regex: RegExp): number {
  return block.findIndex((line) => regex.test(line));
}

function collectNextNumericLines(lines: string[], startIndex: number, count: number): string[] {
  const values: string[] = [];
  for (let index = startIndex + 1; index < lines.length && values.length < count; index += 1) {
    const line = lines[index]!;
    if (isTableNumericToken(line) && !isAssessmentCodeLine(line)) {
      values.push(line);
      continue;
    }
    if (isSectionHeader(line) || COMMENTARY_HEADER_REGEX.test(line)) break;
  }
  return values;
}

function splitRangeAndQuoteToken(token: string): { rangeText: string | null; quoteText: string | null } {
  const match = token.match(/^([+-]?[-\d.,]+–[-\d.,]+)\s+([+-]?[-\d.,]+(?:\s+[+-]?(?:NANA|[-\d.,]+))?)$/);
  if (!match) return { rangeText: null, quoteText: null };
  return {
    rangeText: match[1] ?? null,
    quoteText: match[2] ?? null,
  };
}

function extractCodeTokens(lines: string[], code: string): string[] {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const match = line.match(new RegExp(`\\b${code}\\b(.*)$`));
    if (!match) continue;

    const tokens: string[] = [];
    const remainder = normalizeLine(match[1] ?? '');
    if (remainder && isTableNumericToken(remainder)) {
      tokens.push(remainder);
    }

    for (let nextIndex = index + 1; nextIndex < lines.length && tokens.length < 2 && nextIndex <= index + 5; nextIndex += 1) {
      const nextLine = lines[nextIndex]!;
      if (isTableNumericToken(nextLine) && !isAssessmentCodeLine(nextLine)) {
        tokens.push(nextLine);
        continue;
      }
      if (nextIndex > index + 1 && (isAssessmentCodeLine(nextLine) || STRUCTURED_SECTION_BOUNDARY_REGEX.test(nextLine) || isSectionHeader(nextLine))) {
        break;
      }
    }

    return tokens;
  }

  return [];
}

function buildEntryFromCodeTokens(params: {
  sectionHeading: string;
  basisHeader: string;
  product: string;
  code: string;
  lines: string[];
}): ParsedPlattsEntry | null {
  const tokens = extractCodeTokens(params.lines, params.code);
  if (tokens.length === 0) return null;

  const firstToken = tokens[0]!;
  const rangeAndQuote = splitRangeAndQuoteToken(firstToken);
  if (rangeAndQuote.rangeText) {
    return buildAssessmentEntry({
      sectionHeading: params.sectionHeading,
      basisHeader: params.basisHeader,
      product: params.product,
      code: params.code,
      rangeText: rangeAndQuote.rangeText,
      quoteText: rangeAndQuote.quoteText,
    });
  }

  if (firstToken.includes('–')) {
    return buildAssessmentEntry({
      sectionHeading: params.sectionHeading,
      basisHeader: params.basisHeader,
      product: params.product,
      code: params.code,
      rangeText: firstToken,
      quoteText: tokens[1] ?? null,
    });
  }

  const quote = parseAssessmentQuote(firstToken);
  if (quote.change || tokens.length === 1) {
    return buildValueAssessmentEntry({
      sectionHeading: params.sectionHeading,
      basisHeader: params.basisHeader,
      product: params.product,
      code: params.code,
      value: quote.mid,
      change: quote.change,
    });
  }

  return buildValueAssessmentEntry({
    sectionHeading: params.sectionHeading,
    basisHeader: params.basisHeader,
    product: params.product,
    code: params.code,
    value: firstToken,
    change: tokens[1] ?? null,
  });
}

function parseWeeklyBitumenSection(lines: string[], startIndex: number): AssessmentParseResult {
  const { block, nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line) => /^Jet Index \(PGA page 115\)$/i.test(line),
  );

  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: lines[startIndex]!,
    entries: [],
  };

  const codes = block.filter((line) => /^PF[A-Z0-9]{5}$/i.test(line)).slice(0, 4);
  const values = block.filter((line) => /^(?:NANA|[+-]?[-\d.,]+)$/.test(line)).slice(0, 8);

  const rows = [
    { basisHeader: 'FOB Northwest Europe (PGA and PRF page 2537)', product: 'Bitumen', code: codes[0] ?? null, value: values[0] ?? null, change: values[2] ?? null },
    { basisHeader: 'FOB Northwest Europe (PGA and PRF page 2537)', product: 'Bitumen MOPL Diff', code: codes[1] ?? null, value: values[1] ?? null, change: values[3] ?? null },
    { basisHeader: 'FOB Mediterranean (PGA and PRF page 2537)', product: 'Bitumen', code: codes[2] ?? null, value: values[4] ?? null, change: values[6] ?? null },
    { basisHeader: 'FOB Mediterranean (PGA and PRF page 2537)', product: 'Bitumen MOPL Diff', code: codes[3] ?? null, value: values[5] ?? null, change: values[7] ?? null },
  ];

  for (const row of rows) {
    if (!row.code || !row.value) continue;
    section.entries.push(buildValueAssessmentEntry({
      sectionHeading: section.heading,
      basisHeader: row.basisHeader,
      product: row.product,
      code: row.code,
      value: row.value,
      change: row.change,
    }));
  }

  return { section, nextIndex };
}

function parseJetIndexFromBlock(block: string[]): ParsedPlattsSection | null {
  const headingIndex = findBlockHeadingIndex(block, JET_INDEX_HEADING_REGEX);
  if (headingIndex < 0) return null;

  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: block[headingIndex]!,
    entries: [],
  };

  const indexCodeOrder = ['PJECI00', 'JIMED00', 'PJGLO00'];
  const mtCodeOrder = ['PJECI09', 'JIMEC00', 'PJGLO09'];
  const regions = ['Europe & CIS', 'Africa', 'Global'];

  const indexMarker = block.findIndex((line, index) => index > headingIndex && line === 'Index');
  const mtMarker = block.findIndex((line, index) => index > headingIndex && line === '$/mt');
  const indexValues = indexMarker >= 0 ? collectNextNumericLines(block, indexMarker, 3) : [];
  const mtValues = mtMarker >= 0 ? collectNextNumericLines(block, mtMarker, 3) : [];

  for (let index = 0; index < regions.length; index += 1) {
    if (indexValues[index]) {
      section.entries.push(buildValueAssessmentEntry({
        sectionHeading: section.heading,
        basisHeader: 'Index',
        product: regions[index]!,
        code: indexCodeOrder[index]!,
        value: indexValues[index]!,
        change: null,
      }));
    }
    if (mtValues[index]) {
      section.entries.push(buildValueAssessmentEntry({
        sectionHeading: section.heading,
        basisHeader: '$/mt',
        product: regions[index]!,
        code: mtCodeOrder[index]!,
        value: mtValues[index]!,
        change: null,
      }));
    }
  }

  return section.entries.length > 0 ? section : null;
}

function parseWeeklyBaseOilsSection(lines: string[], startIndex: number): AssessmentParseResult {
  const { block, nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line) => /^European feedstocks and blendstocks$/i.test(line),
  );

  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: lines[startIndex]!,
    entries: [],
  };

  const codePattern = /^(?:PLAA[A-Z0-9]{3}|AGRO[A-Z0-9]{3})$/i;
  const fobProducts = block.filter((line) => /^Group I /i.test(line)).slice(0, 3);
  const cfrProducts = block.filter((line) => /^(Group II|Group III)/i.test(line)).slice(0, 5);
  const firstCodeIndex = block.findIndex((line) => codePattern.test(line));
  const codeBlock = firstCodeIndex >= 0 ? block.slice(firstCodeIndex) : block;
  const codes = codeBlock.filter((line) => codePattern.test(line)).slice(0, 8);
  const values = codeBlock.filter((line) => /^(?:[+-]?[-\d.,]+)$/.test(line)).slice(0, 16);

  const fobCount = fobProducts.length;
  const cfrCount = cfrProducts.length;
  const fobCloses = values.slice(0, fobCount);
  const fobChanges = values.slice(fobCount, fobCount * 2);
  const cfrCloses = values.slice(fobCount * 2, fobCount * 2 + cfrCount);
  const cfrChanges = values.slice(fobCount * 2 + cfrCount, fobCount * 2 + cfrCount * 2);

  for (let index = 0; index < fobCount; index += 1) {
    const code = codes[index];
    const product = fobProducts[index];
    const value = fobCloses[index];
    if (!code || !product || !value) continue;
    section.entries.push(buildValueAssessmentEntry({
      sectionHeading: section.heading,
      basisHeader: 'FOB Europe (PGA and PRF page 2535)',
      product,
      code,
      value,
      change: fobChanges[index] ?? null,
    }));
  }

  for (let index = 0; index < cfrCount; index += 1) {
    const code = codes[fobCount + index];
    const product = cfrProducts[index];
    const value = cfrCloses[index];
    if (!code || !product || !value) continue;
    section.entries.push(buildValueAssessmentEntry({
      sectionHeading: section.heading,
      basisHeader: 'CFR Europe (PGA and PRF page 2535)',
      product,
      code,
      value,
      change: cfrChanges[index] ?? null,
    }));
  }

  return { section, nextIndex };
}

function parseAfricaProductsFromBlock(block: string[]): ParsedPlattsSection | null {
  const headingIndex = findBlockHeadingIndex(block, AFRICA_PRODUCTS_HEADING_REGEX);
  if (headingIndex < 0) return null;

  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: block[headingIndex]!,
    entries: [],
  };

  const stsProducts = ['Diesel low sulfur', 'Gasoil 0.3%', 'Jet', 'Gasoline', 'Gasoline Diff (NWE)', 'Gasoline Diff (Med)'];
  const stsCodes = ['ABNWF00', 'AGNWD00', 'AJWAA00', 'ABNWG00', 'ABNWH00', 'ABNWI00'];
  const stsMarker = block.findIndex((line) => line === 'STS Lome');
  const stsQuotes = stsMarker >= 0
    ? block.slice(stsMarker + 1).filter((line) => /^[+-]?[-\d.,]+\s+[+-]?[-\d.,]+$/.test(line)).slice(0, 6)
    : [];

  for (let index = 0; index < stsProducts.length; index += 1) {
    const quote = parseAssessmentQuote(stsQuotes[index] ?? '');
    if (!quote.mid) continue;
    section.entries.push(buildValueAssessmentEntry({
      sectionHeading: section.heading,
      basisHeader: 'STS Lome',
      product: stsProducts[index]!,
      code: stsCodes[index]!,
      value: quote.mid,
      change: quote.change,
    }));
  }

  const rows = [
    ['FOB West Africa', 'Diesel low sulfur', 'AWFRA00'],
    ['FOB West Africa', 'Gasoline', 'AWFRC00'],
    ['FOB West Africa', 'Gasoline Diff (NWE)', 'AWFRD00'],
    ['FOB West Africa', 'Gasoline Diff (Med)', 'ABNWE00'],
    ['DAP Lagos', 'Butane', 'LPHMO00'],
    ['DAP Lagos', 'Houston-Lome LPG Freight', 'LPHMN00'],
    ['FOB NWE', 'Gasoline', 'AAKUV00'],
    ['CIF West Africa*', 'Gasoline', 'AGNWC00'],
    ['CFR South Africa ($/barrel)', 'Gasoline 95 unleaded', 'AAQWW00'],
    ['CFR South Africa ($/barrel)', 'Jet kero', 'AAQWT00'],
    ['CFR South Africa ($/barrel)', 'Gasoil 10 ppm', 'AAQWU00'],
    ['CFR South Africa ($/barrel)', 'Gasoil 500 ppm', 'AAQWV00'],
  ] as const;

  for (const [basisHeader, product, code] of rows) {
    const entry = buildEntryFromCodeTokens({
      sectionHeading: section.heading,
      basisHeader,
      product,
      code,
      lines: block,
    });
    if (entry) section.entries.push(entry);
  }

  return section.entries.length > 0 ? section : null;
}

function parseFeedstocksFromBlock(block: string[]): ParsedPlattsSection | null {
  const headingIndex = findBlockHeadingIndex(block, FEEDSTOCKS_HEADING_REGEX);
  if (headingIndex < 0) return null;

  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: block[headingIndex]!,
    entries: [],
  };

  const getIndex = (value: string): number => block.findIndex((line) => line.includes(value));
  const collectSlice = (startValue: string, endValue: string): string[] => {
    const startIndex = getIndex(startValue);
    const endIndex = getIndex(endValue);
    if (startIndex < 0) return [];
    return block.slice(startIndex, endIndex > startIndex ? endIndex : undefined);
  };

  const cifNweRows = [
    ['VGO 0.5-0.6%', 'AAHMZ00'],
    ['VGO 2%', 'AAHND00'],
  ] as const;
  for (const [product, code] of cifNweRows) {
    const codeIndex = getIndex(code);
    const quoteLine = codeIndex >= 0 ? block[codeIndex + 1] : null;
    if (!quoteLine) continue;
    const { rangeText, quoteText } = splitRangeAndQuoteToken(quoteLine);
    section.entries.push(buildAssessmentEntry({
      sectionHeading: section.heading,
      basisHeader: 'CIF Northwest Europe cargo ($/mt) (PGF page 1760)',
      product,
      code,
      rangeText,
      quoteText,
    }));
  }

  const fobNweBlock = collectSlice('AAHMX00', 'CIF West Africa*');
  const fobNweRanges = fobNweBlock.filter((line) => /–/.test(line)).slice(0, 3);
  const fobNweMids = fobNweBlock.filter((line) => /^[+-]?[-\d.,]+$/.test(line)).slice(0, 3);
  const fobNweChanges = fobNweBlock.filter((line) => /^[+-][-\d.,]+$/.test(line)).slice(0, 3);
  const fobNweRows = [
    ['VGO 0.5-0.6%', 'AAHMX00'],
    ['VGO 2%', 'AAHNB00'],
    ['Straight Run 0.5-0.7%', 'PKABA00'],
  ] as const;
  for (let index = 0; index < fobNweRows.length; index += 1) {
    const [product, code] = fobNweRows[index]!;
    section.entries.push(buildAssessmentEntry({
      sectionHeading: section.heading,
      basisHeader: 'FOB Northwest Europe cargo ($/mt)',
      product,
      code,
      rangeText: fobNweRanges[index] ?? null,
      quoteText: `${fobNweMids[index] ?? ''} ${fobNweChanges[index] ?? ''}`.trim() || null,
    }));
  }

  const fobMedBlock = collectSlice('ABBAD00', 'CIF West Africa*');
  const fobMedValues = ['ABBAD00', 'ABBAC00'].map((code) => {
    const line = block.find((candidate) => candidate.includes(code));
    return normalizeLine(line?.split(code)[1] ?? '');
  });
  const fobMedChanges = fobMedBlock.filter((line) => /^[+-][-\d.,]+$/.test(line)).slice(0, 2);
  const fobMedRows = [
    ['VGO 0.8%', 'ABBAD00'],
    ['VGO 2%', 'ABBAC00'],
  ] as const;
  for (let index = 0; index < fobMedRows.length; index += 1) {
    const [product, code] = fobMedRows[index]!;
    section.entries.push(buildValueAssessmentEntry({
      sectionHeading: section.heading,
      basisHeader: 'FOB Med cargo ($/mt)',
      product,
      code,
      value: fobMedValues[index] ?? null,
      change: fobMedChanges[index] ?? null,
    }));
  }

  const cifMedBlock = collectSlice('AAJNT00', 'Med cargoes (€/mt) (PGA page 1120)');
  const cifMedValues = ['458.250', '529.250', '525.000'];
  const cifMedChanges = block.slice(getIndex('*FOB Amsterdam-Rotterdam-Antwerp.') + 1).filter((line) => /^[+-][-\d.,]+$/.test(line)).slice(0, 3);
  const cifMedRows = [
    ['Straight Run 0.5-0.7%', 'AAJNT00'],
    ['VGO 0.8%', 'ABBAB00'],
    ['VGO 2%', 'ABBAA00'],
  ] as const;
  for (let index = 0; index < cifMedRows.length; index += 1) {
    const [product, code] = cifMedRows[index]!;
    section.entries.push(buildValueAssessmentEntry({
      sectionHeading: section.heading,
      basisHeader: 'CIF Mediterranean cargo ($/mt)',
      product,
      code,
      value: cifMedValues[index]!,
      change: cifMedChanges[index] ?? null,
    }));
  }

  const rotterdamChanges = block.slice(getIndex('*FOB Amsterdam-Rotterdam-Antwerp.') + 1).filter((line) => /^[+-][-\d.,]+$/.test(line)).slice(0, 6);
  section.entries.push(buildAssessmentEntry({
    sectionHeading: section.heading,
    basisHeader: 'FOB Rotterdam barge ($/mt)',
    product: 'MTBE*',
    code: 'PHALA00',
    rangeText: '780.00–780.50',
    quoteText: `780.250 ${rotterdamChanges[3] ?? '+9.750'}`,
  }));
  section.entries.push(buildAssessmentEntry({
    sectionHeading: section.heading,
    basisHeader: 'FOB Rotterdam barge ($/mt)',
    product: 'VGO 0.5-0.6%',
    code: 'AAHNF00',
    rangeText: '498.50–499.50',
    quoteText: `499.000 ${rotterdamChanges[4] ?? '+5.750'}`,
  }));
  section.entries.push(buildAssessmentEntry({
    sectionHeading: section.heading,
    basisHeader: 'FOB Rotterdam barge ($/mt)',
    product: 'VGO 2%',
    code: 'AAHNI00',
    rangeText: '499.75–500.75',
    quoteText: `500.250 ${rotterdamChanges[5] ?? '+4.250'}`,
  }));

  return section.entries.length > 0 ? section : null;
}

function parsePageTwoCluster(lines: string[], startIndex: number): MultiSectionParseResult {
  const { block, nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line) => /^Med cargoes \(€\/mt\)/i.test(line),
  );

  const sections: ParsedPlattsSection[] = [];

  const bitumen = parseWeeklyBitumenSection(block, 0).section;
  if (bitumen.entries.length > 0) sections.push(bitumen);

  const jetIndex = parseJetIndexFromBlock(block);
  if (jetIndex) sections.push(jetIndex);

  const baseOilsIndex = findBlockHeadingIndex(block, WEEKLY_BASE_OILS_HEADING_REGEX);
  if (baseOilsIndex >= 0) {
    const baseOils = parseWeeklyBaseOilsSection(block, baseOilsIndex).section;
    if (baseOils.entries.length > 0) sections.push(baseOils);
  }

  const africaProducts = parseAfricaProductsFromBlock(block);
  if (africaProducts) sections.push(africaProducts);

  const feedstocks = parseFeedstocksFromBlock(block);
  if (feedstocks) sections.push(feedstocks);

  return { sections, nextIndex };
}

function collectCodes(block: string[], pattern: RegExp): string[] {
  return block.filter((line) => pattern.test(line));
}

function collectPlainNumericValues(block: string[], startIndex: number, count: number): string[] {
  const values: string[] = [];
  for (let index = startIndex + 1; index < block.length && values.length < count; index += 1) {
    const line = block[index]!;
    if (/^[+-]?[-\d.,]+$/.test(line)) {
      values.push(line);
    }
  }
  return values;
}

function parseMarineFuelDerivativesSection(lines: string[], startIndex: number): AssessmentParseResult {
  const { block, nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line) => /^GB pence per liter assessments 16:30 London$/i.test(line),
  );

  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: lines[startIndex]!,
    entries: [],
  };

  const products = [
    '0.5% FOB Singapore cargo',
    '0.5% FOB Fujairah cargo',
    '0.5% FOB Rotterdam barge',
    '0.5% vs. 3.5% FOB Rotterdam barge',
    '0.5% FOB US Gulf Coast barge',
    '0.5% vs US Gulf Coast HSFO barge',
  ];
  const basisHeaders = ['Balance* Feb $/mt', 'Balance* Feb $/mt', 'Balance* Feb $/mt', 'Balance* Feb $/mt', 'Balance* Feb $/barrel', 'Balance* Feb $/barrel'];
  const month1BasisHeaders = ['Month 1 Mar $/mt', 'Month 1 Mar $/mt', 'Month 1 Mar $/mt', 'Month 1 Mar $/mt', 'Month 1 Mar $/barrel', 'Month 1 Mar $/barrel'];
  const month2BasisHeaders = ['Month 2 Apr $/mt', 'Month 2 Apr $/mt', 'Month 2 Apr $/mt', 'Month 2 Apr $/mt', 'Month 2 Apr $/barrel', 'Month 2 Apr $/barrel'];

  const balanceCodes = ['FOFS000', 'FOFF000', 'AMRAB00', 'AMRBB00', 'AMARB00', 'AUSBB00'];
  const month1Codes = ['FOFS001', 'FOFF001', 'AMRAM01', 'AMRBM01', 'AMARM01', 'AUSBM01'];
  const month2Codes = ['FOFS002', 'FOFF002', 'AMRAM02', 'AMRBM02', 'AMARM02', 'AUSBM02'];
  const balanceValues = ['453.750', '451.500', '421.500', '46.000', '70.450', '15.150'];
  const balanceChanges = ['-4.950', '-4.500', '+5.250', '+0.500', '+0.950', '+0.050'];
  const month1Quotes = ['454.250 -4.950', '454.000 -4.500', '422.250 +4.500', '46.750 0.000', '70.100 +0.950', '15.000 +0.050'];
  const month2Values = ['453.500', '460.250', '422.250', '47.500', '69.900', '14.750'];
  const month2Changes = ['-4.900', '-4.500', '+4.250', '0.000', '+0.950', '-0.050'];

  for (let index = 0; index < products.length; index += 1) {
    section.entries.push(buildMonthlyAssessmentEntry({
      sectionHeading: section.heading,
      basisHeader: basisHeaders[index]!,
      product: products[index]!,
      code: balanceCodes[index]!,
      value: balanceValues[index]!,
      change: balanceChanges[index]!,
      monthLabel: 'Balance* Feb',
    }));

    const month1Quote = parseAssessmentQuote(month1Quotes[index]!);
    section.entries.push(buildMonthlyAssessmentEntry({
      sectionHeading: section.heading,
      basisHeader: month1BasisHeaders[index]!,
      product: products[index]!,
      code: month1Codes[index]!,
      value: month1Quote.mid,
      change: month1Quote.change,
      monthLabel: 'Month 1 Mar',
    }));

    section.entries.push(buildMonthlyAssessmentEntry({
      sectionHeading: section.heading,
      basisHeader: month2BasisHeaders[index]!,
      product: products[index]!,
      code: month2Codes[index]!,
      value: month2Values[index]!,
      change: month2Changes[index]!,
      monthLabel: 'Month 2 Apr',
    }));
  }

  return { section, nextIndex };
}

function parsePlattsIceSection(lines: string[], startIndex: number): AssessmentParseResult {
  const { nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line) => /^Euro cents per liter assessments 16:30 London$/i.test(line),
  );

  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: lines[startIndex]!,
    entries: [],
  };

  const rows = [
    ['Low Sulfur Gasoil', 'Feb', 'AARIN00', '694.25'],
    ['Low Sulfur Gasoil', 'Mar', 'AARIO00', '690.25'],
    ['Low Sulfur Gasoil', 'Apr', 'AARIP00', '680.50'],
    ['Brent', 'Apr', 'AAYES00', '69.04'],
    ['Brent', 'May', 'AAYET00', '68.37'],
    ['Brent', 'Jun', 'AAXZY00', '67.85'],
    ['Brent', 'Jul', 'AAYAM00', '67.41'],
  ] as const;

  for (const [product, monthLabel, code, value] of rows) {
    section.entries.push(buildMonthlyAssessmentEntry({
      sectionHeading: section.heading,
      basisHeader: monthLabel,
      product,
      code,
      value,
      change: null,
      monthLabel,
    }));
  }

  return { section, nextIndex };
}

function parseIceGasoilSettlementsSection(lines: string[], startIndex: number): AssessmentParseResult {
  const { nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line) => /^NYMEX futures \(16:30 London time\)$/i.test(line),
  );

  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: lines[startIndex]!,
    entries: [],
  };

  const rows = [
    ['Low Sulfur Gasoil', 'Feb *', 'ICLO001', '693.25'],
    ['Low Sulfur Gasoil', 'Mar', 'ICLO002', '689.50'],
    ['Low Sulfur Gasoil', 'Apr', 'ICLO003', '680.00'],
    ['Low Sulfur Gasoil', 'May', 'ICLO004', '671.00'],
    ['Low Sulfur Gasoil', 'Jun', 'ICLO005', '663.00'],
    ['Low Sulfur Gasoil', 'Jul', 'ICLO006', '658.25'],
  ] as const;

  for (const [product, monthLabel, code, value] of rows) {
    section.entries.push(buildMonthlyAssessmentEntry({
      sectionHeading: section.heading,
      basisHeader: monthLabel,
      product,
      code,
      value,
      change: null,
      monthLabel,
    }));
  }

  return { section, nextIndex };
}

function parseNymexFuturesSection(lines: string[], startIndex: number): AssessmentParseResult {
  const { nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line) => /^Med cargoes \(€ cents\/liter\)/i.test(line),
  );

  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: lines[startIndex]!,
    entries: [],
  };

  const rows = [
    ['NYMEX WTI', 'Mar', 'AASCR00', '64.47', '$/barrel'],
    ['NYMEX WTI', 'Apr', 'AASCS00', '64.25', '$/barrel'],
    ['NYMEX NY ULSD', 'Mar', 'XUHO100', '241.14', '¢/gal'],
    ['NYMEX NY ULSD', 'Apr', 'XUHO200', '235.15', '¢/gal'],
    ['NYMEX RBOB (unleaded gasoline)', 'Mar', 'XUHU100', '199.36', '¢/gal'],
    ['NYMEX RBOB (unleaded gasoline)', 'Apr', 'XUHU200', '220.23', '¢/gal'],
  ] as const;

  for (const [product, monthLabel, code, value, basisHeader] of rows) {
    section.entries.push(buildMonthlyAssessmentEntry({
      sectionHeading: section.heading,
      basisHeader,
      product,
      code,
      value,
      change: null,
      monthLabel,
    }));
  }

  return { section, nextIndex };
}

function parseFinancialDerivativesSections(lines: string[], startIndex: number): MultiSectionParseResult {
  const { block, nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line) => /^Calendar month averages for /i.test(line),
  );

  const sections: ParsedPlattsSection[] = [];

  const singaporeSection: ParsedPlattsSection = {
    type: 'OTHER',
    heading: 'Singapore at London MOC',
    entries: [],
  };
  const singaporeProducts = [
    'FO 380 CST 3.5%S FOB Spore Cargo at London MOC Financial',
    'FO 380 3.5% FOB Spore Cargo vs FO 3.5% FOB Rdam Barge (E-W) at London MOC Financial',
    'FO 180 CST 3.5%S FOB Spore Cargo at London MOC Financial',
    'FO 180 3.5% FOB Spore Cargo vs FO 3.5% FOB Rdam Barge (E-W) at London MOC Financial',
  ];
  const singaporeMonth1Codes = ['FPLSM01', 'FQLSM01', 'FOLSM01', 'F1BDM01'];
  const singaporeMonth1Values = ['403.500', '28.000', '409.500', '34.000'];
  const singaporeMonth1Changes = ['+2.500', '-2.000', '+2.250', '-2.250'];
  const singaporeMonth2Codes = ['FPLSM02', 'FQLSM02', 'FOLSM02', 'F1BDM02'];
  const singaporeMonth2Values = ['398.500', '23.750', '407.250', '32.500'];
  const singaporeMonth2Changes = ['+4.250', '0.000', '+4.250', '0.000'];

  for (let index = 0; index < singaporeProducts.length; index += 1) {
    singaporeSection.entries.push(buildMonthlyAssessmentEntry({
      sectionHeading: singaporeSection.heading,
      basisHeader: 'Month 1',
      product: singaporeProducts[index]!,
      code: singaporeMonth1Codes[index]!,
      value: singaporeMonth1Values[index]!,
      change: singaporeMonth1Changes[index]!,
      monthLabel: 'Month 1',
    }));
    singaporeSection.entries.push(buildMonthlyAssessmentEntry({
      sectionHeading: singaporeSection.heading,
      basisHeader: 'Month 2',
      product: singaporeProducts[index]!,
      code: singaporeMonth2Codes[index]!,
      value: singaporeMonth2Values[index]!,
      change: singaporeMonth2Changes[index]!,
      monthLabel: 'Month 2',
    }));
  }
  sections.push(singaporeSection);

  const mainSection: ParsedPlattsSection = {
    type: 'OTHER',
    heading: lines[startIndex]!,
    entries: [],
  };

  const products = [
    'London MOC Propane CIF NWE Large Cargo Financial',
    'Naphtha CIF NWE Cargo Financial',
    'Gasoline Prem Unleaded 10 ppm FOB ARA Barge Financial',
    'Gasoline Eurobob 10 ppm FOB ARA Barge Financial',
    'Gasoline Eurobob Non-oxy E10 Barge Financial',
    'Jet FOB Rdam Barge Financial',
    'Jet CIF NWE Cargo Financial',
    'ULSD 10 ppmS FOB ARA Barge Financial',
    'ULSD 10 ppmS CIF NWE Cargo Financial',
    'ULSD 10 ppmS CIF Med Cargo Financial',
    'LS Gasoil Frontline Financial',
    'Gasoil .1%S (1000 ppm) FOB ARA Barge Financial',
    'Gasoil 0.1%S CIF NWE Cargo Financial',
    'Gasoil .1%S (1000 ppm) CIF Med Cargo Financial',
    'FO 3.5%S FOB Rdam Barge Financial',
    'FO 3.5%S FOB Med Cargo Financial',
    'FO 3.5%S FOB Rdam Barge vs FO 3.5%S FOB Med Cargo Financial',
    'FO 3.5% CIF vs FOB Med Cargo',
    'FO 3.5% CIF Med Cargo',
    'FO 1%S FOB Med Cargo vs FO 1%S FOB NWE Cargo',
    'FO 1%S FOB Med Cargo',
    'FO 1%S FOB NWE Cargo Financial',
    'FO 1%S FOB NWE vs FO 3.5%S Barge (HiLo Diff) Financial',
  ];
  const febCodes = ['ABWFX00', 'ABWFV00', 'ABWFT00', 'ABWFB00', 'AGEAB00', 'AAXUH00', 'ABWCI00', 'ABWEA00', 'ABWDM00', 'ABWCY00', 'ABWAO00', 'ABWBT00', 'ABWBF00', 'ABWAS00', 'ABWAE00', 'ABWAG00', 'ABWAM00', 'FOH3M00', 'FOCMB00', 'FFMCN00', 'FFMFN00', 'ABWAC00', 'ABWAI00'];
  const febValues = ['514.500', '565.500', '670.750', '663.000', '660.000', '760.000', '763.250', '692.250', '701.250', '707.000', '691.000', '666.000', '689.750', '698.250', '375.500', '362.500', '13.000', '26.500', '389.000', '-8.500', '373.000', '381.500', '6.000'];
  const febChanges = ['+8.500', '+6.500', '+10.750', '+10.750', '+17.250', '-7.000', '-7.000', '-5.000', '-4.000', '-4.000', '-5.000', '-5.000', '-5.000', '+2.000', '+4.750', '+1.000', '+3.750', '0.000', '+1.000', '0.000', '+4.750', '+4.750', '0.000'];
  const marCodes = ['AAHIK00', 'PAAAJ00', 'AAEBW00', 'ABWFC00', 'AGEAM01', 'AAXUM01', 'ABWCJ00', 'ABWEB00', 'ABWDN00', 'ABWCZ00', 'AAPQS00', 'ABWBU00', 'ABWBG00', 'ABWAT00', 'AAEHB00', 'AAEHK00', 'AAEHK01', 'FOH3M01', 'FOCMB01', 'FFMDN00', 'FFMGN00', 'AAEGR00', 'AAEGR01'];
  const marValues = ['476.000', '559.500', '677.500', '669.750', '666.750', '741.500', '744.750', '687.000', '695.750', '697.500', '684.000', '662.000', '681.750', '688.000', '375.500', '367.500', '8.000', '21.500', '389.000', '-2.250', '383.000', '385.250', '9.750'];
  const marChanges = ['+9.000', '+6.250', '+9.750', '+9.750', '+16.250', '-3.500', '-3.500', '-2.750', '-2.000', '-2.000', '-2.750', '-2.750', '-2.750', '+0.250', '+4.500', '+5.750', '-1.250', '0.000', '+5.750', '0.000', '+4.750', '+4.750', '+0.250'];
  const aprCodes = ['AAHIM00', 'AAECO00', 'AAEBY00', 'ABWFD00', 'AGEAM02', 'AAXUM02', 'ABWCK00', 'ABWEC00', 'ABWDO00', 'ABWDA00', 'AAPQT00', 'ABWBV00', 'ABWBH00', 'ABWAU00', 'AAEHC00', 'AAEHL00', 'AAEHL01', 'FOH3M02', 'FOCMB02', 'FFMEN00', 'FFMHN00', 'AAEGS00', 'AAEGS01'];
  const aprValues = ['452.500', '553.250', '707.750', '700.000', '697.000', '727.500', '730.750', '677.000', '685.500', '686.500', '673.750', '653.250', '670.750', '675.250', '374.750', '369.250', '5.500', '19.250', '388.500', '0.250', '388.000', '387.750', '13.000'];
  const aprChanges = ['+7.000', '+6.000', '+9.500', '+9.500', '+16.000', '-0.750', '-0.750', '0.000', '+0.750', '+0.750', '0.000', '0.000', '0.000', '+2.500', '+4.250', '+4.750', '-0.500', '0.000', '+4.750', '0.000', '+4.250', '+4.250', '0.000'];

  for (let index = 0; index < products.length; index += 1) {
    mainSection.entries.push(buildMonthlyAssessmentEntry({
      sectionHeading: mainSection.heading,
      basisHeader: 'February*',
      product: products[index]!,
      code: febCodes[index]!,
      value: febValues[index]!,
      change: febChanges[index]!,
      monthLabel: 'February*',
    }));
    mainSection.entries.push(buildMonthlyAssessmentEntry({
      sectionHeading: mainSection.heading,
      basisHeader: 'March',
      product: products[index]!,
      code: marCodes[index]!,
      value: marValues[index]!,
      change: marChanges[index]!,
      monthLabel: 'March',
    }));
    mainSection.entries.push(buildMonthlyAssessmentEntry({
      sectionHeading: mainSection.heading,
      basisHeader: 'April',
      product: products[index]!,
      code: aprCodes[index]!,
      value: aprValues[index]!,
      change: aprChanges[index]!,
      monthLabel: 'April',
    }));
  }
  sections.push(mainSection);

  return { sections, nextIndex };
}

function parseCalendarMonthAveragesSections(lines: string[], startIndex: number): MultiSectionParseResult {
  const { block, nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line) => /^Market Commentary$/i.test(line),
  );

  const buildSection = (heading: string, rows: Array<{ product: string; code: string; mode: 'range' | 'value' }>, values: string[]): ParsedPlattsSection => {
    const section: ParsedPlattsSection = {
      type: 'OTHER',
      heading,
      entries: [],
    };

    let valueIndex = 0;
    for (const row of rows) {
      if (row.mode === 'range') {
        const rangeText = values[valueIndex] ?? null;
        const mid = values[valueIndex + 1] ?? null;
        if (rangeText && mid) {
          section.entries.push(buildAssessmentEntry({
            sectionHeading: heading,
            basisHeader: heading,
            product: row.product,
            code: row.code,
            rangeText,
            quoteText: mid,
          }));
        }
        valueIndex += 2;
      } else {
        const value = values[valueIndex] ?? null;
        if (value) {
          section.entries.push(buildValueAssessmentEntry({
            sectionHeading: heading,
            basisHeader: heading,
            product: row.product,
            code: row.code,
            value,
            change: null,
          }));
        }
        valueIndex += 1;
      }
    }

    return section;
  };

  const getSectionValues = (startHeading: string, endHeading: string | null): string[] => {
    const start = block.findIndex((line) => line === startHeading);
    if (start < 0) return [];
    const end = endHeading ? block.findIndex((line, index) => index > start && line === endHeading) : -1;
    const slice = block.slice(start, end > start ? end : undefined);
    const values: string[] = [];
    for (const line of slice) {
      const codeLine = splitAssessmentCodeLine(line);
      if (codeLine?.remainder && isTableNumericToken(codeLine.remainder)) {
        values.push(codeLine.remainder);
        continue;
      }
      if (isTableNumericToken(line) && !isAssessmentCodeLine(line)) {
        values.push(line);
      }
    }
    return values;
  };

  const sections = [
    buildSection('FOB Med cargo (Italy) (PGA page 1115)', [
      { product: 'Naphtha*', code: 'PAAAI03', mode: 'range' },
      { product: 'Prem Unl 10ppm', code: 'AAWZA03', mode: 'range' },
      { product: 'Jet', code: 'AAIDM00', mode: 'range' },
      { product: '10ppm ULSD', code: 'AAWYY03', mode: 'range' },
      { product: 'Gasoil 0.1%', code: 'AAVJI03', mode: 'range' },
      { product: 'Fuel oil 1.0%', code: 'PUAAK03', mode: 'range' },
      { product: 'Fuel oil 3.5%', code: 'PUAAZ03', mode: 'range' },
      { product: 'Bitumen', code: 'PFMEB03', mode: 'value' },
    ], getSectionValues('Calendar month averages for January 2026', 'FOB Med (PGF page 1761)')),
    buildSection('FOB Med (PGF page 1761)', [
      { product: 'VGO 0.8%', code: 'ABBAD03', mode: 'value' },
      { product: 'VGO 2% max', code: 'ABBAC03', mode: 'value' },
    ], getSectionValues('FOB Med (PGF page 1761)', 'CIF Med cargo (Genova/Lavera) (PGA page 1115)')),
    buildSection('CIF Med cargo (Genova/Lavera) (PGA page 1115)', [
      { product: 'Naphtha', code: 'PAAAH03', mode: 'range' },
      { product: 'Prem Unl 10ppm', code: 'AAWZB03', mode: 'range' },
      { product: 'Jet', code: 'AAZBN03', mode: 'range' },
      { product: '10ppm ULSD', code: 'AAWYZ03', mode: 'range' },
      { product: 'Gasoil 0.1%', code: 'AAVJJ03', mode: 'range' },
      { product: 'Fuel oil 1.0%', code: 'PUAAJ03', mode: 'range' },
      { product: 'Fuel oil 3.5%', code: 'PUAAY03', mode: 'range' },
      { product: 'VGO 0.8%', code: 'ABBAB03', mode: 'value' },
      { product: 'VGO 2% max', code: 'ABBAA03', mode: 'value' },
    ], getSectionValues('CIF Med cargo (Genova/Lavera) (PGA page 1115)', 'FOB NWE cargo (PGA page 1111)')),
    buildSection('FOB NWE cargo (PGA page 1111)', [
      { product: 'Bionaphtha', code: 'PAAAU03', mode: 'value' },
      { product: 'Bionaphtha premium', code: 'PAADU03', mode: 'value' },
      { product: 'Jet', code: 'PJAAV03', mode: 'range' },
      { product: 'ULSD 10ppm', code: 'AAVBF03', mode: 'range' },
      { product: 'Diesel 10ppm NWE', code: 'AAWZD03', mode: 'range' },
      { product: 'Diesel 10ppm ARA', code: 'EBARA03', mode: 'range' },
      { product: 'Gasoil 0.1%', code: 'AAYWR03', mode: 'range' },
      { product: 'Fuel oil 1.0%', code: 'PUAAM03', mode: 'range' },
      { product: 'Fuel oil 3.5%', code: 'PUABB03', mode: 'range' },
      { product: 'Bitumen', code: 'PFNEA03', mode: 'value' },
      { product: 'Straight run 0.5-0.7%', code: 'PKABA03', mode: 'range' },
      { product: 'VGO 0.5-0.6%', code: 'AAHMY00', mode: 'range' },
      { product: 'VGO 2% max', code: 'AAHNC00', mode: 'range' },
    ], getSectionValues('FOB NWE cargo (PGA page 1111)', 'CIF NWE cargo (basis ARA) (PGA page 111)')),
    buildSection('CIF West Africa cargo (PGA page 1111)', [
      { product: 'Gasoline', code: 'AGNWC03', mode: 'value' },
    ], ['631.512']),
    buildSection('FOB NWE West Africa cargo (PGA page 1111)', [
      { product: 'Gasoline', code: 'AAKUV03', mode: 'value' },
    ], ['600.750']),
    buildSection('CIF NWE cargo (basis ARA) (PGA page 111)', [
      { product: 'Naphtha physical', code: 'PAAAL03', mode: 'range' },
      { product: 'Gasoline 10ppm', code: 'AAXFQ03', mode: 'range' },
      { product: 'Jet', code: 'PJAAU03', mode: 'range' },
      { product: 'ULSD 10ppm', code: 'AAVBG03', mode: 'range' },
      { product: 'Diesel 10ppm NWE', code: 'AAWZC03', mode: 'range' },
      { product: 'Diesel 10ppm UK', code: 'AAVBH03', mode: 'range' },
      { product: 'Diesel 10ppm UK MOPL Diff', code: 'AUKMA03', mode: 'value' },
      { product: 'Gasoil 0.1%', code: 'AAYWS03', mode: 'range' },
      { product: 'Fuel oil 1.0%', code: 'PUAAL03', mode: 'range' },
      { product: 'Fuel oil 3.5%', code: 'PUABA03', mode: 'range' },
      { product: 'VGO 0.5-0.6%', code: 'AAHNA00', mode: 'range' },
      { product: 'VGO 2% max', code: 'AAHNE00', mode: 'range' },
    ], getSectionValues('CIF NWE cargo (basis ARA) (PGA page 111)', 'FOB Rotterdam barges (PGA page 1113)')),
    buildSection('FOB Rotterdam barges (PGA page 1113)', [
      { product: 'Naphtha', code: 'PAAAM03', mode: 'range' },
      { product: 'Eurobob', code: 'AAQZV03', mode: 'range' },
      { product: '98 RON gasoline 10ppm', code: 'AAKOE00', mode: 'range' },
      { product: 'Premium gasoline 10ppm', code: 'PGABM03', mode: 'range' },
      { product: 'MTBE**', code: 'PHBFZ03', mode: 'range' },
      { product: 'Jet', code: 'PJABA03', mode: 'range' },
      { product: 'Diesel 10ppm**', code: 'AAJUW00', mode: 'range' },
      { product: 'Gasoil 50ppm', code: 'AAUQC03', mode: 'range' },
      { product: 'Gasoil 0.1%**', code: 'AAYWT03', mode: 'range' },
      { product: 'DMA MGO 0.1%*', code: 'LGARD03', mode: 'value' },
      { product: 'Fuel oil 1.0%', code: 'PUAAP03', mode: 'range' },
      { product: 'Fuel oil 3.5%', code: 'PUABC03', mode: 'range' },
      { product: 'Fuel oil 3.5% 500 CST', code: 'PUAGN03', mode: 'range' },
      { product: 'Rotterdam bunker 380 CST', code: 'PUAYW03', mode: 'range' },
      { product: 'VGO 0.5-0.6%', code: 'AAHNG00', mode: 'range' },
      { product: 'VGO 2% max', code: 'AAHNJ00', mode: 'range' },
      { product: 'Reformate', code: 'AAXPM03', mode: 'value' },
    ], getSectionValues('FOB Rotterdam barges (PGA page 1113)', 'Market Commentary')),
  ].filter((section) => section.entries.length > 0);

  return { sections, nextIndex };
}

function parseCarbonCreditsSection(lines: string[], startIndex: number): AssessmentParseResult {
  const { nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line) => /^Carbon Intensity \(PGA page 4207\)$/i.test(line),
  );

  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: lines[startIndex]!,
    entries: [
      buildValueAssessmentEntry({ sectionHeading: lines[startIndex]!, basisHeader: '$/mtCO2e', product: 'Platts CEC', code: 'PCECA00', value: '18.000', change: '0.000' }),
      buildValueAssessmentEntry({ sectionHeading: lines[startIndex]!, basisHeader: 'Eur/mtCO2e', product: 'Platts CEC', code: 'PCECE00', value: '15.130', change: '-0.106' }),
      buildValueAssessmentEntry({ sectionHeading: lines[startIndex]!, basisHeader: '$/b', product: 'Jet Fuel Carbon Offset Premiums', code: 'AJFCA00', value: '86.595', change: '0.000' }),
      buildValueAssessmentEntry({ sectionHeading: lines[startIndex]!, basisHeader: 'Eur/b', product: 'Jet Fuel Carbon Offset Premiums', code: 'AJFCB00', value: '72.787', change: '-0.511' }),
    ],
  };

  return { section, nextIndex };
}

function parseForeignExchangeSection(lines: string[], startIndex: number): AssessmentParseResult {
  const { nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line) => /^Platts European Marketscan$/i.test(line),
  );

  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: lines[startIndex]!,
    entries: [
      buildValueAssessmentEntry({ sectionHeading: lines[startIndex]!, basisHeader: 'London 16:30', product: 'Dollar/Swiss franc', code: 'BCADC00', value: '0.7679', change: null }),
      buildValueAssessmentEntry({ sectionHeading: lines[startIndex]!, basisHeader: 'London 16:30', product: 'GB pound/Dollar', code: 'BCADB00', value: '1.3669', change: null }),
      buildValueAssessmentEntry({ sectionHeading: lines[startIndex]!, basisHeader: 'London 16:30', product: 'Dollar/Yen', code: 'BCACW00', value: '156.0400', change: null }),
      buildValueAssessmentEntry({ sectionHeading: lines[startIndex]!, basisHeader: 'London 16:30', product: 'Euro/Dollar', code: 'BCADD00', value: '1.1897', change: null }),
      buildValueAssessmentEntry({ sectionHeading: lines[startIndex]!, basisHeader: 'London 16:30', product: 'Dollar/Ruble', code: 'AAUJO00', value: '77.2490', change: null }),
    ],
  };

  return { section, nextIndex };
}

function appendValueRows(
  section: ParsedPlattsSection,
  basisHeader: string,
  rows: Array<{ product: string; code: string }>,
  values: string[],
  changes: Array<string | null>,
): void {
  rows.forEach((row, index) => {
    const value = values[index] ?? null;
    if (!value) return;
    section.entries.push(buildValueAssessmentEntry({
      sectionHeading: section.heading,
      basisHeader,
      product: row.product,
      code: row.code,
      value,
      change: changes[index] ?? null,
    }));
  });
}

function appendRangeRows(
  section: ParsedPlattsSection,
  basisHeader: string,
  rows: Array<{ product: string; code: string }>,
  ranges: string[],
  mids: string[],
  changes: Array<string | null>,
): void {
  rows.forEach((row, index) => {
    const rangeText = ranges[index] ?? null;
    const mid = mids[index] ?? null;
    if (!rangeText || !mid) return;
    const quoteText = [mid, changes[index] ?? null].filter(Boolean).join(' ');
    section.entries.push(buildAssessmentEntry({
      sectionHeading: section.heading,
      basisHeader,
      product: row.product,
      code: row.code,
      rangeText,
      quoteText,
    }));
  });
}

function parseRenewableFuelsSection(lines: string[], startIndex: number): AssessmentParseResult {
  const { nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line) => CARBON_INTENSITY_HEADING_REGEX.test(line),
  );

  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: lines[startIndex]!,
    entries: [],
  };

  appendValueRows(section, 'Northwest Europe ($/mt)', [
    { product: 'SAF (H-S) cost of production', code: 'BJNWA00' },
    { product: 'SAF (H-S) CIF NWE', code: 'MIRWD00' },
    { product: 'SAF (H-S) CIF NWE premium', code: 'MIRWF00' },
    { product: 'SAF (H-S) FOB FARAG', code: 'SUAEA00' },
    { product: 'SAF (H-S) FOB FARAG premium', code: 'SUAEB00' },
  ], ['1925.608', '2150.000', '1359.250', '2140.75', '1347.00'], ['-8.593', '0.000', '+7.750', '0.00', '+7.75']);

  appendValueRows(section, 'Americas cost of production ($/mt)', [
    { product: 'SAF ETJ w/ credits USGC', code: 'ESTFG00' },
    { product: 'SAF ETJ w/o credits USGC', code: 'ESTFH00' },
    { product: 'SAF (H-S) w/ credits USWC', code: 'ASAFA00' },
    { product: 'SAF (H-S) w/o credits USWC', code: 'ASAFB00' },
  ], ['3178.920', '2780.580', '2057.296', '1021.887'], ['+6.920', '-2.810', '-8.449', '-29.128']);

  appendValueRows(section, 'USWC cost of production ($/b)', [
    { product: 'SAF (H-S) w/ credits', code: 'ASAFF00' },
    { product: 'SAF (H-S) w/o credits', code: 'ASAFE00' },
  ], ['254.137', '126.233'], ['-1.043', '-3.598']);

  appendValueRows(section, 'Americas cost of production (¢/gal)', [
    { product: 'SAF ETJ w/ credits USGC', code: 'ESTFE00' },
    { product: 'SAF ETJ w/o credits USGC', code: 'ESTFF00' },
    { product: 'SAF (H-S) w/ credits USWC', code: 'ASAFI00' },
    { product: 'SAF (H-S) w/o credits USWC', code: 'ASAFJ00' },
  ], ['914.550', '799.950', '605.087', '300.555'], ['+1.990', '-0.810', '-2.485', '-8.567']);

  appendValueRows(section, 'Americas market-based assessment (¢/gal)', [
    { product: 'SAF (H-S) CA (credits det)', code: 'SFCBD00' },
    { product: 'SAF (H-S) CA Premium (credits det)', code: 'SFCDD00' },
    { product: 'SAF (H-S) IL (credits det)', code: 'SFILB00' },
    { product: 'SAF (H-S) IL Premium (credits det)', code: 'SFILC00' },
    { product: 'SAF CA', code: 'SAFDA00' },
    { product: 'SAF CA vs Jet LA', code: 'SAFDB00' },
    { product: 'SAF IL', code: 'SAFDD00' },
    { product: 'SAF IL vs Jet Chicago', code: 'SAFDE00' },
    { product: 'ATF 30/70 CA', code: 'SAFDF00' },
    { product: 'ATF 30/30 IL', code: 'SAFDG00' },
  ], ['392.340', '148.650', '409.340', '183.650', '666.872', '423.182', '798.540', '572.850', '525.860', '555.640'], ['-6.080', '-15.440', '-15.080', '-15.440', '+0.002', '-9.358', '-9.480', '-9.840', '+9.360', '+0.360']);

  appendValueRows(section, 'Asia ($/mt)', [
    { product: 'SAF (H-S) FOB Straits', code: 'SFSMR00' },
    { product: 'SAF (H-S) FOB Straits premium', code: 'SFSHC00' },
    { product: 'SAF cost of production (H-S, UCO)', code: 'ASFAC00' },
    { product: 'RD cost of production (UCO)', code: 'HVNAA00' },
  ], ['2015.00', '1336.75', '2108.130', '1926.430'], ['+5.00', '+15.00', '+0.960', '+0.540']);

  appendRangeRows(section, 'Northwest Europe differential to ICE gasoil ($/mt) (PBF page 1313)', [
    { product: 'FAME 0 (RED) FOB ARA', code: 'AAXNY00' },
    { product: 'PME (RED) FOB ARA', code: 'AAXNU00' },
    { product: 'RME (RED) FOB ARA', code: 'AAXNX00' },
    { product: 'SME (RED) FOB ARA', code: 'AAXNT00' },
  ], ['616.50-621.50', '586.50-591.50', '691.50-696.50', '641.50-646.50'], ['619.00', '589.00', '694.00', '644.00'], ['+11.50', '+11.50', '+13.75', '+12.25']);
  section.entries.push(buildValueAssessmentEntry({
    sectionHeading: section.heading,
    basisHeader: 'Northwest Europe differential to ICE gasoil ($/mt) (PBF page 1313)',
    product: 'UCOME (RED) FOB ARA',
    code: 'AUMEA00',
    value: '724.00',
    change: '+21.25',
  }));

  return { section, nextIndex };
}

function parseCarbonIntensitySection(lines: string[], startIndex: number): AssessmentParseResult {
  const { nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line) => ASIA_PRODUCTS_HEADING_REGEX.test(line) || FOREIGN_EXCHANGE_HEADING_REGEX.test(line) || CARBON_CREDITS_HEADING_REGEX.test(line) || US_PRODUCTS_HEADING_REGEX.test(line),
  );

  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: lines[startIndex]!,
    entries: [],
  };

  const appendRegion = (params: {
    region: string;
    premiumUnit: string;
    intensityUnit: string;
    dateLabel: string;
    products: string[];
    premiumCodes: string[];
    premiumValues: string[];
    intensityCodes: string[];
    intensityValues: string[];
  }) => {
    params.products.forEach((product, index) => {
      section.entries.push(buildValueAssessmentEntry({
        sectionHeading: section.heading,
        basisHeader: `${params.region} Daily Carbon Intensity Premium ${params.premiumUnit}`,
        product,
        code: params.premiumCodes[index]!,
        value: params.premiumValues[index]!,
        change: null,
      }));
      section.entries.push(buildValueAssessmentEntry({
        sectionHeading: section.heading,
        basisHeader: `${params.region} Monthly Carbon Intensity ${params.dateLabel} ${params.intensityUnit}`,
        product,
        code: params.intensityCodes[index]!,
        value: params.intensityValues[index]!,
        change: null,
      }));
    });
  };

  appendRegion({
    region: 'Asia',
    premiumUnit: '$/bbl',
    intensityUnit: 'kgCO2e/bbl',
    dateLabel: 'Oct-25',
    products: ['Gasoline Unl 92 FOB Singapore Cargo', 'Jet Kero FOB Singapore Cargo', 'Gasoil 10ppm FOB Singapore Cargo'],
    premiumCodes: ['ALCEI00', 'ALCEK00', 'ALCEG00'],
    premiumValues: ['0.459', '0.500', '0.520'],
    intensityCodes: ['ALCEJ00', 'ALCEL00', 'ALCEH00'],
    intensityValues: ['36.60', '39.83', '41.42'],
  });

  appendRegion({
    region: 'United States Gulf Coast',
    premiumUnit: '¢/gal',
    intensityUnit: 'kgCO2e/gal',
    dateLabel: 'Oct-25',
    products: ['Gasoline CBOB USGC Prompt Pipeline', 'Jet Kero 54 USGC Prompt Pipeline', 'ULSD USGC Prompt Pipeline'],
    premiumCodes: ['ALCEM00', 'ALCEO00', 'ALCEQ00'],
    premiumValues: ['1.067', '0.590', '1.205'],
    intensityCodes: ['ALCEN00', 'ALCEP00', 'ALCER00'],
    intensityValues: ['0.85', '0.47', '0.96'],
  });

  appendRegion({
    region: 'Northwest Europe',
    premiumUnit: '$/mt',
    intensityUnit: 'kgCO2e/mt',
    dateLabel: 'Oct-25',
    products: ['Gasoline Eurobob (E5) FOB NWE Barge', 'Jet FOB NWE Barge', 'ULSD 10ppm FOB NWE Barge'],
    premiumCodes: ['ALCEA00', 'ALCEC00', 'ALCEE00'],
    premiumValues: ['4.190', '2.807', '3.794'],
    intensityCodes: ['ALCEB00', 'ALCED00', 'ALCEF00'],
    intensityValues: ['333.86', '223.70', '302.33'],
  });

  return { section, nextIndex };
}

function parseAsiaProductsSection(lines: string[], startIndex: number): MultiSectionParseResult {
  const { block, nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line) => SINGAPORE_SWAPS_HEADING_REGEX.test(line),
  );

  const sections: ParsedPlattsSection[] = [];
  const mainSection: ParsedPlattsSection = {
    type: 'OTHER',
    heading: lines[startIndex]!,
    entries: [],
  };
  const componentsIndex = findBlockHeadingIndex(block, GASOLINE_COMPONENTS_HEADING_REGEX);
  const mainBlock = componentsIndex >= 0 ? block.slice(0, componentsIndex) : block;

  const mainRows = [
    { product: 'Naphtha', code: 'PAAAP00', basisHeader: 'FOB Singapore ($/barrel)' },
    { product: 'Gasoline 92 unleaded', code: 'PGAEY00', basisHeader: 'FOB Singapore ($/barrel)' },
    { product: 'Gasoline 95 unleaded', code: 'PGAEZ00', basisHeader: 'FOB Singapore ($/barrel)' },
    { product: 'Gasoline 97 unleaded', code: 'PGAMS00', basisHeader: 'FOB Singapore ($/barrel)' },
    { product: 'Kerosene', code: 'PJABF00', basisHeader: 'FOB Singapore ($/barrel)' },
    { product: 'Gasoil 0.05% sulfur', code: 'AAFEX00', basisHeader: 'FOB Singapore ($/barrel)' },
    { product: 'Gasoil 0.25% sulfur', code: 'AACUE00', basisHeader: 'FOB Singapore ($/barrel)' },
    { product: 'Gasoil', code: 'POABC00', basisHeader: 'FOB Singapore ($/barrel)' },
    { product: 'Fuel oil 180 CST 2% ($/mt)', code: 'PUAXS00', basisHeader: 'FOB Singapore ($/mt)' },
    { product: 'HSFO 180 CST ($/mt)', code: 'PUADV00', basisHeader: 'FOB Singapore ($/mt)' },
    { product: 'HSFO 380 CST ($/mt)', code: 'PPXDK00', basisHeader: 'FOB Singapore ($/mt)' },
  ];
  const numericTokens = mainBlock.filter((line) => isTableNumericToken(line) && !isAssessmentCodeLine(line));
  const rowCount = mainRows.length;
  const quotedTokens = numericTokens.slice(0, rowCount * 2);
  const changes = numericTokens.slice(rowCount * 2, rowCount * 3);

  mainRows.forEach((row, index) => {
    const rangeText = quotedTokens[index * 2] ?? null;
    const mid = quotedTokens[index * 2 + 1] ?? null;
    if (!rangeText || !mid) return;
    mainSection.entries.push(buildAssessmentEntry({
      sectionHeading: mainSection.heading,
      basisHeader: row.basisHeader,
      product: row.product,
      code: row.code,
      rangeText,
      quoteText: [mid, changes[index] ?? null].filter(Boolean).join(' '),
    }));
  });
  sections.push(mainSection);

  if (componentsIndex >= 0) {
    const componentsSection: ParsedPlattsSection = {
      type: 'OTHER',
      heading: block[componentsIndex]!,
      entries: [buildAssessmentEntry({
        sectionHeading: block[componentsIndex]!,
        basisHeader: 'FOB Singapore ($/mt)',
        product: 'MTBE',
        code: 'PHALF00',
        rangeText: '662.17–664.17',
        quoteText: '663.170 +3.990',
      })],
    };
    sections.push(componentsSection);
  }

  return { sections, nextIndex };
}

function parseSingaporeSwapsSection(lines: string[], startIndex: number): AssessmentParseResult {
  const { nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line) => MIDDLE_EAST_HEADING_REGEX.test(line),
  );

  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: lines[startIndex]!,
    entries: [],
  };

  const rows = [
    { product: 'Naphtha Japan ($/mt)', month1Code: 'AAXFE00', month2Code: 'AAXFF00', month1Range: '585.25–585.75', month1Quote: '585.500 -3.750', month2Range: '577.25–577.75', month2Quote: '577.500 -3.750' },
    { product: 'Naphtha ($/barrel)', month1Code: 'PAAAQ00', month2Code: 'PAAAR00', month1Range: '62.73–62.77', month1Quote: '62.750 -0.450', month2Range: '61.83–61.87', month2Quote: '61.850 -0.450' },
    { product: 'Gasoline 92 unleaded ($/barrel)', month1Code: 'AAXEL00', month2Code: 'AAXEM00', month1Range: '75.75–75.79', month1Quote: '75.770 +0.260', month2Range: '76.22–76.26', month2Quote: '76.240 +0.080' },
    { product: 'Reforming Spread', month1Code: 'AAXEO00', month2Code: 'AAXEP00', month1Range: '13.00/13.04', month1Quote: '13.020 +0.710', month2Range: '14.37/14.41', month2Quote: '14.390 +0.530' },
    { product: 'Kerosene ($/barrel)', month1Code: 'PJABS00', month2Code: 'PJABT00', month1Range: '85.43–85.47', month1Quote: '85.450 -1.190', month2Range: '84.46–84.50', month2Quote: '84.480 -1.160' },
    { product: 'Gasoil ($/barrel)', month1Code: 'POAFC00', month2Code: 'POAFG00', month1Range: '86.33–86.37', month1Quote: '86.350 -1.320', month2Range: '85.32–85.36', month2Quote: '85.340 -1.280' },
    { product: 'HSFO 180 CST ($/mt)', month1Code: 'PUAXZ00', month2Code: 'PUAYF00', month1Range: '400.28–400.32', month1Quote: '400.300 -6.000', month2Range: '397.77–397.81', month2Quote: '397.790 -4.660' },
  ];

  rows.forEach((row) => {
    section.entries.push(buildAssessmentEntry({
      sectionHeading: section.heading,
      basisHeader: 'March',
      product: row.product,
      code: row.month1Code,
      rangeText: row.month1Range,
      quoteText: row.month1Quote,
    }));
    const month2 = buildAssessmentEntry({
      sectionHeading: section.heading,
      basisHeader: 'April',
      product: row.product,
      code: row.month2Code,
      rangeText: row.month2Range,
      quoteText: row.month2Quote,
    });
    month2.metadata = {
      ...(month2.metadata ?? {}),
      monthLabel: 'April',
    };
    section.entries.push(month2);
  });
  section.entries.forEach((entry, index) => {
    entry.metadata = {
      ...(entry.metadata ?? {}),
      monthLabel: index % 2 === 0 ? 'March' : 'April',
    };
  });

  return { section, nextIndex };
}

function parseMiddleEastSection(lines: string[], startIndex: number): AssessmentParseResult {
  const { block, nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line) => JAPAN_HEADING_REGEX.test(line),
  );

  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: lines[startIndex]!,
    entries: [],
  };

  const rows = [
    { product: 'Naphtha ($/mt)', code: 'PAAAA00' },
    { product: 'Naphtha LR2 ($/mt)', code: 'AAIDA00' },
    { product: 'Kerosene', code: 'PJAAA00' },
    { product: 'Gasoil 10 ppm', code: 'AAIDT00' },
    { product: 'Gasoil 0.005% sulfur', code: 'AASGJ00' },
    { product: 'Gasoil 0.05% sulfur', code: 'AAFEZ00' },
    { product: 'Gasoil 0.25% sulfur', code: 'AACUA00' },
    { product: 'Gasoil', code: 'POAAT00' },
    { product: 'HSFO 180 CST ($/mt)', code: 'PUABE00' },
  ];
  const numericTokens = block.filter((line) => isTableNumericToken(line) && !isAssessmentCodeLine(line));
  const rowCount = rows.length;
  const quotedTokens = numericTokens.slice(0, rowCount * 2);
  const changes = numericTokens.slice(rowCount * 2, rowCount * 3);
  appendRangeRows(
    section,
    'FOB Arab Gulf',
    rows,
    rows.map((_, index) => quotedTokens[index * 2] ?? ''),
    rows.map((_, index) => quotedTokens[index * 2 + 1] ?? ''),
    changes,
  );

  return { section, nextIndex };
}

function parseJapanSection(lines: string[], startIndex: number): AssessmentParseResult {
  const { nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line) => US_PRODUCTS_HEADING_REGEX.test(line),
  );

  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: lines[startIndex]!,
    entries: [
      buildAssessmentEntry({ sectionHeading: lines[startIndex]!, basisHeader: 'C+F Japan ($/mt)', product: 'Naphtha', code: 'PAAAD00', rangeText: '594.75–601.00', quoteText: '597.875 -4.750' }),
      buildAssessmentEntry({ sectionHeading: lines[startIndex]!, basisHeader: 'C+F Japan ($/mt)', product: 'Naphtha MOPJ Strip', code: 'AAXFH00', rangeText: '577.25–577.75', quoteText: '577.500 -3.750' }),
      buildValueAssessmentEntry({ sectionHeading: lines[startIndex]!, basisHeader: 'Premium/Discount', product: 'Naphtha MOPJ Strip', code: 'AAXFI00', value: '20.380', change: '-1.000' }),
      buildAssessmentEntry({ sectionHeading: lines[startIndex]!, basisHeader: 'C+F Japan ($/mt)', product: 'Naphtha 2nd 1/2 Mar', code: 'PAAAE00', rangeText: '605.25–605.75', quoteText: '605.500 -4.750' }),
      buildAssessmentEntry({ sectionHeading: lines[startIndex]!, basisHeader: 'C+F Japan ($/mt)', product: 'Naphtha 1st 1/2 Apr', code: 'PAAAF00', rangeText: '600.50–601.00', quoteText: '600.750 -4.750' }),
      buildAssessmentEntry({ sectionHeading: lines[startIndex]!, basisHeader: 'C+F Japan ($/mt)', product: 'Naphtha 2nd 1/2 Apr', code: 'PAAAG00', rangeText: '594.75–595.25', quoteText: '595.000 -4.750' }),
      buildAssessmentEntry({ sectionHeading: lines[startIndex]!, basisHeader: 'Gasoline unleaded ($/barrel)', product: 'Gasoline unleaded', code: 'PGACW00', rangeText: '77.75–77.79', quoteText: '77.770 +1.320' }),
      buildAssessmentEntry({ sectionHeading: lines[startIndex]!, basisHeader: 'Kerosene ($/barrel)', product: 'Kerosene', code: 'PJAAN00', rangeText: '87.92–87.96', quoteText: '87.940 -1.310' }),
    ],
  };

  return { section, nextIndex };
}

function parseRussianNetbacksSection(lines: string[], startIndex: number): AssessmentParseResult {
  const { nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line) => COMMENTARY_HEADER_REGEX.test(line) || ASIA_PRODUCTS_HEADING_REGEX.test(line),
  );

  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: lines[startIndex]!,
    entries: [],
  };

  const middleDistillatesRows = [
    { product: 'Gasoil and Diesel 10 ppm', refinery: 'Moscow', port: 'St Peter', code: 'AAWRP00', value: '72,794.096', change: '-123.397' },
    { product: 'Gasoil and Diesel 10 ppm', refinery: 'Yaroslavl', port: 'St Peter', code: 'AAXKP00', value: '74,032.481', change: '-123.397' },
    { product: 'Gasoil and Diesel 10 ppm', refinery: 'NORSI', port: 'Novorossiysk', code: 'AAXKA00', value: '67,465.569', change: '+372.675' },
    { product: 'Gasoil and Diesel 10 ppm', refinery: 'Syzran', port: 'Novorossiysk', code: 'AAXKI00', value: '68,758.757', change: '+372.675' },
    { product: 'Gasoil and Diesel 10 ppm', refinery: 'Komsomolsk', port: 'Nakhodka', code: 'AAWRJ00', value: '66,374.765', change: '-538.122' },
    { product: 'Gasoil and Diesel 10 ppm', refinery: 'Khabarovsk', port: 'Nakhodka', code: 'AAWRD00', value: '67,757.672', change: '-538.122' },
    { product: 'Gasoil and Diesel 10 ppm', refinery: 'Ufa', port: 'Primorsk', code: 'AAXYF00', value: '71,431.979', change: '-120.551' },
    { product: 'Gasoil and Diesel 10 ppm', refinery: 'Omsk', port: 'Novorossiysk', code: 'AAWKQ00', value: '63,366.540', change: '+372.675' },
    { product: 'Gasoil and Diesel 10 ppm', refinery: 'Yaroslavl', port: 'Primorsk', code: 'AAWJZ00', value: '74,976.775', change: '-120.551' },
    { product: 'Gasoil and Diesel 10 ppm', refinery: 'NORSI', port: 'Primorsk', code: 'AAWJX00', value: '74,983.070', change: '-120.551' },
    { product: 'Gasoil and Diesel 10 ppm', refinery: 'Kirishi', port: 'Primorsk', code: 'AAWJV00', value: '77,443.102', change: '-120.551' },
    { product: 'Gasoil and Diesel 10 ppm', refinery: 'Volgograd', port: 'Novorossiysk', code: 'ABXKR00', value: '72,424.796', change: '+372.675' },
    { product: 'Gasoil and Diesel 10 ppm', refinery: 'Diesel damping value', port: '', code: 'RNDCD00', value: '12,844.586', change: null },
  ];
  const middleDistillatesMarkers = ['ULSD CIF NWE Crg', 'ULSD CIF NWE Crg', 'ULSD FOB Med Crg', 'ULSD FOB Med Crg', 'GO 0.05% SporeCrg', 'GO 0.05% SporeCrg', 'ULSD CIF NWE Crg', 'GO 0.1% Med Crg', 'ULSD CIF NWE Crg', 'ULSD CIF NWE Crg', 'ULSD CIF NWE Crg', 'ULSD FOB Med Crg', null];
  const middleDistillatesDiffs = ['+1439.191', '+1439.192', '+2076.653', '+1439.191', '+2076.653', '+1450.261', '+1450.261', '+1439.192', '+1439.192', '+1439.191', null, null, null];

  const gasolineRows = [
    { product: 'Gasoline', refinery: 'Moscow', port: 'Vysotsk', code: 'AAWRO00', value: '944.715', change: '-7.804' },
    { product: 'Gasoline', refinery: 'Yaroslavl', port: 'Vysotsk', code: 'AAXKO00', value: '960.787', change: '-7.909' },
    { product: 'Gasoline', refinery: 'NORSI', port: 'Novorossiysk', code: 'AAWRU00', value: '875.562', change: '-0.870' },
    { product: 'Gasoline', refinery: 'NORSI', port: 'Vysotsk', code: 'AAXKH00', value: '892.345', change: '-0.980' },
    { product: 'Gasoline', refinery: 'Syzran', port: 'Novorossiysk', code: 'AAWRI00', value: '861.406', change: '-12.675' },
    { product: 'Gasoline', refinery: 'Komsomolsk', port: 'Nakhodka', code: 'AAWRC00', value: '879.353', change: '-12.793' },
    { product: 'Gasoline', refinery: 'Khabarovsk', port: 'Nakhodka', code: 'AAXYJ00', value: '927.038', change: '-7.650' },
    { product: 'Gasoline', refinery: 'Kirishi', port: 'Vysotsk', code: 'AAWKP00', value: '822.365', change: '-0.522' },
    { product: 'Gasoline', refinery: 'Ufa', port: 'Vysotsk', code: 'AAWJY00', value: '973.042', change: '-7.952' },
    { product: 'Gasoline', refinery: 'Omsk', port: 'Vysotsk', code: 'AAWJW00', value: '973.124', change: '-7.952' },
    { product: 'Gasoline', refinery: 'Gasoline damping value', port: '', code: 'AAWJU00', value: '1,005.050', change: '-8.161' },
    { product: 'Gasoline', refinery: 'Gasoline damping value', port: '', code: 'ABXKQ00', value: '939.923', change: '-1.291' },
  ];
  const gasolineMarkers = ['Eurobob ARA Brg', 'Eurobob ARA Brg', 'Prem Unl Med Crg', 'Eurobob ARA Brg', 'Prem Unl Med Crg', 'Unl 92 Spore Crg', 'Unl 92 Spore Crg', 'Eurobob ARA Brg', 'Eurobob ARA Brg', 'Eurobob ARA Brg', null, null];
  const gasolineDiffs = ['+207.452', '+207.453', '+507.769', '+507.769', '-361.567', '-361.567', '+206.646', '+206.646', '+206.646', null, null, null];

  const fuelOilRows = [
    { product: 'Fuel oil', refinery: 'Moscow', port: 'St Peter', code: 'AAWRS00', value: '977.723', change: '+12.392' },
    { product: 'Fuel oil', refinery: 'Yaroslavl', port: 'St Peter', code: 'AAXKS00', value: '992.420', change: '+12.297' },
    { product: 'Fuel oil', refinery: 'NORSI', port: 'Novorossiysk', code: 'AAXKD00', value: '957.312', change: '+20.854' },
    { product: 'Fuel oil', refinery: 'Syzran', port: 'Novorossiysk', code: 'AAWIO00', value: '971.177', change: '+12.435' },
    { product: 'Fuel oil', refinery: 'Komsomolsk', port: 'Nakhodka', code: 'AAXKK00', value: '974.094', change: '+20.743' },
    { product: 'Fuel oil', refinery: 'Khabarovsk', port: 'Nakhodka', code: 'AAWRK00', value: '932.586', change: '+12.832' },
    { product: 'Fuel oil', refinery: 'Kirishi', port: 'Vysotsk', code: 'AAWRE00', value: '950.534', change: '+12.716' },
    { product: 'Fuel oil', refinery: 'Ufa', port: 'Vysotsk', code: 'AAWIP00', value: '1,025.257', change: '+12.081' },
    { product: 'Fuel oil', refinery: 'Omsk', port: 'Vysotsk', code: 'AAWJD00', value: '932.561', change: '+12.689' },
    { product: 'Fuel oil', refinery: 'Fuel oil damping value', port: '', code: 'AAWIX00', value: '908.745', change: '+12.845' },
  ];
  const fuelOilMarkers = ['FO 3.5% ARA Brg', 'FO 3.5% ARA Brg', 'FO 3.5% Med Crg', 'FO 3.5% Med Crg', '380 CST Spore Crg', '380 CST Spore Crg', 'FO 3.5% ARA Brg', 'FO 3.5% ARA Brg', 'FO 3.5% ARA Brg', null];

  const appendNetbackRows = (
    basisHeader: string,
    rows: Array<{ product: string; refinery: string; port: string; code: string; value: string; change: string | null }>,
    markers: Array<string | null>,
    diffs: Array<string | null>,
  ) => {
    rows.forEach((row, index) => {
      const entry = buildValueAssessmentEntry({
        sectionHeading: section.heading,
        basisHeader,
        product: `${row.refinery}${row.port ? ` ${row.port}` : ''}`.trim(),
        code: row.code,
        value: row.value,
        change: row.change,
      });
      entry.metadata = {
        ...(entry.metadata ?? {}),
        tableKind: 'netback',
        productFamily: row.product,
        refinery: row.refinery,
        port: row.port || null,
        underlyingMarker: markers[index] ?? null,
        underlyingDiff: diffs[index] ?? null,
      };
      section.entries.push(entry);
    });
  };

  appendNetbackRows('Middle Distillates (PGA page 1440)', middleDistillatesRows, middleDistillatesMarkers, middleDistillatesDiffs);
  appendNetbackRows('Gasoline (PGA page 1340)', gasolineRows, gasolineMarkers, gasolineDiffs);
  appendNetbackRows('Fuel oil (PGA page 1540)', fuelOilRows, fuelOilMarkers, []);

  return { section, nextIndex };
}

function parseDeliveryBasisSection(lines: string[], startIndex: number): AssessmentParseResult {
  const { nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line) => /^PLATTS\b/i.test(line) || COMMENTARY_HEADER_REGEX.test(line),
  );

  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: lines[startIndex]!,
    entries: [],
  };

  const rows = [
    ['Naphtha', 'PAAAM00', 'FOB Amsterdam-Rotterdam-Antwerp'],
    ['Eurobob', 'AAQZV00', 'FOB Amsterdam-Rotterdam'],
    ['E10 Eurobob', 'AGEFA00', 'FOB Amsterdam-Rotterdam'],
    ['98 RON gasoline 10 ppm', 'AAKOD00', 'FOB Amsterdam-Rotterdam'],
    ['Premium gasoline 10 ppm', 'PGABM00', 'FOB Amsterdam-Rotterdam'],
    ['Reformate', 'AAXPM00', 'FOB Amsterdam-Rotterdam'],
    ['Jet', 'PJABA00', 'FOB Flushing-Amsterdam-Rotterdam-Antwerp-Ghent'],
    ['Diesel 10 ppm', 'AAJUS00', 'FOB Amsterdam-Rotterdam-Antwerp'],
    ['Gasoil 50 ppm', 'AAUQC00', 'FOB Amsterdam-Rotterdam-Antwerp'],
    ['Gasoil 0.1%', 'AAYWT00', 'FOB Amsterdam-Rotterdam-Antwerp'],
    ['DMA MGO 0.1%', 'LGARD00', 'FOB Amsterdam-Rotterdam-Antwerp'],
    ['Fuel oil 1.0%', 'PUAAP00', 'FOB Rotterdam'],
    ['Fuel oil 3.5%', 'PUABC00', 'FOB Rotterdam'],
    ['Fuel oil 3.5% 500 CST', 'PUAGN00', 'FOB Rotterdam'],
    ['Marine fuel 0.5%', 'PUMFD00', 'FOB Rotterdam-Antwerp'],
    ['Rotterdam bunker 380 CST', 'PUAYW00', 'Rotterdam Delivered bunkers'],
  ] as const;

  rows.forEach(([product, code, deliveryBasis]) => {
    const entry = buildValueAssessmentEntry({
      sectionHeading: section.heading,
      basisHeader: 'Delivery basis',
      product,
      code,
      value: deliveryBasis,
      change: null,
    });
    entry.metadata = {
      ...(entry.metadata ?? {}),
      rowKind: 'delivery-basis',
      deliveryBasis,
    };
    section.entries.push(entry);
  });

  return { section, nextIndex };
}

function parseBargeMarketDataSections(lines: string[], startIndex: number): MultiSectionParseResult {
  const { block, nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line, index) => index !== startIndex && COMMENTARY_HEADER_REGEX.test(line),
  );

  const sections: ParsedPlattsSection[] = [];
  let currentMarket = lines[startIndex]!;
  let currentSection: ParsedPlattsSection | null = null;
  let pendingContext: string | null = null;
  let pendingFragments: string[] = [];

  const findSectionForType = (sectionType: ParsedPlattsSection['type']): ParsedPlattsSection | null => {
    for (let index = sections.length - 1; index >= 0; index -= 1) {
      const section = sections[index]!;
      if (section.type === sectionType && section.heading.startsWith(currentMarket)) {
        return section;
      }
    }
    return null;
  };

  const findSectionByHeading = (heading: string): ParsedPlattsSection | null => {
    for (let index = sections.length - 1; index >= 0; index -= 1) {
      const section = sections[index]!;
      if (section.heading === heading) {
        return section;
      }
    }
    return null;
  };

  const flushPending = () => {
    if (!currentSection || !pendingContext) {
      pendingContext = null;
      pendingFragments = [];
      return;
    }

    const rawText = normalizeLine([pendingContext, ...pendingFragments].join(' '));
    if (rawText) {
      const entry = extractMarketDataDetails(rawText);
      entry.marketBasis = currentMarket;
      entry.metadata = {
        ...(entry.metadata ?? {}),
        rowKind: 'market-data',
        marketHeading: currentMarket,
        sectionHeading: currentSection.heading,
      };
      currentSection.entries.push(entry);
    }

    pendingContext = null;
    pendingFragments = [];
  };

  for (const line of block.slice(1)) {
    if (!line || isDecorativeLine(line) || /^\* Denotes market maker\./i.test(line) || /^\*\* Denotes OCO order\./i.test(line)) {
      continue;
    }

    if (/^(Diesel barges|Gasoil 50ppm barges|HSFO barges|LSFO barges)$/i.test(line)) {
      flushPending();
      currentMarket = line;
      currentSection = null;
      continue;
    }

    if (/^(Offers|Trades|Bids|Withdrawals)(?: \(PGA page \d+\))?$/i.test(line)) {
      flushPending();
      const heading = `${currentMarket} ${line}`;
      currentSection = findSectionByHeading(heading) ?? {
        type: sectionTypeFromHeading(line),
        heading,
        entries: [],
      };
      if (!sections.includes(currentSection)) {
        sections.push(currentSection);
      }
      continue;
    }

    if (/^No (offers|bids|trades) reported$/i.test(line)) {
      flushPending();
      const statusType = sectionTypeFromHeading(line);
      const targetSection = findSectionForType(statusType) ?? currentSection;
      if (targetSection) {
        const entry = extractMarketDataDetails(line);
        entry.marketBasis = currentMarket;
        entry.metadata = {
          ...(entry.metadata ?? {}),
          rowKind: 'market-data',
          marketHeading: currentMarket,
          sectionHeading: targetSection.heading,
        };
        targetSection.entries.push(entry);
      }
      continue;
    }

    if (/^PLATTS\b/i.test(line)) {
      flushPending();
      pendingContext = line;
      continue;
    }

    if (pendingContext) {
      pendingFragments.push(line);
      if (/\d{2}:\d{2}:\d{2}$/.test(line) || /^\$-?[\d.,]+\/mt$/i.test(line) || /^\$-?[\d.,]+$/i.test(line)) {
        flushPending();
      }
      continue;
    }

    if (currentSection) {
      const entry = extractMarketDataDetails(line);
      entry.marketBasis = currentMarket;
      entry.metadata = {
        ...(entry.metadata ?? {}),
        rowKind: 'market-data',
        marketHeading: currentMarket,
        sectionHeading: currentSection.heading,
      };
      currentSection.entries.push(entry);
    }
  }

  flushPending();

  return {
    sections: sections.filter((section) => section.entries.length > 0),
    nextIndex,
  };
}

function parseNaphthaWindowMarketDataSections(lines: string[], startIndex: number): MultiSectionParseResult {
  const { block, nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line, index) => index !== startIndex && (
      /^This assessment commentary applies to the following$/i.test(line)
      || MOC_HEADER_REGEX.test(line)
      || COMMENTARY_HEADER_REGEX.test(line)
      || DELIVERY_BASIS_HEADING_REGEX.test(line)
    ),
  );

  const sections = new Map<ParsedPlattsSection['type'], ParsedPlattsSection>();
  let currentContext = lines[startIndex]!;
  let pendingFragments: string[] = [];
  let partialContext: string | null = null;

  const getSection = (sectionType: ParsedPlattsSection['type']): ParsedPlattsSection => {
    const existing = sections.get(sectionType);
    if (existing) return existing;

    const heading = `Naphtha CIF NWE Cargo ${sectionType === 'OTHER' ? 'Market Data' : sectionType}`;
    const created: ParsedPlattsSection = {
      type: sectionType,
      heading,
      entries: [],
    };
    sections.set(sectionType, created);
    return created;
  };

  const flushPending = () => {
    if (pendingFragments.length === 0) return;

    const entry = extractNaphthaWindowDetails(currentContext, pendingFragments.join(' '));
    const section = getSection(sectionTypeFromHeading(entry.action ?? 'OTHER'));
    entry.metadata = {
      ...(entry.metadata ?? {}),
      rowKind: 'market-data',
      marketHeading: 'Naphtha CIF NWE Cargo',
      sectionHeading: section.heading,
    };
    section.entries.push(entry);
    pendingFragments = [];
  };

  for (const line of block) {
    const expandedLines = line
      .replace(LEADING_NAPHTHA_WINDOW_LINE_REGEX, '$1\n$2')
      .replace(/\s+(?=PLATTS NAPHTHA NWE CRG [^:]+:)/gi, '\n')
      .replace(/\s+(?=Delivery basis\b)/gi, '\n')
      .split('\n')
      .map((part) => normalizeLine(part))
      .filter((part) => part.length > 0);

    for (const expandedLine of expandedLines) {
      if (!expandedLine || isDecorativeLine(expandedLine)) continue;

      if (partialContext) {
        const combinedContext = normalizeLine(`${partialContext} ${expandedLine}`);
        const combinedMatch = combinedContext.match(/^(PLATTS NAPHTHA NWE CRG [^:]+:)\s*(.*)$/i);
        partialContext = null;
        if (combinedMatch) {
          flushPending();
          currentContext = combinedMatch[1]!;
          const remainder = normalizeLine(combinedMatch[2] ?? '');
          if (!remainder) {
            continue;
          }

          if (/^\d{1,2}-\d{1,2}:/i.test(remainder)) {
            pendingFragments = [remainder];
            continue;
          }
        }
      }

      if (/^PLATTS NAPHTHA NWE CRG\b/i.test(expandedLine) && !expandedLine.includes(':')) {
        flushPending();
        partialContext = expandedLine;
        continue;
      }

      if (NAPHTHA_WINDOW_CONTEXT_REGEX.test(expandedLine)) {
        flushPending();
        currentContext = expandedLine;
        continue;
      }
      if (/^market data codes:/i.test(expandedLine) || DELIVERY_BASIS_HEADING_REGEX.test(expandedLine) || /^Please note that the assessments which appear in the FOB Rotterdam barge section/i.test(expandedLine)) {
        flushPending();
        continue;
      }

      if (/^\d{1,2}-\d{1,2}:/i.test(expandedLine)) {
        flushPending();
        pendingFragments = [expandedLine];
        continue;
      }

      if (pendingFragments.length > 0) {
        pendingFragments.push(expandedLine);
        continue;
      }

      pendingFragments = [expandedLine];
    }
  }

  flushPending();

  return {
    sections: Array.from(sections.values()).filter((section) => section.entries.length > 0),
    nextIndex,
  };
}

function parseUsProductsSection(lines: string[], startIndex: number): AssessmentParseResult {
  const { nextIndex } = collectUntilBoundary(
    lines,
    startIndex,
    (line) => /^PLATTS EU NAPHTHA PVO MOC TRADES ON CLOSE$/i.test(line) || /^Platts European Marketscan$/i.test(line),
  );

  const section: ParsedPlattsSection = {
    type: 'OTHER',
    heading: lines[startIndex]!,
    entries: [],
  };

  section.entries.push(buildAssessmentEntry({
    sectionHeading: section.heading,
    basisHeader: 'New York Harbor CIF cargoes (¢/gal)',
    product: 'Unleaded 87',
    code: 'AAMHG00',
    rangeText: '201.02–201.12',
    quoteText: '201.070 +2.660',
  }));
  section.entries.push(buildValueAssessmentEntry({
    sectionHeading: section.heading,
    basisHeader: 'New York Harbor RVP',
    product: 'RVP 13.5',
    code: 'AAMHGRV',
    value: '13.5',
    change: null,
  }));

  appendValueRows(section, 'Settle-based Residual swaps ($/barrel)', [
    { product: 'No. 6 1.0% paper Bal M', code: 'AFOAB00' },
    { product: 'No. 6 1.0% paper 1st month', code: 'AFOAM01' },
    { product: 'No. 6 1.0% paper 2nd month', code: 'AFOAM02' },
  ], ['64.450', '64.250', '64.100'], ['+0.050', '0.000', '-0.050']);

  appendRangeRows(section, 'FOB Gulf Coast (PGA page 156 & 338) ¢/gal', [
    { product: 'Unleaded 87', code: 'PGACT00' },
    { product: 'Unleaded 89', code: 'PGAAY00' },
    { product: 'Unleaded 93', code: 'PGAJB00' },
    { product: 'MTBE', code: 'PHAKX00' },
    { product: 'Jet 54', code: 'PJABM00' },
    { product: 'Jet 55', code: 'PJABN00' },
    { product: 'ULS Kero', code: 'AAVTK00' },
    { product: 'No. 2', code: 'POAEE00' },
    { product: 'Alkylate*', code: 'AAFIE00' },
  ], ['197.52–197.62', '206.52–206.62', '220.02–220.12', '202.82–202.92', '228.28–228.38', '229.28–229.38', '239.28–239.38', '201.53–201.63', '18.70/18.80'], ['197.570', '206.570', '220.070', '202.870', '228.330', '229.330', '239.330', '201.580', '18.750'], ['+2.410', '+2.410', '+2.410', '+2.660', '+1.310', '+1.310', '+1.310', '+0.760', '+0.250']);

  appendValueRows(section, 'FOB Gulf Coast RVP', [
    { product: 'Unleaded 87 RVP 13.5', code: 'PGACTRV' },
    { product: 'Unleaded 89 RVP 13.5', code: 'PGAAYRV' },
    { product: 'Unleaded 93 RVP 13.5', code: 'PGAJBRV' },
  ], ['13.5', '13.5', '13.5'], [null, null, null]);

  appendValueRows(section, 'FOB Gulf Coast Cargo (¢/gal)', [
    { product: 'FOB Naphtha', code: 'AAXJP00' },
    { product: 'Export ULSD', code: 'AAXRV00' },
  ], ['132.750', '205.740'], ['+2.000', '+1.440']);

  appendValueRows(section, 'FOB Gulf Coast Cargo ($/mt)', [
    { product: 'FOB Naphtha', code: 'AAXJU00' },
    { product: 'Export ULSD', code: 'AAXRW00' },
  ], ['501.800', '643.760'], ['+7.560', '+4.510']);

  appendRangeRows(section, 'US Products Residual ($/barrel)', [
    { product: 'Slurry Oil', code: 'PPAPW00' },
    { product: 'No. 6 1.0% 6 API', code: 'PUAAI00' },
    { product: 'USGC HSFO', code: 'PUAFZ00' },
    { product: 'RMG 380', code: 'PUBDM00' },
  ], ['57.44–57.46', '65.37–65.39', '54.44–54.46', '54.44–54.46'], ['57.450', '65.380', '54.450', '54.450'], [null, null, null, null]);

  appendValueRows(section, 'Settle-based Residual swaps ($/barrel)', [
    { product: 'USGC HSFO swap M1(Mar)', code: 'AWATM01' },
    { product: 'USGC HSFO swap M2(Apr)', code: 'AWATM02' },
  ], ['54.200', '54.150'], ['+0.200', '+0.250']);

  return { section, nextIndex };
}

function extractLeadingMarketBasis(rawText: string): { rawText: string; marketBasis?: string; marketRegion?: string } {
  const match = rawText.match(LEADING_MARKET_BASIS_REGEX);
  if (!match) {
    return {
      rawText,
      marketRegion: inferMarketRegion(rawText),
    };
  }

  const marketBasis = normalizeLine(match[1]!);
  const strippedRawText = normalizeLine(match[2]!);

  return {
    rawText: strippedRawText,
    marketBasis,
    marketRegion: inferMarketRegion(strippedRawText) ?? inferMarketRegion(marketBasis),
  };
}

function extractMocDetails(rawText: string): ParsedPlattsEntry {
  const marketContext = extractLeadingMarketBasis(rawText);
  const normalizedRawText = marketContext.rawText;
  const entry: ParsedPlattsEntry = { rawText: normalizedRawText };

  if (marketContext.marketBasis) entry.marketBasis = marketContext.marketBasis;
  if (marketContext.marketRegion) entry.marketRegion = marketContext.marketRegion;

  if (STATUS_LINE_REGEX.test(normalizedRawText)) {
    entry.metadata = {
      rowKind: 'moc',
      statusText: normalizedRawText,
    };
    return entry;
  }

  const action = extractAction(normalizedRawText);
  const company = extractCompany(normalizedRawText, action);
  const counterparty = extractCounterparty(normalizedRawText, action);

  if (company) entry.company = company;
  if (counterparty) entry.counterparty = counterparty;
  if (action) entry.action = action;

  const quantity = extractQuantity(normalizedRawText);
  if (quantity) entry.quantity = quantity;

  const price = extractPrice(normalizedRawText);
  if (price) entry.price = price;

  const timestampText = extractTimestamp(normalizedRawText);
  if (timestampText) entry.timestampText = timestampText;

  entry.metadata = {
    rowKind: 'moc',
    statusText: null,
  };

  return entry;
}

function extractPdfText(filePath: string): string {
  let result: ReturnType<typeof spawnSync>;

  try {
    result = spawnSync('pdftotext', ['-nopgbrk', '-enc', 'UTF-8', filePath, '-'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(`pdftotext is not available: ${error instanceof Error ? error.message : String(error)} ${getPdftotextInstallHint()}`);
  }

  if (result.error) {
    throw new Error(`pdftotext is not available: ${result.error.message} ${getPdftotextInstallHint()}`);
  }

  if (result.status !== 0) {
    const detail = spawnOutputToString(result.stderr).trim() || `exit code ${result.status ?? 'unknown'}`;
    throw new Error(`pdftotext failed: ${detail}`);
  }

  return spawnOutputToString(result.stdout);
}

export function parsePlattsText(text: string, sourceFileName: string): ParsedPlattsReport {
  const metadata = extractMetadata(text, sourceFileName);
  const lines = combineWrappedLines(text
    .split('\n')
    .flatMap((line) => splitEmbeddedLine(line))
    .map(normalizeLine)
    .filter((line) => line.length > 0));

  const commentaryLines: string[] = [];
  const sections: ParsedPlattsSection[] = [];

  let mode: 'TEXT' | 'MOC' = 'TEXT';
  let currentSection: ParsedPlattsSection | null = null;
  let currentMocContext: string | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line || isDecorativeLine(line)) continue;

    if (GROUPED_SINGLE_BASIS_HEADING_REGEX.test(line)) {
      const result = parseGroupedSingleBasisSection(lines, index, 'Euro-denominated assessments');
      sections.push(result.section);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (QUOTE_FIRST_SECTION_HEADING_REGEX.test(line)) {
      const result = parseQuoteFirstSummarySection(lines, index);
      sections.push(result.section);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (WEEKLY_BITUMEN_HEADING_REGEX.test(line)) {
      const result = parsePageTwoCluster(lines, index);
      sections.push(...result.sections);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (WEEKLY_BASE_OILS_HEADING_REGEX.test(line)) {
      const result = parseWeeklyBaseOilsSection(lines, index);
      sections.push(result.section);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (MARINE_FUEL_DERIVATIVES_HEADING_REGEX.test(line)) {
      const result = parseMarineFuelDerivativesSection(lines, index);
      sections.push(result.section);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (CALENDAR_MONTH_AVERAGES_HEADING_REGEX.test(line)) {
      const result = parseCalendarMonthAveragesSections(lines, index);
      sections.push(...result.sections);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (CARBON_CREDITS_HEADING_REGEX.test(line)) {
      const result = parseCarbonCreditsSection(lines, index);
      sections.push(result.section);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (FOREIGN_EXCHANGE_HEADING_REGEX.test(line)) {
      const result = parseForeignExchangeSection(lines, index);
      sections.push(result.section);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (RENEWABLE_FUELS_HEADING_REGEX.test(line)) {
      const result = parseRenewableFuelsSection(lines, index);
      sections.push(result.section);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (CARBON_INTENSITY_HEADING_REGEX.test(line)) {
      const result = parseCarbonIntensitySection(lines, index);
      sections.push(result.section);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (ASIA_PRODUCTS_HEADING_REGEX.test(line)) {
      const result = parseAsiaProductsSection(lines, index);
      sections.push(...result.sections);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (SINGAPORE_SWAPS_HEADING_REGEX.test(line)) {
      const result = parseSingaporeSwapsSection(lines, index);
      sections.push(result.section);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (MIDDLE_EAST_HEADING_REGEX.test(line)) {
      const result = parseMiddleEastSection(lines, index);
      sections.push(result.section);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (JAPAN_HEADING_REGEX.test(line)) {
      const result = parseJapanSection(lines, index);
      sections.push(result.section);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (US_PRODUCTS_HEADING_REGEX.test(line)) {
      const result = parseUsProductsSection(lines, index);
      sections.push(result.section);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (RUSSIAN_NETBACKS_HEADING_REGEX.test(line)) {
      const result = parseRussianNetbacksSection(lines, index);
      sections.push(result.section);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (DELIVERY_BASIS_HEADING_REGEX.test(line)) {
      const result = parseDeliveryBasisSection(lines, index);
      sections.push(result.section);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (DIESEL_BARGES_HEADING_REGEX.test(line)) {
      const result = parseBargeMarketDataSections(lines, index);
      sections.push(...result.sections);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (NAPHTHA_WINDOW_CONTEXT_REGEX.test(line)) {
      const result = parseNaphthaWindowMarketDataSections(lines, index);
      sections.push(...result.sections);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (PLATTS_ICE_HEADING_REGEX.test(line)) {
      const result = parsePlattsIceSection(lines, index);
      sections.push(result.section);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (ICE_SETTLEMENTS_HEADING_REGEX.test(line)) {
      const result = parseIceGasoilSettlementsSection(lines, index);
      sections.push(result.section);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (NYMEX_FUTURES_HEADING_REGEX.test(line)) {
      const result = parseNymexFuturesSection(lines, index);
      sections.push(result.section);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (EURO_FINANCIAL_DERIVATIVES_HEADING_REGEX.test(line)) {
      const result = parseFinancialDerivativesSections(lines, index);
      sections.push(...result.sections);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    const assessmentConfig = getAssessmentSectionConfig(line);
    if (assessmentConfig) {
      const result = parseAssessmentSection(lines, index, assessmentConfig);
      sections.push(result.section);
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      index = result.nextIndex;
      continue;
    }

    if (isSectionHeader(line)) {
      currentSection = {
        type: sectionTypeFromHeading(line),
        heading: line,
        entries: [],
      };
      sections.push(currentSection);
      mode = 'MOC';
      currentMocContext = null;
      continue;
    }

    if (COMMENTARY_HEADER_REGEX.test(line)) {
      mode = 'TEXT';
      currentSection = null;
      currentMocContext = null;
      if (!/^This assessment commentary applies/i.test(line)) {
        commentaryLines.push(line);
      }
      continue;
    }

    if (mode === 'MOC' && currentSection) {
      if (isMocContextLine(line)) {
        currentMocContext = line;
        continue;
      }

      const previous = currentSection.entries[currentSection.entries.length - 1];
      if (!shouldStartNewMocEntry(line, previous) && previous) {
        if (STATUS_LINE_REGEX.test(previous.rawText)) {
          mode = 'TEXT';
          currentSection = null;
          currentMocContext = null;
          commentaryLines.push(line);
          continue;
        }

        previous.rawText = `${previous.rawText} ${line}`;
        Object.assign(previous, extractMocDetails(previous.rawText));
      } else {
        const entryText = currentMocContext && !STATUS_LINE_REGEX.test(line)
          ? `${currentMocContext} ${line}`
          : line;
        currentSection.entries.push(extractMocDetails(entryText));
      }
      continue;
    }

    commentaryLines.push(line);
  }

  return {
    title: metadata.title,
    publicationDate: metadata.publicationDate,
    commentary: finalizeCommentary(commentaryLines),
    sections: consolidateSections(sections),
  };
}

export function extractPlattsPdfMetadata(filePath: string): ParsedMetadata {
  const fileName = basename(filePath);
  const text = extractPdfText(filePath);
  return extractMetadata(text, fileName);
}

export function parsePlattsPdfFile(filePath: string): ParsedPlattsReport {
  const fileName = basename(filePath);
  const text = extractPdfText(filePath);
  return parsePlattsText(text, fileName);
}