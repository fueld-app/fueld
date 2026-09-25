import pdfmake from 'pdfmake';
import vfsFonts from 'pdfmake/build/vfs_fonts.js';
import type { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces';
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, notInArray } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import QRCode from 'qrcode';
import { db } from '../../db';
import { bankAccounts, orders, orderItems, counterparties, vessels, places, invoices, users, documentRevisions, tenants, priceReferences, type TenantSettings } from '../../db/schema';
import { isIanaTimezone } from '../../utils/timezone';
import { getDateFormatSettings, getCostSalesDecimalPrecision, getDocumentBrandingSettings } from '../admin/settings.service';
import { ensureOrderInvoice, InvoiceLinesChangedError, InvoiceNotFoundError } from '../orders/invoice.service';
import { splitAmountByPercent } from '../orders/invoice-amounts';
import { customerFacingItems, isSupplierCreditPlaceholder } from './customer-facing-items';

// ═══════════════════════════════════════════════════════════════════════
//  Document Service — Server-side PDF generation (pdfmake v0.3)
// ═══════════════════════════════════════════════════════════════════════

const pdfmakeVfs = (pdfmake as any)?.virtualfs;
if (pdfmakeVfs && typeof pdfmakeVfs.writeFileSync === 'function') {
  for (const [fontFileName, base64Data] of Object.entries(vfsFonts as Record<string, string>)) {
    pdfmakeVfs.writeFileSync(fontFileName, base64Data, 'base64');
  }
}

// Configure fonts (server-side: use built-in Roboto shipped with pdfmake)
pdfmake.setFonts({
  Roboto: {
    normal: 'Roboto-Regular.ttf',
    bold: 'Roboto-Medium.ttf',
    italics: 'Roboto-Italic.ttf',
    bolditalics: 'Roboto-MediumItalic.ttf',
  },
});

// ─── Bank details (configurable per tenant in a real system) ─────────

interface BankDetails {
  bankName: string;
  accountName: string | null;
  accountNumber: string | null;
  iban: string | null;
  swift: string | null;
  currency: string;
  branchAddress: string | null;
  sortCode: string | null;
  routingNumber: string | null;
  intermediaryBank: string | null;
}

type DocumentType = 'OFFER' | 'PROFORMA_INVOICE' | 'INVOICE' | 'OTHER' | 'BROKER_CONFIRMATION';
/**
 * Bump this whenever document output changes so cached revisions regenerate.
 *
 * Bumped to 2026-09-25a for the bank-fail-closed + tenant-accent change
 * (8bbbc799): the same order now renders different bytes than before, and
 * without the bump a cached revision would keep serving the old appearance
 * forever, so the fix would appear not to have taken effect.
 */
const DOCUMENT_TEMPLATE_VERSION = '2026-09-25a';

export interface DocumentRevisionInfo {
  id: string;
  tenantId: string;
  revisionNumber: number;
  verificationRef: string;
  verifyToken: string;
  sha256Hex: string;
  fingerprintShort: string;
  issuedAt: Date;
  filePath: string;
  isNew: boolean;
}

interface DocumentPrintMeta {
  issuedAt: Date;
  revisionNumber: number;
  verificationRef: string;
  fingerprintShort: string;
}

function formatIssuedAtUtc(date: Date, dateFormat?: string): string {
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  switch (dateFormat) {
    case 'AMERICAN':  return `${m}/${d}/${y}`;
    case 'EUROPEAN':  return `${d}/${m}/${y}`;
    case 'ISO':
    default:          return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
}


/** Sum customer-facing lines as money, or null when any line is unbillable. */
function computeInvoiceAmountForItems(
  items: Array<{
    productType: string;
    hideOnDocuments?: boolean | null;
    salesPrice?: string | number | null;
    deliveredQuantity?: string | number | null;
    quantity: string | number;
  }>,
): number {
  return customerFacingItems(items).reduce((sum, item) => {
    const qty = parseFloat(String(item.deliveredQuantity ?? item.quantity ?? 0)) || 0;
    const price = parseFloat(String(item.salesPrice ?? 0)) || 0;
    return sum + qty * price;
  }, 0);
}

function numberOrNull(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function getPublicApiBaseUrl(): string {
  const explicit = process.env['VERIFY_BASE_URL']
    ?? process.env['PUBLIC_API_URL']
    ?? process.env['API_URL'];
  if (explicit?.trim()) return trimTrailingSlash(explicit.trim());

  const appUrl = process.env['APP_URL'];
  if (appUrl?.trim()) {
    try {
      const parsed = new URL(appUrl.trim());
      const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (isLocal) return `${parsed.protocol}//${parsed.hostname}:3000`;
      return `${parsed.origin}/api`;
    } catch {
      // fall through
    }
  }

  return 'http://localhost:3000';
}

export function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

/**
 * Formats a raw product_type enum value for display on PDFs and labels.
 * Replaces underscores with spaces (e.g. BARGING_FEE → "BARGING FEE",
 * CREDIT_NOTE → "CREDIT NOTE").
 */
export function formatProductTypeLabel(productType: string): string {
  return productType.replace(/_/g, ' ');
}

export function documentTypePrefix(documentType: DocumentType): string {
  switch (documentType) {
    case 'OFFER': return 'OFF';
    case 'PROFORMA_INVOICE': return 'PFI';
    case 'INVOICE': return 'INV';
    default: return 'DOC';
  }
}

/**
 * Human-quotable reference for a document revision.
 *
 * Revision numbers are scoped to a document STREAM, so date + revision alone is
 * not unique: two orders' first revision on the same day both read
 * `INV-YYYYMMDD-R001` (confirmed on live data — one such ref occurred 12 times).
 * A field named "reference" that several documents share is not a reference, so
 * the stream is folded in as a short digest of the stream key.
 *
 * The digest is 4 hex characters — 65,536 possibilities — so this makes a
 * collision unlikely, NOT impossible; the SHA-256 fingerprint printed beside it
 * is the exact identity, and it is what verification resolves on. Widening the
 * digest would put a longer opaque string on a customer-facing document for a
 * label nobody keys on.
 *
 * The fingerprint remains the exact identity and is printed alongside; this only
 * makes the human-facing string unambiguous. Refs already written are frozen on
 * their revision rows (and printed on documents the customer holds), so this
 * changes only revisions created from here on.
 */
export function buildVerificationRef(
  documentType: DocumentType,
  issuedAt: Date,
  revisionNumber: number,
  streamDiscriminator?: string | null,
): string {
  const yyyy = String(issuedAt.getUTCFullYear());
  const mm = String(issuedAt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(issuedAt.getUTCDate()).padStart(2, '0');
  const base = `${documentTypePrefix(documentType)}-${yyyy}${mm}${dd}-R${String(revisionNumber).padStart(3, '0')}`;
  if (!streamDiscriminator) return base;
  const digest = createHash('sha256').update(streamDiscriminator).digest('hex').slice(0, 4).toUpperCase();
  return `${base}-${digest}`;
}

function mapRevisionInfo(revision: typeof documentRevisions.$inferSelect, isNew = false): DocumentRevisionInfo {
  return {
    id: revision.id,
    tenantId: revision.tenantId,
    revisionNumber: revision.revisionNumber,
    verificationRef: revision.verificationRef,
    verifyToken: revision.verifyToken,
    sha256Hex: revision.sha256Hex,
    fingerprintShort: revision.fingerprintShort,
    issuedAt: revision.issuedAt,
    filePath: revision.filePath,
    isNew,
  };
}

function getRevisionAbsolutePath(filePath: string): string {
  return join(process.cwd(), 'uploads', filePath);
}

export function resolveDocumentStreamTarget(params: {
  orderId?: string | null;
  invoiceId?: string | null;
  streamVariant?: string | null;
}): string | null {
  const baseTarget = params.invoiceId ?? params.orderId ?? null;
  if (!baseTarget) return null;
  return params.streamVariant ? `${baseTarget}:${params.streamVariant}` : baseTarget;
}

export function buildDocumentStreamKey(documentType: DocumentType, streamTarget: string): string {
  return `${documentType}:${streamTarget}:${DOCUMENT_TEMPLATE_VERSION}`;
}

export function toMs(date: Date | null | undefined): number {
  return date ? date.getTime() : 0;
}

export function maxMs(values: Array<Date | null | undefined>): number {
  return values.reduce((acc, value) => Math.max(acc, toMs(value)), 0);
}

export function maxItemUpdatedAtMs(items: Array<{ updatedAt: Date }>): number {
  return items.reduce((acc, item) => Math.max(acc, item.updatedAt.getTime()), 0);
}

async function getTenantDocumentVerificationExpiryDays(tenantId: string): Promise<number> {
  const [tenant] = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const settings = (tenant?.settings ?? {}) as TenantSettings;
  const raw = settings.documentVerificationLinkExpiryDays;
  if (raw === undefined || raw === null) return 0;
  const days = Number(raw);
  if (!Number.isFinite(days)) return 0;
  return Math.max(0, Math.floor(days));
}

export async function isDocumentRevisionVerificationExpired(revision: DocumentRevisionInfo): Promise<boolean> {
  const expiryDays = await getTenantDocumentVerificationExpiryDays(revision.tenantId);
  if (expiryDays <= 0) return false;
  const expiresAt = revision.issuedAt.getTime() + expiryDays * 24 * 60 * 60 * 1000;
  return Date.now() > expiresAt;
}

export async function persistDocumentRevision(params: {
  tenantId: string;
  orderId?: string | null;
  invoiceId?: string | null;
  streamVariant?: string | null;
  documentType: DocumentType;
  fileName: string;
  buffer: Buffer;
  generatedBy?: string | null;
}): Promise<DocumentRevisionInfo> {
  const streamTarget = resolveDocumentStreamTarget({
    orderId: params.orderId,
    invoiceId: params.invoiceId,
    streamVariant: params.streamVariant ?? null,
  });
  if (!streamTarget) throw new Error('Missing document stream target (orderId/invoiceId)');

  const streamKey = buildDocumentStreamKey(params.documentType, streamTarget);
  const sha256Hex = createHash('sha256').update(params.buffer).digest('hex');

  const [existing] = await db
    .select()
    .from(documentRevisions)
    .where(and(
      eq(documentRevisions.tenantId, params.tenantId),
      eq(documentRevisions.streamKey, streamKey),
      eq(documentRevisions.sha256Hex, sha256Hex),
    ))
    .limit(1);

  if (existing) return mapRevisionInfo(existing, false);

  const [latest] = await db
    .select({ revisionNumber: documentRevisions.revisionNumber })
    .from(documentRevisions)
    .where(and(
      eq(documentRevisions.tenantId, params.tenantId),
      eq(documentRevisions.streamKey, streamKey),
    ))
    .orderBy(desc(documentRevisions.revisionNumber))
    .limit(1);

  const revisionNumber = (latest?.revisionNumber ?? 0) + 1;
  const issuedAt = new Date();
  const fingerprintShort = sha256Hex.slice(0, 12).toUpperCase();
  const verifyToken = randomUUID().replace(/-/g, '');
  const verificationRef = buildVerificationRef(params.documentType, issuedAt, revisionNumber, streamKey);

  const safeStream = sanitizePathSegment(streamKey);
  const relativePath = join('documents', sanitizePathSegment(params.tenantId), safeStream, `r${String(revisionNumber).padStart(4, '0')}-${fingerprintShort}.pdf`);
  const absolutePath = join(process.cwd(), 'uploads', relativePath);

  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, params.buffer);

  const payload = {
    tenantId: params.tenantId,
    orderId: params.orderId ?? null,
    invoiceId: params.invoiceId ?? null,
    documentType: params.documentType,
    streamKey,
    revisionNumber,
    verificationRef,
    verifyToken,
    sha256Hex,
    fingerprintShort,
    filePath: relativePath,
    fileName: params.fileName,
    mimeType: 'application/pdf',
    fileSize: params.buffer.length,
    generatedBy: params.generatedBy ?? null,
    issuedAt,
  };

  try {
    const [inserted] = await db.insert(documentRevisions).values(payload).returning();
    return mapRevisionInfo(inserted, true);
  } catch {
    const [concurrent] = await db
      .select()
      .from(documentRevisions)
      .where(and(
        eq(documentRevisions.tenantId, params.tenantId),
        eq(documentRevisions.streamKey, streamKey),
        eq(documentRevisions.sha256Hex, sha256Hex),
      ))
      .limit(1);
    if (concurrent) return mapRevisionInfo(concurrent, false);
    throw new Error('Failed to persist document revision');
  }
}

export async function getLatestDocumentRevisionByOrderId(
  orderId: string,
  documentType: Exclude<DocumentType, 'OTHER'>,
): Promise<DocumentRevisionInfo | null> {
  const streamKey = buildDocumentStreamKey(documentType, orderId);
  const [revision] = await db
    .select()
    .from(documentRevisions)
    .where(eq(documentRevisions.streamKey, streamKey))
    .orderBy(desc(documentRevisions.revisionNumber))
    .limit(1);

  return revision ? mapRevisionInfo(revision) : null;
}

/**
 * Latest INVOICE revision for an order, whatever it is keyed by.
 *
 * Issued invoices are keyed by their invoice id (the stream target is
 * `invoiceId ?? orderId`), while the legacy order-keyed stream is still
 * consulted so revisions issued before invoice rows existed keep verifying.
 * Read-only by design — the public verify route must never generate.
 */
export async function getLatestInvoiceRevisionForOrder(orderId: string): Promise<DocumentRevisionInfo | null> {
  // Prefer a revision belonging to the order's LIVE invoice. Ordering by
  // revisionNumber alone would surface the voided invoice's revision after a
  // void/reissue (its number is higher), so the verify link printed on the new
  // document would resolve to the cancelled one.
  const [revision] = await db
    .select({ revision: documentRevisions })
    .from(documentRevisions)
    .innerJoin(invoices, eq(invoices.id, documentRevisions.invoiceId))
    .where(and(
      eq(documentRevisions.orderId, orderId),
      eq(documentRevisions.documentType, 'INVOICE'),
      ne(invoices.status, 'VOID'),
    ))
    .orderBy(desc(documentRevisions.revisionNumber))
    .limit(1);

  if (revision) return mapRevisionInfo(revision.revision);

  // Legacy order-keyed revisions predate invoice rows entirely, so they carry
  // no invoiceId. Only those may be served from the fallback: an order-keyed
  // revision that DOES belong to an invoice is either the live one (handled
  // above) or the voided one, which must never be surfaced for verification.
  return getLatestInvoicelessRevisionForOrder(orderId, 'INVOICE');
}

/** Latest revision for an order that belongs to no invoice (legacy issuance). */
async function getLatestInvoicelessRevisionForOrder(
  orderId: string,
  documentType: DocumentType,
): Promise<DocumentRevisionInfo | null> {
  const [revision] = await db
    .select()
    .from(documentRevisions)
    .where(and(
      eq(documentRevisions.streamKey, buildDocumentStreamKey(documentType, orderId)),
      isNull(documentRevisions.invoiceId),
    ))
    .orderBy(desc(documentRevisions.revisionNumber))
    .limit(1);

  return revision ? mapRevisionInfo(revision) : null;
}

export async function getLatestDocumentRevisionByStream(params: {
  documentType: DocumentType;
  orderId?: string | null;
  invoiceId?: string | null;
  streamVariant?: string | null;
}): Promise<DocumentRevisionInfo | null> {
  const streamTarget = resolveDocumentStreamTarget({
    orderId: params.orderId,
    invoiceId: params.invoiceId,
    streamVariant: params.streamVariant ?? null,
  });
  if (!streamTarget) return null;

  const streamKey = buildDocumentStreamKey(params.documentType, streamTarget);
  const [revision] = await db
    .select()
    .from(documentRevisions)
    .where(eq(documentRevisions.streamKey, streamKey))
    .orderBy(desc(documentRevisions.revisionNumber))
    .limit(1);

  return revision ? mapRevisionInfo(revision) : null;
}

/**
 * The newest revision for an invoice, IGNORING the template-version segment of
 * the stream key. Used only to keep an already-issued invoice frozen when the
 * template version is bumped; see the call site in generateOrderInvoicePdfBuffer.
 */
async function getAnyDocumentRevisionByInvoiceId(invoiceId: string): Promise<DocumentRevisionInfo | null> {
  const [revision] = await db
    .select()
    .from(documentRevisions)
    .where(and(eq(documentRevisions.invoiceId, invoiceId), eq(documentRevisions.documentType, 'INVOICE')))
    .orderBy(desc(documentRevisions.revisionNumber))
    .limit(1);
  return revision ? mapRevisionInfo(revision) : null;
}

export async function getDocumentRevisionByVerifyToken(token: string): Promise<DocumentRevisionInfo | null> {
  const [revision] = await db
    .select()
    .from(documentRevisions)
    .where(eq(documentRevisions.verifyToken, token))
    .limit(1);

  return revision ? mapRevisionInfo(revision) : null;
}

export function loadDocumentRevisionBuffer(revision: DocumentRevisionInfo): Buffer {
  const absolutePath = getRevisionAbsolutePath(revision.filePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Document artifact missing on disk: ${revision.filePath}`);
  }
  return readFileSync(absolutePath);
}

export async function overwriteDocumentRevisionArtifact(revision: DocumentRevisionInfo, buffer: Buffer): Promise<void> {
  const absolutePath = getRevisionAbsolutePath(revision.filePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, buffer);
  await db
    .update(documentRevisions)
    .set({ fileSize: buffer.length })
    .where(eq(documentRevisions.id, revision.id));
}

/**
 * NO fallback bank details — deliberately.
 *
 * This used to be a Fueld company account (`DNB Bank ASA`, `Fueld Trading Ltd`,
 * IBAN `NO93 8601 1117 947`), returned whenever neither the order nor the
 * invoicing company resolved an account. A tenant that had not configured
 * banking therefore printed ANOTHER ENTITY'S IBAN on its invoices, under a
 * "REMITTANCE INSTRUCTIONS" heading, addressed to its own customers — money to
 * the wrong account, undetectable by the customer.
 *
 * A missing remittance block is a visible configuration gap. A wrong account
 * number is a silent financial hazard. `loadOrderBankDetails` returns null.
 */

// ─── Data fetching ───────────────────────────────────────────────────

export async function fetchOrderForInvoice(orderId: string) {
  const isMissingCompanyRegistrationColumnError = (error: unknown): boolean => {
    if (!(error instanceof Error)) return false;
    return /company_registration_number/i.test(error.message);
  };

  const queryOrder = (includeCompanyRegistrationNumber: boolean) =>
    db.query.orders.findFirst({
      where: eq(orders.id, orderId),
      with: {
        client: includeCompanyRegistrationNumber
          ? true
          : {
              columns: {
                companyRegistrationNumber: false,
              },
            },
        vessel: true,
        place: true,
        salesRep: true,
        supplier: includeCompanyRegistrationNumber
          ? true
          : {
              columns: {
                companyRegistrationNumber: false,
              },
            },
        agent: includeCompanyRegistrationNumber
          ? true
          : {
              columns: {
                companyRegistrationNumber: false,
              },
            },
        invoicingCompany: includeCompanyRegistrationNumber
          ? true
          : {
              columns: {
                companyRegistrationNumber: false,
              },
            },
        customerContact: true,
        supplierContact: true,
        agentContact: true,
        orderSuppliers: {
          with: {
            company: includeCompanyRegistrationNumber
              ? true
              : {
                  columns: {
                    companyRegistrationNumber: false,
                  },
                },
            contact: true,
          },
        },
        items: {
          orderBy: [asc(orderItems.sortOrder), asc(orderItems.createdAt)],
        },
      },
    });

  let order: Awaited<ReturnType<typeof queryOrder>>;
  try {
    order = await queryOrder(true);
  } catch (error) {
    if (!isMissingCompanyRegistrationColumnError(error)) throw error;
    order = await queryOrder(false);
  }

  if (!order) throw new Error(`Order ${orderId} not found`);
  return order;
}

function getCompanyRegistrationNumber(company: unknown): string | null {
  if (!company || typeof company !== 'object') return null;
  const value = (company as { companyRegistrationNumber?: unknown }).companyRegistrationNumber;
  return typeof value === 'string' ? value : null;
}

/** Load the bank account assigned to an order (or the company default). */
export async function loadOrderBankDetails(
  bankAccountId: string | null | undefined,
  invoicingCompanyId: string | null | undefined,
): Promise<BankDetails | null> {
  const mapAccount = (ba: typeof bankAccounts.$inferSelect): BankDetails => ({
    bankName: ba.bankName,
    accountName: ba.accountName,
    accountNumber: ba.accountNumber,
    iban: ba.iban,
    swift: ba.swiftBic,
    currency: ba.currency,
    branchAddress: ba.branchAddress,
    sortCode: ba.sortCode,
    routingNumber: ba.routingNumber,
    intermediaryBank: ba.intermediaryBank,
  });

  // Try specific bank account first
  if (bankAccountId) {
    const [ba] = await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, bankAccountId))
      .limit(1);
    if (ba) return mapAccount(ba);
  }
  // Fallback: default bank account for the invoicing company
  if (invoicingCompanyId) {
    const [ba] = await db
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.counterpartyId, invoicingCompanyId), eq(bankAccounts.isDefault, true)))
      .limit(1);
    if (ba) return mapAccount(ba);
  }

  // No account configured: print nothing. Never substitute another entity's.
  return null;
}

/**
 * Whether this order's documents would print payable banking details. Lets
 * callers warn BEFORE issuing: an invoice with no remittance section becomes a
 * support ticket, and one with the wrong account is worse.
 */
export async function hasPayableBankDetails(
  bankAccountId: string | null | undefined,
  invoicingCompanyId: string | null | undefined,
): Promise<boolean> {
  return (await loadOrderBankDetails(bankAccountId, invoicingCompanyId)) !== null;
}

// ─── PDF Builder ─────────────────────────────────────────────────────

function formatNumber(val: string | null | undefined, decimals = 2, precision?: number): string {
  if (!val) return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  const dp = precision != null ? precision : decimals;
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Format a sales/cost price — uses up to 4 decimal places for small per-unit rates (e.g. $0.001/gal). */
function formatPrice(val: string | null | undefined, precision?: number | null): string {
  if (!val) return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  // Cap at 4 decimals — sales_price is numeric(12,4). Dynamic min 2, max 4.
  const maxDp = precision != null ? Math.min(precision, 4) : 4;
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: maxDp });
}

/** Determine the fixed decimal places needed for the price column so all items align.
 *  Uses the admin-configured costSalesDecimalPrecision as the baseline (default 5).
 *  If any item has a sub-cent price (< $0.01), use at least 4 decimals. */
function computePriceColumnDecimals(items: Array<{ salesPrice: string | null }>, configuredPrecision?: number | null): number {
  const minDecimals = configuredPrecision ?? 5;
  for (const item of items) {
    const n = parseFloat(item.salesPrice ?? '0');
    if (!isNaN(n) && n !== 0 && Math.abs(n) < 0.01) return Math.max(4, minDecimals);
  }
  return minDecimals;
}

/** Format a price with at least 2 decimals, up to the configured precision.
 *  Strips unnecessary trailing zeros while preserving full precision (no rounding). */
function formatPriceFixed(val: string | null | undefined, decimals: number): string {
  if (!val) return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: Math.min(2, decimals), maximumFractionDigits: decimals });
}

/**
 * Compute the maximum number of decimal places across all line items for a given field.
 * Returns at least 2 (minimum display precision).
 * e.g. if items have quantities [100, 123.456, 50.5], returns 3.
 */
function computeMaxDecimalPlaces(items: Array<Record<string, unknown>>, field: string): number {
  let maxDp = 2;
  for (const item of items) {
    const val = item[field];
    if (!val) continue;
    // numeric(14,7) columns always serialize with 7 fraction digits (e.g. "610.0000000").
    // Strip padding zeros so the column type doesn't force every document to 7dp.
    const s = String(parseFloat(String(val)));
    const dot = s.indexOf('.');
    if (dot === -1) continue;
    const dp = s.length - dot - 1;
    if (dp > maxDp) maxDp = dp;
  }
  return maxDp;
}

/** Format a number, stripping trailing zeros (e.g. 100.000 → "100", 100.500 → "100.5"). */
function formatNumberCompact(val: string | null | undefined, maxDecimals = 3): string {
  if (!val) return '—';
  const n = parseFloat(val);
  if (isNaN(n)) return '—';
  // Format with up to maxDecimals, then strip trailing zeros
  const formatted = n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: maxDecimals });
  return formatted;
}

/** Strip common country prefixes so "Republic of Singapore" normalises to "singapore". */
function normalizeCountryName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^(the\s+)?(republic|kingdom|state|emirate|sultanate|federation|commonwealth|principality)\s+of\s+/i, '')
    .trim();
}

/** Returns true when the country is already mentioned in one of the address lines. */
function countryAlreadyInAddress(lines: string[], country: string): boolean {
  const norm = normalizeCountryName(country);
  return lines.some(l => {
    const nl = normalizeCountryName(l);
    return nl.includes(norm) || norm.includes(nl);
  });
}

/**
 * The "Bill To" party block: customer name, attention line, then the address
 * lines with the country appended when it is not already part of the address.
 *
 * Shared by the offer and proforma builders, which carried identical copies.
 * Kept as a builder rather than a constant because `Att.:` is only emitted when
 * a contact exists — a blank attention line on a legal document reads as an
 * omission.
 */
function buildCustomerBlock(params: {
  clientName: string;
  customerContactName: string | null;
  clientAddress: string | null;
  clientCountry: string | null;
  fontSize?: number;
}): Content[] {
  const size = params.fontSize ?? 10;
  const block: Content[] = [{ text: params.clientName, fontSize: size } as Content];
  if (params.customerContactName?.trim()) {
    block.push({ text: `Att.: ${params.customerContactName.trim()}`, fontSize: size } as Content);
  }
  const clientAddr = params.clientAddress?.trim();
  if (clientAddr) {
    const lines = splitAddressLines(clientAddr);
    for (const line of lines) {
      block.push({ text: line, fontSize: size } as Content);
    }
    // Append country only when the address did not already carry it.
    if (params.clientCountry?.trim() && !countryAlreadyInAddress(lines, params.clientCountry)) {
      block.push({ text: params.clientCountry.trim(), fontSize: size } as Content);
    }
  } else if (params.clientCountry?.trim()) {
    block.push({ text: params.clientCountry.trim(), fontSize: size } as Content);
  }
  return block;
}

/**
 * The page header shared by the live builders: company logo, the
 * Date/Ref/PO table, and the three-column strip (party block, document title,
 * meta). Only three values differ between an offer and a proforma — the side
 * column width, the title, and whether the title wraps — so those are the
 * parameters rather than a copied block.
 *
 * The party block is rendered on page 1 only; later pages repeat the header
 * without re-printing the addressee.
 */
function buildDocumentHeader(params: {
  companyLogoDataUrl: string | null;
  createdDate: string;
  refNum: string;
  purchaseOrderNumber: string | null;
  customerBlock: Content[];
  customerTopOffset: number;
  title: string;
  /** Width of the outer columns, in points. */
  sideWidth: number;
  titleNoWrap?: boolean;
}): (currentPage: number, pageCount: number) => Content {
  return (currentPage: number, _pageCount: number) => {
    const rightStack: Content[] = [];
    if (params.companyLogoDataUrl) {
      rightStack.push({ image: params.companyLogoDataUrl, fit: [150, 50], alignment: 'right', margin: [0, 0, 0, 10] } as Content);
    }
    // Date / Ref — tabular so labels and values are column-aligned
    rightStack.push({
      table: {
        widths: ['auto', 'auto'],
        body: [
          [{ text: 'Date:', bold: true, alignment: 'right', margin: [0, 0, 4, 0] }, { text: params.createdDate, alignment: 'right' }],
          [{ text: 'Ref.:', bold: true, alignment: 'right', margin: [0, 0, 4, 0] }, { text: params.refNum, alignment: 'right' }],
          ...(params.purchaseOrderNumber?.trim() ? [
            [{ text: 'PO.:', bold: true, alignment: 'right', margin: [0, 0, 4, 0] }, { text: params.purchaseOrderNumber.trim(), alignment: 'right' }],
          ] : []),
        ],
      },
      layout: {
        hLineWidth: () => 0,
        vLineWidth: () => 0,
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 1,
        paddingBottom: () => 1,
      },
      fontSize: 10,
    } as Content);

    return {
      margin: [40, 30, 0, 0],
      columns: [
        { width: params.sideWidth, stack: currentPage === 1 ? params.customerBlock : [{ text: '' }], margin: [0, params.customerTopOffset, 0, 0] },
        {
          width: '*',
          text: params.title,
          style: 'docTitle',
          alignment: 'center',
          margin: [10, 0, 10, 0],
          ...(params.titleNoWrap ? { noWrap: true } : {}),
        },
        { width: params.sideWidth, stack: rightStack, margin: [0, 0, 40, 0] },
      ],
    } as Content;
  };
}

/** The page footer shared by every tenant document: issuer name and address on
 * the left, contacts in the middle, page number on the right, and the
 * revision/fingerprint line beneath when the document is a finalised revision.
 *
 * Extracted because the offer and proforma builders carried character-identical
 * copies (2432 chars each). Two copies of a legal document's footer is two
 * places for the issuer's own address to disagree with itself.
 */
function buildDocumentFooter(params: {
  senderName: string;
  companyAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  vatNumber: string | null;
  companyRegistrationNumber: string | null;
  printMeta: DocumentPrintMeta | null;
  dateFormat?: string | null;
  accent: string;
}): (currentPage: number, pageCount: number) => Content {
  return (currentPage: number, pageCount: number) => {
    const leftTexts: Content[] = [
      { text: params.senderName, fontSize: 8, bold: true, color: '#374151' } as Content,
    ];
    if (params.companyAddress?.trim()) {
      for (const line of splitAddressLines(params.companyAddress)) {
        leftTexts.push({ text: line, fontSize: 8, color: '#374151' } as Content);
      }
    }
    // VAT / registration belong with the company address block (per Daniel/Moxie
    // feedback) rather than in the middle contact column.
    if (params.vatNumber?.trim()) {
      leftTexts.push({ text: `VAT No : ${params.vatNumber.trim()}`, fontSize: 8, color: '#374151' } as Content);
    }
    if (params.companyRegistrationNumber?.trim()) {
      leftTexts.push({ text: `Reg. No : ${params.companyRegistrationNumber.trim()}`, fontSize: 8, color: '#374151' } as Content);
    }
    const middleTexts: Content[] = [];
    if (params.companyPhone?.trim()) {
      const display = formatPhoneDisplay(params.companyPhone) ?? params.companyPhone.trim();
      middleTexts.push({ text: `T ${display}`, fontSize: 8, color: params.accent, link: phoneToTelUri(params.companyPhone) } as Content);
    }
    if (params.companyEmail?.trim()) {
      middleTexts.push({ text: params.companyEmail.trim(), fontSize: 8, color: params.accent, link: `mailto:${params.companyEmail.trim()}` } as Content);
    }

    return {
      margin: [40, 0, 40, 20] as [number, number, number, number],
      stack: [
        { canvas: [{ type: 'line' as const, x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#9ca3af' }] },
        {
          columns: [
            { width: '*' as const, stack: leftTexts },
            { width: '*' as const, stack: middleTexts },
            { width: 'auto' as const, stack: [{ text: `${currentPage} / ${pageCount}`, fontSize: 8, color: '#374151', alignment: 'right' as const }] },
          ],
          margin: [0, 8, 0, 0] as [number, number, number, number],
        },
        ...(params.printMeta ? [{
          text: `Issued (UTC): ${formatIssuedAtUtc(params.printMeta.issuedAt, params.dateFormat ?? undefined)}   Revision: ${params.printMeta.revisionNumber}   Ref: ${params.printMeta.verificationRef}   Fingerprint: ${params.printMeta.fingerprintShort}`,
          fontSize: 7,
          color: '#6b7280',
          alignment: 'center',
          margin: [0, 16, 0, 0] as [number, number, number, number],
        } as Content] : []),
      ],
    };
  };
}

/** Fueld's own accent — the fallback when the issuing company has no brand colour. */
const DEFAULT_DOC_ACCENT = '#1a56db';

/** Relative luminance per WCAG 2.x, for the contrast floor below. */
function relativeLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
}

/** Contrast ratio of a colour against white (the document background). */
function contrastOnWhite(hex: string): number {
  return (1.0 + 0.05) / (relativeLuminance(hex) + 0.05);
}

/**
 * The accent colour for a tenant's documents: the ISSUING COMPANY's
 * `brandColor` when the tenant has OPTED IN and the colour is legible, else
 * Fueld's blue.
 *
 * Opt-in because branding is an appearance change to documents a customer
 * receives. A tenant that already had a legible `brandColor` stored would
 * otherwise have had its invoices silently restyled by shipping this feature —
 * verified: ChannelTX has two legible brand colours on companies that invoice
 * 290 orders. Default off means nobody's documents change until they choose to.
 *
 * `brandColor` has been stored on counterparties all along and the email
 * template already reads it — the PDFs hardcoded Fueld blue in 18 places, so a
 * tenant that set its own colour got Fueld's on every invoice.
 *
 * Two guards, both necessary because this is user input written into a legal
 * document:
 *
 *  - SHAPE. Must be a hex triple (#RRGGBB, or #RGB expanded). An unvalidated
 *    string would either throw inside pdfmake mid-render or emit a broken
 *    colour.
 *  - LEGIBILITY. Shape alone is not enough: a valid `#F5C518` (a bright yellow
 *    brand colour) has a contrast ratio of 1.63:1 on white, so section
 *    headings and the table header would be effectively invisible on the
 *    customer's invoice. Any colour below the WCAG large-text floor (3:1) falls
 *    back to Fueld blue. This is a floor, not a preference — the point is that a
 *    tenant cannot make their own documents unreadable by picking a pale brand
 *    colour.
 */
export function resolveDocAccent(brandColor: string | null | undefined, brandingEnabled = false): string {
  return resolveOptionalDocAccent(brandColor, brandingEnabled) ?? DEFAULT_DOC_ACCENT;
}

/**
 * The tenant's accent, or NULL when they have not configured a usable one.
 *
 * Separate from `resolveDocAccent` because "no accent configured" and "accent
 * is Fueld blue" are different things to a document. Callers that would
 * otherwise change the appearance of an unbranded tenant's documents use this
 * and keep the previous neutral styling; callers that always need a colour
 * (rules, links) use `resolveDocAccent`.
 */
export function resolveOptionalDocAccent(brandColor: string | null | undefined, brandingEnabled = false): string | null {
  // Not opted in: no accent, so the caller keeps its previous styling.
  if (!brandingEnabled) return null;
  const value = (brandColor ?? '').trim();
  let candidate: string | null = null;
  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
    candidate = value;
  } else if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    // A stored value is user input, so accept the #RGB shorthand too.
    const [r, g, b] = [value[1]!, value[2]!, value[3]!];
    candidate = `#${r}${r}${g}${g}${b}${b}`;
  }
  if (!candidate) return null;
  // WCAG large-text minimum. Below this the accent text stops being readable.
  if (contrastOnWhite(candidate) < 3) return null;
  return candidate;
}

/**
 * Format a phone number for display: keep international prefix, format
 * remaining digits in local-style groups.
 * e.g. "+4526131217" → "+45 2613 1217", "+18005551234" → "+1 800 555 1234"
 */
/** Known 2-digit E.164 country codes (the rest in 2xx-9xx range are 3-digit). */
const TWO_DIGIT_CC = new Set([
  '20','27','30','31','32','33','34','36','39',
  '40','41','43','44','45','46','47','48','49',
  '51','52','53','54','55','56','57','58',
  '60','61','62','63','64','65','66',
  '81','82','84','86','90','91','92','93','94','95','98',
]);

function formatPhoneDisplay(phone: string | null | undefined): string | null {
  if (!phone) return null;
  // Strip everything except digits and leading +
  let cleaned = phone.replace(/[^\d+]/g, '');
  if (!cleaned.startsWith('+')) cleaned = `+${cleaned}`;

  const digits = cleaned.slice(1); // without +
  if (digits.length < 4) return cleaned; // too short to format

  // Detect country code length: 1 (+1, +7), 2, or 3
  let ccLen = 2;
  if (digits.startsWith('1') || digits.startsWith('7')) {
    ccLen = 1;
  } else if (TWO_DIGIT_CC.has(digits.slice(0, 2))) {
    ccLen = 2;
  } else {
    ccLen = 3;
  }

  const cc = digits.slice(0, ccLen);
  const national = digits.slice(ccLen);

  // Group national number in blocks of 2 (common international style)
  const groups: string[] = [];
  for (let i = 0; i < national.length; i += 2) {
    groups.push(national.slice(i, i + 2));
  }
  return `+${cc} ${groups.join(' ')}`;
}

/** Strip non-digit/+ chars for use in tel: URI */
function phoneToTelUri(phone: string): string {
  return 'tel:' + phone.replace(/[^\d+]/g, '');
}

/** Build a pdfmake text node for a phone number with tel: link */
function phoneTextNode(label: string, phone: string, opts: { fontSize?: number; margin?: number[]; accent?: string } = {}): Content {
  const display = formatPhoneDisplay(phone) ?? phone;
  const uri = phoneToTelUri(phone);
  return {
    text: [
      { text: label, bold: true },
      { text: display, link: uri, color: opts.accent ?? '#1a56db' },
    ],
    fontSize: opts.fontSize ?? 10,
    margin: opts.margin ?? [0, 0, 0, 2],
  } as Content;
}

/** Build a pdfmake text node for an email with mailto: link */
function emailTextNode(label: string, email: string, opts: { fontSize?: number; margin?: number[]; accent?: string } = {}): Content {
  return {
    text: [
      { text: label, bold: true },
      { text: email, link: `mailto:${email}`, color: opts.accent ?? '#1a56db' },
    ],
    fontSize: opts.fontSize ?? 10,
    margin: opts.margin ?? [0, 0, 0, 2],
  } as Content;
}

export function formatCustomerPaymentTerms(
  type: string | null | undefined,
  creditDays: number | null | undefined,
): string | null {
  if (!type) return null;
  if (type === 'CREDIT') {
    const days = creditDays ?? 0;
    return `Credit ${days} days`;
  }
  if (type === 'COD') return 'Cash on Delivery';
  if (type === 'PREPAY') return 'Cash in advance';
  return type;
}

/** Split an address into display lines.
 *  If the address contains newlines, split on newlines only (preserving commas).
 *  Otherwise, split on commas. */
export function splitAddressLines(address: string): string[] {
  const trimmed = address.trim();
  if (!trimmed) return [];
  if (trimmed.includes('\n')) {
    return trimmed.split('\n').map(l => l.trim()).filter(Boolean);
  }
  return trimmed.split(/,\s*/).map(l => l.trim()).filter(Boolean);
}

function formatStoredDateOnlyForDisplay(value: string | Date | null | undefined, tz?: string | null, dateFormat?: string): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  // Use the provided timezone if valid, otherwise fall back to UTC
  const safeTz = tz && isIanaTimezone(tz) ? tz : 'UTC';

  // Get the date parts in the target timezone
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(date);

  const map = new Map(parts.map((p) => [p.type, p.value]));
  const day = map.get('day') ?? '01';
  const month = map.get('month') ?? '01';
  const year = map.get('year') ?? '0000';

  // Apply the configurable date format
  switch (dateFormat) {
    case 'AMERICAN':  return `${month}/${day}/${year}`;
    case 'EUROPEAN':  return `${day}/${month}/${year}`;
    case 'ISO':
    default:          return `${year}-${month}-${day}`;
  }
}

export function parseTimezoneOffset(tz: string | null | undefined): number | null {
  if (!tz) return null;
  const match = tz.match(/([+-])\s*(\d{1,2})(?::(\d{2}))?/);
  if (!match) {
    if (/^(GMT|UTC)$/i.test(tz.trim())) return 0;
    return null;
  }
  const sign = match[1] === '+' ? 1 : -1;
  const hours = parseInt(match[2], 10);
  const minutes = match[3] ? parseInt(match[3], 10) : 0;
  return sign * (hours * 60 + minutes);
}

/** Compute invoice due date from payment terms.
 *  For CREDIT terms the due date is deliveryDate (ETA) + creditDays.
 *  Falls back to baseDate when ETA is not available.
 */
export function computeDueDate(
  baseDate: Date,
  paymentTermType: string | null | undefined,
  creditDays: number | null | undefined,
  deliveryDate?: Date | null,
): string {
  if (paymentTermType === 'CREDIT') {
    const days = creditDays ?? 30;
    const anchor = deliveryDate ?? baseDate;
    return new Date(anchor.getTime() + days * 86_400_000).toISOString().split('T')[0]!;
  }
  // COD / PREPAY → due immediately
  if (paymentTermType === 'COD' || paymentTermType === 'PREPAY') {
    return baseDate.toISOString().split('T')[0]!;
  }
  // Default fallback: 30 days
  return new Date(baseDate.getTime() + 30 * 86_400_000).toISOString().split('T')[0]!;
}

export function formatDateTimeForDisplay(value: string | null, tz: string | null | undefined, _omitTz = false, dateFormat?: string): string | null {
  return formatStoredDateOnlyForDisplay(value, tz, dateFormat);
}

export function replaceCompanyNamePlaceholder(
  value: string | null | undefined,
  companyName: string | null | undefined,
  documentName?: string | null,
): string | null {
  if (!value) return null;
  let result = value;
  const resolvedName = companyName?.trim();
  if (resolvedName) {
    result = result.replace(/\$\{companyName\}/g, resolvedName);
  }

  const resolvedDocumentName = documentName?.trim();
  if (resolvedDocumentName) {
    result = result
      .replace(/\$\{documentName\}/g, resolvedDocumentName)
      .replace(/\$\{offerOrConfirmation\}/g, resolvedDocumentName);
  }

  return result;
}

export function buildOfferForAccountOfText(params: {
  title: string;
  vesselName: string;
  vesselImo?: string | null;
  clientName?: string | null;
  /** For broker deals: the customer account the supply is for (overrides companyName on nomination "For account of"). */
  accountName?: string | null;
  companyName?: string | null;
}): string {
  const vesselRef = `${params.vesselName}${params.vesselImo ? ` (IMO: ${params.vesselImo})` : ''}`;
  const vesselDisplay = params.vesselName.startsWith('MV ') ? vesselRef : `MV ${vesselRef}`;
  const forAccountParts = params.title === 'NOMINATION'
    ? [params.accountName?.trim() || params.companyName?.trim() || 'Invoicing company']
    : [`Master and/or owner and/or charterers and/or ${vesselDisplay}`];

  if (params.title !== 'NOMINATION' && params.clientName) {
    forAccountParts.push(`and/or ${params.clientName}`);
  }

  return forAccountParts.join(' ');
}

function buildNotesSection(params: {
  customerNote?: string | null;
  termsAndConditions?: string | null;
  itemNotes?: Array<{ label: string; note: string }>;
  placeRemark?: string | null;
}): Content[] {
  const customerNote = params.customerNote?.trim();
  const termsAndConditions = params.termsAndConditions?.trim();
  const placeRemark = params.placeRemark?.trim();
  const itemNotes = params.itemNotes ?? [];
  if (!customerNote && !termsAndConditions && !placeRemark && itemNotes.length === 0) return [];

  const notes: Content[] = [];
  
  if (customerNote || placeRemark) {
    notes.push({ text: 'Notes', style: 'sectionLabel' } as Content);
  }

  if (customerNote) {
    notes.push({ text: customerNote, margin: [0, 0, 0, 6] } as Content);
  }

  if (placeRemark) {
    notes.push({ text: placeRemark, margin: [0, 0, 0, 6] } as Content);
  }

  if (termsAndConditions) {
    notes.push({ text: 'Terms:', bold: true, margin: [0, 2, 0, 4] } as Content);
    // Split on newlines so each paragraph is justified independently.
    // pdfmake only justifies text that wraps; short/last lines stay left-aligned.
    const paragraphs = termsAndConditions.split(/\n/).filter((p) => p.trim());
    for (const para of paragraphs) {
      notes.push({ text: para.trim(), alignment: 'justify', margin: [0, 0, 0, 2] } as Content);
    }
  }

  if (itemNotes.length) {
    notes.push({
      ul: itemNotes.map((entry) => `${entry.label}: ${entry.note}`),
      margin: [0, 0, 0, 6],
    } as Content);
  }

  return notes;
}

export function tryLoadLogoDataUrl(logoUrl: string | null | undefined): string | null {
  const raw = (logoUrl ?? '').trim();
  if (!raw) return null;

  // We expect stored URLs like: /uploads/logos/<filename>
  const filename = basename(raw.split('?')[0] ?? '');
  if (!filename) return null;

  const ext = extname(filename).toLowerCase();
  const mime = ext === '.png'
    ? 'image/png'
    : ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : null;
  if (!mime) return null;

  // Resolve to local uploads folder (works in dev and in the deployed /opt/fueld layout).
  const localPath = join(process.cwd(), 'uploads/logos', filename);
  if (!existsSync(localPath)) return null;

  try {
    const buf = readFileSync(localPath);
    if (!buf.length) return null;
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}
export async function countLiveOrderInvoices(orderId: string): Promise<number> {
  const rows = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(and(eq(invoices.orderId, orderId), notInArray(invoices.status, ['VOID', 'DRAFT'])));
  return rows.length;
}

async function expectedTrancheShare(
  liveLinesTotal: number,
  invoice: typeof invoices.$inferSelect,
): Promise<number> {
  const percent = numberOrNull(invoice.tranchePercent);
  if (percent == null || percent <= 0) return liveLinesTotal;

  // Reconstruct the schedule AS IT WAS AT ISSUANCE and re-split the live total
  // the same way issuance did -- same percents, same order, same last-tranche
  // residual absorption. Reconstructing is exact; deriving the share from the
  // tranche's POSITION in the current live set is not, because voiding a sibling
  // makes a survivor look like the residual absorber and a paid sibling dropping
  // out shifts which share absorbs it.
  //
  // Voided rows are included (they are part of the issuance-time set) but a
  // reissue shares its tranche's seq, so the live row wins on a seq collision.
  const rows = await db
    .select({ seq: invoices.trancheSeq, percent: invoices.tranchePercent, status: invoices.status })
    .from(invoices)
    .where(and(eq(invoices.orderId, invoice.orderId), isNotNull(invoices.trancheSeq)));

  const bySeq = new Map<number, string>();
  for (const row of rows) {
    const seq = row.seq!;
    const isLive = row.status !== 'VOID' && row.status !== 'DRAFT';
    if (!bySeq.has(seq) || isLive) bySeq.set(seq, row.percent ?? '0');
  }

  const seqs = [...bySeq.keys()].sort((a, b) => a - b);
  const index = seqs.indexOf(invoice.trancheSeq!);
  if (index < 0) return Math.round((liveLinesTotal * percent) / 100 * 100) / 100;

  const percents = seqs.map((seq) => numberOrNull(bySeq.get(seq) ?? null) ?? 0);
  return numberOrNull(splitAmountByPercent(liveLinesTotal, percents, index)) ?? liveLinesTotal;
}

/**
 * Load one invoice of an order, refusing an id that belongs to a different order
 * (so an invoice id cannot be used to render another order's document).
 */
async function fetchInvoiceRowForOrder(orderId: string, invoiceId: string): Promise<typeof invoices.$inferSelect> {
  const [row] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.orderId, orderId), eq(invoices.id, invoiceId)))
    .limit(1);
  if (!row) throw new InvoiceNotFoundError(orderId);
  return row;
}

export async function generateOrderInvoicePdfBuffer(
  orderId: string,
  options: { invoiceId?: string } = {},
): Promise<{
  buffer: Buffer;
  invoiceNumber: string;
  fileName: string;
  revision: DocumentRevisionInfo;
}> {
  const order = await fetchOrderForInvoice(orderId);
  const { dateFormat } = await getDateFormatSettings(order.tenantId);
  const { enabled: brandingEnabled } = await getDocumentBrandingSettings(order.tenantId);
  const { precision: costSalesDecimalPrecision } = await getCostSalesDecimalPrecision();

  // Materialize the invoice row on ISSUANCE. Before this existed, no production
  // code path ever inserted into `invoices`, so the number was always a PREVIEW
  // placeholder and every reader (collections, aging, QuickBooks) saw nothing.
  await ensureOrderInvoice(order.id);
  // Split payment terms issue one invoice per tranche, so the caller picks which
  // one to render. Without an id this returns the deposit tranche; the other
  // tranches are reachable by naming their invoice.
  const invoice = options.invoiceId
    ? await fetchInvoiceRowForOrder(order.id, options.invoiceId)
    : await ensureOrderInvoice(order.id);

  // An ISSUED invoice is a frozen artifact: once rendered, it must keep serving
  // THOSE bytes. The stream key embeds DOCUMENT_TEMPLATE_VERSION, so a template
  // bump (which exists to regenerate cached documents after an output change)
  // would otherwise make this lookup MISS and re-render an already-issued
  // invoice into a new revision — silently restating a document the customer
  // already holds, and breaking the fingerprint/verification story.
  //
  // So: use the versioned stream first, then fall back to any revision for this
  // invoice regardless of template version. A draft/pre-issue invoice has no
  // revision yet, so it re-renders under the new template exactly as intended.
  const existingRevision = await getLatestDocumentRevisionByStream({
    documentType: 'INVOICE',
    orderId: order.id,
    invoiceId: invoice.id,
  }) ?? await getAnyDocumentRevisionByInvoiceId(invoice.id);
  if (existingRevision) {
    const fileName = `Fueld_Invoice_${invoice.invoiceNumber.replace(/[^a-zA-Z0-9-]/g, '_')}.pdf`;
    return {
      buffer: loadDocumentRevisionBuffer(existingRevision),
      invoiceNumber: invoice.invoiceNumber,
      fileName,
      revision: existingRevision,
    };
  }

  // Nothing is persisted yet, so this would be the FIRST render of this invoice.
  // Refuse if the order's lines no longer add up to the frozen amount: the
  // document would not sum to itself. An already-issued artifact returns above
  // and is never subject to this.
  const frozenAmount = numberOrNull(invoice.amount);
  if (frozenAmount != null) {
    const liveLinesTotal = await computeInvoiceAmountForItems(order.items);
    // The document must sum to itself. What "itself" is depends on the kind of
    // invoice, and the two cases must be checked separately: an unscheduled
    // order bills the whole deal, a tranche bills a SHARE of it. Testing both
    // with OR would let an edited order slip through whenever the lines total
    // happened to land on the tranche's frozen figure.
    if (invoice.trancheSeq == null) {
      if (Math.abs(liveLinesTotal - frozenAmount) > 0.005) {
        throw new InvoiceLinesChangedError(order.id, frozenAmount.toFixed(2), liveLinesTotal.toFixed(2));
      }
    } else {
      const expected = await expectedTrancheShare(liveLinesTotal, invoice);
      // Compared in cents: the split rounds each share to 2dp, so a sub-cent
      // float artifact must not read as a changed order.
      if (Math.round(expected * 100) !== Math.round(frozenAmount * 100)) {
        throw new InvoiceLinesChangedError(order.id, frozenAmount.toFixed(2), expected.toFixed(2));
      }
    }
  }

  const invoiceNumber = invoice.invoiceNumber;

  const bank = await loadOrderBankDetails(order.bankAccountId, order.invoicingCompanyId);

  // QR code verification
  let verifyUrl: string | null = null;
  const verifyLink = `${getPublicApiBaseUrl()}/verify/${orderId}/invoice`;
  try {
    verifyUrl = await QRCode.toDataURL(verifyLink, { width: 160, margin: 1 });
  } catch { /* QR generation failed — continue without */ }

  // Company logo
  const companyLogoDataUrl = tryLoadLogoDataUrl(order.invoicingCompany?.logoUrl ?? null);

  // Resolve price reference names for formula-priced items
  const invoiceRefIds = new Set<string>();
  for (const item of order.items) {
    if (item.salesReferenceId) invoiceRefIds.add(item.salesReferenceId);
  }
  const invoiceRefNameMap = new Map<string, string>();
  if (invoiceRefIds.size > 0) {
    const refs = await db.select({ id: priceReferences.id, name: priceReferences.name })
      .from(priceReferences)
      .where(inArray(priceReferences.id, [...invoiceRefIds]));
    for (const r of refs) invoiceRefNameMap.set(r.id, r.name);
  }

  const docData = {
    orderNumber: order.orderNumber ?? null,
    clientName: order.client.name,
    clientCountry: order.client.country,
    clientAddress: order.client.headOfficeAddress ?? null,
    customerContactName: order.customerContact?.name ?? null,
    customerContactRole: order.customerContact?.role ?? null,
    customerContactPhone: order.customerContact?.phone ?? null,
    customerContactEmail: order.customerContact?.email ?? null,
    vesselName: order.vessel.name,
    vesselImo: order.vessel.imo,
    portName: order.place.name,
    eta: order.eta?.toISOString() ?? null,
    etd: order.etd?.toISOString() ?? null,
    timezone: order.place.timezone ?? null,
    dateFormat: dateFormat,
    costSalesDecimalPrecision: costSalesDecimalPrecision,
    currency: order.currency ?? 'USD',
    fromName: order.salesRep?.name ?? null,
    fromEmail: order.salesRep?.email ?? null,
    fromPhone: order.salesRep?.phone ?? null,
    paymentTerms: formatCustomerPaymentTerms(order.customerPaymentTermType, order.customerCreditDays),
    dueDate: invoice.dueDate,
    customerNote: order.customerNote ?? null,
    purchaseOrderNumber: order.purchaseOrderNumber ?? null,
    deliveredAt: order.deliveredAt ?? null,
    termsAndConditions: order.termsAndConditions ?? null,
    placeRemark: order.placeRemark ?? order.place.orderRemark ?? null,
    accentColor: resolveDocAccent(order.invoicingCompany?.brandColor, brandingEnabled),
    companyName: order.invoicingCompany?.name ?? null,
    companyAddress: order.invoicingCompany?.headOfficeAddress ?? null,
    companyPhone: order.invoicingCompany?.headOfficePhone ?? null,
    companyEmail: order.invoicingCompany?.headOfficeEmail ?? null,
    companyRegistrationNumber: getCompanyRegistrationNumber(order.invoicingCompany),
    companyWebsite: order.invoicingCompany?.website ?? null,
    companyLogoDataUrl,
    itemNotes: order.items
      .filter((item) => item.customerNote && !item.hideOnDocuments && !isSupplierCreditPlaceholder(item))
      .map((item) => ({
        label: formatProductTypeLabel(item.productType),
        note: String(item.customerNote),
      })),
    items: customerFacingItems(order.items).map((item) => ({
      productType: item.productType,
      description: item.description,
      quantity: item.deliveredQuantity ?? item.quantity,
      unit: item.unit,
      priceUnit: item.salesUnit ?? item.unit,
      salesPrice: item.salesPrice,
      salesPricingModel: item.salesPricingModel,
      salesReferenceName: item.salesReferenceId ? (invoiceRefNameMap.get(item.salesReferenceId) ?? null) : null,
      salesPremium: item.salesPremium,
      salesBarging: item.salesBarging,
      salesBargingUnit: item.salesBargingUnit,
      salesCreditDays: item.salesCreditDays,
      salesPriceFinalized: item.salesPriceFinalized,
      salesCurrency: item.salesCurrency,
    })),
    createdAt: invoice.createdAt,
    verifyUrl,
    verifyLink,
    fraudPreventionText: order.invoicingCompany?.fraudPreventionText ?? null,
    bank,
    vatNumber: order.invoicingCompany?.vatNumber ?? null,
    latePaymentInterest: order.invoicingCompany?.latePaymentInterest ?? null,
    docTitle: 'INVOICE',
    printMeta: null as DocumentPrintMeta | null,
    // The invoice's OWN frozen total, not a fresh sum of the lines: the two can
    // differ if the order was edited between issuance and the first render.
    frozenTotal: invoice.amount,
    trancheLabel: invoice.trancheLabel,
    tranchePercent: invoice.tranchePercent,
    orderLinesTotal: invoice.trancheSeq == null ? null : await computeInvoiceAmountForItems(order.items),
    trancheSeq: invoice.trancheSeq,
  };

  const docDefinition = buildProformaDocument(docData);
  const buffer = await createPdfBuffer(docDefinition);
  const fileName = `Fueld_Invoice_${invoiceNumber.replace(/[^a-zA-Z0-9-]/g, '_')}.pdf`;
  const revision = await persistDocumentRevision({
    tenantId: order.tenantId,
    orderId: order.id,
    invoiceId: invoice.id,
    documentType: 'INVOICE',
    fileName,
    buffer,
  });

  if (revision.isNew) {
    const verifyTokenLink = `${getPublicApiBaseUrl()}/verify/token/${revision.verifyToken}`;
    let verifyTokenQr = docData.verifyUrl;
    try {
      verifyTokenQr = await QRCode.toDataURL(verifyTokenLink, { width: 160, margin: 1 });
    } catch {
      // keep existing QR (or null) if token QR generation fails
    }
    const finalized = buildProformaDocument({
      ...docData,
      verifyUrl: verifyTokenQr,
      verifyLink: verifyTokenLink,
      printMeta: {
        issuedAt: revision.issuedAt,
        revisionNumber: revision.revisionNumber,
        verificationRef: revision.verificationRef,
        fingerprintShort: revision.fingerprintShort,
      },
    });
    const finalizedBuffer = await createPdfBuffer(finalized);
    await overwriteDocumentRevisionArtifact(revision, finalizedBuffer);
  }

  const canonicalBuffer = loadDocumentRevisionBuffer(revision);

  return { buffer: canonicalBuffer, invoiceNumber, fileName, revision };
}

// ─── Internal: pdfmake → Buffer ──────────────────────────────────────

function createPdfBuffer(docDefinition: TDocumentDefinitions): Promise<Buffer> {
  const pdf = pdfmake.createPdf(docDefinition);
  return pdf.getBuffer();
}

// ═══════════════════════════════════════════════════════════════════════
//  Offer PDF
// ═══════════════════════════════════════════════════════════════════════

export function buildOfferDocument(data: {
  orderNumber: string | null;
  clientName: string;
  clientCountry: string | null;
  clientAddress: string | null;
  customerContactName: string | null;
  customerContactRole: string | null;
  customerContactPhone: string | null;
  customerContactEmail: string | null;
  agentName?: string | null;
  agentAddress?: string | null;
  agentContactName?: string | null;
  agentContactRole?: string | null;
  agentContactPhone?: string | null;
  agentContactEmail?: string | null;
  vesselName: string;
  vesselImo: string | null;
  portName: string;
  eta: string | null;
  etd: string | null;
  timezone: string | null;
  dateFormat?: string | null;
  costSalesDecimalPrecision?: number | null;
  /** Tenant accent for rules/labels — the issuing company's brandColor. */
  accentColor?: string | null;
  fromName: string | null;
  fromEmail: string | null;
  fromPhone: string | null;
  paymentTerms: string | null;
  customerNote: string | null;
  termsAndConditions: string | null;
  placeRemark: string | null;
  // Broker deals: the nomination is for the account of the deal's customer
  // account (e.g. Ocean7 Chartering), not our own invoicing company.
  accountName?: string | null;
  companyName: string | null;
  companyAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  companyRegistrationNumber?: string | null;
  vatNumber?: string | null;
  companyWebsite: string | null;
  companyLogoDataUrl: string | null;
  itemNotes: Array<{ label: string; note: string }>;
  currency: string;
  items: Array<{
    productType: string;
    description: string | null;
    quantity: string;
    quantityMin: string | null;
    quantityMax: string | null;
    unit: string;
    priceUnit?: string;
    salesPrice: string | null;
    salesPricingModel?: string | null;
    salesReferenceName?: string | null;
    salesPremium?: string | null;
    salesBarging?: string | null;
    salesBargingUnit?: string | null;
    salesCreditDays?: number | null;
    salesPriceFinalized?: boolean | null;
    salesCurrency?: string | null;
  }>;
  createdAt: Date;
  docTitle?: string;
  verifyUrl?: string | null;
  supplierResponseUrl?: string | null;
  supplierResponseQrUrl?: string | null;
  supplierResponseTitle?: string | null;
  supplierResponseText?: string | null;
  printMeta?: DocumentPrintMeta | null;
  purchaseOrderNumber?: string | null;
  hidePrices?: boolean;
}): TDocumentDefinitions {
  // Heading colour: the tenant's accent when they set a legible one, else the
  // previous near-black. Using the blue default here would silently restyle
  // every unbranded tenant's live documents.
  const accentText = resolveOptionalDocAccent(data.accentColor) ?? '#111827';

  // Tenant accent (validated); Fueld blue when the issuer has none.
  const accent = resolveDocAccent(data.accentColor);

  // ── Prepare data ──────────────────────────────────────────────────
  const refNum = data.orderNumber ?? 'DRAFT';
  const senderName = data.companyName?.trim() || 'Fueld Trading';
  const dd = String(data.createdAt.getUTCDate()).padStart(2, '0');
  const mm = String(data.createdAt.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = data.createdAt.getUTCFullYear();
  // Same as the invoice: the document date is a date on the page, so it follows
  // the tenant's configured format rather than a hardcoded DD-MM-YYYY.
  const createdDate = formatStoredDateOnlyForDisplay(data.createdAt, null, data.dateFormat ?? undefined)
    ?? `${dd}-${mm}-${yyyy}`;
  const title = data.docTitle ?? 'OFFER';
  const openingTopMargin = title === 'NOMINATION' ? 8 : 18;
  const showAgentBlock = (title === 'CONFIRMATION' || title === 'NOMINATION')
    && (
      !!data.agentName?.trim()
      || !!data.agentContactName?.trim()
      || !!data.agentContactEmail?.trim()
      || !!data.agentContactPhone?.trim()
    );
  const openingSentence = title === 'NOMINATION'
    ? 'With reference to our correspondence, we are pleased to nominate to you the following:'
    : title === 'CONFIRMATION'
      ? 'With reference to our correspondence, we are pleased to confirm to you the following:'
      : 'With reference to our correspondence, we are pleased to offer to you the following:';

  const agentContactDetailsLine: Content | null = (() => {
    const parts: Array<string | { text: string; link?: string; color?: string }> = [];
    const email = data.agentContactEmail?.trim();
    const phone = data.agentContactPhone?.trim();
    if (email) {
      parts.push({ text: email, link: `mailto:${email}`, color: accent });
    }
    if (email && phone) {
      parts.push('  |  ');
    }
    if (phone) {
      parts.push({ text: formatPhoneDisplay(phone) ?? phone, link: phoneToTelUri(phone), color: accent });
    }
    if (!parts.length) return null;
    return {
      text: [{ text: 'Contact details:  ', bold: true }, ...parts],
      margin: [0, 0, 0, 4],
    } as Content;
  })();

  // Customer address block (top-left)
  const customerBlock: Content[] = buildCustomerBlock({
    clientName: data.clientName,
    customerContactName: data.customerContactName,
    clientAddress: data.clientAddress,
    clientCountry: data.clientCountry,
  });

  // Right-side meta block (Date / Ref / Page — Page is dynamic via header)
  const rightMetaBlock: Content[] = [];
  if (data.companyLogoDataUrl) {
    rightMetaBlock.push({ image: data.companyLogoDataUrl, fit: [150, 50], alignment: 'right', margin: [0, 0, 0, 8] } as Content);
  }

  // Items table
  const tableHeader: TableCell[] = data.hidePrices
    ? [
        { text: 'Product', style: 'tableHeader' },
        { text: 'Quantity', style: 'tableHeader', alignment: 'right' },
        { text: 'Unit', style: 'tableHeader' },
      ]
    : [
        { text: 'Product', style: 'tableHeader' },
        { text: 'Quantity', style: 'tableHeader', alignment: 'right' },
        { text: 'Unit', style: 'tableHeader' },
        { text: 'Price', style: 'tableHeader', alignment: 'right' },
      ];

  // Compute fixed decimal places so all items align — min 2, max = highest dp in data
  const qtyDecimals = computeMaxDecimalPlaces(data.items, 'quantity');
  const priceDecimals = computeMaxDecimalPlaces(data.items, 'salesPrice');

  const tableRows: TableCell[][] = data.items.map((item) => {
    // Render the quantity range (min - max) when a min is set and differs from
    // the max. The max normally lives in `quantity` (quantityMax is unused /
    // always null in stored data), but honour quantityMax when present. Matches
    // the inquiry/email PDF range rendering.
    const maxQty = formatNumber(
      item.quantityMax != null && String(item.quantityMax).trim() !== '' ? item.quantityMax : item.quantity,
      qtyDecimals,
    );
    const minQty = item.quantityMin != null && String(item.quantityMin).trim() !== ''
      ? formatNumber(item.quantityMin, qtyDecimals)
      : '';
    const qty = minQty && minQty !== maxQty ? `${minQty} - ${maxQty}` : maxQty;
    const desc = item.description?.trim();
    const productCell: Content = item.productType === 'ITEM' && desc
      ? { text: desc }
      : desc
        ? { text: [{ text: formatProductTypeLabel(item.productType) }, { text: `  ${desc}`, fontSize: 8, color: '#374151' }] }
        : { text: formatProductTypeLabel(item.productType) };

    const baseRow: TableCell[] = [
      productCell as TableCell,
      { text: qty, alignment: 'right' },
      { text: item.unit },
    ];

    if (!data.hidePrices) {
      let priceCell: Content;
      if (item.salesPricingModel === 'FORMULA') {
        const parts: Content[] = [];
        if (item.salesReferenceName) parts.push({ text: item.salesReferenceName, bold: true, fontSize: 9 });
        if (item.salesPremium && parseFloat(item.salesPremium)) parts.push({ text: ` + ${formatNumber(item.salesPremium)} /${item.priceUnit ?? item.unit}`, fontSize: 8 });
        if (item.salesBarging && parseFloat(item.salesBarging)) parts.push({ text: `\nbarging ${formatNumber(item.salesBarging)} ${item.salesBargingUnit || 'l/s'}`, fontSize: 8 });
        if (item.salesPriceFinalized) {
          parts.push({ text: `\n→ ${formatNumber(item.salesPrice, priceDecimals)} ${item.salesCurrency || data.currency}/${item.priceUnit ?? item.unit}`, fontSize: 8, bold: true });
        }
        priceCell = { text: parts, alignment: 'right' };
      } else {
        priceCell = { text: `${item.salesCurrency || data.currency}/${item.priceUnit ?? item.unit}  ${formatNumber(item.salesPrice, priceDecimals)}`, alignment: 'right' };
      }
      baseRow.push(priceCell as TableCell);
    }

    return baseRow;
  });

  // Delivery date string
  let deliveryDateStr = '';
  if (data.eta) {
    const hasRange = !!data.etd;
    const fmtEta = formatDateTimeForDisplay(data.eta, data.timezone, hasRange, data.dateFormat ?? undefined);
    deliveryDateStr = fmtEta ?? data.eta;
    if (data.etd) {
      const fmtEtd = formatDateTimeForDisplay(data.etd, data.timezone, false, data.dateFormat ?? undefined);
      deliveryDateStr += ` to ${fmtEtd ?? data.etd}`;
    }
  }

  // "For account of" line
  const forAccountOfText = buildOfferForAccountOfText({
    title,
    vesselName: data.vesselName,
    vesselImo: data.vesselImo,
    clientName: data.clientName,
    accountName: data.accountName,
    companyName: data.companyName,
  });

  // ── Header (3 columns: client | title | logo+date/ref) ───────────
  const customerTopOffset = data.companyLogoDataUrl ? 60 : 0;
  // Dynamically compute top page margin so the header is never clipped
  const headerContentHeight = 30 + customerTopOffset + customerBlock.length * 14 + 4;
  const topMargin = Math.max(140, headerContentHeight);

  const header = buildDocumentHeader({
    companyLogoDataUrl: data.companyLogoDataUrl,
    createdDate,
    refNum,
    purchaseOrderNumber: data.purchaseOrderNumber ?? null,
    customerBlock,
    customerTopOffset,
    title,
    sideWidth: 200,
  });

  // ── Footer (company details + page number) ────────────────────────
  const footerFn = buildDocumentFooter({
    senderName,
    companyAddress: data.companyAddress,
    companyPhone: data.companyPhone,
    companyEmail: data.companyEmail,
    vatNumber: data.vatNumber ?? null,
    companyRegistrationNumber: data.companyRegistrationNumber ?? null,
    printMeta: data.printMeta ?? null,
    dateFormat: data.dateFormat,
    accent,
  });

  // ── Document definition ───────────────────────────────────────────
  return {
    pageSize: 'A4',
    pageMargins: [40, topMargin, 40, 80],
    header,
    content: [
      // Vessel / Delivery info (single-column stack)
      {
        stack: [
          {
            text: openingSentence,
            margin: [0, openingTopMargin, 0, 12],
          } as Content,
          {
            columns: [
              { width: 90, text: 'Vessel:', bold: true },
              { width: '*', text: `${data.vesselName}${data.vesselImo ? ` (IMO: ${data.vesselImo})` : ''}` },
            ],
          } as Content,
          {
            columns: [
              { width: 90, text: 'Delivery place:', bold: true },
              { width: '*', text: data.portName },
            ],
            margin: [0, 2, 0, 0],
          } as Content,
          ...(deliveryDateStr ? [{
            columns: [
              { width: 90, text: 'Delivery date:', bold: true },
              { width: '*', text: deliveryDateStr },
            ],
            margin: [0, 2, 0, 0],
          } as Content] : []),
        ],
        margin: [0, 0, 0, 10],
      } as Content,

      // Items table
      {
        table: {
          headerRows: 1,
          widths: ['*', 70, 35, 120],
          body: [tableHeader, ...tableRows],
        },
        layout: {
          hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
            i === 0 || i === 1 || i === node.table.body.length ? 1 : 0,
          vLineWidth: () => 0,
          hLineColor: () => '#111827',
          paddingTop: () => 5,
          paddingBottom: () => 5,
        },
      } as Content,
      { text: '', margin: [0, 10, 0, 0] } as Content,

      ...(showAgentBlock
        ? [
            ...(data.agentName?.trim()
              ? [{ text: [{ text: 'Agent:  ', bold: true }, { text: data.agentName.trim() }], margin: [0, 0, 0, 2] } as Content]
              : []),
            ...(data.agentContactName?.trim()
              ? [{ text: [{ text: 'Contact person:  ', bold: true }, { text: data.agentContactName.trim() }], margin: [0, 0, 0, 2] } as Content]
              : []),
            ...(agentContactDetailsLine ? [agentContactDetailsLine] : []),
            { text: '', margin: [0, 0, 0, 2] } as Content,
          ]
        : []),

      // For account of
      { text: [{ text: 'For account of:  ', bold: true }, { text: forAccountOfText }], margin: [0, 0, 0, 4] } as Content,

      // Payment terms
      ...(data.paymentTerms
        ? [{ text: [{ text: 'Payment terms:  ', bold: true }, { text: data.paymentTerms }], margin: [0, 0, 0, 6] } as Content]
        : []),

      // Notes
      ...buildNotesSection({
        customerNote: data.customerNote,
        termsAndConditions: data.termsAndConditions,
        itemNotes: data.itemNotes,
        placeRemark: data.placeRemark,
      }),

      ...(data.supplierResponseUrl ? [
        { text: data.supplierResponseTitle ?? 'Supplier response', style: 'sectionLabel', margin: [0, 10, 0, 6] } as Content,
        {
          columns: [
            {
              width: '*',
              stack: [
                { text: data.supplierResponseText ?? 'Confirm delivery completion, submit the exact delivery time, and upload the BDRs via this secure link.', margin: [0, 0, 0, 6] } as Content,
                {
                  text: data.supplierResponseUrl,
                  link: data.supplierResponseUrl,
                  color: '#1d4ed8',
                  decoration: 'underline',
                  fontSize: 9,
                } as Content,
              ],
            },
            ...(data.supplierResponseQrUrl ? [{
              width: 'auto',
              stack: [
                { image: data.supplierResponseQrUrl, fit: [80, 80], alignment: 'right' } as Content,
                { text: 'Scan to open delivery response form', fontSize: 7, color: '#6b7280', alignment: 'center', margin: [0, 4, 0, 0] } as Content,
              ],
            } as Content] : []),
          ],
          margin: [0, 0, 0, 6],
        } as Content,
      ] : []),

      // Sign-off (with optional QR code on the right)
      { text: '', margin: [0, 8, 0, 0] } as Content,
      ...(data.verifyUrl ? [{
        columns: [
          {
            width: '*',
            stack: [
              { text: 'Best regards', margin: [0, 0, 0, 6] } as Content,
              { text: senderName, bold: true, margin: [0, 0, 0, 2] } as Content,
              ...(data.fromName?.trim()
                ? [{ text: data.fromName.trim(), fontSize: 9 } as Content]
                : []),
              { text: '', margin: [0, 2, 0, 0] } as Content,
              ...(data.fromEmail?.trim()
                ? [emailTextNode('Direct Email:  ', data.fromEmail.trim(), { fontSize: 9, accent })]
                : []),
              ...(data.fromPhone?.trim()
                ? [phoneTextNode('Direct Phone:  ', data.fromPhone.trim(), { fontSize: 9, accent })]
                : []),
            ],
          },
          {
            width: 'auto',
            stack: [
              { image: data.verifyUrl, fit: [80, 80], alignment: 'right' } as Content,
              { text: 'Scan to verify', fontSize: 7, color: '#6b7280', alignment: 'center', margin: [0, 4, 0, 0] } as Content,
            ],
          },
        ],
      } as Content] : [
        { text: 'Best regards', margin: [0, 0, 0, 6] } as Content,
        { text: senderName, bold: true, margin: [0, 0, 0, 2] } as Content,
        ...(data.fromName?.trim()
          ? [{ text: data.fromName.trim(), fontSize: 9 } as Content]
          : []),
        { text: '', margin: [0, 2, 0, 0] } as Content,
        ...(data.fromEmail?.trim()
          ? [emailTextNode('Direct Email:  ', data.fromEmail.trim(), { fontSize: 9, accent })]
          : []),
        ...(data.fromPhone?.trim()
          ? [phoneTextNode('Direct Phone:  ', data.fromPhone.trim(), { fontSize: 9, accent })]
          : []),
      ]),
    ],
    footer: footerFn,
    styles: {
      docTitle: { fontSize: 16, bold: true, color: '#111827' },
      // Same treatment as the proforma: a tenant that sets a brand colour must
      // not see it on the invoice but near-black headings on the offer for the
      // same deal.
      sectionLabel: { fontSize: 10, bold: true, color: accentText, margin: [0, 0, 0, 4] },
      tableHeader: { fontSize: 9, bold: true, color: accentText },
    },
    defaultStyle: { fontSize: 10, font: 'Roboto' },
  };
}

/**
 * Generate an Offer PDF buffer for a given order ID.
 */
export async function generateOfferPdfBuffer(orderId: string, options?: {
  includeHiddenItems?: boolean;
  documentTitleOverride?: string;
  documentTypeOverride?: DocumentType;
  baseFileNameOverride?: string;
}): Promise<{
  buffer: Buffer;
  fileName: string;
  revision: DocumentRevisionInfo;
}> {
  const includeHidden = options?.includeHiddenItems ?? false;
  void includeHidden; // kept for API compat: hideOnDocuments lines stay excluded everywhere; CREDIT_NOTE lines are now also unconditionally excluded
  const order = await fetchOrderForInvoice(orderId);
  const { dateFormat } = await getDateFormatSettings(order.tenantId);
  const { enabled: brandingEnabled } = await getDocumentBrandingSettings(order.tenantId);
  const { precision: costSalesDecimalPrecision } = await getCostSalesDecimalPrecision();
  const isInquiryContext = order.status === 'INQUIRY' || order.status === 'OFFER';
  const documentTitle = options?.documentTitleOverride ?? (isInquiryContext ? 'OFFER' : 'CONFIRMATION');
  const documentName = options?.documentTitleOverride ?? (isInquiryContext ? 'Offer' : 'Confirmation');
  const baseFileName = options?.baseFileNameOverride ?? (isInquiryContext ? 'Offer' : 'Confirmation');
  const existingRevision = await getLatestDocumentRevisionByStream({
    documentType: 'OFFER',
    orderId: order.id,
  });

  const offerSourceUpdatedAtMs = maxMs([
    order.updatedAt,
    order.client.updatedAt,
    order.vessel.updatedAt,
    order.place.updatedAt,
    order.invoicingCompany?.updatedAt ?? null,
    order.salesRep?.updatedAt ?? null,
    order.customerContact?.updatedAt ?? null,
    order.supplierContact?.updatedAt ?? null,
  ]);
  const offerItemUpdatedAtMs = maxItemUpdatedAtMs(order.items);
  const offerCombinedUpdatedAtMs = Math.max(offerSourceUpdatedAtMs, offerItemUpdatedAtMs);

  if (existingRevision && offerCombinedUpdatedAtMs <= existingRevision.issuedAt.getTime()) {
    const existingBuffer = loadDocumentRevisionBuffer(existingRevision);
    const existingFileName = `${baseFileName}_${order.orderNumber ?? orderId.slice(0, 8)}.pdf`;
    return { buffer: existingBuffer, fileName: existingFileName, revision: existingRevision };
  }

  const companyLogoDataUrl = tryLoadLogoDataUrl(order.invoicingCompany?.logoUrl ?? null);

  // Resolve price reference names for formula-priced items
  const refIds = new Set<string>();
  for (const item of order.items) {
    if (item.salesReferenceId) refIds.add(item.salesReferenceId);
    if (item.costReferenceId) refIds.add(item.costReferenceId);
  }
  const refNameMap = new Map<string, string>();
  if (refIds.size > 0) {
    const refs = await db.select({ id: priceReferences.id, name: priceReferences.name })
      .from(priceReferences)
      .where(inArray(priceReferences.id, [...refIds]));
    for (const r of refs) refNameMap.set(r.id, r.name);
  }

  const docData = {
    orderNumber: order.orderNumber,
    clientName: order.client.name,
    clientCountry: order.client.country,
    clientAddress: order.client.headOfficeAddress ?? null,
    customerContactName: order.customerContact?.name ?? null,
    customerContactRole: order.customerContact?.role ?? null,
    customerContactPhone: order.customerContact?.phone ?? null,
    customerContactEmail: order.customerContact?.email ?? null,
    agentName: order.agent?.name ?? null,
    agentContactName: order.agentContact?.name ?? null,
    agentContactPhone: order.agentContact?.phone ?? null,
    agentContactEmail: order.agentContact?.email ?? null,
    vesselName: order.vessel.name,
    vesselImo: order.vessel.imo,
    portName: order.place.name,
    eta: order.eta?.toISOString() ?? null,
    etd: order.etd?.toISOString() ?? null,
    timezone: order.place.timezone ?? null,
    dateFormat: dateFormat,
    costSalesDecimalPrecision: costSalesDecimalPrecision,
    fromName: order.salesRep?.name ?? null,
    fromEmail: order.salesRep?.email ?? null,
    fromPhone: order.salesRep?.phone ?? null,
    paymentTerms: formatCustomerPaymentTerms(order.customerPaymentTermType, order.customerCreditDays),
    customerNote: order.customerNote ?? null,
    purchaseOrderNumber: order.purchaseOrderNumber ?? null,
    termsAndConditions: replaceCompanyNamePlaceholder(
      order.termsAndConditions ?? order.client?.specialCustomerTerms ?? order.invoicingCompany?.customerTerms ?? null,
      order.invoicingCompany?.name ?? null,
      documentName,
    ),
    placeRemark: order.placeRemark ?? order.place.orderRemark ?? null,
    accentColor: resolveDocAccent(order.invoicingCompany?.brandColor, brandingEnabled),
    companyName: order.invoicingCompany?.name ?? null,
    companyAddress: order.invoicingCompany?.headOfficeAddress ?? null,
    companyPhone: order.invoicingCompany?.headOfficePhone ?? null,
    companyEmail: order.invoicingCompany?.headOfficeEmail ?? null,
    companyRegistrationNumber: getCompanyRegistrationNumber(order.invoicingCompany),
    vatNumber: order.invoicingCompany?.vatNumber ?? null,
    companyWebsite: order.invoicingCompany?.website ?? null,
    companyLogoDataUrl,
    itemNotes: order.items
      .filter((item) => item.customerNote && !item.hideOnDocuments && !isSupplierCreditPlaceholder(item))
      .map((item) => ({
        label: formatProductTypeLabel(item.productType),
        note: String(item.customerNote),
      })),
    currency: order.currency ?? 'USD',
    items: customerFacingItems(order.items).map((item) => ({
      productType: item.productType,
      description: item.description,
      quantity: item.quantity,
      quantityMin: item.quantityMin,
      quantityMax: item.quantityMax,
      unit: item.unit,
      priceUnit: item.salesUnit ?? item.unit,
      salesPrice: item.salesPrice,
      salesPricingModel: item.salesPricingModel,
      salesReferenceName: item.salesReferenceId ? (refNameMap.get(item.salesReferenceId) ?? null) : null,
      salesPremium: item.salesPremium,
      salesBarging: item.salesBarging,
      salesBargingUnit: item.salesBargingUnit,
      salesCreditDays: item.salesCreditDays,
      salesPriceFinalized: item.salesPriceFinalized,
      salesCurrency: item.salesCurrency,
    })),
    createdAt: order.createdAt,
    docTitle: documentTitle,
    verifyUrl: null as string | null,
    printMeta: null,
    hidePrices: (order as any).isBrokerDeal ?? false,
  };

  const docDefinition = buildOfferDocument(docData);
  const buffer = await createPdfBuffer(docDefinition);
  const fileName = `${baseFileName}_${order.orderNumber ?? orderId.slice(0, 8)}.pdf`;
  const revision = await persistDocumentRevision({
    tenantId: order.tenantId,
    orderId: order.id,
    documentType: options?.documentTypeOverride ?? 'OFFER',
    fileName,
    buffer,
  });

  if (revision.isNew) {
    const finalized = buildOfferDocument({
      ...docData,
      printMeta: {
        issuedAt: revision.issuedAt,
        revisionNumber: revision.revisionNumber,
        verificationRef: revision.verificationRef,
        fingerprintShort: revision.fingerprintShort,
      },
    });
    const finalizedBuffer = await createPdfBuffer(finalized);
    await overwriteDocumentRevisionArtifact(revision, finalizedBuffer);
  }

  const canonicalBuffer = loadDocumentRevisionBuffer(revision);

  return { buffer: canonicalBuffer, fileName, revision };
}

/**
 * Generate a broker confirmation PDF — includes ALL line items (including
 * those marked hideOnDocuments=true, e.g. broker commission line items).
 * Sent to the broker contact, not the customer.
 */
export async function generateBrokerConfirmationPdfBuffer(orderId: string): Promise<{
  buffer: Buffer;
  fileName: string;
}> {
  const { buffer, fileName } = await generateOfferPdfBuffer(orderId, {
    includeHiddenItems: true,
    documentTitleOverride: 'BROKER CONFIRMATION',
    documentTypeOverride: 'BROKER_CONFIRMATION',
    baseFileNameOverride: 'BrokerConfirmation',
  });
  return { buffer, fileName };
}

/**
 * Generate a supplier-facing nomination PDF for a given order ID.
 * Reuses the confirmation layout and content structure.
 */
function resolveNominationSupplierContext(
  order: Awaited<ReturnType<typeof fetchOrderForInvoice>>,
  orderSupplierId?: string | null,
) {
  const supplierLegs = order.orderSuppliers ?? [];
  if (supplierLegs.length > 0) {
    const selectedSupplier = orderSupplierId
      ? supplierLegs.find((supplier) => supplier.id === orderSupplierId) ?? null
      : supplierLegs.length === 1
        ? supplierLegs[0]!
        : supplierLegs.find((supplier) => supplier.isPrimary) ?? supplierLegs[0]!;

    if (!selectedSupplier) {
      throw new Error('Selected supplier does not belong to this order');
    }

    const items = supplierLegs.length <= 1
      ? order.items
      : order.items.filter((item) => item.orderSupplierId === selectedSupplier.id || (selectedSupplier.isPrimary && !item.orderSupplierId));

    return {
      selectedSupplier,
      supplier: selectedSupplier.company ?? order.supplier,
      supplierContact: selectedSupplier.contact ?? order.supplierContact,
      paymentTermType: selectedSupplier.paymentTermType ?? order.supplierPaymentTermType,
      creditDays: selectedSupplier.creditDays ?? order.supplierCreditDays,
      items,
      streamVariant: supplierLegs.length > 1 ? `supplier:${selectedSupplier.id}` : null,
    };
  }

  if (!order.supplier) {
    throw new Error('Select a supplier before generating Nomination PDF');
  }

  return {
    selectedSupplier: null,
    supplier: order.supplier,
    supplierContact: order.supplierContact,
    paymentTermType: order.supplierPaymentTermType,
    creditDays: order.supplierCreditDays,
    items: order.items,
    streamVariant: null,
  };
}

export async function generateNominationPdfBuffer(orderId: string, options?: {
  orderSupplierId?: string | null;
  responseUrl?: string | null;
}): Promise<{
  buffer: Buffer;
  fileName: string;
  revision: DocumentRevisionInfo;
}> {
  const order = await fetchOrderForInvoice(orderId);
  const { dateFormat } = await getDateFormatSettings(order.tenantId);
  const { enabled: brandingEnabled } = await getDocumentBrandingSettings(order.tenantId);
  const { precision: costSalesDecimalPrecision } = await getCostSalesDecimalPrecision();
  const nominationContext = resolveNominationSupplierContext(order, options?.orderSupplierId ?? null);
  if (!nominationContext.items.length) {
    throw new Error('Assign at least one line item to the selected supplier before generating Nomination PDF');
  }

  const existingRevision = await getLatestDocumentRevisionByStream({
    documentType: 'OTHER',
    orderId: order.id,
    streamVariant: nominationContext.streamVariant,
  });

  const nominationSourceUpdatedAtMs = maxMs([
    order.updatedAt,
    nominationContext.selectedSupplier?.updatedAt ?? null,
    nominationContext.supplier?.updatedAt ?? null,
    order.agent?.updatedAt ?? null,
    order.vessel.updatedAt,
    order.place.updatedAt,
    order.invoicingCompany?.updatedAt ?? null,
    order.salesRep?.updatedAt ?? null,
    nominationContext.supplierContact?.updatedAt ?? null,
    order.agentContact?.updatedAt ?? null,
  ]);
  const nominationItemUpdatedAtMs = maxItemUpdatedAtMs(nominationContext.items);
  const nominationCombinedUpdatedAtMs = Math.max(nominationSourceUpdatedAtMs, nominationItemUpdatedAtMs);

  if (existingRevision && nominationCombinedUpdatedAtMs <= existingRevision.issuedAt.getTime()) {
    const existingBuffer = loadDocumentRevisionBuffer(existingRevision);
    const existingFileName = `Nomination_${order.orderNumber ?? orderId.slice(0, 8)}.pdf`;
    return { buffer: existingBuffer, fileName: existingFileName, revision: existingRevision };
  }

  const companyLogoDataUrl = tryLoadLogoDataUrl(order.invoicingCompany?.logoUrl ?? null);
  let supplierResponseQrUrl: string | null = null;
  if (options?.responseUrl) {
    try {
      supplierResponseQrUrl = await QRCode.toDataURL(options.responseUrl, { width: 160, margin: 1 });
    } catch {
      supplierResponseQrUrl = null;
    }
  }

  // Resolve price reference names for formula-priced items
  const nomRefIds = new Set<string>();
  for (const item of order.items) {
    if (item.salesReferenceId) nomRefIds.add(item.salesReferenceId);
    if (item.costReferenceId) nomRefIds.add(item.costReferenceId);
  }
  const nomRefNameMap = new Map<string, string>();
  if (nomRefIds.size > 0) {
    const refs = await db.select({ id: priceReferences.id, name: priceReferences.name })
      .from(priceReferences)
      .where(inArray(priceReferences.id, [...nomRefIds]));
    for (const r of refs) nomRefNameMap.set(r.id, r.name);
  }

  const docData = {
    orderNumber: order.orderNumber,
    clientName: nominationContext.supplier?.name ?? 'Supplier',
    clientCountry: nominationContext.supplier?.country ?? null,
    clientAddress: nominationContext.supplier?.headOfficeAddress ?? null,
    customerContactName: nominationContext.supplierContact?.name ?? null,
    customerContactRole: nominationContext.supplierContact?.role ?? null,
    customerContactPhone: nominationContext.supplierContact?.phone ?? null,
    customerContactEmail: nominationContext.supplierContact?.email ?? null,
    agentName: order.agent?.name ?? null,
    agentContactName: order.agentContact?.name ?? null,
    agentContactPhone: order.agentContact?.phone ?? null,
    agentContactEmail: order.agentContact?.email ?? null,
    vesselName: order.vessel.name,
    vesselImo: order.vessel.imo,
    portName: order.place.name,
    eta: order.eta?.toISOString() ?? null,
    etd: order.etd?.toISOString() ?? null,
    timezone: order.place.timezone ?? null,
    dateFormat: dateFormat,
    costSalesDecimalPrecision: costSalesDecimalPrecision,
    fromName: order.salesRep?.name ?? null,
    fromEmail: order.salesRep?.email ?? null,
    fromPhone: order.salesRep?.phone ?? null,
    paymentTerms: formatCustomerPaymentTerms(nominationContext.paymentTermType, nominationContext.creditDays),
    customerNote: nominationContext.selectedSupplier?.note ?? order.supplierNote ?? null,
    termsAndConditions: replaceCompanyNamePlaceholder(
      order.invoicingCompany?.supplierTerms ?? null,
      order.invoicingCompany?.name ?? null,
      'Nomination',
    ),
    placeRemark: null,
    // Broker deals: the nomination is for the account of the deal's customer
    // account (e.g. Ocean7 Chartering), not our own invoicing company.
    accountName: order.isBrokerDeal ? order.client?.name ?? null : undefined,
    accentColor: resolveDocAccent(order.invoicingCompany?.brandColor, brandingEnabled),
    companyName: order.invoicingCompany?.name ?? null,
    companyAddress: order.invoicingCompany?.headOfficeAddress ?? null,
    companyPhone: order.invoicingCompany?.headOfficePhone ?? null,
    companyEmail: order.invoicingCompany?.headOfficeEmail ?? null,
    companyRegistrationNumber: getCompanyRegistrationNumber(order.invoicingCompany),
    vatNumber: order.invoicingCompany?.vatNumber ?? null,
    companyWebsite: order.invoicingCompany?.website ?? null,
    companyLogoDataUrl,
    itemNotes: [],
    currency: order.currency ?? 'USD',
    items: customerFacingItems(nominationContext.items).map((item) => ({
      productType: item.productType,
      description: item.description,
      quantity: item.quantity,
      quantityMin: item.quantityMin,
      quantityMax: item.quantityMax,
      unit: item.unit,
      priceUnit: item.costUnit ?? item.unit,
      salesPrice: item.costPrice,
      salesPricingModel: item.costPricingModel,
      salesReferenceName: item.costReferenceId ? (nomRefNameMap.get(item.costReferenceId) ?? null) : null,
      salesPremium: item.costPremium,
      salesBarging: item.costBarging,
      salesBargingUnit: item.costBargingUnit,
      salesCreditDays: item.costCreditDays,
      salesPriceFinalized: item.costPriceFinalized,
      salesCurrency: item.costCurrency,
    })),
    createdAt: order.createdAt,
    docTitle: 'NOMINATION',
    verifyUrl: null as string | null,
    supplierResponseUrl: options?.responseUrl ?? null,
    supplierResponseQrUrl,
    supplierResponseTitle: 'Delivery confirmation link',
    supplierResponseText: 'Please confirm delivery completion, provide the exact delivery time, and upload the BDRs through this secure link.',
    printMeta: null,
  };

  const docDefinition = buildOfferDocument(docData);
  const buffer = await createPdfBuffer(docDefinition);
  const fileName = `Nomination_${order.orderNumber ?? orderId.slice(0, 8)}.pdf`;
  const revision = await persistDocumentRevision({
    tenantId: order.tenantId,
    orderId: order.id,
    streamVariant: nominationContext.streamVariant,
    documentType: 'OTHER',
    fileName,
    buffer,
  });

  if (revision.isNew) {
    const finalized = buildOfferDocument({
      ...docData,
      printMeta: {
        issuedAt: revision.issuedAt,
        revisionNumber: revision.revisionNumber,
        verificationRef: revision.verificationRef,
        fingerprintShort: revision.fingerprintShort,
      },
    });
    const finalizedBuffer = await createPdfBuffer(finalized);
    await overwriteDocumentRevisionArtifact(revision, finalizedBuffer);
  }

  const canonicalBuffer = loadDocumentRevisionBuffer(revision);

  return { buffer: canonicalBuffer, fileName, revision };
}

// ═══════════════════════════════════════════════════════════════════════
//  Proforma Invoice PDF
// ═══════════════════════════════════════════════════════════════════════

function buildProformaDocument(data: {
  orderNumber: string | null;
  clientName: string;
  clientCountry: string | null;
  clientAddress: string | null;
  customerContactName: string | null;
  customerContactRole: string | null;
  customerContactPhone: string | null;
  customerContactEmail: string | null;
  vesselName: string;
  vesselImo: string | null;
  portName: string;
  eta: string | null;
  etd: string | null;
  timezone: string | null;
  dateFormat?: string | null;
  costSalesDecimalPrecision?: number | null;
  /** Tenant accent for rules/labels — the issuing company's brandColor. */
  accentColor?: string | null;
  currency: string;
  fromName: string | null;
  fromEmail: string | null;
  fromPhone: string | null;
  paymentTerms: string | null;
  dueDate?: string | null;
  customerNote: string | null;
  termsAndConditions: string | null;
  companyName: string | null;
  companyAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  companyRegistrationNumber?: string | null;
  companyWebsite: string | null;
  companyLogoDataUrl: string | null;
  itemNotes: Array<{ label: string; note: string }>;
  items: Array<{
    productType: string;
    description: string | null;
    quantity: string;
    unit: string;
    priceUnit?: string;
    salesPrice: string | null;
    salesPricingModel?: string | null;
    salesReferenceName?: string | null;
    salesPremium?: string | null;
    salesBarging?: string | null;
    salesBargingUnit?: string | null;
    salesCreditDays?: number | null;
    salesPriceFinalized?: boolean | null;
    salesCurrency?: string | null;
  }>;
  createdAt: Date;
  verifyUrl?: string | null;
  verifyLink?: string | null;
  fraudPreventionText?: string | null;
  bank?: BankDetails | null;
  vatNumber?: string | null;
  latePaymentInterest?: string | null;
  placeRemark?: string | null;
  docTitle?: string;
  printMeta?: DocumentPrintMeta | null;
  purchaseOrderNumber?: string | null;
  deliveredAt?: Date | null;
  /**
   * Total already frozen on the invoice row. When present it wins over the sum
   * of the line items, so the headline figure on an ISSUED invoice can never
   * disagree with the receivable that aging/collections read — even if the
   * order's lines were edited in the window before the first render.
   */
  frozenTotal?: string | null;
  /** Split payment terms: which tranche this document bills. */
  trancheLabel?: string | null;
  tranchePercent?: string | null;
  /** The order's full lines total, shown so a tranche invoice reconciles. */
  orderLinesTotal?: number | null;
  trancheSeq?: number | null;
}): TDocumentDefinitions {
  // Heading colour: the tenant's accent when they set a legible one, else the
  // previous near-black. Using the blue default here would silently restyle
  // every unbranded tenant's live documents.
  const accentText = resolveOptionalDocAccent(data.accentColor) ?? '#111827';

  // Tenant accent (validated); Fueld blue when the issuer has none.
  const accent = resolveDocAccent(data.accentColor);

  // ── Prepare data ──────────────────────────────────────────────────
  const refNum = data.orderNumber ?? 'DRAFT';
  const senderName = data.companyName?.trim() || 'Fueld Trading';
  const dd2 = String(data.createdAt.getUTCDate()).padStart(2, '0');
  const mm2 = String(data.createdAt.getUTCMonth() + 1).padStart(2, '0');
  const yyyy2 = data.createdAt.getUTCFullYear();
  // The document date follows the tenant's configured format, like every other
  // date on the page — it was hardcoded DD-MM-YYYY and ignored the setting.
  const createdDate = formatStoredDateOnlyForDisplay(data.createdAt, null, data.dateFormat ?? undefined)
    ?? `${dd2}-${mm2}-${yyyy2}`;

  // Customer address block (top-left)
  const customerBlock: Content[] = buildCustomerBlock({
    clientName: data.clientName,
    customerContactName: data.customerContactName,
    clientAddress: data.clientAddress,
    clientCountry: data.clientCountry,
  });

  // Items table (with totals for confirmation/nomination)
  const tableHeader: TableCell[] = [
    { text: 'Product', style: 'tableHeader' },
    { text: 'Quantity', style: 'tableHeader', alignment: 'right' },
    { text: 'Unit', style: 'tableHeader' },
    { text: 'Price', style: 'tableHeader', alignment: 'right' },
    { text: 'Total amount', style: 'tableHeader', alignment: 'right' },
  ];

  // Compute fixed decimal places so all items align — min 2, max = highest dp in data
  const qtyDecimals = computeMaxDecimalPlaces(data.items, 'quantity');
  const priceDecimals = computeMaxDecimalPlaces(data.items, 'salesPrice');

  const tableRows: TableCell[][] = data.items.map((item) => {
    const qty = parseFloat(item.quantity) || 0;
    const unitPrice = parseFloat(item.salesPrice ?? '0') || 0;
    const lineTotal = qty * unitPrice;
    const desc = item.description?.trim();
    const productCell: Content = item.productType === 'ITEM' && desc
      ? { text: desc }
      : desc
        ? { text: [{ text: formatProductTypeLabel(item.productType) }, { text: `  ${desc}`, fontSize: 8, color: '#374151' }] }
        : { text: formatProductTypeLabel(item.productType) };

    let priceCell: Content;
    let totalCell: Content;
    if (item.salesPricingModel === 'FORMULA') {
      const parts: Content[] = [];
      if (item.salesReferenceName) parts.push({ text: item.salesReferenceName, bold: true, fontSize: 9 });
      if (item.salesPremium && parseFloat(item.salesPremium)) parts.push({ text: ` + ${formatNumber(item.salesPremium)} /${item.priceUnit ?? item.unit}`, fontSize: 8 });
      if (item.salesBarging && parseFloat(item.salesBarging)) parts.push({ text: `\nbarging ${formatNumber(item.salesBarging)} ${item.salesBargingUnit || 'l/s'}`, fontSize: 8 });
      if (item.salesPriceFinalized) {
        parts.push({ text: `\n\u2192 ${formatNumber(item.salesPrice, priceDecimals)} ${item.salesCurrency || data.currency}/${item.priceUnit ?? item.unit}`, fontSize: 8, bold: true });
        totalCell = { text: `${formatNumber(String(lineTotal), priceDecimals)} ${item.salesCurrency || data.currency}`, alignment: 'right' };
      } else {
        totalCell = { text: 'TBD', alignment: 'right', italics: true, color: '#d97706' };
      }
      priceCell = { text: parts, alignment: 'right' };
    } else {
      priceCell = { text: `${item.salesCurrency || data.currency}/${item.priceUnit ?? item.unit}  ${formatNumber(item.salesPrice, priceDecimals)}`, alignment: 'right' };
      totalCell = { text: `${formatNumber(String(lineTotal), priceDecimals)} ${item.salesCurrency || data.currency}`, alignment: 'right' };
    }

    return [
      productCell as TableCell,
      { text: formatNumber(item.quantity, qtyDecimals), alignment: 'right' },
      { text: item.unit },
      priceCell as TableCell,
      totalCell as TableCell,
    ];
  });
  const lineItemsTotal = data.items.reduce((sum, item) => {
    const qty = parseFloat(item.quantity) || 0;
    const price = parseFloat(item.salesPrice ?? '0') || 0;
    return sum + qty * price;
  }, 0);
  // An issued invoice prints its frozen total; a proforma (never invoiced)
  // prints the live sum.
  const grandTotal = data.frozenTotal != null && data.frozenTotal !== ''
    ? parseFloat(data.frozenTotal) || 0
    : lineItemsTotal;
  const grandTotalCurrency = data.items[0]?.salesCurrency || data.currency;
  // A tranche invoice bills only its share of the order, so the headline must
  // name the tranche — otherwise the customer reads "total amount due" against
  // a figure that is half the deal.
  const companyLabel = data.companyName?.trim() || 'Company';
  // numeric(6,3) serializes 50 as "50.000"; a legal document must not leak the
  // column scale, so trim trailing zeros the way the prices already are.
  const tranchePercentLabel = data.tranchePercent == null
    ? null
    : String(parseFloat(data.tranchePercent));
  const totalAmountDueLabel = data.trancheLabel || tranchePercentLabel
    ? `${data.trancheLabel ? `${data.trancheLabel} — ` : ''}${tranchePercentLabel}% of order. Total amount due to ${companyLabel}`
    : `Total amount due to ${companyLabel}`;

  // Delivery date string — use the actual marked delivery date (deliveredAt), not ETA/ETD range
  let deliveryDateStr = '';
  if (data.deliveredAt) {
    const fmtDelivered = formatDateTimeForDisplay(data.deliveredAt.toISOString(), data.timezone, false, data.dateFormat ?? undefined);
    deliveryDateStr = fmtDelivered ?? formatStoredDateOnlyForDisplay(data.deliveredAt, data.timezone, data.dateFormat ?? undefined) ?? '';
  }

  // "For account of" line (like reference PDF)
  const vesselRef = `${data.vesselName}${data.vesselImo ? ` (IMO: ${data.vesselImo})` : ''}`;
  const vesselDisplay = data.vesselName.startsWith('MV ') ? vesselRef : `MV ${vesselRef}`;
  const forAccountParts = [`Master and/or owner and/or charterers and/or ${vesselDisplay}`];
  if (data.clientName) forAccountParts.push(`and/or ${data.clientName}`);
  const hasNotesSection = !!data.customerNote?.trim() || data.itemNotes.length > 0;

  // ── Header (3 columns: client | title | logo+date/ref) ────────────
  const customerTopOffset = data.companyLogoDataUrl ? 60 : 0;
  const headerContentHeight = 30 + customerTopOffset + customerBlock.length * 14 + 4;
  const topMargin = Math.max(140, headerContentHeight);

  const header = buildDocumentHeader({
    companyLogoDataUrl: data.companyLogoDataUrl,
    createdDate,
    refNum,
    purchaseOrderNumber: data.purchaseOrderNumber ?? null,
    customerBlock,
    customerTopOffset,
    title: data.docTitle ?? 'PROFORMA INVOICE',
    sideWidth: 150,
    titleNoWrap: true,
  });

  // ── Footer (company details + page number) ────────────────────────
  const footerFn = buildDocumentFooter({
    senderName,
    companyAddress: data.companyAddress,
    companyPhone: data.companyPhone,
    companyEmail: data.companyEmail,
    vatNumber: data.vatNumber ?? null,
    companyRegistrationNumber: data.companyRegistrationNumber ?? null,
    printMeta: data.printMeta ?? null,
    dateFormat: data.dateFormat,
    accent,
  });

  // ── Document definition ───────────────────────────────────────────
  return {
    pageSize: 'A4',
    pageMargins: [40, topMargin, 40, 80],
    header,
    content: [
      // Vessel / Delivery info (single-column stack)
      {
        stack: [
          {
            columns: [
              { width: 90, text: 'Vessel:', bold: true },
              { width: '*', text: vesselRef },
            ],
          } as Content,
          {
            columns: [
              { width: 90, text: 'Delivery place:', bold: true },
              { width: '*', text: data.portName },
            ],
            margin: [0, 2, 0, 0],
          } as Content,
          ...(deliveryDateStr ? [{
            columns: [
              { width: 90, text: 'Delivery date:', bold: true },
              { width: '*', text: deliveryDateStr },
            ],
            margin: [0, 2, 0, 0],
          } as Content] : []),
        ],
        margin: [0, 20, 0, 14],
      } as Content,

      // Items table
      {
        table: {
          headerRows: 1,
          widths: ['*', 65, 35, 130, 90],
          body: [tableHeader, ...tableRows],
        },
        layout: {
          hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
            i === 0 || i === 1 || i === node.table.body.length ? 1 : 0,
          vLineWidth: () => 0,
          hLineColor: () => '#111827',
          paddingTop: () => 5,
          paddingBottom: () => 5,
        },
      } as Content,
      {
        columns: [
          { width: '*', text: totalAmountDueLabel, bold: true },
          { width: 'auto', text: `${formatNumber(String(grandTotal), priceDecimals)} ${grandTotalCurrency}`, bold: true, alignment: 'right' },
        ],
        margin: [0, 6, 0, 0],
      } as Content,
      // A tranche invoice bills a share, so the lines above it total the whole
      // deal: show that subtotal explicitly, or the reader cannot reconcile the
      // arithmetic and the invoice gets queried.
      ...(data.orderLinesTotal != null && tranchePercentLabel
        ? [{
            columns: [
              { width: '*', text: 'Order total', fontSize: 9, color: '#6b7280' },
              { width: 'auto', text: `${formatNumber(String(data.orderLinesTotal), priceDecimals)} ${grandTotalCurrency}`, fontSize: 9, color: '#6b7280', alignment: 'right' },
            ],
            margin: [0, 6, 0, 0],
          } as Content]
        : []),
      { text: '', margin: [0, 6, 0, 0] } as Content,

      // Payment terms + Notes + QR code (2-column: left has terms/notes, right has QR)
      {
        columns: [
          {
            width: '*',
            stack: [
              ...(data.paymentTerms
                ? [{ text: [{ text: 'Payment terms:  ', bold: true }, { text: data.paymentTerms.replace(/_/g, ' ') }], margin: [0, 0, 0, 2] } as Content]
                : []),
              ...(data.dueDate
                ? [{ text: [{ text: 'Due date:  ', bold: true }, { text: formatStoredDateOnlyForDisplay(data.dueDate, null, data.dateFormat ?? undefined) ?? data.dueDate }], margin: [0, 0, 0, 2] } as Content]
                : []),
              ...buildNotesSection({
                customerNote: data.customerNote,
                termsAndConditions: data.termsAndConditions ?? null,
                itemNotes: data.itemNotes,
              }),
            ],
          },
          ...(data.verifyUrl ? [{
            width: 'auto',
            stack: [
              { image: data.verifyUrl, fit: [80, 80], alignment: 'right', link: data.verifyLink ?? undefined } as Content,
              { text: 'Scan or click to verify', fontSize: 7, color: accent, alignment: 'center', margin: [0, 4, 0, 0], link: data.verifyLink ?? undefined } as Content,
              ...(data.verifyLink ? [
                { text: `Verify domain: ${new URL(data.verifyLink).hostname}`, fontSize: 6, color: '#6b7280', alignment: 'center', margin: [0, 2, 0, 0] } as Content,
              ] : []),
            ],
          } as Content] : []),
        ],
      } as Content,

      // ── Remittance Instructions ──
      ...(data.bank ? [
        { text: '', margin: [0, hasNotesSection ? 2 : 8, 0, 0] } as Content,
        { canvas: [{ type: 'line' as const, x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#e5e7eb' }] } as Content,
        { text: '', margin: [0, 6, 0, 0] } as Content,
        { text: 'REMITTANCE INSTRUCTIONS', style: 'sectionLabel' } as Content,
        { text: 'Payment to be effected, free of all charges to us, by telegraphic transfer to:', fontSize: 9, margin: [0, 2, 0, 6] } as Content,
        { text: `Please include Order Ref ${data.orderNumber ?? refNum} in the transfer message/note.`, fontSize: 9, margin: [0, 0, 0, 6] } as Content,
        {
          columns: [
            { width: '25%', text: 'Bank:', bold: true },
            { width: '75%', text: data.bank.bankName },
          ],
          margin: [0, 2, 0, 0],
        } as Content,
        ...(data.bank.branchAddress ? [{
          columns: [
            { width: '25%', text: '' },
            { width: '75%', text: data.bank.branchAddress, color: '#374151' },
          ],
          margin: [0, 2, 0, 0],
        } as Content] : []),
        ...(data.bank.accountName ? [{
          columns: [
            { width: '25%', text: 'In favour of:', bold: true },
            { width: '75%', text: data.bank.accountName },
          ],
          margin: [0, 2, 0, 0],
        } as Content] : []),
        ...(data.bank.iban ? [{
          columns: [
            { width: '25%', text: 'IBAN No:', bold: true },
            { width: '75%', text: data.bank.iban, font: 'Roboto' },
          ],
          margin: [0, 2, 0, 0],
        } as Content] : []),
        ...(data.bank.accountNumber ? [{
          columns: [
            { width: '25%', text: 'Account No:', bold: true },
            { width: '75%', text: data.bank.accountNumber, font: 'Roboto' },
          ],
          margin: [0, 2, 0, 0],
        } as Content] : []),
        ...(data.bank.swift ? [{
          columns: [
            { width: '25%', text: 'SWIFT:', bold: true },
            { width: '75%', text: data.bank.swift },
          ],
          margin: [0, 2, 0, 0],
        } as Content] : []),
        ...(data.bank.sortCode ? [{
          columns: [
            { width: '25%', text: 'Sort Code:', bold: true },
            { width: '75%', text: data.bank.sortCode },
          ],
          margin: [0, 2, 0, 0],
        } as Content] : []),
        ...(data.bank.routingNumber ? [{
          columns: [
            { width: '25%', text: 'Routing No:', bold: true },
            { width: '75%', text: data.bank.routingNumber },
          ],
          margin: [0, 2, 0, 0],
        } as Content] : []),
        ...(data.bank.intermediaryBank ? [{
          columns: [
            { width: '25%', text: 'Intermediary bank:', bold: true },
            { width: '75%', text: data.bank.intermediaryBank },
          ],
          margin: [0, 2, 0, 0],
        } as Content] : []),
      ] : []),

      // ── VAT Number ──
      ...(data.vatNumber ? [{
        text: `${data.companyName ?? 'Company'} VAT: ${data.vatNumber}`,
        fontSize: 9,
        margin: [0, 10, 0, 0],
      } as Content] : []),

      // ── Payment note ──
      ...(data.latePaymentInterest ? [{
        text: `Note : Late payment charged @ ${data.latePaymentInterest} interest, per month pro rata.`,
        fontSize: 8, color: '#b91c1c', bold: true,
        decoration: 'underline' as const,
        margin: [0, 10, 0, 0],
      } as Content] : []),

      // ── Fraud Prevention (QR moved to payment terms section) ──
      ...(data.fraudPreventionText ? [
        { text: '', margin: [0, 10, 0, 0] } as Content,
        { text: 'FRAUD PREVENTION', fontSize: 9, bold: true, margin: [0, 0, 0, 4] } as Content,
        { text: data.fraudPreventionText, fontSize: 8, color: '#374151', margin: [0, 0, 10, 0] } as Content,
      ] : []),
    ],
    footer: footerFn,
    styles: {
      docTitle: { fontSize: 16, bold: true, color: '#111827' },
      // Section headings carry the tenant accent, so a tenant that sets a brand
      // colour sees it on every document rather than Fueld's blue.
      sectionLabel: { fontSize: 10, bold: true, color: accentText, margin: [0, 0, 0, 4] },
      tableHeader: { fontSize: 9, bold: true, color: accentText },
    },
    defaultStyle: { fontSize: 10, font: 'Roboto' },
  };
}

/**
 * Generate a Proforma Invoice PDF buffer for a given order ID.
 */
export async function generateProformaInvoicePdfBuffer(orderId: string): Promise<{
  buffer: Buffer;
  fileName: string;
  revision: DocumentRevisionInfo;
}> {
  const order = await fetchOrderForInvoice(orderId);
  const { dateFormat } = await getDateFormatSettings(order.tenantId);
  const { enabled: brandingEnabled } = await getDocumentBrandingSettings(order.tenantId);
  const { precision: costSalesDecimalPrecision } = await getCostSalesDecimalPrecision();
  const existingRevision = await getLatestDocumentRevisionByStream({
    documentType: 'PROFORMA_INVOICE',
    orderId: order.id,
  });

  const proformaSourceUpdatedAtMs = maxMs([
    order.updatedAt,
    order.client.updatedAt,
    order.vessel.updatedAt,
    order.place.updatedAt,
    order.invoicingCompany?.updatedAt ?? null,
    order.salesRep?.updatedAt ?? null,
    order.customerContact?.updatedAt ?? null,
    order.supplierContact?.updatedAt ?? null,
  ]);
  const proformaItemUpdatedAtMs = maxItemUpdatedAtMs(order.items);
  const proformaCombinedUpdatedAtMs = Math.max(proformaSourceUpdatedAtMs, proformaItemUpdatedAtMs);

  if (existingRevision && proformaCombinedUpdatedAtMs <= existingRevision.issuedAt.getTime()) {
    const existingBuffer = loadDocumentRevisionBuffer(existingRevision);
    const existingFileName = `Proforma_Invoice_${order.orderNumber ?? orderId.slice(0, 8)}.pdf`;
    return { buffer: existingBuffer, fileName: existingFileName, revision: existingRevision };
  }

  const companyLogoDataUrl = tryLoadLogoDataUrl(order.invoicingCompany?.logoUrl ?? null);
  const bank = await loadOrderBankDetails(order.bankAccountId, order.invoicingCompanyId);

  // Resolve price reference names for formula-priced items
  const proformaRefIds = new Set<string>();
  for (const item of order.items) {
    if (item.salesReferenceId) proformaRefIds.add(item.salesReferenceId);
  }
  const proformaRefNameMap = new Map<string, string>();
  if (proformaRefIds.size > 0) {
    const refs = await db.select({ id: priceReferences.id, name: priceReferences.name })
      .from(priceReferences)
      .where(inArray(priceReferences.id, [...proformaRefIds]));
    for (const r of refs) proformaRefNameMap.set(r.id, r.name);
  }

  const paymentTerms = formatCustomerPaymentTerms(
    order.customerPaymentTermType,
    order.customerCreditDays,
  );

  const docData = {
    orderNumber: order.orderNumber,
    clientName: order.client.name,
    clientCountry: order.client.country,
    clientAddress: order.client.headOfficeAddress ?? null,
    customerContactName: order.customerContact?.name ?? null,
    customerContactRole: order.customerContact?.role ?? null,
    customerContactPhone: order.customerContact?.phone ?? null,
    customerContactEmail: order.customerContact?.email ?? null,
    vesselName: order.vessel.name,
    vesselImo: order.vessel.imo,
    portName: order.place.name,
    eta: order.eta?.toISOString() ?? null,
    etd: order.etd?.toISOString() ?? null,
    timezone: order.place.timezone ?? null,
    dateFormat: dateFormat,
    costSalesDecimalPrecision: costSalesDecimalPrecision,
    currency: order.currency ?? 'USD',
    fromName: order.salesRep?.name ?? null,
    fromEmail: order.salesRep?.email ?? null,
    fromPhone: order.salesRep?.phone ?? null,
    paymentTerms,
    customerNote: order.customerNote ?? null,
    purchaseOrderNumber: order.purchaseOrderNumber ?? null,
    deliveredAt: order.deliveredAt ?? null,
    termsAndConditions: order.termsAndConditions ?? null,
    placeRemark: order.placeRemark ?? order.place.orderRemark ?? null,
    accentColor: resolveDocAccent(order.invoicingCompany?.brandColor, brandingEnabled),
    companyName: order.invoicingCompany?.name ?? null,
    companyAddress: order.invoicingCompany?.headOfficeAddress ?? null,
    companyPhone: order.invoicingCompany?.headOfficePhone ?? null,
    companyEmail: order.invoicingCompany?.headOfficeEmail ?? null,
    companyRegistrationNumber: getCompanyRegistrationNumber(order.invoicingCompany),
    companyWebsite: order.invoicingCompany?.website ?? null,
    companyLogoDataUrl,
    itemNotes: order.items
      .filter((item) => item.customerNote && !item.hideOnDocuments && !isSupplierCreditPlaceholder(item))
      .map((item) => ({
        label: formatProductTypeLabel(item.productType),
        note: String(item.customerNote),
      })),
    items: customerFacingItems(order.items).map((item) => ({
      productType: item.productType,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      priceUnit: item.salesUnit ?? item.unit,
      salesPrice: item.salesPrice,
      salesPricingModel: item.salesPricingModel,
      salesReferenceName: item.salesReferenceId ? (proformaRefNameMap.get(item.salesReferenceId) ?? null) : null,
      salesPremium: item.salesPremium,
      salesBarging: item.salesBarging,
      salesBargingUnit: item.salesBargingUnit,
      salesCreditDays: item.salesCreditDays,
      salesPriceFinalized: item.salesPriceFinalized,
      salesCurrency: item.salesCurrency,
    })),
    createdAt: order.createdAt,
    verifyUrl: null as string | null,
    verifyLink: null as string | null,
    fraudPreventionText: order.invoicingCompany?.fraudPreventionText ?? null,
    bank,
    vatNumber: order.invoicingCompany?.vatNumber ?? null,
    latePaymentInterest: order.invoicingCompany?.latePaymentInterest ?? null,
    printMeta: null,
  };

  // Generate QR code verification URL
  const verifyLink = `${getPublicApiBaseUrl()}/verify/${orderId}/proforma-invoice`;
  try {
    docData.verifyUrl = await QRCode.toDataURL(verifyLink, { width: 160, margin: 1 });
    docData.verifyLink = verifyLink;
  } catch { /* QR generation failed — continue without */ }

  const docDefinition = buildProformaDocument(docData);
  const buffer = await createPdfBuffer(docDefinition);
  const fileName = `Proforma_Invoice_${order.orderNumber ?? orderId.slice(0, 8)}.pdf`;
  const revision = await persistDocumentRevision({
    tenantId: order.tenantId,
    orderId: order.id,
    documentType: 'PROFORMA_INVOICE',
    fileName,
    buffer,
  });

  if (revision.isNew) {
    const verifyTokenLink = `${getPublicApiBaseUrl()}/verify/token/${revision.verifyToken}`;
    let verifyTokenQr = docData.verifyUrl;
    try {
      verifyTokenQr = await QRCode.toDataURL(verifyTokenLink, { width: 160, margin: 1 });
    } catch {
      // keep existing QR (or null) if token QR generation fails
    }
    const finalized = buildProformaDocument({
      ...docData,
      verifyUrl: verifyTokenQr,
      verifyLink: verifyTokenLink,
      printMeta: {
        issuedAt: revision.issuedAt,
        revisionNumber: revision.revisionNumber,
        verificationRef: revision.verificationRef,
        fingerprintShort: revision.fingerprintShort,
      },
    });
    const finalizedBuffer = await createPdfBuffer(finalized);
    await overwriteDocumentRevisionArtifact(revision, finalizedBuffer);
  }

  const canonicalBuffer = loadDocumentRevisionBuffer(revision);

  return { buffer: canonicalBuffer, fileName, revision };
}

export const __documentTestUtils = {
  trimTrailingSlash,
  getPublicApiBaseUrl,
  sanitizePathSegment,
  documentTypePrefix,
  buildVerificationRef,
  mapRevisionInfo,
  getRevisionAbsolutePath,
  resolveDocumentStreamTarget,
  buildDocumentStreamKey,
  toMs,
  maxMs,
  maxItemUpdatedAtMs,
  persistDocumentRevision,
  fetchOrderForInvoice,
  getCompanyRegistrationNumber,
  loadOrderBankDetails,
  hasPayableBankDetails,
  findAnyInvoiceRevision: getAnyDocumentRevisionByInvoiceId,
  resolveDocAccent,
  resolveOptionalDocAccent,
  buildCustomerBlock,
  buildDocumentFooter,
  overwriteDocumentRevisionArtifact,
  formatNumber,
  formatPhoneDisplay,
  phoneToTelUri,
  phoneTextNode,
  emailTextNode,
  parseTimezoneOffset,
  formatDateTimeForDisplay,
  formatCustomerPaymentTerms,
  computeDueDate,
  replaceCompanyNamePlaceholder,
  buildOfferForAccountOfText,
  buildNotesSection,
  normalizeCountryName,
  countryAlreadyInAddress,
  tryLoadLogoDataUrl,
  createPdfBuffer,
  buildOfferDocument,
  buildProformaDocument,
};
