// ═══════════════════════════════════════════════════════════════════════
//  Documents — Shared helper functions
//
//  Extracted from documents.controller.ts so that sub-controllers and the
//  main controller share them without circular deps.
// ═══════════════════════════════════════════════════════════════════════

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { orderTransferSides, orderAttachments, orderPortDocuments } from '../../db/schema';
import { getOrderById } from '../orders/orders.service';
import { getDeliveryDocumentationSettings } from '../admin/settings.service';

// ── Nomination response link helpers ─────────────────────────────────

export function buildNominationResponseLinkCardHtml(responseUrl: string): string {
  return `
    <div style="margin-top: 24px; border: 1px solid #dbeafe; border-radius: 12px; background: #f8fbff; padding: 18px;">
      <p style="margin: 0 0 12px; line-height: 1.6; color: #1f2937;">Please confirm delivery completion, submit the exact delivery time, and upload the BDRs here:</p>
      <a href="${responseUrl}" style="display: inline-block; border-radius: 999px; background: #1e3a5f; color: #ffffff; font-weight: 700; text-decoration: none; padding: 10px 16px;">Confirm delivery and upload BDRs</a>
      <p style="margin: 10px 0 0; font-size: 12px; line-height: 1.5; color: #6b7280;">If the button does not open, copy this URL into your browser: ${responseUrl}</p>
    </div>
  `;
}

export function injectNominationResponseLink(htmlBody: string, responseUrl: string): string {
  const replaced = htmlBody.replace(/\{\{nominationResponseUrl\}\}|\$\{nominationResponseUrl\}/g, responseUrl);
  if (replaced.includes(responseUrl)) {
    return replaced;
  }
  return `${replaced}${buildNominationResponseLinkCardHtml(responseUrl)}`;
}

// ── Transfer document block check ────────────────────────────────────

/**
 * For internal-transfer orders, finance documents (proforma/invoice) must not be
 * generated until the relevant transfer side is finalized. Returns null when the
 * order is not a transfer; otherwise returns an error message when blocked, or
 * the empty string when the requested side is finalized.
 */
export async function getTransferDocumentBlockReason(
  order: Awaited<ReturnType<typeof getOrderById>>,
  side: 'SOURCE_SELL' | 'DESTINATION_BUY' = 'SOURCE_SELL',
): Promise<string | null> {
  if (!order || (order as { orderKind?: string }).orderKind !== 'INTERNAL_TRANSFER') return null;
  const [row] = await db
    .select({ status: orderTransferSides.status })
    .from(orderTransferSides)
    .where(and(
      eq(orderTransferSides.orderId, order.id),
      eq(orderTransferSides.kind, side),
    ))
    .limit(1);
  if (!row) return 'Transfer side not configured';
  if (row.status !== 'FINALIZED') {
    return `${side === 'SOURCE_SELL' ? 'Source' : 'Destination'} side is still in DRAFT — finalize it before generating documents`;
  }
  return '';
}

// ── Nomination supplier resolution ───────────────────────────────────

export function resolveNominationOrderSupplier(
  order: Awaited<ReturnType<typeof getOrderById>>,
  orderSupplierId?: string | null,
) {
  const supplierLegs = order?.orderSuppliers ?? [];
  if (supplierLegs.length > 0) {
    if (orderSupplierId) {
      const selected = supplierLegs.find((supplier) => supplier.id === orderSupplierId) ?? null;
      if (!selected) {
        return { supplier: null, message: 'Selected supplier does not belong to this order' };
      }
      return { supplier: selected, message: null };
    }

    if (supplierLegs.length > 1) {
      return { supplier: null, message: 'Select which supplier you want to nominate first' };
    }

    return { supplier: supplierLegs[0]!, message: null };
  }

  if (!order?.supplierId) {
    return { supplier: null, message: 'Select a supplier first' };
  }

  return {
    supplier: {
      id: null,
      companyId: order.supplierId,
      contactId: order.supplierContactId ?? null,
      paymentTermType: order.supplierPaymentTermType ?? null,
      creditDays: order.supplierCreditDays ?? null,
      note: order.supplierNote ?? null,
      company: order.supplier ?? null,
      contact: order.supplierContact ?? null,
    },
    message: null,
  };
}

export function countNominationItemsForSupplier(
  order: Awaited<ReturnType<typeof getOrderById>>,
  orderSupplier?: { id: string | null; isPrimary?: boolean | null } | null,
): number {
  const items = order?.items ?? [];
  const supplierCount = order?.orderSuppliers?.length ?? 0;
  if (!orderSupplier?.id || supplierCount <= 1) {
    return items.length;
  }
  return items.filter((item) => {
    if (item.orderSupplierId === orderSupplier.id) return true;
    return orderSupplier.isPrimary === true && !item.orderSupplierId;
  }).length;
}

// ── Attachment loading ──────────────────────────────────────────────

export async function loadSelectedOrderAttachments(orderId: string, attachmentIds: string[]) {
  if (attachmentIds.length === 0) return [];

  const rows = await db
    .select()
    .from(orderAttachments)
    .where(and(
      eq(orderAttachments.orderId, orderId),
      inArray(orderAttachments.id, attachmentIds),
    ));

  if (rows.length !== attachmentIds.length) {
    throw new Error('One or more selected attachments were not found on this order');
  }

  const docSettings = await getDeliveryDocumentationSettings();
  const allowedTypes = docSettings.deliveryDocumentationTypes;
  if (rows.some((row) => !allowedTypes.includes(String(row.type ?? '').toUpperCase()))) {
    throw new Error(`Only ${allowedTypes.join('/')} attachments can be added to invoice emails`);
  }

  return Promise.all(rows.map(async (row) => {
    const normalizedPath = row.filePath.startsWith('/') ? row.filePath : `/${row.filePath}`;
    const file = Bun.file(`${process.cwd()}${normalizedPath}`);
    if (!(await file.exists())) {
      throw new Error(`Attachment file is missing: ${row.fileName}`);
    }

    return {
      filename: row.fileName,
      content: Buffer.from(await file.arrayBuffer()),
      contentType: row.mimeType,
    };
  }));
}

export async function loadSelectedOrderPortDocuments(orderId: string, documentIds: string[]) {
  if (documentIds.length === 0) return [];

  const rows = await db
    .select()
    .from(orderPortDocuments)
    .where(and(
      eq(orderPortDocuments.orderId, orderId),
      inArray(orderPortDocuments.id, documentIds),
    ));

  if (rows.length !== documentIds.length) {
    throw new Error('One or more selected Port Documentation files were not found on this order');
  }

  return Promise.all(rows.map(async (row) => {
    const normalizedPath = row.filePath.startsWith('/') ? row.filePath : `/${row.filePath}`;
    const file = Bun.file(`${process.cwd()}${normalizedPath}`);
    if (!(await file.exists())) {
      throw new Error(`Port Documentation file is missing: ${row.fileName}`);
    }

    return {
      filename: row.fileName,
      content: Buffer.from(await file.arrayBuffer()),
      contentType: row.mimeType,
    };
  }));
}

// ── Inquiry helpers ─────────────────────────────────────────────────

export function calculateInquiryResponseHours(sentAt: Date | null, respondedAt: Date | null): number | null {
  if (!sentAt || !respondedAt) return null;
  const diffMs = respondedAt.getTime() - sentAt.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  return Number((diffMs / 3_600_000).toFixed(2));
}

export function formatInquiryQuantity(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return trimmed;
  return trimmed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

export function buildInquiryWhatsAppText(params: {
  supplierName: string;
  contactName?: string | null;
  senderName: string;
  companyName?: string | null;
  vesselName: string;
  vesselImo?: string | null;
  portName: string;
  etaFormatted?: string | null;
  etdFormatted?: string | null;
  responseDeadlineFormatted?: string | null;
  personalNote?: string | null;
  quoteFormUrl?: string | null;
  items: Array<{ quantity: string; quantityMin?: string | null; unit: string; productType: string; description?: string | null }>;
}): string {
  const preferredName = params.contactName?.trim() || params.supplierName.trim() || 'there';
  const vesselLabel = params.vesselImo
    ? `${params.vesselName} (IMO: ${params.vesselImo})`
    : params.vesselName;
  const deliveryLabel = params.etaFormatted && params.etdFormatted
    ? `${params.etaFormatted} to ${params.etdFormatted}`
    : params.etaFormatted || params.etdFormatted || null;
  const companyName = params.companyName?.trim() || 'FUELD';
  const itemLines = params.items.map((item) => {
    const max = formatInquiryQuantity(item.quantity);
    const min = formatInquiryQuantity(item.quantityMin);
    const qtyLabel = min && min !== max ? `${min} - ${max}` : max;
    return `- ${qtyLabel} ${item.unit} ${item.productType}${item.description ? ` - ${item.description}` : ''}`;
  });

  return [
    `Good day ${preferredName},`,
    '',
    params.personalNote?.trim() || null,
    params.personalNote?.trim() ? '' : null,
    'Please offer for the following:',
    `*Vessel:* ${vesselLabel}`,
    `*Place:* ${params.portName}`,
    deliveryLabel ? `*Delivery:* ${deliveryLabel}` : null,
    params.responseDeadlineFormatted ? `*Reply within:* ${params.responseDeadlineFormatted}` : null,
    `*Account:* ${companyName}`,
    '',
    '*Requested items:*',
    ...itemLines,
    params.quoteFormUrl?.trim() ? '' : null,
    params.quoteFormUrl?.trim() ? `Submit quote here: ${params.quoteFormUrl.trim()}` : null,
    '',
    `Best regards,`,
    params.senderName,
  ].filter((line): line is string => line !== null && line !== undefined).join('\n');
}
