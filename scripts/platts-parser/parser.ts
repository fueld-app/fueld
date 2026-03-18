import { file } from "bun";
import * as path from "path";
import { PDFParse } from "pdf-parse";

// ═══════════════════════════════════════════════════════════════════════
//  Data Structures
// ═══════════════════════════════════════════════════════════════════════

interface ReportData {
  title: string;
  publicationDate: string | null;
  sourceFile: string;
  assessments: AssessmentRow[];
  commentary: string[];
  mocData: MocSection[];
}

interface AssessmentRow {
  product: string;
  code: string;
  mid: string | null;
  change: string | null;
  range: string | null;
  basis: string;
  region: string | null;
  unit: string;
}

interface MocSection {
  type: "Trades" | "Bids" | "Offers" | "Withdrawals" | "Other";
  heading: string;
  marketRegion: string | null;
  marketBasis: string | null;
  entries: ParsedMocEntry[];
}

interface ParsedMocEntry {
  rawText: string;
  company?: string;
  counterparty?: string;
  action?: string;
  price?: string;
  quantity?: string;
  timestampText?: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  Noise / Decorative Line Filters
// ═══════════════════════════════════════════════════════════════════════

function isDecorativeLine(line: string): boolean {
  if (/^--\s*\d+\s+of\s+\d+\s*-/i.test(line)) return true;
  if (/^©\s*\d{4}\s+by\s+S&P Global/i.test(line)) return true;
  if (/^\d{1,2}$/.test(line)) return true;
  if (/^www\.spglobal\.com\/energy/i.test(line)) return true;
  if (/^Contact Client Services:/i.test(line)) return true;
  if (/^Explore Forward Curves/i.test(line)) return true;
  if (/^Platts is part of S&P Global Energy\.?$/i.test(line)) return true;
  if (/^Platts European Marketscan\s+[A-Z][a-z]+ \d{1,2}, \d{4}/i.test(line)) return true;
  if (/^S&P Global, the S&P Global logo/i.test(line)) return true;
  if (/^S&P Global Energy, its affiliates and all of their third-party/i.test(line)) return true;
  if (/^ICE index data and NYMEX futures data used herein/i.test(line)) return true;
  if (/^Permission is granted for those registered with the Copyright/i.test(line)) return true;
  if (/^For all other queries or requests pursuant/i.test(line)) return true;
  if (/^Platts European Marketscan You may view or otherwise/i.test(line)) return true;
  if (/^Trade Data: S&P Global Energy has defined standards/i.test(line)) return true;
  if (/^Exclusions:\s*None/i.test(line)) return true;
  return false;
}

/** Strip inline page footers that appear mid-line after stitching */
function stripInlineNoise(text: string): string {
  // e.g. "www.spglobal.com/energy -- 1 of 33 -(see page 11)"
  text = text.replace(/www\.spglobal\.com\/energy\s*--\s*\d+\s+of\s+\d+\s*-\s*(\(see page \d+\)\s*)?/gi, '');
  // e.g. "-- 4 of 33 -Platts European Marketscan ..."
  text = text.replace(/--\s*\d+\s+of\s+\d+\s*-\s*(?:\(.*?\)\s*)?Platts European Marketscan\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\s*©\s*\d{4}\s+by\s+S&P Global Inc\.\s+All rights reserved\.\s*\d*/gi, '');
  // Standalone page/copyright markers within text
  text = text.replace(/Platts European Marketscan\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\s*©\s*\d{4}\s+by\s+S&P Global Inc\.\s+All rights reserved\.\s*\d*/gi, '');
  return text.trim();
}

// ═══════════════════════════════════════════════════════════════════════
//  Date Extraction
// ═══════════════════════════════════════════════════════════════════════

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function extractPublicationDate(text: string): string | null {
  const m = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})/i);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

// ═══════════════════════════════════════════════════════════════════════
//  Assessment Table Parsing
// ═══════════════════════════════════════════════════════════════════════

/** Detect Platts assessment codes: 6-8 alphanumeric with at least one digit */
const CODE_RE = /\b((?=[A-Z0-9]{6,8}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{6,8})\b/g;

/** Match price values: optional range (521.50–522.00) then mid and change */
const QUOTE_RE = /(?:([\d.,]+)[–-]([\d.,]+)\s+)?([\d.,]+)\s+([+-][\d.,]+)/;

/** Single value with no range (e.g. "521.750 +10.750") */
const SINGLE_QUOTE_RE = /^([\d.,]+)\s+([+-][\d.,]+)$/;

interface AssessmentTableConfig {
  headingPattern: RegExp;
  basisHeaders: string[];
  region: string;
  unit: string;
}

const TABLE_CONFIGS: AssessmentTableConfig[] = [
  {
    headingPattern: /Mediterranean cargoes.*?\(?\$\/mt\)?/i,
    basisHeaders: ['FOB Med (Italy)', 'CIF Med (Genova/Lavera)', 'MOPL Diff'],
    region: 'MED',
    unit: '$/mt',
  },
  {
    headingPattern: /Northwest Europe cargoes.*?\(?\$\/mt\)?|^Northwest Europe cargoes\s*\(PGA/i,
    basisHeaders: ['FOB NWE', 'CIF NWE/Basis ARA', 'MOPL Diff'],
    region: 'NWE',
    unit: '$/mt',
  },
  {
    headingPattern: /Northwest Europe barges.*?\(?\$\/mt\)?|^Northwest Europe barges\s*\(PGA/i,
    basisHeaders: ['FOB Rotterdam', 'FOB FARAG', 'MOPL Diff'],
    region: 'NWE',
    unit: '$/mt',
  },
  {
    headingPattern: /West Africa cargoes.*?\(?\$\/mt\)?|^West Africa cargoes\s*\(PGA|STS Lome/i,
    basisHeaders: ['STS Lome', 'FOB West Africa', 'CIF West Africa'],
    region: 'WAF',
    unit: '$/mt',
  },
  {
    headingPattern: /Marine Fuel\s*\(PGA page 30\)/i,
    basisHeaders: ['Marine Fuel 0.5%'],
    region: 'GLOBAL',
    unit: '$/mt',
  },
  {
    headingPattern: /Mediterranean cargoes.*?€\/mt/i,
    basisHeaders: ['FOB Med', 'CIF Med'],
    region: 'MED',
    unit: '€/mt',
  },
  {
    headingPattern: /Northwest Europe cargoes.*?€\/mt/i,
    basisHeaders: ['FOB NWE', 'CIF NWE/Basis ARA'],
    region: 'NWE',
    unit: '€/mt',
  },
  {
    headingPattern: /Northwest Europe barges.*?€\/mt/i,
    basisHeaders: ['FOB Rotterdam'],
    region: 'NWE',
    unit: '€/mt',
  },
  {
    headingPattern: /FOB Singapore|FOB Arab Gulf|C\+?F Japan|Singapore\s*\(PGA page 200/i,
    basisHeaders: ['FOB Singapore', 'FOB Arab Gulf', 'C+F Japan'],
    region: 'ASIA',
    unit: '$/barrel',
  },
  {
    headingPattern: /feedstocks and blendstocks/i,
    basisHeaders: ['CIF NWE cargo', 'FOB NWE cargo', 'FOB Med cargo', 'CIF Med cargo', 'FOB Rotterdam barge'],
    region: 'NWE',
    unit: '$/mt',
  },
  {
    headingPattern: /European financial derivatives/i,
    basisHeaders: ['Financial'],
    region: 'NWE',
    unit: '$/mt',
  },
];

/**
 * Extract structured assessment rows from a single commentary block.
 * Commentary blocks often contain embedded table data with codes like PAAAI00.
 */
function extractAssessments(text: string): { rows: AssessmentRow[]; remainingText: string } {
  const rows: AssessmentRow[] = [];

  // Determine table context from the text
  let basis = 'Unknown';
  let region: string | null = null;
  let unit = '$/mt';
  for (const cfg of TABLE_CONFIGS) {
    if (cfg.headingPattern.test(text)) {
      basis = cfg.basisHeaders[0];
      region = cfg.region;
      unit = cfg.unit;
      break;
    }
  }

  // Update basis when we see sub-headers like "FOB NWE", "CIF Med" etc.
  const basisUpdateRe = /\b(FOB\s+(?:Med|NWE|Rotterdam|FARAG|West Africa|Singapore|Arab Gulf)|CIF\s+(?:Med|NWE|West Africa|Mediterranean)|STS\s+Lome|C\+?F\s+Japan|CFR\s+(?:South Africa|Europe)|DAP\s+Lagos)\b/gi;

  // Split on tab boundaries to find code+value clusters
  const segments = text.split(/\t/);
  let currentProduct = '';
  let currentBasis = basis;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i].trim();
    if (!seg) continue;

    // Check for basis updates
    const basisMatch = seg.match(basisUpdateRe);
    if (basisMatch) {
      currentBasis = basisMatch[basisMatch.length - 1].trim();
    }

    // Check if segment contains an assessment code
    const codeMatches = [...seg.matchAll(CODE_RE)];
    if (codeMatches.length > 0) {
      for (const cm of codeMatches) {
        const code = cm[1];
        // Everything before the code is potential product name
        const beforeCode = seg.slice(0, cm.index).trim();
        if (beforeCode && !/^\d/.test(beforeCode) && !/^[+-]/.test(beforeCode)) {
          // Filter out noise like page references
          const cleaned = beforeCode.replace(/\(PGA.*?\)/gi, '').replace(/\*+$/g, '').trim();
          if (cleaned && cleaned.length > 1) {
            currentProduct = cleaned;
          }
        }

        // Everything after the code is potential value
        const afterCode = seg.slice((cm.index ?? 0) + code.length).trim();
        let mid: string | null = null;
        let change: string | null = null;
        let range: string | null = null;

        // Try to parse values from remainder of this segment + next segment
        const valuePart = afterCode || (i + 1 < segments.length ? segments[i + 1].trim() : '');
        const qm = valuePart.match(QUOTE_RE);
        if (qm) {
          if (qm[1] && qm[2]) range = `${qm[1]}–${qm[2]}`;
          mid = qm[3];
          change = qm[4];
        } else {
          const sm = valuePart.match(SINGLE_QUOTE_RE);
          if (sm) {
            mid = sm[1];
            change = sm[2];
          } else {
            // Just a single number
            const numMatch = valuePart.match(/^([\d.,]+)/);
            if (numMatch) mid = numMatch[1];
          }
        }

        if (mid || currentProduct) {
          rows.push({
            product: currentProduct || 'Unknown',
            code,
            mid,
            change,
            range,
            basis: currentBasis,
            region,
            unit,
          });
        }
      }
    }
  }

  // Build remaining text by stripping the tabular data parts
  // Keep only sentences that look like prose (no tab-separated values)
  const remaining = text
    .split(/\t/)
    .filter(s => {
      const t = s.trim();
      // Keep if it looks like prose (contains spaces and lowercase)
      return t.length > 20 && /[a-z]/.test(t) && !/^[A-Z0-9]{6,8}$/.test(t);
    })
    .join(' ')
    .trim();

  return { rows, remainingText: remaining };
}

// ═══════════════════════════════════════════════════════════════════════
//  MOC Extraction
// ═══════════════════════════════════════════════════════════════════════

/** Infer market region from section heading text */
function inferMarketRegion(text: string): string | null {
  const upper = text.toUpperCase();
  if (upper.includes('NWE') || upper.includes('NORTHWEST EUROPE') || upper.includes('RDAM') || upper.includes('ROTTERDAM') || upper.includes('FARAG')) return 'NWE';
  if (upper.includes('NORTH SEA') || upper.includes('NSEA')) return 'NSEA';
  if (upper.includes('MED')) return 'MED';
  if (upper.includes('NAPHTHA')) return 'NWE'; // Naphtha PVO defaults to NWE
  if (upper.includes('MIDDIST')) return 'MIDDIST';
  if (upper.includes('WEST AFRICA') || upper.includes('WAF') || upper.includes('LOME')) return 'WAF';
  if (upper.includes('SINGAPORE') || upper.includes('ASIA') || upper.includes('JAPAN')) return 'ASIA';
  if (upper.includes('EU FO') || upper.includes('FUEL OIL')) return 'EU_FO';
  return null;
}

/** Infer market basis from section heading */
function inferMarketBasis(text: string): string | null {
  const upper = text.toUpperCase();
  if (upper.includes('FOB')) return 'FOB';
  if (upper.includes('CIF')) return 'CIF';
  if (upper.includes('STS')) return 'STS';
  if (upper.includes('CFR')) return 'CFR';
  if (upper.includes('DAP')) return 'DAP';
  return null;
}

function extractMocDetails(rawText: string): ParsedMocEntry {
  const entry: ParsedMocEntry = { rawText };

  // Skip TQC/OPTOL metadata lines
  if (/^(TQC:|OPTOL:|SPEC:)/i.test(rawText)) return entry;

  // Extract timestamp (HH:MM:SS)
  const tsMatch = rawText.match(/\((\d{2}:\s?\d{2}:\s?\d{2})\)/);
  if (tsMatch) {
    entry.timestampText = tsMatch[1].replace(/\s/g, '');
  }

  // Extract Company & Action — handle "NO LONGER BIDS/OFFERS" correctly
  const actionMatch = rawText.match(
    /^(.+?)\s+(NO LONGER BIDS|NO LONGER OFFERS|BIDS|OFFERS|SELLS|BUYS)\b/i
  );
  if (actionMatch) {
    let leadingText = actionMatch[1].trim();
    // Strip leading context like "10-25: MARCH 2-6:" or "PLATTS PREM UNL FOB MED CRG:"
    const colonIdx = leadingText.lastIndexOf(':');
    if (colonIdx >= 0) {
      leadingText = leadingText.slice(colonIdx + 1).trim();
    }
    // Take the last word(s) as company name — filter out false positives
    const company = leadingText.replace(/[^A-Za-z0-9\s&'./-]/g, '').trim();
    if (company && !/^(PLATTS|CIF BASIS|FOB BASIS|AT|FOR|THE)$/i.test(company)) {
      entry.company = company;
    }
    entry.action = actionMatch[2].toUpperCase();
  }

  // Extract counterparty from "SELLS TO X" / "BUYS FROM X"
  const cpMatch = rawText.match(/SELLS TO\s+([A-Z0-9&.'()\-/\s]+?)(?:\*|\s+AT\b|\s+FOR\b|\s*\()/i)
    || rawText.match(/BUYS FROM\s+([A-Z0-9&.'()\-/\s]+?)(?:\*|\s+AT\b|\s+FOR\b|\s*\()/i);
  if (cpMatch) {
    entry.counterparty = cpMatch[1].replace(/[^A-Za-z0-9\s&'./-]/g, '').trim();
  }

  // Extract Quantity (e.g., "FOR 27000.0MT", "FOR 100KB")
  const qtyMatch = rawText.match(/FOR\s+([\d.]+\s?[A-Z]{2,4})\b/i);
  if (qtyMatch) {
    entry.quantity = qtyMatch[1].replace(/\s/g, '');
  }

  // Extract Price (e.g., "$-5.00", "$3/MT")
  const priceMatch = rawText.match(/\$(-?[\d.]+(?:\/[A-Za-z]+)?)/);
  if (priceMatch) {
    entry.price = priceMatch[0];
  }

  return entry;
}

// ═══════════════════════════════════════════════════════════════════════
//  Commentary Stitching
// ═══════════════════════════════════════════════════════════════════════

function stitchCommentary(lines: string[]): string[] {
  const stitched: string[] = [];
  let buffer = "";

  for (const line of lines) {
    if (!buffer) {
      buffer = line;
    } else if (buffer.endsWith("-")) {
      buffer = buffer.slice(0, -1) + line;
    } else if (!/[.:!?"]$/.test(buffer)) {
      buffer += " " + line;
    } else {
      stitched.push(buffer);
      buffer = line;
    }
  }
  if (buffer) stitched.push(buffer);

  return stitched;
}

// ═══════════════════════════════════════════════════════════════════════
//  Main Parser
// ═══════════════════════════════════════════════════════════════════════

const MOC_HEADER_RE = /(?:PLATTS\s+[A-Z0-9&.'()\/-]+(?:\s+[A-Z0-9&.'()\/-]+)*\s+)?MOC\s+(TRADES|BIDS|OFFERS|WITHDRAWALS)\s+ON\s+CLOSE/i;
const SIMPLE_HEADER_RE = /^(Trades|Bids|Offers|Withdrawals)(?::\s*(?:None|No .*)?)?\.?$/i;
const COMBINED_HEADER_RE = /^(Bids, Offers, Trades|Offers, Trades|Bids, Offers)$/i;
const COMMENTARY_HEADER_RE = /^(Platts.*?Daily Market Analysis|Platts.*?Rationale|Market Commentary|This assessment commentary applies)/i;

function classifyMocType(line: string): MocSection["type"] | null {
  if (MOC_HEADER_RE.test(line) || SIMPLE_HEADER_RE.test(line) || COMBINED_HEADER_RE.test(line)) {
    if (/TRADES/i.test(line)) return "Trades";
    if (/BIDS/i.test(line)) return "Bids";
    if (/OFFERS/i.test(line)) return "Offers";
    if (/WITHDRAWALS/i.test(line)) return "Withdrawals";
    return "Other";
  }
  return null;
}

export async function parsePlattsPDF(filePath: string): Promise<ReportData> {
  const arrayBuffer = await file(filePath).arrayBuffer();
  const pdfBuffer = Buffer.from(arrayBuffer);

  const parser = new PDFParse({ data: pdfBuffer });
  const result = await parser.getText();
  await parser.destroy();

  const fullText = result.text;
  const lines = fullText.split('\n');

  const report: ReportData = {
    title: "Platts European Marketscan",
    publicationDate: extractPublicationDate(fullText),
    sourceFile: filePath,
    assessments: [],
    commentary: [],
    mocData: [],
  };

  let currentMode: 'TEXT' | 'MOC' = 'TEXT';
  let currentMoc: MocSection | null = null;
  let mocHeadingContext = ''; // accumulates heading text for region inference
  let rawCommentaryLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const cleanLine = lines[i].trim();
    if (!cleanLine) continue;
    if (isDecorativeLine(cleanLine)) continue;

    // -- MOC DETECTION --
    const mocType = classifyMocType(cleanLine);
    if (mocType) {
      currentMode = 'MOC';
      mocHeadingContext = cleanLine;
      currentMoc = {
        type: mocType,
        heading: cleanLine,
        marketRegion: inferMarketRegion(cleanLine),
        marketBasis: inferMarketBasis(cleanLine),
        entries: [],
      };
      report.mocData.push(currentMoc);
      continue;
    }

    // -- MOC ACCUMULATION --
    if (currentMode === 'MOC') {
      // Detect end of MOC section
      if (COMMENTARY_HEADER_RE.test(cleanLine)) {
        currentMode = 'TEXT';
        rawCommentaryLines.push(cleanLine);
      } else if (/^(CIF|FOB)\s+BASIS\b/i.test(cleanLine)) {
        // Context line for MOC — update region/basis
        mocHeadingContext += ' ' + cleanLine;
        if (currentMoc) {
          currentMoc.marketRegion ??= inferMarketRegion(mocHeadingContext);
          currentMoc.marketBasis ??= inferMarketBasis(cleanLine);
        }
      } else {
        currentMoc?.entries.push(extractMocDetails(cleanLine));
      }
      continue;
    }

    // -- STANDARD TEXT --
    if (cleanLine.length > 4) {
      rawCommentaryLines.push(cleanLine);
    }
  }

  // Post-process commentary: stitch broken lines, then strip inline page noise
  const stitched = stitchCommentary(rawCommentaryLines);

  // Separate assessment data from prose commentary
  const cleanCommentary: string[] = [];
  for (const block of stitched) {
    const cleaned = stripInlineNoise(block);
    if (!cleaned) continue;

    // If this block contains tab-separated assessment codes, extract them
    const hasAssessmentCodes = CODE_RE.test(cleaned);
    CODE_RE.lastIndex = 0; // reset global regex
    if (hasAssessmentCodes && cleaned.includes('\t')) {
      const { rows, remainingText } = extractAssessments(cleaned);
      report.assessments.push(...rows);
      if (remainingText && remainingText.length > 30) {
        const prose = stripInlineNoise(remainingText);
        if (prose) cleanCommentary.push(prose);
      }
    } else {
      cleanCommentary.push(cleaned);
    }
  }

  // Filter out commentary lines that are mostly noise
  report.commentary = cleanCommentary.filter(line => {
    if (/^©\s*\d{4}/i.test(line)) return false;
    if (/^Code\s+Mid$/i.test(line)) return false;
    return true;
  });

  return report;
}

// ═══════════════════════════════════════════════════════════════════════
//  CLI Entry Point
// ═══════════════════════════════════════════════════════════════════════

async function run() {
  const inputFilePath = path.join(import.meta.dir, "EUM_20260209.pdf");
  const outputFilePath = path.join(import.meta.dir, "output.json");

  try {
    console.log(`Parsing ${inputFilePath}...`);
    const data = await parsePlattsPDF(inputFilePath);

    await Bun.write(outputFilePath, JSON.stringify(data, null, 2));

    console.log(`Done. ${data.assessments.length} assessments, ${data.mocData.length} MOC sections, ${data.commentary.length} commentary blocks.`);
    console.log(`Publication date: ${data.publicationDate}`);
    console.log(`Saved to ${outputFilePath}`);
  } catch (error) {
    console.error("Error parsing the PDF file.", error);
  }
}

run();

run();