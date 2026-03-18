import { basename } from 'node:path';
import { PDFParse } from 'pdf-parse';

export const PLATTS_PARSER_VERSION = '2026-03-18c';

export interface ParsedPlattsEntry {
  rawText: string;
  company?: string;
  counterparty?: string;
  action?: string;
  price?: string;
  quantity?: string;
  timestampText?: string;
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

const MOC_HEADER_REGEX = /(MOC TRADES ON CLOSE|MOC BIDS ON CLOSE|MOC OFFERS ON CLOSE|MOC WITHDRAWALS ON CLOSE)/i;
const SIMPLE_HEADER_REGEX = /^(Trades|Bids|Offers|Withdrawals)(?::\s*(?:None|No .*|None\.)?)?\.?$/i;
const COMBINED_HEADER_REGEX = /^(Bids, Offers, Trades|Offers, Trades|Bids, Offers)$/i;
const COMMENTARY_HEADER_REGEX = /^(Platts.*?(?:Daily Market Analysis|Rationale|Rationales|Rationale & Exclusions|Daily Commentary)|Market Commentary|This assessment commentary applies)/i;
const STATUS_LINE_REGEX = /^(?:[\u2022\u2023\u25AA\u25CF\u25E6\u2043\u00B7\u0084\-]\s*)?NO\s+(TRADES|BIDS|OFFERS|WITHDRAWALS)\s+REPORTED\.?$/i;

function splitEmbeddedLine(line: string): string[] {
  const markers = [
    ' PLATTS ',
    ' Trades',
    ' Bids',
    ' Offers',
    ' Withdrawals',
    ' This assessment commentary applies',
    ' Platts ',
  ];

  let expanded = line;
  for (const marker of markers) {
    const replacement = `\n${marker.trimStart()}`;
    expanded = expanded.replaceAll(marker, replacement);
  }

  expanded = expanded.replace(MOC_HEADER_REGEX, (match) => `\n${match}`);

  return expanded
    .split('\n')
    .map((part) => normalizeLine(part))
    .filter((part) => part.length > 0);
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

function isDecorativeLine(line: string): boolean {
  if (!line) return true;
  if (/^--\s*\d+\s+of\s+\d+\s*--$/i.test(line)) return true;
  if (/^©\s*\d{4}\s+by\s+S&P Global/i.test(line)) return true;
  if (/^www\.spglobal\.com\/energy/i.test(line)) return true;
  if (/^Contact Client Services:/i.test(line)) return true;
  if (/^Explore Forward Curves/i.test(line)) return true;
  if (/^Platts European Marketscan\s+[A-Z][a-z]+ \d{1,2}, \d{4}$/i.test(line)) return true;
  return false;
}

function isSectionHeader(line: string): boolean {
  return MOC_HEADER_REGEX.test(line) || SIMPLE_HEADER_REGEX.test(line) || COMBINED_HEADER_REGEX.test(line);
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

function cleanupEntityName(raw: string | undefined): string | undefined {
  const cleaned = raw
    ?.replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || /^NO$/i.test(cleaned) || /^PLATTS$/i.test(cleaned) || /^REPORTED$/i.test(cleaned)) return undefined;
  return cleaned;
}

function shouldAppendToPrevious(line: string, previous?: ParsedPlattsEntry): boolean {
  if (!previous) return false;
  if (/^\(\d{2}:\d{2}:\d{2}\)$/.test(line)) return true;
  if (/^[\d,.]+\s*[A-Z]{1,6}$/.test(line)) return true;
  if (/^[\d,.]+\s*[A-Z]{1,6}(?:\s*\(\d{2}:\d{2}:\d{2}\))?$/.test(line)) return true;
  if (/^(AT|FOR|FROM|TO)\b/i.test(line)) return true;
  return false;
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
  return cleanupEntityName(rawText.match(regex)?.[1]);
}

function extractTimestamp(rawText: string): string | undefined {
  const match = rawText.match(/\((\d{2}:\d{2}:\d{2})\)/);
  return match?.[1];
}

function extractMocDetails(rawText: string): ParsedPlattsEntry {
  const entry: ParsedPlattsEntry = { rawText };
  if (STATUS_LINE_REGEX.test(rawText)) {
    return entry;
  }

  const action = extractAction(rawText);
  const company = extractCompany(rawText, action);
  const counterparty = extractCounterparty(rawText, action);

  if (company) entry.company = company;
  if (counterparty) entry.counterparty = counterparty;
  if (action) entry.action = action;

  const quantity = extractQuantity(rawText);
  if (quantity) entry.quantity = quantity;

  const price = extractPrice(rawText);
  if (price) entry.price = price;

  const timestampText = extractTimestamp(rawText);
  if (timestampText) entry.timestampText = timestampText;

  return entry;
}

async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: pdfBuffer });

  try {
    const result = await parser.getText();
    return result.text ?? '';
  } finally {
    await parser.destroy();
  }
}

export function parsePlattsText(text: string, sourceFileName: string): ParsedPlattsReport {
  const metadata = extractMetadata(text, sourceFileName);
  const lines = text
    .split('\n')
    .flatMap((line) => splitEmbeddedLine(line))
    .map(normalizeLine);

  const commentaryLines: string[] = [];
  const sections: ParsedPlattsSection[] = [];

  let mode: 'TEXT' | 'MOC' = 'TEXT';
  let currentSection: ParsedPlattsSection | null = null;

  for (const rawLine of lines) {
    const line = normalizeLine(rawLine);
    if (!line || isDecorativeLine(line)) continue;

    if (isSectionHeader(line)) {
      currentSection = {
        type: sectionTypeFromHeading(line),
        heading: line,
        entries: [],
      };
      sections.push(currentSection);
      mode = 'MOC';
      continue;
    }

    if (COMMENTARY_HEADER_REGEX.test(line)) {
      mode = 'TEXT';
      commentaryLines.push(line);
      currentSection = null;
      continue;
    }

    if (mode === 'MOC' && currentSection) {
      const previous = currentSection.entries[currentSection.entries.length - 1];
      if (shouldAppendToPrevious(line, previous)) {
        previous.rawText = `${previous.rawText} ${line}`;
        Object.assign(previous, extractMocDetails(previous.rawText));
      } else {
        currentSection.entries.push(extractMocDetails(line));
      }
      continue;
    }

    commentaryLines.push(line);
  }

  return {
    title: metadata.title,
    publicationDate: metadata.publicationDate,
    commentary: stitchCommentary(commentaryLines),
    sections,
  };
}

export async function extractPlattsPdfMetadata(filePath: string): Promise<ParsedMetadata> {
  const fileName = basename(filePath);
  const pdfBuffer = Buffer.from(await Bun.file(filePath).arrayBuffer());
  const text = await extractPdfText(pdfBuffer);
  return extractMetadata(text, fileName);
}

export async function parsePlattsPdfFile(filePath: string): Promise<ParsedPlattsReport> {
  const fileName = basename(filePath);
  const pdfBuffer = Buffer.from(await Bun.file(filePath).arrayBuffer());
  const text = await extractPdfText(pdfBuffer);
  return parsePlattsText(text, fileName);
}