import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import type { SubmitSupplierInquiryQuoteDto, SupplierInquiryItemQuoteDto } from '@fueld/types';
import { db } from '../../db';
import { companyContacts, counterparties, plattsReportEntries, supplierInquiries, supplierInquiryItemQuotes, type SupplierInquiry, users } from '../../db/schema';
import { getOrderById } from '../orders/orders.service';
import { getInquirySettings } from '../admin/settings.service';
import { logActivity } from '../activity/activity.service';
import { buildInquiryReminderEmailHtml, sendDocumentEmail } from './mail.service';

const DEFAULT_SUPPLIER_QUOTE_EXPIRY_DAYS = 30;
const INQUIRY_REMINDER_INTERVAL_MS = 10 * 60 * 1000;

let inquiryReminderTimer: ReturnType<typeof setInterval> | null = null;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function hashSupplierQuoteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSupplierQuoteToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(24).toString('hex');
  return {
    rawToken,
    tokenHash: hashSupplierQuoteToken(rawToken),
  };
}

export function getSupplierQuoteExpiryDate(): Date {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + DEFAULT_SUPPLIER_QUOTE_EXPIRY_DAYS);
  return expiresAt;
}

export function getSupplierQuoteFormUrl(rawToken: string): string {
  const baseUrl = trimTrailingSlash(process.env['APP_URL']?.trim() || 'http://localhost:4200');
  return `${baseUrl}/supplier-quote/${rawToken}`;
}

export async function applyStaleSupplierInquiryStatuses(filters?: { orderId?: string; inquiryId?: string }): Promise<number> {
  const inquirySettings = await getInquirySettings();
  const hours = inquirySettings.autoMarkNoReplyAfterHours;
  if (hours == null || hours <= 0) return 0;

  const cutoff = new Date(Date.now() - (hours * 3_600_000));
  const whereClauses = [
    eq(supplierInquiries.status, 'SENT'),
    lte(supplierInquiries.sentAt, cutoff),
  ];

  if (filters?.orderId) {
    whereClauses.push(eq(supplierInquiries.orderId, filters.orderId));
  }
  if (filters?.inquiryId) {
    whereClauses.push(eq(supplierInquiries.id, filters.inquiryId));
  }

  const updated = await db
    .update(supplierInquiries)
    .set({
      status: 'NO_REPLY',
      canDeliver: null,
      declineReason: null,
      respondedAt: null,
      quotedAt: null,
      updatedAt: new Date(),
    })
    .where(and(...whereClauses))
    .returning({ id: supplierInquiries.id });

  return updated.length;
}

const moneyPattern = /^\d+(?:\.\d{1,4})?$/;

export type SupplierInquiryResponseStatus = 'SENT' | 'QUOTED' | 'DECLINED' | 'NO_REPLY';

export interface SaveSupplierInquiryResponseInput {
  inquiry: SupplierInquiry;
  status: SupplierInquiryResponseStatus;
  respondedAt?: string | Date | null;
  declineReason?: string | null;
  quoteValidUntil?: string | Date | null;
  deliveryWindow?: string | null;
  supplierPaymentTerms?: string | null;
  supplierComment?: string | null;
  items?: SubmitSupplierInquiryQuoteDto['items'];
}

export interface SupplierInquiryResponseOrderContext {
  currency: string;
  items: SupplierInquiryItemQuoteDto[];
}

function normalizeDate(value?: string | Date | null): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeText(value?: string | null): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function computeReminderAt(sentAt: Date, responseDeadlineAt: Date): Date {
  const totalMs = Math.max(0, responseDeadlineAt.getTime() - sentAt.getTime());
  const twentyFourHoursMs = 24 * 3_600_000;
  const reminderMs = totalMs > twentyFourHoursMs
    ? responseDeadlineAt.getTime() - twentyFourHoursMs
    : sentAt.getTime() + Math.max(30 * 60_000, Math.floor(totalMs / 2));
  return new Date(reminderMs);
}

function formatReminderDeadline(date: Date): string {
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export async function getSupplierInquiryOrderContext(orderId: string): Promise<SupplierInquiryResponseOrderContext | null> {
  const order = await getOrderById(orderId);
  if (!order) return null;

  const signalIds = Array.from(new Set(
    (order.items ?? [])
      .flatMap((item: any) => [item.costPlattsEntryId, item.salesPlattsEntryId])
      .filter((value: string | null | undefined): value is string => Boolean(value)),
  ));

  const signalMap = new Map<string, string>();
  if (signalIds.length > 0) {
    const rows = await db
      .select({ id: plattsReportEntries.id, rawText: plattsReportEntries.rawText })
      .from(plattsReportEntries)
      .where(inArray(plattsReportEntries.id, signalIds));
    for (const row of rows) signalMap.set(row.id, row.rawText);
  }

  return {
    currency: order.currency ?? 'USD',
    items: (order.items ?? []).map((item: any) => ({
      orderItemId: item.id,
      productType: item.productType,
      quantity: item.quantity,
      unit: item.unit,
      description: item.description ?? null,
      price: null,
      currency: order.currency ?? 'USD',
      marketSignal: signalMap.get(item.costPlattsEntryId) ?? signalMap.get(item.salesPlattsEntryId) ?? null,
      note: null,
    })),
  };
}

export async function processPendingInquiryReminders(): Promise<number> {
  const inquirySettings = await getInquirySettings();
  const now = new Date();
  const candidates = await db
    .select({
      id: supplierInquiries.id,
      orderId: supplierInquiries.orderId,
      supplierId: supplierInquiries.supplierId,
      contactId: supplierInquiries.contactId,
      email: supplierInquiries.email,
      subject: supplierInquiries.subject,
      quoteTokenHash: supplierInquiries.quoteTokenHash,
      quoteTokenExpiresAt: supplierInquiries.quoteTokenExpiresAt,
      sentByUserId: supplierInquiries.sentByUserId,
      sentAt: supplierInquiries.sentAt,
      responseDeadlineAt: supplierInquiries.responseDeadlineAt,
      reminderCount: supplierInquiries.reminderCount,
      senderName: users.name,
      senderEmail: users.email,
      supplierName: counterparties.name,
      contactName: companyContacts.name,
    })
    .from(supplierInquiries)
    .innerJoin(counterparties, eq(supplierInquiries.supplierId, counterparties.id))
    .leftJoin(companyContacts, eq(supplierInquiries.contactId, companyContacts.id))
    .leftJoin(users, eq(supplierInquiries.sentByUserId, users.id))
    .where(
      and(
        eq(supplierInquiries.status, 'SENT'),
        isNull(supplierInquiries.reminderSentAt),
        gt(supplierInquiries.responseDeadlineAt, now),
      ),
    );

  let sentCount = 0;
  for (const candidate of candidates) {
    if (!candidate.sentByUserId || !candidate.senderEmail || !candidate.responseDeadlineAt) continue;
    const reminderAt = computeReminderAt(candidate.sentAt, candidate.responseDeadlineAt);
    if (now < reminderAt || now >= candidate.responseDeadlineAt) continue;

    const order = await getOrderById(candidate.orderId);
    if (!order) continue;

    const reminderToken = inquirySettings.supplierResponseUrlEnabled ? createSupplierQuoteToken() : null;
    const quoteFormUrl = reminderToken ? getSupplierQuoteFormUrl(reminderToken.rawToken) : null;
    const htmlBody = buildInquiryReminderEmailHtml({
      senderName: candidate.senderName ?? 'Fueld User',
      vesselName: order.vessel?.name ?? 'Vessel',
      portName: order.place?.name ?? 'Port',
      orderNumber: order.orderNumber ?? candidate.orderId.slice(0, 8).toUpperCase(),
      supplierName: candidate.supplierName,
      contactName: candidate.contactName ?? null,
      responseDeadlineFormatted: formatReminderDeadline(candidate.responseDeadlineAt),
      quoteFormUrl,
    });

    try {
      await sendDocumentEmail({
        documentType: 'INQUIRY',
        orderId: candidate.orderId,
        tenantId: order.tenantId,
        sentByUserId: candidate.sentByUserId,
        senderEmail: candidate.senderEmail,
        senderName: candidate.senderName ?? 'Fueld User',
        recipientEmail: candidate.email,
        ccEmails: [],
        bccEmails: [],
        subject: `Reminder: ${candidate.subject}`,
        htmlBody,
      });

      await db
        .update(supplierInquiries)
        .set({
          quoteTokenHash: reminderToken?.tokenHash ?? candidate.quoteTokenHash,
          quoteTokenExpiresAt: reminderToken ? getSupplierQuoteExpiryDate() : candidate.quoteTokenExpiresAt,
          reminderSentAt: now,
          reminderCount: (candidate.reminderCount ?? 0) + 1,
          updatedAt: now,
        })
        .where(eq(supplierInquiries.id, candidate.id));

      await logActivity({
        tenantId: order.tenantId,
        entityType: 'order',
        entityId: candidate.orderId,
        userId: candidate.sentByUserId,
        action: 'EMAIL_SENT',
        metadata: {
          documentType: 'INQUIRY_REMINDER',
          supplierInquiryId: candidate.id,
          recipientEmail: candidate.email,
        },
      });
      sentCount += 1;
    } catch (error) {
      console.error('[SupplierInquiry] Failed to send reminder:', error);
    }
  }

  return sentCount;
}

export function startInquiryReminderJob(): void {
  if (inquiryReminderTimer) return;

  void processPendingInquiryReminders().catch((error) => {
    console.error('[SupplierInquiry] Initial reminder run failed:', error);
  });

  inquiryReminderTimer = setInterval(() => {
    void processPendingInquiryReminders().catch((error) => {
      console.error('[SupplierInquiry] Reminder run failed:', error);
    });
  }, INQUIRY_REMINDER_INTERVAL_MS);
}

export async function saveSupplierInquiryResponse(input: SaveSupplierInquiryResponseInput): Promise<{ success: true } | { success: false; message: string }> {
  const orderContext = await getSupplierInquiryOrderContext(input.inquiry.orderId);
  if (!orderContext) {
    return { success: false, message: 'Order not found' };
  }

  const orderItemIds = orderContext.items.map((item) => item.orderItemId);
  const respondedAt = normalizeDate(input.respondedAt);
  const quoteValidUntil = normalizeDate(input.quoteValidUntil);
  const deliveryWindow = normalizeText(input.deliveryWindow);
  const supplierPaymentTerms = normalizeText(input.supplierPaymentTerms);
  const supplierComment = normalizeText(input.supplierComment);
  const now = new Date();

  if ((input.status === 'QUOTED' || input.status === 'DECLINED') && !respondedAt) {
    return { success: false, message: 'Please provide when the supplier responded' };
  }

  if (input.status === 'DECLINED') {
    const declineReason = String(input.declineReason ?? '').trim();
    if (!declineReason) {
      return { success: false, message: 'Please provide a decline reason' };
    }

    await db.delete(supplierInquiryItemQuotes).where(eq(supplierInquiryItemQuotes.supplierInquiryId, input.inquiry.id));
    await db
      .update(supplierInquiries)
      .set({
        status: 'DECLINED',
        canDeliver: false,
        declineReason,
        respondedAt,
        quotedAt: null,
        quoteValidUntil: null,
        deliveryWindow: null,
        supplierPaymentTerms: null,
        supplierComment,
        updatedAt: now,
      })
      .where(eq(supplierInquiries.id, input.inquiry.id));

    return { success: true };
  }

  if (input.status === 'NO_REPLY' || input.status === 'SENT') {
    await db.delete(supplierInquiryItemQuotes).where(eq(supplierInquiryItemQuotes.supplierInquiryId, input.inquiry.id));
    await db
      .update(supplierInquiries)
      .set({
        status: input.status,
        canDeliver: null,
        declineReason: null,
        respondedAt: null,
        quotedAt: null,
        quoteValidUntil: null,
        deliveryWindow: null,
        supplierPaymentTerms: null,
        supplierComment: null,
        updatedAt: now,
      })
      .where(eq(supplierInquiries.id, input.inquiry.id));

    return { success: true };
  }

  const quoteItems = input.items ?? [];
  const seenIds = new Set<string>();
  let pricedLineCount = 0;
  for (const item of quoteItems) {
    if (!orderItemIds.includes(item.orderItemId)) {
      return { success: false, message: 'Quote contains an invalid line item' };
    }
    if (seenIds.has(item.orderItemId)) {
      return { success: false, message: 'Each line item can only be quoted once' };
    }
    seenIds.add(item.orderItemId);

    const price = String(item.price ?? '').trim();
    if (!price) {
      continue;
    }
    if (!moneyPattern.test(price)) {
      return { success: false, message: 'Please enter a valid price for each quoted line item' };
    }
    pricedLineCount += 1;
  }

  if (pricedLineCount === 0) {
    return { success: false, message: 'Please quote at least one line item' };
  }

  await db.delete(supplierInquiryItemQuotes).where(eq(supplierInquiryItemQuotes.supplierInquiryId, input.inquiry.id));
  await db.insert(supplierInquiryItemQuotes).values(
    quoteItems.map((item) => ({
      supplierInquiryId: input.inquiry.id,
      orderItemId: item.orderItemId,
      price: normalizeText(item.price) ?? null,
      currency: orderContext.currency,
      note: normalizeText(item.note),
    })),
  );

  await db
    .update(supplierInquiries)
    .set({
      status: 'QUOTED',
      canDeliver: true,
      declineReason: null,
      respondedAt,
      quotedAt: respondedAt,
      quoteValidUntil,
      deliveryWindow,
      supplierPaymentTerms,
      supplierComment,
      updatedAt: now,
    })
    .where(eq(supplierInquiries.id, input.inquiry.id));

  return { success: true };
}