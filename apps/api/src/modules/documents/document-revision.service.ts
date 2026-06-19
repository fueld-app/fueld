// ═══════════════════════════════════════════════════════════════════════
//  Document Revision — version tracking & verification for documents
// ═══════════════════════════════════════════════════════════════════════

import { and, desc, eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { db } from '../../db';
import { documentRevisions, tenants } from '../../db/schema';
import type { TenantSettings } from '../../db/schema';
import { formatIssuedAtUtc, getPublicApiBaseUrl, trimTrailingSlash } from './document-utils.service';
import type { DocumentRevisionInfo, DocumentType } from './document.types';
import { DOCUMENT_TEMPLATE_VERSION, buildVerificationRef, sanitizePathSegment } from './document.types';

export function mapRevisionInfo(revision: typeof documentRevisions.$inferSelect, isNew = false): DocumentRevisionInfo {
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

export function getRevisionAbsolutePath(filePath: string): string {
  return join(process.cwd(), 'uploads', filePath);
}

export async function isDocumentRevisionVerificationExpired(revision: DocumentRevisionInfo): Promise<boolean> {
  if (!revision.issuedAt) return false;
  const [tenant] = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, revision.tenantId))
    .limit(1);
  const settings = (tenant?.settings ?? {}) as TenantSettings;
  const raw = settings.documentVerificationLinkExpiryDays;
  if (raw === undefined || raw === null) return false;
  const days = Number(raw);
  if (!Number.isFinite(days) || days <= 0) return false;
  const expiryMs = revision.issuedAt.getTime() + days * 86400000;
  return Date.now() > expiryMs;
}

export async function getLatestDocumentRevisionByOrderId(
  orderId: string,
  documentType: DocumentType,
): Promise<DocumentRevisionInfo | null> {
  const [revision] = await db
    .select()
    .from(documentRevisions)
    .where(and(eq(documentRevisions.orderId, orderId), eq(documentRevisions.documentType, documentType)))
    .orderBy(desc(documentRevisions.revisionNumber))
    .limit(1);
  return revision ? mapRevisionInfo(revision) : null;
}

export async function getLatestDocumentRevisionByStream(params: {
  orderId?: string | null;
  invoiceId?: string | null;
  documentType?: string | null;
}): Promise<DocumentRevisionInfo | null> {
  const conditions = [];
  if (params.orderId) conditions.push(eq(documentRevisions.orderId, params.orderId));
  if (params.invoiceId) conditions.push(eq(documentRevisions.invoiceId, params.invoiceId));
  if (params.documentType) conditions.push(eq(documentRevisions.documentType, params.documentType as any));
  if (!conditions.length) return null;

  const [revision] = await db
    .select()
    .from(documentRevisions)
    .where(and(...conditions))
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
  return readFileSync(absolutePath);
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

export async function createDocumentRevision(params: {
  tenantId: string;
  orderId?: string | null;
  invoiceId?: string | null;
  documentType: DocumentType;
  pdfBuffer: Buffer;
  storageDir: string;
}): Promise<DocumentRevisionInfo> {
  const sha256Hex = createHash('sha256').update(params.pdfBuffer).digest('hex');
  const fingerprintShort = sha256Hex.slice(0, 12);
  const verificationRef = buildVerificationRef(params.documentType, new Date(), 1);
  const verifyToken = randomUUID();

  const issuedAt = new Date();
  const filePath = join(params.storageDir, `${verificationRef}.pdf`);
  const absolutePath = getRevisionAbsolutePath(filePath);

  if (!existsSync(dirname(absolutePath))) {
    mkdirSync(dirname(absolutePath), { recursive: true });
  }

  writeFileSync(absolutePath, params.pdfBuffer);

  const [created] = await db
    .insert(documentRevisions)
    .values({
      tenantId: params.tenantId,
      orderId: params.orderId ?? null,
      invoiceId: params.invoiceId ?? null,
      documentType: params.documentType,
      revisionNumber: 1,
      verificationRef,
      verifyToken,
      sha256Hex,
      fingerprintShort,
      issuedAt,
      filePath,
      fileName: `${verificationRef}.pdf`,
      fileSize: params.pdfBuffer.length,
      streamKey: verificationRef,
    })
    .returning();

  return mapRevisionInfo(created, true);
}

export function getTenantDocumentVerificationExpiryDays(tenantId: string): Promise<number> {
  return db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)
    .then((rows) => {
      const settings = (rows[0]?.settings ?? {}) as TenantSettings;
      const raw = settings.documentVerificationLinkExpiryDays;
      if (raw === undefined || raw === null) return 0;
      const days = Number(raw);
      if (!Number.isFinite(days)) return 0;
      return Math.max(0, Math.floor(days));
    });
}
