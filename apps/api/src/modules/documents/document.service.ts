import pdfmake from 'pdfmake';
import vfsFonts from 'pdfmake/build/vfs_fonts.js';
import type { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import QRCode from 'qrcode';
import { db } from '../../db';
import { bankAccounts, orders, orderItems, counterparties, vessels, places, invoices, users, documentRevisions, tenants, priceReferences, type TenantSettings } from '../../db/schema';

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

type DocumentType = 'OFFER' | 'PROFORMA_INVOICE' | 'INVOICE' | 'OTHER';
const DOCUMENT_TEMPLATE_VERSION = '2026-03-13f';

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

function formatIssuedAtUtc(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function trimTrailingSlash(value: string): string {
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

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

function documentTypePrefix(documentType: DocumentType): string {
  switch (documentType) {
    case 'OFFER': return 'OFF';
    case 'PROFORMA_INVOICE': return 'PFI';
    case 'INVOICE': return 'INV';
    default: return 'DOC';
  }
}

function buildVerificationRef(documentType: DocumentType, issuedAt: Date, revisionNumber: number): string {
  const yyyy = String(issuedAt.getUTCFullYear());
  const mm = String(issuedAt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(issuedAt.getUTCDate()).padStart(2, '0');
  return `${documentTypePrefix(documentType)}-${yyyy}${mm}${dd}-R${String(revisionNumber).padStart(3, '0')}`;
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

function resolveDocumentStreamTarget(params: {
  orderId?: string | null;
  invoiceId?: string | null;
}): string | null {
  return params.invoiceId ?? params.orderId ?? null;
}

function buildDocumentStreamKey(documentType: DocumentType, streamTarget: string): string {
  return `${documentType}:${streamTarget}:${DOCUMENT_TEMPLATE_VERSION}`;
}

function toMs(date: Date | null | undefined): number {
  return date ? date.getTime() : 0;
}

function maxMs(values: Array<Date | null | undefined>): number {
  return values.reduce((acc, value) => Math.max(acc, toMs(value)), 0);
}

function maxItemUpdatedAtMs(items: Array<{ updatedAt: Date }>): number {
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

async function persistDocumentRevision(params: {
  tenantId: string;
  orderId?: string | null;
  invoiceId?: string | null;
  documentType: DocumentType;
  fileName: string;
  buffer: Buffer;
  generatedBy?: string | null;
}): Promise<DocumentRevisionInfo> {
  const streamTarget = params.invoiceId ?? params.orderId;
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
  const verificationRef = buildVerificationRef(params.documentType, issuedAt, revisionNumber);

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

export async function getLatestDocumentRevisionByStream(params: {
  documentType: DocumentType;
  orderId?: string | null;
  invoiceId?: string | null;
}): Promise<DocumentRevisionInfo | null> {
  const streamTarget = resolveDocumentStreamTarget({
    orderId: params.orderId,
    invoiceId: params.invoiceId,
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

async function overwriteDocumentRevisionArtifact(revision: DocumentRevisionInfo, buffer: Buffer): Promise<void> {
  const absolutePath = getRevisionAbsolutePath(revision.filePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, buffer);
  await db
    .update(documentRevisions)
    .set({ fileSize: buffer.length })
    .where(eq(documentRevisions.id, revision.id));
}

const DEFAULT_BANK_DETAILS: BankDetails = {
  bankName: 'DNB Bank ASA',
  accountName: 'Fueld Trading Ltd',
  accountNumber: null,
  iban: 'NO93 8601 1117 947',
  swift: 'DNBANOKKXXX',
  currency: 'USD',
  branchAddress: null,
  sortCode: null,
  routingNumber: null,
  intermediaryBank: null,
};

// ─── Data fetching ───────────────────────────────────────────────────

async function fetchInvoiceData(invoiceId: string) {
  const isMissingCompanyRegistrationColumnError = (error: unknown): boolean => {
    if (!(error instanceof Error)) return false;
    return /company_registration_number/i.test(error.message);
  };

  const queryInvoice = (includeCompanyRegistrationNumber: boolean) =>
    db.query.invoices.findFirst({
      where: eq(invoices.id, invoiceId),
      with: {
        order: {
          with: {
            client: true,
            vessel: true,
            place: true,
            salesRep: true,
            supplier: true,
            invoicingCompany: includeCompanyRegistrationNumber
              ? true
              : {
                  columns: {
                    companyRegistrationNumber: false,
                  },
                },
            items: true,
          },
        },
      },
    });

  let invoice: Awaited<ReturnType<typeof queryInvoice>>;
  try {
    invoice = await queryInvoice(true);
  } catch (error) {
    if (!isMissingCompanyRegistrationColumnError(error)) throw error;
    invoice = await queryInvoice(false);
  }

  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
  return invoice;
}

async function fetchOrderForInvoice(orderId: string) {
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
        invoicingCompany: includeCompanyRegistrationNumber
          ? true
          : {
              columns: {
                companyRegistrationNumber: false,
              },
            },
        customerContact: true,
        supplierContact: true,
        items: true,
        invoices: true,
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
async function loadOrderBankDetails(
  bankAccountId: string | null | undefined,
  invoicingCompanyId: string | null | undefined,
): Promise<BankDetails> {
  // Try specific bank account first
  if (bankAccountId) {
    const [ba] = await db
      .select()
      .from(bankAccounts)
      .where(eq(bankAccounts.id, bankAccountId))
      .limit(1);
    if (ba) {
      return {
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
      };
    }
  }
  // Fallback: default bank account for the invoicing company
  if (invoicingCompanyId) {
    const [ba] = await db
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.counterpartyId, invoicingCompanyId), eq(bankAccounts.isDefault, true)))
      .limit(1);
    if (ba) {
      return {
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
      };
    }
  }
  return DEFAULT_BANK_DETAILS;
}

// ─── PDF Builder ─────────────────────────────────────────────────────

function formatNumber(val: string | null | undefined, decimals = 2): string {
  if (!val) return '—';
  const n = parseFloat(val);
  return isNaN(n) ? '—' : n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
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
function phoneTextNode(label: string, phone: string, opts: { fontSize?: number; margin?: number[] } = {}): Content {
  const display = formatPhoneDisplay(phone) ?? phone;
  const uri = phoneToTelUri(phone);
  return {
    text: [
      { text: label, bold: true },
      { text: display, link: uri, color: '#1a56db' },
    ],
    fontSize: opts.fontSize ?? 10,
    margin: opts.margin ?? [0, 0, 0, 2],
  } as Content;
}

/** Build a pdfmake text node for an email with mailto: link */
function emailTextNode(label: string, email: string, opts: { fontSize?: number; margin?: number[] } = {}): Content {
  return {
    text: [
      { text: label, bold: true },
      { text: email, link: `mailto:${email}`, color: '#1a56db' },
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

function parseTimezoneOffset(tz: string | null | undefined): number | null {
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

/** Check if a string is a valid IANA timezone identifier. */
function isIanaTimezone(tz: string | null | undefined): boolean {
  if (!tz) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Compute invoice due date from payment terms.
 *  For CREDIT terms the due date is deliveryDate (ETA) + creditDays.
 *  Falls back to baseDate when ETA is not available.
 */
function computeDueDate(
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

function formatDateTimeForDisplay(value: string | null, tz: string | null | undefined, omitTz = false): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (isNaN(date.getTime())) return null;

  // ── IANA timezone path (preferred) ──────────────────────────────
  if (tz && isIanaTimezone(tz)) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const map = new Map(parts.map((p) => [p.type, p.value]));
    const day = map.get('day') ?? '01';
    const month = map.get('month') ?? '01';
    const year = map.get('year') ?? '0000';
    const hour = map.get('hour') ?? '00';
    const minute = map.get('minute') ?? '00';

    // Get timezone abbreviation (e.g. "HKT", "GST", "CET")
    const abbrParts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(date);
    const abbr = abbrParts.find((p) => p.type === 'timeZoneName')?.value ?? tz;

    const dateTime = `${day}-${month}-${year} ${hour}:${minute}`;
    return omitTz ? dateTime : `${dateTime} ${abbr}`;
  }

  // ── Legacy fixed-offset path (fallback for old "GMT +04H" style) ─
  const offset = parseTimezoneOffset(tz ?? null);
  const local = offset === null ? date : new Date(date.getTime() + offset * 60_000);
  const year = String(local.getUTCFullYear()).padStart(4, '0');
  const month = String(local.getUTCMonth() + 1).padStart(2, '0');
  const day = String(local.getUTCDate()).padStart(2, '0');
  const hour = String(local.getUTCHours()).padStart(2, '0');
  const minute = String(local.getUTCMinutes()).padStart(2, '0');
  const formatted = `${day}-${month}-${year} ${hour}:${minute}`;
  if (omitTz) return formatted;
  return tz ? `${formatted} ${tz}` : formatted;
}

function replaceCompanyNamePlaceholder(
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

function buildOfferForAccountOfText(params: {
  title: string;
  vesselName: string;
  vesselImo?: string | null;
  clientName?: string | null;
  companyName?: string | null;
}): string {
  const vesselRef = `${params.vesselName}${params.vesselImo ? ` (IMO: ${params.vesselImo})` : ''}`;
  const vesselDisplay = params.vesselName.startsWith('MV ') ? vesselRef : `MV ${vesselRef}`;
  const forAccountParts = params.title === 'NOMINATION'
    ? [params.companyName?.trim() || 'Invoicing company']
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

function buildInvoiceDocument(data: {
  invoiceNumber: string;
  orderNumber?: string | null;
  dueDate: string;
  clientName: string;
  clientCountry: string | null;
  clientAddress?: string | null;
  vesselName: string;
  vesselImo: string | null;
  portName: string;
  salesRepName: string | null;
  paymentTerms: string | null;
  customerNote: string | null;
  itemNotes: Array<{ label: string; note: string }>;
  items: Array<{
    productType: string;
    quantity: string;
    unit: string;
    priceUnit?: string;
    salesPrice: string | null;
    costPrice: string | null;
  }>;
  totalAmount: string | null;
  bank: BankDetails;
  createdAt: Date;
  companyName: string | null;
  vatNumber: string | null;
  companyRegistrationNumber: string | null;
  fraudPreventionText: string | null;
  latePaymentInterest: string | null;
  verifyUrl?: string | null;
  verifyLink?: string | null;
  companyLogoDataUrl: string | null;
  companyAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
  printMeta?: DocumentPrintMeta | null;
}): TDocumentDefinitions {
  // Build line items table
  const tableHeader: TableCell[] = [
    { text: '#', style: 'tableHeader' },
    { text: 'Product', style: 'tableHeader' },
    { text: 'Quantity', style: 'tableHeader', alignment: 'right' },
    { text: 'Unit', style: 'tableHeader' },
    { text: 'Unit Price (USD)', style: 'tableHeader', alignment: 'right' },
    { text: 'Total (USD)', style: 'tableHeader', alignment: 'right' },
  ];

  const tableRows: TableCell[][] = data.items.map((item, idx) => {
    const qty = parseFloat(item.quantity) || 0;
    const price = parseFloat(item.salesPrice ?? '0') || 0;
    const lineTotal = qty * price;
    return [
      { text: String(idx + 1), alignment: 'center' },
      { text: item.productType },
      { text: formatNumberCompact(item.quantity, 3), alignment: 'right' },
      { text: item.unit },
      { text: formatNumber(item.salesPrice, 4), alignment: 'right' },
      { text: formatNumber(String(lineTotal), 2), alignment: 'right' },
    ];
  });

  // Grand total
  const grandTotal = data.items.reduce((sum, item) => {
    const qty = parseFloat(item.quantity) || 0;
    const price = parseFloat(item.salesPrice ?? '0') || 0;
    return sum + qty * price;
  }, 0);
  const totalAmountDueLabel = `Total amount due to ${data.companyName?.trim() || 'Company'}`;

  const docDefinition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [40, 60, 40, 60],

    content: [
      // ── Header ──
      {
        columns: [
          {
            width: '*',
            stack: data.companyLogoDataUrl
              ? [{ image: data.companyLogoDataUrl, fit: [140, 50] } as Content]
              : [
                  { text: data.companyName ?? 'FUELD', style: 'brand' } as Content,
                  { text: 'Bunker Trading Solutions', style: 'brandSub' } as Content,
                ],
          },
          {
            width: 'auto',
            stack: [
              { text: 'INVOICE', style: 'invoiceTitle' },
              { text: `#${data.invoiceNumber}`, style: 'invoiceNumber' },
            ],
            alignment: 'right',
          },
        ],
      } as Content,
      { text: '', margin: [0, 10, 0, 0] } as Content,

      // ── Horizontal divider ──
      {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#1a56db' }],
      } as Content,
      { text: '', margin: [0, 10, 0, 0] } as Content,

      // ── Bill To / Invoice Meta ──
      {
        columns: [
          {
            width: '50%',
            stack: (() => {
              const billTo: Content[] = [
                { text: 'Bill To:', style: 'sectionLabel' } as Content,
                { text: data.clientName, style: 'clientName' } as Content,
              ];
              const invAddr = data.clientAddress?.trim();
              if (invAddr) {
                const addrLines = splitAddressLines(invAddr);
                for (const line of addrLines) billTo.push({ text: line, color: '#666666' } as Content);
                if (data.clientCountry?.trim() && !countryAlreadyInAddress(addrLines, data.clientCountry)) {
                  billTo.push({ text: data.clientCountry.trim(), color: '#666666' } as Content);
                }
              } else if (data.clientCountry) {
                billTo.push({ text: data.clientCountry, color: '#666666' } as Content);
              }
              return billTo;
            })(),
          },
          {
            width: '50%',
            stack: [
              { text: `Invoice Date: ${data.createdAt.toISOString().split('T')[0]}`, alignment: 'right' },
              { text: `Due Date: ${data.dueDate}`, alignment: 'right', bold: true },
              { text: `Sales Rep: ${data.salesRepName ?? 'N/A'}`, alignment: 'right', color: '#666666' },
            ],
          },
        ],
      } as Content,
      { text: '', margin: [0, 22, 0, 0] } as Content,

      // ── Vessel Info ──
      {
        columns: [
          { width: '50%', text: `Vessel: ${data.vesselName}${data.vesselImo ? ` (IMO: ${data.vesselImo})` : ''}`, style: 'vesselInfo' },
          { width: '50%', text: `Port: ${data.portName}`, style: 'vesselInfo', alignment: 'right' },
        ],
      } as Content,
      { text: '', margin: [0, 10, 0, 0] } as Content,

      // ── Line Items Table ──
      {
        table: {
          headerRows: 1,
          widths: [25, '*', 70, 40, 80, 90],
          body: [tableHeader, ...tableRows],
        },
        layout: {
          hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
            i === 0 || i === 1 || i === node.table.body.length ? 1 : 0.5,
          vLineWidth: () => 0,
          hLineColor: (i: number) => (i <= 1 ? '#1a56db' : '#e5e7eb'),
          paddingTop: () => 6,
          paddingBottom: () => 6,
        },
      } as Content,

      {
        columns: [
          { width: '*', text: totalAmountDueLabel, bold: true },
          { width: 'auto', text: `${formatNumber(String(grandTotal), 2)} USD`, bold: true, alignment: 'right' },
        ],
        margin: [0, 6, 0, 0],
      } as Content,

      // ── Notes / Payment Terms ── (removed — not needed on invoices)

      // ── Divider ──
      { text: '', margin: [0, 4, 0, 0] } as Content,
      {
        canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#e5e7eb' }],
      } as Content,
      { text: '', margin: [0, 6, 0, 0] } as Content,

      // ── Bank Details ──
      { text: 'REMITTANCE INSTRUCTIONS', style: 'sectionLabel' } as Content,
      { text: 'Payment to be effected, free of all charges to us, by telegraphic transfer to:', fontSize: 9, margin: [0, 2, 0, 6] } as Content,
      { text: `Please include Order Ref ${data.orderNumber ?? data.invoiceNumber} in the transfer message/note.`, fontSize: 9, margin: [0, 0, 0, 6] } as Content,
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

      // ── Fraud Prevention + QR (2-column) ──
      ...((data.fraudPreventionText || data.verifyUrl) ? [
        { text: '', margin: [0, 10, 0, 0] } as Content,
        {
          columns: [
            {
              width: '*',
              stack: [
                ...(data.fraudPreventionText ? [
                  { text: 'FRAUD PREVENTION', fontSize: 9, bold: true, margin: [0, 0, 0, 4] } as Content,
                  { text: data.fraudPreventionText, fontSize: 8, color: '#374151', margin: [0, 0, 10, 0] } as Content,
                ] : []),
              ],
            },
            {
              width: 'auto',
              stack: [
                ...(data.verifyUrl ? [
                  { image: data.verifyUrl, fit: [80, 80], alignment: 'right', link: data.verifyLink ?? undefined } as Content,
                  { text: 'Scan or click to verify', fontSize: 7, color: '#1a56db', alignment: 'center', margin: [0, 4, 0, 0], link: data.verifyLink ?? undefined } as Content,
                  ...(data.verifyLink ? [
                    { text: `Verify domain: ${new URL(data.verifyLink).hostname}`, fontSize: 6, color: '#6b7280', alignment: 'center', margin: [0, 2, 0, 0] } as Content,
                  ] : []),
                ] : []),
              ],
            },
          ],
        } as Content,
      ] : []),
    ],

    // ── Footer ──
    footer: (currentPage: number, pageCount: number) => {
      const senderName = data.companyName?.trim() || 'Fueld Trading';
      const leftTexts: Content[] = [
        { text: senderName, fontSize: 8, bold: true, color: '#374151' } as Content,
      ];
      if (data.companyAddress?.trim()) {
        for (const line of splitAddressLines(data.companyAddress)) {
          leftTexts.push({ text: line, fontSize: 8, color: '#374151' } as Content);
        }
      }
      const middleTexts: Content[] = [];
      if (data.companyPhone?.trim()) {
        const display = formatPhoneDisplay(data.companyPhone) ?? data.companyPhone.trim();
        middleTexts.push({ text: `Phone No : ${display}`, fontSize: 8, color: '#1a56db', link: phoneToTelUri(data.companyPhone) } as Content);
      }
      if (data.companyEmail?.trim()) {
        middleTexts.push({ text: `Email : ${data.companyEmail.trim()}`, fontSize: 8, color: '#1a56db', link: `mailto:${data.companyEmail.trim()}` } as Content);
      }
      if (data.companyRegistrationNumber?.trim()) {
        middleTexts.push({ text: `Reg. No : ${data.companyRegistrationNumber.trim()}`, fontSize: 8, color: '#374151' } as Content);
      }
      if (data.vatNumber?.trim()) {
        middleTexts.push({ text: `VAT No : ${data.vatNumber.trim()}`, fontSize: 8, color: '#374151' } as Content);
      }
      return {
        margin: [40, 0, 40, 20] as [number, number, number, number],
        stack: [
          { canvas: [{ type: 'line' as const, x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#9ca3af' }] },
          {
            columns: [
              { width: '*' as const, stack: leftTexts },
              { width: '*' as const, stack: middleTexts },
              { width: 'auto' as const, text: `Page ${currentPage} of ${pageCount}`, fontSize: 8, color: '#374151', alignment: 'right' as const },
            ],
            margin: [0, 6, 0, 0] as [number, number, number, number],
          },
          ...(data.printMeta ? [{
            text: `Issued (UTC): ${formatIssuedAtUtc(data.printMeta.issuedAt)}   Revision: ${data.printMeta.revisionNumber}   Ref: ${data.printMeta.verificationRef}   Fingerprint: ${data.printMeta.fingerprintShort}`,
            fontSize: 7,
            color: '#6b7280',
            alignment: 'center',
            margin: [0, 16, 0, 0] as [number, number, number, number],
          } as Content] : []),
        ],
      };
    },

    // ── Styles ──
    styles: {
      brand: { fontSize: 22, bold: true, color: '#1a56db' },
      brandSub: { fontSize: 9, color: '#6b7280', margin: [0, 2, 0, 0] },
      invoiceTitle: { fontSize: 24, bold: true, color: '#111827' },
      invoiceNumber: { fontSize: 12, color: '#6b7280', margin: [0, 2, 0, 0] },
      sectionLabel: { fontSize: 10, bold: true, color: '#1a56db', margin: [0, 0, 0, 4] },
      clientName: { fontSize: 14, bold: true },
      vesselInfo: { fontSize: 10, color: '#374151' },
      tableHeader: { fontSize: 9, bold: true, color: '#ffffff', fillColor: '#1a56db' },
      totalLabel: { fontSize: 12, bold: true, margin: [0, 0, 20, 0] },
      totalValue: { fontSize: 14, bold: true, color: '#1a56db' },
    },

    defaultStyle: {
      fontSize: 10,
      font: 'Roboto',
    },
  };

  return docDefinition;
}

// ═══════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Generate an invoice PDF buffer for a given invoice ID.
 */
export async function generateInvoicePdfBuffer(invoiceId: string): Promise<Buffer> {
  const invoice = await fetchInvoiceData(invoiceId);
  const order = invoice.order;

  const bank = await loadOrderBankDetails(order.bankAccountId, order.invoicingCompanyId);

  // QR code verification
  let verifyUrl: string | null = null;
  const verifyLink = `${getPublicApiBaseUrl()}/verify/${order.id}/invoice`;
  try {
    verifyUrl = await QRCode.toDataURL(verifyLink, { width: 160, margin: 1 });
  } catch { /* QR generation failed — continue without */ }

  // Company logo
  let companyLogoDataUrl: string | null = null;
  if (order.invoicingCompany?.logoUrl) {
    const logoPath = join(process.cwd(), 'uploads', order.invoicingCompany.logoUrl);
    if (existsSync(logoPath)) {
      const ext = extname(logoPath).replace('.', '');
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : 'image/jpeg';
      companyLogoDataUrl = `data:${mime};base64,${readFileSync(logoPath).toString('base64')}`;
    }
  }

  // Resolve price reference names for formula-priced items
  const invRefIds = new Set<string>();
  for (const item of order.items) {
    if (item.salesReferenceId) invRefIds.add(item.salesReferenceId);
  }
  const invRefNameMap = new Map<string, string>();
  if (invRefIds.size > 0) {
    const refs = await db.select({ id: priceReferences.id, name: priceReferences.name })
      .from(priceReferences)
      .where(inArray(priceReferences.id, [...invRefIds]));
    for (const r of refs) invRefNameMap.set(r.id, r.name);
  }

  const docData = {
    orderNumber: order.orderNumber ?? null,
    clientName: order.client.name,
    clientCountry: order.client.country,
    clientAddress: order.client.headOfficeAddress ?? null,
    customerContactName: null,
    customerContactRole: null,
    customerContactPhone: null,
    customerContactEmail: null,
    vesselName: order.vessel.name,
    vesselImo: order.vessel.imo,
    portName: order.place.name,
    eta: order.eta?.toISOString() ?? null,
    etd: order.etd?.toISOString() ?? null,
    timezone: order.place.timezone ?? null,
    currency: order.currency ?? 'USD',
    fromName: order.salesRep?.name ?? null,
    fromEmail: order.salesRep?.email ?? null,
    fromPhone: order.salesRep?.phone ?? null,
    paymentTerms: formatCustomerPaymentTerms(order.customerPaymentTermType, order.customerCreditDays),
    customerNote: order.customerNote ?? null,
    termsAndConditions: order.termsAndConditions ?? null,
    placeRemark: order.placeRemark ?? order.place.orderRemark ?? null,
    companyName: order.invoicingCompany?.name ?? null,
    companyAddress: order.invoicingCompany?.headOfficeAddress ?? null,
    companyPhone: order.invoicingCompany?.headOfficePhone ?? null,
    companyEmail: order.invoicingCompany?.headOfficeEmail ?? null,
    companyRegistrationNumber: getCompanyRegistrationNumber(order.invoicingCompany),
    companyWebsite: order.invoicingCompany?.website ?? null,
    companyLogoDataUrl,
    itemNotes: order.items
      .filter((item) => item.customerNote)
      .map((item) => ({
        label: item.productType,
        note: String(item.customerNote),
      })),
    items: order.items.map((item) => ({
      productType: item.productType,
      description: item.description,
      quantity: item.deliveredQuantity ?? item.quantity,
      unit: item.unit,
      priceUnit: item.salesUnit ?? item.unit,
      salesPrice: item.salesPrice,
      salesPricingModel: item.salesPricingModel,
      salesReferenceName: item.salesReferenceId ? (invRefNameMap.get(item.salesReferenceId) ?? null) : null,
      salesPremium: item.salesPremium,
      salesBarging: item.salesBarging,
      salesBargingUnit: item.salesBargingUnit,
      salesCreditDays: item.salesCreditDays,
      salesPriceFinalized: item.salesPriceFinalized,
    })),
    createdAt: invoice.createdAt,
    verifyUrl,
    verifyLink,
    fraudPreventionText: order.invoicingCompany?.fraudPreventionText ?? null,
    bank,
    vatNumber: order.invoicingCompany?.vatNumber ?? null,
    latePaymentInterest: order.invoicingCompany?.latePaymentInterest ?? null,
    docTitle: 'INVOICE',
  };

  const docDefinition = buildProformaDocument(docData);
  return createPdfBuffer(docDefinition);
}

/**
 * Generate an invoice PDF buffer for a given order ID.
 * Uses the first invoice attached to the order, or creates a preview
 * with a placeholder invoice number.
 */
export async function generateOrderInvoicePdfBuffer(orderId: string): Promise<{
  buffer: Buffer;
  invoiceNumber: string;
  fileName: string;
  revision: DocumentRevisionInfo;
}> {
  const order = await fetchOrderForInvoice(orderId);

  // Find the first invoice or generate a preview number
  const invoice = order.invoices?.[0];
  const existingRevision = await getLatestDocumentRevisionByStream({
    documentType: 'INVOICE',
    orderId: order.id,
    invoiceId: invoice?.id ?? null,
  });

  const invoiceSourceUpdatedAtMs = maxMs([
    order.updatedAt,
    order.client.updatedAt,
    order.vessel.updatedAt,
    order.place.updatedAt,
    order.invoicingCompany?.updatedAt ?? null,
    order.salesRep?.updatedAt ?? null,
    invoice?.updatedAt ?? invoice?.createdAt ?? null,
    order.customerContact?.updatedAt ?? null,
    order.supplierContact?.updatedAt ?? null,
  ]);
  const itemSourceUpdatedAtMs = maxItemUpdatedAtMs(order.items);
  const sourceUpdatedAtMs = Math.max(invoiceSourceUpdatedAtMs, itemSourceUpdatedAtMs);

  if (existingRevision && sourceUpdatedAtMs <= existingRevision.issuedAt.getTime()) {
    const existingBuffer = loadDocumentRevisionBuffer(existingRevision);
    const existingInvoiceNumber = invoice?.invoiceNumber ?? `PREVIEW-${orderId.slice(0, 8).toUpperCase()}`;
    const existingFileName = `Fueld_Invoice_${existingInvoiceNumber.replace(/[^a-zA-Z0-9-]/g, '_')}.pdf`;
    return {
      buffer: existingBuffer,
      invoiceNumber: existingInvoiceNumber,
      fileName: existingFileName,
      revision: existingRevision,
    };
  }

  const invoiceNumber = invoice?.invoiceNumber ?? `PREVIEW-${orderId.slice(0, 8).toUpperCase()}`;

  const bank = await loadOrderBankDetails(order.bankAccountId, order.invoicingCompanyId);

  // QR code verification
  let verifyUrl: string | null = null;
  const verifyLink = `${getPublicApiBaseUrl()}/verify/${orderId}/invoice`;
  try {
    verifyUrl = await QRCode.toDataURL(verifyLink, { width: 160, margin: 1 });
  } catch { /* QR generation failed — continue without */ }

  // Company logo
  let companyLogoDataUrl: string | null = null;
  if (order.invoicingCompany?.logoUrl) {
    const logoPath = join(process.cwd(), 'uploads', order.invoicingCompany.logoUrl);
    if (existsSync(logoPath)) {
      const ext = extname(logoPath).replace('.', '');
      const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : 'image/jpeg';
      companyLogoDataUrl = `data:${mime};base64,${readFileSync(logoPath).toString('base64')}`;
    }
  }

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
    currency: order.currency ?? 'USD',
    fromName: order.salesRep?.name ?? null,
    fromEmail: order.salesRep?.email ?? null,
    fromPhone: order.salesRep?.phone ?? null,
    paymentTerms: formatCustomerPaymentTerms(order.customerPaymentTermType, order.customerCreditDays),
    customerNote: order.customerNote ?? null,
    termsAndConditions: order.termsAndConditions ?? null,
    placeRemark: order.placeRemark ?? order.place.orderRemark ?? null,
    companyName: order.invoicingCompany?.name ?? null,
    companyAddress: order.invoicingCompany?.headOfficeAddress ?? null,
    companyPhone: order.invoicingCompany?.headOfficePhone ?? null,
    companyEmail: order.invoicingCompany?.headOfficeEmail ?? null,
    companyRegistrationNumber: getCompanyRegistrationNumber(order.invoicingCompany),
    companyWebsite: order.invoicingCompany?.website ?? null,
    companyLogoDataUrl,
    itemNotes: order.items
      .filter((item) => item.customerNote)
      .map((item) => ({
        label: item.productType,
        note: String(item.customerNote),
      })),
    items: order.items.map((item) => ({
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
    })),
    createdAt: invoice?.createdAt ?? order.createdAt,
    verifyUrl,
    verifyLink,
    fraudPreventionText: order.invoicingCompany?.fraudPreventionText ?? null,
    bank,
    vatNumber: order.invoicingCompany?.vatNumber ?? null,
    latePaymentInterest: order.invoicingCompany?.latePaymentInterest ?? null,
    docTitle: 'INVOICE',
    printMeta: null as DocumentPrintMeta | null,
  };

  const docDefinition = buildProformaDocument(docData);
  const buffer = await createPdfBuffer(docDefinition);
  const fileName = `Fueld_Invoice_${invoiceNumber.replace(/[^a-zA-Z0-9-]/g, '_')}.pdf`;
  const revision = await persistDocumentRevision({
    tenantId: order.tenantId,
    orderId: order.id,
    invoiceId: invoice?.id ?? null,
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

function buildOfferDocument(data: {
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
  fromName: string | null;
  fromEmail: string | null;
  fromPhone: string | null;
  paymentTerms: string | null;
  customerNote: string | null;
  termsAndConditions: string | null;
  placeRemark: string | null;
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
  }>;
  createdAt: Date;
  docTitle?: string;
  verifyUrl?: string | null;
  supplierResponseUrl?: string | null;
  supplierResponseQrUrl?: string | null;
  supplierResponseTitle?: string | null;
  supplierResponseText?: string | null;
  printMeta?: DocumentPrintMeta | null;
}): TDocumentDefinitions {
  // ── Prepare data ──────────────────────────────────────────────────
  const refNum = data.orderNumber ?? 'DRAFT';
  const senderName = data.companyName?.trim() || 'Fueld Trading';
  const dd = String(data.createdAt.getUTCDate()).padStart(2, '0');
  const mm = String(data.createdAt.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = data.createdAt.getUTCFullYear();
  const createdDate = `${dd}-${mm}-${yyyy}`;
  const title = data.docTitle ?? 'OFFER';
  const openingTopMargin = title === 'NOMINATION' ? 8 : 18;
  const openingSentence = title === 'NOMINATION'
    ? 'With reference to our correspondence, we are pleased to nominate to you the following:'
    : title === 'CONFIRMATION'
      ? 'With reference to our correspondence, we are pleased to confirm to you the following:'
      : 'With reference to our correspondence, we are pleased to offer to you the following:';

  // Customer address block (top-left)
  const customerBlock: Content[] = [
    { text: data.clientName, fontSize: 10 } as Content,
  ];
  if (data.customerContactName?.trim()) {
    customerBlock.push({ text: `Att.: ${data.customerContactName.trim()}`, fontSize: 10 } as Content);
  }
  // Client address lines
  const clientAddr = data.clientAddress?.trim();
  if (clientAddr) {
    const lines = splitAddressLines(clientAddr);
    for (const line of lines) {
      customerBlock.push({ text: line, fontSize: 10 } as Content);
    }
    // Append country if not already included in address lines
    if (data.clientCountry?.trim() && !countryAlreadyInAddress(lines, data.clientCountry)) {
      customerBlock.push({ text: data.clientCountry.trim(), fontSize: 10 } as Content);
    }
  } else if (data.clientCountry?.trim()) {
    customerBlock.push({ text: data.clientCountry.trim(), fontSize: 10 } as Content);
  }

  // Right-side meta block (Date / Ref / Page — Page is dynamic via header)
  const rightMetaBlock: Content[] = [];
  if (data.companyLogoDataUrl) {
    rightMetaBlock.push({ image: data.companyLogoDataUrl, fit: [150, 50], alignment: 'right', margin: [0, 0, 0, 8] } as Content);
  }

  // Items table
  const tableHeader: TableCell[] = [
    { text: 'Product', style: 'tableHeader' },
    { text: 'Quantity', style: 'tableHeader', alignment: 'right' },
    { text: 'Unit', style: 'tableHeader' },
    { text: 'Price', style: 'tableHeader', alignment: 'right' },
  ];

  const tableRows: TableCell[][] = data.items.map((item) => {
    const qty = item.quantityMin && item.quantityMax
      ? `${formatNumberCompact(item.quantityMin, 0)} - ${formatNumberCompact(item.quantityMax, 0)}`
      : formatNumberCompact(item.quantity, 3);
    const productCell: Content = item.description?.trim()
      ? { text: [{ text: item.productType }, { text: `  ${item.description.trim()}`, fontSize: 8, color: '#374151' }] }
      : { text: item.productType };

    let priceCell: Content;
    if (item.salesPricingModel === 'FORMULA') {
      const parts: Content[] = [];
      if (item.salesReferenceName) parts.push({ text: item.salesReferenceName, bold: true, fontSize: 9 });
      if (item.salesPremium && parseFloat(item.salesPremium)) parts.push({ text: ` + ${formatNumber(item.salesPremium)} /${item.priceUnit ?? item.unit}`, fontSize: 8 });
      if (item.salesBarging && parseFloat(item.salesBarging)) parts.push({ text: `\nbarging ${formatNumber(item.salesBarging)} ${item.salesBargingUnit || 'l/s'}`, fontSize: 8 });
      if (item.salesPriceFinalized) {
        parts.push({ text: `\n→ ${formatNumber(item.salesPrice)} ${data.currency}/${item.priceUnit ?? item.unit}`, fontSize: 8, bold: true });
      }
      priceCell = { text: parts, alignment: 'right' };
    } else {
      priceCell = { text: `${data.currency}/${item.priceUnit ?? item.unit}  ${formatNumber(item.salesPrice)}`, alignment: 'right' };
    }

    return [
      productCell as TableCell,
      { text: qty, alignment: 'right' },
      { text: item.unit },
      priceCell as TableCell,
    ];
  });

  // Delivery date string
  let deliveryDateStr = '';
  if (data.eta) {
    const hasRange = !!data.etd;
    const fmtEta = formatDateTimeForDisplay(data.eta, data.timezone, hasRange);
    deliveryDateStr = fmtEta ?? data.eta;
    if (data.etd) {
      const fmtEtd = formatDateTimeForDisplay(data.etd, data.timezone);
      deliveryDateStr += ` to ${fmtEtd ?? data.etd}`;
    }
  }

  // "For account of" line
  const forAccountOfText = buildOfferForAccountOfText({
    title,
    vesselName: data.vesselName,
    vesselImo: data.vesselImo,
    clientName: data.clientName,
    companyName: data.companyName,
  });

  // ── Header (3 columns: client | title | logo+date/ref) ───────────
  const customerTopOffset = data.companyLogoDataUrl ? 60 : 0;
  // Dynamically compute top page margin so the header is never clipped
  const headerContentHeight = 30 + customerTopOffset + customerBlock.length * 14 + 4;
  const topMargin = Math.max(140, headerContentHeight);

  const header = (currentPage: number, pageCount: number): Content => {
    const rightStack: Content[] = [];
    // Logo
    if (data.companyLogoDataUrl) {
      rightStack.push({ image: data.companyLogoDataUrl, fit: [150, 50], alignment: 'right', margin: [0, 0, 0, 10] } as Content);
    }
    // Date / Ref — tabular so labels and values are column-aligned
    rightStack.push({
      table: {
        widths: ['*', 'auto'],
        body: [
          [{ text: 'Date:', bold: true, alignment: 'right', margin: [0, 0, 4, 0] }, { text: createdDate, alignment: 'right' }],
          [{ text: 'Ref.:', bold: true, alignment: 'right', margin: [0, 0, 4, 0] }, { text: refNum, alignment: 'right' }],
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
        { width: 200, stack: currentPage === 1 ? customerBlock : [{ text: '' }], margin: [0, customerTopOffset, 0, 0] },
        { width: '*', text: title, style: 'docTitle', alignment: 'center', margin: [10, 0, 10, 0] },
        { width: 200, stack: rightStack, margin: [0, 0, 40, 0] },
      ],
    } as Content;
  };

  // ── Footer (company details + page number) ────────────────────────
  const footerFn = (currentPage: number, pageCount: number) => {
    const leftTexts: Content[] = [
      { text: senderName, fontSize: 8, bold: true, color: '#374151' } as Content,
    ];
    if (data.companyAddress?.trim()) {
      for (const line of splitAddressLines(data.companyAddress)) {
        leftTexts.push({ text: line, fontSize: 8, color: '#374151' } as Content);
      }
    }
    const middleTexts: Content[] = [];
    if (data.companyPhone?.trim()) {
      const display = formatPhoneDisplay(data.companyPhone) ?? data.companyPhone.trim();
      middleTexts.push({ text: `T ${display}`, fontSize: 8, color: '#1a56db', link: phoneToTelUri(data.companyPhone) } as Content);
    }
    if (data.companyEmail?.trim()) {
      middleTexts.push({ text: data.companyEmail.trim(), fontSize: 8, color: '#1a56db', link: `mailto:${data.companyEmail.trim()}` } as Content);
    }
    if (data.companyRegistrationNumber?.trim()) {
      middleTexts.push({ text: `Reg. No : ${data.companyRegistrationNumber.trim()}`, fontSize: 8, color: '#374151' } as Content);
    }
    if (data.vatNumber?.trim()) {
      middleTexts.push({ text: `VAT No : ${data.vatNumber.trim()}`, fontSize: 8, color: '#374151' } as Content);
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
        ...(data.printMeta ? [{
          text: `Issued (UTC): ${formatIssuedAtUtc(data.printMeta.issuedAt)}   Revision: ${data.printMeta.revisionNumber}   Ref: ${data.printMeta.verificationRef}   Fingerprint: ${data.printMeta.fingerprintShort}`,
          fontSize: 7,
          color: '#6b7280',
          alignment: 'center',
          margin: [0, 16, 0, 0] as [number, number, number, number],
        } as Content] : []),
      ],
    };
  };

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
                ? [emailTextNode('Direct Email:  ', data.fromEmail.trim(), { fontSize: 9 })]
                : []),
              ...(data.fromPhone?.trim()
                ? [phoneTextNode('Direct Phone:  ', data.fromPhone.trim(), { fontSize: 9 })]
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
          ? [emailTextNode('Direct Email:  ', data.fromEmail.trim(), { fontSize: 9 })]
          : []),
        ...(data.fromPhone?.trim()
          ? [phoneTextNode('Direct Phone:  ', data.fromPhone.trim(), { fontSize: 9 })]
          : []),
      ]),
    ],
    footer: footerFn,
    styles: {
      docTitle: { fontSize: 16, bold: true, color: '#111827' },
      sectionLabel: { fontSize: 10, bold: true, color: '#111827', margin: [0, 0, 0, 4] },
      tableHeader: { fontSize: 9, bold: true },
    },
    defaultStyle: { fontSize: 10, font: 'Roboto' },
  };
}

/**
 * Generate an Offer PDF buffer for a given order ID.
 */
export async function generateOfferPdfBuffer(orderId: string): Promise<{
  buffer: Buffer;
  fileName: string;
  revision: DocumentRevisionInfo;
}> {
  const order = await fetchOrderForInvoice(orderId);
  const isInquiryContext = order.status === 'INQUIRY' || order.status === 'OFFER';
  const documentTitle = isInquiryContext ? 'OFFER' : 'CONFIRMATION';
  const documentName = isInquiryContext ? 'Offer' : 'Confirmation';
  const baseFileName = isInquiryContext ? 'Offer' : 'Confirmation';
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
    vesselName: order.vessel.name,
    vesselImo: order.vessel.imo,
    portName: order.place.name,
    eta: order.eta?.toISOString() ?? null,
    etd: order.etd?.toISOString() ?? null,
    timezone: order.place.timezone ?? null,
    fromName: order.salesRep?.name ?? null,
    fromEmail: order.salesRep?.email ?? null,
    fromPhone: order.salesRep?.phone ?? null,
    paymentTerms: formatCustomerPaymentTerms(order.customerPaymentTermType, order.customerCreditDays),
    customerNote: order.customerNote ?? null,
    termsAndConditions: replaceCompanyNamePlaceholder(
      order.termsAndConditions ?? order.invoicingCompany?.customerTerms ?? null,
      order.invoicingCompany?.name ?? null,
      documentName,
    ),
    placeRemark: order.placeRemark ?? order.place.orderRemark ?? null,
    companyName: order.invoicingCompany?.name ?? null,
    companyAddress: order.invoicingCompany?.headOfficeAddress ?? null,
    companyPhone: order.invoicingCompany?.headOfficePhone ?? null,
    companyEmail: order.invoicingCompany?.headOfficeEmail ?? null,
    companyRegistrationNumber: getCompanyRegistrationNumber(order.invoicingCompany),
    vatNumber: order.invoicingCompany?.vatNumber ?? null,
    companyWebsite: order.invoicingCompany?.website ?? null,
    companyLogoDataUrl,
    itemNotes: order.items
      .filter((item) => item.customerNote)
      .map((item) => ({
        label: item.productType,
        note: String(item.customerNote),
      })),
    currency: order.currency ?? 'USD',
    items: order.items.map((item) => ({
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
    })),
    createdAt: order.createdAt,
    docTitle: documentTitle,
    verifyUrl: null as string | null,
    printMeta: null,
  };

  // QR code removed from offers — only shown on invoices and proforma invoices

  const docDefinition = buildOfferDocument(docData);
  const buffer = await createPdfBuffer(docDefinition);
  const fileName = `${baseFileName}_${order.orderNumber ?? orderId.slice(0, 8)}.pdf`;
  const revision = await persistDocumentRevision({
    tenantId: order.tenantId,
    orderId: order.id,
    documentType: 'OFFER',
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
 * Generate a supplier-facing nomination PDF for a given order ID.
 * Reuses the confirmation layout and content structure.
 */
export async function generateNominationPdfBuffer(orderId: string, options?: { responseUrl?: string | null }): Promise<{
  buffer: Buffer;
  fileName: string;
  revision: DocumentRevisionInfo;
}> {
  const order = await fetchOrderForInvoice(orderId);
  const existingRevision = await getLatestDocumentRevisionByStream({
    documentType: 'OTHER',
    orderId: order.id,
  });

  const nominationSourceUpdatedAtMs = maxMs([
    order.updatedAt,
    order.supplier?.updatedAt ?? null,
    order.vessel.updatedAt,
    order.place.updatedAt,
    order.invoicingCompany?.updatedAt ?? null,
    order.salesRep?.updatedAt ?? null,
    order.supplierContact?.updatedAt ?? null,
  ]);
  const nominationItemUpdatedAtMs = maxItemUpdatedAtMs(order.items);
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
    clientName: order.supplier?.name ?? 'Supplier',
    clientCountry: order.supplier?.country ?? null,
    clientAddress: order.supplier?.headOfficeAddress ?? null,
    customerContactName: order.supplierContact?.name ?? null,
    customerContactRole: order.supplierContact?.role ?? null,
    customerContactPhone: order.supplierContact?.phone ?? null,
    customerContactEmail: order.supplierContact?.email ?? null,
    vesselName: order.vessel.name,
    vesselImo: order.vessel.imo,
    portName: order.place.name,
    eta: order.eta?.toISOString() ?? null,
    etd: order.etd?.toISOString() ?? null,
    timezone: order.place.timezone ?? null,
    fromName: order.salesRep?.name ?? null,
    fromEmail: order.salesRep?.email ?? null,
    fromPhone: order.salesRep?.phone ?? null,
    paymentTerms: formatCustomerPaymentTerms(order.supplierPaymentTermType, order.supplierCreditDays),
    customerNote: null,
    termsAndConditions: replaceCompanyNamePlaceholder(
      order.invoicingCompany?.supplierTerms ?? null,
      order.invoicingCompany?.name ?? null,
      'Nomination',
    ),
    placeRemark: null,
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
    items: order.items.map((item) => ({
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
  currency: string;
  fromName: string | null;
  fromEmail: string | null;
  fromPhone: string | null;
  paymentTerms: string | null;
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
}): TDocumentDefinitions {
  // ── Prepare data ──────────────────────────────────────────────────
  const refNum = data.orderNumber ?? 'DRAFT';
  const senderName = data.companyName?.trim() || 'Fueld Trading';
  const dd2 = String(data.createdAt.getUTCDate()).padStart(2, '0');
  const mm2 = String(data.createdAt.getUTCMonth() + 1).padStart(2, '0');
  const yyyy2 = data.createdAt.getUTCFullYear();
  const createdDate = `${dd2}-${mm2}-${yyyy2}`;

  // Customer address block (top-left)
  const customerBlock: Content[] = [
    { text: data.clientName, fontSize: 10 } as Content,
  ];
  if (data.customerContactName?.trim()) {
    customerBlock.push({ text: `Att.: ${data.customerContactName.trim()}`, fontSize: 10 } as Content);
  }
  // Client address lines
  const clientAddr = data.clientAddress?.trim();
  if (clientAddr) {
    const lines = splitAddressLines(clientAddr);
    for (const line of lines) {
      customerBlock.push({ text: line, fontSize: 10 } as Content);
    }
    // Append country if not already included in address lines
    if (data.clientCountry?.trim() && !countryAlreadyInAddress(lines, data.clientCountry)) {
      customerBlock.push({ text: data.clientCountry.trim(), fontSize: 10 } as Content);
    }
  } else if (data.clientCountry?.trim()) {
    customerBlock.push({ text: data.clientCountry.trim(), fontSize: 10 } as Content);
  }

  // Items table (with totals for confirmation/nomination)
  const tableHeader: TableCell[] = [
    { text: 'Product', style: 'tableHeader' },
    { text: 'Quantity', style: 'tableHeader', alignment: 'right' },
    { text: 'Unit', style: 'tableHeader' },
    { text: 'Price', style: 'tableHeader', alignment: 'right' },
    { text: 'Total amount', style: 'tableHeader', alignment: 'right' },
  ];

  const tableRows: TableCell[][] = data.items.map((item) => {
    const qty = parseFloat(item.quantity) || 0;
    const unitPrice = parseFloat(item.salesPrice ?? '0') || 0;
    const lineTotal = qty * unitPrice;
    const productCell: Content = item.description?.trim()
      ? { text: [{ text: item.productType }, { text: `  ${item.description.trim()}`, fontSize: 8, color: '#374151' }] }
      : { text: item.productType };

    let priceCell: Content;
    let totalCell: Content;
    if (item.salesPricingModel === 'FORMULA') {
      const parts: Content[] = [];
      if (item.salesReferenceName) parts.push({ text: item.salesReferenceName, bold: true, fontSize: 9 });
      if (item.salesPremium && parseFloat(item.salesPremium)) parts.push({ text: ` + ${formatNumber(item.salesPremium)} /${item.priceUnit ?? item.unit}`, fontSize: 8 });
      if (item.salesBarging && parseFloat(item.salesBarging)) parts.push({ text: `\nbarging ${formatNumber(item.salesBarging)} ${item.salesBargingUnit || 'l/s'}`, fontSize: 8 });
      if (item.salesPriceFinalized) {
        parts.push({ text: `\n\u2192 ${formatNumber(item.salesPrice)} ${data.currency}/${item.priceUnit ?? item.unit}`, fontSize: 8, bold: true });
        totalCell = { text: `${formatNumber(String(lineTotal), 2)} ${data.currency}`, alignment: 'right' };
      } else {
        totalCell = { text: 'TBD', alignment: 'right', italics: true, color: '#d97706' };
      }
      priceCell = { text: parts, alignment: 'right' };
    } else {
      priceCell = { text: `${data.currency}/${item.priceUnit ?? item.unit}  ${formatNumber(item.salesPrice)}`, alignment: 'right' };
      totalCell = { text: `${formatNumber(String(lineTotal), 2)} ${data.currency}`, alignment: 'right' };
    }

    return [
      productCell as TableCell,
      { text: formatNumberCompact(item.quantity, 3), alignment: 'right' },
      { text: item.unit },
      priceCell as TableCell,
      totalCell as TableCell,
    ];
  });
  const grandTotal = data.items.reduce((sum, item) => {
    const qty = parseFloat(item.quantity) || 0;
    const price = parseFloat(item.salesPrice ?? '0') || 0;
    return sum + qty * price;
  }, 0);
  const totalAmountDueLabel = `Total amount due to ${data.companyName?.trim() || 'Company'}`;

  // Delivery date string
  let deliveryDateStr = '';
  if (data.eta) {
    const hasRange = !!data.etd;
    const fmtEta = formatDateTimeForDisplay(data.eta, data.timezone, hasRange);
    deliveryDateStr = fmtEta ?? data.eta;
    if (data.etd) {
      const fmtEtd = formatDateTimeForDisplay(data.etd, data.timezone);
      deliveryDateStr += ` to ${fmtEtd ?? data.etd}`;
    }
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

  const header = (currentPage: number, _pageCount: number): Content => {
    const rightStack: Content[] = [];
    if (data.companyLogoDataUrl) {
      rightStack.push({ image: data.companyLogoDataUrl, fit: [150, 50], alignment: 'right', margin: [0, 0, 0, 10] } as Content);
    }
    // Date / Ref — tabular so labels and values are column-aligned
    rightStack.push({
      table: {
        widths: ['*', 'auto'],
        body: [
          [{ text: 'Date:', bold: true, alignment: 'right', margin: [0, 0, 4, 0] }, { text: createdDate, alignment: 'right' }],
          [{ text: 'Ref.:', bold: true, alignment: 'right', margin: [0, 0, 4, 0] }, { text: refNum, alignment: 'right' }],
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
        { width: 150, stack: currentPage === 1 ? customerBlock : [{ text: '' }], margin: [0, customerTopOffset, 0, 0] },
        { width: '*', text: data.docTitle ?? 'PROFORMA INVOICE', style: 'docTitle', alignment: 'center', margin: [10, 0, 10, 0], noWrap: true },
        { width: 150, stack: rightStack, margin: [0, 0, 40, 0] },
      ],
    } as Content;
  };

  // ── Footer (company details + page number) ────────────────────────
  const footerFn = (currentPage: number, pageCount: number) => {
    const leftTexts: Content[] = [
      { text: senderName, fontSize: 8, bold: true, color: '#374151' } as Content,
    ];
    if (data.companyAddress?.trim()) {
      for (const line of splitAddressLines(data.companyAddress)) {
        leftTexts.push({ text: line, fontSize: 8, color: '#374151' } as Content);
      }
    }
    const middleTexts: Content[] = [];
    if (data.companyPhone?.trim()) {
      const display = formatPhoneDisplay(data.companyPhone) ?? data.companyPhone.trim();
      middleTexts.push({ text: `T ${display}`, fontSize: 8, color: '#1a56db', link: phoneToTelUri(data.companyPhone) } as Content);
    }
    if (data.companyEmail?.trim()) {
      middleTexts.push({ text: data.companyEmail.trim(), fontSize: 8, color: '#1a56db', link: `mailto:${data.companyEmail.trim()}` } as Content);
    }
    if (data.companyRegistrationNumber?.trim()) {
      middleTexts.push({ text: `Reg. No : ${data.companyRegistrationNumber.trim()}`, fontSize: 8, color: '#374151' } as Content);
    }
    if (data.vatNumber?.trim()) {
      middleTexts.push({ text: `VAT No : ${data.vatNumber.trim()}`, fontSize: 8, color: '#374151' } as Content);
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
        ...(data.printMeta ? [{
          text: `Issued (UTC): ${formatIssuedAtUtc(data.printMeta.issuedAt)}   Revision: ${data.printMeta.revisionNumber}   Ref: ${data.printMeta.verificationRef}   Fingerprint: ${data.printMeta.fingerprintShort}`,
          fontSize: 7,
          color: '#6b7280',
          alignment: 'center',
          margin: [0, 16, 0, 0] as [number, number, number, number],
        } as Content] : []),
      ],
    };
  };

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
          { width: 'auto', text: `${formatNumber(String(grandTotal), 2)} ${data.currency}`, bold: true, alignment: 'right' },
        ],
        margin: [0, 6, 0, 0],
      } as Content,
      { text: '', margin: [0, 6, 0, 0] } as Content,

      // Payment terms
      ...(data.paymentTerms
        ? [{ text: [{ text: 'Payment terms:  ', bold: true }, { text: data.paymentTerms.replace(/_/g, ' ') }], margin: [0, 0, 0, 2] } as Content]
        : []),

      // Notes
      ...buildNotesSection({
        customerNote: data.customerNote,
        itemNotes: data.itemNotes,
      }),

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

      // ── Fraud Prevention + QR (2-column) ──
      ...((data.fraudPreventionText || data.verifyUrl) ? [
        { text: '', margin: [0, 10, 0, 0] } as Content,
        {
          columns: [
            {
              width: '*',
              stack: [
                ...(data.fraudPreventionText ? [
                  { text: 'FRAUD PREVENTION', fontSize: 9, bold: true, margin: [0, 0, 0, 4] } as Content,
                  { text: data.fraudPreventionText, fontSize: 8, color: '#374151', margin: [0, 0, 10, 0] } as Content,
                ] : []),
              ],
            },
            {
              width: 'auto',
              stack: [
                ...(data.verifyUrl ? [
                  { image: data.verifyUrl, fit: [80, 80], alignment: 'right', link: data.verifyLink ?? undefined } as Content,
                  { text: 'Scan or click to verify', fontSize: 7, color: '#1a56db', alignment: 'center', margin: [0, 4, 0, 0], link: data.verifyLink ?? undefined } as Content,
                  ...(data.verifyLink ? [
                    { text: `Verify domain: ${new URL(data.verifyLink).hostname}`, fontSize: 6, color: '#6b7280', alignment: 'center', margin: [0, 2, 0, 0] } as Content,
                  ] : []),
                ] : []),
              ],
            },
          ],
        } as Content,
      ] : []),
    ],
    footer: footerFn,
    styles: {
      docTitle: { fontSize: 16, bold: true, color: '#111827' },
      sectionLabel: { fontSize: 10, bold: true, color: '#111827', margin: [0, 0, 0, 4] },
      tableHeader: { fontSize: 9, bold: true },
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
    currency: order.currency ?? 'USD',
    fromName: order.salesRep?.name ?? null,
    fromEmail: order.salesRep?.email ?? null,
    fromPhone: order.salesRep?.phone ?? null,
    paymentTerms,
    customerNote: order.customerNote ?? null,
    termsAndConditions: order.termsAndConditions ?? null,
    placeRemark: order.placeRemark ?? order.place.orderRemark ?? null,
    companyName: order.invoicingCompany?.name ?? null,
    companyAddress: order.invoicingCompany?.headOfficeAddress ?? null,
    companyPhone: order.invoicingCompany?.headOfficePhone ?? null,
    companyEmail: order.invoicingCompany?.headOfficeEmail ?? null,
    companyRegistrationNumber: getCompanyRegistrationNumber(order.invoicingCompany),
    companyWebsite: order.invoicingCompany?.website ?? null,
    companyLogoDataUrl,
    itemNotes: order.items
      .filter((item) => item.customerNote)
      .map((item) => ({
        label: item.productType,
        note: String(item.customerNote),
      })),
    items: order.items.map((item) => ({
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
  fetchInvoiceData,
  fetchOrderForInvoice,
  getCompanyRegistrationNumber,
  loadOrderBankDetails,
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
  buildInvoiceDocument,
  buildOfferDocument,
  buildProformaDocument,
};
