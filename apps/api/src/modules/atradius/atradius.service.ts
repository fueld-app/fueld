/**
 * Atradius insurance cover — monthly Excel import (tenant-gated feature).
 *
 * Pierre (Riviera Marine) exports the Atradius policy/cover state every month
 * and uploads it here. Each upload REPLACES the previous tenant's buyer rows
 * (audit trail kept in atradius_imports). Buyers are matched to counterparties
 * by stable Atradius buyer number (persisted mapping), then exact name.
 */
import * as XLSX from 'xlsx';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  atradiusBuyers,
  atradiusImports,
  counterparties,
  users,
} from '../../db/schema';

// ── Status normalization ────────────────────────────────────────────────
// Active: coverage currently in force. Inactive: refused / cancelled /
// future-cancellation / no-increase decisions (the still-valid original
// Approuvée row stays in the export, so latest-wins per buyer number keeps
// the active cover). 'Réduite' is active — col AE already reflects the
// reduced amount. Rows whose end date has passed are inactive regardless.
const STATUS_MAP: Record<string, { normalized: string; active: boolean }> = {
  'approuvée': { normalized: 'APPROVED', active: true },
  'partiellement acceptée': { normalized: 'PARTIAL', active: true },
  'réémise': { normalized: 'REISSUED', active: true },
  'réduite': { normalized: 'REDUCED', active: true },
  'conditions de couverture modifiées': { normalized: 'MODIFIED', active: true },
  'refusée': { normalized: 'REFUSED', active: false },
  'annulée': { normalized: 'CANCELLED', active: false },
  'annulation future': { normalized: 'FUTURE_CANCEL', active: false },
  "pas d'augmentation de couverture": { normalized: 'NO_INCREASE', active: false },
};

const HEADER_ALIASES: Record<string, string[]> = {
  buyerNumber: ["n° d'acheteur", "no d'acheteur", "n°d'acheteur", "numéro d'acheteur"],
  buyerName: ["nom de l'acheteur"],
  coverAmount: ['montant total de la décision dans la devise de la police'],
  status: ['statut de la couverture'],
  decisionDate: ['date de la décision'],
  endDate: ['date de fin'],
  currency: ['code devise de la police', 'devise de la police'],
};

function normalizeHeader(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\u00a0/g, ' ') // non-breaking spaces from Excel
    .trim();
}

/** Resolve columns by header name (with expected-letter fallback). */
function resolveColumns(headerRow: Record<string, unknown>): Record<string, string> {
  const letters = Object.keys(headerRow);
  const byNormalized = new Map<string, string>();
  for (const letter of letters) {
    byNormalized.set(normalizeHeader(headerRow[letter]), letter);
  }
  const resolved: Record<string, string> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    let letter = aliases.map((a) => byNormalized.get(normalizeHeader(a))).find(Boolean);
    // Letter-position fallback deliberately NOT implemented: a missing header
    // should fail the import loudly (clear error) rather than guess columns.
    if (letter) resolved[field] = letter;
  }
  return resolved;
}

export interface ImportSummary {
  importId: string;
  rowCount: number;
  matchedCount: number;
  unmatchedCount: number;
  unmatched: Array<{
    id: string;
    buyerNumber: string;
    buyerName: string;
    coverAmount: string;
    statusRaw: string;
    suggestedCounterpartyId: string | null;
  }>;
  replaced: boolean;
}

function toIsoDate(value: unknown): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    // Excel serial date (1900 epoch, accounting for the 1900 leap-year bug)
    const ms = Math.round((value - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }
  return null;
}

export async function importAtradiusFile(opts: {
  tenantId: string;
  userId: string;
  fileName: string;
  file: File;
}): Promise<ImportSummary> {
  const buf = Buffer.from(await opts.file.arrayBuffer());
  const workbook = XLSX.read(buf, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('The file has no sheets');

  // Row 1 = headers; read as letter-keyed object-of-arrays.
  const rowsByLetter = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
  });
  if (rowsByLetter.length < 2) throw new Error('The file has no data rows');

  const headerRow: Record<string, unknown> = {};
  const headerCells = rowsByLetter[0] ?? [];
  headerCells.forEach((cell, idx) => {
    // Column letter (A, B, ... AE) — Atradius exports go past Z, so compute
    // bijective base-26 like Excel does.
    let n = idx;
    let letter = '';
    do {
      letter = String.fromCharCode(65 + (n % 26)) + letter;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    headerRow[letter] = cell;
  });

  const cols = resolveColumns(headerRow);
  for (const required of ['buyerNumber', 'buyerName', 'coverAmount', 'status']) {
    if (!cols[required]) {
      throw new Error(`Could not locate the "${required}" column by header — is this an Atradius policy export?`);
    }
  }

  // Counterparties for matching (exact normalized name)
  const cps = await db
    .select({ id: counterparties.id, name: counterparties.name })
    .from(counterparties)
    .where(eq(counterparties.tenantId, opts.tenantId));
  const exactByName = new Map(cps.map((cp) => [cp.name.trim().toUpperCase(), cp.id]));
  // Normalized suggestion (punctuation/legal-suffix stripped) — suggestion only
  const stripLegal = (s: string) =>
    s
      .toUpperCase()
      .replace(/[.,'’\-()]/g, ' ')
      .replace(/\b(LTD|LIMITED|SAS|SA|APS|GMBH|BV|INC|LLC|SPA|SL|AS|PTE|PTY|CO|CORP)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  const normalizedByName = new Map<string, string>();
  for (const cp of cps) {
    const key = stripLegal(cp.name);
    if (key && !normalizedByName.has(key)) normalizedByName.set(key, cp.id);
  }

  // Previous mapping (buyer_number → counterparty) survives replacement.
  const previous = await db
    .select({
      buyerNumber: atradiusBuyers.buyerNumber,
      matchedCounterpartyId: atradiusBuyers.matchedCounterpartyId,
      matchSource: atradiusBuyers.matchSource,
    })
    .from(atradiusBuyers)
    .where(eq(atradiusBuyers.tenantId, opts.tenantId));
  const previousMapping = new Map(
    previous
      .filter((p) => p.matchedCounterpartyId)
      .map((p) => [p.buyerNumber, { id: p.matchedCounterpartyId as string, source: p.matchSource ?? 'MAPPING' }]),
  );

  const today = new Date().toISOString().slice(0, 10);
  const parsed: Array<typeof atradiusBuyers.$inferInsert> = [];
  for (const raw of rowsByLetter.slice(1)) {
    const get = (field: string): unknown => {
      const letter = cols[field];
      if (!letter) return undefined;
      let n = 0;
      for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
      return raw[n - 1];
    };
    const buyerNumber = String(get('buyerNumber') ?? '').trim();
    const buyerName = String(get('buyerName') ?? '').trim();
    if (!buyerNumber || !buyerName) continue; // blank/summary rows

    const statusRaw = String(get('status') ?? '').trim();
    // Exports may use typographic (\u2019) or ASCII (') apostrophes.
    const statusKey = statusRaw.toLowerCase().replace(/\u2019/g, "'");
    const statusInfo = STATUS_MAP[statusKey] ?? { normalized: 'UNKNOWN', active: false };
    const decisionDate = toIsoDate(get('decisionDate'));
    const endDate = toIsoDate(get('endDate'));
    const amountRaw = get('coverAmount');
    // Numeric cells come through as numbers; TEXT cells may be French-locale
    // ("1 234,56") — normalize before stripping, don't silently mangle.
    let amountText = String(amountRaw ?? '0');
    if (typeof amountRaw === 'string' && amountRaw.includes(',')) {
      amountText = amountRaw.replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
    }
    const coverAmount = String(parseFloat(amountText.replace(/[^0-9.\-]/g, '')) || 0);
    const currency = String(get('currency') ?? 'EUR').trim() || 'EUR';

    // End date passed → inactive regardless of status.
    const expired = !!endDate && endDate < today;
    const isActive = statusInfo.active && !expired;

    // Matching: persisted mapping (stable buyer number) > exact name.
    // Normalized name is a SUGGESTION only — never auto-applied.
    const prior = previousMapping.get(buyerNumber);
    let matchedCounterpartyId = prior?.id ?? null;
    let matchSource = prior?.source ?? null;
    if (!matchedCounterpartyId) {
      const exact = exactByName.get(buyerName.toUpperCase());
      if (exact) {
        matchedCounterpartyId = exact;
        matchSource = 'EXACT';
      }
    }

    parsed.push({
      tenantId: opts.tenantId,
      importId: '', // set below
      buyerNumber,
      buyerName,
      coverAmount,
      currency,
      statusRaw,
      statusNormalized: statusInfo.normalized,
      isActive,
      decisionDate,
      endDate,
      matchedCounterpartyId,
      matchSource,
    });
  }
  if (parsed.length === 0) throw new Error('No buyer rows found in the file');

  // Replace-semantics transaction: one import at a time per tenant.
  const result = await db.transaction(async (tx) => {
    const [last] = await tx
      .select({ id: atradiusImports.id })
      .from(atradiusImports)
      .where(eq(atradiusImports.tenantId, opts.tenantId))
      .orderBy(desc(atradiusImports.createdAt))
      .limit(1);
    const replaced = !!last;
    if (last) {
      await tx.delete(atradiusBuyers).where(eq(atradiusBuyers.tenantId, opts.tenantId));
    }

    const [importRow] = await tx
      .insert(atradiusImports)
      .values({
        tenantId: opts.tenantId,
        uploadedBy: opts.userId,
        fileName: opts.fileName,
        rowCount: parsed.length,
      })
      .returning();

    for (const row of parsed) row.importId = importRow!.id;
    await tx.insert(atradiusBuyers).values(parsed);

    const matched = parsed.filter((p) => p.matchedCounterpartyId).length;
    // Store the DEDUPED unmatched count (one per buyer_number) so the DB
    // agrees with the summary the modal shows.
    const unmatchedBuyerNumbers = new Set(parsed.filter((p) => !p.matchedCounterpartyId).map((p) => p.buyerNumber));
    await tx
      .update(atradiusImports)
      .set({ matchedCount: matched, unmatchedCount: unmatchedBuyerNumbers.size })
      .where(eq(atradiusImports.id, importRow!.id));

    return { importRow, parsed, matched, replaced };
  });

  // Unmatched rows of the NEW import, with REAL atradius_buyers.id values
  // (the mapping modal uses row.id as its selection/track key — all ids must
  // be distinct, not placeholder ''). Deduped to one row per buyer_number.
  const unmatchedRows = await db
    .select({
      id: atradiusBuyers.id,
      buyerNumber: atradiusBuyers.buyerNumber,
      buyerName: atradiusBuyers.buyerName,
      coverAmount: atradiusBuyers.coverAmount,
      statusRaw: atradiusBuyers.statusRaw,
    })
    .from(atradiusBuyers)
    .where(
      and(
        eq(atradiusBuyers.importId, result.importRow!.id),
        isNull(atradiusBuyers.matchedCounterpartyId),
      ),
    );
  const seen = new Set<string>();
  const unmatched = unmatchedRows
    .filter((r) => (seen.has(r.buyerNumber) ? false : (seen.add(r.buyerNumber), true)))
    .map((r) => ({ ...r, suggestedCounterpartyId: normalizedByName.get(stripLegal(r.buyerName)) ?? null }));

  return {
    importId: result.importRow!.id,
    rowCount: result.parsed.length,
    matchedCount: result.matched,
    unmatchedCount: unmatched.length,
    unmatched: unmatched as ImportSummary['unmatched'],
    replaced: result.replaced,
  };
}

/**
 * Manual mapping of an Atradius buyer to a counterparty. Applies to ALL
 * decision rows of that buyer_number (a buyer can have several decisions in
 * one export); the persisted mapping is also what future imports inherit.
 */
export async function mapBuyerToCounterparty(opts: {
  tenantId: string;
  buyerNumber: string;
  counterpartyId: string | null;
}): Promise<boolean> {
  const result = await db
    .update(atradiusBuyers)
    .set({
      matchedCounterpartyId: opts.counterpartyId,
      matchSource: opts.counterpartyId ? 'MANUAL' : null,
    })
    .where(and(eq(atradiusBuyers.tenantId, opts.tenantId), eq(atradiusBuyers.buyerNumber, opts.buyerNumber)))
    .returning({ id: atradiusBuyers.id });
  return result.length > 0;
}

export interface CoverResponse {
  covers: Record<string, { amount: string; currency: string }>;
  lastImport: {
    fileName: string;
    uploadedByName: string | null;
    createdAt: string;
    rowCount: number;
    matchedCount: number;
    unmatchedCount: number;
  } | null;
}

/**
 * Current cover per counterparty: latest decision per buyer_number wins,
 * then SUM across buyer_numbers mapped to the same counterparty. Only
 * is_active rows contribute; a mapped buyer whose latest decision is
 * inactive contributes 0 (renders as €0, distinct from unmapped "—").
 */
export async function getAtradiusCover(tenantId: string): Promise<CoverResponse> {
  const [importRow] = await db
    .select({
      id: atradiusImports.id,
      fileName: atradiusImports.fileName,
      createdAt: atradiusImports.createdAt,
      rowCount: atradiusImports.rowCount,
      matchedCount: atradiusImports.matchedCount,
      unmatchedCount: atradiusImports.unmatchedCount,
      uploadedByName: users.name,
    })
    .from(atradiusImports)
    .leftJoin(users, eq(users.id, atradiusImports.uploadedBy))
    .where(eq(atradiusImports.tenantId, tenantId))
    .orderBy(desc(atradiusImports.createdAt))
    .limit(1);

  if (!importRow) return { covers: {}, lastImport: null };

  // Winning row per buyer_number: latest decision, then latest import insertion.
  const rows = await db
    .select({
      buyerNumber: atradiusBuyers.buyerNumber,
      coverAmount: atradiusBuyers.coverAmount,
      currency: atradiusBuyers.currency,
      isActive: atradiusBuyers.isActive,
      matchedCounterpartyId: atradiusBuyers.matchedCounterpartyId,
      decisionDate: atradiusBuyers.decisionDate,
    })
    .from(atradiusBuyers)
    .where(eq(atradiusBuyers.tenantId, tenantId))
    // NULLS LAST: a row with an unparseable decision date must not beat
    // dated rows for the same buyer_number (Postgres DESC is NULLS FIRST).
    .orderBy(sql`${atradiusBuyers.decisionDate} DESC NULLS LAST`, desc(atradiusBuyers.createdAt));

  const winning = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!winning.has(row.buyerNumber)) winning.set(row.buyerNumber, row);
  }

  const covers: Record<string, { amount: string; currency: string }> = {};
  for (const row of winning.values()) {
    if (!row.matchedCounterpartyId) continue;
    const existing = covers[row.matchedCounterpartyId];
    if (!row.isActive) {
      covers[row.matchedCounterpartyId] = existing ?? { amount: '0', currency: row.currency };
      continue;
    }
    const add = parseFloat(row.coverAmount) || 0;
    if (existing) {
      const base = parseFloat(existing.amount) || 0;
      covers[row.matchedCounterpartyId] = {
        amount: (base + add).toFixed(2),
        currency: existing.currency === row.currency ? existing.currency : `${existing.currency}/${row.currency}`,
      };
    } else {
      covers[row.matchedCounterpartyId] = { amount: add.toFixed(2), currency: row.currency };
    }
  }

  return {
    covers,
    lastImport: {
      fileName: importRow.fileName,
      uploadedByName: importRow.uploadedByName,
      createdAt: importRow.createdAt.toISOString(),
      rowCount: importRow.rowCount,
      matchedCount: importRow.matchedCount,
      unmatchedCount: importRow.unmatchedCount,
    },
  };
}

/** Unmatched buyer rows of the current import (for the mapping UI). */
export async function listUnmatchedBuyers(tenantId: string): Promise<
  Array<{ id: string; buyerNumber: string; buyerName: string; coverAmount: string; statusRaw: string }>
> {
  const [importRow] = await db
    .select({ id: atradiusImports.id })
    .from(atradiusImports)
    .where(eq(atradiusImports.tenantId, tenantId))
    .orderBy(desc(atradiusImports.createdAt))
    .limit(1);
  if (!importRow) return [];
  const rows = await db
    .select({
      id: atradiusBuyers.id,
      buyerNumber: atradiusBuyers.buyerNumber,
      buyerName: atradiusBuyers.buyerName,
      coverAmount: atradiusBuyers.coverAmount,
      statusRaw: atradiusBuyers.statusRaw,
    })
    .from(atradiusBuyers)
    .where(and(eq(atradiusBuyers.tenantId, tenantId), eq(atradiusBuyers.importId, importRow.id)));
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.buyerNumber)) return false;
    seen.add(r.buyerNumber);
    return true;
  });
}