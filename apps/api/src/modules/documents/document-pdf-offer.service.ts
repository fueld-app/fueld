// ═══════════════════════════════════════════════════════════════════════
//  Document PDF Generators — PDF document definitions (invoice, offer,
//  proforma invoice, nomination) using pdfmake.
// ═══════════════════════════════════════════════════════════════════════

import pdfmake from 'pdfmake';
import vfsFonts from 'pdfmake/build/vfs_fonts.js';
import type { TDocumentDefinitions, Content, TableCell } from 'pdfmake/interfaces';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { db } from '../../db';
import { bankAccounts, orders, orderItems, counterparties, vessels, places, invoices, users, priceReferences, tenants } from '../../db/schema';
import type { TenantSettings } from '../../db/schema';
import QRCode from "qrcode";
import { createPdfBuffer, phoneTextNode, emailTextNode, buildNotesSection } from './document-pdf.service';
import {
  getCompanyRegistrationNumber, loadBankDetails, tryLoadLogoDataUrl,
  formatCustomerPaymentTerms, formatStoredDateOnlyForDisplay,
  formatNumber, formatNumberCompact, normalizeCountryName, countryAlreadyInAddress,
  formatPhoneDisplay, splitAddressLines, formatIssuedAtUtc,
} from './document-utils.service';
import { createDocumentRevision, getRevisionAbsolutePath, mapRevisionInfo } from './document-revision.service';
import { getDateFormatSettings, getCostSalesDecimalPrecision } from '../admin/settings.service';
import {
  fetchOrderForInvoice,
  computeDueDate,
  loadOrderBankDetails,
  maxMs,
  maxItemUpdatedAtMs,
  persistDocumentRevision,
  overwriteDocumentRevisionArtifact,
  getLatestDocumentRevisionByStream,
  loadDocumentRevisionBuffer,
  trimTrailingSlash,
  sanitizePathSegment,
  documentTypePrefix,
  buildVerificationRef,
  resolveDocumentStreamTarget,
  buildDocumentStreamKey,
  toMs,
  parseTimezoneOffset,
  replaceCompanyNamePlaceholder,
  formatDateTimeForDisplay,
  buildOfferForAccountOfText,
} from './document.service';
import { phoneToTelUri, getPublicApiBaseUrl } from './document-utils.service';
import type { DocumentRevisionInfo, BankDetails, DocumentPrintMeta, DocumentType } from './document.types';
import { DEFAULT_BANK_DETAILS } from './document.types';

const pdfmakeVfs = (pdfmake as any)?.virtualfs;
if (pdfmakeVfs && typeof pdfmakeVfs.writeFileSync === 'function') {
  for (const [fontFileName, base64Data] of Object.entries(vfsFonts as Record<string, string>)) {
    pdfmakeVfs.writeFileSync(fontFileName, base64Data, 'base64');
  }
}

pdfmake.setFonts({
  Roboto: {
    normal: 'Roboto-Regular.ttf',
    bold: 'Roboto-Medium.ttf',
    italics: 'Roboto-Italic.ttf',
    bolditalics: 'Roboto-MediumItalic.ttf',
  },
});

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
  purchaseOrderNumber?: string | null;
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
      parts.push({ text: email, link: `mailto:${email}`, color: '#1a56db' });
    }
    if (email && phone) {
      parts.push('  |  ');
    }
    if (phone) {
      parts.push({ text: formatPhoneDisplay(phone) ?? phone, link: phoneToTelUri(phone), color: '#1a56db' });
    }
    if (!parts.length) return null;
    return {
      text: [{ text: 'Contact details:  ', bold: true }, ...parts],
      margin: [0, 0, 0, 4],
    } as Content;
  })();

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
          ...(data.purchaseOrderNumber?.trim() ? [
            [{ text: 'PO No.:', bold: true, alignment: 'right', margin: [0, 0, 4, 0] }, { text: data.purchaseOrderNumber.trim(), alignment: 'right' }],
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
          text: `Issued (UTC): ${formatIssuedAtUtc(data.printMeta.issuedAt, data.dateFormat ?? undefined)}   Revision: ${data.printMeta.revisionNumber}   Ref: ${data.printMeta.verificationRef}   Fingerprint: ${data.printMeta.fingerprintShort}`,
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
        customerNotes: data.customerNote,
        termsAndConditions: data.termsAndConditions,
        vendorName: data.companyName ?? '',
        clientName: data.clientName,
        vesselName: data.vesselName,
        placeName: data.portName,
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
  const { dateFormat } = await getDateFormatSettings();
  const { precision: costSalesDecimalPrecision } = await getCostSalesDecimalPrecision();
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

export function resolveNominationSupplierContext(
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
  const { dateFormat } = await getDateFormatSettings();
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
    items: nominationContext.items.map((item) => ({
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

