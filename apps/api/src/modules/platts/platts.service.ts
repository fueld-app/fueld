import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type {
  CreatePlattsReportResponseDto,
  PaginatedResponse,
  PlattsReportDetailDto,
  PlattsReportDto,
  PlattsReportEntryDto,
  PlattsReportImportDto,
  PlattsReportSectionDto,
  PlattsSuggestionMatchDto,
  PlattsSuggestionRequestItemDto,
  PlattsSuggestionsResponseDto,
} from '@fueld/types';
import { db } from '../../db';
import {
  plattsReportEntries,
  plattsReportImports,
  plattsReports,
  plattsReportSections,
  users,
} from '../../db/schema';
import { logActivity } from '../activity/activity.service';
import {
  extractPlattsPdfMetadata,
  parsePlattsPdfFile,
  PLATTS_PARSER_VERSION,
  type ParsedPlattsEntry,
} from './platts-parser.service';

const PLATTS_UPLOAD_ROOT = join(process.cwd(), 'uploads', 'platts');

type ReportRow = typeof plattsReports.$inferSelect;

interface ListFilters {
  tenantId: string;
  family?: string;
  from?: string;
  to?: string;
  status?: string;
  search?: string;
  canonicalOnly?: boolean;
  page: number;
  pageSize: number;
}

interface SuggestionScoredEntry {
  entryId: string;
  reportId: string;
  reportTitle: string;
  reportPublicationDate: string;
  sectionType: string;
  sectionHeading: string;
  rawText: string;
  company: string | null;
  counterparty: string | null;
  action: string | null;
  instrument: string | null;
  windowLabel: string | null;
  marketRegion: string | null;
  product: string | null;
  priceRaw: string | null;
  priceValue: number | null;
  quantityRaw: string | null;
  quantityValue: number | null;
  timestampText: string | null;
  confidence: number | null;
  score: number;
}

const parseQueue: string[] = [];
const pendingIds = new Set<string>();
let parseLoopRunning = false;

interface ProductSignalProfile {
  exact: string[];
  broad: string[];
  exclude?: string[];
}

const PRODUCT_SIGNAL_PROFILES: Record<string, ProductSignalProfile> = {
  VLSFO: {
    exact: ['VLSFO', '0.5%S', '0.5% MARINE FUEL', 'LOW SULFUR FUEL OIL', 'LSFO'],
    broad: ['FUEL OIL', 'MARINE FUEL'],
    exclude: ['GASOIL', 'MGO', 'MDO', 'JET', 'NAPHTHA', 'PYGAS'],
  },
  LSMGO: {
    exact: ['LSMGO', 'DMA 10PPM', 'DMA', 'MARINE GASOIL', 'ULSD 10PPM'],
    broad: ['GASOIL'],
    exclude: ['FUEL OIL', 'VLSFO', 'HSFO', 'JET', 'NAPHTHA'],
  },
  MGO: {
    exact: ['MGO', 'MARINE GASOIL', 'DMA'],
    broad: ['GASOIL'],
    exclude: ['FUEL OIL', 'VLSFO', 'HSFO', 'JET', 'NAPHTHA'],
  },
  MDO: {
    exact: ['MDO', 'MARINE DIESEL'],
    broad: ['GASOIL', 'DIESEL'],
    exclude: ['FUEL OIL', 'VLSFO', 'HSFO', 'JET', 'NAPHTHA'],
  },
  IFO380CST: {
    exact: ['IFO 380', '380 CST', '380CST', 'HSFO 380', '3.5%S FUEL OIL'],
    broad: ['HSFO', 'FUEL OIL'],
    exclude: ['VLSFO', '0.5%S', 'GASOIL', 'MGO', 'JET'],
  },
  IFO180CST: {
    exact: ['IFO 180', '180 CST', '180CST', 'HSFO 180'],
    broad: ['HSFO', 'FUEL OIL'],
    exclude: ['VLSFO', '0.5%S', 'GASOIL', 'MGO', 'JET'],
  },
  IFO120CST: {
    exact: ['IFO 120', '120 CST', '120CST'],
    broad: ['FUEL OIL'],
    exclude: ['VLSFO', '0.5%S', 'GASOIL', 'MGO', 'JET'],
  },
  IFO30CST: {
    exact: ['IFO 30', '30 CST', '30CST'],
    broad: ['FUEL OIL'],
    exclude: ['GASOIL', 'MGO', 'JET'],
  },
  IFO: {
    exact: ['IFO', 'HSFO'],
    broad: ['FUEL OIL'],
    exclude: ['GASOIL', 'MGO', 'JET'],
  },
  LSIFO: {
    exact: ['LSIFO', 'LOW SULFUR FUEL OIL'],
    broad: ['FUEL OIL'],
    exclude: ['GASOIL', 'MGO', 'JET'],
  },
  CUTTERSTOCK: {
    exact: ['CUTTERSTOCK'],
    broad: ['FUEL OIL'],
    exclude: ['GASOIL', 'JET'],
  },
  PYGAS: {
    exact: ['PYGAS', 'PYROLYSIS GASOLINE'],
    broad: ['GASOLINE'],
    exclude: ['FUEL OIL', 'GASOIL', 'JET'],
  },
  LUBE: {
    exact: ['LUBE', 'LUBRICANT'],
    broad: [],
    exclude: ['FUEL OIL', 'GASOIL', 'JET'],
  },
};

function resolveStoredPath(relativePath: string): string {
  return join(process.cwd(), relativePath);
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    const candidate = 'message' in error ? error.message : null;
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate;
    }

    const code = 'code' in error ? error.code : null;
    const detail = 'detail' in error ? error.detail : null;
    const parts = [code, detail]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
    if (parts.length > 0) {
      return parts.join(': ');
    }
  }

  if (typeof error === 'string' && error.trim().length > 0) {
    return error;
  }

  return fallback;
}

function normalizeFilename(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function buildReportDto(row: ReportRow & { uploadedByName?: string | null }): PlattsReportDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    family: row.family as PlattsReportDto['family'],
    publicationDate: row.publicationDate,
    title: row.title,
    sourceFileName: row.sourceFileName,
    sourceMimeType: row.sourceMimeType,
    sourceFileSize: row.sourceFileSize,
    uploadedBy: row.uploadedBy,
    uploadedByName: row.uploadedByName ?? null,
    status: row.status as PlattsReportDto['status'],
    parserVersion: row.parserVersion,
    parseError: row.parseError,
    isCanonical: row.isCanonical,
    supersededByReportId: row.supersededByReportId,
    parsedAt: toIso(row.parsedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildImportDto(row: typeof plattsReportImports.$inferSelect): PlattsReportImportDto {
  return {
    id: row.id,
    reportId: row.reportId,
    importMode: row.importMode,
    importBatchId: row.importBatchId,
    sha256Hex: row.sha256Hex,
    notes: row.notes,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function parseNumeric(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/-?[\d,.]+/);
  if (!match) return null;
  const parsed = Number(match[0]!.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseUnit(value: string | undefined): string | null {
  if (!value) return null;
  const slashMatch = value.match(/\/\s*([A-Za-z]+)/);
  if (slashMatch) return slashMatch[1]!.toUpperCase();
  const unitMatch = value.match(/([A-Z]{1,6})$/);
  return unitMatch ? unitMatch[1]!.toUpperCase() : null;
}

function isoDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function tokenizeSearchText(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9%]+/g, ' ')
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function getProductSignalProfile(productType: string): ProductSignalProfile {
  return PRODUCT_SIGNAL_PROFILES[productType] ?? {
    exact: [productType],
    broad: [],
    exclude: [],
  };
}

function scoreSuggestionEntry(item: PlattsSuggestionRequestItemDto, entry: {
  rawText: string;
  instrument: string | null;
  windowLabel: string | null;
  marketRegion: string | null;
  product: string | null;
  company: string | null;
  action: string | null;
  priceRaw: string | null;
  quantityRaw: string | null;
  confidence: number | null;
  sectionHeading: string;
}): number {
  const profile = getProductSignalProfile(item.productType);
  const descriptionKeywords = tokenizeSearchText(item.description);
  const haystack = [
    entry.rawText,
    entry.instrument,
    entry.windowLabel,
    entry.marketRegion,
    entry.product,
    entry.sectionHeading,
  ]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();

  let score = 0;
  for (const keyword of profile.exact) {
    if (haystack.includes(keyword)) {
      score += keyword.length >= 6 ? 30 : 20;
    }
  }

  for (const keyword of profile.broad) {
    if (haystack.includes(keyword)) {
      score += 10;
    }
  }

  for (const keyword of descriptionKeywords) {
    if (haystack.includes(keyword)) {
      score += keyword.length >= 6 ? 12 : 6;
    }
  }

  for (const keyword of profile.exclude ?? []) {
    if (haystack.includes(keyword)) {
      score -= 24;
    }
  }

  if (entry.company && entry.action) score += 20;
  if (entry.priceRaw) score += 8;
  if (entry.quantityRaw) score += 6;
  if (entry.confidence != null) score += Math.round(entry.confidence * 10);

  return score;
}

async function findBestCanonicalReport(tenantId: string, family: ReportRow['family'], requestedPublicationDate: string): Promise<ReportRow | null> {
  const [datedMatch] = await db
    .select()
    .from(plattsReports)
    .where(and(
      eq(plattsReports.tenantId, tenantId),
      eq(plattsReports.family, family),
      eq(plattsReports.isCanonical, true),
      eq(plattsReports.status, 'READY'),
      sql`${plattsReports.publicationDate} <= ${requestedPublicationDate}`,
    ))
    .orderBy(desc(plattsReports.publicationDate), desc(plattsReports.createdAt))
    .limit(1);

  if (datedMatch) return datedMatch;

  const [fallback] = await db
    .select()
    .from(plattsReports)
    .where(and(
      eq(plattsReports.tenantId, tenantId),
      eq(plattsReports.family, family),
      eq(plattsReports.isCanonical, true),
      eq(plattsReports.status, 'READY'),
    ))
    .orderBy(desc(plattsReports.publicationDate), desc(plattsReports.createdAt))
    .limit(1);

  return fallback ?? null;
}

function toSuggestionMatch(entry: SuggestionScoredEntry): PlattsSuggestionMatchDto {
  return {
    entryId: entry.entryId,
    reportId: entry.reportId,
    reportTitle: entry.reportTitle,
    reportPublicationDate: entry.reportPublicationDate,
    sectionType: entry.sectionType as PlattsSuggestionMatchDto['sectionType'],
    sectionHeading: entry.sectionHeading,
    rawText: entry.rawText,
    company: entry.company,
    counterparty: entry.counterparty,
    action: entry.action,
    instrument: entry.instrument,
    windowLabel: entry.windowLabel,
    marketRegion: entry.marketRegion,
    product: entry.product,
    priceRaw: entry.priceRaw,
    priceValue: entry.priceValue,
    quantityRaw: entry.quantityRaw,
    quantityValue: entry.quantityValue,
    timestampText: entry.timestampText,
    confidence: entry.confidence,
    score: entry.score,
  };
}

function inferProduct(text: string | null): string | null {
  if (!text) return null;
  const upper = text.toUpperCase();
  if (upper.includes('BRENT')) return 'BRENT';
  if (upper.includes('BFOE')) return 'BFOE';
  if (upper.includes('ULSD')) return 'ULSD';
  if (upper.includes('NAPHTHA')) return 'NAPHTHA';
  if (upper.includes('GASOIL')) return 'GASOIL';
  if (upper.includes('MARINE FUEL')) return 'MARINE_FUEL';
  if (upper.includes('FUEL OIL')) return 'FUEL_OIL';
  if (upper.includes('WTI MIDLAND')) return 'WTI_MIDLAND';
  return null;
}

function inferMarketRegion(text: string | null): string | null {
  if (!text) return null;
  const upper = text.toUpperCase();
  if (upper.includes('NWE')) return 'NWE';
  if (upper.includes('NSEA') || upper.includes('NORTH SEA')) return 'NSEA';
  if (upper.includes('MED')) return 'MED';
  if (upper.includes('EU FO')) return 'EU_FO';
  if (upper.includes('MIDDIST')) return 'MIDDIST';
  return null;
}

function classifyEntryKind(entry: ParsedPlattsEntry): string {
  if (entry.company && entry.action) return 'STRUCTURED';
  if (/^PLATTS /i.test(entry.rawText)) return 'INSTRUMENT_CONTEXT';
  if (/BASIS/i.test(entry.rawText)) return 'MARKET_CONTEXT';
  if (/^NO\s+(TRADES|BIDS|OFFERS|WITHDRAWALS)\s+REPORTED$/i.test(entry.rawText)) return 'STATUS_LINE';
  return 'RAW';
}

function parseInstrumentLine(rawText: string): { instrument: string | null; windowLabel: string | null } {
  if (!/^PLATTS /i.test(rawText)) {
    return { instrument: null, windowLabel: null };
  }

  const parts = rawText.split(':').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { instrument: rawText, windowLabel: null };
  if (parts.length === 1) return { instrument: parts[0]!, windowLabel: null };
  return {
    instrument: parts[0]!,
    windowLabel: parts.slice(1).join(': '),
  };
}

async function getReportRow(tenantId: string, reportId: string): Promise<(ReportRow & { uploadedByName?: string | null }) | null> {
  const [row] = await db
    .select({
      id: plattsReports.id,
      tenantId: plattsReports.tenantId,
      family: plattsReports.family,
      publicationDate: plattsReports.publicationDate,
      title: plattsReports.title,
      sourceFileName: plattsReports.sourceFileName,
      sourceFilePath: plattsReports.sourceFilePath,
      sourceMimeType: plattsReports.sourceMimeType,
      sourceFileSize: plattsReports.sourceFileSize,
      uploadedBy: plattsReports.uploadedBy,
      status: plattsReports.status,
      parserVersion: plattsReports.parserVersion,
      parseError: plattsReports.parseError,
      commentary: plattsReports.commentary,
      isCanonical: plattsReports.isCanonical,
      supersededByReportId: plattsReports.supersededByReportId,
      parsedAt: plattsReports.parsedAt,
      createdAt: plattsReports.createdAt,
      updatedAt: plattsReports.updatedAt,
      uploadedByName: users.name,
    })
    .from(plattsReports)
    .leftJoin(users, eq(plattsReports.uploadedBy, users.id))
    .where(and(eq(plattsReports.id, reportId), eq(plattsReports.tenantId, tenantId)))
    .limit(1);

  return row ?? null;
}

async function markReportStatus(reportId: string, status: ReportRow['status'], parseError?: string | null): Promise<void> {
  await db
    .update(plattsReports)
    .set({
      status,
      parseError: parseError ?? null,
      parserVersion: PLATTS_PARSER_VERSION,
      updatedAt: new Date(),
      parsedAt: status === 'READY' ? new Date() : null,
    })
    .where(eq(plattsReports.id, reportId));
}

function buildEntryDto(row: typeof plattsReportEntries.$inferSelect): PlattsReportEntryDto {
  return {
    id: row.id,
    reportId: row.reportId,
    sectionId: row.sectionId,
    sortOrder: row.sortOrder,
    rawText: row.rawText,
    entryKind: row.entryKind,
    marketRegion: row.marketRegion,
    marketBasis: row.marketBasis,
    instrument: row.instrument,
    product: row.product,
    windowLabel: row.windowLabel,
    company: row.company,
    counterparty: row.counterparty,
    action: row.action,
    priceRaw: row.priceRaw,
    priceValue: row.priceValue,
    priceUnit: row.priceUnit,
    quantityRaw: row.quantityRaw,
    quantityValue: row.quantityValue,
    quantityUnit: row.quantityUnit,
    timestampText: row.timestampText,
    confidence: row.confidence,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  };
}

async function persistParsedReport(report: ReportRow, parsed: Awaited<ReturnType<typeof parsePlattsPdfFile>>): Promise<void> {
  await db.delete(plattsReportEntries).where(eq(plattsReportEntries.reportId, report.id));
  await db.delete(plattsReportSections).where(eq(plattsReportSections.reportId, report.id));

  await db
    .update(plattsReports)
    .set({
      title: parsed.title,
      publicationDate: parsed.publicationDate,
      commentary: parsed.commentary,
      parserVersion: PLATTS_PARSER_VERSION,
      parseError: null,
      status: 'READY',
      parsedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(plattsReports.id, report.id));

  for (let sectionIndex = 0; sectionIndex < parsed.sections.length; sectionIndex += 1) {
    const section = parsed.sections[sectionIndex]!;
    const [insertedSection] = await db
      .insert(plattsReportSections)
      .values({
        reportId: report.id,
        sortOrder: sectionIndex,
        type: section.type,
        heading: section.heading,
      })
      .returning();

    let currentMarketBasis: string | null = null;
    let currentInstrument: string | null = null;
    let currentWindowLabel: string | null = null;
    let currentMarketRegion: string | null = inferMarketRegion(section.heading);
    let currentProduct: string | null = inferProduct(section.heading);

    for (let entryIndex = 0; entryIndex < section.entries.length; entryIndex += 1) {
      const entry = section.entries[entryIndex]!;

      if (/BASIS/i.test(entry.rawText)) {
        currentMarketBasis = entry.rawText;
        currentMarketRegion = inferMarketRegion(entry.rawText) ?? currentMarketRegion;
      }

      const instrumentLine = parseInstrumentLine(entry.rawText);
      if (instrumentLine.instrument) {
        currentInstrument = instrumentLine.instrument;
        currentWindowLabel = instrumentLine.windowLabel;
        currentMarketRegion = inferMarketRegion(entry.rawText) ?? currentMarketRegion;
        currentProduct = inferProduct(entry.rawText) ?? currentProduct;
      }

      const priceRaw = entry.price ?? null;
      const quantityRaw = entry.quantity ?? null;
      await db.insert(plattsReportEntries).values({
        reportId: report.id,
        sectionId: insertedSection.id,
        sortOrder: entryIndex,
        rawText: entry.rawText,
        entryKind: classifyEntryKind(entry),
        marketRegion: currentMarketRegion,
        marketBasis: currentMarketBasis,
        instrument: currentInstrument,
        product: currentProduct,
        windowLabel: currentWindowLabel,
        company: entry.company ?? null,
        counterparty: entry.counterparty ?? null,
        action: entry.action ?? null,
        priceRaw,
        priceValue: parseNumeric(priceRaw ?? undefined),
        priceUnit: parseUnit(priceRaw ?? undefined),
        quantityRaw,
        quantityValue: parseNumeric(quantityRaw ?? undefined),
        quantityUnit: parseUnit(quantityRaw ?? undefined),
        timestampText: entry.timestampText ?? null,
        confidence: entry.company && entry.action ? 0.95 : instrumentLine.instrument ? 0.85 : currentMarketBasis ? 0.75 : null,
        metadata: {
          sectionHeading: section.heading,
        },
      });
    }
  }
}

async function parseSingleReport(reportId: string): Promise<void> {
  const [report] = await db.select().from(plattsReports).where(eq(plattsReports.id, reportId)).limit(1);
  if (!report) return;

  try {
    await db
      .update(plattsReports)
      .set({
        status: 'PARSING',
        parseError: null,
        parserVersion: PLATTS_PARSER_VERSION,
        updatedAt: new Date(),
      })
      .where(eq(plattsReports.id, reportId));

    const parsed = await parsePlattsPdfFile(resolveStoredPath(report.sourceFilePath));
    await persistParsedReport(report, parsed);
  } catch (error) {
    const message = getErrorMessage(error, 'Unknown parse failure');
    await markReportStatus(reportId, 'FAILED', message);
  }
}

async function runParseLoop(): Promise<void> {
  if (parseLoopRunning) return;
  parseLoopRunning = true;

  try {
    while (parseQueue.length > 0) {
      const reportId = parseQueue.shift();
      if (!reportId) continue;
      pendingIds.delete(reportId);
      await parseSingleReport(reportId);
    }
  } finally {
    parseLoopRunning = false;
  }
}

export function enqueuePlattsParse(reportId: string): void {
  if (pendingIds.has(reportId)) return;
  pendingIds.add(reportId);
  parseQueue.push(reportId);
  void runParseLoop();
}

export async function resumePendingPlattsParseJobs(): Promise<void> {
  const pending = await db
    .select({ id: plattsReports.id })
    .from(plattsReports)
    .where(or(eq(plattsReports.status, 'UPLOADED'), eq(plattsReports.status, 'PARSING')));

  for (const report of pending) {
    enqueuePlattsParse(report.id);
  }
}

export async function createPlattsReportFromUpload(params: {
  tenantId: string;
  userId: string;
  file: File;
  family?: ReportRow['family'];
  importMode?: string;
  importBatchId?: string | null;
  notes?: string | null;
}): Promise<CreatePlattsReportResponseDto> {
  if (params.file.type !== 'application/pdf') {
    throw new Error('Only PDF files are allowed');
  }

  if (params.file.size > 25 * 1024 * 1024) {
    throw new Error('Platts PDF must be under 25 MB');
  }

  const reportId = randomUUID();
  const tenantSegment = params.tenantId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileBuffer = Buffer.from(await params.file.arrayBuffer());
  const fileHash = createHash('sha256').update(fileBuffer).digest('hex');
  const fileName = normalizeFilename(params.file.name || 'platts.pdf');
  const storedRelativePath = join('uploads', 'platts', tenantSegment, reportId, 'source.pdf');
  const storedAbsolutePath = resolveStoredPath(storedRelativePath);

  try {
    await mkdir(dirname(storedAbsolutePath), { recursive: true });
    await Bun.write(storedAbsolutePath, fileBuffer);
  } catch (error) {
    throw new Error(`Failed to save uploaded PDF to storage: ${getErrorMessage(error, 'Unknown filesystem error')}`);
  }

  let metadata: Awaited<ReturnType<typeof extractPlattsPdfMetadata>>;
  try {
    metadata = await extractPlattsPdfMetadata(storedAbsolutePath);
  } catch (error) {
    throw new Error(`Failed to read uploaded PDF metadata: ${getErrorMessage(error, 'Unknown PDF parsing error')}`);
  }

  const family = params.family ?? 'EUROPEAN_MARKETSCAN';
  const warnings: string[] = [];

  let existingCanonical: { id: string } | undefined;
  try {
    [existingCanonical] = await db
      .select({ id: plattsReports.id })
      .from(plattsReports)
      .where(and(
        eq(plattsReports.tenantId, params.tenantId),
        eq(plattsReports.family, family),
        eq(plattsReports.publicationDate, metadata.publicationDate),
        eq(plattsReports.isCanonical, true),
      ))
      .limit(1);
  } catch (error) {
    throw new Error(`Failed to check existing Platts reports: ${getErrorMessage(error, 'Unknown database error')}`);
  }

  if (existingCanonical) {
    warnings.push('A canonical Platts report already exists for this publication date. This upload was saved as non-canonical history.');
  }

  let insertedReport: typeof plattsReports.$inferSelect;
  try {
    [insertedReport] = await db
      .insert(plattsReports)
      .values({
        id: reportId,
        tenantId: params.tenantId,
        family,
        publicationDate: metadata.publicationDate,
        title: metadata.title,
        sourceFileName: fileName,
        sourceFilePath: storedRelativePath,
        sourceMimeType: params.file.type || 'application/pdf',
        sourceFileSize: params.file.size,
        uploadedBy: params.userId,
        status: 'UPLOADED',
        parserVersion: PLATTS_PARSER_VERSION,
        isCanonical: existingCanonical == null,
        commentary: [],
      })
      .returning();

    await db.insert(plattsReportImports).values({
      reportId,
      importMode: params.importMode ?? 'single',
      importBatchId: params.importBatchId ?? null,
      sha256Hex: fileHash,
      uploadedBy: params.userId,
      notes: params.notes ?? null,
    });
  } catch (error) {
    throw new Error(`Failed to store Platts report record: ${getErrorMessage(error, 'Unknown database error')}`);
  }

  await logActivity({
    tenantId: params.tenantId,
    userId: params.userId,
    action: 'CREATE',
    entityType: 'platts_report',
    entityId: reportId,
    entityName: metadata.title,
    metadata: {
      publicationDate: metadata.publicationDate,
      fileName,
      canonical: existingCanonical == null,
      warnings,
    },
  });

  enqueuePlattsParse(reportId);

  return {
    report: buildReportDto({ ...insertedReport, uploadedByName: null }),
    warnings,
  };
}

export async function listPlattsReports(filters: ListFilters): Promise<PaginatedResponse<PlattsReportDto>> {
  const conditions = [eq(plattsReports.tenantId, filters.tenantId)];

  if (filters.family) conditions.push(eq(plattsReports.family, filters.family as ReportRow['family']));
  if (filters.status) conditions.push(eq(plattsReports.status, filters.status as ReportRow['status']));
  if (filters.canonicalOnly) conditions.push(eq(plattsReports.isCanonical, true));
  if (filters.from) conditions.push(sql`${plattsReports.publicationDate} >= ${filters.from}`);
  if (filters.to) conditions.push(sql`${plattsReports.publicationDate} <= ${filters.to}`);
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    conditions.push(or(ilike(plattsReports.title, pattern), ilike(plattsReports.sourceFileName, pattern))!);
  }

  const whereClause = and(...conditions);
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(plattsReports)
    .where(whereClause);

  const rows = await db
    .select({
      id: plattsReports.id,
      tenantId: plattsReports.tenantId,
      family: plattsReports.family,
      publicationDate: plattsReports.publicationDate,
      title: plattsReports.title,
      sourceFileName: plattsReports.sourceFileName,
      sourceFilePath: plattsReports.sourceFilePath,
      sourceMimeType: plattsReports.sourceMimeType,
      sourceFileSize: plattsReports.sourceFileSize,
      uploadedBy: plattsReports.uploadedBy,
      status: plattsReports.status,
      parserVersion: plattsReports.parserVersion,
      parseError: plattsReports.parseError,
      commentary: plattsReports.commentary,
      isCanonical: plattsReports.isCanonical,
      supersededByReportId: plattsReports.supersededByReportId,
      parsedAt: plattsReports.parsedAt,
      createdAt: plattsReports.createdAt,
      updatedAt: plattsReports.updatedAt,
      uploadedByName: users.name,
    })
    .from(plattsReports)
    .leftJoin(users, eq(plattsReports.uploadedBy, users.id))
    .where(whereClause)
    .orderBy(desc(plattsReports.publicationDate), desc(plattsReports.createdAt))
    .limit(filters.pageSize)
    .offset((filters.page - 1) * filters.pageSize);

  return {
    items: rows.map((row) => buildReportDto(row)),
    total: total ?? 0,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

export async function getPlattsReportDetail(tenantId: string, reportId: string): Promise<PlattsReportDetailDto | null> {
  const report = await getReportRow(tenantId, reportId);
  if (!report) return null;

  const sections = await db
    .select()
    .from(plattsReportSections)
    .where(eq(plattsReportSections.reportId, reportId))
    .orderBy(asc(plattsReportSections.sortOrder));

  const entries = await db
    .select()
    .from(plattsReportEntries)
    .where(eq(plattsReportEntries.reportId, reportId))
    .orderBy(asc(plattsReportEntries.sortOrder));

  const imports = await db
    .select()
    .from(plattsReportImports)
    .where(eq(plattsReportImports.reportId, reportId))
    .orderBy(desc(plattsReportImports.createdAt));

  const entriesBySection = new Map<string, PlattsReportEntryDto[]>();
  for (const entry of entries) {
    const bucket = entriesBySection.get(entry.sectionId) ?? [];
    bucket.push(buildEntryDto(entry));
    entriesBySection.set(entry.sectionId, bucket);
  }

  const sectionDtos: PlattsReportSectionDto[] = sections.map((section) => ({
    id: section.id,
    reportId: section.reportId,
    sortOrder: section.sortOrder,
    type: section.type as PlattsReportSectionDto['type'],
    heading: section.heading,
    entries: entriesBySection.get(section.id) ?? [],
  }));

  return {
    ...buildReportDto(report),
    commentary: Array.isArray(report.commentary) ? report.commentary : [],
    sections: sectionDtos,
    imports: imports.map(buildImportDto),
  };
}

export async function getPlattsReportSource(tenantId: string, reportId: string): Promise<{ file: Bun.BunFile; fileName: string } | null> {
  const report = await getReportRow(tenantId, reportId);
  if (!report) return null;
  const file = Bun.file(resolveStoredPath(report.sourceFilePath));
  if (!(await file.exists())) return null;
  return { file, fileName: report.sourceFileName };
}

export async function enqueuePlattsReparse(tenantId: string, reportId: string, userId: string): Promise<PlattsReportDto | null> {
  const report = await getReportRow(tenantId, reportId);
  if (!report) return null;

  await db
    .update(plattsReports)
    .set({
      status: 'UPLOADED',
      parseError: null,
      parserVersion: PLATTS_PARSER_VERSION,
      updatedAt: new Date(),
    })
    .where(eq(plattsReports.id, reportId));

  await logActivity({
    tenantId,
    userId,
    action: 'UPDATE',
    entityType: 'platts_report',
    entityId: reportId,
    entityName: report.title,
    metadata: { event: 'reparse-requested' },
  });

  enqueuePlattsParse(reportId);
  const updated = await getReportRow(tenantId, reportId);
  return updated ? buildReportDto(updated) : null;
}

export async function replaceCanonicalPlattsReport(tenantId: string, reportId: string, userId: string): Promise<PlattsReportDto | null> {
  const report = await getReportRow(tenantId, reportId);
  if (!report) return null;
  if (report.status !== 'READY') {
    throw new Error('Only ready reports can become canonical');
  }

  const [currentCanonical] = await db
    .select()
    .from(plattsReports)
    .where(and(
      eq(plattsReports.tenantId, tenantId),
      eq(plattsReports.family, report.family),
      eq(plattsReports.publicationDate, report.publicationDate),
      eq(plattsReports.isCanonical, true),
    ))
    .limit(1);

  if (currentCanonical && currentCanonical.id !== report.id) {
    await db
      .update(plattsReports)
      .set({
        isCanonical: false,
        status: 'SUPERSEDED',
        supersededByReportId: report.id,
        updatedAt: new Date(),
      })
      .where(eq(plattsReports.id, currentCanonical.id));
  }

  await db
    .update(plattsReports)
    .set({
      isCanonical: true,
      status: 'READY',
      supersededByReportId: null,
      updatedAt: new Date(),
    })
    .where(eq(plattsReports.id, report.id));

  await logActivity({
    tenantId,
    userId,
    action: 'UPDATE',
    entityType: 'platts_report',
    entityId: report.id,
    entityName: report.title,
    metadata: {
      event: 'replace-canonical',
      publicationDate: report.publicationDate,
      replacedReportId: currentCanonical?.id ?? null,
    },
  });

  const updated = await getReportRow(tenantId, report.id);
  return updated ? buildReportDto(updated) : null;
}

export async function getCanonicalPlattsReport(tenantId: string, family: string, publicationDate: string): Promise<PlattsReportDetailDto | null> {
  const [canonical] = await db
    .select({ id: plattsReports.id })
    .from(plattsReports)
    .where(and(
      eq(plattsReports.tenantId, tenantId),
      eq(plattsReports.family, family as ReportRow['family']),
      eq(plattsReports.publicationDate, publicationDate),
      eq(plattsReports.isCanonical, true),
    ))
    .limit(1);

  if (!canonical) return null;
  return getPlattsReportDetail(tenantId, canonical.id);
}

export async function getPlattsSuggestions(params: {
  tenantId: string;
  publicationDate?: string | null;
  family?: ReportRow['family'];
  items: PlattsSuggestionRequestItemDto[];
  limitPerItem?: number;
}): Promise<PlattsSuggestionsResponseDto> {
  const family = params.family ?? 'EUROPEAN_MARKETSCAN';
  const requestedPublicationDate = params.publicationDate && /^\d{4}-\d{2}-\d{2}$/.test(params.publicationDate)
    ? params.publicationDate
    : isoDateOnly(new Date());
  const limitPerItem = Math.max(1, Math.min(params.limitPerItem ?? 5, 10));
  const cleanItems = params.items
    .filter((item) => item.key && item.productType)
    .map((item) => ({
      key: item.key,
      productType: item.productType,
      description: item.description?.trim() || null,
    }));

  const report = await findBestCanonicalReport(params.tenantId, family, requestedPublicationDate);
  if (!report || cleanItems.length === 0) {
    return {
      family: family as PlattsSuggestionsResponseDto['family'],
      requestedPublicationDate,
      matchedPublicationDate: null,
      reportId: null,
      reportTitle: null,
      usedFallbackReport: false,
      items: cleanItems.map((item) => ({
        key: item.key,
        productType: item.productType as PlattsSuggestionsResponseDto['items'][number]['productType'],
        description: item.description,
        matches: [],
      })),
    };
  }

  const rows = await db
    .select({
      entryId: plattsReportEntries.id,
      reportId: plattsReportEntries.reportId,
      rawText: plattsReportEntries.rawText,
      company: plattsReportEntries.company,
      counterparty: plattsReportEntries.counterparty,
      action: plattsReportEntries.action,
      instrument: plattsReportEntries.instrument,
      windowLabel: plattsReportEntries.windowLabel,
      marketRegion: plattsReportEntries.marketRegion,
      product: plattsReportEntries.product,
      priceRaw: plattsReportEntries.priceRaw,
      priceValue: plattsReportEntries.priceValue,
      quantityRaw: plattsReportEntries.quantityRaw,
      quantityValue: plattsReportEntries.quantityValue,
      timestampText: plattsReportEntries.timestampText,
      confidence: plattsReportEntries.confidence,
      sectionType: plattsReportSections.type,
      sectionHeading: plattsReportSections.heading,
    })
    .from(plattsReportEntries)
    .innerJoin(plattsReportSections, eq(plattsReportEntries.sectionId, plattsReportSections.id))
    .where(and(
      eq(plattsReportEntries.reportId, report.id),
      or(eq(plattsReportEntries.entryKind, 'STRUCTURED'), eq(plattsReportEntries.entryKind, 'RAW')),
    ))
    .orderBy(asc(plattsReportSections.sortOrder), asc(plattsReportEntries.sortOrder));

  const items = cleanItems.map((item) => {
    const scored = rows
      .map((row) => ({
        ...row,
        reportTitle: report.title,
        reportPublicationDate: report.publicationDate,
        score: scoreSuggestionEntry(item, row),
      }))
      .filter((row) => row.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limitPerItem)
      .map(toSuggestionMatch);

    return {
      key: item.key,
      productType: item.productType as PlattsSuggestionsResponseDto['items'][number]['productType'],
      description: item.description,
      matches: scored,
    };
  });

  return {
    family: family as PlattsSuggestionsResponseDto['family'],
    requestedPublicationDate,
    matchedPublicationDate: report.publicationDate,
    reportId: report.id,
    reportTitle: report.title,
    usedFallbackReport: report.publicationDate !== requestedPublicationDate,
    items,
  };
}