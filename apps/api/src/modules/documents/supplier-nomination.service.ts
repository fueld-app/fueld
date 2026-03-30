import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import type { SupplierNominationAttachmentDto, SupplierNominationSummaryDto } from '@fueld/types';
import { db } from '../../db';
import {
  counterparties,
  orderAttachments,
  orders,
  orderSuppliers,
  companyContacts,
  supplierNominationAttachments,
  supplierNominations,
  type SupplierNomination,
} from '../../db/schema';

const ACTIVE_SUPPLIER_NOMINATION_STATUSES = ['SENT', 'OPENED', 'SUBMITTED'] as const;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function normalizeText(value?: string | null): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDate(value?: string | Date | null): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function hashSupplierNominationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSupplierNominationToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(24).toString('hex');
  return {
    rawToken,
    tokenHash: hashSupplierNominationToken(rawToken),
  };
}

export function getSupplierNominationFormUrl(rawToken: string): string {
  const baseUrl = trimTrailingSlash(process.env['APP_URL']?.trim() || 'http://localhost:4200');
  return `${baseUrl}/supplier-nomination/${rawToken}`;
}

export async function getSupplierNominationByToken(rawToken: string): Promise<SupplierNomination | null> {
  const tokenHash = hashSupplierNominationToken(rawToken);
  const [nomination] = await db
    .select()
    .from(supplierNominations)
    .where(and(
      eq(supplierNominations.responseTokenHash, tokenHash),
      or(
        isNull(supplierNominations.responseTokenExpiresAt),
        gt(supplierNominations.responseTokenExpiresAt, new Date()),
      ),
    ))
    .orderBy(desc(supplierNominations.sentAt))
    .limit(1);

  return nomination ?? null;
}

async function syncOrderDeliveredAtFromSuppliers(orderId: string): Promise<void> {
  const rows = await db
    .select({ deliveredAt: orderSuppliers.deliveredAt })
    .from(orderSuppliers)
    .where(eq(orderSuppliers.orderId, orderId));

  const deliveredAtValues = rows
    .map((row) => row.deliveredAt?.getTime() ?? 0)
    .filter((value) => value > 0);

  const deliveredAt = deliveredAtValues.length > 0
    ? new Date(Math.max(...deliveredAtValues))
    : null;

  await db
    .update(orders)
    .set({
      deliveredAt,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId));
}

export async function invalidateActiveSupplierNominations(input: {
  orderId: string;
  orderSupplierId?: string | null;
}): Promise<number> {
  const updated = await db
    .update(supplierNominations)
    .set({
      status: 'SUPERSEDED',
      responseTokenExpiresAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(supplierNominations.orderId, input.orderId),
      input.orderSupplierId
        ? eq(supplierNominations.orderSupplierId, input.orderSupplierId)
        : isNull(supplierNominations.orderSupplierId),
      inArray(supplierNominations.status, [...ACTIVE_SUPPLIER_NOMINATION_STATUSES]),
    ))
    .returning({ id: supplierNominations.id });

  return updated.length;
}

export async function createSupplierNominationLink(input: {
  orderId: string;
  orderSupplierId?: string | null;
  supplierId: string;
  contactId?: string | null;
  email: string;
  subject: string;
  sentByUserId?: string | null;
}): Promise<{ nomination: SupplierNomination; rawToken: string }> {
  await invalidateActiveSupplierNominations({
    orderId: input.orderId,
    orderSupplierId: input.orderSupplierId ?? null,
  });

  const token = createSupplierNominationToken();
  const [created] = await db
    .insert(supplierNominations)
    .values({
      orderId: input.orderId,
      orderSupplierId: input.orderSupplierId ?? null,
      supplierId: input.supplierId,
      contactId: input.contactId ?? null,
      email: input.email,
      subject: input.subject,
      status: 'SENT',
      responseTokenHash: token.tokenHash,
      responseTokenExpiresAt: null,
      sentByUserId: input.sentByUserId ?? null,
      sentAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();

  if (!created) {
    throw new Error('Failed to create supplier nomination link');
  }

  return { nomination: created, rawToken: token.rawToken };
}

export async function markSupplierNominationOpened(nomination: SupplierNomination): Promise<SupplierNomination> {
  if (nomination.openedAt) return nomination;

  const [updated] = await db
    .update(supplierNominations)
    .set({
      status: nomination.status === 'SENT' ? 'OPENED' : nomination.status,
      openedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(supplierNominations.id, nomination.id))
    .returning();

  return updated ?? nomination;
}

export async function expireSupplierNomination(nominationId: string): Promise<void> {
  await db
    .update(supplierNominations)
    .set({
      status: 'EXPIRED',
      responseTokenExpiresAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(supplierNominations.id, nominationId));
}

export async function saveSupplierNominationResponse(input: {
  nomination: SupplierNomination;
  deliveryCompletedConfirmed: boolean;
  deliveryCompletedAt: string | Date;
  supplierReference?: string | null;
  supplierComment?: string | null;
}): Promise<{ success: true } | { success: false; message: string }> {
  if (!input.deliveryCompletedConfirmed) {
    return { success: false, message: 'Supplier must confirm that delivery is completed' };
  }

  const deliveryCompletedAt = normalizeDate(input.deliveryCompletedAt);
  if (!deliveryCompletedAt) {
    return { success: false, message: 'Enter the exact delivery time before submitting' };
  }

  await db
    .update(supplierNominations)
    .set({
      status: 'SUBMITTED',
      deliveryCompletedConfirmed: true,
      deliveryCompletedAt,
      supplierReference: normalizeText(input.supplierReference),
      supplierComment: normalizeText(input.supplierComment),
      respondedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(supplierNominations.id, input.nomination.id));

  if (input.nomination.orderSupplierId) {
    await db
      .update(orderSuppliers)
      .set({
        deliveredAt: deliveryCompletedAt,
        updatedAt: new Date(),
      })
      .where(eq(orderSuppliers.id, input.nomination.orderSupplierId));

    await syncOrderDeliveredAtFromSuppliers(input.nomination.orderId);
  }

  return { success: true };
}

export async function linkOrderAttachmentToSupplierNomination(input: {
  supplierNominationId: string;
  orderAttachmentId: string;
}): Promise<void> {
  await db.insert(supplierNominationAttachments).values({
    supplierNominationId: input.supplierNominationId,
    orderAttachmentId: input.orderAttachmentId,
  });
}

export async function listSupplierNominationAttachments(supplierNominationId: string): Promise<SupplierNominationAttachmentDto[]> {
  const rows = await db
    .select({
      id: orderAttachments.id,
      fileName: orderAttachments.fileName,
      fileSize: orderAttachments.fileSize,
      createdAt: orderAttachments.createdAt,
    })
    .from(supplierNominationAttachments)
    .innerJoin(orderAttachments, eq(orderAttachments.id, supplierNominationAttachments.orderAttachmentId))
    .where(eq(supplierNominationAttachments.supplierNominationId, supplierNominationId))
    .orderBy(desc(orderAttachments.createdAt));

  return rows.map((row) => ({
    id: row.id,
    fileName: row.fileName,
    fileSize: row.fileSize,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function getLatestSupplierNominationForOrder(
  orderId: string,
  orderSupplierId?: string | null,
): Promise<SupplierNomination | null> {
  const [nomination] = await db
    .select()
    .from(supplierNominations)
    .where(and(
      eq(supplierNominations.orderId, orderId),
      orderSupplierId
        ? eq(supplierNominations.orderSupplierId, orderSupplierId)
        : undefined,
    ))
    .orderBy(desc(supplierNominations.sentAt))
    .limit(1);

  return nomination ?? null;
}

export async function getSupplierNominationSummary(
  orderId: string,
  orderSupplierId?: string | null,
): Promise<SupplierNominationSummaryDto | null> {
  const nomination = await getLatestSupplierNominationForOrder(orderId, orderSupplierId);
  if (!nomination) return null;

  const [attachments, supplier] = await Promise.all([
    listSupplierNominationAttachments(nomination.id),
    db
      .select({ name: counterparties.name })
      .from(counterparties)
      .where(eq(counterparties.id, nomination.supplierId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  return {
    id: nomination.id,
    orderSupplierId: nomination.orderSupplierId ?? null,
    supplierId: nomination.supplierId,
    supplierName: supplier?.name ?? null,
    status: nomination.status,
    sentAt: nomination.sentAt.toISOString(),
    openedAt: nomination.openedAt?.toISOString() ?? null,
    respondedAt: nomination.respondedAt?.toISOString() ?? null,
    deliveryCompletedConfirmed: nomination.deliveryCompletedConfirmed,
    deliveryCompletedAt: nomination.deliveryCompletedAt?.toISOString() ?? null,
    supplierReference: nomination.supplierReference ?? null,
    supplierComment: nomination.supplierComment ?? null,
    attachments,
  };
}